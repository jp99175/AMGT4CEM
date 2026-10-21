/**
 * Menu unique (haut gauche) regroupant le choix du fond de plan, la
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

    document.getElementById('amgt-signalements-edit-link').addEventListener('click', (e) => {
      e.preventDefault();
      AMGT4CEM_SignalementsLayer.openPicker();
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
   * Appelé une fois les données chargées et ses couches Stations/Tunnels construites.
   * @param {{ MS: L.LayerGroup, MT: L.LayerGroup }} layersByType
   */
  setMetroLayers(layersByType) {
    this._metroLayers = layersByType;
    this._applyMetroOpacity(this._metroOpacityFactor);
  },

  /**
   * Réglage d'opacité de la couche Métro (icône curseurs) : Stations,
   * Tunnels et Planches n'ont pas la même opacité de remplissage d'origine
   * (AMGT4CEM_METRO_TYPES, voir metroLayer.js) — le facteur s'applique en
   * multiplicateur sur chacune, jamais en remplacement absolu. Boucle sur
   * tous les types déclarés (pas de liste MS/MT/PE en dur ici) pour qu'un
   * futur type supplémentaire n'ait qu'un seul endroit à mettre à jour.
   */
  _applyMetroOpacity(factor) {
    this._metroOpacityFactor = factor;
    if (!this._metroLayers) return;

    for (const type of Object.keys(AMGT4CEM_METRO_TYPES)) {
      const group = this._metroLayers[type];
      const base = AMGT4CEM_METRO_TYPES[type];
      if (!group) continue;
      group.eachLayer((layer) => layer.setStyle({ opacity: factor, fillOpacity: base.fillOpacity * factor }));
    }
  },

  _initBasemapControls() {
    const bar = document.getElementById('amgt-year-slider-bar');
    const prevBtn = document.getElementById('amgt-year-prev');
    const nextBtn = document.getElementById('amgt-year-next');
    const latestBtn = document.getElementById('amgt-year-latest');
    const yearLabel = document.getElementById('amgt-bruciel-year-label');
    const sourceLogo = document.getElementById('amgt-source-logo');
    const orientation = document.getElementById('amgt-orientation');

    // Ligne du temps : un élément par millésime accessible (voir
    // AMGT4CEM_Basemap.getAccessibleTimeline), chacun avec ses sources
    // accessibles. Sondée une seule fois (résultat mis en cache par
    // AMGT4CEM_Basemap) lors du premier passage sur "Orthophotos" ; tant que
    // le sondage n'est pas terminé, la navigation est désactivée plutôt que
    // de risquer d'afficher une image cassée ou un message d'erreur.
    // `fullTimeline` : tout ce qui est accessible ; `timeline` : ce qui est coché dans ⚙ Orthophotos (voir
    // AMGT4CEM_OrthoSelectionStore), seul utilisé par la navigation.
    let fullTimeline = null;
    let timeline = null;
    let currentIndex = -1;
    let currentSource = null;
    const orthoOn = () => document.querySelector('input[name="amgt-basemap"][value="bruciel"]').checked;

    const renderNav = () => {
      const hasYears = timeline && timeline.length > 0;
      const atLatest = !hasYears || currentIndex >= timeline.length - 1;
      yearLabel.textContent = hasYears ? timeline[currentIndex].key : (timeline ? '—' : '…');
      prevBtn.disabled = !hasYears || currentIndex <= 0;
      nextBtn.disabled = atLatest;
      latestBtn.disabled = atLatest;

      // Un millésime présent dans plusieurs sources (doublon) a sa date
      // soulignée et cliquable : le clic bascule d'une source à l'autre.
      const item = hasYears ? timeline[currentIndex] : null;
      const hasChoice = !!item && item.sources.length > 1;
      yearLabel.classList.toggle('amgt-has-choice', hasChoice);
      yearLabel.disabled = !hasChoice;
      // Logo de l'entité dont l'orthophoto est affichée (source courante).
      const shown = item ? AMGT4CEM_Basemap.SOURCES[currentSource || item.sources[0].source] : null;
      sourceLogo.classList.toggle('amgt-hidden', !shown);
      if (shown) {
        sourceLogo.src = shown.logo;
        sourceLogo.alt = shown.logoAlt;
        sourceLogo.title = shown.logoAlt;
      }

      // Flèche d'orientation de la prise de vue quand l'année a plusieurs variantes bruxelloises.
      const SRC = AMGT4CEM_Basemap.SOURCES;
      const cur = item && SRC[currentSource || item.sources[0].source];
      const variants = item ? item.sources.filter((s) => SRC[s.source].column === 'bruxelles').length : 0;
      const showOrientation = !!cur && cur.column === 'bruxelles' && variants > 1;
      orientation.classList.toggle('amgt-hidden', !showOrientation);
      if (showOrientation) {
        const ir = cur.variant.startsWith('IR');
        const ns = cur.variant.endsWith('N-S');
        orientation.textContent = (ir ? 'IR ' : '') + (ns ? '↕' : '↔');
        orientation.title = `Prise de vue ${ns ? 'nord-sud' : 'est-ouest'}${ir ? ', proche infrarouge' : ''}`;
      }

      if (!item) {
        yearLabel.removeAttribute('title');
      } else if (hasChoice) {
        const names = item.sources.map((s) => AMGT4CEM_Basemap.SOURCES[s.source].label).join(' / ');
        yearLabel.title = `Source affichée : ${AMGT4CEM_Basemap.SOURCES[currentSource].label} — cliquer pour changer (${names})`;
      } else {
        yearLabel.title = `Source : ${AMGT4CEM_Basemap.SOURCES[item.sources[0].source].label}`;
      }
    };

    const showYearAt = (index) => {
      currentIndex = index;
      const item = timeline[currentIndex];
      currentSource = AMGT4CEM_Basemap.showOrtho(item);
      renderNav();
    };

    const ensureTimelineLoaded = async () => {
      if (!fullTimeline) {
        renderNav(); // affiche "…" pendant le sondage
        fullTimeline = await AMGT4CEM_Basemap.getAccessibleTimeline();
        timeline = AMGT4CEM_Basemap.filterTimeline(fullTimeline, AMGT4CEM_OrthoSelectionStore.getSelection());
        currentIndex = -1;
      }
      if (timeline.length > 0) {
        showYearAt(currentIndex >= 0 ? currentIndex : timeline.length - 1); // l'année en cours, sinon la plus récente
      } else {
        renderNav();
      }
    };

    // Cases cochées / décochées dans ⚙ Orthophotos : la navigation suit tout de suite. L'année affichée reste
    // si elle est encore cochée, sinon on prend la plus proche.
    AMGT4CEM_OrthoSelectionStore.onChange(() => {
      if (!fullTimeline) return;
      const before = currentIndex >= 0 && timeline[currentIndex] ? timeline[currentIndex] : null;
      timeline = AMGT4CEM_Basemap.filterTimeline(fullTimeline, AMGT4CEM_OrthoSelectionStore.getSelection());
      if (!timeline.length) { currentIndex = -1; renderNav(); return; }
      let index = timeline.length - 1;
      if (before) {
        const same = timeline.findIndex((t) => t.key === before.key);
        index = same >= 0
          ? same
          : timeline.reduce((best, t, i) => (Math.abs(t.sortYear - before.sortYear) < Math.abs(timeline[best].sortYear - before.sortYear) ? i : best), 0);
      }
      if (orthoOn()) showYearAt(index); else { currentIndex = index; renderNav(); }
    });
    document.getElementById('amgt-ortho-settings-btn').addEventListener('click', () => AMGT4CEM_OrthoPicker.open());

    prevBtn.addEventListener('click', () => {
      if (timeline && currentIndex > 0) showYearAt(currentIndex - 1);
    });
    nextBtn.addEventListener('click', () => {
      if (timeline && currentIndex < timeline.length - 1) showYearAt(currentIndex + 1);
    });
    latestBtn.addEventListener('click', () => {
      if (timeline && timeline.length > 0) showYearAt(timeline.length - 1);
    });
    yearLabel.addEventListener('click', () => {
      if (!timeline || currentIndex < 0) return;
      const item = timeline[currentIndex];
      if (item.sources.length < 2) return;
      const i = item.sources.findIndex((s) => s.source === currentSource);
      const next = item.sources[(i + 1) % item.sources.length].source;
      AMGT4CEM_Basemap.rememberSource(item, next);
      currentSource = AMGT4CEM_Basemap.showOrtho(item, next);
      renderNav();
    });

    document.querySelectorAll('input[name="amgt-basemap"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        bar.classList.toggle('amgt-hidden', radio.value !== 'bruciel');
        if (radio.value === 'urbis') AMGT4CEM_Basemap.showUrbis();
        else if (radio.value === 'bruciel') ensureTimelineLoaded();
      });
    });
  },

  _initLayerControls(map, pointsGroup) {
    // Une seule case pour Stations + Tunnels : les deux se parcourent
    // toujours ensemble en pratique, inutile de les distinguer ici (la
    // recherche, elle, continue de les différencier). Les Planches (PE) et
    // leurs repères (PE_info, PE_label) en sont exclus : leur affichage/
    // masquage est piloté ensemble depuis le sélecteur "Plans patrimoine"
    // (voir plans-patrimoine.js, entrée `external: true`, et
    // patrimoineLayer.js#registerExternalLayer) — seule leur opacité reste
    // réglée ici (_applyMetroOpacity), avec le reste du réseau. Sans cette
    // exclusion, `group.addTo(map)` ajouterait directement le groupe à la
    // carte, court-circuitant le sélecteur "Plans patrimoine".
    document.getElementById('amgt-layer-metro').addEventListener('change', (e) => {
      AMGT4CEM_ScreenshotTool.invalidateBackground();
      if (!this._metroLayers) return;
      for (const type of Object.keys(AMGT4CEM_METRO_TYPES)) {
        if (type === 'PE' || type === 'PE_info' || type === 'PE_label') continue;
        const group = this._metroLayers[type];
        if (!group) continue;
        if (e.target.checked) group.addTo(map);
        else map.removeLayer(group);
      }
    });

    document.getElementById('amgt-layer-points').addEventListener('change', (e) => {
      AMGT4CEM_ScreenshotTool.invalidateBackground();
      if (e.target.checked) { pointsGroup.addTo(map); AMGT4CEM_SignalementsLayer.connectAndRefresh(); }
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

    // Nappe phréatique : case principale (décochée au départ) + choix des éléments dans le sous-volet.
    document.getElementById('amgt-layer-nappe').addEventListener('change', (e) => {
      AMGT4CEM_ScreenshotTool.invalidateBackground();
      AMGT4CEM_NappeLayer.setEnabled(e.target.checked);
    });
    for (const [id, part] of [['amgt-nappe-isopieses', 'isopieses'], ['amgt-nappe-bandes', 'bandes'], ['amgt-nappe-stations', 'stations']]) {
      document.getElementById(id).addEventListener('change', (e) => {
        AMGT4CEM_ScreenshotTool.invalidateBackground();
        AMGT4CEM_NappeLayer.setParts({ [part]: e.target.checked });
      });
    }
  },

  /**
   * Icône curseurs (☰ Carte, section Couches) : ouvre/ferme un sous-volet
   * par couche (Métro, Signalements et demandes, UrbIS Topo, Plans patrimoine)
   * regroupant le curseur d'opacité et, pour les deux derniers, le lien
   * "(modifier la sélection)" — comme dans MobiGIS. Réglage d'opacité
   * persistant par appareil (voir layerOpacityStore.js). Un clic en dehors
   * d'un sous-volet ouvert (y compris sur un autre sous-volet, ou sur la
   * carte) le referme, comme le menu ☰ Carte et le panneau ⚙ Paramètres.
   */
  _initOpacityControls() {
    const layers = [
      { key: 'metro', apply: (factor) => this._applyMetroOpacity(factor) },
      { key: 'points', apply: (factor) => AMGT4CEM_SignalementsLayer.setOpacity(factor) },
      { key: 'urbistopo', apply: (factor) => AMGT4CEM_UrbisTopoLayer.setOpacity(factor) },
      { key: 'patrimoine', apply: (factor) => AMGT4CEM_PatrimoineLayer.setOpacity(factor) },
      { key: 'nappe', apply: (factor) => AMGT4CEM_NappeLayer.setOpacity(factor) },
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
