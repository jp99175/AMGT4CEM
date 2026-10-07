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
 *
 * En haut : le bouton 💾 enregistre la sélection comme PRÉFÉRENCES LOCALES de
 * l'utilisateur, et une case « Tout (dé)sélectionner » agit sur tous les types
 * affichés. Sous la liste : la barre « sélection par défaut partagée »
 * (pickerDefaultBar.js), réservée aux administrateurs, qui fait modifier un
 * brouillon de la sélection par défaut du dépôt (data/urbis-topo/).
 */
const AMGT4CEM_UrbisTopoPicker = {
  _overlay: null,
  _content: null,
  _searchInput: null,
  _draft: null, // brouillon de la sélection par défaut partagée (édition administrateur), sinon null
  _bar: null,

  init() {
    this._overlay = document.getElementById('amgt-topo-picker');
    this._content = document.getElementById('amgt-topo-picker-content');
    this._searchInput = document.getElementById('amgt-topo-picker-search');

    document.getElementById('amgt-topo-picker-close').addEventListener('click', () => this.close());
    this._searchInput.addEventListener('input', () => this._render());

    this._bar = AMGT4CEM_PickerDefaultBar.attach(document.getElementById('amgt-topo-picker-default-bar'), {
      start: () => {
        this._draft = AMGT4CEM_UrbisTopoSelectionStore.getShared();
        this._setEditing(true);
      },
      save: async (code) => {
        await AMGT4CEM_UrbisTopoSelectionStore.saveShared(this._draft, code);
        this._draft = null;
        this._setEditing(false);
      },
      cancel: () => {
        this._draft = null;
        this._setEditing(false);
      },
    });

    const saveBtn = document.getElementById('amgt-topo-picker-save-default');
    const saveBtnDefaultText = saveBtn.textContent;
    saveBtn.addEventListener('click', () => {
      AMGT4CEM_UrbisTopoSelectionStore.saveCurrentAsDefault();
      saveBtn.textContent = '✓';
      setTimeout(() => { saveBtn.textContent = saveBtnDefaultText; }, 1200);
    });
  },

  /** Sélection affichée : le brouillon de la sélection par défaut partagée en édition, sinon celle de l'appareil. */
  _selection() {
    return this._draft || AMGT4CEM_UrbisTopoSelectionStore.getSelection();
  },

  _setEditing(editing) {
    this._overlay.classList.toggle('amgt-fs-picker--editing-default', editing);
    document.getElementById('amgt-topo-picker-save-default').disabled = editing;
    this._render();
  },

  _toggle(code) {
    const store = AMGT4CEM_UrbisTopoSelectionStore;
    if (this._draft) this._draft = store.withToggle(this._draft, code);
    else store.toggle(code);
  },

  _setMany(codes, on) {
    const store = AMGT4CEM_UrbisTopoSelectionStore;
    if (this._draft) this._draft = on ? store.withMany(this._draft, codes) : store.withoutMany(this._draft, codes);
    else if (on) store.selectMany(codes);
    else store.deselectMany(codes);
  },

  open() {
    this._draft = null;
    this._setEditing(false);
    this._bar.reset();
    this._searchInput.value = '';
    this._render();
    this._overlay.classList.remove('amgt-hidden');
    this._searchInput.focus();
  },

  close() {
    this._draft = null; // une édition de la sélection par défaut non enregistrée est abandonnée
    this._setEditing(false);
    this._bar.reset();
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
    const selection = this._selection();
    this._content.innerHTML = '';

    // Types actuellement affichés (filtrés par la recherche) : ceux sur lesquels agit « Tout (dé)sélectionner ».
    const shown = AMGT4CEM_URBISTOPO_CATALOG.filter(
      (e) => (e.geometry === 'point' || e.geometry === 'ligne') && (!needle || this._normalize(e.label).includes(needle))
    );
    if (shown.length) this._content.appendChild(this._buildGlobalToggle(shown, selection));

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
      section.appendChild(this._buildThemeHeading(theme, entries, selection));

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

  /** Case « Tout (dé)sélectionner » au-dessus de tous les thèmes : coché si tous les types affichés le sont, indéterminé si une partie. */
  _buildGlobalToggle(entries, selection) {
    const row = document.createElement('label');
    row.className = 'amgt-checkbox-row amgt-topo-global-toggle';
    const codes = entries.map((e) => e.code);
    const selectedCount = codes.filter((c) => selection[c]).length;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedCount === codes.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < codes.length;
    checkbox.addEventListener('change', () => {
      this._setMany(codes, checkbox.checked);
      this._render();
    });
    row.append(checkbox, document.createTextNode(' Tout (dé)sélectionner'));
    return row;
  },

  /**
   * En-tête d'un thème avec une case "tout cocher/décocher" : reflète l'état
   * (coché si tous les types visibles du thème sont sélectionnés, indéterminé
   * si certains seulement) et agit sur les types actuellement affichés (donc
   * filtrés par la recherche s'il y en a une).
   */
  _buildThemeHeading(theme, entries, selection) {
    const wrapper = document.createElement('div');
    wrapper.className = 'amgt-topo-theme-heading';

    const codes = entries.map((e) => e.code);
    const selectedCount = codes.filter((c) => selection[c]).length;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedCount === codes.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < codes.length;
    checkbox.title = `Tout cocher/décocher — ${theme}`;
    checkbox.addEventListener('change', () => {
      this._setMany(codes, checkbox.checked);
      this._render();
    });

    const heading = document.createElement('h4');
    heading.textContent = theme;

    wrapper.append(checkbox, heading);
    return wrapper;
  },

  _buildRow(entry, selection) {
    const row = document.createElement('label');
    row.className = 'amgt-checkbox-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(selection[entry.code]);
    checkbox.addEventListener('change', () => {
      this._toggle(entry.code);
      this._render(); // reflète la nouvelle pastille de couleur immédiatement
    });

    const dot = document.createElement('span');
    dot.className = 'amgt-topo-color-dot';
    if (selection[entry.code]) dot.style.background = selection[entry.code];

    row.append(checkbox, dot, document.createTextNode(' ' + entry.label));
    return row;
  },
};
