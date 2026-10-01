# AMGT4CEM — Carte du réseau métro (V1)

Application cartographique légère et autonome pour la maintenance génie
civil du réseau métro bruxellois (HTML + CSS + JavaScript, sans framework,
sans backend).

## 1. Lancer l'application

L'application est une page statique. Le réseau métro de référence est chargé
via `fetch()` depuis `Metro_export_SHP/Metro.shp`/`.dbf` (Shapefile — voir
section 4bis), ce qui **ne fonctionne pas** si vous ouvrez `index.html`
directement en double-clic (`file://`) — c'est une restriction des
navigateurs, pas un bug. Servez le dossier avec un petit serveur HTTP local :

```bash
cd AMGT4CEM
python3 -m http.server 8000
```

Puis ouvrez : http://localhost:8000/

*(Si vous n'avez pas Python, `npx serve` ou l'extension VS Code "Live Server"
fonctionnent tout aussi bien.)*

Si malgré tout vous ouvrez la page en `file://`, l'application le détecte
automatiquement et affiche un bouton pour sélectionner manuellement un
fichier `.json` de secours (`Metro.json`, tenu à jour en parallèle du
Shapefile — sans quitter la page).

## 2. Tester le scénario principal

1. La carte s'ouvre déjà recentrée sur l'emprise du réseau métro.
2. Les couches **Stations** et **Tunnels** sont visibles.
3. Cliquez sur une station ou un tunnel : ses attributs (`name_fr`,
   `name_nl`, `type`, `niveau`...) s'affichent dans une popup.
4. Déplacez la carte (glisser) et zoomez (molette, pincement, ou
   double-clic — pas de boutons +/- dédiés, voir point 7 ci-dessous) : le
   fond et les données métro restent parfaitement superposés, sans limite
   de zoom.
5. Bouton **☰ Carte** (haut gauche) : ouvre le menu, organisé en trois
   catégories. **Fond de carte** : choisissez **UrbIS** ou **Orthophotos**
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
   stations, tunnels (couche Metro, chargée depuis le Shapefile), points
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
   En bas à droite, sous l'attribution "(c) CIRB/CIBG – UrbIS", un petit
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
11. Icône **⚙** en haut à droite du menu **☰ Carte**, ou lien **⚙ Sources,
    serveur, fonds de plan…** de la section **Paramètres** (au-dessus de
    « Réinitialiser la vue ») : ouvre la fenêtre de paramètres, à trois
    onglets — **Sources** (corriger l'URL d'un service externe — fond UrbIS,
    orthophotos, géocodeur — si celui-ci change d'adresse, sans modifier le
    code ; voir section 3bis), **Serveur** (adresse du relais d'enregistrement
    et code administrateur, bouton **Tester**) et **Fonds de plan** (lancer le
    mode édition des étiquettes de planche ; charger un nouveau shapefile :
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
    fond de carte ou de couche (☰ Carte reste utilisable pendant une
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

Deux choix dans le menu **☰ Carte**, déclarés dans `config.js`
(`AMGT4CEM_CONFIG.basemaps`) :

### UrbIS

Fond de référence grisé. Service WMS public UrbIS (CIRB/CIBG), le même
service que celui utilisé par MobiGIS
(`https://geoservices-urbis.irisnet.be/geoserver/Urbis/wms`, couche
`urbisFRGray`). **Cet endpoint n'a pas pu être testé en direct depuis
l'environnement de développement** (politique réseau du bac à sable bloquant
les domaines `*.irisnet.be`) — vérifiez son chargement depuis votre propre
poste.

### Orthophotos

Une seule ligne du temps continue, de **1935 à 2022** (19 millésimes),
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

Aucun nom de couche ci-dessus n'est deviné. Pour ajouter un millésime plus
récent quand il sera identifié, ajoutez une entrée dans
`AMGT4CEM_CONFIG.basemaps.bruciel.entries` (voir `config.js`).

### Recherche d'adresses (géocodage)

La recherche (bouton **🔍**) inclut aussi les noms de rues, via le service
officiel de géocodage UrbIS (CIRB/CIBG),
`https://geoservices.irisnet.be/localization/Rest/Localize/getaddresses`
(déclaré dans `AMGT4CEM_CONFIG.geocoder`, utilisé par `src/searchTool.js`).
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
Web Mercator, ces couches précisent `crs: 'EPSG:31370'` dans `config.js`
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
pour sélectionner une famille entière d'un coup plutôt que type par type.
Le bouton **💾** en haut du sélecteur enregistre la sélection courante comme
sélection par défaut de cet appareil — utilisée à la prochaine fois que
l'application démarre sans aucune sélection enregistrée (première visite,
ou après effacement des données du navigateur), à la place de la
présélection intégrée au code (grilles de ventilation seules).

