# Relais d'enregistrement (Cloudflare Worker)

Permet à l'application d'**enregistrer dans le dépôt** les données modifiées
par un administrateur :

- `PUT /shared/<dossier>/<fichier>` : toute donnée écrite par l'application,
  dans `data/<dossier>/<fichier>.json` — aujourd'hui le dossier
  **`plans-patrimoine`** (`etiquettes-planches` : ancrage/orientation des
  références de planche ; `etiquettes-troncons` : position et tronçon de
  rattachement des numéros d'interstation), modifiés avec le plugin
  `src/peLabelEditor/` ; plus tard `amiante`, `chantiers`...
  **`fonds-de-plan`** (`services` : adresse du relais et URL des services externes ;
  `urbis` : couche du fond UrbIS), modifiés dans ⚙ Paramètres ; **`urbis-topo`** et
  **`plans-patrimoine`** (`selection-par-defaut` : sélections par défaut partagées),
  modifiées depuis les sélecteurs de couches.
- `PUT /settings` : ancienne route des paramètres généraux (`data/app-settings.json`),
  **plus utilisée par l'application** depuis la refonte des données (tout passe par
  `/shared/…`) ; conservée dans le relais déjà déployé, sans effet.

**Une seule autorisation.** Le code administrateur (`ADMIN_TOKEN`) ouvre
toutes les routes : elles ne sont pas des droits distincts, ce sont des
chemins de fichiers. Un nouveau dossier ou un nouveau fichier ne demande donc
**ni modification ni redéploiement** du relais (seul `/settings`, au contrôle
strict, est une route à part). Si, plus tard, des utilisateurs non
administrateurs doivent écrire dans certains dossiers (signalements...), on
pourra attribuer un code distinct par dossier sans changer ce principe.

**Après une mise à jour de `worker.js`** (ex. passage aux routes
`/shared/<dossier>/<fichier>`), le relais doit être **redéployé** (`wrangler
deploy`, ou coller le nouveau `worker.js` dans le tableau de bord Cloudflare) :
tant que ce n'est pas fait, l'enregistrement correspondant répond « Route
inconnue ». C'est la **dernière** fois nécessaire pour de nouveaux jeux de données.

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
   L'adresse (adresse **sans** `/shared/…` ni `/settings` : l'application
   ajoute la route) est alors écrite par le relais dans
   `data/fonds-de-plan/services.json` (clé `relais`) : c'est un paramètre général, lu par tous les
   visiteurs après le redéploiement de GitHub Pages. Le code n'est gardé que
   le temps de l'onglet (`sessionStorage`), jamais sur disque.
5. Dans le mode édition des étiquettes, **Enregistrer dans l'application**
   utilise cette adresse et ce code.

## Ce que fait / refuse le relais

- `GET` avec le code administrateur : simple contrôle de connexion (bouton **Tester** de ⚙ Paramètres > Serveur), n'écrit rien.
- Pour écrire, accepte uniquement `PUT` avec `Authorization: Bearer <code administrateur>`
  (comparaison à temps constant) depuis une origine autorisée.
- `PUT /shared/<dossier>/<fichier>` : `{ "version": 1, "crs": "EPSG:31370", ... }`
  — format libre ; contrôles communs : `crs`, s'il est donné, vaut
  `EPSG:31370` ; dans un jeu `labels`, clés de la forme `numéro#rang` et toute
  coordonnée (`x`, `y`, `a1`, `a2`) en Lambert 72 belge (mètres). `<dossier>`,
  `<fichier>` : minuscules, chiffres, tirets.
- `PUT /settings` : `{ "version": 1, "settings": { urbisUrl?, urbisLayers?,
  brucielHistoriqueUrl?, brucielRecentUrl?, geocoderUrl?, relayUrl? } }` —
  clés connues seulement, adresses en `https://` (ou `http://localhost`).
- N'écrit que `data/<dossier>/<fichier>.json` (et, pour l'ancienne route, `data/app-settings.json`) (contenu : un enregistrement
  sans changement réel ne crée aucun commit).
- Le jeton GitHub n'est jamais renvoyé au navigateur.

Chaque enregistrement est un commit du dépôt (« Données « plans-patrimoine/etiquettes-planches » :
mise à jour (via l'application) ») : l'historique permet de revenir en
arrière.

## Tester sans déployer

`worker.js` n'utilise que `fetch`/`Request`/`Response` standard : il se teste
sous Node 18+ en important `validateShared` et le gestionnaire par défaut, avec un
faux `fetch` à la place de l'API GitHub.
