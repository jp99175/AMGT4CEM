/**
 * Sélecteur plein écran des couches "Plans patrimoine" (voir
 * data/patrimoineCatalog.js) — même principe que le sélecteur UrbIS Topo
 * (urbisTopoPicker.js), en plus simple : peu d'entrées pour l'instant, donc
 * pas de recherche ni de regroupement par thème. Chaque case cochée/décochée
 * met à jour la sélection immédiatement (voir patrimoineSelectionStore.js).
 */
const AMGT4CEM_PatrimoinePicker = {
  _overlay: null,
  _content: null,

  init() {
    this._overlay = document.getElementById('amgt-patrimoine-picker');
    this._content = document.getElementById('amgt-patrimoine-picker-content');
    document.getElementById('amgt-patrimoine-picker-close').addEventListener('click', () => this.close());
  },

  open() {
    this._render();
    this._overlay.classList.remove('amgt-hidden');
  },

  close() {
    this._overlay.classList.add('amgt-hidden');
  },

  _render() {
    const selection = AMGT4CEM_PatrimoineSelectionStore.getSelection();
    this._content.innerHTML = '';
    for (const entry of AMGT4CEM_PATRIMOINE_CATALOG) {
      this._content.appendChild(this._buildRow(entry, selection));
    }
  },

  _buildRow(entry, selection) {
    const row = document.createElement('label');
    row.className = 'amgt-checkbox-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(selection[entry.id]);
    checkbox.addEventListener('change', () => {
      AMGT4CEM_PatrimoineSelectionStore.toggle(entry.id);
      this._render(); // reflète la nouvelle pastille de couleur immédiatement
    });

    const dot = document.createElement('span');
    dot.className = 'amgt-topo-color-dot';
    if (selection[entry.id]) dot.style.background = selection[entry.id];

    row.append(checkbox, dot, document.createTextNode(' ' + entry.label));
    return row;
  },
};
