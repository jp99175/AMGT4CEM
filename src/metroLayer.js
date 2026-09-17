/**
 * Construction des couches Leaflet à partir des données de référence Metro.json.
 *
 * Metro.json (analysé au préalable) est une FeatureCollection GeoJSON de 156
 * polygones (aucune ligne/point), avec un seul attribut de classification
 * utile : `type` = "MS" (emprise de station, 69 entités) ou "MT" (emprise de
 * tunnel, 87 entités). Chaque polygone est un anneau simple, sans trou.
 * CRS déclaré dans le fichier : EPSG:31370 (Belgian Lambert 72).
 */
const AMGT4CEM_METRO_TYPES = {
  MS: { label: 'Stations', color: '#c0392b', fillOpacity: 0.55, weight: 1 },
  MT: { label: 'Tunnels', color: '#2c3e50', fillOpacity: 0.35, weight: 1 },
};

const AMGT4CEM_MetroLayer = {
  /**
   * @param {object} geojson - FeatureCollection Metro.json (non modifiée)
   * @returns {{ layersByType: Object.<string, L.LayerGroup>, bounds: L.LatLngBounds }}
   */
  build(geojson) {
    const layersByType = {
      MS: L.layerGroup(),
      MT: L.layerGroup(),
    };
    const bounds = L.latLngBounds([]);

    for (const feature of geojson.features || []) {
      const props = feature.properties || {};
      const type = props.type;
      const style = AMGT4CEM_METRO_TYPES[type];
      if (!style || !feature.geometry || feature.geometry.type !== 'Polygon') continue;

      // Un seul anneau extérieur par polygone dans ce jeu de données.
      const ring = feature.geometry.coordinates[0];
      const latlngs = ring.map(AMGT4CEM_CRS.lambertToLatLng);

      const polygon = L.polygon(latlngs, {
        color: style.color,
        weight: style.weight,
        fillOpacity: style.fillOpacity,
      });

      polygon.bindPopup(this._buildPopupHtml(props));
      polygon.addTo(layersByType[type]);
      bounds.extend(polygon.getBounds());
    }

    return { layersByType, bounds };
  },

  _buildPopupHtml(props) {
    const rows = Object.entries(props)
      .map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`)
      .join('');
    return `<div class="amgt-popup"><table>${rows}</table></div>`;
  },
};
