# SIG4CEM : saisie des signalements et demandes (`home.html?app=signal`)

Interface de saisie, **séparée de la carte AMGT4CEM** (`home.html?app=carto`) : elle ne renvoie jamais vers elle.
Elle embarque son propre écran de carte, juste pour choisir le point. Chargée par `src/router.js` d'après la liste
`apps.signal` de `config.js`.

## Parcours « Nouvelle entrée »

1. **Carte, tout de suite.** Fond UrbIS (même socle que la carte : `crs.js`, `services.js`, `basemap.js`). Un toucher pose
   un marqueur déplaçable (la position GPS de l'appareil est en suspens, retirée de la carte) ; **Valider la position** ouvre le formulaire.
2. **Formulaire.** Type > domaine technique, date d'observation, localisation précisée, demandeur (et sa référence),
   description, photos (prise directe ou fichiers ; réduites à 2000 px, JPEG 85). **Modifier la position** revient à la carte
   sans effacer la saisie ; **Annuler** supprime l'entrée et ses photos.
3. **Deux enregistrements.** **Enregistrer en local** : brouillon (`draft`). **Enregistrer et envoyer** : envoi demandé (`file`),
   puis `envoye` (référence attribuée par le serveur) ou `erreur`. Sans serveur configuré
   (`plugins` > `signalements` > `options.serverUrl`), l'entrée reste `file` et attend.

## Cycle d'une entrée

`draft` → `file` → `envoye` (ou `erreur`, à relancer). L'identifiant (UUID) est créé sur l'appareil ; la référence publique
`AAAA-NNNN` vient du serveur. Stockage : IndexedDB (`amgt4cem-signal`), photos dans `amgt4cem-pieces`.

## Listes « Mes entrées »

Les trois lignes du menu ouvrent une liste (`list.js`) :

- **Draft** : brouillons locaux, avec cases à cocher (et « tout sélectionner »). **Envoyer la sélection**, **Supprimer**. Un toucher sur une entrée la rouvre dans le formulaire (même écran que « Nouvelle entrée », titre « Modifier l'entrée ») : « Annuler » ne supprime rien de ce qui était déjà enregistré.
- **Téléversement en cours** : envois demandés mais pas reçus (en attente, ou en erreur avec le message exact). **Relancer l'envoi**, **Repasser en brouillon**, **Supprimer**.
- **Mes dernières entrées** : entrées reçues par le serveur, avec leur référence ; filtre 7 jours, 1 mois ou entre deux dates (date d'envoi). Lecture seule.

Au premier lancement, les signalements saisis avec l'ancien outil de la carte (localStorage) sont repris dans Draft ou, s'ils ont une référence, dans les dernières entrées ; les données d'origine ne sont pas touchées.

## Menu

Compteurs réels : Nouvelle entrée et Draft = brouillons en local ; Téléversement en cours = (encore en local / déjà sur le
serveur) pour l'envoi en cours ; Mes dernières entrées = entrées envoyées. Un bandeau rouge signale les entrées en erreur.

## Carte de choix du point

Elle affiche ce que la sélection locale de la carte affiche (lue dans le localStorage du même navigateur) : réseau
(stations, tunnels, planches, via `src/network.js`), UrbIS Topo et Plans patrimoine avec leurs opacités, numéros
d'interstation. Pas de points métier. Seuls points affichés : les entrées locales non encore téléversées.
`src/signal/shims.js` fournit le stub `AMGT4CEM_AddPointTool` attendu par `metroLayer.js`.

## Photos : commentaire et annotations

Chaque photo (réduite à 2000 px, JPEG 85) a un commentaire texte et, au choix, des annotations (crayon, flèche, cercle,
texte) saisies dans `photoEditor.js`. La photo n'est jamais modifiée : les annotations sont enregistrées à part, sur un
calque PNG transparent (grand côté 1000 px) superposé à l'affichage, avec les traits (coordonnées relatives) pour les
reprendre. Dans l'archive de dépôt : `IMG_…_MX.jpg` (photo), `IMG_…_MX_ANNOT.png` (calque) et, dans `signalement.json`,
`pieces[i].commentaire` et `pieces[i].annotations` (nom, taille, SHA-256), champs facultatifs (schéma version 1).
Reste à faire : recadrage.

## À faire

Interruption d'un envoi en cours ; révisions d'une entrée déjà envoyée ; recadrage des photos ; identité des
utilisateurs ; fond de carte hors connexion.

## Fichiers

| Fichier | Rôle |
|---|---|
| `signal.js` | écrans, menu, enregistrement et envoi |
| `entries.js` | stockage IndexedDB, statuts, compteurs ; constructeur DOM `SIG4CEM.h` |
| `mapPicker.js` | écran carte : choix du point |
| `form.js` | formulaire et photos (nouvelle entrée ou modification) |
| `list.js` | listes « Mes entrées » : brouillons, envois en cours, dernières entrées |
| `signal.css` | styles (pensés pour le téléphone) |
| `../signalements/` | modules repris du plugin : vocabulaire et archive (`depot.js`), photos (`pieces-store.js`), envoi (`envoi.js`) |
tools/stamp-build.sh : horodatage du build, lancé par le hook git pre-commit (.git/hooks, non versionné : à recréer sur un autre clone).
