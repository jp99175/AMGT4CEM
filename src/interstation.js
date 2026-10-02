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
 * Centre du tronçon : centre de gravité du polygone ; s'il tombe hors du
 * polygone (tunnel courbe : 32 cas sur 87), le point du contour le plus
 * proche, repoussé de quelques mètres vers l'intérieur.
 *
 * Les tronçons (Metro.shp) arrivent de façon asynchrone : l'association se
 * fait dès que numéros ET tronçons sont chargés (whenReady).
 */
const AMGT4CEM_Interstation = {
  STYLE: { heightMeters: 42 }, // même hauteur réelle que les références de planche (voir AMGT4CEM_LABEL_STYLES)
  _features: null, // numéros (GeoJSON, Lambert), null tant que non chargés
  _tunnels: null, // [{ id, name, ring, center: [x, y] }], null tant que Metro.shp non reçu
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
        return { id: String(f.properties.ogc_fid), name: f.properties.name_fr || f.properties.name_nl || '', ring, center: this._centerOf(ring) };
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

  _inRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },

  _centerOf(ring) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      const c = x1 * y2 - x2 * y1;
      area += c;
      cx += (x1 + x2) * c;
      cy += (y1 + y2) * c;
    }
    if (!area) return ring[0];
    const centroid = [cx / (3 * area), cy / (3 * area)];
    if (this._inRing(centroid, ring)) return centroid;

    // Centre de gravité hors du polygone : point du contour le plus proche, repoussé vers l'intérieur.
    let near = null;
    for (let i = 1; i < ring.length; i++) {
      const c = this._nearestOnSegment(centroid, ring[i - 1], ring[i]);
      if (!near || c.d < near.d) near = c;
    }
    const ux = (centroid[0] - near.x) / (near.d || 1); // du contour vers le centre de gravité = vers l'extérieur
    const uy = (centroid[1] - near.y) / (near.d || 1);
    for (const step of [3, 1.5, 0.5]) {
      const p = [near.x - ux * step, near.y - uy * step];
      if (this._inRing(p, ring)) return p;
    }
    return [near.x, near.y];
  },
};
