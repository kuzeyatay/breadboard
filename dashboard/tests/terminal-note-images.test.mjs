import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { deleteTerminalNote, readTerminalNote, readTerminalNoteImage, saveTerminalNoteImage, writeTerminalNote } from '../src/lib/terminal-note-store.ts';

test('pasted note images are pruned once no live note references them, after a grace period', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1)');
  readTerminalNote(db, 1);
  const [kept, orphan, fresh] = ['a', 'b', 'c'].map(ch => ch.repeat(32));
  for (const id of [kept, orphan, fresh]) saveTerminalNoteImage(db, 1, id, 'image/png', Buffer.from([1]));
  db.prepare("UPDATE terminal_note_images SET created_at='2000-01-01' WHERE id IN (?,?)").run(kept, orphan);
  writeTerminalNote(db, 1, {title: '', body: `![image](/api/profile/terminal-note/image?id=${kept})`}, 0);
  assert.ok(readTerminalNoteImage(db, 1, kept));
  assert.equal(readTerminalNoteImage(db, 1, orphan), null);
  assert.ok(readTerminalNoteImage(db, 1, fresh), 'fresh paste survives before its note saves');
  deleteTerminalNote(db, 1, 'default', 1);
  assert.equal(readTerminalNoteImage(db, 1, kept), null);
});
