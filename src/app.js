/**
 * Point d'entrée de l'application : assemble les modules (fond de plan,
 * couche Metro, points métier, outils de navigation et de création).
 */
(function () {
  const map = L.map('map', {
    zoomControl: true,
    maxZoom: AMGT4CEM_CONFIG.maxZoom,
    // Vue par défaut le temps que Metro.json soit chargé (recentrée ensuite
    // sur l'emprise réelle du réseau).
    center: [50.85, 4.35],
    zoom: 12,
  });

  const { urbis, fallback } = AMGT4CEM_Basemap.build();
  urbis.addTo(map);

  const layersControl = L.control.layers(
    { 'Urbis (fond officiel)': urbis, 'Fond de secours (OSM)': fallback },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(map);

  AMGT4CEM_CoordsDisplay.init(map);
  const pointsGroup = AMGT4CEM_PointsLayer.init(map);
  layersControl.addOverlay(pointsGroup, 'Points métier');

  AMGT4CEM_AddPointTool.init(map, {
    onPointCreated() {
      AMGT4CEM_PointsLayer.refresh();
    },
  });

  let metroBounds = null;

  function onMetroLoaded(geojson) {
    const { layersByType, bounds } = AMGT4CEM_MetroLayer.build(geojson);
    layersControl.addOverlay(layersByType.MS, 'Stations');
    layersControl.addOverlay(layersByType.MT, 'Tunnels');
    layersByType.MS.addTo(map);
    layersByType.MT.addTo(map);

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

  document.getElementById('amgt-reset-view-btn').addEventListener('click', () => {
    if (metroBounds && metroBounds.isValid()) {
      map.fitBounds(metroBounds, { padding: [20, 20] });
    }
  });

  document.getElementById('amgt-add-point-btn').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.toggle();
  });

  document.getElementById('amgt-form-confirm').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.confirm();
  });

  document.getElementById('amgt-form-cancel').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.cancel();
  });
})();
