# Elternportal Tooling

Dieses Verzeichnis enthält Automatisierungen, um Daten aus dem Elternportal zu exportieren und in CalDAV-Kalender (z. B. iCloud) zu synchronisieren.

## Installation

```bash
cd tooling
npm install
```

## Environment Variablen

Kopiere `.env.example` nach `.env` und ergänze die benötigten Werte:

- `EP_CONFIG`: Pfad zur Elternportal-Konfiguration (Standard `../examples/config.js`)
- `EP_SCHOOL`, `EP_KID`, `EP_KID_NAME`: optionale Filter (kommasepariert)
- `OUTPUT_DIR`: Zielverzeichnis für die JSON-Dateien (Standard `../data`)
- `CAL_URL`, `ICLOUD_USER`, `ICLOUD_PASS`: CalDAV Zugangsdaten
- `REMINDER_MINUTES`, `ORGANIZER_EMAIL`, `ORGANIZER_CN`: optionale Kalender-Parameter

## Export

```bash
npm run export -- \
  --source vertretung \
  --school SCHOOL_CODE \
  --kid 1234 \
  --output-dir ../data
```

Verfügbare Quellen: `vertretung`, `schulaufgaben`, `termine`.

Pro Kind entsteht eine Datei `../data/<klasse>_<kind>/<quelle>.json` mit stabilen UIDs. Beispiel: `../data/klasse6a_kind1/vertretung.json`.
Die Metadaten enthalten sowohl deutsche Zeitangaben (`generatedAt`, `lastUpdate`) als auch die zugehörigen ISO-Werte (`generatedAtIso`, `lastUpdateIso`).

## Sync

```bash
npm run sync -- \
  --input ../data/klasse6a_kind1/vertretung.json \
  --calendar-url "$CAL_URL"
```

Die Events werden als `PUT` an `<CAL_URL>/<UID>.ics` gesendet – somit werden existierende Einträge mit derselben UID aktualisiert. Nach erfolgreichem Sync erhält jeder Eintrag einen Zeitstempel `lastSyncedAt` (ISO) und `lastSyncedAtLocal` (deutsche Zeit).

> ⚠️ `--prune` ist vorbereitet, aber noch nicht implementiert.

## Docker / Compose

Die eigentlichen Container-Definitionen liegen im Verzeichnis `../docker`. Jede Pipeline kann dort aus Export + Sync zusammengesetzt werden und nutzt das gemeinsame `data/` Verzeichnis als Archiv.
