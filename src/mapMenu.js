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
      AMGT4CEM_SettingsPanel.close();
      panel.classList.toggle('amgt-hidden');
    });
    document.addEventListener('click', (e) => {
      if (panel.classList.contains('amgt-hidden')) return;
      if (panel.contains(e.target) || e.target === menuBtn) return;
      panel.classList.add('amgt-hidden');
    });

    this._initBasemapControls();
    this._initLayerControls(map, pointsGroup);
    this._initTopoLayerControls();

    document.getElementById('amgt-reset-view-btn').addEventListener('click', () => {
      // Revient également au fond de référence UrbIS grisé, pas seulement à
      // l'emprise géographique.
      document.getElementById('amgt-year-slider-bar').classList.add('amgt-hidden');
      document.querySelector('input[name="amgt-basemap"][value="urbis"]').checked = true;
      AMGT4CEM_Basemap.showUrbis();

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
    const bar = document.getElementById('amgt-year-slider-bar');
    const prevBtn = document.getElementById('amgt-year-prev');
    const nextBtn = document.getElementById('amgt-year-next');
    const latestBtn = document.getElementById('amgt-year-latest');
    const yearLabel = document.getElementById('amgt-bruciel-year-label');

    // Années réellement accessibles, dans l'ordre chronologique. Sondées une
    // seule fois (résultat mis en cache par AMGT4CEM_Basemap) lors du premier
    // passage sur "Orthophotos" ; tant que le sondage n'est pas terminé, la
    // navigation est désactivée plutôt que de risquer d'afficher une image
    // cassée ou un message d'erreur.
    let accessibleYears = null;
    let currentIndex = -1;

    const renderNav = () => {
      const hasYears = accessibleYears && accessibleYears.length > 0;
      const atLatest = !hasYears || currentIndex >= accessibleYears.length - 1;
      yearLabel.textContent = hasYears ? accessibleYears[currentIndex] : (accessibleYears ? '—' : '…');
      prevBtn.disabled = !hasYears || currentIndex <= 0;
      nextBtn.disabled = atLatest;
      latestBtn.disabled = atLatest;
    };

    const showYearAt = (index) => {
      currentIndex = index;
      renderNav();
      AMGT4CEM_Basemap.showBruciel(accessibleYears[currentIndex]);
    };

    const ensureAccessibleYearsLoaded = async () => {
      if (accessibleYears) return;
      renderNav(); // affiche "…" pendant le sondage
      accessibleYears = await AMGT4CEM_Basemap.getAccessibleBrucielYears();
      if (accessibleYears.length > 0) {
        showYearAt(accessibleYears.length - 1); // la plus récente accessible
      } else {
        renderNav();
      }
    };

    prevBtn.addEventListener('click', () => {
      if (accessibleYears && currentIndex > 0) showYearAt(currentIndex - 1);
    });
    nextBtn.addEventListener('click', () => {
      if (accessibleYears && currentIndex < accessibleYears.length - 1) showYearAt(currentIndex + 1);
    });
    latestBtn.addEventListener('click', () => {
      if (accessibleYears && accessibleYears.length > 0) showYearAt(accessibleYears.length - 1);
    });

    document.querySelectorAll('input[name="amgt-basemap"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        bar.classList.toggle('amgt-hidden', radio.value !== 'bruciel');
        if (radio.value === 'urbis') AMGT4CEM_Basemap.showUrbis();
        else if (radio.value === 'bruciel') ensureAccessibleYearsLoaded();
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

  /**
   * Cases à cocher générées dynamiquement à partir de config.js (une par
   * couche UrbIS Topo optionnelle) : voir urbisTopoLayer.js.
   */
  _initTopoLayerControls() {
    const container = document.getElementById('amgt-topo-layers');

    for (const { id, label, color } of AMGT4CEM_UrbisTopoLayer.getLayerDefinitions()) {
      const row = document.createElement('label');
      row.className = 'amgt-checkbox-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.addEventListener('change', () => {
        AMGT4CEM_UrbisTopoLayer.setEnabled(id, checkbox.checked);
      });

      const dot = document.createElement('span');
      dot.className = 'amgt-topo-color-dot';
      dot.style.background = color;

      row.append(checkbox, dot, document.createTextNode(' ' + label));
      container.appendChild(row);
    }
  },
};
