// basic-original-usage.js
// Beispielskript, das dem ursprünglichen README-Workflow entspricht.
// Nutzt einen einzelnen Account-Eintrag aus config.js (oder das erste Element aus accounts[]).

import { getElternportalClient } from "@philippdormann/elternportal-api";
import config from "./config.js";

function resolveLegacyConfig() {
  if (Array.isArray(config.accounts) && config.accounts.length > 0) {
    return config.accounts[1];
  }
  return config;
}

async function main() {
  const account = resolveLegacyConfig();

  if (!account?.short || !account?.username || !account?.password) {
    throw new Error(
      "Bitte stelle sicher, dass config.js short, username und password enthält."
    );
  }

  console.log("Verbinde mit dem Elternportal...");
  const client = await getElternportalClient({
    short: account.short,
    username: account.username,
    password: account.password,
    kidId: account.kidId ?? 0,
  });

  console.log("✅ Anmeldung erfolgreich!\n");

  console.log("=== getKids() ===");
  const kids = await client.getKids();
  console.log(JSON.stringify(kids, null, 2));

  //console.log("\n=== getSchoolInfos() ===");
  //const schoolInfos = await client.getSchoolInfos();
  //console.log(JSON.stringify(schoolInfos, null, 2));

  console.log("\n=== getSchwarzesBrett() (erste 5 Einträge) ===");
  const board = await client.getSchwarzesBrett();
  console.log(JSON.stringify(board.slice(0, 5), null, 2));

  console.log("\n=== getVertretungsplan() ===");
  try {
    const substitionsPlan = await client.getVertretungsplan();
    console.log(JSON.stringify(substitionsPlan, null, 2));
  } catch (error) {
    console.error("❌ Fehler bei getVertretungsplan():", error?.message ?? error);
  }

  console.log("\n=== getStundenplan() ===");
  try {
    const timetable = await client.getStundenplan();
    console.log(JSON.stringify(timetable, null, 2));
  } catch (error) {
    console.error("❌ Fehler bei getStundenplan():", error?.message ?? error);
  }

  console.log("\nFertig.");
}

main().catch((error) => {
  console.error("❌ Fehler:", error?.message ?? error);
  process.exitCode = 1;
});
