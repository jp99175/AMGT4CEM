/**
 * Stockage local des signalements (localStorage), indépendant des points métier du cœur.
 *
 * Deux FLUX, deux clés distinctes : STANDARD et AMIANTE (criticité du sujet : ils ne
 * partagent ni stockage, ni couche, ni fichier de dépôt). Même principe que la micro-base
 * du cœur (module isolé, interface asynchrone) : le jour où un vrai stockage partagé est
 * choisi, seul ce module change.
 *
 * Enregistrement : { id (UUID), flux, nature, type, domaine, x, y (Lambert 72), label,
 * dateObservation, lieu, demandeur, referenceDemandeur, description,
 * reference (null : attribuée à l'import), pieces[], creeLe, exporteLe }.
 */
(function () {
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});
const KEYS = { STANDARD: 'amgt4cem.signalements.v1', AMIANTE: 'amgt4cem.signalements.amiante.v1' };
const FLUXES = ['STANDARD', 'AMIANTE'];

NS.Store = {
  _read(flux) {
    try {
      const raw = localStorage.getItem(KEYS[flux]);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('[AMGT4CEM] Signalements illisibles :', err);
      return [];
    }
  },

  _write(flux, items) {
    localStorage.setItem(KEYS[flux], JSON.stringify(items));
  },

  async getAll() {
    return FLUXES.flatMap((flux) => this._read(flux));
  },

  async add(data) {
    const flux = data.flux === 'AMIANTE' ? 'AMIANTE' : 'STANDARD';
    const item = {
      ...data,
      flux,
      id: crypto.randomUUID ? crypto.randomUUID() : `sg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      reference: null,
      pieces: [],
      creeLe: new Date().toISOString(),
    };
    const items = this._read(flux);
    items.push(item);
    this._write(flux, items);
    return item;
  },

  async update(id, patch) {
    for (const flux of FLUXES) {
      const items = this._read(flux);
      const idx = items.findIndex((s) => s.id === id);
      if (idx === -1) continue;
      items[idx] = { ...items[idx], ...patch };
      this._write(flux, items);
      return items[idx];
    }
    return null;
  },

  async remove(id) {
    for (const flux of FLUXES) {
      const items = this._read(flux);
      const kept = items.filter((s) => s.id !== id);
      if (kept.length !== items.length) this._write(flux, kept);
    }
    try { await NS.Pieces.removeForPoint(id); } catch (err) { console.warn('[AMGT4CEM] Photos non supprimées :', err); }
  },
};
})();
