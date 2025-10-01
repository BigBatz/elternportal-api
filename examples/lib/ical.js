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

    const event = calendar.createEvent({
      id: uid,
      summary,
      description,
      start: entry.startDate,
      end: entry.allDay ? addDays(entry.endDate, 1) : entry.endDate,
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
