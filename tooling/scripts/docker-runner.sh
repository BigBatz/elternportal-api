#!/bin/sh
# Docker Runner Script
# Zweck: Wird im Container aufgerufen, installiert Abhängigkeiten (falls nötig)
# und führt Export/Sync in einer Endlosschleife aus.
# Nutzt die Umgebung: EP_CONFIG, OUTPUT_DIR, CAL_URL_KIND*, ICLOUD_USER_KIND*,
# ICLOUD_PASS_KIND*, CAL_UID_PREFIX, CAL_UID_PREFIX_KIND*, CAL_KID_ID_KIND*,
# CAL_KID_NAME_KIND*, CAL_KID_SLUG_KIND*, CAL_SOURCE, CAL_SOURCE_KIND*,
# CAL_SOURCES_KIND*, EXPORT_SOURCES, SYNC_INTERVAL.

set -euo pipefail

ROOT_DIR="/workspace"
TOOLING_DIR="/workspace/tooling"

SYNC_INTERVAL="${SYNC_INTERVAL:-1800}"
OUTPUT_DIR="${OUTPUT_DIR:-/data}"
CONFIG_PATH="${EP_CONFIG:-../tooling/config.prod.js}"

list_sources() {
  local raw="$1"
  local fallback="$2"
  if [ -z "$raw" ]; then
    raw="$fallback"
  fi
  raw="${raw//,/ }"
  for item in $raw; do
    if [ -n "$item" ]; then
      printf '%s\n' "$item"
    fi
  done
}

run_sync_for_kind() {
  index="$1"
  eval "cal_url=\${CAL_URL_KIND${index}:-}"
  if [ -z "$cal_url" ]; then
    echo "[Runner] CAL_URL_KIND${index} nicht gesetzt – überspringe Sync ${index}"
    return 0
  fi

  eval "user=\${ICLOUD_USER_KIND${index}:-}"
  eval "pass=\${ICLOUD_PASS_KIND${index}:-}"
  if [ -z "$user" ] || [ -z "$pass" ]; then
    echo "[Runner] Zugangsdaten für Kind ${index} unvollständig – überspringe"
    return 0
  fi

  eval "uid_prefix=\${CAL_UID_PREFIX_KIND${index}:-${CAL_UID_PREFIX:-}}"
  eval "kid_id=\${CAL_KID_ID_KIND${index}:-}"
  eval "kid_name=\${CAL_KID_NAME_KIND${index}:-}"
  eval "kid_slug=\${CAL_KID_SLUG_KIND${index}:-}"
  eval "sources_raw=\${CAL_SOURCES_KIND${index}:-}"
  if [ -z "$sources_raw" ]; then
    eval "sources_raw=\${CAL_SOURCE_KIND${index}:-}"
  fi
  if [ -z "$sources_raw" ]; then
    sources_raw="${CAL_SOURCE:-}"
  fi
  if [ -z "$sources_raw" ]; then
    sources_raw="${EXPORT_SOURCES:-}"
  fi
  if [ -z "$sources_raw" ]; then
    sources_raw="vertretung"
  fi

  for source in $(list_sources "$sources_raw" "vertretung"); do
    set -- \
      --source "$source" \
      --output-dir "$OUTPUT_DIR" \
      --calendar-url "$cal_url"

    if [ -n "$kid_id" ]; then
      set -- "$@" --kid-id "$kid_id"
    fi

    if [ -n "$kid_name" ]; then
      set -- "$@" --kid-name "$kid_name"
    fi

    if [ -n "$kid_slug" ]; then
      set -- "$@" --kid-slug "$kid_slug"
    fi

    echo "[Runner] $(date -u) – Sync Kind ${index} (Quelle: $source)"
    (
      cd "$TOOLING_DIR" && \
        CAL_UID_PREFIX="$uid_prefix" \
        ICLOUD_USER="$user" \
        ICLOUD_PASS="$pass" \
        npm run sync -- "$@"
    )
  done
}

echo "[Runner] npm install im Projektwurzelverzeichnis..."
(cd "$ROOT_DIR" && npm install >/tmp/npm-install-root.log 2>&1) || { cat /tmp/npm-install-root.log; exit 1; }

echo "[Runner] npm run build (Bibliothek bereitstellen)..."
(cd "$ROOT_DIR" && npm run build >/tmp/npm-build.log 2>&1) || { cat /tmp/npm-build.log; exit 1; }

echo "[Runner] npm install im Tooling-Verzeichnis..."
(cd "$TOOLING_DIR" && npm install >/tmp/npm-install-tooling.log 2>&1) || { cat /tmp/npm-install-tooling.log; exit 1; }

echo "[Runner] Loop gestartet – Intervall ${SYNC_INTERVAL}s"

while true; do
  export_sources="${EXPORT_SOURCES:-}"
  if [ -z "$export_sources" ]; then
    if [ -n "$CAL_SOURCE" ]; then
      export_sources="$CAL_SOURCE"
    else
      export_sources="vertretung"
    fi
  fi

  for source in $(list_sources "$export_sources" "vertretung"); do
    echo "[Runner] $(date -u) – Export starten (Quelle: $source)"
    (cd "$TOOLING_DIR" && npm run export -- --source "$source" --config "$CONFIG_PATH" --output-dir "$OUTPUT_DIR")
  done

  run_sync_for_kind 1
  run_sync_for_kind 2

  echo "[Runner] $(date -u) – Warte ${SYNC_INTERVAL}s"
  sleep "$SYNC_INTERVAL"
done
