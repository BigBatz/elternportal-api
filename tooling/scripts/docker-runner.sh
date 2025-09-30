#!/bin/sh
# Docker Runner Script
# Zweck: Wird im Container aufgerufen, installiert Abhängigkeiten (falls nötig)
# und führt Export/Sync in einer Endlosschleife aus.
# Nutzt die Umgebung: EP_CONFIG, OUTPUT_DIR, CAL_URL_KIND*, ICLOUD_USER_KIND*,
# ICLOUD_PASS_KIND*, SYNC_INTERVAL.

set -euo pipefail

ROOT_DIR="/workspace"
TOOLING_DIR="/workspace/tooling"

SYNC_INTERVAL="${SYNC_INTERVAL:-1800}"
OUTPUT_DIR="${OUTPUT_DIR:-/data}"
CONFIG_PATH="${EP_CONFIG:-../tooling/config.prod.js}"

echo "[Runner] npm install im Projektwurzelverzeichnis..."
(cd "$ROOT_DIR" && npm install >/tmp/npm-install-root.log 2>&1) || { cat /tmp/npm-install-root.log; exit 1; }

echo "[Runner] npm run build (Bibliothek bereitstellen)..."
(cd "$ROOT_DIR" && npm run build >/tmp/npm-build.log 2>&1) || { cat /tmp/npm-build.log; exit 1; }

echo "[Runner] npm install im Tooling-Verzeichnis..."
(cd "$TOOLING_DIR" && npm install >/tmp/npm-install-tooling.log 2>&1) || { cat /tmp/npm-install-tooling.log; exit 1; }

echo "[Runner] Loop gestartet – Intervall ${SYNC_INTERVAL}s"

while true; do
  echo "[Runner] $(date -u) – Export starten"
  (cd "$TOOLING_DIR" && npm run export -- --source vertretung --config "$CONFIG_PATH" --output-dir "$OUTPUT_DIR")

  echo "[Runner] $(date -u) – Sync Kind 1"
  (cd "$TOOLING_DIR" && npm run sync -- \
    --input "$OUTPUT_DIR/klasse6a_kind1/vertretungsplan.json" \
    --calendar-url "${CAL_URL_KIND1}" \
    --username "${ICLOUD_USER_KIND1}" \
    --password "${ICLOUD_PASS_KIND1}")

  echo "[Runner] $(date -u) – Sync Kind 2"
  (cd "$TOOLING_DIR" && npm run sync -- \
    --input "$OUTPUT_DIR/klasse8e_kind2/vertretungsplan.json" \
    --calendar-url "${CAL_URL_KIND2}" \
    --username "${ICLOUD_USER_KIND2}" \
    --password "${ICLOUD_PASS_KIND2}")

  echo "[Runner] $(date -u) – Warte ${SYNC_INTERVAL}s"
  sleep "$SYNC_INTERVAL"
done
