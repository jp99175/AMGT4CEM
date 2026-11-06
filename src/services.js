/**
 * Configuration des SERVICES externes (fonds de plan, géocodeur, UrbIS Topo) et du relais
 * d'enregistrement. Elle vit dans des fichiers du dépôt, lus par tous au démarrage, et non dans le code :
 *
 *  - config/fonds-de-plan/services.json : fichier GÉNÉRAL — adresse du relais et URL de chaque service
 *    (clés : urbis, bruciel, urbis-orthophotos, flandre, urbis-adm, geocodeur, urbis-topo) ;
 *  - un fichier par service pour ses réglages propres (couches, années, attribution, format...) :
 *    config/fonds-de-plan/{urbis,bruciel,urbis-orthophotos,flandre,geocodeur}.json et, pour les objets
 *    UrbIS Topo, config/urbis-topo/parametres.json (avec la sélection par défaut partagée).
 *
 * load() assemble ces fichiers dans AMGT4CEM_CONFIG (basemaps, geocoder, urbisTopo,
 * peLabelAnchorsRelayUrl), sous la forme lue par basemap.js, searchTool.js et urbisTopoLayer.js, AVANT que
 * ces modules ne s'en servent. Il ne rejette jamais : un fichier absent, illisible ou lent (délai borné)
 * est signalé en console et le service concerné reste simplement non configuré.
 *
 * Modifiées par un administrateur depuis « ⚙ Paramètres » (settingsPanel.js) : save() réécrit services.json
 * (adresses) et, si le nom de la couche UrbIS change, urbis.json, via le relais (routes
 * shared/fonds-de-plan/<fichier>, voir workers/relay/README.md). Il n'y a plus de valeurs « par défaut » dans le code :
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
    this._appliquerEnAttente();
    this._assemble(AMGT4CEM_CONFIG);
  },

  // Enregistrement fait sur le serveur mais pas encore redéployé sur le site (1 à 3 minutes) : cet appareil garde
  // pendant 10 minutes les fichiers qu'il vient d'écrire, pour ne pas revoir l'ancienne valeur. Les autres appareils
  // voient le changement au redéploiement.
  _CLE_ATTENTE: 'amgt4cem.services.enAttente.v1',
  _DUREE_ATTENTE_MS: 10 * 60 * 1000,

  _lireAttente() {
    try {
      const a = JSON.parse(localStorage.getItem(this._CLE_ATTENTE) || 'null');
      if (a && a.ts && Date.now() - a.ts < this._DUREE_ATTENTE_MS) return a;
      if (a) localStorage.removeItem(this._CLE_ATTENTE);
    } catch (err) { /* stockage indisponible : pas d'enregistrement en attente */ }
    return null;
  },

  _noterAttente(fichiers) {
    const a = this._lireAttente() || { ts: 0, fichiers: {} };
    a.ts = Date.now();
    a.fichiers = { ...a.fichiers, ...fichiers };
    try { localStorage.setItem(this._CLE_ATTENTE, JSON.stringify(a)); } catch (err) { /* sans conséquence */ }
  },

  /** Vrai si un enregistrement de cet appareil n'est pas encore visible sur le site publié. */
  enAttente() {
    return !!this._lireAttente();
  },

  _appliquerEnAttente() {
    const a = this._lireAttente();
    if (!a) return;
    const strip = (o) => JSON.stringify({ ...o, date: undefined });
    for (const [nom, contenu] of Object.entries(a.fichiers)) {
      const publie = nom === 'services' ? this._services : this._sources[nom];
      if (publie && strip(publie) === strip(contenu)) { delete a.fichiers[nom]; continue; } // déjà redéployé
      if (nom === 'services') this._services = contenu; else this._sources[nom] = contenu;
    }
    try {
      if (Object.keys(a.fichiers).length) localStorage.setItem(this._CLE_ATTENTE, JSON.stringify(a));
      else localStorage.removeItem(this._CLE_ATTENTE);
    } catch (err) { /* sans conséquence */ }
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
        id: `bruciel-${e.year}${e.variant ? '-' + e.variant : ''}`,
        label: `Bruciel ${e.year}${e.variant ? ' (' + e.variant + ')' : ''}`,
        // Variante (est-ouest, infrarouge...) : traitée comme une source à part (colonne, bascule, logo de Bruxelles).
        source: e.variant ? `${id}-${e.variant}` : id,
        type: o.type || 'wms',
        url: this._url(key),
        layers: e.layers,
        version: o.wmsVersion || '1.3.0',
        format: o.format || 'image/jpeg',
        crs: o.crs,
        attribution: o.attribution,
        year: e.year,
        resolution: e.resolution || '',
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
        // Service de tuiles (WMTS) ; absent = WMS seul. L'adresse vient de services.json (clé « urbis-tuiles »), celle de urbis.json ne sert que de secours.
        // Mode « wms » (Réglages > Services et relais) : on ignore les tuiles, le WMS est affiché seul, sans bascule.
        tuiles: u.tuiles && u.mode !== 'wms' ? { ...u.tuiles, url: this._url('urbis-tuiles') || u.tuiles.url } : null,
      },
      // Ligne du temps unique : Bruciel historique (1935-1996) puis orthophotos récentes UrbIS (2004-2022).
      bruciel: { entries: [...orthoEntries('bruciel', 'bruciel'), ...orthoEntries('urbis-orthophotos', 'bruxelles')] },
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

    // Nappe phréatique (Bruxelles Environnement) : adresses des WFS dans services.json (clés `eaux-souterraines` et `geologie`),
    // réglages (couches, attributs, zoom minimal, mentions) dans config/nappe/parametres.json.
    config.nappe = { ...src('nappe'), urls: { 'eaux-souterraines': this._url('eaux-souterraines'), geologie: this._url('geologie') }, snapshotUrl: this._url('nappe-sync') };

    // Couche DITP-DIOV publique (non connecté) : adresse et couche de la Région lues dans services.json (clé `metro`),
    // copie de secours et délai fixés dans config.js.
    const m = (this._services && this._services.services && this._services.services.metro) || {};
    config.ditpDiovPublic = { ...config.ditpDiovPublic, wfsUrl: m.url || '', couche: m.couche || '' };

    config.peLabelAnchorsRelayUrl = (this._services && this._services.relais && this._services.relais.url) || '';
  },

  /** Service de tuiles UrbIS { url, layer, tileMatrixSet, format }, que le mode d'affichage soit « tuiles » ou « WMS seul » ; null si absent. */
  tuilesConfig() {
    const t = this._sources.urbis && this._sources.urbis.tuiles;
    if (!t) return null;
    const url = this._url('urbis-tuiles') || t.url;
    return url ? { ...t, url } : null;
  },

  /** Valeurs actuellement en vigueur, pour les champs de « ⚙ Paramètres ». */
  current() {
    const tuiles = this._sources.urbis && this._sources.urbis.tuiles;
    return {
      urbisMode: this._sources.urbis && this._sources.urbis.mode === 'wms' ? 'wms' : 'tuiles',
      urbisTuilesUrl: this._url('urbis-tuiles') || (tuiles && tuiles.url) || '',
      urbisTuilesLayer: (tuiles && tuiles.layer) || '',
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
      urbisTuilesUrl: 'urbis-tuiles',
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
    const tuilesLayer = (values.urbisTuilesLayer || '').trim();
    if (tuilesLayer && !/^[\w:.,-]{1,100}$/.test(tuilesLayer)) throw new Error(`Nom de couche de tuiles invalide : ${tuilesLayer}`);

    const mode = values.urbisMode === 'wms' ? 'wms' : 'tuiles';

    const strip = (o) => JSON.stringify({ ...o, date: undefined });
    const today = new Date().toISOString().slice(0, 10);
    if (strip(services) !== strip(this._services || {})) {
      await AMGT4CEM_PeLabelAnchors.putToRelay(relayUrl, 'shared/fonds-de-plan/services', { ...services, version: 1, date: today }, adminCode);
      this._services = { ...services, version: 1, date: today };
      this._noterAttente({ services: this._services });
    }
    // urbis.json : mode d'affichage, couche WMS (repli) et/ou couche de tuiles, réécrit seulement si l'un des trois change.
    const cur = this._sources.urbis;
    if (cur) {
      const layersChange = layers && layers !== cur.layers;
      const tuilesChange = tuilesLayer && cur.tuiles && tuilesLayer !== cur.tuiles.layer;
      const modeChange = mode !== (cur.mode === 'wms' ? 'wms' : 'tuiles');
      if (layersChange || tuilesChange || modeChange) {
        const urbis = { ...cur, date: today };
        if (modeChange) urbis.mode = mode;
        if (layersChange) urbis.layers = layers;
        if (tuilesChange) urbis.tuiles = { ...cur.tuiles, layer: tuilesLayer };
        await AMGT4CEM_PeLabelAnchors.putToRelay(relayUrl, 'shared/fonds-de-plan/urbis', urbis, adminCode);
        this._sources.urbis = urbis;
        this._noterAttente({ urbis });
      }
    }
    if (relay) AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl = relay; // prise en compte immédiate
  },
};
