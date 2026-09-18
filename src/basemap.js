/**
 * Fonds de plan sélectionnables (UrbIS, orthophotos, secours...).
 *
 * Construit chaque entrée de AMGT4CEM_CONFIG.basemaps en couche Leaflet.
 * Techniquement, un L.tileLayer / L.tileLayer.wms Leaflet charge ses tuiles via des
 * balises <img>, pas via fetch/XHR : les restrictions CORS n'empêchent donc pas
 * l'affichage (elles ne bloqueraient que la lecture des pixels via un canvas, ce qui
 * n'est pas fait ici). Le facteur bloquant réel possible est l'accessibilité réseau
 * du service depuis le poste client, pas le CORS.
 */
const AMGT4CEM_Basemap = {
  /**
   * @returns {{ layers: Object.<string, L.Layer>, defaultId: string }}
   */
  build() {
    const layers = {};
    let defaultId = null;

    for (const entry of AMGT4CEM_CONFIG.basemaps) {
      const layer = this._buildLayer(entry);
      if (!layer) continue;

      layers[entry.id] = layer;
      if (entry.default || !defaultId) defaultId = entry.id;

      this._attachErrorWarning(layer, entry);
    }

    return { layers, defaultId };
  },

  _buildLayer(entry) {
    switch (entry.type) {
      case 'wms':
        return L.tileLayer.wms(entry.url, {
          layers: entry.layers,
          version: entry.version || '1.3.0',
          format: entry.format || 'image/png',
          transparent: false,
          attribution: entry.attribution,
          maxZoom: AMGT4CEM_CONFIG.maxZoom,
        });

      case 'xyz':
        return L.tileLayer(entry.url, {
          attribution: entry.attribution,
          maxZoom: AMGT4CEM_CONFIG.maxZoom,
        });

      default:
        console.warn('[AMGT4CEM] Type de fond de plan inconnu :', entry.type);
        return null;
    }
  },

  _attachErrorWarning(layer, entry) {
    let failed = false;
    layer.on('tileerror', () => {
      if (failed) return;
      failed = true;
      console.warn(`[AMGT4CEM] Le fond "${entry.label}" semble inaccessible depuis ce poste.`);
      const warningEl = document.getElementById('amgt-basemap-warning');
      warningEl.textContent = `Le fond « ${entry.label} » semble inaccessible depuis ce poste. ` +
        'Essayez un autre fond dans le contrôle de couches (haut droite).';
      warningEl.classList.remove('amgt-hidden');
    });
  },
};
