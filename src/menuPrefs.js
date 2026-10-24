/**
 * Affichage du menu ☰ Carte : couches cochées et opacités.
 *
 *  - DERNIERS RÉGLAGES UTILISÉS : enregistrés automatiquement sur l'appareil à chaque changement fait par
 *    l'utilisateur, et repris au démarrage.
 *  - AFFICHAGE PAR DÉFAUT PARTAGÉ (appareil sans réglage enregistré : première visite, données effacées) :
 *      · utilisateurs NON connectés : config/fonds-de-plan/menu-par-defaut.json ;
 *      · utilisateurs connectés     : config/fonds-de-plan/menu-par-defaut-connectes.json (à défaut, le précédent).
 *    La disquette à côté de « Réinitialiser la vue » enregistre l'affichage actuel : pour les non connectés après
 *    validation par le code administrateur ; pour un administrateur connecté, pour tous les utilisateurs connectés.
 *    L'écriture passe par le relais (code administrateur), le fichier est visible par tous après redéploiement du site.
 * Au démarrage, l'opacité d'une couche n'est reprise que si le curseur de cette couche n'a pas déjà été réglé sur l'appareil.
 */
const AMGT4CEM_MenuPrefs = {
  _lastKey: 'amgt4cem.menu-prefs.v1',
  _files: {
    public: { url: './config/fonds-de-plan/menu-par-defaut.json', route: 'shared/fonds-de-plan/menu-par-defaut' },
    connectes: { url: './config/fonds-de-plan/menu-par-defaut-connectes.json', route: 'shared/fonds-de-plan/menu-par-defaut-connectes' },
  },
  _shared: { public: null, connectes: null },

  async _loadOne(kind) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(this._files[kind].url, { cache: 'no-cache', signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        const json = (await response.json()) || {};
        if (json.layers || json.opacity) this._shared[kind] = { layers: json.layers || {}, opacity: json.opacity || {} };
      }
    } catch (err) {
      console.warn(`[AMGT4CEM] Affichage par défaut (${kind}) illisible, ignoré :`, err);
    }
  },

  /** Lit les fichiers partagés ; ne rejette jamais. */
  async loadShared() {
    await Promise.all([this._loadOne('public'), this._loadOne('connectes')]);
  },

  _last() {
    try {
      const raw = localStorage.getItem(this._lastKey);
      if (raw) return JSON.parse(raw);
    } catch (err) { /* illisible : ignoré */ }
    return null;
  },

  _connected() {
    return typeof AMGT4CEM_Auth !== 'undefined' && !!AMGT4CEM_Auth.session();
  },

  /** Affichage par défaut qui s'applique à cet utilisateur. */
  _defaultState() {
    return this._connected() ? this._shared.connectes || this._shared.public : this._shared.public;
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
    const state = this._last() || this._defaultState();
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

  _saveLast() {
    try { localStorage.setItem(this._lastKey, JSON.stringify(this.capture())); } catch (err) { /* valable pour la session */ }
  },

  /** Écriture dans le fichier partagé `kind` ('public' | 'connectes') par le relais. */
  async _saveShared(kind, code) {
    const state = this.capture();
    await AMGT4CEM_PeLabelAnchors.putToRelay(AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl, this._files[kind].route, { version: 1, ...state }, code);
    this._shared[kind] = state;
  },

  initUi() {
    // Derniers réglages utilisés : enregistrés à chaque changement fait par l'utilisateur (pas par l'application).
    document.addEventListener('change', (e) => {
      if (e.isTrusted && e.target.matches && e.target.matches('input[type="checkbox"][id^="amgt-layer-"]')) this._saveLast();
    });
    document.addEventListener('input', (e) => {
      if (e.isTrusted && e.target.matches && e.target.matches('.amgt-opacity-slider')) this._saveLast();
    });

    const btn = document.getElementById('amgt-menu-prefs-save');
    const zone = document.getElementById('amgt-menu-prefs-code');
    if (!btn || !zone) return;
    const isAdmin = () => typeof AMGT4CEM_Admin !== 'undefined' && AMGT4CEM_Admin.isAdmin();
    const kind = () => (isAdmin() ? 'connectes' : 'public');

    // Visible pour un visiteur non connecté (validation par code) et pour un administrateur connecté ; pas pour un autre compte.
    const refresh = () => {
      const show = !this._connected() || isAdmin();
      btn.classList.toggle('amgt-hidden', !show);
      btn.title = isAdmin()
        ? "Enregistrer l'affichage actuel comme affichage par défaut de tous les utilisateurs connectés"
        : "Enregistrer l'affichage actuel comme affichage par défaut des utilisateurs non connectés (code administrateur requis)";
      zone.classList.add('amgt-hidden');
    };
    refresh();
    if (typeof AMGT4CEM_Auth !== 'undefined') AMGT4CEM_Auth.onChange(refresh);

    const say = (text, isError) => {
      zone.textContent = '';
      zone.classList.remove('amgt-hidden');
      const p = document.createElement('p');
      p.textContent = text;
      if (isError) p.className = 'amgt-menu-prefs__err';
      zone.append(p);
    };

    const save = async (code) => {
      const problem = AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl ? '' : 'Adresse du relais non renseignée (⚙ Paramètres > Serveur) : enregistrement impossible.';
      if (problem) return say(problem, true);
      say('Vérification…');
      try {
        await AMGT4CEM_PeLabelAnchors.checkConnection(AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl, code);
        AMGT4CEM_PeLabelAnchors.setAdminCode(code);
        await this._saveShared(kind(), code);
      } catch (err) {
        AMGT4CEM_PeLabelAnchors.setAdminCode('');
        return say(err.message, true);
      }
      say(kind() === 'connectes'
        ? '✓ Affichage enregistré pour les utilisateurs connectés (visible après le redéploiement du site, environ 1 minute).'
        : '✓ Affichage enregistré pour les utilisateurs non connectés (visible après le redéploiement du site, environ 1 minute).');
    };

    btn.addEventListener('click', () => {
      const known = AMGT4CEM_PeLabelAnchors.getAdminCode();
      if (known) return save(known); // code déjà validé dans cet onglet
      zone.textContent = '';
      zone.classList.remove('amgt-hidden');
      const row = document.createElement('div');
      row.className = 'amgt-menu-prefs__row';
      const input = document.createElement('input');
      input.type = 'password';
      input.placeholder = 'Code administrateur';
      input.autocomplete = 'off';
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'amgt-btn amgt-btn--primary';
      go.textContent = 'Valider';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'amgt-btn';
      cancel.textContent = 'Annuler';
      const submit = () => (input.value.trim() ? save(input.value.trim()) : say('Saisir le code administrateur.', true));
      go.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      cancel.addEventListener('click', () => zone.classList.add('amgt-hidden'));
      row.append(input, go, cancel);
      zone.append(row);
      input.focus();
    });
  },
};
