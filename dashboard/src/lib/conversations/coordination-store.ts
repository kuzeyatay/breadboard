import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ApiError } from "../hermes/route-core.ts";

export const CHAT_MESSAGE_TTL_MS = 15 * 60_000;
export const chatMessageClientId = (id: string) => `chat-message:${id}`;
export interface CoordinatingChat {
  id: number;
  public_id: string;
  user_id: number;
  title: string;
  surface: string;
  default_garden_id: number | null;
  temporary: number;
  archived_at: string | null;
}
export interface ChatEnvelope {
  id: string;
  user_id: number;
  source_id: number;
  target_id: number;
  source_run_id: string;
  request_id: string;
  parent_id: string | null;
  message: string;
  status: "queued" | "dispatching" | "running" | "complete" | "failed" | "cancelled";
  error: string | null;
  created_at: number;
  claimed_at: number | null;
}

export function ensureChatCoordinationSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_agent_messages (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    source_run_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    parent_id TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','dispatching','running','complete','failed','cancelled')),
    error TEXT,
    created_at INTEGER NOT NULL,
    claimed_at INTEGER,
    UNIQUE(source_id, source_run_id, request_id)
  );
  CREATE INDEX IF NOT EXISTS chat_agent_messages_pending ON chat_agent_messages(target_id, status, created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS chat_agent_messages_dispatch ON chat_agent_messages(target_id) WHERE status = 'dispatching';`);
}

/** SQLite is the authority across route bundles, reloads and detached pumps. */
export class ChatCoordinationStore {
  readonly db: Database.Database;
  constructor(db: Database.Database) { this.db = db; ensureChatCoordinationSchema(db); }

  chat(userId: number, id: number | string): CoordinatingChat {
    const row = this.db.prepare(`SELECT * FROM conversations WHERE user_id = ? AND ${typeof id === "number" ? "id" : "public_id"} = ?
      AND temporary = 0 AND archived_at IS NULL AND surface IN ('dashboard_terminal', 'garden_chat')`).get(userId, id) as CoordinatingChat | undefined;
    if (!row) throw new ApiError(404, "chat_unavailable", "This saved chat is unavailable for coordination.");
    return row;
  }

  list(userId: number, query: string, afterId: number, limit: number, gardenIds: number[]) {
    const gardens = JSON.stringify(gardenIds);
    return this.db.prepare(`SELECT c.id, c.public_id AS chatId, c.title, c.surface,
      c.default_garden_id AS gardenId,
      EXISTS(SELECT 1 FROM conversation_messages m WHERE m.conversation_id = c.id AND m.role = 'assistant' AND m.status = 'pending') AS busy
      FROM conversations c WHERE c.user_id = ? AND c.temporary = 0 AND c.archived_at IS NULL
      AND c.surface IN ('dashboard_terminal','garden_chat') AND c.id > ?
      AND (c.default_garden_id IS NULL OR c.default_garden_id IN (SELECT value FROM json_each(?)))
      AND instr(lower(c.title), lower(?)) > 0 ORDER BY c.id LIMIT ?`).all(userId, afterId, gardens, query, limit) as Array<{
        id: number; chatId: string; title: string; surface: string; gardenId: number | null; busy: number;
      }>;
  }

  get(id: string): ChatEnvelope | undefined {
    return this.db.prepare("SELECT * FROM chat_agent_messages WHERE id = ?").get(id) as ChatEnvelope | undefined;
  }

  enqueue(input: { userId: number; sourceId: number; targetId: string; sourceRunId: string; requestId: string; message: string; parentId?: string }) {
    return this.db.transaction(() => {
      const source = this.chat(input.userId, input.sourceId);
      const target = this.chat(input.userId, input.targetId);
      if (source.id === target.id) throw new ApiError(400, "chat_self_message", "Choose a different chat.");
      const existing = this.db.prepare("SELECT * FROM chat_agent_messages WHERE source_id = ? AND source_run_id = ? AND request_id = ?").get(source.id, input.sourceRunId, input.requestId) as ChatEnvelope | undefined;
      if (existing) {
        if (existing.target_id !== target.id || existing.message !== input.message) throw new ApiError(409, "chat_message_conflict", "This request_id already belongs to a different message.");
        return existing;
      }
      let parentId = input.parentId;
      for (let depth = 0; parentId; depth++) {
        const parent = this.get(parentId);
        if (!parent || parent.user_id !== input.userId || (depth === 0 && parent.target_id !== source.id)) throw new ApiError(403, "chat_parent_invalid", "Invalid coordination parent.");
        if (parent.source_id === target.id || depth >= 7) throw new ApiError(409, "chat_coordination_cycle", "Reply to the incoming request in your final answer; do not send it back to an ancestor chat.");
        parentId = parent.parent_id ?? undefined;
      }
      // Concurrent, independently started chains must not wait on each other.
      const cycle = this.db.prepare(`WITH RECURSIVE reachable(id) AS (
        SELECT target_id FROM chat_agent_messages WHERE source_id = ? AND status IN ('queued','dispatching','running')
        UNION SELECT m.target_id FROM chat_agent_messages m JOIN reachable r ON m.source_id = r.id
        WHERE m.status IN ('queued','dispatching','running')) SELECT 1 FROM reachable WHERE id = ? LIMIT 1`).get(target.id, source.id);
      if (cycle) throw new ApiError(409, "chat_coordination_cycle", "That chat is already waiting on this chat. Answer the incoming message first.");
      const count = this.db.prepare("SELECT count(*) AS n FROM chat_agent_messages WHERE source_run_id = ?").get(input.sourceRunId) as { n: number };
      if (count.n >= 16) throw new ApiError(429, "chat_message_limit", "This turn has reached its limit of 16 cross-chat messages.");
      const id = `msg_${randomUUID()}`;
      this.db.prepare(`INSERT INTO chat_agent_messages (id,user_id,source_id,target_id,source_run_id,request_id,parent_id,message,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(id, input.userId, source.id, target.id, input.sourceRunId, input.requestId, input.parentId ?? null, input.message, Date.now());
      return this.get(id)!;
    }).immediate();
  }

  pendingTargets(): number[] {
    return (this.db.prepare("SELECT DISTINCT target_id AS id FROM chat_agent_messages WHERE status IN ('queued','dispatching','running')").all() as { id: number }[]).map(row => row.id);
  }

  next(targetId: number): ChatEnvelope | undefined {
    return this.db.prepare(`SELECT * FROM chat_agent_messages WHERE target_id = ? AND status IN ('queued','dispatching','running') ORDER BY created_at, rowid LIMIT 1`).get(targetId) as ChatEnvelope | undefined;
  }

  claim(id: string): boolean {
    return this.db.prepare("UPDATE chat_agent_messages SET status = 'dispatching', claimed_at = ? WHERE id = ? AND status = 'queued'").run(Date.now(), id).changes === 1;
  }

  finish(id: string, status: ChatEnvelope["status"], error: string | null = null): void {
    this.db.prepare("UPDATE chat_agent_messages SET status = ?, error = ? WHERE id = ? AND status IN ('queued','dispatching','running')").run(status, error, id);
  }

  reconcile(id: string): ChatEnvelope | undefined {
    const row = this.get(id);
    if (!row) return;
    const answer = this.db.prepare("SELECT status FROM conversation_messages WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'").get(row.target_id, chatMessageClientId(id)) as { status: string } | undefined;
    if (answer && answer.status !== "pending") this.finish(id, answer.status === "complete" ? "complete" : answer.status === "aborted" ? "cancelled" : "failed",
      answer.status === "complete" ? null : "The receiving chat stopped or failed. Open that chat for details.");
    return this.get(id);
  }

  receipt(userId: number, sourceId: number, id: string) {
    const row = this.get(id);
    if (!row || row.user_id !== userId || row.source_id !== sourceId) throw new ApiError(404, "chat_message_not_found", "Message not found in this chat's outbox.");
    this.chat(userId, sourceId);
    const target = this.chat(userId, row.target_id);
    const current = this.reconcile(id)!;
    const answer = current.status === "complete" ? this.db.prepare("SELECT content FROM conversation_messages WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'").get(row.target_id, chatMessageClientId(id)) as { content: string } | undefined : undefined;
    // Hermes treats any serialized "error" key as a failed tool, even null.
    // A queued/running/complete receipt is successful; only emit real errors.
    return { messageId: id, chatId: target.public_id, title: target.title, status: current.status,
      answer: answer?.content.slice(0, 24_000) ?? null, answerTruncated: (answer?.content.length ?? 0) > 24_000, ...(current.error ? { error: current.error } : {}) };
  }
}
