/**
 * Accès administrateur : la fenêtre « ⚙ Paramètres » (et, dans ses onglets,
 * l'enregistrement des paramètres généraux sur le serveur, le mode édition des
 * étiquettes de planche) n'est destinée qu'aux administrateurs.
 *
 * POINT DE BRANCHEMENT du futur mot de passe administrateur — pas encore
 * implémenté : pour l'instant l'accès est ouvert (config.js `adminMode`).
 * Quand le mot de passe existera, `requestAccess()` est le seul endroit à
 * compléter (demander le mot de passe, le vérifier, retourner true/false) ;
 * tous les appelants (settingsPanel.js, pe-label-editor) passent par lui.
 */
const AMGT4CEM_Admin = {
  /** Faut-il considérer l'utilisateur comme administrateur, sans rien lui demander ? */
  isAdmin() {
    return AMGT4CEM_CONFIG.adminMode !== false;
  },

  /**
   * Demande l'accès administrateur (futur mot de passe).
   * @returns {Promise<boolean>} true si l'accès est accordé.
   */
  async requestAccess() {
    return this.isAdmin();
  },
};
