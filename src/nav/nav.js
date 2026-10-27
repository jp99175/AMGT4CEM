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
    { id: 'carto', libelle: 'Carte', protege: false, icone: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>' },
    { id: 'signal', libelle: 'Saisie', protege: true, icone: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>' },
    { id: 'reglages', libelle: 'Réglages', protege: true, icone: '<path d="M10.3 4.3c.4-1.8 2.9-1.8 3.4 0a1.7 1.7 0 0 0 2.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8.4 1.8 2.9 0 3.4a1.7 1.7 0 0 0-1 2.6c.9 1.5-.9 3.3-2.4 2.4a1.7 1.7 0 0 0-2.6 1c-.5 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.5-1c-1.6.9-3.3-.9-2.4-2.4a1.7 1.7 0 0 0-1.1-2.6c-1.7-.5-1.7-3 0-3.4a1.7 1.7 0 0 0 1.1-2.5c-.9-1.6.8-3.3 2.4-2.4a1.7 1.7 0 0 0 2.5-1.1z"/><circle cx="12" cy="12" r="3"/>' },
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
      a.innerHTML = `<svg class="amgt-nav__ic" viewBox="0 0 24 24" aria-hidden="true">${o.icone}</svg><span>${o.libelle}</span>`;
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
