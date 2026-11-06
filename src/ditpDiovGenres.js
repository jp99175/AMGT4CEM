/**
 * Genres de la couche « DITP-DIOV » à afficher (station, tunnel, dépôt, ouvrage atypique) : sélection par genre,
 * même principe que UrbIS Topo et Plans patrimoine (voir selectionStore.js) — sélection courante de l'appareil,
 * préférences locales, sélection par défaut partagée config/ditp-diov/selection-par-defaut.json (relais).
 *
 * La COULEUR de chaque genre n'est pas un choix de l'utilisateur : elle est fixée pour tout le monde dans
 * config/ditp-diov/vocabulaires.json (champ `couleur`), modifiable par les comptes qui ont le droit « attributs »
 * (src/ditpDiovPicker.js). La valeur stockée dans la sélection ne sert qu'à marquer « coché ».
 *
 * Sans sélection par défaut partagée enregistrée, tous les genres sont affichés (comportement d'avant).
 */
const AMGT4CEM_DitpDiovSelectionStore = createSelectionStore({
  key: 'amgt4cem.ditp-diov-selection.v1',
  preferencesKey: 'amgt4cem.ditp-diov-default.v1',
  sharedUrl: AMGT4CEM_CONFIG.ditpDiov.defaultSelectionUrl,
  sharedRoute: 'shared/ditp-diov/selection-par-defaut',
  palette: () => ['#000000'],
  label: 'DITP-DIOV',
});
AMGT4CEM_DitpDiovSelectionStore._shared = { station: '#000000', tunnel: '#000000', depot: '#000000', ouvrage_atypique: '#000000' };

const AMGT4CEM_DitpDiovGenres = {
  /** Genres pilotés par la sélection, dans l'ordre d'affichage ; `type` = clé de groupe de ditpDiovLayer.js. */
  LISTE: [
    { genre: 'station', type: 'MS' },
    { genre: 'tunnel', type: 'MT' },
    { genre: 'depot', type: 'DP' },
    { genre: 'ouvrage_atypique', type: 'OA' },
  ],
  _map: null,
  _layers: null,
  _branche: false,

  _vocab(genre) {
    const v = (typeof AMGT4CEM_Referentiel !== 'undefined' && AMGT4CEM_Referentiel.vocabulaires && AMGT4CEM_Referentiel.vocabulaires.genres) || {};
    return v[genre] || {};
  },

  libelle(genre) {
    return this._vocab(genre).libelle || genre;
  },

  /** Couleur du genre (vocabulaire, fixée pour tous), sinon celle du style par défaut de ditpDiovLayer.js. */
  couleur(genre) {
    const item = this.LISTE.find((g) => g.genre === genre);
    return this._vocab(genre).couleur || (item && AMGT4CEM_DITP_DIOV_TYPES[item.type].color) || '#555555';
  },

  /** Case « DITP-DIOV » cochée ? (absente, par exemple sur la carte de choix du point de SIG4CEM : oui.) */
  _ditpDiovActif() {
    const c = typeof document !== 'undefined' && document.getElementById('amgt-layer-ditp-diov');
    return !c || c.checked;
  },

  /** Affiche ou retire chaque groupe selon la case « DITP-DIOV » et la sélection des genres. */
  appliquer(map, layersByType) {
    this._map = map;
    this._layers = layersByType;
    if (!this._branche) {
      this._branche = true;
      AMGT4CEM_DitpDiovSelectionStore.onChange(() => this.rafraichir());
    }
    const actif = this._ditpDiovActif();
    for (const { genre, type } of this.LISTE) {
      const groupe = layersByType[type];
      if (!groupe) continue;
      if (actif && AMGT4CEM_DitpDiovSelectionStore.isSelected(genre)) groupe.addTo(map);
      else map.removeLayer(groupe);
    }
  },

  rafraichir() {
    if (this._map && this._layers) this.appliquer(this._map, this._layers);
  },

  /** Retire de la carte les groupes d'un réseau abandonné (changement de source). */
  retirer(map, layersByType) {
    if (!layersByType) return;
    for (const { type } of this.LISTE) if (layersByType[type]) map.removeLayer(layersByType[type]);
  },

  /** Repeint les polygones d'un genre (ou de tous) avec `couleurs` { genre: '#rrggbb' } ; sans argument : couleurs du vocabulaire. */
  recolorer(couleurs) {
    if (!this._layers) return;
    for (const { genre, type } of this.LISTE) {
      const groupe = this._layers[type];
      if (!groupe) continue;
      const c = (couleurs && couleurs[genre]) || this.couleur(genre);
      groupe.eachLayer((l) => l.setStyle({ color: c }));
    }
  },
};
