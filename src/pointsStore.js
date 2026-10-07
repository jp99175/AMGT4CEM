/**
 * Micro-base de données métier (couche d'accès aux données).
 *
 * Stockage V1 : localStorage du navigateur (aucun serveur à installer/administrer,
 * adapté à un prototype). Cette couche est volontairement isolée du reste de
 * l'application : le jour où un vrai backend (fichier, API, base de données)
 * sera nécessaire, seul ce module devra être remplacé — la cartographie et
 * l'interface n'ont aucune dépendance directe sur le mécanisme de stockage.
 *
 * Interface volontairement asynchrone (bien que localStorage soit synchrone)
 * pour rester compatible sans modification avec un futur backend réseau —
 * une tentative de stockage partagé via l'API GitHub a été essayée puis
 * abandonnée (voir README section "Micro-base de données" : l'API Contents
 * de GitHub ne supporte pas les requêtes authentifiées depuis un navigateur,
 * limitation CORS de leur côté, pas un problème de configuration).
 *
 * Schéma volontairement ouvert : un point possède un minimum de champs
 * (id, type, label, x, y) et un sac libre `properties` pour tout champ
 * métier additionnel défini plus tard, sans migration de schéma.
 *
 * Deux FLUX, deux clés de stockage distinctes (config.js) :
 *  - STANDARD : points libres, signalements et demandes courants ;
 *  - AMIANTE  : demandes liées à l'amiante, séparées par criticité (elles ne
 *    partagent ni stockage, ni couche, ni fichier de dépôt avec le reste).
 * Le flux d'un point est lu dans `properties.flux` (absent = STANDARD).
 *
 * Les coordonnées x/y sont stockées en Lambert (même CRS que Metro.json),
 * en pleine précision (aucun arrondi).
 */
const AMGT4CEM_PointsStore = {
  _key(flux) {
    return flux === 'AMIANTE'
      ? AMGT4CEM_CONFIG.pointsAmianteStorageKey
      : AMGT4CEM_CONFIG.pointsStorageKey;
  },

  _read(flux) {
    try {
      const raw = localStorage.getItem(this._key(flux));
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('[AMGT4CEM] Micro-DB illisible, réinitialisation.', err);
      return [];
    }
  },

  _write(flux, points) {
    localStorage.setItem(this._key(flux), JSON.stringify(points));
  },

  _fluxOf(point) {
    return point && point.properties && point.properties.flux === 'AMIANTE' ? 'AMIANTE' : 'STANDARD';
  },

  /** Tous les points, flux confondus (chaque point porte son flux dans properties). */
  async getAll() {
    return [...this._read('STANDARD'), ...this._read('AMIANTE')];
  },

  /** Points d'un seul flux ('STANDARD' ou 'AMIANTE'). */
  async getByFlux(flux) {
    return this._read(flux);
  },

  async getById(id) {
    return (await this.getAll()).find((p) => p.id === id) || null;
  },

  /**
   * @param {{ type: string, label: string, x: number, y: number, properties?: object }} data
   * @returns {Promise<object>} le point créé (avec id généré)
   */
  async add(data) {
    const properties = data.properties || {};
    const flux = properties.flux === 'AMIANTE' ? 'AMIANTE' : 'STANDARD';
    const points = this._read(flux);
    const point = {
      id: (crypto.randomUUID ? crypto.randomUUID() : `pt-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      type: data.type,
      label: data.label,
      x: data.x,
      y: data.y,
      properties,
      createdAt: new Date().toISOString(),
    };
    points.push(point);
    this._write(flux, points);
    return point;
  },

  /**
   * @param {string} id
   * @param {object} patch - champs à mettre à jour (ex: { x, y } après déplacement)
   */
  async update(id, patch) {
    for (const flux of ['STANDARD', 'AMIANTE']) {
      const points = this._read(flux);
      const idx = points.findIndex((p) => p.id === id);
      if (idx === -1) continue;
      points[idx] = { ...points[idx], ...patch, updatedAt: new Date().toISOString() };
      this._write(flux, points);
      return points[idx];
    }
    return null;
  },

  async remove(id) {
    for (const flux of ['STANDARD', 'AMIANTE']) {
      const points = this._read(flux);
      const kept = points.filter((p) => p.id !== id);
      if (kept.length !== points.length) this._write(flux, kept);
    }
    if (typeof AMGT4CEM_PiecesStore !== 'undefined') {
      try { await AMGT4CEM_PiecesStore.removeForPoint(id); } catch (err) { console.warn('[AMGT4CEM] Pièces non supprimées :', err); }
    }
  },
};
