#!/usr/bin/env python3
"""
Migration UNIQUE vers la nouvelle architecture de données (voir README, section 4).

À lancer une seule fois, depuis la racine du dépôt, SUR UNE COPIE contenant encore les anciens
fichiers (Metro_export_SHP/, data/patrimoine-*.json). Après la migration, ces anciens fichiers sont
supprimés du dépôt (ils restent récupérables via le tag / la branche de sauvegarde).

Dépendance : pyshp  ->  pip install pyshp

    python3 tools/migrer-donnees.py

Entrées :
  Metro_export_SHP/Metro.shp+.dbf+.prj      69 stations (type MS), 87 tunnels (MT), (36 PE : recoupés, non utilisés)
  Metro_export_SHP/MetroInfo.shp, MetroLabels.shp   repères de tronçon PE_info (-> fichier legacy)
  data/patrimoine-plans-ensemble-500e.json  36 planches au 1/500
  data/patrimoine-numero-interstation.json  numéros interstation (conservés tels quels, fichier legacy)
  data/fond-de-plan/etiquettes-troncons.json  (identifiants de tunnel réécrits : ancien id_objet -> nouveau id)

Sorties :
  data/geometries/polygones.{shp,shx,dbf,prj,cpg}   un seul champ attributaire : `id`
  data/referentiel/polygones.json, lignes.json, vocabulaires.json
  data/legacy/numeros-interstation.legacy.json, data/legacy/reperes-troncons.legacy.json
  data/fond-de-plan/etiquettes-troncons.json        (réécrit)
  tools/rapport-migration.md

Rien n'est deviné : ce qui manque ou ne se rattache pas est consigné dans le rapport.
"""
import json
import math
import os
import shutil
import sys
from collections import Counter, defaultdict

try:
    import shapefile  # pyshp
except ImportError:
    sys.exit("pyshp est requis : pip install pyshp")

RACINE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DATE = "2026-10-05"
CRS = "EPSG:31370"
COULEUR_PLANCHE = "#b8860b"  # couleur de la couche « Plans d'ensemble » dans l'ancienne appli (AMGT4CEM_METRO_TYPES.PE)


def chemin(*p):
    return os.path.join(RACINE, *p)


def charger_json(*p):
    with open(chemin(*p), encoding="utf-8") as f:
        return json.load(f)


def ecrire_json(valeur, *p, indent=2):
    os.makedirs(os.path.dirname(chemin(*p)), exist_ok=True)
    with open(chemin(*p), "w", encoding="utf-8", newline="\n") as f:
        json.dump(valeur, f, ensure_ascii=False, indent=indent)
        f.write("\n")


def aire_signee(anneau):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(anneau, anneau[1:] + anneau[:1]):
        s += x1 * y2 - x2 * y1
    return s / 2


