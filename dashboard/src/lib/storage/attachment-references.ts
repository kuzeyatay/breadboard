import type Database from "better-sqlite3";

const initialized = new WeakSet<Database.Database>();
export function ensureAttachmentReferences(db: Database.Database): void {
  if (initialized.has(db)) return;
  db.transaction(() => db.exec(`CREATE TABLE IF NOT EXISTS storage_attachment_index(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO storage_attachment_index(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS storage_attachment_references(
      message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
      blob_id TEXT NOT NULL,PRIMARY KEY(message_id,blob_id));
    CREATE INDEX IF NOT EXISTS storage_attachment_blob ON storage_attachment_references(blob_id,message_id);
    CREATE TABLE IF NOT EXISTS storage_attachment_dirty(
      message_id INTEGER PRIMARY KEY REFERENCES conversation_messages(id) ON DELETE CASCADE);
    DROP TRIGGER IF EXISTS storage_attachment_insert;
    DROP TRIGGER IF EXISTS storage_attachment_update;
    DROP TRIGGER IF EXISTS storage_attachment_enqueue_update;
    CREATE TRIGGER IF NOT EXISTS storage_attachment_enqueue_insert AFTER INSERT ON conversation_messages BEGIN
      INSERT OR IGNORE INTO storage_attachment_dirty VALUES(NEW.id);
    END;
    CREATE TRIGGER IF NOT EXISTS storage_attachment_enqueue_update AFTER UPDATE OF metadata ON conversation_messages
    WHEN NOT EXISTS(SELECT 1 FROM storage_attachment_dirty WHERE message_id=NEW.id) BEGIN
      INSERT OR IGNORE INTO storage_attachment_dirty VALUES(NEW.id);
    END;`)).immediate();
  initialized.add(db);
}

export function attachmentIndexComplete(db: Database.Database): boolean {
  ensureAttachmentReferences(db);
  return (db.prepare(`SELECT complete AND NOT EXISTS(SELECT 1 FROM storage_attachment_dirty LIMIT 1) AS complete
    FROM storage_attachment_index WHERE id=1`).get() as {complete:number}).complete===1;
}

export function indexAttachmentReferences(db: Database.Database, shouldYield: () => boolean): void {
  ensureAttachmentReferences(db);
  const state=db.prepare("SELECT cursor,complete FROM storage_attachment_index WHERE id=1").get() as {cursor:number;complete:number};
  // Streaming only enqueues a message ID. Parse its potentially large metadata
  // once while idle, instead of parsing old and new JSON on every token write.
  // Until the queue is drained, absence never authorizes attachment deletion.
  const rows=state.complete
    ? db.prepare("SELECT message_id AS id FROM storage_attachment_dirty ORDER BY message_id LIMIT 128").all() as Array<{id:number}>
    : db.prepare("SELECT id FROM conversation_messages WHERE id>? ORDER BY id LIMIT 128").all(state.cursor) as Array<{id:number}>;
  if(!rows.length && !state.complete){db.prepare("UPDATE storage_attachment_index SET complete=1 WHERE id=1").run();return;}
  for(const row of rows){
    if(shouldYield())break;
    db.transaction(()=>{
      db.prepare("DELETE FROM storage_attachment_references WHERE message_id=?").run(row.id);
      db.prepare(`INSERT OR IGNORE INTO storage_attachment_references SELECT m.id,json_extract(j.value,'$.blobId')
        FROM conversation_messages m,json_each(CASE WHEN json_valid(m.metadata) THEN m.metadata ELSE '{}' END,'$.attachments') j
        WHERE m.id=? AND j.type='object' AND typeof(json_extract(j.value,'$.blobId'))='text'`).run(row.id);
      db.prepare("DELETE FROM storage_attachment_dirty WHERE message_id=?").run(row.id);
      if(!state.complete)db.prepare("UPDATE storage_attachment_index SET cursor=? WHERE id=1").run(row.id);
    })();
  }
}

/** Until backfill is complete, absence is not proof that a blob is unowned. */
export function attachmentReferenced(db: Database.Database, blobId: string, excludingConversation?: number): boolean {
  if(!attachmentIndexComplete(db))return true;
  return !!db.prepare(`SELECT 1 FROM storage_attachment_references r JOIN conversation_messages m ON m.id=r.message_id
    WHERE r.blob_id=? AND (? IS NULL OR m.conversation_id<>?) LIMIT 1`).get(blobId,excludingConversation??null,excludingConversation??null);
}
