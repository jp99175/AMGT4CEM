# Relais d'enregistrement (Cloudflare Worker)

Permet à l'application d'**enregistrer dans le dépôt** les données modifiées
par un administrateur :

- `PUT /anchors` : définitions d'ancrage/orientation des références de planche
  (`data/pe-label-anchors.json`), modifiées avec le plugin
  `plugins/pe-label-editor/` ;
- `PUT /interstation` : position et tronçon de rattachement des étiquettes
  de numéro d'interstation (`data/interstation-labels.json`), modifiées avec
  le même plugin, en mode « tronçons » ;
- `PUT /settings` : paramètres généraux de l'application — adresses des
  services externes et adresse du relais (`data/app-settings.json`),
  modifiés dans ⚙ Paramètres.

**Après une mise à jour de `worker.js`** (ex. ajout de la route
`/interstation`), le relais doit être **redéployé** (`wrangler deploy`, ou
coller le nouveau `worker.js` dans le tableau de bord Cloudflare) : tant que ce
n'est pas fait, l'enregistrement correspondant répond « Route inconnue ».

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
4. Dans l'application : ⚙ Paramètres > onglet **Serveur** : coller l'adresse
   du relais et le code administrateur de l'étape 3, puis **Tester**
   (« Relais joignable, code administrateur accepté ») et **Enregistrer**.
   L'adresse (adresse **sans** `/anchors`, `/interstation` ni `/settings` : l'application
   ajoute la route) est alors écrite par le relais dans
   `data/app-settings.json` : c'est un paramètre général, lu par tous les
   visiteurs après le redéploiement de GitHub Pages. Le code n'est gardé que
   le temps de l'onglet (`sessionStorage`), jamais sur disque.
5. Dans le mode édition des étiquettes, **Enregistrer dans l'application**
   utilise cette adresse et ce code.

## Ce que fait / refuse le relais

- `GET` avec le code administrateur : simple contrôle de connexion (bouton **Tester** de ⚙ Paramètres > Serveur), n'écrit rien.
- Pour écrire, accepte uniquement `PUT` avec `Authorization: Bearer <code administrateur>`
  (comparaison à temps constant) depuis une origine autorisée.
- Valide le format : `{ "version": 1, "labels": { "1000-236#0": { r1, a1,
  r2?, a2? } } }` — points de référence parmi les 8 connus, coordonnées dans
  l'emprise de la Belgique, aucun champ en trop, 200 Ko maximum.
- `PUT /interstation` : `{ "version": 1, "labels": { "648#0": { x, y, tunnel } } }`
  — `x`, `y` : position du texte en Lambert 72 (mètres), `tunnel` : `ogc_fid`
  du tronçon (chiffres) ; aucun champ en trop.
- `PUT /settings` : `{ "version": 1, "settings": { urbisUrl?, urbisLayers?,
  brucielHistoriqueUrl?, brucielRecentUrl?, geocoderUrl?, relayUrl? } }` —
  clés connues seulement, adresses en `https://` (ou `http://localhost`).
- N'écrit que `data/pe-label-anchors.json`, `data/interstation-labels.json` et `data/app-settings.json` (contenu trié : un enregistrement
  sans changement réel ne crée aucun commit).
- Le jeton GitHub n'est jamais renvoyé au navigateur.

Chaque enregistrement est un commit du dépôt (« Étiquettes de planche : mise à
jour des ancrages (via l'application) ») : l'historique permet de revenir en
arrière.

## Tester sans déployer

`worker.js` n'utilise que `fetch`/`Request`/`Response` standard : il se teste
sous Node 18+ en important `validate` et le gestionnaire par défaut, avec un
faux `fetch` à la place de l'API GitHub.
