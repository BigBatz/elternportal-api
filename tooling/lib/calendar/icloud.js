/**
 * Elternportal Tooling – CalDAV Client-Helfer
 *
 * Zweck: Übergibt ICS-Einträge per HTTP an CalDAV-Server (z. B. iCloud).
 * Wird direkt von `tooling/scripts/sync-calendar.js` verwendet.
 *
 * Versionshistorie:
 * - v1.0.0 (2025-09) – erster Stand für Export/Sync-Pipeline.
 */

// Hilfsfunktion: erzeugt die endgültige .ics-URL pro UID.
function buildEventUrl({ calendarUrl, uid }) {
  const normalized = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  return `${normalized}${encodeURIComponent(uid)}.ics`;
}

function buildAuthHeader(credentials) {
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
}

// Legt ein Event per CalDAV PUT an bzw. aktualisiert es.
export async function putEvent({ calendarUrl, credentials, icsContent, uid }) {
  if (!calendarUrl) throw new Error("calendarUrl fehlt");
  if (!credentials?.username || !credentials?.password) {
    throw new Error("iCloud-Zugangsdaten fehlen");
  }

  const url = buildEventUrl({ calendarUrl, uid });
  const headers = {
    "Content-Type": "text/calendar; charset=utf-8",
    Authorization: buildAuthHeader(credentials),
  };

  const makePut = async () =>
    fetch(url, {
      method: "PUT",
      headers: {
        ...headers,
        "If-None-Match": "*",
      },
      body: icsContent,
      redirect: "follow",
    });

  let response = await makePut();

  if (response.status === 412) {
    // Versuch, eine vorhandene Ressource zu entfernen (404 = nichts vorhanden -> ok)
    const deleteResponse = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: buildAuthHeader(credentials),
      },
      redirect: "follow",
    });

    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      const text = await deleteResponse.text();
      throw new Error(
        `Fehler beim DELETE ${url}: ${deleteResponse.status} ${deleteResponse.statusText} ${text}`
      );
    }

    response = await makePut();
  }

  if (!response.ok && response.status !== 204 && response.status !== 201) {
    const text = await response.text();
    throw new Error(`Fehler beim PUT ${url}: ${response.status} ${response.statusText} ${text}`);
  }
}

// Löscht ein Event über CalDAV (derzeit nur optional genutzt).
export async function deleteEvent({ calendarUrl, credentials, uid }) {
  if (!calendarUrl) throw new Error("calendarUrl fehlt");
  if (!credentials?.username || !credentials?.password) {
    throw new Error("iCloud-Zugangsdaten fehlen");
  }

  const url = buildEventUrl({ calendarUrl, uid });
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: buildAuthHeader(credentials),
    },
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Fehler beim DELETE ${url}: ${response.status} ${response.statusText} ${text}`);
  }
}
