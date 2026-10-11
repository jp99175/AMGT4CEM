/**
 * Outil "Ajouter un point" : on pointe une position sur la carte, on choisit le type de données à saisir,
 * puis « Enregistrer » ouvre l'interface de saisie correspondante, position déjà renseignée.
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
   * pour les clics sur les polygones du référentiel (stations/tunnels), qui
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
      this._ensureMarkerVisibleAboveForm();
    });

    this._updateCoordPreview();
    this._showForm();
    this._ensureMarkerVisibleAboveForm();
  },

  /**
   * Le formulaire est ancré en bas de l'écran (voir style.css) : un point posé
   * dans cette zone se retrouverait masqué juste après avoir été placé. On
   * décale la vue (sans changer la position géographique du point) pour que
   * le marqueur reste visible au-dessus du formulaire.
   */
  _ensureMarkerVisibleAboveForm() {
    const formEl = document.getElementById('amgt-point-form');
    const mapContainer = this._map.getContainer();
    const formRect = formEl.getBoundingClientRect();
    const mapRect = mapContainer.getBoundingClientRect();
    const margin = 16;
    const safeBottom = formRect.top - mapRect.top - margin;

    const markerPoint = this._map.latLngToContainerPoint(this._pendingLatLng);
    if (markerPoint.y > safeBottom) {
      this._map.panBy([0, markerPoint.y - safeBottom], { animate: true });
    }
  },

  /** Position retenue, en Lambert 72 (non affichée : le formulaire de saisie la reprend). */
  _updateCoordPreview() {
    this._pendingLambert = AMGT4CEM_CRS.latLngToLambert(this._pendingLatLng);
  },

  _showForm() {
    document.getElementById('amgt-point-form').classList.remove('amgt-hidden');
  },

  _hideForm() {
    document.getElementById('amgt-point-form').classList.add('amgt-hidden');
  },

  _removeTempMarker() {
    if (this._tempMarker) {
      this._map.removeLayer(this._tempMarker);
      this._tempMarker = null;
    }
  },

  /**
   * « Enregistrer » : ouvre l'interface de saisie du type choisi, formulaire déjà rempli de la position pointée.
   * Un seul type pour l'instant : « Signalements et demandes » (SIG4CEM, home.html?app=signal).
   */
  confirm() {
    const type = document.getElementById('amgt-form-type').value;
    if (!this._pendingLambert) return;
    if (type === 'signal') {
      const { x, y } = this._pendingLambert;
      location.href = AMGT4CEM_Router.url('signal', { x: x.toFixed(2), y: y.toFixed(2) });
    }
  },

  cancel() {
    this.deactivate();
  },
};