Voir `data/urbisTopoCatalog.js` pour le catalogue complet,
`src/urbisTopoSelectionStore.js` pour la sélection (persistée dans
`localStorage`, propre à cet appareil : clé `amgt4cem.urbistopo-selection.v1`
pour la sélection courante, `amgt4cem.urbistopo-default.v1` pour la
sélection par défaut enregistrée via 💾), `src/urbisTopoPicker.js` pour le
sélecteur, et `src/urbisTopoLayer.js` pour le chargement carte.

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
`data/urbisTopoCatalog.js` mais ne sont pas sélectionnables.

Chargement strictement **à la demande**, pour deux raisons :
- rien n'est requêté tant qu'aucun type n'est sélectionné ;
- une fois une sélection faite, seuls les objets de l'emprise actuellement
  visible sont demandés (`CQL_FILTER` avec `TYPE IN (...)` et `BBOX(...)`,
  au plus 2 requêtes quel que soit le nombre de types sélectionnés — une par
  géométrie), et seulement à partir d'un niveau de zoom minimal
  (`AMGT4CEM_CONFIG.urbisTopo.minZoom`, 16 par défaut, ajustable) — une seule
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

Oui, à quelques exceptions près : `Metro_export_SHP/` (export Shapefile
depuis Civil 3D, voir section 4bis ; `Metro.json` en garde une copie de
secours) et les fichiers "Plans patrimoine" (section 3ter) sont fournis
par l'utilisateur et servis localement, et la micro-base de points métier
vit uniquement dans le `localStorage` du navigateur (section 6). Tout le
reste — fond UrbIS, orthophotos Bruciel, géocodeur d'adresses, UrbIS Topo —
est interrogé en direct auprès de services externes (CIRB/CIBG,
urban.brussels), à chaque affichage, sans rien mettre en cache de façon
permanente côté application.

Ces URLs sont en dur dans `config.js`. Si l'un de ces services change
d'adresse (migration de serveur, changement de nom de domaine...), il n'est
pas nécessaire de modifier le code : l'icône **⚙** en haut à droite du menu
**☰ Carte** ouvre la fenêtre de paramètres ; son onglet **Sources** permet de corriger :

- l'URL du service WMS du fond UrbIS et le nom de sa couche,
- l'URL du service WMS des orthophotos historiques (1935&ndash;1996),
- l'URL du service WMS des orthophotos récentes (2004&ndash;2022),
- l'URL du géocodeur d'adresses.

Ces valeurs sont des **paramètres généraux de l'application**, pas des
réglages de l'appareil : **Enregistrer** les envoie au serveur (relais
`relay/`, route `/settings`), qui les commit dans `data/app-settings.json`
(dépôt). L'application lit ce fichier à chaque démarrage
(`src/settingsStore.js`, avant toute création de couche) : tous les visiteurs
les voient, après le redéploiement de GitHub Pages (~1 min). Seules les
valeurs différentes de `config.js` sont enregistrées ; fichier absent ou vide
= valeurs par défaut de `config.js`. Le bouton **Valeurs par défaut** remplit
les champs avec celles de `config.js` (à enregistrer ensuite). Cette fenêtre
est réservée aux administrateurs (voir section 1, item 11) ; l'enregistrement
exige l'adresse du relais et le code administrateur (onglet **Serveur**). Les
anciens réglages locaux (`localStorage`, clé `amgt4cem.settings.v1`) ne sont
plus lus et sont effacés au démarrage.

Cela ne couvre que les adresses de service (le cas le plus probable :
migration d'un serveur entier) : les noms de couches par année pour les
orthophotos (`Orthophotoplans_1996`, `urbisgrid:Ortho2022Ns`...) restent
dans `config.js`, car les vérifier nécessite de toute façon de consulter le
`GetCapabilities` réel du service (voir section 3).

## 3ter. Plans patrimoine

Dans le menu **☰ Carte**, section "Couches" : la case **Plans patrimoine**
affiche ou masque des données de référence fournies directement par
l'utilisateur (export de son propre SIG patrimoine, jamais rechargées
depuis un service externe — contrairement à UrbIS Topo). Même principe que
UrbIS Topo : le choix des plans à afficher se fait via le lien
**"(modifier la sélection)"**, qui ouvre un sélecteur plein écran listant
le catalogue disponible (voir `data/patrimoineCatalog.js`) ; rien n'est
présélectionné par défaut tant que l'utilisateur n'a pas enregistré sa
propre sélection avec le bouton **💾** en haut du sélecteur (même principe
que pour UrbIS Topo : sélection par défaut propre à cet appareil, clé
`amgt4cem.patrimoine-default.v1`, voir `src/patrimoineSelectionStore.js`).
Le lien de sélection, comme le curseur d'opacité, ne s'affiche que
lorsqu'on clique sur l'icône **curseurs** de la case Plans patrimoine — les
deux partagent le même volet repliable, pour ne pas encombrer le menu par
défaut.

