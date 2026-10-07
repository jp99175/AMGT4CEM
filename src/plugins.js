/**
 * Chargeur de plugins de l'application cartographique.
 *
 * Un plugin est une petite application SÉPARÉE, qui vit dans son propre dossier
 * (src/<plugin>/, avec son README, ses styles et ses scripts) et se branche sur la carte
 * par l'interface ci-dessous. Le cœur de l'application ne connaît aucun plugin par son
 * nom : il lit la liste `plugins` de config.js, charge styles puis scripts dans l'ordre,
 * et chaque plugin s'enregistre avec AMGT4CEM_Plugins.register({ id, init(ctx) }).
 * Un plugin absent, désactivé ou en erreur ne gêne jamais le reste de l'application.
 *
 * Contexte `ctx` remis à init() :
 *  - map            : la carte Leaflet ;
 *  - crs            : AMGT4CEM_CRS (conversions Lambert 72 <-> carte) ;
 *  - config         : AMGT4CEM_CONFIG ;
 *  - base           : adresse du dossier du plugin (ex. './src/signalements/') ;
 *  - options        : le bloc `options` de la déclaration du plugin dans config.js ({} si absent) ;
 *  - toolbar, menu  : éléments DOM de la barre d'outils et du menu ☰ Carte, où le plugin
 *                     ajoute ses boutons et ses cases de couche ;
 *  - addPointMenu   : AMGT4CEM_AddPointMenu ; add(entry) ajoute une entrée au menu du bouton « ✚ Ajouter un
 *                     point » (voir src/addPointMenu.js), setHighlight(on) allume le bouton pendant l'outil ;
 *  - captureClicks(handler)  : déclare un outil de placement ; handler.isActive() et
 *                     handler.handleMapClick(e) sont appelés pour les clics que les polygones
 *                     du réseau interceptent (voir metroLayer.js) ;
 *  - deactivateCoreTools()   : arrête « Ajouter un point » et « Mesurer » ;
 *  - onCoreToolActivated(fn) : prévient le plugin quand un outil du cœur démarre.
 */
const AMGT4CEM_Plugins = {
  _ctx: null,
  _capturers: [],
  _coreToolListeners: [],

  /** Charge tous les plugins activés de config.js. Ne rejette jamais. */
  async init(deps) {
    this._ctx = {
      map: deps.map,
      crs: AMGT4CEM_CRS,
      config: AMGT4CEM_CONFIG,
      addPointMenu: AMGT4CEM_AddPointMenu,
      toolbar: document.getElementById('amgt-toolbar'),
      menu: document.getElementById('amgt-map-menu'),
      captureClicks: (handler) => this._capturers.push(handler),
      deactivateCoreTools: () => deps.deactivateCoreTools(),
      onCoreToolActivated: (fn) => this._coreToolListeners.push(fn),
    };
    for (const plugin of AMGT4CEM_CONFIG.plugins || []) {
      if (!plugin.enabled) continue;
      try {
        await this._load(plugin);
      } catch (err) {
        console.error(`[AMGT4CEM] Plugin « ${plugin.id} » non chargé :`, err);
      }
    }
  },

  async _load(plugin) {
    for (const href of plugin.styles || []) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = plugin.base + href;
      document.head.appendChild(link);
    }
    for (const src of plugin.scripts || []) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = plugin.base + src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`script introuvable : ${plugin.base}${src}`));
        document.body.appendChild(script);
      });
    }
  },

  /** Appelé par le script principal d'un plugin. */
  register(plugin) {
    try {
      const entry = AMGT4CEM_CONFIG.plugins.find((p) => p.id === plugin.id) || {};
      plugin.init({ ...this._ctx, base: entry.base, options: entry.options || {} });
    } catch (err) {
      console.error(`[AMGT4CEM] Plugin « ${plugin.id} » : initialisation impossible :`, err);
    }
  },

  /**
   * Relaie à un plugin un clic de polygone du réseau pendant qu'un de ses outils de placement
   * est actif. @returns {boolean} true si un plugin a pris le clic.
   */
  dispatchMapClick(e) {
    for (const handler of this._capturers) {
      if (handler.isActive()) {
        handler.handleMapClick(e);
        return true;
      }
    }
    return false;
  },

  /** Appelé par app.js quand un outil du cœur (Ajouter un point, Mesurer) démarre. */
  notifyCoreToolActivated(toolName) {
    for (const fn of this._coreToolListeners) fn(toolName);
  },
};
