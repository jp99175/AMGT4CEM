/**
 * Plugin "pe-label-editor" — déplacer et réorienter à la souris les
 * étiquettes de référence de planche (PE_label, ex. "1000-236"), avec des
 * points d'accroche magnétiques le long du contour des planches.
 *
 * AUCUN fichier de l'application n'est modifié par ce plugin : il n'utilise
 * que des objets déjà globaux de l'appli (AMGT4CEM_MapMenu, AMGT4CEM_CRS,
 * AMGT4CEM_ShpLoader, AMGT4CEM_CONFIG, Leaflet `L`) depuis un script chargé
 * en plus, tout à la fin de la page (voir index.html de ce dossier) — il ne
 * touche à aucun fichier existant du dépôt, seulement au DOM/aux objets déjà
 * en mémoire, exactement comme le ferait une extension de navigateur.
 *
 * Ce que ce plugin modifie réellement à l'affichage :
 * - la position (LatLng) du marqueur de texte PE_label existant
 *   (`marker.setLatLng(...)`, une API Leaflet publique) ;
 * - la rotation CSS de son `<span>` (`style.transform`), le même
 *   mécanisme que celui déjà utilisé par scaledText.js pour appliquer la
 *   rotation d'origine (voir metroLayer.js/scaledText.js) — ce plugin ne
 *   fait qu'écrire une nouvelle valeur à la même propriété, en overlay,
 *   sans modifier scaledText.js lui-même.
 *
 * Persistance : ce plugin n'a pas accès aux fichiers du dépôt (Shapefile),
 * donc pas de sauvegarde "définitive" possible depuis le navigateur. Les
 * réglages sont gardés dans localStorage (par navigateur/appareil) ET
 * exportables en JSON (bouton "Exporter") pour être transmis à qui
 * maintient le Shapefile si on veut les rendre permanents.
 */
