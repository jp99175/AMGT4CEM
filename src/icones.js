/**
 * Registre unique des icônes géométriques en trait (disquette, croix, flèche de retour, œil…).
 *
 * Chaque dessin n'existe qu'ici. Les autres fichiers appellent AMGT4CEM_Icones.svg('disquette') au lieu de recopier
 * le tracé. Réglages par défaut : viewBox 24, dessin de 23 px, trait de 0,835 (soit 0,8 px), couleur = currentColor.
 *
 * Ce registre ne contient PAS les dessins de Jph (tracés remplis) : ceux-ci restent des fichiers .svg utilisés en
 * masque CSS ; ni les gros dessins propres à un outil (mesureIcones.js, logo).
 *
 * Chargé en premier par chaque interface (config.js).
 */
window.AMGT4CEM_Icones = (function () {
  const DEFAUT = { taille: 23, trait: 0.835 };

  const TRACES = {
    disquette: '<path d="M5 3h11.5L21 7.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3"/><path d="M7 21v-8h10v8"/>',
    fermer: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9l6 6M15 9l-6 6"/>',
    annuler: '<g transform="matrix(-1 0 0 1 24 0)"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5v4.5h-4.5"/></g>', // ↺
    replier: '<path d="M6 9l6 6 6-6"/>',
    deplier: '<path d="M6 15l6-6 6 6"/>',
    terminer: '<path d="M4.5 12.5l5 5 10-11"/>',
    coche: '<circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/>',
    pause: '<rect x="7" y="5" width="3.6" height="14" rx="1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1"/>',
    lecture: '<path d="M8 5.2l11 6.8-11 6.8z"/>',
    polygone: '<path d="M12 3.5l7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8z"/>',
    oeil: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    oeilBarre: '<path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .5 4.2 1.2M21.5 12S18 18.5 12 18.5c-1.6 0-3-.5-4.2-1.2"/><path d="M4 4l16 16"/>',
    remplir: '<path d="M5 5h14v14H5z"/><path d="M5 10l5-5M5 15l10-10M5 19l14-14M10 19l9-9M15 19l4-4"/>',
    unir: '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="13" r="5"/><path d="M19 3v5M16.5 5.5h5"/>',
    soustraire: '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="13" r="5" stroke-dasharray="2 2"/><path d="M16.5 5.5h5"/>',
    modifier: '<path d="M4 18l5-8 5 5 6-9"/><circle cx="4" cy="18" r="1.7"/><circle cx="9" cy="10" r="1.7"/><circle cx="14" cy="15" r="1.7"/><circle cx="20" cy="6" r="1.7"/>',
  };

  /** Enveloppe SVG (viewBox 24, trait arrondi, currentColor) autour d'un contenu quelconque. */
  function enveloppe(contenu, opt) {
    const o = Object.assign({}, DEFAUT, opt);
    return `<svg viewBox="0 0 24 24" width="${o.taille}" height="${o.taille}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="${o.trait}" stroke-linecap="round" stroke-linejoin="round">${contenu}</svg>`;
  }

  /** Icône du registre par son nom. opt : { taille, trait }. */
  function svg(nom, opt) {
    if (!(nom in TRACES)) throw new Error(`Icône inconnue : ${nom}`);
    return enveloppe(TRACES[nom], opt);
  }


  return { TRACES, enveloppe, svg };
})();
