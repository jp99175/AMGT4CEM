/**
 * Affichage carte des types d'objets UrbIS Topo choisis par l'utilisateur
 * (voir urbisTopoSelectionStore.js / urbisTopoPicker.js). Traitée comme les
 * autres couches du menu ☰ Carte (Stations, Tunnels, Points métier) : une
 * case active/désactive l'affichage (voir mapMenu.js) — le choix des types à
 * afficher se fait à part, via le sélecteur plein écran.
 *
 * Chargement strictement à la demande : rien n'est requêté tant que la case
 * est décochée ou que la sélection est vide, et seuls les objets de
 * l'emprise visible sont demandés au service (le WFS ne groupe le catalogue
 * que par géométrie — une seule des 3 couches globales dépasse 450 000
 * objets, tous types confondus).
 *
 * En dessous du niveau de zoom minimal (config.js), rien n'est affiché ni
 * requêté plutôt que de risquer une réponse énorme ou lente — comme pour les
 * autres fonds de cette application, aucun état cassé n'est jamais montré.
 */
const AMGT4CEM_UrbisTopoLayer = {
  _map: null,
  _group: null,
  _enabled: true,
  _fetchToken: 0,
  _moveTimer: null,
  _catalogIndexCache: null,

  init(map) {
    this._map = map;
    this._group = L.layerGroup();

    AMGT4CEM_UrbisTopoSelectionStore.onChange(() => this.refresh());

    map.on('moveend', () => {
      clearTimeout(this._moveTimer);
      this._moveTimer = setTimeout(() => this.refresh(), 400);
    });

    this.refresh();
  },

  setEnabled(enabled) {
    this._enabled = enabled;
    this.refresh();
  },

  async refresh() {
    const token = ++this._fetchToken;
    this._group.clearLayers();

    if (!this._enabled) {
      this._map.removeLayer(this._group);
      return;
    }

    const selection = AMGT4CEM_UrbisTopoSelectionStore.getSelection();
    const codes = Object.keys(selection);

    if (codes.length === 0) {
      this._map.removeLayer(this._group);
      return;
    }
    this._group.addTo(this._map);

    if (this._map.getZoom() < AMGT4CEM_CONFIG.urbisTopo.minZoom) return;

    const catalogByCode = this._catalogIndex();
    const pointCodes = codes.filter((c) => catalogByCode[c] && catalogByCode[c].geometry === 'point');
    const lineCodes = codes.filter((c) => catalogByCode[c] && catalogByCode[c].geometry === 'ligne');

    const bbox = AMGT4CEM_CRS.boundsToLambertBbox(this._map.getBounds());
    const queries = [];
    if (pointCodes.length) queries.push({ featureType: 'urbistopo:TopoPoints', codes: pointCodes });
    if (lineCodes.length) queries.push({ featureType: 'urbistopo:TopoLines', codes: lineCodes });

    for (const query of queries) {
      let features;
      try {
        features = await this._fetchFeatures(query, bbox);
      } catch (err) {
        console.warn('[AMGT4CEM] Couches UrbIS Topo indisponibles :', err);
        continue;
      }
      if (token !== this._fetchToken) return; // la vue a changé entre-temps
      this._renderFeatures(features, selection, catalogByCode);
    }
  },

  _catalogIndex() {
    if (!this._catalogIndexCache) {
      this._catalogIndexCache = {};
      for (const entry of AMGT4CEM_URBISTOPO_CATALOG) this._catalogIndexCache[entry.code] = entry;
    }
    return this._catalogIndexCache;
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

  _renderFeatures(features, selection, catalogByCode) {
    const typeAttribute = AMGT4CEM_CONFIG.urbisTopo.typeAttribute;
    for (const feature of features) {
      const code = feature.properties && feature.properties[typeAttribute];
      const color = selection[code];
      if (!color) continue; // type non sélectionné (ne devrait pas arriver, le serveur filtre déjà)

      const leafletLayer = this._buildLeafletLayer(feature.geometry, color);
      if (!leafletLayer) continue;
      leafletLayer.bindPopup(this._buildPopup(feature.properties || {}, catalogByCode[code]));
      this._group.addLayer(leafletLayer);
    }
  },

  _buildLeafletLayer(geom, color) {
    if (!geom) return null;
    const toLatLng = (pair) => AMGT4CEM_CRS.lambertToLatLng(pair);

    switch (geom.type) {
      case 'Point':
        return L.circleMarker(toLatLng(geom.coordinates), this._pointStyle(color));
      case 'MultiPoint':
        return L.circleMarker(toLatLng(geom.coordinates[0]), this._pointStyle(color));
      case 'LineString':
        return L.polyline(geom.coordinates.map(toLatLng), this._lineStyle(color));
      case 'MultiLineString':
        return L.polyline(geom.coordinates.map((line) => line.map(toLatLng)), this._lineStyle(color));
      default:
        return null;
    }
  },

  _pointStyle(color) {
    return { radius: 5, color: '#fff', weight: 1, fillColor: color, fillOpacity: 0.9 };
  },

  _lineStyle(color) {
    return { color, weight: 3 };
  },

  /** Construction DOM sûre (pas d'innerHTML) : les valeurs viennent d'un service externe. */
  _buildPopup(props, catalogEntry) {
    const typeAttribute = AMGT4CEM_CONFIG.urbisTopo.typeAttribute;
    const container = document.createElement('div');
    container.className = 'amgt-popup';

    const title = document.createElement('strong');
    title.textContent = props.DESCRFRE || (catalogEntry && catalogEntry.label) || props[typeAttribute] || 'Objet UrbIS Topo';
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
    addRow('Code', props[typeAttribute]);
    addRow('Identifiant', props.ID);
    container.appendChild(table);

    return container;
  },
};
