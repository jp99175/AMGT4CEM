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
  _defaultKey: 'amgt4cem.urbistopo-default.v1',
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

  /** Sélectionne plusieurs codes d'un coup (case "tout cocher" d'un thème). */
  selectMany(codes) {
    const selection = this.getSelection();
    for (const code of codes) {
      if (!selection[code]) selection[code] = this._nextColor(selection);
    }
    this._save(selection);
  },

  /** Désélectionne plusieurs codes d'un coup (case "tout décocher" d'un thème). */
  deselectMany(codes) {
    const selection = this.getSelection();
    for (const code of codes) delete selection[code];
    this._save(selection);
  },

  /**
   * Enregistre la sélection actuelle comme sélection par défaut (bouton 💾 du
   * sélecteur) : utilisée à la place de la présélection intégrée à
   * l'application (config.js) tant qu'aucune sélection courante n'est
   * enregistrée (première visite, ou après effacement des données du
   * navigateur) — propre à cet appareil, comme le reste.
   */
  saveCurrentAsDefault() {
    localStorage.setItem(this._defaultKey, JSON.stringify(this.getSelection()));
  },

  _buildDefaultSelection() {
    try {
      const raw = localStorage.getItem(this._defaultKey);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('[AMGT4CEM] Sélection par défaut enregistrée illisible, ignorée :', err);
    }

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
