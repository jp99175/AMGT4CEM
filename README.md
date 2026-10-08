# AMGT4CEM — Carte du réseau métro (V1)

Application cartographique légère et autonome pour la maintenance génie
civil du réseau métro bruxellois (HTML + CSS + JavaScript, sans framework,
sans backend).

## 1. Lancer l'application

L'application est une page statique. Les géométries (shapefiles
`data/shapefile/`), les référentiels (JSON de `data/metro/` et `data/plans-patrimoine/`) et la
configuration des services (`data/fonds-de-plan/`) sont chargés via
`fetch()`, ce qui **ne fonctionne pas** si vous ouvrez `home.html` directement
en double-clic (`file://`) — c'est une restriction des navigateurs, pas un bug.
Servez le dossier avec un petit serveur HTTP local :

```bash
cd AMGT4CEM
python3 -m http.server 8000
```

Puis ouvrez l'une des deux interfaces de la page unique `home.html` :

- http://localhost:8000/home.html?app=carto : **AMGT4CEM**, visualisation de toutes les données sur la carte
  (interface par défaut, aussi atteinte par `index.html` et par `home.html` sans paramètre) ;
- http://localhost:8000/home.html?app=signal : **SIG4CEM**, saisie des signalements et demandes
  (menu, nouvelle entrée avec choix du point sur sa propre carte, enregistrement local ou envoi : voir `src/signal/README.md`).

*(Si vous n'avez pas Python, `npx serve` ou l'extension VS Code "Live Server"
fonctionnent tout aussi bien.)*

Si vous ouvrez malgré tout la page en `file://`, l'application le détecte et
affiche un message demandant de la servir par un petit serveur HTTP (aucun
bouton de secours : les données ne sont pas chargées).

## 2. Tester le scénario principal

1. La carte s'ouvre déjà recentrée sur l'emprise du réseau métro.
2. Les couches **Stations** et **Tunnels** sont visibles.
3. Cliquez sur une station ou un tunnel : ses informations du
   référentiel (noms FR/NL — tous les noms d'une station —, identifiant...)
   s'affichent dans une popup.
4. Déplacez la carte (glisser) et zoomez (molette, pincement, ou
   double-clic — pas de boutons +/- dédiés, voir point 7 ci-dessous) : le
   fond et les données métro restent parfaitement superposés, sans limite
   de zoom.
5. Bouton **☰ Carte** (haut gauche) : ouvre le menu, organisé en trois
   catégories. **Fond de plan** : choisissez **UrbIS** ou **Orthophotos**
   (fait apparaître, en bas de l'écran, une navigation **‹ année › ⏭** pour
   parcourir les millésimes de 1935 à 2022 — seules les années dont le
   service répond sont proposées, réglée sur la plus récente accessible par
   défaut ; le bouton **⏭** y ramène directement). **Couches** : cases à
   cocher pour Métro (Stations et Tunnels), UrbIS Topo (voir section 3bis)
   et Plans patrimoine (section 3ter). **Points métier** : case à cocher
   pour vos points métier (section 6) — cette catégorie est amenée à
   s'enrichir (constats/signalements...).
   L'icône **☰ curseurs** à côté de chaque couche, dans les trois
   catégories, ouvre un sous-volet de réglage d'opacité individuel (comme
   dans MobiGIS), mémorisé par appareil — un clic ailleurs (sur un autre
   sous-volet, sur la carte, ...) le referme, comme le menu ☰ Carte et le
   panneau ⚙ Paramètres. Le bouton **⤢ Réinitialiser la vue** revient à
   l'emprise générale du réseau et remet le fond UrbIS grisé.
6. Bouton **🔍** (haut droite) : ouvre un champ de recherche sur les
   stations (tous leurs noms, FR et NL), tunnels (référentiel, voir section 4), planches (référence), points
   métier et adresses (noms de rues). Tapez un nom (les accents sont
   ignorés dans la recherche, ex.
   "de brouckere" trouve "De Brouckère") : les résultats stations/tunnels/
   points apparaissent immédiatement, puis les adresses correspondantes
   (géocodeur UrbIS, voir section 3) s'ajoutent après une courte requête
   réseau. Cliquez un résultat : la carte se recentre et zoome dessus
   automatiquement.
7. Une réglette graduée façon "latte" (en bas à gauche), avec sa valeur
   affichée à droite du segment, indique la distance à l'écran :
   graduations principales aux deux bouts et sous-graduations plus courtes
   à l'unité (ex. tous les 1 km si elle affiche "5 km", tous les 10 m si
   elle affiche "50 m"). Cliquez dessus pour afficher à la place les
   coordonnées Lambert (X, Y) du dernier point survolé/cliqué sur la
   carte ; au bout de 5 secondes (ou en recliquant), on revient
   automatiquement à la réglette. Voir `src/scaleControl.js`.
   En bas à droite, au-dessus de l'attribution "(c) CIRB/CIBG – UrbIS", un petit
   repère rouge **BUILD AAAAMMJJ-HHMM** (heure locale de Bruxelles, pas
   UTC) indique l'horodatage de la dernière mise à jour du code déployé
   (voir `src/buildInfo.js` — site statique, pas de véritable étape de
   compilation : cette valeur est mise à jour à la main à chaque commit
   poussé).
8. Cliquez **✚ Ajouter un point**, puis cliquez à l'endroit voulu sur la
   carte (vous pouvez continuer à naviguer avant de cliquer) : un marqueur
   provisoire apparaît, les coordonnées X/Y Lambert sont calculées
   automatiquement et affichées dans le petit formulaire.
9. Complétez *Type* et *Libellé*, cliquez **Enregistrer**. Le point devient
   permanent et est sauvegardé dans la micro-base (`localStorage` du
   navigateur, propre à cet appareil — voir section 6).
10. Rechargez la page : le point est toujours là. Cliquez dessus pour
    consulter ses informations. Vous pouvez le glisser-déposer pour le
    repositionner : les coordonnées Lambert sont recalculées et enregistrées
    automatiquement. Le bouton **🗑 Supprimer ce point** dans la popup
    l'efface définitivement (demande confirmation).
11. Icône **⚙** en haut à droite du menu **☰ Carte** : ouvre la fenêtre de paramètres, à trois
    onglets — **Sources** (corriger l'URL d'un service externe — fond UrbIS,
    orthophotos, géocodeur — si celui-ci change d'adresse, sans modifier le
    code ; voir section 3bis), **Serveur** (adresse du relais d'enregistrement
    et code administrateur, bouton **Tester**) et **Données** (lancer le
    mode édition des étiquettes (planches, interstations) ; charger un nouveau shapefile :
    à venir — il devra accepter un ou plusieurs fichiers du dossier du
    shapefile : .shp, .dbf, .shx, .prj, .cpg…, pas seulement le .shp). La fenêtre est **réservée aux administrateurs** : son ouverture
    passe par `AMGT4CEM_Admin.requestAccess()` (`src/admin.js`), où se
    branchera le mot de passe administrateur (pas encore implémenté : accès
    ouvert tant que `adminMode` vaut vrai dans `config.js`). Ce sont des
    **paramètres généraux**, enregistrés sur le serveur et communs à tous les
    visiteurs — rien n'est gardé localement.
