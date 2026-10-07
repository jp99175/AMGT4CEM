/**
 * Affichage carte des couches "Plans patrimoine" choisies par l'utilisateur
 * (voir patrimoineSelectionStore.js / patrimoinePicker.js). Contrairement à
 * UrbIS Topo, ce sont des fichiers LOCAUX (data/plans-patrimoine/catalogue.js) —
 * chacun est chargé une seule fois (mis en cache), sans filtre d'emprise ni
 * de zoom (volumes très modestes : quelques centaines d'entités au plus).
 *
 * Géométrie rencontrée dans ces fichiers : uniquement des Point avec un
 * attribut "text" ou "numero" — une étiquette de texte (nom de station,
 * numéro d'interstation...) affichée comme telle, pas comme un simple
 * point coloré, pour rester lisible.
 *
 * Les planches (plans d'ensemble au 1/500e) ne passent plus par un fichier propre : ce sont des
 * polygones de genre « planche » de polygones.shp, construits par metroLayer.js (étiquette =
 * `sheet_ref` du référentiel, clic en zone de recouvrement : toutes les planches listées).
 * Leur entrée du catalogue (`external: true`) ne fait qu'afficher/masquer cette couche,
 * voir registerExternalLayer() ci-dessous.
 */
const AMGT4CEM_PatrimoineLayer = {
  _map: null,
  _group: null,
  _enabled: true,
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
   * Enregistre une couche Leaflet déjà construite ailleurs (ex : les
   * planches "PE" de metroLayer.js, voir app.js) pour un id du catalogue
   * marqué `external: true`. Peut être appelé avant ou après que
   * l'utilisateur ait sélectionné cet id (le chargement du réseau Métro est
   * asynchrone) : si déjà sélectionné, la couche est affichée immédiatement.
   */
  registerExternalLayer(id, layerGroup) {
    this._externalLayers[id] = layerGroup;
    this.refresh();
  },

  /**
   * Réglage d'opacité (icône curseurs du menu ☰ Carte), 0 à 1. Les couches
   * externes (ex : planches PE) n'y sont pas soumises : leur opacité reste
   * gérée par leur propre module (curseur "Métro" pour PE) pour éviter que
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
    if (!this._enabled) {
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
        // z-order opposés (voir metroLayer.js) : les planches PE doivent
        // rester SOUS les stations/tunnels (pour qu'un clic sur une station
        // ouvre bien sa popup, pas celle de la planche sous-jacente), alors
        // que les repères PE_info doivent au contraire rester AU-DESSUS —
        // ils sont délibérément plaqués SUR un tunnel (MT), un simple
        // bringToBack() les rendrait donc totalement inaccessibles au clic.
        // Marqués via `_amgtBringToFront` posé par metroLayer.js. Deux
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
          subGroup = this._buildSubGroup(features, selection[id]);
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
    const response = await fetch(entry.file);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();
    this._cache[entry.id] = geojson.features || [];
    return this._cache[entry.id];
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
