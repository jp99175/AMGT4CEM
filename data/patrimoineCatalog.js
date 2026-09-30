/**
 * Catalogue des couches "Plans patrimoine" : données de référence fournies
 * directement par l'utilisateur (fichiers GeoJSON EPSG:31370, exportés de
 * son propre SIG patrimoine), jamais rechargées depuis un service externe —
 * contrairement à UrbIS Topo. Chaque fichier est chargé une seule fois par
 * src/patrimoineLayer.js, à la demande (voir patrimoineSelectionStore.js /
 * patrimoinePicker.js pour la sélection).
 *
 * Les plans d'ensemble au 1/500e ont été fusionnés dans
 * Metro_export_SHP/Metro.shp (type "PE", géométrie + popups gérés par
 * metroLayer.js) : cette entrée n'a donc pas de `file` propre (`external:
 * true`), sa case à cocher ne fait qu'afficher/masquer la couche Leaflet
 * déjà construite par metroLayer.js, enregistrée auprès de ce module via
 * AMGT4CEM_PatrimoineLayer.registerExternalLayer() (voir app.js). Couleur
 * et opacité de cette couche restent gérées par metroLayer.js/mapMenu.js
 * (curseur "Métro"), pas par la pastille de couleur du sélecteur ici.
 * data/patrimoine-plans-ensemble-500e.json n'est donc plus chargé par l'app,
 * mais conservé (et sa géométrie reste la source de la fusion ci-dessus).
 * Les repères "PE_info" (Metro_export_SHP/MetroInfo.shp, transitions entre
 * tronçons de construction relevées dans INFRAVIEW.pdf — voir README
 * section 4bis) sont affichés/masqués par la même case : pas d'entrée de
 * catalogue séparée, ils sont fusionnés dans le même groupe Leaflet que PE
 * avant l'enregistrement (voir app.js).
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
  {
    id: 'plans-ensemble-500e',
    label: "Plans d'ensemble (1/500e)",
    external: true,
  },
];
