/**
 * Fenêtre "⚙ Paramètres" à onglets (ouverte par l'engrenage du menu ☰ Carte,
 * ou par le lien « Sources, serveur, fonds de plan » du même menu) :
 *
 * 1. Sources : corriger les URLs des services externes (UrbIS, orthophotos,
 *    géocodeur d'adresses) si l'un d'eux venait à changer d'adresse, sans
 *    devoir modifier config.js.
 * 2. Serveur (administrateurs) : adresse du relais d'enregistrement et code
 *    administrateur — la communication avec le serveur qui écrit dans le
 *    dépôt les modifications faites dans l'application (voir
 *    peLabelAnchors.js et relay/README.md).
 * 3. Fonds de plan (administrateurs) : modifications des données de fond —
 *    lancement du mode édition des étiquettes de planche (plugin
 *    plugins/pe-label-editor/, chargé à la demande) ; chargement d'un
 *    nouveau shapefile : à venir.
 *
 * Les onglets 2 et 3 n'existent que si AMGT4CEM_CONFIG.adminMode (point de
 * branchement du futur mode « édition »).
 *
 * Exclusif avec le menu "☰ Carte" (un seul panneau ouvert à la fois, même
 * position à l'écran) — voir mapMenu.js pour la réciproque.
 */
const AMGT4CEM_SettingsPanel = {
  _panel: null,

  init() {
    const btn = document.getElementById('amgt-settings-btn');
    const link = document.getElementById('amgt-open-settings-link');
    const panel = document.getElementById('amgt-settings-panel');
    const menuPanel = document.getElementById('amgt-map-menu');
    this._panel = panel;

    this._initTabs(panel);
    this._initSourcesTab();
    this._initServerTab();
    this._initBasemapsTab(panel);

    const fillFields = () => {
      this._fillSources();
      this._fillServer();
    };
    const toggle = () => {
      const opening = panel.classList.contains('amgt-hidden');
      menuPanel.classList.add('amgt-hidden');
      panel.classList.toggle('amgt-hidden');
      if (opening) fillFields();
    };
    btn.addEventListener('click', toggle);
    link.addEventListener('click', toggle);

    document.addEventListener('click', (e) => {
      if (panel.classList.contains('amgt-hidden')) return;
      if (panel.contains(e.target) || e.target === btn || e.target === link) return;
      panel.classList.add('amgt-hidden');
    });
  },

  // ---- Onglets -------------------------------------------------------------

  _initTabs(panel) {
    const tabs = Array.from(panel.querySelectorAll('.amgt-tab'));
    // Onglets réservés aux administrateurs : absents (pas seulement masqués) pour les autres.
    if (!AMGT4CEM_CONFIG.adminMode) {
      for (const tab of panel.querySelectorAll('.amgt-tab--admin')) tab.remove();
      for (const pane of panel.querySelectorAll('[data-pane="server"], [data-pane="basemaps"]')) pane.remove();
    }
    const show = (name) => {
      for (const tab of panel.querySelectorAll('.amgt-tab')) {
        const active = tab.dataset.tab === name;
        tab.classList.toggle('amgt-tab--active', active);
        tab.setAttribute('aria-selected', String(active));
      }
      for (const pane of panel.querySelectorAll('.amgt-tab-pane')) pane.classList.toggle('amgt-hidden', pane.dataset.pane !== name);
    };
    for (const tab of tabs) tab.addEventListener('click', () => show(tab.dataset.tab));
    show('sources');
  },

  // ---- 1. Sources ----------------------------------------------------------

  _sourceFields() {
    return {
      urbisUrl: document.getElementById('amgt-settings-urbis-url'),
      urbisLayers: document.getElementById('amgt-settings-urbis-layers'),
      brucielHistoriqueUrl: document.getElementById('amgt-settings-bruciel-hist-url'),
      brucielRecentUrl: document.getElementById('amgt-settings-bruciel-recent-url'),
      geocoderUrl: document.getElementById('amgt-settings-geocoder-url'),
    };
  },

  _fillSources() {
    const fields = this._sourceFields();
    const histEntry = AMGT4CEM_CONFIG.basemaps.bruciel.entries.find((e) => e.year <= 1996);
    const recentEntry = AMGT4CEM_CONFIG.basemaps.bruciel.entries.find((e) => e.year >= 2004);
    fields.urbisUrl.value = AMGT4CEM_CONFIG.basemaps.urbis.url;
    fields.urbisLayers.value = AMGT4CEM_CONFIG.basemaps.urbis.layers;
    fields.brucielHistoriqueUrl.value = histEntry ? histEntry.url : '';
    fields.brucielRecentUrl.value = recentEntry ? recentEntry.url : '';
    fields.geocoderUrl.value = AMGT4CEM_CONFIG.geocoder.url;
  },

  _initSourcesTab() {
    const fields = this._sourceFields();
    document.getElementById('amgt-settings-save').addEventListener('click', () => {
      AMGT4CEM_SettingsStore.save({
        urbisUrl: fields.urbisUrl.value.trim(),
        urbisLayers: fields.urbisLayers.value.trim(),
        brucielHistoriqueUrl: fields.brucielHistoriqueUrl.value.trim(),
        brucielRecentUrl: fields.brucielRecentUrl.value.trim(),
        geocoderUrl: fields.geocoderUrl.value.trim(),
      });
      // Un rechargement garantit que toutes les couches déjà construites
      // (basemap.js les prépare une fois à l'init) repartent bien des
      // nouvelles URLs, plutôt que de tenter une mise à jour à chaud partielle.
      alert('Paramètres enregistrés. La page va se recharger pour les appliquer.');
      window.location.reload();
    });

    document.getElementById('amgt-settings-reset').addEventListener('click', () => {
      if (!confirm('Revenir aux adresses de service par défaut de l\'application ?')) return;
      // Seulement les adresses de cet onglet : l'adresse du relais (onglet Serveur) est conservée.
      AMGT4CEM_SettingsStore.reset(Object.keys(fields));
      window.location.reload();
    });
  },

  // ---- 2. Serveur ----------------------------------------------------------

  _fillServer() {
    const url = document.getElementById('amgt-settings-relay-url');
    const code = document.getElementById('amgt-settings-admin-code');
    if (!url) return; // onglet absent (pas administrateur)
    url.value = AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl || '';
    code.value = AMGT4CEM_PeLabelAnchors.getAdminCode();
    this._serverStatus('');
  },

  _serverStatus(message, kind) {
    const el = document.getElementById('amgt-settings-relay-status');
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
    el.className = `amgt-settings-status${kind ? ` amgt-settings-status--${kind}` : ''}`;
  },

  _initServerTab() {
    const url = document.getElementById('amgt-settings-relay-url');
    if (!url) return; // onglet absent (pas administrateur)
    const code = document.getElementById('amgt-settings-admin-code');

    document.getElementById('amgt-settings-relay-save').addEventListener('click', () => {
      const value = url.value.trim();
      AMGT4CEM_SettingsStore.save({ relayUrl: value });
      // Prise en compte immédiate (rien n'est construit à partir de cette valeur au démarrage) ;
      // vide : retour à la valeur de config.js.
      AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl = value || AMGT4CEM_SettingsStore.defaultRelayUrl;
      AMGT4CEM_PeLabelAnchors.setAdminCode(code.value.trim());
      this._serverStatus('Enregistré sur cet appareil (adresse) et pour cet onglet (code).', 'ok');
    });

    document.getElementById('amgt-settings-relay-reset').addEventListener('click', () => {
      AMGT4CEM_SettingsStore.reset(['relayUrl']);
      AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl = AMGT4CEM_SettingsStore.defaultRelayUrl;
      AMGT4CEM_PeLabelAnchors.setAdminCode('');
      this._fillServer();
      this._serverStatus('Adresse et code réinitialisés.');
    });

    document.getElementById('amgt-settings-relay-test').addEventListener('click', async () => {
      this._serverStatus('Test en cours…');
      try {
        this._serverStatus(await AMGT4CEM_PeLabelAnchors.checkConnection(url.value.trim(), code.value.trim()), 'ok');
      } catch (err) {
        this._serverStatus(err.message, 'error');
      }
    });
  },

  // ---- 3. Fonds de plan ----------------------------------------------------

  _initBasemapsTab(panel) {
    const btn = document.getElementById('amgt-settings-edit-labels');
    if (!btn) return; // onglet absent (pas administrateur)
    btn.addEventListener('click', () => {
      panel.classList.add('amgt-hidden');
      this._launchLabelEditor();
    });
  },

  /**
   * Lance le mode édition des étiquettes de planche : affiche la couche
   * « Plans d'ensemble » (les étiquettes n'existent à l'écran que si elle
   * l'est), charge le plugin plugins/pe-label-editor/ à la demande (une
   * seule fois), puis ouvre son panneau.
   */
  _launchLabelEditor() {
    const layerId = 'plans-ensemble-500e';
    if (!AMGT4CEM_PatrimoineSelectionStore.getSelection()[layerId]) AMGT4CEM_PatrimoineSelectionStore.toggle(layerId);

    const open = () => {
      // Les étiquettes sont ajoutées à la carte de façon asynchrone (patrimoineLayer.refresh) : le plugin les cherche lui-même jusqu'à les trouver.
      window.AMGT4CEM_PeLabelEditor.open();
    };
    if (window.AMGT4CEM_PeLabelEditor) return open();

    const base = './plugins/pe-label-editor/';
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${base}pe-label-editor.css`;
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = `${base}pe-label-editor.js`;
    script.onload = open;
    script.onerror = () => alert("Impossible de charger l'outil d'édition des étiquettes (plugins/pe-label-editor/).");
    document.body.appendChild(script);
  },

  /** Appelé par mapMenu.js pour fermer ce panneau quand l'autre s'ouvre. */
  close() {
    document.getElementById('amgt-settings-panel').classList.add('amgt-hidden');
  },
};
