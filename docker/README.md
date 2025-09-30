# Docker Automatisierung

Dieses Verzeichnis enthält Beispiel-Konfigurationen, um die Tooling-Skripte per Docker bzw. Docker Compose auszuführen.

## Struktur

- `docker-compose.example.yml` – Vorlage für einen Loop (Export + Sync im Intervall)
- `env/` – Ablage für geheime Konfigurationsdateien (liegt in `.gitignore`)
  - `elternportal.env.example` – Beispiel für Elternportal-spezifische Variablen
  - `icloud.env.example` – Beispiel für CalDAV/iCloud Variablen

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
   Öffne beide Dateien und trage deine Zugangsdaten ein (`SYNC_INTERVAL` steuert das Loop-Intervall, CalDAV-URLs/App-Passwörter für jedes Kind ergänzen).

3. **Docker Compose Beispiel adaptieren** (optional):
   ```bash
   cp docker-compose.example.yml docker-compose.yml
   mkdir -p ../data          # lokales Archivverzeichnis für JSON-Dateien
   ```
   Falls du das Archiv woanders speichern möchtest, passe `OUTPUT_DIR` (in
   `env/elternportal.env`) sowie den Volume-Pfad in `docker-compose.yml`
   entsprechend an.

4. **Loop starten** – der Container exportiert und synchronisiert fortlaufend alle `${SYNC_INTERVAL}` Sekunden (Standard 1800 = 30 Minuten):
   ```bash
   docker compose up -d vertretungsplan-runner
   docker compose logs -f vertretungsplan-runner    # optional: Fortschritt beobachten
   ```
   Die `logging`-Option sorgt dafür, dass maximal fünf Log-Dateien à 10 MB gehalten werden. Stoppen per `docker compose down` oder `docker compose stop vertretungsplan-runner`.

5. **(Optional) einmaligen Lauf ausführen** – falls du den Loop nicht dauerhaft brauchst:
   ```bash
   docker compose run --rm vertretungsplan-runner
   ```
   Der Container bricht nach `Ctrl+C` ab.

Die Container mounten das Projektverzeichnis und das zentrale `../data`-Verzeichnis. Dadurch bleiben alle JSON-Dateien archiviert und können anschließend erneut synchronisiert werden.

> Hinweis: `npm install` wird aktuell pro Lauf ausgeführt. Für dauerhafte Setups empfiehlt sich ein angepasstes Dockerfile, das Abhängigkeiten bereits im Image installiert.
