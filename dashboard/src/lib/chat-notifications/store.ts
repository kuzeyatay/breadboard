import type Database from "better-sqlite3";
import type {
  ChatNotificationRecord,
  ChatNotificationTarget,
} from "../chat-notification-inbox.ts";

/**
 * Account-scoped state behind the "Response ready" corner notices.
 *
 * Everything that decides whether a notice is shown lives here, in the
 * database, rather than in a browser: the desktop shell opens the dashboard
 * on a fresh loopback port each launch, and a person routinely has the
 * dashboard and a Garden open side by side. Per-origin storage made every
 * window (and every launch) keep its own copy of what had been dismissed,
 * so a notice closed in one place came back from another. With one record
 * per account, a dismissal made anywhere is a dismissal everywhere.
 */

export const MAX_PENDING_CHAT_NOTIFICATIONS = 24;

interface NotificationRow {
  message_id: number;
  content: string;
  status: "complete" | "failed";
  metadata: string | null;
  updated_at: string;
  conversation_public_id: string;
  conversation_title: string;
  surface: "dashboard_terminal" | "garden_chat";
  legacy_chat_session_id: number | null;
  garden_slug: string | null;
}

interface BaselineRow {
  updated_at: string;
  message_id: number;
}

interface DismissalCandidateRow {
  message_id: number;
  conversation_id: number;
  metadata: string | null;
}

/**
 * Only assistant turns of a person's own, on-the-record Terminal and Garden
 * chats become notices. Buzz rooms, temporary chats, and turns originating in
 * Telegram never do. Telegram already delivers its reply in the originating
 * channel; repeating it as a Breadboard corner notice would make one response
 * look like two separate events. The client message id is durable provenance:
 * unlike Telegram's current-chat binding, it survives `/new` and chat rotation.
 */
const NOTIFIABLE_MESSAGES_SQL = `
  FROM conversation_messages m
  JOIN conversations c ON c.id = m.conversation_id
  LEFT JOIN clusters g ON g.id = c.default_garden_id
  WHERE c.user_id = @userId
    AND c.temporary = 0
    AND c.buzz_room_id IS NULL
    AND c.surface IN ('dashboard_terminal', 'garden_chat')
    AND COALESCE(m.client_message_id, '') NOT LIKE 'telegram-%'
    AND m.role = 'assistant'
    AND m.status IN ('complete', 'failed')
    AND NOT COALESCE((
      json_valid(m.metadata)
      AND (
        json_extract(m.metadata, '$.delegatedAgentRun') = 1
        OR json_extract(m.metadata, '$.deliveryChannel') IN ('telegram', 'whatsapp')
      )
    ), 0)
`;

