/**
 * Chargement MANUEL de secours des données cartographiques de référence,
 * au format GeoJSON.
 *
 * Le chargement automatique normal se fait désormais depuis le Shapefile
 * (Metro_export_SHP/, voir shpLoader.js et metroShpBaseUrl dans config.js) —
 * c'est le format que Civil 3D édite nativement. Ce module ne sert plus
 * qu'au bouton de secours (#amgt-manual-load), pour le cas où même ce
 * fetch() échouerait (ex : ouverture en file:// sans serveur local, voir
 * cahier des charges section 14 — un fetch() vers un fichier local échoue
 * dans ce mode, restriction CORS des navigateurs) : sélection manuelle d'un
 * fichier .json (input[type=file] + FileReader), pour dépanner sans avoir à
 * relancer un serveur local.
 */
const AMGT4CEM_MetroData = {
  /**
   * Charge un GeoJSON à partir d'un fichier choisi par l'utilisateur.
   * @param {File} file
   * @param {(geojson: object) => void} onLoaded
   * @param {(err: Error) => void} onError
   */
  loadFromFile(file, onLoaded, onError) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onLoaded(JSON.parse(reader.result));
      } catch (err) {
        onError(err);
      }
    };
    reader.onerror = () => onError(reader.error);
    reader.readAsText(file);
  },
};
