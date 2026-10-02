/**
 * Numéros d'interstation (data/patrimoine-numero-interstation.json, couche
 * « Numéros interstation » des Plans patrimoine) : chaque numéro est rattaché
 * au TRONÇON (polygone MT de Metro.shp, emprise de tunnel) dont le contour est
 * le plus proche de son point.
 *
 * Deux usages :
 *  - l'étiquette : texte à taille réelle constante (scaledText.js, comme les
 *    références de planche), souligné, avec une ligne de repère qui part du
 *    centre du tronçon et rejoint l'extrémité du soulignement la plus proche.
 *    Les étiquettes n'ont pas d'infobulle (marqueurs non interactifs) ;
 *  - l'infobulle de l'emprise du tronçon (metroLayer.js) y ajoute son ou ses
 *    numéros (numbersForTunnel), que la couche soit affichée ou non.
 *
 * Position/orientation d'une étiquette : celles d'origine (point du fichier =
 * centre du texte, horizontal), sauf définition d'ancrage partagée de
 * data/pe-label-anchors.json (clé « IS-numéro#rang », même format et même
 * édition que les références de planche — plugin pe-label-editor, le cadre
 * d'ancrage étant ici l'emprise du tronçon).
 *
 * AXE ET CENTRE DU TRONÇON : le polygone d'un tunnel est une bande allongée.
 * Sa ligne de construction (axe) est tracée entre ses deux côtés longs ; le
 * centre du tronçon, où arrive la ligne de repère, est le milieu de cet axe
 * MESURÉ LE LONG de l'axe (et non le centre de gravité, qui tombe hors du
 * tunnel dès qu'il est courbe). Construction (_axisOf) : les deux sommets les
 * plus éloignés l'un de l'autre repèrent les deux extrémités ; ils découpent
 * le contour en deux côtés, rééchantillonnés à abscisse curviligne
 * proportionnelle ; l'axe passe par le milieu de chaque paire de points
 * correspondants. L'axe est tracé par le plugin d'édition quand on déplace
 * une étiquette (marker._amgtTunnel.axis, Lambert).
 *
 * Les tronçons (Metro.shp) arrivent de façon asynchrone : l'association se
 * fait dès que numéros ET tronçons sont chargés (whenReady).
 */
