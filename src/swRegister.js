/**
 * Enregistre le service worker (sw.js, à la racine) : ouverture de l'application sans réseau et téléchargement des tuiles
 * hors de la page. Sans effet si le navigateur ou la page (HTTP hors localhost) ne le permet pas : l'application marche alors comme avant.
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((err) => console.warn('[AMGT4CEM] Service worker non enregistré :', err && err.message));
  });
}());