def point_dans_anneau(x, y, anneau):
    dedans = False
    j = len(anneau) - 1
    for i in range(len(anneau)):
        xi, yi = anneau[i]
        xj, yj = anneau[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            dedans = not dedans
        j = i
    return dedans


def anneaux_shape(shape):
    """Liste d'anneaux [[(x, y), ...], ...] d'un shape pyshp (parties)."""
    bornes = list(shape.parts) + [len(shape.points)]
    return [[tuple(p) for p in shape.points[bornes[i]:bornes[i + 1]]] for i in range(len(shape.parts))]


def main():
    rapport = []  # (rubrique, lignes)
    anomalies = []

    def note(rubrique, ligne):
        rapport.append((rubrique, ligne))

    # ---------- 1. Lecture de Metro.shp : stations et tunnels --------------------------------
    metro = shapefile.Reader(chemin("Metro_export_SHP", "Metro"), encoding="iso-8859-1")
    entites = []  # [{genre, anneaux, ref}] dans l'ordre d'attribution des id
    pe_metro = []
    for shape, rec in zip(metro.shapes(), metro.records()):
        r = rec.as_dict()
        t = r["type"]
        if t in ("MS", "MT"):
            ref = {
                "genre": "station" if t == "MS" else "tunnel",
                "name_fr": r["name_fr"],
                "name_nl": r["name_nl"],
                "niveau": r["niveau"],
                "ids_externes": {"ogc_fid": r["ogc_fid"]},
            }
            if r["id_objet"]:
                ref["ids_externes"]["id_objet"] = r["id_objet"]
            else:
                anomalies.append(f"{t} ogc_fid={r['ogc_fid']} ({r['name_fr']}) : id_objet vide dans Metro.dbf")
            if t == "MS":
                ref["noms"] = []
            entites.append({"genre": ref["genre"], "anneaux": anneaux_shape(shape), "ref": ref})
        elif t == "PE":
            pe_metro.append((r["sheet_ref"], anneaux_shape(shape)))
        else:
            anomalies.append(f"Entité de type inattendu « {t} » (ogc_fid={r['ogc_fid']}) ignorée")
    nb_ms = sum(1 for e in entites if e["genre"] == "station")
    nb_mt = sum(1 for e in entites if e["genre"] == "tunnel")
    note("Entités lues", f"Metro.shp : {nb_ms} stations (MS), {nb_mt} tunnels (MT), {len(pe_metro)} planches (PE, recoupées avec le JSON).")
    if (nb_ms, nb_mt) != (69, 87):
        anomalies.append(f"Effectifs inattendus : {nb_ms} stations / {nb_mt} tunnels (attendu 69 / 87)")

    # ---------- 2. Planches (JSON patrimoine) ---------------------------------------------------
    pj = charger_json("data", "patrimoine-plans-ensemble-500e.json")
    planches_json = []
    for f in pj["features"]:
        planches_json.append((f["properties"].get("sheet_ref", ""), [[tuple(p) for p in f["geometry"]["coordinates"][0]]]))
    for sheet_ref, anneaux in planches_json:
        # Convention Shapefile : anneau extérieur horaire.
        anneau = anneaux[0]
        if aire_signee(anneau) > 0:
            anneau.reverse()
        ref = {"genre": "planche", "sheet_ref": sheet_ref, "couleur": COULEUR_PLANCHE}
        if not sheet_ref:
            anomalies.append("Planche sans sheet_ref dans le JSON patrimoine")
        entites.append({"genre": "planche", "anneaux": anneaux, "ref": ref})
    note("Entités lues", f"data/patrimoine-plans-ensemble-500e.json : {len(planches_json)} planches.")

    # Recoupement JSON <-> Metro.shp (type PE)
    deja = defaultdict(list)
    for sr, an in pe_metro:
        deja[sr].append(an[0])
    ecarts = 0
    for sr, an in planches_json:
        ok = any(
            len(g) == len(an[0]) and (
                all(abs(a[0] - b[0]) < 0.01 and abs(a[1] - b[1]) < 0.01 for a, b in zip(g, an[0]))
                or all(abs(a[0] - b[0]) < 0.01 and abs(a[1] - b[1]) < 0.01 for a, b in zip(g, reversed(an[0])))
            )
            for g in deja.get(sr, [])
        )
        if not ok:
            ecarts += 1
            anomalies.append(f"Planche {sr} : géométrie du JSON différente de celle du type PE de Metro.shp (celle du JSON est retenue)")
    note("Contrôles", f"Géométries des planches du JSON identiques à celles du type PE de Metro.shp : {len(planches_json) - ecarts}/{len(planches_json)}.")

    doublons_sr = [s for s, n in Counter(sr for sr, _ in planches_json).items() if n > 1]
    for s in doublons_sr:
        anomalies.append(f"sheet_ref en double parmi les planches : {s}")

    # ---------- 3. Attribution des id et écriture des géométries ---------------------------------
    for i, e in enumerate(entites, start=1):
        e["id"] = f"G{i:06d}"
    prochain = len(entites) + 1

    os.makedirs(chemin("data", "geometries"), exist_ok=True)
    w = shapefile.Writer(chemin("data", "geometries", "polygones"), shapeType=shapefile.POLYGON, encoding="utf-8")
    w.field("id", "C", size=12)
    for e in entites:
        w.poly(e["anneaux"])
        w.record(e["id"])
    w.close()
    shutil.copyfile(chemin("Metro_export_SHP", "Metro.prj"), chemin("data", "geometries", "polygones.prj"))
    with open(chemin("data", "geometries", "polygones.cpg"), "w", newline="") as f:
        f.write("UTF-8")
    note("Sorties", f"data/geometries/polygones.shp : {len(entites)} polygones, champ unique `id` (G000001 à G{len(entites):06d}) ; .prj copié de Metro.prj.")

    # ---------- 4. Référentiel ---------------------------------------------------------------------
    ref_pol = {
        "version": 1,
        "date": DATE,
        "crs": CRS,
        "prochain_id": prochain,
        "entites": {e["id"]: e["ref"] for e in entites},
    }
    ecrire_json(ref_pol, "data", "referentiel", "polygones.json")
    ecrire_json(
        {"version": 1, "date": DATE, "crs": CRS, "prochain_id": prochain, "entites": {}},
        "data", "referentiel", "lignes.json",
    )
    niveaux = sorted({e["ref"].get("niveau") for e in entites if e["ref"].get("niveau")})
    ecrire_json(
        {
            "version": 1,
            "date": DATE,
            "regle_id": "Chaîne opaque « G » + 6 chiffres, attribuée une fois, jamais réutilisée, unique sur polygones.shp ET lignes.shp. Aucune signification métier.",
            "genres": {
                "station": {"libelle": "Station", "geometrie": "polygone"},
                "tunnel": {"libelle": "Tunnel (tronçon)", "geometrie": "polygone"},
                "planche": {"libelle": "Planche 1/500", "geometrie": "polygone"},
            },
            "niveaux": {"valeurs": niveaux, "note": "Valeurs relevées telles quelles dans Metro.dbf ; aucune interprétation."},
        },
        "data", "referentiel", "vocabulaires.json",
    )
    note("Sorties", "data/referentiel/polygones.json, lignes.json (vide), vocabulaires.json.")

    # ---------- 5. Noms de station ------------------------------------------------------------------
    chemin_noms = chemin("data", "patrimoine-nom-station.json")
    if os.path.exists(chemin_noms):
        # Non géré : voir rapport. Les textes bruts (FR, NL et numéros mêlés dans un seul champ `text`)
        # ne se classent pas en {fr, nl, reference} sans deviner.
        anomalies.append("data/patrimoine-nom-station.json présent mais non traité par ce script (textes non typés)")
    else:
        note(
            "Noms de station",
            "Le fichier de points texte `data/patrimoine-nom-station.json` n'existe plus dans l'arbre de travail "
            "(retiré au commit 3d75dcc : « sans lien fiable avec les emprises »). Aucun nom n'a donc été rattaché : "
            "`noms` est une liste vide pour chacune des 69 stations. Même si le fichier était récupéré dans l'historique, "
            "ses 206 textes n'ont qu'un champ `text` (nom FR, nom NL et numéros de référence mêlés) : les classer en "
            "{fr, nl, reference} reviendrait à deviner.",
        )

    # ---------- 6. Numéros interstation (legacy) ----------------------------------------------------
    os.makedirs(chemin("data", "legacy"), exist_ok=True)
    src_num = chemin("data", "patrimoine-numero-interstation.json")
    if os.path.exists(src_num):
        shutil.copyfile(src_num, chemin("data", "legacy", "numeros-interstation.legacy.json"))
        nb_num = len(charger_json("data", "patrimoine-numero-interstation.json")["features"])
        note("Legacy", f"data/legacy/numeros-interstation.legacy.json : {nb_num} points texte copiés tels quels (aucune géométrie de tronçon n'existe).")

    # ---------- 7. Repères de tronçon PE_info (legacy) -----------------------------------------------
    feats = []
    info = shapefile.Reader(chemin("Metro_export_SHP", "MetroInfo"), encoding="iso-8859-1")
    for shape, rec in zip(info.shapes(), info.records()):
        r = rec.as_dict()
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in a] for a in anneaux_shape(shape)]},
            "properties": {"type": "PE_info", "code": r["code"]},
        })
    nb_tri = len(feats)
    labels = shapefile.Reader(chemin("Metro_export_SHP", "MetroLabels"), encoding="iso-8859-1")
    nb_codes = nb_pelabel = 0
    for shape, rec in zip(labels.shapes(), labels.records()):
        r = rec.as_dict()
        if r["type"] == "PE_label":
            nb_pelabel += 1  # amorçage d'origine : la source des références de planche est data/fond-de-plan/etiquettes-planches.json
            continue
        nb_codes += 1
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": list(shape.points[0])},
            "properties": {"type": "PE_info", "code": r["code"], "angle": r["angle"], "side": r["side"]},
        })
    ecrire_json(
        {
            "type": "FeatureCollection",
            "legacy": True,
            "note": "Repères de transition entre tronçons de construction (INFRAVIEW.pdf), issus de MetroInfo.shp et MetroLabels.shp. Pas d'identifiant : à rattacher à lignes.shp quand il existera.",
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::31370"}},
            "features": feats,
        },
        "data", "legacy", "reperes-troncons.legacy.json", indent=None,
    )
    note("Legacy", f"data/legacy/reperes-troncons.legacy.json : {nb_tri} triangles + {nb_codes} codes (MetroInfo.shp / MetroLabels.shp, type PE_info), conservés pour que la couche « Plans d'ensemble » continue de les afficher.")
    note("Non migré", f"{nb_pelabel} points PE_label de MetroLabels.shp : amorçage d'origine des références de planche, remplacé depuis longtemps par data/fond-de-plan/etiquettes-planches.json (source unique).")

    # ---------- 8. etiquettes-troncons.json : ancien id_objet -> nouvel id -----------------------------
    par_ancien = {}
    for e in entites:
        if e["genre"] == "tunnel" and "id_objet" in e["ref"]["ids_externes"]:
            par_ancien[e["ref"]["ids_externes"]["id_objet"]] = e["id"]
    et = charger_json("data", "fond-de-plan", "etiquettes-troncons.json")
    non_trouves = []
    utilises = Counter()
    for cle, d in et["labels"].items():
        if d.get("tunnel") in {e["id"] for e in entites}:
            utilises[d["tunnel"]] += 1  # déjà migré (script relancé)
            continue
        nouveau = par_ancien.get(d.get("tunnel"))
        if nouveau:
            d["tunnel"] = nouveau
            utilises[nouveau] += 1
        else:
            non_trouves.append((cle, d.get("tunnel")))
    ecrire_json(et, "data", "fond-de-plan", "etiquettes-troncons.json")
    note("Étiquettes de tronçon", f"data/fond-de-plan/etiquettes-troncons.json : {len(et['labels']) - len(non_trouves)}/{len(et['labels'])} références de tunnel réécrites (ancien id_objet -> id).")
    for cle, t in non_trouves:
        anomalies.append(f"Étiquette de tronçon « {cle} » : tunnel « {t} » introuvable, référence laissée inchangée")
    sans_numero = [e["ref"]["name_fr"] + " (" + e["id"] + ")" for e in entites if e["genre"] == "tunnel" and e["id"] not in utilises]
    note("Contrôles", f"Tunnels sans aucune étiquette de numéro d'interstation : {len(sans_numero)}.")
    partages = [(t, n) for t, n in utilises.items() if n > 1]
    note("Contrôles", f"Tunnels portant plusieurs numéros : {len(partages)}.")

    # Références de planche : chaque clé « ref#rang » doit correspondre à une planche existante.
    ep = charger_json("data", "fond-de-plan", "etiquettes-planches.json")
    refs_planches = {sr for sr, _ in planches_json}
    inconnues = sorted({k.split("#")[0] for k in ep["labels"]} - refs_planches)
    for k in inconnues:
        anomalies.append(f"etiquettes-planches.json : référence « {k} » ne correspond à aucune planche")
    sans_etiq = sorted(refs_planches - {k.split("#")[0] for k in ep["labels"]})
    note("Contrôles", f"Planches sans référence dans etiquettes-planches.json : {len(sans_etiq)}" + (f" ({', '.join(sans_etiq)})." if sans_etiq else "."))

    # ---------- 9. Contrôles d'anomalies ---------------------------------------------------------------
    noms_vus = defaultdict(list)
    for e in entites:
        if e["genre"] in ("station", "tunnel"):
            noms_vus[(e["genre"], e["ref"]["name_fr"])].append(e["id"])
    for (genre, nom), ids in noms_vus.items():
        if len(ids) > 1 and genre == "station":
            anomalies.append(f"Station dupliquée : « {nom} » ({', '.join(ids)})")
        if len(ids) > 1 and genre == "tunnel":
            note("Doublons", f"Tunnels de même nom « {nom} » : {', '.join(ids)} (même nom : seul l'id les distingue).")
    for e in entites:
        if e["genre"] in ("station", "tunnel") and not (e["ref"]["name_fr"] or e["ref"]["name_nl"]):
            anomalies.append(f"{e['genre']} {e['id']} sans nom")
    # Doublons de géométrie
    vus = {}
    for e in entites:
        cle = tuple(sorted(round(c, 2) for p in e["anneaux"][0] for c in p))
        if cle in vus:
            anomalies.append(f"Géométrie identique : {vus[cle]} et {e['id']}")
        vus[cle] = e["id"]
    # Chevauchement des planches (sommet de l'une dans l'autre)
    planches = [e for e in entites if e["genre"] == "planche"]
    chev = 0
    for i, a in enumerate(planches):
        for b in planches[i + 1:]:
            if any(point_dans_anneau(x, y, b["anneaux"][0]) for x, y in a["anneaux"][0]) or any(
                point_dans_anneau(x, y, a["anneaux"][0]) for x, y in b["anneaux"][0]
            ):
                chev += 1
    note("Contrôles", f"Paires de planches qui se chevauchent : {chev} (connu, voir README ; comportement du clic conservé).")
    # Stations sans tunnel contigu ne sont pas évaluées (pas de topologie dans les données).

    # ---------- Rapport ---------------------------------------------------------------------------------
    lignes = [
        "# Rapport de migration",
        "",
        f"Généré par `tools/migrer-donnees.py` le {DATE}. Rien n'est inventé ni deviné : ce qui ne se rattache pas est listé ici.",
        "",
    ]
    rubriques = []
    for r, _ in rapport:
        if r not in rubriques:
            rubriques.append(r)
    for r in rubriques:
        lignes.append(f"## {r}")
        lignes.append("")
        for rr, l in rapport:
            if rr == r:
                lignes.append(f"- {l}")
        lignes.append("")
    lignes.append("## Noms sans emprise / emprises sans nom")
    lignes.append("")
    lignes.append("- Noms sans emprise : sans objet (aucun nom de station n'a pu être migré, voir « Noms de station »).")
    lignes.append(f"- Emprises de station sans nom de la liste `noms` : {nb_ms}/{nb_ms} (toutes). Elles gardent `name_fr` / `name_nl` issus de Metro.dbf.")
    lignes.append("")
    lignes.append("## Anomalies")
    lignes.append("")
    if anomalies:
        lignes += [f"- {a}" for a in anomalies]
    else:
        lignes.append("- Aucune anomalie détectée par les contrôles automatiques.")
    if sans_numero:
        lignes += ["", "### Tunnels sans numéro d'interstation", ""] + [f"- {s}" for s in sans_numero]
    lignes.append("")
    with open(chemin("tools", "rapport-migration.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lignes))
    print("\n".join(lignes))


if __name__ == "__main__":
    main()
