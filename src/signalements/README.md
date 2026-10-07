# Plugin : Signalements

Application séparée, branchée sur la carte par `src/plugins.js` (déclarée dans `plugins` de `config.js`).
Elle ajoute à la carte un bouton **⚠ Signalement**, deux cases dans ☰ Carte (**Signalements et demandes**,
**Amiante (flux séparé)**) et son propre formulaire. Elle ne modifie aucun module du cœur et n'utilise pas
le stockage des points métier (« ✚ Ajouter un point », inchangé). `enabled: false` dans `config.js` la retire.

## Saisie

Clic sur **⚠ Signalement**, puis clic sur la carte (y compris sur une station ou un tunnel) : un marqueur
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

La référence officielle (`AAAA-NNNN`, par exemple `2026-0122`) est attribuée **par le système à l'import**,
jamais ici : un navigateur hors ligne ne peut pas garantir l'unicité. Le signalement porte en attendant son
identifiant interne (UUID). Une fois attribuée, la référence est la clé primaire de la fiche.

## Dépôt

Le bouton **⬇ Exporter le dépôt (.zip)** du popup produit `FICH_<réf. courte>-<type court>_<AAAAMMJJ>_FR.zip` :

- `signalement.json` : schéma `amgt4cem-depot-signalement` (version 1), positions en Lambert 72 ; bloc
  `provenance` (demandeur et sa référence : identifiant externe à l'import, type `REF_DEMANDEUR`) ; `reference`
  et `redacteur` vides (référence attribuée à l'import ; référentiel des intervenants à venir) ;
- les photos `IMG_<réf. courte>-<type>-<domaine>-<n°>_<AAAAMMJJ>_MX.jpg`.

Les noms suivent la convention de nommage de l'organisation `TYPE_Titre_date_LANGUE` : `IMG` (images) et
`VID` (vidéos) adaptent le type `AUDI` de la liste STIB, jugé trop général. Aucun nom, initiales ni
matricule dans les noms de fichiers.

## Limites actuelles

Signalements et photos restent dans le navigateur de chaque agent (localStorage et IndexedDB) : sans
export, ils ne sont ni partagés ni sauvegardés, et ils sont perdus si les données du site sont effacées.
Le stockage partagé du suivi, le stockage des photos (Cloudflare R2) et l'identification des rédacteurs
restent à décider ou à construire (voir le document de conception). Les signalements ne sont pas encore
trouvables par la recherche de la carte.

## Fichiers

| Fichier | Rôle |
|---|---|
| `signalements.js` | plugin : bouton, couches, formulaire, placement, popup (enregistrement auprès de `AMGT4CEM_Plugins`) |
| `depot.js` | vocabulaire, noms de fichiers, contenu et export du dépôt |
| `store.js` | stockage local, un par flux |
| `pieces-store.js` | photos (IndexedDB), réduction, empreintes |
| `zip-writer.js` | écriture d'une archive ZIP sans dépendance |
| `signalements.css` | styles propres au plugin |
| `../../data/signalements/vocabulaire.json` | vocabulaire public |

## Retirer ou déplacer le plugin

Le dossier est autonome : `enabled: false` dans `config.js` le désactive ; le déplacer dans un autre dépôt
demande seulement de changer `base` dans la déclaration du plugin et de garder `vocabulaire.json` accessible.
