/**
 * Contrôle unique, en bas à gauche de la carte, qui alterne entre deux
 * affichages au clic :
 * - **Échelle** (par défaut) : une réglette graphique façon "latte", avec
 *   des graduations principales aux deux extrémités et des sous-graduations
 *   (plus courtes) à l'unité en dessous de la distance totale affichée —
 *   ex. tous les 1 km si la réglette indique "3 km" ou "5 km", tous les
 *   10 m si elle indique "30 m" ou "50 m" (voir _niceRound : même logique
 *   que le contrôle L.Control.Scale natif de Leaflet, dont elle reprend
 *   l'algorithme de choix d'une distance "ronde").
 * - **Coordonnées** Lambert (X, Y) du dernier point survolé/cliqué sur la
 *   carte — affichées 5 secondes puis on revient automatiquement à
 *   l'échelle (ou en cliquant à nouveau sur le contrôle). La
 *   latitude/longitude n'est jamais montrée à l'utilisateur.
 */
const AMGT4CEM_ScaleControl = {
  _map: null,
  _container: null,
  _mode: 'scale', // 'scale' | 'coords'
  _lastLatLng: null,
  _revertTimer: null,
  _maxWidthPx: 220,
  _coordsDisplayMs: 5000,

  init(map) {
    this._map = map;

    const self = this;
    const Control = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd() {
        const el = L.DomUtil.create('div', 'amgt-scale-control');
        L.DomEvent.disableClickPropagation(el);
        el.addEventListener('click', () => self._onClick());
        self._container = el;
        return el;
      },
    });
    new Control().addTo(map);

    map.on('mousemove', (e) => { this._lastLatLng = e.latlng; });
    map.on('zoomend moveend', () => this._renderScale());

    this._showScale();
  },

  _onClick() {
    if (this._mode === 'scale') this._showCoords();
    else this._showScale();
  },

  _showCoords() {
    clearTimeout(this._revertTimer);
    this._mode = 'coords';
    this._container.title = "Cliquez pour revenir à l'échelle";

    const latlng = this._lastLatLng || this._map.getCenter();
    const { x, y } = AMGT4CEM_CRS.latLngToLambert(latlng);
    this._container.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'amgt-scale-coords';
    span.textContent = `X : ${AMGT4CEM_CRS.formatCoord(x)}    Y : ${AMGT4CEM_CRS.formatCoord(y)}`;
    this._container.appendChild(span);

    this._revertTimer = setTimeout(() => this._showScale(), this._coordsDisplayMs);
  },

  _showScale() {
    clearTimeout(this._revertTimer);
    this._mode = 'scale';
    if (this._container) this._container.title = 'Cliquez pour afficher les coordonnées';
    this._renderScale();
  },

  _renderScale() {
    if (this._mode !== 'scale' || !this._container) return;

    const map = this._map;
    const y = map.getSize().y / 2;
    const maxMeters = map.distance(
      map.containerPointToLatLng([0, y]),
      map.containerPointToLatLng([this._maxWidthPx, y])
    );
    if (!maxMeters) return;

    const { value, segments } = this._niceRound(maxMeters);
    const widthPx = Math.max(1, Math.round(this._maxWidthPx * (value / maxMeters)));
    const label = value >= 1000 ? `${value / 1000} km` : `${value} m`;

    this._container.innerHTML = '';
    this._container.appendChild(this._buildRulerSvg(widthPx, segments));
    const labelEl = document.createElement('div');
    labelEl.className = 'amgt-scale-label';
    labelEl.textContent = label;
    this._container.appendChild(labelEl);
  },

  /**
   * Distance "ronde" à afficher (même algorithme que L.Control.Scale :
   * puissance de 10 la plus proche, arrondie à 1/2/3/5 fois cette
   * puissance) et nombre de segments égaux de sous-graduation qui en
   * découle : le chiffre de tête lui-même (3 km -> 3 x 1 km, 50 m -> 5 x
   * 10 m, 1 km -> 1 segment, pas de sous-graduation nécessaire).
   */
  _niceRound(num) {
    const pow10 = Math.pow(10, (Math.floor(num) + '').length - 1);
    const d = num / pow10;
    const segments = d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1;
    return { value: pow10 * segments, segments };
  },

  /** Réglette façon "latte" : ligne de base, graduations principales aux
   * deux bouts (pleine hauteur), sous-graduations internes plus courtes. */
  _buildRulerSvg(widthPx, segments) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const height = 14;
    const baseline = 12;
    const majorTop = 2;
    const minorTop = 7;

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', widthPx);
    svg.setAttribute('height', height);
    svg.setAttribute('class', 'amgt-scale-svg');

    const addLine = (x1, y1, x2, y2) => {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      svg.appendChild(line);
    };

    addLine(0, baseline, widthPx, baseline);
    addLine(0, majorTop, 0, baseline);
    addLine(widthPx, majorTop, widthPx, baseline);
    for (let i = 1; i < segments; i++) {
      const x = Math.round((widthPx * i) / segments);
      addLine(x, minorTop, x, baseline);
    }

    return svg;
  },
};
