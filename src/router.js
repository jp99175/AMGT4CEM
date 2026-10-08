/**
 * Routeur de home.html : choisit l'interface selon le paramètre d'adresse ?app=.
 *
 *   home.html?app=carto    AMGT4CEM : visualisation de toutes les données sur la carte (défaut)
 *   home.html?app=signal   SIG4CEM  : saisie des signalements et demandes
 *
 * Les interfaces sont déclarées dans `apps` de config.js (gabarit, styles, scripts). Le routeur copie
 * le gabarit choisi dans la page, charge les styles puis les scripts DANS L'ORDRE (un script dépend des
 * précédents), et ne charge jamais une autre interface : la carte n'embarque pas le code de la saisie,
 * et inversement. Tout ce qui doit servir aux deux vit dans config.js et dans des modules listés dans
 * les deux interfaces (le socle commun).
 *
 * Liens entre interfaces : AMGT4CEM_Router.url('carto', { mode: 'choisir-point' }) donne une adresse
 * relative à cette page ; les paramètres autres que `app` sont libres et lus par l'interface cible
 * (AMGT4CEM_Router.params).
 */
const AMGT4CEM_Router = {
  /** Identifiant de l'interface chargée (« carto », « signal »), ou null avant start(). */
  app: null,
  /** Paramètres d'adresse autres que `app`, tels que reçus (URLSearchParams). */
  params: new URLSearchParams(),

  /**
   * Adresse d'une interface, relative à home.html.
   * @param {string} app - identifiant de l'interface
   * @param {Object<string,string>} [extra] - paramètres supplémentaires
   */
  url(app, extra) {
    const q = new URLSearchParams({ app, ...(extra || {}) });
    return `home.html?${q.toString()}`;
  },

  async start() {
    const config = AMGT4CEM_CONFIG;
    const query = new URLSearchParams(location.search);
    const requested = query.get('app');
    const id = requested || config.defaultApp;
    const app = Object.prototype.hasOwnProperty.call(config.apps, id) ? config.apps[id] : null;

    if (!app) {
      this._showError(`Interface inconnue : « ${requested} ». Interfaces disponibles : ${Object.keys(config.apps).join(', ')}.`, id);
      return;
    }

    query.delete('app');
    this.params = query;
    this.app = id;
    document.title = app.title;
    document.documentElement.dataset.app = id;

    const template = document.getElementById(app.template);
    if (!template) {
      this._showError(`Gabarit introuvable pour l'interface « ${id} » (#${app.template}).`, id);
      return;
    }
    document.body.insertBefore(template.content.cloneNode(true), template);

    for (const href of app.styles || []) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
    try {
      for (const src of app.scripts) await this._loadScript(src);
    } catch (err) {
      console.error(`[AMGT4CEM] Interface « ${id} » non chargée :`, err);
      this._showError(`L'interface « ${id} » n'a pas pu être chargée : ${err.message}`, id);
    }
  },

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`script introuvable : ${src}`));
      document.body.appendChild(script);
    });
  },

  /** Message en clair, avec un lien vers chaque interface existante. */
  _showError(message, id) {
    const box = document.createElement('div');
    box.className = 'amgt-router-error';
    box.append(Object.assign(document.createElement('p'), { textContent: message }));
    const list = document.createElement('p');
    for (const name of Object.keys(AMGT4CEM_CONFIG.apps)) {
      if (name === id) continue;
      const a = document.createElement('a');
      a.href = this.url(name);
      a.textContent = AMGT4CEM_CONFIG.apps[name].title;
      a.style.display = 'block';
      list.append(a);
    }
    box.append(list);
    document.body.append(box);
  },
};

AMGT4CEM_Router.start();
