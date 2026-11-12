/**
 * Indicateur de téléchargement des cartes hors ligne sur la page Carte : un liseré épais autour du bouton « Couches »,
 * qui se remplit à partir du haut dans le sens des aiguilles d'une montre, et disparaît à la fin du téléchargement.
 * Interrompu (arrêt, erreur, tuiles en échec) : il reste figé en orange à l'avancement atteint.
 * L'avancement vient du service worker (sw.js) ; sans service worker il n'y a pas d'indicateur.
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  let anneau = null;

  function montrer(pourcent, interrompu) {
    const bouton = document.getElementById('amgt-menu-btn');
    if (!bouton) return;
    if (!anneau) { anneau = document.createElement('span'); anneau.className = 'hl-anneau'; anneau.setAttribute('aria-hidden', 'true'); }
    if (!anneau.isConnected) bouton.append(anneau); // le menu Couches réécrit le contenu du bouton : on remet le liseré si besoin
    anneau.style.setProperty('--hl-p', String(Math.max(0, Math.min(100, pourcent))));
    anneau.classList.toggle('hl-anneau--interrompu', !!interrompu);
    bouton.title = interrompu ? 'Couches (téléchargement des cartes interrompu)' : `Couches (téléchargement des cartes : ${Math.round(pourcent)} %)`;
  }
  function cacher() {
    if (anneau && anneau.isConnected) anneau.remove();
    const bouton = document.getElementById('amgt-menu-btn');
    if (bouton) bouton.title = 'Couches';
  }

  /** etat : actif | fini | arret | erreur ; faites / total : tuiles gardées sur tuiles du travail ; erreurs : tuiles en échec. */
  function appliquer(etat, faites, total, erreurs) {
    const p = total ? (100 * faites) / total : 0;
    if (etat === 'actif') montrer(p, false);
    else if (etat === 'fini' && !erreurs) cacher();
    else if (etat === 'fini' || etat === 'arret' || etat === 'erreur') montrer(p, true);
    else cacher();
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    const m = event.data || {};
    if (m.type === 'progression') appliquer(m.etat, m.faites, m.total, m.erreurs);
    else if (m.type === 'etat') { if (m.travail) appliquer(m.travail.etat, m.travail.faites, m.travail.total, m.travail.erreurs); else cacher(); }
  });

  function demander() {
    const c = navigator.serviceWorker.controller;
    if (c) c.postMessage({ type: 'etat' });
  }
  if (document.readyState === 'complete') demander(); else window.addEventListener('load', demander);
  navigator.serviceWorker.addEventListener('controllerchange', demander);
}());
