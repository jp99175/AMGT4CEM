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
  _metroOpacityFactor: 1,

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
    this._initOpacityControls();

    document.getElementById('amgt-topo-edit-link').addEventListener('click', (e) => {
      e.preventDefault();
      AMGT4CEM_UrbisTopoPicker.open();
    });

    document.getElementById('amgt-patrimoine-edit-link').addEventListener('click', (e) => {
      e.preventDefault();
      AMGT4CEM_PatrimoinePicker.open();
    });

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
    this._applyMetroOpacity(this._metroOpacityFactor);
  },

  /**
   * Réglage d'opacité de la couche Métro (icône curseurs) : Stations et
   * Tunnels n'ont pas la même opacité de remplissage d'origine
   * (AMGT4CEM_METRO_TYPES, voir metroLayer.js) — le facteur s'applique en
   * multiplicateur sur chacune, jamais en remplacement absolu.
   */
  _applyMetroOpacity(factor) {
    this._metroOpacityFactor = factor;
    if (!this._metroLayers) return;

    const applyGroup = (group, base) => {
      group.eachLayer((layer) => layer.setStyle({ opacity: factor, fillOpacity: base.fillOpacity * factor }));
    };
    applyGroup(this._metroLayers.MS, AMGT4CEM_METRO_TYPES.MS);
    applyGroup(this._metroLayers.MT, AMGT4CEM_METRO_TYPES.MT);
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
    // Une seule case pour Stations + Tunnels (Metro.json) : les deux se
    // parcourent toujours ensemble en pratique, inutile de les distinguer
    // ici (la recherche, elle, continue de les différencier).
    document.getElementById('amgt-layer-metro').addEventListener('change', (e) => {
      AMGT4CEM_ScreenshotTool.invalidateBackground();
      if (!this._metroLayers) return;
      if (e.target.checked) {
        this._metroLayers.MS.addTo(map);
        this._metroLayers.MT.addTo(map);
      } else {
        map.removeLayer(this._metroLayers.MS);
        map.removeLayer(this._metroLayers.MT);
      }
    });

    document.getElementById('amgt-layer-points').addEventListener('change', (e) => {
      AMGT4CEM_ScreenshotTool.invalidateBackground();
      if (e.target.checked) pointsGroup.addTo(map);
      else map.removeLayer(pointsGroup);
    });

    // Traitée comme une couche parmi d'autres (Stations, Tunnels, Points
    // métier) : une seule case, active/désactive l'affichage des types
    // actuellement sélectionnés. Le choix des types se fait à part, via
    // "(modifier la sélection)" -> urbisTopoPicker.js.
    document.getElementById('amgt-layer-urbistopo').addEventListener('change', (e) => {
      AMGT4CEM_ScreenshotTool.invalidateBackground();
      AMGT4CEM_UrbisTopoLayer.setEnabled(e.target.checked);
    });

    document.getElementById('amgt-layer-patrimoine').addEventListener('change', (e) => {
      AMGT4CEM_ScreenshotTool.invalidateBackground();
      AMGT4CEM_PatrimoineLayer.setEnabled(e.target.checked);
    });
  },

  /**
   * Icône curseurs (☰ Carte, section Couches) : ouvre/ferme un sous-volet
   * par couche (Métro, Points métier, UrbIS Topo, Plans patrimoine)
   * regroupant le curseur d'opacité et, pour les deux derniers, le lien
   * "(modifier la sélection)" — comme dans MobiGIS. Réglage d'opacité
   * persistant par appareil (voir layerOpacityStore.js). Un clic en dehors
   * d'un sous-volet ouvert (y compris sur un autre sous-volet, ou sur la
   * carte) le referme, comme le menu ☰ Carte et le panneau ⚙ Paramètres.
   */
  _initOpacityControls() {
    const layers = [
      { key: 'metro', apply: (factor) => this._applyMetroOpacity(factor) },
      { key: 'points', apply: (factor) => AMGT4CEM_PointsLayer.setOpacity(factor) },
      { key: 'urbistopo', apply: (factor) => AMGT4CEM_UrbisTopoLayer.setOpacity(factor) },
      { key: 'patrimoine', apply: (factor) => AMGT4CEM_PatrimoineLayer.setOpacity(factor) },
    ];

    const pairs = [];

    for (const { key, apply } of layers) {
      const toggleBtn = document.querySelector(`.amgt-opacity-toggle-btn[data-layer="${key}"]`);
      const sliderRow = document.querySelector(`.amgt-opacity-slider-row[data-layer="${key}"]`);
      const slider = sliderRow.querySelector('.amgt-opacity-slider');
      pairs.push({ toggleBtn, sliderRow });

      const factor = AMGT4CEM_LayerOpacityStore.getFactor(key);
      slider.value = String(Math.round(factor * 100));
      apply(factor);

      toggleBtn.addEventListener('click', () => {
        sliderRow.classList.toggle('amgt-hidden');
      });

      slider.addEventListener('input', () => {
        AMGT4CEM_ScreenshotTool.invalidateBackground();
        const newFactor = Number(slider.value) / 100;
        apply(newFactor);
        AMGT4CEM_LayerOpacityStore.setFactor(key, newFactor);
      });
    }

    document.addEventListener('click', (e) => {
      for (const { toggleBtn, sliderRow } of pairs) {
        if (sliderRow.classList.contains('amgt-hidden')) continue;
        if (sliderRow.contains(e.target) || toggleBtn.contains(e.target)) continue;
        sliderRow.classList.add('amgt-hidden');
      }
    });
  },
};
