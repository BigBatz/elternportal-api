/**
 * Elternportal Tooling – ICS Generator
 *
 * Zweck: Baut einzelne ICS-Ereignisse inkl. Reminder/Organizer und liefert
 * einen Hash zur Änderungsdetektion. Eingesetzt durch
 * `tooling/scripts/sync-calendar.js`.
 *
 * Versionshistorie:
 * - v1.0.0 (2025-09) – initiale Version für Vertretungsplan-Sync.
 */

import ical from "ical-generator";

// Wandelt ISO/String/Date in ein Date-Objekt oder null.
function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
}

// Erstellt einen ICS-String für einen einzelnen Termin.
export function generateIcsString({ calendarName, entry, organizer, reminderMinutes }) {
  const calendar = ical({
    name: calendarName || "Elternportal",
    timezone: "UTC",
    prodId: {
      company: "elternportal",
      product: "tooling",
    },
  });

  const startDate = toDate(entry.start || entry.date);
  const endDate = toDate(entry.end || entry.date);

  const event = calendar.createEvent({
    id: entry.uid,
    summary: entry.summary,
    description: entry.description,
    location: entry.location || undefined,
    start: startDate ?? undefined,
    end: endDate ?? undefined,
    allDay: entry.allDay ?? (!startDate && !!entry.date),
  });

  if (organizer?.email) {
    event.organizer({
      name: organizer.cn || organizer.email,
      email: organizer.email,
    });
  }

  if (Array.isArray(entry.reminders) && entry.reminders.length > 0) {
    for (const reminder of entry.reminders) {
      if (typeof reminder.minutes !== "number") continue;
      event.createAlarm({ type: "display", trigger: reminder.minutes * -60 });
    }
  } else if (typeof reminderMinutes === "number" && !Number.isNaN(reminderMinutes)) {
    event.createAlarm({ type: "display", trigger: reminderMinutes * -60 });
  }

  return calendar.toString();
}

// Hash zur Erkennung unveränderter Events (Basis64-URL)
export function buildSyncHash({ entry }) {
  const data = {
    summary: entry.summary ?? "",
    description: entry.description ?? "",
    location: entry.location ?? "",
    start: entry.start ?? entry.date ?? "",
    end: entry.end ?? entry.date ?? "",
    allDay: entry.allDay ?? false,
    reminders: entry.reminders ?? null,
  };
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}
