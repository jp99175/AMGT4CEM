/**
 * Menu unique (haut gauche) regroupant le choix du fond de carte, la
 * visibilité des couches Metro/points, et le retour à l'emprise du réseau.
 *
 * Remplace le contrôle de couches Leaflet par défaut : avec plusieurs
 * dizaines de fonds potentiels (UrbIS, orthophotos, Bruciel...), ce contrôle
 * devenait trop long et se superposait aux autres boutons sur petit écran.
 */
const AMGT4CEM_MapMenu = {
  _metroLayers: null,

  /**
   * @param {{ map: L.Map, pointsGroup: L.LayerGroup, getMetroBounds: () => (L.LatLngBounds|null) }} deps
   */
  init({ map, pointsGroup, getMetroBounds }) {
    const menuBtn = document.getElementById('amgt-menu-btn');
    const panel = document.getElementById('amgt-map-menu');

    menuBtn.addEventListener('click', () => {
      panel.classList.toggle('amgt-hidden');
    });
    document.addEventListener('click', (e) => {
      if (panel.classList.contains('amgt-hidden')) return;
      if (panel.contains(e.target) || e.target === menuBtn) return;
      panel.classList.add('amgt-hidden');
    });

    this._initBasemapControls();
    this._initLayerControls(map, pointsGroup);

    document.getElementById('amgt-reset-view-btn').addEventListener('click', () => {
      const bounds = getMetroBounds();
      if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    });
  },

  /**
   * Appelé une fois Metro.json chargé et ses couches Stations/Tunnels construites.
   * @param {{ MS: L.LayerGroup, MT: L.LayerGroup }} layersByType
   */
  setMetroLayers(layersByType) {
    this._metroLayers = layersByType;
  },

  _initBasemapControls() {
    const years = AMGT4CEM_CONFIG.basemaps.bruciel.entries.map((e) => e.year);
    const sliderBar = document.getElementById('amgt-year-slider-bar');
    const slider = document.getElementById('amgt-bruciel-slider');
    const yearLabel = document.getElementById('amgt-bruciel-year-label');

    slider.min = 0;
    slider.max = years.length - 1;
    slider.value = years.length - 1;
    yearLabel.textContent = years[years.length - 1];

    const applyBruciel = () => {
      const year = years[Number(slider.value)];
      // Ré-affiche le libellé (masqué le temps précédent si le fond était
      // inaccessible) avant de charger la nouvelle année.
      yearLabel.classList.remove('amgt-hidden');
      yearLabel.textContent = year;
      AMGT4CEM_Basemap.showBruciel(year);
    };

    slider.addEventListener('input', applyBruciel);

    document.querySelectorAll('input[name="amgt-basemap"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        sliderBar.classList.toggle('amgt-hidden', radio.value !== 'bruciel');
        if (radio.value === 'urbis') AMGT4CEM_Basemap.showUrbis();
        else if (radio.value === 'bruciel') applyBruciel();
      });
    });
  },

  _initLayerControls(map, pointsGroup) {
    document.getElementById('amgt-layer-stations').addEventListener('change', (e) => {
      if (!this._metroLayers) return;
      if (e.target.checked) this._metroLayers.MS.addTo(map);
      else map.removeLayer(this._metroLayers.MS);
    });

    document.getElementById('amgt-layer-tunnels').addEventListener('change', (e) => {
      if (!this._metroLayers) return;
      if (e.target.checked) this._metroLayers.MT.addTo(map);
      else map.removeLayer(this._metroLayers.MT);
    });

    document.getElementById('amgt-layer-points').addEventListener('change', (e) => {
      if (e.target.checked) pointsGroup.addTo(map);
      else map.removeLayer(pointsGroup);
    });
  },
};
