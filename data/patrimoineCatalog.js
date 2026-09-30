/**
 * Catalogue des couches "Plans patrimoine" : données de référence fournies
 * directement par l'utilisateur (fichiers GeoJSON EPSG:31370, exportés de
 * son propre SIG patrimoine), jamais rechargées depuis un service externe —
 * contrairement à UrbIS Topo. Chaque fichier est chargé une seule fois par
 * src/patrimoineLayer.js, à la demande (voir patrimoineSelectionStore.js /
 * patrimoinePicker.js pour la sélection).
 *
 * Les plans d'ensemble au 1/500e n'y figurent plus depuis leur fusion dans
 * Metro_export_SHP/Metro.shp (type "PE", voir metroLayer.js) : ils sont
 * désormais toujours affichés avec le reste du réseau métro, plus besoin de
 * les sélectionner ici séparément — data/patrimoine-plans-ensemble-500e.json
 * est conservé dans l'historique Git mais n'est plus chargé par l'app.
 *
 * Liste volontairement ouverte : d'autres plans pourront s'y ajouter au fur
 * et à mesure (voir le sélecteur "modifier la sélection").
 */
const AMGT4CEM_PATRIMOINE_CATALOG = [
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
