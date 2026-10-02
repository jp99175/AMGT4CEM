# Plugin : éditeur d'étiquettes (références de planche, numéros d'interstation)

Placer et orienter chaque référence de planche (ex. « 1000-236 ») par
rapport au cadre de sa planche, et chaque numéro d'interstation (couche
« Numéros interstation », texte souligné relié au centre de son tronçon) par
rapport à l'emprise de son tronçon, en choisissant des points précis plutôt
qu'en glissant au jugé. Même procédure pour les deux : pour un numéro
d'interstation, le « cadre » est le contour du tronçon (tunnel `MT`) auquel
il est rattaché, et les intersections proposées sont celles avec les autres
emprises (stations, tunnels). La ligne de repère suit : elle part toujours du
centre du tronçon (milieu de son axe) vers l'extrémité du soulignement la
plus proche. Pendant la modification d'un numéro d'interstation, l'**axe du
tunnel** (ligne de construction, pointillé violet) et son milieu sont
affichés.
Les définitions des numéros d'interstation sont enregistrées dans le même
fichier, sous la clé `IS-<numéro>#<rang>`.

Le plugin lui-même vit dans ce dossier. L'affichage des définitions
enregistrées (ancrage, orientation) est fait par l'application
(`src/scaledText.js`, `src/peLabelAnchors.js`, `src/metroLayer.js`) : sans le
plugin, les visiteurs voient le résultat ; seul l'enregistrement exige le
plugin et le relais.

**Réservé aux administrateurs (à terme).** La modification n'est destinée
qu'aux administrateurs, en mode « édition » : ce plugin n'est chargé que par
sa propre page de lancement, et `isAdmin()` (début de `pe-label-editor.js`)
est le point de branchement prévu pour le contrôle d'accès réel — il masque
la bulle et l'icône quand il renvoie `false`. Il renvoie `true` pour
l'instant.

## Utilisation

