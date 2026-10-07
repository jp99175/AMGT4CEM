/**
 * Catalogue des couches "Plans patrimoine" (sélecteur « modifier la sélection »,
 * voir patrimoinePicker.js / patrimoineSelectionStore.js).
 *
 * - Plans d'ensemble au 1/500e : `external: true`. Les planches sont des polygones
 *   (genre « planche ») de data/shapefile/polygones.shp, étiquetés par le `sheet_ref`
 *   du référentiel (data/metro/ et data/plans-patrimoine/ (polygones.json)) ; leur couche Leaflet est construite
 *   par metroLayer.js et enregistrée auprès de patrimoineLayer.js
 *   (registerExternalLayer(), voir app.js) : la case à cocher ne fait qu'afficher/masquer
 *   cette couche. Couleur et opacité restent réglées avec le réseau Métro (curseur « Métro »).
 *   La même case affiche les repères de tronçon legacy (triangles + codes PE_info,
 *   data/plans-patrimoine/reperes-troncons.legacy.json) et les références de planche
 *   (data/plans-patrimoine/etiquettes-planches.json).
 * - Numéros interstation : étiquettes de data/plans-patrimoine/etiquettes-troncons.json,
 *   rattachées à un tronçon (polygone de genre « tunnel ») par son `id` ; `file` n'est plus
 *   lu (archive legacy, à retirer quand lignes.shp existera).
 *
 * Liste volontairement ouverte : d'autres plans pourront s'y ajouter au fur et à mesure.
 */
const AMGT4CEM_PATRIMOINE_CATALOG = [
  {
    id: 'numero-interstation',
    label: 'Numéros interstation',
    file: './data/plans-patrimoine/numeros-interstation.legacy.json',
    // Rendu spécifique (src/interstation.js) : texte souligné à taille réelle
    // constante + ligne de repère jusqu'au centre du tronçon, au lieu du
    // simple libellé des autres couches de ce catalogue. Sans infobulle : le
    // numéro apparaît dans celle de l'emprise du tronçon. Les étiquettes
    // viennent de data/plans-patrimoine/etiquettes-troncons.json (source unique) ;
    // `file` n'est plus lu : archive d'origine, qui a servi à amorcer ce JSON.
    interstation: true,
  },
  {
    id: 'plans-ensemble-500e',
    label: "Plans d'ensemble (1/500e)",
    external: true,
  },
];
