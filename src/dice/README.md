# Dés

Interface `home.html?app=dice` : micro-application autonome (HTML/CSS/JS, sans dépendance) : simulateur de jets de dés.

- Par défaut **D100 = 2 × D10** (dizaines 0-9 + unités 0-9, « 00 » = 100).
- Autres dés : D4, D6, D8, D10, D12, D20 (1 à 10 dés, total = somme) ; le D100 (2 × D10) est le choix de départ.
- Écran : titre, total en grand sur afficheur à lames rotatives, historique en tableau des départs (heure, dés, résultat), puis bandeau de commande en bas : deux boutons rotatifs sur plaque gravée (**NOMBRE** de dés 1 à 10, **DÉ** 4/6/8/10/12/20/100 ; souris, doigt, molette ou flèches) et trois boutons poussoirs à voyant : **SOUND** (voyant MUTE rouge quand le son est coupé), **LAUNCH** (voyant RUNNING vert pendant que les lames tournent), **EXIT** (voyant PROGRAM rouge ; ferme l'onglet, sinon retour à la page précédente ou à la carte).
- Tirage **non biaisé** : `crypto.getRandomValues` + rejet des valeurs excédentaires (pas de modulo biaisé).

Lancer : `python3 -m http.server 8000` puis http://localhost:8000/home.html?app=dice
Test d'uniformité (khi² sur 1 M de jets) : `node src/dice/test/rng.test.mjs`
