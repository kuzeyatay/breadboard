import type Database from "better-sqlite3";
import { payloadHash } from "./codec.ts";

const initialized = new WeakSet<Database.Database>();
export function ensurePdfObjectSchema(db: Database.Database): void {
  if (initialized.has(db)) return;
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='pdf_document_edit_history'").get()) return;
  db.exec(`CREATE TABLE IF NOT EXISTS storage_pdf_objects (
      sha256 TEXT PRIMARY KEY, data BLOB NOT NULL, byte_length INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS storage_pdf_references (
      revision_id INTEGER PRIMARY KEY REFERENCES pdf_document_edit_history(id) ON DELETE CASCADE,
      sha256 TEXT NOT NULL REFERENCES storage_pdf_objects(sha256)
    );
    CREATE INDEX IF NOT EXISTS storage_pdf_object_references ON storage_pdf_references(sha256);
    CREATE TRIGGER IF NOT EXISTS storage_pdf_reference_removed AFTER DELETE ON storage_pdf_references BEGIN
      DELETE FROM storage_pdf_objects WHERE sha256=OLD.sha256
        AND NOT EXISTS(SELECT 1 FROM storage_pdf_references WHERE sha256=OLD.sha256);
    END;
    CREATE TRIGGER IF NOT EXISTS storage_pdf_revision_replaced AFTER UPDATE OF pdf_data ON pdf_document_edit_history
    WHEN length(NEW.pdf_data)>0 BEGIN
      DELETE FROM storage_pdf_references WHERE revision_id=NEW.id;
    END;
  `);
  const columns=db.pragma("table_info(pdf_document_edit_history)") as Array<{name:string}>;
  db.exec(`CREATE VIEW IF NOT EXISTS pdf_document_history_reads AS SELECT ${columns.map(({name}) => name === "pdf_data"
    ? "COALESCE(o.data,h.pdf_data) AS pdf_data" : `h."${name.replaceAll('"','""')}"`).join(",")}
    FROM pdf_document_edit_history h LEFT JOIN storage_pdf_references r ON r.revision_id=h.id
    LEFT JOIN storage_pdf_objects o ON o.sha256=r.sha256`);
  initialized.add(db);
}

export function deduplicatePdfRevision(db: Database.Database, revisionId: number): number {
  ensurePdfObjectSchema(db);
  const row=db.prepare("SELECT pdf_data FROM pdf_document_edit_history WHERE id=? AND length(pdf_data)>0").get(revisionId) as {pdf_data:Buffer}|undefined;
  if (!row) return 0;
  const hash=payloadHash(row.pdf_data);
  return db.transaction(() => {
    const current=db.prepare("SELECT pdf_data FROM pdf_document_edit_history WHERE id=?").get(revisionId) as {pdf_data:Buffer}|undefined;
    if (!current?.pdf_data.equals(row.pdf_data)) return 0;
    const existing=db.prepare("SELECT data FROM storage_pdf_objects WHERE sha256=?").get(hash) as {data:Buffer}|undefined;
    if (existing && !existing.data.equals(row.pdf_data)) throw new Error("PDF object checksum mismatch");
    db.prepare("INSERT OR IGNORE INTO storage_pdf_objects(sha256,data,byte_length) VALUES(?,?,?)").run(hash,row.pdf_data,row.pdf_data.length);
    db.prepare("INSERT INTO storage_pdf_references(revision_id,sha256) VALUES(?,?)").run(revisionId,hash);
    db.prepare("UPDATE pdf_document_edit_history SET pdf_data=zeroblob(0) WHERE id=?").run(revisionId);
    return existing ? row.pdf_data.length : 0;
  })();
}
