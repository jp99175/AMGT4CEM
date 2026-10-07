/**
 * Sélection des types d'objets UrbIS Topo à afficher sur la carte (code -> couleur) : voir
 * data/urbis-topo/catalogue.js pour la liste des codes possibles et selectionStore.js pour le principe
 * (sélection courante de l'appareil, préférences locales 💾, sélection par défaut partagée
 * data/urbis-topo/selection-par-defaut.json). Interface : urbisTopoPicker.js ; affichage carte :
 * urbisTopoLayer.js.
 */
const AMGT4CEM_UrbisTopoSelectionStore = createSelectionStore({
  key: 'amgt4cem.urbistopo-selection.v1',
  preferencesKey: 'amgt4cem.urbistopo-default.v1', // clé historique du bouton 💾 : les préférences déjà enregistrées sont conservées
  sharedUrl: AMGT4CEM_CONFIG.urbisTopo.defaultSelectionUrl,
  sharedRoute: 'shared/urbis-topo/selection-par-defaut',
  palette: () => AMGT4CEM_CONFIG.urbisTopo.colorPalette,
  label: 'UrbIS Topo',
});
