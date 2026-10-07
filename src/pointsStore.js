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
 * Les coordonnées x/y sont stockées en Lambert (même CRS que Metro.json),
 * en pleine précision (aucun arrondi).
 */
const AMGT4CEM_PointsStore = {
  _read() {
    try {
      const raw = localStorage.getItem(AMGT4CEM_CONFIG.pointsStorageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('[AMGT4CEM] Micro-DB illisible, réinitialisation.', err);
      return [];
    }
  },

  _write(points) {
    localStorage.setItem(AMGT4CEM_CONFIG.pointsStorageKey, JSON.stringify(points));
  },

  async getAll() {
    return this._read();
  },

  async getById(id) {
    return this._read().find((p) => p.id === id) || null;
  },

  /**
   * @param {{ type: string, label: string, x: number, y: number, properties?: object }} data
   * @returns {Promise<object>} le point créé (avec id généré)
   */
  async add(data) {
    const points = this._read();
    const point = {
      id: (crypto.randomUUID ? crypto.randomUUID() : `pt-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      type: data.type,
      label: data.label,
      x: data.x,
      y: data.y,
      properties: data.properties || {},
      createdAt: new Date().toISOString(),
    };
    points.push(point);
    this._write(points);
    return point;
  },

  /**
   * @param {string} id
   * @param {object} patch - champs à mettre à jour (ex: { x, y } après déplacement)
   */
  async update(id, patch) {
    const points = this._read();
    const idx = points.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    points[idx] = { ...points[idx], ...patch, updatedAt: new Date().toISOString() };
    this._write(points);
    return points[idx];
  },

  async remove(id) {
    const points = this._read().filter((p) => p.id !== id);
    this._write(points);
  },
};
