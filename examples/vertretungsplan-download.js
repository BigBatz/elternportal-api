// vertretungsplan-download.js
import { getElternportalClient } from "@philippdormann/elternportal-api";
import fs from "fs/promises";
import readline from "readline";
import { stdin as input, stdout as output } from "process";
import config from "./config.js";

const cliOptions = parseCliOptions(process.argv.slice(2));

async function downloadVertretungsplan() {
  const accounts = normalizeConfigs(config).filter(shouldIncludeAccount);

  if (accounts.length === 0) {
    console.warn("Keine passenden Schul-Accounts in config.js gefunden.");
    return;
  }

  for (const account of accounts) {
    const schoolIdentifier = account.short;
    const schoolDisplayName =
      account.schoolName || account.displayName || schoolIdentifier;

    console.log(
      `\n===============================\nSchule: ${schoolDisplayName} (${schoolIdentifier})\n===============================`
    );

    try {
      console.log("Verbinde mit dem Elternportal...");

      const client = await getElternportalClient({
        short: account.short,
        username: account.username,
        password: account.password,
        kidId: account.kidId,
      });

      console.log("✅ Anmeldung erfolgreich!");

      const kids = await client.getKids();
      if (!kids || kids.length === 0) {
        console.warn("⚠️  Keine Kinderinformationen gefunden, überspringe.");
        continue;
      }

      const selectedKids = await resolveKidsForAccount({
        kids,
        account,
        schoolDisplayName,
      });

      if (selectedKids.length === 0) {
        console.warn(
          "⚠️  Keine passenden Kinder für diese Konfiguration ausgewählt, überspringe."
        );
        continue;
      }

      for (const kid of selectedKids) {
        if (typeof client.setKid === "function") {
          await client.setKid(kid.id);
        }

        const plan = await client.getVertretungsplan();
        const lastUpdateIso = plan.lastUpdate?.toISOString() ?? null;
        console.log(
          `Vertretungsplan für ${kid.firstName ?? "Kind"} geladen (${plan.substitutions.length} Einträge, Stand: ${
            lastUpdateIso ?? "unbekannt"
          }).`
        );

        await exportKidVertretungsplan({
          kid,
          account,
          schoolDisplayName,
          plan,
        });
      }
    } catch (error) {
      console.error(
        "❌ Fehler beim Laden des Vertretungsplans für diese Schule:",
        error
      );
      console.error("Details:", error?.message ?? error);
    }
  }
}

