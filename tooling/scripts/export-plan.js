#!/usr/bin/env node
/**
 * Elternportal Tooling – Export CLI
 *
 * Zweck: Führt den Export-Prozess für Vertretungen, Schulaufgaben oder Termine aus
 * und speichert die Ergebnisse unterhalb des Archiv-Verzeichnisses.
 * Verwendung: Direkt via `npm run export` oder aus Docker.
 *
 * Versionshistorie:
 * - v1.0.0 (2025-09) – initiale CLI-Version.
 */
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { hideBin } from "yargs/helpers";
import yargs from "yargs";
import { exportPlans } from "../lib/elternportal/exporters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv = yargs(hideBin(process.argv))
  .option("source", {
    alias: "s",
    type: "string",
    choices: ["vertretung", "schulaufgaben", "termine"],
    demandOption: true,
    describe: "Welche Daten exportiert werden sollen",
  })
  .option("config", {
    alias: "c",
    type: "string",
    describe: "Pfad zur Elternportal-Konfiguration (ESM)",
    default: process.env.EP_CONFIG ?? path.resolve(__dirname, "../../examples/config.js"),
  })
  .option("output-dir", {
    alias: "o",
    type: "string",
    describe: "Ausgabeverzeichnis für JSON-Dateien",
    default: process.env.OUTPUT_DIR ?? path.resolve(__dirname, "../../data"),
  })
  .option("school", {
    type: "array",
    describe: "Filter für Schul-Kürzel",
    default: process.env.EP_SCHOOL ? process.env.EP_SCHOOL.split(",") : [],
  })
  .option("kid", {
    type: "array",
    describe: "Filter für Kinder-IDs",
    default: process.env.EP_KID ? process.env.EP_KID.split(",").map(Number) : [],
  })
  .option("kid-name", {
    type: "array",
    describe: "Filter für Kinder-Namen",
    default: process.env.EP_KID_NAME ? process.env.EP_KID_NAME.split(",") : [],
  })
  .help()
  .alias("h", "help")
  .parse();

// Lädt die konfigurierte config.js (ESM).
async function loadConfig(configPath) {
  const resolved = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);
  const module = await import(resolved);
  return module.default ?? module;
}

(async () => {
  try {
    const config = await loadConfig(argv.config);
    const results = await exportPlans({
      config,
      source: argv.source,
      filters: {
        schools: argv.school,
        kidIds: (argv.kid ?? []).map((id) => Number.parseInt(id, 10)).filter((id) => !Number.isNaN(id)),
        kidNames: (argv["kid-name"] ?? []).map((name) => String(name)),
      },
      outputDir: path.isAbsolute(argv.outputDir)
        ? argv.outputDir
        : path.resolve(process.cwd(), argv.outputDir),
    });

    for (const result of results) {
      console.log(
        `✔ ${argv.source} für ${result.kid.firstName ?? "Kind"} (${result.kid.className ?? ""}) – ${result.count} Einträge`
      );
    }
  } catch (error) {
    console.error("❌ Export fehlgeschlagen:", error.message);
    process.exitCode = 1;
  }
})();
