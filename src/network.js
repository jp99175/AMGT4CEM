/**
 * Chargement et construction des couches du réseau (stations, tunnels, planches), COMMUNS à la carte
 * AMGT4CEM (src/app.js) et à la carte de choix du point de SIG4CEM (src/signal/mapPicker.js).
 *
 * Extrait de src/app.js : même construction, écrite une seule fois pour que les deux interfaces affichent
 * le réseau de la même façon. Ne touche ni au menu, ni à la recherche, ni aux outils de la carte : l'appelant
 * reçoit les couches construites et décide de ce qu'il en fait (menu d'opacité, index de recherche, vue).
 */
const AMGT4CEM_Network = {
  /** Repères legacy (triangles + codes de tronçon, sans identifiant) : facultatifs, jamais bloquants. */
  async loadLegacyMarkers() {
    try {
      const response = await fetch(AMGT4CEM_CONFIG.reperesTronconsLegacyUrl);
      if (response.ok) return (await response.json()).features || [];
    } catch (err) {
      console.warn('[AMGT4CEM] Repères de tronçon (legacy) illisibles, ignorés :', err);
    }
    return [];
  },

  /**
   * Lit les données (géométries, référentiel, étiquettes) puis construit les couches et ajoute Stations et
   * Tunnels à la carte. Les planches (PE) et leurs repères sont confiés à la couche « Plans patrimoine »,
   * qui les affiche selon la sélection locale. Rejette si les données sont illisibles.
   * @returns {Promise<{layersByType: Object, bounds: L.LatLngBounds, searchIndex: Array}>}
   */
  async load(map) {
    // Définitions d'ancrage des références de planche (fichier partagé) : lues en parallèle des
    // géométries, attendues avant la construction des étiquettes. Ne rejette jamais.
    const anchorsReady = AMGT4CEM_PeLabelAnchors.load();
    const [features, legacy] = await Promise.all([AMGT4CEM_Referentiel.load(), this.loadLegacyMarkers(), anchorsReady]);
    return this.build(map, features.concat(legacy));
  },

  build(map, features) {
    const { layersByType, bounds, searchIndex } = AMGT4CEM_MetroLayer.build({
      type: 'FeatureCollection',
      features,
    });
    // PE (planches), PE_label (référence de planche tracée dans l'emprise), PE_info (repères de transition
    // entre tronçons) ne sont pas ajoutées directement : leur visibilité est pilotée ensemble par la
    // sélection « Plans patrimoine » (entrée `external: true`, patrimoineLayer.js#registerExternalLayer),
    // d'où leur fusion dans un groupe commun. Les polygones PE restent ajoutés à ce groupe AVANT MS/MT :
    // ce sont de larges zones qui recouvrent des stations/tunnels, elles ne doivent jamais passer devant
    // et intercepter leur clic (voir metroLayer.js et patrimoineLayer.js, bringToBack()).
    const peAndInfoGroup = L.layerGroup();
    layersByType.PE.eachLayer((l) => peAndInfoGroup.addLayer(l));
    layersByType.PE_label.eachLayer((l) => peAndInfoGroup.addLayer(l));
    layersByType.PE_info.eachLayer((l) => peAndInfoGroup.addLayer(l));
    layersByType.PE_info_text.eachLayer((l) => peAndInfoGroup.addLayer(l));
    AMGT4CEM_MetroLayer.setPeLabelDisplayGroup(peAndInfoGroup); // les références créées à l'exécution s'ajoutent aussi à ce groupe
    AMGT4CEM_PatrimoineLayer.registerExternalLayer('plans-ensemble-500e', peAndInfoGroup);
    AMGT4CEM_Interstation.setMetroFeatures(features); // rattache les numéros d'interstation à leur tronçon (genre « tunnel »)

    layersByType.MS.addTo(map);
    layersByType.MT.addTo(map);
    return { layersByType, bounds, searchIndex };
  },

  /**
   * Opacité du réseau (réglage « Métro » de la carte, mémorisé par appareil) : multiplicateur sur l'opacité
   * propre à chaque type (AMGT4CEM_METRO_TYPES), jamais un remplacement absolu.
   */
  setOpacity(layersByType, factor) {
    for (const type of Object.keys(AMGT4CEM_METRO_TYPES)) {
      const group = layersByType[type];
      if (!group) continue;
      const base = AMGT4CEM_METRO_TYPES[type];
      group.eachLayer((layer) => layer.setStyle({ opacity: factor, fillOpacity: base.fillOpacity * factor }));
    }
  },
};
