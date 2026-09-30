/**
 * Construction des couches Leaflet à partir des données de référence
 * (Metro_export_SHP/Metro.shp + MetroInfo.shp + MetroLabels.shp, voir
 * shpLoader.js — les trois FeatureCollections sont fusionnées par app.js
 * avant l'appel à build()).
 *
 * Metro.shp : 192 polygones (aucune ligne/point), avec un seul attribut de
 * classification utile : `type` = "MS" (emprise de station, 69 entités),
 * "MT" (emprise de tunnel, 87 entités) ou "PE" (plan d'ensemble au 1/500e,
 * 36 entités — attribut propre : `sheet_ref`, le numéro de planche ; pas de
 * nom FR/NL, une planche n'en a pas). Chaque polygone est un seul anneau
 * extérieur, sans trou. CRS : EPSG:31370 (Belgian Lambert 72).
 *
 * MetroInfo.shp (106 entités `type = "PE_info"`, Polygon) : les TRIANGLES
 * de transition entre tronçons de construction relevés dans INFRAVIEW.pdf
 * (STIB, plan "Station & Interstation Infrastructure", attribut `code` —
 * ex. "D1", "G1a") — chaque petit triangle gris du plan y marque la
 * frontière entre deux tronçons identifiés par un code. Coordonnées
 * vectorielles extraites directement du PDF (ce sont de vraies formes
 * vectorielles dans le fichier, pas des pixels), orientation fidèle à
 * chacune. Position brute issue de la transformation affine (échelle +
 * rotation + translation) calée sur 43 stations déjà connues de Metro.shp
 * (résidu médian ~13-25 m) — AUCUN recalage individuel sur le tunnel (MT)
 * le plus proche (essayé, puis abandonné : un recalage propre à chaque
 * repère casse le caractère "préserve les distances" d'une transformation
 * affine globale et peut faire dériver deux repères l'un vers l'autre ;
 * préférer la position du plan source, quitte à être décalé de quelques
 * mètres du tracé exact, plutôt que de résoudre l'un en cassant l'autre).
 * Voir le README section 4bis pour le détail de la méthode et ses limites
 * (11 triangles sur 117 exclus, association triangle → code trop
 * incertaine au-delà d'un certain seuil de distance).
 *
 * MetroLabels.shp (117 entités, Point) : les points d'ancrage des CODES et
 * des RÉFÉRENCES DE PLANCHE, rendus en texte HTML (pas en polygone — un
 * premier essai avait tracé ce texte en contours de caractères extraits,
 * jugé après coup moins lisible qu'un texte HTML classique) dont la taille
 * suit le zoom pour simuler une hauteur réelle constante (voir
 * scaledText.js) :
 * - `type = "PE_info"` (80, un par code UNIQUE — partagé par ses éventuels
 *   deux triangles, un tracé à deux voies ayant deux triangles pour un
 *   seul code) : centre du texte dans le PDF, même transformation affine
 *   que les triangles.
 * - `type = "PE_label"` (37 : un par planche, `3000-126` en ayant deux
 *   comme dans le PDF) : texte de `sheet_ref` (voir Metro.shp/PE),
 *   position ET rotation (`angle`, degrés CSS) reprises telles quelles
 *   d'INFRAVIEW.pdf (même transformation affine que les triangles
 *   PE_info, angle du texte source converti du repère PDF au repère
 *   écran) — sauf si cette position brute tombe hors de l'emprise
 *   Metro.shp de sa planche (7 planches, là où ces emprises s'écartent le
 *   plus des contours du PDF — voir README 4bis "Emprises des
 *   planches") : dans ce cas seulement, recalée par interpolation vers le
 *   `representative_point` (shapely, pas le centroïde : certaines
 *   planches sont concaves) jusqu'à retomber dans l'emprise, rotation
 *   conservée telle quelle.
 * Les deux sont non interactifs : un clic doit atteindre la forme en
 * dessous (triangle pour PE_info, planche pour PE_label), pas s'arrêter
 * sur le texte.
 *
 * Les triangles PE_info (seuls encore en Polygon) combinent parfois
 * plusieurs formes par entité — non, en fait une seule (un triangle par
 * entité) : `_groupRingsIntoShapes()` reste néanmoins générique (utile si
 * un futur type Polygon multi-formes en a besoin), reconstruit les formes
 * à partir de la liste plate d'anneaux du Shapefile selon la convention
 * ESRI standard (anneau horaire = nouvelle forme, antihoraire = trou).
 *
 * Les planches (PE) sont de larges zones qui recouvrent des stations/
 * tunnels : voir app.js (ordre d'ajout des couches, PE en dessous) pour que
 * cliquer sur une station ouvre bien sa popup, pas celle de la planche
 * sous-jacente — les triangles PE_info, étant eux aussi rendus en
 * L.polygon (canvas) mais délibérément plaqués SUR un tunnel, suivent la
 * règle inverse (voir patrimoineLayer.js#registerExternalLayer,
 * bringToBack()/bringToFront()). Les textes (L.marker, markerPane) n'ont
 * pas ce problème : non interactifs, ils ne peuvent jamais intercepter de
 * clic quel que soit leur rang d'empilement.
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

/** kind (recherche) et libellé associés à chaque type de polygone. */
const AMGT4CEM_METRO_KIND_BY_TYPE = { MS: 'station', MT: 'tunnel', PE: 'planche' };

