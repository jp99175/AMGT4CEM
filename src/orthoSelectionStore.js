/**
 * Orthophotos proposées dans la navigation par année (⚙ Orthophotos du menu ☰ Carte) : une case par couple
 * « source:millésime » (ex. bruxelles:1953, vlaanderen:2022 ; voir AMGT4CEM_Basemap.entryCode). Même principe que
 * les autres sélecteurs (selectionStore.js) : sélection courante de l'appareil, préférences locales 💾, sélection
 * par défaut partagée (data/fonds-de-plan/orthophotos-selection-par-defaut.json, modifiable par un administrateur).
 *
 * Particularité : une sélection VIDE veut dire « tout » (AMGT4CEM_Basemap.filterTimeline) : une année ajoutée plus
 * tard à la configuration est donc proposée sans qu'il faille mettre le fichier à jour.
 */
const AMGT4CEM_OrthoSelectionStore = createSelectionStore({
  key: 'amgt4cem.ortho-selection.v1',
  preferencesKey: 'amgt4cem.ortho-default.v1',
  sharedUrl: './data/fonds-de-plan/orthophotos-selection-par-defaut.json',
  sharedRoute: 'shared/fonds-de-plan/orthophotos-selection-par-defaut',
  palette: () => ['#1565c0'], // la couleur n'a pas de sens ici : seule la présence de la clé compte
  label: 'Orthophotos',
});
