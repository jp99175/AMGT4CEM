/**
 * Lecteur Shapefile (.shp + .dbf) minimal, écrit à la main — aucune
 * bibliothèque tierce (pas de "npm install", pas de droits admin
 * nécessaires : ce fichier est vendored comme le reste de vendor/*.js).
 *
 * Pourquoi pas GeoJSON ni GeoPackage comme donnée de référence : AutoCAD
 * Civil 3D (l'outil utilisé pour adapter les plans) n'édite facilement ni
 * l'un ni l'autre, mais exporte nativement du Shapefile (Map 3D intégré,
 * sans plugin). Le Shapefile devient donc le format de base : les mises à
 * jour se font dans Civil 3D, l'export (Metro_export_SHP/Metro.shp/.dbf/
 * .prj/...) remplace les fichiers du dépôt, et cette app les lit
 * directement, sans étape de conversion externe (QGIS, GDAL...).
 *
 * Ne gère QUE le sous-ensemble nécessaire à Metro.shp, MetroInfo.shp et
 * MetroLabels.shp : type de forme Polygon (code 5, un ou plusieurs anneaux
 * par entité — MetroInfo.shp/PE_info combine plusieurs formes disjointes
 * dans un même enregistrement, un triangle par forme) et Point (code 1,
 * MetroLabels.shp — position d'ancrage des textes PE_info/PE_label rendus
 * en HTML, voir metroLayer.js/scaledText.js), coordonnées 2D (pas de Z/M).
 * Les coordonnées lues restent dans le CRS
 * natif du fichier (Lambert72, EPSG:31370 — voir Metro.prj) : AUCUNE
 * reprojection n'est faite ici, exactement comme l'ancien Metro.json.
 * C'est AMGT4CEM_CRS.lambertToLatLng (crs.js), appelé par metroLayer.js,
 * qui s'en charge à l'affichage.
 *
 * Formats bruts (spécifications publiques, non propriétaires) :
 *  - .shp (ESRI Shapefile) : en-tête de fichier de 100 octets (quelques
 *    champs en gros-boutien), puis des enregistrements en petit-boutien —
 *    voir "ESRI Shapefile Technical Description" (livre blanc ESRI).
 *  - .dbf (dBASE III+) : en-tête + descripteurs de champs de longueur fixe,
 *    puis des enregistrements de longueur fixe, tout en petit-boutien.
 *    L'encodage du texte (ISO-8859-1 pour cet export, voir Metro.cst) doit
 *    être précisé explicitement : le .dbf ne l'indique pas lui-même.
 */
const AMGT4CEM_ShpLoader = {
  // Encodage du texte dans le .dbf (voir Metro.cst, le "codepage" associé à
  // cet export AutoCAD). À ajuster ici si un futur export change de codepage.
  _dbfEncoding: 'iso-8859-1',

  /**
   * @param {string} baseUrl - chemin sans extension (ex: './Metro_export_SHP/Metro')
   * @param {(geojson: object) => void} onLoaded
   * @param {(err: Error) => void} onError
   */
  async load(baseUrl, onLoaded, onError) {
    try {
      const [shpBuf, dbfBuf] = await Promise.all([
        this._fetchArrayBuffer(`${baseUrl}.shp`),
        this._fetchArrayBuffer(`${baseUrl}.dbf`),
      ]);
      const geometries = this._parseShp(shpBuf);
      const records = this._parseDbf(dbfBuf);
      if (geometries.length !== records.length) {
        throw new Error(
          `Nombre d'entités incohérent entre .shp (${geometries.length}) et .dbf (${records.length})`
        );
      }
      const features = geometries.map((geometry, i) => ({
        type: 'Feature',
        geometry,
        properties: records[i],
      }));
      onLoaded({ type: 'FeatureCollection', features });
    } catch (err) {
      onError(err);
    }
  },

  async _fetchArrayBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
    return response.arrayBuffer();
  },

  /** Lit toutes les géométries d'un .shp. Types pris en charge : Polygon (5,
   * Metro.shp et MetroInfo.shp) et Point (1, MetroLabels.shp). */
  _parseShp(buffer) {
    const view = new DataView(buffer);
    const geometries = [];
    let offset = 100; // fin de l'en-tête de fichier (100 octets fixes)
    while (offset < buffer.byteLength) {
      // En-tête d'enregistrement (8 octets, gros-boutien) : numéro (ignoré),
      // longueur du contenu en mots de 16 bits (donc x2 pour des octets).
      const contentLengthWords = view.getInt32(offset + 4, false);
      const recordStart = offset + 8;
      const shapeType = view.getInt32(recordStart, true);

      if (shapeType === 0) {
        geometries.push(null); // forme nulle (enregistrement vide)
      } else if (shapeType === 5) {
        // Polygon : boîte englobante (4 doubles = 32 octets, ignorée),
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
        const rings = partStarts.map((start, i) => {
          const end = i + 1 < partStarts.length ? partStarts[i + 1] : numPoints;
          return points.slice(start, end);
        });
        geometries.push({ type: 'Polygon', coordinates: rings });
      } else if (shapeType === 1) {
        // Point : X, Y (2 doubles, pas de bbox ni de parties).
        let p = recordStart + 4;
        const x = view.getFloat64(p, true); p += 8;
        const y = view.getFloat64(p, true);
        geometries.push({ type: 'Point', coordinates: [x, y] });
      } else {
        throw new Error(
          `Type de forme Shapefile non pris en charge : ${shapeType} (seuls Polygon/5 et Point/1 sont gérés par cette app)`
        );
      }

      offset = recordStart + contentLengthWords * 2;
    }
    return geometries;
  },

  /** Lit tous les enregistrements attributaires d'un .dbf, dans l'ordre du
   * fichier (même ordre que les entités du .shp correspondant). */
  _parseDbf(buffer) {
    const view = new DataView(buffer);
    const numRecords = view.getUint32(4, true);
    const headerLength = view.getUint16(8, true);
    const recordLength = view.getUint16(10, true);

    // Descripteurs de champs : blocs de 32 octets, jusqu'au terminateur 0x0D.
    const fields = [];
    let p = 32;
    while (view.getUint8(p) !== 0x0d) {
      const nameBytes = new Uint8Array(buffer, p, 11);
      let name = '';
      for (let i = 0; i < 11 && nameBytes[i] !== 0; i++) name += String.fromCharCode(nameBytes[i]);
      const type = String.fromCharCode(view.getUint8(p + 11));
      const length = view.getUint8(p + 16);
      fields.push({ name, type, length });
      p += 32;
    }

    const decoder = new TextDecoder(this._dbfEncoding);
    const records = [];
    let recOffset = headerLength;
    for (let r = 0; r < numRecords; r++) {
      // 1er octet de chaque enregistrement : marqueur de suppression (0x2A)
      // ou valide (0x20) — ignoré ici, tous les enregistrements sont gardés
      // pour rester alignés avec le .shp (même nombre d'entités).
      let fieldOffset = recOffset + 1;
      const props = {};
      for (const field of fields) {
        const bytes = new Uint8Array(buffer, fieldOffset, field.length);
        const raw = decoder.decode(bytes).trim();
        props[field.name] = field.type === 'N' ? (raw === '' ? null : Number(raw)) : raw;
        fieldOffset += field.length;
      }
      records.push(props);
      recOffset += recordLength;
    }
    return records;
  },
};
