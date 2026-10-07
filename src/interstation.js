/**
 * Numéros d'interstation (couche « Numéros interstation » des Plans patrimoine) : chaque
 * numéro est rattaché à un TRONÇON (polygone de genre « tunnel » de data/shapefile/polygones.shp, emprise de tunnel).
 *
 * SOURCE UNIQUE : data/plans-patrimoine/etiquettes-troncons.json, liste COMPLÈTE des étiquettes
 * { "numéro#rang": { x, y, tunnel } } — position du texte (Lambert 72, mètres) et identifiant
 * stable `id` du tunnel (référentiel, ex. « G000002 »). Créer ou supprimer une étiquette = ajouter ou retirer une entrée
 * (plugin pe-label-editor). Le fichier d'origine data/plans-patrimoine/numeros-interstation.legacy.json n'est
 * plus lu : archive (amorçage initial du JSON), à retirer quand lignes.shp existera.
 *
 * Deux usages :
 *  - l'étiquette : texte à taille réelle constante (scaledText.js, comme les
 *    références de planche), souligné par le MÊME tracé que la ligne de repère :
 *    un seul trait qui part du centre du tronçon, rejoint l'extrémité du bord bas
 *    du texte la plus proche, puis longe ce bord (épaisseur plus fine au dézoom).
 *    Les étiquettes n'ont pas d'infobulle (marqueurs non interactifs) ;
 *  - l'infobulle de l'emprise du tronçon (metroLayer.js) y ajoute son ou ses
 *    numéros (numbersForTunnel), que la couche soit affichée ou non.
 *
 * RATTACHEMENT. Celui du JSON. Pour une étiquette nouvellement créée (ou dont le tronçon
 * a disparu de polygones.shp), le tunnel dont le contour est le plus proche du texte
 * (autoTunnelAt) sert de proposition par défaut.
 *
 * AXE ET CENTRE DU TRONÇON. Le polygone d'un tunnel est une bande allongée ;
 * son axe est une ligne de construction tracée entre ses deux côtés longs, et
 * le centre du tronçon (point d'arrivée de la ligne de repère) est le milieu
 * de cet axe, MESURÉ LE LONG de l'axe — pas le centre de gravité, qui tombe
 * hors du tunnel dès qu'il est courbe. Construction (_axisOf) :
 *  - les SEGMENTS COMMUNS entre le contour du tunnel et ceux des stations
 *    (MS) sont repérés (_commonSegments) ; l'axe passe TOUJOURS par le milieu
 *    de ces segments : avec deux segments communs ou plus, les deux plus
 *    éloignés marquent les extrémités, le contour est coupé à ces segments et
 *    ses deux côtés, rééchantillonnés à abscisse curviligne proportionnelle,
 *    donnent l'axe (milieu de chaque paire de points correspondants) ; les
 *    segments communs intermédiaires sont ajoutés comme points de passage ;
 *  - avec un seul segment commun (ou aucun), les deux sommets les plus
 *    éloignés repèrent les extrémités, et l'extrémité voisine du segment
 *    commun est ramenée sur son milieu.
 *
 * Les tronçons (polygones.shp) arrivent de façon asynchrone : les étiquettes sont liées à leur
 * tronçon dès que le JSON ET polygones.shp sont chargés (whenReady).
 */