(function () {
  const STORAGE_KEY = 'amgt4cem-ple-overrides-v3'; // clés "code#rang" (v2) ; v3 : les positions de base ont été recalées sur le réseau du PDF, d'anciens réglages (faits sur d'anciennes emprises décalées) seraient faux
  const SNAP_SPACING_M = 15; // distance entre deux points d'accroche générés le long d'un bord de planche
  const SNAP_RADIUS_M = 12; // rayon d'accroche magnétique (mètres réels, pas des pixels — stable à tout niveau de zoom)
  const LABEL_GAP_M = 6; // retrait (m) du bord de référence du texte à l'intérieur du cadre, une fois accroché
  // translate() CSS qui amène le point d'ancrage au milieu du bord choisi de la boîte de texte (même table que scaledText.js)
  const SIDE_TRANSLATE = { center: '-50%,-50%', top: '-50%,0', bottom: '-50%,-100%', left: '0,-50%', right: '-100%,-50%' };
  const ROTATE_HANDLE_PX = 46; // distance écran (px) entre une étiquette et sa poignée de rotation

  const PeLabelEditor = {
    _map: null,
    _active: false,
    _entries: [], // { id, code, marker, span, moveHandle, rotHandle, lat, lng, angle }
    _snapPoints: [], // { lat, lng, angle }
    _snapLayer: null,
    _overrides: {}, // id -> { lat, lng, angle }
    _toggleBtn: null,
    _panel: null,
    _planchesLoaded: false,

    init() {
      this._waitForApp(() => {
        this._map = this._findMap();
        if (!this._map) {
          console.error('[pe-label-editor] Carte Leaflet introuvable, plugin non démarré.');
          return;
        }
        this._loadOverrides();
        this._buildToggleButton();
        // Meilleur effort : si les étiquettes sont déjà visibles (couche
        // "Plans d'ensemble" déjà cochée), les réglages sauvegardés d'une
        // visite précédente s'appliquent tout de suite, sans attendre que
        // l'utilisateur rouvre le mode édition. Si pas encore visibles
        // (couche décochée), on retente quelques secondes — la couche est
        // externe (patrimoineLayer.js) et peut être (dés)activée bien après
        // le chargement du réseau.
        if (!this._ensureIndexed()) {
          this._autoIndexInterval = setInterval(() => {
            if (this._ensureIndexed()) clearInterval(this._autoIndexInterval);
          }, 2000);
        }
      });
    },

    /**
     * Indexe les étiquettes visibles UNE SEULE FOIS (garde les valeurs
     * d'origine pour "Réinitialiser") et leur applique aussitôt les
     * réglages sauvegardés. Un second appel (ex. depuis _activate()) ne
     * refait rien si déjà indexé — sans cette garde, ré-indexer après un
     * premier passage lirait les positions déjà surchargées comme si
     * c'étaient les valeurs d'origine du PDF.
     */
    _ensureIndexed() {
      if (this._entries.length) return true;
      const entries = this._indexVisibleLabels();
      if (!entries.length) return false;
      this._entries = entries;
      this._applyOverrides();
      for (const entry of entries) this._makeLabelClickable(entry);
      return true;
    },

    /**
     * Attend que l'appli ait fini de construire la couche PE_label
     * (chargement Shapefile asynchrone). Référence `AMGT4CEM_MapMenu` en
     * identifiant nu (pas `window.AMGT4CEM_MapMenu`) : comme tous les
     * scripts classiques de cette appli (voir mapMenu.js), c'est un `const`
     * de premier niveau — visible dans la portée globale partagée par tous
     * les <script> du document (donc par ce plugin, injecté dans le même
     * document), mais PAS posé comme propriété de `window`.
     */
    _waitForApp(cb) {
      const check = () => {
        const layers = typeof AMGT4CEM_MapMenu !== 'undefined' && AMGT4CEM_MapMenu._metroLayers;
        if (layers && layers.PE_label && layers.MS && layers.MS._map) {
          cb();
        } else {
          setTimeout(check, 300);
        }
      };
      check();
    },

    _findMap() {
      const layers = AMGT4CEM_MapMenu._metroLayers;
      return (layers.MS && layers.MS._map) || (layers.MT && layers.MT._map) || null;
    },

    _buildToggleButton() {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'amgt-ple-toggle-btn';
      btn.textContent = '🧲 Étiquettes planches';
      btn.title = "Déplacer/réorienter les références de planche (plugin, ne modifie aucun fichier de l'appli)";
      btn.addEventListener('click', () => this._toggle());
      document.body.appendChild(btn);
      this._toggleBtn = btn;
    },

    _toggle() {
      if (this._active) this._deactivate();
      else this._activate();
    },

    _activate() {
      if (this._active) return; // déjà actif (ex. double-clic rapide sur une étiquette) : rien à refaire
      if (!this._ensureIndexed()) {
        alert(
          "Aucune étiquette de planche visible.\n\n" +
          "Activez d'abord la couche « Plans d'ensemble (1/500e) » " +
          '(menu ☰ Carte → Plans patrimoine), puis réessayez.'
        );
        return;
      }
      this._buildHandles();
      this._active = true;
      for (const entry of this._entries) entry.span.style.cursor = 'grab';
      this._toggleBtn.classList.add('amgt-ple-active');
      this._buildPanel();

      // Les points d'accroche demandent la géométrie des planches
      // (Metro.shp) : chargée à part (indépendamment de metroLayer.js, ce
      // plugin ne lit aucun état interne de l'appli), une seule fois.
      if (!this._planchesLoaded) {
        this._loadSnapPoints(() => this._refreshPanelCount());
      } else {
        this._showSnapPoints();
        this._refreshPanelCount();
      }
    },

    _deactivate() {
      this._active = false;
      for (const entry of this._entries) entry.span.style.cursor = 'pointer';
      this._toggleBtn.classList.remove('amgt-ple-active');
      this._destroyHandles();
      this._hideSnapPoints();
      if (this._panel) {
        this._panel.remove();
        this._panel = null;
      }
    },

    /** Un marqueur PE_label sans élément DOM n'est pas affiché (couche masquée) — on l'ignore. */
    _indexVisibleLabels() {
      const out = [];
      const seen = {};
      AMGT4CEM_MapMenu._metroLayers.PE_label.eachLayer((marker) => {
        const el = marker.getElement();
        if (!el) return;
        const span = el.querySelector('.amgt-scaled-text');
        if (!span) return;
        const latlng = marker.getLatLng();
        const code = span.textContent.trim();
        // Clé stable "code#rang" (ex. "3000-126#1" pour sa 2e étiquette),
        // pas un simple index : un réglage sauvegardé reste attaché à la
        // bonne étiquette même si MetroLabels.shp est régénéré dans un autre
        // ordre ou gagne/perd une ligne.
        seen[code] = (seen[code] || 0) + 1;
        out.push({
          key: `${code}#${seen[code] - 1}`,
          code,
          marker,
          span,
          moveHandle: null,
          rotHandle: null,
          // Valeurs d'ORIGINE (avant toute surcharge du plugin) : gardées
          // pour permettre un vrai "Réinitialiser" sans recharger la page.
          origLat: latlng.lat,
          origLng: latlng.lng,
          origAngle: this._readAngleDeg(span),
          origSide: span.dataset.side || 'center',
          lat: latlng.lat,
          lng: latlng.lng,
          angle: this._readAngleDeg(span),
          side: span.dataset.side || 'center',
        });
      });
      return out;
    },

    _readAngleDeg(span) {
      const m = /rotate\(\s*(-?[\d.]+)deg\s*\)/.exec(span.style.transform || '');
      return m ? parseFloat(m[1]) : 0;
    },

    /**
     * Rend le texte de l'étiquette lui-même cliquable pour entrer
     * directement en mode édition (sans passer par le bouton 🧲) : le
     * `<span>` du texte a `pointer-events: none` dans le CSS de l'appli
     * (style.css, volontaire — un clic doit normalement traverser jusqu'à
     * la planche en dessous, voir metroLayer.js). Ce plugin ne touche pas
     * ce fichier : il pose juste un style inline (plus prioritaire que la
     * règle de classe) sur CET élément précis, en overlay, comme il le fait
     * déjà pour `transform`/`font-size`.
     *
     * `marker.on('add', ...)` (même mécanisme que scaledText.js) : Leaflet
     * recrée l'élément DOM du divIcon à chaque fois que le marqueur
     * redevient visible (ex. la couche "Plans d'ensemble" désactivée puis
     * réactivée) — sans ce ré-abonnement, le style inline et l'écouteur de
     * clic seraient perdus après un tel cycle.
     */
    _makeLabelClickable(entry) {
      entry.marker.on('add', () => this._bindLabelClick(entry));
      this._bindLabelClick(entry);
    },

    _bindLabelClick(entry) {
      const el = entry.marker.getElement();
      const span = el ? el.querySelector('.amgt-scaled-text') : null;
      if (!span) return;
      entry.span = span; // l'élément peut avoir été recréé depuis l'indexation initiale
      span.style.pointerEvents = 'auto';
      span.style.cursor = 'pointer';
      span.title = "Cliquer pour déplacer/orienter cette étiquette (plugin d'édition)";
      span.style.touchAction = 'none'; // un glissé sur le texte (tactile) ne doit pas faire défiler la page
      if (span._amgtPleClickBound) return; // déjà abonné sur CET élément, ne pas empiler les écouteurs
      span._amgtPleClickBound = true;
      span.addEventListener('pointerdown', (e) => this._startTextDrag(entry, e));
      span.addEventListener('click', (e) => {
        L.DomEvent.stopPropagation(e); // pas de clic-traversant vers la planche en dessous dans ce cas précis
        L.DomEvent.preventDefault(e);
        this._activate();
      });
    },

    /**
     * Mode édition actif : glisser le TEXTE de l'étiquette la déplace (même
     * accroche magnétique que la poignée orange) — pas besoin de viser un
     * petit point. Événements « pointer » : souris, tactile et stylet.
     */
    _startTextDrag(entry, ev) {
      if (!this._active || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      L.DomEvent.stopPropagation(ev);
      L.DomEvent.preventDefault(ev);
      const map = this._map;
      const span = entry.span;
      if (span.setPointerCapture) span.setPointerCapture(ev.pointerId);
      map.dragging.disable(); // sinon la carte se déplace en même temps
      const p0 = map.mouseEventToContainerPoint(ev);
      const a0 = map.latLngToContainerPoint([entry.lat, entry.lng]);
      span.style.cursor = 'grabbing';
      const move = (e) => {
        const p = map.mouseEventToContainerPoint(e);
        this._moveEntryTo(entry, map.containerPointToLatLng(L.point(a0.x + p.x - p0.x, a0.y + p.y - p0.y)));
      };
      const up = () => {
        span.removeEventListener('pointermove', move);
        span.removeEventListener('pointerup', up);
        span.removeEventListener('pointercancel', up);
        map.dragging.enable();
        span.style.cursor = this._active ? 'grab' : 'pointer';
        this._persistEntry(entry);
      };
      span.addEventListener('pointermove', move);
      span.addEventListener('pointerup', up);
      span.addEventListener('pointercancel', up);
    },

    // ---- Persistance (localStorage + export/import JSON) ----------------

    _loadOverrides() {
      try {
        this._overrides = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      } catch (err) {
        console.warn('[pe-label-editor] localStorage illisible, overrides ignorés :', err);
        this._overrides = {};
      }
    },

    _saveOverrides() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._overrides));
      } catch (err) {
        console.warn('[pe-label-editor] Écriture localStorage impossible :', err);
      }
    },

    _applyOverrides() {
      for (const entry of this._entries) {
        const o = this._overrides[entry.key];
        if (!o) continue;
        entry.lat = o.lat;
        entry.lng = o.lng;
        entry.marker.setLatLng([o.lat, o.lng]);
        this._applyPose(entry, o.angle, o.side || entry.side);
      }
    },

    /**
     * Pose l'orientation ET le bord d'ancrage du texte : le point du marqueur
     * est le milieu du bord `side` de la boîte de texte (le plus proche du
     * cadre de la planche), rotation autour de ce point — même transform que
     * scaledText.js. Ancré sur ce bord, le texte reste collé à son cadre à
     * tout niveau de zoom (il pousse à partir de ce bord quand sa taille change).
     */
    _applyPose(entry, angleDeg, side) {
      entry.angle = angleDeg;
      entry.side = SIDE_TRANSLATE[side] ? side : 'center';
      entry.span.dataset.side = entry.side;
      entry.span.style.transformOrigin = '0 0';
      entry.span.style.transform = `rotate(${angleDeg}deg) translate(${SIDE_TRANSLATE[entry.side]})`;
    },

    _applyAngle(entry, angleDeg) {
      this._applyPose(entry, angleDeg, entry.side);
    },

    _persistEntry(entry) {
      this._overrides[entry.key] = { lat: entry.lat, lng: entry.lng, angle: entry.angle, side: entry.side };
      this._saveOverrides();
    },

    // ---- Poignées de déplacement / rotation ------------------------------

    _buildHandles() {
      for (const entry of this._entries) {
        entry.moveHandle = L.marker([entry.lat, entry.lng], {
          draggable: true,
          keyboard: false,
          icon: L.divIcon({
            className: 'amgt-ple-handle amgt-ple-handle--move',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
          title: entry.code,
        }).addTo(this._map);

        entry.rotHandle = L.marker(this._rotateHandleLatLng(entry), {
          draggable: true,
          keyboard: false,
          icon: L.divIcon({
            className: 'amgt-ple-handle amgt-ple-handle--rotate',
            iconSize: [11, 11],
            iconAnchor: [5, 5],
          }),
        }).addTo(this._map);

        entry.moveHandle.on('drag', () => this._onMoveDrag(entry));
        entry.moveHandle.on('dragend', () => this._onMoveDragEnd(entry));
        entry.rotHandle.on('drag', () => this._onRotateDrag(entry));
        entry.rotHandle.on('dragend', () => this._persistEntry(entry));
      }
      this._zoomHandler = () => {
        for (const entry of this._entries) entry.rotHandle.setLatLng(this._rotateHandleLatLng(entry));
      };
      this._map.on('zoomend', this._zoomHandler);
    },

    _destroyHandles() {
      for (const entry of this._entries) {
        if (entry.moveHandle) this._map.removeLayer(entry.moveHandle);
        if (entry.rotHandle) this._map.removeLayer(entry.rotHandle);
      }
      if (this._zoomHandler) this._map.off('zoomend', this._zoomHandler);
    },

    /** Point écran à ROTATE_HANDLE_PX de l'étiquette, dans la direction de son orientation actuelle. */
    _rotateHandleLatLng(entry) {
      const center = this._map.latLngToContainerPoint([entry.lat, entry.lng]);
      const rad = (entry.angle * Math.PI) / 180;
      const pt = L.point(center.x + ROTATE_HANDLE_PX * Math.cos(rad), center.y + ROTATE_HANDLE_PX * Math.sin(rad));
      return this._map.containerPointToLatLng(pt);
    },

    _onMoveDrag(entry) {
      this._moveEntryTo(entry, entry.moveHandle.getLatLng());
    },

    /**
     * Déplace le point d'ancrage (milieu du bord de référence du texte) vers
     * `latlng`, avec accroche magnétique : à moins de SNAP_RADIUS_M d'un point
     * du cadre d'une planche, le bord de référence se pose dessus, le texte
     * prend l'orientation du bord du cadre et se place à l'intérieur de la planche.
     */
    _moveEntryTo(entry, latlng) {
      const snap = this._nearestSnapPoint(latlng);
      if (snap) {
        latlng = L.latLng(snap.lat, snap.lng);
        this._applyPose(entry, snap.angle, snap.side);
      }
      entry.moveHandle.setLatLng(latlng);
      entry.lat = latlng.lat;
      entry.lng = latlng.lng;
      entry.marker.setLatLng(latlng);
      entry.rotHandle.setLatLng(this._rotateHandleLatLng(entry));
    },

    _onMoveDragEnd(entry) {
      this._persistEntry(entry);
    },

    _onRotateDrag(entry) {
      const center = this._map.latLngToContainerPoint([entry.lat, entry.lng]);
      const handlePt = this._map.latLngToContainerPoint(entry.rotHandle.getLatLng());
      const angleDeg = (Math.atan2(handlePt.y - center.y, handlePt.x - center.x) * 180) / Math.PI;
      this._applyAngle(entry, angleDeg);
      // Recentre la poignée pile sur le cercle (rayon constant), même si le
      // relâchement de souris n'est pas tombé exactement dessus.
      entry.rotHandle.setLatLng(this._rotateHandleLatLng(entry));
    },

    // ---- Points d'accroche magnétiques (le long du contour des planches) ---

    /**
     * Charge Metro.shp indépendamment (même fichier que metroLayer.js, mais
     * lu séparément par ce plugin — aucun état interne de l'appli n'est
     * requis) pour en extraire le contour des planches (`type === "PE"`) et
     * générer des points tous les SNAP_SPACING_M mètres le long de chaque
     * bord, avec l'angle local du bord (même formule que la rotation des
     * PE_label d'origine : conversion Lambert → écran par `-atan2`, repère
     * conforme des deux côtés donc angle préservé localement).
     */
    _loadSnapPoints(done) {
      AMGT4CEM_ShpLoader.load(
        AMGT4CEM_CONFIG.metroShpBaseUrl,
        (geojson) => {
          const points = [];
          for (const f of geojson.features) {
            if (!f.properties || f.properties.type !== 'PE') continue;
            if (!f.geometry || f.geometry.type !== 'Polygon') continue;
            const ring = f.geometry.coordinates[0];
            // Sens du contour (aire signée > 0 : antihoraire, y vers le haut) : donne de quel
            // côté de chaque bord se trouve l'intérieur de la planche.
            let area2 = 0;
            for (let i = 0; i < ring.length - 1; i++) area2 += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
            for (let i = 0; i < ring.length - 1; i++) {
              points.push(...this._samplePEEdge(ring[i], ring[i + 1], area2 > 0 ? 1 : -1));
            }
          }
          this._snapPoints = points;
          this._planchesLoaded = true;
          this._buildSnapLayer();
          done();
        },
        (err) => {
          console.warn('[pe-label-editor] Metro.shp illisible, accroche magnétique désactivée :', err);
          this._planchesLoaded = true;
          done();
        }
      );
    },

    /**
     * Points d'accroche le long d'un bord du cadre, décalés de LABEL_GAP_M vers
     * l'INTÉRIEUR de la planche. Chacun porte l'orientation du bord (texte
     * lisible de gauche à droite : angle ramené dans ]-90°, 90°]) et le bord de
     * la boîte de texte à poser sur le cadre : 'top' si l'intérieur est sous le
     * texte, 'bottom' s'il est au-dessus.
     */
    _samplePEEdge([x0, y0], [x1, y1], ccw) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return [];
      const nx = (ccw > 0 ? -dy : dy) / len; // normale vers l'intérieur (repère Lambert, y vers le haut)
      const ny = (ccw > 0 ? dx : -dx) / len;
      let angle = (-Math.atan2(dy, dx) * 180) / Math.PI; // Lambert (y haut) -> écran CSS (y bas)
      if (angle > 90) angle -= 180;
      if (angle <= -90) angle += 180;
      const rad = (angle * Math.PI) / 180;
      // "bas" du texte en repère Lambert = (-sin, -cos) ; intérieur de ce côté -> le bord de référence est le haut
      const side = nx * -Math.sin(rad) + ny * -Math.cos(rad) > 0 ? 'top' : 'bottom';
      const steps = Math.max(1, Math.round(len / SNAP_SPACING_M));
      const out = [];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const { lat, lng } = AMGT4CEM_CRS.lambertToLatLng([x0 + dx * t + nx * LABEL_GAP_M, y0 + dy * t + ny * LABEL_GAP_M]);
        out.push({ lat, lng, angle, side });
      }
      return out;
    },

    _buildSnapLayer() {
      this._snapLayer = L.layerGroup();
      for (const p of this._snapPoints) {
        L.circleMarker([p.lat, p.lng], {
          radius: 3,
          color: '#888',
          weight: 1,
          fillColor: '#ccc',
          fillOpacity: 0.85,
          interactive: false,
        }).addTo(this._snapLayer);
      }
      this._showSnapPoints();
    },

    _showSnapPoints() {
      if (this._snapLayer) this._snapLayer.addTo(this._map);
    },

    _hideSnapPoints() {
      if (this._snapLayer) this._map.removeLayer(this._snapLayer);
    },

    /** Plus proche point d'accroche à moins de SNAP_RADIUS_M mètres (distance planaire simple, échelle locale). */
    _nearestSnapPoint(latlng) {
      if (!this._snapPoints.length) return null;
      const cosLat = Math.cos((latlng.lat * Math.PI) / 180);
      const M_PER_DEG_LAT = 111320;
      let best = null;
      let bestD2 = (SNAP_RADIUS_M) ** 2;
      for (const p of this._snapPoints) {
        const dy = (p.lat - latlng.lat) * M_PER_DEG_LAT;
        const dx = (p.lng - latlng.lng) * M_PER_DEG_LAT * cosLat;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = p;
        }
      }
      return best;
    },

    // ---- Panneau de contrôle ---------------------------------------------

    _buildPanel() {
      const panel = document.createElement('div');
      panel.className = 'amgt-ple-panel';
      panel.innerHTML = `
        <h3>🧲 Étiquettes de planches</h3>
        <p>Glissez le <b>texte</b> (ou le point orange) pour déplacer, le point bleu pour orienter. Le point orange est le milieu du bord du texte le plus proche du cadre : c'est lui qui s'accroche.</p>
        <div class="amgt-ple-legend"><span class="amgt-ple-swatch amgt-ple-swatch--move"></span> ancrage (milieu du bord de référence)</div>
        <div class="amgt-ple-legend"><span class="amgt-ple-swatch amgt-ple-swatch--rotate"></span> orienter</div>
        <div class="amgt-ple-legend"><span class="amgt-ple-swatch amgt-ple-swatch--snap"></span> accroche magnétique</div>
        <p class="amgt-ple-count"></p>
        <div class="amgt-ple-actions">
          <button type="button" data-action="reset">Réinitialiser</button>
          <button type="button" data-action="export">Exporter JSON</button>
          <label class="amgt-ple-import-btn">Importer JSON<input type="file" accept="application/json" data-action="import" /></label>
          <button type="button" data-action="close">Fermer</button>
        </div>
      `;
      document.body.appendChild(panel);
      this._panel = panel;

      panel.querySelector('[data-action="reset"]').addEventListener('click', () => this._resetAll());
      panel.querySelector('[data-action="export"]').addEventListener('click', () => this._exportJson());
      panel.querySelector('[data-action="close"]').addEventListener('click', () => this._deactivate());
      panel.querySelector('[data-action="import"]').addEventListener('change', (e) => this._importJson(e));

      this._refreshPanelCount();
    },

    _refreshPanelCount() {
      if (!this._panel) return;
      const el = this._panel.querySelector('.amgt-ple-count');
      el.textContent = `${this._entries.length} étiquette(s) · ${this._snapPoints.length} point(s) d'accroche`;
    },

    _resetAll() {
      if (!confirm("Réinitialiser toutes les étiquettes à leur position/orientation d'origine (PDF) ?")) return;
      this._overrides = {};
      this._saveOverrides();
      for (const entry of this._entries) {
        entry.lat = entry.origLat;
        entry.lng = entry.origLng;
        entry.marker.setLatLng([entry.lat, entry.lng]);
        this._applyPose(entry, entry.origAngle, entry.origSide);
        entry.moveHandle.setLatLng([entry.lat, entry.lng]);
        entry.rotHandle.setLatLng(this._rotateHandleLatLng(entry));
      }
    },

    _exportJson() {
      const out = this._entries.map((e) => ({ key: e.key, code: e.code, lat: e.lat, lng: e.lng, angle: e.angle, side: e.side }));
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
          const data = JSON.parse(reader.result);
          const byKey = {};
          for (const row of data) byKey[row.key] = row;
          for (const entry of this._entries) {
            const row = byKey[entry.key];
            if (!row) continue;
            entry.lat = row.lat;
            entry.lng = row.lng;
            entry.marker.setLatLng([row.lat, row.lng]);
            this._applyPose(entry, row.angle, row.side || entry.side);
            entry.moveHandle.setLatLng([row.lat, row.lng]);
            entry.rotHandle.setLatLng(this._rotateHandleLatLng(entry));
            this._persistEntry(entry);
          }
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
