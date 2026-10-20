/**
 * Écran plein écran « ⚙ Orthophotos » (bouton à droite de « Orthophotos » dans le menu ☰ Carte) : un tableau
 * année × source (une colonne par source : Bruxelles, Flandre). Chaque case existante porte la résolution de
 * l'image quand elle est connue (champ `resolution` de data/fonds-de-plan/*.json) et une case à cocher qui
 * choisit si cette orthophoto est proposée dans la navigation par année. Une année sans orthophoto pour une
 * source affiche « — ».
 *
 * Comme les autres sélecteurs : chaque case agit tout de suite (orthoSelectionStore.js), 💾 enregistre la
 * sélection comme préférences locales de l'utilisateur, et la barre du bas (pickerDefaultBar.js, administrateur)
 * modifie la sélection par défaut partagée de l'application.
 */
const AMGT4CEM_OrthoPicker = {
  _overlay: null,
  _content: null,
  _draft: null, // brouillon de la sélection par défaut partagée (édition administrateur), sinon null
  _bar: null,
  _notice: '',
  _access: null, // { id d'entrée: le service répond ? } une fois le sondage fini, sinon null

  init() {
    this._overlay = document.getElementById('amgt-ortho-picker');
    this._content = document.getElementById('amgt-ortho-picker-content');
    document.getElementById('amgt-ortho-picker-close').addEventListener('click', () => this.close());

    const store = AMGT4CEM_OrthoSelectionStore;
    this._bar = AMGT4CEM_PickerDefaultBar.attach(document.getElementById('amgt-ortho-picker-default-bar'), {
      start: () => {
        this._draft = this._all(store.getShared());
        this._setEditing(true);
      },
      save: async (code) => {
        await store.saveShared(this._normalized(this._draft), code);
        this._draft = null;
        this._setEditing(false);
      },
      cancel: () => {
        this._draft = null;
        this._setEditing(false);
      },
    });

    const saveBtn = document.getElementById('amgt-ortho-picker-save-default');
    const saveBtnText = saveBtn.textContent;
    saveBtn.addEventListener('click', () => {
      store.saveCurrentAsDefault();
      saveBtn.textContent = '✓';
      setTimeout(() => { saveBtn.textContent = saveBtnText; }, 1200);
    });
  },

  _codes() {
    return AMGT4CEM_Basemap.getConfiguredEntries().map((e) => AMGT4CEM_Basemap.entryCode(e));
  },

  /** Sélection vide = tout : pour l'affichage, on la développe en liste complète de cases cochées. */
  _all(selection) {
    if (Object.keys(selection).length) return { ...selection };
    return AMGT4CEM_OrthoSelectionStore.withMany({}, this._codes());
  },

  /** Si tout est coché, on enregistre une sélection vide (= tout, y compris les années ajoutées plus tard). */
  _normalized(selection) {
    const codes = this._codes();
    return codes.every((c) => selection[c]) ? {} : selection;
  },

  _selection() {
    return this._draft || this._all(AMGT4CEM_OrthoSelectionStore.getSelection());
  },

  /** Applique une nouvelle sélection complète (brouillon, ou sélection de l'appareil). */
  _apply(selection) {
    // Une sélection vide voudrait dire « tout » : on ne laisse donc pas décocher la dernière orthophoto.
    if (!this._codes().some((c) => selection[c])) {
      this._notice = 'Au moins une orthophoto doit rester cochée.';
      return;
    }
    this._notice = '';
    if (this._draft) {
      this._draft = selection;
      return;
    }
    AMGT4CEM_OrthoSelectionStore.replaceSelection(this._normalized(selection));
  },

  _setEditing(editing) {
    this._overlay.classList.toggle('amgt-fs-picker--editing-default', editing);
    document.getElementById('amgt-ortho-picker-save-default').disabled = editing;
    this._render();
  },

  open() {
    this._notice = '';
    this._draft = null;
    this._setEditing(false);
    this._bar.reset();
    this._render();
    this._overlay.classList.remove('amgt-hidden');
    // Le service répond-il pour chaque orthophoto ? (même sondage que la navigation, mis en cache)
    AMGT4CEM_Basemap.probeAll().then((access) => {
      this._access = access;
      if (!this._overlay.classList.contains('amgt-hidden')) this._render();
    });
  },

  close() {
    this._draft = null; // une édition de la sélection par défaut non enregistrée est abandonnée
    this._setEditing(false);
    this._bar.reset();
    this._overlay.classList.add('amgt-hidden');
  },

  _render() {
    const store = AMGT4CEM_OrthoSelectionStore;
    const selection = this._selection();
    const entries = AMGT4CEM_Basemap.getConfiguredEntries();
    const SRC = AMGT4CEM_Basemap.SOURCES;
    const columns = Object.keys(AMGT4CEM_Basemap.COLUMNS).filter((c) => entries.some((e) => SRC[e.source].column === c));
    const srcOrder = Object.keys(SRC);

    // Une ligne par millésime (clé : année, ou plage pour les compilations), les plus récents d'abord.
    // Une case de colonne contient une ligne par variante disponible cette année-là.
    const rows = new Map();
    for (const e of entries) {
      if (!rows.has(e.key)) rows.set(e.key, { key: e.key, sortYear: e.sortYear, byColumn: {} });
      const r = rows.get(e.key);
      (r.byColumn[SRC[e.source].column] = r.byColumn[SRC[e.source].column] || []).push(e);
    }
    const sorted = [...rows.values()].sort((a, b) => b.sortYear - a.sortYear || b.key.length - a.key.length);

    const table = document.createElement('table');
    table.className = 'amgt-ortho-table';
    const head = table.createTHead().insertRow();
    head.insertCell().outerHTML = '<th>Année</th>';
    for (const c of columns) {
      const th = document.createElement('th');
      const codes = entries.filter((e) => SRC[e.source].column === c).map((e) => AMGT4CEM_Basemap.entryCode(e));
      const n = codes.filter((code) => selection[code]).length;
      const all = document.createElement('input');
      all.type = 'checkbox';
      all.checked = n === codes.length;
      all.indeterminate = n > 0 && n < codes.length;
      all.title = `Tout cocher/décocher — ${AMGT4CEM_Basemap.COLUMNS[c]}`;
      all.addEventListener('change', () => {
        const next = { ...selection };
        for (const code of codes) { if (all.checked) next[code] = next[code] || store.nextColor(next); else delete next[code]; }
        this._apply(next);
        this._render();
      });
      th.append(all, document.createTextNode(' ' + AMGT4CEM_Basemap.COLUMNS[c]));
      head.appendChild(th);
    }

    const body = table.createTBody();
    for (const r of sorted) {
      const tr = body.insertRow();
      tr.insertCell().textContent = r.key;
      for (const c of columns) {
        const td = tr.insertCell();
        const list = (r.byColumn[c] || []).sort((x, y) => srcOrder.indexOf(x.source) - srcOrder.indexOf(y.source));
        if (!list.length) { td.className = 'amgt-ortho-none'; td.textContent = '—'; continue; }
        for (const e of list) {
          const code = AMGT4CEM_Basemap.entryCode(e);
          const unavailable = this._access && this._access[e.id] === false;
          const label = document.createElement('label');
          label.className = 'amgt-ortho-cell' + (unavailable ? ' amgt-ortho-cell--off' : '');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = Boolean(selection[code]);
          if (unavailable) {
            cb.disabled = true;
            label.title = `Le service ne répond pas pour cette couche (${e.layers}) : elle n'est pas proposée dans la navigation.`;
          }
          cb.addEventListener('change', () => {
            const next = { ...selection };
            if (cb.checked) next[code] = store.nextColor(next); else delete next[code];
            this._apply(next);
            this._render();
          });
          label.appendChild(cb);
          // Plusieurs variantes dans la case : on nomme chacune (sinon la case se suffit).
          if (list.length > 1) {
            const v = document.createElement('span');
            v.className = 'amgt-ortho-variant';
            v.textContent = SRC[e.source].variant;
            label.appendChild(v);
          }
          const res = document.createElement('span');
          res.className = 'amgt-ortho-res' + (e.resolution ? '' : ' amgt-ortho-res--unknown');
          res.textContent = unavailable ? 'indisponible' : (e.resolution || 'résolution ?');
          if (unavailable) res.className = 'amgt-ortho-res amgt-ortho-res--off';
          label.appendChild(res);
          td.appendChild(label);
        }
      }
    }

    this._content.innerHTML = '';
    this._content.appendChild(table);
    const hint = document.createElement('p');
    hint.className = 'amgt-settings-hint';
    hint.textContent = (this._notice ? this._notice + ' ' : '') + "Seules les orthophotos cochées sont proposées avec les flèches de la navigation par année. « indisponible » : le service ne répond pas pour cette couche (nom de couche à vérifier, ou service en panne) ; « résolution ? » : valeur pas encore renseignée (champ « resolution » de data/fonds-de-plan/*.json).";
    this._content.appendChild(hint);
  },
};
