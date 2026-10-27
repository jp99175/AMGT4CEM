/**
 * Routeur de home.html : choisit l'interface selon le paramètre d'adresse.
 *
 * Interfaces actuelles (`apps` de config.js), inchangées jusqu'à la bascule :
 *   home.html?app=carto    AMGT4CEM : visualisation de toutes les données sur la carte (défaut)
 *   home.html?app=signal   SIG4CEM  : saisie des signalements et demandes
 *   home.html?app=admin    Administration des intervenants
 *
 * Nouvelle interface (`pages` de config.js), qui vit à côté des précédentes jusqu'à la bascule :
 *   home.html?page=carto     carte, avec la barre de navigation Carte · Saisie · Réglages
 *   home.html?page=signal    saisie, avec la même barre
 *   home.html?page=reglages  réglages, regroupés par droit
 * Une page reprend le plus souvent les fichiers de l'interface correspondante ; seuls les fichiers qui
 * changent sont copiés (voir config.js). Sans paramètre, home.html ouvre toujours l'ancienne carte.
 *
 * Les interfaces sont déclarées avec un gabarit, des styles et des scripts. Le routeur copie le gabarit
 * choisi dans la page, charge les styles puis les scripts DANS L'ORDRE (un script dépend des précédents),
 * et ne charge jamais une autre interface : la carte n'embarque pas le code de la saisie, et inversement.
 * Tout ce qui doit servir aux deux vit dans config.js et dans des modules listés dans les deux interfaces
 * (le socle commun).
 *
 * Liens entre interfaces : AMGT4CEM_Router.url('signal', { x, y }) donne une adresse relative à cette page,
 * DE LA MÊME FAMILLE que l'interface ouverte : ?page=signal depuis une page, ?app=signal depuis une interface
 * actuelle. Une interface qui n'existe pas encore comme page (« admin ») garde son adresse ?app=. Les
 * paramètres autres que `app` et `page` sont libres et lus par l'interface cible (AMGT4CEM_Router.params).
 */
const AMGT4CEM_Router = {
  /** Identifiant de l'interface chargée (« carto », « signal », « reglages »…), ou null avant start(). */
  app: null,
  /** 'app' : interface actuelle (?app=) ; 'page' : nouvelle interface (?page=). */
  mode: 'app',
  /** Paramètres d'adresse autres que `app` et `page`, tels que reçus (URLSearchParams). */
  params: new URLSearchParams(),

  /**
   * Adresse d'une interface, relative à home.html, dans la famille de l'interface ouverte.
   * @param {string} app - identifiant de l'interface
   * @param {Object<string,string>} [extra] - paramètres supplémentaires
   */
  url(app, extra) {
    const pages = AMGT4CEM_CONFIG.pages || {};
    const key = this.mode === 'page' && Object.prototype.hasOwnProperty.call(pages, app) ? 'page' : 'app';
    const q = new URLSearchParams({ [key]: app, ...(extra || {}) });
    return `home.html?${q.toString()}`;
  },

  async start() {
    const config = AMGT4CEM_CONFIG;
    const query = new URLSearchParams(location.search);
    const parPage = query.has('page');
    const registry = parPage ? (config.pages || {}) : config.apps;
    const requested = parPage ? query.get('page') : query.get('app');
    const id = requested || (parPage ? config.defaultPage : config.defaultApp);
    const app = Object.prototype.hasOwnProperty.call(registry, id) ? registry[id] : null;
    this.mode = parPage ? 'page' : 'app';

    if (!app) {
      this._showError(`Interface inconnue : « ${requested} ». Interfaces disponibles : ${Object.keys(registry).join(', ')}.`, id);
      return;
    }

    query.delete('app');
    query.delete('page');
    this.params = query;
    this.app = id;
    document.title = app.title;
    document.documentElement.dataset.app = id;
    if (parPage) document.documentElement.dataset.page = id;
    // Barre de navigation (src/nav/) : la place est réservée AVANT le chargement des scripts, pour que la carte
    // prenne tout de suite sa taille définitive.
    if (app.nav) document.documentElement.classList.add('amgt-has-nav');

    const template = document.getElementById(app.template);
    if (!template) {
      this._showError(`Gabarit introuvable pour l'interface « ${id} » (#${app.template}).`, id);
      return;
    }
    document.body.insertBefore(template.content.cloneNode(true), template);

    const styles = (app.styles || []).map((href) => this._loadStyle(href));
    try {
      // Nouvelle interface : on attend ses styles (la mise en page de la barre en dépend) ; un style manquant
      // ne bloque rien. Interfaces actuelles : comportement inchangé.
      if (parPage) await Promise.all(styles);
      await this._loadScripts(app.scripts);
      await Promise.all((app.modules || []).map((m) => import(new URL(m, document.baseURI).href)));
    } catch (err) {
      console.error(`[AMGT4CEM] Interface « ${id} » non chargée :`, err);
      this._showError(`L'interface « ${id} » n'a pas pu être chargée : ${err.message}`, id);
    }
  },

  /** Ajoute une feuille de style ; la promesse est tenue au chargement comme à l'échec. */
  _loadStyle(href) {
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = () => { console.warn(`[AMGT4CEM] Style introuvable : ${href}`); resolve(); };
      document.head.appendChild(link);
    });
  },

  /**
   * Télécharge tous les scripts EN PARALLÈLE mais les exécute dans l'ordre déclaré (`async = false` sur des
   * scripts ajoutés dynamiquement) : un chargement l'un après l'autre ajoutait un aller-retour réseau par script.
   */
  _loadScripts(srcs) {
    return Promise.all(srcs.map((src) => this._loadScript(src)));
  },

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = false; // exécution dans l'ordre d'insertion, téléchargement en parallèle
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`script introuvable : ${src}`));
      document.body.appendChild(script);
    });
  },

  /** Message en clair, avec un lien vers chaque interface existante de la même famille. */
  _showError(message, id) {
    const registry = this.mode === 'page' ? (AMGT4CEM_CONFIG.pages || {}) : AMGT4CEM_CONFIG.apps;
    const box = document.createElement('div');
    box.className = 'amgt-router-error';
    box.append(Object.assign(document.createElement('p'), { textContent: message }));
    const list = document.createElement('p');
    for (const name of Object.keys(registry)) {
      if (name === id) continue;
      const a = document.createElement('a');
      a.href = this.url(name);
      a.textContent = registry[name].title;
      a.style.display = 'block';
      list.append(a);
    }
    box.append(list);
    document.body.append(box);
  },
};

AMGT4CEM_Router.start();
