// elternbriefe-download.js
import { getElternportalClient } from "@philippdormann/elternportal-api";
import fs from "fs/promises";
import path from "path";
import readline from "readline";
import { stdin as input, stdout as output } from "process";
import config from "./config.js";

const cliOptions = parseCliOptions(process.argv.slice(2));

async function downloadElternbriefe() {
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

      for (const kid of selectedKids) {
        await downloadForKid({
          client,
          account,
          kid,
          schoolIdentifier,
          schoolDisplayName,
        });
      }
    } catch (error) {
      console.error(
        "❌ Fehler beim Herunterladen der Elternbriefe:",
        error
      );
      console.error("Details:", error?.message ?? error);
    }
  }
}

async function downloadForKid({
  client,
  account,
  kid,
  schoolIdentifier,
  schoolDisplayName,
}) {
  const kidLabel = formatKidLabel(kid);
  console.log(`\n--- ${kidLabel} (${kid.className}) ---`);

  if (typeof client.setKid === "function") {
    await client.setKid(kid.id);
  }

  console.log("Rufe Elternbriefe ab...");
  const letters = await client.getElternbriefe();
  console.log(`${letters.length} Elternbriefe gefunden.`);

  if (!letters.length) {
    return;
  }

  const baseDir = path.join(
    "elternbriefe",
    sanitizeForFilename(schoolIdentifier || "schule"),
    buildKidBaseName({ kid })
  );

  await fs.mkdir(baseDir, { recursive: true });

  const knownFile = path.join(baseDir, "heruntergeladene-elternbriefe.json");
  const listFile = path.join(baseDir, "elternbriefe-liste.json");

  let downloadedLetters = [];
  try {
    const downloadedData = await fs.readFile(knownFile, "utf8");
    downloadedLetters = JSON.parse(downloadedData);
    console.log(`${downloadedLetters.length} bereits heruntergeladene Elternbriefe gefunden.`);
  } catch {
    console.log("Keine Liste heruntergeladener Elternbriefe gefunden. Erstelle neue Liste.");
  }

  await fs.writeFile(listFile, JSON.stringify(letters, null, 2), "utf8");
  console.log("✅ Liste der Elternbriefe gespeichert.");

  const downloadedIds = new Set(downloadedLetters.map((letter) => letter.id));
  const newLetters = letters.filter((letter) => !downloadedIds.has(letter.id));

  console.log(`${newLetters.length} neue Elternbriefe zum Herunterladen gefunden.`);

  if (newLetters.length === 0) {
    return;
  }

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < newLetters.length; i++) {
    const letter = newLetters[i];
    const title = letter.title || "Ohne Titel";
    console.log(`Verarbeite Elternbrief ${i + 1}/${newLetters.length}: ${title}`);

    try {
      const safeTitle = sanitizeForFilename(title) || "brief";
      const formattedDate = normalizeDate(letter.date);
      const baseName = `${formattedDate}_ID${letter.id}_${safeTitle}`;

      const txtFilePath = path.join(baseDir, `${baseName}.txt`);
      await fs.writeFile(txtFilePath, letter.messageText ?? "", "utf8");
      console.log(`  ✅ Nachrichtentext gespeichert: ${path.basename(txtFilePath)}`);

      if (letter.link && letter.link.trim() !== "") {
        const pdfFilePath = path.join(baseDir, `${baseName}.pdf`);
        console.log(`  Lade PDF herunter: ${path.basename(pdfFilePath)}`);

        try {
          const fileData = await client.getElternbrief(letter.id);

          const buffer = extractBuffer(fileData);
          if (buffer) {
            await fs.writeFile(pdfFilePath, buffer);
            console.log(`  ✅ PDF gespeichert: ${path.basename(pdfFilePath)}`);
            successCount++;
          } else {
            console.log("  ⚠️ Kein PDF-Inhalt gefunden.");
            errorCount++;
          }
        } catch (error) {
          if (error?.message === "Elternbrief not found") {
            console.log(`  ⚠️ Elternbrief nicht gefunden (ID: ${letter.id})`);
          } else {
            console.error(`  ❌ Fehler beim Herunterladen:`, error?.message ?? error);
          }
          errorCount++;
        }
      } else {
        console.log("  ℹ️ Kein Anhang vorhanden.");
        skippedCount++;
      }

      downloadedLetters.push(letter);
    } catch (error) {
      console.error(`  ❌ Fehler bei Elternbrief ${title}:`, error?.message ?? error);
      errorCount++;
    }
  }

  await fs.writeFile(knownFile, JSON.stringify(downloadedLetters, null, 2), "utf8");

  console.log(
    `✅ Download abgeschlossen. ${successCount} PDFs erfolgreich, ${errorCount} fehlgeschlagen, ${skippedCount} ohne Anhänge.`
  );
  console.log(
    `Alle neuen Elternbriefe wurden im Ordner "${baseDir}" gespeichert.`
  );
}

function extractBuffer(fileData) {
  if (!fileData) {
    return null;
  }

  if (Buffer.isBuffer(fileData)) {
    return fileData;
  }

  if (typeof fileData === "object") {
    if (Buffer.isBuffer(fileData.pdf)) {
      return fileData.pdf;
    }
    if (Buffer.isBuffer(fileData.content)) {
      return fileData.content;
    }
    if (Buffer.isBuffer(fileData.buffer)) {
      return fileData.buffer;
    }
  }

  return null;
}

function normalizeDate(dateString) {
  if (!dateString) {
    return "undatiert";
  }

  try {
    const [datePart] = dateString.split(" ");
    const [day, month, year] = datePart.split(".");
    if (day && month && year) {
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  } catch {
    // ignore parsing errors
  }

  return "undatiert";
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

function buildKidBaseName({ kid }) {
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

function shouldIncludeAccount(account) {
  if (!cliOptions.schools.length) {
    return true;
  }
  const candidates = [account.short, account.schoolName, account.displayName]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return cliOptions.schools.some((school) => candidates.includes(school));
}

function askQuestion(query) {
  if (cliOptions.nonInteractive) {
    return Promise.resolve("");
  }

  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

downloadElternbriefe();

