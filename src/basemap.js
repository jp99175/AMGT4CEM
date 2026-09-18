/**
 * Fonds de plan : UrbIS, Orthophoto (dernière en date) et Bruciel (série
 * historique, une couche par année).
 *
 * Une seule couche de fond est ajoutée à la carte à la fois ; changer de fond
 * ou d'année Bruciel retire l'ancienne couche et ajoute la nouvelle.
 *
 * Techniquement, un L.tileLayer.wms Leaflet charge ses tuiles via des balises
 * <img>, pas via fetch/XHR : les restrictions CORS n'empêchent donc pas
 * l'affichage (elles ne bloqueraient que la lecture des pixels via un canvas,
 * ce qui n'est pas fait ici). Le facteur bloquant réel possible est
 * l'accessibilité réseau du service depuis le poste client, pas le CORS.
 */
const AMGT4CEM_Basemap = {
  _map: null,
  _currentLayer: null,
  _leafletCrsCache: {},
  _brucielLayersByYear: {},

  init(map) {
    this._map = map;
    this._brucielLayersByYear = {};
    for (const year of AMGT4CEM_CONFIG.basemaps.bruciel.years) {
      const entry = AMGT4CEM_CONFIG.basemaps.bruciel.layerFor(year);
      this._brucielLayersByYear[year] = this._buildLayer(entry);
    }
  },

  /**
   * Affiche le fond UrbIS (remplace le fond courant s'il y en a un).
   */
  showUrbis() {
    this._setActiveLayer(this._buildLayer(AMGT4CEM_CONFIG.basemaps.urbis));
  },

  /**
   * Affiche l'orthophoto la plus récente.
   */
  showOrthophoto() {
    this._setActiveLayer(this._buildLayer(AMGT4CEM_CONFIG.basemaps.orthophoto));
  },

  /**
   * Affiche la couche Bruciel correspondant à l'année donnée (voir
   * AMGT4CEM_CONFIG.basemaps.bruciel.years pour les années disponibles).
   */
  showBruciel(year) {
    const layer = this._brucielLayersByYear[year];
    if (!layer) {
      console.warn('[AMGT4CEM] Année Bruciel inconnue :', year);
      return;
    }
    this._setActiveLayer(layer);
  },

  _setActiveLayer(layer) {
    if (this._currentLayer === layer) return;
    if (this._currentLayer) this._map.removeLayer(this._currentLayer);
    this._currentLayer = layer;
    layer.addTo(this._map);
  },

  _buildLayer(entry) {
    const options = {
      layers: entry.layers,
      version: entry.version || '1.3.0',
      format: entry.format || 'image/png',
      transparent: false,
      attribution: entry.attribution,
      maxZoom: AMGT4CEM_CONFIG.maxZoom,
    };
    // La carte Leaflet affiche en Web Mercator (EPSG:3857) par défaut. Certains
    // services WMS (ex : orthophotos Bruciel) ne déclarent que EPSG:31370 dans
    // leur GetCapabilities et refusent les requêtes en 3857 : `crs` force alors
    // Leaflet à requêter ce fond dans son CRS natif, sans changer le CRS
    // d'affichage général de la carte (Leaflet convertit automatiquement).
    if (entry.crs) options.crs = this._resolveLeafletCrs(entry.crs);

    const layer = L.tileLayer.wms(entry.url, options);
    this._attachErrorWarning(layer, entry);
    return layer;
  },

  /**
   * Résout (et met en cache) un objet L.CRS Proj4Leaflet pour un code EPSG donné.
   * Suppose que ce code a déjà été enregistré via proj4.defs() (c'est le cas pour
   * EPSG:31370, fait dans crs.js au chargement).
   */
  _resolveLeafletCrs(epsgCode) {
    if (!this._leafletCrsCache[epsgCode]) {
      this._leafletCrsCache[epsgCode] = new L.Proj.CRS(epsgCode);
    }
    return this._leafletCrsCache[epsgCode];
  },

  _attachErrorWarning(layer, entry) {
    let failed = false;
    layer.on('tileerror', () => {
      if (failed) return;
      failed = true;
      console.warn(`[AMGT4CEM] Le fond "${entry.label}" semble inaccessible depuis ce poste.`);
      const warningEl = document.getElementById('amgt-basemap-warning');
      warningEl.textContent = `Le fond « ${entry.label} » semble inaccessible depuis ce poste.`;
      warningEl.classList.remove('amgt-hidden');
    });
  },
};
