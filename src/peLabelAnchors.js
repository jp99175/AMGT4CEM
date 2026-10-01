/**
 * Définitions d'ancrage/orientation des références de planche (PE_label),
 * PARTAGÉES : lues dans un fichier du dépôt (data/pe-label-anchors.json, voir
 * config.js `peLabelAnchorsUrl`) et appliquées pour tous les visiteurs, pas
 * propres à un navigateur.
 *
 * Format : { "version": 1, "labels": { "1000-236#0": { r1, a1: [lat, lng], r2?, a2? }, ... } }
 * — la clé est "numéro de planche#rang" (le rang distingue deux étiquettes de
 * même numéro, ex. "3000-126#1") ; la signification de r1/a1/r2/a2 est
 * décrite dans scaledText.js. Une étiquette absente du fichier garde sa
 * position et son orientation d'origine (MetroLabels.shp).
 *
 * Enregistrement (réservé aux administrateurs, voir le plugin
 * plugins/pe-label-editor/) : un navigateur ne peut pas écrire dans le dépôt
 * (l'API GitHub refuse les requêtes préparatoires CORS, voir README section
 * 6) ; l'écriture passe donc par un petit relais serveur (relay/, à déployer
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
        this._labels = (data && data.labels) || {};
      }
    } catch (err) {
      console.warn('[AMGT4CEM] Définitions d\'ancrage des étiquettes de planche illisibles, positions d\'origine utilisées :', err);
    }
    return this._labels;
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
      response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${code}` } });
    } catch (err) {
      throw new Error(`Relais injoignable (${err.message}) : vérifier l'adresse, et que le site y est autorisé (ALLOWED_ORIGINS).`);
    }
    if (response.status === 401) throw new Error('Relais joignable, mais code administrateur refusé.');
    if (!response.ok) throw new Error(`Relais joignable, réponse inattendue (HTTP ${response.status}).`);
    return 'Relais joignable, code administrateur accepté.';
  },

  /**
   * Enregistre l'ensemble des définitions dans le dépôt, via le relais.
   * @param {Object} labels - { clé: { r1, a1, r2?, a2? } } (étiquettes SANS définition : absentes)
   * @param {string} adminCode - code administrateur attendu par le relais
   * @returns {Promise<void>} rejetée avec un Error au message lisible en cas d'échec
   */
  async save(labels, adminCode) {
    if (!this.isSaveConfigured()) {
      throw new Error("Enregistrement partagé non configuré : renseigner peLabelAnchorsRelayUrl (config.js, voir relay/README.md).");
    }
    let response;
    try {
      response = await fetch(AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminCode}` },
        body: JSON.stringify({ version: 1, labels }),
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
      throw new Error(response.status === 401 ? 'Code administrateur refusé.' : `Enregistrement refusé (HTTP ${response.status}) ${detail}`.trim());
    }
    this._labels = JSON.parse(JSON.stringify(labels));
  },
};
