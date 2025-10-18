import ical from "ical-generator";
import { createHash } from "crypto";

function addDays(date, days) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

function sanitizeTrigger(trigger) {
  if (trigger instanceof Date || typeof trigger === "number") {
    return trigger;
  }

  if (typeof trigger !== "string") {
    return trigger;
  }

  const isoMatch = trigger.match(
    /^([+-])?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i
  );
  if (!isoMatch) {
    return trigger;
  }

  const [, sign = "-", daysRaw, hoursRaw, minutesRaw, secondsRaw] = isoMatch;
  const days = daysRaw ? Number.parseInt(daysRaw, 10) : 0;
  const hours = hoursRaw ? Number.parseInt(hoursRaw, 10) : 0;
  const minutes = minutesRaw ? Number.parseInt(minutesRaw, 10) : 0;
  const seconds = secondsRaw ? Number.parseInt(secondsRaw, 10) : 0;

  const totalSeconds =
    days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds;

  if (totalSeconds === 0) {
    return trigger;
  }

  const signMultiplier = sign === "-" ? -1 : 1;
  return totalSeconds * signMultiplier;
}

function parseGermanDate(raw) {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  const match = trimmed.match(/^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4})$/);
  if (!match) {
    return null;
  }

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);

  if (
    Number.isNaN(day) ||
    Number.isNaN(month) ||
    Number.isNaN(year) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function toDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveAllDayStart(entry, fallback) {
  const rawDate = parseGermanDate(entry?.rawDate);
  if (rawDate) {
    return rawDate;
  }

  const primary = toDate(entry?.date);
  if (primary) {
    return new Date(
      Date.UTC(
        primary.getUTCFullYear(),
        primary.getUTCMonth(),
        primary.getUTCDate()
      )
    );
  }

  if (fallback) {
    return new Date(
      Date.UTC(
        fallback.getUTCFullYear(),
        fallback.getUTCMonth(),
        fallback.getUTCDate()
      )
    );
  }

  return null;
}

export function generateCalendarIcs(entries, options) {
  const {
    calendarName,
    calendarColor = "#FF9500",
    schoolIdentifier,
    summaryBuilder,
    descriptionBuilder,
    uidBuilder,
    alarms,
    timestamp,
    onEvent,
  } = options;

  const calendar = ical({
    name: calendarName,
    prodId: {
      company: "Elternportal",
      product: "Kalenderexport",
    },
  });

  calendar.method("PUBLISH");
  if (calendarColor) {
    calendar.x("X-APPLE-CALENDAR-COLOR", calendarColor);
  }

  const total = entries.length;
  const now = timestamp ?? new Date();

  let exportedCount = 0;

  entries.forEach((entry, index) => {
    if (!entry.startDate || !entry.endDate) {
      return;
    }

    if (onEvent && onEvent(entry, index, total) === false) {
      return;
    }

    const summary = summaryBuilder
      ? summaryBuilder(entry, index, total)
      : entry.title;
    const description = descriptionBuilder
      ? descriptionBuilder(entry, index, total)
      : entry.title;

    const uidSeed = uidBuilder
      ? uidBuilder(entry, index, total)
      : `${schoolIdentifier}-${entry.id}-${entry.title}-${entry.startDate.toISOString()}-${entry.endDate.toISOString()}`;
    const uidHash = createHash("md5").update(uidSeed).digest("hex");
    const uid = `${uidHash}@${schoolIdentifier}.elternportal`;

    let start = toDate(entry.startDate);
    let end = toDate(entry.endDate);

    if (!start || !end) {
      return;
    }

    if (entry.allDay) {
      const normalizedStart = resolveAllDayStart(entry, start);
      if (normalizedStart) {
        start = normalizedStart;
        end = addDays(normalizedStart, 1);
      } else {
        end = addDays(end, 1);
      }
    }

    const event = calendar.createEvent({
      id: uid,
      summary,
      description,
      start,
      end,
      allDay: entry.allDay,
      stamp: now,
      transparency: "OPAQUE",
      status: "CONFIRMED",
    });

    const alarmList =
      typeof alarms === "function" ? alarms(entry, index, total) ?? [] : alarms ?? [];

    alarmList.forEach((alarm) => {
      const action = alarm.action ? alarm.action.toUpperCase() : "DISPLAY";
      event.createAlarm({
        type: action.toLowerCase() === "audio" ? "audio" : "display",
        description: alarm.description,
        trigger: sanitizeTrigger(alarm.trigger),
      });
    });

    exportedCount += 1;
  });

  return {
    ics: calendar.toString(),
    count: exportedCount,
  };
}
