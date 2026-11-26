/**
 * Grille d'affichage de la carte : Lambert 72 (EPSG:31370), la grille des tuiles WMTS UrbIS de la Région.
 * Partagée par la carte (src/app.js), la carte de choix de position (src/signal/mapPicker.js), l'outil de calage
 * du synoptique et la page d'essai ; chargée après Leaflet, proj4 et proj4leaflet.
 *
 * Grille (GetCapabilities, TileMatrixSet « EPSG:31370 ») : 16 niveaux (0 à 15) de 256 px, coin haut-gauche (16478 ; 304073),
 * dénominateur d'échelle du niveau 0 = 3 973 618,066406251, divisé par 2 à chaque niveau. Résolution (mètres au sol par
 * pixel) = dénominateur × 0,00028 (taille de pixel de référence OGC). Le numéro de niveau n'a pas d'importance pour
 * l'utilisateur : les seuils d'affichage s'expriment en échelle 1:N (voir zoomThresholds.js).
 */
const AMGT4CEM_LambertGrid = (function () {
'use strict';

const GRILLE = {
  matrice: 'EPSG:31370',
  origine: [16478, 304073],
  echelle0: 3973618.066406251,
  pixelOGC: 0.00028,
  taille: 256,
  niveaux: 16,
};
const MAX_ZOOM = GRILLE.niveaux - 1;
const resolutions = Array.from({ length: GRILLE.niveaux }, (_, z) => (GRILLE.echelle0 * GRILLE.pixelOGC) / 2 ** z);

let _crs = null;

/** CRS Leaflet « Lambert 72 » avec la grille des tuiles ; distance calculée dans le plan Lambert (en mètres au sol). */
function crs() {
  if (_crs) return _crs;
  _crs = new L.Proj.CRS(AMGT4CEM_CONFIG.businessCRS.epsg, AMGT4CEM_CONFIG.businessCRS.proj4def, {
    origin: GRILLE.origine,
    resolutions,
  });
  // L.Proj.CRS n'a pas de calcul de distance : sans lui, l'échelle graphique et les mesures de la carte échouent. Lambert 72 est
  // conforme et son facteur d'échelle vaut presque 1 sur Bruxelles : la distance dans le plan est la distance au sol.
  _crs.distance = function (a, b) {
    const p = this.project(a);
    const q = this.project(b);
    return Math.hypot(q.x - p.x, q.y - p.y);
  };
  return _crs;
}

/** Mètres au sol par pixel au niveau z. */
const resolution = (z) => resolutions[0] / 2 ** z;
/** Mètres au sol par pixel de la carte à son niveau de zoom actuel. */
const resolutionCarte = (map) => resolution(map.getZoom());
const resolutionDeEchelle = (n) => Number(n) * GRILLE.pixelOGC;
const echelleDeResolution = (r) => r / GRILLE.pixelOGC;
/** Échelle 1:N de la carte à son zoom actuel (N, nombre réel). */
const echelleCarte = (map) => echelleDeResolution(resolutionCarte(map));
/** La carte est-elle à l'échelle 1:N ou plus détaillée ? (tolérance de 0,1 % pour les arrondis) */
const auMoinsDetaillee = (map, n) => resolutionCarte(map) <= resolutionDeEchelle(n) * 1.001;
/** Niveau de zoom entier dont la résolution est la plus proche de `res` mètres par pixel. */
const niveauPourResolution = (res) => Math.max(0, Math.min(MAX_ZOOM, Math.round(Math.log2(resolutions[0] / res))));

/** Échelle 1:N (arrondie à la centaine) d'un ancien zoom Web Mercator à la latitude de Bruxelles : migration des réglages enregistrés. */
function echelleDepuisZoomMercator(z) {
  const res = (156543.03392804097 * Math.cos((50.85 * Math.PI) / 180)) / 2 ** z;
  return Math.max(100, Math.round(echelleDeResolution(res) / 100) * 100);
}

return { GRILLE, MAX_ZOOM, resolutions, crs, resolution, resolutionCarte, resolutionDeEchelle, echelleDeResolution, echelleCarte, auMoinsDetaillee, niveauPourResolution, echelleDepuisZoomMercator };
})();
