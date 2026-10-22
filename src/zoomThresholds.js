/**
 * Seuils de zoom réglables par l'utilisateur (sélecteurs « modifier la sélection » de Géotechnique et d'UrbIS Topo).
 * Ils sont rangés avec la sélection correspondante (réglages annexes de selectionStore.js) : valeur de l'appareil,
 * sinon préférences locales 💾, sinon défaut partagé des administrateurs ; à défaut, le fichier de réglages de la couche.
 */
const AMGT4CEM_ZoomThresholds = {
  _listeners: [],
  MIN: 8,
  MAX: 20,

  /** Magasin qui porte le seuil `id` : « nappe.* » -> Géotechnique, « urbistopo » -> UrbIS Topo. */
  _store(id) {
    return id.startsWith('nappe.') ? AMGT4CEM_NappeSelectionStore : AMGT4CEM_UrbisTopoSelectionStore;
  },

  _valid(v) {
    v = Math.round(Number(v));
    return Number.isFinite(v) && v >= this.MIN && v <= this.MAX ? v : null;
  },

  /** Seuil de `id` (ex. 'nappe.isopieses'), ou `fallback` si personne n'en a choisi. */
  get(id, fallback) {
    const v = this._valid((this._store(id).getExtra().zoom || {})[id]);
    return v === null ? fallback : v;
  },

  /** Seuil choisi dans `extra` (appareil, brouillon…), ou `fallback`. */
  from(extra, id, fallback) {
    const v = this._valid(((extra || {}).zoom || {})[id]);
    return v === null ? fallback : v;
  },

  /** Seuil de l'appareil : change tout de suite l'affichage. */
  set(id, value) {
    const store = this._store(id);
    const zoom = { ...(store.getExtra().zoom || {}) };
    const v = this._valid(value);
    if (v === null) delete zoom[id]; else zoom[id] = v;
    store.setExtraValue('zoom', zoom);
    this._listeners.forEach((fn) => fn(id));
  },

  onChange(fn) { this._listeners.push(fn); },

  /**
   * Ligne « À partir du zoom [n] » pour un sélecteur. `picker.draftExtra()` renvoie le brouillon des réglages par
   * défaut partagés en cours d'édition administrateur (sinon null) : la valeur y est lue et écrite à la place de l'appareil.
   * `row.refresh()` relit la valeur (à appeler quand le sélecteur change de mode).
   */
  buildControl(id, fallback, label, picker, opts = {}) {
    const row = document.createElement('div');
    row.className = 'amgt-zoom-threshold' + (opts.inline ? ' amgt-zoom-threshold--inline' : '');
    const lab = document.createElement('label');
    lab.textContent = `${label || 'Afficher à partir du zoom'} `;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(this.MIN);
    input.max = String(this.MAX);
    input.step = '1';
    input.inputMode = 'numeric';
    const current = () => {
      const draft = picker && picker.draftExtra && picker.draftExtra();
      return draft ? this.from(draft, id, fallback) : this.get(id, fallback);
    };
    row.refresh = () => { input.value = String(current()); };
    input.addEventListener('change', () => {
      const draft = picker && picker.draftExtra && picker.draftExtra();
      if (draft) {
        const zoom = { ...(draft.zoom || {}) };
        const v = this._valid(input.value);
        if (v === null) delete zoom[id]; else zoom[id] = v;
        draft.zoom = zoom;
      } else this.set(id, input.value);
      row.refresh();
    });
    lab.append(input);
    row.append(lab);
    row.refresh();
    return row;
  },
};
