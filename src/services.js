/**
 * Configuration des SERVICES externes (fonds de plan, géocodeur, UrbIS Topo) et du relais
 * d'enregistrement. Elle vit dans des fichiers du dépôt, lus par tous au démarrage, et non dans le code :
 *
 *  - data/fonds-de-plan/services.json : fichier GÉNÉRAL — adresse du relais et URL de chaque service
 *    (clés : urbis, bruciel, urbis-orthophotos, flandre, urbis-adm, geocodeur, urbis-topo) ;
 *  - un fichier par service pour ses réglages propres (couches, années, attribution, format...) :
 *    data/fonds-de-plan/{urbis,bruciel,urbis-orthophotos,flandre,geocodeur}.json et, pour les objets
 *    UrbIS Topo, data/urbis-topo/parametres.json (avec la sélection par défaut partagée).
 *
 * load() assemble ces fichiers dans AMGT4CEM_CONFIG (basemaps, geocoder, urbisTopo,
 * peLabelAnchorsRelayUrl), sous la forme lue par basemap.js, searchTool.js et urbisTopoLayer.js, AVANT que
 * ces modules ne s'en servent. Il ne rejette jamais : un fichier absent, illisible ou lent (délai borné)
 * est signalé en console et le service concerné reste simplement non configuré.
 *
 * Modifiées par un administrateur depuis « ⚙ Paramètres » (settingsPanel.js) : save() réécrit services.json
 * (adresses) et, si le nom de la couche UrbIS change, urbis.json, via le relais (routes
 * shared/fonds-de-plan/<fichier>, voir relay/README.md). Il n'y a plus de valeurs « par défaut » dans le code :
 * les fichiers du dépôt font foi (historique Git pour revenir en arrière).
 *
 * Remplace data/app-settings.json et les blocs `basemaps` / `geocoder` / `urbisTopo` de config.js.
 */
