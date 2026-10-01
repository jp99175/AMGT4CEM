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
    // détermine l'empilement visuel. On ajoute le repère "BUILD..." AVANT
    // l'attribution pour qu'il reste sous elle (voir plus bas).
    attributionControl: false,
    maxZoom: AMGT4CEM_CONFIG.maxZoom,
    // Vue par défaut le temps que Metro.json soit chargé (recentrée ensuite
    // sur l'emprise réelle du réseau).
    center: [50.85, 4.35],
    zoom: 12,
  });
  AMGT4CEM_SearchTool.init(map);

  // Ajouté avant l'attribution (voir commentaire sur attributionControl
  // ci-dessus) pour apparaître sous "(c) CIRB - UrbIS", pas au-dessus.
  AMGT4CEM_BuildInfoControl.init(map);
  // Retire le lien "Leaflet" du contrôle d'attribution (sans obligation légale :
  // la licence BSD-2-Clause de Leaflet n'exige pas d'affichage à l'écran, voir
  // README). Les attributions des sources de données (UrbIS, Bruciel...)
  // restent affichées, elles. Créé ici, AVANT l'ajout des fonds de plan, pour
  // que leurs attributions (passées en option des couches) soient bien
  // captées par ce contrôle.
  map.attributionControl = L.control.attribution({ prefix: false }).addTo(map);

  AMGT4CEM_Basemap.init(map);
  AMGT4CEM_Basemap.showUrbis();

  AMGT4CEM_ScaleControl.init(map);
  AMGT4CEM_ScaledText.initMap(map);
  const pointsGroup = AMGT4CEM_PointsLayer.init(map);
  AMGT4CEM_UrbisTopoLayer.init(map);
  AMGT4CEM_UrbisTopoPicker.init();
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

  function onMetroLoaded(geojson) {
    // MetroInfo.shp (triangles PE_info, Polygon) et MetroLabels.shp (points
    // d'ancrage des textes PE_info/PE_label, Point) sont des fichiers à part
    // (Metro.shp est Polygon — un .shp ne mélange pas deux types de forme) :
    // chargés séparément, fusionnés avec les entités de Metro.shp avant
    // l'unique appel à build(). Leur absence/échec (ex : fichier pas encore
    // déployé) ne doit pas empêcher le reste de l'app de fonctionner —
    // dégradation silencieuse (juste un avertissement en console), comme le
    // reste des couches optionnelles de cette app.
    AMGT4CEM_ShpLoader.load(AMGT4CEM_CONFIG.metroInfoShpBaseUrl, (infoGeojson) => {
      AMGT4CEM_ShpLoader.load(AMGT4CEM_CONFIG.metroLabelsShpBaseUrl, (labelsGeojson) => {
        finishMetroLoad(geojson.features.concat(infoGeojson.features, labelsGeojson.features));
      }, (err) => {
        console.warn('[AMGT4CEM] Chargement de MetroLabels.shp (textes PE_info/PE_label) impossible, couche ignorée :', err);
        finishMetroLoad(geojson.features.concat(infoGeojson.features));
      });
    }, (err) => {
      console.warn('[AMGT4CEM] Chargement de MetroInfo.shp (triangles PE_info) impossible, couche ignorée :', err);
      finishMetroLoad(geojson.features);
    });
  }

  // Définitions d'ancrage des références de planche (fichier partagé, voir
  // peLabelAnchors.js) : lues en parallèle du Shapefile, attendues avant la
  // construction des étiquettes. Ne rejette jamais (absentes = positions d'origine).
  const anchorsReady = AMGT4CEM_PeLabelAnchors.load();

  function finishMetroLoad(features) {
    anchorsReady.then(() => buildMetro(features));
  }

  function buildMetro(features) {
    const { layersByType, bounds, searchIndex } = AMGT4CEM_MetroLayer.build({
      type: 'FeatureCollection',
      features,
    });
    // PE (planches), PE_label (référence de planche tracée dans l'emprise)
    // et PE_info (repères de transition entre tronçons) ne sont pas
    // ajoutées directement ici : leur visibilité est pilotée ensemble
    // depuis le sélecteur "Plans patrimoine" (voir patrimoineCatalog.js,
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
    AMGT4CEM_PatrimoineLayer.registerExternalLayer('plans-ensemble-500e', peAndInfoGroup);

    layersByType.MS.addTo(map);
    layersByType.MT.addTo(map);
    AMGT4CEM_MapMenu.setMetroLayers(layersByType);
    AMGT4CEM_SearchTool.setMetroIndex(searchIndex);

    metroBounds = bounds;
    map.fitBounds(bounds, { padding: [20, 20] });

    document.getElementById('amgt-manual-load').classList.add('amgt-hidden');
  }

  // Chargement automatique normal : Shapefile (voir shpLoader.js et le
  // commentaire sur metroShpBaseUrl, config.js). Le bouton de secours
  // (chargement manuel d'un .json) ne sert qu'en dernier recours, si ce
  // fetch échoue (ex : ouverture en file:// sans serveur local).
  AMGT4CEM_ShpLoader.load(AMGT4CEM_CONFIG.metroShpBaseUrl, onMetroLoaded, (err) => {
    console.warn('[AMGT4CEM] Chargement automatique de Metro.shp impossible ' +
      '(probablement une ouverture en file:// sans serveur local) :', err);
    document.getElementById('amgt-manual-load').classList.remove('amgt-hidden');
  });

  document.getElementById('amgt-manual-load-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    AMGT4CEM_MetroData.loadFromFile(file, onMetroLoaded, (err) => {
      alert('Impossible de lire ce fichier comme Metro.json : ' + err.message);
    });
  });

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
