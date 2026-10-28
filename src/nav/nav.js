/**
 * Barre de navigation de la nouvelle interface (home.html?page=…) : Carte · Saisie · Réglages.
 *
 *  - En bas de l'écran sur téléphone, en haut sur grand écran (voir nav.css).
 *  - Chaque onglet est un lien vers sa page (la page se recharge). L'onglet de la page ouverte ne fait rien.
 *  - Saisie et Réglages exigent une connexion : sans session, le toucher ouvre l'écran de connexion, puis mène
 *    à l'onglet demandé si l'agent se connecte. Pas de cadenas sur les onglets.
 *
 * Icône de compte (AMGT4CEM_Nav.compte()) : bonhomme, pastille verte quand un compte est connecté, croix rouge
 * au survol (souris) ; un toucher déconnecte après confirmation (écran tactile) ; sans session, elle ouvre
 * l'écran de connexion. Placée en haut à droite des écrans Saisie (menu de SIG4CEM) et Réglages.
 *
 * N'est chargée que par les pages (config.js, `pages`) : les interfaces ?app= ne la voient jamais.
 */
const AMGT4CEM_Nav = {
  ONGLETS: [
    { id: 'carto', libelle: 'Carte', protege: false, vb: '0 0 36.87 23', sw: 0.8, icone: '<path d="M5.06,3.28 L9.77,2.19 L14.47,1.10 L12.99,9.27 L11.50,17.45 L6.05,19.58 L0.60,21.71 L2.83,12.49 L5.06,3.28Z M14.47,1.10 L18.19,2.58 L21.90,4.07 L22.90,13.23 L23.89,22.40 L17.69,19.92 L11.50,17.45 L12.99,9.27 L14.47,1.10Z M21.90,4.07 L25.62,2.33 L29.34,0.60 L32.80,8.53 L36.27,16.45 L30.08,19.43 L23.89,22.40 L22.90,13.23 L21.90,4.07Z M16.26,7.07 L17.71,6.95 L19.10,6.81 L19.66,9.05 L20.28,11.31 L19.39,12.97 L18.39,14.59 L17.09,13.19 L15.84,11.82 L16.05,9.44 L16.26,7.07Z M16.21,7.58 L15.49,7.17 L14.77,6.76 L14.06,6.36 L13.33,6.11 L12.55,6.23 L11.77,6.34 L10.99,6.45 L10.22,6.55 L9.44,6.66 L8.67,6.76 L7.90,6.86 L7.13,6.96 L6.37,7.06 L5.60,7.15 L4.84,7.24 L4.08,7.33 M15.93,10.80 L15.10,10.60 L14.27,10.40 L13.43,10.19 L12.58,10.17 L11.73,10.57 L10.87,10.96 L10.01,11.36 L9.15,11.76 L8.29,12.17 L7.43,12.58 L6.56,12.99 L5.69,13.40 L4.82,13.81 L3.95,14.23 L3.08,14.65 L2.21,15.07 M17.36,6.81 L17.25,6.48 L17.13,6.15 L17.02,5.82 L16.92,5.49 L16.81,5.17 L16.71,4.84 L16.61,4.51 L16.51,4.19 L16.41,3.87 L16.32,3.54 L16.23,3.22 L16.14,2.90 L16.05,2.58 L15.97,2.26 L15.89,1.95 L15.81,1.63 M20.22,9.71 L20.94,9.91 L21.66,10.11 L22.37,10.31 L23.08,10.06 L23.78,9.63 L24.49,9.21 L25.18,8.78 L25.88,8.36 L26.56,7.94 L27.25,7.52 L27.93,7.10 L28.61,6.68 L29.28,6.27 L29.95,5.86 L30.62,5.45 L31.28,5.04 M19.14,13.49 L19.59,14.10 L20.05,14.73 L20.52,15.35 L21.00,15.98 L21.49,16.62 L22.00,17.26 L22.51,17.90 L23.03,18.55 L23.57,19.18 L24.11,19.40 L24.67,19.62 L25.23,19.83 L25.81,20.03 L26.40,20.23 L26.99,20.43 L27.60,20.62 M17.04,13.00 L16.95,13.38 L16.86,13.76 L16.77,14.14 L16.68,14.52 L16.59,14.90 L16.49,15.28 L16.40,15.66 L16.30,16.03 L16.20,16.41 L16.10,16.79 L16.00,17.16 L15.89,17.54 L15.79,17.91 L15.68,18.28 L15.57,18.66 L15.46,19.03"/>' },
    { id: 'signal', libelle: 'Saisie', protege: true, img: 'icone-saisie.png', w: 23.75, h: 24 },
    { id: 'reglages', libelle: 'Réglages', protege: true, img: 'icone-reglages.png', w: 17.75, h: 24 },
  ],

  MESSAGES: {
    signal: 'Connectez-vous pour saisir ou consulter des signalements et des demandes.',
    reglages: 'Connectez-vous pour accéder aux réglages.',
  },

  init() {
    if (typeof AMGT4CEM_Router === 'undefined' || AMGT4CEM_Router.mode !== 'page') return;
    const courant = AMGT4CEM_Router.app;
    const nav = document.createElement('nav');
    nav.className = 'amgt-nav';
    nav.setAttribute('aria-label', 'Navigation principale');
    for (const o of this.ONGLETS) {
      const a = document.createElement('a');
      a.className = 'amgt-nav__tab';
      a.href = AMGT4CEM_Router.url(o.id);
      a.innerHTML = (o.img
        ? `<span class="amgt-nav__ic amgt-nav__ic--img" style="width:${o.w}px;height:${o.h}px;-webkit-mask-image:url('${new URL('./src/nav/' + o.img, document.baseURI).href}');mask-image:url('${new URL('./src/nav/' + o.img, document.baseURI).href}')" aria-hidden="true"></span>`
        : `<svg class="amgt-nav__ic" viewBox="${o.vb}" style="width:${(o.vb.split(' ')[2] * 23 / o.vb.split(' ')[3]).toFixed(1)}px;stroke-width:${o.sw}" aria-hidden="true">${o.icone}</svg>`)
        + `<span>${o.libelle}</span>`;
      if (o.id === courant) a.setAttribute('aria-current', 'page');
      a.addEventListener('click', (e) => this._onTab(e, o, a.href));
      nav.append(a);
    }
    document.body.append(nav);

    // Saisie : icône de compte en haut à droite, au-dessus du menu de SIG4CEM (masquée sur les autres écrans, voir nav.css).
    const sig = courant === 'signal' && document.getElementById('sig4cem-root');
    if (sig) sig.append(this.compte({ classe: 'amgt-nav-account--signal' }));
  },

  async _onTab(e, onglet, href) {
    if (onglet.id === AMGT4CEM_Router.app) { e.preventDefault(); return; }
    if (!onglet.protege || this._session()) return; // lien ordinaire
    e.preventDefault();
    const s = await AMGT4CEM_Auth.ensure({ message: this.MESSAGES[onglet.id] });
    if (s) location.href = href;
  },

  _session() {
    return typeof AMGT4CEM_Auth !== 'undefined' && AMGT4CEM_Auth.session();
  },

  /**
   * Icône de compte. Se met à jour seule à chaque connexion ou déconnexion.
   * @param {{classe?: string}} [options]
   * @returns {HTMLButtonElement}
   */
  compte(options = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `amgt-nav-account ${options.classe || ''}`.trim();
    b.innerHTML = '<svg class="amgt-account__user" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>'
      + '<span class="amgt-nav-account__badge" aria-hidden="true">'
      + '<svg class="amgt-nav-account__ok" viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7"/><path d="M4.5 8.3l2.4 2.4 4.6-4.9"/></svg>'
      + '<svg class="amgt-nav-account__out" viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7"/><path d="M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6"/></svg>'
      + '</span>';
    const maj = () => {
      const s = this._session();
      b.classList.toggle('amgt-nav-account--on', !!s);
      const titre = s ? `Connecté : ${AMGT4CEM_Auth.label(s)} — se déconnecter` : 'Se connecter';
      b.title = titre;
      b.setAttribute('aria-label', titre);
    };
    b.addEventListener('click', async () => {
      const s = this._session();
      if (s) {
        const tactile = window.matchMedia && window.matchMedia('(hover: none)').matches;
        if (tactile && !window.confirm(`Se déconnecter (${AMGT4CEM_Auth.label(s)}) ?`)) return;
        AMGT4CEM_Auth.logout();
      } else {
        await AMGT4CEM_Auth.ensure({ message: 'Connectez-vous pour accéder à la saisie et aux réglages.' });
      }
      maj();
    });
    if (typeof AMGT4CEM_Auth !== 'undefined') AMGT4CEM_Auth.onChange(maj);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) maj(); });
    maj();
    return b;
  },
};

AMGT4CEM_Nav.init();
