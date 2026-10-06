/**
 * Paramètres GÉNÉRAUX de l'application — adresses des services externes
 * (UrbIS, orthophotos, géocodeur) et du serveur d'enregistrement (relais) :
 * communs à tous les visiteurs, enregistrés sur le serveur, pas dans le
 * navigateur. Modifiés par un administrateur depuis « ⚙ Paramètres » (voir
 * settingsPanel.js).
 *
 * Stockage : data/app-settings.json dans le dépôt (config.js
 * `appSettingsUrl`), lu par tous au démarrage — il ne contient que les valeurs
 * qui diffèrent de config.js, le reste garde sa valeur par défaut. Écrit via
 * le relais d'enregistrement (relay/, PUT /settings), car un navigateur ne peut
 * pas écrire dans le dépôt (voir README section 6).
 *
 * Remplace les anciennes surcharges locales (localStorage) : elles ne sont
 * plus lues, et l'ancienne clé est supprimée au démarrage pour qu'un réglage
 * oublié sur un appareil ne contredise pas silencieusement les paramètres
 * généraux.
 */
const AMGT4CEM_SettingsStore = {
  _settings: {},
  /** Valeurs de config.js avant application des paramètres généraux (pour « valeurs par défaut »). */
  defaults: {},

  /** Charge le fichier partagé. N'échoue jamais : absent/illisible/lent = valeurs par défaut de config.js. */
  async load() {
    try {
      localStorage.removeItem('amgt4cem.settings.v1'); // anciens réglages locaux, remplacés par les paramètres généraux
    } catch (err) {
      /* localStorage indisponible : rien à nettoyer */
    }
    try {
      // Délai borné : l'application ne doit pas rester bloquée si le serveur de fichiers est lent.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(AMGT4CEM_CONFIG.appSettingsUrl, { cache: 'no-cache', signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        const data = await response.json();
        this._settings = (data && data.settings) || {};
      }
    } catch (err) {
      console.warn('[AMGT4CEM] Paramètres généraux illisibles, valeurs par défaut utilisées :', err);
    }
    return this._settings;
  },

  /**
   * Applique les paramètres généraux sur AMGT4CEM_CONFIG, en place. À appeler
   * une seule fois au tout début de app.js (après load()), avant que les autres
   * modules (basemap.js, searchTool.js...) ne lisent la configuration.
   */
  applyToConfig(config) {
    const histEntry = config.basemaps.bruciel.entries.find((e) => e.year <= 1996);
    const recentEntry = config.basemaps.bruciel.entries.find((e) => e.year >= 2004);
    this.defaults = {
      urbisUrl: config.basemaps.urbis.url,
      urbisLayers: config.basemaps.urbis.layers,
      brucielHistoriqueUrl: histEntry ? histEntry.url : '',
      brucielRecentUrl: recentEntry ? recentEntry.url : '',
      flandreUrl: config.basemaps.flandre.url,
      geocoderUrl: config.geocoder.url,
      relayUrl: config.peLabelAnchorsRelayUrl || '',
    };
    const o = this._settings;

    if (o.urbisUrl) config.basemaps.urbis.url = o.urbisUrl;
    if (o.urbisLayers) config.basemaps.urbis.layers = o.urbisLayers;

    if (o.brucielHistoriqueUrl || o.brucielRecentUrl) {
      for (const entry of config.basemaps.bruciel.entries) {
        if (o.brucielHistoriqueUrl && entry.year <= 1996) entry.url = o.brucielHistoriqueUrl;
        if (o.brucielRecentUrl && entry.year >= 2004) entry.url = o.brucielRecentUrl;
      }
    }

    if (o.flandreUrl) config.basemaps.flandre.url = o.flandreUrl;

    if (o.geocoderUrl) config.geocoder.url = o.geocoderUrl;
    if (o.relayUrl) config.peLabelAnchorsRelayUrl = o.relayUrl;
  },

  /** Valeurs actuellement en vigueur (défauts de config.js + paramètres généraux). */
  current() {
    return { ...this.defaults, ...this._settings };
  },

  /**
   * Enregistre les paramètres généraux sur le serveur.
   * @param {object} values - toutes les valeurs saisies ; celles égales à la valeur par défaut ne sont pas enregistrées.
   * @param {string} relayUrl - adresse du relais À UTILISER pour cet enregistrement (peut être celle qu'on vient de saisir : c'est ainsi qu'on l'enregistre la première fois).
   * @param {string} adminCode - code administrateur du relais
   * @returns {Promise<void>} rejetée avec un Error au message lisible en cas d'échec
   */
  async save(values, relayUrl, adminCode) {
    const settings = {};
    for (const [key, value] of Object.entries(values)) {
      if (value && value !== this.defaults[key]) settings[key] = value;
    }
    await AMGT4CEM_PeLabelAnchors.putToRelay(relayUrl, 'settings', { version: 1, settings }, adminCode);
    this._settings = settings;
    if (values.relayUrl) AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl = values.relayUrl; // prise en compte immédiate
  },
};
