#!/usr/bin/env node
// CLI, das JSON-Einträge in einen CalDAV-Kalender überträgt und Status zurückschreibt.
import "dotenv/config";
import path from "path";
import { hideBin } from "yargs/helpers";
import yargs from "yargs";
import { readPlan, writePlan } from "../lib/storage/json.js";
import { formatDateTimeGerman } from "../lib/shared/datetime.js";
import { generateIcsString, buildSyncHash } from "../lib/calendar/ics.js";
import { putEvent, deleteEvent } from "../lib/calendar/icloud.js";

const argv = yargs(hideBin(process.argv))
  .option("input", {
    alias: "i",
    type: "string",
    describe: "Pfad zur JSON-Datei mit Kalender-Einträgen",
    demandOption: true,
  })
  .option("calendar-url", {
    alias: "u",
    type: "string",
    describe: "CalDAV Basis-URL (endet auf /)",
    default: process.env.CAL_URL || process.env.ICAL_CAL_URL || process.env.ICLOUD_CAL_URL,
  })
  .option("username", {
    type: "string",
    describe: "CalDAV Benutzer",
    default: process.env.ICLOUD_USER,
  })
  .option("password", {
    type: "string",
    describe: "CalDAV Passwort / App-spezifisches Passwort",
    default: process.env.ICLOUD_PASS,
  })
  .option("reminder", {
    type: "number",
    describe: "Standard-Erinnerung in Minuten",
    default: process.env.REMINDER_MINUTES
      ? Number.parseInt(process.env.REMINDER_MINUTES, 10)
      : undefined,
  })
  .option("organizer-email", {
    type: "string",
    describe: "Organiser-E-Mail-Adresse",
    default: process.env.ORGANIZER_EMAIL,
  })
  .option("organizer-cn", {
    type: "string",
    describe: "Organiser-Anzeige-Name",
    default: process.env.ORGANIZER_CN,
  })
  .option("prune", {
    type: "boolean",
    describe: "Events entfernen, die nicht mehr in der JSON-Datei enthalten sind",
    default: false,
  })
  .help()
  .alias("h", "help")
  .parse();

async function main() {
  const inputPath = path.isAbsolute(argv.input)
    ? argv.input
    : path.resolve(process.cwd(), argv.input);

  const plan = await readPlan(inputPath);
  if (!plan) {
    throw new Error(`Plan-Datei nicht gefunden: ${inputPath}`);
  }

  const entries = Array.isArray(plan.entries) ? plan.entries : [];
  if (!entries.length) {
    console.log("ℹ️  Keine Einträge zum Synchronisieren vorhanden.");
    return;
  }

  const calendarName = plan.metadata?.kid?.className
    ? `${plan.metadata.kid.className} – ${plan.metadata.school?.displayName ?? "Elternportal"}`
    : plan.metadata?.school?.displayName ?? "Elternportal";

  const kidInfo = plan.metadata?.kid;
  const kidFirstName = kidInfo?.firstName?.trim();
  const kidLabel = kidInfo
    ? kidFirstName && kidFirstName.length > 0
      ? kidFirstName
      : `Kind ${kidInfo.id ?? ""}`.trim()
    : null;

  const organizer = argv["organizer-email"]
    ? { email: argv["organizer-email"], cn: argv["organizer-cn"] }
    : null;

  const credentials = {
    username: argv.username,
    password: argv.password,
  };

  if (!argv["calendar-url"]) {
    throw new Error("calendar-url ist erforderlich (CAL_URL Umgebungsvariable setzen).");
  }

  console.log(`📤 Synchronisiere ${entries.length} Einträge nach ${argv["calendar-url"]}`);

  const updatedEntries = [];
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.uid) {
      console.warn("⚠️  Überspringe Eintrag ohne UID", entry);
      continue;
    }

    const summary =
      kidLabel && entry.summary && !entry.summary.startsWith(`${kidLabel} –`)
        ? `${kidLabel} – ${entry.summary}`
        : entry.summary;

    const incomingHash = buildSyncHash({ entry: { ...entry, summary } });

    if (entry._syncHash && entry._syncHash === incomingHash) {
      skipped += 1;
      updatedEntries.push(entry);
      continue;
    }

    const icsContent = generateIcsString({
      calendarName,
      entry: { ...entry, summary },
      organizer,
      reminderMinutes: argv.reminder,
    });

    await putEvent({
      calendarUrl: argv["calendar-url"],
      credentials,
      icsContent,
      uid: entry.uid,
    });

    const now = new Date();
    const syncedEntry = {
      ...entry,
      summary,
      lastSyncedAt: now.toISOString(),
      lastSyncedAtLocal: formatDateTimeGerman(now),
      _syncHash: incomingHash,
    };
    updatedEntries.push(syncedEntry);

    console.log(`✔ Event synchronisiert: ${entry.uid}`);
  }

  const mergedPlan = {
    ...plan,
    entries: entries.map((entry) => {
      const updated = updatedEntries.find((e) => e.uid === entry.uid);
      return updated ?? entry;
    }),
  };

  await writePlan(inputPath, mergedPlan);

  if (skipped > 0) {
    console.log(`ℹ️  ${skipped} unverändert übersprungen.`);
  }

  if (argv.prune) {
    await pruneRemoteEntries({ plan, calendarUrl: argv["calendar-url"], credentials });
  }
}

async function pruneRemoteEntries({ plan, calendarUrl, credentials }) {
  // Pruning erfordert das Auflisten der vorhandenen Dateien. Da iCloud dies nur
  // über WebDAV REPORT zulässt, belassen wir hier einen Hinweis für eine spätere
  // Erweiterung.
  console.warn(
    "⚠️  prune ist aktuell nicht implementiert. Bitte Events manuell entfernen, falls nötig."
  );
}

main().catch((error) => {
  console.error("❌ Sync fehlgeschlagen:", error.message);
  process.exitCode = 1;
});
