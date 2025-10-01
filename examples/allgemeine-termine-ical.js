// allgemeine-termine-ical.js
import { getElternportalClient } from "@philippdormann/elternportal-api";
import fs from "fs/promises";
import readline from "readline";
import { stdin as input, stdout as output } from "process";
import config from "./config.js";
import { generateCalendarIcs } from "./lib/ical.js";

const cliOptions = parseCliOptions(process.argv.slice(2));

async function createAllgemeineTermineICS() {
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

      if (!selectedKids.length) {
        console.warn(
          "⚠️  Keine passenden Kinder für diese Konfiguration ausgewählt, überspringe."
        );
        continue;
      }

      const allgemeineTermine = await client.getAllgemeineTermine();
      if (!allgemeineTermine.length) {
        console.log("ℹ️  Keine allgemeinen Termine veröffentlicht.");
        continue;
      }

      console.log(
        `${allgemeineTermine.length} allgemeine Termine für den Export vorbereitet.`
      );

      for (const kid of selectedKids) {
        await exportKidCalendar({
          client,
          account,
          kid,
          schoolDisplayName,
          termine: allgemeineTermine,
        });
      }
    } catch (error) {
      console.error(
        "❌ Fehler beim Erstellen der iCal-Datei für diese Schule:",
        error
      );
      console.error("Details:", error?.message ?? error);
    }
  }
}

async function exportKidCalendar({
  client,
  account,
  kid,
  schoolDisplayName,
  termine,
}) {
  const kidLabel = formatKidLabel(kid);
  console.log(`\n--- ${kidLabel} (${kid.className}) ---`);

  if (typeof client.setKid === "function") {
    await client.setKid(kid.id);
  }

  const baseName = buildFileBaseName({ kid });
  const knownFile = `bekannte-termine_${baseName}.json`;
  const calendarFile = `termine_${baseName}_${new Date()
    .toISOString()
    .slice(0, 10)}.ics`;

  let knownEntries = [];
  try {
    const data = await fs.readFile(knownFile, "utf8");
    knownEntries = JSON.parse(data);
    console.log(`${knownEntries.length} bekannte Termine geladen.`);
  } catch {
    console.log("Keine bekannten Termine gefunden, erstelle neue Datei.");
  }

  const knownIds = new Set(knownEntries.map((entry) => entry.id));
  const newEntries = termine.filter((entry) => !knownIds.has(entry.id));

  console.log(`${newEntries.length} neue Termine gefunden.`);

  if (newEntries.length > 0) {
    const calendarName = `Allgemeine Termine ${kid.firstName} (${kid.className}) - ${schoolDisplayName}`;
    const { ics, count } = generateCalendarIcs(newEntries, {
      calendarName,
      calendarColor: "#1E90FF",
      schoolIdentifier: account.short,
      summaryBuilder: (termin) => `${termin.title} (${kid.className} - ${schoolDisplayName})`,
      descriptionBuilder: (termin) =>
        `Termin für ${
          [kid.firstName, kid.lastName].filter(Boolean).join(" ")
        }, Klasse ${kid.className} (${schoolDisplayName}). Automatisch erstellt aus dem Elternportal.`,
      uidBuilder: (termin) =>
        `${account.short}-${kid.id}-${termin.id}-${termin.startDate?.toISOString() ?? ""}-${termin.endDate?.toISOString() ?? ""}`,
      alarms: [
        {
          trigger: "-P7D",
          description: `Erinnerung: ${kid.firstName} hat in einer Woche einen Termin`,
        },
        {
          trigger: "-P2D",
          description: `Erinnerung: ${kid.firstName} hat in 2 Tagen einen Termin`,
        },
      ],
      onEvent: (termin, index, total) => {
        console.log(`Verarbeite Termin ${index + 1}/${total}: ${termin.title}`);
      },
    });

    if (count > 0) {
      await fs.writeFile(calendarFile, ics, "utf8");
      console.log(
        `✅ iCal-Datei "${calendarFile}" erstellt mit ${count} neuen Terminen für ${kidLabel}.`
      );
    } else {
      console.log("ℹ️  Keine gültigen Termine für den Export gefunden.");
    }
  } else {
    console.log("Keine neuen Termine zum Exportieren vorhanden.");
  }

  await fs.writeFile(knownFile, JSON.stringify(termine, null, 2), "utf8");
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

createAllgemeineTermineICS();