V1 (deux fichiers, EPSG:31370, voir `data/patrimoine-*.json`) :
- **Numéros interstation** : repères numérotés le long des tronçons entre
  stations.
- **Noms de station** : toponymes bilingues FR/NL et repères associés.

Les **plans d'ensemble au 1/500e** (36 planches) ont migré dans
`Metro_export_SHP/Metro.shp` (type `"PE"`, géométrie et popups gérés par
`src/metroLayer.js`, voir section 4bis) — mais restent une entrée de ce
sélecteur (`data/patrimoineCatalog.js`, `external: true`) : la case à
cocher affiche/masque simplement la couche déjà construite par
`metroLayer.js` (voir `src/patrimoineLayer.js#registerExternalLayer`), sans
recharger de fichier séparé ni proposer de couleur (la couleur/opacité des
planches reste réglée avec le reste du réseau métro, curseur "Métro"). Le
clic dans une zone où plusieurs planches se chevauchent (constaté sur ce
jeu de données) liste toujours **toutes** celles concernées à cet endroit
précis, pas seulement celle au-dessus visuellement — logique reprise telle
quelle dans `src/metroLayer.js` (`_sheetRefsAt`) au moment de la migration.
La même case affiche aussi **PE_info** et **PE_label**
(`Metro_export_SHP/MetroInfo.shp` + `MetroLabels.shp`) : les triangles et
codes de transition entre tronçons de construction (D0, D1, G1a...)
relevés dans INFRAVIEW.pdf, et le texte des références de planches
(1000-236...) affiché dans l'emprise des planches elles-mêmes — voir le
détail en section 4bis (méthode, précision, limites).

**Numéros interstation** et **Noms de station** sont des **étiquettes de
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

## 4. Analyse de Metro.json (format historique — remplacé comme référence par le Shapefile, voir 4bis)

Ce format n'est plus la donnée de référence (voir section 4bis) ; il reste
documenté ici pour mémoire, et parce que `Metro.json` en est toujours
dérivé comme fichier de secours.

- Format : `FeatureCollection` GeoJSON (à l'origine, sortie de service WFS
  GeoServer).
- CRS déclaré explicitement dans le fichier : `urn:ogc:def:crs:EPSG::31370`
  → Belgian Lambert 72, utilisé tel quel comme référentiel métier de
  l'application (pas de conversion définitive en lat/lon).
- 192 entités, toutes en géométrie `Polygon` (aucune ligne/point) :
  - `type = "MS"` (69 entités) : emprises de stations.
  - `type = "MT"` (87 entités) : emprises de tunnels.
  - `type = "PE"` (36 entités) : plans d'ensemble au 1/500e (planches),
    fusionnées ici depuis l'ancien `data/patrimoine-plans-ensemble-500e.json`
    — voir section 4bis.
- Attributs : `ogc_fid`, `name_fr`, `name_nl`, `niveau`, `type`, `sheet_ref`
  (numéro de planche, uniquement rempli pour `type = "PE"`).
- Emprise (bbox) : X ∈ [142502.65, 156823.81], Y ∈ [166628.36, 176534.41],
  cohérente avec l'étendue réelle de la Région bruxelloise une fois
  reprojetée en WGS84 (vérifié) — légèrement plus large que l'emprise du
  seul réseau métro, les planches débordant de quelques dizaines à ~190 m
  sur trois côtés.

## 4bis. Donnée de référence : Shapefile, pas GeoJSON

Le réseau métro (stations, tunnels, et depuis leur fusion les plans
d'ensemble au 1/500e — types `MS`/`MT`/`PE`, voir section 4) est maintenant
tenu en **Shapefile** dans `Metro_export_SHP/` (`Metro.shp`, `.dbf`, `.prj`,
`.cst`, `.idx`, `.shx`) — format délibérément choisi pour être exploitable
à la fois par **AutoCAD Civil 3D** (édite et exporte le Shapefile
nativement, Map 3D intégré, sans plugin ni droits admin) et par cette
application, contrairement à GeoJSON ou GeoPackage qui ne satisfont que
l'un des deux côtés (voir discussion dans l'historique du projet).

