/**
 * Réglages locaux liés aux adaptations de plans (Réglages > Avancé > Adaptations de plans).
 *
 * L'outil « Dessiner une zone » de la page carte n'apparaît que si le compte connecté détient le droit « plans »
 * ET a coché la case de l'écran « Adaptations de plans ». Cette case est un paramètre LOCAL : il reste dans ce
 * navigateur (localStorage), par compte (matricule), et n'est jamais envoyé au serveur. Le serveur de dépôt reste
 * seul juge du droit ; ce module ne fait que décider de l'affichage. Chargé par la page carte et la page Réglages.
 */
const AMGT4CEM_PlansPrefs = {
  CLE: 'amgt4cem.plans.lieuxActif.v1',

  _matricule() {
    const s = AMGT4CEM_Auth.session();
    return s && s.utilisateur ? String(s.utilisateur.matricule || '') : '';
  },

  /** Le compte connecté détient-il le droit « plans » ? */
  aDroit() { return !!AMGT4CEM_Auth.session() && AMGT4CEM_Auth.aDroit('plans'); },

  /** Case cochée pour le compte connecté (décochée par défaut). */
  lieuxActif() {
    const m = this._matricule();
    if (!m) return false;
    try { return localStorage.getItem(`${this.CLE}.${m}`) === '1'; } catch (err) { return false; }
  },

  fixerLieuxActif(actif) {
    const m = this._matricule();
    if (!m) return;
    try { localStorage.setItem(`${this.CLE}.${m}`, actif ? '1' : '0'); } catch (err) { /* valable pour la session seulement */ }
  },

  /** Bouton « Dessiner une zone » affiché sur la page carte ? */
  outilLieuxDisponible() { return this.aDroit() && this.lieuxActif(); },
};
