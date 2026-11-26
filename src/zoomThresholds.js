/**
 * Seuils d'affichage réglables par l'utilisateur (sélecteurs « modifier la sélection » de Géotechnique et d'UrbIS Topo),
 * exprimés en ÉCHELLE 1:N : une couche s'affiche quand la carte est à cette échelle ou plus détaillée. Le numéro de niveau de
 * zoom n'a pas d'importance (voir lambertGrid.js). Ils sont rangés avec la sélection correspondante (réglages annexes de
 * selectionStore.js, champ `echelle`) : valeur de l'appareil, sinon préférences locales, sinon défaut partagé des
 * administrateurs ; à défaut, le fichier de réglages de la couche.
 *
 * Migration : avant le passage de la carte en Lambert 72, les seuils étaient des numéros de zoom Web Mercator (champ `zoom`).
 * Ils sont convertis à la lecture en échelle équivalente (AMGT4CEM_LambertGrid.echelleDepuisZoomMercator) et le champ
 * `echelle` prend le relais dès la première modification.
 */
const AMGT4CEM_ZoomThresholds = {
  _listeners: [],
  MIN: 500,
  MAX: 200000,
  /** Valeurs proposées dans la liste (et ce qu'une saisie libre peut remplacer). */
  LISTE: [50000, 25000, 10000, 5000, 2500, 1000],

  /** Magasin qui porte le seuil `id` : « nappe.* » -> Géotechnique, « urbistopo » -> UrbIS Topo. */
  _store(id) {
    return id.startsWith('nappe.') ? AMGT4CEM_NappeSelectionStore : AMGT4CEM_UrbisTopoSelectionStore;
  },

  _valid(v) {
    v = Math.round(Number(v));
    return Number.isFinite(v) && v >= this.MIN && v <= this.MAX ? v : null;
  },

  /** 40000 -> « 1:40 000 » (espace insécable). */
  format(n) {
    return `1:${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
  },

  /** Échelle (dénominateur) choisie dans `extra`, ancien numéro de zoom converti compris ; null si personne n'en a choisi. */
  _lire(extra, id) {
    const e = this._valid(((extra || {}).echelle || {})[id]);
    if (e !== null) return e;
    const z = Number(((extra || {}).zoom || {})[id]);
    return Number.isFinite(z) && z >= 8 && z <= 22 ? AMGT4CEM_LambertGrid.echelleDepuisZoomMercator(z) : null;
  },

  /** Seuil de `id` (ex. 'nappe.isopieses') en dénominateur d'échelle, ou `fallback` si personne n'en a choisi. */
  get(id, fallback) {
    const v = this._lire(this._store(id).getExtra(), id);
    return v === null ? fallback : v;
  },

  /** Seuil choisi dans `extra` (appareil, brouillon…), ou `fallback`. */
  from(extra, id, fallback) {
    const v = this._lire(extra, id);
    return v === null ? fallback : v;
  },

  /** La carte est-elle assez détaillée pour afficher `id` ? */
  visible(map, id, fallback) {
    return AMGT4CEM_LambertGrid.auMoinsDetaillee(map, this.get(id, fallback));
  },

  /** Écrit le seuil `id` dans `extra` (champ `echelle`) ; efface l'ancien champ `zoom` de cet identifiant. */
  _ecrire(extra, id, value) {
    const echelle = { ...(extra.echelle || {}) };
    const zoom = { ...(extra.zoom || {}) };
    const v = this._valid(value);
    if (v === null) delete echelle[id]; else echelle[id] = v;
    delete zoom[id];
    return { echelle, zoom };
  },

  /** Seuil de l'appareil : change tout de suite l'affichage. */
  set(id, value) {
    const store = this._store(id);
    const { echelle, zoom } = this._ecrire(store.getExtra(), id, value);
    store.setExtraValue('echelle', echelle);
    store.setExtraValue('zoom', zoom);
    this._listeners.forEach((fn) => fn(id));
  },

  onChange(fn) { this._listeners.push(fn); },

  /**
   * Ligne « Afficher à partir de l'échelle » pour un sélecteur : liste (1:50 000 à 1:1 000) + « Autre valeur… » qui
   * ouvre un champ libre. `picker.draftExtra()` renvoie le brouillon des réglages par défaut partagés en cours d'édition
   * administrateur (sinon null) : la valeur y est lue et écrite à la place de l'appareil.
   * `row.refresh()` relit la valeur (à appeler quand le sélecteur change de mode).
   */
  buildControl(id, fallback, label, picker, opts = {}) {
    const row = document.createElement('div');
    row.className = 'amgt-zoom-threshold' + (opts.inline ? ' amgt-zoom-threshold--inline' : '');
    const lab = document.createElement('label');
    lab.textContent = `${label || "Afficher à partir de l'échelle"} `;
    const select = document.createElement('select');
    for (const n of this.LISTE) {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = this.format(n);
      select.append(o);
    }
    const autre = document.createElement('option');
    autre.value = 'autre';
    autre.textContent = 'Autre valeur…';
    select.append(autre);
    const libre = document.createElement('span');
    libre.className = 'amgt-zoom-threshold__libre';
    libre.append(document.createTextNode('1 : '));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(this.MIN);
    input.max = String(this.MAX);
    input.step = '1';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', 'Échelle personnalisée');
    libre.append(input);
    const erreur = document.createElement('div');
    erreur.className = 'amgt-zoom-threshold__erreur';
    const draft = () => (picker && picker.draftExtra && picker.draftExtra()) || null;
    const current = () => {
      const d = draft();
      return d ? this.from(d, id, fallback) : this.get(id, fallback);
    };
    const ecrire = (v) => {
      const d = draft();
      if (d) { const r = this._ecrire(d, id, v); d.echelle = r.echelle; d.zoom = r.zoom; } else this.set(id, v);
    };
    row.refresh = () => {
      const v = current();
      const dansListe = this.LISTE.includes(v);
      select.value = dansListe ? String(v) : 'autre';
      input.value = String(v);
      libre.hidden = select.value !== 'autre';
      erreur.textContent = '';
    };
    select.addEventListener('change', () => {
      if (select.value === 'autre') { libre.hidden = false; input.focus(); return; }
      ecrire(Number(select.value));
      row.refresh();
    });
    input.addEventListener('change', () => {
      const v = this._valid(input.value);
      if (v === null) {
        erreur.textContent = `Entrez une échelle entre ${this.format(this.MIN)} et ${this.format(this.MAX)}.`;
        return;
      }
      ecrire(v);
      row.refresh();
      if (!this.LISTE.includes(v)) { select.value = 'autre'; libre.hidden = false; }
    });
    lab.append(select);
    row.append(lab, libre, erreur);
    row.refresh();
    return row;
  },
};
