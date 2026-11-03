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
    for (const o of l.objets) this._addCand({ id: o.id, couche: o.couche, code: o.code, type: o.type, lignes: o.lignes }, true);
    this._renderListe();
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
  },

  _set(c, v) {
    c.sel = v;
    if (c.cb) c.cb.checked = v;
    for (const l of c.layers) l.setStyle(this._style(v));
    const n = [...this._cands.values()].filter((x) => x.sel).length;
    this._f('compte').textContent = `${n} coché(s) / ${this._cands.size}`;
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
    const cat = {};
    for (const e of AMGT4CEM_URBISTOPO_CATALOG) cat[e.code] = e.label;
    const notes = [];
    for (const ft of ['TopoLines', 'TopoShapes']) {
      try {
        const params = new URLSearchParams({ service: 'WFS', version, request: 'GetFeature', typeNames: `urbistopo:${ft}`, outputFormat: 'application/json', count: '400', CQL_FILTER: `BBOX(geom,${x0},${y0},${x1},${y1})` });
        const r = await fetch(`${wfsUrl}?${params.toString()}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const feats = (await r.json()).features || [];
        notes.push(`${ft} : ${feats.length}`);
        for (const f of feats) {
          const lignes = this._lignes(f.geometry);
          if (!lignes.length) continue;
          const code = (f.properties || {})[typeAttribute];
          const dedans = lignes.every((l) => l.every((q) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1));
          this._addCand({ id: (f.properties || {}).ID, couche: ft, code, type: `${cat[code] || (f.properties || {}).DESCRFRE || code} (${code})`, lignes }, dedans);
        }
      } catch (err) {
        notes.push(`${ft} : erreur ${err.message}`);
      }
    }
    if (this._rectLayer) { this._map.removeLayer(this._rectLayer); this._rectLayer = null; }
    this._renderListe();
    this._etat(`Objets trouvés — ${notes.join(' ; ')}. Cochés : ceux qui sont entièrement dans le rectangle.`);
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
      await this._envoyer({ ...this._lieux, [slug]: { nom, tolerance_m: tol, objets } });
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
