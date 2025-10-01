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
  if (typeof trigger !== "string") {
    return trigger;
  }

  const isoMatch = trigger.match(
    /^-P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i
  );
  if (!isoMatch) {
    return trigger;
  }

  const [, days, hours, minutes, seconds] = isoMatch.map((value) =>
    value ? Number.parseInt(value, 10) : 0
  );

  if (days) {
    return { before: days, unit: "days" };
  }
  if (hours) {
    return { before: hours, unit: "hours" };
  }
  if (minutes) {
    return { before: minutes, unit: "minutes" };
  }
  if (seconds) {
    return { before: seconds, unit: "seconds" };
  }

  return trigger;
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
    calendar.property("X-APPLE-CALENDAR-COLOR", calendarColor);
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
