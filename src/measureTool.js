/**
 * Outil "📏 Mesurer" : effet dynamique en deux gestes de type
 * presser-glisser-relâcher (comme placer un point puis le corriger avant
 * de lâcher), un pour le centre, un pour le rayon :
 *
 * 1. Presser sur la carte : pose un premier point (le centre). Tant que le
 *    bouton reste enfoncé, le déplacer suit le curseur en direct. Relâcher
 *    fige ce centre.
 * 2. Presser à nouveau : démarre le tracé du rayon depuis ce centre fixe.
 *    Tant que le bouton reste enfoncé, le point d'arrivée suit le curseur
 *    en direct (segment pointillé + cote au bout du segment + cercle qui
 *    grandit/rétrécit avec lui). Relâcher fige le rayon.
 *
 * La mesure complète reste ensuite affichée 3 secondes puis disparaît
 * automatiquement — le bouton "📷 Capture" (screenshotTool.js) n'est
 * lui-même visible que pendant que le cercle et la cote le sont (du 1er
 * geste jusqu'à la fin de ce délai), pour permettre d'en garder une image
 * avant qu'elle ne disparaisse. Une nouvelle pression pendant ce délai
 * recommence directement une nouvelle mesure.
 *
 * Comme AddPointTool, le mode reste actif (bouton "allumé") tant qu'on ne
 * le désactive pas explicitement ; activer cet outil désactive AddPointTool
 * et vice-versa (un seul mode d'interaction à la fois). Le glisser-déposer
 * de la carte est désactivé tant que l'outil est actif (sinon un geste de
 * positionnement déplacerait la vue au lieu de poser un point).
 */
