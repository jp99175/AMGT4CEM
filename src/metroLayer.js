/**
 * Construction des couches Leaflet à partir des entités jointes par referentiel.js
 * (data/geometries/polygones.shp + data/referentiel/polygones.json, jointure par `id`).
 *
 * Chaque polygone porte son `genre` (issu du référentiel, pas du shapefile) :
 *  - "station" : emprise de station (couche Stations) ;
 *  - "tunnel" : emprise de tunnel / tronçon (couche Tunnels) ;
 *  - "planche" : plan d'ensemble au 1/500e, étiquette = `sheet_ref` du référentiel
 *    (affichage piloté par le sélecteur « Plans patrimoine », voir patrimoineLayer.js).
 * Tout le reste (noms FR/NL, liste des noms d'une station, niveau...) vient du référentiel.
 * Un polygone sans entrée de référentiel n'a pas de genre : il n'est pas affiché.
 * Chaque polygone est un seul anneau extérieur, sans trou. CRS : EPSG:31370 (Belgian Lambert 72).
 *
 * LEGACY (data/legacy/reperes-troncons.legacy.json, type "PE_info", sans identifiant) : les
 * TRIANGLES de transition entre tronçons de construction relevés dans INFRAVIEW.pdf (Polygon)
 * et leurs CODES (Point, ex. "D1", "G1a"), rendus en texte HTML dont la taille suit le zoom
 * (scaledText.js). Ils seront rattachés à lignes.shp quand il existera ; en attendant ils
 * s'affichent avec les planches. Non interactifs pour les textes : un clic doit atteindre la
 * forme en dessous.
 *
 * Les références de planche (texte orange) ne viennent pas des shapefiles : leur liste est
 * celle de data/fond-de-plan/etiquettes-planches.json (source unique, voir peLabelAnchors.js).
 *
 * CALAGE PDF → Lambert (commun à tout ce qui vient d'INFRAVIEW.pdf) : voir README, section 4bis.
 *
 * Les planches sont de larges zones qui recouvrent des stations/tunnels : voir app.js (ordre
 * d'ajout des couches, planches en dessous) pour que cliquer sur une station ouvre bien sa
 * popup. Les triangles PE_info, plaqués SUR un tunnel, suivent la règle inverse (voir
 * patrimoineLayer.js#registerExternalLayer, bringToBack()/bringToFront()).
 */
// Uniquement les types encore rendus en L.polygon (Path : fillOpacity/
// weight s'appliquent, voir mapMenu.js _applyMetroOpacity qui parcourt
// cette table et appelle layer.setStyle(...) sur chaque groupe — une
// méthode que L.Marker n'a pas). Les textes PE_info/PE_label (L.marker,
// voir _buildScaledLabel) ont leur propre style, passé directement au
// constructeur du marqueur, pas via cette table.
const AMGT4CEM_METRO_TYPES = {
  MS: { label: 'Stations', color: '#c0392b', fillOpacity: 0.55, weight: 1 },
  MT: { label: 'Tunnels', color: '#2c3e50', fillOpacity: 0.35, weight: 1 },
  PE: { label: "Plans d'ensemble (1/500e)", color: '#b8860b', fillOpacity: 0.06, weight: 1 },
  PE_info: { label: 'Repères tronçons', color: '#575757', fillOpacity: 1, weight: 0 },
};

// Couleurs des textes PE_info/PE_label (L.marker, voir _buildScaledLabel),
// reprises telles quelles d'INFRAVIEW.pdf (couleur RGB exacte des objets
// texte du PDF, pas une approximation) : gris pour les codes de tronçon,
// orange pour les références de planche/plan (même teinte que les
// repères "4000-138"... visibles sur le plan lui-même). Hauteur réelle
// visée ~42 m, dérivée de la taille de police d'origine dans le PDF
// (~8pt) une fois passée par l'échelle du calage affine (~5.3 m/pt).
const AMGT4CEM_LABEL_STYLES = {
  PE_info: { color: '#575757', heightMeters: 42 },
  PE_label: { color: '#ff7f00', heightMeters: 42 },
};

