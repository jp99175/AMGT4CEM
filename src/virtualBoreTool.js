/**
 * Outil « Sondage virtuel » (icône sous la règle) : on pose un réticule sur la carte, comme pour l'outil de mesure
 * (presser, glisser, relâcher ; au doigt, le point est décalé vers le haut pour que le doigt ne le cache pas), et un
 * écran affiche ce que les données régionales disent du sous-sol À CET ENDROIT :
 *
 *  - IMPLANTATION : coordonnées Lambert 72 du réticule, station ou tunnel dont l'emprise le contient ;
 *  - NAPPE PHRÉATIQUE : niveau (m DNG) et profondeur sous le sol (m), déduits des isopièzes et isobathes du modèle
 *    (équidistance 2 m, état de mai 2013) par interpolation entre les deux lignes voisines ; cote du sol qui en découle ;
 *    stations de mesure piézométriques les plus proches (leurs niveaux mesurés ne sont pas dans le WFS : BruWater) ;
 *  - COUPE GÉOLOGIQUE : lien vers BrugeoTool (coupe officielle) au point du réticule (`sondage.brugeotool`),
 *    attributs affichés tels que le service les renvoie. Ces noms de couches ne sont pas confirmés par un appel réel :
 *    une couche absente ou vide est signalée comme telle, jamais complétée par une valeur supposée.
 *
 * Les valeurs de la nappe sont INDICATIVES (modèle BPSM v1.0, mai 2013) : l'écran et le fichier enregistré le disent.
 * Boutons de l'écran : ✕ ferme (et retire le réticule), 💾 enregistre un fichier HTML autonome (à ouvrir ou imprimer).
 *
 * Les requêtes réutilisent celles de la couche Nappe (AMGT4CEM_NappeLayer._fetchFeatures) : mêmes services, mêmes
 * noms de couches retrouvés dans le GetCapabilities. Toutes les distances sont calculées en Lambert 72 (mètres).
 */