const AMGT4CEM_MeasureTool = {
  _map: null,
  _active: false,
  // 'idle' (attend la presse du centre) | 'draggingCenter' |
  // 'idleAwaitingRadius' (centre fixé, attend la presse du rayon) |
  // 'draggingRadius'
  _state: 'idle',
  _center: null,
  _centerMarker: null,
  _line: null,
  _circle: null,
  _labelMarker: null,
  _clearTimer: null,

  init(map) {
    this._map = map;

    // Pane dédiée, au-dessus de tout le reste (Métro, UrbIS Topo, Plans
    // patrimoine...) pour que la mesure soit toujours visible quel que soit
    // l'ordre d'ajout de ces couches. pointer-events:none : elle ne doit
    // jamais intercepter un clic/une presse.
    const pane = map.createPane('amgtMeasurePane');
    pane.style.zIndex = 650;
    pane.style.pointerEvents = 'none';

    this._onMouseDown = (e) => this._handlePress(e.latlng);
    this._onMouseMove = (e) => this._handleMove(e.latlng);
    this._onMouseUp = () => this._handleRelease();
    // Une presse pour poser le centre ou le rayon tombe souvent sur une
    // station/un tunnel/un objet UrbIS Topo... qui ouvrirait sinon sa
    // propre popup par-dessus la mesure : on la referme immédiatement tant
    // que l'outil est actif.
    this._onPopupOpen = (e) => e.popup.close();

    // Capture de pointeur : sans elle, un geste rapide à la souris réelle
    // qui sort brièvement de la zone de la carte arrête de recevoir les
    // événements mousemove/mouseup (ils partent vers l'élément sous le
    // curseur à ce moment-là) et le tracé se fige au lieu de suivre le
    // relâchement.
    const container = map.getContainer();
    container.addEventListener('pointerdown', (e) => {
      if (this._active && container.setPointerCapture) {
        try { container.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    });
  },

  isActive() {
    return this._active;
  },

  activate() {
    if (this._active) return;
    this._active = true;
    this._state = 'idle';
    this._map.dragging.disable();
    this._map.getContainer().classList.add('amgt-placing-mode');
    document.getElementById('amgt-measure-btn').classList.add('amgt-btn--active');
    this._map.on('mousedown', this._onMouseDown);
    this._map.on('popupopen', this._onPopupOpen);
  },

  deactivate() {
    if (!this._active) return;
    this._active = false;
    this._map.dragging.enable();
    this._map.getContainer().classList.remove('amgt-placing-mode');
    document.getElementById('amgt-measure-btn').classList.remove('amgt-btn--active');
    this._map.off('mousedown', this._onMouseDown);
    this._map.off('mousemove', this._onMouseMove);
    this._map.off('popupopen', this._onPopupOpen);
    document.removeEventListener('mouseup', this._onMouseUp);
    this._state = 'idle';
    this._clearMeasurement();
  },

  toggle() {
    if (this._active) this.deactivate();
    else this.activate();
  },

  _handlePress(latlng) {
    if (this._state === 'idle') {
      this._clearMeasurement();
      this._center = latlng;
      this._centerMarker = this._buildDotMarker(latlng);
      this._state = 'draggingCenter';
    } else if (this._state === 'idleAwaitingRadius') {
      this._line = L.polyline([this._center, latlng], {
        pane: 'amgtMeasurePane',
        color: '#d32f2f',
        weight: 2,
        dashArray: '5,5',
      }).addTo(this._map);
      this._circle = L.circle(this._center, {
        pane: 'amgtMeasurePane',
        radius: 0,
        color: '#d32f2f',
        weight: 2,
        fillOpacity: 0.08,
      }).addTo(this._map);
      this._labelMarker = this._buildLabelMarker(latlng, '0 m');
      document.getElementById('amgt-screenshot-btn').classList.remove('amgt-hidden');
      this._state = 'draggingRadius';
    } else {
      return;
    }

    this._map.on('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  },

  _handleMove(latlng) {
    if (this._state === 'draggingCenter') {
      this._center = latlng;
      this._centerMarker.setLatLng(latlng);
    } else if (this._state === 'draggingRadius') {
      const radiusMeters = this._map.distance(this._center, latlng);
      this._line.setLatLngs([this._center, latlng]);
      this._circle.setLatLng(this._center);
      this._circle.setRadius(radiusMeters);
      this._labelMarker.setLatLng(latlng);
      this._labelMarker.setIcon(this._buildLabelIcon(this._formatDistance(radiusMeters)));
    }
  },

  _handleRelease() {
    this._map.off('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);

    if (this._state === 'draggingCenter') {
      this._state = 'idleAwaitingRadius';
    } else if (this._state === 'draggingRadius') {
      this._state = 'idle';
      clearTimeout(this._clearTimer);
      this._clearTimer = setTimeout(() => this._clearMeasurement(), 3000);
    }
  },

  _clearMeasurement() {
    clearTimeout(this._clearTimer);
    this._clearTimer = null;
    if (this._centerMarker) { this._map.removeLayer(this._centerMarker); this._centerMarker = null; }
    if (this._line) { this._map.removeLayer(this._line); this._line = null; }
    if (this._circle) { this._map.removeLayer(this._circle); this._circle = null; }
    if (this._labelMarker) { this._map.removeLayer(this._labelMarker); this._labelMarker = null; }
    this._center = null;
    document.getElementById('amgt-screenshot-btn').classList.add('amgt-hidden');
  },

  _formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(1)} m`;
  },

  _buildDotMarker(latlng) {
    const dot = document.createElement('span');
    dot.className = 'amgt-measure-dot';
    return L.marker(latlng, {
      icon: L.divIcon({ className: 'amgt-measure-dot-icon', pane: 'amgtMeasurePane', html: dot }),
      interactive: false,
      pane: 'amgtMeasurePane',
    }).addTo(this._map);
  },

  _buildLabelIcon(text) {
    const span = document.createElement('span');
    span.className = 'amgt-measure-label__text';
    span.textContent = text;
    return L.divIcon({ className: 'amgt-measure-label', pane: 'amgtMeasurePane', html: span });
  },

  _buildLabelMarker(latlng, text) {
    return L.marker(latlng, {
      icon: this._buildLabelIcon(text),
      interactive: false,
      pane: 'amgtMeasurePane',
    }).addTo(this._map);
  },
};
