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
  // Trois choix exposés à l'utilisateur : UrbIS (fond de référence grisé),
  // Orthophoto (image aérienne la plus récente) et Bruciel (série historique
  // parcourue via un curseur temporel). Chaque sous-clé décrit une ou plusieurs
  // couches WMS ; voir src/basemap.js pour la construction des couches Leaflet.
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

    // Orthophoto la plus récente disponible sur le workspace "urbisgrid" (voir
    // ci-dessous) — actuellement 2022. Mettre à jour `layers` ici quand un
    // millésime plus récent sera identifié.
    orthophoto: {
      id: 'urbisgrid-ortho2022ns',
      label: 'Orthophoto',
      type: 'wms',
      url: 'https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wms',
      layers: 'urbisgrid:Ortho2022Ns',
      version: '1.3.0',
      format: 'image/jpeg',
      crs: 'EPSG:31370',
      attribution: '&copy; CIRB/CIBG &ndash; UrbIS',
    },

    // Orthophotos historiques Bruciel (Bruxelles Urbanisme & Patrimoine / urban.brussels),
    // parcourues via un curseur temporel dans l'interface plutôt qu'une liste de
    // fonds séparés. Service GeoServer : gis.urban.brussels, workspace
    // "URBAN_DCC_ER" (et non "BRUCIEL", qui ne contient que des couches
    // thématiques annexes). Noms de couches confirmés via un GetCapabilities réel
    // fourni par l'utilisateur (voir historique de conversation) — pas de
    // supposition ici.
    // Streaming à la demande comme les autres fonds WMS : aucune image n'est
    // embarquée dans l'application, chaque tuile est requêtée au serveur au
    // moment de l'affichage (voir architecture, README section 5).
    // Important : ces couches ne déclarent QUE EPSG:31370 et CRS:84 dans leur
    // GetCapabilities (pas EPSG:3857/900913, contrairement au fond UrbIS) — la
    // carte Leaflet fonctionnant par défaut en Web Mercator, il faut forcer ces
    // requêtes WMS dans leur CRS natif via `crs`, sous peine de tuiles vides ou
    // d'erreur serveur (voir crs.js / basemap.js).
    // Ce serveur ne va pas au-delà de 1996.
    bruciel: {
      years: [1935, 1944, 1953, 1961, 1971, 1977, 1987, 1996],
      layerFor(year) {
        return {
          id: `bruciel-${year}`,
          label: `Bruciel ${year}`,
          type: 'wms',
          url: 'https://gis.urban.brussels/geoserver/URBAN_DCC_ER/wms',
          layers: `Orthophotoplans_${year}`,
          version: '1.3.0',
          format: 'image/jpeg',
          crs: 'EPSG:31370',
          attribution: '&copy; urban.brussels &ndash; Bruciel',
        };
      },
    },
  },

  // --- Micro-base de données métier (stockage local du prototype) ---
  pointsStorageKey: 'amgt4cem.points.v1',

  // --- Affichage ---
  maxZoom: 22,
};
