import type Database from "better-sqlite3";
import { parsePaintPomodoroDurations, type PaintPomodoroDurations } from "./paint-pomodoro-settings.ts";

function ensureSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS paint_pomodoro_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    durations_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

export function readPaintPomodoroDurations(db: Database.Database, userId: number): PaintPomodoroDurations | null {
  ensureSchema(db);
  const row = db.prepare("SELECT durations_json FROM paint_pomodoro_settings WHERE user_id = ?")
    .get(userId) as { durations_json: string } | undefined;
  if (!row) return null;
  const durations = parsePaintPomodoroDurations(JSON.parse(row.durations_json));
  if (!durations) throw new Error("The saved timer settings could not be read.");
  return durations;
}

export function writePaintPomodoroDurations(db: Database.Database, userId: number, input: unknown): PaintPomodoroDurations {
  const durations = parsePaintPomodoroDurations(input);
  if (!durations) throw new Error("Timer durations must be between 1 and 180 minutes.");
  ensureSchema(db);
  db.prepare(`INSERT INTO paint_pomodoro_settings (user_id, durations_json) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET durations_json = excluded.durations_json, updated_at = datetime('now')`)
    .run(userId, JSON.stringify(durations));
  return durations;
}
