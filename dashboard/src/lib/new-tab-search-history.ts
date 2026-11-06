import type Database from "better-sqlite3";
import { normalizeSearchHistory, type SearchHistoryEntry } from "./new-tab-search-suggestions.ts";

function ensureSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS new_tab_search_history (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    entries TEXT NOT NULL DEFAULT '[]'
  )`);
}

export function readSearchHistory(db: Database.Database, userId: number): SearchHistoryEntry[] {
  ensureSchema(db);
  const row = db.prepare("SELECT entries FROM new_tab_search_history WHERE user_id = ?").get(userId) as { entries: string } | undefined;
  try { return normalizeSearchHistory(JSON.parse(row?.entries ?? "[]")); } catch { return []; }
}

/** Read/edit/write stays atomic across tabs and survives desktop port changes. */
export function updateSearchHistory(db: Database.Database, userId: number, entry: SearchHistoryEntry, remove = false): SearchHistoryEntry[] {
  ensureSchema(db);
  return db.transaction(() => {
    const current = readSearchHistory(db, userId);
    const next = remove ? current.filter(item => item.scope !== entry.scope || item.query.toLocaleLowerCase() !== entry.query.toLocaleLowerCase())
      : normalizeSearchHistory([entry, ...current]);
    db.prepare("INSERT INTO new_tab_search_history (user_id, entries) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET entries = excluded.entries")
      .run(userId, JSON.stringify(next));
    return next;
  })();
}
