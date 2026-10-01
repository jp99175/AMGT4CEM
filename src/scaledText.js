/**
 * Texte HTML dont la taille visible (CSS font-size) suit le zoom de la
 * carte, pour simuler une taille RÉELLE constante (en mètres) plutôt
 * qu'une taille d'écran fixe (comportement par défaut de tout texte
 * HTML/CSS, y compris dans un L.divIcon) — c'est le rendu recherché pour
 * les repères PE_info/PE_label (voir metroLayer.js) : sur INFRAVIEW.pdf,
 * ce texte grossit/rétrécit avec le zoom exactement comme le reste du
 * dessin technique, pas à taille de police fixe à l'écran.
 *
 * Un premier essai avait tracé ce texte en vrais polygones (contours de
 * caractères extraits par traitement d'image) pour obtenir cet effet —
 * jugé après coup moins lisible qu'un texte HTML classique (pas de
 * hinting/anti-aliasing natif du navigateur). Solution retenue : texte
 * HTML normal, mais dont le `font-size` est recalculé à chaque changement
 * de zoom pour correspondre à une hauteur réelle donnée (mètres).
 *
 * Calcul mètres/pixel : projection Web Mercator (celle utilisée par
 * Leaflet par défaut — AMGT4CEM_CRS ne fait que fournir les coordonnées
 * lat/lon affichées dessus, pas un CRS Leaflet personnalisé), formule
 * standard dérivée de la taille de tuile (256 px) et de la circonférence
 * équatoriale terrestre, ajustée par le cosinus de la latitude.
 */
const AMGT4CEM_ScaledText = {
  _entries: [], // { marker, heightMeters, minPx, maxPx }
  _map: null,

  /** translate() CSS (en % de la boîte du texte) qui amène le point d'ancrage au milieu du bord `side`. */
  SIDE_TRANSLATE: {
    center: '-50%,-50%',
    top: '-50%,0',
    bottom: '-50%,-100%',
    left: '0,-50%',
    right: '-100%,-50%',
  },

  /** À appeler une fois, après création de la carte. */
  initMap(map) {
    this._map = map;
    map.on('zoomend', () => this.updateAll());
  },

  /**
   * @param {L.LatLng} latlng
   * @param {string} text
   * @param {{color: string, heightMeters: number, minPx?: number, maxPx?: number, rotationDeg?: number, side?: 'top'|'bottom'|'left'|'right'}} opts
   *   `side` : bord de la boîte de texte auquel le point est ancré, en son
   *   milieu — le bord le plus proche du cadre de la planche, pour une
   *   référence de planche (voir metroLayer.js). Sans `side`, le point est
   *   le centre du texte. Ancrer sur un bord plutôt qu'au centre garde le
   *   texte collé à son cadre à tout niveau de zoom : quand la taille de
   *   police change, le texte pousse à partir de ce bord au lieu de
   *   déborder de part et d'autre d'un centre fixe.
   * @returns {L.Marker}
   */
  createMarker(latlng, text, opts) {
    // La rotation (degrés CSS, horaire) est fixe pour un repère donné — pas
    // recalculée au zoom comme le font-size — reprise du texte source dans
    // INFRAVIEW.pdf (voir metroLayer.js). Rotation autour du point
    // d'ancrage (transform-origin 0 0 = ce point, voir style.css) APRÈS
    // translate() — l'ordre CSS s'applique de droite à gauche — pour que le
    // bord choisi tombe pile sur le point, quelle que soit la rotation.
    const rotationDeg = opts.rotationDeg || 0;
    const side = AMGT4CEM_ScaledText.SIDE_TRANSLATE[opts.side] ? opts.side : 'center';
    const transform = ` transform:rotate(${rotationDeg}deg) translate(${AMGT4CEM_ScaledText.SIDE_TRANSLATE[side]});`;
    const marker = L.marker(latlng, {
      // Non interactif : ce texte est purement visuel, un clic doit
      // atteindre la forme en dessous (triangle PE_info, planche PE) —
      // voir aussi la CSS (pointer-events: none) qui le garantit vraiment
      // au niveau du DOM, `interactive: false` seul ne suffit pas à
      // empêcher un <span> visible de bloquer physiquement le clic.
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'amgt-scaled-text-icon',
        html: `<span class="amgt-scaled-text" data-side="${side}" style="color:${opts.color};${transform}">${text}</span>`,
        iconAnchor: [0, 0],
      }),
    });
    const entry = {
      marker,
      heightMeters: opts.heightMeters,
      minPx: opts.minPx || 6,
      maxPx: opts.maxPx || 400,
    };
    this._entries.push(entry);
    // Un marqueur peut être (dés)affiché bien après sa création (case à
    // cocher "Plans patrimoine") : se dimensionner soi-même à chaque ajout
    // réel sur la carte, plutôt que de dépendre d'un appel externe au bon
    // moment — fonctionne quel que soit le moment/la raison de l'ajout.
    marker.on('add', () => this._updateOne(entry));
    return marker;
  },

  /** À appeler sur tout changement de zoom (voir initMap). */
  updateAll() {
    for (const entry of this._entries) this._updateOne(entry);
  },

  _updateOne(entry) {
    const map = entry.marker._map;
    if (!map) return;
    const el = entry.marker.getElement();
    if (!el) return;
    const span = el.querySelector('.amgt-scaled-text');
    if (!span) return;
    const metersPerPixel = this._metersPerPixel(map.getCenter().lat, map.getZoom());
    const px = Math.max(entry.minPx, Math.min(entry.maxPx, entry.heightMeters / metersPerPixel));
    span.style.fontSize = `${px}px`;
  },

  _metersPerPixel(lat, zoom) {
    const EARTH_CIRCUMFERENCE_M = 40075016.686;
    return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom + 8);
  },
};
