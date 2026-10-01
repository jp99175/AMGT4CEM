# Plugin : éditeur d'étiquettes de planches (PE_label)

Placer et orienter chaque référence de planche (ex. « 1000-236 ») par
rapport au cadre de sa planche, en choisissant des points précis plutôt
qu'en glissant au jugé.

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

Servir le site normalement (le plugin a besoin d'http(s), pas de `file://`),
puis ouvrir `plugins/pe-label-editor/index.html` au lieu de `index.html`
(la page charge l'appli telle quelle et y ajoute ce plugin à la fin).

1. Afficher la couche **Plans d'ensemble (1/500e)** (menu ☰ Carte → Plans
   patrimoine).
2. **Cliquer dans le texte** d'une référence de planche : une bulle d'info
   affiche « Planche 1000-236 » avec l'icône **déplacer** (quatre flèches).
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
4. **Terminé** garde le résultat, **Annuler** revient à l'état d'avant,
   **Réinitialiser l'étiquette** revient à la position d'origine (PDF).

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

- **Enregistrer** (dans le panneau d'édition d'une étiquette, ou
  **Enregistrer dans l'application** dans le panneau d'administration)
  envoie TOUTES les définitions au relais serveur `relay/`, qui commit le
  fichier dans le dépôt. Il demande le **code administrateur** du relais
  (gardé le temps de l'onglet seulement). Les autres visiteurs voient le
  changement après le redéploiement de GitHub Pages (~1 min).
- Le panneau indique le nombre de modifications **non enregistrées** ;
  « Terminé (sans enregistrer) » applique la modification à l'écran
  seulement (perdue au rechargement).
- **Le relais est à déployer une fois** (compte Cloudflare gratuit, jeton
  GitHub) : voir `relay/README.md`, puis renseigner `peLabelAnchorsRelayUrl`
  dans `config.js`. Tant que ce n'est pas fait, « Enregistrer » affiche un
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
