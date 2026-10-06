# Rapport de migration

Généré par `tools/migrer-donnees.py` le 2026-10-06. Rien n'est inventé ni deviné : ce qui ne se rattache pas est listé ici.

## Entités lues

- Metro.shp : 69 stations (MS), 87 tunnels (MT), 36 planches (PE, recoupées avec le JSON).
- data/patrimoine-plans-ensemble-500e.json : 36 planches.

## Contrôles

- Géométries des planches du JSON identiques à celles du type PE de Metro.shp : 36/36.
- Tunnels sans aucune étiquette de numéro d'interstation : 7.
- Tunnels portant plusieurs numéros : 6.
- Planches sans référence dans etiquettes-planches.json : 0.
- Paires de planches qui se chevauchent : 42 (connu, voir README ; comportement du clic conservé).

## Sorties

- data/geometries/polygones.shp : 192 polygones, champ unique `id` (G000001 à G000192) ; .prj copié de Metro.prj.
- data/referentiel/polygones.json, lignes.json (vide), vocabulaires.json.

## Niveau

- Champ `niveau` non repris : « - » ×142, « 0 » ×14 dans Metro.dbf, valeurs non crédibles. À renseigner plus tard dans le référentiel.

## Noms

- Préfixes « Station », « Tunnel STIB », « Tunnel MIVB » retirés des noms (ils répètent le genre).

## Noms de station

- Le fichier de points texte `data/patrimoine-nom-station.json` n'existe plus dans l'arbre de travail (retiré au commit 3d75dcc : « sans lien fiable avec les emprises »). Aucun nom n'a donc été rattaché : `noms` est une liste vide pour chacune des 69 stations. Même si le fichier était récupéré dans l'historique, ses 206 textes n'ont qu'un champ `text` (nom FR, nom NL et numéros de référence mêlés) : les classer en {fr, nl, reference} reviendrait à deviner.

## Legacy

- data/legacy/numeros-interstation.legacy.json : 86 points texte copiés tels quels (aucune géométrie de tronçon n'existe).
- data/legacy/reperes-troncons.legacy.json : 106 triangles + 80 codes (MetroInfo.shp / MetroLabels.shp, type PE_info), conservés pour que la couche « Plans d'ensemble » continue de les afficher.

## Non migré

- 37 points PE_label de MetroLabels.shp : amorçage d'origine des références de planche, remplacé depuis longtemps par data/fond-de-plan/etiquettes-planches.json (source unique).

## Étiquettes de tronçon

- data/fond-de-plan/etiquettes-troncons.json : 86/86 références de tunnel réécrites (ancien id_objet -> id).

## Doublons

- Tunnels de même nom « Horta - Albert » : G000002, G000136 (même nom : seul l'id les distingue).
- Tunnels de même nom « Delacroix - Clemenceau » : G000005, G000084, G000118 (même nom : seul l'id les distingue).
- Tunnels de même nom « Demey - Hermann-Debroux » : G000014, G000057 (même nom : seul l'id les distingue).
- Tunnels de même nom « Erasme - Eddy Merckx » : G000056, G000156 (même nom : seul l'id les distingue).
- Tunnels de même nom « Delta - Beaulieu » : G000058, G000064 (même nom : seul l'id les distingue).
- Tunnels de même nom « Beekkant - Gare de l'Ouest » : G000059, G000080, G000117, G000146 (même nom : seul l'id les distingue).

## Noms sans emprise / emprises sans nom

- Noms sans emprise : sans objet (aucun nom de station n'a pu être migré, voir « Noms de station »).
- Emprises de station sans nom de la liste `noms` : 69/69 (toutes). Elles gardent `name_fr` / `name_nl` issus de Metro.dbf.

## Anomalies

- Aucune anomalie détectée par les contrôles automatiques.

### Tunnels sans numéro d'interstation

- Delacroix - Clemenceau (G000005)
- Demey - Hermann-Debroux (G000057)
- Delta - Beaulieu (G000058)
- Beekkant - Gare de l'Ouest (G000080)
- Beekkant - Gare de l'Ouest (G000117)
- Cité Modèle - Roi Baudouin (G000132)
- Erasme - Eddy Merckx (G000156)
