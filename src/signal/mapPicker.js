/**
 * Choix du point sur la carte, dans SIG4CEM (écran plein cadre, lancé dès « Nouvelle entrée »).
 *
 * Carte Leaflet avec le fond UrbIS (src/basemap.js, même socle que la carte AMGT4CEM) : un toucher pose un
 * marqueur déplaçable, « Ma position » centre sur le GPS de l'appareil, « Valider » renvoie la position en
 * Lambert 72. La couche du réseau (stations, tunnels) n'est pas chargée ici pour l'instant.
 *
 * SIG4CEM.MapPicker.open({ position?, onValidate({x, y}), onCancel() })
 */
(function () {
const SIG = (window.SIG4CEM = window.SIG4CEM || {});
const h = SIG.h;

SIG.MapPicker = {
  el: null,
  map: null,
  marker: null,
  lambert: null,
  _ready: null,

  /** Construit l'écran et la carte une seule fois ; le fond de plan attend la configuration des services. */
  _build() {
    if (this.el) return;
    this.hint = h('p', { class: 'sig4cem-map__hint', text: 'Touchez la carte pour placer le point.' });
    this.coords = h('span', { class: 'sig4cem-map__coords', text: '' });
    this.btnLocate = h('button', { type: 'button', class: 'sig4cem-btn', text: '\u{1F4CD} Ma position' });
    this.btnCancel = h('button', { type: 'button', class: 'sig4cem-btn', text: 'Annuler' });
    this.btnOk = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--primary', text: 'Valider la position', disabled: '' });
    this.canvas = h('div', { id: 'sig4cem-map', class: 'sig4cem-map__canvas' });
    this.el = h('section', { class: 'sig4cem-screen sig4cem-screen--map sig4cem-hidden' },
      h('div', { class: 'sig4cem-map__top' }, this.hint, this.coords),
      this.canvas,
      h('div', { class: 'sig4cem-map__actions' }, this.btnCancel, this.btnLocate, this.btnOk));
    document.getElementById('sig4cem-root').append(this.el);
    this.btnLocate.addEventListener('click', () => this._locate());
  },

  _ensureMap() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      await AMGT4CEM_Services.load();
      this.map = L.map(this.canvas, { attributionControl: false, maxZoom: AMGT4CEM_CONFIG.maxZoom, center: [50.85, 4.37], zoom: 13 });
      L.control.attribution({ prefix: false }).addTo(this.map); // avant le fond : il y inscrit son crédit
      AMGT4CEM_Basemap.init(this.map);
      AMGT4CEM_Basemap.showUrbis();
      this.map.on('click', (e) => this._place(e.latlng));
    })();
    return this._ready;
  },

  _place(latlng) {
    if (!this.marker) {
      this.marker = L.marker(latlng, {
        draggable: true,
        icon: L.divIcon({ className: 'amgt-temp-marker', html: '<div class="amgt-temp-marker__dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
      }).addTo(this.map);
      this.marker.on('dragend', () => this._update(this.marker.getLatLng()));
    } else {
      this.marker.setLatLng(latlng);
    }
    this._update(latlng);
  },

  _update(latlng) {
    this.lambert = AMGT4CEM_CRS.latLngToLambert(latlng);
    this.coords.textContent = `X ${AMGT4CEM_CRS.formatCoord(this.lambert.x)} · Y ${AMGT4CEM_CRS.formatCoord(this.lambert.y)}`;
    this.hint.textContent = 'Déplacez le point si besoin, puis validez.';
    this.btnOk.disabled = false;
  },

  _locate() {
    if (!navigator.geolocation) { this.hint.textContent = 'Position GPS indisponible sur cet appareil.'; return; }
    this.hint.textContent = 'Recherche de la position…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
        this.map.setView(latlng, Math.max(this.map.getZoom(), 18));
        this._place(latlng);
      },
      () => { this.hint.textContent = 'Position GPS refusée ou indisponible : touchez la carte.'; },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  },

  /** Ouvre l'écran, tout de suite ; `position` ({x, y} en Lambert 72) replace un point déjà choisi. */
  async open({ position, onValidate, onCancel }) {
    this._build();
    this.el.classList.remove('sig4cem-hidden');
    this.btnOk.onclick = () => { if (this.lambert) onValidate({ ...this.lambert }); };
    this.btnCancel.onclick = () => onCancel();
    this.btnOk.disabled = true;
    this.lambert = null;
    this.coords.textContent = '';
    this.hint.textContent = 'Touchez la carte pour placer le point.';
    try {
      await this._ensureMap();
    } catch (err) {
      console.error('[SIG4CEM] Carte non chargée :', err);
      this.hint.textContent = `Carte indisponible : ${err.message}`;
      return;
    }
    this.map.invalidateSize();
    if (this.marker) { this.map.removeLayer(this.marker); this.marker = null; }
    if (position) {
      const latlng = AMGT4CEM_CRS.lambertToLatLng([position.x, position.y]);
      this.map.setView(latlng, Math.max(this.map.getZoom(), 17));
      this._place(latlng);
    }
  },

  close() {
    if (this.el) this.el.classList.add('sig4cem-hidden');
  },
};
})();
