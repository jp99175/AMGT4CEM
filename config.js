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
  // Chaque dossier métier (data/metro/, data/plans-patrimoine/) porte le référentiel des géométries
  // qui le concernent : polygones.json (et lignes.json s'il y a des tronçons) + vocabulaires.json.
  // Le chargeur fusionne ces fichiers et les joint aux deux shapefiles par `id` (src/referentiel.js).
  donnees: {
    polygonesShp: './data/shapefile/polygones',
    lignesShp: './data/shapefile/lignes',
    identifiantsJson: './data/shapefile/identifiants.json',
    polygonesJson: ['./data/metro/polygones.json', './data/plans-patrimoine/polygones.json'],
    lignesJson: ['./data/metro/lignes.json'],
    vocabulairesJson: ['./data/metro/vocabulaires.json', './data/plans-patrimoine/vocabulaires.json'],
  },
  // LEGACY : repères de transition entre tronçons (triangles + codes D0, D1, G1a...), sans identifiant ;
  // à rattacher à lignes.shp quand il existera (voir metroLayer.js et le README).
  reperesTronconsLegacyUrl: './data/plans-patrimoine/reperes-troncons.legacy.json',

  // Étiquettes des Plans patrimoine, écrites par l'application (tout ce qui n'est pas une
  // géométrie de data/shapefile/, seule éditable sous AutoCAD) : un fichier JSON par type
  // d'élément dans data/plans-patrimoine/, en Lambert 72, partagés entre visiteurs. Lus par
  // tous ; enregistrés (administrateurs, outil d'édition src/peLabelEditor/) par un relais
  // serveur à déployer une fois (relay/README.md), route PUT /shared/plans-patrimoine/<fichier>.
  // Ancrage/orientation des références de planche (src/peLabelAnchors.js) :
  peLabelAnchorsUrl: './data/plans-patrimoine/etiquettes-planches.json',
  // Position et tronçon de rattachement des numéros d'interstation (src/interstation.js) :
  interstationLabelsUrl: './data/plans-patrimoine/etiquettes-troncons.json',
  // Adresse du relais d'enregistrement : lue dans data/fonds-de-plan/services.json (clé
  // `relais`) par src/services.js, qui renseigne cette propriété au démarrage ; elle se
  // saisit la première fois dans ⚙ Paramètres > Serveur. Vide = enregistrement impossible.
  peLabelAnchorsRelayUrl: '',

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

  // --- Services externes : fonds de plan, géocodeur, UrbIS Topo ---
  // Leur configuration (URL de chaque service, couches, années, attribution...) n'est plus ici :
  // elle vit dans data/fonds-de-plan/ (un fichier général `services.json` + un fichier par
  // service) et data/urbis-topo/parametres.json, lue au démarrage par src/services.js, qui
  // assemble `basemaps`, `geocoder` et `urbisTopo` ci-dessous dans cet objet.
  // Note générale : l'accès sortant de l'environnement de développement vers *.irisnet.be et
  // *.brussels est bloqué (voir README) : ces services n'ont pu être vérifiés que depuis un
  // navigateur réel.
  fondsDePlan: {
    servicesUrl: './data/fonds-de-plan/services.json',
    sourcesUrls: {
      'urbis': './data/fonds-de-plan/urbis.json',
      'bruciel': './data/fonds-de-plan/bruciel.json',
      'urbis-orthophotos': './data/fonds-de-plan/urbis-orthophotos.json',
      'flandre': './data/fonds-de-plan/flandre.json',
      'geocodeur': './data/fonds-de-plan/geocodeur.json',
      'urbis-topo': './data/urbis-topo/parametres.json',
    },
  },

  // --- Couches UrbIS Topo (à la demande) ---
  // Réglages du service : data/urbis-topo/parametres.json. Ici seulement le fichier de la
  // sélection par défaut PARTAGÉE (data/urbis-topo/), modifiable par un administrateur depuis
  // le sélecteur « modifier la sélection » (src/urbisTopoPicker.js, src/selectionStore.js).
  urbisTopo: {
    defaultSelectionUrl: './data/urbis-topo/selection-par-defaut.json',
  },

  // --- Plans patrimoine (à la demande) ---
  // Données de référence LOCALES fournies directement par l'utilisateur
  // (fichiers GeoJSON EPSG:31370, voir data/plans-patrimoine/catalogue.js) : plans
  // d'ensemble au 1/500e, numéros interstation. Jamais
  // rechargées depuis un service externe (contrairement à UrbIS Topo), donc
  // pas de garde-fou de zoom/emprise nécessaire (volumes très modestes).
  patrimoine: {
    // Couleurs attribuées automatiquement aux plans sélectionnés (voir
    // patrimoineSelectionStore.js), dans cet ordre, en boucle si besoin.
    colorPalette: ['#e64a19', '#1565c0', '#2e7d32', '#8e24aa', '#00838f'],
    // Sélection par défaut PARTAGÉE (rien de présélectionné au départ), modifiable par un administrateur.
    defaultSelectionUrl: './data/plans-patrimoine/selection-par-defaut.json',
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

  // --- Plugins (applications séparées branchées sur la carte, voir src/plugins.js) ---
  // Chaque plugin vit dans son dossier : styles puis scripts chargés dans l'ordre ; le dernier
  // script s'enregistre par AMGT4CEM_Plugins.register. `enabled: false` le retire sans rien supprimer.
  plugins: [
    {
      id: 'signalements',
      // Retiré de la carto (la saisie vit dans home.html?app=signal, SIG4CEM) : le code du plugin reste
      // en place le temps d'être repris par l'interface de saisie. Une couche en lecture seule des
      // signalements du serveur reviendra dans la carto (à brancher avec le serveur de dépôt).
      enabled: false,
      base: './src/signalements/',
      styles: ['signalements.css'],
      scripts: ['pieces-store.js', 'zip-writer.js', 'depot.js', 'store.js', 'envoi.js', 'signalements.js'],
      options: {
        // Adresse du serveur de dépôt (depot-signalements/, Cloudflare Worker) qui attribue la référence
        // AAAA-NNNN. '' = pas de serveur : les signalements restent sur l'appareil (export ZIP à la main).
        serverUrl: '',
      },
    },
  ],

  // --- Interfaces (une seule page, home.html ; voir src/router.js) ---
  // home.html?app=<id> choisit l'interface. Le routeur copie le gabarit `template` (balise <template>
  // de home.html), charge les `styles` puis les `scripts` dans l'ordre, sans jamais charger une
  // autre interface. config.js, lui, est commun (chargé par home.html avant le routeur).
  //  - carto  : AMGT4CEM, visualisation de toutes les données sur la carte (interface par défaut) ;
  //  - signal : SIG4CEM, saisie des signalements et demandes (menu, brouillons, envois).
  defaultApp: 'carto',
  apps: {
    carto: {
      title: 'AMGT4CEM – Carte du réseau métro',
      template: 'amgt-tpl-carto',
      styles: [],
      scripts: [
        './vendor/leaflet/leaflet.js',
        './vendor/proj4/proj4.js',
        './vendor/proj4leaflet/proj4leaflet.js',
        './vendor/html2canvas/html2canvas.min.js',
        './src/buildInfo.js',
        './data/urbis-topo/catalogue.js',
        './data/plans-patrimoine/catalogue.js',
        './src/admin.js',
        './src/services.js',
        './src/layerOpacityStore.js',
        './src/crs.js',
        './src/shpLoader.js',
        './src/referentiel.js',
        './src/scaledText.js',
        './src/peLabelAnchors.js',
        './src/interstation.js',
        './src/metroLayer.js',
        './src/network.js',
        './src/pointsStore.js',
        './src/pointsLayer.js',
        './src/selectionStore.js',
        './src/pickerDefaultBar.js',
        './src/urbisTopoSelectionStore.js',
        './src/urbisTopoLayer.js',
        './src/urbisTopoPicker.js',
        './src/patrimoineSelectionStore.js',
        './src/patrimoineLayer.js',
        './src/patrimoinePicker.js',
        './src/addPointTool.js',
        './src/measureTool.js',
        './src/screenshotTool.js',
        './src/scaleControl.js',
        './src/buildInfoControl.js',
        './src/creditsLayout.js',
        './src/basemap.js',
        './src/mapMenu.js',
        './src/settingsPanel.js',
        './src/searchTool.js',
        './src/plugins.js',
        './src/addPointMenu.js',
        './src/app.js',
      ],
    },
    signal: {
      title: 'SIG4CEM – Signalements et demandes',
      template: 'amgt-tpl-signal',
      styles: ['./src/signal/signal.css'],
      // Socle commun avec la carte AMGT4CEM, pour que la carte de choix du point affiche ce que ta sélection
      // locale affiche dans la carte (réseau, UrbIS Topo, Plans patrimoine ; jamais les points métier) :
      // mêmes modules, même ordre. Sans les menus, la recherche, les outils (mesure, ajout de point) ni les
      // sélecteurs. Puis les modules de dépôt repris de src/signalements/ (vocabulaire, photos, archive,
      // envoi) et l'interface de saisie. L'ordre compte : chaque script dépend des précédents.
      scripts: [
        './vendor/leaflet/leaflet.js',
        './vendor/proj4/proj4.js',
        './vendor/proj4leaflet/proj4leaflet.js',
        './src/buildInfo.js',
        './data/urbis-topo/catalogue.js',
        './data/plans-patrimoine/catalogue.js',
        './src/services.js',
        './src/layerOpacityStore.js',
        './src/crs.js',
        './src/shpLoader.js',
        './src/referentiel.js',
        './src/scaledText.js',
        './src/peLabelAnchors.js',
        './src/interstation.js',
        './src/metroLayer.js',
        './src/network.js',
        './src/selectionStore.js',
        './src/urbisTopoSelectionStore.js',
        './src/urbisTopoLayer.js',
        './src/patrimoineSelectionStore.js',
        './src/patrimoineLayer.js',
        './src/screenshotTool.js', // basemap.js l'appelle (invalidateBackground) ; jamais initialisé ici
        './src/basemap.js',
        './src/plugins.js', // seulement captureClicks : les polygones du réseau lui renvoient les clics
        './src/signal/shims.js',
        './src/signalements/pieces-store.js',
        './src/signalements/zip-writer.js',
        './src/signalements/depot.js',
        './src/signalements/envoi.js',
        './src/signal/entries.js',
        './src/signal/mapPicker.js',
        './src/signal/form.js',
        './src/signal/signal.js',
      ],
    },
  },

  // --- Affichage ---
  maxZoom: 22,
};