12. Bouton **📏** (icône seule, "Mesurer" au survol) : effet dynamique en deux gestes
    presser-glisser-relâcher. Pressez sur la carte pour poser le centre
    d'un cercle : tant que le bouton reste enfoncé, le déplacer suit le
    curseur en direct ; relâchez pour le figer exactement à l'endroit du
    relâchement (pas à la position du dernier mouvement enregistré avant,
    parfois légèrement différente). Pressez à nouveau pour tracer le rayon
    depuis ce centre : tant que le bouton reste enfoncé, le point
    d'arrivée suit le curseur en direct (segment pointillé + cote
    au bout du segment + cercle qui grandit/rétrécit avec lui) ; relâchez
    pour le figer, là aussi exactement au point de relâchement, jamais à
    une position atteinte par la souris/le doigt ensuite.

    Dès ce 2e relâchement, la carte est **automatiquement capturée et
    gardée en mémoire, comme un fichier temporaire** (pas besoin de cliquer
    sur quoi que ce soit) : capturer au moment précis où la mesure vient
    d'être tracée, plutôt qu'à un clic ultérieur, évite toute image
    incomplète ou incohérente avec ce qui a réellement été mesuré. Rien
    n'est écrit où que ce soit (ni presse-papier, ni disque) à ce stade. Le
    bouton **💾**, sous "☰ Carte" (pas dans la barre d'outils, il
    n'apparaît qu'avec une mesure en cours), est le SEUL moment où cette
    image quitte la mémoire : il déclenche le téléchargement du fichier PNG
    déjà capturé, sans refaire de rendu. Le bouton, le cercle, le segment
    et la cote disparaissent tous ensemble 4 secondes après ce 2e
    relâchement (une nouvelle pression pendant ce délai recommence
    directement une nouvelle mesure) ; si vous n'avez pas cliqué sur "💾"
    avant leur disparition, l'image capturée est simplement abandonnée
    (jamais écrite nulle part). Cercle et segment sont en
    magenta (`#f50057`), une couleur qui tranche aussi bien sur le fond de
    carte que sur les couches orangées (Plans patrimoine) déjà utilisées. Le
    point de départ (centre du cercle) est un anneau avec un réticule (pas
    un point plein), avec un pixel transparent à l'intersection des deux
    lignes qui le composent, et un léger halo blanc pour rester lisible sur
    un fond chargé. La cote (l'étiquette de distance) est toujours
    positionnée légèrement au-delà du bord du cercle, dans le prolongement
    du rayon, et grandit à l'opposé de celui-ci quelle que soit sa
    direction : elle n'est donc jamais coupée par le trait ou le
    remplissage du cercle.
    Le glisser-déposer et le pincer-zoomer de la
    carte sont désactivés tant que l'outil est actif, pour que ces gestes
    de positionnement ne déplacent/zooment pas la vue. Fonctionne aussi
    bien au doigt (smartphone/tablette) qu'à la souris (événements Pointer
    natifs plutôt que les événements souris relayés par Leaflet, que le
    tactile ne déclenche pas). Au doigt, le point réellement positionné est
    décalé de 60 px vers le haut par rapport au point de contact, pour que
    le doigt ne cache pas ce qu'il est en train de placer (pas de décalage
    à la souris). Toutes les couches vectorielles (Métro, UrbIS Topo,
    Plans patrimoine, mesure...) sont dessinées sur `<canvas>` plutôt qu'en
    SVG (`preferCanvas`, voir `src/app.js`) : la capture d'écran s'est
    montrée peu fiable avec le SVG de Leaflet en usage réel (couches ou
    éléments de la mesure absents de l'image bien que visibles à l'écran).

    La capture ne redessine pas toute la carte à chaque mesure : régénérer
    l'image entière (tuiles + couches) via `html2canvas` à chaque fois s'est
    révélé peu fiable selon le réseau du moment (des tuiles pourtant bien
    visibles à l'écran pouvaient manquer dans l'image, `useCORS` forçant une
    nouvelle requête réseau indépendante de la tuile déjà chargée). Le fond
    de carte n'est donc **recapturé que quand la vue a pu changer** (mis en
    cache sinon) : à l'activation de l'outil, et à chaque changement de
    fond de plan ou de couche (☰ Carte reste utilisable pendant une
    mesure, seuls le glisser et le pincer-zoomer sont désactivés) ; seuls le
    cercle, le segment, le point central et la cote — dont la géométrie
    exacte est déjà connue — sont redessinés à **chaque** capture directement en
    Canvas 2D (sans passer par `html2canvas`, donc sans dépendance réseau),
    puis composés par-dessus ce fond.
    Activer **✚ Ajouter un point** désactive **📏 Mesurer** et inversement
    (un seul outil actif à la fois). Voir `src/measureTool.js` et
    `src/screenshotTool.js`.

Voir section 6 ci-dessous pour le détail du stockage (micro-base de
données) et sa mise en place.

## 3. Les fonds de plan

Deux choix dans le menu **☰ Carte**, dont la configuration vit dans
`data/fonds-de-plan/` (un fichier général `services.json` + un fichier par
service, voir section 3bis) :

### UrbIS

Fond de référence grisé. Service WMS public UrbIS (CIRB/CIBG), le même
service que celui utilisé par MobiGIS
(`https://geoservices-urbis.irisnet.be/geoserver/Urbis/wms`, couche
`urbisFRGray`). **Cet endpoint n'a pas pu être testé en direct depuis
l'environnement de développement** (politique réseau du bac à sable bloquant
les domaines `*.irisnet.be`) — vérifiez son chargement depuis votre propre
poste.

### Orthophotos

Une seule ligne du temps continue, de **1935 à 2025**, alimentée par deux sources (Bruxelles et Flandre, voir plus bas),
parcourue avec des chevrons ‹ › en bas de l'écran une fois "Orthophotos"
sélectionné dans le menu. Contrairement à un simple curseur, **seules les
années dont le service répond effectivement sont proposées** : à la
première sélection, chaque année est sondée une fois (petite requête
GetMap 64×64, voir `AMGT4CEM_Basemap.getAccessibleBrucielYears` dans
`src/basemap.js`) et le résultat mis en cache pour la session. Les chevrons
ne naviguent qu'entre années accessibles ; il n'y a donc jamais d'image
cassée ni de message d'erreur affiché — si une année est inaccessible, elle
n'apparaît simplement pas dans la navigation. Réglée sur la plus récente
accessible par défaut (2022 si tout répond).

Le nom "Bruciel" n'est pas montré à l'utilisateur, mais reste utilisé en
interne (`config.js`, `AMGT4CEM_Basemap.showBruciel`) puisque la donnée
historique vient bien de ce service. Deux services distincts sont fusionnés
dans cette unique série, de façon transparente pour l'utilisateur :

- **1935-1996** : Bruciel historique (Bruxelles Urbanisme & Patrimoine /
  urban.brussels). Service GeoServer : `gis.urban.brussels`, workspace
  `URBAN_DCC_ER` (et non `BRUCIEL`, qui ne contient que des couches
  thématiques annexes — localisation d'ateliers, tracés de tram, etc. — pas
  les images aériennes elles-mêmes). Couches `Orthophotoplans_<année>`.
  Confirmées via un `GetCapabilities` réel fourni par l'utilisateur.
- **2004-2022** : orthophotos récentes UrbIS, les mêmes que celles
  proposées par MobiGIS (`data.mobility.brussels/mobigis`). Service
  GeoServer : `geoservices-urbis.irisnet.be`, workspace `urbisgrid`.
  Couches `urbisgrid:Ortho<année>`. Noms confirmés en extrayant les URLs de
  légende réellement générées par la page MobiGIS (snapshot HTML fourni par
  l'utilisateur).

- **Flandre, 2000-2025** : Digitaal Vlaanderen, « Orthofotomozaïek,
  middenschalig, winteropnamen », service WMS
  `https://geo.api.vlaanderen.be/OMW/wms` (`AMGT4CEM_CONFIG.basemaps.flandre`).
  Couches `OMWRGB<aa>VL` pour 2012-2025 (25 cm jusqu'en 2021, 15 cm ensuite) et
  trois compilations pluriannuelles : 2000-2003, 2005-2007 et 2008-2011
  (la couche `…_vdc` de chacune donne les dates de vol exactes). Noms
  confirmés via un `GetCapabilities` réel fourni par l'utilisateur.

  **Doublons et choix de la source.** Les millésimes présents dans les deux
  sources (2012, 2014, 2016-2022) ont leur **date soulignée** dans la barre
  des années : un clic sur la date bascule de Bruxelles à la Flandre (et
  inversement), et le choix est mémorisé **par année** sur l'appareil. Par
  défaut, c'est la source bruxelloise qui s'affiche. Les années propres à
  une source (1935-1996, 2004, 2009, 2013, 2015, 2023-2025, plages 2000-2003,
  2005-2007 et 2008-2011) ne sont pas soulignées.

  **Emprise.** Les tuiles flamandes sont découpées selon le contour de la
  Région de Bruxelles-Capitale, lu à la demande dans UrbIS Adm (WFS, couche
  `UrbisAdm:Mu` = les 19 communes, `config.basemaps.flandre.regionBoundary`) :
  rien n'est affiché au-delà. Si cette lecture échoue (réseau, CORS, nom de
  couche — non testé depuis le bac à sable), les tuiles s'affichent entières
  dans le rectangle `regionBboxLambert` (approximatif). La découpe passe par
  un canvas par tuile (`AMGT4CEM_Basemap._ClippedWmsLayer`) : l'image est
  demandée avec CORS ; si le serveur ne l'autorise pas, elle est redemandée
  sans (affichage correct, mais la capture d'écran du fond est alors
  impossible pour ces années).

  **Logo de la source.** À droite de la date, un micro logo rond indique
  l'entité dont l'orthophoto est affichée : le lion sur fond jaune pour la
  Flandre, l'iris sur fond blanc pour Bruxelles (`assets/logo-vlaanderen.png`
  et `assets/logo-bruxelles.png`, 96 px, recadrés depuis les logos officiels).

  **Crédits.** Le crédit en bas à droite suit la couche affichée (organisme
  et millésime : « © urban.brussels – Bruciel (1953) », « © CIRB/CIBG – UrbIS
  (2016) », « © Digitaal Vlaanderen – orthophoto 2016 »), et « © CIRB/CIBG –
  UrbIS Topo » s'ajoute quand la couche UrbIS Topo est active.

  **Bas de carte.** Crédits en bas à droite, échelle en bas à gauche, repère
  BUILD juste au-dessus des crédits. Si crédits et échelle ne tiennent plus
  côte à côte (`src/creditsLayout.js`, remesuré à chaque changement de
  contenu et au redimensionnement), la barre de crédits passe sur toute la
  largeur, en fond translucide, et l'échelle se place au-dessus.

Aucun nom de couche ci-dessus n'est deviné. Pour ajouter un millésime plus
récent quand il sera identifié, ajoutez une entrée dans
`data/fonds-de-plan/urbis-orthophotos.json` (ou `bruciel.json` pour une année
historique), tableau `entries`.

### Recherche d'adresses (géocodage)

La recherche (bouton **🔍**) inclut aussi les noms de rues, via le service
officiel de géocodage UrbIS (CIRB/CIBG),
`https://geoservices.irisnet.be/localization/Rest/Localize/getaddresses`
(configuré dans `data/fonds-de-plan/services.json` et `geocodeur.json`, utilisé par `src/searchTool.js`).
Endpoint et format confirmés via le code source public du connecteur PHP
`geo6/geocoder-php-urbis-provider` (pas deviné) ; il répond nativement en
EPSG:31370, pas de conversion nécessaire côté client.

