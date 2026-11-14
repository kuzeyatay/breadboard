import type Database from "better-sqlite3";
import { packPayload, unpackPayload, payloadHash, PayloadCache, PayloadPacker } from "./codec.ts";
import { DAY_MS, STORAGE_POLICY } from "./policy.ts";
import { ensureAttachmentReferences } from "./attachment-references.ts";

const installed = new WeakMap<Database.Database, Map<number, number>>();
const payloadCaches = new WeakMap<Database.Database, PayloadCache>();
/** Memory-pressure handling and repeatable cold-page performance checks. */
export function evictConversationPayloadCache(db: Database.Database): void { payloadCaches.get(db)?.clear(); }
const fields = ["metadata", "sources"] as const;
type Field = typeof fields[number];

/** Keep SQL predicates and covering indexes cheap; the read view restores every
 * original byte. Only bulky detail collections are removed from this projection. */
function metadataProjection(text: string): string | null {
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== "object") return null;
    const projection = { ...value };
    for (const key of ["toolCalls", "toolResults", "thinking", "reasoning", "events", "steps", "rawEvents", "artifacts"])
      delete projection[key];
    // Ownership predicates also accept the historical toolCalls binding.
    if (value.toolCalls && !Array.isArray(value.toolCalls) && typeof value.toolCalls === "object") {
      projection.toolCalls = {};
      for (const key of ["externalAgentRun", "inlineSelection", "verification"])
        if (key in value.toolCalls) projection.toolCalls[key] = value.toolCalls[key];
    }
    return JSON.stringify(projection);
  } catch { return null; }
}

export function ensureChatPayloadSchema(db: Database.Database): void {
  if (installed.has(db)) return;
  ensureAttachmentReferences(db);
  const reads = new Map<number, number>(), cache = new PayloadCache();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      if (!db.open) return;
      try { flushConversationReads(db); } catch { scheduleFlush(); }
    }, 1000);
    flushTimer.unref();
  };
  db.function("breadboard_storage_text", (plain, encoded, bytes, hash, conversationId) => {
    if (typeof conversationId === "number") { reads.set(conversationId, Date.now()); scheduleFlush(); }
    if (encoded === null) return plain;
    if (!Buffer.isBuffer(encoded) || typeof hash !== "string" || typeof bytes !== "number")
      throw new Error("Invalid stored conversation payload");
    const cached = cache.get(hash);
    if (cached !== undefined) return cached;
    const text = unpackPayload(encoded, bytes, hash).toString("utf8");
    cache.put(hash, text); return text;
  });
  db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS storage_conversation_activity (
      conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      last_read_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS storage_message_payloads (
      message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
      field TEXT NOT NULL CHECK(field IN ('metadata','sources')),
      codec TEXT NOT NULL CHECK(codec='bbz1'), data BLOB NOT NULL,
      raw_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(message_id, field)
    );
    DROP TRIGGER IF EXISTS storage_metadata_replaced;
    DROP TRIGGER IF EXISTS storage_sources_replaced;
    CREATE TRIGGER storage_metadata_replaced AFTER UPDATE OF metadata ON conversation_messages
      WHEN EXISTS(SELECT 1 FROM storage_message_payloads WHERE message_id=NEW.id AND field='metadata')
        AND NEW.metadata IS NOT OLD.metadata BEGIN
      DELETE FROM storage_message_payloads WHERE message_id=NEW.id AND field='metadata';
    END;
    CREATE TRIGGER storage_sources_replaced AFTER UPDATE OF sources ON conversation_messages
      WHEN EXISTS(SELECT 1 FROM storage_message_payloads WHERE message_id=NEW.id AND field='sources')
        AND NEW.sources IS NOT OLD.sources BEGIN
      DELETE FROM storage_message_payloads WHERE message_id=NEW.id AND field='sources';
    END;
  `)).immediate();
  const columns = db.pragma("table_info(conversation_messages)") as Array<{ name: string }>;
  const select = columns.map(({ name }) => fields.includes(name as Field)
    ? `breadboard_storage_text(m.${name}, p_${name}.data, p_${name}.raw_bytes, p_${name}.sha256, m.conversation_id) AS ${name}`
    : `m."${name.replaceAll('"', '""')}"`).join(", ");
  db.exec(`CREATE VIEW IF NOT EXISTS conversation_message_reads AS SELECT ${select}
    FROM conversation_messages m
    LEFT JOIN storage_message_payloads p_metadata ON p_metadata.message_id=m.id AND p_metadata.field='metadata'
    LEFT JOIN storage_message_payloads p_sources ON p_sources.message_id=m.id AND p_sources.field='sources'`);
  installed.set(db, reads);
  payloadCaches.set(db, cache);
}

