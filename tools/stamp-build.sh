#!/bin/sh
# Écrit l'heure réelle (Bruxelles) dans src/buildInfo.js. Appelé par le hook git pre-commit.
cd "$(dirname "$0")/.." || exit 1
STAMP=$(TZ=Europe/Brussels date +%Y%m%d-%H%M)
sed -i "s/AMGT4CEM_BUILD_TIMESTAMP = '[0-9-]*'/AMGT4CEM_BUILD_TIMESTAMP = '$STAMP'/" src/buildInfo.js
