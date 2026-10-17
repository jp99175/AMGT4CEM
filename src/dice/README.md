# Dés

Interface `home.html?app=dice` : micro-application autonome (HTML/CSS/JS, sans dépendance) : simulateur de jets de dés.

- Par défaut **D100 = 2 × D10** (dizaines 0-9 + unités 0-9, « 00 » = 100).
- Autres dés au choix par le bouton rotatif : D4, D6, D8, D10, D12, D20 (1 à 10 dés, total = somme).
- Façon **panneau radio d'avion** : afficheurs LED orange (nombre, dé), bouton noir « LANCER », bouton rotatif double (couronne = type de dé, bouton central = nombre de dés ; souris, molette ou flèches). Total en grand sur afficheur à lames rotatives, avec petit clac sonore (bouton 🔊 pour couper). Historique en tableau des départs (heure, dés, résultat) en bas.
- Tirage **non biaisé** : `crypto.getRandomValues` + rejet des valeurs excédentaires (pas de modulo biaisé).

Lancer : `python3 -m http.server 8000` puis http://localhost:8000/home.html?app=dice
Test d'uniformité (khi² sur 1 M de jets) : `node src/dice/test/rng.test.mjs`
