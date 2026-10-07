/**
 * Géométries pérennes + référentiel, jointure par `id`.
 *
 *  - data/shapefile/polygones.shp et lignes.shp : géométries Lambert 72 éditées dans AutoCAD, chaque
 *    entité ne portant que le champ `id` (identifiant opaque « G » + 6 chiffres, voir README) ;
 *  - data/shapefile/identifiants.json : règle de l'id et compteur `prochain_id` ;
 *  - référentiel réparti par domaine métier, chaque dossier portant celui des géométries qui le
 *    concernent : data/metro/ (stations, tunnels, tronçons) et data/plans-patrimoine/ (planches), avec
 *    polygones.json (lignes.json pour les tronçons) et vocabulaires.json. Tout ce qui complète une
 *    géométrie y est indexé par `id` (genre, noms, références de planche, identifiants externes...).
 *
 * lignes.shp / lignes.json peuvent être absents (aucun tronçon dessiné pour l'instant) : toléré ;
 * lignes.shp n'est lu que si un référentiel de lignes décrit au moins une ligne.
 *
 * load() renvoie les entités jointes { geometry, properties: { id, source, ...entrée du référentiel } }.
 * Les contrôles (mêmes règles que tools/verifier-donnees.py) sont NON BLOQUANTS : avertissements en
 * console, jamais d'exception pour une incohérence de données. Une géométrie sans entrée de référentiel
 * est gardée mais sans `genre` (aucune couche ne l'affiche) ; une entrée sans géométrie est ignorée ;
 * un `id` décrit dans deux dossiers est signalé (la première entrée est gardée).
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
    const [refPolygones, refLignes, vocabulaires, identifiants] = await Promise.all([
      this._fetchEntites(cfg.polygonesJson, true),
      this._fetchEntites(cfg.lignesJson, false),
      this._fetchVocabulaires(cfg.vocabulairesJson),
      this._fetchJson(cfg.identifiantsJson, false),
    ]);
    const polygones = await AMGT4CEM_ShpLoader.load(cfg.polygonesShp);
    // lignes.shp n'est demandé que si le référentiel décrit au moins une ligne : tant qu'aucun tronçon
    // n'est dessiné, le fichier n'existe pas (et une requête 404 inutile salirait la console).
    const lignes = Object.keys(refLignes.entites).length
      ? await AMGT4CEM_ShpLoader.load(cfg.lignesShp, { optional: true })
      : { type: 'FeatureCollection', features: [] };
    this.vocabulaires = vocabulaires;
    this.identifiants = identifiants || {};

    const avertissements = [...refPolygones.avertissements, ...refLignes.avertissements];
    const sources = [
      { nom: 'polygones', geo: polygones, entrees: refPolygones.entites },
      { nom: 'lignes', geo: lignes, entrees: refLignes.entites },
    ];
    const vus = new Map(); // id -> fichier déjà rencontré (unicité sur les deux fichiers à la fois)
    const features = [];

    for (const { nom, geo, entrees } of sources) {
      const utilisees = new Set();
      for (const f of geo.features) {
        const id = f.properties.id;
        if (!f.geometry) continue;
        if (!id) {
          avertissements.push(`${nom}.shp : entité sans id, ignorée`);
          continue;
        }
        if (vus.has(id)) {
          avertissements.push(`id « ${id} » en double (${vus.get(id)} et ${nom}) : la première entité est conservée`);
          continue;
        }
        vus.set(id, nom);
        const entree = entrees[id];
        utilisees.add(id);
        if (!entree) avertissements.push(`${nom} : géométrie « ${id} » sans entrée de référentiel (non affichée)`);
        features.push({ type: 'Feature', geometry: f.geometry, properties: { ...(entree || {}), id, source: nom } });
      }
      for (const [id, e] of Object.entries(entrees)) {
        if (!utilisees.has(id)) avertissements.push(`${nom} : entrée de référentiel « ${id} » sans géométrie`);
        if (this.vocabulaires.genres && !this.vocabulaires.genres[e.genre]) {
          avertissements.push(`${nom} : entrée « ${id} » : genre « ${e.genre} » absent des vocabulaires`);
        }
      }
    }
    // prochain_id : compteur unique (identifiants.json), toujours au-delà du plus grand id utilisé.
    const plusGrand = Math.max(0, ...[...vus.keys()].filter((id) => /^G\d{6}$/.test(id)).map((id) => Number(id.slice(1))));
    const prochain = this.identifiants.prochain_id;
    if (!Number.isInteger(prochain)) avertissements.push('identifiants.json : prochain_id absent');
    else if (prochain <= plusGrand) avertissements.push(`prochain_id (${prochain}) doit être supérieur au plus grand id utilisé (G${String(plusGrand).padStart(6, '0')})`);

    for (const a of avertissements) console.warn('[AMGT4CEM] Données :', a);
    this.features = features;
    return features;
  },

  /** Référentiels de plusieurs dossiers fusionnés : { entites, avertissements } (un `id` décrit deux fois : signalé, le premier gagne). */
  async _fetchEntites(urls, required) {
    const entites = {};
    const avertissements = [];
    const fichiers = await Promise.all(urls.map((url) => this._fetchJson(url, required)));
    fichiers.forEach((ref, i) => {
      for (const [id, e] of Object.entries((ref && ref.entites) || {})) {
        if (entites[id]) avertissements.push(`id « ${id} » décrit dans deux référentiels (${urls[i]} et un précédent) : le premier est gardé`);
        else entites[id] = e;
      }
    });
    return { entites, avertissements };
  },

  /** Vocabulaires de plusieurs dossiers fusionnés (genres réunis ; niveaux : listes concaténées). */
  async _fetchVocabulaires(urls) {
    const out = { genres: {} };
    for (const v of await Promise.all(urls.map((url) => this._fetchJson(url, false)))) {
      if (v) Object.assign(out.genres, v.genres || {});
    }
    return out;
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
