/**
 * Envoi des signalements au serveur de dépôt (depot-signalements/, Cloudflare Worker).
 *
 * Le signalement reste d'abord sur l'appareil ; quand l'agent l'envoie, le serveur reçoit l'archive de
 * dépôt (la même que l'export ZIP), lui attribue la référence AAAA-NNNN et la range. Cette référence
 * revient ici et est inscrite sur le signalement local, qui devient « référencé ». Renvoyer un signalement
 * déjà reçu redonne la même référence (le serveur est idempotent) : un envoi interrompu se refait sans risque.
 *
 * Le code d'accès est demandé une fois et gardé le temps de l'onglet (sessionStorage), jamais dans
 * localStorage ni dans le code. Il identifie l'appartenance au service, pas la personne.
 */
(function () {
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});
const CODE_KEY = 'amgt4cem.signalements.code';

NS.Envoi = {
  serverUrl: '',

  init(options) {
    this.serverUrl = String((options && options.serverUrl) || '').replace(/\/+$/, '');
  },

  configured() {
    return !!this.serverUrl;
  },

  getCode() {
    try { return sessionStorage.getItem(CODE_KEY) || ''; } catch (err) { return ''; }
  },

  setCode(code) {
    try { if (code) sessionStorage.setItem(CODE_KEY, code); else sessionStorage.removeItem(CODE_KEY); } catch (err) { /* sans mémoire d'onglet : redemandé */ }
  },

  /** Code gardé, sinon demandé à l'agent. @returns {string} '' si l'agent annule. */
  ensureCode() {
    let code = this.getCode();
    if (!code) {
      code = (window.prompt("Code d'accès au serveur de dépôt des signalements :") || '').trim();
      if (code) this.setCode(code);
    }
    return code;
  },

  async _call(path, options) {
    let response;
    try {
      response = await fetch(this.serverUrl + path, options);
    } catch (err) {
      throw new Error("Serveur de dépôt injoignable (réseau, ou adresse non autorisée). Le signalement reste sur cet appareil.");
    }
    let body = {};
    try { body = await response.json(); } catch (err) { /* corps vide */ }
    if (response.status === 401) {
      this.setCode(''); // un code refusé ne reste pas en mémoire
      throw new Error("Code d'accès refusé.");
    }
    if (!response.ok) throw new Error(body.erreur || `Erreur du serveur (HTTP ${response.status}).`);
    return body;
  },

  /**
   * Envoie un signalement. @returns {Promise<{reference: string, recuLe: string}>}
   * @throws si le serveur n'est pas configuré, si le code manque ou est refusé, ou en cas d'échec.
   */
  async send(s) {
    if (!this.configured()) throw new Error("Aucun serveur de dépôt n'est configuré (options.serverUrl dans config.js).");
    const code = this.ensureCode();
    if (!code) throw new Error('Envoi annulé : pas de code d’accès.');
    const { blob } = await NS.Depot.buildArchive(s);
    return this._call('/depot', {
      method: 'POST',
      headers: {
        'X-Depot-Code': code,
        'X-Signalement-Id': s.id,
        'X-Flux': 'STANDARD', // plus de flux séparé : le serveur accepte encore AMIANTE mais on ne l'utilise plus
        'X-Fichier': NS.Depot.depotFileName(s),
        'Content-Type': 'application/zip',
      },
      body: blob,
    });
  },
};
})();
