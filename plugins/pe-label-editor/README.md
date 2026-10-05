# Plugin : éditeur d'étiquettes (références de planche, numéros d'interstation)

**Un seul mode édition** pour deux types d'étiquettes :

- les **références de planche** (ex. « 1000-236 ») : placer et orienter chacune
  par rapport au cadre de sa planche, en choisissant des points précis plutôt
  qu'en glissant au jugé (procédure en 4 choix ci-dessous) ;
- les **numéros d'interstation** (couche « Numéros interstation », texte
  souligné relié au centre de son tronçon) : déplacer le texte et choisir le
  tronçon auquel il se raccroche (voir « Numéros d'interstation »).

**Geste commun** : au **survol**, l'étiquette modifiable est mise en
**surbrillance** ; un **premier clic** la **sélectionne**, un **second clic**
lance sa **modification**. L'**étape en cours** s'affiche en haut à gauche de
la page, sous le menu carte, limitée à l'**étape en cours** (pas tout le process) : titre de
l'étiquette, puis l'étape surlignée — titre en gras, « ✓ valeur » en vert si
elle est déjà renseignée, consigne en gris — avec ses boutons **◀ Retour**, **Suivant ▶**,
**↺** (position d'origine), **Annuler** (la modification en cours) et
**✓ Terminer**. Le bouton **✥ Mode édition** (en bas à droite) affiche ou
masque, à chaque clic, le **panneau de suivi** : aide, compteurs de
modifications non enregistrées, et trois boutons : **💾** (enregistrer
planches et tronçons ; grisé tant qu'il n'y a rien à enregistrer), **↶**
(annuler la dernière opération de la session, une à la fois ; grisé s'il n'y
en a pas) et **Quitter l'édition**. Pendant une modification, 💾 et ↶ sont grisés. Le bouton
« ✥ Mode édition » prend un contour rouge tant qu'il reste des modifications
non enregistrées.

Le plugin lui-même vit dans ce dossier. L'affichage des définitions
enregistrées (ancrage, orientation) est fait par l'application
(`src/scaledText.js`, `src/peLabelAnchors.js`, `src/metroLayer.js`) : sans le
plugin, les visiteurs voient le résultat ; seul l'enregistrement exige le
plugin et le relais.

**Réservé aux administrateurs (à terme).** La modification n'est destinée
qu'aux administrateurs, en mode « édition » : ce plugin n'est chargé que par
sa propre page de lancement ou à la demande depuis les paramètres, et
`isAdmin()` (début de `pe-label-editor.js`) est le point de branchement prévu
pour le contrôle d'accès réel — il masque les commandes quand il renvoie
`false`. Il renvoie `true` pour l'instant.

## Utilisation

**Infobulles désactivées** : tant que le plugin est chargé (mode édition), les
infobulles de l'application (planches, stations, points, UrbIS Topo) ne
s'ouvrent plus, pour ne pas gêner le choix des points. Elles reviennent à la
sortie (**Quitter l'édition**).

**Depuis l'application** : ⚙ Paramètres > onglet **Fonds de plan** > **✥ Mode
édition**. Cela affiche les couches « Plans d'ensemble » et « Numéros
interstation », charge ce plugin à la demande (une seule fois) et ouvre le
panneau de suivi (l'aide) ; **Quitter l'édition** (dans ce panneau) recharge la
page et revient au mode normal. La couleur des étiquettes repositionnées
(ci-dessous) n'apparaît que dans ce mode.

Alternative (développement) : ouvrir `plugins/pe-label-editor/index.html` au
lieu de `index.html` (la page charge l'appli telle quelle et y ajoute ce
plugin à la fin). Dans les deux cas le site doit être servi en http(s).

## Références de planche

1. Afficher la couche **Plans d'ensemble (1/500e)** (menu ☰ Carte → Plans
   patrimoine).
2. **Survoler** le texte d'une référence (il s'illumine), **cliquer** pour la
   sélectionner (« Planche 1000-236 — sélectionné » en haut à gauche), puis
   **cliquer à nouveau** : la modification de CETTE étiquette commence, en
   quatre étapes (la barre indique l'étape en cours et sa consigne) :
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
3. Boutons de la barre d'étape :
   - **◀ Retour** : annule le positionnement du dernier point choisi (et
     revient à son étape) ; sans point choisi, revient à l'étape précédente ;
   - **Suivant ▶** : étape suivante en **gardant la valeur déjà enregistrée**
     (les **quatre choix sont indispensables**, y compris l'orientation) ; **choisir
     un point** (clic sur le texte ou sur le cadre) fait passer **aussi** à
     l'étape suivante, même si celle-ci a déjà une valeur ;
   - **↺** : remet l'étiquette dans l'état du début de cette modification ;
   - **Annuler** : abandonne la modification en cours, aucun changement ;
   - **✓ Terminer** : garde le positionnement (il faut les **quatre** choix) ;
     la modification reste à **enregistrer** (💾 du panneau de suivi).

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

## Numéros d'interstation

Couche « Numéros interstation » et réseau « Tunnels » affichés. **Survol**
(surbrillance), **premier clic** (sélection : « Interstation 648 —
sélectionné »), **second clic** (début de la modification, deux étapes) :

1. **Déplacer le texte, parallèlement au trajet du pointeur** : on appuie
   **n'importe où sur la carte** (souris, ou **doigt** sur écran tactile) et on
   glisse ; le texte se déplace du même vecteur que le pointeur, sans qu'il
   faille le saisir (le doigt ne le cache donc pas). Orientation horizontale ;
   la ligne de repère suit. La **carte est figée** pendant cette étape (la
   molette ou le pincement zooment toujours).
2. **Choisir le tronçon de rattachement** (**Suivant ▶**, la carte est alors
   libre) : le **survol** d'un tunnel (souris) allume son **axe** (orange épais,
   avec son milieu) et son contour ; un **clic** ou un **appui sans
   glissement** (moins de 5 px, y compris au doigt) le choisit. L'axe du
   tronçon actuel reste affiché en violet pointillé ; sans choix, le tronçon
   automatique (contour le plus proche) s'applique. La ligne de repère arrive
   au milieu de l'axe du tronçon choisi.

**✓ Terminer** garde le résultat (à enregistrer), **Annuler** l'abandonne,
**↺** remet la position et le tronçon d'origine. Les étiquettes modifiées
s'affichent dans la couleur opposée, comme les références de planche.
Enregistrement : `data/fond-de-plan/etiquettes-troncons.json` (`{ "version": 1, "crs": "EPSG:31370", "labels":
{ "648#0": { x, y, tunnel } } }` — position en Lambert 72, `id` du tronçon (référentiel)
du tunnel), route `/shared/fond-de-plan/etiquettes-troncons` du relais.

## Supprimer et créer des étiquettes

**Source unique** : les JSON de `data/fond-de-plan/` sont la liste COMPLÈTE des
étiquettes (planches : 37 ; tronçons : 86 au départ). Créer ou supprimer une
étiquette revient à ajouter ou retirer une entrée ; les fichiers d'origine
(`MetroLabels.shp`, `patrimoine-numero-interstation.json` : supprimés ou déplacés dans `data/legacy/`) ne servent plus
qu'à l'amorçage.

- **Supprimer** (uniquement en mode édition) : sélectionner l'étiquette
  (premier clic), puis **🗑** dans la barre, après **confirmation** (pas de code
  administrateur). Annulable avec ↶ tant que la page n'est pas rechargée ; la
  suppression n'est partagée qu'après 💾. Une fois enregistrée, l'étiquette reste
  récupérable dans l'historique Git du dépôt (chaque enregistrement est un commit).
- **Créer** : en mode édition, le bouton « ✚ Ajouter un point » de la barre
  d'outils devient **« ✚ Ajouter un élément »** (l'outil de mesure est masqué) et
  propose :
  - **Étiquette de planche** : survoler la planche concernée (elle s'illumine) et
    cliquer ; puis les quatre choix habituels. Une planche peut avoir plusieurs
    étiquettes (clé `<référence>#<rang>`, premier rang libre) ;
  - **Étiquette de tronçon** : saisir le numéro (ex. `243-3`) ; l'étiquette
    apparaît au centre de l'écran, rattachée au tunnel le plus proche ; puis les
    deux étapes habituelles (déplacer le texte, choisir le tronçon).

  **Annuler** pendant une création supprime l'étiquette sans laisser de trace.

## Annuler

**↶** annule la dernière opération de la session — modification, création ou
suppression —, une à la fois. Pas de « tout réinitialiser » : ↶ répété, ou
« Quitter l'édition » (recharge la page : les modifications non enregistrées
sont abandonnées après confirmation), couvrent ce besoin.

## Enregistrement dans l'application

Les modifications sont **enregistrées dans l'application**, partagées par
tous les visiteurs — pas dans le navigateur (rien n'est gardé dans
`localStorage`). Les références de planche vivent dans
`data/fond-de-plan/etiquettes-planches.json` (ancrages en Lambert 72), les
numéros d'interstation dans `data/fond-de-plan/etiquettes-troncons.json`
(dépôt), lus par l'application elle-même
(`src/peLabelAnchors.js`, `src/interstation.js`) : un visiteur sans le plugin
voit les étiquettes à leur nouvelle place.

- **💾** (panneau de suivi, bouton **✥ Mode édition**) envoie au
  relais serveur `relay/` les définitions des planches et/ou des tronçons
  (seulement celles qui ont changé) ; le relais commit chaque fichier dans le
  dépôt. Il utilise l'**adresse du relais** et le **code administrateur** des
  paramètres généraux (⚙ Paramètres > Serveur ; le code est masqué, gardé le
  temps de l'onglet seulement ; s'il manque, le plugin renvoie vers cet
  onglet). Les autres visiteurs voient le changement après le redéploiement
  de GitHub Pages (~1 min).
- Le panneau indique, pour chaque type, le nombre de modifications **non
  enregistrées** ; **✓ Terminer** seul applique la modification à l'écran
  (perdue au rechargement tant qu'elle n'est pas enregistrée).
- **Le relais est à déployer une fois** (compte Cloudflare gratuit, jeton
  GitHub) : voir `relay/README.md`, puis renseigner son adresse dans
  ⚙ Paramètres > Serveur (bouton **Tester** pour vérifier la connexion et le
  code ; l'adresse est enregistrée sur le serveur comme paramètre général).
  Tant que ce n'est pas fait, « Enregistrer » affiche un message explicite et
  n'écrit rien.
- L'export/import JSON manuel a été retiré de l'interface.

Les anciens réglages locaux (`localStorage`, versions précédentes du plugin)
ne sont plus lus.

## Fichiers

- `index.html` — page de lancement (récupère l'`index.html` de l'appli et
  y injecte le CSS/JS ci-dessous avant `</body>`).
- `pe-label-editor.css` — styles de la barre d'étape, des points et des panneaux.
- `pe-label-editor.js` — logique (voir l'en-tête du fichier : principe,
  calcul des points remarquables, alignement, persistance).
