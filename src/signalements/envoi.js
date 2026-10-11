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
    // Connexion d'abord : la fiche doit porter le matricule du rédacteur / contributeur avant d'être archivée.
    let session = null;
    let stamped = s;
    let blob = null;
    let headers = null;
    const preparer = async () => {
      const m = session.utilisateur.matricule;
      const redacteur = s.redacteur || m;
      const contributeurs = (s.contributeurs && s.contributeurs.length) ? s.contributeurs : [m]; // sans historique : l'expéditeur est l'auteur
      stamped = { ...s, redacteur, contributeurs };
      blob = (await NS.Depot.buildArchive(stamped)).blob;
      headers = {
        'X-Signalement-Id': s.id,
        'X-Flux': 'STANDARD', // plus de flux séparé : le serveur accepte encore AMIANTE mais on ne l'utilise plus
        'X-Fichier': NS.Depot.depotFileName(stamped),
        'Content-Type': 'application/zip',
      };
    };
    // Connexion demandée si besoin ; un jeton refusé (compte désactivé, expiré) redemande une fois la connexion.
    for (let essai = 0; essai < 2; essai++) {
      session = await AMGT4CEM_Auth.ensure({ message: essai ? 'Votre connexion a expiré ou a été refusée : reconnectez-vous.' : 'Connectez-vous pour envoyer au serveur. Vos entrées restent sur cet appareil tant que vous ne l\'avez pas fait.' });
      if (!session) throw new Error('Envoi annulé : connexion requise. L\'entrée reste sur cet appareil.');
      await preparer();
      try {
        const r = await AMGT4CEM_Auth.call('/depot', { method: 'POST', headers, body: blob, raw: true });
        return { ...r, redacteur: stamped.redacteur, contributeurs: stamped.contributeurs };
      } catch (err) {
        if (err.status === 401 && essai === 0) continue;
        throw err;
      }
    }
  },
};
})();
