# Plugin : éditeur d'étiquettes de planches (PE_label)

Placer et orienter chaque référence de planche (ex. « 1000-236 ») par
rapport au cadre de sa planche, en choisissant des points précis plutôt
qu'en glissant au jugé.

**Ne modifie aucun fichier de l'application.** Tous les fichiers du plugin
vivent dans ce dossier ; le désinstaller = supprimer ce dossier.

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
      1. les **sommets** du polygone (carré plein) ;
      2. le **centre de chaque côté** du polygone (petit carré clair) ;
      3. les **intersections** avec d'autres planches (rond doré) ;
      4. le **centre de chaque segment** que les points précédents délimitent
         sur le cadre (losange).

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

## Sauvegarde

Ce plugin n'a pas accès aux fichiers du dépôt : les définitions (les 4
points de chaque étiquette modifiée) sont gardées dans le navigateur
(`localStorage`, clé `amgt4cem-ple-overrides-v4`), pas partagées avec les
autres visiteurs. Le bouton **✥ Étiquettes planches** (en bas à droite)
ouvre le panneau d'administration :

- **Exporter JSON** : télécharge les définitions, avec le résultat calculé
  (ancre, point de référence, rotation CSS) — à transmettre à qui maintient
  `Metro_export_SHP/MetroLabels.shp` pour les rendre permanentes.
- **Importer JSON** : recharge un export.
- **Tout réinitialiser**.

Les anciens réglages (versions précédentes du plugin : position et angle
libres, accroche magnétique) ne sont pas repris : le modèle a changé.

## Fichiers

- `index.html` — page de lancement (récupère l'`index.html` de l'appli et
  y injecte le CSS/JS ci-dessous avant `</body>`).
- `pe-label-editor.css` — styles de la bulle, des points et des panneaux.
- `pe-label-editor.js` — logique (voir l'en-tête du fichier : principe,
  calcul des points remarquables, alignement, persistance).
