// config.js
//
// Du kannst entweder ein einzelnes Account-Objekt exportieren
// oder – empfohlen – ein Array unter `accounts` verwenden.
// Im Array können mehrere Schulen/Kinder gepflegt werden.

export default {
  accounts: [
    {
      short: "schule-a",          // Subdomain‑Kürzel, z. B. "emagyha"
      schoolName: "Schule A",
      username: "dein-login",
      password: "dein-passwort",
      // optional: spezifische Kinder auswählen (ID, Vor-/Nachname, Klasse, "all", Objekt ...)
      kids: ["Max"],
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

// Alternativ weiterhin möglich:
// export default {
//   short: "schule-a",
//   username: "dein-login",
//   password: "dein-passwort",
// };
