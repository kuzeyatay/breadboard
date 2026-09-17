import db from "./db.ts";
import { ApiError } from "./hermes/route-core.ts";
import { highlightEntryId, TEXT_HIGHLIGHT_PREFIXES, type HighlightMutation } from "./text-highlight-types.ts";

// Lives in brain.db under BREADBOARD_DATA_DIR, independent of per-launch ports.
db.exec(`
  CREATE TABLE IF NOT EXISTS text_highlights (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    highlight_id TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, storage_key, highlight_id)
  );
  CREATE TABLE IF NOT EXISTS text_highlight_operations (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    PRIMARY KEY (user_id, storage_key, operation_id)
  );
`);

export function syncTextHighlights(userId: number, input: Record<string, unknown>) {
  const key = input.key;
  if (typeof key !== "string" || key.length > 2048 || !TEXT_HIGHLIGHT_PREFIXES.some(prefix => key.startsWith(prefix) && key.length > prefix.length)) {
    throw new ApiError(400, "invalid_highlight_key", "A highlight location is required.");
  }
  const entries = input.entries ?? [];
  const mutations = input.mutations ?? [];
  if (!Array.isArray(entries) || !Array.isArray(mutations) || entries.length > 10_000 || mutations.length > 10_000) {
    throw new ApiError(400, "invalid_highlights", "Invalid highlights.");
  }
  for (const entry of entries) {
    if (!highlightEntryId(entry)) throw new ApiError(400, "invalid_highlight", "A highlight id is required.");
  }
  for (const mutation of mutations) {
    if (!mutation || typeof mutation.operationId !== "string" || !mutation.operationId || mutation.operationId.length > 128 ||
        typeof mutation.id !== "string" || !mutation.id || mutation.id.length > 256 ||
        (mutation.value !== null && highlightEntryId(mutation.value) !== mutation.id)) {
      throw new ApiError(400, "invalid_highlight_mutation", "Invalid highlight change.");
    }
  }
  return db.transaction(() => {
    const migrate = db.prepare("INSERT OR IGNORE INTO text_highlights(user_id, storage_key, highlight_id, value) VALUES (?, ?, ?, ?)");
    // Import old browser caches without overwriting newer marks or tombstones.
    for (const entry of entries) migrate.run(userId, key, highlightEntryId(entry), JSON.stringify(entry));
    const receipt = db.prepare("INSERT OR IGNORE INTO text_highlight_operations(user_id, storage_key, operation_id) VALUES (?, ?, ?)");
    const write = db.prepare(`INSERT INTO text_highlights(user_id, storage_key, highlight_id, value) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, storage_key, highlight_id) DO UPDATE SET value = excluded.value`);
    for (const mutation of mutations as HighlightMutation[]) {
      // A response can be lost after commit. Retrying must not undo a later edit.
      if (receipt.run(userId, key, mutation.operationId).changes) {
        write.run(userId, key, mutation.id, mutation.value === null ? null : JSON.stringify(mutation.value));
      }
    }
    const rows = db.prepare("SELECT value FROM text_highlights WHERE user_id = ? AND storage_key = ? AND value IS NOT NULL ORDER BY rowid")
      .all(userId, key) as { value: string }[];
    return { entries: rows.map(row => JSON.parse(row.value)), acknowledged: mutations.map((mutation: HighlightMutation) => mutation.operationId) };
  }).immediate();
}
