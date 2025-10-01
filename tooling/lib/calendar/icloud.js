/**
 * Elternportal Tooling – CalDAV Client-Helfer
 *
 * Zweck: Übergibt ICS-Einträge per HTTP an CalDAV-Server (z. B. iCloud).
 * Wird direkt von `tooling/scripts/sync-calendar.js` verwendet.
 *
 * Versionshistorie:
 * - v1.0.0 (2025-09) – erster Stand für Export/Sync-Pipeline.
 */

const debugEnabled = Boolean(process.env.DEBUG_CALDAV);
const debug = (...args) => {
  if (debugEnabled) {
    console.log("[CalDAV]", ...args);
  }
};

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

  const makePut = async (extraHeaders = {}, label = "PUT") => {
    debug(`${label} ${url}`, extraHeaders);
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...headers,
        ...extraHeaders,
      },
      body: icsContent,
      redirect: "follow",
    });
    debug(`${label} -> ${response.status} ${response.statusText}`);
    return response;
  };

  let response = await makePut({ "If-None-Match": "*" }, "PUT If-None-Match");

  if (response.status === 412) {
    // Server verlangt evtl. einen If-Match Header für bestehende Ressourcen.
    response = await makePut({ "If-Match": "*" }, "PUT If-Match");
  }

  if (response.status === 412) {
    // Entferne vorhandene Ressource (404 = nichts vorhanden -> ok) und lege neu an.
    debug("DELETE previous resource", url);
    const deleteResponse = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: buildAuthHeader(credentials),
      },
      redirect: "follow",
    });

    debug(`DELETE -> ${deleteResponse.status} ${deleteResponse.statusText}`);

    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      const text = await deleteResponse.text();
      throw new Error(
        `Fehler beim DELETE ${url}: ${deleteResponse.status} ${deleteResponse.statusText} ${text}`
      );
    }

    response = await makePut({}, "PUT final");
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
  debug(`DELETE request ${url}`);
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: buildAuthHeader(credentials),
    },
  });
  debug(`DELETE response -> ${response.status} ${response.statusText}`);

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Fehler beim DELETE ${url}: ${response.status} ${response.statusText} ${text}`);
  }
}
