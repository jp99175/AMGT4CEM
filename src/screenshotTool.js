/**
 * Bouton "📷 Capture" : exporte en PNG (téléchargement direct) l'état actuel
 * de la carte affichée à l'écran — utile notamment pour garder une trace
 * d'une mesure (measureTool.js), qui disparaît 3 secondes après la fin du
 * geste. Utilise html2canvas (vendor/html2canvas), une capture DOM côté
 * navigateur, sans rien envoyer à un serveur.
 *
 * Limite connue : les tuiles du fond de carte (UrbIS/Bruciel, services WMS
 * externes) ne peuvent être incluses dans l'image que si ce service
 * autorise la lecture cross-origin de ses images (en-tête CORS) ; sinon
 * elles restent blanches dans la capture, mais les couches vectorielles
 * (réseau métro, UrbIS Topo, Plans patrimoine, mesure en cours...), qui
 * sont dessinées directement dans la page, sont toujours capturées.
 */
const AMGT4CEM_ScreenshotTool = {
  init(map) {
    this._map = map;
    document.getElementById('amgt-screenshot-btn').addEventListener('click', () => this.capture());
  },

  async capture() {
    const btn = document.getElementById('amgt-screenshot-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Capture…';
    try {
      const canvas = await html2canvas(this._map.getContainer(), {
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `amgt4cem-${this._timestamp()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('[AMGT4CEM] Capture d\'écran impossible :', err);
      alert('Capture d\'écran impossible : ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  },

  _timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  },
};
