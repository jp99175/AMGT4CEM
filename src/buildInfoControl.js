/**
 * Petite mention "BUILD AAAAMMJJ-HHMM" en bas à droite de la carte, au-dessus de
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
        const text = `BUILD ${AMGT4CEM_BUILD_TIMESTAMP}`;
        const url = AMGT4CEM_CONFIG.buildLinkUrl;
        if (url) {
          // Lien vers cette version (ZIP) : voir config.js pour la façon de la lancer.
          const a = L.DomUtil.create('a', '', el);
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = text;
          a.title = 'Télécharger cette version (ZIP). Lancer : décompresser, python -m http.server 8000, ouvrir http://localhost:8000';
          L.DomEvent.disableClickPropagation(el);
        } else {
          el.textContent = text;
        }
        return el;
      },
    });
    new Control().addTo(map);
  },
};
