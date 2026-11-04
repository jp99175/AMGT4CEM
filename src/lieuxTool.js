/**
 * Outil d'administration « Constituer un lieu » (usage exceptionnel, réservé aux administrateurs).
 *
 * Un lieu (auvent, passerelle, ascenseur...) est un ENSEMBLE d'objets UrbIS Topo (lignes). L'outil permet de
 * choisir ces objets : tracer un rectangle autour de l'ouvrage (presser-glisser-relâcher) fait proposer tous les
 * objets qu'il touche, cochés s'ils sont entièrement dedans ; toucher un objet sur la carte le coche / décoche.
 * L'enregistrement écrit data/lieux/lieux.json via le relais (route shared/lieux/lieux, code administrateur) :
 *   { version: 1, crs: 'EPSG:31370', lieux: { SLUG: { nom, tolerance_m, objets: [{ id, couche, code, type, lignes }] } } }
 * `lignes` = géométrie en Lambert 72 (mètres, au cm) : le calcul « ce point est-il dans le lieu ? » (zone = objets
 * élargis de `tolerance_m`) se fera sans appeler UrbIS. Les emprises dessinées (dépôt Delta) restent des polygones
 * (data/plans-patrimoine/temp-delta-mod.json), autre type de lieu.
 */
const AMGT4CEM_LieuxTool = {
  FILE: './data/lieux/lieux.json',
  ROUTE: 'shared/lieux/lieux',
  _map: null,
  _btn: null,
  _active: false,
  _panel: null,
  _group: null, // objets candidats (cliquables)
  _rectLayer: null,
  _cands: new Map(), // clé « couche:id » -> { key, id, couche, code, type, lignes (Lambert), sel, layers[] }
  _lieux: {},
  _armed: false,
  _start: null,

  init(map, btn) {
    this._map = map;
    this._btn = btn;
    map.createPane('amgtLieuxPane').style.zIndex = 655;
    this._group = L.layerGroup();
    btn.addEventListener('click', () => this.toggle());
  },

  async toggle() {
    if (this._active) return this.close();
    if (!(await AMGT4CEM_Admin.requestAccess())) return;
    this._active = true;
    this._btn.classList.add('amgt-btn--active');
    this._group.addTo(this._map);
    await this._readLieux();
    this._buildPanel();
  },

  close() {
    this._active = false;
    this._btn.classList.remove('amgt-btn--active');
    this._disarm();
    this._group.clearLayers();
    this._cands.clear();
    if (this._apercuLayer) { this._map.removeLayer(this._apercuLayer); this._apercuLayer = null; }
    this._map.removeLayer(this._group);
    if (this._panel) this._panel.remove();
    this._panel = null;
  },

  async _readLieux() {
    try {
      const r = await fetch(`${this.FILE}?t=${Date.now()}`);
      this._lieux = r.ok ? ((await r.json()).lieux || {}) : {};
    } catch (err) {
      this._lieux = {};
    }
  },

  // ---------------------------------------------------------------- panneau
  _buildPanel() {
    const p = document.createElement('div');
    p.id = 'amgt-lieux-panel';
    p.innerHTML = `
      <div class="amgt-lieux-row"><strong>Constituer un lieu</strong><button type="button" data-a="fermer" aria-label="Fermer">✕</button></div>
      <div class="amgt-lieux-row"><select data-f="existant"></select></div>
      <div class="amgt-lieux-row"><input data-f="nom" placeholder="Nom du lieu (ex. Ascenseur POELAERT)" />
        <input data-f="tol" type="number" min="0" max="50" step="1" value="5" title="Tolérance autour des objets (m)" /><span>m</span></div>
      <div class="amgt-lieux-row"><button type="button" data-a="rect">▭ Tracer un rectangle</button><span data-f="compte"></span></div>
      <div class="amgt-lieux-liste" data-f="liste"></div>
      <div class="amgt-lieux-row"><select data-f="contour" title="Forme du lieu">
        <option value="">Lignes seules</option><option value="serre">Polygone fermé : enveloppe serrée</option><option value="convexe">Polygone fermé : enveloppe convexe</option></select>
        <input data-f="marge" type="number" min="0" max="10" step="0.5" value="1.5" title="Comble les vides de cette largeur (m)" /><span>m</span></div>
      <div class="amgt-lieux-row"><input data-f="code" type="password" placeholder="Code administrateur" autocomplete="off" /></div>
      <div class="amgt-lieux-row"><button type="button" data-a="enreg">💾 Enregistrer</button><button type="button" data-a="suppr">Supprimer le lieu</button></div>
      <div class="amgt-lieux-etat" data-f="etat"></div>`;
    document.body.appendChild(p);
    this._panel = p;
    const f = (n) => p.querySelector(`[data-f="${n}"]`);
    const sel = f('existant');
    sel.innerHTML = '<option value="">— nouveau lieu —</option>' + Object.entries(this._lieux).map(([k, l]) => `<option value="${k}">${l.nom}</option>`).join('');
    const known = AMGT4CEM_PeLabelAnchors.getAdminCode();
    if (known) f('code').value = known;
    sel.addEventListener('change', () => this._chargerLieu(sel.value));
    for (const n of ['contour', 'marge']) f(n).addEventListener('change', () => this._apercu());
    p.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'fermer') this.close();
      else if (a.dataset.a === 'rect') this._arm();
      else if (a.dataset.a === 'enreg') this._enregistrer();
      else if (a.dataset.a === 'suppr') this._supprimer();
    });
    L.DomEvent.disableClickPropagation(p);
    L.DomEvent.disableScrollPropagation(p);
    this._renderListe();
  },

  _f(n) { return this._panel.querySelector(`[data-f="${n}"]`); },
  _etat(t, err) { const e = this._f('etat'); e.textContent = t; e.style.color = err ? '#b3261e' : '#0b5c75'; },

  _chargerLieu(slug) {
    this._clearCands();
    if (!slug) { this._f('nom').value = ''; this._renderListe(); return; }
    const l = this._lieux[slug];
    this._f('nom').value = l.nom;
    this._f('tol').value = l.tolerance_m;
    this._f('contour').value = l.contour_methode || '';
    if (l.contour_marge !== undefined) this._f('marge').value = l.contour_marge;
    for (const o of l.objets) this._addCand({ id: o.id, couche: o.couche, code: o.code, type: o.type, lignes: o.lignes }, true);
    this._renderListe();
    this._apercu();
    const pts = l.objets.flatMap((o) => o.lignes.flat()).map((q) => AMGT4CEM_CRS.lambertToLatLng(q));
    if (pts.length) this._map.fitBounds(L.latLngBounds(pts).pad(0.3));
  },

  _clearCands() { this._group.clearLayers(); this._cands.clear(); },

  _renderListe() {
    const liste = this._f('liste');
    liste.innerHTML = '';
    for (const c of this._cands.values()) {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = c.sel;
      cb.addEventListener('change', () => this._set(c, cb.checked));
      lab.append(cb, ` ${c.type || c.code} #${c.id}`);
      liste.appendChild(lab);
      c.cb = cb;
    }
    const n = [...this._cands.values()].filter((c) => c.sel).length;
    this._f('compte').textContent = `${n} coché(s) / ${this._cands.size}`;
    this._apercu();
  },

  _set(c, v) {
    c.sel = v;
    if (c.cb) c.cb.checked = v;
    for (const l of c.layers) l.setStyle(this._style(v));
    const n = [...this._cands.values()].filter((x) => x.sel).length;
    this._f('compte').textContent = `${n} coché(s) / ${this._cands.size}`;
    this._apercu();
  },

  _style(sel) { return sel ? { color: '#e65100', weight: 6, opacity: 0.95 } : { color: '#757575', weight: 4, opacity: 0.7 }; },

  _addCand(o, sel) {
    const key = `${o.couche}:${o.id}`;
    if (this._cands.has(key)) { if (sel) this._set(this._cands.get(key), true); return; }
    const c = { key, ...o, sel, layers: [] };
    for (const ligne of o.lignes) {
      const pl = L.polyline(ligne.map((q) => AMGT4CEM_CRS.lambertToLatLng(q)), { pane: 'amgtLieuxPane', ...this._style(sel) });
      pl.on('click', (e) => { L.DomEvent.stopPropagation(e); this._set(c, !c.sel); });
      this._group.addLayer(pl);
      c.layers.push(pl);
    }
    this._cands.set(key, c);
  },

  // -------------------------------------------------------------- rectangle
  _arm() {
    if (this._armed) return this._disarm();
    this._armed = true;
    const m = this._map;
    m.dragging.disable();
    m.touchZoom.disable();
    m.doubleClickZoom.disable();
    const el = m.getContainer();
    el.style.touchAction = 'none';
    el.style.cursor = 'crosshair';
    this._handlers = {
      down: (e) => {
        if (e.target.closest && e.target.closest('#amgt-lieux-panel')) return;
        this._start = m.mouseEventToLatLng(e);
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
        e.preventDefault();
      },
      move: (e) => {
        if (!this._start) return;
        const b = L.latLngBounds(this._start, m.mouseEventToLatLng(e));
        if (this._rectLayer) this._rectLayer.setBounds(b);
        else this._rectLayer = L.rectangle(b, { pane: 'amgtLieuxPane', color: '#0b5c75', weight: 2, dashArray: '6 4', fillOpacity: 0.08 }).addTo(m);
      },
      up: (e) => {
        if (!this._start) return;
        const b = L.latLngBounds(this._start, m.mouseEventToLatLng(e));
        this._start = null;
        this._disarm();
        this._chercher(b);
      },
    };
    el.addEventListener('pointerdown', this._handlers.down);
    el.addEventListener('pointermove', this._handlers.move);
    el.addEventListener('pointerup', this._handlers.up);
    this._etat('Presser-glisser-relâcher sur la carte pour tracer le rectangle.');
  },

  _disarm() {
    if (!this._armed) return;
    this._armed = false;
    const m = this._map;
    const el = m.getContainer();
    el.removeEventListener('pointerdown', this._handlers.down);
    el.removeEventListener('pointermove', this._handlers.move);
    el.removeEventListener('pointerup', this._handlers.up);
    el.style.touchAction = '';
    el.style.cursor = '';
    m.dragging.enable();
    m.touchZoom.enable();
    m.doubleClickZoom.enable();
  },

  async _chercher(bounds) {
    const sw = AMGT4CEM_CRS.latLngToLambert(bounds.getSouthWest());
    const ne = AMGT4CEM_CRS.latLngToLambert(bounds.getNorthEast());
    const [x0, x1] = [Math.min(sw.x, ne.x), Math.max(sw.x, ne.x)];
    const [y0, y1] = [Math.min(sw.y, ne.y), Math.max(sw.y, ne.y)];
    if (x1 - x0 < 1 || y1 - y0 < 1) return this._etat('Rectangle trop petit.', true);
    this._etat('Recherche des objets UrbIS…');
    const { wfsUrl, version, typeAttribute } = AMGT4CEM_CONFIG.urbisTopo;
    // Seuls les types UrbIS Topo actuellement affichés (sélection de la carte) sont proposés.
    const selection = AMGT4CEM_UrbisTopoSelectionStore.getSelection();
    const cat = {};
    for (const e of AMGT4CEM_URBISTOPO_CATALOG) cat[e.code] = e;
    const parCouche = { TopoLines: [], TopoShapes: [] };
    for (const code of Object.keys(selection)) {
      const g = cat[code] && cat[code].geometry;
      if (g === 'ligne') parCouche.TopoLines.push(code);
      else if (g === 'polygone') parCouche.TopoShapes.push(code);
    }
    if (!parCouche.TopoLines.length && !parCouche.TopoShapes.length) {
      return this._etat("Aucun type linéaire UrbIS Topo n'est affiché : les sélectionner d'abord (☰ Carte > UrbIS Topo).", true);
    }
    const notes = [];
    for (const ft of ['TopoLines', 'TopoShapes']) {
      if (!parCouche[ft].length) continue;
      try {
        const codes = parCouche[ft].map((c) => `'${c}'`).join(',');
        const params = new URLSearchParams({ service: 'WFS', version, request: 'GetFeature', typeNames: `urbistopo:${ft}`, outputFormat: 'application/json', count: '400', CQL_FILTER: `${typeAttribute} IN (${codes}) AND BBOX(geom,${x0},${y0},${x1},${y1})` });
        const r = await fetch(`${wfsUrl}?${params.toString()}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const feats = (await r.json()).features || [];
        notes.push(`${ft} : ${feats.length}`);
        for (const f of feats) {
          const lignes = this._lignes(f.geometry);
          if (!lignes.length) continue;
          const code = (f.properties || {})[typeAttribute];
          const dedans = lignes.every((l) => l.every((q) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1));
          this._addCand({ id: (f.properties || {}).ID, couche: ft, code, type: `${(cat[code] && cat[code].label) || (f.properties || {}).DESCRFRE || code} (${code})`, lignes }, dedans);
        }
      } catch (err) {
        notes.push(`${ft} : erreur ${err.message}`);
      }
    }
    if (this._rectLayer) { this._map.removeLayer(this._rectLayer); this._rectLayer = null; }
    this._renderListe();
    this._etat(`Objets trouvés (types affichés) — ${notes.join(' ; ')}. Cochés : ceux qui sont entièrement dans le rectangle.`);
  },

  /** Géométrie GeoJSON -> liste de lignes [[x,y],...] (Lambert), arrondies au cm ; les anneaux des surfaces comptent comme lignes. */
  _lignes(g) {
    if (!g) return [];
    const r = (l) => l.map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
    switch (g.type) {
      case 'LineString': return [r(g.coordinates)];
      case 'MultiLineString': case 'Polygon': return g.coordinates.map(r);
      case 'MultiPolygon': return g.coordinates.flat().map(r);
      default: return [];
    }
  },

  // ------------------------------------------------------------------ contour
  /** Contour fermé des objets cochés : [] si « lignes seules », sinon liste d'anneaux [[x,y],...] (Lambert, fermés). */
  _contour() {
    const mode = this._f('contour').value;
    const lignes = [...this._cands.values()].filter((c) => c.sel).flatMap((c) => c.lignes);
    if (!mode || !lignes.length) return [];
    if (mode === 'convexe') return [this._enveloppeConvexe(lignes.flat())];
    return this._enveloppeSerree(lignes, Math.max(0, Number(this._f('marge').value) || 0));
  },

  _enveloppeConvexe(pts) {
    const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const bas = [];
    for (const q of p) { while (bas.length >= 2 && cross(bas[bas.length - 2], bas[bas.length - 1], q) <= 0) bas.pop(); bas.push(q); }
    const haut = [];
    for (const q of [...p].reverse()) { while (haut.length >= 2 && cross(haut[haut.length - 2], haut[haut.length - 1], q) <= 0) haut.pop(); haut.push(q); }
    const ring = bas.slice(0, -1).concat(haut.slice(0, -1));
    ring.push(ring[0]);
    return ring.map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
  },

  /**
   * Enveloppe serrée : les objets sont tracés sur une grille fine, épaissis de `marge` (comble les vides plus
   * étroits que 2 × marge), l'intérieur est rempli, puis le contour de chaque ensemble est relevé et simplifié
   * (Douglas-Peucker). Une érosion ramène ensuite le polygone au plus près des objets.
   */
  _enveloppeSerree(lignes, marge) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const l of lignes) for (const q of l) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    const c = Math.max(0.25, (Math.max(x1 - x0, y1 - y0) + 2 * marge) / 700); // taille de cellule (m)
    const r = Math.max(1, Math.ceil(marge / c));
    const ox = x0 - marge - 2 * c; const oy = y0 - marge - 2 * c;
    const W = Math.ceil((x1 - x0 + 2 * marge) / c) + 5; const H = Math.ceil((y1 - y0 + 2 * marge) / c) + 5;
    const m = new Uint8Array(W * H);
    const stamp = (cx, cy) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const X = cx + dx; const Y = cy + dy;
        if (X >= 0 && Y >= 0 && X < W && Y < H) m[Y * W + X] = 1;
      }
    };
    for (const l of lignes) for (let i = 0; i < l.length - 1; i++) {
      const [ax, ay] = l[i]; const [bx, by] = l[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (c / 2)));
      for (let k = 0; k <= n; k++) stamp(Math.floor((ax + (bx - ax) * k / n - ox) / c), Math.floor((ay + (by - ay) * k / n - oy) / c));
    }
    // Remplissage : tout ce qui n'est pas relié au bord par des cellules vides est intérieur.
    const ext = new Uint8Array(W * H);
    const pile = [0];
    ext[0] = 1;
    while (pile.length) {
      const i = pile.pop(); const X = i % W; const Y = (i - X) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const A = X + dx; const B = Y + dy;
        if (A < 0 || B < 0 || A >= W || B >= H) continue;
        const j = B * W + A;
        if (!ext[j] && !m[j]) { ext[j] = 1; pile.push(j); }
      }
    }
    // Érosion (distance au vide extérieur, chanfrein 1 / 1,41) : le polygone suit de près les objets au lieu de
    // les déborder de `marge` ; il garde une largeur minimale (~1,2 × marge) autour d'un objet isolé.
    const dist = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) dist[i] = ext[i] ? 0 : 1e9;
    const D = Math.SQRT2;
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const i = Y * W + X; let d = dist[i];
      if (X > 0) d = Math.min(d, dist[i - 1] + 1);
      if (Y > 0) { d = Math.min(d, dist[i - W] + 1); if (X > 0) d = Math.min(d, dist[i - W - 1] + D); if (X < W - 1) d = Math.min(d, dist[i - W + 1] + D); }
      dist[i] = d;
    }
    for (let Y = H - 1; Y >= 0; Y--) for (let X = W - 1; X >= 0; X--) {
      const i = Y * W + X; let d = dist[i];
      if (X < W - 1) d = Math.min(d, dist[i + 1] + 1);
      if (Y < H - 1) { d = Math.min(d, dist[i + W] + 1); if (X < W - 1) d = Math.min(d, dist[i + W + 1] + D); if (X > 0) d = Math.min(d, dist[i + W - 1] + D); }
      dist[i] = d;
    }
    const seuil = 0.6 * r;
    const plein = (X, Y) => X >= 0 && Y >= 0 && X < W && Y < H && dist[Y * W + X] > seuil;
    // Arêtes de bord, orientées pour avoir le plein à gauche, puis chaînées en anneaux.
    const suiv = new Map();
    const ajout = (a, b) => { const k = `${a[0]},${a[1]}`; if (!suiv.has(k)) suiv.set(k, []); suiv.get(k).push(b); };
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      if (!plein(X, Y)) continue;
      if (!plein(X, Y - 1)) ajout([X, Y], [X + 1, Y]);
      if (!plein(X + 1, Y)) ajout([X + 1, Y], [X + 1, Y + 1]);
      if (!plein(X, Y + 1)) ajout([X + 1, Y + 1], [X, Y + 1]);
      if (!plein(X - 1, Y)) ajout([X, Y + 1], [X, Y]);
    }
    const anneaux = [];
    for (const [k0, liste] of suiv) {
      while (liste.length) {
        const depart = k0.split(',').map(Number);
        const ring = [depart];
        let cur = liste.pop();
        let guard = 0;
        while (guard++ < 1e6 && (cur[0] !== depart[0] || cur[1] !== depart[1])) {
          ring.push(cur);
          const l2 = suiv.get(`${cur[0]},${cur[1]}`);
          if (!l2 || !l2.length) break;
          cur = l2.pop();
        }
        if (ring.length > 3) anneaux.push(ring);
      }
    }
    const aire = (rg) => rg.reduce((s, q, i) => { const n = rg[(i + 1) % rg.length]; return s + q[0] * n[1] - n[0] * q[1]; }, 0) / 2;
    const dp = (pts, eps) => {
      if (pts.length < 3) return pts;
      const [a, b] = [pts[0], pts[pts.length - 1]];
      let dmax = 0; let imax = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
        if (d > dmax) { dmax = d; imax = i; }
      }
      if (dmax <= eps) return [a, b];
      return dp(pts.slice(0, imax + 1), eps).slice(0, -1).concat(dp(pts.slice(imax), eps));
    };
    return anneaux.filter((rg) => aire(rg) > 0).map((rg) => {
      const mid = Math.floor(rg.length / 2);
      const eps = Math.max(2.5, (0.25 * marge) / c); // tolérance de simplification, en cellules de grille
      const h1 = dp(rg.slice(0, mid + 1), eps); const h2 = dp(rg.slice(mid).concat([rg[0]]), eps);
      const simple = h1.slice(0, -1).concat(h2); // se ferme sur le premier point
      const out = simple.map((q) => [Math.round((ox + q[0] * c) * 100) / 100, Math.round((oy + q[1] * c) * 100) / 100]);
      out.push(out[0]); // anneau fermé
      return out;
    });
  },

  _apercu() {
    if (!this._panel) return;
    if (this._apercuLayer) { this._map.removeLayer(this._apercuLayer); this._apercuLayer = null; }
    const anneaux = this._contour();
    if (!anneaux.length) return;
    this._apercuLayer = L.polygon(anneaux.map((rg) => rg.map((q) => AMGT4CEM_CRS.lambertToLatLng(q))), { pane: 'amgtLieuxPane', interactive: false, color: '#0b5c75', weight: 2, dashArray: '6 4', fillColor: '#0b5c75', fillOpacity: 0.2 }).addTo(this._map);
  },

  // ----------------------------------------------------------- enregistrement
  _slug(nom) { return nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, ''); },

  async _envoyer(lieux) {
    const code = this._f('code').value.trim();
    await AMGT4CEM_PeLabelAnchors.putToRelay(AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl, this.ROUTE, { version: 1, crs: 'EPSG:31370', lieux }, code);
    AMGT4CEM_PeLabelAnchors.setAdminCode(code);
    this._lieux = lieux;
  },

  async _enregistrer() {
    const nom = this._f('nom').value.trim();
    const slug = this._slug(nom);
    const objets = [...this._cands.values()].filter((c) => c.sel).map((c) => ({ id: c.id, couche: c.couche, code: c.code, type: c.type, lignes: c.lignes }));
    if (!slug) return this._etat('Donner un nom au lieu.', true);
    if (!objets.length) return this._etat('Aucun objet coché.', true);
    const tol = Math.max(0, Math.min(50, Number(this._f('tol').value) || 0));
    try {
      this._etat('Enregistrement…');
      const contour = this._contour();
      const lieu = { nom, tolerance_m: tol, objets };
      if (contour.length) Object.assign(lieu, { contour_methode: this._f('contour').value, contour_marge: Number(this._f('marge').value) || 0, contour });
      await this._envoyer({ ...this._lieux, [slug]: lieu });
      this._etat(`Lieu « ${nom} » enregistré (${objets.length} objets). La carte le lira après le déploiement (environ une minute).`);
    } catch (err) {
      this._etat(err.message, true);
    }
  },

  async _supprimer() {
    const slug = this._f('existant').value;
    if (!slug) return this._etat('Choisir un lieu existant à supprimer.', true);
    if (!confirm(`Supprimer le lieu « ${this._lieux[slug].nom} » ?`)) return;
    const reste = { ...this._lieux };
    delete reste[slug];
    try {
      await this._envoyer(reste);
      this._etat('Lieu supprimé.');
      this.close();
    } catch (err) {
      this._etat(err.message, true);
    }
  },
};
