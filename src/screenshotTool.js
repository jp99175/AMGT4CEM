/**
 * Capture PNG de la carte, associée à l'outil "📏 Mesurer" (measureTool.js) :
 *
 * 1. Dès le 2e relâchement (rayon figé), measureTool.js appelle capture() :
 *    la carte est immédiatement capturée à cet instant exact et gardée en
 *    mémoire (Blob), comme un fichier temporaire — RIEN n'est envoyé ni
 *    écrit où que ce soit (ni presse-papier, ni disque) tant que
 *    l'utilisateur n'a pas explicitement demandé de la garder. Capturer au
 *    moment précis du relâchement, plutôt qu'à un clic ultérieur sur
 *    "💾", élimine toute course avec le délai d'affichage de la mesure ou
 *    la vitesse de l'appareil : l'image obtenue correspond toujours
 *    exactement à ce qui vient d'être tracé, jamais à un état plus tardif
 *    (mesure déjà effacée, souris/doigt déplacé depuis...).
 * 2. Le bouton "💾" (visible seulement le temps de measureTool.js,
 *    _hideDelayMs) déclenche le SEUL moment où cette image quitte la
 *    mémoire : téléchargement direct du fichier PNG, sans refaire de rendu.
 * 3. Si l'image capturée n'est pas enregistrée (bouton non cliqué avant la
 *    disparition de la mesure, ou nouvelle mesure démarrée entre-temps),
 *    measureTool.js appelle discardIfUnsaved() : la référence au Blob est
 *    simplement abandonnée (garbage collectée par le navigateur), rien n'a
 *    jamais quitté la mémoire de l'onglet.
 *
 * Fond capturé une seule fois par activation (pas à chaque mesure) :
 * régénérer TOUTE l'image (tuiles + couches) à chaque capture, via
 * html2canvas (rendu DOM, useCORS: true), s'est révélé peu fiable en usage
 * réel : useCORS force une RE-REQUÊTE réseau de chaque tuile/image
 * cross-origin (WMS UrbIS/Bruciel...) indépendante de l'image déjà chargée
 * et visible à l'écran, et cette re-requête peut échouer selon le réseau du
 * moment même quand la tuile d'origine est parfaitement affichée. Un seul
 * fond (_ensureBackground) est donc capturé au besoin, mis en cache, puis
 * réutilisé pour toutes les mesures suivantes — TANT QUE la vue affichée
 * n'a pas pu changer : invalidé (invalidateBackground) par measureTool.js à
 * chaque activate()/deactivate() de l'outil "Mesurer" (glisser/pincer-zoomer
 * de la carte désactivés entre les deux, mais PAS le menu ☰ Carte, resté
 * utilisable), ET par tout changement de fond de plan ou de couche pendant
 * ce temps (basemap.js, _setActiveLayer ; mapMenu.js, cases à cocher et
 * curseurs d'opacité) — sans quoi une bascule UrbIS -> orthophoto en cours
 * de mesure resterait invisible dans les captures suivantes de la même
 * activation. Seuls le cercle, le segment, le point central et la cote —
 * dont la géométrie exacte est déjà connue, aucun réseau impliqué — sont
 * redessinés à CHAQUE capture, directement en Canvas 2D (measureTool.js,
 * drawOverlayOnContext), puis composés par-dessus ce fond : ces éléments ne
 * peuvent donc plus jamais disparaître d'une capture pour une raison réseau.
 *
 * Tuiles du fond de plan : recopiées depuis l'écran (_drawTiles), jamais
 * redemandées. Les couches de tuiles (basemap.js, _CorsWmsLayer) les
 * demandent avec CORS dès l'affichage, ce qui rend leurs pixels exportables.
 * Limite connue : un service qui refuse CORS reste affichable, mais son fond
 * n'apparaît pas dans l'image (backgroundIncomplete, message dans la console
 * et dans l'infobulle du « 💾 ») ; les couches vectorielles (réseau métro,
 * UrbIS Topo, Plans patrimoine) et la mesure elle-même sont toujours capturées.
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
  // Image de la mesure courante, gardée en mémoire comme un fichier
  // temporaire (jamais écrite nulle part tant que save() n'est pas appelé).
  _blobPromise: null,
  _saved: false,
  // Fond (tuiles + couches, sans la mesure) capturé une fois par activation
  // de l'outil "Mesurer" — voir _ensureBackground/invalidateBackground.
  _backgroundCanvas: null,
  // Des tuiles du fond de plan n'ont pas pu être recopiées dans le dernier fond capturé.
  backgroundIncomplete: false,

  init(map) {
    this._map = map;
    document.getElementById('amgt-screenshot-btn').addEventListener('click', () => this.save());
  },

  /** Appelé par measureTool.js au moment précis du 2e relâchement. */
  capture() {
    this._saved = false;
    this._blobPromise = this._buildCompositeBlob();
    this._blobPromise.catch((err) => console.error('[AMGT4CEM] Capture d\'écran impossible :', err));
  },

  /** Fond mis en cache (html2canvas) + cercle/segment/point/cote redessinés
   * à la main (measureTool.js, drawOverlayOnContext) par-dessus, composés
   * dans un nouveau canvas — voir en-tête du fichier. */
  async _buildCompositeBlob() {
    const background = await this._ensureBackground();
    const saveBtn = document.getElementById('amgt-screenshot-btn');
    if (saveBtn) {
      saveBtn.title = this.backgroundIncomplete
        ? 'Enregistrer la capture (sans le fond de plan : son service ne permet pas de le recopier)'
        : 'Enregistrer la capture de la mesure (image PNG)';
    }

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
   * fond de plan SANS la mesure : la pane dédiée (amgtMeasurePane) est
   * masquée le temps de la capture, pour ne jamais graver une mesure
   * précédente dans le fond réutilisé par les suivantes.
   *
   * Les tuiles du fond de plan (UrbIS, orthophotos) sont recopiées telles
   * quelles depuis l'écran (_drawTiles) au lieu d'être redemandées au réseau
   * par html2canvas : c'est cette nouvelle requête qui faisait disparaître
   * le fond de plan de l'image (voir en-tête). Le reste (couches vectorielles,
   * étiquettes, contrôles) passe toujours par html2canvas, sans les tuiles. */
  _ensureBackground() {
    if (this._backgroundCanvas) return Promise.resolve(this._backgroundCanvas);
    // Un seul calcul à la fois : deux captures qui se chevauchent relisaient l'état « masqué » de la pane
    // comme état d'origine et la laissaient masquée pour de bon (plus aucun tracé, ni rayon ni chaîne).
    if (!this._backgroundPromise) {
      const calcul = this._buildBackground().finally(() => { if (this._backgroundPromise === calcul) this._backgroundPromise = null; });
      this._backgroundPromise = calcul;
    }
    return this._backgroundPromise;
  },

  async _buildBackground() {
    const pane = this._map.getPane('amgtMeasurePane');
    if (pane) pane.style.display = 'none';
    await this._waitForPaint();
    try {
      try {
        this._backgroundCanvas = await this._renderBackground();
      } catch (err) {
        // Repli : ancienne méthode (tout par html2canvas, tuiles redemandées au réseau).
        console.warn('[AMGT4CEM] Capture : recopie des tuiles impossible, repli sur html2canvas seul :', err);
        this._backgroundCanvas = await html2canvas(this._map.getContainer(), { useCORS: true, logging: false });
      }
    } finally {
      if (pane) pane.style.display = ''; // la pane n'a jamais d'affichage propre en dehors de la capture
    }
    return this._backgroundCanvas;
  },

  async _renderBackground() {
    const container = this._map.getContainer();
    const tilePane = this._map.getPane('tilePane');
    const bg = getComputedStyle(container).backgroundColor;

    // 1. Tout sauf les tuiles, sur fond transparent.
    const overlay = await html2canvas(container, {
      useCORS: true,
      logging: false,
      backgroundColor: null,
      ignoreElements: (el) => el === tilePane,
      onclone: (doc) => {
        const c = doc.getElementById(container.id);
        if (c) c.style.background = 'none';
      },
    });

    // 2. Couleur de fond de la carte, puis tuiles recopiées, puis le reste par-dessus.
    const out = document.createElement('canvas');
    out.width = overlay.width;
    out.height = overlay.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ddd';
    ctx.fillRect(0, 0, out.width, out.height);
    const ignorees = this._drawTiles(ctx, out.width / container.getBoundingClientRect().width);
    ctx.drawImage(overlay, 0, 0);

    this.backgroundIncomplete = ignorees > 0;
    if (ignorees > 0) {
      console.warn(`[AMGT4CEM] Capture : ${ignorees} tuile(s) du fond de plan non recopiables (service sans CORS) : fond absent de l'image.`);
    }
    return out;
  },

  /** Recopie les tuiles chargées de chaque couche de tuiles de la carte (dans l'ordre d'empilement) à leur
   * position à l'écran. Une tuile qu'un canvas ne peut pas exporter (image chargée sans CORS) est ignorée :
   * l'image garderait sinon un canvas « souillé », donc impossible à enregistrer. Retourne le nombre ignoré. */
  _drawTiles(ctx, scale) {
    const container = this._map.getContainer();
    const cr = container.getBoundingClientRect();
    const tilePane = this._map.getPane('tilePane');
    const layers = Array.from(tilePane.querySelectorAll('.leaflet-layer'))
      .map((el, i) => ({ el, z: parseInt(getComputedStyle(el).zIndex, 10) || 0, i }))
      .sort((a, b) => a.z - b.z || a.i - b.i);
    let ignorees = 0;
    for (const { el: layer } of layers) {
      const ls = getComputedStyle(layer);
      if (ls.display === 'none' || ls.visibility === 'hidden') continue;
      const layerOpacity = parseFloat(ls.opacity);
      for (const tile of layer.querySelectorAll('img.leaflet-tile, canvas.leaflet-tile')) {
        if (tile.tagName === 'IMG') {
          if (!tile.complete || !tile.naturalWidth) continue; // pas (encore) chargée : rien à recopier
          if (tile.getAttribute('crossorigin') === null) { ignorees++; continue; }
        } else {
          try { tile.getContext('2d').getImageData(0, 0, 1, 1); } catch (err) { ignorees++; continue; }
        }
        const r = tile.getBoundingClientRect();
        if (r.right < cr.left || r.left > cr.right || r.bottom < cr.top || r.top > cr.bottom) continue;
        const tileOpacity = parseFloat(getComputedStyle(tile).opacity);
        ctx.globalAlpha = (Number.isNaN(layerOpacity) ? 1 : layerOpacity) * (Number.isNaN(tileOpacity) ? 1 : tileOpacity);
        // +0,5 px de recouvrement : pas de filet clair entre deux tuiles aux positions arrondies.
        ctx.drawImage(tile, (r.left - cr.left) * scale, (r.top - cr.top) * scale, r.width * scale + 0.5, r.height * scale + 0.5);
      }
    }
    ctx.globalAlpha = 1;
    return ignorees;
  },

  /** Appelé par measureTool.js à chaque activate()/deactivate() : le fond
   * mis en cache ne doit jamais être réutilisé d'une activation à l'autre
   * (seule période où la vue est garantie inchangée). */
  invalidateBackground() {
    this._backgroundCanvas = null;
    this._backgroundPromise = null;
  },

  /** Deux requestAnimationFrame : technique standard pour attendre qu'un
   * repaint planifié (ici, le canvas Leaflet, ou le masquage de la pane de
   * mesure) ait bien eu lieu. */
  _waitForPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  },

  /** Appelé par measureTool.js quand la mesure disparaît sans avoir été
   * enregistrée : la référence au Blob "temporaire" est simplement
   * abandonnée (garbage collectée) — rien n'avait quitté la mémoire. */
  discardIfUnsaved() {
    if (this._saved) return;
    this._blobPromise = null;
  },

  async save() {
    if (!this._blobPromise) return;
    this._saved = true;

    const btn = document.getElementById('amgt-screenshot-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      const blob = await this._blobPromise;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `amgt4cem-${this._timestamp()}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.error('[AMGT4CEM] Enregistrement de la capture impossible :', err);
      alert('Enregistrement de la capture impossible : ' + err.message);
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
