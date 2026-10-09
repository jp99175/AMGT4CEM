/**
 * Stockage local des entrées de SIG4CEM (IndexedDB) et petit constructeur DOM commun à l'interface.
 *
 * Une entrée est un signalement ou une demande, avec le même contenu que le dépôt du plugin
 * `signalements` (voir src/signalements/depot.js) et un STATUT qui suit son cycle de vie :
 *   draft    enregistrée en local, envoi pas encore demandé ;
 *   file     envoi demandé, pas encore sur le serveur (en attente de réseau ou de serveur) ;
 *   erreur   envoi tenté et refusé ou interrompu (message dans `erreur`) : à relancer ;
 *   envoye   reçue par le serveur, qui a attribué la référence officielle (`reference`).
 * L'identifiant `id` (UUID) est créé sur l'appareil, dès la saisie ; la référence publique AAAA-NNNN
 * vient du serveur à la réception. `lotOuvert` marque les entrées envoyées pendant un envoi encore en cours
 * (compteur « x/y » du menu) ; il est effacé quand plus rien n'attend.
 *
 * IndexedDB et non localStorage : une entrée peut être nombreuse et ses photos le sont déjà
 * (src/signalements/pieces-store.js).
 */
(function () {
const SIG = (window.SIG4CEM = window.SIG4CEM || {});

/** Petit constructeur DOM : tout texte passe par textContent (jamais de HTML saisi par l'utilisateur). */
SIG.h = function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
};

SIG.STATUT = { DRAFT: 'draft', FILE: 'file', ERREUR: 'erreur', ENVOYE: 'envoye' };

const DB_NAME = 'amgt4cem-signal';
const STORE = 'entries';

SIG.Entries = {
  _dbPromise: null,

  _db() {
    if (!this._dbPromise) {
      this._dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('statut', 'statut', { unique: false });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this._dbPromise;
  },

  async _run(mode, fn) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  all() { return this._run('readonly', (s) => s.getAll()); },
  get(id) { return this._run('readonly', (s) => s.get(id)); },

  /** Enregistre une nouvelle entrée (statut `draft` sauf indication) ; `data.id` est l'UUID créé à la saisie. */
  async add(data) {
    const item = { reference: null, pieces: [], statut: SIG.STATUT.DRAFT, creeLe: new Date().toISOString(), ...data };
    await this._run('readwrite', (s) => s.put(item));
    return item;
  },

  /** Modifie une entrée en une seule transaction ; renvoie l'entrée à jour, ou null si elle n'existe pas. */
  async update(id, patch) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let out = null;
      const read = store.get(id);
      read.onsuccess = () => {
        if (!read.result) return;
        out = { ...read.result, ...patch };
        store.put(out);
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  /** Supprime l'entrée et ses photos locales (jamais la copie du serveur, s'il y en a une). */
  async remove(id) {
    await this._run('readwrite', (s) => s.delete(id));
    try { await window.AMGT4CEM_Signalements.Pieces.removeForPoint(id); } catch (err) { console.warn('[SIG4CEM] Photos non supprimées :', err); }
  },

  /** Compteurs du menu : brouillons, en file, en erreur, envoyées, et envoyées pendant l'envoi en cours. */
  async counts() {
    const c = { draft: 0, file: 0, erreur: 0, envoye: 0, lot: 0 };
    for (const e of await this.all()) {
      c[e.statut] = (c[e.statut] || 0) + 1;
      if (e.statut === SIG.STATUT.ENVOYE && e.lotOuvert) c.lot += 1;
    }
    return c;
  },

  /**
   * Reprend une seule fois les signalements saisis avec l'ancien plugin de la carte (localStorage,
   * clés amgt4cem.signalements.v1 et amgt4cem.signalements.amiante.v1) : ils deviennent des brouillons (ou des
   * entrées envoyées s'ils ont une référence). Leurs photos sont déjà dans le même stockage de photos.
   * Les données d'origine ne sont ni modifiées ni supprimées. @returns {Promise<number>} nombre d'entrées reprises
   */
  async migrateLegacy() {
    const FLAG = 'amgt4cem.signal.legacy-migrated.v1';
    try { if (localStorage.getItem(FLAG)) return 0; } catch (err) { return 0; }
    let n = 0;
    for (const key of ['amgt4cem.signalements.v1', 'amgt4cem.signalements.amiante.v1']) {
      let items = [];
      try { items = JSON.parse(localStorage.getItem(key) || '[]'); } catch (err) { console.warn('[SIG4CEM] Anciens signalements illisibles :', key, err); }
      for (const item of items) {
        if (!item || !item.id || await this.get(item.id)) continue;
        await this.add({ ...item, statut: item.reference ? SIG.STATUT.ENVOYE : SIG.STATUT.DRAFT });
        n += 1;
      }
    }
    try { localStorage.setItem(FLAG, new Date().toISOString()); } catch (err) { /* repris à la prochaine ouverture */ }
    return n;
  },

  /** Quand plus rien n'attend (file ou erreur), l'envoi en cours est terminé : le compteur x/y repart à zéro. */
  async closeLotIfDone() {
    const all = await this.all();
    if (all.some((e) => e.statut === SIG.STATUT.FILE || e.statut === SIG.STATUT.ERREUR)) return;
    for (const e of all) if (e.lotOuvert) await this.update(e.id, { lotOuvert: false });
  },
};
})();
