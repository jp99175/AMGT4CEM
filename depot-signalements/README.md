# Serveur de dépôt des signalements (Cloudflare Worker + R2)

Reçoit les signalements envoyés par le plugin `src/signalements/`, leur **attribue la référence officielle
`AAAA-NNNN`** (ex. `2026-0001`, compteur unique, remis à 1 chaque année de Bruxelles) et range
l'archive dans R2. **Distinct de `relay/`** : le relais écrit dans le dépôt GitHub (public) ; ce serveur n'y écrit
jamais, car le suivi n'entre pas dans le dépôt.

| Route | Accès | Rôle |
|---|---|---|
| `POST /auth/login` | public | `{ matricule, motdepasse }` → jeton (30 jours) + identité |
| `POST /auth/activer` | public | `{ matricule, code, motdepasse }` : première connexion avec le code reçu par email. Référentiel vide : le code d'amorçage `ADMIN_BOOTSTRAP_CODE` crée ce matricule comme premier administrateur |
| `GET /auth/moi` · `POST /auth/motdepasse` | jeton | identité courante · changement de mot de passe |
| `POST /depot` | jeton | corps = archive ZIP ; en-têtes `Authorization: Bearer …`, `X-Signalement-Id`, `X-Flux` (`STANDARD`), `X-Fichier` ; répond `{ reference, deja, recuLe }` ; le matricule du rédacteur est noté dans `recu.json` |
| `GET /signalements` | jeton | index des entrées envoyées (référence, type, titre, position Lambert 72, version, rédacteur et contributeurs avec leurs noms) : lu par la couche « Signalements et demandes » de la carte |
| `GET /signalements/AAAA-NNNN/archive` | jeton | archive ZIP de la dernière version d'une entrée (pour la rouvrir et la réviser) |
| `POST /signalements/AAAA-NNNN/supprimer` | jeton | supprime l'entrée du système (rédacteur ou administrateur) : retirée de l'index, donc de la carte et des listes ; l'archive et son historique restent dans R2 ; un renvoi de cette entrée est refusé (410) |
| `GET /sante` | jeton | vérifie l'adresse et la connexion |
| `GET` · `POST /admin/intervenants` | jeton admin | liste · création/modification d'une fiche (la création génère le code d'activation) |
| `POST /admin/activation` | jeton admin | nouveau code d'activation pour un matricule |

- **Idempotent** : renvoyer le même signalement (même `X-Signalement-Id`) redonne la même référence, sans doublon
  ni numéro perdu ; un envoi interrompu se refait sans risque.
- **Rangement R2** : `standard/` (et `amiante/` pour d'anciens dépôts) · année · référence · `depot.zip` (l'archive reçue) et `recu.json`
  (référence, identifiant, nom de fichier, taille, date de réception, `deposePar` = matricule du compte qui a déposé ; le rédacteur et les contributeurs de la fiche sont dans `signalement.json` de l'archive).
- **Révisions** : renvoyer une archive avec le même `X-Signalement-Id` et une version plus récente (v0.NN) est une révision de la
  même référence. La version précédente est conservée dans `historique/vNNN_<date>.zip` ; `recu.json` liste les révisions
  (version, date, compte déposant). Une version plus ancienne que celle du serveur est refusée (409) : quelqu'un a révisé entre-temps.
- **Index** : à chaque dépôt, le serveur lit `signalement.json` dans l'archive et met à jour `index/signalements.json` (R2). La carte ne lit que cet index, jamais les archives ni les photos.
- **Référentiel des intervenants** : un seul objet R2, `referentiel/intervenants.json` (jamais dans le dépôt GitHub).
  Clé = matricule ; prénom, nom, GSM (`+32…`), email, organisation, division, département, service, droit admin, actif.
  Mot de passe : jamais conservé, seulement une empreinte PBKDF2-SHA256 salée. Code d'activation : `XXXXX-XXXXX`,
  à usage unique, 7 jours, seule l'empreinte est conservée. Écritures conditionnelles (ETag) : pas d'écrasement concurrent.
- **Sécurité** : 5 échecs de connexion → blocage 15 min ; jeton signé (HMAC) re-vérifié à chaque appel (un compte désactivé
  ou privé du droit admin est refusé aussitôt) ; un administrateur ne peut pas se retirer son droit ni se désactiver, et il
  reste toujours au moins un administrateur actif.
- **Transition** : tant qu'aucun compte n'est activé, l'ancien code partagé (`X-Depot-Code`, secret `DEPOT_CODE`) reste accepté
  pour `/depot` et `/sante`. Dès le premier compte activé, il ne sert plus.
- **Contrôles** : origine autorisée (`ALLOWED_ORIGINS`), flux valide, archive ZIP de 30 Mo au plus.
- **Données personnelles** : matricule, nom, GSM et email sont des données personnelles. Tant que l'accord de l'IT / du DPO
  n'est pas donné, ne créer que des agents fictifs.

## Déploiement (une seule fois)

Prérequis : compte Cloudflare (gratuit, R2 demande d'activer l'offre gratuite), Node.js.

1. Dans `wrangler.toml`, vérifier `ALLOWED_ORIGINS` (l'adresse du site, par ex. `https://jp99175.github.io`, sans chemin).
2. Depuis ce dossier :
   ```
   npx wrangler login
   npx wrangler r2 bucket create amgt4cem-depots
   npx wrangler secret put SESSION_SECRET        # longue chaîne aléatoire : signe les jetons de connexion
   npx wrangler secret put ADMIN_BOOTSTRAP_CODE  # code temporaire pour créer le premier administrateur
   npx wrangler deploy
   ```
3. Noter l'adresse affichée (`https://amgt4cem-depot-signalements.<compte>.workers.dev`) et la mettre dans
   `config.js`, `plugins` > `signalements` > `options.serverUrl`.

4. **Premier administrateur** : ouvrir `home.html?app=signal`, « Se connecter », onglet **Première connexion** : saisir son
   matricule, le code d'amorçage (`ADMIN_BOOTSTRAP_CODE`) comme code, et choisir son mot de passe. Le compte est créé administrateur
   (possible une seule fois, tant que le référentiel est vide). Compléter ensuite sa fiche dans `home.html?app=admin`, puis
   supprimer le secret `ADMIN_BOOTSTRAP_CODE`.
   Les secrets peuvent aussi se définir dans le tableau de bord Cloudflare (Workers > le Worker > Settings > Variables).
   Variable optionnelle `PBKDF2_ITER` (100000 par défaut, maximum accepté par Cloudflare) : la baisser si le forfait
   gratuit renvoie l'erreur 1102 (temps CPU dépassé) à la connexion.

Tant que `serverUrl` est vide, le plugin fonctionne comme avant : signalements sur l'appareil, export ZIP à la main.

## Tester en local

`npx wrangler dev --local` (avec un fichier `.dev.vars` contenant `SESSION_SECRET`, `ADMIN_BOOTSTRAP_CODE`, `DEPOT_CODE` éventuel, et `--var ALLOWED_ORIGINS:…` du site de test)
simule R2 et le compteur. Vérifié ainsi : amorçage par première connexion, activation, connexion, blocage après échecs, dépôt authentifié (matricule noté), repli sur l'ancien code puis refus après activation, référence attribuée, renvoi idempotent, archive invalide.

## Relire les dépôts

Tableau de bord Cloudflare > R2 > `amgt4cem-depots`, ou `npx wrangler r2 object get amgt4cem-depots/standard/2026/2026-0001/depot.zip`.
