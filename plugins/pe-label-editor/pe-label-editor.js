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
  const STORAGE_KEY = 'amgt4cem-ple-overrides-v1';
  const SNAP_SPACING_M = 15; // distance entre deux points d'accroche générés le long d'un bord de planche
  const SNAP_RADIUS_M = 12; // rayon d'accroche magnétique (mètres réels, pas des pixels — stable à tout niveau de zoom)
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
      let i = 0;
      AMGT4CEM_MapMenu._metroLayers.PE_label.eachLayer((marker) => {
        const el = marker.getElement();
        if (!el) return;
        const span = el.querySelector('.amgt-scaled-text');
        if (!span) return;
        const latlng = marker.getLatLng();
        out.push({
          id: i++,
          code: span.textContent.trim(),
          marker,
          span,
          moveHandle: null,
          rotHandle: null,
          // Valeurs d'ORIGINE (avant toute surcharge du plugin) : gardées
          // pour permettre un vrai "Réinitialiser" sans recharger la page.
          origLat: latlng.lat,
          origLng: latlng.lng,
          origAngle: this._readAngleDeg(span),
          lat: latlng.lat,
          lng: latlng.lng,
          angle: this._readAngleDeg(span),
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
      if (span._amgtPleClickBound) return; // déjà abonné sur CET élément, ne pas empiler les écouteurs
      span._amgtPleClickBound = true;
      span.addEventListener('click', (e) => {
        L.DomEvent.stopPropagation(e); // pas de clic-traversant vers la planche en dessous dans ce cas précis
        L.DomEvent.preventDefault(e);
        this._activate();
      });
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
        const o = this._overrides[entry.id];
        if (!o) continue;
        entry.lat = o.lat;
        entry.lng = o.lng;
        entry.angle = o.angle;
        entry.marker.setLatLng([o.lat, o.lng]);
        this._applyAngle(entry, o.angle);
      }
    },

    _applyAngle(entry, angleDeg) {
      entry.angle = angleDeg;
      entry.span.style.transform = `translate(-50%,-50%) rotate(${angleDeg}deg)`;
    },

    _persistEntry(entry) {
      this._overrides[entry.id] = { lat: entry.lat, lng: entry.lng, angle: entry.angle };
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
      let latlng = entry.moveHandle.getLatLng();
      const snap = this._nearestSnapPoint(latlng);
      if (snap) {
        latlng = L.latLng(snap.lat, snap.lng);
        entry.moveHandle.setLatLng(latlng);
        this._applyAngle(entry, snap.angle);
      }
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
            for (let i = 0; i < ring.length - 1; i++) {
              points.push(...this._samplePEEdge(ring[i], ring[i + 1]));
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

    _samplePEEdge([x0, y0], [x1, y1]) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return [];
      const angle = (-Math.atan2(dy, dx) * 180) / Math.PI; // Lambert (y haut) -> écran CSS (y bas)
      const steps = Math.max(1, Math.round(len / SNAP_SPACING_M));
      const out = [];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const { lat, lng } = AMGT4CEM_CRS.lambertToLatLng([x0 + dx * t, y0 + dy * t]);
        out.push({ lat, lng, angle });
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
        <p>Glissez le point orange pour déplacer, le point bleu pour orienter.</p>
        <div class="amgt-ple-legend"><span class="amgt-ple-swatch amgt-ple-swatch--move"></span> déplacer</div>
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
        this._applyAngle(entry, entry.origAngle);
        entry.moveHandle.setLatLng([entry.lat, entry.lng]);
        entry.rotHandle.setLatLng(this._rotateHandleLatLng(entry));
      }
    },

    _exportJson() {
      const out = this._entries.map((e) => ({ id: e.id, code: e.code, lat: e.lat, lng: e.lng, angle: e.angle }));
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
          const byId = {};
          for (const row of data) byId[row.id] = row;
          for (const entry of this._entries) {
            const row = byId[entry.id];
            if (!row) continue;
            entry.lat = row.lat;
            entry.lng = row.lng;
            entry.marker.setLatLng([row.lat, row.lng]);
            this._applyAngle(entry, row.angle);
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
