/**
 * Identification des intervenants : session et appels au serveur de dépôt (workers/depot/).
 *
 * Partagé par SIG4CEM (envoi des signalements) et la page d'administration. Le serveur détient le référentiel
 * (R2, jamais le dépôt public) et vérifie tout ; ici on ne garde que le jeton reçu après connexion, dans
 * localStorage (propre à l'appareil, valable 30 jours). Aucun mot de passe n'est conservé.
 *
 *   AMGT4CEM_Auth.init({ serverUrl })
 *   AMGT4CEM_Auth.session()          session valide ou null : { jeton, expire, utilisateur }
 *   AMGT4CEM_Auth.ensure(options)    session, sinon écran de connexion (AMGT4CEM_AuthUi) ; null si l'agent renonce
 *   AMGT4CEM_Auth.call(path, { method, body, auth })   appel JSON ; lève une Error au message lisible
 *   AMGT4CEM_Auth.onChange(fn)       fn() est appelée quand la session change (connexion, déconnexion, autre onglet)
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
    this._emit();
  },

  _listeners: [],
  _watching: false,

  /** `fn()` est appelée à chaque changement de session : connexion, déconnexion, jeton refusé, autre onglet. */
  onChange(fn) {
    this._listeners.push(fn);
    if (!this._watching) {
      this._watching = true;
      window.addEventListener('storage', (e) => { if (e.key === this.KEY || e.key === null) this._emit(); });
    }
  },

  _emit() {
    for (const fn of this._listeners) {
      try { fn(); } catch (err) { console.error('[AMGT4CEM] Auth.onChange :', err); }
    }
  },

  logout() {
    this._store(null);
  },

  async call(path, { method = 'GET', body, auth = true, headers = {}, raw, blob } = {}) {
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
    if (blob && response.ok) return response.blob();
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

  // --- Rappel avant l'expiration ----------------------------------------------------------------------------------
  // La session dure 30 jours (jeton signé par le serveur de dépôt, TOKEN_TTL_S). Pour qu'elle n'expire pas en plein
  // travail (tunnel, local technique, sans réseau), le mot de passe est redemandé DANS LES 7 DERNIERS JOURS : une
  // nouvelle connexion émet un nouveau jeton de 30 jours. Au plus une demande par 24 h ; « Plus tard » la repousse.
  RAPPEL_JOURS: 7,
  RAPPEL_KEY: 'amgt4cem.session.rappel.v1', // horodatage du dernier rappel affiché
  _rappelEnCours: false,

  /** Jours restants avant l'expiration (arrondi au-dessus), ou null sans session. */
  joursRestants() {
    const s = this.session();
    return s ? Math.ceil((new Date(s.expire).getTime() - Date.now()) / 86400000) : null;
  },

  /**
   * Redemande le mot de passe si la session expire dans 7 jours ou moins (une fois par 24 h, hors ligne : plus tard).
   * @returns {Promise<object|null>} la nouvelle session si l'agent s'est reconnecté, sinon null
   */
  async rappelerSiBesoin() {
    const s = this.session();
    if (!s || this._rappelEnCours) return null;
    const reste = new Date(s.expire).getTime() - Date.now();
    if (reste > this.RAPPEL_JOURS * 86400000) return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null; // la connexion échouerait : au retour du réseau
    try {
      if (Date.now() - Number(localStorage.getItem(this.RAPPEL_KEY) || 0) < 86400000) return null;
      localStorage.setItem(this.RAPPEL_KEY, String(Date.now()));
    } catch (err) { /* sans mémoire locale : le rappel peut revenir à chaque ouverture, sans gravité */ }
    this._rappelEnCours = true;
    try {
      const jours = this.joursRestants();
      const date = new Date(s.expire).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });
      return await AMGT4CEM_AuthUi.prompt({
        titre: 'Prolonger la session',
        message: `Votre session expire le ${date} (dans ${jours} jour${jours > 1 ? 's' : ''}). Saisissez de nouveau votre mot de passe pour la prolonger de 30 jours.`,
        matricule: s.utilisateur && s.utilisateur.matricule,
        fermer: 'Plus tard',
        sansActivation: true,
      });
    } finally {
      this._rappelEnCours = false;
    }
  },

  /** À appeler une fois au démarrage d'une interface : rappel à l'ouverture, au retour sur l'onglet et au retour du réseau. */
  surveillerExpiration() {
    const go = () => { this.rappelerSiBesoin().catch((err) => console.error('[AMGT4CEM] Rappel de session :', err)); };
    go();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
    window.addEventListener('online', go);
  },

  /** Session valide, sinon écran de connexion. `options` : voir AMGT4CEM_AuthUi.prompt. */
  async ensure(options) {
    return this.session() || AMGT4CEM_AuthUi.prompt(options || {});
  },

  /** « Prénom Nom (matricule) » */
  label(s) {
    const u = (s || this.session() || {}).utilisateur;
    return u ? `${`${u.prenom} ${u.nom}`.trim() || "Compte"} (${u.matricule})` : "";
  },
};
