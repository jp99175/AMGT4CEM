/**
 * Fond de plan : couche Urbis (Bruxelles Mobilité / CIRB-CIBG) en priorité,
 * avec un fond de secours sélectionnable si Urbis est inaccessible depuis
 * le poste utilisateur (voir README pour le détail de cette limitation).
 *
 * Techniquement, un L.tileLayer.wms Leaflet charge ses tuiles via des
 * balises <img>, pas via fetch/XHR : les restrictions CORS n'empêchent donc
 * pas l'affichage (elles ne bloqueraient que la lecture des pixels via un
 * canvas, ce qui n'est pas fait ici). Le facteur bloquant réel possible est
 * l'accessibilité réseau du service depuis le poste client, pas le CORS.
 */
const AMGT4CEM_Basemap = {
  build() {
    const urbis = L.tileLayer.wms(AMGT4CEM_CONFIG.urbisWms.url, {
      layers: AMGT4CEM_CONFIG.urbisWms.layers,
      version: AMGT4CEM_CONFIG.urbisWms.version,
      format: AMGT4CEM_CONFIG.urbisWms.format,
      transparent: false,
      attribution: AMGT4CEM_CONFIG.urbisWms.attribution,
      maxZoom: AMGT4CEM_CONFIG.maxZoom,
    });

    const fallback = L.tileLayer(AMGT4CEM_CONFIG.fallbackBasemap.url, {
      attribution: AMGT4CEM_CONFIG.fallbackBasemap.attribution,
      maxZoom: AMGT4CEM_CONFIG.maxZoom,
    });

    let urbisFailed = false;
    urbis.on('tileerror', () => {
      if (urbisFailed) return;
      urbisFailed = true;
      console.warn('[AMGT4CEM] Le fond Urbis semble inaccessible depuis ce poste. ' +
        'Basculement possible vers le fond de secours via le contrôle de couches.');
      document.getElementById('amgt-basemap-warning').classList.remove('amgt-hidden');
    });

    return { urbis, fallback };
  },
};
