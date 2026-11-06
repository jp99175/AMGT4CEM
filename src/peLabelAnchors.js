/**
 * Définitions d'ancrage/orientation des références de planche (PE_label),
 * PARTAGÉES : lues dans un fichier du dépôt (data/plans-patrimoine/etiquettes-planches.json,
 * voir config.js `peLabelAnchorsUrl`) et appliquées pour tous les visiteurs, pas
 * propres à un navigateur.
 *
 * Format du FICHIER : { "version": 1, "crs": "EPSG:31370", "labels": { "1000-236#0": { r1, a1: [x, y], r2?, a2? } } }
 * — Lambert 72 en mètres (a1/a2, au mm près) ; la clé est "numéro de
 * planche#rang" (le rang distingue deux étiquettes de même numéro, ex.
 * "3000-126#1") ; la signification de r1/a1/r2/a2 est décrite dans scaledText.js.
 * Ce JSON est la liste COMPLÈTE des
 * références de planche (source unique) : une étiquette absente du fichier n'existe pas.
 *
 * Format INTERNE (tout le reste de l'application, scaledText.js, plugin) : a1/a2 en
 * [lat, lng] (WGS84, l'affichage Leaflet) — la conversion se fait ici, à la lecture
 * (_fromFile) et à l'enregistrement (_toFile), et nulle part ailleurs.
 *
 * Enregistrement (réservé aux administrateurs, voir le plugin
 * src/peLabelEditor/) : un navigateur ne peut pas écrire dans le dépôt
 * (l'API GitHub refuse les requêtes préparatoires CORS, voir README section
 * 6) ; l'écriture passe donc par un petit relais serveur (workers/relay/, à déployer
 * une fois) qui valide la demande et enregistre le fichier dans le dépôt.
 * `peLabelAnchorsRelayUrl` (config.js) vide = enregistrement non configuré.
 */
