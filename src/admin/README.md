# Administration des intervenants (`home.html?app=admin`)

Page réservée aux comptes ayant le droit `utilisateurs` (gestion des utilisateurs). Elle lit et modifie le référentiel des intervenants
conservé sur le serveur de dépôt (R2, voir `workers/depot/README.md`) ; rien n'est écrit dans le dépôt GitHub.

- **Liste** filtrable (nom, matricule, service…) ; **fiche** : matricule (clé, non modifiable ensuite), prénom, nom, GSM
  (saisi `0475 12 34 56`, enregistré `+32475123456`, affiché `+32 475 12 34 56`), email, organisation / division / département /
  service (BM / DITP / AMGT / CEM par défaut), droits (quatre cases : gestion des utilisateurs, attributs, plans, vocabulaire ; aucune case = agent), actif.
- **Création** : le serveur génère un code d'activation (`XXXXX-XXXXX`, 7 jours, affiché une seule fois) ; la page prépare
  l'email d'accueil (lien d'activation + code), l'ouvre dans la messagerie (`mailto:`) ou le copie. « Nouveau code
  d'activation + email » en refabrique un si le premier est perdu.
- **Mots de passe** : l'administrateur ne les connaît jamais.
- **Premier administrateur** : il se crée par l'écran « Première connexion » (matricule + code d'amorçage du serveur), puis complète sa fiche ici.
- Fichiers : `admin.js`, `admin.css` ; session et écran de connexion dans `../auth/`.

- **Sécurité** (bouton à côté de « Nouvel intervenant ») : opérations interrompues par l'erreur 1102, nombre de tours des mots de passe, délai croissant après les échecs de connexion.
