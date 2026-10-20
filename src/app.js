/**
 * Point d'entrée de l'application : assemble les modules (fond de plan,
 * couche Metro, signalements et demandes, outils de navigation et de création).
 */
(async function () {
  // Configuration des services externes et adresse du serveur d'enregistrement
  // (data/fonds-de-plan/, communes à tous, enregistrées sur le serveur — voir
  // services.js) : lue et assemblée dans AMGT4CEM_CONFIG AVANT que
  // basemap.js/searchTool.js ne la lisent. load() ne rejette jamais (délai borné).
  await AMGT4CEM_Services.load();
  // Sélections par défaut PARTAGÉES (UrbIS Topo, Plans patrimoine) : lues avant la création des couches, qui
  // en dépendent pour une première visite. Ne rejette jamais (délai borné).
  await Promise.all([AMGT4CEM_UrbisTopoSelectionStore.loadShared(), AMGT4CEM_PatrimoineSelectionStore.loadShared(), AMGT4CEM_OrthoSelectionStore.loadShared()]);

  const map = L.map('map', {
    // Pas de contrôle de zoom Leaflet : remplacé par la recherche en haut à
    // droite (voir searchTool.js). Le zoom reste possible à la molette, au
    // pincement et au double-clic.
    zoomControl: false,
    // Rendu Canvas plutôt que SVG pour toutes les couches vectorielles
    // (Métro, UrbIS Topo, Plans patrimoine, mesure...) : html2canvas
    // (screenshotTool.js) s'est montré peu fiable pour capturer du SVG
    // Leaflet en conditions réelles (tuiles de fond chargées, zoom serré,
    // beaucoup d'objets à l'écran) — cercle/segment de mesure ou couches
    // entières absents de la capture bien que visibles à l'écran — alors
    // qu'un <canvas> se recopie pixel pour pixel sans ambiguïté. Popups et
    // interactivité (clic sur une station, un tunnel...) restent
    // pleinement fonctionnels avec ce mode, Leaflet gérant lui-même la
    // détection de clic sur les couches canvas.
    preferCanvas: true,
    // Attribution ajoutée "à la main" juste après (et non automatiquement
    // ici) : pour un coin bas, Leaflet insère chaque nouveau contrôle
    // au-dessus des précédents (voir Control.addTo), donc l'ordre d'ajout
    // détermine l'empilement visuel. On ajoute le repère "BUILD..." APRÈS
    // l'attribution pour qu'il apparaisse au-dessus (voir plus bas).
    attributionControl: false,
    maxZoom: AMGT4CEM_CONFIG.maxZoom,
    // Vue par défaut le temps que les données soient chargées (recentrée ensuite
    // sur l'emprise réelle du réseau).
    center: [50.85, 4.35],
    zoom: 12,
  });
  AMGT4CEM_SearchTool.init(map);

  // Retire le lien "Leaflet" du contrôle d'attribution (sans obligation légale :
  // la licence BSD-2-Clause de Leaflet n'exige pas d'affichage à l'écran, voir
  // README). Les attributions des sources de données (UrbIS, Bruciel...)
  // restent affichées, elles. Créé ici, AVANT l'ajout des fonds de plan, pour
  // que leurs attributions (passées en option des couches) soient bien
  // captées par ce contrôle.
  map.attributionControl = L.control.attribution({ prefix: false }).addTo(map);
  // Ajouté APRÈS l'attribution (voir commentaire sur attributionControl ci-dessus : pour un coin bas,
  // le dernier contrôle ajouté s'empile au-dessus) : le repère BUILD apparaît au-dessus de "(c) CIRB - UrbIS".
  AMGT4CEM_BuildInfoControl.init(map);

  AMGT4CEM_Basemap.init(map);
  AMGT4CEM_Basemap.showUrbis();

  AMGT4CEM_ScaleControl.init(map);
  AMGT4CEM_CreditsLayout.init(map); // après l'échelle et les crédits : mesure leur largeur
  AMGT4CEM_ScaledText.initMap(map);
  const pointsGroup = AMGT4CEM_SignalementsLayer.init(map); // signalements et demandes (ex-« points métier »)
  AMGT4CEM_UrbisTopoLayer.init(map);
  AMGT4CEM_UrbisTopoPicker.init();
  AMGT4CEM_Interstation.init(); // charge les numéros d'interstation (associés aux tunnels dans AMGT4CEM_Network.build)
  AMGT4CEM_PatrimoineLayer.init(map);
  AMGT4CEM_PatrimoinePicker.init();
  AMGT4CEM_OrthoPicker.init(); // les orthophotos configurées sont lues à l'ouverture de l'écran

  let metroBounds = null;

  AMGT4CEM_MapMenu.init({
    map,
    pointsGroup,
    getMetroBounds: () => metroBounds,
  });
  AMGT4CEM_SettingsPanel.init();

  AMGT4CEM_AddPointTool.init(map, {
    onPointCreated() {
      AMGT4CEM_SignalementsLayer.refresh();
    },
  });
  AMGT4CEM_MeasureTool.init(map);
  AMGT4CEM_ScreenshotTool.init(map);

  // Plugins (applications séparées, voir src/plugins.js) : après les outils du cœur, qu'ils peuvent arrêter.
  AMGT4CEM_Plugins.init({
    map,
    deactivateCoreTools() {
      AMGT4CEM_AddPointTool.deactivate();
      AMGT4CEM_MeasureTool.deactivate();
    },
  });

  /** Message bloquant (bandeau) : les données ne se lisent que servies par HTTP. */
  function showLoadError(message) {
    const banner = document.getElementById('amgt-load-error');
    banner.textContent = message;
    banner.classList.remove('amgt-hidden');
  }

  // Couche Métro selon la connexion :
  //  - personne n'est connecté : couche PUBLIQUE de la Région (stations et tunnels, copie de secours du dépôt si la
  //    Région ne répond pas), voir src/metroPublicLayer.js ; ni planches ni référentiel ;
  //  - un compte est connecté : couche corrigée (shapefile + référentiel) et planches « Plans patrimoine »,
  //    voir src/network.js.
  // Elle est relue sans recharger la page à chaque connexion ou déconnexion (voir plus bas).
  let networkMode = null; // 'prive' | 'public' : source actuellement affichée (null : rien d'affiché)
  let networkLayers = null; // groupes Leaflet du réseau affiché
  let networkToken = 0; // numéro de la dernière lecture demandée : une lecture périmée est jetée
  let networkFitted = false; // la vue a déjà été recentrée sur le réseau une première fois

  function wantedNetworkMode() {
    return AMGT4CEM_Auth.session() ? 'prive' : 'public';
  }

  /** Retire de la carte les couches d'un réseau (Stations, Tunnels, et planches de la source privée). */
  function discardNetwork(mode, layersByType) {
    if (!layersByType) return;
    for (const type of ['MS', 'MT']) if (layersByType[type]) map.removeLayer(layersByType[type]);
    if (mode === 'prive') AMGT4CEM_PatrimoineLayer.unregisterExternalLayer('plans-ensemble-500e');
  }

  /** Réseau construit : le menu (opacité), la recherche et la vue en dépendent. */
  function onNetworkBuilt(mode, { layersByType, bounds, searchIndex }) {
    networkMode = mode;
    networkLayers = layersByType;
    AMGT4CEM_MapMenu.setMetroLayers(layersByType);
    AMGT4CEM_SearchTool.setMetroIndex(searchIndex);

    // Case « Métro » décochée avant le changement de source : les nouvelles couches restent masquées.
    if (!document.getElementById('amgt-layer-metro').checked) {
      for (const type of ['MS', 'MT']) map.removeLayer(layersByType[type]);
    }

    metroBounds = bounds;
    // Recentrage seulement au premier affichage : un changement de source ne déplace pas la carte.
    if (!networkFitted && bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    networkFitted = true;
    document.getElementById('amgt-load-error').classList.add('amgt-hidden');
  }

  /**
   * « Plans patrimoine » et « Points métier » (signalements et demandes) sont réservés aux comptes connectés. Sans
   * connexion, ces deux couches n'apparaissent pas : rien n'est affiché ni lu, et leurs lignes du menu « Couches »
   * (titre, case, état, curseur d'opacité, lien « modifier la sélection ») et leurs sélecteurs sont masqués.
   * Le masquage du menu passe par `style.display` : la classe `amgt-hidden` des curseurs sert déjà à l'icône d'opacité.
   */
  function applyConnectionAccess(connected) {
    const show = (el) => { if (el) el.style.display = connected ? '' : 'none'; };

    AMGT4CEM_PatrimoineLayer.setAccess(connected);
    show(document.getElementById('amgt-layer-patrimoine').closest('.amgt-layer-row'));
    show(document.querySelector('.amgt-opacity-slider-row[data-layer="patrimoine"]'));
    if (!connected) AMGT4CEM_PatrimoinePicker.close();

    show(document.getElementById('amgt-points-heading'));
    show(document.getElementById('amgt-layer-points').closest('.amgt-layer-row'));
    show(document.getElementById('amgt-signalements-status'));
    show(document.querySelector('.amgt-opacity-slider-row[data-layer="points"]'));
    if (!connected) AMGT4CEM_SignalementsLayer.closePicker();
  }

  /** Affiche la source de réseau qui correspond à la connexion actuelle ; sans effet si c'est déjà elle. */
  function loadNetwork() {
    const mode = wantedNetworkMode();
    applyConnectionAccess(mode === 'prive');
    if (mode === networkMode) return;
    const token = ++networkToken;
    const loading = mode === 'prive' ? AMGT4CEM_Network.load(map) : AMGT4CEM_MetroPublicLayer.load(map);
    loading.then(
      (result) => {
        if (token !== networkToken) { // connexion ou déconnexion pendant la lecture : cette lecture est périmée
          discardNetwork(mode, result.layersByType);
          return;
        }
        discardNetwork(networkMode, networkLayers); // l'ancienne source (si elle existe) cède la place
        onNetworkBuilt(mode, result);
      },
      (err) => {
        if (token !== networkToken) return;
        console.error('[AMGT4CEM] Chargement des données impossible :', err);
        showLoadError(`Chargement des données impossible : ${err.message}`);
      }
    );
  }

  // Les shapefiles et JSON se lisent par fetch(), impossible en file:// (restriction des
  // navigateurs) : message clair, sans solution de repli.
  if (location.protocol === 'file:') {
    showLoadError('Cette application ne peut pas être ouverte directement depuis un fichier (file://). ' +
      'Servez le dossier par un petit serveur HTTP : « python3 -m http.server 8000 » dans le dossier, ' +
      'puis ouvrez http://localhost:8000/.');
  } else {
    loadNetwork();
    // Connexion, déconnexion ou session expirée (onglet redevenu actif, la session expire sans événement) :
    // la source du réseau suit.
    AMGT4CEM_Auth.onChange(loadNetwork);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadNetwork(); });
  }

  // « ✚ Ajouter un point » : lance « Point métier » directement, ou ouvre le menu si un plugin y a ajouté des entrées.
  AMGT4CEM_AddPointMenu.init(document.getElementById('amgt-add-point-btn'), {
    corePoint: () => {
      AMGT4CEM_MeasureTool.deactivate();
      AMGT4CEM_Plugins.notifyCoreToolActivated('add-point');
      AMGT4CEM_AddPointTool.toggle();
    },
  });

  // Icône de connexion : montre/masque « Ajouter un point » et « ⚙ Paramètres » selon le compte connecté.
  // Après une connexion ou une déconnexion, la couche des signalements (données privées) est relue.
  AMGT4CEM_AccountButton.init({ onChange: () => AMGT4CEM_SignalementsLayer.refresh() });

  document.getElementById('amgt-measure-btn').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.deactivate();
    AMGT4CEM_Plugins.notifyCoreToolActivated('measure');
    AMGT4CEM_MeasureTool.toggle();
  });

  document.getElementById('amgt-form-confirm').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.confirm();
  });

  document.getElementById('amgt-form-cancel').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.cancel();
  });
})();
