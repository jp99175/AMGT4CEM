# Copie des données de la nappe phréatique dans R2 (Worker `nappe-sync`)

Le service régional (WFS de Bruxelles Environnement) répond parfois en **HTTP 502**, alors que les isopièzes du modèle ne
changent plus depuis mai 2013. Ce Worker récupère les données **une fois**, les range dans R2 (**partie publique**,
`public/nappe/`) et les **revérifie périodiquement**. La carte lit cette copie en priorité ; elle la garde aussi sur
l'appareil (cache du navigateur) et ne s'adresse au service régional qu'à défaut des deux.

| Route | Accès | Rôle |
|---|---|---|
| `GET /nappe/etat.json` | public | état de chaque jeu : empreinte, date de dernière vérification, date de dernier changement, dernière erreur |
| `GET /nappe/isopieses.json` · `GET /nappe/stations.json` | public | GeoJSON complet du jeu, Lambert 72 |
| `GET /nappe/sync` | secret `SYNC_CODE` (en-tête `X-Sync-Code`, ou `?code=…` dans l'adresse) | synchronisation immédiate de tous les jeux |

- **Contrôle de fraîcheur** : le Worker passe toutes les 6 heures (`wrangler.toml`, `crons`). Un jeu n'est réinterrogé que
  s'il est « échu » (`synchro.intervalleJours` dans `data/nappe/parametres.json` : 30 jours pour les isopièzes, 1 jour pour
  les stations) **ou** si sa dernière tentative a échoué. Il n'est remplacé que si son **empreinte (SHA-256) change**.
- **Service en panne** : jusqu'à 4 essais espacés (2 s, 6 s, 15 s) ; en cas d'échec, l'ancienne copie reste servie et
  l'erreur est notée dans `etat.json` (`derniereErreur`).
- **Réglages** : adresses des services et couches sont lues à chaque passage dans le site publié (`SITE_URL`) : mêmes fichiers
  que la carte (`data/fonds-de-plan/services.json`, `data/nappe/parametres.json`). Pas besoin de redéployer pour les changer.
- **Temps processeur** : le GeoJSON n'est jamais décodé dans le Worker (contrôle par recherche de texte, empreinte calculée par
  le système) pour rester sous la limite de l'offre gratuite (erreur 1102).
- **Limite** : seules les **positions et attributs** des stations sont copiés. Les niveaux mesurés (chroniques horaires) ne
  sont pas dans ce WFS ; ils passent par BruWater (voir `data/nappe/parametres.json`).

## Déploiement (une seule fois)

Même bucket que le serveur de dépôt (`amgt4cem-depots`), préfixe `public/nappe/` : rien d'autre n'est touché.

1. Depuis ce dossier :
   ```
   npx wrangler login
   npx wrangler secret put SYNC_CODE      # chaîne aléatoire : protège /nappe/sync
   npx wrangler deploy
   ```
   (ou, depuis le tableau de bord Cloudflare : importer le dépôt GitHub, dossier racine `nappe-sync`, puis ajouter le secret
   `SYNC_CODE` dans Settings > Variables et secrets.)
2. Noter l'adresse affichée (`https://amgt4cem-nappe-sync.<compte>.workers.dev`) et la saisir dans
   `data/fonds-de-plan/services.json`, clé `nappe-sync`, champ `url`.
3. Lancer la première synchronisation sans attendre le prochain passage (depuis un terminal) :
   ```
   curl -H "X-Sync-Code: <le secret>" https://amgt4cem-nappe-sync.<compte>.workers.dev/nappe/sync
   ```
   ou, sans terminal, en ouvrant dans un navigateur
   `https://amgt4cem-nappe-sync.<compte>.workers.dev/nappe/sync?code=<le secret>` (peut durer une minute).
   La réponse est l'état : chaque jeu doit indiquer `"disponible": true` et `"derniereErreur": null`.
   Si une erreur apparaît (nom de couche, 502 persistant...), elle est écrite dans `derniereErreur`.
4. `ALLOWED_ORIGINS` (`wrangler.toml`) doit contenir l'adresse du site (`https://jp99175.github.io`).
