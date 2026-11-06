/**
 * Catalogue des couches "Plans patrimoine" (sélecteur « modifier la sélection »,
 * voir patrimoinePicker.js / patrimoineSelectionStore.js).
 *
 * - Plans d'ensemble au 1/500e : `external: true`. Les planches sont des polygones
 *   (genre « planche ») de data/shapefile/polygones.shp, étiquetés par le `sheet_ref`
 *   du référentiel (data/ditp-diov/ et data/plans-patrimoine/ (polygones.json)) ; leur couche Leaflet est construite
 *   par ditpDiovLayer.js et enregistrée auprès de patrimoineLayer.js
 *   (registerExternalLayer(), voir app.js) : la case à cocher ne fait qu'afficher/masquer
 *   cette couche. Couleur et opacité restent réglées avec le réseau DITP-DIOV (curseur « DITP-DIOV »).
 *   La même case affiche les repères de tronçon legacy (triangles + codes PE_info,
 *   data/plans-patrimoine/reperes-troncons.legacy.json) et les références de planche
 *   (data/plans-patrimoine/etiquettes-planches.json).
 * - Numéros interstation : étiquettes de data/plans-patrimoine/etiquettes-troncons.json,
 *   rattachées à un tronçon (polygone de genre « tunnel ») par son `id` ; `file` n'est plus
 *   lu (archive legacy, à retirer quand lignes.shp existera).
 *
 * Liste volontairement ouverte : d'autres plans pourront s'y ajouter au fur et à mesure.
 */
/** Rubriques du sélecteur « Plans patrimoine » (ordre d'affichage), comme les thèmes d'UrbIS Topo. */
const AMGT4CEM_PATRIMOINE_THEME_ORDER = ['INFRAVIEW', 'Autres'];

const AMGT4CEM_PATRIMOINE_CATALOG = [
  {
    id: 'numero-interstation',
    label: 'Numéros interstation',
    theme: 'INFRAVIEW',
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
    id: 'temp_DELTA_mod',
    label: 'Zones à intégrer',
    theme: 'Autres',
    // Couche des lieux : l'ancienne emprise provisoire (copie translatée de P000150) est devenue le lieu
    // « Station DELTA » de data/lieux/lieux.json (05/11/2026) ; temp-delta-mod.json est conservé vide,
    // car la couche le lit encore avant d'ajouter les lieux enregistrés.
    file: './data/plans-patrimoine/temp-delta-mod.json',
    // Ouvrages atypiques ajoutés à la même couche : objets UrbIS Topo (TopoLines) lus au vol par
    // identifiant (le service n'est joignable que depuis un navigateur) et dessinés avec la même
    // couleur : polygone si la ligne est fermée, trait sinon. À valider par l'utilisateur ; ils
    // deviendront des « lieux » du formulaire de signalement.
    lieuxFile: './data/lieux/lieux.json', // lieux enregistrés par src/lieuxTool.js : prioritaires sur la liste provisoire ci-dessous
    urbisObjets: [
      { lieu: 'Auvent FLAGEY', code: 'BB1202L', id: 1160595 },
      { lieu: 'Auvent ROGIER', code: 'BB1202L', id: 170857761 },
      { lieu: 'Passerelle BEEKKANT', code: 'BR03L', id: 1816969 },
      { lieu: 'Ascenseur POELAERT (bâtiment)', code: 'BB01L', id: 7864774 },
      { lieu: 'Ascenseur POELAERT (bâtiment)', code: 'BB01L', id: 7864798 },
      { lieu: 'Ascenseur POELAERT (passerelle)', code: 'BR03L', id: 1817683 },
    ],
  },
  {
    // ESSAI (05/11/2026) : shapefile provisoire généré depuis les zones ci-dessus (data/shapefile-test/), pour
    // éprouver la lecture d'un shapefile et, plus tard, l'écriture. N'entre ni dans polygones.shp ni dans le référentiel.
    id: 'test_shapefile',
    label: 'test_shapefile (essai : zones à intégrer en shapefile)',
    theme: 'Autres',
    shapefile: './data/shapefile-test/test_shapefile',
    referentiel: './data/shapefile-test/test_shapefile.json',
  },
  {
    id: 'plans-ensemble-500e',
    label: "Plans d'ensemble (1/500e)",
    theme: 'INFRAVIEW',
    external: true,
  },
];
