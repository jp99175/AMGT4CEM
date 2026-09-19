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

  // --- Géocodage d'adresses (recherche par nom de rue) ---
  // Service officiel UrbIS (CIRB/CIBG), le même écosystème que le fond de
  // plan et les orthophotos. Endpoint et format de requête/réponse
  // confirmés via le code source public du connecteur PHP "geo6/
  // geocoder-php-urbis-provider" (pas une supposition). Répond nativement
  // en EPSG:31370 (`spatialReference=31370`), pas besoin de conversion.
  // Domaine bloqué depuis ce bac à sable (comme les autres services
  // *.irisnet.be) : le fonctionnement du fond de plan (tuiles <img>, jamais
  // lu par du JS) a pu être vérifié malgré ce blocage, mais un appel
  // fetch() JSON comme celui-ci est un cas différent (nécessite un vrai
  // support CORS pour que le navigateur laisse passer la réponse) — à
  // vérifier depuis un navigateur utilisateur réel.
  geocoder: {
    url: 'https://geoservices.irisnet.be/localization/Rest/Localize/getaddresses',
    spatialReference: 31370,
    language: 'fr',
  },

  // --- Couches UrbIS Topo (à la demande) ---
  // Objets ponctuels/linéaires détaillés (grilles de ventilation, chambres de
  // visite, avaloirs...), en plus du fond de plan. Service officiel UrbIS
  // Topo (CIRB/CIBG - Paradigm), catalogue d'objets et attribut de type
  // ("TYPE") confirmés via :
  //  - la fiche technique officielle "UrbIS - Topo" (spécifications de
  //    produit ISO 19131, PDF fourni par l'utilisateur) pour la liste des
  //    codes/libellés d'objets ;
  //  - un GetFeature réel (application/json, 5 entités, fourni par
  //    l'utilisateur) confirmant le nom de l'attribut de type ("TYPE"), les
  //    libellés français/néerlandais ("DESCRFRE"/"DESCRDUT") et le CRS de
  //    sortie (EPSG:31370, cohérent avec le reste de l'application).
  // Aucun code ci-dessous n'est deviné.
  //
  // Le service ne regroupe les ~150 types d'objets du catalogue que sous 3
  // couches WFS globales (par géométrie) : chaque entrée ci-dessous précise
  // dans laquelle filtrer et avec quels codes ("TYPE IN (...)").
  //
  // Le service ne déclare cet endpoint que pour un usage "download" classique
  // (formaté pour un navigateur, jamais testé ici en fetch() JS) : comme pour
  // le géocodeur, le support CORS d'un appel fetch() JSON depuis l'application
  // n'a pas pu être vérifié depuis ce bac à sable (domaine bloqué) — à tester
  // depuis un navigateur utilisateur réel.
  urbisTopo: {
    wfsUrl: 'https://geoservices-urbis.irisnet.be/geoserver/urbistopo/wfs',
    version: '2.0.0',
    typeAttribute: 'TYPE',
    // Garde-fous : évite de charger des dizaines de milliers d'objets d'un
    // coup (une seule des 3 couches WFS globales en contient plus de 450 000
    // au total, tous types confondus) — chaque couche n'est interrogée que
    // dans l'emprise visible, à partir de ce niveau de zoom, et plafonnée à
    // ce nombre d'objets par requête. Ajustable ici si trop restrictif/laxiste
    // une fois testé en conditions réelles.
    minZoom: 16,
    maxFeaturesPerQuery: 500,
    layers: [
      {
        id: 'grilles-ventilation',
        label: 'Grilles de ventilation',
        color: '#00897b',
        queries: [{ featureType: 'urbistopo:TopoLines', codes: ['BR14L'] }],
      },
      {
        id: 'chambres-taques',
        label: 'Chambres / taques d\'égout',
        color: '#6d4c41',
        queries: [
          {
            featureType: 'urbistopo:TopoPoints',
            codes: [
              'CR6101P', 'CR6102P', 'CR6103P', 'CR6104P',
              'CR6105P', 'CR6106P', 'CR6107P', 'CR6109P',
            ],
          },
          { featureType: 'urbistopo:TopoLines', codes: ['CR6102L', 'CR6108L'] },
        ],
      },
      {
        id: 'avaloirs',
        label: 'Avaloirs',
        color: '#1e88e5',
        queries: [{ featureType: 'urbistopo:TopoPoints', codes: ['CR6203P', 'CR6204P', 'CR6205P'] }],
      },
    ],
  },

  // --- Micro-base de données métier (stockage local du prototype) ---
  // Tentative abandonnée : stocker les points dans data/points.json de ce
  // dépôt via l'API GitHub (partagé entre appareils). Ça ne fonctionne pas :
  // l'API Contents de GitHub ne répond pas correctement au préflight CORS
  // dès qu'une requête porte un en-tête Authorization ou
  // Content-Type: application/json — le navigateur bloque toute écriture
  // avant même qu'elle parte, quel que soit le jeton (vérifié en conditions
  // réelles). Voir README section "Micro-base de données" pour le détail et
  // les deux pistes sérieuses pour la suite (petit relais serveur, ou un
  // service pensé pour ça comme Supabase).
  pointsStorageKey: 'amgt4cem.points.v1',

  // --- Affichage ---
  maxZoom: 22,
};
