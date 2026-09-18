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
    // Service GeoServer : gis.urban.brussels, workspace "URBAN_DCC_ER" (et non
    // "BRUCIEL", qui ne contient que des couches thématiques annexes). Noms de
    // couches confirmés via un GetCapabilities réel fourni par l'utilisateur (voir
    // historique de conversation) — pas de supposition ici.
    // Streaming à la demande comme le reste des fonds WMS : aucune image n'est
    // embarquée dans l'application, chaque tuile est requêtée au serveur au moment
    // de l'affichage (voir architecture, README section 5).
    // Important : ces couches ne déclarent QUE EPSG:31370 et CRS:84 dans leur
    // GetCapabilities (pas EPSG:3857/900913, contrairement au fond UrbIS) — la
    // carte Leaflet fonctionnant par défaut en Web Mercator, il faut forcer ces
    // requêtes WMS dans leur CRS natif via `crs`, sous peine de tuiles vides ou
    // d'erreur serveur (voir crs.js / basemap.js).
    // Ce serveur ne va pas au-delà de 1996 ; les orthophotos plus récentes (2000+)
    // sont vraisemblablement publiées ailleurs (infrastructure UrbIS) et n'ont pas
    // encore été localisées — voir README section "Orthophotos Bruciel".
    ...[1935, 1944, 1953, 1961, 1971, 1977, 1987, 1996].map((year) => ({
      id: `bruciel-${year}`,
      label: `Orthophoto ${year} (bruciel)`,
      type: 'wms',
      url: 'https://gis.urban.brussels/geoserver/URBAN_DCC_ER/wms',
      layers: `Orthophotoplans_${year}`,
      version: '1.3.0',
      format: 'image/jpeg',
      crs: 'EPSG:31370',
      attribution: '&copy; urban.brussels &ndash; Bruciel',
    })),

    // Orthophotos récentes UrbIS (2004-2022) — les mêmes que celles proposées par
    // MobiGIS (data.mobility.brussels/mobigis). Service GeoServer :
    // geoservices-urbis.irisnet.be, workspace "urbisgrid". Noms de couches
    // confirmés en extrayant les URLs de légende réellement générées par la page
    // MobiGIS (snapshot HTML fourni par l'utilisateur) — pas de supposition ici.
    // "NIR" = variante infrarouge proche (fausses couleurs) ; "Ns" = millésime le
    // plus récent de la série correspondante. `crs` forcé en EPSG:31370 par
    // précaution (même raison que les couches Bruciel ci-dessus ; le
    // GetCapabilities de ce workspace précis n'a pas été vérifié).
    ...[
      'Ortho2004', 'Ortho2009', 'Ortho2012', 'Ortho2014', 'Ortho2016', 'Ortho2017',
      'Ortho2018', 'Ortho2019', 'Ortho2020', 'Ortho2020NIR', 'Ortho2021Ns',
      'Ortho2022Ns', 'Ortho2022NirNs',
    ].map((layerName) => ({
      id: `urbisgrid-${layerName.toLowerCase()}`,
      label: `Orthophoto ${layerName.replace('Ortho', '').replace('Ns', '').replace('NIR', ' (infrarouge)').replace('Nir', ' (infrarouge)')} (UrbIS)`,
      type: 'wms',
      url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms',
      layers: `urbisgrid:${layerName}`,
      version: '1.3.0',
      format: 'image/jpeg',
      crs: 'EPSG:31370',
      attribution: '&copy; CIRB/CIBG &ndash; UrbIS',
    })),
  ],

  // --- Micro-base de données métier (stockage local du prototype) ---
  pointsStorageKey: 'amgt4cem.points.v1',

  // --- Affichage ---
  maxZoom: 22,
};
