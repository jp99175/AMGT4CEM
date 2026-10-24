# Modules de dépôt des signalements (communs à SIG4CEM)

> **État** : l'ancien plugin de la carte (bouton, formulaire, stockage local `store.js`) a été **supprimé** ; ses
> données d'essai sont effacées des appareils. Ce dossier ne garde que les modules repris par SIG4CEM
> (`home.html?app=signal`, `src/signal/`) : photos (`pieces-store.js`), archive ZIP (`zip-writer.js`,
> `zip-reader.js`), vocabulaire et noms de fichiers (`depot.js`), envoi (`envoi.js`), PDF (`pdf.js`), révision
> (`importer.js`). L'adresse du serveur est dans `config.js`, bloc `depot`. Ce qui suit décrit les règles de
> saisie et de dépôt, toujours valables dans SIG4CEM.

## Saisie

**✚ Ajouter un point ▾** > **⚠ Signalement**, puis clic sur la carte (y compris sur une station ou un tunnel) : un marqueur
déplaçable est posé et le formulaire s'ouvre.

| Champ | Règle |
|---|---|
| Type | voir l'arborescence ci-dessous (`data/signalements/vocabulaire.json`) |
| Domaine technique | selon le type : obligatoire, facultatif ou absent (voir l'arborescence ci-dessous) |
| Date d'observation | aujourd'hui par défaut |
| Localisation précisée | texte libre (station, niveau, local, PK…) en plus de la position |
| Demandeur | qui a signalé ou demandé : à ne pas confondre avec le rédacteur (celui qui saisit) |
| Référence chez le demandeur | son numéro de ticket ou de dossier, s'il en a un |
| Description | texte libre |
| Photos | une ou plusieurs ; réduites à 1600 px (JPEG), empreinte SHA-256 de l'original conservée |

Arborescence (vocabulaire version 4, `data/signalements/vocabulaire.json`) : **deux niveaux seulement**, type puis
domaine technique. La nature (signalement ou demande) n'est plus choisie : elle découle du type et reste dans les données.

| Type | Nature (dérivée) | Domaine technique |
|---|---|---|
| Avarie | signalement | gros œuvre, parachèvement, drainage-égouttage-évacuation (obligatoire) |
| Infiltration / écoulement | signalement | sans objet |
| Application amiante | signalement | sans objet |
| Demande de modification / renouvellement | demande | gros œuvre, parachèvement, drainage-égouttage-évacuation (obligatoire) |

Sont abandonnés, et marqués `obsolete` (codes conservés, entrées déjà saisies lisibles et modifiables) : « Mise à jour des
plans », « Modification » et « Renouvellement » (fusionnés dans la demande ci-dessus), les anciennes demandes amiante
(contrôle, inventaire destructif, traitement). La « demande de modification documentaire » est retirée : le signalement
d'une incohérence dans les plans sera prévu ailleurs.

## Un seul formulaire

Tous les signalements et demandes passent par le même formulaire et le même stockage. Le champ « Domaine technique »
reste affiché ; il est grisé (« Sans objet pour ce type ») quand le type n'en accepte pas (infiltration, application
amiante). L'application amiante est un simple type ; son marqueur sur la carte est un losange rouge.

## Référence

La référence officielle (`AAAA-NNNN`, par exemple `2026-0122`) est attribuée **par le serveur de dépôt à la
réception**, jamais ici : un navigateur hors ligne ne peut pas garantir l'unicité. Le signalement porte en
attendant son identifiant interne (UUID). Une fois attribuée, la référence est la clé primaire de la fiche ; le
marqueur prend alors un contour vert et ne se déplace plus.

## Envoi au serveur

1. Le signalement est d'abord **enregistré sur l'appareil** (localStorage, photos en IndexedDB) : il se saisit sans réseau.
2. **⬆ Envoyer au serveur** (fenêtre du marqueur) ou **⬆ Téléverser les fichiers sur le serveur** (menu du bouton
   ✚ Ajouter un point, tous les signalements en attente, avec le nombre entre parenthèses) envoie l'archive de
   dépôt au serveur `workers/depot/` (voir son README). Le code d'accès est demandé une fois par onglet.
3. Le serveur répond par la référence, inscrite sur le signalement local. Renvoyer un signalement déjà reçu redonne la
   même référence (pas de doublon). En cas d'échec, le signalement reste sur l'appareil et peut être renvoyé.

Le serveur se déclare dans `config.js` : `plugins` > `signalements` > `options.serverUrl` (vide : pas d'envoi, les
boutons d'envoi sont masqués ou grisés).

## Export manuel

Le bouton **⬇ Exporter le dépôt (.zip)** du popup produit la même archive en téléchargement,
`FICH_<réf. courte>-<type court>_<AAAAMMJJ>_FR.zip` :

- `signalement.json` : schéma `amgt4cem-depot-signalement` (version 1), positions en Lambert 72 ; bloc
  `provenance` (demandeur et sa référence : identifiant externe, type `REF_DEMANDEUR`) ; `reference`
  vide (attribuée par le serveur) ; `redacteur` (matricule du créateur) et `contributeurs` (matricules de ceux qui ont
  ajouté ou révisé la fiche) viennent de la session connectée, jamais du formulaire ;
- les photos `IMG_<réf. courte>-<type>-<domaine>-<n°>_<AAAAMMJJ>_MX.jpg`.

Les noms suivent la convention de nommage de l'organisation `TYPE_Titre_date_LANGUE` : `IMG` (images) et
`VID` (vidéos) adaptent le type `AUDI` de la liste STIB, jugé trop général. Aucun nom, initiales ni
matricule dans les noms de fichiers.

## Limites actuelles

Tant qu'un signalement n'est pas envoyé, il n'existe que dans le navigateur de l'agent : il est perdu si les
données du site sont effacées. Une fois envoyé, la copie du serveur fait foi, mais l'application ne relit pas
encore le serveur (pas de vue partagée des signalements des autres agents). Les photos partent dans l'archive ;
leur stockage séparé et l'identification des rédacteurs restent à construire. Les signalements ne sont pas
encore trouvables par la recherche de la carte.

## Fichiers

| Fichier | Rôle |
|---|---|
| `depot.js` | vocabulaire, noms de fichiers, contenu et export du dépôt |
| `envoi.js` | envoi de l'archive au serveur de dépôt, code d'accès (onglet) |
| `pieces-store.js` | photos (IndexedDB), réduction, empreintes |
| `zip-writer.js` | écriture d'une archive ZIP sans dépendance |
| `../../data/signalements/vocabulaire.json` | vocabulaire public |
| `../../depot-signalements/` | serveur de dépôt (Cloudflare Worker + R2), attribue la référence |

## Retirer ou déplacer le plugin

Le dossier est autonome : `enabled: false` dans `config.js` le désactive ; le déplacer dans un autre dépôt
demande seulement de changer `base` dans la déclaration du plugin et de garder `vocabulaire.json` accessible.
