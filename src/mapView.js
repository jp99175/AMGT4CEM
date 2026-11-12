/**
 * Dernière vue de la carte (centre et zoom), gardée le temps de l'onglet (sessionStorage) : en quittant la page Carte
 * (Réglages, formulaire de signalement...) puis en y revenant, ou après un rechargement, la carte n'est plus recentrée
 * sur toute la région. Rien n'est envoyé au serveur ; une nouvelle session repart de la vue d'ensemble.
 * Partagé par la carte (src/app.js) et par la carte de choix de position des signalements (src/signal/mapPicker.js).
 */
(function () {
const CLE = 'amgt4cem-derniere-vue';

const MapView = {
  /** Vue mémorisée { center: [lat, lng], zoom } ou null. */
  get() {
    try {
      const v = JSON.parse(sessionStorage.getItem(CLE) || 'null');
      if (v && Array.isArray(v.center) && v.center.every(Number.isFinite) && Number.isFinite(v.zoom)) return v;
    } catch (err) { /* stockage indisponible ou valeur illisible : pas de vue mémorisée */ }
    return null;
  },

  /** Mémorise la vue à chaque fin de déplacement ou de zoom. */
  suivre(map) {
    map.on('moveend', () => {
      const c = map.getCenter();
      try { sessionStorage.setItem(CLE, JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() })); } catch (err) { /* sans conséquence */ }
    });
  },
};

window.AMGT4CEM_MapView = MapView;
})();
