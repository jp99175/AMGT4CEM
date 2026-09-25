/**
 * Outil "📏 Mesurer" : effet dynamique en deux gestes de type
 * presser-glisser-relâcher (comme placer un point puis le corriger avant
 * de lâcher), un pour le centre, un pour le rayon :
 *
 * 1. Presser sur la carte : pose un premier point (le centre). Tant que le
 *    doigt/bouton reste enfoncé, le déplacer suit le curseur en direct.
 *    Relâcher fige ce centre.
 * 2. Presser à nouveau : démarre le tracé du rayon depuis ce centre fixe.
 *    Tant que le doigt/bouton reste enfoncé, le point d'arrivée suit le
 *    curseur en direct (segment pointillé + cote au bout du segment +
 *    cercle qui grandit/rétrécit avec lui). Relâcher fige le rayon.
 *
 * Dès ce 2e relâchement, la carte est aussi immédiatement capturée
 * (screenshotTool.js, capture) et gardée en mémoire comme un fichier
 * temporaire — rien n'est écrit où que ce soit (ni presse-papier, ni
 * disque) avant un clic explicite sur "💾". Capturer au moment précis du
 * relâchement, plutôt qu'à un clic ultérieur, élimine toute course avec le
 * délai d'affichage de la mesure ou la vitesse de l'appareil. Le bouton
 * "💾" (enregistre cette même image déjà capturée, sans refaire de rendu),
 * le cercle, le segment et la cote disparaissent tous ensemble 4 secondes
 * après ce relâchement (_hideDelayMs) — une nouvelle pression pendant ce
 * délai recommence directement une nouvelle mesure, et l'image déjà
 * capturée est abandonnée si elle n'a pas été enregistrée entre-temps
 * (discardIfUnsaved).
 *
 * Cette capture ne redessine PAS toute la carte à chaque mesure : un fond
 * (tuiles + couches) n'est capturé qu'au besoin (screenshotTool.js,
 * _ensureBackground), réutilisé pour toutes les mesures suivantes tant que
 * la vue affichée ne peut pas avoir changé — invalidé à chaque
 * activate()/deactivate() de cet outil, ET par tout changement de fond de
 * carte/couche pendant qu'il reste actif (basemap.js, mapMenu.js : le menu
 * ☰ Carte reste utilisable, seuls le glisser et le pincer-zoomer sont
 * désactivés). Seuls le cercle, le segment, le point central et la cote de
 * LA mesure courante sont redessinés à chaque capture, directement en
 * Canvas 2D (drawOverlayOnContext ci-dessous) à partir de leur géométrie
 * déjà connue — jamais via un nouveau rendu DOM/réseau, donc jamais perdus
 * si le réseau est capricieux au moment de la capture.
 *
 * Le cercle et le segment sont reconstruits une dernière fois, à neuf, au
 * moment du relâchement (_freezeShapes) plutôt que de garder les mêmes
 * objets mutés en direct pendant tout le geste : sur un appareil réel
 * générant de très nombreux événements de déplacement par seconde, le
 * rendu Canvas de Leaflet peut laisser une trace visible ("un curseur") des
 * positions intermédiaires du cercle si son suivi interne des zones à
 * effacer/redessiner n'est pas mis à jour assez vite — un objet flambant
 * neuf, dessiné une seule fois à sa position finale, ne peut pas hériter
 * de ce genre de résidu.
 *
 * Comme AddPointTool, le mode reste actif (bouton "allumé") tant qu'on ne
 * le désactive pas explicitement ; activer cet outil désactive AddPointTool
 * et vice-versa (un seul mode d'interaction à la fois). Le glisser-déposer
 * et le pincer-zoomer de la carte sont désactivés tant que l'outil est
 * actif (sinon un geste de positionnement déplacerait/zoomerait la vue).
 *
 * Événements Pointer natifs (pointerdown/move/up), pas les événements
 * souris relayés par Leaflet (map.on('mousedown', ...)) : sur smartphone,
 * Leaflet gère lui-même les événements tactiles pour son propre usage
 * (pan, pincer-zoomer) et n'émet alors pas les événements souris de
 * compatibilité dont dépendait une version précédente de cet outil, qui ne
 * fonctionnait de ce fait qu'à la souris. Les événements Pointer couvrent
 * uniformément souris, tactile et stylet.
 *
 * Au doigt, le point réellement positionné (_eventToLatLng) est décalé
 * vers le haut par rapport au point de contact : sinon le doigt cache
 * lui-même le centre/la cote/le bord du cercle pendant qu'on les
 * positionne. Pas de décalage à la souris (le curseur, fin, ne cache rien).
 *
 * La cote (l'étiquette de distance) n'est jamais positionnée pile sur le
 * bord du cercle (où son fond blanc la ferait apparaître "coupée" par le
 * trait du cercle) : _computeLabelPlacement calcule un point décalé
 * au-delà du bord, dans le prolongement du rayon, et une direction
 * (dirX/dirY) utilisée pour ancrer le coin de l'étiquette le plus proche du
 * cercle sur ce point — l'étiquette grandit alors toujours vers l'extérieur,
 * jamais en repli sur le cercle. Même logique utilisée pour l'étiquette
 * HTML en direct (_buildLabelIcon, transform CSS dynamique) et pour la
 * cote redessinée à la capture (drawOverlayOnContext).
 */
