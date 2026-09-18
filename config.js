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

  // Petite emprise (2km x 2km, centre de Bruxelles) utilisée uniquement pour
  // sonder si un fond WMS répond avant de le proposer (voir basemap.js) —
  // confortablement à l'intérieur de l'emprise de tous les fonds Orthophoto
  // connus (vérifié contre les BoundingBox de leurs GetCapabilities). Ce
  // n'est pas une donnée métier.
  probeBboxLambert: [148000, 168000, 150000, 170000],

  // --- Fonds de plan ---
  // Deux choix exposés à l'utilisateur : UrbIS (fond de référence grisé) et
  // Bruciel (ligne du temps unique, parcourue via un curseur, couvrant à la
  // fois les orthophotos historiques ET les plus récentes — deux services
  // distincts fusionnés dans une seule série chronologique côté interface).
  // Voir src/basemap.js pour la construction des couches Leaflet.
  //
  // Note générale : l'accès sortant de cet environnement de développement vers les
  // domaines *.irisnet.be et *.brussels est bloqué par la politique réseau du bac à
  // sable (voir README). Les identifiants de couches ci-dessous suivent les
  // spécifications OGC WMS publiques documentées de ces services, mais n'ont pas pu
  // être testés en direct depuis ici — à vérifier dans un navigateur utilisateur réel.
  basemaps: {
    urbis: {
      id: 'urbis-grey',
      label: 'UrbIS',
      type: 'wms',
      url: 'https://geoservices-urbis.irisnet.be/geoserver/Urbis/wms',
      layers: 'urbisFRGray',
      version: '1.3.0',
      format: 'image/png',
      attribution: '&copy; CIRB/CIBG &ndash; UrbIS',
    },

    // Ligne du temps orthophotos "Bruciel" : fusionne deux services distincts
    // dans une seule série chronologique parcourue au curseur (voir
    // src/mapMenu.js) — l'utilisateur n'a pas besoin de savoir laquelle des
    // deux infrastructures sert quelle année.
    //
    // 1935-1996 : Bruciel historique (Bruxelles Urbanisme & Patrimoine /
    // urban.brussels). Service GeoServer : gis.urban.brussels, workspace
    // "URBAN_DCC_ER" (et non "BRUCIEL", qui ne contient que des couches
    // thématiques annexes). Ce serveur ne va pas au-delà de 1996.
    //
    // 2004-2022 : orthophotos récentes UrbIS, les mêmes que celles proposées
    // par MobiGIS (data.mobility.brussels/mobigis). Service GeoServer :
    // geoservices-urbis.irisnet.be, workspace "urbisgrid".
    //
    // Tous les noms de couches ci-dessous ont été confirmés via un
    // GetCapabilities réel ou un snapshot HTML de MobiGIS fournis par
    // l'utilisateur (voir historique de conversation) — aucun n'est deviné.
    // Streaming à la demande comme les autres fonds WMS : aucune image n'est
    // embarquée dans l'application, chaque tuile est requêtée au serveur au
    // moment de l'affichage (voir architecture, README section 5).
    // Important : ces couches ne déclarent QUE EPSG:31370 et CRS:84 dans leur
    // GetCapabilities (pas EPSG:3857/900913, contrairement au fond UrbIS) — la
    // carte Leaflet fonctionnant par défaut en Web Mercator, il faut forcer ces
    // requêtes WMS dans leur CRS natif via `crs`, sous peine de tuiles vides ou
    // d'erreur serveur (voir crs.js / basemap.js).
    bruciel: {
      entries: [
        ...[1935, 1944, 1953, 1961, 1971, 1977, 1987, 1996].map((year) => ({
          year,
          url: 'https://gis.urban.brussels/geoserver/URBAN_DCC_ER/wms',
          layers: `Orthophotoplans_${year}`,
          attribution: '&copy; urban.brussels &ndash; Bruciel',
        })),
        { year: 2004, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2004', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
        { year: 2009, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2009', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
        { year: 2012, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2012', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
        { year: 2014, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2014', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
        { year: 2016, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2016', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
        { year: 2017, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2017', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
        { year: 2018, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2018', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
        { year: 2019, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2019', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
        { year: 2020, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2020', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
        { year: 2021, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2021Ns', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
        { year: 2022, url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms', layers: 'urbisgrid:Ortho2022Ns', attribution: '&copy; CIRB/CIBG &ndash; UrbIS' },
      ].map((e) => ({
        id: `bruciel-${e.year}`,
        label: `Bruciel ${e.year}`,
        type: 'wms',
        url: e.url,
        layers: e.layers,
        version: '1.3.0',
        format: 'image/jpeg',
        crs: 'EPSG:31370',
        attribution: e.attribution,
        year: e.year,
      })),
    },
  },

  // --- Micro-base de données métier ---
  // Stockage : le fichier JSON ci-dessous, dans CE dépôt GitHub, lu/écrit via
  // l'API Contents de GitHub (voir src/pointsStore.js). Les points sont donc
  // partagés entre tous les appareils qui ouvrent l'application, pas
  // seulement stockés localement.
  //
  // ⚠️ Le jeton ci-dessous, une fois renseigné, est embarqué tel quel dans le
  // code JavaScript public de l'application (aucun serveur ne le protège) :
  // n'importe qui inspectant la page peut le récupérer et l'utiliser pour
  // écrire dans ce dépôt. Décision assumée par l'utilisateur (voir
  // conversation) le temps de mettre en place un vrai backend. Pour limiter
  // les dégâts possibles :
  //   - Utilisez un jeton "fine-grained" (pas un "classic token"),
  //   - Portée strictement limitée à CE dépôt (pas "All repositories"),
  //   - Permission "Contents" réglée sur "Read and write" UNIQUEMENT,
  //     aucune autre permission cochée,
  //   - Régénérable/révocable à tout moment depuis
  //     https://github.com/settings/tokens si besoin.
  // Voir README section "Micro-base de données" pour la procédure complète.
  githubStore: {
    owner: 'jp99175',
    repo: 'AMGT4CEM',
    branch: 'claude/amgt4cem-mapping-app-fy2zdt',
    path: 'data/points.json',
    token: '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',
  },

  // --- Affichage ---
  maxZoom: 22,
};
