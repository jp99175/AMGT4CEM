/**
 * Affichage du menu ☰ Carte « par défaut » : couches cochées et opacités. Deux niveaux, du plus prioritaire au moins :
 *  1. PRÉFÉRENCES LOCALES de l'appareil (bouton 💾 du menu) ;
 *  2. affichage PAR DÉFAUT PARTAGÉ (data/fonds-de-plan/menu-par-defaut.json), modifiable par un administrateur
 *     (barre « défaut administrateur » du menu, enregistrement par le relais).
 * Appliqués au démarrage : cases cochées toujours ; opacité seulement pour les couches dont l'appareil n'a pas déjà
 * réglé le curseur (le réglage courant de l'appareil reste prioritaire).
 */
const AMGT4CEM_MenuPrefs = {
  _prefKey: 'amgt4cem.menu-prefs.v1',
  _sharedUrl: './data/fonds-de-plan/menu-par-defaut.json',
  _sharedRoute: 'shared/fonds-de-plan/menu-par-defaut',
  _shared: null,
  _draft: null,
  _bar: null,

  /** Lit le fichier partagé ; ne rejette jamais (absent, illisible, lent : pas de défaut partagé). */
  async loadShared() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(this._sharedUrl, { cache: 'no-cache', signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        const json = (await response.json()) || {};
        if (json.layers || json.opacity) this._shared = { layers: json.layers || {}, opacity: json.opacity || {} };
      }
    } catch (err) {
      console.warn('[AMGT4CEM] Affichage par défaut du menu illisible, ignoré :', err);
    }
  },

  _local() {
    try {
      const raw = localStorage.getItem(this._prefKey);
      if (raw) return JSON.parse(raw);
    } catch (err) { /* illisible : ignoré */ }
    return null;
  },

  /** État actuellement affiché : { layers: {id: bool}, opacity: {couche: facteur} }. */
  capture() {
    const layers = {};
    document.querySelectorAll('input[type="checkbox"][id^="amgt-layer-"]').forEach((cb) => { layers[cb.id.replace('amgt-layer-', '')] = cb.checked; });
    const opacity = {};
    document.querySelectorAll('.amgt-opacity-slider-row[data-layer]').forEach((row) => {
      opacity[row.dataset.layer] = Number(row.querySelector('.amgt-opacity-slider').value) / 100;
    });
    return { layers, opacity };
  },

  /** À appeler une fois TOUTES les couches initialisées. */
  applyStartup() {
    const state = this._local() || this._shared;
    if (!state) return;
    for (const [name, on] of Object.entries(state.layers || {})) {
      const cb = document.getElementById(`amgt-layer-${name}`);
      if (cb && cb.checked !== Boolean(on)) { cb.checked = Boolean(on); cb.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    for (const [name, factor] of Object.entries(state.opacity || {})) {
      if (AMGT4CEM_LayerOpacityStore.has(name)) continue;
      const slider = document.querySelector(`.amgt-opacity-slider-row[data-layer="${name}"] .amgt-opacity-slider`);
      if (!slider) continue;
      slider.value = String(Math.round(Number(factor) * 100));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },

  saveLocal() {
    localStorage.setItem(this._prefKey, JSON.stringify(this.capture()));
  },

  /** Interface du menu : 💾 (appareil) et barre administrateur (défaut partagé). */
  initUi() {
    const saveBtn = document.getElementById('amgt-menu-prefs-save');
    const barEl = document.getElementById('amgt-menu-prefs-default-bar');
    if (!saveBtn || !barEl) return;
    const text = saveBtn.textContent;
    saveBtn.addEventListener('click', () => {
      this.saveLocal();
      saveBtn.textContent = '✓ Affichage enregistré sur cet appareil';
      setTimeout(() => { saveBtn.textContent = text; }, 1800);
    });
    this._bar = AMGT4CEM_PickerDefaultBar.attach(barEl, {
      labels: {
        idle: '🔒 Affichage par défaut pour tous (administrateur)',
        save: 'Enregistrer l’affichage actuel comme défaut',
        done: '✓ Affichage par défaut enregistré (visible par tous après le redéploiement du site, environ 1 minute).',
        editing: 'L’affichage actuel du menu (couches cochées, opacités) va devenir le défaut partagé : réglez-le puis enregistrez.',
      },
      start: () => { this._draft = true; },
      save: async (code) => {
        await AMGT4CEM_PeLabelAnchors.putToRelay(
          AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl,
          this._sharedRoute,
          { version: 1, ...this.capture() },
          code
        );
        this._shared = this.capture();
        this._draft = null;
      },
      cancel: () => { this._draft = null; },
    });
  },
};
