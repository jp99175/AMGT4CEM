/**
 * Mention « BUILD AAAAMMJJ-HHMM » tout en bas des pages Saisie et Réglages : petits caractères rouges, alignée à droite,
 * après le contenu et au-dessus du bandeau Carte / Saisie / Réglages (la page réserve déjà la place du bandeau). Il
 * faut descendre en bas de la page pour la voir. Même aspect que sur la carte (src/buildInfoControl.js).
 */
(function () {
function poser() {
  if (document.getElementById('amgt-build-page') || typeof AMGT4CEM_BUILD_TIMESTAMP === 'undefined') return;
  const el = document.createElement('div');
  el.id = 'amgt-build-page';
  el.className = 'amgt-build-page';
  el.textContent = `BUILD ${AMGT4CEM_BUILD_TIMESTAMP}`;
  document.body.append(el);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poser); else poser();
})();
