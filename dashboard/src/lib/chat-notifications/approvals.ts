import type Database from "better-sqlite3";
import type { ChatNotificationRecord, ChatNotificationTarget } from "../chat-notification-inbox.ts";
import { isRuntimeRunAbandoned } from "../hermes/run-liveness.ts";

// Approval cards as notifications. A turn nobody is watching (a scheduled run,
// a chat left in the background) used to sit on its card until it timed out:
// the card lived only in the chat. Like a runtime question, an approval is now
// recorded here when Hermes raises it and offered in the notification center,
// the toast and the desktop overlay, where Allow / Deny answer it in place.

export function ensureApprovalNotificationSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_approval_notifications (
      id INTEGER PRIMARY KEY,
      runtime_session_id INTEGER NOT NULL REFERENCES hermes_runtime_sessions(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES hermes_runs(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      description TEXT NOT NULL,
      command TEXT,
      allow_session INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(runtime_session_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_approvals_pending
      ON chat_approval_notifications(resolved, dismissed);
  `);
}

// The same chats that get question notifications: not temporary, voice, Buzz
// or phone-delivered ones (a phone turn runs with standing approval).
const NOTIFIABLE_APPROVAL_SQL = `
    AND c.temporary = 0 AND c.buzz_room_id IS NULL
    AND COALESCE(c.origin_label, '') <> 'Voice'
    AND c.surface IN ('dashboard_terminal', 'garden_chat')
`;

export function recordApprovalNotification(database: Database.Database, input: {
  runtimeSessionId: number;
  runId: string;
  requestId: string;
  description: string;
  command?: string;
  allowSession: boolean;
}): void {
  ensureApprovalNotificationSchema(database);
  if (!input.requestId || !input.description.trim()) return;
  database.prepare(`
    INSERT OR IGNORE INTO chat_approval_notifications
      (runtime_session_id, run_id, request_id, description, command, allow_session, created_at)
    SELECT s.id, r.id, @requestId, @description, @command, @allowSession, @createdAt
    FROM hermes_runtime_sessions s
    JOIN hermes_runs r ON r.runtime_session_id = s.id
    JOIN conversations c ON c.id = s.conversation_id AND c.user_id = s.user_id
    WHERE s.id = @runtimeSessionId AND r.id = @runId AND r.status = 'active'
      ${NOTIFIABLE_APPROVAL_SQL}
  `).run({
    runtimeSessionId: input.runtimeSessionId,
    runId: input.runId,
    requestId: input.requestId,
    description: input.description.trim().slice(0, 4_000),
    command: input.command?.slice(0, 4_000) ?? null,
    allowSession: input.allowSession ? 1 : 0,
    createdAt: new Date().toISOString(),
  });
}

/** Answered from the chat or a notification: the card is gone everywhere. */
export function resolveApprovalNotification(database: Database.Database, runtimeSessionId: number, requestId: string): void {
  ensureApprovalNotificationSchema(database);
  database.prepare(`UPDATE chat_approval_notifications SET resolved = 1
    WHERE runtime_session_id = ? AND request_id = ?`).run(runtimeSessionId, requestId);
}

const APPROVAL_SOURCE_SQL = `
  FROM chat_approval_notifications a
  JOIN hermes_runtime_sessions s ON s.id = a.runtime_session_id
  JOIN hermes_runs r ON r.id = a.run_id AND r.runtime_session_id = s.id
  JOIN conversations c ON c.id = s.conversation_id AND c.user_id = s.user_id
  LEFT JOIN clusters g ON g.id = c.default_garden_id
  WHERE c.user_id = @userId
    ${NOTIFIABLE_APPROVAL_SQL}
`;

export function listPendingApprovalNotifications(database: Database.Database, userId: number,
  includeDismissed = false): ChatNotificationRecord[] {
  ensureApprovalNotificationSchema(database);
  const rows = database.prepare(`
    SELECT a.id, a.description, a.command, a.allow_session, a.request_id, a.runtime_session_id, a.created_at,
           c.public_id, c.title, c.surface, c.legacy_chat_session_id, g.slug,
           r.started_at, r.heartbeat_at, r.dispatch_json
    ${APPROVAL_SOURCE_SQL}
      AND a.resolved = 0 ${includeDismissed ? "" : "AND a.dismissed = 0"} AND r.status = 'active'
    ORDER BY a.id ASC
  `).all({ userId }) as Array<{
    id: number; description: string; command: string | null; allow_session: number; request_id: string;
    runtime_session_id: number; created_at: string; public_id: string; title: string;
    surface: "dashboard_terminal" | "garden_chat"; legacy_chat_session_id: number | null;
    slug: string | null; started_at: string; heartbeat_at: string | null; dispatch_json: string;
  }>;
  return rows.filter((row) => !isRuntimeRunAbandoned(row)).flatMap((row) => {
    const target: ChatNotificationTarget | null = row.surface === "garden_chat"
      ? row.legacy_chat_session_id !== null && row.slug
        ? { surface: "garden_chat", chatId: String(row.legacy_chat_session_id), gardenSlug: row.slug, conversationId: row.public_id }
        : null
      : { surface: "dashboard_terminal", chatId: row.public_id };
    const response = row.command ? `${row.description}\n\n\`${row.command}\`` : row.description;
    return target ? [{
      id: `approval_${row.id}`,
      kind: "chat_approval" as const,
      title: "Approval needed" as const,
      type: "success" as const,
      response,
      chatTitle: row.title,
      target,
      approval: {
        sessionId: row.runtime_session_id,
        requestId: row.request_id,
        description: row.description,
        ...(row.command ? { command: row.command } : {}),
        allowSession: row.allow_session === 1,
      },
      updatedAt: row.created_at,
    }] : [];
  });
}

export function approvalNotificationId(id: string): number | null {
  const match = /^approval_(\d{1,15})$/.exec(id);
  const value = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function dismissApprovalNotifications(database: Database.Database, userId: number,
  ids: readonly number[]): number {
  ensureApprovalNotificationSchema(database);
  const dismiss = database.prepare(`
    UPDATE chat_approval_notifications SET dismissed = 1
    WHERE dismissed = 0 AND id = @id AND id IN (SELECT a.id ${APPROVAL_SOURCE_SQL})
  `);
  let count = 0;
  database.transaction(() => {
    for (const id of new Set(ids)) count += dismiss.run({ id, userId }).changes;
  })();
  return count;
}
