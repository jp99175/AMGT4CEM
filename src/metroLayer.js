/**
 * Construction des couches Leaflet à partir des données de référence
 * (Metro_export_SHP/Metro.shp, voir shpLoader.js).
 *
 * FeatureCollection de 192 polygones (aucune ligne/point), avec un seul
 * attribut de classification utile : `type` = "MS" (emprise de station, 69
 * entités), "MT" (emprise de tunnel, 87 entités) ou "PE" (plan d'ensemble au
 * 1/500e, 36 entités — attribut propre : `sheet_ref`, le numéro de planche ;
 * pas de nom FR/NL, une planche n'en a pas). Chaque polygone est un seul
 * anneau extérieur, sans trou. CRS : EPSG:31370 (Belgian Lambert 72).
 *
 * Les planches (PE) sont de larges zones qui recouvrent des stations/
 * tunnels : voir app.js (ordre d'ajout des couches, PE en dessous) pour que
 * cliquer sur une station ouvre bien sa popup, pas celle de la planche
 * sous-jacente.
 */
const AMGT4CEM_METRO_TYPES = {
  MS: { label: 'Stations', color: '#c0392b', fillOpacity: 0.55, weight: 1 },
  MT: { label: 'Tunnels', color: '#2c3e50', fillOpacity: 0.35, weight: 1 },
  PE: { label: "Plans d'ensemble (1/500e)", color: '#b8860b', fillOpacity: 0.06, weight: 1 },
};

/** kind (recherche) et libellé associés à chaque type de polygone. */
const AMGT4CEM_METRO_KIND_BY_TYPE = { MS: 'station', MT: 'tunnel', PE: 'planche' };

const AMGT4CEM_MetroLayer = {
  /**
   * @param {object} geojson - FeatureCollection Metro.json (non modifiée)
   * @returns {{ layersByType: Object.<string, L.LayerGroup>, bounds: L.LatLngBounds, searchIndex: object[] }}
   */
  build(geojson) {
    const layersByType = {
      MS: L.layerGroup(),
      MT: L.layerGroup(),
      PE: L.layerGroup(),
    };
    const bounds = L.latLngBounds([]);
    const searchIndex = [];
    // Certaines planches (PE) se chevauchent (constaté sur ce jeu de
    // données, hérité de l'ancien data/patrimoine-plans-ensemble-500e.json)
    // : accumulée au fil de la boucle, complète au moment où un clic peut
    // réellement survenir (après le rendu initial), voir _sheetRefsAt.
    const peFeatures = [];

    for (const feature of geojson.features || []) {
      const props = feature.properties || {};
      const type = props.type;
      const style = AMGT4CEM_METRO_TYPES[type];
      if (!style || !feature.geometry || feature.geometry.type !== 'Polygon') continue;
      if (type === 'PE') peFeatures.push(feature);

      // Un seul anneau extérieur par polygone dans ce jeu de données.
      const ring = feature.geometry.coordinates[0];
      const latlngs = ring.map(AMGT4CEM_CRS.lambertToLatLng);

      const polygon = L.polygon(latlngs, {
        color: style.color,
        weight: style.weight,
        fillOpacity: style.fillOpacity,
      });

      // bindPopup ouvrirait automatiquement la popup au clic ; on retire ce
      // comportement par défaut (`off`) pour le remplacer par le nôtre, qui
      // laisse la priorité à l'outil "Ajouter un point" quand il est actif —
      // sans ça, cliquer sur une station/un tunnel n'ouvrirait que sa popup
      // d'info et ne poserait jamais de point à cet endroit.
      polygon.off('click');
      if (type === 'PE') {
        // Contenu recalculé à CHAQUE clic (pas de bindPopup statique) :
        // plusieurs planches peuvent se chevaucher à l'endroit cliqué, un
        // simple bindPopup ne révélerait que celle au-dessus dans l'ordre
        // d'affichage (voir _sheetRefsAt).
        polygon.bindPopup('');
        polygon.on('click', (e) => {
          if (AMGT4CEM_AddPointTool.isActive()) {
            L.DomEvent.stopPropagation(e);
            AMGT4CEM_AddPointTool.handleMapClick(e);
            return;
          }
          const refs = this._sheetRefsAt(e.latlng, peFeatures);
          polygon.setPopupContent(this._buildPePopupHtml(refs));
          polygon.openPopup(e.latlng);
        });
      } else {
        polygon.bindPopup(this._buildPopupHtml(props));
        polygon.on('click', (e) => {
          if (AMGT4CEM_AddPointTool.isActive()) {
            L.DomEvent.stopPropagation(e);
            AMGT4CEM_AddPointTool.handleMapClick(e);
          } else {
            polygon.openPopup(e.latlng);
          }
        });
      }
      polygon.addTo(layersByType[type]);
      bounds.extend(polygon.getBounds());

      // Une planche (PE) n'a pas de nom FR/NL, seulement sa référence
      // (sheet_ref) : c'est elle qui sert de libellé de recherche.
      const label = type === 'PE'
        ? (props.sheet_ref || '(sans référence)')
        : (props.name_fr || props.name_nl || '(sans nom)');
      searchIndex.push({
        kind: AMGT4CEM_METRO_KIND_BY_TYPE[type] || type,
        label,
        searchText: [props.name_fr, props.name_nl, props.sheet_ref].filter(Boolean).join(' '),
        bounds: polygon.getBounds(),
      });
    }

    return { layersByType, bounds, searchIndex };
  },

  _buildPopupHtml(props) {
    // Les planches (PE) n'ont pas de name_fr/name_nl/niveau (champs vides
    // pour elles, voir schéma ci-dessus) : on ne les affiche pas plutôt que
    // de montrer des cellules vides dans la popup.
    const rows = Object.entries(props)
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`)
      .join('');
    return `<div class="amgt-popup"><table>${rows}</table></div>`;
  },

  /**
   * Numéros de planche (sheet_ref) de toutes les planches (PE) dont
   * l'emprise contient ce point — normalement une seule, sauf dans les
   * zones où plusieurs planches se chevauchent (voir _pointInRing).
   * Repris tel quel de l'ancien src/patrimoineLayer.js (même jeu de
   * données, même besoin), avant la fusion des planches dans Metro.shp.
   */
  _sheetRefsAt(latlng, peFeatures) {
    const { x, y } = AMGT4CEM_CRS.latLngToLambert(latlng);
    const refs = [];
    for (const f of peFeatures) {
      if (!this._pointInRing([x, y], f.geometry.coordinates[0])) continue;
      const ref = f.properties && f.properties.sheet_ref;
      if (ref) refs.push(ref);
    }
    return refs;
  },

  /** Test point-dans-polygone (ray casting), coordonnées Lambert des deux côtés. */
  _pointInRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  },

  _buildPePopupHtml(refs) {
    if (refs.length > 1) {
      const items = refs.map((ref) => `<li>${ref}</li>`).join('');
      return `<div class="amgt-popup"><strong>Planches superposées à cet endroit :</strong>` +
        `<ul class="amgt-popup-list">${items}</ul></div>`;
    }
    const label = refs[0] ? `Planche ${refs[0]}` : "Plan d'ensemble 1/500e";
    return `<div class="amgt-popup"><strong>${label}</strong></div>`;
  },
};
