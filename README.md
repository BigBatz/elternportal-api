# ElternPortal API Client 📚

This library provides an easy-to-use interface for interacting with the ElternPortal system, a platform for school-parent communication in Germany.

## Features 🌟

- **Authentication**: Securely log in to the ElternPortal system
- **Kid Management**: Set and retrieve information about children linked to the account
- **School Information**: Fetch various details about the school
- **Announcements**: Get updates from the school's bulletin board (Schwarzes Brett)
- **Calendar**: Retrieve school events and schedules (inkl. Schulaufgaben und allgemeine Termine)
- **Parent Letters**: Access and download parent letters (Elternbriefe)
- **Lost and Found**: View items in the lost and found section
- **Exam Schedules**: Get the dates of upcoming exams
- **Substitute Plan**: Check for changes of the timetable 

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

#### Get general school events 🗓️

```typescript
const generalEvents = await client.getAllgemeineTermine();
```

#### Get substitute plan 🔄

```typescript
const substitutePlan = await client.getVertretungsplan();
```

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
- CLI filters (`--school`, `--kid`, `--kidName`, `--non-interactive`)

Take a look at `examples/README.md` for detailed usage instructions.