Contrairement aux fonds de plan WMS (chargés comme des `<img>`, jamais lus
par du JavaScript), cette recherche fait un vrai appel `fetch()` qui lit la
réponse JSON — ce qui exige un support CORS explicite du serveur. **Ce
point n'a pas pu être vérifié depuis l'environnement de développement**
(domaine `*.irisnet.be` bloqué par la politique réseau du bac à sable, comme
pour les autres services UrbIS) : à tester depuis un navigateur réel. En
cas d'indisponibilité (réseau, CORS, format inattendu), la recherche
d'adresse échoue silencieusement (aucune erreur affichée) et les résultats
stations/tunnels/points restent disponibles normalement.

### CRS forcé en EPSG:31370

Les couches Bruciel (les deux périodes) ne déclarent que
`EPSG:31370`/`CRS:84` dans leurs `GetCapabilities` (pas `EPSG:3857`,
contrairement au fond UrbIS) — la carte Leaflet fonctionnant par défaut en
Web Mercator, ces couches précisent `crs: 'EPSG:31370'` dans `data/fonds-de-plan/bruciel.json` et `urbis-orthophotos.json`
pour forcer Leaflet à les requêter dans leur CRS natif (via Proj4Leaflet,
voir `src/basemap.js`), sous peine de tuiles vides ou d'erreur serveur.

### Couches UrbIS Topo à la demande

Dans le menu **☰ Carte**, section "Couches" : la case **UrbIS Topo**,
au même titre que Métro (Stations + Tunnels, fusionnés en une seule case
également) et Points métier, affiche ou masque des objets détaillés du
produit **UrbIS Topo** (CIRB/CIBG - Paradigm) — grilles de ventilation,
chambres et taques d'égout, avaloirs, mobilier urbain, marquages
routiers, etc.

Le choix des types à afficher se fait à part, via le lien
**"(modifier la sélection)"**, qui ouvre un sélecteur plein écran listant
l'intégralité du catalogue d'objets (une centaine de types), classé par
thème (Voirie, Assainissement et égouttage, Marquages et signalisation
routière, Mobilier urbain, Transport en commun, Bâtiments...) avec un champ
de recherche. Cocher/décocher un type l'affiche/le masque immédiatement sur
la carte (si la case "UrbIS Topo" est elle-même cochée), avec une couleur
assignée automatiquement. Le menu ne liste pas les types actuellement
sélectionnés : seule la case globale y apparaît. Le lien de sélection, comme
le curseur d'opacité, ne s'affiche que lorsqu'on clique sur l'icône
**curseurs** de la case UrbIS Topo — les deux partagent le même volet
repliable, pour ne pas encombrer le menu par défaut.

Chaque thème a sa propre case "tout cocher/décocher" (à côté de son titre,
état indéterminé si seule une partie des types du thème est sélectionnée),
pour sélectionner une famille entière d'un coup plutôt que type par type ; une
case **« Tout (dé)sélectionner »**, au-dessus de tout, agit sur tous les types
affichés (la recherche restreint cet ensemble).

**Sélections** (trois niveaux, du plus au moins prioritaire — même principe pour
Plans patrimoine, section 3ter) :
1. la **sélection courante** de l'appareil, mise à jour à chaque case cochée
   (`localStorage`, clé `amgt4cem.urbistopo-selection.v1`) ;
2. les **préférences locales** de l'utilisateur : le bouton **💾** en haut du
   sélecteur les enregistre (clé `amgt4cem.urbistopo-default.v1`) ; elles servent
   quand il n'y a pas de sélection courante (première visite, données du
   navigateur effacées) ;
3. la **sélection par défaut partagée** : `data/urbis-topo/selection-par-defaut.json`,
   lue par tous. Sous la liste, le bouton **« 🔒 Modifier la sélection par défaut
   (administrateur) »** vérifie le code administrateur auprès du relais, puis fait
   modifier un *brouillon* de cette sélection (la carte et la sélection de l'appareil
   ne changent pas) ; **Enregistrer** l'envoie au relais (route
   `shared/urbis-topo/selection-par-defaut`), qui la commit ; **Annuler** l'abandonne.

Voir `data/urbis-topo/catalogue.js` pour le catalogue complet,
`src/selectionStore.js` (principe commun) et `src/urbisTopoSelectionStore.js` pour
la sélection, `src/pickerDefaultBar.js` pour la barre « sélection par défaut »,
`src/urbisTopoPicker.js` pour le sélecteur, `src/urbisTopoLayer.js` pour le chargement
carte, et `data/urbis-topo/parametres.json` pour les réglages du service.

**Rien de tout cela n'est deviné.** Le service WFS officiel
(`geoservices-urbis.irisnet.be/geoserver/urbistopo/wfs`) ne regroupe le
catalogue d'objets que sous 3 couches globales par géométrie
(`urbistopo:TopoPoints/TopoLines/TopoShapes`) — chaque type réel (grille de
ventilation, avaloir...) est un code (ex. `CR6203P`) dans un attribut `TYPE`
à l'intérieur de ces couches :
- la liste complète des codes/libellés vient de la fiche technique
  officielle ("UrbIS - Topo", spécifications de produit ISO 19131, section
  4.1 "Catalogue d'objets", PDF fourni par l'utilisateur) ;
- le nom de l'attribut (`TYPE`), les libellés français/néerlandais
  (`DESCRFRE`/`DESCRDUT`) et le format de sortie (GeoJSON, EPSG:31370)
  viennent d'un `GetFeature` réel exécuté par l'utilisateur.

Le regroupement par thème (voirie, bâtiments...), en revanche, n'existe pas
dans la fiche technique — c'est un classement construit pour la navigation
dans le sélecteur, une aide d'interface et non une donnée officielle.

**Limite connue de la V1** : seuls les types en géométrie "point" ou "ligne"
sont proposés dans le sélecteur. Le catalogue contient aussi des types en
géométrie "texte" (étiquettes, ex. noms de rue, numéros de maison) et un
type en "polygone" (zones de mise à jour par levé) : leur affichage carte
n'est pas encore pris en charge, ils restent listés dans
`data/urbis-topo/catalogue.js` mais ne sont pas sélectionnables.

Chargement strictement **à la demande**, pour deux raisons :
- rien n'est requêté tant qu'aucun type n'est sélectionné ;
- une fois une sélection faite, seuls les objets de l'emprise actuellement
  visible sont demandés (`CQL_FILTER` avec `TYPE IN (...)` et `BBOX(...)`,
  au plus 2 requêtes quel que soit le nombre de types sélectionnés — une par
  géométrie), et seulement à partir d'un niveau de zoom minimal
  (`minZoom` de `data/urbis-topo/parametres.json`, 16 par défaut, ajustable) — une seule
  des 3 couches globales dépasse 450 000 objets au total, tous types
  confondus, il serait à la fois lent et inutile de tout charger d'un coup.
  La zone se met à jour (avec un léger délai) quand vous déplacez ou zoomez
  la carte, tant qu'au moins un type reste sélectionné.

Comme pour le géocodeur d'adresses, cet endpoint est prévu pour un usage
"téléchargement" classique depuis un navigateur : le support CORS d'un appel
`fetch()` JSON depuis l'application elle-même **n'a pas pu être vérifié
depuis cet environnement** (domaine bloqué) — à tester en conditions
réelles. En cas d'indisponibilité, la couche reste simplement vide (aucune
erreur affichée), sans affecter le reste de l'application.

Enfin, la fiche technique précise (section 6.2 "Généalogie") que ce jeu de
données "est produit par l'intégration de données provenant d'opérations
cycliques de photogrammétrie **et de relevés topographiques**", avec une
mise à jour mensuelle du produit (section 9).

## 3bis. Toutes les sources de données sont-elles externes ? Que faire si l'une change ?

Oui, à quelques exceptions près : les géométries (`data/shapefile/`, export
AutoCAD) et les référentiels (`data/metro/`, `data/plans-patrimoine/`) — voir
section 4 — sont fournis par l'utilisateur et servis localement, comme les
fichiers « Plans patrimoine » (section 3ter) ; la micro-base de points métier vit
uniquement dans le `localStorage` du navigateur (section 6). Tout le reste — fond
UrbIS, orthophotos (Bruciel, UrbIS, Flandre), géocodeur d'adresses, UrbIS Topo —
est interrogé en direct auprès de services externes (CIRB/CIBG, urban.brussels,
Digitaal Vlaanderen), à chaque affichage, sans rien mettre en cache de façon
permanente côté application.

**Où est configuré chaque service.** Plus rien n'est en dur dans `config.js` :
- `data/fonds-de-plan/services.json` — fichier **général** : adresse du relais et
  URL de chaque service (`urbis`, `bruciel`, `urbis-orthophotos`, `flandre`,
  `urbis-adm`, `geocodeur`, `urbis-topo`) ;
- un fichier par service pour ses réglages propres (couches, années, attribution,
  format, CRS, notes de provenance) : `data/fonds-de-plan/urbis.json`, `bruciel.json`,
  `urbis-orthophotos.json`, `flandre.json`, `geocodeur.json`, et
  `data/urbis-topo/parametres.json` pour UrbIS Topo (avec sa sélection par défaut).

