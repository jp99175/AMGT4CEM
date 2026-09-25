/**
 * Outil "📏 Mesurer" : cliquer-maintenir sur la carte pose le centre d'un
 * cercle, glisser trace son rayon (segment + cote au bout du segment +
 * cercle), relâcher fige la mesure. Le tout reste affiché 3 secondes après
 * le relâchement (ou la fin du clic, ex. sortie du curseur hors carte) puis
 * disparaît — le bouton "📷 Capture" (screenshotTool.js) permet d'en garder
 * une image avant que ça n'arrive.
 *
 * Comme AddPointTool, le mode reste actif (bouton "allumé") tant qu'on ne le
 * désactive pas explicitement, pour pouvoir enchaîner plusieurs mesures ;
 * activer cet outil désactive AddPointTool et vice-versa (un seul mode
 * d'interaction à la fois sur la carte).
 */
const AMGT4CEM_MeasureTool = {
  _map: null,
  _active: false,
  _drawing: false,
  _center: null,
  _line: null,
  _circle: null,
  _labelMarker: null,
  _clearTimer: null,
  _onDeactivated: null,

  init(map) {
    this._map = map;
    this._onMouseDown = (e) => this._startDrawing(e.latlng);
    this._onMouseMove = (e) => this._updateDrawing(e.latlng);
    this._onMouseUp = () => this._finishDrawing();
  },

  isActive() {
    return this._active;
  },

  activate() {
    if (this._active) return;
    this._active = true;
    this._map.dragging.disable();
    this._map.getContainer().classList.add('amgt-placing-mode');
    document.getElementById('amgt-measure-btn').classList.add('amgt-btn--active');
    this._map.on('mousedown', this._onMouseDown);
  },

  deactivate() {
    if (!this._active) return;
    this._active = false;
    this._map.dragging.enable();
    this._map.getContainer().classList.remove('amgt-placing-mode');
    document.getElementById('amgt-measure-btn').classList.remove('amgt-btn--active');
    this._map.off('mousedown', this._onMouseDown);
    this._map.off('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    this._drawing = false;
    this._clearMeasurement();
  },

  toggle() {
    if (this._active) this.deactivate();
    else this.activate();
  },

  _startDrawing(latlng) {
    this._clearMeasurement();
    this._center = latlng;
    this._drawing = true;

    this._line = L.polyline([latlng, latlng], {
      color: '#d32f2f',
      weight: 2,
      dashArray: '5,5',
    }).addTo(this._map);

    this._circle = L.circle(latlng, {
      radius: 0,
      color: '#d32f2f',
      weight: 2,
      fillOpacity: 0.05,
    }).addTo(this._map);

    this._labelMarker = this._buildLabelMarker(latlng, '0 m');

    this._map.on('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  },

  _updateDrawing(latlng) {
    if (!this._drawing) return;
    const radiusMeters = this._map.distance(this._center, latlng);

    this._line.setLatLngs([this._center, latlng]);
    this._circle.setLatLng(this._center);
    this._circle.setRadius(radiusMeters);
    this._labelMarker.setLatLng(latlng);
    this._labelMarker.setIcon(this._buildLabelIcon(this._formatDistance(radiusMeters)));
  },

  _finishDrawing() {
    if (!this._drawing) return;
    this._drawing = false;
    this._map.off('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);

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
  },

  _formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(1)} m`;
  },

  _buildLabelIcon(text) {
    const span = document.createElement('span');
    span.className = 'amgt-measure-label__text';
    span.textContent = text;
    return L.divIcon({ className: 'amgt-measure-label', html: span });
  },

  _buildLabelMarker(latlng, text) {
    return L.marker(latlng, {
      icon: this._buildLabelIcon(text),
      interactive: false,
    }).addTo(this._map);
  },
};