Origine de la donnée de référence : export WFS du service public MobiGIS
(`data.mobility.brussels`, couche `bm_public_transport:Metro`, requête
conservée dans `Metro_export_SHP/wfsrequest.txt`), qui produit justement un
Shapefile (`outputFormat=shape-zip`) en EPSG:31370. Ce même fichier peut
ensuite être ouvert et adapté dans Civil 3D.

Workflow de mise à jour d'un plan :
1. Adapter le plan dans Civil 3D (à partir du Shapefile existant, ou d'un
   nouvel export WFS MobiGIS si une resynchronisation complète est voulue).
2. Exporter en Shapefile, en réutilisant les mêmes noms de champs
   (`ogc_fid`, `name_fr`, `name_nl`, `niveau`, `type`) et le même CRS
   (EPSG:31370).
3. Remplacer les fichiers dans `Metro_export_SHP/` du dépôt.
4. Publier (commit + push) : l'application recharge automatiquement la
   nouvelle version au prochain chargement de page, aucune étape de
   conversion externe (QGIS, GDAL...) n'est nécessaire.

Lecture entièrement côté navigateur (`src/shpLoader.js`, ~150 lignes, aucune
bibliothèque tierce) : parseur binaire minimal pour `.shp` (type Polygon
uniquement, c'est le seul utilisé ici) et `.dbf` (texte décodé en
ISO-8859-1, voir `Metro.cst`). Aucune reprojection n'est faite à la lecture
— les coordonnées Lambert72 brutes sont conservées telles quelles, exactement
comme le faisait l'ancien `Metro.json` ; c'est `AMGT4CEM_CRS.lambertToLatLng`
(`crs.js`, appelé par `metroLayer.js`) qui convertit à l'affichage.

