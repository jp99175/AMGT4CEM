/**
 * Géométries pérennes + référentiel, jointure par `id`.
 *
 *  - data/geometries/polygones.shp et lignes.shp : géométries Lambert 72 éditées dans AutoCAD, chaque
 *    entité ne portant que le champ `id` (identifiant opaque « G » + 6 chiffres, voir README) ;
 *  - data/referentiel/polygones.json et lignes.json : tout ce qui complète une géométrie (genre, noms,
 *    niveau, références de planche, identifiants externes...), indexé par `id` ;
 *  - data/referentiel/vocabulaires.json : genres et valeurs admises.
 *
 * lignes.shp / lignes.json peuvent être absents (aucun tronçon dessiné pour l'instant) : toléré ;
 * lignes.shp n'est lu que si lignes.json décrit au moins une ligne.
 *
 * load() renvoie les entités jointes { geometry, properties: { id, source, ...entrée du référentiel } }.
 * Les contrôles (mêmes règles que tools/verifier-donnees.py) sont NON BLOQUANTS : avertissements en
 * console, jamais d'exception pour une incohérence de données. Une géométrie sans entrée de référentiel
 * est gardée mais sans `genre` (aucune couche ne l'affiche) ; une entrée sans géométrie est ignorée.
 * Seule l'impossibilité totale de lire polygones.shp rejette la promesse (message affiché par app.js).
 */
const AMGT4CEM_Referentiel = {
  features: [],
  vocabulaires: null,

  /** Chargement unique (mémorisé) : appelable depuis plusieurs modules (app.js, plugin d'édition). */
  load() {
    if (!this._promise) this._promise = this._load();
    return this._promise;
  },

  async _load() {
    const cfg = AMGT4CEM_CONFIG.donnees;
    const [refPolygones, refLignes, vocabulaires] = await Promise.all([
      this._fetchJson(cfg.polygonesJson, true),
      this._fetchJson(cfg.lignesJson, false),
      this._fetchJson(cfg.vocabulairesJson, false),
    ]);
    const polygones = await AMGT4CEM_ShpLoader.load(cfg.polygonesShp);
    // lignes.shp n'est demandé que si le référentiel décrit au moins une ligne : tant qu'aucun tronçon
    // n'est dessiné, le fichier n'existe pas (et une requête 404 inutile salirait la console).
    const lignes = refLignes && Object.keys(refLignes.entites || {}).length
      ? await AMGT4CEM_ShpLoader.load(cfg.lignesShp, { optional: true })
      : { type: 'FeatureCollection', features: [] };
    this.vocabulaires = vocabulaires || {};

    const sources = [
      { nom: 'polygones', geo: polygones, ref: refPolygones },
      { nom: 'lignes', geo: lignes, ref: refLignes },
    ];
    const vus = new Map(); // id -> fichier déjà rencontré (unicité sur les deux fichiers à la fois)
    const features = [];
    const avertissements = [];

    for (const { nom, geo, ref } of sources) {
      const entrees = (ref && ref.entites) || {};
      if (geo.features.length && !ref) avertissements.push(`referentiel/${nom}.json absent : aucune entrée pour ${geo.features.length} géométries`);
      const utilisees = new Set();
      for (const f of geo.features) {
        const id = f.properties.id;
        if (!f.geometry) continue;
        if (!id) {
          avertissements.push(`${nom}.shp : entité sans id, ignorée`);
          continue;
        }
        if (vus.has(id)) avertissements.push(`id « ${id} » en double (${vus.get(id)} et ${nom}) : la première entité est conservée`);
        if (vus.has(id)) continue;
        vus.set(id, nom);
        const entree = entrees[id];
        utilisees.add(id);
        if (!entree) avertissements.push(`${nom} : géométrie « ${id} » sans entrée de référentiel (non affichée)`);
        features.push({ type: 'Feature', geometry: f.geometry, properties: { ...(entree || {}), id, source: nom } });
      }
      for (const id of Object.keys(entrees)) {
        if (!utilisees.has(id)) avertissements.push(`${nom} : entrée de référentiel « ${id} » sans géométrie`);
      }
      const genres = (this.vocabulaires.genres) || {};
      if (this.vocabulaires.genres) {
        for (const [id, e] of Object.entries(entrees)) {
          if (!genres[e.genre]) avertissements.push(`${nom} : entrée « ${id} » : genre « ${e.genre} » absent de vocabulaires.json`);
        }
      }
    }
    const suivants = [refPolygones, refLignes].filter(Boolean).map((r) => r.prochain_id);
    if (new Set(suivants).size > 1) avertissements.push(`prochain_id différent entre polygones.json et lignes.json : ${suivants.join(' / ')}`);

    for (const a of avertissements) console.warn('[AMGT4CEM] Données :', a);
    this.features = features;
    return features;
  },

  /** JSON du référentiel ; absent (404) ou illisible = null (avertissement), sauf `required`, qui rejette. */
  async _fetchJson(url, required) {
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (response.ok) return await response.json();
      if (required || response.status !== 404) throw new Error(`HTTP ${response.status} (${url})`);
    } catch (err) {
      if (required) throw err;
      console.warn(`[AMGT4CEM] Référentiel illisible (${url}) :`, err);
    }
    return null;
  },

  /** Entités jointes d'un genre ('station', 'tunnel', 'planche'...). */
  byGenre(genre) {
    return this.features.filter((f) => f.properties.genre === genre);
  },
};
