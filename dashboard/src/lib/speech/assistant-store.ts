import type Database from 'better-sqlite3';
import { DEFAULT_VOICE_ASSISTANT, parseVoiceAssistantPreferences, type VoiceAssistantPreferences } from './assistant-preferences.ts';
function ensure(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS voice_assistant_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences_json TEXT NOT NULL
  )`);
}
export function readVoiceAssistantPreferences(db: Database.Database, userId: number): VoiceAssistantPreferences {
  ensure(db);
  const row = db.prepare('SELECT preferences_json FROM voice_assistant_preferences WHERE user_id = ?').get(userId) as { preferences_json: string } | undefined;
  try { return parseVoiceAssistantPreferences(JSON.parse(row?.preferences_json ?? 'null')) ?? { ...DEFAULT_VOICE_ASSISTANT }; }
  catch { return { ...DEFAULT_VOICE_ASSISTANT }; }
}
export function writeVoiceAssistantPreferences(db: Database.Database, userId: number, value: unknown): VoiceAssistantPreferences {
  const preferences = parseVoiceAssistantPreferences(value);
  if (!preferences) throw new Error('Invalid voice assistant preferences.');
  ensure(db);
  db.prepare(`INSERT INTO voice_assistant_preferences (user_id, preferences_json) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET preferences_json = excluded.preferences_json`).run(userId, JSON.stringify(preferences));
  return preferences;
}