const AMGT4CEM_Services = {
  _services: null, // contenu de services.json ({ version, relais, services }), null si illisible
  _sources: {}, // contenus des fichiers par service, par clé (urbis, bruciel...)

  async load() {
    try {
      localStorage.removeItem('amgt4cem.settings.v1'); // anciens réglages locaux, abandonnés depuis longtemps
    } catch (err) {
      /* localStorage indisponible : rien à nettoyer */
    }
    const cfg = AMGT4CEM_CONFIG.fondsDePlan;
    const keys = Object.keys(cfg.sourcesUrls);
    const [services, ...sources] = await Promise.all([
      this._fetchJson(cfg.servicesUrl),
      ...keys.map((k) => this._fetchJson(cfg.sourcesUrls[k])),
    ]);
    this._services = services;
    keys.forEach((k, i) => (this._sources[k] = sources[i]));
    this._assemble(AMGT4CEM_CONFIG);
  },

  /** JSON d'un fichier de configuration, ou null (avertissement) ; délai borné pour ne jamais bloquer l'application. */
  async _fetchJson(url) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(url, { cache: 'no-cache', signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) return await response.json();
      console.warn(`[AMGT4CEM] Configuration illisible (${url}) : HTTP ${response.status}`);
    } catch (err) {
      console.warn(`[AMGT4CEM] Configuration illisible (${url}) :`, err);
    }
    return null;
  },

  /** URL d'un service d'après services.json ('' si non configuré). */
  _url(key) {
    const s = this._services && this._services.services && this._services.services[key];
    return (s && s.url) || '';
  },

  /** Assemble la configuration lue par le reste de l'application (même forme que l'ancien config.js). */
  _assemble(config) {
    const src = (k) => this._sources[k] || {};

    const u = src('urbis');
    const orthoEntries = (key, id) => {
      const o = src(key);
      return (o.entries || []).map((e) => ({
        id: `bruciel-${e.year}`,
        label: `Bruciel ${e.year}`,
        source: id,
        type: o.type || 'wms',
        url: this._url(key),
        layers: e.layers,
        version: o.wmsVersion || '1.3.0',
        format: o.format || 'image/jpeg',
        crs: o.crs,
        attribution: o.attribution,
        year: e.year,
      }));
    };
    const f = src('flandre');
    config.basemaps = {
      urbis: {
        id: u.id,
        label: u.label,
        type: u.type || 'wms',
        url: this._url('urbis'),
        layers: u.layers,
        version: u.wmsVersion || '1.3.0',
        format: u.format,
        attribution: u.attribution,
      },
      // Ligne du temps unique : Bruciel historique (1935-1996) puis orthophotos récentes UrbIS (2004-2022).
      bruciel: { entries: [...orthoEntries('bruciel', 'bruxelles'), ...orthoEntries('urbis-orthophotos', 'bruxelles')] },
      flandre: {
        url: this._url('flandre'),
        regionBoundary: { wfsUrl: this._url('urbis-adm'), ...(f.regionBoundary || {}) },
        regionBboxLambert: f.regionBboxLambert,
        attribution: f.attribution,
        entries: f.entries || [],
      },
    };

    const g = src('geocodeur');
    config.geocoder = { url: this._url('geocodeur'), spatialReference: g.spatialReference, language: g.language };

    const t = src('urbis-topo');
    config.urbisTopo = {
      ...config.urbisTopo, // defaultSelectionUrl (config.js)
      wfsUrl: this._url('urbis-topo'),
      version: t.wfsVersion,
      typeAttribute: t.typeAttribute,
      minZoom: t.minZoom,
      maxFeaturesPerQuery: t.maxFeaturesPerQuery,
      colorPalette: t.colorPalette || [],
    };

    config.peLabelAnchorsRelayUrl = (this._services && this._services.relais && this._services.relais.url) || '';
  },

  /** Valeurs actuellement en vigueur, pour les champs de « ⚙ Paramètres ». */
  current() {
    return {
      urbisUrl: this._url('urbis'),
      urbisLayers: this._sources.urbis ? this._sources.urbis.layers || '' : '',
      brucielHistoriqueUrl: this._url('bruciel'),
      brucielRecentUrl: this._url('urbis-orthophotos'),
      flandreUrl: this._url('flandre'),
      geocoderUrl: this._url('geocodeur'),
      relayUrl: (this._services && this._services.relais && this._services.relais.url) || '',
    };
  },

  /**
   * Enregistre les paramètres sur le serveur (via le relais) : services.json, et urbis.json si le nom de la
   * couche UrbIS change. Seuls les fichiers modifiés sont réécrits (pas de commit sans changement).
   * @param {object} values - toutes les valeurs saisies (voir current())
   * @param {string} relayUrl - adresse du relais À UTILISER pour cet enregistrement (peut être celle qu'on vient de saisir :
   *   c'est ainsi qu'on l'enregistre la première fois)
   * @param {string} adminCode - code administrateur du relais
   * @returns {Promise<void>} rejetée avec un Error au message lisible en cas d'échec
   */
  async save(values, relayUrl, adminCode) {
    const isUrl = (v) => /^(https:\/\/[^\s]+|http:\/\/localhost(:\d+)?(\/[^\s]*)?)$/.test(v) && v.length <= 400;
    const urlFields = {
      urbisUrl: 'urbis',
      brucielHistoriqueUrl: 'bruciel',
      brucielRecentUrl: 'urbis-orthophotos',
      flandreUrl: 'flandre',
      geocoderUrl: 'geocodeur',
    };
    const services = JSON.parse(JSON.stringify(this._services || { version: 1, relais: {}, services: {} }));
    services.services = services.services || {};
    for (const [field, key] of Object.entries(urlFields)) {
      const v = (values[field] || '').trim();
      if (!v) continue;
      if (!isUrl(v)) throw new Error(`Adresse invalide pour « ${key} » (https obligatoire) : ${v}`);
      services.services[key] = { ...(services.services[key] || {}), url: v };
    }
    const relay = (values.relayUrl || '').trim();
    if (relay && !isUrl(relay)) throw new Error(`Adresse du relais invalide (https obligatoire) : ${relay}`);
    services.relais = { ...(services.relais || {}), url: relay };

    const layers = (values.urbisLayers || '').trim();
    if (layers && !/^[\w:.,-]{1,100}$/.test(layers)) throw new Error(`Nom de couche invalide : ${layers}`);

    const strip = (o) => JSON.stringify({ ...o, date: undefined });
    const today = new Date().toISOString().slice(0, 10);
    if (strip(services) !== strip(this._services || {})) {
      await AMGT4CEM_PeLabelAnchors.putToRelay(relayUrl, 'shared/fonds-de-plan/services', { ...services, version: 1, date: today }, adminCode);
      this._services = { ...services, version: 1, date: today };
    }
    if (layers && this._sources.urbis && layers !== this._sources.urbis.layers) {
      const urbis = { ...this._sources.urbis, layers, date: today };
      await AMGT4CEM_PeLabelAnchors.putToRelay(relayUrl, 'shared/fonds-de-plan/urbis', urbis, adminCode);
      this._sources.urbis = urbis;
    }
    if (relay) AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl = relay; // prise en compte immédiate
  },
};
