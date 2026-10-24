#!/usr/bin/env python3
"""Renommage unique des identifiants des polygones : G000001…G000192 → P000001…P000192.

Raison : la lettre désigne désormais le fichier d'origine (P = polygones.shp, L = lignes.shp,
G = géométries autonomes créées dans l'application). Mêmes chiffres, seule la lettre change.
À exécuter UNE fois, avant toute donnée de suivi. Sans argument : simulation (rien n'est écrit).
Avec --appliquer : modifie les fichiers sur place.

Touche : polygones.dbf (champ `id`), les trois référentiels JSON, la couche temporaire et le
compteur `identifiants.json`. Les commentaires de code et la documentation sont modifiés à la main.
"""
import argparse
import json
import os
import re
import struct

RACINE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DATA = os.path.join(RACINE, "data")
DBF = os.path.join(DATA, "shapefile", "polygones.dbf")
JSONS = [
    os.path.join(DATA, "metro", "polygones.json"),
    os.path.join(DATA, "plans-patrimoine", "polygones.json"),
    os.path.join(DATA, "plans-patrimoine", "etiquettes-troncons.json"),
    os.path.join(DATA, "plans-patrimoine", "temp-delta-mod.json"),
]
ID = re.compile(r"\bG(\d{6})\b")


def renommer_dbf(appliquer):
    with open(DBF, "rb") as f:
        b = bytearray(f.read())
    n, entete, longueur = struct.unpack("<IHH", b[4:12])
    champs, i = [], 32
    while b[i] != 0x0D:
        champs.append((b[i:i + 11].split(b"\0")[0].decode("ascii"), b[i + 16]))
        i += 32
    decalage, taille = 1, None
    for nom, ln in champs:
        if nom == "id":
            taille = ln
            break
        decalage += ln
    if taille is None:
        raise SystemExit("champ `id` absent du .dbf")
    modifies = 0
    for r in range(n):
        debut = entete + r * longueur + decalage
        valeur = bytes(b[debut:debut + taille]).decode("latin-1")
        m = re.fullmatch(r"G(\d{6})\s*", valeur)
        if m:
            b[debut] = ord("P")
            modifies += 1
        elif valeur.strip():
            raise SystemExit(f".dbf : identifiant inattendu « {valeur.strip()} » (enregistrement {r + 1})")
    if appliquer:
        with open(DBF, "wb") as f:
            f.write(b)
    return n, modifies


def renommer_json(chemin, appliquer):
    with open(chemin, "r", encoding="utf-8") as f:
        texte = f.read()
    ids = set(ID.findall(texte))
    nouveau = ID.sub(lambda m: "P" + m.group(1), texte)
    if appliquer and nouveau != texte:
        with open(chemin, "w", encoding="utf-8", newline="") as f:
            f.write(nouveau)
        json.loads(nouveau)  # contrôle : le fichier reste du JSON valide
    return len(ids)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--appliquer", action="store_true", help="écrire les modifications (sinon simulation)")
    a = p.parse_args()
    n, modifies = renommer_dbf(a.appliquer)
    print(f"polygones.dbf : {modifies} identifiants sur {n} enregistrements")
    for chemin in JSONS:
        print(f"{os.path.relpath(chemin, RACINE)} : {renommer_json(chemin, a.appliquer)} identifiants distincts")
    print("Modifications écrites." if a.appliquer else "Simulation : rien n'a été écrit (ajouter --appliquer).")


if __name__ == "__main__":
    main()
