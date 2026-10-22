/**
 * Couche « Géotechnique » (nappe phréatique) : deux jeux de données du WFS « water » de Bruxelles Environnement
 * (adresse : data/fonds-de-plan/services.json, clé `eaux-souterraines` ; réglages : data/nappe/parametres.json) :
 *
 *  - ISOPIÈZES de la nappe phréatique (lignes de niveau, équidistance 2 m, en m DNG) : résultat du modèle BPSM v1.0,
 *    état de MAI 2013. Valeur indicative, qui ne remplace pas une étude d'expert (mention reprise dans chaque fenêtre) ;
 *  - STATIONS de mesure piézométriques (points) du réseau de suivi régional. Les chroniques ne sont pas servies par le
 *    WFS : seule la position et les attributs de la station s'affichent ici.
 *
 * Source des données : une COPIE rangée dans R2 par le Worker nappe-sync/ (revérifiée périodiquement), gardée aussi sur
 * l'appareil (IndexedDB) ; le service régional, parfois en HTTP 502, n'est interrogé directement qu'à défaut (voir
 * « Jeux de données complets » plus bas). Rien n'est lu tant que la case est décochée ; seuls les objets de l'emprise
 * visible sont dessinés, et en dessous du zoom minimal de chaque élément rien n'est affiché. Une couche en échec
 * (réseau, CORS, nom de couche inconnu) est signalée en console et simplement absente : aucun état cassé n'est montré.
 *
 * Le nom exact des couches publiées (avec son préfixe d'espace de noms) n'est PAS supposé : il est retrouvé dans le
 * GetCapabilities du service, en cherchant le nom configuré comme fin du nom publié (résultat gardé en mémoire).
 * Les requêtes se font en Lambert 72 (EPSG:31370), comme tout le reste de l'application.
 */
