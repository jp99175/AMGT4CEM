/**
 * Choix du point sur la carte, dans SIG4CEM (écran plein cadre, lancé dès « Nouvelle entrée »).
 *
 * La carte montre ce que ta sélection locale affiche dans la carte AMGT4CEM, SAUF les points métier :
 *  - le fond de plan UrbIS (src/basemap.js) ;
 *  - le réseau : stations, tunnels, planches (src/network.js, partagé avec la carte) ;
 *  - les objets UrbIS Topo et les Plans patrimoine choisis dans la carte (sélections lues dans le stockage du
 *    navigateur, ou à défaut la sélection partagée), avec leur réglage d'opacité.
 * Les seuls points affichés sont les entrées saisies ici et pas encore téléversées (brouillon, envoi demandé,
 * envoi en erreur) : une entrée reçue par le serveur n'y figure plus.
 *
 * Un toucher pose un marqueur déplaçable (y compris sur une station ou un tunnel : voir AMGT4CEM_Plugins.
 * captureClicks), « Valider » renvoie la position en Lambert 72.
 *
 * SIG4CEM.MapPicker.open({ position?, onValidate({x, y}), onCancel() })
 */
(function () {
const SIG = (window.SIG4CEM = window.SIG4CEM || {});
const h = SIG.h;

const STATUT_TEXTE = {
  draft: 'Brouillon, enregistré en local',
  file: 'Envoi demandé, pas encore sur le serveur',
  erreur: "Envoi en erreur : à relancer",
};

SIG.MapPicker = {
  el: null,
  map: null,
  marker: null,
  lambert: null,
  isOpen: false,
  network: null, // couches du réseau (stations, tunnels...), une fois chargées
  entriesGroup: null,
  _ready: null,
  _userPlaced: false,

  /** Construit l'écran une seule fois ; la carte, elle, attend la configuration des services. */
  _build() {
    if (this.el) return;
    this.hint = h('p', { class: 'sig4cem-map__hint', text: 'Touchez la carte pour placer le point.' });
    this.coords = h('span', { class: 'sig4cem-map__coords', text: '' });
    this.btnCancel = h('button', { type: 'button', class: 'sig4cem-btn', text: 'Annuler' });
    this.btnOk = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--primary', text: 'Valider la position', disabled: '' });
    this.canvas = h('div', { id: 'sig4cem-map', class: 'sig4cem-map__canvas' });
    // Recherche de la carte AMGT4CEM (src/searchTool.js), mêmes identifiants : station, tunnel, adresse.
    const searchBox = h('div', { id: 'amgt-search-box' },
      h('button', { type: 'button', id: 'amgt-search-toggle', class: 'amgt-btn amgt-btn--icon', title: 'Rechercher une station, un tunnel ou une adresse', text: '\u{1F50D}' }),
      h('div', { id: 'amgt-search-panel', class: 'amgt-hidden' },
        h('input', { type: 'text', id: 'amgt-search-input', placeholder: 'Station, tunnel, adresse...', autocomplete: 'off' }),
        h('ul', { id: 'amgt-search-results' })));
    const body = h('div', { class: 'sig4cem-map__body' }, this.canvas, searchBox);
    this.el = h('section', { class: 'sig4cem-screen sig4cem-screen--map sig4cem-hidden' },
      h('div', { class: 'sig4cem-map__top' }, this.hint, this.coords),
      body,
      h('div', { class: 'sig4cem-map__actions' }, this.btnCancel, this.btnOk));
    document.getElementById('sig4cem-root').append(this.el);
  },

  /** Monte la carte et ses couches, comme src/app.js mais sans menu, recherche ni outils. */
  _ensureMap() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      await AMGT4CEM_Services.load();
      // Sélections par défaut PARTAGÉES : lues avant la création des couches, qui en dépendent pour une première visite.
      await Promise.all([AMGT4CEM_UrbisTopoSelectionStore.loadShared(), AMGT4CEM_PatrimoineSelectionStore.loadShared()]);

      this.map = L.map(this.canvas, {
        attributionControl: false,
        preferCanvas: true, // comme la carte AMGT4CEM : rendu Canvas pour toutes les couches vectorielles
        maxZoom: AMGT4CEM_CONFIG.maxZoom,
        center: [50.85, 4.37],
        zoom: 13,
      });
      const map = this.map;
      L.control.attribution({ prefix: false }).addTo(map); // avant les fonds et couches : ils y inscrivent leur crédit
      AMGT4CEM_ScaledText.initMap(map);
      AMGT4CEM_Basemap.init(map);
      AMGT4CEM_Basemap.showUrbis();
      AMGT4CEM_UrbisTopoLayer.init(map);
      AMGT4CEM_Interstation.init(); // charge les numéros d'interstation (associés aux tunnels dans AMGT4CEM_Network.build)
      AMGT4CEM_PatrimoineLayer.init(map);
      AMGT4CEM_UrbisTopoLayer.setOpacity(AMGT4CEM_LayerOpacityStore.getFactor('urbistopo'));
      AMGT4CEM_PatrimoineLayer.setOpacity(AMGT4CEM_LayerOpacityStore.getFactor('patrimoine'));

      AMGT4CEM_SearchTool.init(map);
      this.entriesGroup = L.layerGroup().addTo(map);
      map.on('click', (e) => this._place(e.latlng));
      // Les polygones du réseau interceptent les clics : ils les relaient ici tant que l'écran est ouvert.
      AMGT4CEM_Plugins.captureClicks({ isActive: () => this.isOpen, handleMapClick: (e) => this._place(e.latlng) });

      this._loadNetwork(); // sans attendre : la carte est utilisable pendant le chargement du réseau
    })();
    return this._ready;
  },

  _loadNetwork() {
    AMGT4CEM_Network.load(this.map).then(
      ({ layersByType, bounds, searchIndex }) => {
        this.network = layersByType;
        AMGT4CEM_SearchTool.setMetroIndex(searchIndex);
        AMGT4CEM_Network.setOpacity(layersByType, AMGT4CEM_LayerOpacityStore.getFactor('metro'));
        // Vue sur le réseau, sauf si un point est déjà posé ou si l'utilisateur a déjà bougé la carte.
        if (bounds.isValid() && !this.marker && !this._moved) this.map.fitBounds(bounds, { padding: [20, 20] });
      },
      (err) => console.error('[SIG4CEM] Réseau non chargé :', err));
  },

  /** Entrées locales pas encore téléversées : brouillon, envoi demandé, envoi en erreur. */
  async _showLocalEntries() {
    this.entriesGroup.clearLayers();
    const crs = AMGT4CEM_CRS;
    for (const e of await SIG.Entries.all()) {
      if (e.statut === SIG.STATUT.ENVOYE) continue;
      const amiante = e.flux === 'AMIANTE';
      const box = h('div', { class: 'sig4cem-popup' },
        h('strong', { text: e.label || 'Entrée' }),
        h('p', { text: STATUT_TEXTE[e.statut] || e.statut }),
        h('p', { text: `Observée le ${e.dateObservation || '?'}` }));
      L.marker(crs.lambertToLatLng([e.x, e.y]), {
        icon: L.divIcon({
          className: `sig4cem-entry-marker${amiante ? ' sig4cem-entry-marker--amiante' : ''}${e.statut === SIG.STATUT.ERREUR ? ' sig4cem-entry-marker--erreur' : ''}`,
          html: '<div class="sig4cem-entry-marker__dot"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      }).bindPopup(box).addTo(this.entriesGroup);
    }
  },

  _place(latlng) {
    if (!this.isOpen) return;
    this.map.closePopup(); // un clic sur une station ou un tunnel ouvre aussi sa popup d'information : inutile ici
    this._userPlaced = true;
    if (!this.marker) {
      this.marker = L.marker(latlng, {
        draggable: true,
        zIndexOffset: 1000,
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

  /** Ouvre l'écran, tout de suite ; `position` ({x, y} en Lambert 72) replace un point déjà choisi. */
  async open({ position, onValidate, onCancel }) {
    this._build();
    this.isOpen = true;
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
    this.map.once('movestart', () => { this._moved = true; });
    if (this.marker) { this.map.removeLayer(this.marker); this.marker = null; }
    await this._showLocalEntries();
    if (position) {
      const latlng = AMGT4CEM_CRS.lambertToLatLng([position.x, position.y]);
      this._moved = true;
      this.map.setView(latlng, Math.max(this.map.getZoom(), 17));
      this._place(latlng);
    }
  },

  close() {
    this.isOpen = false;
    if (this.el) this.el.classList.add('sig4cem-hidden');
  },
};
})();
