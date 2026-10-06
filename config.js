/**
 * Configuration centrale de l'application AMGT4CEM.
 * Toutes les valeurs "en dur" de l'application (services, CRS, clés de stockage)
 * sont regroupées ici pour faciliter la maintenance et l'évolution ultérieure.
 */
const AMGT4CEM_CONFIG = {

  // --- Référentiel géographique métier ---
  // Belgian Lambert 72 (EPSG:31370) : CRS des shapefiles (.prj) et des JSON
  // (`"crs": "EPSG:31370"`), utilisé tel quel comme référentiel métier.
  businessCRS: {
    epsg: 'EPSG:31370',
    // Paramètres officiels EPSG:31370 (Belgian Lambert 72), constante publique
    // (source : IGN/NGI, epsg.io/31370), indépendante du contenu des fichiers de données.
    proj4def: '+proj=lcc +lat_1=51.16666723333333 +lat_2=49.8333339 +lat_0=90 ' +
      '+lon_0=4.367486666666666 +x_0=150000.013 +y_0=5400088.438 +ellps=intl ' +
      '+towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs',
  },

  // --- Données cartographiques de référence ---
  // Trois familles (voir README, section 4) :
  //  1. géométries pérennes : DEUX shapefiles Lambert 72 (éditables dans AutoCAD), un seul champ `id` ;
  //  2. référentiel : JSON rattaché aux géométries par `id` (noms, genre, niveau, références...) ;
  //  3. données métier (suivi) : hors de ce dépôt (phase B).
  // Lecture côté navigateur (src/shpLoader.js, src/referentiel.js), sans conversion externe.
  // lignes.shp / lignes.json peuvent être absents tant qu'aucun tronçon n'est dessiné.
  donnees: {
    polygonesShp: './data/geometries/polygones',
    lignesShp: './data/geometries/lignes',
    polygonesJson: './data/referentiel/polygones.json',
    lignesJson: './data/referentiel/lignes.json',
    vocabulairesJson: './data/referentiel/vocabulaires.json',
  },
  // LEGACY : repères de transition entre tronçons (triangles + codes D0, D1, G1a...), sans identifiant ;
  // à rattacher à lignes.shp quand il existera (voir metroLayer.js et le README).
  reperesTronconsLegacyUrl: './data/legacy/reperes-troncons.legacy.json',

  // Données du FOND DE PLAN écrites par l'application (tout ce qui n'est pas une
  // géométrie de data/geometries/, seule éditable sous AutoCAD) : dossier
  // data/fond-de-plan/, un fichier JSON par type d'élément, en Lambert 72, partagés
  // entre visiteurs. Lus par tous ; enregistrés (administrateurs, plugin
  // plugins/pe-label-editor/) par un relais serveur à déployer une fois
  // (relay/README.md), route PUT /shared/fond-de-plan/<fichier>.
  // Ancrage/orientation des références de planche (src/peLabelAnchors.js) :
  peLabelAnchorsUrl: './data/fond-de-plan/etiquettes-planches.json',
  // Position et tronçon de rattachement des numéros d'interstation (src/interstation.js) :
  interstationLabelsUrl: './data/fond-de-plan/etiquettes-troncons.json',
  // Adresse du relais d'enregistrement. Vide par défaut : elle se renseigne
  // dans ⚙ Paramètres > Serveur, qui l'enregistre sur le serveur avec les
  // autres paramètres généraux (data/app-settings.json) et prime alors sur
  // cette valeur pour tous les visiteurs.
  peLabelAnchorsRelayUrl: '',

  // Paramètres généraux enregistrés sur le serveur (adresses des services
  // externes et du relais, modifiables par un administrateur dans ⚙ Paramètres
  // — voir src/settingsStore.js). Seules les valeurs qui diffèrent de ce
  // fichier de configuration y figurent.
  appSettingsUrl: './data/app-settings.json',

  // Accès administrateur à la fenêtre ⚙ Paramètres et au mode édition des
  // étiquettes de planche. Ouvert à tous pour l'instant : le mot de passe
  // administrateur se branchera dans src/admin.js (AMGT4CEM_Admin.requestAccess).
  adminMode: true,

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
        source: 'bruxelles',
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

    // Orthophotos de la Flandre (Digitaal Vlaanderen, "Orthofotomozaïek,
    // middenschalig, winteropnamen"), proposées EN PLUS de la série bruxelloise
    // ci-dessus, dans la même ligne du temps : quand une année existe dans les
    // deux sources (2012, 2014, 2016-2022), l'utilisateur bascule de l'une à
    // l'autre depuis la barre des années (la plus nette peut différer d'une
    // année à l'autre) et son choix est mémorisé par année (voir basemap.js).
    // Noms de couches confirmés via un GetCapabilities réel fourni par
    // l'utilisateur (https://geo.api.vlaanderen.be/OMW/wms) : 25 cm jusqu'en
    // 2021, 15 cm à partir de 2022 ; EPSG:3857 et 31370 déclarés, donc aucun
    // `crs` forcé ici (contrairement à Bruciel). 2000-2003, 2005-2007 et
    // 2008-2011 sont des compilations de plusieurs campagnes (`period`) ; la
    // couche `<nom>_vdc` de chaque couche donne la date de vol exacte.
    //
    // `regionBboxLambert` : emprise [minX, minY, maxX, maxY] (Lambert 72) hors
    // de laquelle aucune tuile flamande n'est demandée — seule la Région de
    // Bruxelles-Capitale intéresse l'application, inutile de charger (ni
    // d'afficher) la Flandre autour. Rectangle englobant approximatif (pas le
    // contour exact de la Région) : à resserrer ici si besoin.
    flandre: {
      url: 'https://geo.api.vlaanderen.be/OMW/wms',
      regionBboxLambert: [137000, 156000, 167000, 187000],
      entries: [
        { year: 2003, period: '2000-2003', layers: 'OMWRGB00_03VL' },
        { year: 2007, period: '2005-2007', layers: 'OMWRGB05_07VL' },
        { year: 2011, period: '2008-2011', layers: 'OMWRGB08_11VL' },
        ...[12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map((yy) => ({
          year: 2000 + yy,
          layers: `OMWRGB${yy}VL`,
        })),
      ],
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
  // Objets ponctuels/linéaires détaillés du produit UrbIS Topo (CIRB/CIBG -
  // Paradigm), choisis individuellement par l'utilisateur (voir le
  // sélecteur "modifier la sélection", src/urbisTopoPicker.js, et le
  // catalogue complet catalogues/urbis-topo.js) et affichés en plus du fond
  // de plan. Service et attribut de type ("TYPE") confirmés via :
  //  - la fiche technique officielle "UrbIS - Topo" (spécifications de
  //    produit ISO 19131, PDF fourni par l'utilisateur) pour la liste des
  //    codes/libellés d'objets (voir catalogues/urbis-topo.js) ;
  //  - un GetFeature réel (application/json, 5 entités, fourni par
  //    l'utilisateur) confirmant le nom de l'attribut de type ("TYPE"), les
  //    libellés français/néerlandais ("DESCRFRE"/"DESCRDUT") et le CRS de
  //    sortie (EPSG:31370, cohérent avec le reste de l'application).
  // Aucun code n'est deviné.
  //
  // Le service ne regroupe le catalogue que sous 3 couches WFS globales (par
  // géométrie) : quels que soient les types choisis par l'utilisateur,
  // urbisTopoLayer.js les répartit en au plus 2 requêtes (urbistopo:TopoPoints
  // / urbistopo:TopoLines, la géométrie "polygone" n'étant pas prise en
  // charge pour l'instant) filtrées par "TYPE IN (...)".
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
    // au total, tous types confondus) — chaque requête ne porte que sur
    // l'emprise visible, à partir de ce niveau de zoom, et est plafonnée à ce
    // nombre d'objets. Ajustable ici si trop restrictif/laxiste une fois
    // testé en conditions réelles.
    minZoom: 16,
    maxFeaturesPerQuery: 500,
    // Couleurs attribuées automatiquement aux types sélectionnés (voir
    // urbisTopoSelectionStore.js), dans cet ordre, en boucle si besoin.
    colorPalette: [
      '#1e88e5', '#00897b', '#6d4c41', '#e64a19', '#8e24aa',
      '#c0ca33', '#00acc1', '#f4511e', '#3949ab', '#7cb342',
    ],
    // Présélection au tout premier lancement (avant toute personnalisation) :
    // uniquement les grilles de ventilation. Les autres familles (chambres/
    // taques, avaloirs...) restent disponibles dans le sélecteur mais ne
    // sont plus cochées par défaut.
    defaultSelectionCodes: ['BR14L'],
  },

  // --- Plans patrimoine (à la demande) ---
  // Données de référence LOCALES fournies directement par l'utilisateur
  // (fichiers GeoJSON EPSG:31370, voir catalogues/plans-patrimoine.js) : plans
  // d'ensemble au 1/500e, numéros interstation. Jamais
  // rechargées depuis un service externe (contrairement à UrbIS Topo), donc
  // pas de garde-fou de zoom/emprise nécessaire (volumes très modestes).
  patrimoine: {
    // Couleurs attribuées automatiquement aux plans sélectionnés (voir
    // patrimoineSelectionStore.js), dans cet ordre, en boucle si besoin.
    colorPalette: ['#e64a19', '#1565c0', '#2e7d32', '#8e24aa', '#00838f'],
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
