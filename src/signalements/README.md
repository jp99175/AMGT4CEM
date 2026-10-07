# Plugin : Signalements

Application séparée, branchée sur la carte par `src/plugins.js` (déclarée dans `plugins` de `config.js`).
Elle ajoute au menu du bouton **✚ Ajouter un point ▾** les entrées **⚠ Signalement** et **⬆ Téléverser les fichiers sur le serveur** (à côté de **✚ Point métier**, l'outil d'origine), deux cases dans ☰ Carte (**Signalements et demandes**,
**Amiante (flux séparé)**) et son propre formulaire. Elle ne modifie aucun module du cœur et n'utilise pas
le stockage des points métier (« ✚ Ajouter un point », inchangé). `enabled: false` dans `config.js` la retire.

## Saisie

**✚ Ajouter un point ▾** > **⚠ Signalement**, puis clic sur la carte (y compris sur une station ou un tunnel) : un marqueur
déplaçable est posé et le formulaire s'ouvre.

| Champ | Règle |
|---|---|
| Nature | signalement ou demande |
| Type | selon la nature (voir `data/signalements/vocabulaire.json`) |
| Domaine technique | obligatoire, sauf pour les demandes du flux amiante |
| Date d'observation | aujourd'hui par défaut |
| Localisation précisée | texte libre (station, niveau, local, PK…) en plus de la position |
| Demandeur | qui a signalé ou demandé : à ne pas confondre avec le rédacteur (celui qui saisit) |
| Référence chez le demandeur | son numéro de ticket ou de dossier, s'il en a un |
| Description | texte libre |
| Photos | une ou plusieurs ; réduites à 1600 px (JPEG), empreinte SHA-256 de l'original conservée |

Types : `AVARIE`, `INFILTRATION` (signalements) ; `MODIFICATION`, `RENOUVELLEMENT`,
`MISE_A_JOUR_PLANS` (demandes), chacun avec l'un des trois domaines (gros œuvre, parachèvement,
drainage-égouttage-évacuation) ; `CONTROLE`, `INVENTAIRE_DESTRUCTIF`, `TRAITEMENT` (demandes du flux amiante).

## Flux amiante, séparé

Criticité oblige, le flux `AMIANTE` ne partage rien avec les autres signalements : stockage distinct,
couche et case propres, marqueur rouge en losange, bandeau d'avertissement, archive de dépôt à part. L'amiante
est un **contexte**, pas un domaine technique : le domaine y est facultatif.

## Référence

La référence officielle (`AAAA-NNNN`, par exemple `2026-0122`) est attribuée **par le serveur de dépôt à la
réception**, jamais ici : un navigateur hors ligne ne peut pas garantir l'unicité. Le signalement porte en
attendant son identifiant interne (UUID). Une fois attribuée, la référence est la clé primaire de la fiche ; le
marqueur prend alors un contour vert et ne se déplace plus.

## Envoi au serveur

1. Le signalement est d'abord **enregistré sur l'appareil** (localStorage, photos en IndexedDB) : il se saisit sans réseau.
2. **⬆ Envoyer au serveur** (fenêtre du marqueur) ou **⬆ Téléverser les fichiers sur le serveur** (menu du bouton
   ✚ Ajouter un point, tous les signalements en attente, avec le nombre entre parenthèses) envoie l'archive de
   dépôt au serveur `depot-signalements/` (voir son README). Le code d'accès est demandé une fois par onglet.
3. Le serveur répond par la référence, inscrite sur le signalement local. Renvoyer un signalement déjà reçu redonne la
   même référence (pas de doublon). En cas d'échec, le signalement reste sur l'appareil et peut être renvoyé.

Le serveur se déclare dans `config.js` : `plugins` > `signalements` > `options.serverUrl` (vide : pas d'envoi, les
boutons d'envoi sont masqués ou grisés).

## Export manuel

Le bouton **⬇ Exporter le dépôt (.zip)** du popup produit la même archive en téléchargement,
`FICH_<réf. courte>-<type court>_<AAAAMMJJ>_FR.zip` :

- `signalement.json` : schéma `amgt4cem-depot-signalement` (version 1), positions en Lambert 72 ; bloc
  `provenance` (demandeur et sa référence : identifiant externe, type `REF_DEMANDEUR`) ; `reference`
  et `redacteur` vides (référence attribuée par le serveur ; référentiel des intervenants à venir) ;
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
| `signalements.js` | plugin : bouton, couches, formulaire, placement, popup (enregistrement auprès de `AMGT4CEM_Plugins`) |
| `depot.js` | vocabulaire, noms de fichiers, contenu et export du dépôt |
| `envoi.js` | envoi de l'archive au serveur de dépôt, code d'accès (onglet) |
| `store.js` | stockage local, un par flux |
| `pieces-store.js` | photos (IndexedDB), réduction, empreintes |
| `zip-writer.js` | écriture d'une archive ZIP sans dépendance |
| `signalements.css` | styles propres au plugin |
| `../../data/signalements/vocabulaire.json` | vocabulaire public |
| `../../depot-signalements/` | serveur de dépôt (Cloudflare Worker + R2), attribue la référence |

## Retirer ou déplacer le plugin

Le dossier est autonome : `enabled: false` dans `config.js` le désactive ; le déplacer dans un autre dépôt
demande seulement de changer `base` dans la déclaration du plugin et de garder `vocabulaire.json` accessible.
