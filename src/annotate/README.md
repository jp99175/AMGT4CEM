# Annotation de photos (`src/annotate/`)

Outil commun à tous les formulaires qui joignent des photos : signalements aujourd'hui, inspections et constats plus tard.
Il ne dépend d'aucun formulaire : un formulaire l'appelle (`AMGT4CEM_Annotate.open`), reçoit les résultats et les range où il veut.

## Fichiers

| Fichier | Rôle |
|---|---|
| `annotate.js` | API publique (`window.AMGT4CEM_Annotate`) : `open`, `overlayPng`, `vue`, `pivoterMep`, `mepNormal`, `render` |
| `editor.js` | interface de l'éditeur : outils, sélection, liste des objets, mise en page, zoom, gestes |
| `render.js` | dessin des objets (pur, sans DOM) : partagé par l'éditeur, le calque PNG, le PDF |
| `layout.js` | mise en page : rotation, cadre, matrices (pur) |
| `history.js` | annuler / refaire par instantanés |
| `dom.js` | constructeur DOM `h()` (tout texte passe par `textContent`) |
| `store.js` | photos et annotations en local (IndexedDB `amgt4cem-pieces`, nom inchangé) : `AMGT4CEM_Annotate.Store` |
| `annotate.css` | styles de l'éditeur et des icônes (préfixe `annotate-`) |
| `icons/` | icônes (masques SVG, 23 px, trait 0,8, couleur #0b5c75), classes `annotate-ic annotate-ic--<nom>` |

Ordre de chargement : `dom.js`, `render.js`, `layout.js`, `history.js`, `editor.js`, `annotate.js` (`store.js` à part, plus tôt).
Ancien nom conservé le temps de la transition : `SIG4CEM.PhotoEditor` (même objet).

## API

```js
AMGT4CEM_Annotate.open(blob, traits, onDone, mep, { outil: 'mep' })   // onDone(traits, mep) à la validation ; rien ne change si on annule
await AMGT4CEM_Annotate.overlayPng(traits, largeur, hauteur, mep)     // calque PNG transparent (grand côté 1000 px), null sans traits
await AMGT4CEM_Annotate.vue(blob, mep, cote)                          // photo vue à travers sa mise en page (JPEG)
AMGT4CEM_Annotate.pivoterMep(mep, sens, W, H)                         // quart de tour (sens = 1 horaire, -1 anti-horaire)
```

## Format des données

La photo d'origine n'est **jamais modifiée**. Les annotations et la mise en page sont enregistrées à part.

- **`traits`** (liste d'objets, du dessous vers le dessus), coordonnées relatives à la photo entière (0..1) :
  `pen` (p), `arrow` (a, b), `rect` / `ellipse` (a, b, r), `poly` (p, cl), boîtes de texte (`tx: true, tc, s, al, txt: [{t, b, i, u, x}]`).
  Champs communs : `c` (couleur, null = sans cadre), `w` (épaisseur), `o` (opacité), `ty` (plein / tirets / points / nuage),
  `ed` / `ef` (terminaisons), `fc` (remplissage), `hid` (objet masqué).
- **`mep`** (mise en page) : `{ v: 1, a, c: [x, y], w, h }` ; `a` = rotation en degrés (sens horaire) autour du centre de la photo ;
  le cadre (la vue finale) est un rectangle `w × h` centré en `c` dans le repère pivoté ; longueurs en largeurs de photo
  (la photo mesure 1 × H/W). `null` = photo entière, sans rotation.
- **Version du format** : `v: 1` (`annotV` en base, `annotations.v` dans `signalement.json`). Un lecteur qui rencontre une version
  supérieure doit prévenir plutôt que d'écraser.
- Le calque PNG est généré dans le cadre de la mise en page ; tout lecteur extérieur qui affiche la photo seule doit appliquer `mep` lui-même.

## Stockage (`store.js`)

IndexedDB `amgt4cem-pieces`, magasin `pieces` : `{ id, pointId, blob, traits, annot, annotSha256, annotV, annotModifie, mep, … }`.
`setAnnotations(id, png, traits)` enregistre le calque et les traits ; `setMep(id, mep)` la mise en page.
Les archives de dépôt (`src/signalements/depot.js`) reprennent `traits`, `mep` et le calque.
