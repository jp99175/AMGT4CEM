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
 * Dès ce 2e relâchement, la carte est aussi immédiatement capturée et
 * copiée dans le presse-papier (screenshotTool.js, captureToClipboard) :
 * capturer au moment précis du relâchement, plutôt qu'à un clic ultérieur
 * sur "Capture", élimine toute course avec le délai d'affichage de la
 * mesure ou la vitesse de l'appareil. Le bouton "📷 Capture" (sauvegarde de
 * cette même image déjà capturée, sans refaire de rendu), le cercle, le
 * segment et la cote disparaissent tous ensemble 4 secondes après ce
 * relâchement (_hideDelayMs) — une nouvelle pression pendant ce délai
 * recommence directement une nouvelle mesure, et l'image déjà en
 * presse-papier est effacée si elle n'a pas été sauvegardée entre-temps
 * (clearClipboardIfUnsaved).
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
      this._labelMarker = this._buildLabelMarker(latlng, '0 m');
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
      this._labelMarker.setLatLng(latlng);
      this._labelMarker.setIcon(this._buildLabelIcon(this._formatDistance(radiusMeters)));
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
      AMGT4CEM_ScreenshotTool.captureToClipboard();
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
    // Pas de sauvegarde entrée-temps (bouton "Capture" cliqué) : on ne
    // laisse pas traîner une image de mesure oubliée dans le presse-papier.
    AMGT4CEM_ScreenshotTool.clearClipboardIfUnsaved();
  },

  _formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(1)} m`;
  },

  _buildDotMarker(latlng) {
    const dot = document.createElement('span');
    dot.className = 'amgt-measure-dot';
    return L.marker(latlng, {
      icon: L.divIcon({ className: 'amgt-measure-dot-icon', pane: 'amgtMeasurePane', html: dot }),
      interactive: false,
      pane: 'amgtMeasurePane',
    }).addTo(this._map);
  },

  _buildLabelIcon(text) {
    const span = document.createElement('span');
    span.className = 'amgt-measure-label__text';
    span.textContent = text;
    return L.divIcon({ className: 'amgt-measure-label', pane: 'amgtMeasurePane', html: span });
  },

  _buildLabelMarker(latlng, text) {
    return L.marker(latlng, {
      icon: this._buildLabelIcon(text),
      interactive: false,
      pane: 'amgtMeasurePane',
    }).addTo(this._map);
  },
};
