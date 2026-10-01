/**
 * Plugin "pe-label-editor" — placer et orienter les références de planche
 * (PE_label, ex. "1000-236") par rapport au cadre de leur planche.
 *
 * AUCUN fichier de l'application n'est modifié : le plugin n'utilise que des
 * objets déjà globaux de l'appli (AMGT4CEM_MapMenu, AMGT4CEM_CRS,
 * AMGT4CEM_ShpLoader, AMGT4CEM_CONFIG, Leaflet `L`), depuis un script ajouté
 * en fin de page (voir index.html de ce dossier).
 *
 * PRINCIPE
 * Cliquer dans le texte d'une référence ouvre une bulle d'info (numéro de
 * planche) avec une icône « déplacer » : elle lance la modification de CETTE
 * étiquette, en quatre choix :
 *   1. point de référence du texte (R1) : l'un des 8 points de sa boîte —
 *      4 coins et 4 milieux de bord ;
 *   2. point d'ancrage (A1) sur la planche : un coin du cadre, une
 *      intersection avec une autre planche, ou le milieu d'un segment
 *      (segment = portion de cadre entre deux de ces points). R1 est posé sur A1 ;
 *   3. second point de référence du texte (R2), un autre des 8 ;
 *   4. un autre point remarquable de la planche (A2).
 * L'orientation en découle : R1 (= A1), R2 et A2 sont alignés, par la
 * rotation LA MOINS GRANDE de la boîte de texte (en valeur absolue, depuis
 * l'horizontale : texte toujours lisible, jamais à l'envers).
 *
 * Tout est recalculé à l'affichage (taille de boîte mesurée dans le DOM) : le
 * rapport largeur/hauteur de la boîte ne change pas avec le zoom, donc le
 * point de référence reste collé à son point d'ancrage et l'alignement est
 * conservé à tous les niveaux de zoom.
 *
 * ACCÈS RÉSERVÉ : cette modification ne doit à terme être accessible qu'aux
 * administrateurs, en mode « édition ». Ce plugin n'est chargé que par sa page
 * de lancement (la page normale de l'appli ne le charge pas) ; en plus,
 * `isAdmin()` ci-dessous est le point de branchement prévu — à remplacer par
 * le contrôle réel (il masque la bulle et l'icône quand il renvoie false).
 *
 * PERSISTANCE : ce plugin n'a pas accès aux fichiers du dépôt. Les
 * définitions sont gardées dans localStorage (par navigateur) et
 * exportables/importables en JSON, à transmettre à qui maintient les données
 * pour les rendre permanentes.
 */
