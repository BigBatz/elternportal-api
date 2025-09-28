# Elternportal API – Beispiele

Dieses Verzeichnis zeigt, wie du die Elternportal-API in Node-Projekten verwenden kannst. Die Beispiele decken unterschiedliche Anwendungsfälle ab (Informationen auslesen, Schulaufgaben exportieren, allgemeine Termine exportieren) und lassen sich über CLI-Optionen fein steuern.

## Voraussetzungen

- Node.js (≥ 14)
- npm

## Installation

```bash
npm install
cp config.example.js config.js
```

### Konfiguration (`config.js`)

`config.js` kann entweder ein einzelnes Account-Objekt oder – empfohlen – ein `accounts`-Array enthalten. Das Array erlaubt mehrere Schulen und Kinder.

```js
export default {
  accounts: [
    {
      short: "schule-a",          // Schul-Kürzel (Subdomain)
      schoolName: "Schule A",
      username: "dein-login",
      password: "dein-passwort",
      kids: ["Max"],              // optional: Auswahl nach ID, Name, Klasse, "all", Objekt usw.
    },
    {
      short: "schule-b",
      schoolName: "Schule B",
      username: "dein-login",
      password: "dein-passwort",
      kids: ["Erika"],
    },
  ],
};
```

Lässt du `accounts` weg und exportierst nur ein Objekt, funktionieren die Beispiele weiterhin – sie wandeln den Wert intern in ein Array um.

## Verfügbare Beispiele

### 1. Anzeige von Kind- und Schulinformationen

Zeigt grundlegende Informationen zum aktuell aktiven Kind sowie zur Schule.

```bash
npm run info
# oder
node anzeige-kind-schule.js
# optional mit Filtern:
# node anzeige-kind-schule.js [--school=SHORT] [--kid=ID] [--kidName=NAME] [--non-interactive]
```

### 2. Basis-Example wie im ursprünglichen README

Minimalbeispiel, das die API so nutzt wie im ursprünglichen Projekt-README beschrieben (ein einzelnes Account-Objekt in `config.js`).

```bash
npm run basic-original
# oder
node basic-original-usage.js
```

### 3. Schulaufgaben als iCal exportieren

Erstellt für jedes ausgewählte Kind eine ICS-Datei mit allen veröffentlichten Schulaufgaben. Mehrtagige Schulaufgaben werden als Range (inkl. Enddatum) erfasst, Zeitangaben bleiben erhalten.

```bash
npm run export-schulaufgaben-ical
# oder
node schulaufgaben-ical.js [--school=SHORT] [--kid=ID] [--kidName=NAME] [--non-interactive]
```

### 4. Allgemeine Termine als iCal exportieren

Schreibt die allgemeinen (nicht nur schulaufgabenbezogenen) Termine der ausgewählten Accounts in ICS-Dateien. Tages- und Zeitangaben werden korrekt in die ICS übernommen.

```bash
npm run export-allgemeine-termine-ical
# oder
node allgemeine-termine-ical.js [--school=SHORT] [--kid=ID] [--kidName=NAME] [--non-interactive]
```

### 5. Elternbriefe herunterladen

Lädt Elternbriefe (inkl. Anhänge) pro ausgewähltem Kind und speichert sie strukturiert im Ordner `elternbriefe/`.

```bash
npm run download-elternbriefe
# oder
node elternbriefe-download.js [--school=SHORT] [--kid=ID] [--kidName=NAME] [--non-interactive]
```

## CLI-Filter & Optionen

- `--school=<short>`: Export nur für bestimmte Schule(n) (mehrfach verwendbar)
- `--kid=<id>`: Auswahl nach interner Kinder-ID (mehrfach verwendbar)
- `--kidName=<name>`: Filter nach Vor-/Nachname (case-insensitive, mehrfach verwendbar)
- `--non-interactive`: Unterdrückt Rückfragen; bei Mehrfachauswahl wird stattdessen übersprungen

Bleiben keine Kinder nach Filterung übrig, werden sie (außer in `--non-interactive`) zur Auswahl angeboten.

## Wiederholte Exporte & Caching

Die Skripte legen pro Kind JSON-Dateien an, z. B. `bekannte-schulaufgaben_klasse-vorname-nachname.json` oder `bekannte-termine_klasse-vorname-nachname.json`. Diese Dateien enthalten die zuletzt exportierten Einträge, damit erneute Läufe nur neue Events anhängen.

## Funktionen der iCal-Exporte

- Abruf der Daten direkt aus dem Elternportal per API
- Erstellung konsistenter ICS-Dateien mit eindeutigen IDs
- Alarm-Erinnerungen (z. B. 1 Woche & 2 Tage vorher)
- Unterstützung von Mehrtages-Terminen und exakten Uhrzeiten
- Trennung zwischen Schulaufgabenterminen und allgemeinen Terminen
- Konfigurierbare Dateinamen (Klasse + Name des Kindes)
- CLI-Filter für zielgerichtete Exporte
- Elternbriefe-Exporte (TXT + PDF) auf Basis derselben Konfiguration

Die erzeugten ICS-Dateien lassen sich in gängigen Kalender-Apps (Apple Kalender, Google Kalender usw.) importieren. Teile den Kalender bei Bedarf mit deiner Familie oder importiere ihn pro Nutzer separat, damit Erinnerungen zuverlässig auf allen Geräten auftauchen.

## Tipp

Falls du die Exporte automatisieren willst (z. B. via Cronjob), kombiniere `--school`, `--kid` und `--non-interactive`, um zielgerichtet genau die Kalender zu erzeugen, die du benötigst.
