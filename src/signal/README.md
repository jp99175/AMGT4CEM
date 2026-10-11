# SIG4CEM : saisie des signalements et demandes (`home.html?app=signal`)

Interface de saisie, **séparée de la carte AMGT4CEM** (`home.html?app=carto`) : elle ne renvoie jamais vers elle.
Elle embarque son propre écran de carte, juste pour choisir le point. Chargée par `src/router.js` d'après la liste
`apps.signal` de `config.js`.

## Parcours « Nouvelle entrée »

1. **Formulaire, tout de suite.** « Nouvelle entrée » ouvre directement le formulaire complet : type > domaine technique,
   **titre** (obligatoire), date d'observation, **localisation**, précision du lieu (texte libre), demandeur (et sa référence),
   description, photos (prise directe ou fichiers ; réduites à 2000 px, JPEG 85). **Annuler** supprime l'entrée et ses photos.
2. **Localisation.** Facultative mais fortement conseillée (une confirmation est demandée si elle manque). Un toucher dans
   le champ ouvre la carte (fond UrbIS, même socle que la carte : `crs.js`, `services.js`, `basemap.js`) ; un toucher pose un
   marqueur déplaçable, **Valider la position** revient au formulaire sans effacer la saisie. ✕ retire la position.
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
texte en zone transparente, modifiable, déplaçable, de taille et couleur réglables) saisies dans `photoEditor.js`. La photo n'est jamais modifiée : les annotations sont enregistrées à part, sur un
calque PNG transparent (grand côté 1000 px) superposé à l'affichage, avec les traits (coordonnées relatives) pour les
reprendre. Dans l'archive de dépôt : `IMG_…_MX.jpg` (photo), `IMG_…_MX_ANNOT.png` (calque) et, dans `signalement.json`,
`pieces[i].commentaire` et `pieces[i].annotations` (nom, taille, SHA-256), champs facultatifs (schéma version 1).
Reste à faire : recadrage.

## À faire

Interruption d'un envoi en cours ; verrouillage d'une entrée après traitement ; motif de révision ; recadrage des photos ; fond de carte hors connexion.

## Réviser une entrée envoyée

Lien **✎ Modifier (nouvelle version)** dans « Mes dernières entrées » et « Toutes les entrées », et **✎ Modifier cette entrée** dans la bulle de la
carte (`?app=signal&edit=AAAA-NNNN`). Tout agent connecté peut réviser. L'archive de la dernière version est téléchargée du serveur et
reconstituée sur l'appareil (champs, photos, calques et traits d'annotations) ; l'entrée garde son identifiant. Les photos ne changent pas :
seul le calque d'annotations peut être remplacé. Une révision ouverte puis abandonnée, ou enregistrée sans changement, ne laisse rien.
Enregistrer une modification donne la version suivante (v0.NN+1) et ajoute le compte aux contributeurs ; l'envoi dépose la nouvelle version
sous la même référence, l'ancienne est gardée côté serveur (`historique/`).

## Supprimer une entrée du système

Icône 🗑 alignée à droite du cadre (« Mes dernières entrées », « Toutes les entrées ») et de la bulle de la carte. Visible pour le rédacteur de
l'entrée et pour les administrateurs ; le serveur le revérifie. La suppression retire l'entrée de la carte et des listes de tous les agents
(confirmation demandée) ; l'archive reste dans R2, sans être relisible depuis l'application. Les brouillons locaux se suppriment comme avant
(cases à cocher de « Draft »).

## Identification

Le menu a trois rubriques : **Nouvelle entrée** (un sous-élément par formulaire ; pour l'instant Signalement/demande), **Mes entrées** (Draft, Téléversement en cours, Mes dernières entrées) et **Toutes les entrées** (une ligne par formulaire, avec le nombre d'entrées actives du système ; connexion requise).

Chaque entrée porte un **rédacteur** (le créateur, matricule) et des **contributeurs** (matricules de ceux qui l'ont modifiée : enregistrer sans rien changer, ou envoyer, n'ajoute personne). Ces informations ne figurent pas dans le formulaire : elles viennent de la session connectée au moment de l'enregistrement (ou, à défaut, de l'envoi) et partent dans `signalement.json` (`redacteur`, `contributeurs`). Elles apparaissent dans la fiche dépliée d'une entrée envoyée.

Le pied du menu indique « Connecté : Prénom Nom (matricule) » ou « Non connecté ». L'envoi redemande la connexion si besoin ;
les brouillons et les entrées restent sur l'appareil sans connexion. Première connexion : lien reçu par email
(`?app=signal&m=matricule&code=…`) qui ouvre l'écran d'activation (choix du mot de passe). Modules : `src/auth/`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `signal.js` | écrans, menu, enregistrement et envoi |
| `entries.js` | stockage IndexedDB, statuts, compteurs ; constructeur DOM `SIG4CEM.h` |
| `mapPicker.js` | écran carte : choix du point |
| `form.js` | formulaire et photos (nouvelle entrée ou modification) |
| `all.js` | « Toutes les entrées » : les entrées actives du système (index du serveur), lecture seule, par formulaire |
| `list.js` | listes « Mes entrées » : brouillons, envois en cours, dernières entrées |
| `signal.css` | styles (pensés pour le téléphone) |
| `../auth/` | session et écran de connexion / première connexion (communs avec la page admin) |
| `../signalements/` | modules repris du plugin : vocabulaire et archive (`depot.js`), photos (`pieces-store.js`), envoi (`envoi.js`) |
tools/stamp-build.sh : horodatage du build, lancé par le hook git pre-commit (.git/hooks, non versionné : à recréer sur un autre clone).