const AMGT4CEM_PeLabelAnchors = {
  _labels: {},

  /** Charge le fichier partagé. N'échoue jamais : absent/illisible = aucune définition (positions d'origine). */
  async load() {
    try {
      // no-cache : revalide auprès du serveur (GitHub Pages met les fichiers en cache ~10 min) — réponse 304 peu coûteuse.
      const response = await fetch(AMGT4CEM_CONFIG.peLabelAnchorsUrl, { cache: 'no-cache' });
      if (response.ok) {
        const data = await response.json();
        this._labels = this._fromFile((data && data.labels) || {});
      }
    } catch (err) {
      console.warn('[AMGT4CEM] Définitions d\'ancrage des étiquettes de planche illisibles, positions d\'origine utilisées :', err);
    }
    return this._labels;
  },

  /** Fichier (a1/a2 en Lambert [x, y]) -> interne (a1/a2 en [lat, lng]). Tolère un ancien fichier déjà en [lat, lng]. */
  _fromFile(labels) {
    const toLatLng = (p) => {
      if (!Array.isArray(p) || Math.abs(p[0]) < 1000) return p; // déjà [lat, lng]
      const ll = AMGT4CEM_CRS.lambertToLatLng(p);
      return [ll.lat, ll.lng];
    };
    const out = {};
    for (const [key, d] of Object.entries(labels)) {
      out[key] = { ...d, a1: toLatLng(d.a1), ...(d.a2 ? { a2: toLatLng(d.a2) } : {}) };
    }
    return out;
  },

  /** Interne -> fichier : a1/a2 en Lambert [x, y] au mm, clés triées (un enregistrement sans changement ne crée pas de commit). */
  _toFile(labels) {
    const toLambert = (p) => {
      const { x, y } = AMGT4CEM_CRS.latLngToLambert(L.latLng(p[0], p[1]));
      return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
    };
    const out = {};
    for (const key of Object.keys(labels).sort()) {
      const d = labels[key];
      out[key] = { r1: d.r1, a1: toLambert(d.a1), ...(d.r2 && d.a2 ? { r2: d.r2, a2: toLambert(d.a2) } : {}) };
    }
    return out;
  },

  get(key) {
    return this._labels[key] || null;
  },

  /** Copie des définitions actuellement enregistrées (état de référence pour détecter les modifications). */
  all() {
    return JSON.parse(JSON.stringify(this._labels));
  },

  isSaveConfigured() {
    return !!AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl;
  },

  /**
   * Code administrateur du relais : gardé en sessionStorage (le temps de
   * l'onglet, jamais écrit sur le disque de l'appareil).
   */
  getAdminCode() {
    try {
      return sessionStorage.getItem('amgt4cem-admin-code') || '';
    } catch (err) {
      return '';
    }
  },

  /**
   * Fenêtre de saisie du code administrateur (champ masqué, avec case « Afficher »). Renvoie le code saisi (gardé le
   * temps de l'onglet) ou '' si l'utilisateur annule. Si un code est déjà gardé, il est renvoyé sans rien demander.
   */
  demanderCode(message) {
    const deja = this.getAdminCode();
    if (deja) return Promise.resolve(deja);
    return new Promise((resolve) => {
      const el = (tag, style, props) => Object.assign(document.createElement(tag), props || {}, { style: style || '' });
      const fond = el('div', 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;');
      const boite = el('form', 'background:#fff;color:#1f2933;border-radius:10px;padding:16px;width:100%;max-width:340px;box-sizing:border-box;font:15px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3);');
      boite.setAttribute('role', 'dialog'); boite.setAttribute('aria-modal', 'true'); boite.setAttribute('aria-label', 'Code administrateur');
      const titre = el('div', 'font-weight:600;margin:0 0 4px;', { textContent: 'Code administrateur' });
      const aide = el('div', 'font-size:13px;color:#52606d;margin:0 0 10px;', { textContent: message || 'Nécessaire pour enregistrer sur le serveur. Il n\'est gardé que le temps de cet onglet.' });
      const champ = el('input', 'width:100%;box-sizing:border-box;padding:9px 10px;font-size:16px;border:1px solid #9aa5b1;border-radius:6px;', { type: 'password', autocomplete: 'off' });
      champ.setAttribute('autocapitalize', 'none'); champ.setAttribute('spellcheck', 'false');
      const etiquette = el('label', 'display:flex;align-items:center;gap:6px;margin:8px 0 12px;font-size:14px;');
      const voir = el('input', '', { type: 'checkbox' });
      voir.addEventListener('change', () => { champ.type = voir.checked ? 'text' : 'password'; });
      etiquette.append(voir, document.createTextNode('Afficher le code'));
      const annuler = el('button', 'padding:9px 14px;font-size:15px;border:1px solid #cbd2d9;border-radius:6px;background:#fff;cursor:pointer;', { type: 'button', textContent: 'Annuler' });
      const valider = el('button', 'padding:9px 14px;font-size:15px;border:1px solid #2c3e50;border-radius:6px;background:#2c3e50;color:#fff;cursor:pointer;', { type: 'submit', textContent: 'Valider' });
      const actions = el('div', 'display:flex;gap:8px;justify-content:flex-end;');
      actions.append(annuler, valider);
      boite.append(titre, aide, champ, etiquette, actions);
      fond.append(boite);
      const fin = (code) => { document.removeEventListener('keydown', touche, true); fond.remove(); resolve(code); };
      const touche = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); fin(''); } };
      document.addEventListener('keydown', touche, true);
      annuler.addEventListener('click', () => fin(''));
      boite.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const code = champ.value.trim();
        if (!code) { champ.focus(); return; }
        this.setAdminCode(code);
        fin(code);
      });
      document.body.append(fond);
      champ.focus();
    });
  },

  setAdminCode(code) {
    try {
      if (code) sessionStorage.setItem('amgt4cem-admin-code', code);
      else sessionStorage.removeItem('amgt4cem-admin-code');
    } catch (err) {
      /* sessionStorage indisponible : le code sera redemandé */
    }
  },

  /**
   * Vérifie la connexion au relais et le code administrateur, sans rien
   * écrire (GET). Retourne un message lisible ; rejette si le relais est
   * injoignable ou refuse le code.
   */
  async checkConnection(url, code) {
    if (!url) throw new Error("Adresse du relais non renseignée.");
    let response;
    try {
      response = await fetch(url.replace(/\/+$/, '') + '/', { method: 'GET', headers: { Authorization: `Bearer ${code}` } });
    } catch (err) {
      throw new Error(`Relais injoignable (${err.message}) : vérifier l'adresse, et que le site y est autorisé (ALLOWED_ORIGINS).`);
    }
    if (response.status === 401) throw new Error('Relais joignable, mais code administrateur refusé.');
    if (!response.ok) throw new Error(`Relais joignable, réponse inattendue (HTTP ${response.status}).`);
    return 'Relais joignable, code administrateur accepté.';
  },

  /**
   * Enregistre l'ensemble des définitions dans le dépôt, via le relais (adresse : paramètres généraux).
   * @param {Object} labels - { clé: { r1, a1, r2?, a2? } } au format interne (a1/a2 en [lat, lng]) ; étiquettes SANS définition : absentes
   * @param {string} adminCode - code administrateur attendu par le relais
   * @returns {Promise<void>} rejetée avec un Error au message lisible en cas d'échec
   */
  async save(labels, adminCode) {
    await this.putToRelay(AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl, 'shared/plans-patrimoine/etiquettes-planches', { version: 1, crs: 'EPSG:31370', labels: this._toFile(labels) }, adminCode);
    this._labels = JSON.parse(JSON.stringify(labels));
  },

  /**
   * Envoie un contenu au relais (PUT <relais>/<route>). Sert aussi à
   * l'enregistrement de la configuration des services (services.js) et des
   * sélections par défaut partagées (selectionStore.js).
   */
  async putToRelay(relayUrl, route, body, adminCode) {
    if (!relayUrl) {
      throw new Error("Enregistrement impossible : adresse du relais non renseignée (Réglages > Avancé > Services et relais, voir workers/relay/README.md).");
    }
    if (!adminCode) adminCode = await this.demanderCode();
    if (!adminCode) throw new Error('Enregistrement annulé : code administrateur non saisi.');
    let response;
    try {
      response = await fetch(`${relayUrl.replace(/\/+$/, '')}/${route}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminCode}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Relais injoignable (${err.message}).`);
    }
    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.json()).error || '';
      } catch (err) {
        /* corps non JSON : le code HTTP suffit */
      }
      if (response.status === 404 && /Route inconnue/.test(detail)) {
        throw new Error(`Le relais déployé ne connaît pas la route « ${route} » : il faut redéployer workers/relay/worker.js (voir workers/relay/README.md). ${detail}`);
      }
      if (response.status === 401) this.setAdminCode(''); // un code refusé ne doit pas rester en mémoire : il sera redemandé
      throw new Error(response.status === 401 ? 'Code administrateur refusé.' : `Enregistrement refusé (HTTP ${response.status}) ${detail}`.trim());
    }
  },
};
