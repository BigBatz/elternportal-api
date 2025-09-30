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
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      Authorization: buildAuthHeader(credentials),
    },
    body: icsContent,
    redirect: "follow",
  });

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
