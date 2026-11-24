import type Database from "better-sqlite3";
import { DEFAULT_NOTE_ID, validNoteId, validNoteText, type TerminalNote, type TerminalNoteSummary } from "./terminal-note.ts";

const initialized = new WeakSet<Database.Database>();
function ensure(db: Database.Database) {
  if (initialized.has(db)) return;
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS terminal_notepad (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS terminal_notes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      revision INTEGER NOT NULL, updated_at TEXT, deleted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id,id)
    );
    INSERT OR IGNORE INTO terminal_notes(user_id,id,title,body,revision,updated_at)
      SELECT user_id,'default',title,body,revision,updated_at FROM terminal_notepad;`);
  })();
  initialized.add(db);
}
function ensureOwner(db: Database.Database, userId: number) {
  ensure(db);
  // Seed one blank note for first use; tombstones prevent deleted notes returning.
  db.prepare(`INSERT INTO terminal_notes(user_id,id,title,body,revision)
    SELECT ?,?,'','',0 WHERE NOT EXISTS(SELECT 1 FROM terminal_notes WHERE user_id=?)`)
    .run(userId, DEFAULT_NOTE_ID, userId);
}
export function readTerminalNote(db: Database.Database, userId: number, id = DEFAULT_NOTE_ID): TerminalNote | null {
  ensureOwner(db, userId);
  return db.prepare("SELECT title,body,revision,updated_at AS updatedAt FROM terminal_notes WHERE user_id=? AND id=? AND deleted=0")
    .get(userId, id) as TerminalNote | undefined ?? null;
}
export function listTerminalNotes(db: Database.Database, userId: number): TerminalNoteSummary[] {
  ensureOwner(db, userId);
  return db.prepare(`SELECT id,title,substr(body,1,100) AS preview,revision,updated_at AS updatedAt
    FROM terminal_notes WHERE user_id=? AND deleted=0 ORDER BY updated_at DESC,id`).all(userId) as TerminalNoteSummary[];
}
export function createTerminalNote(db: Database.Database, userId: number, id: string,
  text: Pick<TerminalNote, "title" | "body"> = {title: "", body: ""}): TerminalNote | null {
  if (!validNoteId(id) || id === DEFAULT_NOTE_ID || !validNoteText(text)) throw new Error("Invalid note");
  ensureOwner(db, userId);
  // Client-generated IDs make a retry after a lost response idempotent.
  db.prepare(`INSERT OR IGNORE INTO terminal_notes(user_id,id,title,body,revision,updated_at) VALUES (?,?,?,?,0,?)`)
    .run(userId, id, text.title, text.body, new Date().toISOString());
  return readTerminalNote(db, userId, id);
}
export function writeTerminalNote(db: Database.Database, userId: number, text: Pick<TerminalNote, "title" | "body">,
  revision: number, id = DEFAULT_NOTE_ID): {ok: boolean; note: TerminalNote | null} {
  if (!validNoteId(id) || !validNoteText(text) || !Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid note");
  ensureOwner(db, userId);
  return db.transaction(() => {
    const current = readTerminalNote(db, userId, id);
    if (!current) return {ok: false, note: null};
    if (current.title === text.title && current.body === text.body) return {ok: true, note: current};
    if (current.revision !== revision) return {ok: false, note: current};
    const next = {...text, revision: revision + 1, updatedAt: new Date().toISOString()};
    db.prepare("UPDATE terminal_notes SET title=?,body=?,revision=?,updated_at=? WHERE user_id=? AND id=? AND deleted=0")
      .run(next.title, next.body, next.revision, next.updatedAt, userId, id);
    if (current.body !== next.body) pruneTerminalNoteImages(db, userId);
    return {ok: true, note: next};
  })();
}
export function deleteTerminalNote(db: Database.Database, userId: number, id: string, revision: number): boolean {
  if (!validNoteId(id) || !Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid note");
  ensureOwner(db, userId);
  return db.transaction(() => {
    const current = readTerminalNote(db, userId, id);
    if (!current) return true;
    if (current.revision !== revision) return false;
    db.prepare("UPDATE terminal_notes SET deleted=1,title='',body='',revision=revision+1 WHERE user_id=? AND id=?")
      .run(userId, id);
    pruneTerminalNoteImages(db, userId);
    return true;
  })();
}

// Pasted images live beside notes; the body only holds a ![image](url) marker.
function ensureImages(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS terminal_note_images (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(user_id,id))`);
}
export function saveTerminalNoteImage(db: Database.Database, userId: number, id: string, mime: string, data: Buffer) {
  ensureImages(db);
  db.prepare("INSERT INTO terminal_note_images(user_id,id,mime,data,created_at) VALUES (?,?,?,?,?)")
    .run(userId, id, mime, data, new Date().toISOString());
}
export function readTerminalNoteImage(db: Database.Database, userId: number, id: string) {
  ensureImages(db);
  return db.prepare("SELECT mime,data FROM terminal_note_images WHERE user_id=? AND id=?")
    .get(userId, id) as {mime: string; data: Buffer} | undefined ?? null;
}
// Drops images no live note references. The one-day grace keeps a fresh paste
// whose note hasn't saved yet, and lets undo / local draft restores still resolve.
export function pruneTerminalNoteImages(db: Database.Database, userId: number) {
  ensureImages(db);
  db.prepare(`DELETE FROM terminal_note_images WHERE user_id=? AND created_at < ? AND NOT EXISTS(
    SELECT 1 FROM terminal_notes n WHERE n.user_id=terminal_note_images.user_id AND n.deleted=0 AND instr(n.body, terminal_note_images.id) > 0)`)
    .run(userId, new Date(Date.now() - 86_400_000).toISOString());
}
