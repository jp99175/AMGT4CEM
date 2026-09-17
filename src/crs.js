/**
 * Transformations de coordonnées entre le référentiel métier (Lambert belge,
 * EPSG:31370) et le référentiel d'affichage de Leaflet (WGS84 lat/lng).
 *
 * IMPORTANT : ces transformations sont UNIQUEMENT des conversions techniques
 * d'affichage. Le référentiel métier de l'application reste Lambert (X/Y),
 * conformément à Metro.json. On ne "convertit" jamais définitivement une
 * donnée métier en lat/lng : on la projette à la volée pour l'affichage.
 */
proj4.defs(AMGT4CEM_CONFIG.businessCRS.epsg, AMGT4CEM_CONFIG.businessCRS.proj4def);

const AMGT4CEM_CRS = {
  /**
   * Convertit un couple [X, Y] Lambert 72 en L.LatLng (WGS84) pour Leaflet.
   */
  lambertToLatLng([x, y]) {
    const [lon, lat] = proj4(AMGT4CEM_CONFIG.businessCRS.epsg, 'WGS84', [x, y]);
    return L.latLng(lat, lon);
  },

  /**
   * Convertit un L.LatLng Leaflet (WGS84) en coordonnées Lambert 72 {x, y}.
   * Pleine précision conservée (aucun arrondi destructif).
   */
  latLngToLambert(latlng) {
    const [x, y] = proj4('WGS84', AMGT4CEM_CONFIG.businessCRS.epsg, [latlng.lng, latlng.lat]);
    return { x, y };
  },

  /**
   * Formate une coordonnée Lambert pour affichage lisible (arrondi visuel
   * uniquement, ne touche pas à la valeur stockée).
   */
  formatCoord(value, decimals = 2) {
    return Number(value).toFixed(decimals);
  },
};
