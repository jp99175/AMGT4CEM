/**
 * Affichage des coordonnées Lambert (X, Y) sous l'échelle graphique, en bas
 * à gauche de l'écran (voir scaleControl.js). Masqué par défaut : un clic
 * sur l'échelle le fait apparaître/disparaître (voir toggle()) — pratique
 * aussi sur tablette, où il n'existe pas de survol de souris. Une fois
 * affiché, le panneau se met à jour au survol de la carte (souris) et à
 * chaque clic/tap sur la carte (tactile). La latitude/longitude n'est
 * jamais montrée à l'utilisateur.
 */
const AMGT4CEM_CoordsDisplay = {
  _el: null,

  init(map) {
    this._el = document.getElementById('amgt-coords-display');

    const showAt = (latlng) => {
      const { x, y } = AMGT4CEM_CRS.latLngToLambert(latlng);
      this._el.textContent = `X : ${AMGT4CEM_CRS.formatCoord(x)}    Y : ${AMGT4CEM_CRS.formatCoord(y)}`;
    };

    map.on('mousemove', (e) => showAt(e.latlng));
    map.on('click', (e) => showAt(e.latlng));
  },

  toggle() {
    const showing = this._el.classList.toggle('amgt-hidden') === false;
    if (showing && !this._el.textContent) {
      this._el.textContent = 'Cliquez sur la carte pour voir les coordonnées';
    }
  },
};
