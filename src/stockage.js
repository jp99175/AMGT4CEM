/**
 * Source des données du réseau : le dépôt (fichiers publiés avec le site) ou R2 (serveur de dépôt, workers/depot/geometries.js).
 *
 * Lot A de l'écriture du shapefile (18/11/2026). Un interrupteur commun à tous (droit « plans », Réglages > Plans >
 * « Stockage des données ») décide de la source. Par défaut, et pour toute personne non connectée : le dépôt, comme avant.
 * Avec la source R2, ce module lit R2 pour les fichiers qu'il connaît (shapefile des polygones, attributs, compteur P) et,
 * si R2 ne répond pas ou refuse, retombe sur le dépôt sans rien casser.
 *
 *   AMGT4CEM_Stockage.fetch(url, init)   comme fetch(), source-aware
 *   AMGT4CEM_Stockage.lireJson(url)      lecture JSON sans cache, source-aware
 *   AMGT4CEM_Stockage.source()           'depot' | 'r2' (dernière valeur connue du serveur, gardée sur l'appareil)
 *   AMGT4CEM_Stockage.ecrireAttributs(nom, changements)   lot B : écrit des lignes d'attributs dans R2 (droit « attributs »)
 *   AMGT4CEM_Stockage.actualiser()       relit l'état du serveur (source, versions) ; renvoie l'état ou null
 *
 * Lot B : avec la source R2, les écrans d'attributs écrivent dans R2 (ecrireAttributs) et non plus dans le dépôt par le relais.
 * L'écriture du shapefile dans R2 viendra avec le lot C.
 */
