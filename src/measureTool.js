/**
 * Outil "📏 Mesurer" : deux clics, pas de cliquer-glisser (plus fiable —
 * un cliquer-glisser continu s'est révélé peu fiable en usage réel, voir
 * historique du commit).
 *
 * 1er clic : fige le centre du cercle à l'endroit cliqué.
 * Déplacement (sans bouton enfoncé) : prévisualise le rayon en direct
 * (segment pointillé + cote au bout du segment + cercle), qui suit le
 * curseur.
 * 2e clic : fige le rayon. La mesure reste affichée 3 secondes puis
 * disparaît automatiquement — le bouton "📷 Capture" (screenshotTool.js)
 * n'est lui-même visible que pendant que le cercle et la cote le sont
 * (du 1er clic jusqu'à la fin de ce délai de 3 secondes), pour permettre
 * d'en garder une image avant qu'elle ne disparaisse.
 *
 * Un 3e clic recommence directement une nouvelle mesure (efface l'ancienne
 * s'il en restait une). Comme AddPointTool, le mode reste actif (bouton
 * "allumé") tant qu'on ne le désactive pas explicitement ; activer cet
 * outil désactive AddPointTool et vice-versa (un seul mode d'interaction à
 * la fois). Le glisser-déposer de la carte (pan/zoom) reste disponible
 * pendant que l'outil est actif : un simple clic ne le déclenche pas.
 */
const AMGT4CEM_MeasureTool = {
  _map: null,
  _active: false,
  _state: 'idle', // 'idle' (attend le 1er clic) | 'awaitingRadius' (attend le 2e)
  _center: null,
  _line: null,
  _circle: null,
  _labelMarker: null,
  _clearTimer: null,

  init(map) {
    this._map = map;

    // Pane dédiée, au-dessus de tout le reste (Métro, UrbIS Topo, Plans
    // patrimoine...) pour que la mesure soit toujours visible quel que soit
    // l'ordre d'ajout de ces couches. pointer-events:none : elle ne doit
    // jamais intercepter le clic qui démarre une mesure suivante.
    const pane = map.createPane('amgtMeasurePane');
    pane.style.zIndex = 650;
    pane.style.pointerEvents = 'none';

    this._onMapClick = (e) => this._handleClick(e.latlng);
    this._onMouseMove = (e) => this._updatePreview(e.latlng);
    // Un clic pour poser le centre ou le rayon tombe souvent sur une
    // station/un tunnel/un objet UrbIS Topo... qui ouvrirait sinon sa
    // propre popup par-dessus la mesure : on la referme immédiatement tant
    // que l'outil est actif.
    this._onPopupOpen = (e) => e.popup.close();
  },

  isActive() {
    return this._active;
  },

  activate() {
    if (this._active) return;
    this._active = true;
    this._state = 'idle';
    this._map.getContainer().classList.add('amgt-placing-mode');
    document.getElementById('amgt-measure-btn').classList.add('amgt-btn--active');
    this._map.on('click', this._onMapClick);
    this._map.on('popupopen', this._onPopupOpen);
  },

  deactivate() {
    if (!this._active) return;
    this._active = false;
    this._map.getContainer().classList.remove('amgt-placing-mode');
    document.getElementById('amgt-measure-btn').classList.remove('amgt-btn--active');
    this._map.off('click', this._onMapClick);
    this._map.off('mousemove', this._onMouseMove);
    this._map.off('popupopen', this._onPopupOpen);
    this._state = 'idle';
    this._clearMeasurement();
  },

  toggle() {
    if (this._active) this.deactivate();
    else this.activate();
  },

  _handleClick(latlng) {
    if (this._state === 'idle') this._startCenter(latlng);
    else this._finishRadius(latlng);
  },

  _startCenter(latlng) {
    this._clearMeasurement();
    this._center = latlng;
    this._state = 'awaitingRadius';

    this._line = L.polyline([latlng, latlng], {
      pane: 'amgtMeasurePane',
      color: '#d32f2f',
      weight: 2,
      dashArray: '5,5',
    }).addTo(this._map);

    this._circle = L.circle(latlng, {
      pane: 'amgtMeasurePane',
      radius: 0,
      color: '#d32f2f',
      weight: 2,
      fillOpacity: 0.08,
    }).addTo(this._map);

    this._labelMarker = this._buildLabelMarker(latlng, '0 m');
    document.getElementById('amgt-screenshot-btn').classList.remove('amgt-hidden');

    this._map.on('mousemove', this._onMouseMove);
  },

  _updatePreview(latlng) {
    if (this._state !== 'awaitingRadius') return;
    const radiusMeters = this._map.distance(this._center, latlng);

    this._line.setLatLngs([this._center, latlng]);
    this._circle.setLatLng(this._center);
    this._circle.setRadius(radiusMeters);
    this._labelMarker.setLatLng(latlng);
    this._labelMarker.setIcon(this._buildLabelIcon(this._formatDistance(radiusMeters)));
  },

  _finishRadius(latlng) {
    this._updatePreview(latlng);
    this._state = 'idle';
    this._map.off('mousemove', this._onMouseMove);

    clearTimeout(this._clearTimer);
    this._clearTimer = setTimeout(() => this._clearMeasurement(), 3000);
  },

  _clearMeasurement() {
    clearTimeout(this._clearTimer);
    this._clearTimer = null;
    if (this._line) { this._map.removeLayer(this._line); this._line = null; }
    if (this._circle) { this._map.removeLayer(this._circle); this._circle = null; }
    if (this._labelMarker) { this._map.removeLayer(this._labelMarker); this._labelMarker = null; }
    this._center = null;
    document.getElementById('amgt-screenshot-btn').classList.add('amgt-hidden');
  },

  _formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(1)} m`;
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
