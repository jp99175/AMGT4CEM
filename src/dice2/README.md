# Dés 2

Variante de [dés](../dice/README.md) : `home.html?app=dice2`. La première interface (`app=dice`) reste inchangée.

Pensée pour smartphone en portrait (sur grand écran, la même colonne est centrée). Trois panneaux plats de même
largeur, fixés par 4 vis, instruments et boutons montés directement dessus :

1. **Panneau du haut** : 12 emplacements, chacun = une touche **HOLD** + 2 lames « flip » (dizaines 0 à 10, unités 0 à 9, donc
   « 10 » + « 0 » = 100). Numérotation par colonnes (1-4, 5-8, 9-12). La touche HOLD s'éclaire en ambre : le dé est
   conservé au jet suivant (seuls les autres sont relancés, le total compte tous les dés). Changer de dé relâche les HOLD.
2. **Panneau du milieu** : écran carré à 16 segments (vert), en-tête + 9 lignes d'historique (heure, dés, total ; le plus
   récent en haut), bouton rond noir **CLEAR** dessous.
3. **Panneau du bas** : boutons rotatifs gravés **NOMBRE** (1 à 12) et **DÉ** (4, 6, 8, 10, 12, 20, 100), puis les poussoirs
   à voyant **SOUND** (MUTE rouge quand le son est coupé) et **LAUNCH** (RUNNING vert pendant le jet).

Le D100 (choix de départ) est un seul jet de 2 × D10 : une seule valeur 1 à 100, affichée dans l'emplacement 1 ; le bouton
NOMBRE est alors désactivé. Le tirage est le même que pour `dice` (`crypto.getRandomValues` sans biais).

Fichiers : `dice2.js` (interface), `values.js` (logique pure : valeurs des emplacements, HOLD), `seg16.js` (écran à 16 segments),
`flap.js` (lames, variante de `../dice/flap.js` pour les valeurs à deux caractères), `dice2.css`. Les boutons rotatifs
(`../dice/knob.js`) et le tirage (`../dice/rng.js`) sont partagés avec `dice`.

Test de la logique : `node src/dice2/test/values.test.mjs`
