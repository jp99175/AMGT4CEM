/**
 * Magasin local des tuiles du fond de plan UrbIS (carte hors ligne).
 *
 * IndexedDB (et non le cache du navigateur) : on sait exactement ce qui est gardé, on le compte, on le supprime.
 *  - « tuiles » : clé « z/x/y » -> image (Blob)
 *  - « index »  : clé « z/x/y » -> { t: date de téléchargement, o: octets }, relu en entier au démarrage (petits objets)
 * Une tuile de plus de 60 jours n'est plus servie et est supprimée à l'ouverture.
 * Ce fichier est chargé par les pages qui affichent la carte (lecture), par l'écran Réglages et par le service worker (sw.js,
 * qui télécharge les tuiles et les écrit ici). « travail » : le téléchargement en cours, pour qu'il puisse reprendre.
 */
const AMGT4CEM_HorsLigne = (function () {
'use strict';

const NOM_BASE = 'amgt4cem-horsligne';
const VERSION_BASE = 2; // 2 : ajout du magasin « travail » (téléchargement confié au service worker)
const VALIDITE_MS = 60 * 24 * 3600 * 1000;

const HL = {
  pret: false,
  index: new Map(), // « z/x/y » -> { t, o }
  _db: null,
  _ouverture: null,
  VALIDITE_JOURS: 60,

  cle: (z, x, y) => `${z}/${x}/${y}`,

  /** Ouvre la base et charge l'index. Sans effet si IndexedDB est indisponible (navigation privée...) : pret reste false. */
  ouvrir() {
    if (this._ouverture) return this._ouverture;
    this._ouverture = new Promise((ok) => {
      if (typeof indexedDB === 'undefined') { ok(false); return; }
      let req;
      try { req = indexedDB.open(NOM_BASE, VERSION_BASE); } catch (err) { ok(false); return; }
      req.onupgradeneeded = () => {
        const noms = req.result.objectStoreNames;
        if (!noms.contains('tuiles')) req.result.createObjectStore('tuiles');
        if (!noms.contains('index')) req.result.createObjectStore('index');
        if (!noms.contains('travail')) req.result.createObjectStore('travail');
      };
      req.onerror = () => ok(false);
      req.onsuccess = () => {
        this._db = req.result;
        const tx = this._db.transaction('index', 'readonly');
        const cur = tx.objectStore('index').openCursor();
        const limite = Date.now() - VALIDITE_MS;
        const perimees = [];
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          if (c.value.t < limite) perimees.push(c.key); else this.index.set(c.key, c.value);
          c.continue();
        };
        tx.oncomplete = () => {
          this.pret = true;
          if (perimees.length) this.supprimer(perimees);
          ok(true);
        };
        tx.onerror = () => ok(false);
      };
    });
    return this._ouverture;
  },

  /** Relit l'index depuis la base (le service worker a pu écrire des tuiles depuis le dernier chargement). */
  recharger() {
    return new Promise((ok) => {
      if (!this._db) { ok(false); return; }
      const limite = Date.now() - VALIDITE_MS;
      const nouveau = new Map();
      const tx = this._db.transaction('index', 'readonly');
      const cur = tx.objectStore('index').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        if (c.value.t >= limite) nouveau.set(c.key, c.value);
        c.continue();
      };
      tx.oncomplete = () => { this.index = nouveau; ok(true); };
      tx.onerror = () => ok(false);
    });
  },

  /** Travail de téléchargement en cours (un seul) : lecture, écriture, effacement. */
  lireTravail() {
    return new Promise((ok) => {
      if (!this._db) { ok(null); return; }
      try {
        const r = this._db.transaction('travail', 'readonly').objectStore('travail').get('courant');
        r.onsuccess = () => ok(r.result || null);
        r.onerror = () => ok(null);
      } catch (err) { ok(null); }
    });
  },
  ecrireTravail(t) {
    return new Promise((ok) => {
      if (!this._db) { ok(); return; }
      const tx = this._db.transaction('travail', 'readwrite');
      if (t) tx.objectStore('travail').put(t, 'courant'); else tx.objectStore('travail').delete('courant');
      tx.oncomplete = () => ok();
      tx.onerror = () => ok();
    });
  },

  possede(z, x, y) { return this.pret && this.index.has(this.cle(z, x, y)); },

  /** Image d'une tuile gardée, ou null. */
  lire(z, x, y) {
    return new Promise((ok) => {
      if (!this.pret) { ok(null); return; }
      try {
        const r = this._db.transaction('tuiles', 'readonly').objectStore('tuiles').get(this.cle(z, x, y));
        r.onsuccess = () => ok(r.result || null);
        r.onerror = () => ok(null);
      } catch (err) { ok(null); }
    });
  },

  /** Garde une tuile. Rejette si le stockage est plein ou refusé. */
  ecrire(cle, blob) {
    return new Promise((ok, ko) => {
      if (!this.pret) { ko(new Error('stockage indisponible')); return; }
      const rec = { t: Date.now(), o: blob.size };
      const tx = this._db.transaction(['tuiles', 'index'], 'readwrite');
      tx.objectStore('tuiles').put(blob, cle);
      tx.objectStore('index').put(rec, cle);
      tx.oncomplete = () => { this.index.set(cle, rec); ok(); };
      tx.onerror = () => ko(tx.error || new Error('écriture refusée'));
      tx.onabort = () => ko(tx.error || new Error('stockage plein ou refusé'));
    });
  },

  /** Supprime les tuiles données ; sans argument, toutes. */
  supprimer(cles) {
    return new Promise((ok) => {
      if (!this.pret) { ok(); return; }
      const liste = cles || [...this.index.keys()];
      const tx = this._db.transaction(['tuiles', 'index'], 'readwrite');
      for (const c of liste) { tx.objectStore('tuiles').delete(c); tx.objectStore('index').delete(c); }
      tx.oncomplete = () => { liste.forEach((c) => this.index.delete(c)); ok(); };
      tx.onerror = () => ok();
      tx.onabort = () => ok(); // échec : les tuiles restent dans l'index, l'appelant le vérifie
    });
  },

  /** Demande au navigateur de ne pas effacer le stockage de lui-même. true = accordé. */
  async demanderDurable() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (err) { /* indisponible */ }
    return false;
  },

  async estimation() {
    try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (err) { /* indisponible */ }
    return null;
  },

  /** Date de la plus ancienne tuile gardée (ms), ou null. */
  plusAncienne() {
    let m = null;
    for (const v of this.index.values()) if (m === null || v.t < m) m = v.t;
    return m;
  },
};

globalThis.AMGT4CEM_HorsLigne = HL;
HL.ouvrir();
return HL;
}());
