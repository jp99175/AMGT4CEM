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

  /** À appeler une fois, après création de la carte. */
  initMap(map) {
    this._map = map;
    map.on('zoomend', () => this.updateAll());
  },

  /**
   * @param {L.LatLng} latlng
   * @param {string} text
   * @param {{color: string, heightMeters: number, minPx?: number, maxPx?: number, rotationDeg?: number}} opts
   * @returns {L.Marker}
   */
  createMarker(latlng, text, opts) {
    // La rotation (degrés CSS, horaire) est fixe pour un repère donné — pas
    // recalculée au zoom comme le font-size — reprise telle quelle du texte
    // source dans INFRAVIEW.pdf (voir metroLayer.js). translate(-50%,-50%)
    // doit s'appliquer AVANT rotate() (ordre d'écriture CSS = ordre
    // d'application de droite à gauche) pour que la rotation tourne autour
    // du centre du texte, pas de son coin haut-gauche (ancre du marqueur).
    const rotationDeg = opts.rotationDeg || 0;
    const transform = rotationDeg
      ? ` transform:translate(-50%,-50%) rotate(${rotationDeg}deg);`
      : '';
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
        html: `<span class="amgt-scaled-text" style="color:${opts.color};${transform}">${text}</span>`,
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
