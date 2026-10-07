/**
 * Lecteur Shapefile (.shp + .dbf) minimal, écrit à la main — aucune
 * bibliothèque tierce (pas de "npm install", pas de droits admin nécessaires).
 *
 * Les géométries pérennes de l'application sont deux shapefiles Lambert 72
 * (data/shapefile/polygones.* et lignes.*), éditables dans AutoCAD, dont chaque
 * entité ne porte qu'UN champ : `id` (identifiant stable, voir README). Tout le
 * reste (noms, genre, niveau...) vit dans le référentiel JSON (data/metro/, data/plans-patrimoine/),
 * rattaché par cet `id` (voir referentiel.js).
 *
 * Types de forme pris en charge, coordonnées 2D (pas de Z/M) :
 *  - Polygon  (5) : un ou plusieurs anneaux -> { type: 'Polygon', coordinates: [anneau, ...] } ;
 *  - PolyLine (3) : une ou plusieurs parties -> LineString (une partie) ou MultiLineString.
 * Seul le champ `id` du .dbf est lu ; les autres champs éventuels sont ignorés.
 * Les coordonnées restent dans le CRS natif du fichier (Lambert 72, EPSG:31370) :
 * AUCUNE reprojection ici — AMGT4CEM_CRS.lambertToLatLng (crs.js) s'en charge à l'affichage.
 *
 * Formats bruts (spécifications publiques) :
 *  - .shp (ESRI Shapefile) : en-tête de 100 octets (quelques champs en gros-boutien),
 *    puis des enregistrements en petit-boutien ;
 *  - .dbf (dBASE III+) : en-tête + descripteurs de champs de longueur fixe, puis des
 *    enregistrements de longueur fixe. L'`id` est ASCII : l'encodage n'a pas d'importance.
 */
const AMGT4CEM_ShpLoader = {
  /**
   * @param {string} baseUrl - chemin sans extension (ex: './data/shapefile/polygones')
   * @param {{ optional?: boolean }} [options] - optional : fichier absent (404) = collection vide, sans erreur
   * @returns {Promise<{type: 'FeatureCollection', features: object[]}>} entités { geometry, properties: { id } }
   */
  async load(baseUrl, options = {}) {
    let shpBuf;
    let dbfBuf;
    try {
      [shpBuf, dbfBuf] = await Promise.all([
        this._fetchArrayBuffer(`${baseUrl}.shp`),
        this._fetchArrayBuffer(`${baseUrl}.dbf`),
      ]);
    } catch (err) {
      if (options.optional && err.status === 404) return { type: 'FeatureCollection', features: [] };
      throw err;
    }
    const geometries = this._parseShp(shpBuf);
    const ids = this._parseDbfIds(dbfBuf);
    if (geometries.length !== ids.length) {
      throw new Error(`Nombre d'entités incohérent entre .shp (${geometries.length}) et .dbf (${ids.length}) : ${baseUrl}`);
    }
    return {
      type: 'FeatureCollection',
      features: geometries.map((geometry, i) => ({ type: 'Feature', geometry, properties: { id: ids[i] } })),
    };
  },

  async _fetchArrayBuffer(url) {
    // no-cache : revalide auprès du serveur (GitHub Pages met les fichiers en cache ~10 min), comme le
    // référentiel JSON — sinon, juste après un export, géométries et référentiel pourraient ne pas correspondre.
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} (${url})`);
      err.status = response.status;
      throw err;
    }
    return response.arrayBuffer();
  },

  /** Lit toutes les géométries d'un .shp. Types pris en charge : Polygon (5) et PolyLine (3). */
  _parseShp(buffer) {
    const view = new DataView(buffer);
    const geometries = [];
    let offset = 100; // fin de l'en-tête de fichier (100 octets fixes)
    while (offset + 8 <= buffer.byteLength) {
      // En-tête d'enregistrement (8 octets, gros-boutien) : numéro (ignoré),
      // longueur du contenu en mots de 16 bits (donc x2 pour des octets).
      const contentLengthWords = view.getInt32(offset + 4, false);
      const recordStart = offset + 8;
      const shapeType = view.getInt32(recordStart, true);

      if (shapeType === 0) {
        geometries.push(null); // forme nulle (enregistrement vide)
      } else if (shapeType === 5 || shapeType === 3) {
        // Polygon / PolyLine : boîte englobante (4 doubles = 32 octets, ignorée),
        // NumParts, NumPoints, Parts[NumParts], Points[NumPoints] (X,Y).
        let p = recordStart + 4 + 32;
        const numParts = view.getInt32(p, true); p += 4;
        const numPoints = view.getInt32(p, true); p += 4;
        const partStarts = [];
        for (let i = 0; i < numParts; i++) {
          partStarts.push(view.getInt32(p, true));
          p += 4;
        }
        const points = [];
        for (let i = 0; i < numPoints; i++) {
          const x = view.getFloat64(p, true); p += 8;
          const y = view.getFloat64(p, true); p += 8;
          points.push([x, y]);
        }
        const parts = partStarts.map((start, i) => {
          const end = i + 1 < partStarts.length ? partStarts[i + 1] : numPoints;
          return points.slice(start, end);
        });
        if (shapeType === 5) geometries.push({ type: 'Polygon', coordinates: parts });
        else if (parts.length === 1) geometries.push({ type: 'LineString', coordinates: parts[0] });
        else geometries.push({ type: 'MultiLineString', coordinates: parts });
      } else {
        throw new Error(`Type de forme Shapefile non pris en charge : ${shapeType} (seuls Polygon/5 et PolyLine/3 sont gérés par cette app)`);
      }

      offset = recordStart + contentLengthWords * 2;
    }
    return geometries;
  },

  /** Lit le champ `id` de tous les enregistrements d'un .dbf, dans l'ordre du fichier (même ordre que le .shp). */
  _parseDbfIds(buffer) {
    const view = new DataView(buffer);
    const numRecords = view.getUint32(4, true);
    const headerLength = view.getUint16(8, true);
    const recordLength = view.getUint16(10, true);

    // Descripteurs de champs : blocs de 32 octets, jusqu'au terminateur 0x0D.
    let idOffset = -1;
    let idLength = 0;
    let fieldOffset = 1; // 1er octet de chaque enregistrement : marqueur de suppression
    let p = 32;
    while (view.getUint8(p) !== 0x0d) {
      const nameBytes = new Uint8Array(buffer, p, 11);
      let name = '';
      for (let i = 0; i < 11 && nameBytes[i] !== 0; i++) name += String.fromCharCode(nameBytes[i]);
      const length = view.getUint8(p + 16);
      if (name.toLowerCase() === 'id') {
        idOffset = fieldOffset;
        idLength = length;
      }
      fieldOffset += length;
      p += 32;
    }
    if (idOffset < 0) throw new Error('Champ `id` absent du .dbf');

    const decoder = new TextDecoder('iso-8859-1');
    const ids = [];
    for (let r = 0; r < numRecords; r++) {
      const start = headerLength + r * recordLength + idOffset;
      ids.push(decoder.decode(new Uint8Array(buffer, start, idLength)).trim());
    }
    return ids;
  },
};
