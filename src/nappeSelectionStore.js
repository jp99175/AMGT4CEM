/**
 * Éléments affichés par la couche « Géotechnique » (codes : isopieses, bandes, stations), même principe que les
 * autres sélecteurs (voir selectionStore.js) : sélection de l'appareil, préférences locales 💾, sélection par défaut
 * partagée config/nappe/selection-par-defaut.json (modifiable par un administrateur via le relais).
 * Une entrée présente = élément affiché ; la valeur (couleur) n'a pas de sens ici.
 */
const AMGT4CEM_NappeSelectionStore = createSelectionStore({
  key: 'amgt4cem.nappe-selection.v1',
  preferencesKey: 'amgt4cem.nappe-default.v1',
  sharedUrl: './config/nappe/selection-par-defaut.json',
  sharedRoute: 'shared/nappe/selection-par-defaut',
  palette: () => ['#0b5c75'],
  label: 'Géotechnique',
});