const AMGT4CEM_Interstation = {
  STYLE: { heightMeters: 42 }, // même hauteur réelle que les références de planche (voir AMGT4CEM_LABEL_STYLES)
  _overrides: null, // état ENREGISTRÉ { "numéro#rang": { x, y, tunnel } } (Lambert 72, id du tunnel) ; null tant que non chargé
  _tunnels: null, // [{ id, name, ring, axis: [[x, y], ...], center: [x, y], commons: [...] }], null tant que polygones.shp non reçu
  _numbers: [], // état COURANT (modifs non enregistrées comprises) : [{ numero, key, def: { x, y, tunnel }, tunnel }] (tunnel : objet résolu)
  _markers: [], // marqueurs du groupe actuellement construit
  _group: null, // dernier groupe Leaflet construit (buildSubGroup)
  _ready: null,
  _resolveReady: null,

  init() {
    this._ready = new Promise((resolve) => (this._resolveReady = resolve));
    this._fetchOverrides().then((labels) => {
      this._overrides = labels;
      this._tryLink();
    });
  },

  /** Résolue quand numéros, définitions enregistrées et tronçons sont chargés et associés. */
  whenReady() {
    return this._ready;
  },

  /** N'échoue jamais : absent/illisible = aucune étiquette. */
  async _fetchOverrides() {
    try {
      // no-cache : revalide auprès du serveur (GitHub Pages met les fichiers en cache ~10 min), comme peLabelAnchors.js.
      const response = await fetch(AMGT4CEM_CONFIG.interstationLabelsUrl, { cache: 'no-cache' });
      if (response.ok) return ((await response.json()) || {}).labels || {};
    } catch (err) {
      console.warn("[AMGT4CEM] Étiquettes d'interstation illisibles, aucune étiquette affichée :", err);
    }
    return {};
  },

  /** Appelé par app.js avec les entités jointes (seuls les genres « tunnel » et « station » servent). */
  setMetroFeatures(features) {
    const rings = (genre) =>
      features
        .filter((f) => f.properties && f.properties.genre === genre && f.geometry && f.geometry.type === 'Polygon')
        .map((f) => ({ props: f.properties, ring: f.geometry.coordinates[0] }));
    const stations = rings('station').map((s) => ({ ring: this._openRing(s.ring), bbox: this._bbox(s.ring) }));
    this._tunnels = rings('tunnel').map(({ props, ring }) => {
      const commons = this._commonSegments(ring, stations);
      const axis = this._axisOf(ring, commons);
      return { id: props.id, name: props.name_fr || props.name_nl || '', ring, axis, center: this._midpointAlong(axis), commons };
    });
    this._tryLink();
  },

  _tryLink() {
    if (!this._overrides || !this._tunnels) return;
    this._numbers = Object.entries(this._overrides).map(([key, def]) => this._makeNumber(key, def));
    this._resolveReady();
  },

  /** Entrée de l'état courant pour une étiquette : tunnel du JSON, sinon (disparu) le plus proche du texte. */
  _makeNumber(key, def) {
    const d = { x: def.x, y: def.y, tunnel: def.tunnel };
    return { numero: key.split('#')[0], key, def: d, tunnel: this.tunnelById(d.tunnel) || this._nearestTunnel([d.x, d.y]) };
  },

  /** Tunnel dont le contour est le plus proche d'un point Lambert : proposition par défaut pour une étiquette créée. */
  autoTunnelAt(x, y) {
    return this._nearestTunnel([x, y]);
  },

  tunnelById(id) {
    return (this._tunnels || []).find((t) => t.id === String(id)) || null;
  },

  /** Tous les tronçons (axes et centres compris), pour le plugin d'édition. */
  tunnels() {
    return this._tunnels || [];
  },

  /** Numéros d'interstation d'un tronçon (id : identifiant du référentiel), pour son infobulle. */
  numbersForTunnel(id) {
    return this._numbers.filter((n) => n.tunnel && n.tunnel.id === String(id)).map((n) => n.numero);
  },

  /** Marqueurs (texte) du groupe actuellement construit, pour le plugin d'édition. */
  markers() {
    return this._markers;
  },

  // ---- Définitions enregistrées (partagées) -------------------------------------

  /** Définition COURANTE d'une étiquette (copie), ou null. */
  getDef(key) {
    const n = this._numbers.find((x) => x.key === key);
    return n ? { ...n.def } : null;
  },

  /** Copie de l'état ENREGISTRÉ (référence pour détecter les modifications). */
  savedOverrides() {
    return JSON.parse(JSON.stringify(this._overrides || {}));
  },

  /** État COURANT complet { "numéro#rang": { x, y, tunnel } } (modifs, créations, suppressions non enregistrées comprises). */
  currentLabels() {
    const out = {};
    for (const n of this._numbers) out[n.key] = { x: n.def.x, y: n.def.y, tunnel: n.def.tunnel };
    return out;
  },

  /**
   * Enregistre l'ensemble des définitions dans le dépôt, via le relais (data/plans-patrimoine/etiquettes-troncons.json).
   * @param {Object} labels - { "numéro#rang": { x, y, tunnel } }, x/y en Lambert 72, tunnel = id du référentiel (étiquettes SANS définition : absentes)
   * @param {string} adminCode - code administrateur attendu par le relais
   */
  async saveOverrides(labels, adminCode) {
    const sorted = Object.fromEntries(Object.keys(labels).sort().map((k) => [k, labels[k]])); // clés triées : pas de commit sans changement réel
    await AMGT4CEM_PeLabelAnchors.putToRelay(AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl, 'shared/plans-patrimoine/etiquettes-troncons', { version: 1, crs: 'EPSG:31370', labels: sorted }, adminCode);
    this._overrides = JSON.parse(JSON.stringify(labels));
  },

  /**
   * Applique une définition { x, y, tunnel } à un marqueur déjà construit : texte déplacé, ligne de repère
   * ramenée au centre du tronçon choisi (le plus proche du texte si ce tronçon n'existe plus).
   */
  apply(marker, def) {
    const n = marker._amgtNumber;
    n.def = { x: def.x, y: def.y, tunnel: def.tunnel };
    n.tunnel = this.tunnelById(def.tunnel) || this._nearestTunnel([def.x, def.y]);
    marker._amgtTunnel = n.tunnel;
    const at = AMGT4CEM_CRS.lambertToLatLng([def.x, def.y]);
    AMGT4CEM_ScaledText.setDefinition(marker, { r1: 'center', a1: [at.lat, at.lng] });
    AMGT4CEM_ScaledText.setLeaderFrom(marker, AMGT4CEM_CRS.lambertToLatLng(n.tunnel.center));
  },

  /** Le tronçon d'une étiquette est-il celui que le rattachement automatique proposerait pour sa position actuelle ? */
  isAutoTunnel(marker) {
    const n = marker._amgtNumber;
    return this._nearestTunnel([n.def.x, n.def.y]) === n.tunnel;
  },

  /** Marqueur (texte) et ligne de repère d'une étiquette, ajoutés au groupe courant. */
  _makeMarker(n) {
    const at = AMGT4CEM_CRS.lambertToLatLng([n.def.x, n.def.y]);
    const opacity = AMGT4CEM_PatrimoineLayer._opacityFactor;
    const marker = AMGT4CEM_ScaledText.createMarker(at, n.numero, {
      color: this._color,
      heightMeters: this.STYLE.heightMeters,
      leaderFrom: AMGT4CEM_CRS.lambertToLatLng(n.tunnel.center),
      def: { r1: 'center', a1: [at.lat, at.lng] },
    });
    marker._amgtKey = n.key;
    marker._amgtNumber = n;
    marker._amgtTunnel = n.tunnel;
    marker.setOpacity(opacity);
    marker.addTo(this._group);
    marker._amgtLeader.setStyle({ opacity });
    marker._amgtLeader.addTo(this._group);
    this._markers.push(marker);
    return marker;
  },

  /**
   * Construit le groupe Leaflet de la couche : pour chaque étiquette, le texte
   * souligné et sa ligne de repère (même groupe : ils s'affichent et se
   * masquent ensemble, avec la case « Numéros interstation »).
   * @param {string} color - couleur choisie pour la couche
   * @param {number} opacity - facteur d'opacité courant (0 à 1)
   */
  buildSubGroup(color, opacity) {
    for (const m of this._markers) AMGT4CEM_ScaledText.dispose(m);
    this._markers = [];
    this._color = color;
    this._group = L.layerGroup();
    for (const n of this._numbers) this._makeMarker(n);
    return this._group;
  },

  /** Premier rang libre pour un numéro : « 243-3#0 », « 243-3#1 »... */
  nextKey(numero) {
    let rank = 0;
    while (this._numbers.some((n) => n.key === `${numero}#${rank}`) || (this._overrides && this._overrides[`${numero}#${rank}`])) rank++;
    return `${numero}#${rank}`;
  },

  /** Crée une étiquette (clé « numéro#rang », définition { x, y, tunnel }) ; retourne son marqueur, ou null si la couche n'est pas encore construite. */
  createLabel(key, def) {
    const n = this._makeNumber(key, def);
    this._numbers.push(n);
    return this._group ? this._makeMarker(n) : null;
  },

  /** Supprime une étiquette de l'état courant (et de la carte). */
  removeLabel(marker) {
    const n = marker._amgtNumber;
    this._numbers = this._numbers.filter((x) => x !== n);
    this._markers = this._markers.filter((m) => m !== marker);
    if (this._group) {
      this._group.removeLayer(marker);
      this._group.removeLayer(marker._amgtLeader);
    }
    AMGT4CEM_ScaledText.dispose(marker);
  },

  /** Fait correspondre l'état courant à `labels` { clé: { x, y, tunnel } } : retire, ajoute et met à jour (annulation, réinitialisation). */
  syncTo(labels) {
    for (const m of [...this._markers]) if (!labels[m._amgtKey]) this.removeLabel(m);
    this._numbers = this._numbers.filter((n) => labels[n.key]); // étiquettes sans marqueur (couche jamais construite)
    for (const [key, def] of Object.entries(labels)) {
      const marker = this._markers.find((m) => m._amgtKey === key);
      if (marker) this.apply(marker, def);
      else if (this._numbers.some((n) => n.key === key)) Object.assign(this._numbers.find((n) => n.key === key), this._makeNumber(key, def));
      else this.createLabel(key, def);
    }
  },

  // ---- Axe d'un tunnel (Lambert, mètres) ---------------------------------------

  /** Anneau sans son dernier sommet s'il répète le premier. */
  _openRing(ring) {
    const last = ring[ring.length - 1];
    return last[0] === ring[0][0] && last[1] === ring[0][1] ? ring.slice(0, -1) : ring;
  },

  _bbox(ring) {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  },

  /**
   * Segments communs entre le contour d'un tunnel et ceux des stations : parties
   * de côtés quasi colinéaires (écart < 1 m, angle < 3°) qui se recouvrent sur
   * plus de 1 m. [{ p, q, mid, len }] ; les tronçons de recouvrement qui se
   * touchent (côté de station découpé en plusieurs segments) sont fusionnés.
   */
  _commonSegments(tunnelRing, stations) {
    const ring = this._openRing(tunnelRing);
    const box = this._bbox(ring);
    const found = [];
    for (const st of stations) {
      if (st.bbox[0] > box[2] + 2 || st.bbox[2] < box[0] - 2 || st.bbox[1] > box[3] + 2 || st.bbox[3] < box[1] - 2) continue;
      for (let i = 0; i < ring.length; i++) {
        const a = [ring[i], ring[(i + 1) % ring.length]];
        for (let j = 0; j < st.ring.length; j++) {
          const c = this._overlap(a, [st.ring[j], st.ring[(j + 1) % st.ring.length]]);
          if (c) found.push(c);
        }
      }
    }
    const merged = [];
    for (const c of found) {
      const near = merged.find((m) => this._touch(m, c));
      if (near) Object.assign(near, this._union(near, c));
      else merged.push(c);
    }
    return merged;
  },

  /** Recouvrement de deux côtés [a, b] et [c, d] : { p, q, mid, len } ou null. */
  _overlap([[ax, ay], [bx, by]], [[cx, cy], [dx, dy]]) {
    const la = Math.hypot(bx - ax, by - ay);
    const lb = Math.hypot(dx - cx, dy - cy);
    if (la < 0.01 || lb < 0.01) return null;
    const ux = (bx - ax) / la;
    const uy = (by - ay) / la;
    if (Math.abs(ux * ((dy - cy) / lb) - uy * ((dx - cx) / lb)) > Math.sin((3 * Math.PI) / 180)) return null; // pas parallèles
    const off = (px, py) => Math.abs((px - ax) * uy - (py - ay) * ux);
    if (off(cx, cy) > 1 || off(dx, dy) > 1) return null; // parallèles mais décalés
    const t1 = (cx - ax) * ux + (cy - ay) * uy;
    const t2 = (dx - ax) * ux + (dy - ay) * uy;
    const lo = Math.max(0, Math.min(t1, t2));
    const hi = Math.min(la, Math.max(t1, t2));
    if (hi - lo < 1) return null;
    const p = [ax + ux * lo, ay + uy * lo];
    const q = [ax + ux * hi, ay + uy * hi];
    return { p, q, mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], len: hi - lo };
  },

  /** Deux segments communs qui se touchent (extrémité contre extrémité, à 0,3 m). */
  _touch(m, c) {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    return d(m.p, c.p) < 0.3 || d(m.p, c.q) < 0.3 || d(m.q, c.p) < 0.3 || d(m.q, c.q) < 0.3;
  },

  /** Réunion de deux segments communs qui se touchent : les deux extrémités les plus éloignées. */
  _union(m, c) {
    const pts = [m.p, m.q, c.p, c.q];
    let best = null;
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const len = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
        if (!best || len > best.len) best = { p: pts[i], q: pts[j], len };
      }
    }
    return { ...best, mid: [(best.p[0] + best.q[0]) / 2, (best.p[1] + best.q[1]) / 2] };
  },

  /** Axe d'un polygone en bande : polyligne [[x, y], ...] (voir en-tête). */
  _axisOf(closedRing, commons) {
    const ring = this._openRing(closedRing);
    if (ring.length < 4) return [this._meanOf(ring)];
    let axis = null;
    let pass = commons;
    if (commons.length >= 2) {
      // Extrémités : les deux segments communs les plus éloignés l'un de l'autre.
      let c1 = commons[0];
      let c2 = commons[1];
      let best = -1;
      for (let i = 0; i < commons.length; i++) {
        for (let j = i + 1; j < commons.length; j++) {
          const d = Math.hypot(commons[i].mid[0] - commons[j].mid[0], commons[i].mid[1] - commons[j].mid[1]);
          if (d > best) {
            best = d;
            c1 = commons[i];
            c2 = commons[j];
          }
        }
      }
      const chains = this._chainsBetween(ring, c1, c2);
      if (chains) {
        const a = this._resample(chains.a, 50);
        const b = this._resample(chains.b, 50);
        axis = a.map((p, k) => [(p[0] + b[k][0]) / 2, (p[1] + b[k][1]) / 2]);
        pass = commons.filter((c) => c !== c1 && c !== c2); // points de passage intermédiaires
      }
    }
    if (!axis) {
      axis = this._farthestAxis(ring);
      if (commons.length) {
        // L'extrémité de l'axe la plus proche du segment commun (le plus long) est ramenée sur son milieu.
        const c = commons.reduce((x, y) => (y.len > x.len ? y : x));
        const first = Math.hypot(axis[0][0] - c.mid[0], axis[0][1] - c.mid[1]);
        const last = Math.hypot(axis[axis.length - 1][0] - c.mid[0], axis[axis.length - 1][1] - c.mid[1]);
        axis[first <= last ? 0 : axis.length - 1] = c.mid;
        pass = commons.filter((x) => x !== c);
      }
    }
    for (const c of pass) axis = this._insertWaypoint(axis, c.mid);
    return axis;
  },

  /** Axe « sans segment commun » : les deux sommets les plus éloignés repèrent les extrémités. */
  _farthestAxis(ring) {
    const n = ring.length;
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
    const sideA = ring.slice(bi, bj + 1);
    const sideB = ring.slice(bj).concat(ring.slice(0, bi + 1)).reverse();
    const a = this._resample(sideA, 50);
    const b = this._resample(sideB, 50);
    return a.map((p, k) => [(p[0] + b[k][0]) / 2, (p[1] + b[k][1]) / 2]);
  },

  /**
   * Les deux côtés d'un contour entre deux segments communs, orientés du premier au second :
   * { a, b } (polylignes) ou null si les segments ne se laissent pas séparer proprement.
   * Les extrémités p/q de chaque segment sont insérées dans le contour comme sommets.
   */
  _chainsBetween(ring, c1, c2) {
    const pts = ring.map((p) => ({ p, tag: null }));
    const insert = (pt, tag) => {
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = this._nearestOnSegment(pt, pts[i].p, pts[(i + 1) % pts.length].p).d;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      for (const k of [bestI, (bestI + 1) % pts.length]) {
        if (Math.hypot(pts[k].p[0] - pt[0], pts[k].p[1] - pt[1]) < 1e-6) {
          if (pts[k].tag) return false; // deux extrémités sur le même sommet : dégénéré
          pts[k].tag = tag;
          return true;
        }
      }
      pts.splice(bestI + 1, 0, { p: pt, tag });
      return true;
    };
    if (!insert(c1.p, 'a1') || !insert(c1.q, 'a2') || !insert(c2.p, 'b1') || !insert(c2.q, 'b2')) return null;
    const n = pts.length;
    const order = pts.map((v, i) => ({ i, cap: v.tag && v.tag[0] })).filter((v) => v.cap);
    if (order.length !== 4) return null;
    const k = order[0].cap === order[1].cap ? 0 : 1;
    const seq = [0, 1, 2, 3].map((j) => order[(k + j) % 4]);
    if (seq[0].cap !== seq[1].cap || seq[2].cap !== seq[3].cap || seq[0].cap === seq[2].cap) return null;
    const forward = (from, to) => {
      const out = [];
      for (let i = from; ; i = (i + 1) % n) {
        out.push(pts[i].p);
        if (i === to) break;
      }
      return out;
    };
    // seq[0], seq[1] : extrémités du premier segment commun ; seq[2], seq[3] : celles du second.
    const a = forward(seq[1].i, seq[2].i);
    const b = forward(seq[3].i, seq[0].i).reverse();
    return { a, b };
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

  /** Insère un point de passage dans une polyligne, au plus près de celle-ci. */
  _insertWaypoint(line, pt) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 1; i < line.length; i++) {
      const d = this._nearestOnSegment(pt, line[i - 1], line[i]).d;
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    return line.slice(0, bestI).concat([pt], line.slice(bestI));
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

  // ---- Rattachement automatique ---------------------------------------------------

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
};
