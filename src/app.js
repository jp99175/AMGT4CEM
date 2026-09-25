/**
 * Point d'entrée de l'application : assemble les modules (fond de plan,
 * couche Metro, points métier, outils de navigation et de création).
 */
(function () {
  // Applique d'éventuelles surcharges utilisateur (panneau ⚙ Paramètres) des
  // URLs de services externes AVANT que basemap.js/searchTool.js ne lisent
  // AMGT4CEM_CONFIG.
  AMGT4CEM_SettingsStore.applyToConfig(AMGT4CEM_CONFIG);

  const map = L.map('map', {
    // Pas de contrôle de zoom Leaflet : remplacé par la recherche en haut à
    // droite (voir searchTool.js). Le zoom reste possible à la molette, au
    // pincement et au double-clic.
    zoomControl: false,
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
    const { layersByType, bounds, searchIndex } = AMGT4CEM_MetroLayer.build(geojson);
    layersByType.MS.addTo(map);
    layersByType.MT.addTo(map);
    AMGT4CEM_MapMenu.setMetroLayers(layersByType);
    AMGT4CEM_SearchTool.setMetroIndex(searchIndex);

    metroBounds = bounds;
    map.fitBounds(bounds, { padding: [20, 20] });

    document.getElementById('amgt-manual-load').classList.add('amgt-hidden');
  }

  AMGT4CEM_MetroData.tryAutoLoad(onMetroLoaded, () => {
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
