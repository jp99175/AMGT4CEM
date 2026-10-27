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
    vocabulairesJson: ['./config/metro/vocabulaires.json', './config/plans-patrimoine/vocabulaires.json'],
  },
  // Couche Métro PUBLIQUE (personne non connectée, src/metroPublicLayer.js) : Région d'abord (adresse et couche dans
  // config/fonds-de-plan/services.json, clé `metro`, renseignées par src/services.js), copie de secours du dépôt
  // ensuite (export d'origine de la même couche) si la Région refuse, ne répond pas ou renvoie un contenu inutilisable.
  metroPublic: {
    secoursUrl: './config/secours/region-metro.json',
    delaiMs: 8000, // attente maximale de chaque lecture avant de passer à la suivante
  },
  // LEGACY : repères de transition entre tronçons (triangles + codes D0, D1, G1a...), sans identifiant ;
  // à rattacher à lignes.shp quand il existera (voir metroLayer.js et le README).
  reperesTronconsLegacyUrl: './data/plans-patrimoine/reperes-troncons.legacy.json',

  // Étiquettes des Plans patrimoine, écrites par l'application (tout ce qui n'est pas une
  // géométrie de data/shapefile/, seule éditable sous AutoCAD) : un fichier JSON par type
  // d'élément dans data/plans-patrimoine/, en Lambert 72, partagés entre visiteurs. Lus par
  // tous ; enregistrés (administrateurs, outil d'édition src/peLabelEditor/) par un relais
  // serveur à déployer une fois (workers/relay/README.md), route PUT /shared/plans-patrimoine/<fichier>.
  // Ancrage/orientation des références de planche (src/peLabelAnchors.js) :
  peLabelAnchorsUrl: './data/plans-patrimoine/etiquettes-planches.json',
  // Position et tronçon de rattachement des numéros d'interstation (src/interstation.js) :
  interstationLabelsUrl: './data/plans-patrimoine/etiquettes-troncons.json',
  // Adresse du relais d'enregistrement : lue dans config/fonds-de-plan/services.json (clé
  // `relais`) par src/services.js, qui renseigne cette propriété au démarrage ; elle se
  // saisit la première fois dans ⚙ Paramètres > Serveur. Vide = enregistrement impossible.
  peLabelAnchorsRelayUrl: '',

  // Accès administrateur (⚙ Paramètres, mode édition des étiquettes de planche) : compte connecté portant le
  // droit administrateur du serveur de dépôt (src/admin.js, src/accountButton.js).

  // Petite emprise (2km x 2km, centre de Bruxelles) utilisée uniquement pour
  // sonder si un fond WMS répond avant de le proposer (voir basemap.js) —
  // confortablement à l'intérieur de l'emprise de tous les fonds Orthophoto
  // connus (vérifié contre les BoundingBox de leurs GetCapabilities). Ce
  // n'est pas une donnée métier.
  probeBboxLambert: [148000, 168000, 150000, 170000],

  // --- Services externes : fonds de plan, géocodeur, UrbIS Topo ---
  // Leur configuration (URL de chaque service, couches, années, attribution...) n'est plus ici :
  // elle vit dans config/fonds-de-plan/ (un fichier général `services.json` + un fichier par
  // service) et config/urbis-topo/parametres.json, lue au démarrage par src/services.js, qui
  // assemble `basemaps`, `geocoder` et `urbisTopo` ci-dessous dans cet objet.
  // Note générale : l'accès sortant de l'environnement de développement vers *.irisnet.be et
  // *.brussels est bloqué (voir README) : ces services n'ont pu être vérifiés que depuis un
  // navigateur réel.
  fondsDePlan: {
    servicesUrl: './config/fonds-de-plan/services.json',
    sourcesUrls: {
      'urbis': './config/fonds-de-plan/urbis.json',
      'bruciel': './config/fonds-de-plan/bruciel.json',
      'urbis-orthophotos': './config/fonds-de-plan/urbis-orthophotos.json',
      'flandre': './config/fonds-de-plan/flandre.json',
      'geocodeur': './config/fonds-de-plan/geocodeur.json',
      'urbis-topo': './config/urbis-topo/parametres.json',
      'nappe': './config/nappe/parametres.json',
    },
  },

  // --- Couches UrbIS Topo (à la demande) ---
  // Réglages du service : config/urbis-topo/parametres.json. Ici seulement le fichier de la
  // sélection par défaut PARTAGÉE (config/urbis-topo/), modifiable par un administrateur depuis
  // le sélecteur « modifier la sélection » (src/urbisTopoPicker.js, src/selectionStore.js).
  urbisTopo: {
    defaultSelectionUrl: './config/urbis-topo/selection-par-defaut.json',
  },

  // --- Plans patrimoine (à la demande) ---
  // Données de référence LOCALES fournies directement par l'utilisateur
  // (fichiers GeoJSON EPSG:31370, voir config/plans-patrimoine/catalogue.js) : plans
  // d'ensemble au 1/500e, numéros interstation. Jamais
  // rechargées depuis un service externe (contrairement à UrbIS Topo), donc
  // pas de garde-fou de zoom/emprise nécessaire (volumes très modestes).
  patrimoine: {
    // Couleurs attribuées automatiquement aux plans sélectionnés (voir
    // patrimoineSelectionStore.js), dans cet ordre, en boucle si besoin.
    colorPalette: ['#e64a19', '#1565c0', '#2e7d32', '#8e24aa', '#00838f'],
    // Sélection par défaut PARTAGÉE (rien de présélectionné au départ), modifiable par un administrateur.
    defaultSelectionUrl: './config/plans-patrimoine/selection-par-defaut.json',
  },

  // --- Serveur de dépôt (workers/depot/, Cloudflare Worker) ---
  // Comptes et connexion, envoi des signalements et demandes de SIG4CEM (référence AAAA-NNNN attribuée à la
  // réception), couche « Points métier » de la carte, administration. '' = pas de serveur.
  depot: {
    serverUrl: 'https://amgt4cem-depot-signalements.jp99175.workers.dev',
    // Zoom à partir duquel le pictogramme amiante remplace le losange rouge sur la carte (à ajuster).
    amiantePictoZoomMin: 17,
  },

  // --- Plugins (applications séparées branchées sur la carte, voir src/plugins.js) ---
  // Chaque plugin vit dans son dossier : styles puis scripts chargés dans l'ordre ; le dernier
  // script s'enregistre par AMGT4CEM_Plugins.register. `enabled: false` le retire sans rien supprimer.
  plugins: [],

  // --- Interfaces (une seule page, home.html ; voir src/router.js) ---
  // home.html?app=<id> choisit l'interface. Le routeur copie le gabarit `template` (balise <template>
  // de home.html), charge les `styles` puis les `scripts` dans l'ordre, sans jamais charger une
  // autre interface. config.js, lui, est commun (chargé par home.html avant le routeur).
  //  - carto  : AMGT4CEM, visualisation de toutes les données sur la carte (interface par défaut) ;
  //  - signal : SIG4CEM, saisie des signalements et demandes (menu, brouillons, envois) ;
  //  - admin  : administration des intervenants (référentiel sur le serveur de dépôt, droit administrateur requis).
  defaultApp: 'carto',
  apps: {
    carto: {
      title: 'AMGT4CEM – Carte du réseau métro',
      template: 'amgt-tpl-carto',
      styles: ['./src/auth/auth.css'],
      scripts: [
        './vendor/leaflet/leaflet.js',
        './vendor/proj4/proj4.js',
        './vendor/proj4leaflet/proj4leaflet.js',
        './vendor/html2canvas/html2canvas.min.js',
        './src/buildInfo.js',
        './config/urbis-topo/catalogue.js',
        './config/plans-patrimoine/catalogue.js',
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
        './src/metroPublicLayer.js',
        './src/network.js',
        './src/auth/auth.js',
        './src/auth/authUi.js',
        './src/signalementsLayer.js',
        './src/zoomThresholds.js',
        './src/selectionStore.js',
        './src/pickerDefaultBar.js',
        './src/orthoSelectionStore.js',
        './src/urbisTopoSelectionStore.js',
        './src/urbisTopoLayer.js',
        './src/urbisTopoPicker.js',
        './src/nappeSelectionStore.js',
        './src/nappeLayer.js',
        './src/patrimoineSelectionStore.js',
        './src/patrimoineLayer.js',
        './src/patrimoinePicker.js',
        './src/addPointTool.js',
        './src/measureTool.js',
        './src/virtualBoreTool.js',
        './src/screenshotTool.js',
        './src/scaleControl.js',
        './src/buildInfoControl.js',
        './src/creditsLayout.js',
        './src/basemap.js',
        './src/orthoPicker.js',
        './src/menuPrefs.js',
        './src/mapMenu.js',
        './src/settingsPanel.js',
        './src/searchTool.js',
        './src/plugins.js',
        './src/addPointMenu.js',
        './src/accountButton.js',
        './src/app.js',
      ],
    },
    signal: {
      title: 'SIG4CEM – Signalements et demandes',
      template: 'amgt-tpl-signal',
      styles: ['./src/signal/signal.css', './src/auth/auth.css'],
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
        './config/urbis-topo/catalogue.js',
        './config/plans-patrimoine/catalogue.js',
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
        './src/zoomThresholds.js',
        './src/selectionStore.js',
        './src/urbisTopoSelectionStore.js',
        './src/urbisTopoLayer.js',
        './src/patrimoineSelectionStore.js',
        './src/patrimoineLayer.js',
        './src/screenshotTool.js', // basemap.js l'appelle (invalidateBackground) ; jamais initialisé ici
        './src/basemap.js',
        './src/plugins.js', // seulement captureClicks : les polygones du réseau lui renvoient les clics
        './src/searchTool.js',
        './src/signal/shims.js',
        './src/signalements/pieces-store.js',
        './src/signalements/zip-writer.js',
        './src/signalements/depot.js',
        './src/auth/auth.js',
        './src/auth/authUi.js',
        './src/signalements/envoi.js',
        './vendor/jspdf/jspdf.umd.min.js',
        './src/signalements/pdf.js',
        './src/signalements/zip-reader.js',
        './src/signalements/importer.js',
        './src/signal/entries.js',
        './src/signal/mapPicker.js',
        './src/signal/photoEditor.js',
        './src/signal/form.js',
        './src/signal/list.js',
        './src/signal/all.js',
        './src/signal/signal.js',
      ],
    },
    admin: {
      title: 'AMGT4CEM – Administration des intervenants',
      template: 'amgt-tpl-admin',
      styles: ['./src/auth/auth.css', './src/admin/admin.css'],
      scripts: [
        './src/buildInfo.js',
        './src/auth/auth.js',
        './src/auth/authUi.js',
        './src/admin/admin.js',
      ],
    },
  },

  // --- Affichage ---
  maxZoom: 22,
};

