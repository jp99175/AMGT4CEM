/**
 * Fonds de plan : UrbIS et Bruciel (ligne du temps orthophotos, une couche
 * par année, de 1935 à la plus récente disponible).
 *
 * Une seule couche de fond est ajoutée à la carte à la fois ; changer de fond
 * ou d'année Bruciel retire l'ancienne couche et ajoute la nouvelle.
 *
 * Chaque année Bruciel est sondée avant d'être proposée à la navigation (voir
 * checkBrucielAccessibility) : aucune tuile cassée ni message d'erreur n'est
 * jamais montré à l'utilisateur, les années inaccessibles sont simplement
 * absentes de la navigation par chevrons (voir mapMenu.js).
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
  _accessibilityChecks: {},

  init(map) {
    this._map = map;
    this._brucielLayersByYear = {};
    for (const entry of AMGT4CEM_CONFIG.basemaps.bruciel.entries) {
      this._brucielLayersByYear[entry.year] = this._buildLayer(entry);
    }
  },

  /**
   * Affiche le fond UrbIS (remplace le fond courant s'il y en a un).
   */
  showUrbis() {
    this._setActiveLayer(this._buildLayer(AMGT4CEM_CONFIG.basemaps.urbis));
  },

  /**
   * Affiche la couche Bruciel correspondant à l'année donnée (voir
   * AMGT4CEM_CONFIG.basemaps.bruciel.entries pour les années disponibles).
   */
  showBruciel(year) {
    const layer = this._brucielLayersByYear[year];
    if (!layer) {
      console.warn('[AMGT4CEM] Année Bruciel inconnue :', year);
      return;
    }
    this._setActiveLayer(layer);
  },

  /**
   * Sonde l'accessibilité de chaque année Bruciel (une requête GetMap minimale
   * par couche, mise en cache pour la session) et retourne les années
   * effectivement accessibles, dans leur ordre chronologique.
   * @returns {Promise<number[]>}
   */
  async getAccessibleBrucielYears() {
    const entries = AMGT4CEM_CONFIG.basemaps.bruciel.entries;
    const results = await Promise.all(entries.map((entry) => this._checkAccessible(entry)));
    return entries.filter((_, i) => results[i]).map((entry) => entry.year);
  },

  _checkAccessible(entry) {
    if (this._accessibilityChecks[entry.id]) return this._accessibilityChecks[entry.id];

    const promise = new Promise((resolve) => {
      const [minX, minY, maxX, maxY] = AMGT4CEM_CONFIG.probeBboxLambert;
      const params = new URLSearchParams({
        service: 'WMS',
        request: 'GetMap',
        version: entry.version || '1.3.0',
        layers: entry.layers,
        styles: '',
        format: entry.format || 'image/png',
        transparent: 'false',
        width: '64',
        height: '64',
        crs: entry.crs || 'EPSG:31370',
        bbox: [minX, minY, maxX, maxY].join(','),
      });

      const probe = new Image();
      let settled = false;
      const finish = (accessible) => {
        if (settled) return;
        settled = true;
        resolve(accessible);
      };

      probe.onload = () => finish(true);
      probe.onerror = () => finish(false);
      // Filet de sécurité si le serveur ne répond ni par succès ni par erreur
      // réseau franche (requête qui reste en attente indéfiniment).
      setTimeout(() => finish(false), 6000);

      probe.src = `${entry.url}?${params.toString()}`;
    });

    this._accessibilityChecks[entry.id] = promise;
    return promise;
  },

  _setActiveLayer(layer) {
    if (this._currentLayer === layer) return;
    if (this._currentLayer) this._map.removeLayer(this._currentLayer);
    this._currentLayer = layer;
    layer.addTo(this._map);
    // Le fond de carte peut changer (UrbIS <-> orthophoto, navigation
    // Bruciel...) pendant que l'outil "Mesurer" reste actif : seuls le
    // glisser et le pincer-zoomer sont désactivés pendant ce temps, pas le
    // menu ☰ Carte. Le fond mis en cache pour la capture (screenshotTool.js)
    // doit donc être invalidé ici aussi, pas seulement à l'activation/
    // désactivation de l'outil, sous peine de capturer un fond obsolète.
    AMGT4CEM_ScreenshotTool.invalidateBackground();
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

    return L.tileLayer.wms(entry.url, options);
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
};
