#!/usr/bin/env python3
"""
Contrôle de cohérence des données : à lancer après CHAQUE export AutoCAD, avant de committer.

    python3 tools/verifier-donnees.py

Aucune dépendance (bibliothèque standard seule). Code de sortie 0 si tout est bon, 1 en cas d'erreur.

Vérifie :
  - présence des fichiers du shapefile (.shp, .shx, .dbf, .prj) : polygones obligatoire, lignes facultatif
    (tant qu'aucun tronçon n'est dessiné) ;
  - type de forme (polygones : 5, lignes : 3) et champ `id` présent dans le .dbf ;
  - nombre d'entités identique entre .shp, .shx et .dbf ;
  - identifiants au bon format (G + 6 chiffres), non vides, UNIQUES sur les deux fichiers à la fois
    (copier ou scinder une entité dans AutoCAD duplique son id) ;
  - aucune géométrie sans entrée de référentiel, aucune entrée de référentiel sans géométrie ;
  - `prochain_id` du référentiel supérieur à tout id utilisé, et identique dans polygones.json / lignes.json ;
  - `genre` de chaque entrée déclaré dans vocabulaires.json ;
  - champs propres à chaque genre : nom (FR ou NL) des stations et tunnels, `sheet_ref` présent et
    unique pour les planches ; aucun caractère de contrôle dans les textes (encodage mal lu) ;
  - enregistrements marqués « supprimé » dans le .dbf (ils restent comptés dans le .shp) ;
  - références des étiquettes (data/fond-de-plan/) : chaque tronçon désigné par etiquettes-troncons.json
    est un `id` de genre « tunnel », chaque planche d'etiquettes-planches.json existe.

Option --corriger : remplace dans etiquettes-troncons.json les anciens identifiants de tunnel
(`id_objet`, ex. « TRO-HORTA-ALBERT-01 », encore écrits par l'ancienne version de l'application tant
que la refonte n'est pas déployée) par le nouvel `id`, grâce à `ids_externes.id_objet` du référentiel.
"""
import json
import os
import re
import struct
import sys
from collections import defaultdict

RACINE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
GEO = os.path.join(RACINE, "data", "geometries")
REF = os.path.join(RACINE, "data", "referentiel")
FORMAT_ID = re.compile(r"^G\d{6}$")
CONTROLE = re.compile("[\x00-\x1f\x7f-\x9f]")
FOND = os.path.join(RACINE, "data", "fond-de-plan")

erreurs = []
avertissements = []


def err(msg):
    erreurs.append(msg)


def lire_shp_entete(chemin):
    with open(chemin, "rb") as f:
        entete = f.read(100)
    if len(entete) < 100 or struct.unpack(">i", entete[:4])[0] != 9994:
        raise ValueError("en-tête .shp invalide")
    return struct.unpack("<i", entete[32:36])[0]


def compter_shp(chemin):
    """Nombre d'enregistrements d'un .shp, en le parcourant."""
    n = 0
    with open(chemin, "rb") as f:
        data = f.read()
    off = 100
    while off + 8 <= len(data):
        longueur = struct.unpack(">i", data[off + 4:off + 8])[0] * 2
        off += 8 + longueur
        n += 1
    if off != len(data):
        raise ValueError("fichier .shp tronqué ou corrompu")
    return n


def lire_dbf_ids(chemin):
    """(liste des valeurs du champ `id`, liste des noms de champs)."""
    with open(chemin, "rb") as f:
        data = f.read()
    nb, entete_len, rec_len = struct.unpack("<IHH", data[4:12])
    champs, p = [], 32
    while data[p] != 0x0D:
        nom = data[p:p + 11].split(b"\x00")[0].decode("ascii", "replace")
        champs.append((nom, data[p + 16]))
        p += 32
    offsets, o = {}, 1
    for nom, long in champs:
        offsets[nom] = (o, long)
        o += long
    ids = []
    supprimes = sum(1 for r in range(nb) if data[entete_len + r * rec_len] == 0x2A)
    if supprimes:
        err(f"{os.path.basename(chemin)} : {supprimes} enregistrement(s) marqué(s) supprimé(s) — réexporter sans eux")
    if "id" in offsets:
        debut, long = offsets["id"]
        for r in range(nb):
            base = entete_len + r * rec_len
            ids.append(data[base + debut:base + debut + long].decode("latin-1").strip())
    return ids, [c[0] for c in champs]