`src/services.js` lit ces fichiers au démarrage, avant toute création de couche, et
les assemble dans `AMGT4CEM_CONFIG` (`basemaps`, `geocoder`, `urbisTopo`) ; un fichier
absent ou illisible est signalé en console et le service concerné reste non configuré.

Si l'un de ces services change d'adresse (migration de serveur, changement de
nom de domaine...), il n'est pas nécessaire de modifier le code : l'icône **⚙**
en haut à droite du menu **☰ Carte** ouvre la fenêtre de paramètres ; son onglet
**Sources** permet de corriger :

- l'URL du service WMS du fond UrbIS et le nom de sa couche,
- l'URL du service WMS des orthophotos historiques (1935&ndash;1996),
- l'URL du service WMS des orthophotos récentes (2004&ndash;2022),
- l'URL du service WMS des orthophotos de Flandre,
- l'URL du géocodeur d'adresses.

Ces valeurs sont des **paramètres généraux de l'application**, pas des réglages de
l'appareil : **Enregistrer** les envoie au serveur (relais `relay/`, routes
`shared/fonds-de-plan/services` et, si le nom de la couche UrbIS change,
`shared/fonds-de-plan/urbis`), qui commit les fichiers dans le dépôt : tous les
visiteurs les voient après le redéploiement de GitHub Pages (~1 min). Les adresses
doivent être en `https` (ou `http://localhost`). Il n'y a plus de « valeurs par
défaut » dans le code : les fichiers du dépôt font foi, et l'historique Git permet
de revenir en arrière. Cette fenêtre est réservée aux administrateurs (voir section 1,
item 11) ; l'enregistrement exige l'adresse du relais et le code administrateur
(onglet **Serveur**).

Cela ne couvre que les adresses de service (le cas le plus probable : migration d'un
serveur entier) : les noms de couches par année pour les orthophotos
(`Orthophotoplans_1996`, `urbisgrid:Ortho2022Ns`...) se modifient dans le fichier du
service, car les vérifier nécessite de toute façon de consulter le `GetCapabilities`
réel du service (voir section 3).

## 3ter. Plans patrimoine

Dans le menu **☰ Carte**, section "Couches" : la case **Plans patrimoine**
affiche ou masque des données de référence fournies directement par
l'utilisateur (export de son propre SIG patrimoine, jamais rechargées
depuis un service externe — contrairement à UrbIS Topo). Même principe que
UrbIS Topo : le choix des plans à afficher se fait via le lien
**"(modifier la sélection)"**, qui ouvre un sélecteur plein écran listant
le catalogue disponible (voir `data/plans-patrimoine/catalogue.js`) ; rien n'est
présélectionné au départ. Mêmes commandes et mêmes trois niveaux de sélection que
pour UrbIS Topo (section 3) : **💾** = préférences locales (clé
`amgt4cem.patrimoine-default.v1`), case **« Tout (dé)sélectionner »** en haut, et
sous la liste le bouton « Modifier la sélection par défaut (administrateur) » qui
modifie `data/plans-patrimoine/selection-par-defaut.json` via le relais (voir
`src/patrimoineSelectionStore.js`).
Le lien de sélection, comme le curseur d'opacité, ne s'affiche que
lorsqu'on clique sur l'icône **curseurs** de la case Plans patrimoine — les
deux partagent le même volet repliable, pour ne pas encombrer le menu par
défaut.

Familles actuelles :
- **Numéros interstation** : repères numérotés le long des tronçons entre
  stations — étiquette soulignée à taille réelle, reliée au centre de son
  tronçon par une ligne de repère (voir plus bas).
- **Plans d'ensemble (1/500e)** : voir ci-dessous.

La couche **« Noms de station »** importée d'INFRAVIEW (206 textes, sans lien
fiable avec les emprises) a été **retirée**. Les noms et références de station
seront saisis dans le **référentiel** (`data/metro/polygones.json`, liste
`noms` de chaque station : entrées `{fr, nl, reference}`) et affichés dans
l'infobulle de l'emprise de station (section 4).

Les **plans d'ensemble au 1/500e** (36 planches) sont des polygones de genre
`planche` de `data/shapefile/polygones.shp` ; leur étiquette est le `sheet_ref`
du référentiel (géométrie et popups gérés par `src/metroLayer.js`, voir section
4bis). Ils restent une entrée de ce sélecteur (`data/plans-patrimoine/catalogue.js`,
`external: true`) : la case à cocher affiche/masque la couche déjà construite par
`metroLayer.js` (voir `src/patrimoineLayer.js#registerExternalLayer`), sans
proposer de couleur (couleur/opacité réglées avec le réseau métro, curseur
« Métro »). Le clic dans une zone où plusieurs planches se chevauchent (42 paires
dans ce jeu de données) liste toujours **toutes** celles concernées à cet endroit
précis, pas seulement celle au-dessus visuellement (`_sheetRefsAt`). La même case
affiche aussi les **repères de tronçon** (triangles et codes D0, D1, G1a... relevés
dans INFRAVIEW.pdf) et les références de planche — voir section 4bis.
Les repères de tronçon sont **legacy** : `data/plans-patrimoine/reperes-troncons.legacy.json`
(106 triangles, 80 codes), sans identifiant, à rattacher à `lignes.shp` quand il
existera.

**Numéros interstation** (`src/interstation.js`) : chaque numéro est
rattaché à un **tronçon** (polygone de genre `tunnel` de `polygones.shp`) — par défaut le
tunnel dont le contour est le plus proche (rattachement automatique, en
Lambert), ou celui choisi par un administrateur (voir plus bas). L'étiquette
est un texte à **taille réelle constante** (comme les références de
planche, `scaledText.js`), **souligné par le même tracé que la ligne de
repère** : un seul trait qui part du **centre du tronçon**, rejoint
le **bord bas du texte**, puis longe ce bord (recalculé à chaque zoom). **Contrainte
d'angle** : le segment issu du centre du tronçon fait **au plus 45° avec la verticale**
(vers le haut ou vers le bas). Il rejoint le point du soulignement le plus proche
qui respecte cet angle ; si le texte est trop à côté pour que le soulignement croise
ce cône, le segment part à exactement 45° jusqu'à la droite du soulignement, qu'il
longe ensuite (`_leaderPath`, `src/scaledText.js`). Seul cas où la contrainte ne tient
pas : texte exactement à la hauteur du centre du tronçon (tracé direct). Son **épaisseur suit la taille du texte** (4 %
du corps, de 0,5 à 4 px) : plus fin quand on dézoome. Texte et trait appartiennent au
même groupe : la case « Numéros interstation » les affiche/masque
ensemble, et le curseur d'opacité de Plans patrimoine s'applique aux deux.
**Pas d'infobulle** sur l'étiquette ni sur la ligne ; le numéro (« N°
interstation ») apparaît dans l'**infobulle de l'emprise du tronçon**
(couche Tunnels), que la couche soit affichée ou non.

**Axe et centre du tronçon.** Le centre du tronçon est le milieu, mesuré
le long de l'**axe du tunnel** : une ligne de construction tracée entre les
deux côtés longs de son polygone. L'axe passe **toujours par le milieu des
segments communs** entre l'emprise du tunnel et celles des stations
(repérés automatiquement : côtés quasi colinéaires, écart < 1 m, qui se
recouvrent sur plus de 1 m ; 64 tunnels en ont deux, 23 un seul) — voir
l'en-tête de `src/interstation.js` pour la construction.

**Déplacer une étiquette de tronçon** : **mode édition commun** aux références
de planche et aux numéros d'interstation (⚙ Paramètres > Données, bouton
« ✥ Mode édition » ; plugin `src/peLabelEditor/`, voir son README). Au
survol l'étiquette s'illumine ; un premier clic la **sélectionne**, un second
lance la modification : 1) on la **déplace parallèlement au trajet du
pointeur** (appui n'importe où sur la carte, souris ou doigt, puis
glissement) ; 2) on **identifie le tronçon** auquel elle se raccroche : le
survol d'un tunnel allume son axe, un clic (ou un appui) le choisit. L'étape
en cours s'affiche en haut à gauche, sous le menu carte (Retour, Suivant,
Annuler, Terminer) ; le suivi et l'enregistrement sont dans le panneau du bouton
« ✥ Mode édition » (masqué par défaut). Position (Lambert 72) et tronçon
(identifiant `id` du référentiel, voir section 4) sont enregistrés dans
`data/plans-patrimoine/etiquettes-troncons.json` (clé `numéro#rang`), via la route
`/shared/plans-patrimoine/etiquettes-troncons` du relais (à redéployer une fois, voir
`relay/README.md`), et remplacent le rattachement automatique pour cette étiquette. Limites du
rattachement automatique : 3 numéros sur 86 à moins de 15 m d'écart entre
les deux premiers tunnels, 4 à plus de 140 m de tout tunnel (243, 243-3,
900, 1000), et 7 tunnels sans numéro — c'est ce que le choix manuel permet
de corriger.

**Numéros interstation** est une famille d'**étiquettes de
texte** (le contenu du champ `text` ou `numero`, affiché tel quel, pas un
simple point coloré) — voir `src/patrimoineLayer.js`. La géométrie "point"
du catalogue UrbIS Topo, par comparaison, n'affiche qu'une pastille
colorée : ici le texte réel du plan est ce qui compte. Aucun filtrage par
zoom/emprise n'est nécessaire (les volumes sont très modestes, quelques
centaines d'objets au plus par plan). **Plans d'ensemble (1/500e)** est la
seule entrée `external` du catalogue (pas de fichier, pas d'étiquette de
texte) : voir plus haut.

