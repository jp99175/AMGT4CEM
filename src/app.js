/**
 * Point d'entrée de l'application : assemble les modules (fond de plan,
 * couche Metro, points métier, outils de navigation et de création).
 */
(async function () {
  // Paramètres généraux (adresses des services externes et du serveur
  // d'enregistrement, communs à tous, enregistrés sur le serveur — voir
  // settingsStore.js) : lus et appliqués AVANT que basemap.js/searchTool.js ne
  // lisent AMGT4CEM_CONFIG. load() ne rejette jamais (délai borné).
  await AMGT4CEM_SettingsStore.load();
  AMGT4CEM_SettingsStore.applyToConfig(AMGT4CEM_CONFIG);

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
  const pointsGroup = AMGT4CEM_PointsLayer.init(map);
  AMGT4CEM_UrbisTopoLayer.init(map);
  AMGT4CEM_UrbisTopoPicker.init();
  AMGT4CEM_Interstation.init(); // charge les numéros d'interstation (associés aux tunnels dans buildMetro)
  AMGT4CEM_PatrimoineLayer.init(map);
  AMGT4CEM_PatrimoinePicker.init();

  let metroBounds = null;

  AMGT4CEM_MapMenu.init({
    map,
    pointsGroup,
    getMetroBounds: () => metroBounds,
  });
  AMGT4CEM_SettingsPanel.init();

  AMGT4CEM_AddPointTool.init(map, {
    onPointCreated() {
      AMGT4CEM_PointsLayer.refresh();
    },
  });
  AMGT4CEM_MeasureTool.init(map);
  AMGT4CEM_ScreenshotTool.init(map);

  // Définitions d'ancrage des références de planche (fichier partagé, voir
  // peLabelAnchors.js) : lues en parallèle des géométries, attendues avant la
  // construction des étiquettes. Ne rejette jamais (absentes = aucune étiquette).
  const anchorsReady = AMGT4CEM_PeLabelAnchors.load();

  /** Repères legacy (triangles + codes de tronçon, sans identifiant) : facultatifs, jamais bloquants. */
  async function loadLegacyMarkers() {
    try {
      const response = await fetch(AMGT4CEM_CONFIG.reperesTronconsLegacyUrl);
      if (response.ok) return (await response.json()).features || [];
    } catch (err) {
      console.warn('[AMGT4CEM] Repères de tronçon (legacy) illisibles, ignorés :', err);
    }
    return [];
  }

  function buildMetro(features) {
    const { layersByType, bounds, searchIndex } = AMGT4CEM_MetroLayer.build({
      type: 'FeatureCollection',
      features,
    });
    // PE (planches), PE_label (référence de planche tracée dans l'emprise)
    // et PE_info (repères de transition entre tronçons) ne sont pas
    // ajoutées directement ici : leur visibilité est pilotée ensemble
    // depuis le sélecteur "Plans patrimoine" (voir plans-patrimoine.js,
    // entrée `external: true`, et patrimoineLayer.js#registerExternalLayer),
    // sous une seule case à cocher — d'où leur fusion dans un groupe
    // commun. Les polygones PE restent néanmoins ajoutés à ce groupe AVANT
    // MS/MT construits juste en dessous : ce sont de larges zones qui
    // recouvrent des stations/tunnels, elles ne doivent jamais passer
    // devant et intercepter leur clic (voir metroLayer.js et
    // patrimoineLayer.js#registerExternalLayer, bringToBack()).
    const peAndInfoGroup = L.layerGroup();
    layersByType.PE.eachLayer((l) => peAndInfoGroup.addLayer(l));
    layersByType.PE_label.eachLayer((l) => peAndInfoGroup.addLayer(l));
    layersByType.PE_info.eachLayer((l) => peAndInfoGroup.addLayer(l));
    layersByType.PE_info_text.eachLayer((l) => peAndInfoGroup.addLayer(l));
    AMGT4CEM_MetroLayer.setPeLabelDisplayGroup(peAndInfoGroup); // les références créées à l'exécution s'ajoutent aussi à ce groupe
    AMGT4CEM_PatrimoineLayer.registerExternalLayer('plans-ensemble-500e', peAndInfoGroup);
    AMGT4CEM_Interstation.setMetroFeatures(features); // rattache les numéros d'interstation à leur tronçon (genre « tunnel »)

    layersByType.MS.addTo(map);
    layersByType.MT.addTo(map);
    AMGT4CEM_MapMenu.setMetroLayers(layersByType);
    AMGT4CEM_SearchTool.setMetroIndex(searchIndex);

    metroBounds = bounds;
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
  }

  /** Message bloquant (bandeau) : les données ne se lisent que servies par HTTP. */
  function showLoadError(message) {
    const banner = document.getElementById('amgt-load-error');
    banner.textContent = message;
    banner.classList.remove('amgt-hidden');
  }

  // Les shapefiles et JSON se lisent par fetch(), impossible en file:// (restriction des
  // navigateurs) : message clair, sans solution de repli.
  if (location.protocol === 'file:') {
    showLoadError('Cette application ne peut pas être ouverte directement depuis un fichier (file://). ' +
      'Servez le dossier par un petit serveur HTTP : « python3 -m http.server 8000 » dans le dossier, ' +
      'puis ouvrez http://localhost:8000/.');
  } else {
    Promise.all([AMGT4CEM_Referentiel.load(), loadLegacyMarkers(), anchorsReady]).then(
      ([features, legacy]) => buildMetro(features.concat(legacy)),
      (err) => {
        console.error('[AMGT4CEM] Chargement des données impossible :', err);
        showLoadError(`Chargement des données impossible : ${err.message}`);
      }
    );
  }

  document.getElementById('amgt-add-point-btn').addEventListener('click', () => {
    AMGT4CEM_MeasureTool.deactivate();
    AMGT4CEM_AddPointTool.toggle();
  });

  document.getElementById('amgt-measure-btn').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.deactivate();
    AMGT4CEM_MeasureTool.toggle();
  });

  document.getElementById('amgt-form-confirm').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.confirm();
  });

  document.getElementById('amgt-form-cancel').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.cancel();
  });
})();