**Infobulles désactivées** : tant que le plugin est chargé (mode édition), les
infobulles de l'application (planches, stations, points, UrbIS Topo) ne
s'ouvrent plus, pour ne pas gêner le choix des points. Seule reste la bulle
du plugin (« Planche … » + icône déplacer). Elles reviennent à la sortie
(**Quitter l'édition**).

**Depuis l'application** : ⚙ Paramètres > onglet **Fonds de plan** > **Mode
édition des étiquettes (planches, interstations)**. Cela affiche les couches
« Plans d'ensemble » et « Numéros interstation », charge ce plugin à la demande (une seule fois) et ouvre son
panneau d'administration ; **Quitter l'édition** (dans ce panneau) recharge la
page et revient au mode normal. La couleur des étiquettes repositionnées
(ci-dessous) n'apparaît que dans ce mode.

Alternative (développement) : ouvrir `plugins/pe-label-editor/index.html` au
lieu de `index.html` (la page charge l'appli telle quelle et y ajoute ce
plugin à la fin). Dans les deux cas le site doit être servi en http(s).

1. Afficher la couche **Plans d'ensemble (1/500e)** et/ou **Numéros
   interstation** (menu ☰ Carte → Plans patrimoine) ; le lancement depuis
   ⚙ Paramètres affiche les deux.
2. **Cliquer dans le texte** d'une référence de planche (ou d'un numéro
   d'interstation) : une bulle d'info affiche « Planche 1000-236 » (ou
   « Interstation 648 ») avec l'icône **déplacer** (quatre flèches).
3. Cliquer l'icône : la modification de CETTE étiquette commence, en
   quatre choix (un panneau les liste, on peut revenir sur n'importe
   lequel) :
   1. **Point de référence du texte** : l'un des **8 points** de sa boîte,
      affichés sur le texte — 4 coins et 4 milieux de bord.
   2. **Point d'ancrage sur la planche** : un point remarquable du cadre,
      dans cet ordre de priorité, chacun avec sa forme :
      1. les **sommets** du polygone (pastille carrée foncée) ;
      2. le **centre de chaque côté** du polygone (pastille carrée foncée) ;
      3. les **intersections** avec d'autres planches (pastille ronde avec
         deux diamètres en X) ;
      4. le **centre de chaque segment** du cadre que délimitent les points
         des catégories 1 **et** 3 (pastille ronde plus petite et plus claire).

      Un point n'est ajouté que s'il a une valeur ajoutée : aucun autre
      point remarquable à moins de **5 m** (échelle réelle du plan) — en cas
      de doute, la catégorie la plus prioritaire l'emporte. Le point de
      référence est posé sur le point choisi.
   3. **Second point de référence du texte** : un autre des 8 points.
   4. **Autre point remarquable de la planche**.

   L'orientation en découle : le point de référence (posé sur l'ancre), le
   second point de référence et le point remarquable de l'étape 4 sont
   **alignés** par la **rotation la moins grande** de la boîte de texte
   (valeur absolue minimale depuis l'horizontale : le texte reste lisible,
   jamais à l'envers). Un trait pointillé bleu montre la droite d'alignement.
4. Contrôles du panneau d'une étiquette :
   - **Retour** : annule le positionnement du dernier point choisi (et
     revient à son étape) ; inactif tant qu'aucun point n'est choisi ;
   - **Appliquer** : garde le positionnement et termine (il faut au moins
     les points 1 et 2) ; le panneau d'administration s'ouvre, avec le
     nombre de modifications non enregistrées et le bouton **Enregistrer
     dans l'application** ;
   - **Annuler** : abandonne, aucun changement ;
   - **Réinitialiser l'étiquette** : remet la position d'origine (PDF).

**Couleur des étiquettes repositionnées.** En mode édition (page du
plugin), une étiquette repositionnée — au moins les points 1 et 2
choisis — s'affiche dans la couleur **chromatiquement opposée** à sa
couleur d'origine (teinte + 180° : l'orange #ff7f00 devient un bleu), pour
repérer d'un coup d'œil celles qui ont été modifiées. La page normale de
l'application, qui ne charge pas le plugin, garde la couleur d'origine.

Si seuls les points 1 et 2 sont choisis, l'étiquette est déplacée mais garde
son orientation d'origine.

Le point de référence reste collé à son ancre à tous les niveaux de zoom (le
texte pousse à partir de ce point), et l'alignement aussi : la rotation est
recalculée avec la taille réelle de la boîte, dont le rapport
largeur/hauteur ne change pas avec le zoom.

## Enregistrement dans l'application

Les modifications sont **enregistrées dans l'application**, partagées par
tous les visiteurs — pas dans le navigateur (rien n'est gardé dans
`localStorage`). Elles vivent dans `data/pe-label-anchors.json` (dépôt), lu
par l'application elle-même (`src/peLabelAnchors.js`) : un visiteur sans le
plugin voit les étiquettes à leur nouvelle place.

- **Enregistrer dans l'application** (panneau d'administration, qui
  s'ouvre après **Appliquer** ou avec le bouton **✥ Étiquettes planches**)
  envoie TOUTES les définitions au relais serveur `relay/`, qui commit le
  fichier dans le dépôt. Il utilise l'**adresse du relais** et le **code
  administrateur** des paramètres généraux (⚙ Paramètres > Serveur ; le code
  est masqué, gardé le temps de l'onglet seulement ; s'il manque, le plugin renvoie vers cet onglet). Les autres visiteurs voient le
  changement après le redéploiement de GitHub Pages (~1 min).
- Le panneau indique le nombre de modifications **non enregistrées** ;
  **Appliquer** seul applique la modification à l'écran (perdue au
  rechargement tant qu'elle n'est pas enregistrée).
- **Le relais est à déployer une fois** (compte Cloudflare gratuit, jeton
  GitHub) : voir `relay/README.md`, puis renseigner son adresse dans
  ⚙ Paramètres > Serveur (bouton **Tester** pour vérifier la connexion et le
  code ; l'adresse est enregistrée sur le serveur comme paramètre général). Tant que ce n'est pas fait, « Enregistrer » affiche un
  message explicite et n'écrit rien.
- Autres boutons du panneau : **Exporter JSON** (copie manuelle, repli si le
  relais est indisponible), **Importer JSON**, **Tout réinitialiser** (à
  enregistrer ensuite pour que ce soit partagé).

Les anciens réglages locaux (`localStorage`, versions précédentes du plugin)
ne sont plus lus.

## Fichiers

- `index.html` — page de lancement (récupère l'`index.html` de l'appli et
  y injecte le CSS/JS ci-dessous avant `</body>`).
- `pe-label-editor.css` — styles de la bulle, des points et des panneaux.
- `pe-label-editor.js` — logique (voir l'en-tête du fichier : principe,
  calcul des points remarquables, alignement, persistance).
