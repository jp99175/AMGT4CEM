/**
 * Configuration centrale de l'application AMGT4CEM.
 * Toutes les valeurs "en dur" de l'application (services, CRS, clés de stockage)
 * sont regroupées ici pour faciliter la maintenance et l'évolution ultérieure.
 */
const AMGT4CEM_CONFIG = {

  // --- Référentiel géographique métier ---
  // CRS déclaré explicitement dans Metro.json : urn:ogc:def:crs:EPSG::31370
  // => Belgian Lambert 72 (EPSG:31370). Confirmé par le fichier lui-même,
  // pas supposé arbitrairement.
  businessCRS: {
    epsg: 'EPSG:31370',
    // Paramètres officiels EPSG:31370 (Belgian Lambert 72), constante publique
    // (source : IGN/NGI, epsg.io/31370), indépendante du contenu de Metro.json.
    proj4def: '+proj=lcc +lat_1=51.16666723333333 +lat_2=49.8333339 +lat_0=90 ' +
      '+lon_0=4.367486666666666 +x_0=150000.013 +y_0=5400088.438 +ellps=intl ' +
      '+towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs',
  },

  // --- Données cartographiques de référence ---
  metroDataUrl: './Metro.json',

  // --- Fonds de plan ---
  // Liste ordonnée des fonds sélectionnables (contrôle de couches, boutons radio).
  // Le premier marqué `default: true` est chargé au démarrage.
  //
  // Note générale : l'accès sortant de cet environnement de développement vers les
  // domaines *.irisnet.be et *.brussels est bloqué par la politique réseau du bac à
  // sable (voir README). Les identifiants de couches ci-dessous suivent les
  // spécifications OGC WMS publiques documentées de ces services, mais n'ont pas pu
  // être testés en direct depuis ici — à vérifier dans un navigateur utilisateur réel.
  basemaps: [
    {
      id: 'urbis-grey',
      label: 'UrbIS (grisé)',
      type: 'wms',
      default: true,
      url: 'https://geoservices-urbis.irisnet.be/geoserver/Urbis/wms',
      layers: 'urbisFRGray',
      version: '1.3.0',
      format: 'image/png',
      attribution: '&copy; CIRB/CIBG &ndash; UrbIS',
    },
    {
      id: 'urbis-color',
      label: 'UrbIS (couleur)',
      type: 'wms',
      url: 'https://geoservices-urbis.irisnet.be/geoserver/Urbis/wms',
      layers: 'urbisFR',
      version: '1.3.0',
      format: 'image/png',
      attribution: '&copy; CIRB/CIBG &ndash; UrbIS',
    },

    // Orthophotos historiques Bruciel (Bruxelles Urbanisme & Patrimoine / urban.brussels).
    // Service GeoServer identifié : gis.urban.brussels, workspace "BRUCIEL".
    // Les noms de couches précis par année n'ont PAS pu être vérifiés depuis ce bac à
    // sable (domaine bloqué) : à confirmer via GetCapabilities avant utilisation réelle.
    //   https://gis.urban.brussels/geoserver/BRUCIEL/ows?service=WMS&version=1.3.0&request=GetCapabilities
    // Corrigez `layers` ci-dessous (et dupliquez le bloc par année) une fois les noms
    // exacts connus — voir README section "Orthophotos Bruciel".
    // {
    //   id: 'bruciel-2023',
    //   label: 'Orthophoto 2023 (bruciel)',
    //   type: 'wms',
    //   url: 'https://gis.urban.brussels/geoserver/BRUCIEL/wms',
    //   layers: 'BRUCIEL:Ortho2023', // <-- à vérifier
    //   version: '1.3.0',
    //   format: 'image/jpeg',
    //   attribution: '&copy; urban.brussels &ndash; Bruciel',
    // },

    // Fond de secours (utilisé si Urbis est inaccessible depuis le poste utilisateur :
    // réseau restreint, service indisponible, etc.). N'affecte pas l'architecture :
    // simple entrée de plus dans la même liste de fonds sélectionnables.
    {
      id: 'osm',
      label: 'Fond de secours (OSM)',
      type: 'xyz',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
    },
  ],

  // --- Micro-base de données métier (stockage local du prototype) ---
  pointsStorageKey: 'amgt4cem.points.v1',

  // --- Affichage ---
  maxZoom: 22,
};
