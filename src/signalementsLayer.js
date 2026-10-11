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

  init(map) {
    this._map = map;
    this._group = L.layerGroup().addTo(map);
    this._statusEl = document.getElementById('amgt-signalements-status');
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
    this._group.clearLayers();
    this._amiante = [];
    if (!AMGT4CEM_Auth.configured()) { this._status('Aucun serveur de dépôt configuré.'); return; }
    if (!AMGT4CEM_Auth.session()) {
      this._status('Connexion requise.', { label: '(se connecter)', run: () => this.connectAndRefresh() });
      return;
    }
    let data;
    try {
      data = await AMGT4CEM_Auth.call('/signalements');
    } catch (err) {
      console.error('[AMGT4CEM] Signalements illisibles :', err);
      if (err.status === 401) this._status('Connexion requise.', { label: '(se connecter)', run: () => this.connectAndRefresh() });
      else this._status(`Lecture impossible : ${err.message}`, { label: '(réessayer)', run: () => this.refresh() });
      return;
    }
    const vocab = await this._vocabulary();
    let sansPosition = 0;
    for (const s of data.signalements || []) {
      if (s.x == null || s.y == null) { sansPosition++; continue; }
      this._addMarker(s, vocab);
    }
    const n = (data.signalements || []).length - sansPosition;
    this._status(`${n} sur la carte${sansPosition ? `, ${sansPosition} sans position` : ''}.`, { label: '(actualiser)', run: () => this.refresh() });
    this._updateAmianteIcons();
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