const AMGT4CEM_VirtualBoreTool = {
  _map: null,
  _active: false,
  _pointerId: null,
  _dragging: false,
  _marker: null,
  _latlng: null,
  _panel: null,
  _result: null, // dernier résultat composé (sections), repris par l'enregistrement
  _runToken: 0,
  // Décalage (px écran) au-dessus du point de contact tactile (comme AMGT4CEM_MeasureTool).
  _touchOffsetPx: 60,

  init(map) {
    this._map = map;
    this._onPopupOpen = (e) => e.popup.close();
    const container = map.getContainer();
    container.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e, false));
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e, true));
  },

  isActive() {
    return this._active;
  },

  toggle() {
    if (this._active) this.deactivate();
    else this.activate();
  },

  activate() {
    if (this._active) return;
    this._active = true;
    AMGT4CEM_ScreenshotTool.invalidateBackground();
    this._map.dragging.disable();
    if (this._map.tap) this._map.tap.disable();
    if (this._map.touchZoom) this._map.touchZoom.disable();
    const container = this._map.getContainer();
    container.classList.add('amgt-placing-mode');
    container.style.touchAction = 'none'; // geste entièrement géré ici (voir AMGT4CEM_MeasureTool.activate)
    document.getElementById('amgt-bore-btn').classList.add('amgt-btn--active');
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
    document.getElementById('amgt-bore-btn').classList.remove('amgt-btn--active');
    this._map.off('popupopen', this._onPopupOpen);
    this._pointerId = null;
    this._dragging = false;
    this.close();
    AMGT4CEM_ScreenshotTool.invalidateBackground();
  },

  // --- Geste de placement --------------------------------------------------------------------------------------

  _onPointerDown(e) {
    if (!this._active || this._pointerId !== null) return;
    if (e.target.closest && e.target.closest('.amgt-bore-panel')) return; // l'écran de résultat reste utilisable
    this._pointerId = e.pointerId;
    const container = this._map.getContainer();
    if (container.setPointerCapture) {
      try { container.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    e.preventDefault();
    this._removeMarker();
    this._dragging = true;
    this._latlng = this._eventToLatLng(e);
    this._marker = this._buildMarker(this._latlng);
  },

  _onPointerMove(e) {
    if (e.pointerId !== this._pointerId || !this._dragging) return;
    e.preventDefault();
    this._latlng = this._eventToLatLng(e);
    this._marker.setLatLng(this._latlng);
  },

  /** @param {boolean} annule - pointercancel : on garde la dernière position reçue (coordonnées d'annulation peu fiables). */
  _onPointerUp(e, annule) {
    if (e.pointerId !== this._pointerId) return;
    this._pointerId = null;
    if (!this._dragging) return;
    this._dragging = false;
    if (!annule) {
      this._latlng = this._eventToLatLng(e);
      this._marker.setLatLng(this._latlng);
    }
    this._run(this._latlng);
  },

  _eventToLatLng(e) {
    let point = this._map.mouseEventToContainerPoint(e);
    if (e.pointerType === 'touch') point = point.subtract([0, this._touchOffsetPx]);
    return this._map.containerPointToLatLng(point);
  },

  _buildMarker(latlng) {
    return L.marker(latlng, {
      icon: L.divIcon({ className: 'amgt-measure-dot-icon', iconSize: [0, 0], pane: 'amgtMeasurePane', html: AMGT4CEM_MeasureTool._buildReticleSvg() }),
      interactive: false,
      pane: 'amgtMeasurePane',
    }).addTo(this._map);
  },

  _removeMarker() {
    if (this._marker) { this._map.removeLayer(this._marker); this._marker = null; }
  },

  // --- Sondage -------------------------------------------------------------------------------------------------

  /** Ouvre l'écran, interroge les services (chacun isolé : un échec ne bloque pas les autres) et compose le résultat. */
  async _run(latlng) {
    const token = ++this._runToken;
    const { x, y } = AMGT4CEM_CRS.latLngToLambert(latlng);
    this._result = null;
    this._openPanel();
    this._renderPanel({ loading: true, x, y });

    const cfg = AMGT4CEM_CONFIG.nappe;
    if (!cfg || !cfg.sondage) {
      this._renderPanel({ error: 'Sondage virtuel non configuré (config/nappe/parametres.json).', x, y });
      return;
    }
    const s = cfg.sondage;
    const box = (r) => [x - r, y - r, x + r, y + r];
    // Jeu complet (copie R2 / cache) s'il existe, sinon requête directe au service.
    const fetchPart = (key, part, radius) => AMGT4CEM_NappeLayer._getFeatures(key, part, box(radius), cfg).then(
      (r) => ({ list: r.list, truncated: r.truncated }),
      (err) => ({ error: AMGT4CEM_NappeLayer._reason(err), detail: String(err && err.message ? err.message : err) })
    );

    const [niveau, profondeur, stations] = await Promise.all([
      fetchPart('isopieses', cfg.isopieses, s.rayonLignesM),
      fetchPart('profondeur', cfg.profondeur, s.rayonLignesM),
      fetchPart('stations', cfg.stations, s.rayonStationsM),
    ]);
    if (token !== this._runToken) return; // un nouveau sondage ou la fermeture est passé entre-temps

    const raw = { x, y, latlng, niveau, profondeur, stations };
    this._result = this._compose(raw, cfg);
    this._renderPanel(this._result);
  },

  /** Données brutes -> écran/fichier : { x, y, date, sections: [{ title, rows: [[libellé, valeur]], notes: [texte] }] }. */
  _compose(raw, cfg) {
    const s = cfg.sondage;
    const fmt = (v, d = 2) => Number(v).toLocaleString('fr-BE', { minimumFractionDigits: d, maximumFractionDigits: d });
    const sections = [];

    // 1. Implantation
    const structure = this._structureAt(raw.latlng);
    sections.push({
      title: 'Implantation du sondage',
      rows: [
        ['X (Lambert 72)', fmt(raw.x)],
        ['Y (Lambert 72)', fmt(raw.y)],
        ['Emprise', structure ? `${structure.kind === 'tunnel' ? 'Tunnel' : 'Station'} ${structure.label}` : 'Hors des emprises métro de la carte'],
      ],
      notes: [],
    });

    // 2. Nappe phréatique
    const nappe = { title: 'Nappe phréatique (modèle, état de ' + cfg.periodeReference + ')', rows: [], notes: [] };
    const head = raw.niveau.error ? null : this._estimate(raw.niveau.list, cfg.isopieses.attributNiveau, raw.x, raw.y, s.ecartIsopiezesM);
    const depth = raw.profondeur.error ? null : this._estimate(raw.profondeur.list, cfg.profondeur.attributNiveau, raw.x, raw.y, s.ecartIsopiezesM);
    const describe = (e, unite) => {
      if (e.methode === 'interpolé') {
        return `${fmt(e.value, 1)} ${unite} (interpolé entre ${fmt(e.entre[0], 0)} et ${fmt(e.entre[1], 0)}, lignes à ${fmt(e.distances[0], 0)} m et ${fmt(e.distances[1], 0)} m)`;
      }
      return `≈ ${fmt(e.value, 0)} ${unite} (ligne la plus proche, à ${fmt(e.distance, 0)} m)`;
    };
    if (raw.niveau.error) nappe.rows.push(['Niveau de la nappe', `indisponible (${raw.niveau.error})`]);
    else nappe.rows.push(['Niveau de la nappe', head ? describe(head, 'm DNG') : `aucune isopièze à moins de ${s.rayonLignesM} m`]);
    if (raw.profondeur.error) nappe.rows.push(['Profondeur de la nappe', `indisponible (${raw.profondeur.error})`]);
    else nappe.rows.push(['Profondeur de la nappe', depth ? describe(depth, 'm sous le sol') : `aucune isobathe à moins de ${s.rayonLignesM} m`]);
    if (head && depth && head.methode === 'interpolé' && depth.methode === 'interpolé') {
      nappe.rows.push(['Cote du sol (déduite)', `${fmt(head.value + depth.value, 1)} m DNG`]);
    }
    nappe.notes.push(cfg.mentionLegale);
    nappe.notes.push('Niveau actuel : non disponible dans le WFS. Les chroniques des stations automatiques sont dans BruWater (geodata.environnement.brussels/client/bruwater/index).');
    if (raw.niveau.truncated || raw.profondeur.truncated) nappe.notes.push('Résultat tronqué par le service : valeurs à prendre avec prudence.');
    sections.push(nappe);

    // 3. Stations de mesure proches
    const st = { title: 'Stations de mesure piézométriques proches', rows: [], notes: [] };
    if (raw.stations.error) {
      st.rows.push(['Stations', `indisponibles (${raw.stations.error})`]);
    } else {
      const near = raw.stations.list
        .map((f) => ({ f, d: this._distanceToGeometry(f.geometry, raw.x, raw.y) }))
        .filter((o) => Number.isFinite(o.d))
        .sort((a, b) => a.d - b.d)
        .slice(0, s.nbStations);
      if (!near.length) st.rows.push(['Stations', `aucune à moins de ${fmt(s.rayonStationsM, 0)} m`]);
      near.forEach((o, i) => {
        st.rows.push([`Station ${i + 1}`, `à ${fmt(o.d, 0)} m`]);
        for (const [k, v] of this._plainProps(o.f.properties).slice(0, 8)) st.rows.push([`   ${k}`, v]);
      });
    }
    sections.push(st);

    // 4. Coupe géologique officielle : BrugeoTool, ouvert au point du réticule (X/Y Lambert 72, arrondis au mètre)
    const bg = s.brugeotool;
    const geo = { title: 'Coupe géologique', rows: [], notes: [], links: [] };
    if (bg && bg.url) {
      const url = bg.url.replace('{x}', Math.round(raw.x)).replace('{y}', Math.round(raw.y));
      geo.links.push({ label: bg.libelle || 'Coupe géologique officielle (BrugeoTool)', url });
      geo.notes.push('Coupe fournie par Bruxelles Environnement (BrugeoTool) pour ces coordonnées ; elle s\'ouvre dans un nouvel onglet.');
    } else {
      geo.notes.push('Coupe géologique non configurée (sondage.brugeotool dans config/nappe/parametres.json).');
    }
    sections.push(geo);

    return { x: raw.x, y: raw.y, date: new Date(), sections };
  },

  /** Attributs simples (texte, nombre) d'un objet, sans identifiant technique ni géométrie. */
  _plainProps(props) {
    return Object.entries(props || {})
      .filter(([k, v]) => k !== 'gid' && k !== 'geom' && v !== null && v !== '' && typeof v !== 'object')
      .map(([k, v]) => [k, String(v)]);
  },

  /** Station/tunnel dont l'emprise (rectangle englobant, la plus petite) contient le point. */
  _structureAt(latlng) {
    const index = (typeof AMGT4CEM_SearchTool !== 'undefined' && AMGT4CEM_SearchTool._metroIndex) || [];
    let best = null;
    let bestArea = Infinity;
    for (const entry of index) {
      if (!entry.bounds || !entry.bounds.contains(latlng)) continue;
      const area = (entry.bounds.getNorth() - entry.bounds.getSouth()) * (entry.bounds.getEast() - entry.bounds.getWest());
      if (area < bestArea) { best = entry; bestArea = area; }
    }
    return best;
  },

  // --- Géométrie (Lambert 72, mètres) --------------------------------------------------------------------------

  /** Segments de toute géométrie linéaire GeoJSON : [[x1, y1, x2, y2], ...]. */
  _segments(geometry) {
    const out = [];
    const push = (coords) => { for (let i = 0; i + 1 < coords.length; i++) out.push([coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]]); };
    if (!geometry) return out;
    if (geometry.type === 'LineString') push(geometry.coordinates);
    else if (geometry.type === 'MultiLineString') geometry.coordinates.forEach(push);
    return out;
  },

  /** Point le plus proche de (px, py) sur le segment : { d, qx, qy }. */
  _nearestOnSegment([x1, y1, x2, y2], px, py) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    const qx = x1 + t * dx;
    const qy = y1 + t * dy;
    return { d: Math.hypot(px - qx, py - qy), qx, qy };
  },

  _distanceToGeometry(geometry, px, py) {
    if (!geometry) return NaN;
    if (geometry.type === 'Point') return Math.hypot(px - geometry.coordinates[0], py - geometry.coordinates[1]);
    if (geometry.type === 'MultiPoint') {
      return Math.min(...geometry.coordinates.map((c) => Math.hypot(px - c[0], py - c[1])));
    }
    return NaN;
  },

  /**
   * Valeur de l'attribut de niveau au point (px, py), d'après des lignes de niveau (isopièzes ou isobathes) :
   *  - interpolation linéaire entre les deux lignes voisines de valeurs consécutives, SI le point est bien entre elles
   *    (les deux points les plus proches sont de part et d'autre : produit scalaire négatif) ;
   *  - sinon (bord de zone, ligne unique...) valeur de la ligne la plus proche, signalée comme telle.
   * @returns {{ value:number, methode:string, entre?:number[], distances?:number[], distance?:number }|null}
   */
  _estimate(features, attr, px, py, spacing) {
    const byLevel = new Map(); // niveau -> ligne la plus proche { v, d, qx, qy }
    for (const f of features) {
      const v = Number(f.properties && f.properties[attr]);
      if (!Number.isFinite(v)) continue;
      for (const seg of this._segments(f.geometry)) {
        const n = this._nearestOnSegment(seg, px, py);
        const known = byLevel.get(v);
        if (!known || n.d < known.d) byLevel.set(v, { v, d: n.d, qx: n.qx, qy: n.qy });
      }
    }
    const levels = [...byLevel.values()].sort((a, b) => a.d - b.d);
    if (!levels.length) return null;
    const a = levels[0];
    const b = levels.find((l) => l.v !== a.v);
    if (b && Math.abs(a.v - b.v) <= spacing * 1.01) {
      const between = (a.qx - px) * (b.qx - px) + (a.qy - py) * (b.qy - py) < 0;
      if (between && a.d + b.d > 0) {
        return { value: a.v + ((b.v - a.v) * a.d) / (a.d + b.d), methode: 'interpolé', entre: [a.v, b.v], distances: [a.d, b.d] };
      }
    }
    return { value: a.v, methode: 'ligne la plus proche', distance: a.d };
  },

  // --- Écran de résultat ---------------------------------------------------------------------------------------

  _openPanel() {
    if (this._panel) return;
    const ic = (typeof AMGT4CEM_Couches !== 'undefined' && AMGT4CEM_Couches.ICONES) || {};
    const panel = document.createElement('div');
    panel.className = 'amgt-bore-panel';
    panel.innerHTML =
      '<div class="amgt-bore-panel__head">' +
        '<strong>Sondage virtuel</strong>' +
        '<span class="amgt-bore-panel__actions">' +
          // Mêmes icônes que les écrans plein écran de la nouvelle interface (src/nav/couches.js)
          `<button type="button" class="amgt-bore-panel__btn amgt-ic-btn" data-act="save" title="Enregistrer le sondage (fichier HTML)" aria-label="Enregistrer" disabled>${ic.disquette || '💾'}</button>` +
          `<button type="button" class="amgt-bore-panel__btn amgt-ic-btn" data-act="close" title="Fermer" aria-label="Fermer">${ic.fermer || '✕'}</button>` +
        '</span>' +
      '</div>' +
      '<div class="amgt-bore-panel__body"></div>';
    panel.addEventListener('click', (e) => {
      const act = e.target.closest('button') && e.target.closest('button').dataset.act;
      if (act === 'close') this.close();
      else if (act === 'save') this._save();
    });
    L.DomEvent.disableClickPropagation(panel);
    L.DomEvent.disableScrollPropagation(panel);
    document.body.appendChild(panel);
    this._panel = panel;
  },

  close() {
    this._runToken++; // une réponse tardive ne rouvre rien
    if (this._panel) { this._panel.remove(); this._panel = null; }
    this._removeMarker();
    this._result = null;
  },

  /** Construction DOM sûre (textContent) : les valeurs viennent de services externes. */
  _renderPanel(state) {
    if (!this._panel) return;
    const body = this._panel.querySelector('.amgt-bore-panel__body');
    body.textContent = '';
    this._panel.querySelector('[data-act="save"]').disabled = !state.sections;

    const text = (tag, cls, content) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      el.textContent = content;
      return el;
    };
    if (state.loading) {
      body.appendChild(text('p', 'amgt-bore-note', `Interrogation des services en cours… (X ${Math.round(state.x)}, Y ${Math.round(state.y)})`));
      return;
    }
    if (state.error) {
      body.appendChild(text('p', 'amgt-bore-note', state.error));
      return;
    }
    for (const section of state.sections) {
      body.appendChild(text('h4', '', section.title));
      const table = document.createElement('table');
      for (const [label, value] of section.rows) {
        const tr = document.createElement('tr');
        const th = text('th', '', label.trim());
        if (label.startsWith('   ')) th.className = 'amgt-bore-sub';
        tr.append(th, text('td', '', value));
        table.appendChild(tr);
      }
      if (section.rows.length) body.appendChild(table);
      for (const l of section.links || []) {
        const p = document.createElement('p');
        const a = document.createElement('a');
        a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = l.label;
        p.appendChild(a); body.appendChild(p);
      }
      for (const note of section.notes) body.appendChild(text('p', 'amgt-bore-note', note));
    }
  },

  // --- Enregistrement (disquette) ------------------------------------------------------------------------------

  /** Fichier HTML autonome (sans script ni ressource externe), prêt à ouvrir ou imprimer. */
  _save() {
    const r = this._result;
    if (!r) return;
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const when = r.date.toLocaleString('fr-BE', { dateStyle: 'long', timeStyle: 'short' });
    const parts = r.sections.map((s) =>
      `<h2>${esc(s.title)}</h2>${s.rows.length ? '<table>' : ''}${s.rows.map(([l, v]) => `<tr><th${l.startsWith('   ') ? ' class="sub"' : ''}>${esc(l.trim())}</th><td>${esc(v)}</td></tr>`).join('')}${s.rows.length ? '</table>' : ''}` +
      (s.links || []).map((l) => `<p><a href="${esc(l.url)}">${esc(l.label)}</a><br><span class="note">${esc(l.url)}</span></p>`).join('') +
      s.notes.map((n) => `<p class="note">${esc(n)}</p>`).join(''));
    const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Sondage virtuel</title>' +
      '<style>body{font-family:Arial,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#222}h1{font-size:20px}' +
      'h2{font-size:15px;margin:20px 0 6px;border-bottom:1px solid #ccc}table{border-collapse:collapse;font-size:13px}' +
      'th{text-align:left;padding:2px 14px 2px 0;color:#555;vertical-align:top;font-weight:600}th.sub{padding-left:14px;font-weight:400}' +
      'td{padding:2px 0}.note{font-size:12px;color:#555;margin:6px 0}</style></head><body>' +
      `<h1>Sondage virtuel</h1><p class="note">AMGT4CEM, ${esc(when)}. Sources : Bruxelles Environnement (CC BY 4.0).</p>` +
      parts.join('') + '</body></html>';
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const stamp = r.date.toISOString().slice(0, 10).replace(/-/g, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sondage-virtuel_X${Math.round(r.x)}_Y${Math.round(r.y)}_${stamp}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
};
