/**
 * Photos jointes aux signalements : stockage LOCAL (IndexedDB), en attendant
 * le stockage des pièces (Cloudflare R2, voir le document de conception).
 *
 * Pourquoi IndexedDB et pas localStorage : une photo pèse de quelques centaines
 * de ko à plusieurs Mo ; localStorage est limité à ~5 Mo pour tout le site.
 *
 * Chaque photo est réduite à l'enregistrement (grand côté <= 1600 px, JPEG) ;
 * l'empreinte SHA-256 du fichier d'origine est conservée avec celle du fichier
 * réduit, pour qu'un original retrouvé plus tard puisse toujours être rattaché.
 */
(function () {
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});
const DB_NAME = 'amgt4cem-pieces';

NS.Pieces = {
  maxSide: 2000,
  jpegQuality: 0.85,
  _dbPromise: null,

  _db() {
    if (!this._dbPromise) {
      this._dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore('pieces', { keyPath: 'id' });
          store.createIndex('pointId', 'pointId', { unique: false });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this._dbPromise;
  },

  async _tx(mode, fn) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pieces', mode);
      const result = fn(tx.objectStore('pieces'));
      tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  async sha256(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  },

  /** Réduit une image (grand côté <= maxSide) et la ré-encode en JPEG. */
  async shrink(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, this.maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encodage JPEG impossible'))), 'image/jpeg', this.jpegQuality));
    return { blob, width: w, height: h };
  },

  /**
   * Enregistre une photo pour un point.
   * @returns {Promise<{id:string,taille:number,largeur:number,hauteur:number,sha256:string,sha256Original:string}>}
   */
  async add(pointId, file) {
    const sha256Original = await this.sha256(file);
    const { blob, width, height } = await this.shrink(file);
    const sha256 = await this.sha256(blob);
    const id = crypto.randomUUID ? crypto.randomUUID() : `pc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await this._tx('readwrite', (store) => store.put({ id, pointId, blob, sha256, sha256Original, largeur: width, hauteur: height }));
    return { id, taille: blob.size, largeur: width, hauteur: height, sha256, sha256Original };
  },

  /**
   * Annotations d'une photo : traits (pour les modifier plus tard) + calque PNG transparent (`png`) qui se
   * superpose à la photo. La photo elle-même n'est JAMAIS modifiée. `traits` vide ou null : annotations retirées.
   * @returns {Promise<null|{taille:number,sha256:string}>} description du calque, ou null s'il n'y en a plus
   */
  async setAnnotations(id, traits, png) {
    const record = await this.get(id);
    if (!record) throw new Error('Photo introuvable');
    if (traits && traits.length && png) {
      record.traits = traits;
      record.annot = png;
      record.annotSha256 = await this.sha256(png);
    } else {
      delete record.traits;
      delete record.annot;
      delete record.annotSha256;
    }
    await this._tx('readwrite', (store) => store.put(record));
    return record.annot ? { taille: record.annot.size, sha256: record.annotSha256 } : null;
  },

  async get(id) {
    return this._tx('readonly', (store) => store.get(id));
  },

  /** Supprime une photo (par son identifiant). */
  async remove(id) {
    return this._tx('readwrite', (store) => store.delete(id));
  },

  async removeForPoint(pointId) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pieces', 'readwrite');
      const req = tx.objectStore('pieces').index('pointId').openKeyCursor(IDBKeyRange.only(pointId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          tx.objectStore('pieces').delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
})();
