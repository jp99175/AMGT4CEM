/**
 * Sélection utilisateur des couches "Plans patrimoine" à afficher sur la
 * carte (id de data/patrimoineCatalog.js -> couleur). Persistée à part
 * (comme les autres préférences de l'application), propre à cet appareil.
 * Même principe que urbisTopoSelectionStore.js, y compris la sélection par
 * défaut enregistrable (bouton 💾 du sélecteur) : rien n'est présélectionné
 * tant que l'utilisateur n'a pas choisi puis enregistré sa propre sélection.
 */
const AMGT4CEM_PatrimoineSelectionStore = {
  _key: 'amgt4cem.patrimoine-selection.v1',
  _defaultKey: 'amgt4cem.patrimoine-default.v1',
  _listeners: [],

  /** @returns {Object<string,string>} id -> couleur (hex). */
  getSelection() {
    try {
      const raw = localStorage.getItem(this._key);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('[AMGT4CEM] Sélection Plans patrimoine illisible, réinitialisée :', err);
    }
    return this._buildDefaultSelection();
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

  /**
   * Enregistre la sélection actuelle comme sélection par défaut (bouton 💾 du
   * sélecteur) : utilisée tant qu'aucune sélection courante n'est enregistrée
   * (première visite, ou après effacement des données du navigateur) —
   * propre à cet appareil, comme le reste.
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
    return {};
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
