import { externalRuntimeFilesystem } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import Database from "better-sqlite3";
import type { RecallSearchHit, RecallSearchPage, RecallSearchQuery } from "./client.ts";

const MAX_FRAMES_TO_SCAN = 4_000;
const { lstatSync } = externalRuntimeFilesystem;

/** Read recent screen snippets while the local recorder is stopped. */
export function searchStoredScreenHistory(
  directory: string,
  query: RecallSearchQuery,
  maxTextChars: number,
): RecallSearchPage | null {
  if (query.contentType !== "ocr" || query.query || !query.startTime || !query.endTime) return null;
  const start = Date.parse(query.startTime);
  const end = Date.parse(query.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const marker = path.join(directory, "db.sqlite.quarantine.json");
  const database = path.join(directory, "db.sqlite");
  const quarantined = () => lstatSync(marker, { throwIfNoEntry: false }) !== undefined;
  let db: Database.Database | undefined;
  try {
    if (quarantined() || !lstatSync(database, { throwIfNoEntry: false })?.isFile()) return null;
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      const member = lstatSync(database + suffix, { throwIfNoEntry: false });
      if (member && !member.isFile()) return null;
    }
    db = new Database(database, { readonly: true, fileMustExist: true, timeout: 0 });
    // Screenpipe stores UTC ISO timestamps, using Z or +00:00 depending on the writer.
    const lower = new Date(start).toISOString().slice(0, 19);
    const upper = new Date(Math.ceil(end / 1000) * 1000).toISOString().slice(0, 19);
    const limit = query.limit ?? 10;
    const rows = db.prepare(`
      WITH recent AS MATERIALIZED (
        SELECT id, timestamp, app_name, window_name FROM frames INDEXED BY idx_frames_timestamp
        WHERE timestamp >= ? AND timestamp < ? AND julianday(timestamp) >= julianday(?)
          AND julianday(timestamp) < julianday(?) ORDER BY timestamp DESC LIMIT ?
      )
      SELECT recent.id AS frameId, recent.timestamp, recent.app_name AS appName,
        recent.window_name AS windowName, frames.text_source AS textSource,
        substr(coalesce(nullif(frames.full_text, ''), frames.accessibility_text, ''), 1, ?) AS text
      FROM recent JOIN frames USING (id)
      WHERE (? = '' OR instr(lower(coalesce(recent.app_name, '')), lower(?)) > 0)
        AND (? = '' OR instr(lower(coalesce(recent.window_name, '')), lower(?)) > 0)
      ORDER BY julianday(recent.timestamp) DESC, recent.id DESC LIMIT ?
    `).all(lower, upper, query.startTime, query.endTime, MAX_FRAMES_TO_SCAN, maxTextChars,
      query.appName ?? "", query.appName ?? "", query.windowName ?? "", query.windowName ?? "", limit + 1);
    if (quarantined()) return null;
    return {
      hits: (rows.slice(0, limit) as unknown as Omit<RecallSearchHit, "type" | "speaker">[])
        .map(row => ({ ...row, type: "OCR", speaker: null })),
      total: null,
      hasMore: rows.length > limit,
    };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* history was unavailable */ }
  }
}
