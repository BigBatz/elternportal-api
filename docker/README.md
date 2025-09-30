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
   git clone <dein-fork>
   cd elternportal-api/docker
   ```

2. **Konfigurationsdateien anlegen** (Beispiele kopieren, anschließend Werte eintragen):
   ```bash
   cp env/elternportal.env.example env/elternportal.env
   cp env/icloud.env.example env/icloud.env
   ```
   - `env/elternportal.env`: Zugangsdaten zum Elternportal sowie optionale Filter (`SYNC_INTERVAL` steuert das Loop-Intervall)
   - `env/icloud.env`: je Kind CalDAV-URL + iCloud-Login (app-spezifisches Passwort empfohlen)

3. **Docker Compose Beispiel adaptieren** (optional):
   ```bash
   cp docker-compose.example.yml docker-compose.yml
   ```
   Passe bei Bedarf Pfade oder Klassennamen an (`/data/klasse.../vertretung.json`).

4. **Loop starten** – der Container exportiert und synchronisiert fortlaufend alle `${SYNC_INTERVAL}` Sekunden (Standard 1800 = 30 Minuten):
   ```bash
   docker compose up vertretungsplan-runner
   ```
   Im Hintergrund sorgt der `logging`-Block dafür, dass maximal drei Log-Dateien à 5 MB gehalten werden. Zum Stoppen `Ctrl+C` oder `docker compose down` verwenden.

5. **(Optional) einmaligen Lauf ausführen** – falls du den Loop nicht dauerhaft brauchst:
   ```bash
   docker compose run --rm vertretungsplan-runner
   ```
   Der Container bricht nach `Ctrl+C` ab.

Die Container mounten das Projektverzeichnis und das zentrale `../data`-Verzeichnis. Dadurch bleiben alle JSON-Dateien archiviert und können anschließend erneut synchronisiert werden.

> Hinweis: `npm install` wird aktuell pro Lauf ausgeführt. Für dauerhafte Setups empfiehlt sich ein angepasstes Dockerfile, das Abhängigkeiten bereits im Image installiert.
