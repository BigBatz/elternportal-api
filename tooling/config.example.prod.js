// Elternportal Tooling – Beispielkonfiguration für Produktions-/Servereinsatz
// ---------------------------------------------------------------------------
// Kopiere diese Datei zu `tooling/config.prod.js` und trage deine Accounts ein.
// Die Struktur entspricht der bekannten config.js, allerdings ohne Beispielwerte.
//
// Verwendung:
//   1. Datei befüllen und NICHT ins Git-Repo committen.
//   2. In `.env` (lokal) oder `docker/env/elternportal.env` die Variable
//      `EP_CONFIG=./tooling/config.prod.js` setzen.
//   3. Export/Sync nutzen wie gewohnt (`npm run export`, Docker-Compose, etc.).

export default {
  accounts: [
    {
      short: "schule-1",
      schoolName: "Schule 1",
      username: "elternlogin-kind1",
      password: "passwort-kind1",
      kids: [
        {
          id: 1234,
          firstName: "Kind1",
          className: "Klasse 6A",
        },
      ],
    },
    {
      short: "schule-2",
      schoolName: "Schule 2",
      username: "elternlogin-kind2",
      password: "passwort-kind2",
      kids: [
        {
          id: 5678,
          firstName: "Kind2",
          className: "Klasse 8B",
        },
      ],
    },
  ],
};
