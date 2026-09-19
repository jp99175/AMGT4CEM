/**
 * Sélecteur plein écran ("page" derrière la carte) listant l'intégralité du
 * catalogue UrbIS Topo, groupé par thème, avec recherche, pour choisir quels
 * types d'objets afficher. Ouvert depuis le lien "(modifier la sélection)"
 * du menu ☰ Carte (voir mapMenu.js). Chaque case cochée/décochée met à jour
 * la sélection immédiatement (voir urbisTopoSelectionStore.js) — pas de
 * bouton "valider" séparé, comme le reste des contrôles de cette application.
 *
 * Les géométries "texte" et "polygone" du catalogue ne sont pas proposées :
 * leur affichage carte n'est pas encore pris en charge (voir
 * urbisTopoLayer.js).
 */
const AMGT4CEM_UrbisTopoPicker = {
  _overlay: null,
  _content: null,
  _searchInput: null,

  init() {
    this._overlay = document.getElementById('amgt-topo-picker');
    this._content = document.getElementById('amgt-topo-picker-content');
    this._searchInput = document.getElementById('amgt-topo-picker-search');

    document.getElementById('amgt-topo-picker-close').addEventListener('click', () => this.close());
    this._searchInput.addEventListener('input', () => this._render());
  },

  open() {
    this._searchInput.value = '';
    this._render();
    this._overlay.classList.remove('amgt-hidden');
    this._searchInput.focus();
  },

  close() {
    this._overlay.classList.add('amgt-hidden');
  },

  _normalize(str) {
    return (str || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  },

  _render() {
    const needle = this._normalize(this._searchInput.value);
    const selection = AMGT4CEM_UrbisTopoSelectionStore.getSelection();
    this._content.innerHTML = '';

    for (const theme of AMGT4CEM_URBISTOPO_THEME_ORDER) {
      const entries = AMGT4CEM_URBISTOPO_CATALOG.filter(
        (e) =>
          e.theme === theme &&
          (e.geometry === 'point' || e.geometry === 'ligne') &&
          (!needle || this._normalize(e.label).includes(needle))
      );
      if (entries.length === 0) continue;

      const section = document.createElement('section');
      section.className = 'amgt-topo-theme';

      const heading = document.createElement('h4');
      heading.textContent = theme;
      section.appendChild(heading);

      for (const entry of entries) {
        section.appendChild(this._buildRow(entry, selection));
      }

      this._content.appendChild(section);
    }

    if (!this._content.children.length) {
      const empty = document.createElement('p');
      empty.className = 'amgt-settings-hint';
      empty.textContent = "Aucun type d'objet ne correspond à cette recherche.";
      this._content.appendChild(empty);
    }
  },

  _buildRow(entry, selection) {
    const row = document.createElement('label');
    row.className = 'amgt-checkbox-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(selection[entry.code]);
    checkbox.addEventListener('change', () => {
      AMGT4CEM_UrbisTopoSelectionStore.toggle(entry.code);
      this._render(); // reflète la nouvelle pastille de couleur immédiatement
    });

    const dot = document.createElement('span');
    dot.className = 'amgt-topo-color-dot';
    if (selection[entry.code]) dot.style.background = selection[entry.code];

    row.append(checkbox, dot, document.createTextNode(' ' + entry.label));
    return row;
  },
};
