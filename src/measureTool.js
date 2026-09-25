/**
 * Outil "📏 Mesurer" : cliquer-maintenir sur la carte pose le centre d'un
 * cercle, glisser trace son rayon (segment + cote au bout du segment +
 * cercle), relâcher fige la mesure. Le tout reste affiché 3 secondes après
 * le relâchement (ou la fin du clic, ex. sortie du curseur hors carte) puis
 * disparaît — le bouton "📷 Capture" (screenshotTool.js) n'est lui-même
 * visible que pendant que la mesure l'est, pour permettre d'en garder une
 * image avant qu'elle ne disparaisse.
 *
 * Comme AddPointTool, le mode reste actif (bouton "allumé") tant qu'on ne le
 * désactive pas explicitement, pour pouvoir enchaîner plusieurs mesures ;
 * activer cet outil désactive AddPointTool et vice-versa (un seul mode
 * d'interaction à la fois sur la carte).
 *
 * Capture de pointeur (voir activate()) : sans elle, un tracé rapide à la
 * souris qui sort brièvement de la zone de la carte arrête de recevoir les
 * événements mousemove/mouseup (ils partent alors vers l'élément qui se
 * trouve sous le curseur à ce moment-là) et le tracé se fige au lieu de
 * suivre le relâchement — cela ne se voit pas avec un tracé simulé "lisse"
 * qui reste toujours dans les limites de la carte, seulement à l'usage réel.
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

  init(map) {
    this._map = map;
    this._onMouseDown = (e) => this._startDrawing(e.latlng);
    this._onMouseMove = (e) => this._updateDrawing(e.latlng);
    this._onMouseUp = () => this._finishDrawing();

    // Pane dédiée, au-dessus de tout le reste (Métro, UrbIS Topo, Plans
    // patrimoine...) pour que la mesure soit toujours visible quel que soit
    // l'ordre d'ajout de ces couches. pointer-events:none : elle ne doit
    // jamais intercepter le clic qui démarre une mesure suivante.
    const pane = map.createPane('amgtMeasurePane');
    pane.style.zIndex = 650;
    pane.style.pointerEvents = 'none';

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
