import crypto from "crypto";

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

// UID für Vertretungen: <school>-kid<id>-<date>-P<period>(-<index>)
export function buildVertretungsUid({ schoolShort, kidId, date, period, index = 0 }) {
  const base = `${schoolShort}-kid${kidId}-${formatDateKey(date)}-P${pad(period ?? 0)}`;
  return index > 0 ? `${base}-${pad(index)}` : base;
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
