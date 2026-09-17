/**
 * Chargement de Metro.json (données cartographiques de référence).
 *
 * Contrainte technique (voir cahier des charges, section 14) :
 * un fetch() vers un fichier local échoue lorsque la page est ouverte en
 * file:// (restrictions CORS des navigateurs sur XMLHttpRequest/fetch pour
 * les URLs locales). On tente donc fetch() en priorité (cas normal :
 * application servie par un petit serveur HTTP local, cf. README), et on
 * bascule automatiquement sur une sélection manuelle de fichier
 * (input[type=file] + FileReader) si le fetch échoue.
 *
 * Dans tous les cas, Metro.json n'est jamais modifié : il est uniquement lu.
 */
const AMGT4CEM_MetroData = {
  /**
   * @param {(geojson: object) => void} onLoaded
   * @param {() => void} onNeedsManualFile - appelé si le chargement automatique échoue
   */
  async tryAutoLoad(onLoaded, onNeedsManualFile) {
    try {
      const response = await fetch(AMGT4CEM_CONFIG.metroDataUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const geojson = await response.json();
      onLoaded(geojson);
    } catch (err) {
      console.warn('[AMGT4CEM] Chargement automatique de Metro.json impossible ' +
        '(probablement une ouverture en file:// sans serveur local) :', err);
      onNeedsManualFile();
    }
  },

  /**
   * Charge Metro.json à partir d'un fichier choisi par l'utilisateur.
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