def verifier_shapefile(nom, type_attendu, obligatoire):
    """Retourne la liste des id (ou None si absent)."""
    base = os.path.join(GEO, nom)
    if not os.path.exists(base + ".shp"):
        if obligatoire:
            err(f"{nom}.shp absent")
        return None
    for ext in ("shx", "dbf", "prj"):
        if not os.path.exists(f"{base}.{ext}"):
            err(f"{nom}.{ext} absent (shapefile incomplet)")
    if not (os.path.exists(base + ".dbf")):
        return None
    try:
        type_forme = lire_shp_entete(base + ".shp")
        n_shp = compter_shp(base + ".shp")
    except Exception as e:  # noqa: BLE001
        err(f"{nom}.shp illisible : {e}")
        return None
    if type_forme != type_attendu:
        err(f"{nom}.shp : type de forme {type_forme}, attendu {type_attendu}")
    ids, champs = lire_dbf_ids(base + ".dbf")
    if "id" not in champs:
        err(f"{nom}.dbf : champ `id` absent (champs : {', '.join(champs) or 'aucun'})")
        return None
    extra = [c for c in champs if c != "id"]
    if extra:
        avertissements.append(f"{nom}.dbf : champs en trop (seul `id` est attendu) : {', '.join(extra)}")
    if len(ids) != n_shp:
        err(f"{nom} : {n_shp} entités dans le .shp mais {len(ids)} enregistrements dans le .dbf")
    if os.path.exists(base + ".shx"):
        n_shx = (os.path.getsize(base + ".shx") - 100) // 8
        if n_shx != n_shp:
            err(f"{nom}.shx : {n_shx} entrées, {n_shp} entités dans le .shp (index à régénérer)")
    for i, v in enumerate(ids, start=1):
        if not v:
            err(f"{nom} : entité n°{i} sans id")
        elif not FORMAT_ID.match(v):
            err(f"{nom} : entité n°{i} : id « {v} » ne respecte pas le format G + 6 chiffres")
    return ids


def charger_ref(nom, obligatoire):
    chemin = os.path.join(REF, nom)
    if not os.path.exists(chemin):
        if obligatoire:
            err(f"referentiel/{nom} absent")
        return None
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except ValueError as e:
        err(f"referentiel/{nom} : JSON invalide ({e})")
        return None


def textes(valeur, cle=""):
    """(chemin, texte) de toutes les chaînes d'une entrée de référentiel, listes et objets compris."""
    if isinstance(valeur, str):
        yield cle, valeur
    elif isinstance(valeur, dict):
        for k, v in valeur.items():
            yield from textes(v, f"{cle}.{k}" if cle else k)
    elif isinstance(valeur, list):
        for i, v in enumerate(valeur):
            yield from textes(v, f"{cle}[{i}]")


def verifier_etiquettes(ref_pol, ref_lig):
    """Références des étiquettes de data/fond-de-plan/ vers le référentiel (option --corriger)."""
    entites = {}
    for ref in (ref_pol, ref_lig):
        entites.update((ref or {}).get("entites") or {})
    tunnels = {v for v, e in entites.items() if e.get("genre") == "tunnel"}
    par_ancien = {
        e["ids_externes"]["id_objet"]: v
        for v, e in entites.items()
        if e.get("genre") == "tunnel" and (e.get("ids_externes") or {}).get("id_objet")
    }
    chemin = os.path.join(FOND, "etiquettes-troncons.json")
    if os.path.exists(chemin):
        with open(chemin, encoding="utf-8") as f:
            et = json.load(f)
        corriges = 0
        for cle, d in (et.get("labels") or {}).items():
            t = d.get("tunnel")
            if t in tunnels:
                continue
            if t in par_ancien and "--corriger" in sys.argv:
                d["tunnel"] = par_ancien[t]
                corriges += 1
            elif t in par_ancien:
                err(f"etiquettes-troncons.json : « {cle} » désigne l'ancien identifiant « {t} » (= {par_ancien[t]}) — relancer avec --corriger")
            else:
                err(f"etiquettes-troncons.json : « {cle} » désigne le tronçon « {t} », qui n'est pas un tunnel du référentiel")
        if corriges:
            with open(chemin, "w", encoding="utf-8", newline="\n") as f:
                json.dump(et, f, ensure_ascii=False, indent=2)
                f.write("\n")
            print(f"etiquettes-troncons.json : {corriges} ancien(s) identifiant(s) remplacé(s) par l'id du référentiel.")
    chemin = os.path.join(FOND, "etiquettes-planches.json")
    if os.path.exists(chemin):
        with open(chemin, encoding="utf-8") as f:
            ep = json.load(f)
        refs = {e.get("sheet_ref") for e in entites.values() if e.get("genre") == "planche"}
        for cle in sorted(ep.get("labels") or {}):
            if cle.split("#")[0] not in refs:
                err(f"etiquettes-planches.json : « {cle} » ne correspond à aucune planche du référentiel")


