/**
 * Affichage carte des couches "Plans patrimoine" choisies par l'utilisateur
 * (voir patrimoineSelectionStore.js / patrimoinePicker.js). Contrairement à
 * UrbIS Topo, ce sont des fichiers LOCAUX (data/patrimoineCatalog.js) —
 * chacun est chargé une seule fois (mis en cache), sans filtre d'emprise ni
 * de zoom (volumes très modestes : quelques centaines d'entités au plus).
 *
 * Géométries rencontrées dans ces fichiers :
 * - Polygon : emprise d'une planche de plan — tracée avec sa propre couleur
 *   de trait quand le fichier la fournit (stroke_color_rgb), sinon la
 *   couleur attribuée à la sélection. Si la planche porte un numéro de
 *   référence (propriété "sheet_ref", absente ou null pour certaines
 *   planches du jeu de données), ce numéro est aussi affiché comme
 *   étiquette de texte au centre de la planche. Certaines emprises se
 *   chevauchent (constaté sur ce jeu de données) : l'infobulle au clic
 *   liste alors toutes les planches dont l'emprise contient le point
 *   cliqué, pas seulement celle au-dessus visuellement (voir
 *   _sheetRefsAt/_pointInRing).
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
      const layer = this._buildLeafletLayer(feature, color, features);
      if (layer) group.addLayer(layer);

      // Emprise de planche avec un numéro de référence (sheet_ref) : affiche
      // ce numéro comme étiquette de texte au centre de la planche, en plus
      // de son contour — sinon le numéro ne serait visible que dans la
      // popup, alors que c'est l'information la plus utile de cette couche.
      const props = feature.properties || {};
      if (feature.geometry && feature.geometry.type === 'Polygon' && props.sheet_ref) {
        const refLabel = this._buildPolygonRefLabel(feature, color);
        if (refLabel) group.addLayer(refLabel);
      }
    }
    return group;
  },

  _buildLeafletLayer(feature, color, siblingFeatures) {
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
      // Certaines planches se chevauchent (constaté sur le jeu de données
      // fourni) : un clic dans une zone de recouvrement ne devrait, avec un
      // simple bindPopup, révéler que la planche au-dessus dans l'ordre
      // d'affichage. On recalcule donc à chaque clic, sur le point réel
      // cliqué, la liste de toutes les planches dont l'emprise le contient.
      polygon.on('click', (e) => {
        const refs = this._sheetRefsAt(e.latlng, siblingFeatures || [feature]);
        L.popup()
          .setLatLng(e.latlng)
          .setContent(this._buildPolygonPopup(props, refs))
          .openOn(this._map);
      });
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

  /** Centroïde simple (moyenne des sommets) : suffisant pour placer une
   * étiquette à l'intérieur d'une planche, pas besoin du centroïde d'aire
   * exact pour ce seul usage d'affichage. */
  _polygonCentroid(ring) {
    const xs = ring.map((c) => c[0]);
    const ys = ring.map((c) => c[1]);
    return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
  },

  _buildPolygonRefLabel(feature, color) {
    const centroid = this._polygonCentroid(feature.geometry.coordinates[0]);
    const latlng = AMGT4CEM_CRS.lambertToLatLng(centroid);
    const ref = feature.properties.sheet_ref;

    const label = document.createElement('span');
    label.className = 'amgt-patrimoine-label__text';
    label.style.color = color;
    label.textContent = ref;

    const marker = L.marker(latlng, {
      opacity: this._opacityFactor,
      icon: L.divIcon({ className: 'amgt-patrimoine-label', html: label }),
    });
    marker.bindPopup(this._buildLabelPopup(ref, centroid));
    return marker;
  },

  /**
   * Numéros de planche (sheet_ref) de toutes les planches dont l'emprise
   * contient ce point (converti en Lambert) — normalement une seule, sauf
   * dans les zones où plusieurs planches se chevauchent.
   */
  _sheetRefsAt(latlng, features) {
    const { x, y } = AMGT4CEM_CRS.latLngToLambert(latlng);
    const refs = [];
    for (const f of features) {
      if (!f.geometry || f.geometry.type !== 'Polygon') continue;
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

  _buildPolygonPopup(props, overlappingRefs) {
    const container = document.createElement('div');
    container.className = 'amgt-popup';

    const refs = overlappingRefs && overlappingRefs.length > 0
      ? overlappingRefs
      : (props && props.sheet_ref ? [props.sheet_ref] : []);

    const title = document.createElement('strong');
    if (refs.length > 1) {
      title.textContent = 'Planches superposées à cet endroit :';
      container.appendChild(title);
      const list = document.createElement('ul');
      list.className = 'amgt-popup-list';
      for (const ref of refs) {
        const li = document.createElement('li');
        li.textContent = ref;
        list.appendChild(li);
      }
      container.appendChild(list);
    } else {
      title.textContent = refs[0] ? `Planche ${refs[0]}` : "Plan d'ensemble 1/500e";
      container.appendChild(title);
    }
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
