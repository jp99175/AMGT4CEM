/**
 * Micro-base de données métier (couche d'accès aux données).
 *
 * Stockage : fichier `data/points.json` de ce dépôt GitHub, lu/écrit via
 * l'API Contents de GitHub (https://docs.github.com/rest/repos/contents).
 * Cette couche reste isolée du reste de l'application (même interface que la
 * V1 localStorage, juste devenue asynchrone) : la cartographie et
 * l'interface n'ont aucune dépendance directe sur le mécanisme de stockage,
 * qui pourra être remplacé par un vrai backend plus tard sans les toucher.
 *
 * Schéma volontairement ouvert : un point possède un minimum de champs
 * (id, type, label, x, y) et un sac libre `properties` pour tout champ
 * métier additionnel défini plus tard, sans migration de schéma.
 *
 * Les coordonnées x/y sont stockées en Lambert (même CRS que Metro.json),
 * en pleine précision (aucun arrondi).
 *
 * Concurrence : deux appareils peuvent écrire presque en même temps. Chaque
 * écriture relit d'abord la dernière version du fichier (et son `sha` git) ;
 * si l'écriture est refusée entre-temps (409, quelqu'un d'autre a écrit en
 * premier), on relit et on réessaie (jusqu'à 3 fois) plutôt que d'écraser
 * silencieusement les données de l'autre appareil.
 */
const AMGT4CEM_PointsStore = {
  _cachedSha: null,

  _apiUrl() {
    const { owner, repo, path, branch } = AMGT4CEM_CONFIG.githubStore;
    return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  },

  /**
   * Toujours sans jeton : l'API Contents de GitHub ne répond pas correctement
   * au préflight CORS (OPTIONS) dès qu'une requête porte un en-tête
   * Authorization — le navigateur bloque alors la requête avant même qu'elle
   * parte (vérifié en conditions réelles, reproductible avec n'importe quel
   * jeton, y compris invalide). Envoyer le jeton ici casserait donc aussi la
   * lecture. Voir README section 6 : les écritures ne peuvent de toute façon
   * pas passer par un appel direct navigateur → api.github.com, pour la même
   * raison (elles nécessitent Authorization + Content-Type: application/json,
   * deux en-têtes qui déclenchent un préflight que GitHub ne gère pas ici).
   */
  _headers() {
    return { Accept: 'application/vnd.github+json' };
  },

  /**
   * Écrire (ajouter/modifier/supprimer un point) nécessite d'envoyer un jeton
   * GitHub — mais dès qu'une requête porte un en-tête Authorization (ou
   * Content-Type: application/json, également nécessaire ici), le navigateur
   * déclenche un préflight CORS que l'API Contents de GitHub ne gère pas :
   * la requête est bloquée avant même de partir, quel que soit le jeton.
   * Vérifié en conditions réelles (reproductible avec un jeton invalide,
   * donc indépendant de sa validité). Un appel direct navigateur →
   * api.github.com ne peut donc pas écrire, point final — voir README
   * section 6 pour la solution (petit relais serveur).
   */
  _writeNotPossible() {
    throw new Error(
      "Écriture impossible : l'API GitHub ne peut pas être appelée en écriture " +
      "directement depuis un navigateur (limitation CORS de l'API GitHub elle-même, " +
      "pas un problème de jeton). Voir README section \"Micro-base de données\"."
    );
  },

  /**
   * @returns {Promise<{ points: object[], sha: string|null }>}
   */
  async _fetchFile() {
    const response = await fetch(this._apiUrl(), { headers: this._headers() });
    if (response.status === 404) {
      return { points: [], sha: null }; // fichier pas encore créé
    }
    if (!response.ok) {
      throw new Error(`Lecture de la micro-base impossible (HTTP ${response.status}).`);
    }
    const body = await response.json();
    const points = JSON.parse(this._base64ToUtf8(body.content));
    return { points, sha: body.sha };
  },

  async _commitFile(points, sha, message) {
    const { owner, repo, path, branch } = AMGT4CEM_CONFIG.githubStore;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const payload = {
      message,
      branch,
      content: this._utf8ToBase64(JSON.stringify(points, null, 2)),
    };
    if (sha) payload.sha = sha;

    const response = await fetch(url, {
      method: 'PUT',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status === 409) {
      const err = new Error('Conflit : la micro-base a été modifiée entre-temps par un autre appareil.');
      err.conflict = true;
      throw err;
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Écriture dans la micro-base impossible (HTTP ${response.status}). ${detail}`);
    }
    const body = await response.json();
    return body.content.sha;
  },

  /**
   * Relit la dernière version, applique `mutate(points)` (qui modifie le
   * tableau en place et renvoie la valeur à renvoyer à l'appelant), commit le
   * résultat. Réessaie en cas de conflit d'écriture concurrente.
   */
  async _mutate(message, mutate) {
    this._writeNotPossible();
    const maxAttempts = 3;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { points, sha } = await this._fetchFile();
      const result = mutate(points);
      try {
        this._cachedSha = await this._commitFile(points, sha, message);
        return result;
      } catch (err) {
        lastErr = err;
        if (!err.conflict) throw err;
        // conflit : on boucle, on relit la dernière version et on réessaie
      }
    }
    throw lastErr;
  },

  async getAll() {
    const { points } = await this._fetchFile();
    return points;
  },

  async getById(id) {
    const points = await this.getAll();
    return points.find((p) => p.id === id) || null;
  },

  /**
   * @param {{ type: string, label: string, x: number, y: number, properties?: object }} data
   * @returns {Promise<object>} le point créé (avec id généré)
   */
  async add(data) {
    const point = {
      id: (crypto.randomUUID ? crypto.randomUUID() : `pt-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      type: data.type,
      label: data.label,
      x: data.x,
      y: data.y,
      properties: data.properties || {},
      createdAt: new Date().toISOString(),
    };
    return this._mutate(`Ajout du point « ${data.label} »`, (points) => {
      points.push(point);
      return point;
    });
  },

  /**
   * @param {string} id
   * @param {object} patch - champs à mettre à jour (ex: { x, y } après déplacement)
   */
  async update(id, patch) {
    return this._mutate(`Modification du point ${id}`, (points) => {
      const idx = points.findIndex((p) => p.id === id);
      if (idx === -1) return null;
      points[idx] = { ...points[idx], ...patch, updatedAt: new Date().toISOString() };
      return points[idx];
    });
  },

  async remove(id) {
    return this._mutate(`Suppression du point ${id}`, (points) => {
      const idx = points.findIndex((p) => p.id === id);
      if (idx !== -1) points.splice(idx, 1);
    });
  },

  _utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  },

  _base64ToUtf8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  },
};
