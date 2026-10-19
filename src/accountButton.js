/**
 * Icône de connexion (menu ☰ Carte, à droite, sur la ligne de « Réinitialiser la vue ») et droits d'accès de l'interface carte.
 *
 *  - Personne n'est connecté : icône vierge. Un clic ouvre l'écran de connexion (AMGT4CEM_AuthUi).
 *  - Un compte est connecté : l'icône porte un badge vert « validé » ; au survol (souris) il devient une croix
 *    rouge, et un clic déconnecte. Sur un écran tactile, il n'y a pas de survol : une confirmation est demandée
 *    avant de déconnecter, pour qu'un doigt posé par mégarde ne ferme pas la session.
 *
 * Ce que la connexion débloque (ce module n'applique que l'affichage ; le serveur de dépôt reste seul juge) :
 *  - « ✚ Ajouter un point » : visible pour tout compte connecté ;
 *  - « ⚙ Paramètres » (menu ☰ Carte) : visible pour un administrateur connecté.
 * À la déconnexion, les outils et fenêtres réservés sont arrêtés et refermés.
 */
const AMGT4CEM_AccountButton = {
  _btn: null,
  _onChange: null,

  /** @param {{onChange?: Function}} options - onChange() : appelée après chaque changement (rafraîchir les données privées) */
  init(options = {}) {
    this._btn = document.getElementById('amgt-account-btn');
    this._onChange = options.onChange || null;
    this._btn.addEventListener('click', () => this._onClick());
    AMGT4CEM_Auth.onChange(() => this.refresh(true));
    // Une session expire sans événement : on revérifie quand l'onglet redevient actif.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(false); });
    this.refresh(false);
  },

  async _onClick() {
    if (AMGT4CEM_Auth.session()) {
      const tactile = window.matchMedia && window.matchMedia('(hover: none)').matches;
      if (tactile && !window.confirm(`Se déconnecter (${AMGT4CEM_Auth.label()}) ?`)) return;
      AMGT4CEM_Auth.logout();
      return;
    }
    await AMGT4CEM_Auth.ensure({ message: 'Connectez-vous pour ajouter des points et accéder aux fonctions réservées.' });
    this.refresh(false);
  },

  /** @param {boolean} notify - la session vient de changer : prévenir l'application */
  refresh(notify) {
    const s = AMGT4CEM_Auth.session();
    const btn = this._btn;
    btn.classList.toggle('amgt-account--on', !!s);
    const titre = s ? `Connecté : ${AMGT4CEM_Auth.label(s)} — cliquer pour se déconnecter` : 'Se connecter';
    btn.title = titre;
    btn.setAttribute('aria-label', titre);

    const show = (id, visible) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('amgt-hidden', !visible);
    };
    show('amgt-add-point-btn', !!s);
    show('amgt-settings-btn', AMGT4CEM_Admin.isAdmin());

    if (!s) {
      // Plus de compte : on arrête ce qui lui était réservé.
      if (typeof AMGT4CEM_AddPointTool !== 'undefined') AMGT4CEM_AddPointTool.deactivate();
      if (typeof AMGT4CEM_AddPointMenu !== 'undefined') AMGT4CEM_AddPointMenu.close();
      const panneau = document.getElementById('amgt-settings-panel');
      if (panneau) panneau.classList.add('amgt-hidden');
    }
    if (notify && this._onChange) this._onChange(!!s);
  },
};
