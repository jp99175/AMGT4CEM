/**
 * Plugin "pe-label-editor" — UN SEUL mode édition, pour les références de planche
 * (PE_label, ex. "1000-236") ET les numéros d'interstation (couche « Numéros
 * interstation », voir src/interstation.js). Activé depuis ⚙ Paramètres > Fonds de
 * plan ; le bouton « ✥ Mode édition » (en bas à droite) affiche/masque le panneau
 * de suivi (aide, compteurs, enregistrement 💾, annulation ↶, sortie du mode).
 *
 * GESTE COMMUN : au survol, l'étiquette modifiable est mise en surbrillance ; un
 * PREMIER clic la sélectionne, le SECOND lance sa modification. L'étape en cours
 * s'affiche en haut à gauche de la page, sous le menu carte, avec ses boutons :
 * Retour, Suivant, Annuler (la modification en cours), Terminer.
 *
 * PLANCHES — quatre choix :
 *   1. point de référence du texte (R1) : l'un des 8 points de sa boîte —
 *      4 coins et 4 milieux de bord ;
 *   2. point d'ancrage (A1) sur la planche : un point remarquable de son
 *      cadre (voir _remarkablePoints). R1 est posé sur A1 ;
 *   3. second point de référence du texte (R2), un autre des 8 ;
 *   4. un autre point remarquable de la planche (A2).
 * Les quatre choix sont INDISPENSABLES (« Terminer » les exige ; « Suivant » garde la valeur
 * déjà enregistrée). L'orientation en découle : R1 (= A1), R2 et A2 sont alignés, par la
 * rotation LA MOINS GRANDE de la boîte de texte (texte toujours lisible).
 * Ce calcul d'affichage est fait par l'application elle-même
 * (AMGT4CEM_ScaledText.setDefinition, scaledText.js) : le plugin ne fait que
 * l'interface de choix et l'enregistrement.
 *
 * TRONÇONS — deux étapes :
 *   1. déplacer le texte, PARALLÈLEMENT au trajet du pointeur : on appuie
 *      n'importe où sur la carte (souris ou doigt) et on glisse, le texte suit le
 *      même trajet (la carte est figée pendant cette étape ; texte horizontal) ;
 *   2. identifier le tronçon auquel il se raccroche : le survol d'un tunnel
 *      allume son axe (ligne de construction, voir interstation.js), un clic le
 *      choisit (la carte est libre). Sans choix, le rattachement automatique
 *      (contour le plus proche) s'applique ; l'axe du tronçon actuel est toujours
 *      montré (violet). La ligne de repère rejoint le milieu de l'axe du tronçon.
 *
 * ENREGISTREMENT PARTAGÉ : les définitions des planches vivent dans
 * data/fond-de-plan/etiquettes-planches.json, celles des tronçons dans
 * data/fond-de-plan/etiquettes-troncons.json (dépôt, Lambert 72), lus par
 * l'application pour tous les visiteurs (peLabelAnchors.js, interstation.js).
 * « Enregistrer » envoie les deux (celui qui a des modifications) au relais
 * serveur (relay/, route /shared/fond-de-plan/<fichier>) qui écrit le fichier
 * dans le dépôt ; il faut le code
 * administrateur du relais. Tant que le relais n'est pas déployé (config.js,
 * peLabelAnchorsRelayUrl), l'enregistrement est impossible : l'export JSON
 * sert de solution de repli manuelle. Rien n'est gardé dans localStorage.
 *
 * ACCÈS RÉSERVÉ : à terme réservé aux administrateurs, en mode « édition ».
 * Ce plugin n'est chargé que par sa page de lancement ou à la demande depuis les
 * paramètres ; `isAdmin()` ci-dessous est le point de branchement prévu pour le
 * contrôle réel (il masque les commandes quand il renvoie false), en plus du
 * code administrateur exigé par le relais à l'enregistrement.
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

  // Tolérance ~1 cm : un point enregistré en Lambert (au mm) puis relu ne retombe pas exactement sur le point remarquable d'origine.
  const sameLatLng = (v, c) => !!v && Math.abs(v[0] - c.lat) < 1e-7 && Math.abs(v[1] - c.lng) < 1e-7;
  const clone = (v) => (v ? JSON.parse(JSON.stringify(v)) : v);

  const PeLabelEditor = {
    _map: null,
    _entries: [], // { key, kind: 'pe'|'ist', code, marker, span, def, lat, lng, angle, ref } — def : { r1, a1, r2?, a2? } (planche) ou { x, y, tunnel } (tronçon, Lambert 72)
    _byKey: {}, // key -> entrée
    _planches: [], // [{ code, ring: [[x, y], ...] }] — Lambert, anneau non refermé
    _undoStack: [], // instantanés de l'état des étiquettes { pe, ist } pris AVANT chaque opération terminée de la session (modification, création, suppression, réinitialisation), le dernier en haut : annulables un à un
    _addMode: null, // création d'une étiquette de planche en cours : choix de la planche (survol + clic)
    _selected: null, // étiquette sélectionnée par un premier clic (le second lance sa modification)
    _edit: null, // session de modification en cours
    _toggleBtn: null, // bouton « ✥ Mode édition »
    _panel: null, // panneau de suivi (aide, compteurs, enregistrement), masqué par défaut
    _bar: null, // étape en cours et ses boutons, en haut à gauche sous le menu carte

    /** Réservé aux administrateurs : voir src/admin.js (futur mot de passe administrateur). */
    isAdmin() {
      return AMGT4CEM_Admin.isAdmin();
    },

    /**
     * Lance le mode édition (appelé par ⚙ Paramètres > Fonds de plan, qui charge ce plugin à la
     * demande) : affiche le bouton « ✥ Mode édition » et, une fois, son panneau (l'aide).
     */
    open() {
      if (!this.isAdmin()) return;
      if (!this._map) {
        setTimeout(() => this.open(), 300); // l'application n'a pas fini de construire ses couches
        return;
      }
      if (!this._panel) this._openAdminPanel();
    },

    init() {
      this._waitForApp(() => {
        this._map = this._findMap();
        if (!this._map) {
          console.error('[pe-label-editor] Carte Leaflet introuvable, plugin non démarré.');
          return;
        }
        this._suppressAppBubbles();
        this._map.on('click', () => {
          if (!this._edit && this._selected) this._select(null); // clic ailleurs sur la carte : désélection
        });
        this._loadPlanches();
        this._buildToggleButton();
        this._adaptToolbar();
        // Les étiquettes n'existent dans le DOM que quand leur couche (« Plans
        // d'ensemble », « Numéros interstation ») est affichée, ce qui peut
        // arriver bien après le chargement — et une couche reconstruite
        // (décochée puis recochée) recrée ses marqueurs : on regarde
        // périodiquement, à peu de frais (marqueur déjà indexé = ignoré).
        this._ensureIndexed();
        this._autoIndexInterval = setInterval(() => this._ensureIndexed(), 1500);
      });
    },

    /**
     * Mode édition : plus d'infobulles de l'application (popups des planches,
     * stations, points, couches UrbIS Topo ; info-bulles Leaflet), qui
     * gênent le choix des points. Le patch dure jusqu'au rechargement de la
     * page (« Quitter l'édition »).
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

    /**
     * Indexe les étiquettes affichées (références de planche, numéros
     * d'interstation) : une fois chacune, et à nouveau si leur marqueur a été
     * reconstruit (couche masquée puis recochée) — l'entrée, avec sa
     * définition éventuellement non enregistrée, est alors rattachée au nouveau
     * marqueur. Leur définition partagée est déjà appliquée par l'application.
     * Retourne true si une entrée a été créée ou rattachée.
     */
    _ensureIndexed() {
      const sources = [];
      AMGT4CEM_MapMenu._metroLayers.PE_label.eachLayer((marker) => sources.push([marker, 'pe']));
      for (const marker of AMGT4CEM_Interstation.markers()) sources.push([marker, 'ist']);
      let changed = false;
      // Étiquettes supprimées (ou retirées par une annulation) : leur entrée disparaît avec leur marqueur.
      const live = new Set(sources.map(([marker]) => marker._amgtKey));
      for (const entry of [...this._entries]) {
        if (live.has(entry.key)) continue;
        this._dropEntry(entry);
        changed = true;
      }
      for (const [marker, kind] of sources) {
        const span = marker.getElement() && marker.getElement().querySelector('.amgt-scaled-text');
        if (!span || !marker._amgtKey) continue;
        let entry = this._byKey[marker._amgtKey];
        if (entry && entry.marker === marker) continue; // déjà indexée
        const origColor = getComputedStyle(span).color; // couleur d'origine du texte (orange des références de planche, couleur de la couche pour les interstations)
        const origInline = span.style.color; // …telle que posée par l'application (style en ligne), à restituer
        if (entry) {
          Object.assign(entry, { marker, span, origColor, origInline }); // marqueur reconstruit : on garde la définition de l'entrée
        } else {
          entry = {
            key: marker._amgtKey, // « code#rang » (planches, metroLayer.js) ou « numéro#rang » (interstations, interstation.js)
            kind,
            code: span.textContent.trim(),
            marker,
            span,
            def: kind === 'ist' ? AMGT4CEM_Interstation.getDef(marker._amgtKey) : AMGT4CEM_ScaledText.getDefinition(marker),
            origColor,
            origInline,
          };
          this._byKey[entry.key] = entry;
          this._entries.push(entry);
        }
        entry.marker.on('add', () => this._bindLabel(entry)); // Leaflet recrée le DOM quand la couche est masquée puis réaffichée
        this._bindLabel(entry);
        this._syncPose(entry);
        changed = true;
      }
      if (changed) this._refreshAdminPanel();
      return changed;
    },

    _dropEntry(entry) {
      this._entries = this._entries.filter((e) => e !== entry);
      delete this._byKey[entry.key];
      if (this._selected === entry) this._selected = null;
    },

    /** Applique la définition courante de l'entrée via l'application, et relit la pose obtenue. */
    _syncPose(entry) {
      let pose;
      if (entry.kind === 'ist') {
        // Tronçon : position du texte et tronçon de rattachement (ligne de repère), appliqués par interstation.js.
        AMGT4CEM_Interstation.apply(entry.marker, entry.def);
        pose = AMGT4CEM_ScaledText.getPose(entry.marker);
      } else {
        pose = AMGT4CEM_ScaledText.setDefinition(entry.marker, entry.def);
      }
      if (!pose) return;
      entry.lat = pose.latlng.lat;
      entry.lng = pose.latlng.lng;
      entry.angle = pose.angle;
      entry.ref = pose.ref;
      this._applyColor(entry);
    },

    /**
     * En mode édition (ce plugin), une étiquette repositionnée — définition
     * avec au moins R1 et A1 (planche), ou définition enregistrée (tronçon) — est affichée dans la couleur chromatiquement
     * opposée à sa couleur d'origine : on voit d'un coup d'œil lesquelles ont
     * été modifiées. La page normale de l'appli ne charge pas ce plugin et
     * garde la couleur d'origine.
     */
    _applyColor(entry) {
      if (!entry.span) return;
      const moved = entry.kind === 'ist' ? !!entry.def : !!(entry.def && entry.def.r1 && entry.def.a1);
      entry.span.style.color = moved ? complementaryColor(entry.origColor) : entry.origInline;
    },

    // ---- Clic dans le texte : premier clic = sélection, second = modification ------

    /**
     * Le `<span>` du texte a `pointer-events: none` dans le CSS de l'appli
     * (voulu : un clic doit traverser jusqu'à la planche). Le plugin pose un
     * style en ligne sur CET élément seulement, et se ré-abonne à chaque `add`.
     * La classe `amgt-ple-editable` met le texte en surbrillance au survol.
     */
    _bindLabel(entry) {
      const span = entry.marker.getElement() && entry.marker.getElement().querySelector('.amgt-scaled-text');
      if (!span) return;
      entry.span = span;
      this._applyColor(entry); // le DOM a pu être recréé : la couleur d'origine est revenue
      if (!this.isAdmin()) return;
      span.classList.add('amgt-ple-editable');
      span.classList.toggle('amgt-ple-selected', this._selected === entry);
      span.style.pointerEvents = 'auto';
      span.style.cursor = 'pointer';
      if (span._amgtPleBound) return;
      span._amgtPleBound = true;
      span.addEventListener('click', (e) => {
        L.DomEvent.stopPropagation(e); // pas de clic traversant vers la planche en dessous
        L.DomEvent.preventDefault(e);
        this._onLabelClick(entry);
      });
    },

    /** Premier clic : sélection ; second clic sur la même étiquette : début de sa modification. */
    _onLabelClick(entry) {
      if (this._edit || this._addMode) return; // une modification ou une création est déjà en cours
      if (this._selected === entry) this._startEdit(entry);
      else this._select(entry);
    },

    _select(entry) {
      if (this._selected && this._selected.span) this._selected.span.classList.remove('amgt-ple-selected');
      this._selected = entry;
      if (entry && entry.span) entry.span.classList.add('amgt-ple-selected');
      this._renderBar();
    },

    /** Désignation d'une étiquette dans l'interface. */
    _describe(entry) {
      return entry.kind === 'ist' ? `Interstation ${entry.code}` : `Planche ${entry.code}`;
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

    /** opts : { created, pre } — étiquette tout juste créée (annuler la supprime) et instantané d'avant sa création. */
    _startEdit(entry, opts = {}) {
      if (entry.kind === 'ist') return this._startEditIst(entry, opts);
      const planche = this._planchOf(entry);
      if (!planche) {
        alert('Contour de la planche introuvable (Metro.shp pas encore chargé) : réessayez dans un instant.');
        return;
      }
      const backup = clone(entry.def);
      entry.def = entry.def ? { ...entry.def } : {};
      const cands = this._remarkablePoints(planche).map((p) => {
        const ll = AMGT4CEM_CRS.lambertToLatLng([p.x, p.y]);
        return { lat: ll.lat, lng: ll.lng, kind: p.kind };
      });
      this._edit = { kind: 'pe', entry, backup, pre: opts.pre || this._snapshot(), created: !!opts.created, cands, slot: 0, refDots: [], candMarkers: [], line: null, history: [] };
      this._edit.slot = Math.max(0, SLOTS.findIndex((s) => !entry.def[s.id]));
      this._showRefDots(entry);
      this._showCandidates();
      this._refreshEdit();
      this._refreshAdminPanel(); // 💾 et ↶ sont grisés pendant une modification
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
      // Le choix d'un point fait passer à l'étape SUIVANTE, que celle-ci ait déjà une valeur enregistrée ou non
      // (sinon : « Suivant » pour garder la valeur enregistrée). À la dernière étape, on y reste (« Terminer »).
      ed.slot = Math.min(ed.slot + 1, SLOTS.length - 1);
      this._refreshEdit();
    },

    /** « Retour » : annule le positionnement du dernier point choisi (et revient à son étape) ; sans point choisi, revient à l'étape précédente. */
    _back() {
      const ed = this._edit;
      if (!ed) return;
      const last = ed.history.pop();
      if (last) {
        ed.entry.def = last.def;
        ed.slot = last.slot;
        this._syncPose(ed.entry);
      } else if (ed.slot > 0) {
        ed.slot--;
      }
      this._refreshEdit();
    },

    /** « Suivant » : étape suivante ; les quatre choix sont indispensables (garder la valeur déjà enregistrée suffit). */
    _nextStep() {
      const ed = this._edit;
      if (!ed || ed.slot >= SLOTS.length - 1) return;
      if (!ed.entry.def[SLOTS[ed.slot].id]) return this._flash("Choisissez d'abord ce point : les quatre choix sont indispensables.");
      ed.slot++;
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
      this._renderBar();
    },

    /** Terminer (planches) : garde la définition ; il faut au moins les points 1 et 2. */
    _finishEdit() {
      const ed = this._edit;
      if (!ed) return;
      if (ed.kind === 'pe') {
        const d = ed.entry.def;
        if (!d.r1 || !d.a1 || !d.r2 || !d.a2) return this._flash('Les quatre choix sont indispensables (point de référence, ancrage, second point de référence, second point du cadre) : complétez-les, ou « Annuler ».');
      }
      // Historique de la session (↶ du panneau) : état d'avant cette opération, si elle a changé quelque chose.
      if (JSON.stringify(this._snapshot()) !== JSON.stringify(ed.pre)) this._undoStack.push(ed.pre);
      this._endEdit(false);
    },

    /** Remet l'étiquette en cours dans l'état qu'elle avait au début de cette modification (sans quitter la modification). */
    _resetCurrent() {
      const ed = this._edit;
      if (!ed) return;
      if (ed.kind === 'ist') {
        ed.entry.def = clone(ed.backup);
        this._syncPose(ed.entry);
        this._showCurrentAxis();
        this._renderBar();
      } else {
        ed.entry.def = clone(ed.backup) || {};
        ed.history = [];
        this._syncPose(ed.entry);
        ed.slot = 0;
        this._refreshEdit();
      }
    },

    // ---- Barre d'étape (en haut à gauche, sous le menu carte) ----------------------

    _buildBar() {
      const bar = document.createElement('div');
      bar.className = 'amgt-ple-bar';
      bar.innerHTML = `
        <h3 class="amgt-ple-bar-title"></h3>
        <ol class="amgt-ple-steps"></ol>
        <p class="amgt-ple-result"></p>
        <p class="amgt-ple-flash" hidden></p>
        <div class="amgt-ple-bar-actions">
          <button type="button" data-action="delete" aria-label="Supprimer l'étiquette" title="Supprimer cette étiquette (confirmation demandée ; annulable avec ↶ tant que la page n'est pas rechargée)">🗑</button>
          <button type="button" data-action="back" title="Annule le dernier choix, ou revient à l'étape précédente">◀ Retour</button>
          <button type="button" data-action="next" title="Passe à l'étape suivante">Suivant ▶</button>
          <button type="button" data-action="reset" title="Remet l'étiquette dans l'état du début de cette modification">↺</button>
          <button type="button" data-action="cancel" title="Abandonne la modification en cours : aucun changement">Annuler</button>
          <button type="button" class="amgt-ple-primary" data-action="apply" title="Garde le résultat et termine">✓ Terminer</button>
        </div>`;
      document.body.appendChild(bar);
      this._bar = bar;
      const on = (action, fn) => bar.querySelector(`[data-action="${action}"]`).addEventListener('click', fn);
      on('back', () => (this._edit.kind === 'ist' ? this._setIstStep(this._edit.step - 1) : this._back()));
      on('next', () => (this._edit.kind === 'ist' ? this._setIstStep(this._edit.step + 1) : this._nextStep()));
      on('reset', () => this._resetCurrent());
      on('delete', () => this._deleteSelected());
      on('cancel', () => (this._addMode ? this._cancelAdd() : this._edit ? this._endEdit(true) : this._select(null)));
      on('apply', () => this._finishEdit());
      // Un appui sur la barre ne doit rien faire à la carte en dessous.
      for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'wheel']) bar.addEventListener(type, (e) => e.stopPropagation());
    },

    /**
     * Étape EN COURS seulement (pas tout le process), présentée comme une étape du panneau d'étapes :
     * titre de l'étiquette, puis l'étape surlignée — titre en gras, « ✓ valeur » en vert si elle est
     * déjà renseignée, consigne en gris. Les boutons Retour / Suivant changent d'étape.
     * steps : [{ title, value, hint }], active : index de l'étape en cours (-1 : aucune).
     */
    _fillSteps(heading, steps, active, result) {
      const bar = this._bar;
      bar.querySelector('.amgt-ple-bar-title').textContent = heading;
      const ol = bar.querySelector('.amgt-ple-steps');
      ol.textContent = '';
      const st = steps[active];
      if (st) {
        const li = document.createElement('li');
        li.classList.add('amgt-ple-active');
        if (st.value) li.classList.add('amgt-ple-done');
        li.innerHTML = '<b></b><span></span><em></em>';
        li.querySelector('b').textContent = st.title;
        li.querySelector('span').textContent = st.value ? `✓ ${st.value}` : '';
        li.querySelector('em').textContent = st.hint;
        ol.appendChild(li);
      }
      bar.querySelector('.amgt-ple-result').textContent = result || '';
    },

    /** Affiche / met à jour la barre : étiquette sélectionnée (en attente d'un second clic) ou étapes de la modification en cours. */
    _renderBar() {
      const ed = this._edit;
      const entry = ed ? ed.entry : this._selected;
      if (!this.isAdmin() || (!entry && !this._addMode)) {
        if (this._bar) this._bar.hidden = true;
        return;
      }
      if (!this._bar) this._buildBar();
      const bar = this._bar;
      bar.hidden = false;
      const buttons = (names) => {
        for (const b of bar.querySelectorAll('.amgt-ple-bar-actions button')) b.hidden = !names.includes(b.dataset.action);
      };
      if (this._addMode) {
        this._fillSteps("Nouvelle étiquette de planche", [], -1, "Survolez la planche concernée (elle s'illumine), puis cliquez dessus.");
        buttons(['cancel']);
        bar.querySelector('[data-action="cancel"]').textContent = 'Annuler';
        return;
      }
      if (!ed) {
        this._fillSteps(`${this._describe(entry)} — sélectionné`, [], -1, 'Cliquez à nouveau sur le texte pour le modifier, ou supprimez-la.');
        buttons(['delete', 'cancel']);
        bar.querySelector('[data-action="cancel"]').textContent = 'Désélectionner';
        return;
      }
      bar.querySelector('[data-action="cancel"]').textContent = 'Annuler';
      buttons(['back', 'next', 'reset', 'cancel', 'apply']);
      if (ed.kind === 'ist') return this._renderBarIst(entry);
      const def = entry.def;
      const steps = SLOTS.map((slot) => {
        let value = '';
        if (def[slot.id]) {
          if (slot.kind === 'ref') value = REFS[def[slot.id]].label;
          else {
            const c = ed.cands.find((k) => sameLatLng(def[slot.id], k));
            value = c ? KIND_LABEL[c.kind] : 'point choisi';
          }
        }
        return { title: slot.title, value, hint: slot.hint };
      });
      let result = '';
      if (def.r1 && def.a1 && def.r2 && def.a2) result = `Rotation : ${entry.angle.toFixed(1)}° (points 1, 3 et 4 alignés, rotation minimale)`;
      else if (def.r1 && def.a1) result = "Position définie. Choisissez les points 3 et 4 : l'orientation est indispensable.";
      this._fillSteps(`Étiquette de la planche ${entry.code}`, steps, ed.slot, result);
      bar.querySelector('[data-action="back"]').disabled = !ed.history.length && ed.slot === 0;
      bar.querySelector('[data-action="next"]').disabled = ed.slot >= SLOTS.length - 1;
    },

    /** Message bref dans la barre (ou, sans barre, dans le panneau de suivi). */
    _flash(msg) {
      const el = this._bar && !this._bar.hidden && this._bar.querySelector('.amgt-ple-flash');
      if (!el) return this._panelFlash(msg);
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => (el.hidden = true), 5000);
    },

    _panelFlash(msg) {
      const el = this._panel && this._panel.querySelector('.amgt-ple-flash');
      if (!el) return;
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(this._panelFlashTimer);
      this._panelFlashTimer = setTimeout(() => (el.hidden = true), 8000);
    },

    _endEdit(cancel) {
      const ed = this._edit;
      if (!ed) return;
      if (ed.kind === 'ist') return this._endEditIst(cancel);
      for (const dot of ed.refDots) dot.remove();
      for (const m of ed.candMarkers) this._map.removeLayer(m);
      if (ed.line) this._map.removeLayer(ed.line);
      this._edit = null;
      if (cancel && ed.created) this._removeLabel(ed.entry); // annuler une création : l'étiquette disparaît sans laisser de trace
      else {
        // Annuler, ou définition sans position (R1+A1 manquants) : retour à l'état d'avant la session.
        if (cancel || !ed.entry.def.r1 || !ed.entry.def.a1) ed.entry.def = ed.backup;
        this._syncPose(ed.entry);
      }
      this._select(null); // la modification est terminée : plus de sélection
      this._refreshAdminPanel();
    },

    // ---- Modification d'une étiquette de tronçon : déplacer le texte, choisir le tronçon ------

    /**
     * Deux étapes : 1. déplacer le texte (carte figée, glissement n'importe où) ; 2. choisir le
     * tronçon de rattachement — le survol d'un tunnel allume son axe, un clic le choisit (carte
     * libre). La définition { x, y, tunnel } (Lambert 72) est appliquée à l'écran au fil de l'eau
     * (AMGT4CEM_Interstation.apply), jamais enregistrée avant « Enregistrer ».
     */
    _startEditIst(entry, opts = {}) {
      if (!AMGT4CEM_MapMenu._metroLayers.MT || !AMGT4CEM_MapMenu._metroLayers.MT._map) {
        alert('Le réseau (couche Tunnels) doit être affiché pour choisir un tronçon : cochez « Métro » dans le menu ☰ Carte.');
        return;
      }
      const backup = clone(entry.def);
      entry.def = { ...entry.def };
      this._edit = { kind: 'ist', entry, backup, pre: opts.pre || this._snapshot(), created: !!opts.created, step: 0, current: [], hover: [], hoverPoly: null, polyHandlers: [], gestureCleanup: null, panMode: false, dragging: false, suppressClick: false };
      this._showCurrentAxis();
      this._enableMoveGesture();
      this._enableTunnelPick();
      this._setIstStep(0);
      this._refreshAdminPanel(); // 💾 et ↶ sont grisés pendant une modification
    },

    /** Étape 0 : déplacer le texte (carte figée) ; étape 1 : choisir le tronçon (carte libre). */
    _setIstStep(step) {
      const ed = this._edit;
      if (!ed || step < 0 || step > 1) return;
      ed.step = step;
      ed.setPanMode(step === 1);
      if (step === 0) this._hoverTunnel(null);
      this._renderBar();
    },

    /** Axe du tronçon actuel (violet, pointillé) et son milieu, point d'arrivée de la ligne de repère. */
    _showCurrentAxis() {
      const ed = this._edit;
      for (const l of ed.current) this._map.removeLayer(l);
      ed.current = this._axisLayers(ed.entry.marker._amgtTunnel, { color: '#8e24aa', weight: 2, dashArray: '8 4' }, 5);
    },

    /** [polyligne de l'axe, rond du milieu] d'un tronçon, ajoutés à la carte. */
    _axisLayers(tunnel, lineStyle, radius) {
      const line = L.polyline(tunnel.axis.map(AMGT4CEM_CRS.lambertToLatLng), { ...lineStyle, interactive: false }).addTo(this._map);
      const centre = L.circleMarker(AMGT4CEM_CRS.lambertToLatLng(tunnel.center), { radius, color: lineStyle.color, fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(this._map);
      return [line, centre];
    },

    /**
     * Déplacer le texte PARALLÈLEMENT au trajet du pointeur : appui (souris ou doigt) n'importe
     * où sur la carte, puis glissement — le texte se déplace du même vecteur que le pointeur, sans
     * qu'il faille le saisir (le doigt ne le cache pas). La carte est figée pendant la modification
     * (bouton « Déplacer la carte » du panneau pour la faire glisser). Un appui sans glissement
     * (moins de 5 px) reste un simple clic : il sert à choisir un tronçon.
     */
    _enableMoveGesture() {
      const ed = this._edit;
      const map = this._map;
      const box = map.getContainer();
      const wasDraggable = map.dragging.enabled();
      const prevTouchAction = box.style.touchAction;
      map.dragging.disable();
      box.style.touchAction = 'none'; // le navigateur ne doit pas prendre le glissement du doigt pour un défilement
      let drag = null;
      const move = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const delta = map.mouseEventToContainerPoint(e).subtract(drag.start);
        if (!drag.moved && Math.hypot(delta.x, delta.y) < 5) return;
        drag.moved = true;
        ed.dragging = true;
        this._moveIst(ed.entry, map.containerPointToLatLng(drag.origin.add(delta)));
      };
      const up = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        if (drag.moved) {
          ed.suppressClick = true; // le clic qui suit le relâchement ne doit pas choisir le tunnel sous le pointeur
          setTimeout(() => (ed.suppressClick = false), 150);
        }
        ed.dragging = false;
        drag = null;
      };
      const down = (e) => {
        if (ed.panMode || e.button) return; // carte libre, ou autre bouton que le principal
        if (e.target.closest && e.target.closest('.leaflet-control, .leaflet-popup')) return;
        drag = {
          id: e.pointerId,
          start: map.mouseEventToContainerPoint(e),
          origin: map.latLngToContainerPoint(AMGT4CEM_ScaledText.getPose(ed.entry.marker).latlng), // le texte est ancré par son centre
          moved: false,
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
      };
      box.addEventListener('pointerdown', down);
      ed.setPanMode = (on) => {
        ed.panMode = on;
        if (on) map.dragging.enable();
        else map.dragging.disable();
        box.style.touchAction = on ? prevTouchAction : 'none';
      };
      ed.gestureCleanup = () => {
        box.removeEventListener('pointerdown', down);
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        if (wasDraggable) map.dragging.enable();
        box.style.touchAction = prevTouchAction;
      };
    },

    _moveIst(entry, latlng) {
      const l = AMGT4CEM_CRS.latLngToLambert(latlng);
      entry.def = { x: Math.round(l.x * 100) / 100, y: Math.round(l.y * 100) / 100, tunnel: entry.def.tunnel };
      this._syncPose(entry);
      this._renderBar();
    },

    /** Survol d'un tunnel : son axe s'allume ; clic : il devient le tronçon de l'étiquette. */
    _enableTunnelPick() {
      const ed = this._edit;
      AMGT4CEM_MapMenu._metroLayers.MT.eachLayer((poly) => {
        if (!poly._amgtTunnelId) return;
        const over = () => this._hoverTunnel(poly);
        const out = () => this._hoverTunnel(null);
        const click = (e) => {
          L.DomEvent.stopPropagation(e);
          if (ed.step !== 1 || ed.suppressClick) return; // seulement à l'étape « tronçon » ; et pas le relâchement d'un glissement
          this._pickTunnel(poly._amgtTunnelId);
        };
        poly.on('mouseover', over);
        poly.on('mouseout', out);
        poly.on('click', click);
        ed.polyHandlers.push({ poly, over, out, click });
      });
    },

    _hoverTunnel(poly) {
      const ed = this._edit;
      if (!ed || (poly && (ed.dragging || ed.step !== 1))) return; // l'axe orange ne s'allume qu'à l'étape « tronçon »
      for (const l of ed.hover) this._map.removeLayer(l);
      ed.hover = [];
      if (ed.hoverPoly) ed.hoverPoly.setStyle({ color: AMGT4CEM_METRO_TYPES.MT.color, weight: AMGT4CEM_METRO_TYPES.MT.weight });
      ed.hoverPoly = poly;
      if (poly) {
        poly.setStyle({ color: '#ff9800', weight: 3 });
        ed.hover = this._axisLayers(AMGT4CEM_Interstation.tunnelById(poly._amgtTunnelId), { color: '#ff9800', weight: 5, opacity: 0.95 }, 6);
      }
      this._renderBar();
    },

    _pickTunnel(id) {
      const entry = this._edit.entry;
      entry.def = { ...entry.def, tunnel: String(id) }; // le texte reste où il est
      this._syncPose(entry);
      this._showCurrentAxis();
      this._renderBar();
    },

    /** Étapes d'une étiquette de tronçon, présentées comme celles d'une planche. */
    _renderBarIst(entry) {
      const ed = this._edit;
      const bar = this._bar;
      const tunnel = entry.marker._amgtTunnel;
      const chosen = !AMGT4CEM_Interstation.isAutoTunnel(entry.marker);
      const steps = [
        {
          title: '1. Déplacer le texte',
          value: JSON.stringify(entry.def) !== JSON.stringify(ed.backup) ? 'déplacé' : '',
          hint: "Appuyez n'importe où sur la carte (souris ou doigt) et glissez : le texte suit le même trajet. La carte est figée pendant cette étape.",
        },
        {
          title: '2. Tronçon de rattachement',
          value: `${tunnel.name}${chosen ? '' : ' (automatique)'}`,
          hint: "Survolez un tunnel : son axe s'allume (orange) ; cliquez pour le choisir. L'axe du tronçon actuel est en violet.",
        },
      ];
      const result = ed.step === 1 && ed.hoverPoly ? `Survol : ${AMGT4CEM_Interstation.tunnelById(ed.hoverPoly._amgtTunnelId).name} (axe orange) — cliquez pour le choisir.` : '';
      this._fillSteps(`Étiquette de l'interstation ${entry.code}`, steps, ed.step, result);
      bar.querySelector('[data-action="back"]').disabled = ed.step === 0;
      bar.querySelector('[data-action="next"]').disabled = ed.step === 1;
    },

    _endEditIst(cancel) {
      const ed = this._edit;
      if (!(cancel && ed.created)) {
        if (cancel) ed.entry.def = ed.backup;
        this._syncPose(ed.entry);
      }
      ed.dragging = false;
      this._hoverTunnel(null);
      for (const h of ed.polyHandlers) {
        h.poly.off('mouseover', h.over);
        h.poly.off('mouseout', h.out);
        h.poly.off('click', h.click);
      }
      for (const l of ed.current) this._map.removeLayer(l);
      if (ed.gestureCleanup) ed.gestureCleanup();
      this._edit = null;
      if (cancel && ed.created) this._removeLabel(ed.entry); // annuler une création : l'étiquette disparaît sans laisser de trace
      this._select(null); // la modification est terminée : plus de sélection
      this._refreshAdminPanel();
    },

    // ---- Instantanés, annulation, suppression --------------------------------------------

    /** État COURANT de toutes les étiquettes (modifs non enregistrées comprises) : { pe, ist }. */
    _snapshot() {
      return { pe: AMGT4CEM_MetroLayer.currentPeLabels(), ist: AMGT4CEM_Interstation.currentLabels() };
    },

    /** Remet toutes les étiquettes dans l'état d'un instantané : retire, ajoute et met à jour. */
    _restore(snap) {
      AMGT4CEM_MetroLayer.syncPeLabels(snap.pe);
      AMGT4CEM_Interstation.syncTo(snap.ist);
      this._ensureIndexed(); // entrées des étiquettes retirées / rétablies
      for (const entry of this._entries) {
        entry.def = entry.kind === 'ist' ? AMGT4CEM_Interstation.getDef(entry.key) : AMGT4CEM_ScaledText.getDefinition(entry.marker);
        this._syncPose(entry);
      }
      this._renderBar();
      this._refreshAdminPanel();
    },

    /** Retire une étiquette (carte, état courant et entrée). */
    _removeLabel(entry) {
      if (entry.kind === 'ist') AMGT4CEM_Interstation.removeLabel(entry.marker);
      else AMGT4CEM_MetroLayer.removePeLabel(entry.marker);
      this._dropEntry(entry);
    },

    /** Supprime l'étiquette sélectionnée, après confirmation (sans code administrateur). */
    _deleteSelected() {
      const entry = this._selected;
      if (!entry || this._edit || this._addMode) return;
      if (!confirm(`Supprimer l'étiquette « ${entry.code} » (${entry.kind === 'ist' ? 'tronçon' : 'planche'}) ?\n\nElle disparaît de la carte ; la suppression n'est partagée qu'après l'enregistrement (💾), et ↶ peut la rétablir tant que la page n'est pas rechargée.`)) return;
      const pre = this._snapshot();
      this._removeLabel(entry);
      this._undoStack.push(pre);
      this._select(null);
      this._refreshAdminPanel();
    },

    // ---- Création d'une étiquette (bouton « ✚ Ajouter un élément » de la barre d'outils) -----

    /** Mode édition : plus d'outil de mesure ; « ✚ Ajouter un point » devient « ✚ Ajouter un élément » (choix : étiquette de planche ou de tronçon). */
    _adaptToolbar() {
      if (!this.isAdmin()) return;
      const measure = document.getElementById('amgt-measure-btn');
      if (measure) {
        if (typeof AMGT4CEM_MeasureTool !== 'undefined') AMGT4CEM_MeasureTool.deactivate();
        measure.classList.add('amgt-hidden');
      }
      const add = document.getElementById('amgt-add-point-btn');
      if (!add) return;
      if (typeof AMGT4CEM_AddPointTool !== 'undefined') AMGT4CEM_AddPointTool.deactivate();
      add.textContent = '✚ Ajouter un élément';
      add.title = 'Ajouter une étiquette de planche ou de tronçon';
      // Phase de capture : passe avant l'écouteur de l'application (ajout de point), qu'on court-circuite.
      add.addEventListener(
        'click',
        (e) => {
          e.stopImmediatePropagation();
          e.preventDefault();
          this._toggleAddMenu(add);
        },
        true
      );
    },

    _toggleAddMenu(btn) {
      if (this._addMenu) return this._closeAddMenu();
      if (this._edit || this._addMode) return this._flash("Terminez ou annulez d'abord l'opération en cours.");
      const menu = document.createElement('div');
      menu.className = 'amgt-ple-addmenu';
      menu.innerHTML = `
        <button type="button" data-kind="pe">Étiquette de planche</button>
        <button type="button" data-kind="ist">Étiquette de tronçon</button>`;
      const r = btn.getBoundingClientRect();
      menu.style.left = `${r.left}px`;
      menu.style.top = `${r.bottom + 4}px`;
      document.body.appendChild(menu);
      this._addMenu = menu;
      for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'wheel']) menu.addEventListener(type, (e) => e.stopPropagation());
      menu.addEventListener('click', (e) => {
        const kind = e.target.dataset && e.target.dataset.kind;
        if (!kind) return;
        this._closeAddMenu();
        if (kind === 'pe') this._startAddPlanche();
        else this._startAddTroncon();
      });
      this._addMenuOutside = (e) => {
        if (!menu.contains(e.target) && e.target !== btn) this._closeAddMenu();
      };
      document.addEventListener('pointerdown', this._addMenuOutside, true);
    },

    _closeAddMenu() {
      if (!this._addMenu) return;
      this._addMenu.remove();
      this._addMenu = null;
      document.removeEventListener('pointerdown', this._addMenuOutside, true);
    },

    /** Affiche la couche d'une famille si besoin et attend qu'elle soit prête (true), ou abandonne après quelques secondes (false). */
    async _ensureLayer(id, isReady) {
      const store = AMGT4CEM_PatrimoineSelectionStore;
      if (!store.getSelection()[id]) store.toggle(id);
      for (let i = 0; i < 40; i++) {
        if (isReady()) return true;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return false;
    },

    /** Nouvelle étiquette de TRONÇON : on saisit son numéro, elle apparaît au centre de l'écran (tronçon le plus proche), puis les deux étapes habituelles. */
    async _startAddTroncon() {
      if (this._edit || this._addMode) return;
      if (!AMGT4CEM_MapMenu._metroLayers.MT || !AMGT4CEM_MapMenu._metroLayers.MT._map) {
        return alert('Le réseau (couche Tunnels) doit être affiché pour rattacher une étiquette à un tronçon : cochez « Métro » dans le menu ☰ Carte.');
      }
      const numero = await this._askInput('Numéro de la nouvelle étiquette de tronçon (chiffres, lettres, tiret ou point — ex. 243-3) :', {
        placeholder: 'Numéro',
        validate: (v) => (/^[0-9A-Za-z.-]{1,20}$/.test(v) ? '' : 'Numéro invalide : 1 à 20 caractères parmi chiffres, lettres, tiret et point.'),
      });
      if (!numero) return;
      const shown = await this._ensureLayer('numero-interstation', () => !!(AMGT4CEM_Interstation._group && AMGT4CEM_Interstation._group._map));
      if (!shown) return alert('La couche « Numéros interstation » ne s\'affiche pas : réessayez après l\'avoir cochée.');
      const pre = this._snapshot();
      const at = AMGT4CEM_CRS.latLngToLambert(this._map.getCenter());
      const x = Math.round(at.x * 100) / 100;
      const y = Math.round(at.y * 100) / 100;
      const key = AMGT4CEM_Interstation.nextKey(numero);
      AMGT4CEM_Interstation.createLabel(key, { x, y, tunnel: AMGT4CEM_Interstation.autoTunnelAt(x, y).id });
      this._ensureIndexed();
      const entry = this._byKey[key];
      if (!entry) return;
      this._select(entry);
      this._startEdit(entry, { created: true, pre });
    },

    /** Nouvelle étiquette de PLANCHE : on survole puis clique la planche concernée, puis les quatre choix habituels. */
    async _startAddPlanche() {
      if (this._edit || this._addMode) return;
      const polys = () => {
        const out = [];
        AMGT4CEM_MapMenu._metroLayers.PE.eachLayer((poly) => out.push(poly));
        return out;
      };
      const shown = await this._ensureLayer('plans-ensemble-500e', () => polys().some((p) => p._map));
      if (!shown) return alert('La couche « Plans d\'ensemble » ne s\'affiche pas : réessayez après l\'avoir cochée.');
      const handlers = [];
      for (const poly of polys()) {
        const base = { color: poly.options.color, weight: poly.options.weight, fillOpacity: poly.options.fillOpacity };
        const over = () => poly.setStyle({ color: '#ff9800', weight: 3, fillOpacity: 0.3 });
        const out = () => poly.setStyle(base);
        const click = (e) => {
          L.DomEvent.stopPropagation(e);
          this._finishAddPlanche(poly);
        };
        poly.on('mouseover', over);
        poly.on('mouseout', out);
        poly.on('click', click);
        handlers.push({ poly, over, out, click, base });
      }
      this._addMode = {
        cleanup: () => {
          for (const h of handlers) {
            h.poly.off('mouseover', h.over);
            h.poly.off('mouseout', h.out);
            h.poly.off('click', h.click);
            h.poly.setStyle(h.base);
          }
        },
      };
      this._select(null);
      this._renderBar();
    },

    _cancelAdd() {
      if (!this._addMode) return;
      this._addMode.cleanup();
      this._addMode = null;
      this._renderBar();
    },

    _finishAddPlanche(poly) {
      const code = poly._amgtSheetRef;
      if (!code) return this._flash("Cette planche n'a pas de référence : choisissez-en une autre.");
      this._addMode.cleanup();
      this._addMode = null;
      const pre = this._snapshot();
      const key = AMGT4CEM_MetroLayer.nextPeKey(code);
      AMGT4CEM_MetroLayer.addPeLabel(AMGT4CEM_MetroLayer.createPeLabel(key, null, poly.getBounds().getCenter()));
      this._ensureIndexed();
      const entry = this._byKey[key];
      if (!entry) return this._renderBar();
      this._select(entry);
      this._startEdit(entry, { created: true, pre });
    },

    // ---- Enregistrement partagé (dans l'application, via le relais) ---------------

    /** Étiquettes affichées d'un type : 'pe' (références de planche) ou 'ist' (numéros d'interstation). */
    _entriesOf(kind) {
      return this._entries.filter((e) => e.kind === kind);
    },

    /** État ENREGISTRÉ d'un type : { clé: définition }. */
    _savedLabels(kind) {
      return kind === 'ist' ? AMGT4CEM_Interstation.savedOverrides() : AMGT4CEM_PeLabelAnchors.all();
    },

    /** État COURANT d'un type (modifs, créations et suppressions non enregistrées comprises) : { clé: définition }. */
    _currentLabels(kind) {
      return kind === 'ist' ? AMGT4CEM_Interstation.currentLabels() : AMGT4CEM_MetroLayer.currentPeLabels();
    },

    /** Clés d'un type dont la définition diffère de ce qui est enregistré. */
    _dirtyKeys(kind) {
      const saved = this._savedLabels(kind);
      const now = this._currentLabels(kind);
      return [...new Set([...Object.keys(saved), ...Object.keys(now)])].filter((k) => JSON.stringify(saved[k] || null) !== JSON.stringify(now[k] || null));
    },

    /**
     * Enregistre dans l'application TOUTES les modifications : celles des planches
     * (data/fond-de-plan/etiquettes-planches.json) et celles des tronçons (…/etiquettes-troncons.json),
     * chacune seulement si elle a changé. `report(msg)` affiche un message à l'endroit voulu.
     * Retourne true si tout ce qui devait l'être a été enregistré.
     */
    async _saveShared(report) {
      const todo = ['pe', 'ist'].filter((kind) => this._dirtyKeys(kind).length);
      if (!todo.length) {
        report('Rien à enregistrer : tout est déjà enregistré.');
        return true;
      }
      if (!AMGT4CEM_PeLabelAnchors.isSaveConfigured()) {
        report(
          "Enregistrement impossible : le relais n'est pas configuré (adresse à renseigner dans ⚙ Paramètres > Serveur, voir relay/README.md). " +
          'En attendant, « Exporter JSON » garde une copie.'
        );
        return false;
      }
      // Code saisi dans ⚙ Paramètres > Serveur (champ masqué, gardé le temps de l'onglet). Pas de boîte de saisie ici : elle afficherait le code en clair.
      const code = AMGT4CEM_PeLabelAnchors.getAdminCode();
      if (!code) {
        report("Code administrateur manquant : le saisir dans ⚙ Paramètres > Serveur, puis réessayer.");
        return false;
      }
      const names = { pe: 'planches', ist: 'tronçons' };
      const done = [];
      for (const kind of todo) {
        try {
          report(`Enregistrement (${names[kind]})…`);
          if (kind === 'ist') await AMGT4CEM_Interstation.saveOverrides(this._currentLabels('ist'), code);
          else await AMGT4CEM_PeLabelAnchors.save(this._currentLabels('pe'), code);
          done.push(names[kind]);
        } catch (err) {
          if (/Code administrateur refusé/.test(err.message)) AMGT4CEM_PeLabelAnchors.setAdminCode(''); // un code refusé ne doit pas rester en mémoire
          report(`${done.length ? `Enregistré : ${done.join(', ')}. ` : ''}Échec (${names[kind]}) : ${err.message}`);
          return false;
        }
      }
      AMGT4CEM_PeLabelAnchors.setAdminCode(code);
      report(`Enregistré dans l'application (${done.join(' et ')}) — visible par tous après le redéploiement du site, ~1 min.`);
      return true;
    },

    // ---- Bouton « ✥ Mode édition » et panneau de suivi (masqué par défaut) ---------------

    _buildToggleButton() {
      if (!this.isAdmin()) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'amgt-ple-toggle-btn';
      btn.textContent = '✥ Mode édition';
      btn.title = "Aide, suivi et enregistrement des modifications d'étiquettes (administrateurs)";
      btn.addEventListener('click', () => (this._panel ? this._closeAdminPanel() : this._openAdminPanel()));
      document.body.appendChild(btn);
      this._toggleBtn = btn;
    },

    _closeAdminPanel() {
      if (!this._panel) return;
      this._panel.remove();
      this._panel = null;
      if (this._toggleBtn) this._toggleBtn.classList.remove('amgt-ple-active');
    },

    _openAdminPanel() {
      if (this._panel || !this._toggleBtn) return;
      this._toggleBtn.classList.add('amgt-ple-active');
      const panel = document.createElement('div');
      panel.className = 'amgt-ple-panel';
      panel.innerHTML = `
        <h3>✥ Mode édition</h3>
        <p>Affichez les couches « Plans d'ensemble » et/ou « Numéros interstation », puis <b>survolez</b> le texte d'un
        élément à modifier (il s'illumine). Un <b>premier clic</b> le sélectionne, un <b>second clic</b> lance sa
        modification : étapes en haut à gauche, sous le menu carte.</p>
        <ul class="amgt-ple-help">
          <li><b>Référence de planche</b> : quatre choix, tous indispensables — point de référence du texte, ancrage sur la planche, second point de référence du texte, second point du cadre (orientation).</li>
          <li><b>Numéro d'interstation</b> : déplacer le texte (glisser n'importe où sur la carte, souris ou doigt), puis choisir son tronçon (survol d'un tunnel = son axe s'allume).</li>
          <li>Dans la barre d'étape : <b>Retour</b> / <b>Suivant</b> changent d'étape, <b>Annuler</b> abandonne cette modification, <b>Terminer</b> la garde.</li>
          <li><b>Supprimer</b> : sélectionner l'étiquette (premier clic), puis 🗑 dans la barre, après confirmation. <b>Créer</b> : « ✚ Ajouter un élément » (barre d'outils), au choix une étiquette de planche (cliquer la planche, puis les quatre choix) ou de tronçon (saisir le numéro, déplacer le texte, choisir le tronçon).</li>
          <li>Ci-dessous : 💾 enregistre (grisé s'il n'y a rien à enregistrer), ↶ annule la dernière opération de la session — modification, création ou suppression (une à la fois). Rien n'est partagé avant l'enregistrement.</li>
        </ul>
        <p class="amgt-ple-count"></p>
        <p class="amgt-ple-flash" hidden></p>
        <div class="amgt-ple-actions">
          <button type="button" class="amgt-ple-icon-btn amgt-ple-primary" data-action="save" aria-label="Enregistrer" title="Enregistrer les modifications (planches et tronçons) dans l'application">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          </button>
          <button type="button" class="amgt-ple-icon-btn" data-action="undo" aria-label="Annuler la dernière modification" title="Annuler la dernière opération de la session (une à la fois)">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
          </button>
          <button type="button" data-action="quit" title="Recharge la page : l'application revient en mode normal">Quitter l'édition</button>
        </div>`;
      document.body.appendChild(panel);
      this._panel = panel;
      for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'wheel']) panel.addEventListener(type, (e) => e.stopPropagation());
      this._refreshAdminPanel();
      panel.querySelector('[data-action="save"]').addEventListener('click', async () => {
        await this._saveShared((m) => this._panelFlash(m));
        this._refreshAdminPanel();
      });
      panel.querySelector('[data-action="undo"]').addEventListener('click', () => this._undo());
      panel.querySelector('[data-action="quit"]').addEventListener('click', () => {
        const dirty = this._dirtyKeys('pe').length + this._dirtyKeys('ist').length;
        if (dirty && !confirm(`${dirty} modification(s) non enregistrée(s) seront perdues. Quitter l'édition ?`)) return;
        window.location.reload();
      });
    },

    /** Compteurs du panneau de suivi, et pastille « modifications non enregistrées » sur le bouton. */
    _refreshAdminPanel() {
      const dirtyPe = this._dirtyKeys('pe').length;
      const dirtyIst = this._dirtyKeys('ist').length;
      if (this._toggleBtn) {
        this._toggleBtn.classList.toggle('amgt-ple-dirty', dirtyPe + dirtyIst > 0);
        this._toggleBtn.title = dirtyPe + dirtyIst ? `${dirtyPe + dirtyIst} modification(s) non enregistrée(s) — cliquez pour le suivi et l'enregistrement` : "Aide, suivi et enregistrement des modifications d'étiquettes (administrateurs)";
      }
      if (!this._panel) return;
      // 💾 grisé s'il n'y a rien à enregistrer (ou pendant une modification) ; ↶ grisé s'il n'y a rien à annuler (ou pendant une modification).
      this._panel.querySelector('[data-action="save"]').disabled = dirtyPe + dirtyIst === 0 || !!this._edit;
      this._panel.querySelector('[data-action="undo"]').disabled = !this._undoStack.length || !!this._edit;
      const el = this._panel.querySelector('.amgt-ple-count');
      const pending = (n) => (n ? `${n} modification(s) NON enregistrée(s)` : 'tout enregistré');
      el.textContent =
        `Planches : ${this._entriesOf('pe').length} étiquette(s) affichée(s), ${pending(dirtyPe)}. ` +
        `Tronçons : ${this._entriesOf('ist').length} étiquette(s) affichée(s), ${pending(dirtyIst)}.`;
    },

    /** Annule la dernière opération de la session (modification, création, suppression, réinitialisation), une à la fois. */
    _undo() {
      if (this._edit || this._addMode) return;
      const pre = this._undoStack.pop();
      if (pre) this._restore(pre);
    },

    /**
     * Boîte de saisie : résolue avec le texte saisi, ou null si abandon. `type: 'password'` masque la saisie (code
     * administrateur) ; `validate(valeur)` retourne un message d'erreur (la boîte reste ouverte) ou ''.
     */
    _askInput(message, { type = 'text', placeholder = '', validate = null } = {}) {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'amgt-ple-modal';
        overlay.innerHTML = `
          <form class="amgt-ple-modal-box">
            <p></p>
            <input autocomplete="off" />
            <p class="amgt-ple-modal-error" hidden></p>
            <div class="amgt-ple-actions">
              <button type="submit" class="amgt-ple-primary">Confirmer</button>
              <button type="button" data-action="cancel">Annuler</button>
            </div>
          </form>`;
        overlay.querySelector('p').textContent = message;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('input');
        input.type = type;
        input.placeholder = placeholder;
        input.setAttribute('aria-label', placeholder || message);
        const error = overlay.querySelector('.amgt-ple-modal-error');
        const done = (value) => {
          overlay.remove();
          resolve(value);
        };
        overlay.querySelector('form').addEventListener('submit', (e) => {
          e.preventDefault();
          const value = input.value.trim();
          if (!value) return;
          const problem = validate ? validate(value) : '';
          if (problem) {
            error.textContent = problem;
            error.hidden = false;
            return;
          }
          done(type === 'password' ? input.value : value);
        });
        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => done(null));
        overlay.addEventListener('keydown', (e) => e.key === 'Escape' && done(null));
        for (const t of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'wheel']) overlay.addEventListener(t, (e) => e.stopPropagation());
        input.focus();
      });
    },
  };

  PeLabelEditor.init();
  window.AMGT4CEM_PeLabelEditor = PeLabelEditor; // exposé pour usage/débogage depuis la console
})();