// --- Nouvelle interface (home.html?page=…), à côté des interfaces actuelles (?app=…) jusqu'à la bascule ---
// Chaque page reprend les fichiers de l'interface correspondante et y ajoute la barre de navigation (src/nav/).
// Un fichier qui doit changer pour la nouvelle interface est COPIÉ (src/…/v2 ou nom distinct) et remplace
// l'original dans la liste de la page seulement : les interfaces ?app= ne sont jamais touchées.
AMGT4CEM_CONFIG.defaultPage = 'carto';
AMGT4CEM_CONFIG.pages = (function (apps) {
  const NAV_STYLES = ['./src/nav/nav.css'];
  const NAV_SCRIPTS = ['./src/nav/nav.js'];
  const avecNav = (app) => ({
    ...app,
    nav: true,
    styles: [...(app.styles || []), ...NAV_STYLES],
    scripts: [...app.scripts, ...NAV_SCRIPTS],
  });
  return {
    carto: avecNav(apps.carto),
    signal: avecNav(apps.signal),
    reglages: {
      title: 'AMGT4CEM – Réglages',
      template: 'amgt-tpl-reglages',
      nav: true,
      styles: ['./src/auth/auth.css', ...NAV_STYLES, './src/reglages/reglages.css'],
      scripts: ['./src/buildInfo.js', './src/auth/auth.js', './src/auth/authUi.js', ...NAV_SCRIPTS, './src/reglages/reglages.js'],
    },
  };
})(AMGT4CEM_CONFIG.apps);
