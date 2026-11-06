import type Database from "better-sqlite3";
import type { AppearancePage, AppearanceTheme } from "./page-appearance.ts";
import { parseSavedBackground, type SavedBackground, type SavedPageAppearance } from "./page-appearance-persistence.ts";

const initialized = new WeakSet<Database.Database>();

function ensure(db: Database.Database) {
  if (initialized.has(db)) return;
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS page_appearance (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      page TEXT NOT NULL,
      theme TEXT NOT NULL,
      background TEXT NOT NULL,
      next_change_at INTEGER,
      rain_mode TEXT,
      PRIMARY KEY (user_id, page, theme)
    )`);
    const columns = db.pragma("table_info(page_appearance)") as { name: string }[];
    if (!columns.some(column => column.name === "rain_mode")) db.exec("ALTER TABLE page_appearance ADD COLUMN rain_mode TEXT");
  })();
  initialized.add(db);
}

export function readSavedPageAppearance(db: Database.Database, userId: number, page: AppearancePage): SavedPageAppearance {
  ensure(db);
  const rows = db.prepare("SELECT theme, background, next_change_at AS nextChangeAt, rain_mode AS rain FROM page_appearance WHERE user_id = ? AND page = ?")
    .all(userId, page) as (Omit<SavedBackground, "rain"> & { theme: AppearanceTheme; rain: SavedBackground["rain"] | null })[];
  const saved: SavedPageAppearance = {};
  for (const row of rows) {
    const value = parseSavedBackground({ ...row, rain: row.rain ?? undefined });
    if (value && (row.theme === "light" || row.theme === "dark")) saved[row.theme] = value;
  }
  return saved;
}

export function writeSavedBackground(
  db: Database.Database, userId: number, page: AppearancePage, theme: AppearanceTheme,
  value: SavedBackground, onlyIfMissing = false,
): SavedBackground {
  const saved = parseSavedBackground(value);
  if (!saved) throw new Error("Invalid background preference.");
  ensure(db);
  // A legacy browser copy may initialize a missing record, but must never
  // replace a choice already saved by another tab or an earlier launch.
  return db.transaction(() => {
    db.prepare(`INSERT INTO page_appearance (user_id, page, theme, background, next_change_at, rain_mode) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, page, theme) DO ${onlyIfMissing ? "NOTHING" : "UPDATE SET background = excluded.background, next_change_at = excluded.next_change_at, rain_mode = excluded.rain_mode"}`)
      .run(userId, page, theme, saved.background, saved.nextChangeAt, saved.rain ?? null);
    return readSavedPageAppearance(db, userId, page)[theme]!;
  })();
}