async function exportKidVertretungsplan({
  kid,
  account,
  schoolDisplayName,
  plan,
}) {
  const kidLabel = formatKidLabel(kid);
  console.log(`\n--- ${kidLabel} (${kid.className}) ---`);

  const sortedEntries = [...plan.substitutions].sort((a, b) => {
    const dateDiff = (a.date?.getTime?.() ?? 0) - (b.date?.getTime?.() ?? 0);
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return (a.period ?? 0) - (b.period ?? 0);
  });

  const exportedEntries = sortedEntries.map((entry) =>
    normalizeSubstitutionEntry({
      date: entry.date,
      period: entry.period,
      originalTeacher: entry.originalTeacher,
      substituteTeacher: entry.substituteTeacher,
      originalClass: entry.originalClass,
      substituteClass: entry.substituteClass,
      room: entry.room,
      note: entry.note,
    })
  );

  const exportPayload = {
    schoolIdentifier: account.short,
    schoolDisplayName,
    kid: {
      id: kid.id,
      firstName: kid.firstName,
      lastName: kid.lastName,
      className: kid.className,
    },
    lastUpdate: null,
    substitutions: [],
  };

  const baseName = buildFileBaseName({ kid });
  const fileName = `vertretungsplan_${baseName}.json`;

  const existing = await readExistingPlan(fileName);
  const existingEntries = Array.isArray(existing?.substitutions)
    ? existing.substitutions.map((entry) => normalizeSubstitutionEntry(entry))
    : [];

  const { mergedEntries, additions, replacements } = mergeSubstitutions(
    existingEntries,
    exportedEntries
  );

  const existingLastUpdateIso = normalizeIsoTimestamp(existing?.lastUpdate);
  const planLastUpdateIso = normalizeIsoTimestamp(plan.lastUpdate);
  const finalLastUpdateIso = determineLatestTimestamp(
    existingLastUpdateIso,
    planLastUpdateIso
  );

  const existingSorted = sortSubstitutions([...existingEntries]);
  const contentChanged =
    JSON.stringify(existingSorted) !== JSON.stringify(mergedEntries);
  const lastUpdateChanged = finalLastUpdateIso !== existingLastUpdateIso;

  exportPayload.lastUpdate = finalLastUpdateIso;
  exportPayload.substitutions = mergedEntries;

  await fs.writeFile(fileName, JSON.stringify(exportPayload, null, 2), "utf8");

  const finalCount = mergedEntries.length;
  if (contentChanged || lastUpdateChanged) {
    const changeSummary = buildChangeSummary({
      additions,
      replacements,
      lastUpdateChanged,
      contentChanged,
    });
    console.log(
      `✅ Vertretungsplan für ${kidLabel} aktualisiert in "${fileName}" (insgesamt ${finalCount} Einträge; ${
        changeSummary || "Aktualisiert"
      }; Stand: ${finalLastUpdateIso ?? "unbekannt"}).`
    );
  } else {
    console.log(
      `ℹ️  Vertretungsplan für ${kidLabel} unverändert in "${fileName}" gespeichert (insgesamt ${finalCount} Einträge; Stand: ${
        finalLastUpdateIso ?? "unbekannt"
      }).`
    );
  }
}

