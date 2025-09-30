// Wandelt ein Datum in eine lokale (de-DE) Kurz-Darstellung um, z. B. "30.09.25, 17:15:00".
export function formatDateTimeGerman(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}