const AMGT4CEM_MetroLayer = {
  /**
   * @param {object} geojson - FeatureCollection Metro.json (non modifiée)
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
    // données, hérité de l'ancien data/patrimoine-plans-ensemble-500e.json)
    // : accumulée au fil de la boucle, complète au moment où un clic peut
    // réellement survenir (après le rendu initial), voir _sheetRefsAt.
    const peFeatures = [];

    for (const feature of geojson.features || []) {
      const props = feature.properties || {};
      const type = props.type;

      if (type === 'PE_info') {
        if (!feature.geometry) continue;
        if (feature.geometry.type === 'Polygon') {
          this._buildInfoShapes(feature, layersByType.PE_info, bounds); // triangle
        } else if (feature.geometry.type === 'Point') {
          this._buildScaledLabel(feature, layersByType.PE_info_text, bounds, AMGT4CEM_LABEL_STYLES.PE_info);
        }
        continue;
      }
      if (type === 'PE_label') {
        if (!feature.geometry || feature.geometry.type !== 'Point') continue;
        this._buildScaledLabel(feature, layersByType.PE_label, bounds, AMGT4CEM_LABEL_STYLES.PE_label);
        continue;
      }

      const style = AMGT4CEM_METRO_TYPES[type];
      if (!style || !feature.geometry || feature.geometry.type !== 'Polygon') continue;
      if (type === 'PE') peFeatures.push(feature);

      // Un seul anneau extérieur par polygone dans ce jeu de données.
      const ring = feature.geometry.coordinates[0];
      const latlngs = ring.map(AMGT4CEM_CRS.lambertToLatLng);

      const polygon = L.polygon(latlngs, {
        color: style.color,
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
        polygon.bindPopup(this._buildPopupHtml(props));
        polygon.on('click', (e) => {
          if (AMGT4CEM_AddPointTool.isActive()) {
            L.DomEvent.stopPropagation(e);
            AMGT4CEM_AddPointTool.handleMapClick(e);
          } else {
            polygon.openPopup(e.latlng);
          }
        });
      }
      polygon.addTo(layersByType[type]);
      bounds.extend(polygon.getBounds());

      // Une planche (PE) n'a pas de nom FR/NL, seulement sa référence
      // (sheet_ref) : c'est elle qui sert de libellé de recherche.
      const label = type === 'PE'
        ? (props.sheet_ref || '(sans référence)')
        : (props.name_fr || props.name_nl || '(sans nom)');
      searchIndex.push({
        kind: AMGT4CEM_METRO_KIND_BY_TYPE[type] || type,
        label,
        searchText: [props.name_fr, props.name_nl, props.sheet_ref].filter(Boolean).join(' '),
        bounds: polygon.getBounds(),
      });
    }

    return { layersByType, bounds, searchIndex };
  },

  _buildPopupHtml(props) {
    // Les planches (PE) n'ont pas de name_fr/name_nl/niveau (champs vides
    // pour elles, voir schéma ci-dessus) : on ne les affiche pas plutôt que
    // de montrer des cellules vides dans la popup.
    const rows = Object.entries(props)
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`)
      .join('');
    return `<div class="amgt-popup"><table>${rows}</table></div>`;
  },

  /**
   * Numéros de planche (sheet_ref) de toutes les planches (PE) dont
   * l'emprise contient ce point — normalement une seule, sauf dans les
   * zones où plusieurs planches se chevauchent (voir _pointInRing).
   * Repris tel quel de l'ancien src/patrimoineLayer.js (même jeu de
   * données, même besoin), avant la fusion des planches dans Metro.shp.
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
  _buildScaledLabel(feature, group, bounds, style) {
    const props = feature.properties || {};
    const latlng = AMGT4CEM_CRS.lambertToLatLng(feature.geometry.coordinates);
    const marker = AMGT4CEM_ScaledText.createMarker(latlng, props.code || '', {
      color: style.color,
      heightMeters: style.heightMeters,
      rotationDeg: props.angle || 0,
    });
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
