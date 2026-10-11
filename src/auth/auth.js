/**
 * Identification des intervenants : session et appels au serveur de dépôt (depot-signalements/).
 *
 * Partagé par SIG4CEM (envoi des signalements) et la page d'administration. Le serveur détient le référentiel
 * (R2, jamais le dépôt public) et vérifie tout ; ici on ne garde que le jeton reçu après connexion, dans
 * localStorage (propre à l'appareil, valable 30 jours). Aucun mot de passe n'est conservé.
 *
 *   AMGT4CEM_Auth.init({ serverUrl })
 *   AMGT4CEM_Auth.session()          session valide ou null : { jeton, expire, utilisateur }
 *   AMGT4CEM_Auth.ensure(options)    session, sinon écran de connexion (AMGT4CEM_AuthUi) ; null si l'agent renonce
 *   AMGT4CEM_Auth.call(path, { method, body, auth })   appel JSON ; lève une Error au message lisible
 */
const AMGT4CEM_Auth = {
  serverUrl: '',
  KEY: 'amgt4cem.session.v1',

  init(options) {
    this.serverUrl = String((options && options.serverUrl) || '').replace(/\/+$/, '');
  },

  configured() {
    return !!this.serverUrl;
  },

  session() {
    try {
      const s = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      if (s && s.jeton && new Date(s.expire).getTime() > Date.now()) return s;
    } catch (err) { /* session illisible : comme absente */ }
    return null;
  },

  _store(s) {
    try { if (s) localStorage.setItem(this.KEY, JSON.stringify(s)); else localStorage.removeItem(this.KEY); } catch (err) { /* sans mémoire locale : redemandé à chaque fois */ }
  },

  logout() {
    this._store(null);
  },

  async call(path, { method = 'GET', body, auth = true, headers = {}, raw } = {}) {
    if (!this.configured()) throw new Error("Aucun serveur n'est configuré (options.serverUrl dans config.js).");
    const h = { ...headers };
    if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
    const s = this.session();
    if (auth && s) h.Authorization = `Bearer ${s.jeton}`;
    let response;
    try {
      response = await fetch(this.serverUrl + path, { method, headers: h, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new Error('Serveur injoignable (réseau, ou adresse non autorisée).');
    }
    let data = {};
    try { data = await response.json(); } catch (err) { /* corps vide */ }
    if (response.status === 401 && auth && s) this.logout(); // jeton refusé : on ne le garde pas
    if (!response.ok) {
      const e = new Error(data.erreur || `Erreur du serveur (HTTP ${response.status}).`);
      e.status = response.status;
      throw e;
    }
    return data;
  },

  async login(matricule, motdepasse) {
    const r = await this.call('/auth/login', { method: 'POST', auth: false, body: { matricule, motdepasse } });
    this._store({ jeton: r.jeton, expire: r.expire, utilisateur: r.utilisateur });
    return this.session();
  },

  async activer(matricule, code, motdepasse) {
    const r = await this.call('/auth/activer', { method: 'POST', auth: false, body: { matricule, code, motdepasse } });
    this._store({ jeton: r.jeton, expire: r.expire, utilisateur: r.utilisateur });
    return this.session();
  },

  /** Session valide, sinon écran de connexion. `options` : voir AMGT4CEM_AuthUi.prompt. */
  async ensure(options) {
    return this.session() || AMGT4CEM_AuthUi.prompt(options || {});
  },

  /** « Prénom Nom (matricule) » */
  label(s) {
    const u = (s || this.session() || {}).utilisateur;
    return u ? `${u.prenom} ${u.nom} (${u.matricule})` : '';
  },
};
