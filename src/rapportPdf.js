/**
 * Rapport PDF d'une entrée envoyée : bouton (icône PDF) qui ouvre le PDF de la version indiquée.
 * Le PDF est fabriqué sur l'appareil à chaque envoi et rangé par le serveur (revisions/v0.NN.pdf) ; ce module ne fait que le lire.
 * Utilisé par la carte (fenêtre d'une entrée) et par Saisie (listes d'entrées).
 */
(function () {
const nomFichier = (reference, version) => `FICH_${reference}-v0-${String(version).padStart(2, '0')}_FR.pdf`;

async function ouvrir(reference, version, bouton) {
  // Fenêtre ouverte tout de suite (le clic autorise l'ouverture), remplie quand le PDF est arrivé.
  const fenetre = window.open('', '_blank');
  if (bouton) bouton.disabled = true;
  try {
    const blob = await AMGT4CEM_Auth.call(`/signalements/${encodeURIComponent(reference)}/pdf?v=${Number(version) || 1}`, { blob: true });
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (fenetre) fenetre.location.href = url;
    else {
      const a = document.createElement('a');
      a.href = url;
      a.download = nomFichier(reference, version);
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (err) {
    if (fenetre) fenetre.close();
    alert(err.status === 404 ? 'Pas de rapport PDF pour cette version.' : `Rapport PDF indisponible : ${err.message}`);
  } finally {
    if (bouton) bouton.disabled = false;
  }
}

window.AMGT4CEM_RapportPdf = {
  ouvrir,
  nomFichier,
  /** Bouton à icône seule (23 px, trait fin, bleu). */
  bouton(reference, version) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'amgt-rapport-pdf';
    b.title = 'Rapport PDF';
    b.setAttribute('aria-label', 'Rapport PDF');
    b.innerHTML = '<span class="amgt-rapport-pdf__ic" aria-hidden="true"></span>';
    b.addEventListener('click', () => ouvrir(reference, version, b));
    return b;
  },
};
})();
