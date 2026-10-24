/**
 * Couche « Métro » PUBLIQUE : stations et tunnels affichés à une personne NON connectée.
 *
 * Source : service WFS de la Région (Bruxelles Mobilité, MobiGIS), couche `bm_public_transport:Metro`, en Lambert 72.
 * L'adresse et le nom de la couche sont dans config/fonds-de-plan/services.json (clé `metro`), lus par
 * src/services.js dans AMGT4CEM_CONFIG.metroPublic.
 *
 * « Région d'abord, copie de secours ensuite » : le navigateur interroge d'abord la Région ; si elle refuse (CORS),
 * ne répond pas dans le délai ou renvoie un contenu inutilisable, la copie de secours du dépôt
 * (config/secours/region-metro.json, export d'origine de la même couche) est lue à la place. La carte s'affiche dans les
 * deux cas ; la source utilisée est écrite dans la console (« [AMGT4CEM] Couche métro publique : ... »).
 *
 * Seuls les attributs de la Région sont disponibles (name_fr, name_nl, type MS station / MT tunnel). Les contours
 * sont ceux de la Région (géoréférencement imparfait connu) : la couche corrigée (shapefile + référentiel) reste
 * réservée aux comptes connectés (src/network.js). Ni planches ni repères ici.
 *
 * Même forme de résultat que AMGT4CEM_Network.load() : { layersByType, bounds, searchIndex }.
 */
const AMGT4CEM_MetroPublicLayer = {
  /** Types de la Région -> genre (clé de recherche et de style, comme metroLayer.js). */
  _GENRE_BY_TYPE: { MS: 'station', MT: 'tunnel' },

  /**
   * Lit les polygones (Région, sinon copie de secours) et construit les couches Stations et Tunnels, ajoutées à la carte.
   * Rejette seulement si la Région ET la copie de secours sont inutilisables.
   * @param {L.Map} map
   * @returns {Promise<{layersByType: Object.<string, L.LayerGroup>, bounds: L.LatLngBounds, searchIndex: object[], source: string}>}
   */
  async load(map) {
    const { features, source } = await this._readFeatures();
    const { layersByType, bounds, searchIndex } = this._build(features);
    layersByType.MS.addTo(map);
    layersByType.MT.addTo(map);
    return { layersByType, bounds, searchIndex, source };
  },

  async _readFeatures() {
    const cfg = AMGT4CEM_CONFIG.metroPublic || {};
    let reason = 'adresse non configurée (config/fonds-de-plan/services.json, clé « metro »)';
    if (cfg.wfsUrl && cfg.couche) {
      try {
        const features = await this._fetchFeatures(this._regionUrl(cfg), cfg.delaiMs);
        console.info(`[AMGT4CEM] Couche métro publique : source Région (WFS), ${features.length} objets.`);
        return { features, source: 'region' };
      } catch (err) {
        // TypeError = refus du navigateur (CORS) ou réseau coupé : le navigateur ne distingue pas les deux.
        reason = err instanceof TypeError ? 'Région refusée ou injoignable (CORS ou réseau)' : String(err.message || err);
      }
    }
    const features = await this._fetchFeatures(cfg.secoursUrl, cfg.delaiMs);
    console.info(`[AMGT4CEM] Couche métro publique : source copie de secours du dépôt, ${features.length} objets (${reason}).`);
    return { features, source: 'secours' };
  },

  _regionUrl({ wfsUrl, couche }) {
    const params = new URLSearchParams({
      service: 'WFS',
      version: '1.1.0',
      request: 'GetFeature',
      typeName: couche,
      outputFormat: 'json',
      srsName: AMGT4CEM_CONFIG.businessCRS.epsg,
    });
    return `${wfsUrl}?${params.toString()}`;
  },

  /** Lit une FeatureCollection de polygones (stations/tunnels) ; lève une Error si elle est vide ou inutilisable. */
  async _fetchFeatures(url, delaiMs) {
    if (!url) throw new Error('adresse manquante');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), delaiMs || 8000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const geojson = await response.json();
      const features = (geojson.features || []).filter((f) => this._usable(f));
      if (!features.length) throw new Error('aucun polygone exploitable dans la réponse');
      return features;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`pas de réponse en ${(delaiMs || 8000) / 1000} s`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },

  _usable(feature) {
    const p = feature && feature.properties;
    const g = feature && feature.geometry;
    return !!(p && this._GENRE_BY_TYPE[p.type] && g && g.type === 'Polygon' && g.coordinates && g.coordinates[0] && g.coordinates[0].length > 2);
  },

  /** Retire le préfixe du nom de la Région (« Station », « Tunnel STIB », « Tunnel STIB/MIVB »). */
  _cleanName(name) {
    return String(name || '').replace(/^\s*(Station|Tunnel(\s+STIB(\s*\/\s*MIVB)?)?)\s+/i, '').trim();
  },

  _build(features) {
    const layersByType = { MS: L.layerGroup(), MT: L.layerGroup() };
    const bounds = L.latLngBounds([]);
    const searchIndex = [];

    for (const feature of features) {
      const props = feature.properties;
      const type = props.type;
      const genre = this._GENRE_BY_TYPE[type];
      const style = AMGT4CEM_METRO_TYPES[type];
      const nameFr = this._cleanName(props.name_fr);
      const nameNl = this._cleanName(props.name_nl);

      // Anneau extérieur seul (comme metroLayer.js) ; coordonnées Lambert 72.
      const latlngs = feature.geometry.coordinates[0].map(AMGT4CEM_CRS.lambertToLatLng);
      const polygon = L.polygon(latlngs, { color: style.color, weight: style.weight, fillOpacity: style.fillOpacity });

      // Même comportement de clic que metroLayer.js : l'outil « Ajouter un point » et les plugins passent avant la popup.
      polygon.bindPopup(() => this._popupHtml(nameFr, nameNl));
      polygon.off('click');
      polygon.on('click', (e) => {
        if (AMGT4CEM_AddPointTool.isActive()) {
          L.DomEvent.stopPropagation(e);
          AMGT4CEM_AddPointTool.handleMapClick(e);
        } else if (AMGT4CEM_Plugins.dispatchMapClick(e)) {
          L.DomEvent.stopPropagation(e);
        } else {
          polygon.openPopup(e.latlng);
        }
      });
      polygon.addTo(layersByType[type]);
      bounds.extend(polygon.getBounds());

      searchIndex.push({
        kind: genre,
        label: nameFr || nameNl || '(sans nom)',
        searchText: [nameFr, nameNl].filter(Boolean).join(' '),
        bounds: polygon.getBounds(),
      });
    }
    return { layersByType, bounds, searchIndex };
  },

  _popupHtml(nameFr, nameNl) {
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const row = (label, value) => (value ? `<tr><th>${label}</th><td>${esc(value)}</td></tr>` : '');
    return `<div class="amgt-popup"><table>${row('Nom (FR)', nameFr)}${row('Nom (NL)', nameNl)}</table></div>`;
  },
};
