/**
 * Point d'entrée de l'application : assemble les modules (fond de plan,
 * couche Metro, points métier, outils de navigation et de création).
 */
(function () {
  const map = L.map('map', {
    // Contrôle de zoom désactivé ici et recréé en haut à droite (position par
    // défaut = haut gauche, sous le menu "☰ Carte" et masqué par lui).
    zoomControl: false,
    maxZoom: AMGT4CEM_CONFIG.maxZoom,
    // Vue par défaut le temps que Metro.json soit chargé (recentrée ensuite
    // sur l'emprise réelle du réseau).
    center: [50.85, 4.35],
    zoom: 12,
  });
  L.control.zoom({ position: 'topright' }).addTo(map);
  // Retire le lien "Leaflet" du contrôle d'attribution (sans obligation légale :
  // la licence BSD-2-Clause de Leaflet n'exige pas d'affichage à l'écran, voir
  // README). Les attributions des sources de données (UrbIS, Bruciel...)
  // restent affichées, elles.
  map.attributionControl.setPrefix(false);

  AMGT4CEM_Basemap.init(map);
  AMGT4CEM_Basemap.showUrbis();

  AMGT4CEM_CoordsDisplay.init(map);
  const pointsGroup = AMGT4CEM_PointsLayer.init(map);

  let metroBounds = null;

  AMGT4CEM_MapMenu.init({
    map,
    pointsGroup,
    getMetroBounds: () => metroBounds,
  });

  AMGT4CEM_AddPointTool.init(map, {
    onPointCreated() {
      AMGT4CEM_PointsLayer.refresh();
    },
  });

  function onMetroLoaded(geojson) {
    const { layersByType, bounds } = AMGT4CEM_MetroLayer.build(geojson);
    layersByType.MS.addTo(map);
    layersByType.MT.addTo(map);
    AMGT4CEM_MapMenu.setMetroLayers(layersByType);

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
    AMGT4CEM_AddPointTool.toggle();
  });

  document.getElementById('amgt-form-confirm').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.confirm();
  });

  document.getElementById('amgt-form-cancel').addEventListener('click', () => {
    AMGT4CEM_AddPointTool.cancel();
  });
})();
