/**
 * Envoi des signalements au serveur de dépôt (depot-signalements/, Cloudflare Worker).
 *
 * Le signalement reste d'abord sur l'appareil ; quand l'agent l'envoie, le serveur reçoit l'archive de
 * dépôt (la même que l'export ZIP), lui attribue la référence AAAA-NNNN et la range. Cette référence
 * revient ici et est inscrite sur le signalement local, qui devient « référencé ». Renvoyer un signalement
 * déjà reçu redonne la même référence (le serveur est idempotent) : un envoi interrompu se refait sans risque.
 *
 * L'agent s'identifie par sa connexion (src/auth/ : matricule + mot de passe, jeton gardé 30 jours sur l'appareil) ;
 * le serveur inscrit son matricule comme rédacteur du dépôt.
 */
(function () {
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});

NS.Envoi = {
  serverUrl: '',

  init(options) {
    this.serverUrl = String((options && options.serverUrl) || '').replace(/\/+$/, '');
    if (typeof AMGT4CEM_Auth !== 'undefined') AMGT4CEM_Auth.init({ serverUrl: this.serverUrl });
  },

  configured() {
    return !!this.serverUrl;
  },

  /**
   * Envoie un signalement. @returns {Promise<{reference: string, recuLe: string}>}
   * @throws si le serveur n'est pas configuré, si l'agent ne se connecte pas, ou en cas d'échec.
   */
  async send(s) {
    if (!this.configured()) throw new Error("Aucun serveur de dépôt n'est configuré (options.serverUrl dans config.js).");
    const { blob } = await NS.Depot.buildArchive(s);
    const headers = {
      'X-Signalement-Id': s.id,
      'X-Flux': 'STANDARD', // plus de flux séparé : le serveur accepte encore AMIANTE mais on ne l'utilise plus
      'X-Fichier': NS.Depot.depotFileName(s),
      'Content-Type': 'application/zip',
    };
    // Connexion demandée si besoin ; un jeton refusé (compte désactivé, expiré) redemande une fois la connexion.
    for (let essai = 0; essai < 2; essai++) {
      const session = await AMGT4CEM_Auth.ensure({ message: essai ? 'Votre connexion a expiré ou a été refusée : reconnectez-vous.' : 'Connectez-vous pour envoyer au serveur. Vos entrées restent sur cet appareil tant que vous ne l\'avez pas fait.' });
      if (!session) throw new Error('Envoi annulé : connexion requise. L\'entrée reste sur cet appareil.');
      try {
        return await AMGT4CEM_Auth.call('/depot', { method: 'POST', headers, body: blob, raw: true });
      } catch (err) {
        if (err.status === 401 && essai === 0) continue;
        throw err;
      }
    }
  },
};
})();
