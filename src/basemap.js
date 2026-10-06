/**
 * Fonds de plan : UrbIS et orthophotos (ligne du temps unique alimentée par
 * deux sources : Bruxelles — Bruciel/UrbIS, 1935-2022 — et Flandre — Digitaal
 * Vlaanderen, 2000-2025). Un millésime présent dans les deux sources peut
 * être affiché depuis l'une ou l'autre (choix mémorisé par année).
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
  _layersById: {},
  _entries: [],
  _accessibilityChecks: {},

  // Sources d'orthophotos, dans l'ordre d'affichage du bouton de bascule.
  // `defaultOrder` : préférence quand aucun choix n'a été mémorisé pour l'année.
  SOURCES: {
    bruxelles: { label: 'Bruxelles' },
    vlaanderen: { label: 'Flandre' },
  },
  DEFAULT_SOURCE: 'bruxelles',
  _SOURCE_STORAGE_PREFIX: 'amgt-ortho-source-',

  init(map) {
    this._map = map;
    this._layersById = {};
    this._entries = this._buildEntries();
    for (const entry of this._entries) this._layersById[entry.id] = this._buildLayer(entry);
  },

  /**
   * Fusionne les séries bruxelloise (config.basemaps.bruciel) et flamande
   * (config.basemaps.flandre) en une liste d'entrées WMS homogènes. Les
   * entrées flamandes reçoivent les réglages communs du service (URL, emprise
   * de la Région) ; la clé `key` désigne le millésime affiché dans la ligne
   * du temps (l'année, ou la plage pour les compilations multi-années) : deux
   * entrées de sources différentes partageant la même `key` sont des doublons
   * entre lesquels l'utilisateur peut basculer.
   */
  _buildEntries() {
    const cfg = AMGT4CEM_CONFIG.basemaps;
    const entries = cfg.bruciel.entries.map((e) => ({ ...e, key: String(e.year), sortYear: e.year }));

    const fl = cfg.flandre;
    const flBounds = fl.regionBboxLambert
      ? L.latLngBounds(
          AMGT4CEM_CRS.lambertToLatLng([fl.regionBboxLambert[0], fl.regionBboxLambert[1]]),
          AMGT4CEM_CRS.lambertToLatLng([fl.regionBboxLambert[2], fl.regionBboxLambert[3]]),
        )
      : null;
    for (const e of fl.entries) {
      const key = e.period || String(e.year);
      entries.push({
        id: `vlaanderen-${key}`,
        key,
        sortYear: e.year,
        year: e.year,
        label: `Flandre ${key}`,
        source: 'vlaanderen',
        type: 'wms',
        url: fl.url,
        layers: e.layers,
        version: '1.3.0',
        format: 'image/jpeg',
        attribution: '&copy; Digitaal Vlaanderen',
        bounds: flBounds,
      });
    }
    return entries;
  },

  /**
   * Affiche le fond UrbIS (remplace le fond courant s'il y en a un).
   */
  showUrbis() {
    this._setActiveLayer(this._buildLayer(AMGT4CEM_CONFIG.basemaps.urbis));
  },

  /**
   * Affiche l'orthophoto du millésime `key`, issue de la source `source`
   * (par défaut : celle mémorisée pour ce millésime, sinon la source par
   * défaut, sinon la première disponible — voir getPreferredSource).
   * Retourne la source effectivement affichée.
   */
  showOrtho(item, source) {
    const chosen = source || this.getPreferredSource(item);
    const choice = item.sources.find((s) => s.source === chosen) || item.sources[0];
    this._setActiveLayer(this._layersById[choice.entry.id]);
    return choice.source;
  },

  /** Source préférée pour ce millésime (choix mémorisé, sinon défaut). */
  getPreferredSource(item) {
    let stored = null;
    try {
      stored = localStorage.getItem(this._SOURCE_STORAGE_PREFIX + item.key);
    } catch (_) { /* stockage indisponible : on retombe sur le défaut */ }
    if (stored && item.sources.some((s) => s.source === stored)) return stored;
    if (item.sources.some((s) => s.source === this.DEFAULT_SOURCE)) return this.DEFAULT_SOURCE;
    return item.sources[0].source;
  },

  /** Mémorise, par appareil, la source choisie pour ce millésime. */
  rememberSource(item, source) {
    try {
      localStorage.setItem(this._SOURCE_STORAGE_PREFIX + item.key, source);
    } catch (_) { /* sans conséquence : le choix vaut pour la session seulement */ }
  },

  /**
   * Sonde l'accessibilité de chaque entrée (une requête GetMap minimale par
   * couche, mise en cache pour la session) et retourne la ligne du temps :
   * un élément par millésime, avec les sources accessibles pour ce millésime,
   * en ordre chronologique. Les millésimes sans aucune source accessible sont
   * omis.
   * @returns {Promise<{key: string, sortYear: number, sources: {source: string, entry: object}[]}[]>}
   */
  async getAccessibleTimeline() {
    const results = await Promise.all(this._entries.map((entry) => this._checkAccessible(entry)));
    const byKey = new Map();
    this._entries.forEach((entry, i) => {
      if (!results[i]) return;
      if (!byKey.has(entry.key)) byKey.set(entry.key, { key: entry.key, sortYear: entry.sortYear, sources: [] });
      byKey.get(entry.key).sources.push({ source: entry.source, entry });
    });
    // Plage multi-années triée sur sa dernière année ; à égalité, la plage
    // (compilation) passe après l'année isolée.
    return [...byKey.values()].sort((a, b) => a.sortYear - b.sortYear || a.key.length - b.key.length);
  },

  _checkAccessible(entry) {
    if (this._accessibilityChecks[entry.id]) return this._accessibilityChecks[entry.id];

    const promise = new Promise((resolve) => {
      const [minX, minY, maxX, maxY] = AMGT4CEM_CONFIG.probeBboxLambert;
      // Les couches sans `crs` forcé (Flandre) sont sondées en Lambert 72 aussi :
      // le service le déclare, et c'est la bbox de sondage qui est en Lambert.
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
    // Le fond de plan peut changer (UrbIS <-> orthophoto, navigation
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
    // Limite le chargement des tuiles à cette emprise (WGS84) : rien n'est
    // demandé au serveur ni affiché au-delà (voir config.basemaps.flandre).
    if (entry.bounds) options.bounds = entry.bounds;

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
