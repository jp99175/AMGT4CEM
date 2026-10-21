/**
 * Couche « Nappe phréatique » : deux jeux de données du WFS « water » de Bruxelles Environnement
 * (adresse : data/fonds-de-plan/services.json, clé `eaux-souterraines` ; réglages : data/nappe/parametres.json) :
 *
 *  - ISOPIÈZES de la nappe phréatique (lignes de niveau, équidistance 2 m, en m DNG) : résultat du modèle BPSM v1.0,
 *    état de MAI 2013. Valeur indicative, qui ne remplace pas une étude d'expert (mention reprise dans chaque fenêtre) ;
 *  - STATIONS de mesure piézométriques (points) du réseau de suivi régional. Les chroniques ne sont pas servies par le
 *    WFS : seule la position et les attributs de la station s'affichent ici.
 *
 * Même principe que UrbIS Topo (urbisTopoLayer.js) : rien n'est requêté tant que la case est décochée, seuls les objets de
 * l'emprise visible sont demandés, et en dessous du zoom minimal rien n'est affiché ni requêté. Une couche en échec
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
  _fetchToken: 0,
  _moveTimer: null,
  _typeNames: {}, // nom configuré -> nom publié (ou null si introuvable), mémorisé par session
  _capabilitiesPromise: null,
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

    map.on('moveend', () => {
      if (!this._enabled) return;
      clearTimeout(this._moveTimer);
      this._moveTimer = setTimeout(() => this.refresh(), 400);
    });
  },

  setEnabled(enabled) {
    this._enabled = enabled;
    this.refresh();
  },

  /** Cases « Isopièzes » / « Stations de mesure » du sous-volet du menu. */
  setParts({ isopieses, stations }) {
    if (typeof isopieses === 'boolean') this._showIsopieses = isopieses;
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
    if (!this._enabled || !cfg || !cfg.wfsUrl || (!this._showIsopieses && !this._showStations)) {
      this._map.removeLayer(this._group);
      if (this._enabled && (!cfg || !cfg.wfsUrl)) this._setStatus('Service non configuré (services.json, clé « eaux-souterraines »).');
      return;
    }
    this._group.addTo(this._map);

    if (this._map.getZoom() < cfg.minZoom) {
      this._setStatus(`Zoomer davantage pour afficher la nappe (niveau ${cfg.minZoom} minimum).`);
      return;
    }

    const bbox = AMGT4CEM_CRS.boundsToLambertBbox(this._map.getBounds());
    const jobs = [];
    if (this._showIsopieses) jobs.push(this._loadIsopieses(cfg, bbox, token));
    if (this._showStations) jobs.push(this._loadStations(cfg, bbox, token));
    const results = await Promise.all(jobs);
    if (token !== this._fetchToken) return; // la vue a changé entre-temps

    const failures = results.filter((r) => r && r.error).map((r) => r.error);
    const truncated = results.some((r) => r && r.truncated);
    const messages = [];
    const counts = results.filter((r) => r && !r.error).map((r) => `${r.count} ${r.label}`);
    if (counts.length) messages.push(`Dans la vue : ${counts.join(', ')}.`);
    if (results.some((r) => r && !r.error && r.count === 0)) messages.push('Aucun objet dans cette emprise : déplacer ou dézoomer.');
    if (failures.length) messages.push(`Indisponible : ${failures.join(' ; ')}.`);
    if (truncated) messages.push('Résultat tronqué (trop d\'objets) : zoomer pour tout voir.');
    this._setStatus(messages.join(' '));
  },

  // --- Isopièzes -----------------------------------------------------------------------------------------------

  async _loadIsopieses(cfg, bbox, token) {
    const part = cfg.isopieses;
    try {
      const features = await this._fetchFeatures(part.couche, bbox, cfg);
      if (token !== this._fetchToken) return null;
      const labelled = this._map.getZoom() >= part.etiquetteMinZoom;
      for (const feature of features.list) {
        const line = this._buildLine(feature, part, cfg);
        if (line) this._group.addLayer(line);
        if (labelled) {
          const label = this._buildLineLabel(feature, part);
          if (label) this._group.addLayer(label);
        }
      }
      return { truncated: features.truncated, count: features.list.length, label: 'isopièzes' };
    } catch (err) {
      console.warn('[AMGT4CEM] Isopièzes de la nappe indisponibles :', err);
      return { error: `isopièzes (${this._reason(err)})` };
    }
  },

  _lineParts(geom) {
    if (!geom) return [];
    if (geom.type === 'LineString') return [geom.coordinates];
    if (geom.type === 'MultiLineString') return geom.coordinates;
    return [];
  },

  _buildLine(feature, part, cfg) {
    const parts = this._lineParts(feature.geometry).map((line) => line.map((pair) => AMGT4CEM_CRS.lambertToLatLng(pair)));
    if (!parts.length) return null;
    const line = L.polyline(parts, { color: part.couleur, weight: part.epaisseur, opacity: this._baseLineOpacity * this._opacityFactor });
    line.bindPopup(() => this._buildPopup(part.libelle, feature.properties || {}, part.attributsPopup, cfg));
    return line;
  },

  /** Étiquette de niveau posée au milieu de la ligne (marqueur non cliquable, texte seul). */
  _buildLineLabel(feature, part) {
    const value = feature.properties && feature.properties[part.attributNiveau];
    const parts = this._lineParts(feature.geometry);
    if (value === undefined || value === null || value === '' || !parts.length) return null;
    const longest = parts.reduce((best, p) => (p.length > best.length ? p : best), parts[0]);
    if (longest.length < 4) return null; // fragment trop court pour porter une étiquette lisible
    const middle = AMGT4CEM_CRS.lambertToLatLng(longest[Math.floor(longest.length / 2)]);
    const text = document.createElement('span');
    text.className = 'amgt-nappe-label';
    text.textContent = Number(value).toLocaleString('fr-BE', { maximumFractionDigits: 1 });
    const icon = L.divIcon({ className: 'amgt-nappe-label-icon', html: text.outerHTML, iconSize: null });
    return L.marker(middle, { icon, interactive: false, keyboard: false });
  },

  // --- Stations de mesure --------------------------------------------------------------------------------------

  async _loadStations(cfg, bbox, token) {
    const part = cfg.stations;
    try {
      const features = await this._fetchFeatures(part.couche, bbox, cfg);
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
        marker.bindPopup(() => this._buildPopup(part.libelle, feature.properties || {}, null, cfg));
        this._group.addLayer(marker);
      }
      return { truncated: features.truncated, count: features.list.length, label: 'stations' };
    } catch (err) {
      console.warn('[AMGT4CEM] Stations piézométriques indisponibles :', err);
      return { error: `stations (${this._reason(err)})` };
    }
  },

  // --- Service WFS ---------------------------------------------------------------------------------------------

  /** Nom publié d'une couche (avec préfixe), d'après le GetCapabilities ; null s'il n'y figure pas. */
  async _resolveTypeName(configured, cfg) {
    if (configured in this._typeNames) return this._typeNames[configured];
    if (!this._capabilitiesPromise) this._capabilitiesPromise = this._fetchPublishedTypeNames(cfg);
    const published = await this._capabilitiesPromise;
    const match = published.find((name) => name === configured || name.endsWith(`:${configured}`));
    this._typeNames[configured] = match || null;
    if (!match) console.warn(`[AMGT4CEM] Couche « ${configured} » absente du GetCapabilities (${published.length} couches publiées).`);
    return this._typeNames[configured];
  },

  async _fetchPublishedTypeNames(cfg) {
    const params = new URLSearchParams({ service: 'WFS', version: cfg.wfsVersion, request: 'GetCapabilities' });
    try {
      const response = await fetch(`${cfg.wfsUrl}?${params.toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = new DOMParser().parseFromString(await response.text(), 'text/xml');
      return Array.from(xml.getElementsByTagNameNS('*', 'FeatureType'))
        .map((ft) => {
          const name = ft.getElementsByTagNameNS('*', 'Name')[0];
          return name ? name.textContent.trim() : '';
        })
        .filter(Boolean);
    } catch (err) {
      this._capabilitiesPromise = null; // une panne passagère ne doit pas condamner la session : on réessaiera
      throw err;
    }
  },

  /** Objets de l'emprise visible (bbox Lambert 72), au plus `maxFeaturesPerQuery`. */
  async _fetchFeatures(configuredName, [minX, minY, maxX, maxY], cfg) {
    const typeName = await this._resolveTypeName(configuredName, cfg);
    if (!typeName) throw new Error(`couche « ${configuredName} » introuvable`);
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
    const response = await fetch(`${cfg.wfsUrl}?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();
    const all = geojson.features || [];
    return { list: all.slice(0, cfg.maxFeaturesPerQuery), truncated: all.length > cfg.maxFeaturesPerQuery };
  },

  // --- Fenêtre d'information et état ---------------------------------------------------------------------------

  /** Construction DOM sûre (pas d'innerHTML) : les valeurs viennent d'un service externe. */
  _buildPopup(title, props, labels, cfg) {
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

    if (labels && cfg.periodeReference) {
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
