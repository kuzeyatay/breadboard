import type Database from 'better-sqlite3';
import { DEFAULT_CLAP_ACTION, DEFAULT_SNAP_ACTION, parseClapSettings, type ClapActionSettings } from './clap-action.ts';
import type { GestureControl } from '../speech/clap/preferences.ts';
const tableName = (control: GestureControl) => control === 'snap' ? 'snap_action_settings' : 'clap_action_settings';

export function ensureClapActionSchema(db: Database.Database, control: GestureControl = 'clap'): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${tableName(control)} (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

export function readClapAction(db: Database.Database, userId: number, control: GestureControl = 'clap'): ClapActionSettings {
  ensureClapActionSchema(db, control);
  const row = db.prepare(`SELECT settings_json FROM ${tableName(control)} WHERE user_id = ?`).get(userId) as { settings_json: string } | undefined;
  if (!row) return structuredClone(control === 'snap' ? DEFAULT_SNAP_ACTION : DEFAULT_CLAP_ACTION);
  // A corrupt saved command is never replaced by a different action silently.
  const settings = parseClapSettings(JSON.parse(row.settings_json));
  if (!settings) throw new Error('Your clap action could not be read. Save it again from Profile.');
  return settings;
}

export function writeClapAction(db: Database.Database, userId: number, input: unknown, control: GestureControl = 'clap'): ClapActionSettings {
  const settings = parseClapSettings(input);
  if (!settings) throw new Error('The clap action is invalid.');
  ensureClapActionSchema(db, control);
  db.prepare(`INSERT INTO ${tableName(control)} (user_id, settings_json) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = datetime('now')`)
    .run(userId, JSON.stringify(settings));
  return settings;
}
