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
- `CAL_UID_PREFIX`: optionaler Präfix, der nur beim Sync auf die UID geschrieben wird
- `CAL_SOURCE`: Standardquelle für den Sync (z. B. `vertretung`)
- `EXPORT_SOURCES`: kommaseparierte Liste, welche Quellen der Docker-Runner exportiert (Standard `vertretung`)
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
  --output-dir ../data \
  --kid-name "Niclas Seidel" \
  --calendar-url "$CAL_URL"
# optional: --source vertretung --uid-prefix kind1
```

Der Sync findet die passende Export-Datei automatisch anhand von `--kid-name`, `--kid-id` oder `--kid-slug`. Die bisherige Übergabe per `--input <pfad>` bleibt weiterhin möglich.

Alternativ kannst du den Präfix über die Variable `CAL_UID_PREFIX` setzen, z. B. `CAL_UID_PREFIX=kind1 npm run sync ...`. Der Export bleibt davon unberührt – der Präfix wird erst beim Schreiben in den CalDAV-Kalender vor die UID gesetzt.

Die Events werden als `PUT` an `<CAL_URL>/<UID>.ics` gesendet – somit werden existierende Einträge mit derselben UID aktualisiert. Nach erfolgreichem Sync erhält jeder Eintrag einen Zeitstempel `lastSyncedAt` (ISO) und `lastSyncedAtLocal` (deutsche Zeit).

> ⚠️ `--prune` ist vorbereitet, aber noch nicht implementiert.

## Docker / Compose

Die eigentlichen Container-Definitionen liegen im Verzeichnis `../docker`. Jede Pipeline kann dort aus Export + Sync zusammengesetzt werden und nutzt das gemeinsame `data/` Verzeichnis als Archiv.

Im Beispiel `docker/env/icloud.env` hinterlegst du pro Kalender `CAL_URL_KIND*`, `ICLOUD_USER_KIND*`, `ICLOUD_PASS_KIND*` sowie einen Selektor (`CAL_KID_NAME_KIND*`, `CAL_KID_ID_KIND*` oder `CAL_KID_SLUG_KIND*`). Optional steuerst du mit `EXPORT_SOURCES` (global) und `CAL_SOURCES_KIND*` (pro Kalender) eine Liste der zu synchronisierenden Quellen, z. B. `vertretung,termine`. Der Runner liest daraus die richtige Export-Datei – ein manueller Pfad ist nicht mehr nötig.