def main():
    ids_pol = verifier_shapefile("polygones", 5, True)
    ids_lig = verifier_shapefile("lignes", 3, False)
    ref_pol = charger_ref("polygones.json", True)
    ref_lig = charger_ref("lignes.json", False)
    voc = charger_ref("vocabulaires.json", True)

    # Unicité sur les deux fichiers à la fois
    vus = defaultdict(list)
    for fichier, ids in (("polygones", ids_pol), ("lignes", ids_lig)):
        for i, v in enumerate(ids or [], start=1):
            if v:
                vus[v].append(f"{fichier} n°{i}")
    for v, ou in sorted(vus.items()):
        if len(ou) > 1:
            err(f"id « {v} » en double : {', '.join(ou)}")

    # Référentiel <-> géométries
    for fichier, ids, ref in (("polygones", ids_pol, ref_pol), ("lignes", ids_lig, ref_lig)):
        entrees = (ref or {}).get("entites", {}) if ref is not None else None
        geo = set(ids or [])
        if entrees is None:
            if ids:
                err(f"{fichier}.shp contient {len(ids)} entités mais referentiel/{fichier}.json est absent")
            continue
        for v in sorted(geo - set(entrees)):
            if v:
                err(f"{fichier} : géométrie « {v} » sans entrée de référentiel")
        for v in sorted(set(entrees) - geo):
            err(f"{fichier} : entrée de référentiel « {v} » sans géométrie")
        genres = (voc or {}).get("genres", {})
        for v, e in entrees.items():
            if voc is not None and e.get("genre") not in genres:
                err(f"{fichier} : entrée « {v} » : genre « {e.get('genre')} » absent de vocabulaires.json")

    # Champs propres à chaque genre, textes
    for fichier, ref in (("polygones", ref_pol), ("lignes", ref_lig)):
        sheet_refs = defaultdict(list)
        for v, e in ((ref or {}).get("entites") or {}).items():
            g = e.get("genre")
            if g in ("station", "tunnel") and not (e.get("name_fr") or e.get("name_nl")):
                err(f"{fichier} : {g} « {v} » sans nom (name_fr ou name_nl)")
            if g == "planche":
                if e.get("sheet_ref"):
                    sheet_refs[e["sheet_ref"]].append(v)
                else:
                    err(f"{fichier} : planche « {v} » sans sheet_ref")
            for cle, texte in textes(e):
                if CONTROLE.search(texte):
                    err(f"{fichier} : « {v} ».{cle} contient un caractère de contrôle ({texte!r}) — encodage mal lu ?")
        for sr, ids in sheet_refs.items():
            if len(ids) > 1:
                err(f"{fichier} : sheet_ref « {sr} » porté par plusieurs planches : {', '.join(ids)}")

    verifier_etiquettes(ref_pol, ref_lig)

    # prochain_id
    suivants = [r.get("prochain_id") for r in (ref_pol, ref_lig) if r is not None]
    if len(set(suivants)) > 1:
        err(f"prochain_id différent entre polygones.json et lignes.json : {suivants}")
    nums = [int(v[1:]) for v in vus if FORMAT_ID.match(v)]
    if nums and suivants and suivants[0] is not None and suivants[0] <= max(nums):
        err(f"prochain_id ({suivants[0]}) doit être supérieur au plus grand id utilisé (G{max(nums):06d})")

    n_pol, n_lig = len(ids_pol or []), len(ids_lig or [])
    print(f"polygones : {n_pol} entités ; lignes : {n_lig if ids_lig is not None else 'fichier absent (toléré)'}")
    for a in avertissements:
        print("AVERTISSEMENT :", a)
    for e in erreurs:
        print("ERREUR :", e)
    if erreurs:
        print(f"\n{len(erreurs)} erreur(s) : corriger avant de committer.")
        return 1
    print("OK : données cohérentes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
