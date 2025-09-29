# ElternPortal API Client 📚

This library provides an easy-to-use interface for interacting with the ElternPortal system, a platform for school-parent communication in Germany.

## Features 🌟

- **Authentication**: Securely log in to the ElternPortal system
- **Kid Management**: Set and retrieve information about children linked to the account
- **School Information**: Fetch various details about the school
- **Announcements**: Get updates from the school's bulletin board (Schwarzes Brett)
- **Calendar**: Retrieve school events and schedules (inkl. Schulaufgaben und allgemeine Termine) – Tabs werden automatisch erkannt
- **Parent Letters**: Access and download parent letters (Elternbriefe)
- **Lost and Found**: View items in the lost and found section
- **Exam Schedules**: Get the dates of upcoming exams
- **Substitute Plan**: Check for changes of the timetable 

## Recent Improvements 🔧

The fork introduces several additions on top of the original project in order to cover real-world workflows more easily:

- **Multi-account configuration & CLI tooling** – the examples now accept multiple schools/kids via a single `config.js` (array or legacy object). Optional CLI flags (`--school`, `--kid`, `--kidName`, `--non-interactive`) allow scripting without manual prompts.
- **Calendar exports as ICS** – requested in [issue #3](https://github.com/philippdormann/elternportal-api/issues/3). Two dedicated scripts generate calendar files for Schulaufgaben and allgemeine Termine separately, with support for date ranges, precise start/end times and duplicate detection through JSON caches.
- **Elternbriefe downloader** – downloads message text plus PDF attachments per child, stores metadata in JSON and resumes gracefully on subsequent runs.
- **Vertretungsplan tooling & parser fixes** – improved HTML parsing ensures that original vs. substitute subjects are extracted correctly (strikethrough vs. replacement), all day sections are processed even if intermediate tables report “Keine Vertretungen”, and substitution dates are emitted in UTC without day shifts. A dedicated example script keeps Vertretungsplan-Einträge pro Kind als JSON-Historie aktuell.
- **Accurate Schulaufgaben detection** – the API now inspects the tab navigation on the Termine page and only returns real exam entries when the Schulaufgaben tab is visible and active, falling back to “allgemein” otherwise.
- **Utility example (`basic-original-usage.js`)** – mirrors the original README flow while still working with the extended configuration, making it easy to sanity-check the API output.

These changes keep the public API surface untouched while providing better tooling for automation and data export.

## Installation 💻

```bash
pnpm i @philippdormann/elternportal-api
```

## Usage 🚀

### Initializing the Client

```typescript
import { getElternportalClient } from "@philippdormann/elternportal-api";

const client = await getElternportalClient({
  short: "schoolcode",
  username: "your_username",
  password: "your_password",
  kidId: 0, // Optional
});
```

### Available Methods

#### Get Kids 👨‍👩‍👧‍👦

```typescript
const kids = await client.getKids();
```

#### Get School Information 🏫

```typescript
const schoolInfo = await client.getSchoolInfos();
```

#### Get Bulletin Board (Schwarzes Brett) 📌

```typescript
const posts = await client.getSchwarzesBrett(includeArchived);
```

#### Get School Calendar (Termine) 📅

```typescript
const events = await client.getTermine(fromDate, toDate);
```

#### Get Timetable 🕒

```typescript
const timetable = await client.getStundenplan();
```

#### Get Lost and Found Items 🧦

```typescript
const lostItems = await client.getFundsachen();
```

#### Get Parent Letters 📬

```typescript
const letters = await client.getElternbriefe();
```

#### Download Files 📁

```typescript
const bulletinFile = await client.getSchwarzesBrettFile(fileId);
const letterFile = await client.getElternbrief(letterId);
```

#### Get exam schedule 📆

```typescript
const examSchedule = await client.getSchulaufgabenplan();
```

> ℹ️  `getSchulaufgabenplan()` liefert nur dann Einträge, wenn das Elternportal tatsächlich einen Schulaufgaben-Tab anbietet. Gibt es ausschließlich allgemeine Termine, wird ein leeres Array zurückgegeben und `getSchulaufgabenplanStatus()` meldet `"allgemein"`.

#### Get general school events 🗓️

```typescript
const generalEvents = await client.getAllgemeineTermine();
```

> 📌  Allgemeine Termine erscheinen ausschließlich, wenn der entsprechende Tab verfügbar ist. Die Einträge sind bereits mit `category: "allgemein"` gekennzeichnet.

#### Get substitute plan 🔄

```typescript
const substitutePlan = await client.getVertretungsplan();
```

> 💾  Siehe `examples/vertretungsplan-download.js` für einen vollständigen Workflow, der Vertretungspläne je Kind zusammenführt und auf Änderungen prüft.

## Types 📝

The library includes TypeScript definitions for various data structures:

- `SchoolInfo`
- `Termin` (Calendar Event)
- `Schulaufgabe` (Exam entry with time range support)
- `AllgemeinerTermin`
- `Elternbrief` (Parent Letter)
- `SchwarzesBrettBox` (Bulletin Board Item)
- `ElternportalFile`
- `Vertretungsplan`

## ICS Export Utility ✨

Under `examples/` you'll find CLI scripts that build on the API to export calendar data as iCal/ICS files (feature requested in [issue #3](https://github.com/philippdormann/elternportal-api/issues/3)). They support:

- Multiple schools/kids via a single config file
- Separate exports for Schulaufgaben vs. allgemeine Termine
- JSON history export for Vertretungspläne inkl. automatischer Zusammenführung
- CLI filters (`--school`, `--kid`, `--kidName`, `--non-interactive`)

Take a look at `examples/README.md` for detailed usage instructions.
