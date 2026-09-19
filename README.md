# AMGT4CEM — Carte du réseau métro (V1)

Application cartographique légère et autonome pour la maintenance génie
civil du réseau métro bruxellois (HTML + CSS + JavaScript, sans framework,
sans backend).

## 1. Lancer l'application

L'application est une page statique. `Metro.json` est chargé via `fetch()`,
ce qui **ne fonctionne pas** si vous ouvrez `index.html` directement en
double-clic (`file://`) — c'est une restriction des navigateurs, pas un bug.
Servez le dossier avec un petit serveur HTTP local :

```bash
cd AMGT4CEM
python3 -m http.server 8000
```

Puis ouvrez : http://localhost:8000/

*(Si vous n'avez pas Python, `npx serve` ou l'extension VS Code "Live Server"
fonctionnent tout aussi bien.)*

Si malgré tout vous ouvrez la page en `file://`, l'application le détecte
automatiquement et affiche un bouton pour sélectionner manuellement le
fichier `Metro.json` (sans quitter la page).

## 2. Tester le scénario principal

1. La carte s'ouvre déjà recentrée sur l'emprise du réseau métro.
2. Les couches **Stations** et **Tunnels** sont visibles.
3. Cliquez sur une station ou un tunnel : ses attributs (`name_fr`,
   `name_nl`, `type`, `niveau`...) s'affichent dans une popup.
4. Déplacez la carte (glisser) et zoomez (molette, pincement, ou
   double-clic — pas de boutons +/- dédiés, voir point 7 ci-dessous) : le
   fond et les données métro restent parfaitement superposés, sans limite
   de zoom.
5. Bouton **☰ Carte** (haut gauche) : ouvre le menu fond de plan / couches /
   vue. Choisissez **UrbIS** ou **Orthophotos** (fait apparaître, en bas de
   l'écran, une navigation **‹ année › ⏭** pour parcourir les millésimes de
   1935 à 2022 — seules les années dont le service répond sont proposées,
   réglée sur la plus récente accessible par défaut ; le bouton **⏭** y
   ramène directement). Les cases à cocher activent/désactivent Stations,
   Tunnels et Points métier. Le bouton **⤢ Réinitialiser la vue** revient à
   l'emprise générale du réseau et remet le fond UrbIS grisé.
6. Bouton **🔍** (haut droite) : ouvre un champ de recherche sur les
   stations, tunnels (Metro.json), points métier et adresses (noms de
   rues). Tapez un nom (les accents sont ignorés dans la recherche, ex.
   "de brouckere" trouve "De Brouckère") : les résultats stations/tunnels/
   points apparaissent immédiatement, puis les adresses correspondantes
   (géocodeur UrbIS, voir section 3) s'ajoutent après une courte requête
   réseau. Cliquez un résultat : la carte se recentre et zoome dessus
   automatiquement.
