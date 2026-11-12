#!/bin/sh
# Met à jour sw.js : numéro de version (le même que le build) et liste des fichiers gardés pour l'ouverture sans réseau.
# Appelé par stamp-build.sh. Exclus : sw.js, README, outils, workers, .github, et le gros fichier des nappes (gardé quand il est ouvert en ligne).
cd "$(dirname "$0")/.." || exit 1
VERSION=$(sed -n "s/.*AMGT4CEM_BUILD_TIMESTAMP = '\([0-9-]*\)'.*/\1/p" src/buildInfo.js)
LISTE=$(mktemp)
{
  echo "const FICHIERS = ["
  { printf '%s\n' home.html index.html style.css config.js
    find assets config data src vendor -type f ! -name '.*' ! -path 'data/nappe/intervalles.json' ! -path 'data/*/archive/*'
  } | LC_ALL=C sort | sed "s|.*|  './&',|"
  echo "];"
} > "$LISTE"
awk -v liste="$LISTE" -v version="$VERSION" '
  /@DEBUT-FICHIERS/ { print; while ((getline l < liste) > 0) print l; skip = 1; next }
  /@FIN-FICHIERS/ { skip = 0 }
  skip { next }
  /^const VERSION = / { print "const VERSION = \x27" version "\x27; // @VERSION (écrit par tools/stamp-sw.sh)"; next }
  { print }
' sw.js > sw.js.tmp && mv sw.js.tmp sw.js
rm -f "$LISTE"
git add sw.js 2>/dev/null || true