Point de vigilance rencontré en pratique : le premier export testé ne
contenait pas de fichier `.shx` (index des formes, normalement l'un des 3
fichiers minimaux d'un Shapefile avec `.shp`/`.dbf`) — à surveiller sur les
prochains exports, qu'ils viennent de Civil 3D ou d'un nouvel export WFS ;
`shpLoader.js` ne le lit pas (il n'en a pas besoin, il lit `.shp`
séquentiellement), mais un autre logiciel GIS pourrait le réclamer.

`Metro.json` reste dans le dépôt et à jour (régénéré à partir du Shapefile)
uniquement comme donnée de secours pour le chargement manuel (voir section
1) — le chargement automatique normal ne le lit plus.

### Éléments d'INFRAVIEW.pdf : calage sur le réseau

Tout ce qui vient d'INFRAVIEW.pdf (STIB, plan "Station & Interstation
Infrastructure", `DITP`, juillet 2025) est placé **par rapport au réseau
métro tel qu'il est dessiné dans ce PDF**, pas d'après un calage de
coordonnées pris isolément :

- emprises des planches (type `PE` de `Metro.shp`) ;
- triangles de transition de tronçon (`MetroInfo.shp`) et leurs codes ;
- références de planche (`MetroLabels.shp`, `PE_label`) ;
- noms et numéros de station, numéros d'interstation
  (`data/patrimoine-nom-station.json`, `data/patrimoine-numero-interstation.json`).

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
Le plugin d'édition (`plugins/pe-label-editor/`, voir son README) permet
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
**enregistrée dans l'application** : `data/pe-label-anchors.json`, lu pour
tous les visiteurs (voir section 6 et `relay/README.md`).

**Noms de station et numéros d'interstation** (couches "Plans patrimoine") :
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
index.html, style.css        interface
config.js                    configuration (CRS, services, clés de stockage)
src/admin.js                 accès administrateur (point de branchement du futur mot de passe)
src/settingsStore.js         paramètres généraux partagés (data/app-settings.json) : lecture au démarrage, enregistrement via le relais
src/settingsPanel.js         fenêtre "⚙ Paramètres" à onglets (Sources / Serveur / Fonds de plan)
src/layerOpacityStore.js     opacité individuelle des couches (icône curseurs, persistée)
src/crs.js                   proj4 EPSG:31370 <-> WGS84 (affichage uniquement)
src/shpLoader.js             lecture Shapefile (Metro_export_SHP/) côté navigateur, sans bibliothèque tierce
src/metroData.js             chargement manuel de secours (.json, FileReader) si le Shapefile échoue
src/scaledText.js            texte HTML à taille réelle constante (zoom), pour PE_info/PE_label
src/metroLayer.js            construction des couches Leaflet Stations/Tunnels/Planches/PE_info/PE_label
Metro_export_SHP/            donnée de référence : Metro.shp (MS/MT/PE) + MetroInfo.shp (triangles PE_info) + MetroLabels.shp (textes PE_info/PE_label) — voir section 4bis
src/basemap.js                fonds de plan (UrbIS, Orthophoto, Bruciel)
data/urbisTopoCatalog.js     catalogue complet des types d'objets UrbIS Topo (référence)
src/urbisTopoSelectionStore.js sélection utilisateur des types UrbIS Topo affichés
src/urbisTopoPicker.js        sélecteur plein écran (catalogue classé par thème)
src/urbisTopoLayer.js        affichage carte des types UrbIS Topo sélectionnés
data/patrimoineCatalog.js    catalogue des couches "Plans patrimoine" (référence)
data/patrimoine-*.json       fichiers de référence locaux "Plans patrimoine" (jamais réécrits)
src/patrimoineSelectionStore.js sélection utilisateur des couches Plans patrimoine affichées
src/patrimoinePicker.js      sélecteur plein écran "Plans patrimoine"
src/patrimoineLayer.js       affichage carte des couches Plans patrimoine sélectionnées
src/mapMenu.js                menu fond de plan / couches / réinitialisation
src/searchTool.js             recherche station/tunnel/point (remplace le zoom +/-)
src/pointsStore.js           micro-base de données (localStorage, schéma ouvert)
src/pointsLayer.js           affichage/déplacement des points métier
src/addPointTool.js          workflow "Ajouter un point"
src/measureTool.js           outil "📏 Mesurer" (segment + cote + cercle, 4s puis disparition)
src/screenshotTool.js        capture PNG auto au 2e relâchement (mémoire uniquement) + enregistrement ("💾")
src/scaleControl.js          réglette graduée (bas gauche), alterne au clic avec les coordonnées Lambert
src/buildInfo.js             horodatage de la dernière mise à jour (à mettre à jour à chaque commit)
src/buildInfoControl.js      affiche "BUILD ..." en bas à droite, sous l'attribution
src/app.js                   assemblage de l'application
vendor/leaflet, vendor/proj4,
vendor/proj4leaflet,
vendor/html2canvas           bibliothèques embarquées localement
```

`Metro_export_SHP/` (donnée de référence) et la micro-base de points métier
(`pointsStore.js`) sont deux sources totalement indépendantes : la première
n'est modifiée que par un nouvel export Civil 3D (jamais par l'application
elle-même) ; la seconde peut être remplacée plus tard par un vrai backend
sans toucher à la cartographie.

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

Le choix n'a pas encore été fait pour les points métier — voir la
conversation de développement.

### Premier usage du relais : définitions d'ancrage des références de planche

La première donnée qui doit être **partagée** (et non propre à un
navigateur) est la position/orientation des références de planche
(`PE_label`), modifiées par un administrateur. Elle utilise la première
piste ci-dessus (petit relais serveur) :

- le fichier `data/pe-label-anchors.json` (dans le dépôt) est lu par
  l'application pour tous les visiteurs (`src/peLabelAnchors.js`, appliqué
  par `src/metroLayer.js` / `src/scaledText.js`) ; absent ou vide, les
  étiquettes gardent leur position d'origine (`MetroLabels.shp`) ;
- le plugin `plugins/pe-label-editor/` (administrateurs) l'enregistre via le
  relais `relay/` (Cloudflare Worker, à déployer une fois : `relay/README.md`),
  qui commit le fichier dans le dépôt ; GitHub Pages le redéploie ;
- tant qu'aucune adresse de relais n'est connue (paramètre général `relayUrl`,
  `data/app-settings.json`, ou `peLabelAnchorsRelayUrl` de `config.js`),
  l'enregistrement est refusé avec un message explicite (l'export JSON reste
  possible).

Le même relais enregistre les **paramètres généraux** de l'application
(route `/settings` → `data/app-settings.json`, fenêtre ⚙ Paramètres) :
adresses des services externes et adresse du relais elle-même. La toute
première fois, l'adresse du relais se saisit dans ⚙ Paramètres > Serveur avec
le code administrateur ; le relais l'écrit dans le fichier partagé, d'où tous
les visiteurs la lisent ensuite.

Les points métier (`pointsStore.js`) restent en `localStorage` : le relais
pourra être étendu à ces données si la piste est retenue.
