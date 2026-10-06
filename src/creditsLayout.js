/**
 * Disposition du bas de la carte : crédits en bas à droite, échelle en bas à
 * gauche, repère BUILD juste au-dessus des crédits.
 *
 * Quand le crédit (qui change selon les données affichées, voir basemap.js)
 * et l'échelle ne tiennent plus côte à côte, la barre de crédits passe en
 * pleine largeur, translucide, et l'échelle se place AU-DESSUS d'elle (classe
 * `amgt-credits-wide` sur le conteneur de la carte, voir style.css). La mesure
 * se fait en retirant la classe, en mesurant la largeur naturelle des deux
 * éléments, puis en la remettant si besoin : elle est rejouée à chaque
 * changement de leur contenu (changement de fond, mode échelle/coordonnées,
 * couches ajoutées/retirées) et au redimensionnement de la fenêtre.
 */
const AMGT4CEM_CreditsLayout = {
  _GAP_PX: 12,

  init(map) {
    const mapEl = map.getContainer();
    const attribution = mapEl.querySelector('.leaflet-control-attribution');
    const scale = mapEl.querySelector('.amgt-scale-control');
    if (!attribution || !scale) return;

    const apply = () => {
      mapEl.classList.remove('amgt-credits-wide');
      const needed = attribution.offsetWidth + scale.offsetWidth + this._GAP_PX;
      const wide = needed > mapEl.clientWidth;
      mapEl.classList.toggle('amgt-credits-wide', wide);
      // Hauteur de la barre de crédits : l'échelle se pose juste au-dessus.
      mapEl.style.setProperty('--amgt-credits-h', `${wide ? attribution.offsetHeight : 0}px`);
    };

    // Plusieurs changements de contenu à la suite (ex. retrait puis ajout de
    // couche) ne déclenchent qu'une mesure, au prochain affichage.
    let pending = false;
    const schedule = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        apply();
      });
    };

    // Contenu seulement (childList/characterData) : le changement de classe de
    // `apply` ne relance donc pas l'observateur.
    const observer = new MutationObserver(schedule);
    for (const el of [attribution, scale]) {
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    }
    window.addEventListener('resize', schedule);
    map.on('resize', schedule);
    schedule();
  },
};
