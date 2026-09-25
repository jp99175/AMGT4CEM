/**
 * Capture PNG de la carte, associée à l'outil "📏 Mesurer" (measureTool.js) :
 *
 * 1. Dès le 2e relâchement (rayon figé), measureTool.js appelle
 *    captureToClipboard() : la carte est immédiatement capturée à cet
 *    instant exact (html2canvas, vendor/html2canvas — rendu DOM côté
 *    navigateur, rien envoyé à un serveur) et copiée dans le presse-papier
 *    système (Clipboard API). Capturer au moment précis du relâchement,
 *    plutôt qu'à un clic ultérieur sur "Capture", élimine toute course
 *    avec le délai d'affichage de la mesure ou la vitesse de l'appareil :
 *    l'image obtenue correspond toujours exactement à ce qui vient d'être
 *    tracé, jamais à un état plus tardif (mesure déjà effacée, souris/doigt
 *    déplacé depuis...).
 * 2. Le bouton "📷 Capture" (visible seulement les 3 secondes suivantes,
 *    voir measureTool.js) ne fait que SAUVEGARDER cette même image déjà
 *    capturée (téléchargement direct), sans refaire de rendu.
 * 3. Si l'image capturée n'est pas sauvegardée (bouton non cliqué avant la
 *    disparition de la mesure, ou nouvelle mesure démarrée entre-temps),
 *    measureTool.js appelle clearClipboardIfUnsaved() pour ne pas laisser
 *    une image de mesure oubliée dans le presse-papier de l'utilisateur.
 *
 * Limite connue : les tuiles du fond de carte (UrbIS/Bruciel, services WMS
 * externes) ne peuvent être incluses dans l'image que si ce service
 * autorise la lecture cross-origin de ses images (en-tête CORS) ; sinon
 * elles restent blanches dans la capture, mais les couches vectorielles
 * (réseau métro, UrbIS Topo, Plans patrimoine, mesure...), qui sont
 * dessinées directement dans la page, sont toujours capturées.
 *
 * Limite Clipboard API : l'écriture presse-papier nécessite un contexte de
 * geste utilisateur actif, qu'un rendu html2canvas (asynchrone, parfois
 * lent) ferait perdre si on attendait son résultat avant d'appeler
 * clipboard.write() — on lui passe donc directement une Promise<Blob> en
 * argument (technique recommandée), en appelant clipboard.write() de façon
 * synchrone dès le relâchement. Si le navigateur ne supporte pas l'écriture
 * presse-papier d'image (ou refuse la permission), seule cette copie
 * échoue silencieusement ; la sauvegarde via le bouton "Capture" reste
 * disponible indépendamment.
 *
 * Rendu Canvas (voir app.js, preferCanvas) plutôt que SVG pour les couches
 * (Métro, UrbIS Topo, Plans patrimoine, mesure...) : plus fiable pour
 * html2canvas, mais Leaflet repeint son canvas de façon asynchrone (au
 * prochain requestAnimationFrame) après un setRadius()/setLatLngs() —
 * capturer de façon strictement synchrone au relâchement risquait donc de
 * lire le canvas AVANT que le cercle/segment n'y soit effectivement
 * dessiné (2 requestAnimationFrame d'attente ci-dessous avant de lancer
 * html2canvas, pour laisser ce repaint se terminer).
 */
const AMGT4CEM_ScreenshotTool = {
  _map: null,
  _blobPromise: null,
  _saved: false,

  init(map) {
    this._map = map;
    document.getElementById('amgt-screenshot-btn').addEventListener('click', () => this.save());
  },

  /** Appelé par measureTool.js au moment précis du 2e relâchement. */
  captureToClipboard() {
    this._saved = false;
    this._blobPromise = this._waitForPaint()
      .then(() => html2canvas(this._map.getContainer(), { useCORS: true, logging: false }))
      .then((canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png')));

    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard
        .write([new ClipboardItem({ 'image/png': this._blobPromise })])
        .catch((err) => console.warn('[AMGT4CEM] Copie presse-papier impossible :', err));
    }

    this._blobPromise.catch((err) => console.error('[AMGT4CEM] Capture d\'écran impossible :', err));
  },

  /** Deux requestAnimationFrame : technique standard pour attendre qu'un
   * repaint planifié (ici, le canvas Leaflet) ait bien eu lieu. */
  _waitForPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  },

  /** Appelé par measureTool.js quand la mesure disparaît sans avoir été sauvegardée. */
  clearClipboardIfUnsaved() {
    if (this._saved || !this._blobPromise) return;
    this._blobPromise = null;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // Pas de geste utilisateur actif à ce moment (appelé depuis un
      // minuteur) : le navigateur peut refuser silencieusement, tant pis —
      // rien de plus fiable n'existe pour "vider" le presse-papier.
      navigator.clipboard.writeText('').catch(() => { /* ignoré */ });
    }
  },

  async save() {
    if (!this._blobPromise) return;
    this._saved = true;

    const btn = document.getElementById('amgt-screenshot-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Capture…';
    try {
      const blob = await this._blobPromise;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `amgt4cem-${this._timestamp()}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.error('[AMGT4CEM] Sauvegarde de la capture impossible :', err);
      alert('Sauvegarde de la capture impossible : ' + err.message);
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
