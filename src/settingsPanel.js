/**
 * Fenêtre "⚙ Paramètres" à onglets (ouverte par l'engrenage du menu ☰ Carte).
 *
 * RÉSERVÉE AUX ADMINISTRATEURS : l'ouverture passe par
 * AMGT4CEM_Admin.requestAccess() (src/admin.js), où se branchera le mot de
 * passe administrateur — pas encore implémenté, accès ouvert pour l'instant.
 *
 * Ce sont des paramètres GÉNÉRAUX, pas des réglages de l'appareil : enregistrés
 * sur le serveur (data/fonds-de-plan/, via le relais d'enregistrement),
 * communs à tous les visiteurs, appliqués au démarrage (voir services.js).
 * Rien n'est gardé dans le navigateur, hormis le code administrateur, le temps
 * de l'onglet (sessionStorage), pour s'identifier auprès du relais.
 *
 * 1. Sources : adresses des services externes (UrbIS, orthophotos, géocodeur
 *    d'adresses), à corriger si l'un d'eux venait à changer d'adresse.
 * 2. Serveur : adresse du relais d'enregistrement (la communication de
 *    l'interface avec le serveur qui modifie les données) et code
 *    administrateur ; bouton Tester. Enregistrer envoie TOUS les paramètres
 *    généraux (onglets Sources et Serveur).
 * 3. Données : modifications des données — lancement du mode
 *    édition des étiquettes de planche et de tronçon (plugin
 *    src/peLabelEditor/, chargé à la demande) ; chargement d'un nouveau shapefile : à venir.
 *
 * Exclusif avec le menu "☰ Carte" (un seul panneau ouvert à la fois, même
 * position à l'écran) — voir mapMenu.js pour la réciproque.
 */
