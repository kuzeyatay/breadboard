import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { buzzThreadNodeId } from "./profile/brain-graph-ids.ts";
import { addMember, getRoomForUser, getMessage, listMembers, listThreadMessages, postMessage } from "./buzz/store.ts";
import { annotationPageUrl, annotationTargetKey, normalizeAnnotationTarget } from "./browser-annotations.ts";
import type { AnnotationResponse, AnnotationThread } from "./browser-annotations.ts";

export class AnnotationError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const initialized = new WeakSet<Database.Database>();
export function ensureBrowserAnnotationsSchema(db: Database.Database) {
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_annotation_threads (
      id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, room_id INTEGER REFERENCES buzz_rooms(id) ON DELETE CASCADE,
      page_url TEXT NOT NULL, target_key TEXT NOT NULL, target_json TEXT NOT NULL,
      root_message_id INTEGER REFERENCES buzz_room_messages(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(scope_key,page_url,target_key)
    );
    CREATE INDEX IF NOT EXISTS browser_annotation_page ON browser_annotation_threads(scope_key,page_url);
    CREATE TABLE IF NOT EXISTS browser_annotation_comments (
      id INTEGER PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES browser_annotation_threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, author TEXT NOT NULL, body TEXT NOT NULL,
      source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS browser_annotation_flags (
      id INTEGER PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES browser_annotation_threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, author TEXT NOT NULL, reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(thread_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS browser_annotation_operations (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, operation_id TEXT NOT NULL,
      thread_id TEXT NOT NULL REFERENCES browser_annotation_threads(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id,operation_id)
    );
  `);
  initialized.add(db);
}
interface ThreadRow { id: string; scope_key: string; room_id: number | null; page_url: string; target_json: string; root_message_id: number | null; }

function audience(db: Database.Database, userId: number, scope: unknown, write = false) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new AnnotationError(401, "Sign in to comment.");
  if (scope === "public") return { key: "public", room: null };
  if (typeof scope !== "string" || !scope.startsWith("room:")) throw new AnnotationError(400, "Choose an audience.");
  const room = getRoomForUser(db, userId, scope.slice(5));
  if (!room) throw new AnnotationError(404, "Room not found.");
  if (write && room.archivedAt) throw new AnnotationError(409, "This room is archived.");
  return { key: `room:${room.publicId}`, room };
}
function threadView(db: Database.Database, row: ThreadRow, roomPublicId: string | null): AnnotationThread {
  const count = row.room_id && row.root_message_id
    ? (db.prepare("SELECT count(*) AS n FROM buzz_room_messages WHERE room_id=? AND (id=? OR parent_id=?) AND deleted_at IS NULL AND author_kind!='system'").get(row.room_id, row.root_message_id, row.root_message_id) as { n: number }).n
    : (db.prepare("SELECT count(*) AS n FROM browser_annotation_comments WHERE thread_id=?").get(row.id) as { n: number }).n;
  return { id: row.id, target: JSON.parse(row.target_json), roomPublicId, rootMessageId: row.root_message_id, count,
    ...(roomPublicId && row.root_message_id ? { organizationHref: `/buzz?room=${encodeURIComponent(roomPublicId)}&thread=${encodeURIComponent(buzzThreadNodeId(roomPublicId, row.root_message_id))}` } : {}) };
}

export function readBrowserAnnotations(db: Database.Database, userId: number, scope: unknown, pageUrl: unknown, threadId?: string | null): AnnotationResponse {
  ensureBrowserAnnotationsSchema(db);
  const access = audience(db, userId, scope);
  const url = annotationPageUrl(pageUrl);
  if (!url) throw new AnnotationError(400, "Open a web page first.");
  const rows = db.prepare(`SELECT t.* FROM browser_annotation_threads t WHERE scope_key=? AND page_url=?
    AND (root_message_id IS NULL OR EXISTS (SELECT 1 FROM buzz_room_messages m WHERE m.id=t.root_message_id AND m.deleted_at IS NULL))
    ORDER BY created_at,id LIMIT 200`).all(access.key, url) as ThreadRow[];
  const threads = rows.map(row => threadView(db, row, access.room?.publicId ?? null));
  const row = threadId ? rows.find(row => row.id === threadId) : undefined;
  if (threadId && !row) throw new AnnotationError(404, "Discussion not found.");
  if (!row) return { threads, thread: null, messages: [], flags: [] };
  const messages = row.room_id && row.root_message_id ? [getMessage(db, row.root_message_id), ...listThreadMessages(db, row.room_id, row.root_message_id)]
    .filter(message => message && !message.deletedAt && message.authorKind !== "system").slice(-300).map(message => {
      const member = message!.memberId ? db.prepare("SELECT user_id FROM buzz_room_members WHERE id=?").get(message!.memberId) as { user_id: number } | undefined : undefined;
      return { id: `room:${message!.id}`, author: message!.authorName, body: typeof message!.metadata?.annotationBody === "string" ? message!.metadata.annotationBody : message!.body,
        source: annotationPageUrl(message!.metadata?.annotationSource),
        createdAt: message!.createdAt, own: member?.user_id === userId };
    }) : (db.prepare("SELECT * FROM (SELECT * FROM browser_annotation_comments WHERE thread_id=? ORDER BY id DESC LIMIT 300) ORDER BY id").all(row.id) as Array<{ id: number; user_id: number; author: string; body: string; source: string | null; created_at: string }>).map(message => ({
      id: `public:${message.id}`, author: message.author, body: message.body, source: message.source, createdAt: message.created_at, own: message.user_id === userId,
    }));
  const flags = (db.prepare("SELECT id,user_id,author,reason FROM browser_annotation_flags WHERE thread_id=? ORDER BY id LIMIT 100").all(row.id) as Array<{id: number; user_id: number; author: string; reason: string}>).map(flag => ({ id: flag.id, author: flag.author, reason: flag.reason, own: flag.user_id === userId }));
  return { threads, thread: threads.find(thread => thread.id === row.id)!, messages, flags };
}

export function writeBrowserAnnotation(db: Database.Database, userId: number, displayName: string, input: Record<string, unknown>): AnnotationResponse {
  ensureBrowserAnnotationsSchema(db);
  const access = audience(db, userId, input.scope, true);
  const target = normalizeAnnotationTarget(input.target);
  if (!target) throw new AnnotationError(400, "Select content on the current page.");
  const operationId = typeof input.operationId === "string" && /^[\w-]{8,128}$/.test(input.operationId) ? input.operationId : null;
  if (!operationId) throw new AnnotationError(400, "Missing operation identifier.");
  if (!["comment", "flag", "withdraw-flag", "delete-comment"].includes(String(input.action))) throw new AnnotationError(400, "Unknown annotation action.");
  const action = String(input.action);
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if ((action === "comment" || action === "flag") && (!body || body.length > 4000)) throw new AnnotationError(400, "Write between 1 and 4,000 characters.");
  const source = input.source ? annotationPageUrl(input.source) : null;
  if (input.source && !source) throw new AnnotationError(400, "Use an http or https source link.");
  const digest = createHash("sha256").update(annotationTargetKey(target)).digest("hex");
  const id = db.transaction(() => {
    const prior = db.prepare("SELECT thread_id FROM browser_annotation_operations WHERE user_id=? AND operation_id=?").get(userId, operationId) as { thread_id: string } | undefined;
    if (prior) {
      const previous = db.prepare("SELECT * FROM browser_annotation_threads WHERE id=?").get(prior.thread_id) as ThreadRow | undefined;
      if (!previous || previous.scope_key !== access.key || previous.page_url !== target.url || annotationTargetKey(JSON.parse(previous.target_json)) !== annotationTargetKey(target)) throw new AnnotationError(409, "This operation belongs to another discussion.");
      return prior.thread_id;
    }
    const recent = db.prepare("SELECT count(*) AS n FROM browser_annotation_operations WHERE user_id=? AND created_at > datetime('now','-1 minute')").get(userId) as { n: number };
    if (recent.n >= 30) throw new AnnotationError(429, "Please wait a moment before posting again.");
    let row = db.prepare("SELECT * FROM browser_annotation_threads WHERE scope_key=? AND page_url=? AND target_key=?").get(access.key, target.url, digest) as ThreadRow | undefined;
    if (!row) {
      if (action !== "comment" && action !== "flag") throw new AnnotationError(404, "Discussion not found.");
      const count = db.prepare("SELECT count(*) AS n FROM browser_annotation_threads WHERE scope_key=? AND page_url=?").get(access.key, target.url) as { n: number };
      if (count.n >= 200) throw new AnnotationError(409, "This page has reached its discussion limit. Reply to an existing discussion.");
      const threadId = randomUUID();
      db.prepare("INSERT INTO browser_annotation_threads(id,scope_key,room_id,page_url,target_key,target_json) VALUES(?,?,?,?,?,?)").run(threadId, access.key, access.room?.id ?? null, target.url, digest, JSON.stringify(target));
      row = db.prepare("SELECT * FROM browser_annotation_threads WHERE id=?").get(threadId) as ThreadRow;
    }
    if (row.root_message_id && getMessage(db, row.root_message_id)?.deletedAt) throw new AnnotationError(409, "This discussion was removed in Organization.");
    if (access.room && !row.root_message_id && (action === "comment" || action === "flag")) {
      const root = postMessage(db, access.room.id, { clientMessageId: `annotation:${row.id}`, memberId: null, authorKind: "system", authorName: "Page discussion",
        body: `${target.title}\n${target.url}${target.quote ? `\n\n> ${target.quote.replace(/\n/g, "\n> ")}` : `\n\n${target.kind === "video" ? `Video${target.time !== undefined ? ` at ${target.time}s` : ""}` : target.kind === "image" ? "Image" : "Page"}`}`,
        metadata: { browserAnnotation: { threadId: row.id, target } } });
      row.root_message_id = root.id;
      db.prepare("UPDATE browser_annotation_threads SET root_message_id=? WHERE id=?").run(root.id, row.id);
    }
    if (action === "comment") {
      if (access.room) {
        const member = listMembers(db, access.room.id).find(member => member.userId === userId) ?? addMember(db, access.room.id, { kind: "human", userId, displayName, handle: displayName });
        postMessage(db, access.room.id, { clientMessageId: `annotation:${userId}:${operationId}`, memberId: member.id, authorKind: "human", authorName: member.displayName, authorHandle: member.handle,
          parentId: row.root_message_id, body: source ? `${body}\n\nSource: ${source}` : body, metadata: { annotationSource: source, annotationBody: body } });
      } else db.prepare("INSERT INTO browser_annotation_comments(thread_id,user_id,author,body,source) VALUES(?,?,?,?,?)").run(row.id, userId, displayName.slice(0,80), body, source);
    } else if (action === "flag") {
      db.prepare(`INSERT INTO browser_annotation_flags(thread_id,user_id,author,reason) VALUES(?,?,?,?)
        ON CONFLICT(thread_id,user_id) DO UPDATE SET reason=excluded.reason`).run(row.id, userId, displayName.slice(0,80), body);
    } else if (action === "withdraw-flag") db.prepare("DELETE FROM browser_annotation_flags WHERE thread_id=? AND user_id=?").run(row.id, userId);
    else {
      const messageId = typeof input.messageId === "string" ? input.messageId : "";
      if (access.room) {
        const message = /^room:\d+$/.test(messageId) ? getMessage(db, Number(messageId.slice(5))) : null;
        const member = message?.memberId ? listMembers(db, access.room.id).find(member => member.id === message.memberId) : null;
        if (!message || message.parentId !== row.root_message_id || message.roomId !== access.room.id || member?.userId !== userId) throw new AnnotationError(404, "Comment not found.");
        db.prepare("UPDATE buzz_room_messages SET body='',deleted_at=datetime('now') WHERE id=?").run(message.id);
      } else {
        if (!/^public:\d+$/.test(messageId)) throw new AnnotationError(404, "Comment not found.");
        const result = db.prepare("DELETE FROM browser_annotation_comments WHERE id=? AND thread_id=? AND user_id=?").run(Number(messageId.slice(7)),row.id,userId);
        if (!result.changes) throw new AnnotationError(404, "Comment not found.");
      }
    }
    if (access.room && row.root_message_id && (action === "flag" || action === "withdraw-flag")) {
      postMessage(db, access.room.id, { clientMessageId: `annotation:${userId}:${operationId}`, memberId: null, authorKind: "system", authorName: displayName.slice(0,80), parentId: row.root_message_id,
        body: action === "flag" ? `Flagged this content: ${body}` : "Removed their flag.", metadata: { browserAnnotationFlag: row.id } });
    }
    db.prepare("INSERT INTO browser_annotation_operations(user_id,operation_id,thread_id) VALUES(?,?,?)").run(userId, operationId, row.id);
    return row.id;
  })();
  return readBrowserAnnotations(db, userId, input.scope, target.url, id);
}
