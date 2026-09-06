import type Database from 'better-sqlite3';
import { migrateClapPreferences, parseClapPreferences, type ClapPreferences, type GestureControl } from './preferences.ts';

function tableName(control: GestureControl) { return control === 'snap' ? 'snap_controls_preferences' : 'clap_controls_preferences'; }
function ensure(db: Database.Database, control: GestureControl) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${tableName(control)} (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}
export function readClapPreferences(db: Database.Database, userId: number, control: GestureControl = 'clap'): ClapPreferences {
  ensure(db, control);
  const row = db.prepare(`SELECT preferences_json FROM ${tableName(control)} WHERE user_id = ?`).get(userId) as { preferences_json: string } | undefined;
  try { return migrateClapPreferences(row ? JSON.parse(row.preferences_json) : null, control); }
  catch { return migrateClapPreferences(null, control); }
}
export function writeClapPreferences(db: Database.Database, userId: number, value: unknown, control: GestureControl = 'clap'): ClapPreferences {
  const p = parseClapPreferences(value);
  if (!p) throw new Error('Invalid clap preferences.');
  ensure(db, control);
  db.prepare(`INSERT INTO ${tableName(control)} (user_id, preferences_json) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json, updated_at=datetime('now')`).run(userId, JSON.stringify(p));
  return p;
}