const AMGT4CEM_SettingsPanel = {
  _panel: null,

  init() {
    const btn = document.getElementById('amgt-settings-btn');
    const panel = document.getElementById('amgt-settings-panel');
    const menuPanel = document.getElementById('amgt-map-menu');
    this._panel = panel;

    this._initTabs(panel);
    this._initSourcesTab();
    this._initServerTab();
    this._initBasemapsTab(panel);

    const toggle = async () => {
      if (!panel.classList.contains('amgt-hidden')) {
        panel.classList.add('amgt-hidden');
        return;
      }
      // Accès administrateur (futur mot de passe) : sans lui, la fenêtre ne s'ouvre pas.
      if (!(await AMGT4CEM_Admin.requestAccess())) return;
      menuPanel.classList.add('amgt-hidden');
      this._fillFields();
      panel.classList.remove('amgt-hidden');
    };
    btn.addEventListener('click', toggle);

    document.addEventListener('click', (e) => {
      if (panel.classList.contains('amgt-hidden')) return;
      if (panel.contains(e.target) || e.target === btn) return;
      panel.classList.add('amgt-hidden');
    });
  },

  // ---- Onglets -------------------------------------------------------------

  _initTabs(panel) {
    const show = (name) => {
      for (const tab of panel.querySelectorAll('.amgt-tab')) {
        const active = tab.dataset.tab === name;
        tab.classList.toggle('amgt-tab--active', active);
        tab.setAttribute('aria-selected', String(active));
      }
      for (const pane of panel.querySelectorAll('.amgt-tab-pane')) pane.classList.toggle('amgt-hidden', pane.dataset.pane !== name);
    };
    this._showTab = show;
    for (const tab of panel.querySelectorAll('.amgt-tab')) tab.addEventListener('click', () => show(tab.dataset.tab));
    show('sources');
  },

  // ---- Champs (paramètres généraux) ------------------------------------------

  _fields() {
    return {
      urbisUrl: document.getElementById('amgt-settings-urbis-url'),
      urbisLayers: document.getElementById('amgt-settings-urbis-layers'),
      brucielHistoriqueUrl: document.getElementById('amgt-settings-bruciel-hist-url'),
      brucielRecentUrl: document.getElementById('amgt-settings-bruciel-recent-url'),
      flandreUrl: document.getElementById('amgt-settings-flandre-url'),
      geocoderUrl: document.getElementById('amgt-settings-geocoder-url'),
      relayUrl: document.getElementById('amgt-settings-relay-url'),
    };
  },

  /** Remplit les champs avec les valeurs en vigueur (défauts de config.js + paramètres généraux). */
  _fillFields() {
    const current = AMGT4CEM_Services.current();
    for (const [key, input] of Object.entries(this._fields())) input.value = current[key] || '';
    this._showCodeState();
    this._status('sources', '');
    this._status('relay', '');
  },

  /**
   * Le champ du code reste TOUJOURS vide : y afficher le code mémorisé
   * (même masqué) révélerait sa longueur. Un texte fixe indique seulement
   * qu'un code est déjà gardé pour cet onglet ; champ vide = on l'utilise.
   */
  _showCodeState() {
    const input = document.getElementById('amgt-settings-admin-code');
    input.value = '';
    input.placeholder = AMGT4CEM_PeLabelAnchors.getAdminCode() ? 'Code déjà saisi (laisser vide pour le garder)' : 'Code administrateur';
  },

  /** Code saisi dans le champ, sinon celui gardé pour cet onglet. */
  _adminCode() {
    return document.getElementById('amgt-settings-admin-code').value.trim() || AMGT4CEM_PeLabelAnchors.getAdminCode();
  },

  _status(which, message, kind) {
    const el = document.getElementById(which === 'relay' ? 'amgt-settings-relay-status' : 'amgt-settings-sources-status');
    el.textContent = message;
    el.hidden = !message;
    el.className = `amgt-settings-status${kind ? ` amgt-settings-status--${kind}` : ''}`;
  },

  /**
   * Enregistre TOUS les paramètres généraux sur le serveur, via le relais.
   * L'adresse du relais utilisée est celle du champ (c'est ainsi qu'on
   * l'enregistre la toute première fois, avant qu'elle soit connue de tous).
   * @param {'sources'|'relay'} which - où afficher le résultat
   */
  async _saveAll(which) {
    const fields = this._fields();
    const values = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()]));
    const code = this._adminCode();
    const relayUrl = values.relayUrl || AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl;
    if (!relayUrl || !code) {
      this._showTab('server');
      this._status('relay', "Pour enregistrer sur le serveur : renseigner l'adresse du relais et le code administrateur.", 'error');
      return;
    }
    this._status(which, 'Enregistrement sur le serveur…');
    try {
      await AMGT4CEM_Services.save(values, relayUrl, code);
      AMGT4CEM_PeLabelAnchors.setAdminCode(code);
      this._showCodeState();
      this._status(which, 'Enregistré sur le serveur. Appliqué à tous les visiteurs après le redéploiement du site (~1 min) ; rechargez ensuite la page.', 'ok');
    } catch (err) {
      AMGT4CEM_PeLabelAnchors.setAdminCode(''); // un code refusé ne doit pas rester en mémoire
      this._showCodeState();
      this._status(which, err.message, 'error');
    }
  },

  // ---- 1. Sources ----------------------------------------------------------

  _initSourcesTab() {
    document.getElementById('amgt-settings-save').addEventListener('click', () => this._saveAll('sources'));
  },

  // ---- 2. Serveur ----------------------------------------------------------

  _initServerTab() {
    const fields = this._fields();

    document.getElementById('amgt-settings-relay-save').addEventListener('click', () => this._saveAll('relay'));

    document.getElementById('amgt-settings-relay-test').addEventListener('click', async () => {
      this._status('relay', 'Test en cours…');
      try {
        this._status('relay', await AMGT4CEM_PeLabelAnchors.checkConnection(fields.relayUrl.value.trim(), this._adminCode()), 'ok');
      } catch (err) {
        this._status('relay', err.message, 'error');
      }
    });
  },

  // ---- 3. Données ----------------------------------------------------

  _initBasemapsTab(panel) {
    document.getElementById('amgt-settings-edit-labels').addEventListener('click', () => {
      panel.classList.add('amgt-hidden');
      this._launchLabelEditor();
    });
  },

  /**
   * Lance le mode édition des étiquettes (références de planche ET numéros
   * d'interstation, un seul mode) : affiche les couches « Plans d'ensemble » et
   * « Numéros interstation » (les étiquettes n'existent à l'écran que si elles
   * le sont), charge le plugin src/peLabelEditor/ à la demande (une
   * seule fois), puis ouvre son panneau de suivi (l'aide).
   */
  _launchLabelEditor() {
    for (const layerId of ['plans-ensemble-500e', 'numero-interstation']) {
      if (!AMGT4CEM_PatrimoineSelectionStore.getSelection()[layerId]) AMGT4CEM_PatrimoineSelectionStore.toggle(layerId);
    }

    const open = () => {
      // Les étiquettes sont ajoutées à la carte de façon asynchrone (patrimoineLayer.refresh) : le plugin les cherche lui-même jusqu'à les trouver.
      window.AMGT4CEM_PeLabelEditor.open();
    };
    if (window.AMGT4CEM_PeLabelEditor) return open();

    const base = './src/peLabelEditor/';
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${base}pe-label-editor.css`;
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = `${base}pe-label-editor.js`;
    script.onload = open;
    script.onerror = () => alert("Impossible de charger l'outil d'édition des étiquettes (src/peLabelEditor/).");
    document.body.appendChild(script);
  },

  /** Appelé par mapMenu.js pour fermer ce panneau quand l'autre s'ouvre. */
  close() {
    document.getElementById('amgt-settings-panel').classList.add('amgt-hidden');
  },
};
