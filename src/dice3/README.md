# Dés 3

Variante de [dés 2](../dice2/README.md) aux couleurs et fixations d'un panneau supérieur de 777 : `home.html?app=dice3`.
`dice` et `dice2` restent inchangés.

- **Panneaux** : trois plaques brun-taupe de même largeur, séparées par des rainures noires (la structure), rendues comme de la
  tôle emboutie et peinte (peinture satinée granuleuse, bords légèrement relevés, ombre portée dans les retraits, repères « + »
  gravés, filet blanc après le titre). Les 4 coins de chaque plaque sont en retrait ; une vis à tête droite (fente) est fixée au
  fond de chaque retrait, dans un logement à anneau. Chaque bloc d'instrument (colonne touches + afficheurs, écran sur une bride
  emboutie, chaque bouton rotatif dans sa découpe ronde, cadre SOUND/LAUNCH) est fixé au panneau par 4 vis à tête bombée en
  croix, peintes de la couleur du panneau, plus petites que les vis des coins (proportions de la photo).
- **Panneau du haut** : 12 emplacements, chacun = touche **HOLD** + afficheur **0-100** à segments (3 caractères, ambre),
  numérotés par colonnes (1-4, 5-8, 9-12). HOLD s'éclaire : le dé est conservé au jet suivant. **RELEASE** (bouton rond noir,
  en bas à droite) relâche tous les HOLD. Changer de dé relâche aussi les HOLD.
- **Panneau du milieu** : écran carré à 16 segments ambre, en-tête + 9 lignes d'historique (heure, dés, total ; le plus récent
  en haut), bouton rond noir **CLEAR** dessous.
- **Panneau du bas** : boutons rotatifs crème **COUNT** (nombre de dés, 1 à 12) et **LIMIT** (type de dé : 4, 6, 8, 10, 12, 20, 100), puis **SOUND**
  (MUTE rouge quand le son est coupé) et **LAUNCH** (RUNNING vert pendant le jet) dans un cadre à rayures rouges et blanches.
- À chaque jet, les afficheurs des dés relancés « brouillent » leurs chiffres avant de se figer, avec un petit clac (coupé par
  SOUND), puis la nouvelle ligne d'historique fait de même.
- Le D100 (choix de départ) est un seul jet de 2 × D10 : une seule valeur 1 à 100, dans l'emplacement 1 ; COUNT est alors
  désactivé. Le tirage est celui de `dice` (`crypto.getRandomValues` sans biais, `../dice/rng.js`).

Fichiers : `dice3.js` (interface), `values.js` (logique pure), `seg16.js` (afficheurs à 16 segments), `knob.js` (bouton rotatif
crème), `sound.js` (clac), `dice3.css`.

Test de la logique : `node src/dice3/test/values.test.mjs`
