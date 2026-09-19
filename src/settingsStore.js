/**
 * Surcharges utilisateur des adresses de services externes (UrbIS,
 * orthophotos, géocodeur). Toutes les sources de données de l'application
 * sont des services distants dont l'URL est en dur dans config.js ; si l'un
 * d'eux change d'adresse, ce module permet de le corriger depuis le panneau
 * "⚙ Paramètres" (voir settingsPanel.js) sans modifier le code.
 *
 * Stockage séparé de la micro-base de points métier (pointsStore.js) : ce
 * sont des préférences techniques, pas des données métier.
 */
const AMGT4CEM_SettingsStore = {
  _key: 'amgt4cem.settings.v1',

  getOverrides() {
    try {
      const raw = localStorage.getItem(this._key);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('[AMGT4CEM] Paramètres enregistrés illisibles, ignorés :', err);
      return {};
    }
  },

  /**
   * @param {object} overrides - un champ vide/absent revient à la valeur par
   * défaut de config.js plutôt que d'être enregistré tel quel.
   */
  save(overrides) {
    const cleaned = {};
    for (const [key, value] of Object.entries(overrides)) {
      if (value) cleaned[key] = value;
    }
    localStorage.setItem(this._key, JSON.stringify(cleaned));
  },

  reset() {
    localStorage.removeItem(this._key);
  },

  /**
   * Applique les surcharges enregistrées sur AMGT4CEM_CONFIG, en place. À
   * appeler une seule fois au tout début de app.js, avant que les autres
   * modules (basemap.js, searchTool.js...) ne lisent la configuration.
   */
  applyToConfig(config) {
    const o = this.getOverrides();

    if (o.urbisUrl) config.basemaps.urbis.url = o.urbisUrl;
    if (o.urbisLayers) config.basemaps.urbis.layers = o.urbisLayers;

    if (o.brucielHistoriqueUrl || o.brucielRecentUrl) {
      for (const entry of config.basemaps.bruciel.entries) {
        if (o.brucielHistoriqueUrl && entry.year <= 1996) entry.url = o.brucielHistoriqueUrl;
        if (o.brucielRecentUrl && entry.year >= 2004) entry.url = o.brucielRecentUrl;
      }
    }

    if (o.geocoderUrl) config.geocoder.url = o.geocoderUrl;
  },
};