Liste volontairement ouverte : d'autres plans (constats, relevés...)
pourront s'y ajouter au fur et à mesure, un fichier et une entrée de
catalogue à la fois.

## 4. Architecture des données

L'application appelle plusieurs **services de fonds de plan** (UrbIS, orthophotos...)
et y superpose des informations qui se répartissent en **couches** et **points
métier**. Le dossier `data/` suit cette répartition (une couche ou un domaine par
dossier) :

```
data/
  shapefile/          géométries pérennes, éditables dans AutoCAD (2 shapefiles) + identifiants.json
  metro/              référentiel de la couche Métro : stations, tunnels (et tronçons, plus tard)
  plans-patrimoine/   référentiel des planches, étiquettes, sélection par défaut, fichiers legacy
  urbis-topo/         réglages du service UrbIS Topo + sélection par défaut partagée
  fonds-de-plan/      services externes : services.json (général) + un fichier par service
  points-metier/      (réservé : structure des points métier, phase B)
  suivi/              suivi (fiches, constats...) : HORS DÉPÔT (.gitignore), phase B
```

### Les trois familles de données

1. **Géométries pérennes** — `data/shapefile/` : shapefiles Lambert 72 (EPSG:31370),
   éditables dans AutoCAD, **strictement limités à deux fichiers** : `polygones.*` et
   `lignes.*` (`.shp`, `.shx`, `.dbf`, `.prj`, `.cpg`). On n'y met que des informations
   **pérennes, transverses, dont le partage présente un intérêt** (emprises des stations,
   des tunnels et des planches, dont le géoréférencement reste à corriger). Chaque
   entité ne porte qu'**un champ : `id`**. Aucun nom, type, niveau ni autre attribut.
   `lignes.*` peut rester absent tant qu'aucun tronçon n'est dessiné (l'application
   le tolère).