(function () {
  const STORAGE_KEY = 'amgt4cem-ple-overrides-v4'; // v4 : modèle à 4 points (R1/A1/R2/A2), incompatible avec les v1-v3 (position + angle libres)
  const MERGE_EPS_M = 0.5; // deux points remarquables plus proches que ça sont confondus
  const CORNER_MIN_TURN_DEG = 1; // un sommet qui dévie de moins de ça n'est pas un coin

  // Les 8 points de la boîte de texte : fraction de la largeur (x) et de la hauteur (y, vers le bas).
  const REFS = {
    tl: { x: 0, y: 0, label: 'coin haut-gauche' },
    tc: { x: 0.5, y: 0, label: 'milieu du bord haut' },
    tr: { x: 1, y: 0, label: 'coin haut-droit' },
    ml: { x: 0, y: 0.5, label: 'milieu du bord gauche' },
    mr: { x: 1, y: 0.5, label: 'milieu du bord droit' },
    bl: { x: 0, y: 1, label: 'coin bas-gauche' },
    bc: { x: 0.5, y: 1, label: 'milieu du bord bas' },
    br: { x: 1, y: 1, label: 'coin bas-droit' },
  };
  // Valeur d'origine (champ `side` de MetroLabels.shp) -> point de référence équivalent.
  const SIDE_TO_REF = { top: 'tc', bottom: 'bc', left: 'ml', right: 'mr' };
  const KIND_LABEL = { corner: 'coin', intersection: 'intersection avec une autre planche', middle: 'milieu de segment' };

  const SLOTS = [
    { id: 'r1', kind: 'ref', title: '1. Point de référence du texte', hint: "Cliquez l'un des 8 points sur le texte." },
    { id: 'a1', kind: 'planche', title: "2. Point d'ancrage sur la planche", hint: 'Cliquez un coin, une intersection ou un milieu de segment du cadre.' },
    { id: 'r2', kind: 'ref', title: '3. Second point de référence du texte', hint: 'Cliquez un autre des 8 points du texte.' },
    { id: 'a2', kind: 'planche', title: '4. Autre point remarquable de la planche', hint: 'Cliquez un autre point du cadre : il sera aligné avec les deux points précédents.' },
  ];

  const sameLatLng = (v, c) => !!v && Math.abs(v[0] - c.lat) < 1e-9 && Math.abs(v[1] - c.lng) < 1e-9;

  const PeLabelEditor = {
    _map: null,
    _entries: [], // { key, code, marker, span, orig:{lat,lng,angle,ref}, def, lat, lng, angle, ref }
    _overrides: {}, // key -> { r1, a1:[lat,lng], r2, a2:[lat,lng] }
    _planches: [], // [{ code, ring: [[x, y], ...] }] — Lambert, anneau non refermé
    _edit: null, // session de modification en cours
    _toggleBtn: null,
    _panel: null,

    /** Point de branchement du futur mode « édition » réservé aux administrateurs. */
    isAdmin() {
      return true;
    },

    init() {
      this._waitForApp(() => {
        this._map = this._findMap();
        if (!this._map) {
          console.error('[pe-label-editor] Carte Leaflet introuvable, plugin non démarré.');
          return;
        }
        this._loadOverrides();
        this._loadPlanches();
        this._buildToggleButton();
        // Les étiquettes n'existent dans le DOM que quand la couche « Plans
        // d'ensemble » est affichée (couche externe, peut être cochée bien après
        // le chargement) : on réessaie jusqu'à les trouver.
        if (!this._ensureIndexed()) {
          this._autoIndexInterval = setInterval(() => {
            if (this._ensureIndexed()) clearInterval(this._autoIndexInterval);
          }, 1500);
        }
        this._map.on('zoomend', () => this._renderAll());
      });
    },

    /**
     * Référence `AMGT4CEM_MapMenu` en identifiant nu (pas `window.…`) : comme
     * tous les scripts classiques de l'appli, c'est un `const` de premier
     * niveau, visible dans la portée globale partagée mais pas posé sur `window`.
     */
    _waitForApp(cb) {
      const check = () => {
        const layers = typeof AMGT4CEM_MapMenu !== 'undefined' && AMGT4CEM_MapMenu._metroLayers;
        if (layers && layers.PE_label && layers.MS && layers.MS._map) cb();
        else setTimeout(check, 300);
      };
      check();
    },

    _findMap() {
      const layers = AMGT4CEM_MapMenu._metroLayers;
      return (layers.MS && layers.MS._map) || (layers.MT && layers.MT._map) || null;
    },

    // ---- Indexation des étiquettes ----------------------------------------

    /** Indexe les étiquettes affichées UNE fois (valeurs d'origine conservées) puis applique les définitions sauvegardées. */
    _ensureIndexed() {
      if (this._entries.length) return true;
      const out = [];
      const seen = {};
      AMGT4CEM_MapMenu._metroLayers.PE_label.eachLayer((marker) => {
        const span = marker.getElement() && marker.getElement().querySelector('.amgt-scaled-text');
        if (!span) return;
        const code = span.textContent.trim();
        seen[code] = (seen[code] || 0) + 1;
        // Clé stable "code#rang" (« 3000-126#1 » pour la 2e étiquette de ce numéro).
        const key = `${code}#${seen[code] - 1}`;
        const ll = marker.getLatLng();
        out.push({
          key,
          code,
          marker,
          span,
          orig: { lat: ll.lat, lng: ll.lng, angle: this._readAngleDeg(span), ref: SIDE_TO_REF[span.dataset.side] || 'tc' },
          def: this._overrides[key] || null,
        });
      });
      if (!out.length) return false;
      this._entries = out;
      for (const entry of out) {
        entry.marker.on('add', () => {
          this._bindLabel(entry);
          this._render(entry);
        });
        this._bindLabel(entry);
        this._render(entry);
      }
      this._refreshAdminCount();
      return true;
    },

    _readAngleDeg(span) {
      const m = /rotate\(\s*(-?[\d.]+)deg\s*\)/.exec(span.style.transform || '');
      return m ? parseFloat(m[1]) : 0;
    },

    // ---- Clic dans le texte : bulle d'info + icône « déplacer » ------------

    /**
     * Le `<span>` du texte a `pointer-events: none` dans le CSS de l'appli
     * (voulu : un clic doit traverser jusqu'à la planche). Ce plugin ne touche
     * pas ce fichier : il pose un style en ligne sur CET élément, et se
     * ré-abonne à chaque `add` du marqueur (Leaflet recrée le DOM quand la
     * couche est masquée puis réaffichée).
     */
    _bindLabel(entry) {
      const span = entry.marker.getElement() && entry.marker.getElement().querySelector('.amgt-scaled-text');
      if (!span) return;
      entry.span = span;
      if (!this.isAdmin()) return;
      span.style.pointerEvents = 'auto';
      span.style.cursor = 'pointer';
      span.title = "Cliquer pour afficher la bulle d'info (et déplacer l'étiquette)";
      if (span._amgtPleBound) return;
      span._amgtPleBound = true;
      span.addEventListener('click', (e) => {
        L.DomEvent.stopPropagation(e); // pas de clic traversant vers la planche en dessous
        L.DomEvent.preventDefault(e);
        if (this._edit) return; // une étiquette est déjà en cours de modification
        this._openBubble(entry, this._map.mouseEventToLatLng(e));
      });
    },

    _openBubble(entry, latlng) {
      const box = document.createElement('div');
      box.className = 'amgt-popup amgt-ple-bubble';
      const title = document.createElement('strong');
      title.textContent = `Planche ${entry.code}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'amgt-ple-move-btn';
      btn.title = 'Déplacer / orienter cette étiquette';
      btn.setAttribute('aria-label', 'Déplacer cette étiquette');
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/>' +
        '<polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>';
      btn.addEventListener('click', () => {
        this._map.closePopup();
        this._startEdit(entry);
      });
      box.append(title, btn);
      L.popup({ closeButton: true, offset: [0, -4] }).setLatLng(latlng).setContent(box).openOn(this._map);
    },

    // ---- Pose d'une étiquette ---------------------------------------------

    _renderAll() {
      for (const entry of this._entries) this._render(entry);
    },

    /**
     * Pose l'étiquette : sans définition, sa position/orientation d'origine
     * (PDF). Avec R1+A1 : R1 posé sur A1. Avec en plus R2+A2 : rotation qui
     * aligne R1, R2 et A2.
     */
    _render(entry) {
      if (!entry.span || !entry.marker.getElement()) return;
      const d = entry.def;
      let { lat, lng, angle, ref } = entry.orig;
      if (d && d.r1 && d.a1) {
        ref = d.r1;
        [lat, lng] = d.a1;
        if (d.r2 && d.a2) angle = this._alignAngle(entry, d);
      }
      entry.lat = lat;
      entry.lng = lng;
      entry.angle = angle;
      entry.ref = ref;
      entry.marker.setLatLng([lat, lng]);
      const r = REFS[ref];
      entry.span.dataset.ref = ref;
      entry.span.style.transformOrigin = '0 0';
      entry.span.style.transform = `rotate(${angle}deg) translate(${-r.x * 100}%,${-r.y * 100}%)`;
    },

    /**
     * Rotation CSS (degrés, horaire) qui aligne R1, R2 et A2 : le vecteur
     * R1→R2 de la boîte (mesurée dans le DOM, sans rotation) doit être
     * parallèle à A1→A2 à l'écran. Deux solutions à 180° l'une de l'autre :
     * on garde celle de plus petite valeur absolue (texte lisible).
     */
    _alignAngle(entry, d) {
      const w = entry.span.offsetWidth || 1;
      const h = entry.span.offsetHeight || 1;
      const v = { x: (REFS[d.r2].x - REFS[d.r1].x) * w, y: (REFS[d.r2].y - REFS[d.r1].y) * h };
      const p1 = this._map.project(L.latLng(d.a1), 0);
      const p2 = this._map.project(L.latLng(d.a2), 0);
      let theta = (Math.atan2(p2.y - p1.y, p2.x - p1.x) - Math.atan2(v.y, v.x)) * (180 / Math.PI);
      theta = ((((theta + 90) % 180) + 180) % 180) - 90; // [-90°, 90°[
      return theta;
    },

    // ---- Points remarquables d'une planche -----------------------------------

    /** Charge Metro.shp (même fichier que l'appli, lu séparément) : contours des planches, en Lambert. */
    _loadPlanches() {
      AMGT4CEM_ShpLoader.load(
        AMGT4CEM_CONFIG.metroShpBaseUrl,
        (geojson) => {
          this._planches = geojson.features
            .filter((f) => f.properties && f.properties.type === 'PE' && f.geometry && f.geometry.type === 'Polygon')
            .map((f) => ({ code: f.properties.sheet_ref, ring: f.geometry.coordinates[0].slice(0, -1) }));
        },
        (err) => console.warn('[pe-label-editor] Metro.shp illisible, choix des points de planche impossible :', err)
      );
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

    /** Planche de l'étiquette : celle de même numéro qui la contient (3000-126 en a deux), sinon la première. */
    _planchOf(entry) {
      const same = this._planches.filter((p) => p.code === entry.code);
      if (same.length <= 1) return same[0] || null;
      const { x, y } = AMGT4CEM_CRS.latLngToLambert(L.latLng(entry.lat, entry.lng));
      return same.find((p) => this._inRing([x, y], p.ring)) || same[0];
    },

    /**
     * Points remarquables du cadre d'une planche : coins, intersections avec
     * les autres planches, puis milieux des segments que ces points découpent
     * sur le cadre. [{ x, y, kind }] en Lambert.
     */
    _remarkablePoints(planche) {
      const ring = planche.ring;
      const n = ring.length;
      const raw = []; // { x, y, kind, edge, t } ; (edge, t) = position le long du cadre
      for (let i = 0; i < n; i++) {
        const a = ring[(i + n - 1) % n];
        const b = ring[i];
        const c = ring[(i + 1) % n];
        const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
        const diff = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1))) * (180 / Math.PI); // 0 si alignés
        if (diff > CORNER_MIN_TURN_DEG) raw.push({ x: b[0], y: b[1], kind: 'corner', edge: i, t: 0 });
      }
      for (let i = 0; i < n; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % n];
        for (const other of this._planches) {
          if (other === planche) continue;
          const m = other.ring.length;
          for (let j = 0; j < m; j++) {
            const hit = this._segIntersect(p, q, other.ring[j], other.ring[(j + 1) % m]);
            if (hit) raw.push({ x: hit.x, y: hit.y, kind: 'intersection', edge: i, t: hit.t });
          }
        }
      }
      raw.sort((a, b) => a.edge - b.edge || a.t - b.t);
      const pts = [];
      for (const r of raw) {
        if (pts.some((q) => Math.hypot(q.x - r.x, q.y - r.y) < MERGE_EPS_M)) continue;
        pts.push(r);
      }
      const out = pts.map((p) => ({ x: p.x, y: p.y, kind: p.kind }));
      if (pts.length > 1) {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, kind: 'middle' });
        }
      }
      return out;
    },

    /** Intersection stricte de deux segments [p,q] et [r,s] : { x, y, t } (t = position sur [p,q]) ou null. */
    _segIntersect(p, q, r, s) {
      const d1x = q[0] - p[0];
      const d1y = q[1] - p[1];
      const d2x = s[0] - r[0];
      const d2y = s[1] - r[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) return null; // parallèles
      const t = ((r[0] - p[0]) * d2y - (r[1] - p[1]) * d2x) / den;
      const u = ((r[0] - p[0]) * d1y - (r[1] - p[1]) * d1x) / den;
      if (t < 1e-9 || t > 1 - 1e-9 || u < 0 || u > 1) return null;
      return { x: p[0] + t * d1x, y: p[1] + t * d1y, t };
    },

    // ---- Modification d'une étiquette (4 choix) ----------------------------------

    _startEdit(entry) {
      const planche = this._planchOf(entry);
      if (!planche) {
        alert('Contour de la planche introuvable (Metro.shp pas encore chargé) : réessayez dans un instant.');
        return;
      }
      if (this._panel) {
        this._panel.remove();
        this._panel = null;
        if (this._toggleBtn) this._toggleBtn.classList.remove('amgt-ple-active');
      }
      const backup = entry.def ? JSON.parse(JSON.stringify(entry.def)) : null;
      entry.def = entry.def ? { ...entry.def } : {};
      const cands = this._remarkablePoints(planche).map((p) => {
        const ll = AMGT4CEM_CRS.lambertToLatLng([p.x, p.y]);
        return { lat: ll.lat, lng: ll.lng, kind: p.kind };
      });
      this._edit = { entry, backup, cands, slot: 0, refDots: [], candMarkers: [], line: null };
      this._edit.slot = Math.max(0, SLOTS.findIndex((s) => !entry.def[s.id]));
      this._showRefDots(entry);
      this._showCandidates();
      this._buildEditPanel();
      this._refreshEdit();
    },

    _showRefDots(entry) {
      for (const [key, r] of Object.entries(REFS)) {
        const dot = document.createElement('i');
        dot.className = 'amgt-ple-dot';
        dot.dataset.ref = key;
        dot.title = r.label;
        dot.style.left = `${r.x * 100}%`;
        dot.style.top = `${r.y * 100}%`;
        dot.addEventListener('pointerdown', (e) => e.stopPropagation());
        dot.addEventListener('click', (e) => {
          L.DomEvent.stopPropagation(e);
          this._pickRef(key);
        });
        entry.span.appendChild(dot);
        this._edit.refDots.push(dot);
      }
    },

    _showCandidates() {
      for (const c of this._edit.cands) {
        const m = L.marker([c.lat, c.lng], {
          icon: L.divIcon({ className: `amgt-ple-cand amgt-ple-cand--${c.kind}`, iconSize: [16, 16], iconAnchor: [8, 8] }),
          title: KIND_LABEL[c.kind],
          keyboard: false,
          zIndexOffset: 1000,
        }).addTo(this._map);
        m.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          this._pickPlanche(c);
        });
        c.marker = m;
        this._edit.candMarkers.push(m);
      }
    },

    _pickRef(key) {
      const ed = this._edit;
      const slot = SLOTS[ed.slot];
      if (slot.kind !== 'ref') return this._flash('Cette étape attend un point du cadre de la planche, pas du texte.');
      if (slot.id === 'r2' && key === ed.entry.def.r1) return this._flash('Le second point de référence doit être différent du premier.');
      this._setSlot(slot.id, key);
    },

    _pickPlanche(c) {
      const ed = this._edit;
      const slot = SLOTS[ed.slot];
      if (slot.kind !== 'planche') return this._flash("Cette étape attend un point du texte (les 8 points sur l'étiquette).");
      if (slot.id === 'a2' && sameLatLng(ed.entry.def.a1, c)) return this._flash("Le second point de la planche doit être différent du point d'ancrage.");
      this._setSlot(slot.id, [c.lat, c.lng]);
    },

    _setSlot(id, value) {
      const ed = this._edit;
      const def = ed.entry.def;
      def[id] = value;
      // Un point devenu identique à son vis-à-vis rendrait l'alignement indéfini : on retire le second.
      if (def.r2 && def.r2 === def.r1) delete def.r2;
      if (def.a2 && def.a1 && def.a2[0] === def.a1[0] && def.a2[1] === def.a1[1]) delete def.a2;
      this._render(ed.entry);
      this._saveEntry(ed.entry);
      const after = SLOTS.findIndex((s, i) => i > ed.slot && !def[s.id]);
      const any = SLOTS.findIndex((s) => !def[s.id]);
      ed.slot = after >= 0 ? after : any >= 0 ? any : ed.slot;
      this._refreshEdit();
    },

    /** Met à jour surbrillances, ligne d'alignement et panneau selon la définition courante. */
    _refreshEdit() {
      const ed = this._edit;
      if (!ed) return;
      const def = ed.entry.def;
      for (const dot of ed.refDots) {
        dot.classList.toggle('amgt-ple-role1', dot.dataset.ref === def.r1);
        dot.classList.toggle('amgt-ple-role2', dot.dataset.ref === def.r2);
      }
      for (const c of ed.cands) {
        const el = c.marker.getElement();
        if (!el) continue;
        el.classList.toggle('amgt-ple-role1', sameLatLng(def.a1, c));
        el.classList.toggle('amgt-ple-role2', sameLatLng(def.a2, c));
      }
      if (ed.line) this._map.removeLayer(ed.line);
      ed.line = null;
      if (def.a1 && def.a2) {
        ed.line = L.polyline([def.a1, def.a2], { color: '#2c7be5', weight: 2, dashArray: '6 5', interactive: false }).addTo(this._map);
      }
      this._refreshEditPanel();
    },

    _buildEditPanel() {
      const panel = document.createElement('div');
      panel.className = 'amgt-ple-panel';
      panel.innerHTML = `
        <h3></h3>
        <ol class="amgt-ple-steps"></ol>
        <p class="amgt-ple-result"></p>
        <p class="amgt-ple-flash" hidden></p>
        <div class="amgt-ple-actions">
          <button type="button" data-action="done">Terminé</button>
          <button type="button" data-action="cancel">Annuler</button>
          <button type="button" data-action="reset">Réinitialiser l'étiquette</button>
        </div>`;
      document.body.appendChild(panel);
      this._panel = panel;
      panel.querySelector('[data-action="done"]').addEventListener('click', () => this._endEdit(false));
      panel.querySelector('[data-action="cancel"]').addEventListener('click', () => this._endEdit(true));
      panel.querySelector('[data-action="reset"]').addEventListener('click', () => {
        const ed = this._edit;
        ed.entry.def = {};
        this._render(ed.entry);
        this._saveEntry(ed.entry);
        ed.slot = 0;
        this._refreshEdit();
      });
    },

    _refreshEditPanel() {
      const ed = this._edit;
      const def = ed.entry.def;
      const p = this._panel;
      p.querySelector('h3').textContent = `Étiquette de la planche ${ed.entry.code}`;
      const ol = p.querySelector('.amgt-ple-steps');
      ol.textContent = '';
      SLOTS.forEach((s, i) => {
        const li = document.createElement('li');
        if (i === ed.slot) li.classList.add('amgt-ple-active');
        if (def[s.id]) li.classList.add('amgt-ple-done');
        let value = '';
        if (def[s.id]) {
          if (s.kind === 'ref') value = REFS[def[s.id]].label;
          else {
            const c = ed.cands.find((k) => sameLatLng(def[s.id], k));
            value = c ? KIND_LABEL[c.kind] : 'point choisi';
          }
        }
        li.innerHTML = '<b></b><span></span><em></em>';
        li.querySelector('b').textContent = s.title;
        li.querySelector('span').textContent = value ? `✓ ${value}` : '';
        li.querySelector('em').textContent = i === ed.slot ? s.hint : '';
        li.addEventListener('click', () => {
          ed.slot = i;
          this._refreshEdit();
        });
        ol.appendChild(li);
      });
      const res = p.querySelector('.amgt-ple-result');
      if (def.r1 && def.a1 && def.r2 && def.a2) res.textContent = `Rotation : ${ed.entry.angle.toFixed(1)}° (points 1, 3 et 4 alignés, rotation minimale)`;
      else if (def.r1 && def.a1) res.textContent = "Position définie. Choisissez les points 3 et 4 pour l'orientation (sinon : orientation d'origine).";
      else res.textContent = '';
    },

    _flash(msg) {
      const el = this._panel && this._panel.querySelector('.amgt-ple-flash');
      if (!el) return;
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => (el.hidden = true), 3500);
    },

    _endEdit(cancel) {
      const ed = this._edit;
      if (!ed) return;
      // Annuler, ou définition sans position (R1+A1 manquants) : on revient à l'état d'avant la session.
      if (cancel || !ed.entry.def.r1 || !ed.entry.def.a1) {
        ed.entry.def = ed.backup;
        this._saveEntry(ed.entry);
      }
      this._render(ed.entry);
      for (const dot of ed.refDots) dot.remove();
      for (const m of ed.candMarkers) this._map.removeLayer(m);
      if (ed.line) this._map.removeLayer(ed.line);
      this._edit = null;
      if (this._panel) this._panel.remove();
      this._panel = null;
      this._refreshAdminCount();
    },

    // ---- Persistance (localStorage + export/import JSON) -------------------------

    _loadOverrides() {
      try {
        this._overrides = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      } catch (err) {
        console.warn('[pe-label-editor] localStorage illisible, réglages ignorés :', err);
        this._overrides = {};
      }
    },

    _saveEntry(entry) {
      const d = entry.def;
      if (d && Object.keys(d).length) this._overrides[entry.key] = d;
      else delete this._overrides[entry.key];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._overrides));
      } catch (err) {
        console.warn('[pe-label-editor] Écriture localStorage impossible :', err);
      }
    },

    // ---- Bouton et panneau d'administration (export / import / tout réinitialiser) -----

    _buildToggleButton() {
      if (!this.isAdmin()) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'amgt-ple-toggle-btn';
      btn.textContent = '✥ Étiquettes planches';
      btn.title = "Édition des références de planche (administrateurs) — ne modifie aucun fichier de l'appli";
      btn.addEventListener('click', () => this._toggleAdminPanel());
      document.body.appendChild(btn);
      this._toggleBtn = btn;
    },

    _toggleAdminPanel() {
      if (this._edit) return;
      if (this._panel) {
        this._panel.remove();
        this._panel = null;
        this._toggleBtn.classList.remove('amgt-ple-active');
        return;
      }
      this._toggleBtn.classList.add('amgt-ple-active');
      const panel = document.createElement('div');
      panel.className = 'amgt-ple-panel';
      panel.innerHTML = `
        <h3>✥ Étiquettes de planches</h3>
        <p>Affichez la couche « Plans d'ensemble », puis <b>cliquez dans le texte</b> d'une référence de planche :
        la bulle d'info propose l'icône « déplacer ».</p>
        <p class="amgt-ple-count"></p>
        <div class="amgt-ple-actions">
          <button type="button" data-action="export">Exporter JSON</button>
          <label class="amgt-ple-import-btn">Importer JSON<input type="file" accept="application/json" data-action="import" /></label>
          <button type="button" data-action="reset-all">Tout réinitialiser</button>
          <button type="button" data-action="close">Fermer</button>
        </div>`;
      document.body.appendChild(panel);
      this._panel = panel;
      this._refreshAdminCount();
      panel.querySelector('[data-action="export"]').addEventListener('click', () => this._exportJson());
      panel.querySelector('[data-action="import"]').addEventListener('change', (e) => this._importJson(e));
      panel.querySelector('[data-action="reset-all"]').addEventListener('click', () => this._resetAll());
      panel.querySelector('[data-action="close"]').addEventListener('click', () => this._toggleAdminPanel());
    },

    _refreshAdminCount() {
      if (!this._panel) return;
      const el = this._panel.querySelector('.amgt-ple-count');
      if (el) el.textContent = `${this._entries.length} étiquette(s) affichée(s) · ${Object.keys(this._overrides).length} modifiée(s)`;
    },

    _resetAll() {
      if (!confirm("Réinitialiser TOUTES les étiquettes à leur position/orientation d'origine (PDF) ?")) return;
      this._overrides = {};
      for (const entry of this._entries) {
        entry.def = null;
        this._render(entry);
      }
      try {
        localStorage.setItem(STORAGE_KEY, '{}');
      } catch (err) {
        /* sans effet : la mémoire est déjà vidée */
      }
      this._refreshAdminCount();
    },

    _exportJson() {
      const out = this._entries.map((e) => ({
        key: e.key,
        code: e.code,
        def: e.def && e.def.r1 ? e.def : null,
        // Résultat calculé (pour qui reprend les données) : ancre, point de référence et rotation CSS.
        lat: e.lat,
        lng: e.lng,
        ref: e.ref,
        angle: e.angle,
      }));
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pe-label-overrides.json';
      a.click();
      URL.revokeObjectURL(a.href);
    },

    _importJson(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const byKey = {};
          for (const row of JSON.parse(reader.result)) byKey[row.key] = row;
          for (const entry of this._entries) {
            const row = byKey[entry.key];
            if (!row) continue;
            entry.def = row.def || null;
            this._render(entry);
            this._saveEntry(entry);
          }
          this._refreshAdminCount();
        } catch (err) {
          alert('Fichier JSON invalide : ' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
  };

  PeLabelEditor.init();
  window.AMGT4CEM_PeLabelEditor = PeLabelEditor; // exposé pour usage/débogage depuis la console
})();