export function flushConversationReads(db: Database.Database): void {
  const reads = installed.get(db);
  if (!reads?.size) return;
  const save = db.prepare(`INSERT INTO storage_conversation_activity(conversation_id,last_read_at)
    SELECT id,? FROM conversations WHERE id=? ON CONFLICT(conversation_id)
    DO UPDATE SET last_read_at=MAX(last_read_at,excluded.last_read_at)`);
  db.transaction(() => { for (const [id, at] of reads) save.run(at, id); })();
  reads.clear();
}

/** Compare-and-swap inside one transaction. A changed row is never archived. */
export function compressMessageField(db: Database.Database, messageId: number, field: Field, now = Date.now()): number {
  ensureChatPayloadSchema(db);
  const row = db.prepare(`SELECT ${field} AS value FROM conversation_messages WHERE id=?`).get(messageId) as { value: string | null } | undefined;
  if (!row?.value || db.prepare("SELECT 1 FROM storage_message_payloads WHERE message_id=? AND field=?").get(messageId, field)) return 0;
  const raw = Buffer.from(row.value);
  if (raw.length < STORAGE_POLICY.minimumPayloadBytes || raw.length > STORAGE_POLICY.cacheBytes) return 0;
  const encoded = packPayload(raw), hash = payloadHash(raw);
  const projection = field === "metadata" ? metadataProjection(row.value) : JSON.stringify({ breadboardStoragePayload: hash });
  if (projection === null || encoded.length + Buffer.byteLength(projection) > raw.length * (1 - STORAGE_POLICY.minimumSaving)) return 0;
  if (!unpackPayload(encoded, raw.length, hash).equals(raw)) throw new Error("Storage roundtrip failed");
  return commitPacked(db, messageId, field, row.value, projection, encoded, hash, now);
}

function commitPacked(db: Database.Database, messageId: number, field: Field, original: string, projection: string, encoded: Buffer, hash: string, now: number): number {
  const rawBytes = Buffer.byteLength(original);
  return db.transaction(() => {
    const changed = db.prepare(`UPDATE conversation_messages SET ${field}=? WHERE id=? AND ${field}=?
      AND NOT EXISTS(SELECT 1 FROM storage_message_payloads WHERE message_id=? AND field=?)`)
      .run(projection, messageId, original, messageId, field).changes;
    if (!changed) return 0;
    db.prepare(`INSERT INTO storage_message_payloads(message_id,field,codec,data,raw_bytes,sha256,created_at)
      VALUES(?,?,'bbz1',?,?,?,?)`).run(messageId, field, encoded, rawBytes, hash, now);
    return rawBytes - encoded.length - Buffer.byteLength(projection);
  })();
}

