import fs from "fs/promises";
import path from "path";

// Stellt sicher, dass ein Verzeichnis existiert.
export async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

// Liest eine Plan-Datei oder gibt null zurück, wenn sie fehlt.
export async function readPlan(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

// Persistiert die Plan-Daten als prettified JSON.
export async function writePlan(filePath, data) {
  const directory = path.dirname(filePath);
  await ensureDirectory(directory);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

// Merged bestehende und neue Einträge anhand ihrer UID und erhält Statusfelder.
export function mergeEntries({ existing = [], incoming = [] }) {
  const map = new Map();

  for (const entry of existing) {
    if (!entry?.uid) continue;
    map.set(entry.uid, { ...entry });
  }

  for (const entry of incoming) {
    if (!entry?.uid) continue;
    const previous = map.get(entry.uid) ?? {};
    const merged = { ...previous, ...entry };
    if (entry.lastSyncedAt === undefined && previous.lastSyncedAt !== undefined) {
      merged.lastSyncedAt = previous.lastSyncedAt;
    }
    if (
      entry.lastSyncedAtLocal === undefined &&
      previous.lastSyncedAtLocal !== undefined
    ) {
      merged.lastSyncedAtLocal = previous.lastSyncedAtLocal;
    }
    if (entry._syncHash === undefined && previous._syncHash !== undefined) {
      merged._syncHash = previous._syncHash;
    }
    map.set(entry.uid, merged);
  }

  return Array.from(map.values()).sort((a, b) => {
    const aStart = a.start ?? a.date ?? "";
    const bStart = b.start ?? b.date ?? "";
    if (aStart !== bStart) {
      return aStart < bStart ? -1 : 1;
    }
    return a.uid.localeCompare(b.uid);
  });
}