/** Clé de style / de groupe Leaflet (MS, MT, PE) associée à chaque genre du référentiel ; le genre sert aussi de `kind` à la recherche. */
const AMGT4CEM_METRO_TYPE_BY_GENRE = { station: 'MS', tunnel: 'MT', planche: 'PE' };

const AMGT4CEM_MetroLayer = {
  /**
   * @param {object} geojson - FeatureCollection des entités jointes (referentiel.js) + repères legacy (non modifiée)
   * @returns {{ layersByType: Object.<string, L.LayerGroup>, bounds: L.LatLngBounds, searchIndex: object[] }}
   */
  build(geojson) {
    const layersByType = {
      MS: L.layerGroup(),
      MT: L.layerGroup(),
      PE: L.layerGroup(),
      PE_info: L.layerGroup(), // triangles (L.polygon)
      PE_info_text: L.layerGroup(), // codes de tronçon (L.marker, texte)
      PE_label: L.layerGroup(), // références de planche (L.marker, texte)
    };
    const bounds = L.latLngBounds([]);
    const searchIndex = [];
    // Certaines planches (PE) se chevauchent (constaté sur ce jeu de
    // données) : accumulée au fil de la boucle, complète au moment où un clic peut
    // réellement survenir (après le rendu initial), voir _sheetRefsAt.
    const peFeatures = [];

    for (const feature of geojson.features || []) {
      const props = feature.properties || {};

      if (props.type === 'PE_info') { // legacy
        if (!feature.geometry) continue;
        if (feature.geometry.type === 'Polygon') {
          this._buildInfoShapes(feature, layersByType.PE_info, bounds); // triangle
        } else if (feature.geometry.type === 'Point') {
          this._buildScaledLabel(feature, layersByType.PE_info_text, bounds, AMGT4CEM_LABEL_STYLES.PE_info);
        }
        continue;
      }

      const type = AMGT4CEM_METRO_TYPE_BY_GENRE[props.genre];
      const style = AMGT4CEM_METRO_TYPES[type];
      if (!style || !feature.geometry || feature.geometry.type !== 'Polygon') continue;
      if (type === 'PE') peFeatures.push(feature);

      // Un seul anneau extérieur par polygone dans ce jeu de données.
      const ring = feature.geometry.coordinates[0];
      const latlngs = ring.map(AMGT4CEM_CRS.lambertToLatLng);

      const polygon = L.polygon(latlngs, {
        color: props.couleur || style.color,
        weight: style.weight,
        fillOpacity: style.fillOpacity,
      });

      // bindPopup ouvrirait automatiquement la popup au clic ; on retire ce
      // comportement par défaut (`off`) pour le remplacer par le nôtre, qui
      // laisse la priorité à l'outil "Ajouter un point" quand il est actif —
      // sans ça, cliquer sur une station/un tunnel n'ouvrirait que sa popup
      // d'info et ne poserait jamais de point à cet endroit.
      polygon.off('click');
      if (type === 'PE') {
        // Contenu recalculé à CHAQUE clic (pas de bindPopup statique) :
        // plusieurs planches peuvent se chevaucher à l'endroit cliqué, un
        // simple bindPopup ne révélerait que celle au-dessus dans l'ordre
        // d'affichage (voir _sheetRefsAt).
        polygon.bindPopup('');
        polygon.on('click', (e) => {
          if (AMGT4CEM_AddPointTool.isActive()) {
            L.DomEvent.stopPropagation(e);
            AMGT4CEM_AddPointTool.handleMapClick(e);
            return;
          }
          const refs = this._sheetRefsAt(e.latlng, peFeatures);
          polygon.setPopupContent(this._buildPePopupHtml(refs));
          polygon.openPopup(e.latlng);
        });
      } else {
        // Contenu calculé à l'ouverture (fonction) : les numéros d'interstation d'un tunnel
        // ne sont associés qu'une fois leur fichier chargé (interstation.js).
        polygon.bindPopup(() => this._buildPopupHtml(props));
        polygon.on('click', (e) => {
          if (AMGT4CEM_AddPointTool.isActive()) {
            L.DomEvent.stopPropagation(e);
            AMGT4CEM_AddPointTool.handleMapClick(e);
          } else {
            polygon.openPopup(e.latlng);
          }
        });
      }
      if (type === 'MT') polygon._amgtTunnelId = props.id; // voir interstation.js / plugin pe-label-editor
      if (type === 'PE') polygon._amgtSheetRef = props.sheet_ref || ''; // plugin pe-label-editor : planche choisie pour une nouvelle étiquette
      polygon.addTo(layersByType[type]);
      bounds.extend(polygon.getBounds());

      // Une planche (PE) n'a pas de nom FR/NL, seulement sa référence
      // (sheet_ref) : c'est elle qui sert de libellé de recherche. Une station
      // peut porter plusieurs noms (props.noms) : tous sont cherchables.
      const label = type === 'PE'
        ? (props.sheet_ref || '(sans référence)')
        : (props.name_fr || props.name_nl || '(sans nom)');
      const noms = (props.noms || []).flatMap((n) => [n.fr, n.nl, n.reference]);
      searchIndex.push({
        kind: props.genre,
        label,
        searchText: [props.name_fr, props.name_nl, props.sheet_ref, ...noms].filter(Boolean).join(' '),
        bounds: polygon.getBounds(),
      });
    }

    // Références de planche : le JSON (data/fond-de-plan/etiquettes-planches.json) est la liste COMPLÈTE.
    this._peLabelGroup = layersByType.PE_label;
    this._peLabelDisplayGroup = null;
    for (const [key, def] of Object.entries(AMGT4CEM_PeLabelAnchors.all())) {
      const marker = this.createPeLabel(key, def);
      marker.addTo(layersByType.PE_label);
      bounds.extend(marker.getLatLng());
    }

    return { layersByType, bounds, searchIndex };
  },

  // ---- Références de planche : création / suppression à l'exécution (plugin pe-label-editor) ------

  /**
   * Texte « référence de planche » (clé « 1000-236#0 » : référence, rang). Sans définition (étiquette en cours
   * de création), le texte est posé en `at` (L.LatLng), le temps de choisir ses points.
   */
  createPeLabel(key, def, at) {
    const style = AMGT4CEM_LABEL_STYLES.PE_label;
    const marker = AMGT4CEM_ScaledText.createMarker(at || L.latLng(def.a1), key.split('#')[0], {
      color: style.color,
      heightMeters: style.heightMeters,
      def: def && def.r1 && def.a1 ? def : undefined,
    });
    marker._amgtKey = key;
    return marker;
  },

  /** Groupe d'affichage commun de la couche « Plans d'ensemble » (app.js), où doivent aussi être ajoutés les marqueurs créés. */
  setPeLabelDisplayGroup(group) {
    this._peLabelDisplayGroup = group;
  },

  addPeLabel(marker) {
    this._peLabelGroup.addLayer(marker);
    if (this._peLabelDisplayGroup) this._peLabelDisplayGroup.addLayer(marker);
  },

  removePeLabel(marker) {
    this._peLabelGroup.removeLayer(marker);
    if (this._peLabelDisplayGroup) this._peLabelDisplayGroup.removeLayer(marker);
    AMGT4CEM_ScaledText.dispose(marker);
  },

  /** Premier rang libre pour une référence : « 3000-126#0 », « 3000-126#1 »... */
  nextPeKey(code) {
    const keys = new Set();
    this._peLabelGroup.eachLayer((m) => keys.add(m._amgtKey));
    const saved = AMGT4CEM_PeLabelAnchors.all();
    let rank = 0;
    while (keys.has(`${code}#${rank}`) || saved[`${code}#${rank}`]) rank++;
    return `${code}#${rank}`;
  },

  /** État COURANT des références de planche { clé: { r1, a1, r2?, a2? } } (a1/a2 en [lat, lng]), modifs non enregistrées comprises. */
  currentPeLabels() {
    const out = {};
    this._peLabelGroup.eachLayer((marker) => {
      const d = AMGT4CEM_ScaledText.getDefinition(marker);
      if (!d || !d.r1 || !d.a1) return; // étiquette sans définition complète (en cours de création)
      out[marker._amgtKey] = { r1: d.r1, a1: d.a1, ...(d.r2 && d.a2 ? { r2: d.r2, a2: d.a2 } : {}) };
    });
    return out;
  },

  /** Fait correspondre les références de planche à `labels` : retire, ajoute et met à jour (annulation, réinitialisation). */
  syncPeLabels(labels) {
    const present = {};
    this._peLabelGroup.eachLayer((m) => (present[m._amgtKey] = m));
    for (const [key, m] of Object.entries(present)) if (!labels[key]) this.removePeLabel(m);
    for (const [key, def] of Object.entries(labels)) {
      if (present[key]) AMGT4CEM_ScaledText.setDefinition(present[key], def);
      else this.addPeLabel(this.createPeLabel(key, def));
    }
  },

  _buildPopupHtml(props) {
    // Données du référentiel (jointes par `id`) : seules les valeurs renseignées sont affichées.
    const row = (label, value) => (value === '' || value === null || value === undefined ? '' : `<tr><th>${label}</th><td>${this._esc(value)}</td></tr>`);
    let rows = row('Nom (FR)', props.name_fr) + row('Nom (NL)', props.name_nl);
    // Une station peut porter plusieurs noms et références (liste du référentiel).
    for (const n of props.noms || []) {
      rows += row('Nom', [n.fr, n.nl].filter(Boolean).join(' / ')) + row('Référence', n.reference);
    }
    rows += row('Niveau', props.niveau);
    // Tunnel (tronçon) : son ou ses numéros d'interstation (les étiquettes de la couche n'ont pas d'infobulle).
    if (props.genre === 'tunnel') {
      const numbers = AMGT4CEM_Interstation.numbersForTunnel(props.id);
      if (numbers.length) rows += row('N° interstation', numbers.join(', '));
    }
    rows += row('Identifiant', props.id);
    return `<div class="amgt-popup"><table>${rows}</table></div>`;
  },

  _esc(value) {
    return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  },

  /**
   * Numéros de planche (sheet_ref) de toutes les planches (PE) dont
   * l'emprise contient ce point — normalement une seule, sauf dans les
   * zones où plusieurs planches se chevauchent (voir _pointInRing).
   * Logique reprise de l'ancien src/patrimoineLayer.js.
   */
  _sheetRefsAt(latlng, peFeatures) {
    const { x, y } = AMGT4CEM_CRS.latLngToLambert(latlng);
    const refs = [];
    for (const f of peFeatures) {
      if (!this._pointInRing([x, y], f.geometry.coordinates[0])) continue;
      const ref = f.properties && f.properties.sheet_ref;
      if (ref) refs.push(ref);
    }
    return refs;
  },

  /** Test point-dans-polygone (ray casting), coordonnées Lambert des deux côtés. */
  _pointInRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  },

  /**
   * Repère "PE_info" (transition entre deux tronçons de construction, voir
   * en-tête du fichier) : une entité peut combiner plusieurs formes
   * disjointes (triangle + chaque caractère du code) — voir
   * _groupRingsIntoShapes(). Un L.polygon par forme, toutes liées au même
   * popup (le code), pour que cliquer n'importe où dans le symbole
   * (triangle ou une lettre) l'affiche.
   */
  _buildInfoShapes(feature, group, bounds) {
    const props = feature.properties || {};
    const shapes = this._groupRingsIntoShapes(feature.geometry.coordinates);
    const style = AMGT4CEM_METRO_TYPES.PE_info;
    const popupHtml = this._buildInfoPopupHtml(props);

    for (const rings of shapes) {
      const latlngRings = rings.map((ring) => ring.map(AMGT4CEM_CRS.lambertToLatLng));
      const polygon = L.polygon(latlngRings, {
        stroke: false,
        fillColor: style.color,
        fillOpacity: style.fillOpacity,
      });
      // Ces formes sont délibérément plaquées SUR un tunnel (MT, voir
      // README section 4bis) : elles doivent donc rester AU-DESSUS de
      // MS/MT (l'inverse des planches PE), sans quoi elles seraient
      // invisibles au clic. Voir patrimoineLayer.js#registerExternalLayer.
      polygon._amgtBringToFront = true;
      polygon.off('click');
      polygon.bindPopup(popupHtml);
      polygon.on('click', (e) => {
        if (AMGT4CEM_AddPointTool.isActive()) {
          L.DomEvent.stopPropagation(e);
          AMGT4CEM_AddPointTool.handleMapClick(e);
        } else {
          polygon.openPopup(e.latlng);
        }
      });
      polygon.addTo(group);
      bounds.extend(polygon.getBounds());
    }
  },

  /**
   * Regroupe la liste plate d'anneaux d'une entité Polygon Shapefile (voir
   * shpLoader.js) en formes indépendantes [anneau extérieur, ...trous],
   * selon la convention ESRI standard : un anneau à sens horaire démarre
   * une nouvelle forme, un anneau antihoraire est un trou de la forme en
   * cours (déterminé ici par l'aire signée, formule du lacet). Seuls les
   * triangles PE_info en ont besoin (MS/MT/PE n'ont jamais qu'un anneau
   * extérieur ; en pratique un triangle n'a lui-même qu'une seule forme,
   * sans trou — ce regroupement générique reste néanmoins la façon la plus
   * directe de lire un Polygon Shapefile sans supposer par avance son
   * nombre de parties).
   */
  _groupRingsIntoShapes(rings) {
    const shapes = [];
    for (const ring of rings) {
      if (this._signedArea(ring) < 0) {
        shapes.push([ring]);
      } else if (shapes.length) {
        shapes[shapes.length - 1].push(ring);
      }
    }
    return shapes;
  },

  _signedArea(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      sum += x1 * y2 - x2 * y1;
    }
    return sum / 2;
  },

  /**
   * Texte PE_info (code de tronçon) ou PE_label (référence de planche) :
   * L.marker texte dont la taille suit le zoom (voir scaledText.js), pour
   * un rendu proche d'INFRAVIEW.pdf (texte à taille réelle constante, pas
   * une taille d'écran fixe). Non interactif : un clic doit atteindre la
   * forme en dessous (triangle pour PE_info, planche pour PE_label — cette
   * dernière gère déjà elle-même le cas de plusieurs planches superposées,
   * _sheetRefsAt), pas s'arrêter sur le texte.
   */
  _buildScaledLabel(feature, group, bounds, style, key) {
    const props = feature.properties || {};
    const latlng = AMGT4CEM_CRS.lambertToLatLng(feature.geometry.coordinates);
    const marker = AMGT4CEM_ScaledText.createMarker(latlng, props.code || '', {
      color: style.color,
      heightMeters: style.heightMeters,
      rotationDeg: props.angle || 0,
      side: props.side || undefined,
      def: key ? AMGT4CEM_PeLabelAnchors.get(key) : undefined, // définition partagée (administrateurs), sinon position d'origine
    });
    marker._amgtKey = key;
    marker.addTo(group);
    bounds.extend(latlng);
  },

  _buildInfoPopupHtml(props) {
    return `<div class="amgt-popup"><table>` +
      `<tr><th>Tronçon</th><td>${props.code || '?'}</td></tr>` +
      `</table></div>`;
  },

  _buildPePopupHtml(refs) {
    if (refs.length > 1) {
      const items = refs.map((ref) => `<li>${ref}</li>`).join('');
      return `<div class="amgt-popup"><strong>Planches superposées à cet endroit :</strong>` +
        `<ul class="amgt-popup-list">${items}</ul></div>`;
    }
    const label = refs[0] ? `Planche ${refs[0]}` : "Plan d'ensemble 1/500e";
    return `<div class="amgt-popup"><strong>${label}</strong></div>`;
  },
};
