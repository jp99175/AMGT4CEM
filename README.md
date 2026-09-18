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
4. Déplacez la carte (glisser) et zoomez (molette, boutons +/-, ou
   double-clic) : le fond et les données métro restent parfaitement
   superposés, sans limite de zoom.
5. Bouton **☰ Carte** (haut gauche) : ouvre le menu fond de plan / couches /
   vue. Choisissez **UrbIS**, **Orthophoto** (image la plus récente) ou
   **Bruciel** (fait apparaître un curseur pour parcourir les années
   1935-1996). Les cases à cocher activent/désactivent Stations, Tunnels et
   Points métier. Le bouton **⤢ Réinitialiser la vue** revient à l'emprise
   générale du réseau.
6. Les coordonnées Lambert du curseur s'affichent en bas à gauche.
7. Cliquez **✚ Ajouter un point**, puis cliquez à l'endroit voulu sur la
   carte (vous pouvez continuer à naviguer avant de cliquer) : un marqueur
   provisoire apparaît, les coordonnées X/Y Lambert sont calculées
   automatiquement et affichées dans le petit formulaire.
8. Complétez *Type* et *Libellé*, cliquez **Enregistrer**. Le point devient
   permanent et est sauvegardé dans la micro-base (`localStorage` du
   navigateur).
9. Rechargez la page : le point est toujours là. Cliquez dessus pour
   consulter ses informations. Vous pouvez le glisser-déposer pour le
   repositionner : les coordonnées Lambert sont recalculées et enregistrées
   automatiquement.

## 3. Les fonds de plan

Trois choix dans le menu **☰ Carte**, déclarés dans `config.js`
(`AMGT4CEM_CONFIG.basemaps`) :

### UrbIS

Fond de référence grisé. Service WMS public UrbIS (CIRB/CIBG), le même
service que celui utilisé par MobiGIS
(`https://geoservices-urbis.irisnet.be/geoserver/Urbis/wms`, couche
`urbisFRGray`). **Cet endpoint n'a pas pu être testé en direct depuis
l'environnement de développement** (politique réseau du bac à sable bloquant
les domaines `*.irisnet.be`) — vérifiez son chargement depuis votre propre
poste. S'il ne se charge pas, une bannière d'avertissement s'affiche
automatiquement.

### Orthophoto

La photo aérienne la plus récente disponible : **2022**
(`urbisgrid:Ortho2022Ns`), sur le même serveur UrbIS, workspace `urbisgrid`.
Ce nom de couche a été confirmé en extrayant les URLs de légende réellement
générées par la page MobiGIS (snapshot HTML fourni par l'utilisateur), pas
une supposition. Pour passer à un millésime plus récent quand il sera
disponible, il suffit de changer `layers` dans
`AMGT4CEM_CONFIG.basemaps.orthophoto` (voir `config.js`).

### Bruciel

Série historique (**1935, 1944, 1953, 1961, 1971, 1977, 1987, 1996**),
parcourue via le curseur qui apparaît dans le menu une fois "Bruciel"
sélectionné — déplacer le curseur change la couche affichée en direct.
Confirmée via un `GetCapabilities` réel du service (fourni par l'utilisateur,
pas une supposition). Service GeoServer : `gis.urban.brussels`, workspace
`URBAN_DCC_ER` (et non `BRUCIEL`, qui ne contient que des couches
thématiques annexes — localisation d'ateliers, tracés de tram, etc. — pas
les images aériennes elles-mêmes). Couches `Orthophotoplans_<année>`. Ce
serveur ne va pas au-delà de 1996.

### CRS forcé en EPSG:31370

Les couches Bruciel et Orthophoto ne déclarent que `EPSG:31370`/`CRS:84`
dans leurs `GetCapabilities` (pas `EPSG:3857`, contrairement au fond UrbIS)
— la carte Leaflet fonctionnant par défaut en Web Mercator, ces couches
précisent `crs: 'EPSG:31370'` dans `config.js` pour forcer Leaflet à les
requêter dans leur CRS natif (via Proj4Leaflet, voir `src/basemap.js`), sous
peine de tuiles vides ou d'erreur serveur.

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
src/crs.js                   proj4 EPSG:31370 <-> WGS84 (affichage uniquement)
src/metroData.js             chargement Metro.json (fetch, avec repli FileReader)
src/metroLayer.js            construction des couches Leaflet Stations/Tunnels
src/basemap.js                fonds de plan (UrbIS, Orthophoto, Bruciel)
src/mapMenu.js                menu fond de plan / couches / réinitialisation
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
