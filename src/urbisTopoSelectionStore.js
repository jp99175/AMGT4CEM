/**
 * Sélection utilisateur des types d'objets UrbIS Topo à afficher sur la
 * carte (code -> couleur), voir data/urbisTopoCatalog.js pour la liste des
 * codes possibles. Persistée à part (comme les points métier et les
 * paramètres), propre à cet appareil — jamais partagée, jamais envoyée à un
 * serveur. Voir urbisTopoPicker.js (interface de sélection, "modifier la
 * sélection") et urbisTopoLayer.js (affichage carte).
 */
const AMGT4CEM_UrbisTopoSelectionStore = {
  _key: 'amgt4cem.urbistopo-selection.v1',
  _listeners: [],

  /** @returns {Object<string,string>} code -> couleur (hex). */
  getSelection() {
    try {
      const raw = localStorage.getItem(this._key);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('[AMGT4CEM] Sélection UrbIS Topo illisible, réinitialisée :', err);
    }
    return this._buildDefaultSelection();
  },

  isSelected(code) {
    return code in this.getSelection();
  },

  toggle(code) {
    const selection = this.getSelection();
    if (selection[code]) {
      delete selection[code];
    } else {
      selection[code] = this._nextColor(selection);
    }
    this._save(selection);
  },

  _buildDefaultSelection() {
    const { defaultSelectionCodes, colorPalette } = AMGT4CEM_CONFIG.urbisTopo;
    const selection = {};
    defaultSelectionCodes.forEach((code, i) => {
      selection[code] = colorPalette[i % colorPalette.length];
    });
    return selection;
  },

  _nextColor(selection) {
    const { colorPalette } = AMGT4CEM_CONFIG.urbisTopo;
    const used = new Set(Object.values(selection));
    const free = colorPalette.find((c) => !used.has(c));
    return free || colorPalette[Object.keys(selection).length % colorPalette.length];
  },

  _save(selection) {
    localStorage.setItem(this._key, JSON.stringify(selection));
    this._listeners.forEach((fn) => fn(selection));
  },

  /** Appelé (légende du menu + couche carte) à chaque changement de sélection. */
  onChange(fn) {
    this._listeners.push(fn);
  },
};
