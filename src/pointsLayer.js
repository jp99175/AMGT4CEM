/**
 * Affichage sur la carte des objets métier enregistrés dans la micro-base.
 *
 * Chaque marqueur est déplaçable (section 10 du cahier des charges) : un
 * glisser-déposer du marqueur recalcule automatiquement X/Y Lambert et met
 * à jour la micro-base. C'est la méthode normale de repositionnement.
 */
const AMGT4CEM_PointsLayer = {
  _layerGroup: null,

  init(map) {
    this._layerGroup = L.layerGroup().addTo(map);
    this.refresh();
    return this._layerGroup;
  },

  refresh() {
    this._layerGroup.clearLayers();
    for (const point of AMGT4CEM_PointsStore.getAll()) {
      this._addMarker(point);
    }
  },

  _addMarker(point) {
    const latlng = AMGT4CEM_CRS.lambertToLatLng([point.x, point.y]);
    const marker = L.marker(latlng, {
      draggable: true,
      icon: L.divIcon({
        className: 'amgt-point-marker',
        html: '<div class="amgt-point-marker__dot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    });

    marker.bindPopup(this._buildPopupHtml(point));

    marker.on('dragend', () => {
      const newLatLng = marker.getLatLng();
      const { x, y } = AMGT4CEM_CRS.latLngToLambert(newLatLng);
      const updated = AMGT4CEM_PointsStore.update(point.id, { x, y });
      marker.setPopupContent(this._buildPopupHtml(updated));
    });

    marker.addTo(this._layerGroup);
  },

  _buildPopupHtml(point) {
    const extraRows = Object.entries(point.properties || {})
      .map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`)
      .join('');
    return `<div class="amgt-popup">
      <table>
        <tr><th>Identifiant</th><td>${point.id}</td></tr>
        <tr><th>Type</th><td>${point.type}</td></tr>
        <tr><th>Libellé</th><td>${point.label}</td></tr>
        <tr><th>X Lambert</th><td>${AMGT4CEM_CRS.formatCoord(point.x)}</td></tr>
        <tr><th>Y Lambert</th><td>${AMGT4CEM_CRS.formatCoord(point.y)}</td></tr>
        ${extraRows}
      </table>
    </div>`;
  },
};
