# Serveur de dépôt des signalements (Cloudflare Worker + R2)

Reçoit les signalements envoyés par le plugin `src/signalements/`, leur **attribue la référence officielle
`AAAA-NNNN`** (ex. `2026-0001`, compteur unique, remis à 1 chaque année de Bruxelles) et range
l'archive dans R2. **Distinct de `relay/`** : le relais écrit dans le dépôt GitHub (public) ; ce serveur n'y écrit
jamais, car le suivi n'entre pas dans le dépôt.

| Route | Rôle |
|---|---|
| `POST /depot` | corps = archive ZIP de dépôt ; en-têtes `X-Depot-Code`, `X-Signalement-Id`, `X-Flux` (`STANDARD` ; `AMIANTE` reste accepté pour d'anciens clients) ; répond `{ reference, deja, recuLe }` |
| `GET /sante` | vérifie l'adresse et le code d'accès |

- **Idempotent** : renvoyer le même signalement (même `X-Signalement-Id`) redonne la même référence, sans doublon
  ni numéro perdu ; un envoi interrompu se refait sans risque.
- **Rangement R2** : `standard/` (et `amiante/` pour d'anciens dépôts) · année · référence · `depot.zip` (l'archive reçue) et `recu.json`
  (référence, identifiant, nom de fichier, taille, date de réception).
- **Contrôles** : origine autorisée (`ALLOWED_ORIGINS`), code d'accès (`DEPOT_CODE`), flux valide, archive ZIP de 30 Mo au plus.
- **Le code d'accès est commun** : il montre l'appartenance au service, pas la personne. L'identification des
  rédacteurs (référentiel des intervenants, matricule) se branchera plus tard sur le même point d'entrée.

## Déploiement (une seule fois)

Prérequis : compte Cloudflare (gratuit, R2 demande d'activer l'offre gratuite), Node.js.

1. Dans `wrangler.toml`, vérifier `ALLOWED_ORIGINS` (l'adresse du site, par ex. `https://jp99175.github.io`, sans chemin).
2. Depuis ce dossier :
   ```
   npx wrangler login
   npx wrangler r2 bucket create amgt4cem-depots
   npx wrangler secret put DEPOT_CODE      # choisir le code d'accès (long) : à donner aux agents
   npx wrangler deploy
   ```
3. Noter l'adresse affichée (`https://amgt4cem-depot-signalements.<compte>.workers.dev`) et la mettre dans
   `config.js`, `plugins` > `signalements` > `options.serverUrl`.

Tant que `serverUrl` est vide, le plugin fonctionne comme avant : signalements sur l'appareil, export ZIP à la main.

## Tester en local

`npx wrangler dev --local` (avec un fichier `.dev.vars` contenant `DEPOT_CODE=...` et `ALLOWED_ORIGINS` du site de test)
simule R2 et le compteur. Vérifié ainsi : référence attribuée, renvoi idempotent, ancien flux amiante, code refusé, archive invalide.

## Relire les dépôts

Tableau de bord Cloudflare > R2 > `amgt4cem-depots`, ou `npx wrangler r2 object get amgt4cem-depots/standard/2026/2026-0001/depot.zip`.