async function readExistingPlan(fileName) {
  try {
    const content = await fs.readFile(fileName, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function normalizeSubstitutionEntry(entry) {
  return {
    date: normalizeIsoTimestamp(entry?.date),
    period: normalizePeriod(entry?.period),
    originalTeacher: normalizeString(entry?.originalTeacher),
    substituteTeacher: normalizeString(entry?.substituteTeacher),
    originalClass: normalizeString(entry?.originalClass),
    substituteClass: normalizeString(entry?.substituteClass),
    room: normalizeString(entry?.room),
    note: normalizeString(entry?.note),
  };
}

function mergeSubstitutions(existingEntries, newEntries) {
  // Wir halten ältere Einträge im JSON fest, auch wenn das Portal sie nicht
  // mehr liefert. Neue Einträge werden ergänzt, bestehende ggf. ersetzt und am
  // Ende konsistent sortiert zurückgegeben.
  const order = [];
  const map = new Map();

  for (const entry of existingEntries) {
    const key = buildEntryKey(entry);
    if (!map.has(key)) {
      map.set(key, entry);
      order.push(key);
    }
  }

  let additions = 0;
  let replacements = 0;

  for (const entry of newEntries) {
    const key = buildEntryKey(entry);
    if (!map.has(key)) {
      map.set(key, entry);
      order.push(key);
      additions += 1;
    } else if (!areEntriesEqual(map.get(key), entry)) {
      map.set(key, entry);
      replacements += 1;
    }
  }

  const mergedEntries = sortSubstitutions(
    order
      .map((key) => map.get(key))
      .filter((entry) => Boolean(entry))
  );
  return { mergedEntries, additions, replacements };
}

function sortSubstitutions(entries) {
  return entries.sort(compareSubstitutions);
}

function compareSubstitutions(a, b) {
  const dateA = dateToComparable(a.date);
  const dateB = dateToComparable(b.date);
  if (dateA !== dateB) {
    return dateA < dateB ? -1 : 1;
  }

  const periodA = a.period ?? Number.POSITIVE_INFINITY;
  const periodB = b.period ?? Number.POSITIVE_INFINITY;
  if (periodA !== periodB) {
    return periodA < periodB ? -1 : 1;
  }

  const keyA = buildEntryKey(a);
  const keyB = buildEntryKey(b);
  return keyA.localeCompare(keyB);
}

function dateToComparable(value) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return Number.POSITIVE_INFINITY;
  }
  return parsed;
}

function buildEntryKey(entry) {
  return [
    entry.date ?? "",
    entry.period ?? "",
    entry.originalTeacher,
    entry.substituteTeacher,
    entry.originalClass,
    entry.substituteClass,
    entry.room,
    entry.note,
  ].join("||");
}

function areEntriesEqual(a, b) {
  return (
    a.date === b.date &&
    a.period === b.period &&
    a.originalTeacher === b.originalTeacher &&
    a.substituteTeacher === b.substituteTeacher &&
    a.originalClass === b.originalClass &&
    a.substituteClass === b.substituteClass &&
    a.room === b.room &&
    a.note === b.note
  );
}

function normalizeIsoTimestamp(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function normalizePeriod(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value == null) {
    return null;
  }
  const parsed = Number.parseInt(`${value}`.trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeString(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) {
    return "";
  }
  return `${value}`.trim();
}

function determineLatestTimestamp(...timestamps) {
  const candidates = timestamps
    .filter(Boolean)
    .map((iso) => ({ iso, time: Date.parse(iso) }))
    .filter(({ time }) => !Number.isNaN(time));
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => a.time - b.time);
  return candidates[candidates.length - 1].iso;
}

function buildChangeSummary({
  additions,
  replacements,
  lastUpdateChanged,
  contentChanged,
}) {
  const parts = [];
  if (additions > 0) {
    parts.push(`${additions} neue Einträge`);
  }
  if (replacements > 0) {
    parts.push(`${replacements} aktualisierte Einträge`);
  }
  if (parts.length === 0 && contentChanged) {
    parts.push("Einträge neu sortiert");
  }
  if (lastUpdateChanged) {
    parts.push("Stand aktualisiert");
  }
  return parts.join(", ");
}

function normalizeConfigs(rawConfig) {
  if (!rawConfig) {
    return [];
  }

  if (Array.isArray(rawConfig)) {
    return rawConfig;
  }

  if (Array.isArray(rawConfig.accounts)) {
    return rawConfig.accounts;
  }

  return [rawConfig];
}

function shouldIncludeAccount(account) {
  if (!cliOptions.schools.length) {
    return true;
  }
  const candidates = [account.short, account.schoolName, account.displayName]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return cliOptions.schools.some((school) => candidates.includes(school));
}

async function resolveKidsForAccount({ kids, account, schoolDisplayName }) {
  let selected = [...kids];

  let filteredByCli = false;

  if (Array.isArray(account.kids) && account.kids.length > 0) {
    selected = uniqueKids(
      account.kids.flatMap((selector) =>
        kids.filter((kid) => matchKidSelector(kid, selector))
      )
    );
  }

  if (cliOptions.kidIds.length > 0) {
    selected = selected.filter((kid) => cliOptions.kidIds.includes(kid.id));
    filteredByCli = true;
  }

  if (cliOptions.kidNames.length > 0) {
    selected = selected.filter((kid) =>
      cliOptions.kidNames.includes((kid.firstName || "").toLowerCase()) ||
      cliOptions.kidNames.includes((kid.lastName || "").toLowerCase()) ||
      cliOptions.kidNames.includes(
        `${kid.firstName || ""} ${kid.lastName || ""}`
          .trim()
          .toLowerCase()
      )
    );
    filteredByCli = true;
  }

  if (filteredByCli && selected.length === 0) {
    return [];
  }

  if (selected.length === 0 && kids.length === 1) {
    selected = [kids[0]];
  }

  if (selected.length === 0) {
    if (cliOptions.nonInteractive) {
      return [];
    }
    selected = await promptForKidSelection({
      kids,
      schoolDisplayName,
      schoolIdentifier: account.short,
    });
  }

  return uniqueKids(selected);
}

function matchKidSelector(kid, selector) {
  if (selector == null) {
    return false;
  }

  if (selector === "all") {
    return true;
  }

  if (typeof selector === "number") {
    return kid.id === selector;
  }

  if (typeof selector === "string") {
    const normalized = selector.toLowerCase();
    return [
      kid.id?.toString(),
      kid.firstName?.toLowerCase(),
      kid.lastName?.toLowerCase(),
      `${kid.firstName ?? ""} ${kid.lastName ?? ""}`.trim().toLowerCase(),
      kid.className?.toLowerCase(),
    ].some((value) => value === normalized);
  }

  if (typeof selector === "object") {
    if (
      selector.id != null &&
      Number.parseInt(selector.id, 10) !== Number.parseInt(`${kid.id}`, 10)
    ) {
      return false;
    }
    if (
      selector.firstName &&
      selector.firstName.toLowerCase() !== (kid.firstName || "").toLowerCase()
    ) {
      return false;
    }
    if (
      selector.lastName &&
      selector.lastName.toLowerCase() !== (kid.lastName || "").toLowerCase()
    ) {
      return false;
    }
    if (
      selector.className &&
      selector.className.toLowerCase() !== (kid.className || "").toLowerCase()
    ) {
      return false;
    }
    return true;
  }

  return false;
}

async function promptForKidSelection({
  kids,
  schoolDisplayName,
  schoolIdentifier,
}) {
  console.log(
    `Mehrere Kinder für ${schoolDisplayName} (${schoolIdentifier}) gefunden.`
  );
  kids.forEach((kid, index) => {
    const label = formatKidLabel(kid);
    console.log(
      `  [${index + 1}] ${label} - Klasse ${kid.className} (ID: ${kid.id})`
    );
  });

  const answer = (
    await askQuestion(
      "Bitte die gewünschten Kinder auswählen (z. B. 1 oder 1,3, 'all' für alle, Enter für alle): "
    )
  )
    .trim()
    .toLowerCase();

  if (answer === "" || answer === "all") {
    return kids;
  }

  const selectedIndexes = answer
    .split(/[,\s]+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => !Number.isNaN(value) && value >= 1 && value <= kids.length);

  if (selectedIndexes.length === 0) {
    console.warn("Keine gültige Auswahl getroffen, überspringe.");
    return [];
  }

  return uniqueKids(selectedIndexes.map((index) => kids[index - 1]));
}

function uniqueKids(list) {
  const map = new Map();
  for (const kid of list) {
    if (kid) {
      map.set(kid.id, kid);
    }
  }
  return Array.from(map.values());
}

function askQuestion(query) {
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

function buildFileBaseName({ kid }) {
  const parts = [kid.className, kid.firstName, kid.lastName];
  const base = parts
    .map((value) => sanitizeForFilename(value || ""))
    .filter(Boolean)
    .join("_");
  if (base.length > 0) {
    return base;
  }
  return sanitizeForFilename(`kid-${kid.id || "unbekannt"}`) || "kind";
}

function sanitizeForFilename(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function formatKidLabel(kid) {
  return [kid.firstName, kid.lastName].filter(Boolean).join(" ") || `Kind ${kid.id}`;
}

function parseCliOptions(args) {
  const options = {
    schools: [],
    kidIds: [],
    kidNames: [],
    nonInteractive: false,
  };

  for (const arg of args) {
    if (arg === "--non-interactive") {
      options.nonInteractive = true;
      continue;
    }

    const [key, value] = arg.split("=");
    if (!value) {
      continue;
    }

    const normalizedValue = value.trim();
    switch (key) {
      case "--school":
        options.schools.push(normalizedValue.toLowerCase());
        break;
      case "--kid":
        options.kidIds.push(Number.parseInt(normalizedValue, 10));
        break;
      case "--kidName":
        options.kidNames.push(normalizedValue.toLowerCase());
        break;
      default:
        break;
    }
  }

  options.kidIds = options.kidIds.filter((id) => !Number.isNaN(id));

  return options;
}

downloadVertretungsplan();
