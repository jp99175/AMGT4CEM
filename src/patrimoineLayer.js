/**
 * Affichage carte des couches "Plans patrimoine" choisies par l'utilisateur
 * (voir patrimoineSelectionStore.js / patrimoinePicker.js). Contrairement à
 * UrbIS Topo, ce sont des fichiers LOCAUX (data/patrimoineCatalog.js) —
 * chacun est chargé une seule fois (mis en cache), sans filtre d'emprise ni
 * de zoom (volumes très modestes : quelques centaines d'entités au plus).
 *
 * Deux types de géométrie rencontrés dans ces fichiers :
 * - Polygon : emprise d'une planche de plan — tracée avec sa propre couleur
 *   de trait quand le fichier la fournit (stroke_color_rgb), sinon la
 *   couleur attribuée à la sélection.
 * - Point avec un attribut "text" ou "numero" : une étiquette de texte
 *   (nom de station, numéro de planche/interstation...) — affichée comme
 *   telle, pas comme un simple point coloré, pour rester lisible.
 */
const AMGT4CEM_PatrimoineLayer = {
  _map: null,
  _group: null,
  _enabled: true,
  _opacityFactor: 1,
  _cache: {}, // id -> features[]
  _subGroups: {}, // id -> L.LayerGroup

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

  /** Réglage d'opacité (icône curseurs du menu ☰ Carte), 0 à 1. */
  setOpacity(factor) {
    this._opacityFactor = factor;
    for (const group of Object.values(this._subGroups)) {
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
      try {
        const features = await this._loadFeatures(entry);
        const subGroup = this._buildSubGroup(features, selection[id]);
        this._subGroups[id] = subGroup;
        subGroup.addTo(this._group);
      } catch (err) {
        console.error(`[AMGT4CEM] Chargement de la couche "${entry.label}" impossible :`, err);
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
    if (!geom) return null;
    const props = feature.properties || {};

    if (geom.type === 'Polygon') {
      const latlngs = geom.coordinates[0].map(AMGT4CEM_CRS.lambertToLatLng);
      // La couleur de trait fournie par le fichier (quand présente) est
      // prioritaire sur la couleur de sélection — c'est une donnée réelle,
      // pas une supposition. "width" (en unités réelles, pas des pixels)
      // n'est volontairement pas utilisé comme épaisseur de trait Leaflet :
      // une épaisseur fixe et lisible est utilisée à la place.
      const strokeColor = props.stroke_color_rgb ? this._rgbFloatToHex(props.stroke_color_rgb) : color;
      const polygon = L.polygon(latlngs, {
        color: strokeColor,
        weight: 2,
        fillOpacity: 0,
        opacity: this._opacityFactor,
      });
      polygon.bindPopup(this._buildPolygonPopup());
      return polygon;
    }

    if (geom.type === 'Point') {
      const text = props.text || props.numero;
      if (!text) return null;
      const latlng = AMGT4CEM_CRS.lambertToLatLng(geom.coordinates);

      const label = document.createElement('span');
      label.className = 'amgt-patrimoine-label__text';
      label.style.color = color;
      label.textContent = text;

      const marker = L.marker(latlng, {
        opacity: this._opacityFactor,
        icon: L.divIcon({ className: 'amgt-patrimoine-label', html: label }),
      });
      marker.bindPopup(this._buildLabelPopup(text, geom.coordinates));
      return marker;
    }

    return null;
  },

  _rgbFloatToHex([r, g, b]) {
    const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  },

  _buildPolygonPopup() {
    const container = document.createElement('div');
    container.className = 'amgt-popup';
    const title = document.createElement('strong');
    title.textContent = "Plan d'ensemble 1/500e";
    container.appendChild(title);
    return container;
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
