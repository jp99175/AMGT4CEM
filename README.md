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
2. Les couches **Stations** et **Tunnels** sont visibles (contrôle de
   couches en haut à droite pour les activer/désactiver).
3. Cliquez sur une station ou un tunnel : ses attributs (`name_fr`,
   `name_nl`, `type`, `niveau`...) s'affichent dans une popup.
4. Déplacez la carte (glisser) et zoomez (molette, boutons +/-, ou
   double-clic) : le fond et les données métro restent parfaitement
   superposés, sans limite de zoom.
5. Bouton **⤢ Vue métro** : revient à l'emprise générale du réseau.
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

## 3. Le fond de plan Urbis

L'application est configurée pour utiliser le service WMS public UrbIS
(CIRB/CIBG), le même service que celui utilisé par MobiGIS
(`https://geoservices-urbis.irisnet.be/geoserver/Urbis/wms`, couche
`urbisFR`). **Cet endpoint n'a pas pu être testé en direct depuis
l'environnement de développement** (politique réseau du bac à sable
bloquant les domaines `*.irisnet.be`) — vérifiez son chargement depuis votre
propre poste. S'il ne se charge pas (icône d'avertissement affichée
automatiquement), basculez sur **« Fond de secours (OSM) »** dans le
contrôle de couches : l'architecture ne change pas, seule l'URL de tuiles
diffère (voir `config.js`).

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
src/basemap.js                fond Urbis WMS + fond de secours
src/pointsStore.js           micro-base de données (localStorage, schéma ouvert)
src/pointsLayer.js           affichage/déplacement des points métier
src/addPointTool.js          workflow "Ajouter un point"
src/coordsDisplay.js         affichage des coordonnées Lambert du curseur
src/app.js                   assemblage de l'application
vendor/leaflet, vendor/proj4 bibliothèques embarquées localement
```

`Metro.json` (donnée de référence) et la micro-base de points métier
(`pointsStore.js`) sont deux sources totalement indépendantes : la première
n'est jamais réécrite ; la seconde peut être remplacée plus tard par un
vrai backend sans toucher à la cartographie.
