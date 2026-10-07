/**
 * Sélection des couches « Plans patrimoine » à afficher sur la carte (id de catalogues/plans-patrimoine.js
 * -> couleur) : même principe que UrbIS Topo (voir selectionStore.js) — sélection courante de l'appareil,
 * préférences locales 💾, sélection par défaut partagée data/plans-patrimoine/selection-par-defaut.json.
 * Rien n'est présélectionné tant qu'un administrateur n'a pas enregistré de sélection par défaut.
 */
const AMGT4CEM_PatrimoineSelectionStore = createSelectionStore({
  key: 'amgt4cem.patrimoine-selection.v1',
  preferencesKey: 'amgt4cem.patrimoine-default.v1',
  sharedUrl: AMGT4CEM_CONFIG.patrimoine.defaultSelectionUrl,
  sharedRoute: 'shared/plans-patrimoine/selection-par-defaut',
  palette: () => AMGT4CEM_CONFIG.patrimoine.colorPalette,
  label: 'Plans patrimoine',
});
