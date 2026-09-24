/**
 * Catalogue des couches "Plans patrimoine" : données de référence fournies
 * directement par l'utilisateur (fichiers GeoJSON EPSG:31370, exportés de
 * son propre SIG patrimoine), jamais rechargées depuis un service externe —
 * contrairement à UrbIS Topo. Chaque fichier est chargé une seule fois par
 * src/patrimoineLayer.js, à la demande (voir patrimoineSelectionStore.js /
 * patrimoinePicker.js pour la sélection).
 *
 * Liste volontairement ouverte : d'autres plans pourront s'y ajouter au fur
 * et à mesure (voir le sélecteur "modifier la sélection").
 */
const AMGT4CEM_PATRIMOINE_CATALOG = [
  {
    id: 'plans-ensemble-500e',
    label: "Plans d'ensemble au 1/500e",
    file: './data/patrimoine-plans-ensemble-500e.json',
  },
  {
    id: 'numero-interstation',
    label: 'Numéros interstation',
    file: './data/patrimoine-numero-interstation.json',
  },
  {
    id: 'nom-station',
    label: 'Noms de station',
    file: './data/patrimoine-nom-station.json',
  },
];