const AMGT4CEM_NappeLayer = {
  _map: null,
  _group: null,
  _enabled: false, // la case du menu est décochée au départ : aucune requête tant qu'on ne la coche pas
  _showIsopieses: true,
  _showStations: true,
  _showBandes: true,
  _fetchToken: 0,
  _moveTimer: null,
  _candidates: [], // couches publiées au nom proche, pour le message d'erreur
  _typeNames: {}, // « adresse|nom configuré » -> nom publié (ou null si introuvable), mémorisé par session
  _capabilitiesByUrl: {}, // GetCapabilities par adresse de service
  _statusEl: null,
  // Opacités de base (facteur 1) : le facteur réglable du menu ☰ Carte s'applique en multiplicateur dessus.
  _baseLineOpacity: 0.9,
  _basePointFillOpacity: 0.9,
  _opacityFactor: 1,

  init(map) {
    this._map = map;
    const cfg = AMGT4CEM_CONFIG.nappe || {};
    this._group = L.layerGroup([], { attribution: cfg.attribution || '&copy; Bruxelles Environnement' });
    this._statusEl = document.getElementById('amgt-nappe-status');
    if (typeof AMGT4CEM_NappeSelectionStore !== 'undefined') { this._syncFromStore(); this._initPicker(); }
    this._syncBoreButton();
    // Intervalles colorés : sous toutes les couches vectorielles (overlayPane = 400), au-dessus des fonds de carte (tilePane = 200).
    const pane = map.createPane('amgtNappeFill');
    pane.style.zIndex = 395;
    pane.style.pointerEvents = 'none';

    map.on('moveend', () => {
      if (!this._enabled) return;
      clearTimeout(this._moveTimer);
      this._moveTimer = setTimeout(() => this.refresh(), 400);
    });
  },

  setEnabled(enabled) {
    this._enabled = enabled;
    this._syncBoreButton();
    this.refresh();
  },

  _PARTS: [
    ['isopieses', 'Isopièzes de la nappe phréatique (mai 2013, modèle)'],
    ['bandes', 'Colorer les intervalles entre isopièzes'],
    ['stations', 'Stations de mesure piézométriques'],
  ],
  _draft: null, // brouillon de la sélection par défaut partagée (édition administrateur), sinon null

  /** Reprend la sélection de l'appareil (préférences locales ou défaut partagé) dans les trois indicateurs d'affichage. */
  _syncFromStore() {
    if (typeof AMGT4CEM_NappeSelectionStore === 'undefined') return;
    const sel = AMGT4CEM_NappeSelectionStore.getSelection();
    this._showIsopieses = Boolean(sel.isopieses);
    this._showBandes = Boolean(sel.bandes);
    this._showStations = Boolean(sel.stations);
  },

  /** Outil « Forage virtuel » : visible seulement quand la couche Géotechnique est active. */
  /** Seuil de zoom d'un élément : choix de l'utilisateur (menu de sélection), sinon réglage du fichier. */
  _minZoom(part, cfg) {
    return AMGT4CEM_ZoomThresholds.get(`nappe.${part}`, cfg[part].minZoom);
  },

  _syncBoreButton() {
    const btn = document.getElementById('amgt-bore-btn');
    if (btn) btn.classList.toggle('amgt-hidden', !this._enabled);
    if (!this._enabled && typeof AMGT4CEM_VirtualBoreTool !== 'undefined') {
      try { AMGT4CEM_VirtualBoreTool.deactivate(); AMGT4CEM_VirtualBoreTool.close(); } catch (err) { /* outil pas encore initialisé */ }
    }
  },

  _initPicker() {
    document.getElementById('amgt-nappe-picker-close').addEventListener('click', () => this.closePicker());
    AMGT4CEM_ZoomThresholds.onChange((id) => { if (id.startsWith('nappe.')) this.refresh(); });
    const store = AMGT4CEM_NappeSelectionStore;
    store.onChange(() => {
      this._syncFromStore();
      if (typeof AMGT4CEM_ScreenshotTool !== 'undefined') AMGT4CEM_ScreenshotTool.invalidateBackground();
      this.refresh();
    });
    const barEl = document.getElementById('amgt-nappe-picker-default-bar');
    this._bar = barEl && typeof AMGT4CEM_PickerDefaultBar !== 'undefined'
      ? AMGT4CEM_PickerDefaultBar.attach(barEl, {
        start: () => { this._draft = store.getShared(); this._setEditing(true); },
        save: async (code) => { await store.saveShared(this._draft, code); this._draft = null; this._setEditing(false); },
        cancel: () => { this._draft = null; this._setEditing(false); },
      })
      : null;
    const saveBtn = document.getElementById('amgt-nappe-picker-save-default');
    const saveText = saveBtn.textContent;
    saveBtn.addEventListener('click', () => {
      store.saveCurrentAsDefault();
      saveBtn.textContent = '✓';
      setTimeout(() => { saveBtn.textContent = saveText; }, 1200);
    });
  },

  _setEditing(editing) {
    document.getElementById('amgt-nappe-picker').classList.toggle('amgt-fs-picker--editing-default', editing);
    document.getElementById('amgt-nappe-picker-save-default').disabled = editing;
    this._renderPicker();
  },

  openPicker() {
    this._draft = null;
    this._setEditing(false);
    if (this._bar) this._bar.reset();
    this._renderPicker();
    document.getElementById('amgt-nappe-picker').classList.remove('amgt-hidden');
  },

  closePicker() {
    this._draft = null; // une édition de la sélection par défaut non enregistrée est abandonnée
    this._setEditing(false);
    if (this._bar) this._bar.reset();
    document.getElementById('amgt-nappe-picker').classList.add('amgt-hidden');
  },

  _renderPicker() {
    const store = AMGT4CEM_NappeSelectionStore;
    const selection = this._draft || store.getSelection();
    const content = document.getElementById('amgt-nappe-picker-content');
    content.textContent = '';
    const codes = this._PARTS.map(([code]) => code);
    const setMany = (on) => {
      if (this._draft) this._draft = on ? store.withMany(this._draft, codes) : store.withoutMany(this._draft, codes);
      else if (on) store.selectMany(codes); else store.deselectMany(codes);
      this._renderPicker();
    };
    const all = document.createElement('label');
    all.className = 'amgt-checkbox-row amgt-topo-global-toggle';
    const n = codes.filter((c) => selection[c]).length;
    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.checked = n === codes.length;
    allCb.indeterminate = n > 0 && n < codes.length;
    allCb.addEventListener('change', () => setMany(allCb.checked));
    all.append(allCb, document.createTextNode(' Tout (dé)sélectionner'));
    content.append(all);
    for (const [code, label] of this._PARTS) {
      const row = document.createElement('label');
      row.className = 'amgt-checkbox-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(selection[code]);
      cb.addEventListener('change', () => {
        if (this._draft) this._draft = store.withToggle(this._draft, code);
        else store.toggle(code);
        this._renderPicker();
      });
      row.append(cb, document.createTextNode(' ' + label));
      content.append(row);
      if (code === 'isopieses' || code === 'stations') {
        const cfg = AMGT4CEM_CONFIG.nappe || {};
        const dflt = cfg[code] ? cfg[code].minZoom : 14;
        content.append(AMGT4CEM_ZoomThresholds.buildControl(`nappe.${code}`, dflt, code === 'isopieses' ? 'Isopièzes et intervalles : à partir du zoom' : 'Stations : à partir du zoom'));
      }
    }
  },

  /** Affichage programmatique des éléments (tests) ; l'interface passe par « modifier la sélection ». */
  setParts({ isopieses, stations, bandes }) {
    if (typeof isopieses === 'boolean') this._showIsopieses = isopieses;
    if (typeof bandes === 'boolean') this._showBandes = bandes;
    if (typeof stations === 'boolean') this._showStations = stations;
    this.refresh();
  },

  /** Réglage d'opacité (icône curseurs du menu ☰ Carte), 0 à 1. */
  setOpacity(factor) {
    this._opacityFactor = factor;
    if (!this._group) return;
    this._group.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker) {
        layer.setStyle({ opacity: factor, fillOpacity: this._basePointFillOpacity * factor });
      } else if (layer instanceof L.ImageOverlay) {
        layer.setOpacity(this._bandOpacity() * factor);
      } else if (layer.options && layer.options.amgtBand) {
        layer.setStyle({ fillOpacity: this._bandOpacity() * factor });
      } else if (layer instanceof L.Polyline) {
        layer.setStyle({ opacity: this._baseLineOpacity * factor });
      } else if (layer instanceof L.Marker && layer.getElement()) {
        layer.getElement().style.opacity = String(factor);
      }
    });
  },

  async refresh() {
    const token = ++this._fetchToken;
    this._group.clearLayers();
    this._setStatus(this._enabled ? 'Chargement…' : '');

    const cfg = AMGT4CEM_CONFIG.nappe;
    if (!this._enabled || !cfg || !cfg.urls || (!this._showIsopieses && !this._showStations)) {
      this._map.removeLayer(this._group);
      return;
    }
    this._group.addTo(this._map);

    // Seuil de zoom propre à chaque élément (data/nappe/parametres.json) : stations dès 13, isopièzes dès 15.
    const zoom = this._map.getZoom();
    const zIso = this._minZoom('isopieses', cfg), zSta = this._minZoom('stations', cfg);
    const wantIsopieses = this._showIsopieses && zoom >= zIso;
    const wantStations = this._showStations && zoom >= zSta;
    const tooFar = [];
    if (this._showIsopieses && !wantIsopieses) tooFar.push(`isopièzes dès le zoom ${zIso}`);
    if (this._showStations && !wantStations) tooFar.push(`stations dès le zoom ${zSta}`);
    if (!wantIsopieses && !wantStations) {
      this._setStatus(`Zoomer davantage : ${tooFar.join(', ')}.`);
      return;
    }

    const bbox = AMGT4CEM_CRS.boundsToLambertBbox(this._map.getBounds());
    const jobs = [];
    if (wantIsopieses) jobs.push(this._loadIsopieses(cfg, bbox, token));
    if (wantStations) jobs.push(this._loadStations(cfg, bbox, token));
    const results = await Promise.all(jobs);
    if (token !== this._fetchToken) return; // la vue a changé entre-temps

    const failures = results.filter((r) => r && r.error).map((r) => r.error);
    const truncated = results.some((r) => r && r.truncated);
    const messages = [];
    if (tooFar.length) messages.push(`Zoomer davantage : ${tooFar.join(', ')}.`);
    const counts = results.filter((r) => r && !r.error).map((r) => `${r.count} ${r.label}`);
    if (counts.length) messages.push(`Dans la vue : ${counts.join(', ')}.`);
    if (results.some((r) => r && !r.error && r.count === 0)) messages.push('Aucun objet dans cette emprise : déplacer ou dézoomer.');
    const legend = results.find((r) => r && r.legend);
    if (legend) messages.push(`Isopièzes : ${legend.legend}.`);
    const sources = [...new Set(results.filter((r) => r && !r.error && r.source).map((r) => r.source))];
    if (sources.length) messages.push(`Source : ${sources.join(' ; ')}.`);
    if (failures.length) messages.push(`Indisponible : ${failures.join(' ; ')}.`);
    if (truncated) messages.push('Résultat tronqué (trop d\'objets) : zoomer pour tout voir.');
    this._setStatus(messages.join(' '));
  },

  // --- Jeux de données complets : copie R2 -> cache de l'appareil -> (en dernier recours) service ----------------

  /**
   * Les isopièzes (modèle de 2013) ne bougent pas et le service régional répond parfois en HTTP 502 : la carte lit donc
   * d'abord la COPIE rangée dans R2 par le Worker nappe-sync/ (clé `nappe-sync` de services.json), qui la revérifie
   * périodiquement. Son etat.json donne l'empreinte (sha256) de chaque jeu : si la copie gardée sur l'appareil
   * (IndexedDB) a la même, elle est utilisée telle quelle, sinon le jeu est retéléchargé. Le service n'est interrogé
   * directement (par emprise, comme avant) que si ni la copie R2 ni le cache de l'appareil ne sont disponibles.
   */
  _datasets: {}, // clé -> Promise du jeu complet { features, source, verifieLe, min, max } (null si indisponible)
  _datasetRetryAt: {}, // clé -> heure avant laquelle on ne réessaie pas (jeu indisponible)
  _idbPromise: null,

  _dataset(key, part, cfg) {
    if (this._datasets[key]) return this._datasets[key];
    if (this._datasetRetryAt[key] && Date.now() < this._datasetRetryAt[key]) return Promise.resolve(null);
    const promise = this._loadDataset(key, part, cfg).then((ds) => {
      if (!ds) { delete this._datasets[key]; this._datasetRetryAt[key] = Date.now() + 60000; } // pas de nouvel essai avant 1 min
      return ds;
    });
    this._datasets[key] = promise;
    return promise;
  },

  async _loadDataset(key, part, cfg) {
    const base = (cfg.snapshotUrl || '').replace(/\/$/, '');
    let meta = null;
    if (base) {
      try {
        const etat = await this._fetchJson(`${base}/nappe/etat.json`, 8000);
        meta = etat && etat.parties && etat.parties[key];
      } catch (err) {
        console.warn('[AMGT4CEM] Copie R2 de la nappe injoignable :', err);
      }
    }
    const cached = await this._idbGet(key);
    if (meta && meta.disponible && cached && cached.sha256 === meta.sha256) {
      return this._prepare(cached.geojson, part, { source: 'copie du serveur AMGT4CEM (déjà sur cet appareil)', verifieLe: meta.verifieLe });
    }
    if (meta && meta.disponible) {
      try {
        const geojson = await this._fetchJson(`${base}/nappe/${key}.json`, 60000);
        this._idbPut(key, { sha256: meta.sha256, geojson });
        return this._prepare(geojson, part, { source: 'copie du serveur AMGT4CEM', verifieLe: meta.verifieLe });
      } catch (err) {
        console.warn(`[AMGT4CEM] Copie R2 « ${key} » illisible :`, err);
      }
    }
    if (cached) return this._prepare(cached.geojson, part, { source: 'cache de cet appareil (non revérifié)', verifieLe: null });
    return null;
  },

  async _fetchJson(url, delaiMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), delaiMs);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  },

  _idb() {
    if (!this._idbPromise) {
      this._idbPromise = new Promise((resolve) => {
        try {
          const rq = indexedDB.open('amgt4cem-nappe', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('jeux');
          rq.onsuccess = () => resolve(rq.result);
          rq.onerror = () => resolve(null);
        } catch (err) {
          resolve(null); // IndexedDB indisponible (navigation privée...) : pas de cache, le reste fonctionne
        }
      });
    }
    return this._idbPromise;
  },

  async _idbGet(key) {
    const db = await this._idb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const rq = db.transaction('jeux').objectStore('jeux').get(key);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      } catch (err) { resolve(null); }
    });
  },

  async _idbPut(key, value) {
    const db = await this._idb();
    if (!db) return;
    try { db.transaction('jeux', 'readwrite').objectStore('jeux').put(value, key); } catch (err) { /* cache facultatif */ }
  },

  /** Ajoute à chaque objet son rectangle englobant (Lambert) et calcule l'étendue des niveaux. */
  _prepare(geojson, part, info) {
    const features = (geojson && geojson.features) || [];
    let min = Infinity;
    let max = -Infinity;
    for (const f of features) {
      f._bb = this._bboxOf(f.geometry);
      const v = Number(f.properties && f.properties[part.attributNiveau]);
      if (part.attributNiveau && Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
    return { features, min, max, ...info };
  },

  _bboxOf(geometry) {
    if (!geometry) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const visit = (c) => {
      if (typeof c[0] === 'number') {
        if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
      } else c.forEach(visit);
    };
    visit(geometry.coordinates || []);
    return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
  },

  /** Objets de l'emprise visible : depuis le jeu complet si disponible, sinon requête directe au service. */
  async _getFeatures(key, part, bbox, cfg) {
    const ds = await this._dataset(key, part, cfg);
    const [minX, minY, maxX, maxY] = bbox;
    if (ds) {
      const list = ds.features.filter((f) => f._bb && f._bb[0] <= maxX && f._bb[2] >= minX && f._bb[1] <= maxY && f._bb[3] >= minY);
      return { list, truncated: false, ds };
    }
    const live = await this._fetchFeatures(part, bbox, cfg);
    return { ...live, ds: null };
  },

  _sourceNote(ds) {
    if (!ds) return 'service régional (copie indisponible)';
    const date = ds.verifieLe ? `, vérifiée le ${new Date(ds.verifieLe).toLocaleDateString('fr-BE')}` : '';
    return `${ds.source}${date}`;
  },

  // --- Isopièzes -----------------------------------------------------------------------------------------------

  async _loadIsopieses(cfg, bbox, token) {
    const part = cfg.isopieses;
    try {
      // Les intervalles se calculent avec des isopièzes situées au-delà de la vue (la ligne voisine peut être loin) :
      // bbox élargie pour elles, vue stricte pour dessiner les lignes et leurs étiquettes.
      const bandes = part.bandes && part.bandes.actif && this._showBandes ? part.bandes : null;
      const margin = bandes ? bandes.rayonM : 0;
      const wide = [bbox[0] - margin, bbox[1] - margin, bbox[2] + margin, bbox[3] + margin];
      const fetched = await this._getFeatures('isopieses', part, wide, cfg);
      if (token !== this._fetchToken) return null;
      const inView = (f) => {
        if (!f._bb) f._bb = this._bboxOf(f.geometry);
        return f._bb && f._bb[0] <= bbox[2] && f._bb[2] >= bbox[0] && f._bb[1] <= bbox[3] && f._bb[3] >= bbox[1];
      };
      const features = { ...fetched, list: fetched.list.filter(inView) };
      let { min, max } = features.ds || { min: Infinity, max: -Infinity };
      if (!features.ds) {
        for (const f of features.list) { const v = Number(f.properties && f.properties[part.attributNiveau]); if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); } }
      }
      if (bandes) {
        // Polygones précalculés (data/nappe/intervalles.json) ; à défaut, calcul par grille.
        const drawn = bandes.fichier ? await this._renderBandPolygons(part, bbox, min, max, token) : false;
        if (token !== this._fetchToken) return null;
        if (!drawn) this._renderBands(fetched.list, part, min, max);
      }
      this._renderIsopieses(features.list, part, cfg, min, max);
      const legend = Number.isFinite(min) && max > min ? `niveaux de ${this._fmt(min)} à ${this._fmt(max)} m DNG, dégradé du foncé (nappe basse) au clair (nappe haute), valeur sur chaque ligne` : '';
      return { truncated: features.truncated, count: features.list.length, label: 'isopièzes', source: this._sourceNote(features.ds), legend };
    } catch (err) {
      console.warn('[AMGT4CEM] Isopièzes de la nappe indisponibles :', err);
      return { error: `isopièzes (${this._reason(err)})` };
    }
  },

  _bandOpacity() {
    const c = AMGT4CEM_CONFIG.nappe;
    return (c && c.isopieses && c.isopieses.bandes && c.isopieses.bandes.opacite) || 0.5;
  },

  _fmt(v) {
    return Number(v).toLocaleString('fr-BE', { maximumFractionDigits: 1 });
  },

  /**
   * Teinte d'un intervalle : dégradé continu de bleus selon l'altitude (foncé = nappe basse, clair = nappe haute),
   * calibré sur les niveaux min/max de TOUT le jeu de données pour que les couleurs ne changent pas d'une vue à l'autre.
   * @param {number} k - numéro de l'intervalle = (niveau de sa ligne basse − décalage) / équidistance
   * @returns {number[]} [r, g, b]
   */
  _bandRgb(k, part, min, max, off) {
    const e = part.bandes ? part.bandes.equidistance : 2;
    const stops = part.rampe;
    const level = off + k * e + e / 2;
    const t = Number.isFinite(min) && max > min ? Math.min(1, Math.max(0, (level - min) / (max - min))) : 0.5;
    const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    const rgb = (hex) => [1, 3, 5].map((q) => parseInt(hex.slice(q, q + 2), 16));
    const [c0, c1] = [rgb(stops[i]), rgb(stops[i + 1])];
    return c0.map((c, q) => Math.round(c + (c1[q] - c) * f));
  },

  /** Décalage des niveaux par rapport à un multiple de l'équidistance (les niveaux du jeu sont tous espacés de 2 m). */
  _levelOffset(features, attr, e) {
    for (const f of features) {
      const v = Number(f.properties && f.properties[attr]);
      if (Number.isFinite(v)) return ((v % e) + e) % e;
    }
    return 0;
  },

  /** Couleur de la ligne d'un niveau : la teinte de l'intervalle qu'elle borde par le bas, mêlée de bleu marine pour rester lisible. */
  _lineColor(level, part, off, min, max) {
    const e = part.bandes ? part.bandes.equidistance : 2;
    const rgb = this._bandRgb(Math.round((level - off) / e), part, min, max, off).map((c, q) => Math.round(c * 0.4 + [11, 42, 107][q] * 0.6));
    return `rgb(${rgb.join(',')})`;
  },


  _textWidth(text, px) {
    if (!this._canvasCtx) this._canvasCtx = document.createElement('canvas').getContext('2d');
    this._canvasCtx.font = `600 ${px}px Arial, sans-serif`; // même police que .amgt-nappe-label (style.css)
    return this._canvasCtx.measureText(text).width;
  },

  // --- Intervalles colorés ---------------------------------------------------------------------------------------

  /** Segments des isopièzes : suite à plat de (x1, y1, x2, y2, niveau), Lambert 72. */
  _lambertSegments(features, attr) {
    const out = [];
    for (const f of features) {
      const v = Number(f.properties && f.properties[attr]);
      if (!Number.isFinite(v)) continue;
      for (const coords of this._lineParts(f.geometry)) {
        for (let i = 0; i + 1 < coords.length; i++) out.push(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1], v);
      }
    }
    return Float64Array.from(out);
  },

  /**
   * Niveau en chaque cellule d'une grille, par interpolation linéaire entre les deux isopièzes voisines de niveaux
   * différents, SI la cellule est entre elles (leurs points les plus proches sont de part et d'autre). Sinon la cellule
   * est « indéterminée » (NaN) : sommet, creux ou bord de la zone couverte, où une valeur serait inventée.
   * @param {Float64Array} segs - (x1, y1, x2, y2, niveau) par segment, Lambert 72 (m)
   * @param {{ox,oy,ax,ay,bx,by}} aff - centre de la cellule (i, j) = (ox + (i+.5)·ax + (j+.5)·bx, oy + (i+.5)·ay + (j+.5)·by)
   * @param {number} rayonM - distance maximale d'une isopièze utile à une cellule
   * @param {number} ecart - équidistance des isopièzes (m) : deux lignes plus éloignées en niveau ne sont pas voisines
   * @returns {Float32Array} niveaux (w × h)
   */
  _interpolateGrid(segs, aff, w, h, rayonM, ecart) {
    const n = w * h;
    const D1 = new Float64Array(n).fill(Infinity), D2 = new Float64Array(n).fill(Infinity);
    const V1 = new Float64Array(n).fill(NaN), V2 = new Float64Array(n).fill(NaN);
    const X1 = new Float64Array(n), Y1 = new Float64Array(n), X2 = new Float64Array(n), Y2 = new Float64Array(n);
    const { ox, oy, ax, ay, bx, by } = aff;
    const det = ax * by - ay * bx;
    const cellM = Math.hypot(ax, ay);
    const pad = rayonM / cellM + 1;
    for (let s = 0; s < segs.length; s += 5) {
      const x1 = segs[s], y1 = segs[s + 1], x2 = segs[s + 2], y2 = segs[s + 3], v = segs[s + 4];
      // Fenêtre de cellules à moins de rayonM du segment (coordonnées de cellule des deux extrémités, élargies).
      const ci1 = ((x1 - ox) * by - (y1 - oy) * bx) / det - 0.5, cj1 = (ax * (y1 - oy) - ay * (x1 - ox)) / det - 0.5;
      const ci2 = ((x2 - ox) * by - (y2 - oy) * bx) / det - 0.5, cj2 = (ax * (y2 - oy) - ay * (x2 - ox)) / det - 0.5;
      const i0 = Math.max(0, Math.floor(Math.min(ci1, ci2) - pad)), i1 = Math.min(w - 1, Math.ceil(Math.max(ci1, ci2) + pad));
      const j0 = Math.max(0, Math.floor(Math.min(cj1, cj2) - pad)), j1 = Math.min(h - 1, Math.ceil(Math.max(cj1, cj2) + pad));
      if (i0 > i1 || j0 > j1) continue;
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cx = ox + (i + 0.5) * ax + (j + 0.5) * bx, cy = oy + (i + 0.5) * ay + (j + 0.5) * by;
          const t = len2 ? Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2)) : 0;
          const qx = x1 + t * dx, qy = y1 + t * dy;
          const d = Math.hypot(cx - qx, cy - qy);
          if (d > rayonM) continue;
          const k = j * w + i;
          if (v === V1[k]) {
            if (d < D1[k]) { D1[k] = d; X1[k] = qx; Y1[k] = qy; }
          } else if (v === V2[k]) {
            if (d < D2[k]) {
              D2[k] = d; X2[k] = qx; Y2[k] = qy;
              if (D2[k] < D1[k]) { // la deuxième ligne devient la plus proche : on échange
                [D1[k], D2[k]] = [D2[k], D1[k]]; [V1[k], V2[k]] = [V2[k], V1[k]];
                [X1[k], X2[k]] = [X2[k], X1[k]]; [Y1[k], Y2[k]] = [Y2[k], Y1[k]];
              }
            }
          } else if (d < D1[k]) {
            D2[k] = D1[k]; V2[k] = V1[k]; X2[k] = X1[k]; Y2[k] = Y1[k];
            D1[k] = d; V1[k] = v; X1[k] = qx; Y1[k] = qy;
          } else if (d < D2[k]) {
            D2[k] = d; V2[k] = v; X2[k] = qx; Y2[k] = qy;
          }
        }
      }
    }
    const out = new Float32Array(n).fill(NaN);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (!Number.isFinite(D1[k]) || !Number.isFinite(D2[k]) || Math.abs(V1[k] - V2[k]) > ecart * 1.01) continue;
        const cx = ox + (i + 0.5) * ax + (j + 0.5) * bx, cy = oy + (i + 0.5) * ay + (j + 0.5) * by;
        const between = (X1[k] - cx) * (X2[k] - cx) + (Y1[k] - cy) * (Y2[k] - cy) < 0;
        if (between && D1[k] + D2[k] > 0) out[k] = V1[k] + ((V2[k] - V1[k]) * D1[k]) / (D1[k] + D2[k]);
      }
    }
    return out;
  },

  /**
   * Intervalle d'un point sans ligne de part et d'autre : on prend la ligne la plus proche (niveau V1) et la plus proche
   * de niveau différent (V2) ; si V2 est plus haut, le point est du côté bas de V1, sinon du côté haut.
   * @returns {number|null} numéro d'intervalle (= numéro de sa ligne basse)
   */
  _nearestBand(segs, cx, cy, e, off) {
    let d1 = Infinity, v1 = NaN, d2 = Infinity, v2 = NaN;
    for (let s = 0; s < segs.length; s += 5) {
      const x1 = segs[s], y1 = segs[s + 1], dx = segs[s + 2] - x1, dy = segs[s + 3] - y1, v = segs[s + 4];
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2)) : 0;
      const d = Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy));
      if (v === v1) { if (d < d1) d1 = d; }
      else if (d < d1) { if (v1 !== v) { d2 = d1; v2 = v1; } d1 = d; v1 = v; }
      else if (v !== v1 && (v === v2 ? d < d2 : d < d2)) { d2 = d; v2 = v; }
    }
    if (!Number.isFinite(d1)) return null;
    const k1 = Math.round((v1 - off) / e);
    if (!Number.isFinite(v2)) return k1;
    return v2 > v1 ? k1 - 1 : k1;
  },

  _bandPolygons: null, // Promise du fichier d'intervalles (polygones Lambert 72), chargé une fois

  _loadBandPolygons(part) {
    if (!this._bandPolygons) {
      this._bandPolygons = fetch(part.bandes.fichier)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((json) => {
          for (const f of json.features) f._bb = this._bboxOf(f.geometry);
          return json.features;
        })
        .catch((err) => { console.warn('[AMGT4CEM] Intervalles précalculés indisponibles, calcul par grille :', err); this._bandPolygons = null; return null; });
    }
    return this._bandPolygons;
  },

  /** Aplats unis : un polygone par zone comprise entre deux isopièzes consécutives, teinte selon l'altitude. */
  async _renderBandPolygons(part, bbox, min, max, token) {
    const feats = await this._loadBandPolygons(part);
    if (!feats || token !== this._fetchToken) return false;
    const e = part.bandes.equidistance;
    const factor = this._opacityFactor;
    for (const f of feats) {
      if (!f._bb || f._bb[0] > bbox[2] || f._bb[2] < bbox[0] || f._bb[1] > bbox[3] || f._bb[3] < bbox[1]) continue;
      if (!f._ll) f._ll = f.geometry.coordinates.map((ring) => ring.map((pt) => AMGT4CEM_CRS.lambertToLatLng(pt)));
      // Une teinte par palier (ex. 10 m = 5 intervalles) : des aplats nettement distincts plutôt qu'un dégradé.
      const palier = part.bandes.paliersM || e;
      const k = Math.floor(f.properties.niv / palier);
      let [r, g, b] = this._bandRgb((k * palier + palier / 2 - e / 2) / e, part, min, max, 0);
      const alt = part.bandes.alternance || 0;
      if (alt && palier === e && Math.round(f.properties.niv / e) % 2) [r, g, b] = [r, g, b].map((c) => Math.round(c + (255 - c) * alt)); // voisins plus distincts
      this._group.addLayer(L.polygon(f._ll, {
        pane: 'amgtNappeFill',
        interactive: false,
        stroke: false,
        fillColor: `rgb(${r},${g},${b})`,
        fillOpacity: this._bandOpacity() * factor,
        amgtBand: true,
      }));
    }
    return true;
  },

  _NO_BAND: -32768,

  /** Intervalle au centre d'une cellule de la région : interpolation entre deux lignes de part et d'autre, sinon ligne la plus proche. */
  _nearestBandAt(rec, w, ox, oy, ax, ay, bx, by, segs, e, off) {
    const i = rec.cell % w, j = (rec.cell - i) / w;
    const cx = ox + (i + 0.5) * ax + (j + 0.5) * bx, cy = oy + (i + 0.5) * ay + (j + 0.5) * by;
    const v = this._interpolateGrid(segs, { ox: cx - 0.5, oy: cy - 0.5, ax: 1, ay: 0, bx: 0, by: 1 }, 1, 1, Infinity, e)[0];
    if (!Number.isNaN(v)) return Math.floor((v - off) / e);
    const k = this._nearestBand(segs, cx, cy, e, off);
    return k === null ? this._NO_BAND : k;
  },

  /**
   * Intervalles COLLÉS aux isopièzes : on dessine les lignes sur une grille, on délimite les zones qu'elles
   * séparent (remplissage par régions), puis chaque zone prend l'intervalle compris entre les deux lignes qui la bordent.
   * Une zone bordée par une seule ligne (sommet, creux) ou par aucune (vue très rapprochée) est tranchée par une
   * interpolation en UN point. Les bords des aplats suivent donc exactement les lignes dessinées.
   * @returns {Int16Array} numéro d'intervalle par cellule (= numéro de sa ligne basse), `_NO_BAND` si indéterminé
   */
  _bandGrid(segs, aff, w, h, e, off, rayonM) {
    const NO = this._NO_BAND, n = w * h, BASE = 2000;
    const { ox, oy, ax, ay, bx, by } = aff;
    const det = ax * by - ay * bx;
    const toCell = (x, y) => [((x - ox) * by - (y - oy) * bx) / det, (ax * (y - oy) - ay * (x - ox)) / det];
    const line = new Int16Array(n); // 0 = pas de ligne, sinon indice de niveau + BASE
    for (let s = 0; s < segs.length; s += 5) {
      const [i1, j1] = toCell(segs[s], segs[s + 1]), [i2, j2] = toCell(segs[s + 2], segs[s + 3]);
      if ((i1 < -1 && i2 < -1) || (i1 > w + 1 && i2 > w + 1) || (j1 < -1 && j2 < -1) || (j1 > h + 1 && j2 > h + 1)) continue;
      const idx = Math.round((segs[s + 4] - off) / e) + BASE;
      const steps = Math.max(1, Math.ceil(Math.hypot(i2 - i1, j2 - j1) / 0.4));
      for (let k = 0; k <= steps; k++) {
        const i = Math.floor(i1 + ((i2 - i1) * k) / steps), j = Math.floor(j1 + ((j2 - j1) * k) / steps);
        if (i >= 0 && i < w && j >= 0 && j < h) line[j * w + i] = idx;
      }
    }
    // Régions (4-connexité) et niveaux des lignes qui les bordent.
    const region = new Int32Array(n).fill(-1);
    const info = []; // { cell, levels:Set }
    const stack = new Int32Array(n);
    for (let start = 0; start < n; start++) {
      if (line[start] || region[start] >= 0) continue;
      const id = info.length;
      const rec = { cell: start, levels: new Set() };
      info.push(rec);
      let sp = 0;
      stack[sp++] = start;
      region[start] = id;
      while (sp) {
        const k = stack[--sp], i = k % w, j = (k - i) / w;
        const nb = [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, j > 0 ? k - w : -1, j < h - 1 ? k + w : -1];
        for (const m of nb) {
          if (m < 0) continue;
          if (line[m]) rec.levels.add(line[m]);
          else if (region[m] < 0) { region[m] = id; stack[sp++] = m; }
        }
      }
    }
    // Régions voisines de part et d'autre d'une même ligne (pour trancher sommets et creux par proximité).
    const across = [];
    const seen = new Set();
    for (let k = 0; k < n; k++) {
      if (!line[k]) continue;
      const i = k % w, j = (k - i) / w;
      const rs = [];
      for (const m of [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, j > 0 ? k - w : -1, j < h - 1 ? k + w : -1]) {
        if (m >= 0 && region[m] >= 0 && !rs.includes(region[m])) rs.push(region[m]);
      }
      for (let p = 0; p < rs.length; p++) for (let q = p + 1; q < rs.length; q++) {
        const key = rs[p] < rs[q] ? `${rs[p]}_${rs[q]}_${line[k]}` : `${rs[q]}_${rs[p]}_${line[k]}`;
        if (!seen.has(key)) { seen.add(key); across.push([rs[p], rs[q], line[k] - BASE]); }
      }
    }
    // Intervalle de chaque région : bordée par deux lignes consécutives = l'intervalle qu'elles délimitent.
    const bandOf = new Int16Array(info.length).fill(NO);
    const single = []; // régions bordées par une seule ligne : tranchées d'après leurs voisines
    info.forEach((rec, id) => {
      const lv = [...rec.levels].sort((a, b) => a - b);
      if (lv.length === 2 && lv[1] - lv[0] === 1) bandOf[id] = lv[0] - BASE;
      else if (lv.length === 1) single.push(id);
      else if (lv.length === 0) bandOf[id] = this._nearestBandAt(rec, w, ox, oy, ax, ay, bx, by, segs, e, off);
      else if (lv.length >= 2) { // lignes non consécutives : valeur interpolée au centre d'une cellule de la région
        const i = rec.cell % w, j = (rec.cell - i) / w;
        const cx = ox + (i + 0.5) * ax + (j + 0.5) * bx, cy = oy + (i + 0.5) * ay + (j + 0.5) * by;
        const v = this._interpolateGrid(segs, { ox: cx - 0.5, oy: cy - 0.5, ax: 1, ay: 0, bx: 0, by: 1 }, 1, 1, rayonM, e)[0];
        bandOf[id] = Number.isNaN(v) ? this._nearestBandAt(rec, w, ox, oy, ax, ay, bx, by, segs, e, off) : Math.floor((v - off) / e);
      }
    });
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const [r1, r2, L] of across) {
        for (const [r, o] of [[r1, r2], [r2, r1]]) {
          if (bandOf[r] !== NO || !single.includes(r) || bandOf[o] === NO) continue;
          // la voisine est au-dessus de la ligne L (intervalle L) -> r est dessous (L-1), et inversement
          if (bandOf[o] === L) { bandOf[r] = L - 1; changed = true; }
          else if (bandOf[o] === L - 1) { bandOf[r] = L; changed = true; }
        }
      }
      if (!changed) break;
    }
    for (const id of single) { // sommet ou creux sans voisine résolue : proximité des lignes
      if (bandOf[id] === NO) bandOf[id] = this._nearestBandAt(info[id], w, ox, oy, ax, ay, bx, by, segs, e, off);
    }
    // Image : régions, puis cases des lignes (elles prennent l'intervalle d'une région voisine).
    const out = new Int16Array(n).fill(NO);
    for (let k = 0; k < n; k++) if (region[k] >= 0) out[k] = bandOf[region[k]];
    for (let k = 0; k < n; k++) {
      if (!line[k]) continue;
      const i = k % w, j = (k - i) / w;
      for (const m of [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, j > 0 ? k - w : -1, j < h - 1 ? k + w : -1]) {
        if (m >= 0 && region[m] >= 0 && out[m] !== NO) { out[k] = out[m]; break; }
      }
    }
    return out;
  },

  /**
   * Colore l'espace entre deux isopièzes voisines (une teinte par intervalle de 2 m, teintes bleues alternées, assorties aux lignes).
   * Calculé pour la vue seulement, sur une grille de cellules d'écran dont la taille grossit si les isopièzes sont
   * nombreuses (budget d'opérations de `bandes.budgetOperations`) ; image posée sous les couches vectorielles.
   */
  _renderBands(features, part, min, max) {
    const b = part.bandes;
    const map = this._map;
    const size = map.getSize();
    const segs = this._lambertSegments(features, part.attributNiveau);
    if (!segs.length) return;
    const lam = (pt) => AMGT4CEM_CRS.latLngToLambert(map.containerPointToLatLng(pt));
    const o = lam([0, 0]), px = lam([size.x, 0]), py = lam([0, size.y]);
    const perX = [(px.x - o.x) / size.x, (px.y - o.y) / size.x], perY = [(py.x - o.x) / size.y, (py.y - o.y) / size.y];
    const mPerPx = Math.hypot(perX[0], perX[1]);
    const c = b.cellulePx;
    const w = Math.ceil(size.x / c), h = Math.ceil(size.y / c);
    const aff = { ox: o.x, oy: o.y, ax: perX[0] * c, ay: perX[1] * c, bx: perY[0] * c, by: perY[1] * c };
    const off = this._levelOffset(features, part.attributNiveau, b.equidistance);
    const bandGrid = this._bandGrid(segs, aff, w, h, b.equidistance, off, b.rayonM);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(w, h);
    const colours = new Map();
    let painted = 0;
    for (let k = 0; k < bandGrid.length; k++) {
      const band = bandGrid[k];
      if (band === this._NO_BAND) continue;
      if (!colours.has(band)) colours.set(band, this._bandRgb(band, part, min, max, off));
      const [r, g, bl] = colours.get(band);
      image.data[4 * k] = r; image.data[4 * k + 1] = g; image.data[4 * k + 2] = bl; image.data[4 * k + 3] = 255;
      painted++;
    }
    if (!painted) return;
    ctx.putImageData(image, 0, 0);
    const bounds = L.latLngBounds(map.containerPointToLatLng([0, 0]), map.containerPointToLatLng([w * c, h * c]));
    this._group.addLayer(L.imageOverlay(canvas.toDataURL('image/png'), bounds, {
      pane: 'amgtNappeFill',
      interactive: false,
      className: 'amgt-nappe-bands',
      opacity: this._bandOpacity() * this._opacityFactor,
    }));
  },

  _lineParts(geom) {
    if (!geom) return [];
    if (geom.type === 'LineString') return [geom.coordinates];
    if (geom.type === 'MultiLineString') return geom.coordinates;
    return [];
  },

  /**
   * Isopièzes : chaque ligne est colorée selon son niveau ; la valeur est écrite DANS la ligne, alignée sur elle, qui est
   * interrompue à cet endroit (pas de trait sous le texte). Le texte reste toujours lisible : son angle est ramené dans
   * [-90°, +90°[ (jamais à l'envers), à la taille de police de l'indicateur de zoom. Étiquettes régulièrement espacées
   * le long de chaque ligne, calculées en pixels du zoom courant (donc recalculées à chaque déplacement/zoom).
   */
  _renderIsopieses(list, part, cfg, min, max) {
    const off = this._levelOffset(list, part.attributNiveau, part.bandes ? part.bandes.equidistance : 2);
    const map = this._map;
    const px = part.etiquettePx || 12;
    const padding = 4;
    const labelled = map.getZoom() >= part.etiquetteMinZoom;
    const margin = 200;
    for (const feature of list) {
      const value = Number(feature.properties && feature.properties[part.attributNiveau]);
      const color = this._lineColor(value, part, off, min, max);
      const text = Number.isFinite(value) ? this._fmt(value) : '';
      const width = text ? this._textWidth(text, px) + 2 * padding : 0;
      const keep = []; // morceaux de ligne conservés (LatLng)

      for (const coords of this._lineParts(feature.geometry)) {
        const pts = coords.map((c) => map.latLngToLayerPoint(AMGT4CEM_CRS.lambertToLatLng(c)));
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
        const total = cum[cum.length - 1];
        const cuts = [];
        if (labelled && width && total >= width * 1.8) {
          const n = Math.max(1, Math.round(total / (part.etiquetteEspacementPx || 480)));
          for (let k = 0; k < n; k++) {
            const s = (total * (k + 0.5)) / n;
            const centre = this._pointAt(pts, cum, s);
            if (!this._inLayerView(centre, margin)) continue; // étiquette hors de la vue : ni posée ni coupée
            const before = this._pointAt(pts, cum, s - width / 2);
            const after = this._pointAt(pts, cum, s + width / 2);
            let angle = (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI;
            // Plage [-90°, +90°[ : jamais à l'envers ; une ligne verticale donne -90° (texte lisible de bas en haut).
            if (angle >= 90) angle -= 180;
            else if (angle < -90) angle += 180;
            cuts.push([s - width / 2, s + width / 2]);
            this._group.addLayer(this._buildLabel(map.layerPointToLatLng(centre), text, angle, color, px));
          }
        }
        for (const piece of this._cut(pts, cum, total, cuts)) keep.push(piece.map((p) => map.layerPointToLatLng(p)));
      }
      if (!keep.length) continue;
      const line = L.polyline(keep, { color, weight: part.epaisseur, opacity: this._baseLineOpacity * this._opacityFactor });
      line.bindPopup(() => this._buildPopup(part.libelle, feature.properties || {}, part.attributsPopup, cfg, true));
      this._group.addLayer(line);
    }
  },

  _inLayerView(layerPoint, margin) {
    const size = this._map.getSize();
    const origin = this._map.containerPointToLayerPoint([0, 0]);
    return layerPoint.x >= origin.x - margin && layerPoint.x <= origin.x + size.x + margin &&
      layerPoint.y >= origin.y - margin && layerPoint.y <= origin.y + size.y + margin;
  },

  /** Point situé à la distance `s` (px) du début de la ligne (bornée à ses extrémités). */
  _pointAt(pts, cum, s) {
    const total = cum[cum.length - 1];
    if (s <= 0) return pts[0];
    if (s >= total) return pts[pts.length - 1];
    let i = 1;
    while (cum[i] < s) i++;
    const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return L.point(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f);
  },

  /** Morceaux de la ligne une fois retirés les intervalles [début, fin] (distances en px, triés ou non). */
  _cut(pts, cum, total, cuts) {
    const sorted = cuts.slice().sort((a, b) => a[0] - b[0]);
    const keepRanges = [];
    let from = 0;
    for (const [a, b] of sorted) {
      if (a > from) keepRanges.push([from, a]);
      from = Math.max(from, b);
    }
    if (from < total) keepRanges.push([from, total]);
    const pieces = [];
    for (const [a, b] of keepRanges) {
      if (b - a < 0.5) continue;
      const piece = [this._pointAt(pts, cum, a)];
      for (let i = 1; i < pts.length - 1; i++) if (cum[i] > a && cum[i] < b) piece.push(pts[i]);
      piece.push(this._pointAt(pts, cum, b));
      pieces.push(piece);
    }
    return pieces;
  },

  /** Étiquette de niveau : texte seul, centré sur son point et tourné de `angle` degrés (sens horaire de l'écran). */
  _buildLabel(latlng, text, angle, color, px) {
    const el = document.createElement('span');
    el.className = 'amgt-nappe-label';
    el.textContent = text;
    el.style.fontSize = `${px}px`;
    el.style.color = color;
    el.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(1)}deg)`;
    return L.marker(latlng, {
      icon: L.divIcon({ className: 'amgt-nappe-label-icon', html: el, iconSize: [0, 0] }),
      interactive: false,
      keyboard: false,
      opacity: this._opacityFactor,
    });
  },

  // --- Stations de mesure --------------------------------------------------------------------------------------

  async _loadStations(cfg, bbox, token) {
    const part = cfg.stations;
    try {
      const features = await this._getFeatures('stations', part, bbox, cfg);
      if (token !== this._fetchToken) return null;
      for (const feature of features.list) {
        const g = feature.geometry;
        const coords = g && (g.type === 'Point' ? g.coordinates : g.type === 'MultiPoint' ? g.coordinates[0] : null);
        if (!coords) continue;
        const marker = L.circleMarker(AMGT4CEM_CRS.lambertToLatLng(coords), {
          radius: part.rayon,
          color: '#fff',
          weight: 1.5,
          fillColor: part.couleur,
          opacity: this._opacityFactor,
          fillOpacity: this._basePointFillOpacity * this._opacityFactor,
        });
        marker.bindPopup(() => this._buildPopup(part.libelle, feature.properties || {}, part.attributsPopup, cfg, false));
        this._group.addLayer(marker);
      }
      return { truncated: features.truncated, count: features.list.length, label: 'stations', source: this._sourceNote(features.ds) };
    } catch (err) {
      console.warn('[AMGT4CEM] Stations piézométriques indisponibles :', err);
      return { error: `stations (${this._reason(err)})` };
    }
  },

  // --- Service WFS ---------------------------------------------------------------------------------------------

  /** Adresse du WFS d'un élément (isopièzes, stations) d'après services.json ; lève une Error si absente. */
  _serviceUrl(part, cfg) {
    const url = cfg.urls && cfg.urls[part.service];
    if (!url) throw new Error(`service « ${part.service} » non configuré (data/fonds-de-plan/services.json)`);
    return url;
  },

  /** Nom publié d'une couche (avec préfixe), d'après le GetCapabilities de son service ; null s'il n'y figure pas. */
  async _resolveTypeName(part, cfg) {
    const url = this._serviceUrl(part, cfg);
    const memo = `${url}|${part.couche}`;
    if (memo in this._typeNames) return this._typeNames[memo];
    if (!this._capabilitiesByUrl[url]) this._capabilitiesByUrl[url] = this._fetchPublishedTypeNames(url, cfg);
    const published = await this._capabilitiesByUrl[url];
    // Préfixe d'espace de noms (« ns:nom ») ou de jeu de données (« bruenvi_nom ») : on accepte une fin de nom égale
    // à celle configurée, la plus courte l'emportant (la plus proche du nom exact).
    const matches = published
      .filter((name) => name === part.couche || name.endsWith(`:${part.couche}`) || name.endsWith(`_${part.couche}`))
      .sort((a, b) => a.length - b.length);
    this._typeNames[memo] = matches[0] || null;
    if (!matches[0]) {
      const related = published.filter((n) => /groundwater|piezo|phreatic|nappe|grondwater/i.test(n));
      console.warn(`[AMGT4CEM] Couche « ${part.couche} » absente du GetCapabilities de ${url} (${published.length} couches publiées). ` +
        `Couches proches : ${related.join(', ') || 'aucune'}. Toutes : ${published.join(', ')}`);
      this._candidates = related.length ? related : published;
    }
    return this._typeNames[memo];
  },

  async _fetchPublishedTypeNames(url, cfg) {
    const params = new URLSearchParams({ service: 'WFS', version: cfg.wfsVersion, request: 'GetCapabilities' });
    try {
      const response = await fetch(`${url}?${params.toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = new DOMParser().parseFromString(await response.text(), 'text/xml');
      return Array.from(xml.getElementsByTagNameNS('*', 'FeatureType'))
        .map((ft) => {
          const name = ft.getElementsByTagNameNS('*', 'Name')[0];
          return name ? name.textContent.trim() : '';
        })
        .filter(Boolean);
    } catch (err) {
      delete this._capabilitiesByUrl[url]; // une panne passagère ne doit pas condamner la session : on réessaiera
      throw err;
    }
  },

  /** Objets de l'emprise visible (bbox Lambert 72), au plus `maxFeaturesPerQuery`. */
  async _fetchFeatures(part, [minX, minY, maxX, maxY], cfg) {
    const url = this._serviceUrl(part, cfg);
    const typeName = await this._resolveTypeName(part, cfg);
    if (!typeName) {
      const near = (this._candidates || []).slice(0, 8).join(', ');
      throw new Error(`couche « ${part.couche} » introuvable sur ${url}${near ? ` ; couches publiées proches : ${near}` : ''}`);
    }
    const crs = AMGT4CEM_CONFIG.businessCRS.epsg;
    const params = new URLSearchParams({
      service: 'WFS',
      version: cfg.wfsVersion,
      request: 'GetFeature',
      typeName,
      outputFormat: 'application/json',
      srsName: crs,
      bbox: `${minX},${minY},${maxX},${maxY},${crs}`,
      maxFeatures: String(cfg.maxFeaturesPerQuery + 1), // un objet de trop sert à détecter la troncature
    });
    const response = await fetch(`${url}?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();
    const all = geojson.features || [];
    return { list: all.slice(0, cfg.maxFeaturesPerQuery), truncated: all.length > cfg.maxFeaturesPerQuery };
  },

  // --- Fenêtre d'information et état ---------------------------------------------------------------------------

  /** Construction DOM sûre (pas d'innerHTML) : les valeurs viennent d'un service externe. */
  _buildPopup(title, props, labels, cfg, modele) {
    const container = document.createElement('div');
    container.className = 'amgt-popup';
    const heading = document.createElement('strong');
    heading.textContent = title;
    container.appendChild(heading);

    const table = document.createElement('table');
    const addRow = (label, value) => {
      if (value === undefined || value === null || value === '') return;
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = label;
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(th, td);
      table.appendChild(tr);
    };
    if (labels) {
      for (const [key, label] of Object.entries(labels)) addRow(label, props[key]);
    } else {
      // Attributs non confirmés : tout ce que le service renvoie, sans identifiant technique interne.
      for (const [key, value] of Object.entries(props)) if (key !== 'gid' && typeof value !== 'object') addRow(key, value);
    }
    container.appendChild(table);

    if (modele && cfg.periodeReference) {
      const note = document.createElement('p');
      note.className = 'amgt-nappe-note';
      note.textContent = `Modèle, état de ${cfg.periodeReference}. ${cfg.mentionLegale || ''}`.trim();
      container.appendChild(note);
    }
    return container;
  },

  /** Cause lisible d'un échec : un TypeError de fetch() = refus du navigateur (CORS) ou réseau coupé. */
  _reason(err) {
    if (err instanceof TypeError) return 'refusé par le navigateur (CORS) ou service injoignable';
    return String(err && err.message ? err.message : err);
  },

  _setStatus(text) {
    if (this._statusEl) this._statusEl.textContent = text;
  },
};