const AMGT4CEM_Stockage = {
  CLE: 'amgt4cem.stockage.source.v1',
  // Fichiers du dépôt connus de R2 : adresse relative -> route du serveur de dépôt.
  CARTE: [
    { motif: /^\.\/data\/shapefile\/polygones\.(shp|shx|dbf|prj|cpg)$/, route: (m) => `/geometries/shapefile/polygones/${m[1]}` },
    { motif: /^\.\/data\/shapefile-essai\/essai\.(shp|shx|dbf|prj|cpg)$/, route: (m) => `/geometries/shapefile/essai/${m[1]}` }, // couche d'essai (R2 seulement : rien dans le dépôt)
    { motif: /^\.\/data\/ditp-diov\/polygones\.json$/, route: () => '/attributs/ditp-diov' },
    { motif: /^\.\/data\/plans-patrimoine\/polygones\.json$/, route: () => '/attributs/plans-patrimoine' },
    { motif: /^\.\/data\/shapefile\/identifiants\.json$/, route: () => '/geometries/identifiants' },
    { motif: /^\.\/data\/lieux\/lieux\.json$/, route: () => '/geometries/lieux' },
  ],
  _etat: null,

  _serveur() {
    return (typeof AMGT4CEM_Auth !== 'undefined' && AMGT4CEM_Auth.configured && AMGT4CEM_Auth.configured()) ? AMGT4CEM_Auth.serverUrl : '';
  },

  _session() {
    return (typeof AMGT4CEM_Auth !== 'undefined' && AMGT4CEM_Auth.session) ? AMGT4CEM_Auth.session() : null;
  },

  /** Dernière source connue ; 'depot' sans session (visiteur) ou si rien n'est connu. */
  source() {
    if (!this._session() || !this._serveur()) return 'depot';
    try { return localStorage.getItem(this.CLE) === 'r2' ? 'r2' : 'depot'; } catch (err) { return 'depot'; }
  },

  _noter(source) {
    try { localStorage.setItem(this.CLE, source === 'r2' ? 'r2' : 'depot'); } catch (err) { /* sans mémoire locale : le dépôt reste la source */ }
  },

  /** État du serveur : source, version courante du shapefile, nombre d'objets et d'entrées, compteur P. null si injoignable. */
  async actualiser() {
    if (!this._session() || !this._serveur()) return null;
    try {
      const e = await AMGT4CEM_Auth.call('/geometries/stockage');
      this._etat = e;
      this._noter(e.source);
      return e;
    } catch (err) {
      console.warn('[AMGT4CEM] État du stockage illisible :', err.message);
      return null;
    }
  },

  /** Interrupteur de source (droit « plans »). */
  async changerSource(source) {
    const e = await AMGT4CEM_Auth.call('/geometries/source', { method: 'POST', body: { source } });
    this._etat = e;
    this._noter(e.source);
    return e;
  },

  _route(url) {
    for (const c of this.CARTE) {
      const m = c.motif.exec(url);
      if (m) return c.route(m);
    }
    return null;
  },

  /** Comme fetch(url, init), en lisant R2 quand la source est R2 et que le fichier y est ; repli sur le dépôt sinon. */
  async fetch(url, init) {
    const route = this.source() === 'r2' ? this._route(String(url).split('?')[0]) : null;
    if (route) {
      try {
        const s = this._session();
        const r = await fetch(this._serveur() + route, { cache: 'no-cache', headers: { Authorization: `Bearer ${s.jeton}` } });
        if (r.ok) { r.depuisR2 = true; return r; }
        console.warn(`[AMGT4CEM] R2 a refusé ${route} (HTTP ${r.status}) : lecture du dépôt à la place.`);
      } catch (err) {
        console.warn(`[AMGT4CEM] R2 injoignable pour ${route} : lecture du dépôt à la place.`);
      }
    }
    return fetch(url, init);
  },

  /** Vrai si la source est R2 ET que les zones dessinées y ont été chargées (sinon elles restent lues et écrites dans le dépôt, par le relais). */
  lieuxDansR2() {
    return this.source() === 'r2' && !!(this._etat && this._etat.lieux);
  },

  /** Zones dessinées : { data, etag, r2 }. `etag` (version de départ pour ecrireLieux) n'existe que si la lecture vient de R2. */
  async lireLieux() {
    if (this.source() === 'r2' && !this._etat) await this.actualiser();
    const r = await this.fetch(`./data/lieux/lieux.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Lecture des zones impossible (HTTP ${r.status}).`);
    return { data: await r.json(), etag: r.depuisR2 ? r.headers.get('ETag') : null, r2: !!r.depuisR2 };
  },

  /** Écrit toutes les zones dans R2 (droit « plans ») ; `etagBase` = version lue. Refus 409 si quelqu'un a écrit entre-temps. Renvoie la nouvelle version (etag). */
  async ecrireLieux(lieux, etagBase) {
    const e = await AMGT4CEM_Auth.call('/geometries/lieux', { method: 'POST', body: { lieux, etagBase } });
    this._etat = e;
    return e.lieux && e.lieux.etag;
  },

  /** Lot C : applique des déplacements (zones vers shapefile, objets retirés vers les zones). `apercu: true` : contrôle seulement. */
  async appliquer(couche, corps) {
    try {
      return await AMGT4CEM_Auth.call(`/geometries/shapefile/${couche}/appliquer`, { method: 'POST', body: corps });
    } catch (err) {
      if (err.data && Array.isArray(err.data.erreurs)) err.message = `${err.message}\n${err.data.erreurs.slice(0, 8).join('\n')}`;
      throw err;
    }
  },

  /** Lecture JSON sans cache (comme les écrans Attributs et Intégrer au shapefile), source-aware. */
  async lireJson(url) {
    const r = await this.fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Lecture impossible (${url}, HTTP ${r.status}).`);
    return r.json();
  },

  /**
   * Lot B : écrit des lignes d'attributs dans R2. `nom` : 'ditp-diov' ou 'plans-patrimoine' ; `changements` : [{ id, avant, apres }]
   * (voir AMGT4CEM_AttributsLogique.changement). Refus du serveur en cas de conflit : l'erreur porte la liste des lignes en cause.
   */
  async ecrireAttributs(nom, changements) {
    try {
      return await AMGT4CEM_Auth.call(`/attributs/${nom}/modifier`, { method: 'POST', body: { changements } });
    } catch (err) {
      if (err.status === 409 && err.data && Array.isArray(err.data.conflits)) {
        const liste = err.data.conflits.slice(0, 8).map((c) => `${c.id} : ${c.motif}.`).join('\n');
        err.message = `${err.message}\n${liste}`;
      }
      throw err;
    }
  },

  /** Supprime des entrées d'attributs sans contour dans le vrai shapefile (R2 seulement ; le serveur refuse si un contour existe encore). */
  async supprimerAttributs(nom, ids) {
    try {
      return await AMGT4CEM_Auth.call(`/attributs/${nom}/supprimer`, { method: 'POST', body: { ids } });
    } catch (err) {
      if (err.status === 409 && err.data && Array.isArray(err.data.conflits)) err.message = `${err.message}\n${err.data.conflits.slice(0, 8).map((c) => `${c.id} : ${c.motif}.`).join('\n')}`;
      throw err;
    }
  },
};
window.AMGT4CEM_Stockage = AMGT4CEM_Stockage;

// Au chargement, puis à chaque connexion ou déconnexion : on relit la source pour la prochaine lecture.
if (typeof AMGT4CEM_Auth !== 'undefined' && AMGT4CEM_Auth.onChange) AMGT4CEM_Auth.onChange(() => { AMGT4CEM_Stockage.actualiser(); });
setTimeout(() => { AMGT4CEM_Stockage.actualiser(); }, 0);
