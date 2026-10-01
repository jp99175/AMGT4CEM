/**
 * Plugin "pe-label-editor" — placer et orienter les références de planche
 * (PE_label, ex. "1000-236") par rapport au cadre de leur planche, et
 * ENREGISTRER le résultat dans l'application (partagé par tous les
 * visiteurs), pas dans le navigateur.
 *
 * PRINCIPE
 * Cliquer dans le texte d'une référence ouvre une bulle d'info (numéro de
 * planche) avec une icône « déplacer » : elle lance la modification de CETTE
 * étiquette, en quatre choix :
 *   1. point de référence du texte (R1) : l'un des 8 points de sa boîte —
 *      4 coins et 4 milieux de bord ;
 *   2. point d'ancrage (A1) sur la planche : un point remarquable de son
 *      cadre (voir _remarkablePoints). R1 est posé sur A1 ;
 *   3. second point de référence du texte (R2), un autre des 8 ;
 *   4. un autre point remarquable de la planche (A2).
 * L'orientation en découle : R1 (= A1), R2 et A2 sont alignés, par la
 * rotation LA MOINS GRANDE de la boîte de texte (texte toujours lisible).
 * Ce calcul d'affichage est fait par l'application elle-même
 * (AMGT4CEM_ScaledText.setDefinition, scaledText.js) : le plugin ne fait que
 * l'interface de choix et l'enregistrement.
 *
 * ENREGISTREMENT PARTAGÉ : les définitions vivent dans
 * data/pe-label-anchors.json (dépôt), lu par l'application pour tous les
 * visiteurs (peLabelAnchors.js). « Enregistrer » les envoie au relais serveur
 * (relay/) qui écrit ce fichier dans le dépôt ; il faut le code administrateur
 * du relais. Tant que le relais n'est pas déployé (config.js,
 * peLabelAnchorsRelayUrl), l'enregistrement est impossible : l'export JSON
 * sert de solution de repli manuelle. Rien n'est gardé dans localStorage.
 *
 * ACCÈS RÉSERVÉ : à terme réservé aux administrateurs, en mode « édition ».
 * Ce plugin n'est chargé que par sa page de lancement ; `isAdmin()` ci-dessous
 * est le point de branchement prévu pour le contrôle réel (il masque la bulle
 * et l'icône quand il renvoie false), en plus du code administrateur exigé par
 * le relais à l'enregistrement.
 */
