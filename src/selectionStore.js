/**
 * Sélection de couches/objets à afficher, commune aux sélecteurs « UrbIS Topo » et « Plans patrimoine »
 * (code ou id -> couleur). Trois niveaux, du plus prioritaire au moins prioritaire :
 *
 *  1. la sélection COURANTE de l'appareil (localStorage `key`), mise à jour à chaque case cochée ;
 *  2. les PRÉFÉRENCES LOCALES de l'utilisateur (localStorage `preferencesKey`), enregistrées par le
 *     bouton 💾 du sélecteur : utilisées quand il n'y a pas de sélection courante (première visite,
 *     données du navigateur effacées) ;
 *  3. la sélection PAR DÉFAUT PARTAGÉE (fichier du dépôt, `sharedUrl`, lu par tous), modifiable par un
 *     administrateur depuis le sélecteur et enregistrée via le relais (`sharedRoute`).
 *
 * `createSelectionStore` renvoie le magasin ; les fonctions `with*` sont pures (elles servent aussi à
 * éditer un brouillon, voir pickerDefaultBar.js).
 */
function createSelectionStore({ key, preferencesKey, sharedUrl, sharedRoute, palette, label }) {
  const store = {
    _listeners: [],
    _shared: {}, // sélection par défaut partagée (fichier du dépôt) ; {} si absente ou illisible

    // ---- Fonctions pures --------------------------------------------------------------------

    /** Couleur libre de la palette pour une nouvelle entrée de `selection`. */
    nextColor(selection) {
      const colors = palette();
      const used = new Set(Object.values(selection));
      const free = colors.find((c) => !used.has(c));
      return free || colors[Object.keys(selection).length % colors.length];
    },

    withToggle(selection, code) {
      const out = { ...selection };
      if (out[code]) delete out[code];
      else out[code] = this.nextColor(out);
      return out;
    },

    withMany(selection, codes) {
      const out = { ...selection };
      for (const code of codes) if (!out[code]) out[code] = this.nextColor(out);
      return out;
    },

    withoutMany(selection, codes) {
      const out = { ...selection };
      for (const code of codes) delete out[code];
      return out;
    },

    // ---- Sélection de l'appareil -------------------------------------------------------------

    /** @returns {Object<string,string>} code -> couleur (hex). */
    getSelection() {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
      } catch (err) {
        console.warn(`[AMGT4CEM] Sélection ${label} illisible, réinitialisée :`, err);
      }
      return this.getDefaultSelection();
    },

    /** Sélection de départ : préférences locales, sinon sélection par défaut partagée. */
    getDefaultSelection() {
      try {
        const raw = localStorage.getItem(preferencesKey);
        if (raw) return JSON.parse(raw);
      } catch (err) {
        console.warn(`[AMGT4CEM] Préférences ${label} illisibles, ignorées :`, err);
      }
      return { ...this._shared };
    },

    isSelected(code) {
      return code in this.getSelection();
    },

    toggle(code) {
      this._save(this.withToggle(this.getSelection(), code));
    },

    /** Sélectionne plusieurs codes d'un coup (case « tout cocher »). */
    selectMany(codes) {
      this._save(this.withMany(this.getSelection(), codes));
    },

    /** Désélectionne plusieurs codes d'un coup (case « tout décocher »). */
    deselectMany(codes) {
      this._save(this.withoutMany(this.getSelection(), codes));
    },

    /** Enregistre la sélection actuelle comme préférences locales de l'utilisateur (bouton 💾 du sélecteur). */
    saveCurrentAsDefault() {
      localStorage.setItem(preferencesKey, JSON.stringify(this.getSelection()));
    },

    _save(selection) {
      localStorage.setItem(key, JSON.stringify(selection));
      this._listeners.forEach((fn) => fn(selection));
    },

    /** Appelé (légende du menu + couche carte) à chaque changement de sélection. */
    onChange(fn) {
      this._listeners.push(fn);
    },

    // ---- Sélection par défaut partagée -------------------------------------------------------

    /** Lit le fichier partagé. N'échoue jamais (absent, illisible, lent : aucune sélection par défaut), délai borné. */
    async loadShared() {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const response = await fetch(sharedUrl, { cache: 'no-cache', signal: controller.signal });
        clearTimeout(timer);
        if (response.ok) this._shared = ((await response.json()) || {}).selection || {};
      } catch (err) {
        console.warn(`[AMGT4CEM] Sélection par défaut ${label} illisible, ignorée :`, err);
      }
      return this._shared;
    },

    getShared() {
      return { ...this._shared };
    },

    /**
     * Enregistre `selection` comme sélection par défaut PARTAGÉE (dépôt, via le relais).
     * Rejetée avec un Error au message lisible en cas d'échec.
     */
    async saveShared(selection, adminCode) {
      await AMGT4CEM_PeLabelAnchors.putToRelay(
        AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl,
        sharedRoute,
        { version: 1, selection },
        adminCode
      );
      const before = JSON.stringify(this.getSelection());
      this._shared = { ...selection };
      // Un appareil sans sélection ni préférences enregistrées voit sa sélection changer : la carte doit suivre.
      if (JSON.stringify(this.getSelection()) !== before) this._listeners.forEach((fn) => fn(this.getSelection()));
    },
  };
  return store;
}
