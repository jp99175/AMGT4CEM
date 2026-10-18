# Dés 3

Variante de [dés 2](../dice2/README.md) aux couleurs et fixations d'un panneau supérieur de 777 : `home.html?app=dice3`.
`dice` et `dice2` restent inchangés.

- **Panneaux** : trois plaques brun-taupe de même largeur, séparées par des rainures noires (la structure), 4 vis laiton chacune,
  fixations à anneau à cheval sur les rainures.
- **Panneau du haut** : 12 emplacements, chacun = touche **HOLD** + afficheur **0-100** à segments (3 caractères, ambre),
  numérotés par colonnes (1-4, 5-8, 9-12). HOLD s'éclaire : le dé est conservé au jet suivant. **RELEASE** (bouton rond noir,
  en bas à droite) relâche tous les HOLD. Changer de dé relâche aussi les HOLD.
- **Panneau du milieu** : écran carré à 16 segments ambre, en-tête + 9 lignes d'historique (heure, dés, total ; le plus récent
  en haut), bouton rond noir **CLEAR** dessous.
- **Panneau du bas** : boutons rotatifs crème **NOMBRE** (1 à 12) et **DÉ** (4, 6, 8, 10, 12, 20, 100), puis **SOUND**
  (MUTE rouge quand le son est coupé) et **LAUNCH** (RUNNING vert pendant le jet) dans un cadre à rayures rouges et blanches.
- À chaque jet, les afficheurs des dés relancés « brouillent » leurs chiffres avant de se figer, avec un petit clac (coupé par
  SOUND), puis la nouvelle ligne d'historique fait de même.
- Le D100 (choix de départ) est un seul jet de 2 × D10 : une seule valeur 1 à 100, dans l'emplacement 1 ; NOMBRE est alors
  désactivé. Le tirage est celui de `dice` (`crypto.getRandomValues` sans biais, `../dice/rng.js`).

Fichiers : `dice3.js` (interface), `values.js` (logique pure), `seg16.js` (afficheurs à 16 segments), `knob.js` (bouton rotatif
crème), `sound.js` (clac), `dice3.css`.

Test de la logique : `node src/dice3/test/values.test.mjs`
