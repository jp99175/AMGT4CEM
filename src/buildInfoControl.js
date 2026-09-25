/**
 * Petite mention "BUILD AAAAMMJJ-HHMM" en bas à droite de la carte, sous
 * l'attribution "(c) CIRB - UrbIS" (voir buildInfo.js pour la valeur).
 * Purement diagnostique : permet de vérifier quelle version du code est
 * effectivement servie, sans consulter l'historique git.
 */
const AMGT4CEM_BuildInfoControl = {
  init(map) {
    const Control = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        const el = L.DomUtil.create('div', 'amgt-build-info');
        el.textContent = `BUILD ${AMGT4CEM_BUILD_TIMESTAMP}`;
        return el;
      },
    });
    new Control().addTo(map);
  },
};
