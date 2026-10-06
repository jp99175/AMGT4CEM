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
 * ANCRAGE ET ORIENTATION. Le point du marqueur est l'un des 8 points de la
 * boîte de texte (4 coins, 4 milieux de bord — `ref`), ou son centre, et la
 * rotation se fait autour de ce point. Une « définition » (`def`, voir
 * peLabelAnchors.js) fixe l'ancrage et l'orientation d'une étiquette par
 * rapport au cadre de sa planche : { r1, a1, r2, a2 } — le point de
 * référence r1 du texte est posé sur le point a1 de la planche, puis la
 * boîte tourne autour pour aligner r1, r2 (second point du texte) et a2
 * (autre point de la planche), par la rotation de plus petite valeur
 * absolue (texte lisible, jamais à l'envers). Calculé ici, à l'affichage,
 * avec la taille réelle de la boîte dans le navigateur (son rapport
 * largeur/hauteur ne change pas avec le zoom) : le point de référence reste
 * collé à son ancre et l'alignement est conservé à tous les zooms.
 *
 * Calcul mètres/pixel : projection Web Mercator (celle utilisée par
 * Leaflet par défaut — AMGT4CEM_CRS ne fait que fournir les coordonnées
 * lat/lon affichées dessus, pas un CRS Leaflet personnalisé), formule
 * standard dérivée de la taille de tuile (256 px) et de la circonférence
 * équatoriale terrestre, ajustée par le cosinus de la latitude.
 */
const AMGT4CEM_ScaledText = {
  _entries: [], // { marker, heightMeters, minPx, maxPx, orig, def, pose }
  _map: null,

  /** Les 8 points de la boîte de texte (fraction de la largeur x, de la hauteur y vers le bas) + son centre. */
  REFS: {
    tl: { x: 0, y: 0, label: 'coin haut-gauche' },
    tc: { x: 0.5, y: 0, label: 'milieu du bord haut' },
    tr: { x: 1, y: 0, label: 'coin haut-droit' },
    ml: { x: 0, y: 0.5, label: 'milieu du bord gauche' },
    mr: { x: 1, y: 0.5, label: 'milieu du bord droit' },
    bl: { x: 0, y: 1, label: 'coin bas-gauche' },
    bc: { x: 0.5, y: 1, label: 'milieu du bord bas' },
    br: { x: 1, y: 1, label: 'coin bas-droit' },
    center: { x: 0.5, y: 0.5, label: 'centre' },
  },

  /** Champ `side` des repères legacy (reperes-troncons.legacy.json) -> point de référence équivalent. */
  SIDE_TO_REF: { top: 'tc', bottom: 'bc', left: 'ml', right: 'mr' },

  /** À appeler une fois, après création de la carte. */
  initMap(map) {
    this._map = map;
    map.on('zoomend', () => this.updateAll());
  },

  /**
   * @param {L.LatLng} latlng
   * @param {string} text
   * @param {{color: string, heightMeters: number, minPx?: number, maxPx?: number, rotationDeg?: number,
   *   ref?: string, side?: 'top'|'bottom'|'left'|'right', def?: {r1: string, a1: number[], r2?: string, a2?: number[]}}} opts
   *   `ref` (ou `side`, ancien nom) : point de la boîte de texte auquel le
   *   point est ancré — le milieu du bord le plus proche du cadre de la
   *   planche, pour une référence de planche. Sans lui, le centre du texte.
   *   `def` : définition d'ancrage/orientation (voir en-tête), prioritaire
   *   sur `ref`/`rotationDeg`/`latlng` quand elle est complète.
   *   `leaderFrom` (L.LatLng) : ligne de repère de ce point à l'extrémité la
   *   plus proche du soulignement, PUIS le long du bord bas du texte (un seul
   *   tracé : la ligne de repère EST le soulignement), exposée en
   *   `marker._amgtLeader` (voir _updateLeader) ; à ajouter à la carte par
   *   l'appelant. Son épaisseur suit la taille du texte (plus fine au dézoom).
   * @returns {L.Marker}
   */
  createMarker(latlng, text, opts) {
    const self = AMGT4CEM_ScaledText;
    const ref = self.REFS[opts.ref] ? opts.ref : self.SIDE_TO_REF[opts.side] || 'center';
    const orig = { latlng, ref, angle: opts.rotationDeg || 0 };
    const def = opts.def && opts.def.r1 && opts.def.a1 ? opts.def : null;
    const start = self._poseOf({ orig, def }, null);
    const underline = opts.leaderFrom ? ' amgt-scaled-text--underline' : ''; // marge sous le texte : le tracé du soulignement passe sur le bord bas de la boîte
    const marker = L.marker(start.latlng, {
      // Non interactif : ce texte est purement visuel, un clic doit
      // atteindre la forme en dessous (triangle PE_info, planche PE) —
      // voir aussi la CSS (pointer-events: none) qui le garantit vraiment
      // au niveau du DOM, `interactive: false` seul ne suffit pas à
      // empêcher un <span> visible de bloquer physiquement le clic.
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'amgt-scaled-text-icon',
        html: `<span class="amgt-scaled-text${underline}" data-ref="${start.ref}" style="color:${opts.color};${self._transform(start)}">${text}</span>`,
        iconAnchor: [0, 0],
      }),
    });
    const entry = {
      marker,
      heightMeters: opts.heightMeters,
      minPx: opts.minPx || 6,
      maxPx: opts.maxPx || 400,
      orig,
      def,
      pose: start,
      leader: null,
    };
    // Ligne de repère (voir en-tête de _updateLeader) : créée ici, mais ajoutée à la
    // carte par l'appelant (dans le même groupe que le marqueur, pour qu'elle
    // s'affiche/se masque avec lui) ; sa position suit le texte à chaque mise à jour.
    if (opts.leaderFrom) {
      const line = L.polyline([opts.leaderFrom, opts.leaderFrom], { color: opts.color, weight: 1.5, interactive: false });
      entry.leader = { from: opts.leaderFrom, line };
      marker._amgtLeader = line;
    }
    this._entries.push(entry);
    // Un marqueur peut être (dés)affiché bien après sa création (case à
    // cocher "Plans patrimoine") : se dimensionner soi-même à chaque ajout
    // réel sur la carte, plutôt que de dépendre d'un appel externe au bon
    // moment — fonctionne quel que soit le moment/la raison de l'ajout.
    marker.on('add', () => this._updateOne(entry));
    return marker;
  },

  /**
   * Remplace la définition d'ancrage/orientation d'un marqueur (null : retour
   * à la position et à l'orientation d'origine). Retourne la pose obtenue.
   */
  setDefinition(marker, def) {
    const entry = this._entries.find((e) => e.marker === marker);
    if (!entry) return null;
    entry.def = def && def.r1 && def.a1 ? def : null;
    this._updateOne(entry);
    return entry.pose;
  },

  /** Change le point de départ de la ligne de repère d'un marqueur (voir `leaderFrom`) et la redessine. */
  setLeaderFrom(marker, latlng) {
    const entry = this._entries.find((e) => e.marker === marker);
    if (!entry || !entry.leader) return;
    entry.leader.from = latlng;
    this._updateOne(entry);
  },

  /** Retire un marqueur du suivi des zooms (groupe reconstruit : l'ancien ne doit plus être mis à jour). */
  dispose(marker) {
    const i = this._entries.findIndex((e) => e.marker === marker);
    if (i >= 0) this._entries.splice(i, 1);
  },

  /** Définition d'ancrage/orientation actuelle d'un marqueur (copie), ou null. */
  getDefinition(marker) {
    const entry = this._entries.find((e) => e.marker === marker);
    return entry && entry.def ? JSON.parse(JSON.stringify(entry.def)) : null;
  },

  /** Pose actuelle { latlng, ref, angle } d'un marqueur. */
  getPose(marker) {
    const entry = this._entries.find((e) => e.marker === marker);
    return entry ? entry.pose : null;
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
    // Après le font-size : l'alignement mesure la boîte de texte à sa taille actuelle.
    entry.pose = this._poseOf(entry, span);
    entry.marker.setLatLng(entry.pose.latlng);
    span.dataset.ref = entry.pose.ref;
    span.style.transform = this._transform(entry.pose).replace(/^ transform:|;$/g, '');
    if (entry.leader) this._updateLeader(entry, span, px);
  },

  /**
   * Ligne de repère ET soulignement d'un texte (option `leaderFrom`) : UN SEUL
   * tracé qui part du point `leaderFrom` (ex. le centre d'un tronçon), rejoint
   * le bord bas de la boîte de texte (extrémité bl ou br la plus proche, ou un point intermédiaire
   * si la contrainte d'angle l'exige), puis longe ce bord jusqu'au bout. Les coins se déduisent
   * de la pose (point de référence + rotation) et de la taille réelle de la
   * boîte, recalculée à chaque zoom (comme la pose elle-même). Épaisseur
   * proportionnelle à la taille du texte (`px`, 4 % du corps), entre 0,5 et
   * 4 px : plus fine quand on dézoome. Le segment qui part de `leaderFrom` fait au plus 45° avec la
   * verticale : voir _leaderPath.
   */
  _updateLeader(entry, span, px) {
    const map = entry.marker._map;
    const { latlng, ref, angle } = entry.pose;
    const r = this.REFS[ref];
    const w = span.offsetWidth;
    const h = span.offsetHeight;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const origin = map.latLngToLayerPoint(latlng);
    // Même transformation que _transform(): translation du point de référence à l'origine, puis rotation horaire.
    const corner = (cx) => {
      const dx = (cx - r.x) * w;
      const dy = (1 - r.y) * h;
      return L.point(origin.x + dx * cos - dy * sin, origin.y + dx * sin + dy * cos);
    };
    const from = map.latLngToLayerPoint(entry.leader.from);
    const bl = corner(0);
    const br = corner(1);
    const path = this._leaderPath(from, bl, br);
    entry.leader.line.setLatLngs(path.map((pt) => map.layerPointToLatLng(pt)));
    entry.leader.line.setStyle({ weight: Math.max(0.5, Math.min(4, px * 0.04)) });
  },

  /**
   * Tracé de la ligne de repère, en points d'écran : la partie qui relie `from` (centre du tronçon)
   * au soulignement [bl, br] fait au plus LEADER_MAX_DEG (45°) avec la VERTICALE (dans un sens
   * comme dans l'autre : |dx| <= |dy|).
   *  - le soulignement croise le cône : la ligne rejoint son point admissible le plus proche de
   *    `from`, puis longe le soulignement d'un bout à l'autre (le retour sur lui-même ne se voit pas) ;
   *  - sinon (texte plutôt à côté qu'au-dessus ou en dessous) : segment à exactement 45° jusqu'à la
   *    droite du soulignement, qu'on longe ensuite jusqu'au bout.
   */
  LEADER_MAX_DEG: 45,

  _leaderPath(from, bl, br) {
    const k = Math.tan((this.LEADER_MAX_DEG * Math.PI) / 180); // |dx| <= k |dy|
    const ok = (pt) => Math.abs(pt.x - from.x) <= k * Math.abs(pt.y - from.y) + 1e-6;
    const at = (t) => L.point(bl.x + (br.x - bl.x) * t, bl.y + (br.y - bl.y) * t);
    let best = null;
    const N = 200;
    for (let i = 0; i <= N; i++) {
      const pt = at(i / N);
      if (ok(pt) && (!best || from.distanceTo(pt) < from.distanceTo(best.pt))) best = { pt, t: i / N };
    }
    if (best) {
      const [e1, e2] = best.t <= 0.5 ? [bl, br] : [br, bl];
      return [from, best.pt, e1, e2];
    }
    // Aucun point admissible : diagonale à 45° vers le bord le plus proche, puis le soulignement.
    const [near, far] = from.distanceTo(bl) <= from.distanceTo(br) ? [bl, br] : [br, bl];
    const sx = Math.sign(near.x - from.x) || 1;
    const sy = Math.sign(near.y - from.y) || 1;
    // Intersection du rayon from + u (sx, sy / ... ) avec la droite near-far : from + u d = near + v e
    const d = L.point(sx, sy * (1 / k));
    const e = L.point(far.x - near.x, far.y - near.y);
    const det = d.x * e.y - d.y * e.x;
    if (Math.abs(det) > 1e-9) {
      const u = ((near.x - from.x) * e.y - (near.y - from.y) * e.x) / det;
      if (u > 0) return [from, L.point(from.x + d.x * u, from.y + d.y * u), near, far];
    }
    // Cas dégénéré : le soulignement est exactement à la hauteur de `from` (ou parallèle au rayon) : aucun
    // segment à 45° ne le rejoint, tracé direct.
    return [from, near, far];
  },

  /**
   * Pose { latlng, ref, angle } : celle d'origine, ou — avec une définition —
   * r1 posé sur a1, et si r2/a2 sont définis la rotation qui aligne r1, r2 et a2.
   * `span` (la boîte de texte dans le DOM) sert à mesurer sa largeur/hauteur ;
   * sans lui (avant l'ajout à la carte), l'angle d'origine est gardé.
   */
  _poseOf(entry, span) {
    const d = entry.def;
    if (!d) return { latlng: entry.orig.latlng, ref: entry.orig.ref, angle: entry.orig.angle };
    const pose = { latlng: L.latLng(d.a1), ref: d.r1, angle: entry.orig.angle };
    if (d.r2 && d.a2 && span && this._map) pose.angle = this._alignAngle(span, d);
    return pose;
  },

  /**
   * Rotation CSS (degrés, horaire) qui aligne r1, r2 et a2 : le vecteur
   * r1→r2 de la boîte (mesurée sans rotation) doit être parallèle à a1→a2
   * à l'écran. Deux solutions à 180° l'une de l'autre : celle de plus petite
   * valeur absolue est retenue.
   */
  _alignAngle(span, d) {
    const R1 = this.REFS[d.r1];
    const R2 = this.REFS[d.r2];
    const w = span.offsetWidth || 1;
    const h = span.offsetHeight || 1;
    const v = { x: (R2.x - R1.x) * w, y: (R2.y - R1.y) * h };
    const p1 = this._map.project(L.latLng(d.a1), 0);
    const p2 = this._map.project(L.latLng(d.a2), 0);
    const theta = (Math.atan2(p2.y - p1.y, p2.x - p1.x) - Math.atan2(v.y, v.x)) * (180 / Math.PI);
    return ((((theta + 90) % 180) + 180) % 180) - 90; // [-90°, 90°[
  },

  /** transform CSS : translate() amène le point de référence sur l'ancre, rotate() tourne autour (origine 0 0, voir style.css). */
  _transform(pose) {
    const r = this.REFS[pose.ref];
    return ` transform:rotate(${pose.angle}deg) translate(${-r.x * 100}%,${-r.y * 100}%);`;
  },

  _metersPerPixel(lat, zoom) {
    const EARTH_CIRCUMFERENCE_M = 40075016.686;
    return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom + 8);
  },
};
