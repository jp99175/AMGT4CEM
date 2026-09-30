# Plugin : éditeur d'étiquettes de planches (PE_label)

Petit plugin autonome pour déplacer et réorienter à la souris les
étiquettes de référence de planche (ex. « 1000-236 »), avec des points
d'accroche magnétiques le long du contour des planches — utile pour
corriger à la main les quelques cas où la position/rotation reprise
d'INFRAVIEW.pdf ne convient pas.

**Ne modifie aucun fichier de l'application.** Tous les fichiers du plugin
vivent dans ce dossier ; le désinstaller = supprimer ce dossier.

## Utilisation

Servir le site normalement (ce plugin a besoin d'http(s), pas d'une
ouverture directe en `file://`), puis ouvrir :

```
plugins/pe-label-editor/index.html
```

au lieu de `index.html`. Cette page charge l'application normale (elle
récupère le vrai `index.html` tel quel) et y ajoute juste ce plugin à la
fin, après que tous les scripts de l'appli aient fini de s'exécuter.

Une fois la carte affichée :

1. Activer la couche **Plans d'ensemble (1/500e)** (menu ☰ Carte → Plans
   patrimoine) si ce n'est pas déjà fait — les étiquettes doivent être
   visibles pour être éditées.
2. Cliquer sur le bouton **🧲 Étiquettes planches** en bas à droite.
3. Pour chaque étiquette apparaissent deux poignées :
   - **point orange** : glisser pour déplacer l'étiquette. En s'approchant
     à moins de 12 m d'un point gris (généré tous les 15 m le long du
     contour de chaque planche), elle s'y accroche automatiquement et
     reprend l'orientation locale du bord — pratique pour aligner
     l'étiquette le long d'une planche.
   - **point bleu** : glisser pour réorienter librement l'étiquette
     (toujours disponible, y compris après un accrochage magnétique).
4. Les réglages sont sauvegardés automatiquement dans le navigateur
   (`localStorage`) à chaque relâchement de souris — ils persistent d'une
   visite à l'autre sur le même navigateur/appareil, mais ne sont PAS
   partagés avec les autres visiteurs (ce plugin n'a pas accès au dépôt).
5. Boutons du panneau :
   - **Réinitialiser** : revient à la position/orientation d'origine
     (celle extraite du PDF) pour toutes les étiquettes.
   - **Exporter JSON** : télécharge les réglages actuels — à transmettre à
     qui maintient le Shapefile (`Metro_export_SHP/MetroLabels.shp`,
     champs `code`/`angle`) pour les rendre permanents dans l'application.
   - **Importer JSON** : recharge des réglages précédemment exportés.
   - **Fermer** : quitte le mode édition (les réglages restent sauvegardés).

## Fichiers

- `index.html` — page de lancement (récupère l'`index.html` de l'appli et
  y injecte le CSS/JS ci-dessous avant `</body>`).
- `pe-label-editor.css` — styles du panneau et des poignées.
- `pe-label-editor.js` — logique du plugin (voir commentaire d'en-tête du
  fichier pour le détail technique : accès aux objets globaux de l'appli,
  génération des points d'accroche, persistance).
