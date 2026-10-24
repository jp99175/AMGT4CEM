/**
 * Accès administrateur : la fenêtre « ⚙ Paramètres » (et, dans ses onglets, l'enregistrement des paramètres
 * généraux sur le serveur, le mode édition des étiquettes de planche) n'est destinée qu'aux administrateurs.
 *
 * L'administrateur est un compte CONNECTÉ (AMGT4CEM_Auth, src/auth/) dont la fiche porte le droit administrateur ;
 * le serveur de dépôt reste seul juge de ce droit, ici on ne fait que masquer ce qui ne sert à rien.
 * Droits précis (utilisateurs, attributs, plans, vocabulaire) : AMGT4CEM_Auth.aDroit(). Pour l'instant, la fenêtre
 * ⚙ Paramètres reste réservée au droit `utilisateurs` ; elle sera répartie par onglet avec l'écriture dans R2.
 */
const AMGT4CEM_Admin = {
  /** Un administrateur est-il connecté ? */
  isAdmin() {
    const s = AMGT4CEM_Auth.session();
    return !!s && AMGT4CEM_Auth.aDroit('utilisateurs', s);
  },

  /**
   * Demande l'accès administrateur : écran de connexion si personne n'est connecté.
   * @returns {Promise<boolean>} true si un administrateur est connecté.
   */
  async requestAccess() {
    if (this.isAdmin()) return true;
    const s = await AMGT4CEM_Auth.ensure({ admin: true, message: 'Cette fonction est réservée aux administrateurs.' });
    return !!s && this.isAdmin();
  },
};