2. **Cadastre / référentiel** — JSON rattaché aux géométries par `id`, **rangé dans le
   dossier de la couche concernée** : `data/metro/polygones.json` (stations et tunnels),
   `data/metro/lignes.json` (tronçons : vide pour l'instant),
   `data/plans-patrimoine/polygones.json` (planches), chacun avec son
   `vocabulaires.json` (genres : libellé, géométrie, couleur d'affichage). Il porte tout ce
   qui complète une géométrie : genre (`station`, `tunnel`, `planche`), noms FR/NL **sans
   préfixe** (« Montgomery », « Horta - Albert » : le genre dit déjà s'il s'agit d'une
   station ou d'un tunnel), liste de noms et références d'une station (`noms`),
   `sheet_ref` d'une planche, identifiants externes (`ids_externes` : ancien `ogc_fid`,
   ancien `id_objet`), plus tard niveau, année de construction, liens vers des plans...
   En-tête de chaque JSON : `version`, `date`, `crs: "EPSG:31370"`. Le **niveau** n'est
   pas renseigné : les valeurs de l'ancien `Metro.dbf` (« - » ×142, « 0 » ×14) n'étaient
   pas crédibles et n'ont pas été reprises. Un même `id` ne figure que dans **un seul**
   dossier. L'application et `tools/verifier-donnees.py` fusionnent ces référentiels
   avant de les joindre aux deux shapefiles.
3. **Données métier (suivi : fiches, constats...)** — **hors de ce dépôt**
   (dossier `data/suivi/`, listé dans `.gitignore` : le dépôt est public, ces données
   n'y entrent jamais). Phase B, pas encore réalisée : la couche « Points métier »
   (`localStorage`, section 6) fonctionne comme avant ; `data/points-metier/` est
   réservé à leur structure (champs, listes de types) quand elle sera définie.

**Règle de l'identifiant.** Chaîne opaque sans signification métier : « G » + 6
chiffres (ex. `G000123`), attribuée une fois, **jamais réutilisée**, **unique sur
les deux fichiers à la fois**. Le prochain à attribuer est `prochain_id`, **compteur
unique** des deux fichiers, dans `data/shapefile/identifiants.json` (avec la règle). Un
code de station ou un numéro de tronçon est un **attribut du référentiel**, jamais un
identifiant. Les anciens identifiants (`ogc_fid`, `id_objet` comme
`TRO-HORTA-ALBERT-01`) sont conservés dans `ids_externes`.

### Contenu de chaque dossier

- `data/plans-patrimoine/` :
  - `polygones.json`, `vocabulaires.json` : référentiel des planches ;
  - `etiquettes-planches.json` (ancrage des références de planche, clé
    « sheet_ref#rang ») et `etiquettes-troncons.json` (position du texte et tronçon de
    rattachement des numéros d'interstation, clé « numéro#rang », tronçon désigné par son
    `id`), écrits par l'application via le relais (section 6), en Lambert 72. Ce sont les
    listes **complètes** des étiquettes (source unique) : créer ou supprimer une étiquette
    = ajouter ou retirer une entrée (mode édition : « ✚ Ajouter un élément », 🗑). L'axe
    du tunnel, le soulignement et la ligne de repère ne sont pas stockés : ils se
    recalculent à l'affichage ;
  - `catalogue.js` : catalogue des couches proposées (code de configuration, chargé par
    `index.html`) ;
  - `selection-par-defaut.json` : sélection par défaut partagée des couches (section 3ter) ;
  - `*.legacy.json` : fichiers conservés en attendant `lignes.shp`, **sans identifiant** —
    `numeros-interstation.legacy.json` (86 points texte, archive d'amorçage, plus lu par
    l'application) et `reperes-troncons.legacy.json` (triangles et codes de transition entre
    tronçons, encore affichés avec les planches). **Aucune géométrie de tronçon n'existe
    encore** : à rattacher à `lignes.shp` plus tard ;
- `data/urbis-topo/` : `catalogue.js` (catalogue des types d'objets : du code de configuration,
  chargé par `home.html`, interface carto), `parametres.json` (réglages du service WFS) et
  `selection-par-defaut.json` (sélection par défaut partagée, section 3) ;
- `data/fonds-de-plan/` : configuration des services externes (section 3bis) ;
- `tools/` : `migrer-donnees.py` (migration unique, déjà exécutée),
  `verifier-donnees.py` (contrôle, voir plus bas), `rapport-migration.md`.

**Contenu actuel de `polygones.shp`** (192 entités, `G000001` à `G000192`) :
69 stations, 87 tunnels, 36 planches au 1/500. Voir `tools/rapport-migration.md`
pour les anomalies et ce qui n'a pas pu être migré (notamment : aucun nom de
station rattaché, la source ayant été retirée).

**Contrôles.** `python3 tools/verifier-donnees.py` (bibliothèque standard seule,
code de sortie non nul en cas d'erreur) vérifie : identifiants uniques sur les deux
fichiers, aucune géométrie sans entrée de référentiel, aucune entrée sans géométrie,
aucun `id` décrit dans deux dossiers, présence de `.prj` et `.shx`, format des `id`,
`prochain_id` (unique, dans `data/shapefile/identifiants.json`) supérieur à tout `id`
utilisé, nom des stations/tunnels, `sheet_ref` présent et unique pour les planches,
caractères de contrôle (encodage mal lu), enregistrements marqués supprimés dans le
`.dbf`, références des étiquettes de `data/plans-patrimoine/` (tronçon = `id` de genre
`tunnel`, planche existante) et configuration des services (JSON valides, URL en https).
Les mêmes règles sont appliquées **sans bloquer** au démarrage de l'application
(avertissements en console, `src/referentiel.js`).

**Si d'anciens identifiants réapparaissent.** Tant qu'une ancienne version de
l'application écrit via le relais, `etiquettes-troncons.json` peut recevoir les anciens
identifiants de tunnel (`id_objet`, ex. `TRO-HORTA-ALBERT-01`) :
`python3 tools/verifier-donnees.py --corriger` les remplace par le nouvel `id` grâce à
`ids_externes.id_objet` du référentiel. Une fois le fichier stabilisé, `id_objet`
n'a plus d'usage et pourra être retiré de `ids_externes`.

## 4bis. Shapefiles : workflow AutoCAD

Format délibérément choisi pour être exploitable à la fois par **AutoCAD Civil 3D**
(édite et exporte le shapefile nativement, Map 3D intégré, sans plugin ni droits
admin) et par cette application. Lecture entièrement côté navigateur
(`src/shpLoader.js`, aucune bibliothèque tierce) : polygones (type 5) et polylignes
(type 3, multi-parties) ; seul le champ `id` du `.dbf` est lu. Aucune reprojection
à la lecture : les coordonnées Lambert 72 sont conservées, `AMGT4CEM_CRS.lambertToLatLng`
(`crs.js`) convertit à l'affichage.

Workflow de mise à jour :
1. **Modifier le dessin** dans AutoCAD (à partir du shapefile existant).
2. **Exporter le shapefile** avec le **seul champ `id`**, même CRS (EPSG:31370),
   en gardant `.shp`, `.shx`, `.dbf`, `.prj`. Une entité **nouvelle** reçoit un
   `id` neuf pris à `prochain_id` (puis `prochain_id` est incrémenté dans
   `data/shapefile/identifiants.json`) ;
   copier ou scinder une entité duplique son `id` : à corriger avant d'exporter.
3. **Compléter le référentiel** : une entrée par `id` (genre, noms...) dans le
   `polygones.json` (ou `lignes.json`) du dossier de la couche : `data/metro/` pour
   une station ou un tunnel, `data/plans-patrimoine/` pour une planche.
4. **Lancer `python3 tools/verifier-donnees.py`** : corriger jusqu'à « OK ».
5. **Committer** (`data/shapefile/`, `data/metro/`, `data/plans-patrimoine/`). Le suivi (famille 3)
   n'est jamais committé.

Origine historique : les polygones viennent de l'export WFS MobiGIS
(`bm_public_transport:Metro`, `Metro.shp`) retravaillé dans Civil 3D, plus les
planches INFRAVIEW ; ils ont été migrés une fois pour toutes dans la nouvelle
structure (`tools/migrer-donnees.py`). `Metro_export_SHP/` et `Metro.json` ont été
supprimés du dépôt ; ils restent récupérables via le tag de sauvegarde (section
« Retour arrière »).

### Éléments d'INFRAVIEW.pdf : calage sur le réseau

*Les noms de fichiers cités dans cette section (`Metro.shp`, `MetroInfo.shp`,
`MetroLabels.shp`, `Metro.json`) sont ceux d'**avant la refonte des données** :
ils décrivent l'historique du calage et sont récupérables via le tag de sauvegarde.
Équivalents actuels : planches = genre `planche` de `polygones.shp` ; triangles et
codes = `data/plans-patrimoine/reperes-troncons.legacy.json` ; références de planche =
`data/plans-patrimoine/etiquettes-planches.json`.*

Tout ce qui vient d'INFRAVIEW.pdf (STIB, plan "Station & Interstation
Infrastructure", `DITP`, juillet 2025) est placé **par rapport au réseau
métro tel qu'il est dessiné dans ce PDF**, pas d'après un calage de
coordonnées pris isolément :

- emprises des planches (genre `planche` de `polygones.shp`) ;
- triangles de transition de tronçon et leurs codes (`data/plans-patrimoine/reperes-troncons.legacy.json`) ;
- références de planche (`data/plans-patrimoine/etiquettes-planches.json`) ;
- numéros d'interstation (`data/plans-patrimoine/numeros-interstation.legacy.json`, archive) ;
  (les noms de station ont été retirés).

**Méthode.** Le réseau du PDF (stations en rouge, tunnels en bleu — 4 934
formes rouges, 92 anneaux bleus) est recalé sur les polygones `MS`/`MT` de
`Metro.shp`, qui font référence pour le réseau : recherche, par fenêtres de
192 m le long du réseau, du décalage qui superpose le mieux les deux dessins
(corrélation de masques, ~830 fenêtres), puis ajustement robuste d'une
transformation sur ces décalages. Résultat : une **similitude pure** —
échelle uniforme **5,28225 m par point PDF**, aucune rotation
(−0,001°), + translation `(141597,22 ; 164265,49)` — et un décalage
résiduel médian du réseau de **~0,5 m** (98 % de la surface des polygones
MS/MT recouverte par le réseau du PDF, contre 48 % avec l'ancien calage).
Un ajustement plus libre (affine, puis polynômes jusqu'au degré 5) ne
fait pas mieux : le PDF n'a ni cisaillement ni déformation locale par
rapport à `Metro.shp`.

**Pourquoi l'ancien calage était faux.** Il avait été ajusté sur 43
centroïdes de stations (résidu 13–25 m), avec une échelle anisotrope de
0,2 % qui s'accumule : jusqu'à ~150 m aux extrémités du réseau. Les
fichiers de planches, de noms de station et de numéros d'interstation
fournis étaient eux aussi dans un repère déformé (échelle ≈ 1,020 × 0,995,
léger cisaillement) : ils contiennent exactement les textes et contours du
PDF (206 textes rouges, 86 numéros bleus, 36 contours orange), à une
transformation affine près — une seule, la même pour les trois, qui les
ramène à 0,00 m des centres de texte / contours du PDF recalé. Ils sont
donc **repositionnés**, pas réinterprétés : mêmes textes, mêmes attributs,
seules les coordonnées changent.

- `Metro_export_SHP/Metro.shp` : les 36 polygones `PE` sont remplacés par
  les contours de planche du PDF (36 anneaux de 4 à 10 sommets, appariés un
  à un aux anciens polygones par recouvrement). Les 156 enregistrements
  MS/MT et tous les attributs sont **inchangés octet pour octet** ; seuls
  les enregistrements PE, l'en-tête (boîte englobante) et `Metro.shx` sont
  réécrits. `Metro.json` et `data/patrimoine-plans-ensemble-500e.json`
  (copies historiques) reçoivent les mêmes géométries.
  Une erreur d'attribut a aussi été corrigée au passage : la planche qui
  couvre Gare Centrale (`ogc_fid` 181) portait `sheet_ref = "3000-126"`
  (doublon) alors que le PDF la numérote **`4000-202`**.
- `Metro_export_SHP/MetroInfo.shp` (Polygon, 106 entités `type = "PE_info"`)
  : les **triangles** de transition entre tronçons de construction (ex.
  `D0`, `D1`, `G1a`...) — chaque petit triangle gris du plan y marque la
  frontière entre deux tronçons identifiés par un code (attribut `code`).
  Coordonnées vectorielles extraites directement du PDF, orientation
  fidèle à chacune.
- `Metro_export_SHP/MetroLabels.shp` (Point, 117 entités) : les points
  d'ancrage du **texte** correspondant, affiché en HTML (pas en polygone —
  voir plus bas) :
  - `type = "PE_info"` (80, un par code **unique** — un code peut être
    partagé par deux triangles) : centre du texte dans le PDF.
  - `type = "PE_label"` (37 : une par planche, sauf `3000-126` qui porte
    deux étiquettes dans le PDF) : les 37 textes orange du PDF, chacun
    rattaché à la planche de même `sheet_ref` et tombant dans son propre
    contour, sans correction. Attributs `angle` (rotation CSS, degrés,
    horaire, celle du texte du PDF) et `side` (voir ci-dessous).

**Ancrage des références de planche (`side`).** Le point d'une référence
n'est pas le centre du texte mais le **milieu du bord de la boîte de texte
le plus proche du cadre de la planche** (`top`, `bottom`, `left` ou
`right` — 30 / 6 / 0 / 1 sur les 37), la rotation se faisant autour de ce
point. Position inchangée par rapport au PDF à la taille d'origine ; mais
quand la taille du texte change avec le zoom (ou est bornée, `minPx`/`maxPx`
de `src/scaledText.js`), le texte pousse **à partir de ce bord** et reste
collé à son cadre au lieu de déborder de part et d'autre d'un centre fixe.
Le plugin d'édition (`src/peLabelEditor/`, voir son README) permet
à un administrateur de redéfinir cet ancrage étiquette par étiquette : clic
dans le texte → bulle d'info avec l'icône « déplacer » → choix d'un point
de référence parmi les 8 de la boîte de texte, d'un point d'ancrage parmi
les points remarquables du cadre, puis d'un second point de référence et
d'un autre point du cadre dont l'alignement avec les deux premiers fixe
l'orientation (rotation minimale). Points remarquables, dans cet ordre :
sommets du polygone, centres des côtés (pastilles carrées foncées),
intersections entre planches (pastille ronde barrée d'un X), centres des
segments que délimitent les sommets ET les intersections (petite pastille
ronde claire) ; un point n'est ajouté que si aucun autre n'est à moins de
5 m. La définition (`{ r1, a1, r2, a2 }`) est calculée à l'affichage par
`AMGT4CEM_ScaledText` (taille de boîte mesurée dans le navigateur) et
**enregistrée dans l'application** : `data/plans-patrimoine/etiquettes-planches.json`, lu pour
tous les visiteurs (voir section 6 et `relay/README.md`).

**Numéros d'interstation** (couche "Plans patrimoine") :
leurs points sont les **centres** des textes du PDF ; le texte est donc
maintenant centré sur son point (`iconSize: [0, 0]` + `translate(-50%, -50%)`),
alors qu'il partait auparavant du coin haut-gauche, décalé de ~6 px.

**Rendu du texte — texte HTML à taille réelle, pas des polygones.** Un
premier essai avait tracé ce texte en vrais polygones (contours de
caractères extraits par traitement d'image, seuillage colorimétrique +
`cv2.findContours` avec hiérarchie pour les trous de chaque caractère —
"D0" a un trou dans le "D" et un dans le "0") — fidèle à la position du
PDF, mais jugé après coup moins lisible qu'un texte HTML classique (pas de
hinting/anti-aliasing natif du navigateur). Remplacé par du texte HTML
normal dont le `font-size` est recalculé à chaque changement de zoom
(`src/scaledText.js`) pour correspondre à une hauteur RÉELLE constante
(~42 m, dérivée de la taille de police d'origine dans le PDF — ~8pt — une
fois passée par l'échelle du calage, ~5,28 m/pt) : le texte
grossit/rétrécit avec le zoom exactement comme sur INFRAVIEW.pdf, pas à
taille d'écran fixe. Couleurs reprises telles quelles du PDF (RGB exact
des objets texte, pas une approximation) : gris pour les codes de
tronçon, orange pour les références de planche — même teinte que les
repères "4000-138"... visibles sur le plan lui-même. La rotation
(`PE_label` uniquement — les codes de tronçon `PE_info` restent
horizontaux) est appliquée en CSS (`transform: rotate(...)`, fixe, pas
recalculée au zoom contrairement au `font-size`) directement sur le
`<span>` avec `translate()` d'abord (selon `side`, voir plus haut) pour
que la rotation tourne autour du point d'ancrage — milieu du bord de
référence, ou centre du texte pour les codes de tronçon — et non du coin
du marqueur. Les deux
sont non interactifs (`interactive: false` + CSS `pointer-events: none`, les deux
nécessaires : un `<span>` visible sans cette règle CSS intercepterait
physiquement le clic au niveau du navigateur, quoi que l'option Leaflet
décide de son côté) : un clic doit atteindre la forme en dessous
(triangle pour PE_info, planche pour PE_label — cette dernière gère déjà
elle-même le cas de plusieurs planches superposées, voir plus haut), pas
s'arrêter sur le texte.

Position des triangles et des codes : chaque entité garde la position
**brute** donnée par le calage ci-dessus, **sans recalage individuel** sur
le tunnel (MT) le plus proche (essayé, puis abandonné) : une transformation
globale préserve par construction les distances/l'absence de chevauchement
du plan source, alors qu'un recalage propre à chaque repère est une
translation différente pour chacun — deux repères proches peuvent alors
dériver l'un vers l'autre et se chevaucher (confirmé en pratique : 25
paires en chevauchement avec un recalage individuel, 0 sans). Les
triangles du plan sont d'ailleurs dessinés à côté du tunnel, pas dessus
(médiane ~23 m du polygone MT le plus proche), et le texte n'est pas
toujours collé à son triangle non plus : cet écart est celui du plan
source, reproduit tel quel plutôt que forcé à zéro.

Limites connues, volontairement documentées plutôt que masquées :
- 117 triangles détectés au total dans le PDF ; 11 exclus faute
  d'association fiable à un code voisin (distance triangle → code trop
  grande, cas ambigus) — 106 entités triangle dans `MetroInfo.shp`.
- L'association triangle → code retenue est la **plus proche** au sens
  géométrique, pas une lecture garantie de la topologie exacte du schéma.
- Précision de position : celle du calage sur le réseau (~0,5 m médian)
  plus celle du plan source (dessin au 1/500e redessiné : quelques mètres)
  — suffisant pour repérer un tronçon sur la carte, pas pour un relevé
  topographique.

Affichage et z-order : contrairement aux planches PE (larges zones qui
doivent rester SOUS les stations/tunnels pour ne pas intercepter leur
clic), les triangles PE_info sont délibérément plaqués SUR un tunnel — ils
doivent donc rester AU-DESSUS de MS/MT, sinon invisibles au clic. Marqués
via `polygon._amgtBringToFront` (metroLayer.js), traité par
`src/patrimoineLayer.js#registerExternalLayer` en deux passes (tous les
`bringToBack` d'abord, puis tous les `bringToFront`), pour finir au-dessus
de tout même si la couche est activée après coup. Les textes (L.marker,
non interactifs) n'ont pas ce problème : ils ne peuvent jamais intercepter
de clic, quel que soit leur rang d'empilement. PE_info et PE_label sont
liés à **PE** dans le sélecteur "Plans patrimoine" (même case à cocher
"Plans d'ensemble (1/500e)" — voir section 3bis) : aucun n'a d'existence
indépendante côté affichage, ils complètent l'information des planches et
du réseau.

## 5. Architecture

```
home.html, style.css         page unique : gabarits des deux interfaces (carto, signal) ; index.html : simple renvoi vers home.html
src/router.js                routeur : lit ?app=, copie le gabarit choisi, charge ses scripts dans l'ordre (liste `apps` de config.js)
src/signal/                  interface de saisie SIG4CEM (home.html?app=signal), séparée de la carte, avec sa propre carte de choix du point
config.js                    configuration (interfaces `apps`, CRS, chemins des données, clés de stockage) ; la configuration des services est dans data/fonds-de-plan/
src/admin.js                 accès administrateur (point de branchement du futur mot de passe)
src/services.js              configuration des services externes (data/fonds-de-plan/, data/urbis-topo/parametres.json) : lecture au démarrage, enregistrement via le relais
src/peLabelEditor/          mode édition des étiquettes (planches, interstations), chargé à la demande
src/selectionStore.js        sélection des couches/objets : courante, préférences locales, défaut partagé
src/pickerDefaultBar.js      barre « sélection par défaut » (administrateur) des sélecteurs
src/settingsPanel.js         fenêtre "⚙ Paramètres" à onglets (Sources / Serveur / Données)
src/layerOpacityStore.js     opacité individuelle des couches (icône curseurs, persistée)
src/crs.js                   proj4 EPSG:31370 <-> WGS84 (affichage uniquement)
src/shpLoader.js             lecture Shapefile (polygones type 5, polylignes type 3, champ `id` seul), côté navigateur, sans bibliothèque tierce
src/referentiel.js           chargement des géométries + référentiel JSON, jointure par `id`, contrôles non bloquants
src/network.js               construction partagée du réseau (stations/tunnels/planches) pour carto et signal
src/scaledText.js            texte HTML à taille réelle constante (zoom), pour les codes de tronçon et les références de planche
src/metroLayer.js            construction des couches Leaflet Stations/Tunnels/Planches (+ repères legacy)
data/shapefile/              famille 1 : polygones.* et lignes.* (shapefiles Lambert 72, champ `id` seul) + identifiants.json — voir section 4
data/metro/                  famille 2 : référentiel stations/tunnels/tronçons (polygones.json, lignes.json, vocabulaires.json)
data/plans-patrimoine/       référentiel des planches, étiquettes (écrites via le relais), sélection par défaut, fichiers legacy
data/urbis-topo/             réglages du service UrbIS Topo, sélection par défaut partagée
data/fonds-de-plan/          services externes : services.json + un fichier par service
data/points-metier/          (réservé : structure des points métier, phase B)
data/signalements/           vocabulaire.json : natures, types, domaines techniques, flux (public)
data/suivi/                  famille 3 (suivi) : HORS DÉPÔT (.gitignore), phase B
depot-signalements/          serveur de dépôt des signalements (Cloudflare Worker + R2) : référence AAAA-NNNN ; distinct de relay/
tools/                       migrer-donnees.py (unique), verifier-donnees.py (après chaque export AutoCAD), rapport-migration.md
src/basemap.js                fonds de plan (UrbIS, Orthophoto, Bruciel)
data/urbis-topo/catalogue.js       catalogue complet des types d'objets UrbIS Topo (référence)
src/urbisTopoSelectionStore.js sélection utilisateur des types UrbIS Topo affichés
src/urbisTopoPicker.js        sélecteur plein écran (catalogue classé par thème)
src/urbisTopoLayer.js        affichage carte des types UrbIS Topo sélectionnés
data/plans-patrimoine/catalogue.js catalogue des couches "Plans patrimoine" (référence)
src/patrimoineSelectionStore.js sélection utilisateur des couches Plans patrimoine affichées
src/patrimoinePicker.js      sélecteur plein écran "Plans patrimoine"
src/patrimoineLayer.js       affichage carte des couches Plans patrimoine sélectionnées
src/mapMenu.js                menu fond de plan / couches / réinitialisation
src/searchTool.js             recherche station/tunnel/point (remplace le zoom +/-)
src/pointsStore.js           micro-base de données (localStorage, schéma ouvert)
src/plugins.js               chargeur de plugins (applications séparées branchées sur la carte)
src/addPointMenu.js          menu du bouton « ✚ Ajouter un point » : Point métier + entrées ajoutées par les plugins
src/signalements/            plugin « Signalements » (voir son README.md)
src/pointsLayer.js           affichage/déplacement des points métier
src/addPointTool.js          workflow "Ajouter un point"
src/measureTool.js           outil "📏 Mesurer" (segment + cote + cercle, 4s puis disparition)
src/screenshotTool.js        capture PNG auto au 2e relâchement (mémoire uniquement) + enregistrement ("💾")
src/scaleControl.js          réglette graduée (bas gauche), alterne au clic avec les coordonnées Lambert
src/buildInfo.js             horodatage de la dernière mise à jour (à mettre à jour à chaque commit)
src/creditsLayout.js         bas de carte : crédits pleine largeur + échelle au-dessus en cas de chevauchement
src/buildInfoControl.js      affiche "BUILD ..." en bas à droite, au-dessus de l'attribution
src/app.js                   assemblage de l'application
vendor/leaflet, vendor/proj4,
vendor/proj4leaflet,
vendor/html2canvas           bibliothèques embarquées localement
```

Les géométries et les référentiels (`data/shapefile/`, `data/metro/`, `data/plans-patrimoine/`) et la
micro-base de points métier (`pointsStore.js`) sont deux sources totalement
indépendantes : les premiers ne sont modifiés que par un export AutoCAD (jamais par
l'application elle-même) ; la seconde peut être remplacée plus tard par un vrai
backend sans toucher à la cartographie.

## 6. Micro-base de données

**Stockage actuel : `localStorage` du navigateur** (clé
`amgt4cem.points.v1`), comme en toute première V1 — propre à chaque
appareil, rien n'est partagé entre appareils, rien n'est envoyé à un
serveur. Voir `src/pointsStore.js`.

### Tentative abandonnée : GitHub comme base partagée

Une piste a été essayée pour partager les points entre appareils sans
backend dédié : les stocker dans un fichier JSON de ce dépôt, lu/écrit via
l'API Contents de GitHub. **Ça ne fonctionne pas, et ce n'est pas
réparable côté client** : dès qu'une requête vers cette API porte un
en-tête `Authorization` (obligatoire pour écrire) ou
`Content-Type: application/json` (nécessaire pour envoyer le nouveau
contenu), le navigateur déclenche une vérification préalable CORS
(« preflight ») que l'API Contents de GitHub ne gère pas — la requête est
bloquée avant même de partir. Vérifié en conditions réelles avec un jeton
volontairement invalide : le blocage est identique, ce qui prouve qu'il ne
dépend pas de la validité du jeton. La lecture simple (sans jeton) fonctionne
bien en revanche (pas de préflight nécessaire), mais ne sert à rien sans
écriture possible.

Pour repartir sur un vrai stockage partagé, deux pistes sérieuses :

- **Petit relais serveur** (ex. Cloudflare Workers, gratuit) : le relais
  appelle l'API GitHub lui-même (les appels serveur-à-serveur ne sont pas
  soumis au CORS des navigateurs), et expose à l'application ses propres
  endpoints simples. Garde `data/points.json` dans ce dépôt comme stockage
  final. Un compte gratuit à créer.
- **Service pensé pour être appelé directement depuis une app web** (ex.
  Supabase, base Postgres gratuite) : pas de mur CORS, pas de jeton
  unique à risque (sécurité par ligne via des règles d'accès). Remplace
  `data/points.json` par une vraie base, avec une interface de gestion des
  données comparable à phpMyAdmin. Un compte gratuit à créer.

**Attention.** Ces pistes ont été étudiées avant la distinction des trois familles de
données (section 4). La première (relais + fichier dans le dépôt) ne convient qu'à des
données publiques et partageables (étiquettes, réglages, sélections par défaut), pas aux
points métier ni au suivi.

Le choix n'a pas encore été fait pour les points métier — voir la
conversation de développement.

### Premier usage du relais : définitions d'ancrage des références de planche

La première donnée qui doit être **partagée** (et non propre à un
navigateur) est la position/orientation des références de planche
(`PE_label`), modifiées par un administrateur. Elle utilise la première
piste ci-dessus (petit relais serveur) :

- le fichier `data/plans-patrimoine/etiquettes-planches.json` (dans le dépôt) est lu par
  l'application pour tous les visiteurs (`src/peLabelAnchors.js`, appliqué
  par `src/metroLayer.js` / `src/scaledText.js`) ; absent ou vide, aucune
  référence de planche n'est affichée ;
- le plugin `src/peLabelEditor/` (administrateurs) l'enregistre via le
  relais `relay/` (Cloudflare Worker, à déployer une fois : `relay/README.md`),
  qui commit le fichier dans le dépôt ; GitHub Pages le redéploie ;
- tant qu'aucune adresse de relais n'est connue (clé `relais` de
  `data/fonds-de-plan/services.json`), l'enregistrement est refusé avec un message
  explicite.

Le même relais enregistre les **paramètres des services** (fenêtre ⚙ Paramètres : routes
`shared/fonds-de-plan/services` et `shared/fonds-de-plan/urbis`) et les **sélections par
défaut partagées** (routes `shared/urbis-topo/selection-par-defaut` et
`shared/plans-patrimoine/selection-par-defaut`) : tout passe par la route générique
`shared/<dossier>/<fichier>`, sans modification ni redéploiement du relais. La toute
première fois, l'adresse du relais se saisit dans ⚙ Paramètres > Serveur avec le code
administrateur ; elle est écrite dans `services.json`, d'où tous les visiteurs la lisent
ensuite.

Les points métier (`pointsStore.js`) restent en `localStorage`. **Le relais ne doit pas
être étendu à ces données** : il écrit dans le dépôt, qui est public, et les points
métier relèvent du suivi (famille 3, section 4), qui n'entre jamais dans le dépôt. Un
stockage partagé du suivi suppose une autre destination (par exemple le SharePoint de
l'équipe) : le choix n'est pas fait.

### Plugins et signalements

Des applications **séparées** se branchent sur la carte sous forme de **plugins** : chacune vit dans son
dossier (`src/<plugin>/`, avec son README, ses styles et ses scripts), est déclarée dans la liste `plugins`
de `config.js` et chargée par `src/plugins.js`. Le cœur ne connaît aucun plugin par son nom ; un plugin
désactivé (`enabled: false`), absent ou en erreur ne gêne pas le reste. Le plugin d'édition des étiquettes
(`src/peLabelEditor/`) se charge à la demande depuis ⚙ Paramètres ; le plugin **Signalements** se charge au
démarrage.

**Signalements** (`src/signalements/`, voir son README) : saisie des signalements et demandes avec
domaine technique, photos, demandeur et référence chez le demandeur ; flux **amiante** séparé (stockage,
couche, marqueurs et dépôt distincts) ; enregistrés d'abord sur l'appareil, puis **envoyés au serveur de dépôt**
(`depot-signalements/`, Cloudflare Worker + R2) qui leur attribue la référence `AAAA-NNNN` ; export d'un dépôt ZIP
à la main possible. Ils n'utilisent pas le
stockage des points métier du cœur (`amgt4cem.signalements.v1`, `amgt4cem.signalements.amiante.v1`) et ne
doivent jamais passer par le relais d'enregistrement (dépôt public).

### Exporter les points métier à la main (avant tout déploiement)

Ils sont dans le `localStorage` de chaque navigateur, donc **hors dépôt** et hors
de toute sauvegarde Git. L'application n'a **pas** de fonction d'export. Dans la
console du navigateur (F12) de l'appareil concerné, sur la page de l'application :

```js
copy(localStorage.getItem('amgt4cem.points.v1'))   // copie le JSON dans le presse-papier : le coller dans un fichier .json
```

Pour restaurer : `localStorage.setItem('amgt4cem.points.v1', '<le JSON>')`, puis recharger.
Les signalements du plugin ont leurs propres clés (`amgt4cem.signalements.v1` et `amgt4cem.signalements.amiante.v1`) ; leurs photos (IndexedDB) ne se récupèrent que par le bouton « Exporter le dépôt » de chaque signalement.
La refonte des données n'y touche pas.

## 7. Retour arrière

Avant la refonte, l'état du dépôt a été figé sur la branche
**`sauvegarde/avant-refonte`** (commit `f42ccea`, build `20261004-1029`), qui ne doit
plus jamais être modifiée. Elle contient l'ancienne structure (`Metro_export_SHP/`,
`Metro.json`, `data/*Catalog.js`...).

- **Consulter / récupérer un fichier** : `git show sauvegarde/avant-refonte:Metro.json`
  ou `git checkout sauvegarde/avant-refonte -- Metro_export_SHP`.
- **Revenir complètement à l'ancienne version** : déployer cette branche telle quelle
  (si GitHub Pages sert la branche `X`, remettre `X` sur ce commit :
  `git checkout X && git reset --hard sauvegarde/avant-refonte && git push --force-with-lease`
  — à ne faire qu'en connaissance de cause, car cela écarte les commits postérieurs),
  ou, plus sûr, `git revert` de la fusion de `refonte-donnees`.
- Un tag annoté `sauvegarde-avant-refonte-20261005` était prévu au même commit ; il n'a
  pas pu être poussé depuis l'environnement de développement (push de tag refusé) :
  à créer à la main si souhaité (`git tag -a sauvegarde-avant-refonte-20261005 f42ccea`).
- Les points métier ne sont pas concernés (`localStorage`, voir ci-dessus).



## Interfaces : carte et saisie (home.html?app=)

Une seule page, `home.html`, deux interfaces choisies par le paramètre d'adresse `app` :

| Adresse | Interface | Contenu |
|---|---|---|
| `home.html?app=carto` (défaut) | AMGT4CEM | visualisation de toutes les données sur la carte, vues paramétrables |
| `home.html?app=signal` | SIG4CEM | saisie des signalements et demandes : nouvelle entrée (carte puis formulaire), brouillons, file d'envoi (en cours de construction) |

Le routeur (`src/router.js`) copie dans la page le gabarit de l'interface choisie, puis charge ses styles
et ses scripts dans l'ordre, d'après la liste `apps` de `config.js`. Une interface ne charge jamais l'autre :
la carte n'embarque pas le code de la saisie et la saisie n'embarque pas la carte. `config.js` est commun.
`AMGT4CEM_Router.url('carto', { ... })` fabrique un lien d'une interface vers l'autre (paramètres libres,
lus par l'interface cible dans `AMGT4CEM_Router.params`). Interface inconnue : message avec des liens
vers les interfaces existantes.

Dans la carte, « ✚ Ajouter un point » est revenu à son rôle d'origine (poser un point métier : type et
libellé). Le plugin `signalements` y est désactivé (`enabled: false` dans `config.js`) : son formulaire,
son menu et ses couches n'y apparaissent plus. Son code reste dans `src/signalements/`, en attendant d'être
repris par l'interface de saisie ; une couche en lecture seule des signalements du serveur reviendra
dans la carte une fois le serveur de dépôt branché.
