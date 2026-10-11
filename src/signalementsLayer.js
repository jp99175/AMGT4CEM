/**
 * Couche « Signalements et demandes » de la carte : les entrées envoyées au serveur de dépôt, visibles par tous
 * les agents connectés. Elle remplace l'ancienne couche « Points métier » (micro-base locale, abandonnée).
 *
 * Lecture seule : les données viennent de GET /signalements (index tenu par le serveur de dépôt, voir
 * depot-signalements/). Il faut une connexion (matricule + mot de passe, module src/auth/) ; sans elle la couche
 * reste vide et le menu propose de se connecter. Les entrées sans position sont comptées, pas dessinées.
 *
 * Les popups sont construites en DOM (textContent) : titre, lieu et description viennent de la saisie des agents.
 */
const AMGT4CEM_SignalementsLayer = {
  _map: null,
  _group: null,
  _opacityFactor: 1,
  _amiante: [],
  _vocab: null,
  _statusEl: null,
  _data: [], // entrées du serveur (toutes), filtrées à l'affichage par type
  _hidden: new Set(), // types masqués sur cet appareil (tout est affiché par défaut)
  _storeKey: 'amgt4cem.signalements-types.v1',

  init(map) {
    this._map = map;
    this._group = L.layerGroup().addTo(map);
    this._statusEl = document.getElementById('amgt-signalements-status');
    try { this._hidden = new Set(JSON.parse(localStorage.getItem(this._storeKey) || '[]')); } catch (err) { this._hidden = new Set(); }
    document.getElementById('amgt-signalements-picker-close').addEventListener('click', () => this.closePicker());
    const plugin = (AMGT4CEM_CONFIG.plugins || []).find((p) => p.id === 'signalements') || {};
    this._options = plugin.options || {};
    AMGT4CEM_Auth.init(this._options);
    map.on('zoomend', () => this._updateAmianteIcons());
    this.refresh();
    return this._group;
  },

  setOpacity(factor) {
    this._opacityFactor = factor;
    this._group.eachLayer((m) => m.setOpacity(factor));
  },

  /** Vocabulaire public (libellés des types et domaines), chargé une fois. */
  async _vocabulary() {
    if (this._vocab) return this._vocab;
    try {
      const r = await fetch('./data/signalements/vocabulaire.json', { cache: 'no-cache' });
      this._vocab = await r.json();
    } catch (err) {
      this._vocab = { types: [], natures: [] };
    }
    return this._vocab;
  },

  _status(text, action) {
    const el = this._statusEl;
    if (!el) return;
    el.textContent = text ? `${text} ` : '';
    if (action) {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = action.label;
      a.addEventListener('click', (e) => { e.preventDefault(); action.run(); });
      el.appendChild(a);
    }
  },

  /** Demande la connexion si besoin, puis recharge. Appelée à l'activation de la case du menu. */
  async connectAndRefresh() {
    if (!AMGT4CEM_Auth.configured()) { this._status('Aucun serveur de dépôt configuré.'); return; }
    if (!AMGT4CEM_Auth.session()) {
      await AMGT4CEM_Auth.ensure({ message: 'Connectez-vous pour voir les signalements et demandes sur la carte.' });
    }
    await this.refresh();
  },

  async refresh() {
    if (!AMGT4CEM_Auth.configured()) { this._data = []; this._draw(); this._status('Aucun serveur de dépôt configuré.'); return; }
    if (!AMGT4CEM_Auth.session()) {
      this._data = [];
      this._draw();
      this._status('Connexion requise.', { label: '(se connecter)', run: () => this.connectAndRefresh() });
      return;
    }
    try {
      this._data = (await AMGT4CEM_Auth.call('/signalements')).signalements || [];
    } catch (err) {
      console.error('[AMGT4CEM] Signalements illisibles :', err);
      this._data = [];
      this._draw();
      if (err.status === 401) this._status('Connexion requise.', { label: '(se connecter)', run: () => this.connectAndRefresh() });
      else this._status(`Lecture impossible : ${err.message}`, { label: '(réessayer)', run: () => this.refresh() });
      return;
    }
    this._status('');
    await this._draw();
  },

  /** Dessine les entrées positionnées dont le type n'est pas masqué. */
  async _draw() {
    this._group.clearLayers();
    this._amiante = [];
    const vocab = await this._vocabulary();
    for (const s of this._data) {
      if (s.x == null || s.y == null || this._hidden.has(s.type)) continue;
      this._addMarker(s, vocab);
    }
    this._updateAmianteIcons();
  },

  // ---------------------------------------------------------------- sélection des types affichés

  /** Types proposés : ceux du vocabulaire encore actifs, plus les anciens types dont des entrées existent. */
  async _pickerTypes() {
    const vocab = await this._vocabulary();
    const presents = new Set(this._data.map((s) => s.type));
    return (vocab.types || []).filter((t) => !t.obsolete || presents.has(t.code));
  },

  async openPicker() {
    this._renderPicker();
    document.getElementById('amgt-signalements-picker').classList.remove('amgt-hidden');
  },

  closePicker() {
    document.getElementById('amgt-signalements-picker').classList.add('amgt-hidden');
  },

  _setHidden(codes, hide) {
    for (const c of codes) { if (hide) this._hidden.add(c); else this._hidden.delete(c); }
    try { localStorage.setItem(this._storeKey, JSON.stringify([...this._hidden])); } catch (err) { /* stockage indisponible : choix valable pour la session */ }
    this._draw();
    this._renderPicker();
  },

  async _renderPicker() {
    const content = document.getElementById('amgt-signalements-picker-content');
    const types = await this._pickerTypes();
    const codes = types.map((t) => t.code);
    content.textContent = '';
    const all = document.createElement('label');
    all.className = 'amgt-checkbox-row amgt-topo-global-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const shown = codes.filter((c) => !this._hidden.has(c)).length;
    cb.checked = shown === codes.length;
    cb.indeterminate = shown > 0 && shown < codes.length;
    cb.addEventListener('change', () => this._setHidden(codes, !cb.checked));
    all.append(cb, document.createTextNode(' Tout (dé)sélectionner'));
    content.append(all);
    for (const t of types) {
      const row = document.createElement('label');
      row.className = 'amgt-checkbox-row';
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !this._hidden.has(t.code);
      c.addEventListener('change', () => this._setHidden([t.code], !c.checked));
      const n = this._data.filter((s) => s.type === t.code).length;
      row.append(c, document.createTextNode(` ${t.fr}${t.obsolete ? ' (ancien type)' : ''}${n ? ` (${n})` : ''}`));
      content.append(row);
    }
  },

  _pictoZoomMin() {
    const z = Number(this._options.amiantePictoZoomMin);
    return Number.isFinite(z) ? z : 17;
  },

  _updateAmianteIcons() {
    if (!this._map) return;
    const picto = this._map.getZoom() >= this._pictoZoomMin();
    for (const a of this._amiante) a.marker.setIcon(picto ? a.picto : a.small);
  },

  _addMarker(s, vocab) {
    const amiante = s.type === 'APPLICATION_AMIANTE';
    const small = L.divIcon({
      className: `amgt-sig-marker${amiante ? ' amgt-sig-marker--amiante' : ''}`,
      html: '<div class="amgt-sig-marker__dot"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    const marker = L.marker(AMGT4CEM_CRS.lambertToLatLng([s.x, s.y]), { icon: small, opacity: this._opacityFactor });
    marker.bindPopup(this._popup(s, vocab));
    marker.addTo(this._group);
    if (amiante) {
      const picto = L.divIcon({
        className: 'amgt-sig-marker amgt-sig-marker--picto',
        html: '<img src="./src/signal/img/amiante.svg" alt="Amiante" width="17" height="36" draggable="false">',
        iconSize: [17, 36],
        iconAnchor: [8, 18],
      });
      this._amiante.push({ marker, small, picto });
    }
  },

  _popup(s, vocab) {
    const p = (text, cls) => { const e = document.createElement('p'); if (cls) e.className = cls; e.textContent = text; return e; };
    const day = (iso) => {
      const d = new Date(iso);
      if (!iso || Number.isNaN(d.getTime())) return '';
      const z = (n) => String(n).padStart(2, '0');
      return `${z(d.getDate())}.${z(d.getMonth() + 1)}.${d.getFullYear()}`;
    };
    const type = (vocab.types || []).find((t) => t.code === s.type);
    const nature = (vocab.natures || []).find((n) => n.code === s.nature);
    const box = document.createElement('div');
    box.className = 'amgt-popup amgt-sig-popup';
    const titre = document.createElement('strong');
    titre.textContent = s.titre || (type && type.fr) || 'Entrée';
    box.append(titre);
    const v = `v0.${String(s.version || 1).padStart(2, '0')}`;
    const quand = day(s.modifieLe || s.recuLe);
    box.append(p([s.reference, v, quand ? `du ${quand}` : ''].filter(Boolean).join(' '), 'amgt-sig-popup__ref'));
    box.append(p([(nature && nature.fr) || s.nature, (type && type.fr) || s.type, s.domaine].filter(Boolean).join(' – ').toUpperCase(), 'amgt-sig-popup__kind'));
    if (s.dateObservation) box.append(p(`Observé le ${day(s.dateObservation)}`));
    if (s.lieu) box.append(p(s.lieu));
    if (s.description) box.append(p(s.description));
    if (s.nbPieces) box.append(p(`${s.nbPieces} photo${s.nbPieces > 1 ? 's' : ''}`));
    if (s.redacteurNom) box.append(p(`Rédacteur : ${s.redacteurNom}`));
    const autres = (s.contributeursNoms || []).filter((n) => n !== s.redacteurNom);
    if (autres.length) box.append(p(`Contributeurs : ${autres.join(', ')}`));
    return box;
  },
};
