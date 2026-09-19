/**
 * Couches UrbIS Topo optionnelles (grilles de ventilation, chambres/taques
 * d'égout, avaloirs... voir AMGT4CEM_CONFIG.urbisTopo), chargées strictement
 * à la demande : rien n'est requêté tant qu'une couche n'est pas cochée dans
 * le menu ☰ Carte, et seuls les objets de l'emprise visible sont demandés au
 * service (le WFS ne groupe le catalogue que par géométrie — une seule de
 * ces 3 couches globales dépasse 450 000 objets, tous types confondus).
 *
 * En dessous du niveau de zoom minimal (config.js), rien n'est affiché ni
 * requêté plutôt que de risquer une réponse énorme ou lente — comme pour les
 * autres fonds de cette application, aucun état cassé n'est jamais montré.
 */
const AMGT4CEM_UrbisTopoLayer = {
  _map: null,
  _groups: {},
  _enabled: {},
  _fetchToken: {},
  _moveTimer: null,

  init(map) {
    this._map = map;
    for (const layer of AMGT4CEM_CONFIG.urbisTopo.layers) {
      this._groups[layer.id] = L.layerGroup();
      this._enabled[layer.id] = false;
      this._fetchToken[layer.id] = 0;
    }

    map.on('moveend', () => {
      clearTimeout(this._moveTimer);
      this._moveTimer = setTimeout(() => this._refreshAllEnabled(), 400);
    });
  },

  /**
   * @returns {{id: string, label: string, color: string}[]} pour construire
   * les cases à cocher du menu ☰ Carte (voir mapMenu.js).
   */
  getLayerDefinitions() {
    return AMGT4CEM_CONFIG.urbisTopo.layers.map(({ id, label, color }) => ({ id, label, color }));
  },

  setEnabled(layerId, enabled) {
    this._enabled[layerId] = enabled;
    const group = this._groups[layerId];
    if (!group) return;

    if (enabled) {
      group.addTo(this._map);
      this._refresh(layerId);
    } else {
      this._map.removeLayer(group);
      group.clearLayers();
    }
  },

  _refreshAllEnabled() {
    for (const [id, enabled] of Object.entries(this._enabled)) {
      if (enabled) this._refresh(id);
    }
  },

  async _refresh(layerId) {
    const group = this._groups[layerId];
    const layerDef = AMGT4CEM_CONFIG.urbisTopo.layers.find((l) => l.id === layerId);
    if (!group || !layerDef) return;

    const token = ++this._fetchToken[layerId];
    group.clearLayers();

    if (this._map.getZoom() < AMGT4CEM_CONFIG.urbisTopo.minZoom) return;

    const bbox = AMGT4CEM_CRS.boundsToLambertBbox(this._map.getBounds());

    for (const query of layerDef.queries) {
      let features;
      try {
        features = await this._fetchFeatures(query, bbox);
      } catch (err) {
        console.warn(`[AMGT4CEM] Couche UrbIS Topo "${layerDef.label}" indisponible :`, err);
        continue;
      }
      if (token !== this._fetchToken[layerId]) return; // la vue a changé entre-temps
      this._renderFeatures(group, features, layerDef);
    }
  },

  async _fetchFeatures(query, [minX, minY, maxX, maxY]) {
    const { wfsUrl, version, typeAttribute, maxFeaturesPerQuery } = AMGT4CEM_CONFIG.urbisTopo;
    const codesList = query.codes.map((c) => `'${c}'`).join(',');
    const cql = `${typeAttribute} IN (${codesList}) AND BBOX(geom,${minX},${minY},${maxX},${maxY})`;

    const params = new URLSearchParams({
      service: 'WFS',
      version,
      request: 'GetFeature',
      typeNames: query.featureType,
      outputFormat: 'application/json',
      count: String(maxFeaturesPerQuery),
      CQL_FILTER: cql,
    });

    const response = await fetch(`${wfsUrl}?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();
    return geojson.features || [];
  },

  _renderFeatures(group, features, layerDef) {
    for (const feature of features) {
      const leafletLayer = this._buildLeafletLayer(feature.geometry, layerDef);
      if (!leafletLayer) continue;
      leafletLayer.bindPopup(this._buildPopup(feature.properties || {}, layerDef));
      group.addLayer(leafletLayer);
    }
  },

  _buildLeafletLayer(geom, layerDef) {
    if (!geom) return null;
    const toLatLng = (pair) => AMGT4CEM_CRS.lambertToLatLng(pair);

    switch (geom.type) {
      case 'Point':
        return L.circleMarker(toLatLng(geom.coordinates), this._pointStyle(layerDef));
      case 'MultiPoint':
        return L.circleMarker(toLatLng(geom.coordinates[0]), this._pointStyle(layerDef));
      case 'LineString':
        return L.polyline(geom.coordinates.map(toLatLng), this._lineStyle(layerDef));
      case 'MultiLineString':
        return L.polyline(geom.coordinates.map((line) => line.map(toLatLng)), this._lineStyle(layerDef));
      default:
        return null;
    }
  },

  _pointStyle(layerDef) {
    return { radius: 5, color: '#fff', weight: 1, fillColor: layerDef.color, fillOpacity: 0.9 };
  },

  _lineStyle(layerDef) {
    return { color: layerDef.color, weight: 3 };
  },

  /** Construction DOM sûre (pas d'innerHTML) : les valeurs viennent d'un service externe. */
  _buildPopup(props, layerDef) {
    const container = document.createElement('div');
    container.className = 'amgt-popup';

    const title = document.createElement('strong');
    title.textContent = props.DESCRFRE || layerDef.label;
    container.appendChild(title);

    const table = document.createElement('table');
    const addRow = (label, value) => {
      if (value === undefined || value === null || value === '') return;
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = label;
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(th, td);
      table.appendChild(tr);
    };
    addRow('Code', props[AMGT4CEM_CONFIG.urbisTopo.typeAttribute]);
    addRow('Identifiant', props.ID);
    container.appendChild(table);

    return container;
  },
};
