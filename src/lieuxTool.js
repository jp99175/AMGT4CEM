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
  _viseurOn: true, // tracé au viseur (✋ : déplacer la carte à la place)
  DECALAGE_PX: 60, // décalage du viseur au-dessus du doigt (pas à la souris)
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
    this._clickH = (e) => this._surClic(e);
    this._map.on('click', this._clickH);
    this._vueH = () => this._aimantVue();
    this._map.on('moveend', this._vueH);
    this._buildPanel();
  },

  close() {
    this._active = false;
    if (this._clickH) this._map.off('click', this._clickH);
    if (this._vueH) this._map.off('moveend', this._vueH);
    clearTimeout(this._aimantTimer);
    this._aimantPts = [];
    this._traceAbandon();
    this._viseurStop();
    this._modeActif = null;
    this._btn.classList.remove('amgt-btn--active');
    this._disarm();
    this._syncDrag();
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
      <div class="amgt-lieux-row"><strong>Constituer un lieu</strong><button type="button" data-a="reduire" title="Réduire en bandeau / agrandir" aria-label="Réduire">▾</button><button type="button" data-a="fermer" aria-label="Fermer">✕</button></div>
      <div class="amgt-lieux-row amgt-lieux-sec"><select data-f="existant"></select></div>
      <div class="amgt-lieux-row amgt-lieux-sec"><input data-f="nom" placeholder="Nom du lieu (ex. Ascenseur POELAERT)" />
        <input data-f="tol" type="number" min="0" max="50" step="1" value="5" title="Tolérance autour des objets (m)" /><span>m</span></div>
      <div class="amgt-lieux-row amgt-lieux-modes">
        <button type="button" data-m="objet" title="Toucher un objet UrbIS visible pour l'ajouter">☝ Objet</button>
        <button type="button" data-a="rect" title="Tracer un rectangle : propose les objets visibles qu'il touche">▭ Rectangle</button>
        <button type="button" data-m="trace" title="Dessiner une ligne brisée (chaîne d'arpenteur), à fermer en polygone">✎ Tracé</button>
        <span data-f="compte"></span></div>
      <div class="amgt-lieux-row amgt-lieux-trace amgt-hidden" data-f="tracebarre">
        <span data-f="chaine"></span>
        <label class="amgt-lieux-aimant" title="Aimant : le viseur s'accroche au point remarquable proche s'il y reste 1 s (0 = sans aimant)"><span class="amgt-lieux-aimant-lab"></span><input data-f="aimant" type="number" min="0" max="50" step="1" value="5" /> m</label>
        <button type="button" data-a="t-main" title="Déplacer la carte au doigt (désactive le viseur)">✋</button>
        <button type="button" data-a="t-annuler" title="Retour : annuler la dernière action du tracé">↶ Retour</button>
        <button type="button" data-a="t-fermer" title="Fermer en polygone (ou toucher le premier sommet)">⬡ Fermer</button>
        <button type="button" data-a="t-valider" title="Ajouter ce tracé à la liste">✓</button>
        <button type="button" data-a="t-abandon" title="Abandonner ce tracé">✕</button></div>
      <div class="amgt-lieux-corps amgt-lieux-sec">
        <div class="amgt-lieux-liste" data-f="liste"></div>
        <input class="amgt-lieux-haut" data-f="haut" type="range" min="0" max="100" value="35" orient="vertical" title="Hauteur de la liste" aria-label="Hauteur de la liste" />
      </div>
      <div class="amgt-lieux-row amgt-lieux-sec"><select data-f="contour" title="Forme du lieu">
        <option value="">Lignes seules</option><option value="union">Polygone : union des polygones cochés</option><option value="serre">Polygone : enveloppe serrée</option><option value="convexe">Polygone : enveloppe convexe</option></select>
        <input data-f="marge" type="number" min="0" max="10" step="0.5" value="1.5" title="Comble les vides étroits (m) : 1,5 enveloppe serrée, 0,2 union" /><span>m</span></div>
      <div class="amgt-lieux-row amgt-lieux-sec"><input data-f="code" type="password" placeholder="Code administrateur" autocomplete="off" /></div>
      <div class="amgt-lieux-row amgt-lieux-sec"><button type="button" data-a="enreg">💾 Enregistrer</button><button type="button" data-a="suppr">Supprimer le lieu</button></div>
      <div class="amgt-lieux-etat" data-f="etat"></div>`;
    document.body.appendChild(p);
    this._panel = p;
    const f = (n) => p.querySelector(`[data-f="${n}"]`);
    const sel = f('existant');
    sel.innerHTML = '<option value="">— nouveau lieu —</option>' + Object.entries(this._lieux).map(([k, l]) => `<option value="${k}">${l.nom}</option>`).join('');
    const known = AMGT4CEM_PeLabelAnchors.getAdminCode();
    if (known) f('code').value = known;
    sel.addEventListener('change', () => this._chargerLieu(sel.value));
    f('contour').addEventListener('change', () => { f('marge').value = f('contour').value === 'union' ? 0.2 : 1.5; this._apercu(); });
    f('marge').addEventListener('change', () => this._apercu());
    f('haut').addEventListener('input', () => this._hauteurListe());
    f('tracebarre').querySelector('.amgt-lieux-aimant-lab').innerHTML = this.SVG_AIMANT;
    try { const v = localStorage.getItem('amgt4cem.lieux.aimant'); if (v !== null && v !== '') f('aimant').value = v; } catch (err) { /* stockage indisponible : valeur par défaut */ }
    f('aimant').addEventListener('change', () => { try { localStorage.setItem('amgt4cem.lieux.aimant', f('aimant').value); } catch (err) { /* ignoré */ } });
    this._hauteurListe();
    p.addEventListener('click', (e) => {
      const m = e.target.closest('[data-m]');
      if (m) return this._mode(m.dataset.m);
      const a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'fermer') this.close();
      else if (a.dataset.a === 'reduire') this._reduire();
      else if (a.dataset.a === 'rect') this._arm();
      else if (a.dataset.a === 't-annuler') this._traceAnnuler();
      else if (a.dataset.a === 't-main') { this._viseurOn = !this._viseurOn; a.classList.toggle('amgt-lieux-actif', !this._viseurOn); this._syncDrag(); this._etat(this._viseurOn ? 'Viseur actif.' : 'Carte déplaçable au doigt : ✋ à nouveau pour reprendre le tracé.'); }
      else if (a.dataset.a === 't-fermer') this._traceFermer();
      else if (a.dataset.a === 't-valider') this._traceValider();
      else if (a.dataset.a === 't-abandon') this._traceAbandon();
      else if (a.dataset.a === 'enreg') this._enregistrer();
      else if (a.dataset.a === 'suppr') this._supprimer();
    });
    L.DomEvent.disableClickPropagation(p);
    L.DomEvent.disableScrollPropagation(p);
    this._renderListe();
    this._mode('objet');
  },

  /** Bandeau : ne garde que les modes, la barre du tracé et le message ; le reste du panneau est masqué. */
  _reduire() {
    const r = this._panel.classList.toggle('amgt-lieux-reduit');
    this._panel.querySelector('[data-a="reduire"]').textContent = r ? '▴' : '▾';
  },

  /** Hauteur de la liste : curseur vertical sur le côté (0 = liste repliée). */
  _hauteurListe() {
    const v = Number(this._f('haut').value);
    const l = this._f('liste');
    l.style.maxHeight = `${Math.round(v * 0.5)}vh`;
    l.style.display = v === 0 ? 'none' : '';
  },

  /** Mode de la carte : 'objet' (toucher un objet visible) ou 'trace' (chaîne d'arpenteur). */
  _mode(m) {
    if (this._modeActif === 'trace' && m !== 'trace') { this._traceAbandon(); this._viseurStop(); }
    this._modeActif = m;
    if (m === 'trace') this._viseurStart();
    this._syncDrag();
    for (const b of this._panel.querySelectorAll('[data-m]')) b.classList.toggle('amgt-lieux-actif', b.dataset.m === m);
    this._f('tracebarre').classList.toggle('amgt-hidden', m !== 'trace');
    if (m === 'trace') this._etat("Poser le doigt : le viseur apparaît au-dessus ; le déplacer, relâcher pour poser le sommet. Presser un sommet pour le déplacer ; toucher le premier sommet ou « Fermer » pour fermer. ✋ = déplacer la carte.");
    else if (m === 'objet') this._etat('Toucher un objet UrbIS visible pour l\'ajouter ; le toucher à nouveau pour le retirer.');
    this._traceInfo();
    if (m === 'trace') this._chargerAimant();
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
      pl.on('click', (e) => {
        if (this._modeActif === 'trace' || this._armed || Date.now() - (this._rectAt || 0) < 400) return; // le clic poursuit vers la carte (sommet du tracé)
        L.DomEvent.stopPropagation(e);
        this._set(c, !c.sel);
      });
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
        this._rectAt = Date.now();
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
    this._syncDrag();
  },

  /** Le glisser de la carte est coupé pendant le tracé au viseur (✋ le rend) : un doigt pose / déplace, deux doigts zooment. */
  _syncDrag() {
    const m = this._map;
    if (!m || this._armed) return;
    const viseur = this._active && this._modeActif === 'trace' && this._viseurOn;
    if (viseur) { m.dragging.disable(); m.doubleClickZoom.disable(); } else { m.dragging.enable(); m.doubleClickZoom.enable(); }
    // Sans glisser Leaflet, le navigateur reprendrait le geste (défilement) et l'annulerait au bout de quelques pixels
    // (pointercancel) : le viseur disparaîtrait. touch-action: none le garde ; le zoom à deux doigts reste géré par Leaflet.
    m.getContainer().style.touchAction = viseur ? 'none' : '';
  },

  /**
   * Interroge UrbIS Topo (types actuellement affichés seulement) dans une emprise Lambert.
   * @returns {Promise<{objets: object[]|null, notes: string[]}>} objets null si aucun type linéaire n'est affiché
   */
  async _wfs(x0, y0, x1, y1) {
    const { wfsUrl, version, typeAttribute } = AMGT4CEM_CONFIG.urbisTopo;
    const selection = AMGT4CEM_UrbisTopoSelectionStore.getSelection();
    const cat = {};
    for (const e of AMGT4CEM_URBISTOPO_CATALOG) cat[e.code] = e;
    const parCouche = { TopoLines: [], TopoShapes: [] };
    for (const code of Object.keys(selection)) {
      const g = cat[code] && cat[code].geometry;
      if (g === 'ligne') parCouche.TopoLines.push(code);
      else if (g === 'polygone') parCouche.TopoShapes.push(code);
    }
    if (!parCouche.TopoLines.length && !parCouche.TopoShapes.length) return { objets: null, notes: [] };
    const notes = [];
    const objets = [];
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
          objets.push({ id: (f.properties || {}).ID, couche: ft, code, type: `${(cat[code] && cat[code].label) || (f.properties || {}).DESCRFRE || code} (${code})`, lignes });
        }
      } catch (err) {
        notes.push(`${ft} : erreur ${err.message}`);
      }
    }
    return { objets, notes };
  },

  async _chercher(bounds) {
    const sw = AMGT4CEM_CRS.latLngToLambert(bounds.getSouthWest());
    const ne = AMGT4CEM_CRS.latLngToLambert(bounds.getNorthEast());
    const [x0, x1] = [Math.min(sw.x, ne.x), Math.max(sw.x, ne.x)];
    const [y0, y1] = [Math.min(sw.y, ne.y), Math.max(sw.y, ne.y)];
    if (this._rectLayer) { this._map.removeLayer(this._rectLayer); this._rectLayer = null; }
    if (x1 - x0 < 1 || y1 - y0 < 1) return this._etat('Rectangle trop petit.', true);
    this._etat('Recherche des objets UrbIS…');
    const { objets, notes } = await this._wfs(x0, y0, x1, y1);
    if (!objets) return this._etat("Aucun type linéaire UrbIS Topo n'est affiché : les sélectionner d'abord (☰ Carte > UrbIS Topo).", true);
    for (const o of objets) {
      const dedans = o.lignes.every((l) => l.every((q) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1));
      this._addCand(o, dedans);
    }
    this._renderListe();
    this._etat(`Objets trouvés (types affichés) — ${notes.join(' ; ')}. Cochés : ceux qui sont entièrement dans le rectangle.`);
  },

  /** Distance (m) d'un point à une ligne brisée, en Lambert. */
  _distLigne(p, l) {
    let dmin = Infinity;
    for (let i = 0; i < l.length - 1; i++) {
      const [ax, ay] = l[i]; const [bx, by] = l[i + 1];
      const dx = bx - ax; const dy = by - ay;
      const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy))) : 0;
      dmin = Math.min(dmin, Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy)));
    }
    return dmin;
  },

  /** Mode « Objet » : l'objet UrbIS visible le plus proche du point touché (dans ~16 px) est ajouté / retiré. */
  async _pick(latlng) {
    const pt = this._map.latLngToContainerPoint(latlng);
    const a = AMGT4CEM_CRS.latLngToLambert(latlng);
    const b = AMGT4CEM_CRS.latLngToLambert(this._map.containerPointToLatLng(L.point(pt.x + 16, pt.y)));
    const tol = Math.max(0.3, Math.hypot(b.x - a.x, b.y - a.y));
    // Objet déjà dans la liste : on le bascule sans interroger UrbIS.
    let proche = null; let dmin = tol;
    for (const c of this._cands.values()) for (const l of c.lignes) { const d = this._distLigne(a, l); if (d < dmin) { dmin = d; proche = c; } }
    if (proche) { this._set(proche, !proche.sel); return; }
    this._etat('Recherche de l\'objet touché…');
    const { objets, notes } = await this._wfs(a.x - tol, a.y - tol, a.x + tol, a.y + tol);
    if (!objets) return this._etat("Aucun type linéaire UrbIS Topo n'est affiché : les sélectionner d'abord (☰ Carte > UrbIS Topo).", true);
    let meilleur = null; dmin = Infinity;
    for (const o of objets) for (const l of o.lignes) { const d = this._distLigne(a, l); if (d < dmin) { dmin = d; meilleur = o; } }
    if (!meilleur || dmin > tol) return this._etat(`Aucun objet affiché à cet endroit (${notes.join(' ; ')}).`, true);
    this._addCand(meilleur, true);
    this._renderListe();
    this._etat(`Ajouté : ${meilleur.type} #${meilleur.id}.`);
  },

  _surClic(e) {
    if (this._armed || Date.now() - (this._rectAt || 0) < 400) return;
    if (this._modeActif === 'objet') this._pick(e.latlng);
  },

  // --------------------------------------------- chaîne d'arpenteur (tracé)
  _fmtM(m) { return `${m.toFixed(2).replace('.', ',')} m`; },

  /** Accroche au sommet le plus proche (objets de la liste, sommets du tracé) dans 12 px, sinon le point lui-même. */
  _accroche(latlng, sauf) {
    const pt = this._map.latLngToContainerPoint(latlng);
    let best = null; let dmin = 12;
    const test = (q) => { const d = pt.distanceTo(this._map.latLngToContainerPoint(q)); if (d < dmin) { dmin = d; best = q; } };
    for (const c of this._cands.values()) for (const l of c.lignes) for (const q of l) test(AMGT4CEM_CRS.lambertToLatLng(q));
    if (this._trace) this._trace.pts.forEach((q, i) => { if (i !== sauf) test(q); });
    return best || latlng;
  },

  _traceLam() { return this._trace.pts.map((q) => { const l = AMGT4CEM_CRS.latLngToLambert(q); return [Math.round(l.x * 100) / 100, Math.round(l.y * 100) / 100]; }); },

  _traceDessin() {
    this._traceLignes();
    this._traceSommets();
  },

  /** Lignes et cotes (redessinées en direct pendant qu'on glisse un sommet). */
  _traceLignes() {
    const t = this._trace;
    t.group.clearLayers();
    if (!t.pts.length) return this._traceInfo();
    const opt = { pane: 'amgtLieuxPane', color: '#0b5c75', weight: 3, interactive: false };
    t.group.addLayer(t.ferme ? L.polygon(t.pts, { ...opt, fillColor: '#0b5c75', fillOpacity: 0.15 }) : L.polyline(t.pts, opt));
    const lam = this._traceLam();
    const n = lam.length;
    for (let i = 0; i < (t.ferme ? n : n - 1); i++) {
      const a = lam[i]; const b = lam[(i + 1) % n];
      const mid = L.latLng((t.pts[i].lat + t.pts[(i + 1) % n].lat) / 2, (t.pts[i].lng + t.pts[(i + 1) % n].lng) / 2);
      t.group.addLayer(L.marker(mid, { pane: 'amgtLieuxPane', interactive: false, icon: L.divIcon({ className: 'amgt-lieux-cote', html: this._fmtM(Math.hypot(b[0] - a[0], b[1] - a[1])), iconSize: null }) }));
    }
    this._traceInfo();
  },

  _traceSommets() {
    const t = this._trace;
    t.sommets.clearLayers();
    // Le sommet tenu sous le viseur n'est pas dessiné : le réticule reste transparent, on voit la carte à travers.
    t.pts.forEach((q, k) => { if (this._g && this._g.i === k) return; t.sommets.addLayer(L.marker(q, { pane: 'amgtLieuxPane', interactive: false, icon: L.divIcon({ className: 'amgt-lieux-sommet', iconSize: [18, 18] }) })); });
  },

  // ------------------------------------------------------------ viseur
  // Au doigt, le sommet est posé sous un VISEUR décalé de DECALAGE_PX au-dessus du point de contact (le doigt ne cache
  // plus ce qu'on fait) ; il suit le doigt, l'aimant s'applique à lui, le relâcher pose (ou dépose) le sommet.
  // Une presse près d'un sommet existant (24 px) le saisit ; un simple toucher du premier sommet ferme le polygone.
  SVG_VISEUR: '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke-linecap="round" aria-hidden="true"><g stroke="#fff" stroke-width="4.4"><circle cx="24" cy="24" r="11" /><path d="M24 4v12M24 32v12M4 24h12M32 24h12" /></g><g stroke="#0b5c75" stroke-width="1.6"><circle cx="24" cy="24" r="11" /><path d="M24 4v12M24 32v12M4 24h12M32 24h12" /></g><circle cx="24" cy="24" r="1.6" fill="#e65100" /></svg>',

  _viseurStart() {
    if (this._vh) return;
    const el = this._map.getContainer();
    this._vh = { down: (e) => this._vDown(e), move: (e) => this._vMove(e), up: (e) => this._vUp(e), cancel: (e) => this._vCancel(e) };
    el.addEventListener('pointerdown', this._vh.down);
    el.addEventListener('pointermove', this._vh.move);
    el.addEventListener('pointerup', this._vh.up);
    el.addEventListener('pointercancel', this._vh.cancel);
  },

  _viseurStop() {
    if (!this._vh) return;
    const el = this._map.getContainer();
    el.removeEventListener('pointerdown', this._vh.down);
    el.removeEventListener('pointermove', this._vh.move);
    el.removeEventListener('pointerup', this._vh.up);
    el.removeEventListener('pointercancel', this._vh.cancel);
    this._vh = null;
    this._viseurAnnule();
  },

  _vPos(e, g) {
    const pt = this._map.mouseEventToContainerPoint(e);
    const dec = e.pointerType === 'mouse' ? 0 : this.DECALAGE_PX;
    return this._map.containerPointToLatLng(L.point(pt.x, pt.y - dec));
  },

  _vDown(e) {
    if (!this._viseurOn || this._armed || this._modeActif !== 'trace') return;
    if (e.button > 0 || (e.target.closest && e.target.closest('button, a, .leaflet-control'))) return;
    this._ptrs = this._ptrs || new Set();
    this._ptrs.add(e.pointerId);
    if (this._ptrs.size > 1) return this._viseurAnnule(); // deux doigts : zoom de la carte, pas de tracé
    const pt = this._map.mouseEventToContainerPoint(e);
    let t = this._trace;
    let i = -1;
    if (t) {
      let dmin = 24;
      t.pts.forEach((q, k) => { const d = pt.distanceTo(this._map.latLngToContainerPoint(q)); if (d <= dmin) { dmin = d; i = k; } });
    }
    if (i < 0 && t && t.ferme) return this._etat('Polygone fermé : ↶ Retour pour le rouvrir, ✓ pour l\'ajouter.');
    if (!t) t = this._trace = { pts: [], ferme: false, hist: [], group: L.layerGroup().addTo(this._map), sommets: L.layerGroup().addTo(this._map) };
    this._traceMemo();
    const g = { id: e.pointerId, nouveau: i < 0, i, depart: pt, bouge: false };
    if (g.nouveau) { t.pts.push(this._vPos(e)); g.i = t.pts.length - 1; }
    g.viseur = L.marker(g.nouveau ? t.pts[g.i] : this._vPos(e), { pane: 'amgtLieuxPane', interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: 'amgt-lieux-viseur', html: this.SVG_VISEUR, iconSize: [48, 48], iconAnchor: [24, 24] }) }).addTo(this._map);
    this._g = g;
    this._aimantDebut(g.i);
    this._aimantDrag(g.viseur, g.i); // initialise l'aimant (délai d'1 s même sans bouger) et place le sommet sous le viseur
    this._traceSommets();
    try { this._map.getContainer().setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
    e.preventDefault();
  },

  _vMove(e) {
    const g = this._g;
    if (!g || e.pointerId !== g.id || !this._trace) return;
    if (!g.bouge && this._map.mouseEventToContainerPoint(e).distanceTo(g.depart) > 6) g.bouge = true;
    g.viseur.setLatLng(this._vPos(e));
    this._aimantDrag(g.viseur, g.i); // met le sommet à la position du viseur (ou de l'aimant) et redessine lignes et cotes
    this._traceSommets();
    e.preventDefault();
  },

  _vUp(e) {
    if (this._ptrs) this._ptrs.delete(e.pointerId);
    const g = this._g;
    if (!g || e.pointerId !== g.id) return;
    const t = this._trace;
    this._g = null;
    this._map.removeLayer(g.viseur);
    if (!t) return;
    if (!g.nouveau && !g.bouge) {
      // Simple toucher d'un sommet existant : le sommet revient où il était ; le premier ferme le polygone.
      const h = t.hist.pop();
      t.pts = h.pts;
      this._aimantFin();
      if (g.i === 0 && t.pts.length >= 3 && !t.ferme) this._traceFermer(); else this._traceDessin();
      return;
    }
    const P = this._am && this._am.accroche;
    t.pts[g.i] = L.latLng(P || this._accroche(g.viseur.getLatLng(), g.i));
    this._aimantFin();
    this._traceDessin();
  },

  _vCancel(e) {
    if (this._ptrs) this._ptrs.delete(e.pointerId);
    if (this._g && e.pointerId === this._g.id) this._viseurAnnule();
  },

  /** Abandonne le geste en cours (deux doigts, annulation système, fin du mode) et restaure l'état d'avant. */
  _viseurAnnule() {
    const g = this._g;
    this._g = null;
    this._ptrs = new Set();
    if (!g) return;
    if (g.viseur) this._map.removeLayer(g.viseur);
    const t = this._trace;
    if (t && t.hist && t.hist.length) { const h = t.hist.pop(); t.pts = h.pts; t.ferme = h.ferme; }
    this._aimantFin();
    if (t) this._traceDessin();
  },

  // ------------------------------------------------------------ aimant
  // En glissant un sommet : si le doigt reste 1 s à moins de X m d'un point remarquable (sommet d'un objet UrbIS
  // visible, d'un objet de la liste ou du tracé), le sommet est attiré dessus ; il est libéré dès que le doigt
  // s'en éloigne de plus de 2 X. X est réglable (🧲, 0 = sans aimant), mémorisé sur l'appareil.
  AIMANT_DELAI_MS: 1000,
  // Aimant en fer à cheval (23 px, trait fin, #0b5c75 comme les autres icônes).
  SVG_AIMANT: '<svg viewBox="0 0 48 48" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 6v18a11 11 0 0 0 22 0V6" /><path d="M9 6h8v9H9zM31 6h8v9h-8z" /><line x1="9" y1="11" x2="17" y2="11" /><line x1="31" y1="11" x2="39" y2="11" /></svg>',

  _aimantRayon() {
    const v = Number(this._f('aimant').value);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  },

  /** Objets UrbIS visibles autour de la vue, chargés une fois par vue : leurs sommets servent à l'aimant. */
  async _chargerAimant() {
    if (!this._active || this._modeActif !== 'trace') return;
    const bnds = this._map.getBounds().pad(0.2);
    const sw = AMGT4CEM_CRS.latLngToLambert(bnds.getSouthWest());
    const ne = AMGT4CEM_CRS.latLngToLambert(bnds.getNorthEast());
    if (Math.abs(ne.x - sw.x) > 600) { this._aimantPts = []; return; } // trop dézoomé : pas d'aimant sur UrbIS
    const jeton = (this._aimantJeton = (this._aimantJeton || 0) + 1);
    const { objets } = await this._wfs(Math.min(sw.x, ne.x), Math.min(sw.y, ne.y), Math.max(sw.x, ne.x), Math.max(sw.y, ne.y));
    if (jeton !== this._aimantJeton || !objets) return;
    this._aimantPts = objets.flatMap((o) => o.lignes.flat());
  },

  _aimantVue() {
    clearTimeout(this._aimantTimer);
    this._aimantTimer = setTimeout(() => this._chargerAimant(), 400);
  },

  _pointsRemarquables(sauf) {
    const pts = [...(this._aimantPts || [])];
    for (const c of this._cands.values()) for (const l of c.lignes) pts.push(...l);
    if (this._trace) this._traceLam().forEach((q, i) => { if (i !== sauf) pts.push(q); });
    return pts;
  },

  _aimantDebut(i) {
    this._am = { i, pts: this._pointsRemarquables(i), cible: null, timer: null, accroche: null, ring: null, doigt: null };
  },

  _aimantDrag(mk, i) {
    const am = this._am;
    const t = this._trace;
    if (!am || !t) return;
    const X = this._aimantRayon();
    const l = AMGT4CEM_CRS.latLngToLambert(mk.getLatLng());
    am.doigt = [l.x, l.y];
    if (am.accroche) {
      // Attiré : on reste sur la cible tant que le doigt ne s'en éloigne pas de plus de 2 X.
      if (Math.hypot(am.doigt[0] - am.cible[0], am.doigt[1] - am.cible[1]) <= 2 * X) {
        mk.setLatLng(am.accroche);
        t.pts[i] = am.accroche;
        this._traceLignes();
        return;
      }
      this._aimantLiberer();
    }
    const c = X > 0 ? this._plusProche(am.doigt, am.pts, X) : null;
    if (!c) { this._aimantReset(); } else if (!am.cible || am.cible[0] !== c[0] || am.cible[1] !== c[1]) {
      this._aimantReset();
      am.cible = c;
      const ll = AMGT4CEM_CRS.lambertToLatLng(c);
      am.ring = L.circleMarker(ll, { pane: 'amgtLieuxPane', radius: 15, color: '#e65100', weight: 2, fill: false, dashArray: '4 3', interactive: false }).addTo(this._map);
      // Petit aimant dessiné sur le point visé : pâle pendant l'attente, plein une fois attiré.
      am.icone = L.marker(ll, { pane: 'amgtLieuxPane', interactive: false, keyboard: false, icon: L.divIcon({ className: 'amgt-lieux-aimant-ic', html: this.SVG_AIMANT, iconSize: [23, 23], iconAnchor: [11.5, 28] }) }).addTo(this._map);
      am.timer = setTimeout(() => this._aimantAttirer(mk, i), this.AIMANT_DELAI_MS);
    }
    t.pts[i] = mk.getLatLng();
    this._traceLignes();
  },

  _plusProche(p, pts, X) {
    let best = null; let dmin = X;
    for (const q of pts) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d <= dmin) { dmin = d; best = q; } }
    return best;
  },

  /** Fin du délai : si le doigt est toujours près de la même cible, le sommet s'y accroche. */
  _aimantAttirer(mk, i) {
    const am = this._am;
    if (!am || !am.cible || am.accroche || !this._trace) return;
    const X = this._aimantRayon();
    if (Math.hypot(am.doigt[0] - am.cible[0], am.doigt[1] - am.cible[1]) > X) return this._aimantReset();
    am.accroche = AMGT4CEM_CRS.lambertToLatLng(am.cible);
    mk.setLatLng(am.accroche);
    this._trace.pts[i] = am.accroche;
    if (am.ring) am.ring.setStyle({ dashArray: null, weight: 3 }); // trait plein, toujours sans remplissage
    if (am.icone && am.icone.getElement()) am.icone.getElement().classList.add('amgt-lieux-aimant-ic--on');
    this._traceLignes();
  },

  _aimantReset() {
    const am = this._am;
    if (!am) return;
    clearTimeout(am.timer);
    am.timer = null;
    am.cible = null;
    if (am.ring) { this._map.removeLayer(am.ring); am.ring = null; }
    if (am.icone) { this._map.removeLayer(am.icone); am.icone = null; }
  },

  _aimantLiberer() {
    if (this._am) this._am.accroche = null;
    this._aimantReset();
  },

  _aimantFin() {
    if (!this._am) return;
    this._aimantReset();
    this._am = null;
  },

  _traceInfo() {
    const el = this._panel && this._f('chaine');
    if (!el) return;
    const t = this._trace;
    if (!t || !t.pts.length) { el.textContent = ''; return; }
    const lam = this._traceLam();
    let total = 0;
    for (let i = 0; i < lam.length - 1; i++) total += Math.hypot(lam[i + 1][0] - lam[i][0], lam[i + 1][1] - lam[i][1]);
    if (t.ferme) {
      const a = lam.length;
      total += Math.hypot(lam[0][0] - lam[a - 1][0], lam[0][1] - lam[a - 1][1]);
      const aire = Math.abs(lam.reduce((s, q, i) => { const n = lam[(i + 1) % a]; return s + q[0] * n[1] - n[0] * q[1]; }, 0) / 2);
      el.textContent = `${a} sommets · périmètre ${this._fmtM(total)} · ${aire.toFixed(1).replace('.', ',')} m²`;
    } else el.textContent = `${lam.length} sommet(s) · ${this._fmtM(total)}`;
  },

  /** Mémorise l'état du tracé avant une modification (bouton ↶ : revenir d'un pas en arrière). */
  _traceMemo() {
    const t = this._trace;
    if (!t) return;
    (t.hist = t.hist || []).push({ pts: t.pts.map((q) => L.latLng(q.lat, q.lng)), ferme: t.ferme });
  },

  _traceAnnuler() {
    const t = this._trace;
    if (!t || !t.hist || !t.hist.length) return this._etat('Rien à annuler.', true);
    const h = t.hist.pop();
    t.pts = h.pts;
    t.ferme = h.ferme;
    this._traceDessin();
  },

  _traceFermer() {
    const t = this._trace;
    if (!t || t.pts.length < 3) return this._etat('Un polygone demande au moins 3 sommets.', true);
    if (t.ferme) return;
    this._traceMemo();
    t.ferme = true;
    this._traceDessin();
  },

  _traceAbandon() {
    if (!this._trace) return;
    this._viseurAnnule();
    this._aimantFin();
    this._map.removeLayer(this._trace.group);
    this._map.removeLayer(this._trace.sommets);
    this._trace = null;
    if (this._panel) this._traceInfo();
  },

  _traceValider() {
    const t = this._trace;
    if (!t || t.pts.length < 2) return this._etat('Poser au moins 2 sommets.', true);
    const lam = this._traceLam();
    if (t.ferme) lam.push(lam[0]);
    this._traceAbandon();
    this._addCand({ id: `T${Date.now().toString(36)}`, couche: 'Trace', code: 'TRACE', type: t.ferme ? 'Tracé fermé (polygone)' : 'Tracé (ligne)', lignes: [lam] }, true);
    this._renderListe();
    this._etat(t.ferme ? 'Polygone ajouté à la liste.' : 'Ligne ajoutée à la liste.');
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
    const marge = Math.max(0, Number(this._f('marge').value) || 0);
    if (mode === 'union') {
      // Seuls les polygones (lignes fermées) sont fusionnés ; les lignes ouvertes sont ignorées.
      const fermees = lignes.filter((l) => l.length >= 4 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1]);
      this._ouvertes = lignes.length - fermees.length;
      return fermees.length ? this._enveloppeSerree(fermees, Math.max(0.05, marge), true) : [];
    }
    return this._enveloppeSerree(lignes, marge, false);
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
  _enveloppeSerree(lignes, marge, fin) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const l of lignes) for (const q of l) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    const c = fin ? Math.max(0.05, (Math.max(x1 - x0, y1 - y0) + 2 * marge) / 1200) : Math.max(0.25, (Math.max(x1 - x0, y1 - y0) + 2 * marge) / 700); // taille de cellule (m)
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
      const eps = fin ? 1.5 : Math.max(2.5, (0.25 * marge) / c); // tolérance de simplification, en cellules de grille
      const h1 = dp(rg.slice(0, mid + 1), eps); const h2 = dp(rg.slice(mid).concat([rg[0]]), eps);
      const simple = h1.slice(0, -1).concat(h2); // se ferme sur le premier point
      const out = simple.map((q) => [Math.round((ox + q[0] * c) * 100) / 100, Math.round((oy + q[1] * c) * 100) / 100]);
      if (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1]) out.push(out[0]); // anneau fermé
      return out;
    });
  },

  _apercu() {
    if (!this._panel) return;
    if (this._apercuLayer) { this._map.removeLayer(this._apercuLayer); this._apercuLayer = null; }
    this._ouvertes = 0;
    const anneaux = this._contour();
    if (this._f('contour').value === 'union') {
      if (!anneaux.length) this._etat('Union : aucun polygone (ligne fermée) coché.', true);
      else if (this._ouvertes) this._etat(`Union : ${anneaux.length} polygone(s) obtenu(s) ; ${this._ouvertes} ligne(s) ouverte(s) ignorée(s).`);
      else this._etat(`Union : ${anneaux.length} polygone(s) obtenu(s).`);
    }
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
