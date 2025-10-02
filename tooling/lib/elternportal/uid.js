/**
 * Elternportal Tooling – UID Generator
 *
 * Zweck: Liefert stabile Identifikatoren für Vertretungs-, Schulaufgaben- und
 * Termindaten. Wird vom Exporter (`exporters.js`) konsumiert.
 *
 * Versionshistorie:
 * - v1.0.0 (2025-09) – initiale Fassung.
 */

// Hilfsfunktion für zweistellige Zahlen (01, 02, ...)
function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

// Erstellt einen YYYYMMDD-Schlüssel aus einem Datum, fällt auf 00000000 zurück.
function formatDateKey(date) {
  if (!date) {
    return "00000000";
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    return "00000000";
  }
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

// UID für Vertretungen: <school>-kid<id>-<date>-P<period>-<classHash>
export function buildVertretungsUid({
  schoolShort,
  kidId,
  date,
  period,
  originalClass,
  substituteClass,
}) {
  const base = `${schoolShort}-kid${kidId}-${formatDateKey(date)}-P${pad(period ?? 0)}`;
  const classToken = (originalClass || substituteClass || "unknown")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 10) || "unknown";
  return `${base}-${classToken}`;
}

// UID für Schulaufgaben: <school>-kid<id>-sa<examId>
export function buildSchulaufgabeUid({ schoolShort, kidId, examId }) {
  return `${schoolShort}-kid${kidId}-sa${examId}`;
}

// UID für allgemeine Termine: bevorzugt Portal-ID, sonst Hash aus Datum + Titel
export function buildTerminUid({ schoolShort, kidId, terminId, date, title }) {
  if (terminId != null) {
    return `${schoolShort}-kid${kidId}-at${terminId}`;
  }
  const hash = crypto
    .createHash("sha1")
    .update(`${schoolShort}|${kidId}|${formatDateKey(date)}|${title ?? ""}`)
    .digest("hex")
    .slice(0, 12);
  return `${schoolShort}-kid${kidId}-at${hash}`;
}
