# Relais d'enregistrement (Cloudflare Worker)

Permet à l'application d'**enregistrer dans le dépôt** les définitions
d'ancrage/orientation des références de planche (`data/pe-label-anchors.json`),
modifiées par un administrateur avec le plugin `plugins/pe-label-editor/`.

Pourquoi un relais : un navigateur ne peut pas écrire directement dans le
dépôt (l'API GitHub refuse les requêtes préparatoires CORS d'un navigateur,
voir README principal section 6). Le relais reçoit la demande de l'appli,
vérifie le code administrateur, valide le contenu, puis appelle lui-même
l'API GitHub (de serveur à serveur, pas de CORS). Le fichier reste dans le
dépôt, versionné, et GitHub Pages le redéploie : tous les visiteurs voient
alors les étiquettes à leur nouvelle place.

Gratuit (offre gratuite Cloudflare Workers). À déployer **une seule fois**.

## Déploiement

Prérequis : un compte Cloudflare (gratuit), Node.js installé.

1. **Jeton GitHub** : GitHub → Settings → Developer settings → Fine-grained
   personal access tokens → nouveau jeton, limité au seul dépôt
   `jp99175/AMGT4CEM`, permission **Contents : Read and write**.
2. **Configuration** : dans `wrangler.toml`, vérifier
   - `GITHUB_BRANCH` : la branche **déployée par GitHub Pages** ;
   - `ALLOWED_ORIGINS` : l'adresse du site (ex. `https://jp99175.github.io`),
     avec `,http://localhost:8765` pour tester en local.
3. Depuis ce dossier :
   ```
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN     # coller le jeton de l'étape 1
   npx wrangler secret put ADMIN_TOKEN      # choisir un code administrateur (long, aléatoire)
   npx wrangler deploy
   ```
   `wrangler deploy` affiche l'adresse du relais
   (`https://amgt4cem-pe-label-relay.<compte>.workers.dev`).
4. Dans `config.js`, renseigner cette adresse :
   ```js
   peLabelAnchorsRelayUrl: 'https://amgt4cem-pe-label-relay.<compte>.workers.dev',
   ```
5. Dans le plugin, **Enregistrer** demande le code administrateur de
   l'étape 3 (gardé le temps de l'onglet seulement, jamais sur disque).

## Ce que fait / refuse le relais

- Accepte uniquement `PUT` avec `Authorization: Bearer <code administrateur>`
  (comparaison à temps constant) depuis une origine autorisée.
- Valide le format : `{ "version": 1, "labels": { "1000-236#0": { r1, a1,
  r2?, a2? } } }` — points de référence parmi les 8 connus, coordonnées dans
  l'emprise de la Belgique, aucun champ en trop, 200 Ko maximum.
- N'écrit que `data/pe-label-anchors.json` (contenu trié : un enregistrement
  sans changement réel ne crée aucun commit).
- Le jeton GitHub n'est jamais renvoyé au navigateur.

Chaque enregistrement est un commit du dépôt (« Étiquettes de planche : mise à
jour des ancrages (via l'application) ») : l'historique permet de revenir en
arrière.

## Tester sans déployer

`worker.js` n'utilise que `fetch`/`Request`/`Response` standard : il se teste
sous Node 18+ en important `validate` et le gestionnaire par défaut, avec un
faux `fetch` à la place de l'API GitHub.
