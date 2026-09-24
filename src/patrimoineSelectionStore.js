/**
 * Sélection utilisateur des couches "Plans patrimoine" à afficher sur la
 * carte (id de data/patrimoineCatalog.js -> couleur). Persistée à part
 * (comme les autres préférences de l'application), propre à cet appareil.
 * Même principe que urbisTopoSelectionStore.js, en plus simple : peu
 * d'entrées, rien n'est présélectionné par défaut (l'utilisateur choisit).
 */
const AMGT4CEM_PatrimoineSelectionStore = {
  _key: 'amgt4cem.patrimoine-selection.v1',
  _listeners: [],

  /** @returns {Object<string,string>} id -> couleur (hex). */
  getSelection() {
    try {
      const raw = localStorage.getItem(this._key);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('[AMGT4CEM] Sélection Plans patrimoine illisible, réinitialisée :', err);
    }
    return {};
  },

  toggle(id) {
    const selection = this.getSelection();
    if (selection[id]) {
      delete selection[id];
    } else {
      selection[id] = this._nextColor(selection);
    }
    this._save(selection);
  },

  _nextColor(selection) {
    const { colorPalette } = AMGT4CEM_CONFIG.patrimoine;
    const used = new Set(Object.values(selection));
    const free = colorPalette.find((c) => !used.has(c));
    return free || colorPalette[Object.keys(selection).length % colorPalette.length];
  },

  _save(selection) {
    localStorage.setItem(this._key, JSON.stringify(selection));
    this._listeners.forEach((fn) => fn(selection));
  },

  /** Appelé (couche carte) à chaque changement de sélection. */
  onChange(fn) {
    this._listeners.push(fn);
  },
};
