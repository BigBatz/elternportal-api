# Docker Automatisierung

Dieses Verzeichnis enthält Beispiel-Konfigurationen, um die Tooling-Skripte per Docker bzw. Docker Compose auszuführen.

## Struktur

- `docker-compose.example.yml` – Vorlage für einen Loop (Export + Sync im Intervall)
- `env/` – Ablage für geheime Konfigurationen (liegt in `.gitignore`)
  - `elternportal.env.example` – Elternportal-spezifische Variablen (`EP_CONFIG`, Filter, `OUTPUT_DIR`, `PERIOD_END_OFFSET_MINUTES`, `SYNC_INTERVAL` …). Der Export nutzt diese Werte, um sich beim Elternportal anzumelden und die JSON-Dateien zu erzeugen.
  - `icloud.env.example` – CalDAV/iCloud Variablen. Hier definierst du, welcher Export in welchen Kalender geschrieben wird (`CAL_URL_KIND*`, `ICLOUD_USER_KIND*`, `CAL_SOURCES_KIND*`, `CAL_UID_PREFIX*`, ggf. Quelle-spezifische Overrides). Der Docker-Runner liest diese Datei ausschließlich für den Sync.
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
  - `env/elternportal.env`: Steuerungsdatei für den Export. Enthält `EP_CONFIG` (Pfad zur JS-Konfig), optionale Filter (`EP_SCHOOL`, `EP_KID`, `EP_KID_NAME`), das Zielverzeichnis `OUTPUT_DIR`, `SYNC_INTERVAL` (Sekunden) sowie `PERIOD_END_OFFSET_MINUTES`. Alles, was der Export wissen muss, landet hier.
  - `env/icloud.env`: Steuerungsdatei für den Sync. Für jedes Ziel (`KIND*`) definierst du die CalDAV-URL und Zugangsdaten (`CAL_URL_KIND*`, `ICLOUD_USER_KIND*`, `ICLOUD_PASS_KIND*`). Über `CAL_SOURCES_KIND*` / `CAL_SOURCE_KIND*` legst du fest, welche Quellen synchronisiert werden. Bei Bedarf überschreibst du pro Quelle die Werte (`CAL_URL_KIND1_VERTRETUNG`, `CAL_URL_KIND1_SCHULAUFGABEN`, …) oder setzt globale Defaults (`CAL_URL_VERTRETUNG`, …). `KIND_COUNT` gibt an, wie viele dieser Blöcke ausgewertet werden.
  - UID-Präfixe (`CAL_UID_PREFIX`, `CAL_UID_PREFIX_KIND*`, `CAL_UID_PREFIX_KIND*_VERTRETUNG`, …) solltest du nur setzen, wenn deine Kalender eindeutige IDs benötigen (z. B. mehrere Kalender für dasselbe Kind).
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

## Fallback-Reihenfolge der Variablen

Für jede Quelle (`vertretung`, `schulaufgaben`, `termine`) prüft der Runner die Werte in dieser Reihenfolge:

1. `CAL_*_KIND{n}_{QUELLE}` (z. B. `CAL_URL_KIND1_SCHULAUFGABEN`)
2. `CAL_*_{QUELLE}` (globale Defaults je Quelle, z. B. `CAL_URL_SCHULAUFGABEN`)
3. `CAL_*_KIND{n}` (Kindweite Defaults)
4. `CAL_*` (globale Defaults)

Dabei steht `CAL_*` stellvertretend für `CAL_URL`, `ICLOUD_USER`, `ICLOUD_PASS` und `CAL_UID_PREFIX`. Die Quellenliste selbst folgt der Reihenfolge `CAL_SOURCES_KIND{n}` → `CAL_SOURCE_KIND{n}` → `CAL_SOURCE` → `EXPORT_SOURCES` → `vertretung`.

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