function coldSelection(db: Database.Database, afterId: number, limit: number, now: number) {
  ensureChatPayloadSchema(db); flushConversationReads(db);
  const cutoff = now - STORAGE_POLICY.coldDays * DAY_MS;
  // Bound rows examined as well as rows returned; a warm installation must not
  // scan the entire message table on every maintenance tick.
  const candidates = db.prepare("SELECT id FROM conversation_messages WHERE id>? ORDER BY id LIMIT ?").all(afterId, limit) as Array<{id:number}>;
  if (!candidates.length) return { rows: [] as Array<{id:number}>, cursor: 0 };
  const hasRuns = db.prepare("SELECT 1 FROM sqlite_master WHERE name='hermes_runs'").get();
  const recoveryGuard = hasRuns ? `AND NOT EXISTS(SELECT 1 FROM hermes_runs r JOIN hermes_runtime_sessions s ON s.id=r.runtime_session_id
    WHERE s.conversation_id=c.id AND (r.status='active' OR json_extract(CASE WHEN json_valid(r.dispatch_json) THEN r.dispatch_json END,'$.taskRecovery.pending')=1))` : "";
  const rows = db.prepare(`SELECT m.id FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id
    LEFT JOIN storage_conversation_activity a ON a.conversation_id=c.id
    WHERE m.id IN (${candidates.map(()=>"?").join(",")}) AND c.updated_at < datetime(?/1000,'unixepoch')
      AND m.updated_at < datetime(?/1000,'unixepoch') AND COALESCE(a.last_read_at,0)<?
      AND NOT EXISTS(SELECT 1 FROM conversation_messages busy WHERE busy.conversation_id=c.id
        AND (busy.status='pending' OR json_extract(CASE WHEN json_valid(busy.metadata) THEN busy.metadata END,'$.externalAgentOutcome')='running'))
    ${recoveryGuard}
    ORDER BY m.id`).all(...candidates.map(row=>row.id), cutoff, cutoff, cutoff) as Array<{ id: number }>;
  return { rows, cursor: candidates[candidates.length-1].id };
}

export function compressColdMessages(db: Database.Database, options: { now?: number; maxMessages?: number; afterId?: number; shouldYield?: () => boolean } = {}) {
  const now = options.now ?? Date.now();
  const selected = coldSelection(db, options.afterId ?? 0, Math.min(16, options.maxMessages ?? 2), now);
  let bytesSaved = 0, cursor = options.afterId ?? 0;
  for (const row of selected.rows) {
    if (options.shouldYield?.()) return { bytesSaved, cursor };
    for (const field of fields) bytesSaved += compressMessageField(db, row.id, field, now);
    cursor = row.id;
  }
  return { bytesSaved, cursor: selected.cursor };
}

export class ColdPayloadWorker {
  private current: { id: number; field: Field; original: string; packer: PayloadPacker } | null = null;
  async step(db: Database.Database, afterId: number, shouldYield: () => boolean): Promise<{bytesSaved:number;cursor:number}> {
    if (!this.current) {
      const selected = coldSelection(db, afterId, 1, Date.now());
      for (const row of selected.rows) {
        for (const field of fields) {
          const value = db.prepare(`SELECT ${field} AS value FROM conversation_messages WHERE id=?
            AND NOT EXISTS(SELECT 1 FROM storage_message_payloads WHERE message_id=? AND field=?)`).get(row.id,row.id,field) as {value:string|null}|undefined;
          if (!value?.value) continue;
          const raw = Buffer.from(value.value);
          if (raw.length < STORAGE_POLICY.minimumPayloadBytes || raw.length > STORAGE_POLICY.cacheBytes) continue;
          this.current = { id:row.id, field, original:value.value, packer:new PayloadPacker(raw) }; break;
        }
      }
      if (!this.current) return {bytesSaved:0,cursor:selected.cursor};
    }
    const current = this.current;
    const packed = await current.packer.step(shouldYield);
    if (!packed) return {bytesSaved:0,cursor:afterId};
    this.current = null;
    const projection = current.field === "metadata" ? metadataProjection(current.original) : JSON.stringify({breadboardStoragePayload:packed.hash});
    if (projection === null || packed.encoded.length + Buffer.byteLength(projection) > Buffer.byteLength(current.original) * (1-STORAGE_POLICY.minimumSaving))
      return {bytesSaved:0,cursor:current.id};
    // Reads, pending work and recovery leases that appeared while the worker
    // yielded make this candidate warm. Compare-and-swap also protects edits.
    if (!coldSelection(db, current.id-1, 1, Date.now()).rows.some(row=>row.id===current.id)) return {bytesSaved:0,cursor:current.id};
    const bytesSaved = commitPacked(db,current.id,current.field,current.original,projection,packed.encoded,packed.hash,Date.now());
    // Revisit this message once to handle its other field without restoring it.
    return {bytesSaved,cursor:bytesSaved ? afterId : current.id};
  }
}