(function () {
  const MIN_SPACING_M = 5; // un point remarquable n'est ajouté que s'il n'y en a pas déjà un à moins de 5 m (échelle réelle du plan)
  const CORNER_MIN_TURN_DEG = 1; // un sommet qui dévie de moins de ça n'est pas un vrai coin

  // Les 8 points de la boîte de texte (définis par l'application, sans « center »).
  const REFS = Object.fromEntries(Object.entries(AMGT4CEM_ScaledText.REFS).filter(([k]) => k !== 'center'));
  const KIND_LABEL = {
    vertex: 'sommet du cadre',
    side: 'milieu de côté du cadre',
    intersection: 'intersection avec une autre planche',
    middle: 'milieu de segment (sommets / intersections)',
  };

  const SLOTS = [
    { id: 'r1', kind: 'ref', title: '1. Point de référence du texte', hint: "Cliquez l'un des 8 points sur le texte." },
    { id: 'a1', kind: 'planche', title: "2. Point d'ancrage sur la planche", hint: 'Cliquez un point remarquable du cadre (sommet, milieu de côté, intersection, milieu de segment).' },
    { id: 'r2', kind: 'ref', title: '3. Second point de référence du texte', hint: 'Cliquez un autre des 8 points du texte.' },
    { id: 'a2', kind: 'planche', title: '4. Autre point remarquable de la planche', hint: 'Cliquez un autre point du cadre : il sera aligné avec les deux points précédents.' },
  ];

  /** Couleur chromatiquement opposée (teinte + 180°, même saturation et luminosité) d'une couleur CSS « rgb(r, g, b) ». */
  function complementaryColor(css) {
    const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css || '');
    if (!m) return css;
    const [r, g, b] = [m[1], m[2], m[3]].map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let sat = 0;
    if (d) {
      sat = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    h = (h + 180) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const mm = l - c / 2;
    const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return `rgb(${[r1, g1, b1].map((v) => Math.round((v + mm) * 255)).join(', ')})`;
  }

  const sameLatLng = (v, c) => !!v && Math.abs(v[0] - c.lat) < 1e-9 && Math.abs(v[1] - c.lng) < 1e-9;
  const clone = (v) => (v ? JSON.parse(JSON.stringify(v)) : v);

  const PeLabelEditor = {
    _map: null,
    _entries: [], // { key, code, marker, span, def, lat, lng, angle, ref }
    _planches: [], // [{ code, ring: [[x, y], ...] }] — Lambert, anneau non refermé
    _edit: null, // session de modification en cours
    _toggleBtn: null,
    _panel: null,

    /** Réservé aux administrateurs : voir src/admin.js (futur mot de passe administrateur). */
    isAdmin() {
      return AMGT4CEM_Admin.isAdmin();
    },

    /**
     * Ouvre le panneau d'administration (appelé par ⚙ Paramètres > Fonds de
     * plan, qui charge ce plugin à la demande).
     */
    open() {
      if (!this.isAdmin()) return;
      if (!this._map) {
        setTimeout(() => this.open(), 300); // l'application n'a pas fini de construire ses couches
        return;
      }
      if (!this._panel && !this._edit) this._openAdminPanel();
    },

    init() {
      this._waitForApp(() => {
        this._map = this._findMap();
        if (!this._map) {
          console.error('[pe-label-editor] Carte Leaflet introuvable, plugin non démarré.');
          return;
        }
        this._suppressAppBubbles();
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
      });
    },

    /**
     * Mode édition : plus d'infobulles de l'application (popups des planches,
     * stations, points, couches UrbIS Topo ; info-bulles Leaflet), qui
     * gênent le choix des points. Seule reste la bulle du plugin (titre de
     * l'étiquette + icône « déplacer »), ouverte par `L.popup().openOn(map)`
     * et non par `openPopup` d'une couche. Le patch dure jusqu'au
     * rechargement de la page (« Quitter l'édition »).
     */
    _suppressAppBubbles() {
      L.Layer.include({
        openPopup() { return this; },
        openTooltip() { return this; },
      });
      this._map.closePopup(); // une infobulle ouverte avant le lancement du mode édition
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

    /** Indexe les étiquettes affichées UNE fois. Leur définition partagée est déjà appliquée par l'application. */
    _ensureIndexed() {
      if (this._entries.length) return true;
      const out = [];
      AMGT4CEM_MapMenu._metroLayers.PE_label.eachLayer((marker) => {
        const span = marker.getElement() && marker.getElement().querySelector('.amgt-scaled-text');
        if (!span || !marker._amgtKey) return;
        out.push({
          key: marker._amgtKey, // "code#rang", posée par metroLayer.js
          code: span.textContent.trim(),
          marker,
          span,
          def: clone(AMGT4CEM_PeLabelAnchors.get(marker._amgtKey)),
          origColor: getComputedStyle(span).color, // couleur d'origine du texte (orange des références de planche)
          origInline: span.style.color, // …telle que posée par l'application (style en ligne), à restituer
        });
      });
      if (!out.length) return false;
      this._entries = out;
      for (const entry of out) {
        entry.marker.on('add', () => this._bindLabel(entry)); // Leaflet recrée le DOM quand la couche est masquée puis réaffichée
        this._bindLabel(entry);
        this._syncPose(entry);
      }
      this._refreshAdminPanel();
      return true;
    },

    /** Applique la définition courante de l'entrée via l'application, et relit la pose obtenue. */
    _syncPose(entry) {
      const pose = AMGT4CEM_ScaledText.setDefinition(entry.marker, entry.def);
      if (!pose) return;
      entry.lat = pose.latlng.lat;
      entry.lng = pose.latlng.lng;
      entry.angle = pose.angle;
      entry.ref = pose.ref;
      this._applyColor(entry);
    },

    /**
     * En mode édition (ce plugin), une étiquette repositionnée — définition
     * avec au moins R1 et A1 — est affichée dans la couleur chromatiquement
     * opposée à sa couleur d'origine : on voit d'un coup d'œil lesquelles ont
     * été modifiées. La page normale de l'appli ne charge pas ce plugin et
     * garde la couleur d'origine.
     */
    _applyColor(entry) {
      if (!entry.span) return;
      const moved = !!(entry.def && entry.def.r1 && entry.def.a1);
      entry.span.style.color = moved ? complementaryColor(entry.origColor) : entry.origInline;
    },

    // ---- Clic dans le texte : bulle d'info + icône « déplacer » ------------

    /**
     * Le `<span>` du texte a `pointer-events: none` dans le CSS de l'appli
     * (voulu : un clic doit traverser jusqu'à la planche). Le plugin pose un
     * style en ligne sur CET élément seulement, et se ré-abonne à chaque `add`.
     */
    _bindLabel(entry) {
      const span = entry.marker.getElement() && entry.marker.getElement().querySelector('.amgt-scaled-text');
      if (!span) return;
      entry.span = span;
      this._applyColor(entry); // le DOM a pu être recréé : la couleur d'origine est revenue
      if (!this.isAdmin()) return;
      span.style.pointerEvents = 'auto';
      span.style.cursor = 'pointer';
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
     * Points remarquables du cadre d'une planche, dans cet ordre :
     *   1. les sommets du polygone                                   (kind 'vertex')
     *   2. le centre de chaque côté du polygone                      (kind 'side')
     *   3. les intersections avec les autres planches                (kind 'intersection')
     *   4. le centre de chaque segment du cadre que délimitent les
     *      points 1 ET 3 (sommets et intersections)                  (kind 'middle')
     * Un point n'est ajouté que s'il a une valeur ajoutée : aucun autre point
     * remarquable déjà retenu à moins de MIN_SPACING_M (mètres réels, le
     * contour étant en Lambert) — la catégorie la plus prioritaire l'emporte.
     * [{ x, y, kind }] en Lambert.
     */
    _remarkablePoints(planche) {
      const ring = planche.ring;
      const n = ring.length;
      // Abscisse curviligne le long du cadre : cum[i] = longueur du cadre jusqu'au sommet i.
      const cum = [0];
      for (let i = 0; i < n; i++) cum.push(cum[i] + Math.hypot(ring[(i + 1) % n][0] - ring[i][0], ring[(i + 1) % n][1] - ring[i][1]));
      const total = cum[n];
      const mod = (v) => ((v % total) + total) % total;
      const pointAt = (sv) => {
        sv = mod(sv);
        let i = 0;
        while (i < n - 1 && cum[i + 1] <= sv) i++;
        const t = (sv - cum[i]) / (cum[i + 1] - cum[i]);
        const q = ring[(i + 1) % n];
        return [ring[i][0] + t * (q[0] - ring[i][0]), ring[i][1] + t * (q[1] - ring[i][1])];
      };
      const out = [];
      const accept = (xy, kind, sv) => {
        if (out.some((q) => Math.hypot(q.x - xy[0], q.y - xy[1]) < MIN_SPACING_M)) return;
        out.push({ x: xy[0], y: xy[1], kind, s: mod(sv) });
      };

      // 1. sommets (un sommet quasi aligné avec ses voisins n'est pas un vrai coin)
      const corners = [];
      for (let i = 0; i < n; i++) {
        const a = ring[(i + n - 1) % n];
        const b = ring[i];
        const c = ring[(i + 1) % n];
        const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
        if (Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1))) * (180 / Math.PI) > CORNER_MIN_TURN_DEG) corners.push(i);
      }
      for (const i of corners) accept(ring[i], 'vertex', cum[i]);

      // 2. centre de chaque côté (portion de cadre entre deux sommets consécutifs)
      corners.forEach((ci, k) => {
        const cj = corners[(k + 1) % corners.length];
        const len = corners.length === 1 ? total : mod(cum[cj] - cum[ci]);
        accept(pointAt(cum[ci] + len / 2), 'side', cum[ci] + len / 2);
      });

      // 3. intersections avec les autres planches
      const hits = [];
      for (let i = 0; i < n; i++) {
        for (const other of this._planches) {
          if (other === planche) continue;
          const m = other.ring.length;
          for (let j = 0; j < m; j++) {
            const hit = this._segIntersect(ring[i], ring[(i + 1) % n], other.ring[j], other.ring[(j + 1) % m]);
            if (hit) hits.push({ xy: [hit.x, hit.y], sv: cum[i] + hit.t * (cum[i + 1] - cum[i]) });
          }
        }
      }
      hits.sort((a, b) => a.sv - b.sv);
      for (const h of hits) accept(h.xy, 'intersection', h.sv);

      // 4. centre de chaque segment défini par les points 1 ET 3 — les centres de côté (2) ne délimitent pas
      const base = out.filter((p) => p.kind === 'vertex' || p.kind === 'intersection').sort((a, b) => a.s - b.s);
      base.forEach((p, k) => {
        const q = base[(k + 1) % base.length];
        const len = base.length === 1 ? total : mod(q.s - p.s);
        accept(pointAt(p.s + len / 2), 'middle', p.s + len / 2);
      });
      return out.map(({ x, y, kind }) => ({ x, y, kind }));
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
      this._closeAdminPanel();
      const backup = clone(entry.def);
      entry.def = entry.def ? { ...entry.def } : {};
      const cands = this._remarkablePoints(planche).map((p) => {
        const ll = AMGT4CEM_CRS.lambertToLatLng([p.x, p.y]);
        return { lat: ll.lat, lng: ll.lng, kind: p.kind };
      });
      this._edit = { entry, backup, cands, slot: 0, refDots: [], candMarkers: [], line: null, history: [] };
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
      ed.history.push({ def: clone(def), slot: ed.slot }); // pour « Retour »
      def[id] = value;
      // Un point devenu identique à son vis-à-vis rendrait l'alignement indéfini : on retire le second.
      if (def.r2 && def.r2 === def.r1) delete def.r2;
      if (def.a2 && def.a1 && def.a2[0] === def.a1[0] && def.a2[1] === def.a1[1]) delete def.a2;
      this._syncPose(ed.entry);
      const after = SLOTS.findIndex((s, i) => i > ed.slot && !def[s.id]);
      const any = SLOTS.findIndex((s) => !def[s.id]);
      ed.slot = after >= 0 ? after : any >= 0 ? any : ed.slot;
      this._refreshEdit();
    },

    /** « Retour » : annule le positionnement du dernier point choisi (et revient à son étape). */
    _back() {
      const ed = this._edit;
      const last = ed && ed.history.pop();
      if (!last) return;
      ed.entry.def = last.def;
      ed.slot = last.slot;
      this._syncPose(ed.entry);
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
          <button type="button" data-action="back" title="Annule le positionnement du dernier point choisi">Retour</button>
          <button type="button" class="amgt-ple-primary" data-action="apply" title="Garde le positionnement et termine">Appliquer</button>
          <button type="button" data-action="cancel" title="Abandonne : aucun changement">Annuler</button>
          <button type="button" data-action="reset">Réinitialiser l'étiquette</button>
        </div>`;
      document.body.appendChild(panel);
      this._panel = panel;
      panel.querySelector('[data-action="back"]').addEventListener('click', () => this._back());
      panel.querySelector('[data-action="apply"]').addEventListener('click', () => {
        const d = this._edit.entry.def;
        if (!d.r1 || !d.a1) return this._flash("Rien à appliquer : choisissez au moins le point de référence (1) et le point d'ancrage (2), ou « Annuler ».");
        this._endEdit(false);
        this._openAdminPanel(); // pour enregistrer dans l'application (le panneau indique les modifications non enregistrées)
      });
      panel.querySelector('[data-action="cancel"]').addEventListener('click', () => this._endEdit(true));
      panel.querySelector('[data-action="reset"]').addEventListener('click', () => {
        const ed = this._edit;
        ed.entry.def = {};
        ed.history = [];
        this._syncPose(ed.entry);
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
      p.querySelector('[data-action="back"]').disabled = !ed.history.length;
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
      this._flashTimer = setTimeout(() => (el.hidden = true), 5000);
    },

    _endEdit(cancel) {
      const ed = this._edit;
      if (!ed) return;
      // Annuler, ou définition sans position (R1+A1 manquants) : retour à l'état d'avant la session.
      if (cancel || !ed.entry.def.r1 || !ed.entry.def.a1) ed.entry.def = ed.backup;
      this._syncPose(ed.entry);
      for (const dot of ed.refDots) dot.remove();
      for (const m of ed.candMarkers) this._map.removeLayer(m);
      if (ed.line) this._map.removeLayer(ed.line);
      this._edit = null;
      if (this._panel) this._panel.remove();
      this._panel = null;
      this._refreshAdminPanel();
    },

    // ---- Enregistrement partagé (dans l'application, via le relais) ---------------

    /** Définitions complètes de toutes les étiquettes : l'état enregistré, corrigé par les entrées indexées. */
    _currentLabels() {
      const labels = AMGT4CEM_PeLabelAnchors.all(); // garde aussi d'éventuelles clés d'étiquettes non indexées
      for (const e of this._entries) {
        const d = e.def;
        if (d && d.r1 && d.a1) {
          const out = { r1: d.r1, a1: d.a1 };
          if (d.r2 && d.a2) Object.assign(out, { r2: d.r2, a2: d.a2 });
          labels[e.key] = out;
        } else {
          delete labels[e.key];
        }
      }
      return labels;
    },

    /** Clés dont la définition diffère de ce qui est enregistré. */
    _dirtyKeys() {
      const saved = AMGT4CEM_PeLabelAnchors.all();
      const now = this._currentLabels();
      return [...new Set([...Object.keys(saved), ...Object.keys(now)])].filter((k) => JSON.stringify(saved[k] || null) !== JSON.stringify(now[k] || null));
    },

    /**
     * Enregistre toutes les définitions dans l'application. `report(msg)` affiche
     * un message à l'endroit voulu. Retourne true si l'enregistrement a réussi.
     */
    async _saveShared(report) {
      if (!AMGT4CEM_PeLabelAnchors.isSaveConfigured()) {
        report(
          "Enregistrement impossible : le relais n'est pas configuré (peLabelAnchorsRelayUrl dans config.js, voir relay/README.md). " +
          'En attendant, « Exporter JSON » garde une copie.'
        );
        return false;
      }
      // Code saisi dans ⚙ Paramètres > Serveur (gardé le temps de l'onglet), sinon demandé ici.
      let code = AMGT4CEM_PeLabelAnchors.getAdminCode();
      if (!code) {
        code = prompt("Code administrateur (celui du relais d'enregistrement) :");
        if (!code) return false;
      }
      try {
        report('Enregistrement…');
        await AMGT4CEM_PeLabelAnchors.save(this._currentLabels(), code);
        AMGT4CEM_PeLabelAnchors.setAdminCode(code);
        report('Enregistré dans l\'application (visible par tous après le redéploiement du site, ~1 min).');
        return true;
      } catch (err) {
        AMGT4CEM_PeLabelAnchors.setAdminCode(''); // un code refusé ne doit pas rester en mémoire
        report(err.message);
        return false;
      }
    },

    // ---- Bouton et panneau d'administration ----------------------------------------

    _buildToggleButton() {
      if (!this.isAdmin()) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'amgt-ple-toggle-btn';
      btn.textContent = '✥ Étiquettes planches';
      btn.title = 'Édition des références de planche (administrateurs)';
      btn.addEventListener('click', () => (this._panel ? this._closeAdminPanel() : this._openAdminPanel()));
      document.body.appendChild(btn);
      this._toggleBtn = btn;
    },

    _closeAdminPanel() {
      if (this._edit || !this._panel) return;
      this._panel.remove();
      this._panel = null;
      if (this._toggleBtn) this._toggleBtn.classList.remove('amgt-ple-active');
    },

    _openAdminPanel() {
      if (this._edit) return;
      this._toggleBtn.classList.add('amgt-ple-active');
      const panel = document.createElement('div');
      panel.className = 'amgt-ple-panel';
      panel.innerHTML = `
        <h3>✥ Étiquettes de planches</h3>
        <p>Affichez la couche « Plans d'ensemble », puis <b>cliquez dans le texte</b> d'une référence de planche :
        la bulle d'info propose l'icône « déplacer ».</p>
        <p class="amgt-ple-count"></p>
        <p class="amgt-ple-flash" hidden></p>
        <div class="amgt-ple-actions">
          <button type="button" class="amgt-ple-primary" data-action="save">Enregistrer dans l'application</button>
          <button type="button" data-action="export">Exporter JSON</button>
          <label class="amgt-ple-import-btn">Importer JSON<input type="file" accept="application/json" data-action="import" /></label>
          <button type="button" data-action="reset-all">Tout réinitialiser</button>
          <button type="button" data-action="close">Fermer</button>
          <button type="button" data-action="quit" title="Recharge la page : l'application revient en mode normal">Quitter l'édition</button>
        </div>`;
      document.body.appendChild(panel);
      this._panel = panel;
      this._refreshAdminPanel();
      panel.querySelector('[data-action="save"]').addEventListener('click', async () => {
        await this._saveShared((m) => this._flash(m));
        this._refreshAdminPanel(true);
      });
      panel.querySelector('[data-action="export"]').addEventListener('click', () => this._exportJson());
      panel.querySelector('[data-action="import"]').addEventListener('change', (e) => this._importJson(e));
      panel.querySelector('[data-action="reset-all"]').addEventListener('click', () => this._resetAll());
      panel.querySelector('[data-action="close"]').addEventListener('click', () => this._closeAdminPanel());
      panel.querySelector('[data-action="quit"]').addEventListener('click', () => {
        const dirty = this._dirtyKeys().length;
        if (dirty && !confirm(`${dirty} modification(s) non enregistrée(s) seront perdues. Quitter l'édition ?`)) return;
        window.location.reload();
      });
    },

    /** `keepFlash` : ne pas masquer le message qu'on vient d'afficher. */
    _refreshAdminPanel() {
      if (!this._panel || this._edit) return;
      const el = this._panel.querySelector('.amgt-ple-count');
      if (!el) return;
      const dirty = this._dirtyKeys().length;
      el.textContent = `${this._entries.length} étiquette(s) affichée(s) · ${dirty ? `${dirty} modification(s) NON enregistrée(s)` : 'tout est enregistré'}`;
    },

    _resetAll() {
      if (!confirm("Remettre TOUTES les étiquettes à leur position/orientation d'origine (PDF) ? (À enregistrer ensuite pour que ce soit partagé.)")) return;
      for (const entry of this._entries) {
        entry.def = null;
        this._syncPose(entry);
      }
      this._refreshAdminPanel();
    },

    _exportJson() {
      const out = this._entries.map((e) => ({ key: e.key, code: e.code, def: e.def && e.def.r1 && e.def.a1 ? e.def : null, lat: e.lat, lng: e.lng, ref: e.ref, angle: e.angle }));
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
            this._syncPose(entry);
          }
          this._refreshAdminPanel();
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
