/**
 * Outil "Ajouter un point" : workflow de création d'un objet métier
 * directement en pointant sa position sur la carte (section 9).
 *
 * Pendant le mode placement, l'utilisateur continue de naviguer normalement
 * (drag/zoom Leaflet ne sont jamais désactivés) ; seul le prochain clic sur
 * la carte déclenche la pose d'un marqueur provisoire.
 */
const AMGT4CEM_AddPointTool = {
  _map: null,
  _active: false,
  _tempMarker: null,
  _pendingLatLng: null,
  _onPointCreated: null,

  init(map, { onPointCreated }) {
    this._map = map;
    this._onPointCreated = onPointCreated;
    map.on('click', (e) => this.handleMapClick(e));
  },

  isActive() {
    return this._active;
  },

  activate() {
    this._active = true;
    this._map.getContainer().classList.add('amgt-placing-mode');
    document.getElementById('amgt-add-point-btn').classList.add('amgt-btn--active');
  },

  deactivate() {
    this._active = false;
    this._map.getContainer().classList.remove('amgt-placing-mode');
    document.getElementById('amgt-add-point-btn').classList.remove('amgt-btn--active');
    this._removeTempMarker();
    this._hideForm();
  },

  toggle() {
    if (this._active) this.deactivate();
    else this.activate();
  },

  /**
   * Traite un clic candidat à la pose d'un point (position géographique dans
   * `e.latlng`). Appelé aussi bien pour les clics directs sur la carte que
   * pour les clics sur les polygones Metro (stations/tunnels), qui
   * intercepteraient sinon le clic pour ouvrir leur propre popup — voir
   * metroLayer.js — afin qu'un point puisse être posé n'importe où, y
   * compris pile sur le réseau.
   */
  handleMapClick(e) {
    if (!this._active) return;

    this._pendingLatLng = e.latlng;
    this._removeTempMarker();

    this._tempMarker = L.marker(e.latlng, {
      draggable: true,
      icon: L.divIcon({
        className: 'amgt-temp-marker',
        html: '<div class="amgt-temp-marker__dot"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    }).addTo(this._map);

    this._tempMarker.on('dragend', () => {
      this._pendingLatLng = this._tempMarker.getLatLng();
      this._updateCoordPreview();
    });

    this._updateCoordPreview();
    this._showForm();
  },

  _updateCoordPreview() {
    const { x, y } = AMGT4CEM_CRS.latLngToLambert(this._pendingLatLng);
    document.getElementById('amgt-form-x').textContent = AMGT4CEM_CRS.formatCoord(x);
    document.getElementById('amgt-form-y').textContent = AMGT4CEM_CRS.formatCoord(y);
    this._pendingLambert = { x, y };
  },

  _showForm() {
    document.getElementById('amgt-point-form').classList.remove('amgt-hidden');
  },

  _hideForm() {
    document.getElementById('amgt-point-form').classList.add('amgt-hidden');
    document.getElementById('amgt-form-type').value = '';
    document.getElementById('amgt-form-label').value = '';
  },

  _removeTempMarker() {
    if (this._tempMarker) {
      this._map.removeLayer(this._tempMarker);
      this._tempMarker = null;
    }
  },

  confirm() {
    const type = document.getElementById('amgt-form-type').value.trim();
    const label = document.getElementById('amgt-form-label').value.trim();
    if (!type || !label || !this._pendingLambert) {
      alert('Merci de renseigner au minimum un type et un libellé.');
      return;
    }
    const point = AMGT4CEM_PointsStore.add({
      type,
      label,
      x: this._pendingLambert.x,
      y: this._pendingLambert.y,
    });
    this._onPointCreated(point);
    this.deactivate();
  },

  cancel() {
    this.deactivate();
  },
};