const AMGT4CEM_Interstation = {
  STYLE: { heightMeters: 42 }, // même hauteur réelle que les références de planche (voir AMGT4CEM_LABEL_STYLES)
  _features: null, // numéros (GeoJSON, Lambert), null tant que non chargés
  _tunnels: null, // [{ id, name, ring, axis: [[x, y], ...], center: [x, y] }], null tant que Metro.shp non reçu
  _numbers: [], // [{ numero, key, xy, latlng, tunnel }] une fois associés
  _byTunnel: {}, // id de tunnel -> [numero]
  _markers: [], // marqueurs du groupe actuellement construit
  _ready: null,
  _resolveReady: null,

  init() {
    this._ready = new Promise((resolve) => (this._resolveReady = resolve));
    this._loadNumbers();
  },

  /** Résolue quand numéros et tronçons sont chargés et associés. */
  whenReady() {
    return this._ready;
  },

  async _loadNumbers() {
    const entry = AMGT4CEM_PATRIMOINE_CATALOG.find((e) => e.interstation);
    try {
      const response = await fetch(entry.file);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this._features = (await response.json()).features || [];
    } catch (err) {
      console.error('[AMGT4CEM] Chargement des numéros d\'interstation impossible :', err);
      this._features = [];
    }
    this._tryLink();
  },

  /** Appelé par app.js avec les entités de Metro.shp (seuls les MT servent). */
  setMetroFeatures(features) {
    this._tunnels = features
      .filter((f) => f.properties && f.properties.type === 'MT' && f.geometry && f.geometry.type === 'Polygon')
      .map((f) => {
        const ring = f.geometry.coordinates[0];
        const axis = this._axisOf(ring);
        return { id: String(f.properties.ogc_fid), name: f.properties.name_fr || f.properties.name_nl || '', ring, axis, center: this._midpointAlong(axis) };
      });
    this._tryLink();
  },

  _tryLink() {
    if (!this._features || !this._tunnels) return;
    const rank = {};
    this._numbers = [];
    this._byTunnel = {};
    for (const f of this._features) {
      const numero = f.properties && (f.properties.numero || f.properties.text);
      if (!numero || !f.geometry || f.geometry.type !== 'Point') continue;
      const xy = f.geometry.coordinates;
      rank[numero] = (rank[numero] || 0) + 1;
      const tunnel = this._nearestTunnel(xy);
      this._numbers.push({ numero: String(numero), key: `IS-${numero}#${rank[numero] - 1}`, xy, latlng: AMGT4CEM_CRS.lambertToLatLng(xy), tunnel });
      if (tunnel) (this._byTunnel[tunnel.id] = this._byTunnel[tunnel.id] || []).push(String(numero));
    }
    this._resolveReady();
  },

  /** Numéros d'interstation d'un tronçon (id = ogc_fid de Metro.shp), pour son infobulle. */
  numbersForTunnel(id) {
    return this._byTunnel[String(id)] || [];
  },

  /** Marqueurs (texte) du groupe actuellement construit, pour le plugin d'édition. */
  markers() {
    return this._markers;
  },

  /**
   * Construit le groupe Leaflet de la couche : pour chaque numéro, le texte
   * souligné et sa ligne de repère (même groupe : ils s'affichent et se
   * masquent ensemble, avec la case « Numéros interstation »).
   * @param {string} color - couleur choisie pour la couche
   * @param {number} opacity - facteur d'opacité courant (0 à 1)
   */
  buildSubGroup(color, opacity) {
    for (const m of this._markers) AMGT4CEM_ScaledText.dispose(m);
    this._markers = [];
    const group = L.layerGroup();
    for (const n of this._numbers) {
      const marker = AMGT4CEM_ScaledText.createMarker(n.latlng, n.numero, {
        color,
        heightMeters: this.STYLE.heightMeters,
        underline: true,
        leaderFrom: n.tunnel ? AMGT4CEM_CRS.lambertToLatLng(n.tunnel.center) : undefined,
        def: AMGT4CEM_PeLabelAnchors.get(n.key), // définition partagée (administrateurs), sinon position d'origine
      });
      marker._amgtKey = n.key;
      marker._amgtKind = 'interstation';
      marker._amgtTunnel = n.tunnel;
      marker.setOpacity(opacity);
      marker.addTo(group);
      if (marker._amgtLeader) {
        marker._amgtLeader.setStyle({ opacity });
        marker._amgtLeader.addTo(group);
      }
      this._markers.push(marker);
    }
    return group;
  },

  // ---- Géométrie (Lambert, mètres) ----------------------------------------

  _nearestTunnel(xy) {
    let best = null;
    let bestDist = Infinity;
    for (const t of this._tunnels) {
      const d = this._distToRing(xy, t.ring);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  },

  _distToRing(p, ring) {
    let min = Infinity;
    for (let i = 1; i < ring.length; i++) min = Math.min(min, this._nearestOnSegment(p, ring[i - 1], ring[i]).d);
    return min;
  },

  _nearestOnSegment([px, py], [ax, ay], [bx, by]) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const x = ax + t * dx;
    const y = ay + t * dy;
    return { x, y, d: Math.hypot(px - x, py - y) };
  },

  /** Anneau sans son dernier sommet s'il répète le premier. */
  _openRing(ring) {
    const last = ring[ring.length - 1];
    return last[0] === ring[0][0] && last[1] === ring[0][1] ? ring.slice(0, -1) : ring;
  },

  /** Axe d'un polygone en bande : polyligne [[x, y], ...] dans l'axe des deux côtés longs (voir en-tête). */
  _axisOf(closedRing) {
    const ring = this._openRing(closedRing);
    const n = ring.length;
    if (n < 4) return [this._meanOf(ring)];
    // Extrémités : les deux sommets les plus éloignés.
    let bi = 0;
    let bj = 1;
    let best = -1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
        if (d > best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    // Les deux côtés, orientés de l'extrémité bi vers l'extrémité bj.
    const sideA = ring.slice(bi, bj + 1);
    const sideB = ring.slice(bj).concat(ring.slice(0, bi + 1)).reverse();
    const STEPS = 50;
    const a = this._resample(sideA, STEPS);
    const b = this._resample(sideB, STEPS);
    return a.map((p, k) => [(p[0] + b[k][0]) / 2, (p[1] + b[k][1]) / 2]);
  },

  /** `count` + 1 points régulièrement espacés (abscisse curviligne) le long d'une polyligne. */
  _resample(points, count) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const total = cum[cum.length - 1];
    const out = [];
    let seg = 1;
    for (let k = 0; k <= count; k++) {
      const s = (total * k) / count;
      while (seg < points.length - 1 && cum[seg] < s) seg++;
      const len = cum[seg] - cum[seg - 1];
      const t = len ? (s - cum[seg - 1]) / len : 0;
      out.push([points[seg - 1][0] + t * (points[seg][0] - points[seg - 1][0]), points[seg - 1][1] + t * (points[seg][1] - points[seg - 1][1])]);
    }
    return out;
  },

  /** Milieu d'une polyligne, mesuré le long de celle-ci. */
  _midpointAlong(line) {
    if (line.length < 2) return line[0];
    let total = 0;
    for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    let remaining = total / 2;
    for (let i = 1; i < line.length; i++) {
      const len = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      if (remaining <= len && len) {
        const t = remaining / len;
        return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])];
      }
      remaining -= len;
    }
    return line[line.length - 1];
  },

  _meanOf(points) {
    return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  },
};
