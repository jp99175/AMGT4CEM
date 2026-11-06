/**
 * Affichage carte des couches "Plans patrimoine" choisies par l'utilisateur
 * (voir patrimoineSelectionStore.js / patrimoinePicker.js). Contrairement à
 * UrbIS Topo, ce sont des fichiers LOCAUX (config/plans-patrimoine/catalogue.js) —
 * chacun est chargé une seule fois (mis en cache), sans filtre d'emprise ni
 * de zoom (volumes très modestes : quelques centaines d'entités au plus).
 *
 * Géométrie rencontrée dans ces fichiers : des Point avec un
 * attribut "text" ou "numero" — une étiquette de texte (nom de station,
 * numéro d'interstation...) affichée comme telle, pas comme un simple
 * point coloré, pour rester lisible.
 *
 * Les planches (plans d'ensemble au 1/500e) ne passent plus par un fichier propre : ce sont des
 * polygones de genre « planche » de polygones.shp, construits par ditpDiovLayer.js (étiquette =
 * `sheet_ref` du référentiel, clic en zone de recouvrement : toutes les planches listées).
 * Leur entrée du catalogue (`external: true`) ne fait qu'afficher/masquer cette couche,
 * voir registerExternalLayer() ci-dessous.
 */
const AMGT4CEM_PatrimoineLayer = {
  _map: null,
  _group: null,
  _enabled: true,
  _allowed: true, // accès à la couche (carte AMGT4CEM : réservée aux comptes connectés, voir setAccess)
  _opacityFactor: 1,
  _cache: {}, // id -> features[]
  _subGroups: {}, // id -> L.LayerGroup
  _externalLayers: {}, // id -> L.LayerGroup déjà construit ailleurs (voir registerExternalLayer)
  _building: {}, // id -> true pendant la construction asynchrone d'une couche (évite un double ajout si refresh() est rappelé entre-temps)

  init(map) {
    this._map = map;
    this._group = L.layerGroup();
    AMGT4CEM_PatrimoineSelectionStore.onChange(() => this.refresh());
    this.refresh();
  },

  setEnabled(enabled) {
    this._enabled = enabled;
    this.refresh();
  },

  /**
   * Accès à la couche « Plans patrimoine » : sans accès (personne n'est connecté), rien n'est affiché ni lu,
   * quelle que soit la case à cocher ni la sélection mémorisée. Vrai par défaut (carte de choix du point de SIG4CEM).
   */
  setAccess(allowed) {
    if (this._allowed === !!allowed) return;
    this._allowed = !!allowed;
    this.refresh();
  },

  /**
   * Enregistre une couche Leaflet déjà construite ailleurs (ex : les
   * planches "PE" de ditpDiovLayer.js, voir app.js) pour un id du catalogue
   * marqué `external: true`. Peut être appelé avant ou après que
   * l'utilisateur ait sélectionné cet id (le chargement du réseau DITP-DIOV est
   * asynchrone) : si déjà sélectionné, la couche est affichée immédiatement.
   */
  registerExternalLayer(id, layerGroup) {
    this._externalLayers[id] = layerGroup;
    this.refresh();
  },

  /**
   * Retire une couche externe enregistrée par registerExternalLayer (ex : planches PE quand plus aucun compte n'est
   * connecté) : elle disparaît de la carte et son entrée du catalogue n'affiche plus rien jusqu'à un nouvel enregistrement.
   */
  unregisterExternalLayer(id) {
    const layer = this._externalLayers[id];
    delete this._externalLayers[id];
    if (layer && this._subGroups[id] === layer) {
      if (this._group) this._group.removeLayer(layer);
      delete this._subGroups[id];
    }
  },

  /**
   * Réglage d'opacité (icône curseurs du menu ☰ Carte), 0 à 1. Les couches
   * externes (ex : planches PE) n'y sont pas soumises : leur opacité reste
   * gérée par leur propre module (curseur "DITP-DIOV" pour PE) pour éviter que
   * deux curseurs n'agissent sur la même couche.
   */
  setOpacity(factor) {
    this._opacityFactor = factor;
    for (const [id, group] of Object.entries(this._subGroups)) {
      if (this._externalLayers[id] === group) continue;
      group.eachLayer((layer) => {
        if (layer instanceof L.Marker) layer.setOpacity(factor);
        else if (layer.setStyle) layer.setStyle({ opacity: factor });
      });
    }
  },

  async refresh() {
    if (!this._enabled || !this._allowed) {
      this._map.removeLayer(this._group);
      return;
    }

    const selection = AMGT4CEM_PatrimoineSelectionStore.getSelection();
    const selectedIds = Object.keys(selection);

    if (selectedIds.length === 0) {
      this._map.removeLayer(this._group);
      return;
    }
    this._group.addTo(this._map);

    // Retire les couches désélectionnées entre-temps.
    for (const id of Object.keys(this._subGroups)) {
      if (!selection[id]) {
        this._group.removeLayer(this._subGroups[id]);
        delete this._subGroups[id];
      }
    }

    // Ajoute les couches nouvellement sélectionnées (déjà affichées : ignorées).
    for (const id of selectedIds) {
      if (this._subGroups[id]) continue;
      const entry = AMGT4CEM_PATRIMOINE_CATALOG.find((e) => e.id === id);
      if (!entry) continue;

      if (entry.external) {
        const layer = this._externalLayers[id];
        if (!layer) continue; // pas encore construite (polygones.shp en cours de chargement) : registerExternalLayer() rappellera refresh()
        this._subGroups[id] = layer;
        layer.addTo(this._group);
        // Cette couche externe peut combiner des enfants aux besoins de
        // z-order opposés (voir ditpDiovLayer.js) : les planches PE doivent
        // rester SOUS les stations/tunnels (pour qu'un clic sur une station
        // ouvre bien sa popup, pas celle de la planche sous-jacente), alors
        // que les repères PE_info doivent au contraire rester AU-DESSUS —
        // ils sont délibérément plaqués SUR un tunnel (MT), un simple
        // bringToBack() les rendrait donc totalement inaccessibles au clic.
        // Marqués via `_amgtBringToFront` posé par ditpDiovLayer.js. Deux
        // passes séparées (pas une seule boucle) : bringToFront doit
        // s'appliquer APRÈS tous les bringToBack pour finir au-dessus de
        // tout, y compris MS/MT déjà présents sur la carte. À l'affichage
        // initial l'ordre d'ajout (PE avant MS/MT, voir app.js) suffirait
        // seul, mais cette couche peut aussi être (dés)activée bien plus
        // tard via cette case à cocher, une fois MS/MT déjà sur la carte.
        layer.eachLayer((l) => {
          if (!l._amgtBringToFront && typeof l.bringToBack === 'function') l.bringToBack();
        });
        layer.eachLayer((l) => {
          if (l._amgtBringToFront && typeof l.bringToFront === 'function') l.bringToFront();
        });
        continue;
      }

      if (this._building[id]) continue;
      this._building[id] = true;
      try {
        let subGroup;
        if (entry.interstation) {
          // Étiquette + ligne de repère jusqu'au centre du tronçon (src/interstation.js) : attend les tronçons de polygones.shp.
          await AMGT4CEM_Interstation.whenReady();
          if (!AMGT4CEM_PatrimoineSelectionStore.getSelection()[id]) continue; // désélectionnée pendant l'attente
          subGroup = AMGT4CEM_Interstation.buildSubGroup(selection[id], this._opacityFactor);
        } else {
          const features = await this._loadFeatures(entry);
          subGroup = this._buildSubGroup(entry.lieuxFile ? features.filter((f) => !this.lieuMasque(f.properties && f.properties.slug)) : features, selection[id]);
        }
        this._subGroups[id] = subGroup;
        subGroup.addTo(this._group);
      } catch (err) {
        console.error(`[AMGT4CEM] Chargement de la couche "${entry.label}" impossible :`, err);
      } finally {
        delete this._building[id];
      }
    }
  },

  async _loadFeatures(entry) {
    if (this._cache[entry.id]) return this._cache[entry.id];
    if (entry.shapefile) {
      // Couche lue dans un shapefile (champ `id` seul) + petit référentiel JSON (nom) : voir src/shpLoader.js.
      const fc = await AMGT4CEM_ShpLoader.load(entry.shapefile);
      let entites = {};
      if (entry.referentiel) {
        try { entites = (await (await fetch(`${entry.referentiel}?t=${Date.now()}`)).json()).entites || {}; } catch (err) { /* sans nom : l'id sert d'étiquette */ }
      }
      this._cache[entry.id] = fc.features.map((f) => ({
        ...f,
        properties: { ...f.properties, genre: 'shapefile', name_fr: ((entites[f.properties.id] || {}).nom || f.properties.id) + ` (${f.properties.id})` },
      }));
      return this._cache[entry.id];
    }
    const response = await fetch(entry.file);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();
    const features = geojson.features || [];
    if (entry.lieuxFile) {
      // Lieux constitués avec l'outil d'administration (src/lieuxTool.js) : géométrie enregistrée, aucun appel à UrbIS.
      const lieux = await this._loadLieux(entry.lieuxFile);
      features.push(...lieux);
      // Tant qu'aucun lieu n'est enregistré : objets provisoires lus au vol dans UrbIS.
      if (!lieux.length && entry.urbisObjets) features.push(...await this._loadUrbisObjets(entry.urbisObjets));
    } else if (entry.urbisObjets) features.push(...await this._loadUrbisObjets(entry.urbisObjets));
    this._cache[entry.id] = features;
    return this._cache[entry.id];
  },

  /**
   * Objets UrbIS Topo lus par identifiant (TopoLines puis TopoShapes) ; une erreur n'empêche pas le reste
   * de la couche. Sans console sur mobile, le résultat (trouvés / erreurs) est affiché dans un bandeau.
   */
  async _loadUrbisObjets(objets) {
    const { wfsUrl, version } = AMGT4CEM_CONFIG.urbisTopo;
    const out = [];
    const notes = [];
    for (const o of objets) {
      let trouve = null;
      const essais = [];
      // Une requête par objet, plusieurs formulations du filtre : le service accepte l'une ou l'autre selon le type du champ.
      for (const featureType of ['urbistopo:TopoLines', 'urbistopo:TopoShapes']) {
        for (const filtre of [`ID='${o.id}'`, `ID=${o.id}`]) {
          if (trouve) break;
          try {
            const params = new URLSearchParams({ service: 'WFS', version, request: 'GetFeature', typeNames: featureType, outputFormat: 'application/json', CQL_FILTER: filtre });
            const response = await fetch(`${wfsUrl}?${params.toString()}`);
            if (!response.ok) { essais.push(`${featureType.split(':')[1]} ${filtre} HTTP ${response.status}`); continue; }
            const geojson = await response.json();
            const f = (geojson.features || [])[0];
            if (f) trouve = { f, featureType };
            else essais.push(`${featureType.split(':')[1]} ${filtre} 0`);
          } catch (err) {
            essais.push(`${featureType.split(':')[1]} ${filtre} ${err && err.message ? err.message : err}`);
          }
        }
      }
      if (trouve) {
        const props = trouve.f.properties || {};
        out.push({ type: 'Feature', geometry: trouve.f.geometry, properties: { genre: 'urbis', name_fr: o.lieu, urbis_id: props.ID, urbis_code: o.code } });
        notes.push(`${o.id} OK (${trouve.featureType.split(':')[1]}, ${props.TYPE || '?'}, ${trouve.f.geometry ? trouve.f.geometry.type : 'sans géométrie'})`);
      } else {
        notes.push(`${o.id} introuvable [${essais.join(' | ')}]`);
      }
    }
    this._bandeau(`Objets UrbIS : ${out.length}/${objets.length}. ${notes.join(' ; ')}`);
    return out;
  },

  // Lieux masqués par l'œil de l'outil « Dessiner une zone » : réglage local (cet appareil), par identifiant de lieu.
  CLE_LIEUX_MASQUES: 'amgt4cem.lieux.masques.v1',
  _lieuxMasques() {
    try { const a = JSON.parse(localStorage.getItem(this.CLE_LIEUX_MASQUES) || '[]'); return Array.isArray(a) ? a : []; } catch (err) { return []; }
  },
  lieuMasque(slug) { return !!slug && this._lieuxMasques().includes(slug); },
  /** Masque (true) ou ré-affiche (false) un lieu dans la couche des lieux, aussitôt (les données restent en cache). */
  masquerLieu(slug, masque) {
    const l = this._lieuxMasques().filter((x) => x !== slug);
    if (masque) l.push(slug);
    try { localStorage.setItem(this.CLE_LIEUX_MASQUES, JSON.stringify(l)); } catch (err) { /* valable pour la session seulement */ }
    for (const e of AMGT4CEM_PATRIMOINE_CATALOG) {
      if (!e.lieuxFile || !this._subGroups[e.id]) continue;
      this._group.removeLayer(this._subGroups[e.id]);
      delete this._subGroups[e.id];
    }
    return this.refresh();
  },

  /**
   * Recharge les lieux constitués (couches du catalogue qui ont `lieuxFile`) après un enregistrement de l'outil
   * « Dessiner une zone » : sans cela, un lieu supprimé ou renommé resterait affiché jusqu'au rechargement de la page.
   */
  reloadLieux() {
    for (const e of AMGT4CEM_PATRIMOINE_CATALOG) {
      if (!e.lieuxFile) continue;
      delete this._cache[e.id];
      if (this._subGroups[e.id]) {
        this._group.removeLayer(this._subGroups[e.id]);
        delete this._subGroups[e.id];
      }
    }
    return this.refresh();
  },

  /**
   * Dernier état envoyé par l'outil (sessionStorage) : prioritaire sur le fichier du site pendant 10 minutes, car
   * celui-ci ne change qu'après le déploiement (voir lieuxTool.js, _recents).
   */
  _lieuxRecents(lus) {
    try {
      const e = JSON.parse(sessionStorage.getItem('amgt4cem.lieux.envoye') || 'null');
      if (!e || Date.now() - e.at > 10 * 60 * 1000) return lus;
      if (JSON.stringify(e.lieux) === JSON.stringify(lus)) return lus;
      return e.lieux;
    } catch (err) { return lus; }
  },

  async _loadLieux(file) {
    try {
      const r = await fetch(`${file}?t=${Date.now()}`); // jamais depuis le cache du navigateur
      const lieux = this._lieuxRecents(r.ok ? ((await r.json()).lieux || {}) : {});
      return Object.entries(lieux).flatMap(([slug, l]) => (l.contour && l.contour.length
        // Contour enregistré (surfaces moins vides) : un seul polygone dont les anneaux sont remplis en pair-impair (les trous restent vides).
        ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: l.contour }, properties: { genre: 'lieu', name_fr: l.nom, slug } }]
        : l.objets.map((o) => ({
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: o.lignes },
        properties: { genre: 'urbis', name_fr: l.nom, slug, urbis_id: o.id, urbis_code: o.code },
      }))));
    } catch (err) {
      return [];
    }
  },

  /**
   * Géométries (Lambert 72) des couches affichées, pour l'outil « Dessiner une zone » : [{ id, nom, polygones: [[ext, trous…]], lignes }].
   * Les lieux constitués (genre « lieu » / « urbis ») en sont exclus (l'outil les lit directement) ; les planches 1/500e,
   * construites par ditpDiovLayer.js, n'y figurent pas.
   */
  geometriesAffichees() {
    const out = [];
    if (!this._group || !this._map || !this._map.hasLayer(this._group)) return out;
    for (const id of Object.keys(this._subGroups || {})) {
      (this._cache[id] || []).forEach((f, i) => {
        const g = f.geometry;
        const p = f.properties || {};
        if (!g || p.genre === 'lieu' || p.genre === 'urbis') return;
        const nom = p.name_fr || p.genre || id;
        const r = (l) => l.map((q) => [q[0], q[1]]);
        if (g.type === 'Polygon') out.push({ id: `${id}-${i}`, nom, polygones: [g.coordinates.map(r)], lignes: g.coordinates.map(r) });
        else if (g.type === 'MultiPolygon') out.push({ id: `${id}-${i}`, nom, polygones: g.coordinates.map((pg) => pg.map(r)), lignes: g.coordinates.flat().map(r) });
        else if (g.type === 'LineString') out.push({ id: `${id}-${i}`, nom, polygones: [], lignes: [r(g.coordinates)] });
        else if (g.type === 'MultiLineString') out.push({ id: `${id}-${i}`, nom, polygones: [], lignes: g.coordinates.map(r) });
      });
    }
    return out;
  },

  _bandeau(texte) {
    const el = document.createElement('div');
    el.textContent = texte;
    el.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:99999;background:#fff3cd;color:#333;border:1px solid #c9a227;border-radius:8px;padding:8px 10px;font:13px sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.3)';
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60000);
  },

  _buildSubGroup(features, color) {
    const group = L.layerGroup();
    for (const feature of features) {
      const layer = this._buildLeafletLayer(feature, color);
      if (layer) group.addLayer(layer);
    }
    return group;
  },

  _buildLeafletLayer(feature, color) {
    const geom = feature.geometry;
    if (geom && geom.type === 'Polygon') return this._buildPolygonLayer(feature, color);
    if (geom && (geom.type === 'LineString' || geom.type === 'MultiLineString')) return this._buildUrbisLineLayer(feature, color);
    if (!geom || geom.type !== 'Point') return null;
    const props = feature.properties || {};

    const text = props.text || props.numero;
    if (!text) return null;
    const latlng = AMGT4CEM_CRS.lambertToLatLng(geom.coordinates);

    const label = document.createElement('span');
    label.className = 'amgt-patrimoine-label__text';
    label.style.color = color;
    label.textContent = text;

    const marker = L.marker(latlng, {
      opacity: this._opacityFactor,
      // iconSize [0, 0] : point d'ancrage = coin du conteneur (sinon le
      // divIcon par défaut, 12×12, décale le texte de 6 px) ; le texte est
      // ensuite centré sur ce point par la CSS. Les points de ces couches
      // (noms de station, numéros d'interstation, planches) sont les
      // CENTRES des textes du plan INFRAVIEW.pdf.
      icon: L.divIcon({ className: 'amgt-patrimoine-label', html: label, iconSize: [0, 0] }),
    });
    marker.bindPopup(this._buildLabelPopup(text, geom.coordinates));
    return marker;
  },

  /** Polygone (coordonnées Lambert 72) : seule la couche temporaire temp_DELTA_mod en contient pour l'instant. */
  _buildPolygonLayer(feature, color) {
    const props = feature.properties || {};
    const rings = feature.geometry.coordinates.map((ring) => ring.map((pt) => AMGT4CEM_CRS.lambertToLatLng(pt)));
    const layer = L.polygon(rings, {
      color,
      weight: 2,
      opacity: this._opacityFactor,
      fillColor: color,
      fillOpacity: 0.25,
    });
    const text = props.name_fr || props.genre || 'Polygone';
    layer.bindPopup(this._buildLabelPopup(text + (props.copie_de ? ` (copie de ${props.copie_de})` : ''), this._lambertCenter(feature)));
    return layer;
  },

  /** Ligne UrbIS : polygone rempli si elle est fermée, trait épais sinon. */
  _buildUrbisLineLayer(feature, color) {
    const props = feature.properties || {};
    const g = feature.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    const group = L.featureGroup();
    for (const line of lines) {
      const pts = line.map((pt) => AMGT4CEM_CRS.lambertToLatLng(pt));
      const closed = line.length > 3 && same(line[0], line[line.length - 1]);
      group.addLayer(closed
        ? L.polygon(pts, { color, weight: 2, opacity: this._opacityFactor, fillColor: color, fillOpacity: 0.25 })
        : L.polyline(pts, { color, weight: 5, opacity: this._opacityFactor }));
    }
    const first = lines[0][0];
    group.bindPopup(this._buildLabelPopup(`${props.name_fr} — ${props.urbis_code} ${props.urbis_id}`, first));
    return group;
  },

  /** Centre de l'emprise englobante du premier anneau, en Lambert 72 (pour la fenêtre d'information). */
  _lambertCenter(feature) {
    const ring = feature.geometry.coordinates[0];
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  },

  _buildLabelPopup(text, [x, y]) {
    const container = document.createElement('div');
    container.className = 'amgt-popup';

    const table = document.createElement('table');
    const addRow = (label, value) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = label;
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(th, td);
      table.appendChild(tr);
    };
    addRow('Texte', text);
    addRow('X Lambert', AMGT4CEM_CRS.formatCoord(x));
    addRow('Y Lambert', AMGT4CEM_CRS.formatCoord(y));
    container.appendChild(table);

    return container;
  },
};
