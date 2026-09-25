/**
 * Capture PNG de la carte, associée à l'outil "📏 Mesurer" (measureTool.js) :
 *
 * 1. Dès le 2e relâchement (rayon figé), measureTool.js appelle
 *    captureToClipboard() : la carte est immédiatement capturée à cet
 *    instant exact et copiée dans le presse-papier système (Clipboard API).
 *    Capturer au moment précis du relâchement, plutôt qu'à un clic ultérieur
 *    sur "Capture", élimine toute course avec le délai d'affichage de la
 *    mesure ou la vitesse de l'appareil : l'image obtenue correspond
 *    toujours exactement à ce qui vient d'être tracé, jamais à un état plus
 *    tardif (mesure déjà effacée, souris/doigt déplacé depuis...).
 * 2. Le bouton "📷 Capture" (visible seulement le temps de measureTool.js,
 *    _hideDelayMs) ne fait que SAUVEGARDER cette même image déjà capturée
 *    (téléchargement direct), sans refaire de rendu.
 * 3. Si l'image capturée n'est pas sauvegardée (bouton non cliqué avant la
 *    disparition de la mesure, ou nouvelle mesure démarrée entre-temps),
 *    measureTool.js appelle clearClipboardIfUnsaved() pour ne pas laisser
 *    une image de mesure oubliée dans le presse-papier de l'utilisateur.
 *
 * Fond capturé une seule fois par activation (pas à chaque mesure) :
 * régénérer TOUTE l'image (tuiles + couches) à chaque capture, via
 * html2canvas (rendu DOM, useCORS: true), s'est révélé peu fiable en usage
 * réel : useCORS force une RE-REQUÊTE réseau de chaque tuile/image
 * cross-origin (WMS UrbIS/Bruciel...) indépendante de l'image déjà chargée
 * et visible à l'écran, et cette re-requête peut échouer selon le réseau du
 * moment même quand la tuile d'origine est parfaitement affichée. Comme le
 * glisser/pincer-zoomer de la carte sont désactivés tant que l'outil
 * "Mesurer" est actif (measureTool.js), la vue ne peut pas changer entre
 * deux mesures d'une même activation : un seul fond (_ensureBackground) est
 * donc capturé au besoin, mis en cache, puis réutilisé pour toutes les
 * mesures suivantes de cette activation (invalidé par measureTool.js à
 * chaque activate()/deactivate()). Seuls le cercle, le segment, le point
 * central et la cote — dont la géométrie exacte est déjà connue, aucun
 * réseau impliqué — sont redessinés à CHAQUE capture, directement en
 * Canvas 2D (measureTool.js, drawOverlayOnContext), puis composés par-dessus
 * ce fond : ces éléments ne peuvent donc plus jamais disparaître d'une
 * capture pour une raison réseau.
 *
 * Limite connue : si le fond WMS n'a pas pu être capturé du tout (service
 * indisponible dès la 1re capture de l'activation), il reste blanc dans
 * toutes les captures de cette activation ; les couches vectorielles
 * (réseau métro, UrbIS Topo, Plans patrimoine) et la mesure elle-même,
 * dessinées directement dans la page/en Canvas 2D, sont toujours capturées.
 *
 * Limite Clipboard API : l'écriture presse-papier nécessite un contexte de
 * geste utilisateur actif, qu'un rendu asynchrone (parfois lent) ferait
 * perdre si on attendait son résultat avant d'appeler clipboard.write() —
 * on lui passe donc directement une Promise<Blob> en argument (technique
 * recommandée), en appelant clipboard.write() de façon synchrone dès le
 * relâchement. Si le navigateur ne supporte pas l'écriture presse-papier
 * d'image (ou refuse la permission), seule cette copie échoue
 * silencieusement ; la sauvegarde via le bouton "Capture" reste disponible
 * indépendamment.
 *
 * Rendu Canvas (voir app.js, preferCanvas) plutôt que SVG pour les couches
 * (Métro, UrbIS Topo, Plans patrimoine...) : plus fiable pour html2canvas
 * lors de la capture du fond. Leaflet repeint son canvas de façon
 * asynchrone (au prochain requestAnimationFrame) après une mise à jour —
 * _waitForPaint() (2 requestAnimationFrame d'attente) laisse ce repaint se
 * terminer avant de lancer html2canvas.
 */
const AMGT4CEM_ScreenshotTool = {
  _map: null,
  _blobPromise: null,
  _saved: false,
  // Fond (tuiles + couches, sans la mesure) capturé une fois par activation
  // de l'outil "Mesurer" — voir _ensureBackground/invalidateBackground.
  _backgroundCanvas: null,

  init(map) {
    this._map = map;
    document.getElementById('amgt-screenshot-btn').addEventListener('click', () => this.save());
  },

  /** Appelé par measureTool.js au moment précis du 2e relâchement. */
  captureToClipboard() {
    this._saved = false;
    this._blobPromise = this._buildCompositeBlob();

    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard
        .write([new ClipboardItem({ 'image/png': this._blobPromise })])
        .catch((err) => console.warn('[AMGT4CEM] Copie presse-papier impossible :', err));
    }

    this._blobPromise.catch((err) => console.error('[AMGT4CEM] Capture d\'écran impossible :', err));
  },

  /** Fond mis en cache (html2canvas) + cercle/segment/point/cote redessinés
   * à la main (measureTool.js, drawOverlayOnContext) par-dessus, composés
   * dans un nouveau canvas — voir en-tête du fichier. */
  async _buildCompositeBlob() {
    const background = await this._ensureBackground();

    const composite = document.createElement('canvas');
    composite.width = background.width;
    composite.height = background.height;
    const ctx = composite.getContext('2d');
    ctx.drawImage(background, 0, 0);

    // html2canvas capture en pixels réels (devicePixelRatio inclus) alors
    // que la géométrie de la mesure (latLngToContainerPoint) est en pixels
    // CSS : on remet le contexte à l'échelle pour que les deux coïncident.
    const scale = background.width / this._map.getSize().x;
    ctx.save();
    ctx.scale(scale, scale);
    AMGT4CEM_MeasureTool.drawOverlayOnContext(ctx);
    ctx.restore();

    return new Promise((resolve) => composite.toBlob(resolve, 'image/png'));
  },

  /** Capture (une seule fois par activation, voir invalidateBackground) le
   * fond de carte SANS la mesure : la pane dédiée (amgtMeasurePane) est
   * masquée le temps de la capture, pour ne jamais graver une mesure
   * précédente dans le fond réutilisé par les suivantes. */
  async _ensureBackground() {
    if (this._backgroundCanvas) return this._backgroundCanvas;

    const pane = this._map.getPane('amgtMeasurePane');
    const prevDisplay = pane ? pane.style.display : null;
    if (pane) pane.style.display = 'none';
    await this._waitForPaint();
    try {
      this._backgroundCanvas = await html2canvas(this._map.getContainer(), { useCORS: true, logging: false });
    } finally {
      if (pane) pane.style.display = prevDisplay || '';
    }
    return this._backgroundCanvas;
  },

  /** Appelé par measureTool.js à chaque activate()/deactivate() : le fond
   * mis en cache ne doit jamais être réutilisé d'une activation à l'autre
   * (seule période où la vue est garantie inchangée). */
  invalidateBackground() {
    this._backgroundCanvas = null;
  },

  /** Deux requestAnimationFrame : technique standard pour attendre qu'un
   * repaint planifié (ici, le canvas Leaflet, ou le masquage de la pane de
   * mesure) ait bien eu lieu. */
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
