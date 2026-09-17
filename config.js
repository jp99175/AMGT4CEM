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

  // --- Fond de plan Urbis (Bruxelles Mobilité / MobiGIS) ---
  // Service WMS public identifié : GeoServer du CIRB/CIBG, workspace "Urbis".
  // Endpoint documenté publiquement : geoservices-urbis.irisnet.be
  // Note : l'accès sortant de cet environnement de développement vers ce domaine
  // est bloqué par la politique réseau du bac à sable (voir README). La configuration
  // ci-dessous suit strictement les spécifications OGC WMS publiques de ce service ;
  // elle doit être vérifiée dans un navigateur utilisateur réel (voir README, section Test).
  urbisWms: {
    url: 'https://geoservices-urbis.irisnet.be/geoserver/Urbis/wms',
    layers: 'urbisFR',
    version: '1.3.0',
    format: 'image/png',
    attribution: '&copy; CIRB/CIBG &ndash; UrbIS',
  },

  // Fond de secours (utilisé si Urbis est inaccessible depuis le poste utilisateur :
  // réseau restreint, service indisponible, etc.). N'affecte pas l'architecture :
  // simple couche de base alternative sélectionnable dans le contrôle de couches.
  fallbackBasemap: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },

  // --- Micro-base de données métier (stockage local du prototype) ---
  pointsStorageKey: 'amgt4cem.points.v1',

  // --- Affichage ---
  maxZoom: 22,
};
