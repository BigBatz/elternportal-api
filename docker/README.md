# Docker Automatisierung

Dieses Verzeichnis enthält Beispiel-Konfigurationen, um die Tooling-Skripte per Docker bzw. Docker Compose auszuführen.

## Struktur

- `docker-compose.example.yml` – Vorlage für einen Loop (Export + Sync im Intervall)
- `env/` – Ablage für geheime Konfigurationen (liegt in `.gitignore`)
  - `elternportal.env.example` – Elternportal-spezifische Variablen (`EP_CONFIG`, Filter, `OUTPUT_DIR`, `PERIOD_END_OFFSET_MINUTES` …)
  - `icloud.env.example` – CalDAV/iCloud Variablen (`CAL_URL_KIND*`, `ICLOUD_USER_KIND*`, `CAL_SOURCES_KIND*`, `CAL_UID_PREFIX*` …)
- `../tooling/scripts/docker-runner.sh` – führt Export + Sync im Loop aus (liest ausschließlich Umgebungsvariablen, keine Secrets im Log)

## Schritt-für-Schritt-Anleitung

1. **Repository auf den Zielrechner klonen** (z. B. den Docker-Host):
   ```bash
   git clone https://github.com/BigBatz/elternportal-api.git
   cd elternportal-api/docker
   ```

2. **Konfigurationsdateien anlegen** (Beispiele kopieren, anschließend Werte eintragen):
   ```bash
   cp env/elternportal.env.example env/elternportal.env
   cp env/icloud.env.example env/icloud.env
   ```
   Öffne beide Dateien und trage deine Zugangsdaten ein. Wichtige Punkte:
   - `env/elternportal.env`: `EP_CONFIG` (Pfad zur JS-Konfig), optional Filter (`EP_SCHOOL`, `EP_KID`, `EP_KID_NAME`), `OUTPUT_DIR`, `SYNC_INTERVAL` (Sekunden), `PERIOD_END_OFFSET_MINUTES` (z. B. `1`, verhindert parallele Darstellung auf iOS).
   - `env/icloud.env`: Für jeden Kalender `CAL_URL_KIND*`, `ICLOUD_USER_KIND*`, `ICLOUD_PASS_KIND*`. Selektor für die passende JSON-Datei per `CAL_KID_NAME_KIND*`, `CAL_KID_ID_KIND*` oder `CAL_KID_SLUG_KIND*`. Mehrere Quellen pro Kalender via `CAL_SOURCES_KIND*=vertretung,termine`; globaler Default über `EXPORT_SOURCES`.
   - UID-Präfixe nur setzen, wenn du je Kalender eindeutige IDs brauchst (`CAL_UID_PREFIX`, `CAL_UID_PREFIX_KIND*`).
   Die Dateien bleiben lokal, da `env/` ignoriert wird – bitte nicht ins Git übernehmen.

3. **Docker Compose Beispiel adaptieren** (optional):
   ```bash
   cp docker-compose.example.yml docker-compose.yml
   mkdir -p ../data          # lokales Archivverzeichnis für JSON-Dateien
   ```
   Falls du das Archiv woanders speichern möchtest, passe `OUTPUT_DIR` (in `env/elternportal.env`) sowie den Volume-Pfad in `docker-compose.yml` an. Das Runner-Skript ermittelt die passenden JSON-Dateien automatisch anhand der Selektoren; ein manuelles Anpassen der Pfade ist nicht mehr nötig.

4. **Loop starten** – der Container exportiert und synchronisiert fortlaufend alle `${SYNC_INTERVAL}` Sekunden (Standard 1800 = 30 Minuten):
   ```bash
   docker compose up -d vertretungsplan-runner
   docker compose logs -f vertretungsplan-runner    # optional: Fortschritt beobachten
   ```
   Beim Start führt das Skript automatisch `npm install` + `npm run build` im Projekt aus, damit `dist/` aktuell ist. Die `logging`-Option sorgt dafür, dass maximal fünf Log-Dateien à 10 MB gehalten werden. Stoppen per `docker compose down` oder `docker compose stop vertretungsplan-runner`.

5. **(Optional) einmaligen Lauf ausführen** – falls du den Loop nicht dauerhaft brauchst:
   ```bash
   docker compose run --rm vertretungsplan-runner
   ```
   Der Container bricht nach `Ctrl+C` ab.

Die Container mounten das Projektverzeichnis und das zentrale `../data`-Verzeichnis. Dadurch bleiben alle JSON-Dateien archiviert und können anschließend erneut synchronisiert werden.

> Hinweis: `npm install` wird aktuell pro Lauf ausgeführt. Für dauerhafte Setups empfiehlt sich ein angepasstes Dockerfile, das Abhängigkeiten bereits im Image installiert.

## Betrieb & Updates

- **Logs prüfen**: `docker compose logs -f vertretungsplan-runner` – Zugangsdaten werden dabei nicht mehr im Klartext ausgegeben; der Sync holt sie aus den Umgebungsvariablen.
- **Konfiguration ändern**: Werte in `env/*.env` anpassen und den Runner neu starten (`docker compose restart vertretungsplan-runner`). Änderungen an `tooling/config.prod.js` oder dem Code greifen automatisch beim nächsten Export.
- **Git-Update einspielen**:
  ```bash
  cd /pfad/zu/elternportal-api
  git pull
  docker compose down
  docker compose up -d
  ```
  Dadurch erhält der laufende Loop den neuen Stand. Die Volumes (`../data`) bleiben erhalten.
