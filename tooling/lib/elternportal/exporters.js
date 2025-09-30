/**
 * Elternportal Tooling – Exporter
 *
 * Zweck: Liest Vertretungspläne, Schulaufgaben und allgemeine Termine per
 * API, wandelt sie in ein Archiv-JSON um (inkl. UIDs & Zeitmapping) und
 * persistiert sie. Genutzt durch `tooling/scripts/export-plan.js`.
 *
 * Versionshistorie:
 * - v1.0.0 (2025-09) – initiale Automations-Fassung.
 */

import { getElternportalClient } from "@philippdormann/elternportal-api";
import { buildVertretungsUid, buildSchulaufgabeUid, buildTerminUid } from "./uid.js";
import { mergeEntries, readPlan, writePlan } from "../storage/json.js";
import { formatDateTimeGerman } from "../shared/datetime.js";
import { zonedTimeToUtc } from "date-fns-tz";
import path from "path";

function normalizeConfigs(rawConfig) {
  if (!rawConfig) return [];
  if (Array.isArray(rawConfig)) return rawConfig;
  if (Array.isArray(rawConfig.accounts)) return rawConfig.accounts;
  return [rawConfig];
}

function sanitizeForFilename(value) {
  return value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function buildKidSlug(kid) {
  const parts = [kid.className, kid.firstName, kid.lastName]
    .map((value) => sanitizeForFilename(value || ""))
    .filter(Boolean);
  return parts.length ? parts.join("_") : `kid-${kid.id ?? "unknown"}`;
}

// Liefert die Kinder, die gemäß Account-Konfiguration und CLI-Filtern verarbeitet werden sollen.
async function resolveKidsForAccount(client, account, filters) {
  const kids = await client.getKids();
  if (!kids?.length) {
    return [];
  }

  let selected = [...kids];

  if (Array.isArray(account.kids) && account.kids.length > 0) {
    selected = uniqueKids(
      account.kids.flatMap((selector) =>
        kids.filter((kid) => matchKidSelector(kid, selector))
      )
    );
  }

  if (filters.kidIds.length > 0) {
    selected = selected.filter((kid) => filters.kidIds.includes(kid.id));
  }

  if (filters.kidNames.length > 0) {
    selected = selected.filter((kid) => {
      const first = (kid.firstName || "").toLowerCase();
      const last = (kid.lastName || "").toLowerCase();
      const full = `${first} ${last}`.trim();
      return (
        filters.kidNames.includes(first) ||
        filters.kidNames.includes(last) ||
        filters.kidNames.includes(full)
      );
    });
  }

  if (selected.length === 0 && kids.length === 1) {
    return [kids[0]];
  }

  return uniqueKids(selected);
}

function uniqueKids(list) {
  const map = new Map();
  for (const kid of list) {
    if (!kid) continue;
    map.set(kid.id, kid);
  }
  return Array.from(map.values());
}

function matchKidSelector(kid, selector) {
  if (selector == null) return false;
  if (selector === "all") return true;
  if (typeof selector === "number") return kid.id === selector;
  if (typeof selector === "string") {
    const normalized = selector.toLowerCase();
    const candidates = [
      kid.id?.toString(),
      (kid.firstName || "").toLowerCase(),
      (kid.lastName || "").toLowerCase(),
      `${kid.firstName || ""} ${kid.lastName || ""}`.trim().toLowerCase(),
      (kid.className || "").toLowerCase(),
    ];
    return candidates.includes(normalized);
  }
  if (typeof selector === "object") {
    if (
      selector.id != null &&
      Number.parseInt(selector.id, 10) !== Number.parseInt(`${kid.id}`, 10)
    ) {
      return false;
    }
    if (
      selector.firstName &&
      selector.firstName.toLowerCase() !== (kid.firstName || "").toLowerCase()
    ) {
      return false;
    }
    if (
      selector.lastName &&
      selector.lastName.toLowerCase() !== (kid.lastName || "").toLowerCase()
    ) {
      return false;
    }
    if (
      selector.className &&
      selector.className.toLowerCase() !== (kid.className || "").toLowerCase()
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function normalizeSchoolFilters(filters) {
  return {
    schools: filters.schools?.map((s) => s.toLowerCase()) ?? [],
    kidIds: filters.kidIds ?? [],
    kidNames: filters.kidNames?.map((s) => s.toLowerCase()) ?? [],
  };
}

function shouldIncludeAccount(account, filters) {
  if (!filters.schools.length) return true;
  const candidates = [account.short, account.schoolName, account.displayName]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return filters.schools.some((school) => candidates.includes(school));
}

// Normiert Datum/Werte aus dem Elternportal auf ISO-Strings.
function serializeDate(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

// Zeitzone aller Schulzeiten – kann bei Bedarf später konfigurierbar gemacht werden.
const TIMEZONE = "Europe/Berlin";

function pad(value) {
  return String(value).padStart(2, "0");
}

function normalizeTimeLabel(label) {
  if (!label) return null;
  const cleaned = label.trim().replace(/h/gi, ":").replace(/\./g, ":");
  const match = cleaned.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  return `${pad(hour)}:${pad(minute)}`;
}

function extractTimes(detail) {
  if (!detail) return [];
  const matches = detail
    .replace(/h/gi, ":")
    .replace(/\./g, ":")
    .match(/\d{1,2}:\d{2}/g);
  if (!matches) return [];
  return matches
    .map((label) => normalizeTimeLabel(label))
    .filter(Boolean);
}

function extractPeriodTimesFromTimetable(rows) {
  const map = {};
  if (!Array.isArray(rows)) {
    return map;
  }
  for (const row of rows) {
    if (!row || row.type !== "info") continue;
    const period = Number.parseInt(row.value ?? row.std ?? row.period, 10);
    if (Number.isNaN(period)) continue;
    const detail = typeof row.detail === "string" ? row.detail : "";
    const parts = extractTimes(detail);
    if (parts.length >= 2) {
      map[period] = { start: parts[0], end: parts[parts.length - 1] };
    }
  }
  return map;
}

// Kombiniert Datum + lokale Uhrzeit zu einem UTC-ISO-String.
function combineDateAndTime(dateValue, timeLabel) {
  if (!dateValue || !timeLabel) return null;
  const dateObj = new Date(dateValue);
  if (Number.isNaN(dateObj.getTime())) return null;
  const datePart = `${dateObj.getUTCFullYear()}-${pad(dateObj.getUTCMonth() + 1)}-${pad(
    dateObj.getUTCDate()
  )}`;
  const normalizedTime = normalizeTimeLabel(timeLabel);
  if (!normalizedTime) return null;
  const zoned = zonedTimeToUtc(`${datePart}T${normalizedTime}:00`, TIMEZONE);
  return zoned.toISOString();
}

// Fügt den Vertretungs-Einträgen reale Start/Endzeiten hinzu, sofern sie bekannt sind.
function applyPeriodTimesToEntries(entries, periodTimes) {
  if (!Array.isArray(entries)) {
    return entries;
  }
  const times = periodTimes && typeof periodTimes === "object" ? periodTimes : {};
  return entries.map((entry) => {
    const period = entry.metadata?.period ?? entry.period ?? null;
    const match = period != null ? times[period] : null;
    if (!match || !match.start || !match.end) {
      return {
        ...entry,
        period,
        allDay: entry.allDay ?? true,
        metadata: {
          ...entry.metadata,
          periodStartLocal: match?.start ?? null,
          periodEndLocal: match?.end ?? null,
        },
      };
    }

    const startIso = combineDateAndTime(entry.date ?? entry.start, match.start) ?? entry.start;
    const endIso = combineDateAndTime(entry.date ?? entry.end ?? entry.start, match.end) ?? entry.end ?? startIso;

    return {
      ...entry,
      period,
      start: startIso,
      end: endIso,
      allDay: false,
      metadata: {
        ...entry.metadata,
        periodStartLocal: match.start,
        periodEndLocal: match.end,
      },
    };
  });
}

// Erzeugt eine kompakte Zusammenfassung für Vertretungen.
function formatVertretungSummary(entry) {
  const base = entry.period ? `${entry.period}. Stunde Vertretung` : "Vertretung";
  const classCurrent = entry.substituteClass || entry.originalClass;
  const classPrevious =
    entry.originalClass &&
    entry.substituteClass &&
    entry.substituteClass !== entry.originalClass
      ? entry.originalClass
      : null;
  const teacherCurrent = entry.substituteTeacher || entry.originalTeacher;
  const teacherPrevious =
    entry.originalTeacher &&
    entry.substituteTeacher &&
    entry.originalTeacher !== entry.substituteTeacher
      ? entry.originalTeacher
      : null;

  const parts = [];
  if (classCurrent) {
    parts.push(
      classPrevious && classPrevious !== classCurrent
        ? `${classCurrent} (vorher ${classPrevious})`
        : classCurrent
    );
  }
  if (teacherCurrent) {
    parts.push(
      teacherPrevious && teacherPrevious !== teacherCurrent
        ? `bei ${teacherCurrent} (vorher ${teacherPrevious})`
        : `bei ${teacherCurrent}`
    );
  }
  if (entry.room) {
    parts.push(`Raum ${entry.room}`);
  }
  if (entry.note) {
    parts.push(entry.note);
  }
  return parts.length ? `${base}. ${parts.join(", ")}` : base;
}

function buildVertretungDescription({ kid, school, entry }) {
  const lines = [
    `Schule: ${school.displayName} (${school.identifier})`,
    `Kind: ${kid.firstName ?? ""} ${kid.lastName ?? ""} (${kid.className ?? ""})`,
  ];
  if (entry.period != null) {
    lines.push(`Stunde: ${entry.period}`);
  }
  if (entry.originalTeacher) {
    lines.push(`Original-Lehrer: ${entry.originalTeacher}`);
  }
  if (entry.substituteTeacher) {
    lines.push(`Vertretung: ${entry.substituteTeacher}`);
  }
  if (entry.originalClass) {
    lines.push(`Original-Fach: ${entry.originalClass}`);
  }
  if (entry.substituteClass) {
    lines.push(`Vertretungs-Fach: ${entry.substituteClass}`);
  }
  if (entry.room) {
    lines.push(`Raum: ${entry.room}`);
  }
  if (entry.note) {
    lines.push(`Hinweis: ${entry.note}`);
  }
  return lines.join("\n");
}

// Exportiert die gewünschte Quelle für alle passenden Accounts/Kinder.
export async function exportPlans({
  config,
  source,
  filters = {},
  outputDir,
}) {
  const normalizedFilters = normalizeSchoolFilters(filters);
  const accounts = normalizeConfigs(config).filter((account) =>
    shouldIncludeAccount(account, normalizedFilters)
  );

  if (!accounts.length) {
    throw new Error("Keine passenden Accounts in der Konfiguration gefunden.");
  }

  const results = [];

  for (const account of accounts) {
    const schoolIdentifier = account.short;
    const schoolDisplayName =
      account.schoolName || account.displayName || schoolIdentifier;

    const client = await getElternportalClient({
      short: account.short,
      username: account.username,
      password: account.password,
      kidId: account.kidId,
    });

    const kids = await resolveKidsForAccount(client, account, normalizedFilters);

    for (const kid of kids) {
      if (typeof client.setKid === "function") {
        await client.setKid(kid.id);
      }

      if (source === "vertretung") {
        const plan = await client.getVertretungsplan();
        const entries = (plan.substitutions || []).map((entry, index) => {
          const uid = buildVertretungsUid({
            schoolShort: schoolIdentifier,
            kidId: kid.id,
            date: entry.date,
            period: entry.period,
            index,
          });
          return {
            uid,
            source: "vertretungsplan",
            date: serializeDate(entry.date),
            start: serializeDate(entry.date),
            end: serializeDate(entry.date),
            allDay: true,
            summary: formatVertretungSummary(entry),
            description: buildVertretungDescription({
              kid,
              school: { identifier: schoolIdentifier, displayName: schoolDisplayName },
              entry,
            }),
            location: entry.room || "",
            metadata: {
              period: entry.period,
              originalTeacher: entry.originalTeacher,
              substituteTeacher: entry.substituteTeacher,
              originalClass: entry.originalClass,
              substituteClass: entry.substituteClass,
              room: entry.room,
              note: entry.note,
            },
            period: entry.period,
          };
        });

        await persistPlan({
          outputDir,
          kid,
          school: { identifier: schoolIdentifier, displayName: schoolDisplayName },
          source,
          entries,
          lastUpdate: serializeDate(plan.lastUpdate),
          resolvePeriodTimes: async () => {
            const timetable = await client.getStundenplan();
            return extractPeriodTimesFromTimetable(timetable);
          },
        });

        results.push({ kid, schoolIdentifier, schoolDisplayName, count: entries.length });
      } else if (source === "schulaufgaben") {
        const exams = await client.getSchulaufgabenplan();
        const entries = exams.map((exam) => {
          const uid = buildSchulaufgabeUid({
            schoolShort: schoolIdentifier,
            kidId: kid.id,
            examId: exam.id,
          });
          return {
            uid,
            source: "schulaufgaben",
            start: serializeDate(exam.startDate),
            end: serializeDate(exam.endDate || exam.startDate),
            allDay: exam.allDay ?? false,
            summary: `${exam.title} (${kid.className})`,
            description: buildExamDescription({ exam, kid, schoolDisplayName }),
            location: exam.room || "",
            metadata: {
              rawDate: exam.rawDate,
              rawTime: exam.rawTime,
              category: exam.category,
            },
          };
        });

        await persistPlan({
          outputDir,
          kid,
          school: { identifier: schoolIdentifier, displayName: schoolDisplayName },
          source,
          entries,
          lastUpdate: null,
        });

        results.push({ kid, schoolIdentifier, schoolDisplayName, count: entries.length });
      } else if (source === "termine") {
        const termine = await client.getAllgemeineTermine();
        const entries = termine.map((termin) => {
          const uid = buildTerminUid({
            schoolShort: schoolIdentifier,
            kidId: kid.id,
            terminId: termin.id,
            date: termin.startDate,
            title: termin.title,
          });
          return {
            uid,
            source: "allgemeine-termine",
            start: serializeDate(termin.startDate),
            end: serializeDate(termin.endDate || termin.startDate),
            allDay: termin.allDay ?? false,
            summary: `${termin.title} (${kid.className})`,
            description: buildTerminDescription({ termin, kid, schoolDisplayName }),
            location: termin.room || "",
            metadata: {
              rawDate: termin.rawDate,
              rawTime: termin.rawTime,
              category: termin.category,
            },
          };
        });

        await persistPlan({
          outputDir,
          kid,
          school: { identifier: schoolIdentifier, displayName: schoolDisplayName },
          source,
          entries,
          lastUpdate: null,
        });

        results.push({ kid, schoolIdentifier, schoolDisplayName, count: entries.length });
      } else {
        throw new Error(`Unbekannte Quelle: ${source}`);
      }
    }
  }

  return results;
}

function buildExamDescription({ exam, kid, schoolDisplayName }) {
  const lines = [
    `Schule: ${schoolDisplayName}`,
    `Kind: ${kid.firstName ?? ""} ${kid.lastName ?? ""} (${kid.className ?? ""})`,
    `Titel: ${exam.title}`,
  ];
  if (exam.rawDate) lines.push(`Datum: ${exam.rawDate}`);
  if (exam.rawTime) lines.push(`Zeit: ${exam.rawTime}`);
  if (exam.category) lines.push(`Kategorie: ${exam.category}`);
  return lines.join("\n");
}

function buildTerminDescription({ termin, kid, schoolDisplayName }) {
  const lines = [
    `Schule: ${schoolDisplayName}`,
    `Kind: ${kid.firstName ?? ""} ${kid.lastName ?? ""} (${kid.className ?? ""})`,
    `Titel: ${termin.title}`,
  ];
  if (termin.rawDate) lines.push(`Datum: ${termin.rawDate}`);
  if (termin.rawTime) lines.push(`Zeit: ${termin.rawTime}`);
  if (termin.category) lines.push(`Kategorie: ${termin.category}`);
  return lines.join("\n");
}

// Persistiert die ermittelten Einträge und aktualisiert Metadaten/Periodenzeiten.
async function persistPlan({
  outputDir,
  kid,
  school,
  source,
  entries,
  lastUpdate,
  resolvePeriodTimes,
}) {
  if (!outputDir) {
    throw new Error("outputDir ist erforderlich");
  }
  const kidSlug = buildKidSlug(kid);
  const sourceSlug =
    source === "vertretung"
      ? "vertretungsplan"
      : source === "schulaufgaben"
      ? "schulaufgaben"
      : "termine";

  const filePath = path.join(outputDir, kidSlug, `${sourceSlug}.json`);
  const existing = await readPlan(filePath);
  let periodTimes = existing?.metadata?.periodTimes ?? null;
  let processedEntries = entries;

  if (source === "vertretung") {
    if ((!periodTimes || Object.keys(periodTimes).length === 0) && resolvePeriodTimes) {
      periodTimes = await resolvePeriodTimes();
    }
    processedEntries = applyPeriodTimesToEntries(entries, periodTimes);
  }

  const mergedEntries = mergeEntries({
    existing: existing?.entries ?? [],
    incoming: processedEntries,
  });

  const generatedAtDate = new Date();
  const generatedAtIso = generatedAtDate.toISOString();
  const existingMetadata = existing?.metadata ?? {};
  const existingLastUpdateIso =
    existingMetadata.lastUpdateIso ?? existingMetadata.lastUpdate ?? null;
  const finalLastUpdateIso = lastUpdate ?? existingLastUpdateIso ?? null;

  const payload = {
    metadata: {
      ...existingMetadata,
      generatedAt: formatDateTimeGerman(generatedAtDate),
      generatedAtIso: generatedAtIso,
      source: sourceSlug,
      lastUpdate: formatDateTimeGerman(finalLastUpdateIso),
      lastUpdateIso: finalLastUpdateIso,
      school,
      kid: {
        id: kid.id,
        firstName: kid.firstName,
        lastName: kid.lastName,
        className: kid.className,
      },
    },
    entries: mergedEntries,
  };

  if (periodTimes && Object.keys(periodTimes).length > 0) {
    payload.metadata.periodTimes = periodTimes;
  }

  await writePlan(filePath, payload);
}

export { normalizeConfigs, buildKidSlug };
