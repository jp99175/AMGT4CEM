# Chromix — puzzle de tri de couleurs (MVP)

Petit puzzle mobile de tri de liquides colorés, en HTML/CSS/JS vanilla, sans
dépendance ni build step. Inspiré du principe générique "water sort puzzle"
mais avec un nom, une direction artistique et un code propres, indépendants
de tout jeu existant.

## Lancer le jeu

Page 100% statique, à servir avec n'importe quel petit serveur HTTP (le
`fetch()` des modules ES nécessite `http://`, pas `file://`) :

```bash
cd magic-sort
python3 -m http.server 8080
```

Puis ouvrir http://localhost:8080/.

## Contenu du MVP

- 20 niveaux à difficulté progressive (3 → 9 couleurs).
- Versement par tap (sélection puis cible) **et** par glisser-déposer.
- Règles de versement strictes (`canPour`/`pour` dans `src/puzzle.js`),
  transferts multi-unités quand plusieurs couches identiques se touchent.
- Annulation multi-niveaux, redémarrage exact du niveau, indice (recherche
  en largeur avec repli heuristique).
- Générateur procédural garanti solvable (`generateLevel` : scramble par
  déplacements inverses depuis un état résolu, puis vérification exhaustive
  par recherche en largeur avec relance sur un autre seed si nécessaire).
- Sauvegarde locale (niveau courant, niveaux terminés, monnaie, réglages
  audio) via `localStorage`.
- Animations de versement (inclinaison + écoulement), sélection, victoire
  (confettis + son), léger retour haptique mobile.
- Sons synthétisés à la volée (WebAudio), aucun asset binaire.
- Mini tutoriel contextuel au niveau 1.

## Architecture

```
src/
  bottle.js    Structure de données Bottle (capacity, colors[], isLocked, hiddenLayers)
  puzzle.js    Logique pure : canPour, pour, undoPour, checkVictory, generateLevel, findHint
  levels.js    Courbe de difficulté des 20 niveaux + cache de génération
  colors.js    Palette de couleurs
  storage.js   saveProgress / loadProgress (localStorage)
  audio.js     Effets sonores synthétisés
  render.js    Rendu DOM des bouteilles + animations
  input.js     Tap et glisser-déposer unifiés
  main.js      Câblage de l'UI et boucle de jeu
```

La logique du puzzle (`puzzle.js`, `bottle.js`) ne touche jamais au DOM ; le
rendu ne modifie jamais l'état du jeu directement. Cela garde l'état
déterministe et facilite l'ajout futur de mécaniques spéciales (couleur
mystère, bouteille verrouillée, capacités variables...) déjà prévues dans la
structure `Bottle` (`isLocked`, `hiddenLayers`).

## Suite prévue (post-MVP)

Progression à 100+ niveaux, mécaniques spéciales (couleur mystère, bouteille
verrouillée/cachée, capacités variables, couleur magique), thèmes
débloquables, écran d'accueil animé, économie de pièces plus profonde.
