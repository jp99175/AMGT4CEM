/**
 * Affichage discret des coordonnées Lambert courantes du curseur
 * (section 8). La latitude/longitude n'est jamais montrée à l'utilisateur.
 */
const AMGT4CEM_CoordsDisplay = {
  init(map) {
    const el = document.getElementById('amgt-coords-display');
    map.on('mousemove', (e) => {
      const { x, y } = AMGT4CEM_CRS.latLngToLambert(e.latlng);
      el.textContent = `X : ${AMGT4CEM_CRS.formatCoord(x)}    Y : ${AMGT4CEM_CRS.formatCoord(y)}`;
    });
    map.on('mouseout', () => {
      el.textContent = '';
    });
  },
};