export function ensureChatNotificationSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_notification_baselines (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_notification_dismissals (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id   INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
      dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, message_id)
    );
  `);
}

export function chatNotificationMessageId(id: string): number | null {
  const match = /^msg_(\d{1,15})$/.exec(id.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function externalAgentFailed(metadata: string | null): boolean {
  if (!metadata) return false;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return parsed.externalAgentOutcome === "failed";
  } catch {
    return false;
  }
}

/**
 * Garden selected-text turns can temporarily exist twice while their legacy
 * transcript row is reconciled into the canonical conversation. Both copies
 * carry the stable inline request id, although migrated rows nest it under
 * `toolCalls`. Treat that id as the identity of the answer rather than either
 * database row id.
 */
function inlineSelectionRequestId(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const direct = parsed.inlineSelection;
    const toolCalls = parsed.toolCalls;
    const nested =
      toolCalls && typeof toolCalls === "object" && !Array.isArray(toolCalls)
        ? (toolCalls as Record<string, unknown>).inlineSelection
        : null;
    const selection = direct ?? nested;
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      return null;
    }
    const requestId = (selection as Record<string, unknown>).requestId;
    return typeof requestId === "string" && requestId.trim()
      ? requestId.trim()
      : null;
  } catch {
    return null;
  }
}

function notificationIdentity(row: NotificationRow): string {
  const requestId = inlineSelectionRequestId(row.metadata);
  return requestId
    ? `${row.conversation_public_id}:inline-selection:${requestId}`
    : `message:${row.message_id}`;
}

function inlineSelectionRequestIdSql(alias: string): string {
  return `COALESCE(
    CASE WHEN json_valid(${alias}.metadata)
      THEN json_extract(${alias}.metadata, '$.inlineSelection.requestId') END,
    CASE WHEN json_valid(${alias}.metadata)
      THEN json_extract(${alias}.metadata, '$.toolCalls.inlineSelection.requestId') END
  )`;
}

function notificationFromRow(row: NotificationRow): ChatNotificationRecord | null {
  const target = row.surface === "garden_chat"
    ? row.legacy_chat_session_id !== null && row.garden_slug
      ? {
          surface: "garden_chat" as const,
          chatId: String(row.legacy_chat_session_id),
          gardenSlug: row.garden_slug,
        }
      : null
    : {
        surface: "dashboard_terminal" as const,
        chatId: row.conversation_public_id,
      };
  if (!target) return null;

  const failed = row.status === "failed" || externalAgentFailed(row.metadata);
  const response = row.content.trim() || "The response could not be completed.";
  return {
    id: `msg_${row.message_id}`,
    title: failed ? "Response failed" : "Response ready",
    type: failed ? "error" : "success",
    response,
    chatTitle: row.conversation_title,
    target,
    updatedAt: row.updated_at,
  };
}

/**
 * The first read for an account draws a line under everything that already
 * exists: only answers finished after this point are ever announced. Without
 * it, the first launch after an upgrade would replay a whole chat history as
 * notices.
 */
export function ensureChatNotificationBaseline(
  database: Database.Database,
  userId: number,
): BaselineRow {
  const existing = database.prepare(`
    SELECT updated_at, message_id FROM chat_notification_baselines WHERE user_id = ?
  `).get(userId) as BaselineRow | undefined;
  if (existing) return existing;

  const latest = database.prepare(`
    SELECT m.id AS message_id, m.updated_at
    ${NOTIFIABLE_MESSAGES_SQL}
    ORDER BY m.updated_at DESC, m.id DESC
    LIMIT 1
  `).get({ userId }) as { message_id: number; updated_at: string } | undefined;
  const baseline: BaselineRow = latest
    ? { updated_at: latest.updated_at, message_id: latest.message_id }
    : { updated_at: "", message_id: 0 };
  database.prepare(`
    INSERT OR IGNORE INTO chat_notification_baselines (user_id, updated_at, message_id)
    VALUES (?, ?, ?)
  `).run(userId, baseline.updated_at, baseline.message_id);
  return baseline;
}

/** Every notice the account has not yet dismissed, oldest first. */
export function listPendingChatNotifications(
  database: Database.Database,
  userId: number,
): ChatNotificationRecord[] {
  const baseline = ensureChatNotificationBaseline(database, userId);
  const rows = database.prepare(`
    SELECT m.id AS message_id, m.content, m.status, m.metadata, m.updated_at,
           c.public_id AS conversation_public_id,
           c.title AS conversation_title,
           c.surface,
           c.legacy_chat_session_id,
           g.slug AS garden_slug
    ${NOTIFIABLE_MESSAGES_SQL}
      AND (m.updated_at > @afterAt OR (m.updated_at = @afterAt AND m.id > @afterId))
      AND NOT EXISTS (
        SELECT 1
        FROM chat_notification_dismissals d
        JOIN conversation_messages dismissed_message
          ON dismissed_message.id = d.message_id
        WHERE d.user_id = @userId
          AND (
            d.message_id = m.id
            OR (
              dismissed_message.conversation_id = m.conversation_id
              AND ${inlineSelectionRequestIdSql("m")} IS NOT NULL
              AND ${inlineSelectionRequestIdSql("dismissed_message")}
                = ${inlineSelectionRequestIdSql("m")}
            )
          )
      )
    ORDER BY m.updated_at DESC, m.id DESC
    LIMIT @candidateLimit
  `).all({
    userId,
    afterAt: baseline.updated_at,
    afterId: baseline.message_id,
    // Reconciliation normally creates at most two copies. Leave extra room so
    // duplicates never crowd real notifications out of the bounded inbox.
    candidateLimit: MAX_PENDING_CHAT_NOTIFICATIONS * 4,
  }) as NotificationRow[];

  const seen = new Set<string>();
  const uniqueRows = rows.filter((row) => {
    const identity = notificationIdentity(row);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, MAX_PENDING_CHAT_NOTIFICATIONS);

  return uniqueRows
    .map(notificationFromRow)
    .filter((record): record is ChatNotificationRecord => record !== null)
    .reverse();
}

/** Dismiss specific notices. Ids that do not belong to the account are ignored. */
export function dismissChatNotifications(
  database: Database.Database,
  userId: number,
  messageIds: readonly number[],
): number {
  if (messageIds.length === 0) return 0;
  const selectRequested = database.prepare(`
    SELECT m.id AS message_id, m.conversation_id, m.metadata
    ${NOTIFIABLE_MESSAGES_SQL}
      AND m.id = @messageId
  `);
  const selectConversationAnswers = database.prepare(`
    SELECT id AS message_id, conversation_id, metadata
    FROM conversation_messages
    WHERE conversation_id = ?
      AND role = 'assistant'
      AND status IN ('complete', 'failed')
  `);
  const insert = database.prepare(`
    INSERT OR IGNORE INTO chat_notification_dismissals (user_id, message_id)
    SELECT @userId, m.id
    ${NOTIFIABLE_MESSAGES_SQL}
      AND m.id = @messageId
  `);
  let dismissed = 0;
  const run = database.transaction(() => {
    for (const messageId of new Set(messageIds)) {
      const requested = selectRequested.get({ userId, messageId }) as
        | DismissalCandidateRow
        | undefined;
      if (!requested) continue;

      const requestId = inlineSelectionRequestId(requested.metadata);
      const equivalentIds = requestId
        ? (selectConversationAnswers.all(requested.conversation_id) as DismissalCandidateRow[])
            .filter((candidate) => inlineSelectionRequestId(candidate.metadata) === requestId)
            .map((candidate) => candidate.message_id)
        : [requested.message_id];
      for (const equivalentId of equivalentIds) {
        dismissed += insert.run({ userId, messageId: equivalentId }).changes;
      }
    }
  });
  run();
  return dismissed;
}

/**
 * Mark every finished answer in one chat as seen. Opening a chat, or watching
 * an answer land in the chat already on screen, both come here: a notice is
 * only an invitation to look at something unseen, and this person has now
 * seen it.
 */
export function dismissChatNotificationsForTarget(
  database: Database.Database,
  userId: number,
  target: ChatNotificationTarget,
): number {
  const baseline = ensureChatNotificationBaseline(database, userId);
  const targetSql = target.surface === "garden_chat"
    ? `AND c.legacy_chat_session_id = @legacyChatId AND g.slug = @gardenSlug`
    : `AND c.public_id = @publicId`;
  const legacyChatId = Number(target.chatId);
  if (target.surface === "garden_chat" && !Number.isSafeInteger(legacyChatId)) {
    return 0;
  }
  return database.prepare(`
    INSERT OR IGNORE INTO chat_notification_dismissals (user_id, message_id)
    SELECT @userId, m.id
    ${NOTIFIABLE_MESSAGES_SQL}
      AND (m.updated_at > @afterAt OR (m.updated_at = @afterAt AND m.id > @afterId))
      ${targetSql}
  `).run({
    userId,
    afterAt: baseline.updated_at,
    afterId: baseline.message_id,
    publicId: target.chatId,
    legacyChatId,
    gardenSlug: target.gardenSlug ?? "",
  }).changes;
}
