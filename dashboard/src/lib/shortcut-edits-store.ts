import type Database from "better-sqlite3";
import { normalizeShortcutEdits, validShortcutEdits, type ShortcutEdit } from "./shortcut-edits.ts";

const initialized = new WeakSet<Database.Database>();
function ensure(db: Database.Database) {
  if (initialized.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS browser_shortcut_edits (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    edits TEXT NOT NULL
  )`);
  initialized.add(db);
}
export function readShortcutEdits(db: Database.Database, userId: number): ShortcutEdit[] {
  ensure(db);
  const row = db.prepare("SELECT edits FROM browser_shortcut_edits WHERE user_id=?").get(userId) as { edits: string } | undefined;
  try { return normalizeShortcutEdits(JSON.parse(row?.edits ?? "[]")); } catch { return []; }
}
export function writeShortcutEdits(db: Database.Database, userId: number, value: unknown): ShortcutEdit[] {
  if (!validShortcutEdits(value)) throw new Error("Invalid shortcut changes.");
  ensure(db);
  const edits = normalizeShortcutEdits(value);
  db.prepare("INSERT INTO browser_shortcut_edits(user_id,edits) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET edits=excluded.edits")
    .run(userId, JSON.stringify(edits));
  return edits;
}