const AMGT4CEM_MeasureTool = {
  _map: null,
  _active: false,
  // 'idle' (attend la presse du centre) | 'draggingCenter' |
  // 'idleAwaitingRadius' (centre fixé, attend la presse du rayon) |
  // 'draggingRadius'
  _state: 'idle',
  _pointerId: null,
  _center: null,
  _centerMarker: null,
  _line: null,
  _circle: null,
  _labelMarker: null,
  _clearTimer: null,
  // Délai avant disparition (bouton Capture, cercle, segment, cote), à
  // partir du 2e relâchement.
  _hideDelayMs: 4000,
  // Décalage (px écran) au-dessus du point de contact tactile, pour que le
  // doigt ne cache pas ce qu'il est en train de positionner.
  _touchOffsetPx: 60,
  // Décalage (px écran) entre le bord du cercle et le point d'ancrage de la
  // cote, pour qu'elle ne soit jamais visuellement coupée par le cercle.
  _labelMarginPx: 14,

  init(map) {
    this._map = map;

    // Pane dédiée, au-dessus de tout le reste (Métro, UrbIS Topo, Plans
    // patrimoine...) pour que la mesure soit toujours visible quel que soit
    // l'ordre d'ajout de ces couches. pointer-events:none : elle ne doit
    // jamais intercepter une pression.
    const pane = map.createPane('amgtMeasurePane');
    pane.style.zIndex = 650;
    pane.style.pointerEvents = 'none';

    // Une presse pour poser le centre ou le rayon tombe souvent sur une
    // station/un tunnel/un objet UrbIS Topo... qui ouvrirait sinon sa
    // propre popup par-dessus la mesure : on la referme immédiatement tant
    // que l'outil est actif.
    this._onPopupOpen = (e) => e.popup.close();

    // pointerdown sur le conteneur de la carte (là où le geste doit
    // démarrer) ; pointermove/pointerup/pointercancel sur window, pour
    // rester robuste si le doigt/curseur sort de la carte en cours de
    // geste (capture de pointeur ci-dessous, en complément).
    const container = map.getContainer();
    container.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e));
  },

  isActive() {
    return this._active;
  },

  activate() {
    if (this._active) return;
    this._active = true;
    this._state = 'idle';
    // Le fond mis en cache pour la capture (screenshotTool.js) ne doit
    // jamais survivre d'une activation à l'autre : la vue a pu changer
    // (pan/zoom, couches) pendant que l'outil était inactif.
    AMGT4CEM_ScreenshotTool.invalidateBackground();
    this._map.dragging.disable();
    if (this._map.tap) this._map.tap.disable();
    if (this._map.touchZoom) this._map.touchZoom.disable();
    const container = this._map.getContainer();
    container.classList.add('amgt-placing-mode');
    // Leaflet ne met touch-action:none sur le conteneur (nécessaire pour
    // qu'un geste tactile soit entièrement géré en JS, sans que le
    // navigateur ne le récupère en cours de route pour son propre
    // défilement/zoom — ce qui figeait le point en plein milieu du geste
    // au lieu d'attendre le relâchement) que lorsque son propre dragging/
    // touchZoom est actif ; comme on vient de les désactiver ci-dessus, on
    // le repose nous-mêmes explicitement.
    container.style.touchAction = 'none';
    document.getElementById('amgt-measure-btn').classList.add('amgt-btn--active');
    this._map.on('popupopen', this._onPopupOpen);
  },

  deactivate() {
    if (!this._active) return;
    this._active = false;
    this._map.dragging.enable();
    if (this._map.tap) this._map.tap.enable();
    if (this._map.touchZoom) this._map.touchZoom.enable();
    const container = this._map.getContainer();
    container.classList.remove('amgt-placing-mode');
    container.style.touchAction = '';
    document.getElementById('amgt-measure-btn').classList.remove('amgt-btn--active');
    this._map.off('popupopen', this._onPopupOpen);
    this._pointerId = null;
    this._state = 'idle';
    this._clearMeasurement();
    AMGT4CEM_ScreenshotTool.invalidateBackground();
  },

  toggle() {
    if (this._active) this.deactivate();
    else this.activate();
  },

  _onPointerDown(e) {
    if (!this._active || this._pointerId !== null) return;
    this._pointerId = e.pointerId;
    const container = this._map.getContainer();
    if (container.setPointerCapture) {
      try { container.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    e.preventDefault();
    this._handlePress(this._eventToLatLng(e));
  },

  _onPointerMove(e) {
    if (e.pointerId !== this._pointerId) return;
    e.preventDefault();
    this._handleMove(this._eventToLatLng(e));
  },

  _onPointerUp(e) {
    if (e.pointerId !== this._pointerId) return;
    this._pointerId = null;
    // Une dernière mise à jour avec la position exacte du relâchement
    // (pas le dernier "move" enregistré, qui peut être légèrement en
    // retard sur un appareil moins réactif) : la cote et le cercle doivent
    // se figer pile là où on relâche, pas à une position intermédiaire.
    this._handleMove(this._eventToLatLng(e));
    this._handleRelease();
  },

  /** Position réelle à utiliser (voir _touchOffsetPx en tête de fichier). */
  _eventToLatLng(e) {
    let point = this._map.mouseEventToContainerPoint(e);
    if (e.pointerType === 'touch') {
      point = point.subtract([0, this._touchOffsetPx]);
    }
    return this._map.containerPointToLatLng(point);
  },

  _handlePress(latlng) {
    if (this._state === 'idle') {
      this._clearMeasurement();
      this._center = latlng;
      this._centerMarker = this._buildDotMarker(latlng);
      this._state = 'draggingCenter';
    } else if (this._state === 'idleAwaitingRadius') {
      this._line = L.polyline([this._center, latlng], {
        pane: 'amgtMeasurePane',
        color: '#f50057',
        weight: 2,
        dashArray: '5,5',
      }).addTo(this._map);
      this._circle = L.circle(this._center, {
        pane: 'amgtMeasurePane',
        radius: 0,
        color: '#f50057',
        weight: 2,
        fillOpacity: 0.08,
      }).addTo(this._map);
      const placement = this._computeLabelPlacement(this._center, latlng);
      this._labelMarker = this._buildLabelMarker(placement.anchorLatLng, '0 m', placement.dirX, placement.dirY);
      document.getElementById('amgt-screenshot-btn').classList.remove('amgt-hidden');
      this._state = 'draggingRadius';
    }
  },

  _handleMove(latlng) {
    if (this._state === 'draggingCenter') {
      this._center = latlng;
      this._centerMarker.setLatLng(latlng);
    } else if (this._state === 'draggingRadius') {
      const radiusMeters = this._map.distance(this._center, latlng);
      this._line.setLatLngs([this._center, latlng]);
      this._circle.setLatLng(this._center);
      this._circle.setRadius(radiusMeters);
      const placement = this._computeLabelPlacement(this._center, latlng);
      this._labelMarker.setLatLng(placement.anchorLatLng);
      this._labelMarker.setIcon(this._buildLabelIcon(this._formatDistance(radiusMeters), placement.dirX, placement.dirY));
    }
  },

  _handleRelease() {
    if (this._state === 'draggingCenter') {
      this._state = 'idleAwaitingRadius';
    } else if (this._state === 'draggingRadius') {
      this._state = 'idle';
      this._freezeShapes();
      clearTimeout(this._clearTimer);
      this._clearTimer = setTimeout(() => this._clearMeasurement(), this._hideDelayMs);
      AMGT4CEM_ScreenshotTool.capture();
    }
  },

  /** Voir l'en-tête du fichier : reconstruit le cercle/segment à neuf, à
   * leur position finale, pour ne garder aucune trace d'un rendu Canvas
   * intermédiaire du geste qui vient de se terminer. */
  _freezeShapes() {
    const center = this._center;
    const [, end] = this._line.getLatLngs();
    const radius = this._circle.getRadius();

    this._map.removeLayer(this._line);
    this._map.removeLayer(this._circle);

    this._line = L.polyline([center, end], {
      pane: 'amgtMeasurePane',
      color: '#f50057',
      weight: 2,
      dashArray: '5,5',
    }).addTo(this._map);
    this._circle = L.circle(center, {
      pane: 'amgtMeasurePane',
      radius,
      color: '#f50057',
      weight: 2,
      fillOpacity: 0.08,
    }).addTo(this._map);
  },

  _clearMeasurement() {
    clearTimeout(this._clearTimer);
    this._clearTimer = null;
    if (this._centerMarker) { this._map.removeLayer(this._centerMarker); this._centerMarker = null; }
    if (this._line) { this._map.removeLayer(this._line); this._line = null; }
    if (this._circle) { this._map.removeLayer(this._circle); this._circle = null; }
    if (this._labelMarker) { this._map.removeLayer(this._labelMarker); this._labelMarker = null; }
    this._center = null;
    document.getElementById('amgt-screenshot-btn').classList.add('amgt-hidden');
    // Pas d'enregistrement entre-temps (bouton "💾" cliqué) : l'image
    // capturée en mémoire est simplement abandonnée, jamais écrite nulle
    // part.
    AMGT4CEM_ScreenshotTool.discardIfUnsaved();
  },

  _formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(1)} m`;
  },

  /** Voir l'en-tête du fichier : point d'ancrage de la cote décalé au-delà
   * du bord du cercle (dans le prolongement du rayon), et direction
   * (dirX/dirY, vecteur unitaire en pixels écran) utilisée par l'appelant
   * pour ancrer le coin de l'étiquette le plus proche du cercle sur ce
   * point plutôt que de centrer l'étiquette dessus. */
  _computeLabelPlacement(centerLatLng, edgeLatLng) {
    const map = this._map;
    const c = map.latLngToContainerPoint(centerLatLng);
    const e = map.latLngToContainerPoint(edgeLatLng);
    let dx = e.x - c.x;
    let dy = e.y - c.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) {
      // Rayon nul (tout début du 2e geste) : direction par défaut, vers le
      // haut, en attendant que l'utilisateur commence à déplacer le doigt.
      dx = 0;
      dy = -1;
    } else {
      dx /= len;
      dy /= len;
    }
    const anchorPoint = L.point(e.x + dx * this._labelMarginPx, e.y + dy * this._labelMarginPx);
    return {
      anchorLatLng: map.containerPointToLatLng(anchorPoint),
      dirX: dx,
      dirY: dy,
    };
  },

  /** -100/0/-50 (%) : traduit une composante de direction (dirX ou dirY) en
   * décalage CSS translate() pour que l'étiquette grandisse à l'opposé du
   * cercle plutôt que de se replier dessus (voir en-tête du fichier). */
  _dirPercent(v) {
    if (v > 0.15) return 0;
    if (v < -0.15) return -100;
    return -50;
  },

  /** Redessine directement (Canvas 2D, pas html2canvas) le cercle, le
   * segment, le point central et la cote de la mesure courante sur un
   * contexte déjà mis à l'échelle pixels CSS — voir screenshotTool.js,
   * capture/_buildCompositeBlob : ceci compose la capture sans jamais
   * dépendre du réseau (pas de nouveau rendu DOM/tuiles), donc ne peut
   * jamais perdre ces éléments même si le fond de carte, lui, a du mal à se
   * recharger. */
  drawOverlayOnContext(ctx) {
    if (!this._center || !this._circle || !this._line) return;
    const map = this._map;
    const color = '#f50057';
    const centerPt = map.latLngToContainerPoint(this._center);
    const [, endLatLng] = this._line.getLatLngs();
    const endPt = map.latLngToContainerPoint(endLatLng);
    const radiusPx = Math.hypot(endPt.x - centerPt.x, endPt.y - centerPt.y);

    ctx.save();

    // Cercle
    ctx.beginPath();
    ctx.arc(centerPt.x, centerPt.y, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245, 0, 87, 0.08)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();

    // Segment pointillé (centre -> bord)
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.moveTo(centerPt.x, centerPt.y);
    ctx.lineTo(endPt.x, endPt.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Point de départ : anneau + réticule, même géométrie que _buildReticleSvg
    // (rayon 5, réticule jusqu'à 6px du centre, espace 1px de chaque côté
    // à l'intersection) — rendu identique en direct et à la capture.
    // ctx.lineCap reste 'butt' (défaut) pour la même raison que dans
    // _buildReticleSvg : un capuchon rond repeindrait le pixel transparent
    // voulu à l'intersection.
    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 2;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(centerPt.x, centerPt.y, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerPt.x - 6, centerPt.y);
    ctx.lineTo(centerPt.x - 1, centerPt.y);
    ctx.moveTo(centerPt.x + 1, centerPt.y);
    ctx.lineTo(centerPt.x + 6, centerPt.y);
    ctx.moveTo(centerPt.x, centerPt.y - 6);
    ctx.lineTo(centerPt.x, centerPt.y - 1);
    ctx.moveTo(centerPt.x, centerPt.y + 1);
    ctx.lineTo(centerPt.x, centerPt.y + 6);
    ctx.stroke();
    ctx.restore();

    // Cote : même logique de décalage/ancrage que l'étiquette HTML en
    // direct (_computeLabelPlacement/_dirPercent), pour un rendu cohérent.
    const placement = this._computeLabelPlacement(this._center, endLatLng);
    const anchorPt = map.latLngToContainerPoint(placement.anchorLatLng);
    const text = this._formatDistance(this._circle.getRadius());
    ctx.font = 'bold 12px system-ui, -apple-system, "Segoe UI", sans-serif';
    const textWidth = ctx.measureText(text).width;
    const textHeight = 12;
    const padX = 5;
    const padY = 3;
    const boxW = textWidth + padX * 2;
    const boxH = textHeight + padY * 2;

    let boxX;
    if (placement.dirX > 0.15) boxX = anchorPt.x;
    else if (placement.dirX < -0.15) boxX = anchorPt.x - boxW;
    else boxX = anchorPt.x - boxW / 2;

    let boxY;
    if (placement.dirY > 0.15) boxY = anchorPt.y;
    else if (placement.dirY < -0.15) boxY = anchorPt.y - boxH;
    else boxY = anchorPt.y - boxH / 2;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, boxX + padX, boxY + boxH / 2);

    ctx.restore();
  },

  _buildDotMarker(latlng) {
    return L.marker(latlng, {
      icon: L.divIcon({ className: 'amgt-measure-dot-icon', pane: 'amgtMeasurePane', html: this._buildReticleSvg() }),
      interactive: false,
      pane: 'amgtMeasurePane',
    }).addTo(this._map);
  },

  /** Point de départ : un anneau + un réticule (2 lignes), pas un point
   * plein — plus lisible sur un fond de carte chargé, et laisse un pixel
   * vide (transparent) à l'intersection des deux lignes qui composent le
   * réticule (le petit espace entre chaque paire de segments ci-dessous).
   * Même géométrie (rayon 5, réticule jusqu'à 6px du centre, espace 1px de
   * chaque côté) que le point central redessiné dans la capture
   * (drawOverlayOnContext, plus bas) — rendu identique en direct et à la
   * capture. */
  _buildReticleSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'amgt-measure-dot');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.setAttribute('aria-hidden', 'true');
    // stroke-linecap volontairement absent (donc "butt", par défaut) : un
    // capuchon "round" dépasserait de la moitié de l'épaisseur du trait
    // au-delà de l'extrémité indiquée, et repeindrait le pixel transparent
    // voulu à l'intersection au centre.
    svg.innerHTML =
      '<circle cx="7" cy="7" r="5" fill="none" stroke="#f50057" stroke-width="1.6" />' +
      '<line x1="1" y1="7" x2="6" y2="7" stroke="#f50057" stroke-width="1.6" />' +
      '<line x1="8" y1="7" x2="13" y2="7" stroke="#f50057" stroke-width="1.6" />' +
      '<line x1="7" y1="1" x2="7" y2="6" stroke="#f50057" stroke-width="1.6" />' +
      '<line x1="7" y1="8" x2="7" y2="13" stroke="#f50057" stroke-width="1.6" />';
    return svg;
  },

  /** dirX/dirY (voir _computeLabelPlacement) : ancre dynamiquement le coin
   * de l'étiquette le plus proche du cercle sur son point de positionnement
   * (transform CSS), pour qu'elle grandisse à l'opposé du cercle et ne soit
   * jamais coupée par son trait/remplissage, quelle que soit la direction
   * du rayon. */
  _buildLabelIcon(text, dirX, dirY) {
    const span = document.createElement('span');
    span.className = 'amgt-measure-label__text';
    span.textContent = text;
    span.style.transform = `translate(${this._dirPercent(dirX)}%, ${this._dirPercent(dirY)}%)`;
    return L.divIcon({ className: 'amgt-measure-label', pane: 'amgtMeasurePane', html: span });
  },

  _buildLabelMarker(latlng, text, dirX, dirY) {
    return L.marker(latlng, {
      icon: this._buildLabelIcon(text, dirX, dirY),
      interactive: false,
      pane: 'amgtMeasurePane',
    }).addTo(this._map);
  },
};