7. Les coordonnées Lambert du curseur s'affichent en bas à gauche, sous la
   navigation temporelle quand celle-ci est visible.
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
11. Icône **⚙** en haut à droite du menu **☰ Carte** : permet de corriger
    l'URL d'un service externe (fond UrbIS, orthophotos, géocodeur
    d'adresses) si celui-ci change d'adresse un jour, sans devoir modifier
    le code. Voir section 3bis ci-dessous.

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

Dans le menu **☰ Carte**, section "Couches UrbIS Topo" : affiche, en plus du
fond de plan et du réseau métro, des objets détaillés du produit
**UrbIS Topo** (CIRB/CIBG - Paradigm) — grilles de ventilation, chambres et
taques d'égout, avaloirs, mobilier urbain, marquages routiers, etc.

Cette section n'affiche qu'une **légende en lecture seule** (pastille de
couleur + libellé) des types actuellement affichés — pour changer la
sélection, le lien **"(modifier la sélection)"** ouvre un sélecteur plein
écran listant l'intégralité du catalogue d'objets (une centaine de types),
classé par thème (Voirie, Assainissement et égouttage, Marquages et
signalisation routière, Mobilier urbain, Transport en commun, Bâtiments...)
avec un champ de recherche. Cocher/décocher un type l'affiche/le masque
immédiatement sur la carte, avec une couleur assignée automatiquement.

Voir `data/urbisTopoCatalog.js` pour le catalogue complet,
`src/urbisTopoSelectionStore.js` pour la sélection (persistée dans
`localStorage`, propre à cet appareil, clé `amgt4cem.urbistopo-selection.v1`
— au tout premier lancement, une présélection reprend les trois familles
proposées lors d'une itération précédente : grilles de ventilation,
chambres/taques d'égout, avaloirs), `src/urbisTopoPicker.js` pour le
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

Oui, à une exception près : `Metro.json` est un fichier fourni par
l'utilisateur et servi localement (jamais réécrit, voir section 4), et la
micro-base de points métier vit uniquement dans le `localStorage` du
navigateur (section 6). Tout le reste — fond UrbIS, orthophotos Bruciel,
géocodeur d'adresses — est interrogé en direct auprès de services externes
(CIRB/CIBG, urban.brussels), à chaque affichage, sans rien mettre en cache
de façon permanente côté application.

Ces URLs sont en dur dans `config.js`. Si l'un de ces services change
d'adresse (migration de serveur, changement de nom de domaine...), il n'est
pas nécessaire de modifier le code : l'icône **⚙** en haut à droite du menu
**☰ Carte** ouvre un panneau permettant de corriger :

- l'URL du service WMS du fond UrbIS et le nom de sa couche,
- l'URL du service WMS des orthophotos historiques (1935&ndash;1996),
- l'URL du service WMS des orthophotos récentes (2004&ndash;2022),
- l'URL du géocodeur d'adresses.

Ces valeurs sont enregistrées à part (`localStorage`, clé
`amgt4cem.settings.v1`, voir `src/settingsStore.js`), propres à cet appareil
comme les points métier, et appliquées au rechargement de la page. Un champ
laissé vide revient à la valeur par défaut de `config.js`. Le bouton
**Réinitialiser** efface toutes les surcharges en une fois.

Cela ne couvre que les adresses de service (le cas le plus probable :
migration d'un serveur entier) : les noms de couches par année pour les
orthophotos (`Orthophotoplans_1996`, `urbisgrid:Ortho2022Ns`...) restent
dans `config.js`, car les vérifier nécessite de toute façon de consulter le
`GetCapabilities` réel du service (voir section 3).

## 4. Analyse de Metro.json (référence)

- Format : `FeatureCollection` GeoJSON (sortie de service WFS GeoServer).
- CRS déclaré explicitement dans le fichier : `urn:ogc:def:crs:EPSG::31370`
  → Belgian Lambert 72, utilisé tel quel comme référentiel métier de
  l'application (pas de conversion définitive en lat/lon).
- 156 entités, toutes en géométrie `Polygon` (aucune ligne/point) :
  - `type = "MS"` (69 entités) : emprises de stations.
  - `type = "MT"` (87 entités) : emprises de tunnels.
- Attributs : `ogc_fid`, `name_fr`, `name_nl`, `niveau`, `type`.
- Emprise (bbox) : X ∈ [142502.65, 156765.94], Y ∈ [166820.13, 176367.30],
  cohérente avec l'étendue réelle de la Région bruxelloise une fois
  reprojetée en WGS84 (vérifié).

## 5. Architecture

```
index.html, style.css        interface
config.js                    configuration (CRS, services, clés de stockage)
src/settingsStore.js         surcharges utilisateur des URLs de services (⚙ Paramètres)
src/settingsPanel.js         panneau "⚙ Paramètres"
src/crs.js                   proj4 EPSG:31370 <-> WGS84 (affichage uniquement)
src/metroData.js             chargement Metro.json (fetch, avec repli FileReader)
src/metroLayer.js            construction des couches Leaflet Stations/Tunnels
src/basemap.js                fonds de plan (UrbIS, Orthophoto, Bruciel)
data/urbisTopoCatalog.js     catalogue complet des types d'objets UrbIS Topo (référence)
src/urbisTopoSelectionStore.js sélection utilisateur des types UrbIS Topo affichés
src/urbisTopoPicker.js        sélecteur plein écran (catalogue classé par thème)
src/urbisTopoLayer.js        affichage carte des types UrbIS Topo sélectionnés
src/mapMenu.js                menu fond de plan / couches / réinitialisation
src/searchTool.js             recherche station/tunnel/point (remplace le zoom +/-)
src/pointsStore.js           micro-base de données (localStorage, schéma ouvert)
src/pointsLayer.js           affichage/déplacement des points métier
src/addPointTool.js          workflow "Ajouter un point"
src/coordsDisplay.js         affichage des coordonnées Lambert du curseur
src/app.js                   assemblage de l'application
vendor/leaflet, vendor/proj4,
vendor/proj4leaflet          bibliothèques embarquées localement
```

`Metro.json` (donnée de référence) et la micro-base de points métier
(`pointsStore.js`) sont deux sources totalement indépendantes : la première
n'est jamais réécrite ; la seconde peut être remplacée plus tard par un
vrai backend sans toucher à la cartographie.

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

Le choix n'a pas encore été fait — voir la conversation de développement.
