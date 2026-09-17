import type Database from "better-sqlite3";
import type { ChatNotificationRecord, ChatNotificationTarget } from "../chat-notification-inbox.ts";
import { isRuntimeRunAbandoned } from "../hermes/run-liveness.ts";

/** Questions have their own receipts: reading one must not dismiss the final answer. */
export function ensureQuestionNotificationSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_question_notifications (
      id INTEGER PRIMARY KEY,
      runtime_session_id INTEGER NOT NULL REFERENCES hermes_runtime_sessions(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES hermes_runs(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      question TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(runtime_session_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_questions_pending
      ON chat_question_notifications(resolved, dismissed);
  `);
}

export function recordQuestionNotification(database: Database.Database, input: {
  runtimeSessionId: number;
  runId: string;
  requestId: string;
  question: string;
  choices: string[];
}): void {
  ensureQuestionNotificationSchema(database);
  if (!input.question.trim() || !input.requestId) return;
  const question = [input.question.trim(), ...input.choices.map(choice => `• ${choice}`)].join("\n\n");
  // Replayed events retain the original receipt and cannot revive a closed question.
  database.prepare(`
    INSERT OR IGNORE INTO chat_question_notifications
      (runtime_session_id, run_id, request_id, question, created_at)
    SELECT s.id, r.id, @requestId, @question, @createdAt
    FROM hermes_runtime_sessions s
    JOIN hermes_runs r ON r.runtime_session_id = s.id
    JOIN conversations c ON c.id = s.conversation_id AND c.user_id = s.user_id
    WHERE s.id = @runtimeSessionId AND r.id = @runId AND r.status = 'active'
      ${NOTIFIABLE_QUESTION_SQL}
  `).run({ runtimeSessionId: input.runtimeSessionId, runId: input.runId,
    requestId: input.requestId, question, createdAt: new Date().toISOString() });
}

export function resolveQuestionNotification(database: Database.Database, runtimeSessionId: number, requestId: string): void {
  ensureQuestionNotificationSchema(database);
  database.prepare(`UPDATE chat_question_notifications SET resolved = 1
    WHERE runtime_session_id = ? AND request_id = ?`).run(runtimeSessionId, requestId);
}

const NOTIFIABLE_QUESTION_SQL = `
    AND c.temporary = 0 AND c.buzz_room_id IS NULL
    AND COALESCE(c.origin_label, '') <> 'Voice'
    AND c.surface IN ('dashboard_terminal', 'garden_chat')
    AND NOT EXISTS (
      SELECT 1 FROM conversation_messages m
      WHERE m.conversation_id = c.id
        AND m.client_message_id = json_extract(CASE WHEN json_valid(r.dispatch_json) THEN r.dispatch_json ELSE '{}' END, '$.clientMessageId')
        AND (m.client_message_id LIKE 'telegram-%'
          OR COALESCE(json_extract(CASE WHEN json_valid(m.metadata) THEN m.metadata ELSE '{}' END, '$.deliveryChannel'), '') IN ('telegram', 'whatsapp')
          OR COALESCE(json_extract(CASE WHEN json_valid(m.metadata) THEN m.metadata ELSE '{}' END, '$.delegatedAgentRun'), 0) = 1)
    )
`;

const QUESTION_SOURCE_SQL = `
  FROM chat_question_notifications q
  JOIN hermes_runtime_sessions s ON s.id = q.runtime_session_id
  JOIN hermes_runs r ON r.id = q.run_id AND r.runtime_session_id = s.id
  JOIN conversations c ON c.id = s.conversation_id AND c.user_id = s.user_id
  LEFT JOIN clusters g ON g.id = c.default_garden_id
  WHERE c.user_id = @userId
    ${NOTIFIABLE_QUESTION_SQL}
`;

export function listPendingQuestionNotifications(database: Database.Database, userId: number): ChatNotificationRecord[] {
  ensureQuestionNotificationSchema(database);
  const rows = database.prepare(`
    SELECT q.id, q.question, q.created_at, c.public_id, c.title, c.surface,
           c.legacy_chat_session_id, g.slug, r.started_at, r.heartbeat_at
    ${QUESTION_SOURCE_SQL}
      AND q.resolved = 0 AND q.dismissed = 0 AND r.status = 'active'
    ORDER BY q.id ASC
  `).all({ userId }) as Array<{
    id: number; question: string; created_at: string; public_id: string; title: string;
    surface: 'dashboard_terminal' | 'garden_chat'; legacy_chat_session_id: number | null;
    slug: string | null; started_at: string; heartbeat_at: string | null;
  }>;
  return rows.filter(row => !isRuntimeRunAbandoned(row)).flatMap(row => {
    const target: ChatNotificationTarget | null = row.surface === 'garden_chat'
      ? row.legacy_chat_session_id !== null && row.slug
        ? { surface: 'garden_chat', chatId: String(row.legacy_chat_session_id), gardenSlug: row.slug, conversationId: row.public_id }
        : null
      : { surface: 'dashboard_terminal', chatId: row.public_id };
    return target ? [{ id: `question_${row.id}`, kind: 'chat_question' as const,
      title: 'Answer needed' as const, type: 'success' as const, response: row.question,
      chatTitle: row.title, target, updatedAt: row.created_at }] : [];
  });
}

export function questionNotificationId(id: string): number | null {
  const match = /^question_(\d{1,15})$/.exec(id);
  const value = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function dismissQuestionNotifications(database: Database.Database, userId: number,
  ids: readonly number[], target?: ChatNotificationTarget | null): number {
  ensureQuestionNotificationSchema(database);
  const dismiss = database.prepare(`
    UPDATE chat_question_notifications SET dismissed = 1
    WHERE dismissed = 0 AND id IN (
      SELECT q.id ${QUESTION_SOURCE_SQL}
        AND (q.id = @id OR (@id IS NULL AND (
          (@surface = 'dashboard_terminal' AND c.public_id = @chatId)
          OR (@surface = 'garden_chat' AND c.legacy_chat_session_id = @chatId AND g.slug = @gardenSlug)
        )))
    )
  `);
  let count = 0;
  database.transaction(() => {
    for (const id of [...new Set(ids), ...(target ? [null] : [])]) {
      count += dismiss.run({ userId, id, surface: target?.surface ?? '',
        chatId: target?.chatId ?? '', gardenSlug: target?.gardenSlug ?? '' }).changes;
    }
  })();
  return count;
}
