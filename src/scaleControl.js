/**
 * Échelle graphique (contrôle Leaflet natif), en bas à gauche de la carte.
 * Un clic dessus affiche/masque le panneau de coordonnées Lambert
 * (coordsDisplay.js) juste au-dessus.
 */
const AMGT4CEM_ScaleControl = {
  init(map) {
    const scale = L.control.scale({
      position: 'bottomleft',
      metric: true,
      imperial: false,
    }).addTo(map);

    const container = scale.getContainer();
    container.style.cursor = 'pointer';
    container.title = 'Afficher/masquer les coordonnées';
    L.DomEvent.on(container, 'click', () => AMGT4CEM_CoordsDisplay.toggle());
  },
};
