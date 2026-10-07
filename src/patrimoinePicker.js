/**
 * Sélecteur plein écran des couches "Plans patrimoine" (voir
 * data/plans-patrimoine/catalogue.js) — même principe que le sélecteur UrbIS Topo
 * (urbisTopoPicker.js), en plus simple : peu d'entrées pour l'instant, donc
 * pas de recherche ni de regroupement par thème. Chaque case cochée/décochée
 * met à jour la sélection immédiatement (voir patrimoineSelectionStore.js).
 * Mêmes commandes que le sélecteur UrbIS Topo : 💾 = préférences locales,
 * case « Tout (dé)sélectionner » en haut, barre « sélection par défaut
 * partagée » (administrateur, data/plans-patrimoine/) sous la liste.
 */
const AMGT4CEM_PatrimoinePicker = {
  _overlay: null,
  _content: null,
  _draft: null, // brouillon de la sélection par défaut partagée (édition administrateur), sinon null
  _bar: null,

  init() {
    this._overlay = document.getElementById('amgt-patrimoine-picker');
    this._content = document.getElementById('amgt-patrimoine-picker-content');
    document.getElementById('amgt-patrimoine-picker-close').addEventListener('click', () => this.close());

    this._bar = AMGT4CEM_PickerDefaultBar.attach(document.getElementById('amgt-patrimoine-picker-default-bar'), {
      start: () => {
        this._draft = AMGT4CEM_PatrimoineSelectionStore.getShared();
        this._setEditing(true);
      },
      save: async (code) => {
        await AMGT4CEM_PatrimoineSelectionStore.saveShared(this._draft, code);
        this._draft = null;
        this._setEditing(false);
      },
      cancel: () => {
        this._draft = null;
        this._setEditing(false);
      },
    });

    const saveBtn = document.getElementById('amgt-patrimoine-picker-save-default');
    const saveBtnDefaultText = saveBtn.textContent;
    saveBtn.addEventListener('click', () => {
      AMGT4CEM_PatrimoineSelectionStore.saveCurrentAsDefault();
      saveBtn.textContent = '✓';
      setTimeout(() => { saveBtn.textContent = saveBtnDefaultText; }, 1200);
    });
  },

  /** Sélection affichée : le brouillon de la sélection par défaut partagée en édition, sinon celle de l'appareil. */
  _selection() {
    return this._draft || AMGT4CEM_PatrimoineSelectionStore.getSelection();
  },

  _setEditing(editing) {
    this._overlay.classList.toggle('amgt-fs-picker--editing-default', editing);
    document.getElementById('amgt-patrimoine-picker-save-default').disabled = editing;
    this._render();
  },

  _toggle(id) {
    const store = AMGT4CEM_PatrimoineSelectionStore;
    if (this._draft) this._draft = store.withToggle(this._draft, id);
    else store.toggle(id);
  },

  _setMany(ids, on) {
    const store = AMGT4CEM_PatrimoineSelectionStore;
    if (this._draft) this._draft = on ? store.withMany(this._draft, ids) : store.withoutMany(this._draft, ids);
    else if (on) store.selectMany(ids);
    else store.deselectMany(ids);
  },

  open() {
    this._draft = null;
    this._setEditing(false);
    this._bar.reset();
    this._render();
    this._overlay.classList.remove('amgt-hidden');
  },

  close() {
    this._draft = null; // une édition de la sélection par défaut non enregistrée est abandonnée
    this._setEditing(false);
    this._bar.reset();
    this._overlay.classList.add('amgt-hidden');
  },

  _render() {
    const selection = this._selection();
    this._content.innerHTML = '';
    this._content.appendChild(this._buildGlobalToggle(AMGT4CEM_PATRIMOINE_CATALOG, selection));
    for (const entry of AMGT4CEM_PATRIMOINE_CATALOG) {
      this._content.appendChild(this._buildRow(entry, selection));
    }
  },

  /** Case « Tout (dé)sélectionner » au-dessus de la liste : coché si tout l'est, indéterminé si une partie. */
  _buildGlobalToggle(entries, selection) {
    const row = document.createElement('label');
    row.className = 'amgt-checkbox-row amgt-topo-global-toggle';
    const ids = entries.map((e) => e.id);
    const selectedCount = ids.filter((id) => selection[id]).length;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedCount === ids.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < ids.length;
    checkbox.addEventListener('change', () => {
      this._setMany(ids, checkbox.checked);
      this._render();
    });
    row.append(checkbox, document.createTextNode(' Tout (dé)sélectionner'));
    return row;
  },

  _buildRow(entry, selection) {
    const row = document.createElement('label');
    row.className = 'amgt-checkbox-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(selection[entry.id]);
    checkbox.addEventListener('change', () => {
      this._toggle(entry.id);
      this._render(); // reflète la nouvelle pastille de couleur immédiatement
    });

    // Couches "external" (ex : planches PE) : pas de pastille de couleur,
    // leur rendu a sa propre couleur fixe (voir metroLayer.js), pas
    // sélectionnable ici.
    if (!entry.external) {
      const dot = document.createElement('span');
      dot.className = 'amgt-topo-color-dot';
      if (selection[entry.id]) dot.style.background = selection[entry.id];
      row.append(checkbox, dot, document.createTextNode(' ' + entry.label));
      return row;
    }

    row.append(checkbox, document.createTextNode(' ' + entry.label));
    return row;
  },
};
