#!/usr/bin/env node
/**
 * Elternportal Tooling – Sync CLI
 *
 * Zweck: Synchronisiert JSON-Einträge mit einem CalDAV-Kalender und aktualisiert
 * den lokalen Status (`lastSyncedAt`, `_syncHash`). Wird für CLI & Docker genutzt.
 *
 * Versionshistorie:
 * - v1.0.0 (2025-09) – initiale CLI-Version.
 */
import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { hideBin } from "yargs/helpers";
import yargs from "yargs";
import { readPlan, writePlan } from "../lib/storage/json.js";
import { formatDateTimeGerman } from "../lib/shared/datetime.js";
import { generateIcsString, buildSyncHash } from "../lib/calendar/ics.js";
import { putEvent, deleteEvent } from "../lib/calendar/icloud.js";
import { buildKidSlug, sourceToSlug } from "../lib/elternportal/exporters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv = yargs(hideBin(process.argv))
  .option("input", {
    alias: "i",
    type: "string",
    describe: "Pfad zur JSON-Datei mit Kalender-Einträgen",
  })
  .option("output-dir", {
    type: "string",
    describe: "Basisverzeichnis, in dem die Export-Dateien liegen",
    default: process.env.OUTPUT_DIR ?? path.resolve(__dirname, "../../data"),
  })
  .option("source", {
    type: "string",
    describe: "Welche Datenquelle synchronisiert werden soll (für automatische Pfadauflösung)",
    choices: ["vertretung", "schulaufgaben", "termine"],
    default: process.env.CAL_SOURCE ?? "vertretung",
  })
  .option("kid-id", {
    type: "number",
    describe: "Kind-ID zur Auswahl der richtigen Export-Datei",
  })
  .option("kid-name", {
    type: "array",
    describe: "Kind-Name (Vor- oder Nachname, mehrfach möglich) zur Auswahl der Export-Datei",
    default: [],
  })
  .option("kid-slug", {
    type: "string",
    describe: "Slug des Kind-Ordners (falls bekannt)",
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
  .option("uid-prefix", {
    type: "string",
    describe: "Optionaler Prefix, der vor die UID gesetzt wird (Kalender-spezifisch)",
  })
  .help()
  .alias("h", "help")
  .parse();

function buildRemoteUid({ uid, prefix }) {
  if (!prefix) {
    return uid;
  }
  return `${prefix}${uid}`;
}

function normalizeCalendarUrl(url) {
  if (!url) {
    return url;
  }
  return url.endsWith("/") ? url : `${url}/`;
}

function normalizeValue(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim().toLowerCase();
}

function buildCandidateNames({ kid, slug }) {
  const first = normalizeValue(kid?.firstName);
  const last = normalizeValue(kid?.lastName);
  const className = normalizeValue(kid?.className);
  const id = kid?.id != null ? normalizeValue(kid.id) : "";
  const names = new Set();
  if (first) names.add(first);
  if (last) names.add(last);
  if (first && last) {
    names.add(`${first} ${last}`.trim());
    names.add(`${last} ${first}`.trim());
  }
  if (className) names.add(className);
  if (slug) names.add(normalizeValue(slug));
  if (id) names.add(id);
  return names;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveInputPath({
  explicitPath,
  outputDir,
  source,
  kidSlug,
  kidId,
  kidNames,
}) {
  if (explicitPath) {
    const resolved = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(process.cwd(), explicitPath);
    return resolved;
  }

  const baseDir = outputDir
    ? path.isAbsolute(outputDir)
      ? outputDir
      : path.resolve(process.cwd(), outputDir)
    : null;

  if (!baseDir) {
    throw new Error("output-dir ist erforderlich, wenn kein input angegeben ist.");
  }

  const sourceSlug = sourceToSlug(source);

  if (kidSlug) {
    const candidate = path.join(baseDir, kidSlug, `${sourceSlug}.json`);
    if (!(await pathExists(candidate))) {
      throw new Error(`Plan-Datei nicht gefunden: ${candidate}`);
    }
    return candidate;
  }

  const dirents = await fs.readdir(baseDir, { withFileTypes: true });
  const matches = [];
  const normalizedNames = (kidNames ?? [])
    .map((value) => normalizeValue(value))
    .filter(Boolean);
  const normalizedId = kidId != null && !Number.isNaN(kidId)
    ? normalizeValue(kidId)
    : null;

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const candidatePath = path.join(baseDir, dirent.name, `${sourceSlug}.json`);
    if (!(await pathExists(candidatePath))) {
      continue;
    }
    const plan = await readPlan(candidatePath);
    if (!plan) {
      continue;
    }
    const kidMeta = plan.metadata?.kid ?? {};
    const slug = buildKidSlug({
      id: kidMeta.id,
      firstName: kidMeta.firstName,
      lastName: kidMeta.lastName,
      className: kidMeta.className,
    });
    const candidateNames = buildCandidateNames({ kid: kidMeta, slug });

    if (normalizedId && !candidateNames.has(normalizedId)) {
      continue;
    }

    if (
      normalizedNames.length > 0 &&
      !normalizedNames.some((name) => candidateNames.has(name))
    ) {
      continue;
    }

    matches.push({
      filePath: candidatePath,
      kid: kidMeta,
      slug,
    });
  }

  if (matches.length === 0) {
    const filters = [];
    if (normalizedId) filters.push(`Kid-ID ${normalizedId}`);
    if (normalizedNames.length > 0) filters.push(`Kid-Name ${normalizedNames.join(", ")}`);
    const filterText = filters.length ? ` (Filter: ${filters.join(", ")})` : "";
    throw new Error(
      `Keine passende Export-Datei im Verzeichnis ${baseDir} gefunden${filterText}.`
    );
  }

  if (matches.length > 1) {
    const found = matches
      .map((match) => {
        const kid = match.kid ?? {};
        const name = [kid.firstName, kid.lastName].filter(Boolean).join(" ") || "(unbekannt)";
        const className = kid.className ? ` / ${kid.className}` : "";
        return `${name}${className} -> ${match.filePath}`;
      })
      .join("; ");
    throw new Error(
      `Mehrere Export-Dateien gefunden. Bitte Filter präzisieren. Kandidaten: ${found}`
    );
  }

  return matches[0].filePath;
}

async function main() {
  const kidNames = Array.isArray(argv["kid-name"]) ? argv["kid-name"] : [argv["kid-name"]];

  const inputPath = await resolveInputPath({
    explicitPath: argv.input,
    outputDir: argv["output-dir"],
    source: argv.source,
    kidSlug: argv["kid-slug"],
    kidId: argv["kid-id"],
    kidNames,
  });

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

  const debugCurl = process.env.DEBUG_CALDAV_CMD === "1";
  const uidPrefix = argv["uid-prefix"] ?? process.env.CAL_UID_PREFIX ?? "";
  const calendarUrl = normalizeCalendarUrl(argv["calendar-url"]);

  if (!calendarUrl) {
    throw new Error("calendar-url ist erforderlich (CAL_URL Umgebungsvariable setzen).");
  }

  console.log(`📄 Plan-Datei: ${inputPath}`);
  console.log(`📤 Synchronisiere ${entries.length} Einträge nach ${calendarUrl}`);

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
    const remoteUid = buildRemoteUid({ uid: entry.uid, prefix: uidPrefix });
    const remoteEventUrl = `${calendarUrl}${encodeURIComponent(remoteUid)}.ics`;

    if (entry._syncHash && entry._syncHash === incomingHash) {
      skipped += 1;
      updatedEntries.push(entry);
      continue;
    }

    const icsContent = generateIcsString({
      calendarName,
      entry: { ...entry, uid: remoteUid, summary },
      organizer,
      reminderMinutes: argv.reminder,
    });

    if (debugCurl) {
      const curlCommand = [
        `curl -u "${argv.username}:${argv.password}"`,
        '-H "Content-Type: text/calendar; charset=utf-8"',
        '-X PUT',
        "--data-binary @- <<'EOF'",
        icsContent,
        'EOF',
        `"${remoteEventUrl}"`,
      ].join(" \\\n  ");

      console.log("\n[DEBUG] CalDAV cURL Befehl:");
      console.log(curlCommand);
      console.log();
    }

    await putEvent({
      calendarUrl,
      credentials,
      icsContent,
      uid: remoteUid,
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

    const displayUid = remoteUid === entry.uid ? entry.uid : `${remoteUid} (Quelle: ${entry.uid})`;
    console.log(`✔ Event synchronisiert: ${displayUid}`);
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
    await pruneRemoteEntries({ plan, calendarUrl, credentials });
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
