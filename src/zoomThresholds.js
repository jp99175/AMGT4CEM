/**
 * Seuils de zoom réglables par l'utilisateur (menus « modifier la sélection » de Géotechnique et d'UrbIS Topo) :
 * valeur propre à l'appareil (localStorage), à défaut celle du fichier de réglages de la couche.
 */
const AMGT4CEM_ZoomThresholds = {
  _key: 'amgt4cem.seuils-zoom.v1',
  _listeners: [],
  MIN: 8,
  MAX: 20,

  _all() {
    try { return JSON.parse(localStorage.getItem(this._key) || '{}') || {}; } catch (err) { return {}; }
  },

  /** Seuil de `id` (ex. 'nappe.isopieses'), ou `fallback` si l'utilisateur n'en a pas choisi. */
  get(id, fallback) {
    const v = Number(this._all()[id]);
    return Number.isFinite(v) && v >= this.MIN && v <= this.MAX ? Math.round(v) : fallback;
  },

  set(id, value) {
    const all = this._all();
    const v = Math.round(Number(value));
    if (Number.isFinite(v) && v >= this.MIN && v <= this.MAX) all[id] = v; else delete all[id];
    try { localStorage.setItem(this._key, JSON.stringify(all)); } catch (err) { /* valable pour la session seulement */ }
    this._listeners.forEach((fn) => fn(id));
  },

  onChange(fn) { this._listeners.push(fn); },

  /** Ligne « À partir du zoom [n] » pour un sélecteur ; `fallback` = valeur du fichier de réglages. */
  buildControl(id, fallback, label) {
    const row = document.createElement('div');
    row.className = 'amgt-zoom-threshold';
    const lab = document.createElement('label');
    lab.textContent = `${label || 'Afficher à partir du zoom'} `;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(this.MIN);
    input.max = String(this.MAX);
    input.step = '1';
    input.inputMode = 'numeric';
    input.value = String(this.get(id, fallback));
    input.addEventListener('change', () => {
      this.set(id, input.value);
      input.value = String(this.get(id, fallback));
    });
    lab.append(input);
    row.append(lab);
    return row;
  },
};
