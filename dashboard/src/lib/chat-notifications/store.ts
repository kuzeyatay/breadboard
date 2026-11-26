import type Database from "better-sqlite3";
import { notificationMessageKeys } from '../chat-notification-visibility.ts';
import type { UnreadChatRecord } from "../conversations/unread.ts";
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
  client_message_id: string | null;
  content: string;
  status: "complete" | "failed";
  metadata: string | null;
  updated_at: string;
  conversation_public_id: string;
  conversation_title: string;
  origin_label: string | null;
  prompt: string | null;
  surface: "dashboard_terminal" | "garden_chat";
  legacy_chat_session_id: number | null;
  garden_slug: string | null;
  follow_up?: number | null;
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

const MESSAGE_METADATA_SQL = `(CASE WHEN json_valid(m.metadata) THEN m.metadata ELSE '{}' END)`;
// Reconciled Garden messages can retain their verification under toolCalls.
const EXTERNAL_AGENTS_SQL = `(CASE
  WHEN json_type(${MESSAGE_METADATA_SQL}, '$.verification.externalAgents') = 'array'
    THEN json_extract(${MESSAGE_METADATA_SQL}, '$.verification.externalAgents')
  WHEN json_type(${MESSAGE_METADATA_SQL}, '$.toolCalls.verification.externalAgents') = 'array'
    THEN json_extract(${MESSAGE_METADATA_SQL}, '$.toolCalls.verification.externalAgents')
  ELSE '[]'
END)`;
const MESSAGE_WHITESPACE_SQL = `char(9, 10, 11, 12, 13, 32, 160, 65279)`;

/**
 * Only assistant turns of a person's own, on-the-record Terminal and Garden
 * chats become notices. Buzz rooms, temporary chats, and turns originating in
 * Telegram or Voice never do. Voice delivers the answer in its own spoken
 * conversation, including when that window has just closed. Telegram already
 * delivers its reply in the originating
 * channel; repeating it as a Breadboard corner notice would make one response
 * look like two separate events. The client message id is durable provenance:
 * unlike Telegram's current-chat binding, it survives `/new` and chat rotation.
 *
 * A complete model turn can still be a hand-off while workers are running.
 * Match assistantHandoffContent's distinction between launch-only provenance
 * and carried results, and wait for directly launched workers to finish too.
 * Apply this before limits, baselines, and dismissals so progress cannot crowd
 * out an answer or mark a worker's eventual result as already seen.
 */
const READABLE_MESSAGES_SQL = `
  FROM conversation_messages m
  JOIN conversations c ON c.id = m.conversation_id
  LEFT JOIN clusters g ON g.id = c.default_garden_id
  WHERE c.user_id = @userId
    AND c.temporary = 0
    AND c.buzz_room_id IS NULL
    AND m.role = 'assistant'
    AND m.status IN ('complete', 'failed')
    AND NOT COALESCE((
      json_extract(${MESSAGE_METADATA_SQL}, '$.delegatedAgentRun') = 1
      OR json_extract(${MESSAGE_METADATA_SQL}, '$.deliveryChannel') IN ('telegram', 'whatsapp')
    ), 0)
    AND (
      m.status = 'failed'
      OR json_extract(${MESSAGE_METADATA_SQL}, '$.externalAgentOutcome') = 'failed'
      OR (
        trim(m.content, ${MESSAGE_WHITESPACE_SQL}) <> ''
        AND COALESCE(json_extract(${MESSAGE_METADATA_SQL}, '$.externalAgentOutcome'), '')
          NOT IN ('running', 'aborted')
        AND trim(m.content, ${MESSAGE_WHITESPACE_SQL}) <>
          trim(COALESCE(json_extract(${MESSAGE_METADATA_SQL}, '$.delegatedAgentPreamble'), ''), ${MESSAGE_WHITESPACE_SQL})
        AND (
          json_array_length(${EXTERNAL_AGENTS_SQL}) = 0
          OR EXISTS (
            SELECT 1 FROM json_each(${EXTERNAL_AGENTS_SQL}) agent
            WHERE CASE WHEN agent.type = 'object'
              THEN json_type(agent.value, '$.carried') = 'true' ELSE 0 END
          )
        )
      )
    )
`;

const NOTIFIABLE_SOURCES_SQL = `
    AND COALESCE(c.origin_label, '') <> 'Voice'
    AND c.surface IN ('dashboard_terminal', 'garden_chat')
    AND COALESCE(m.client_message_id, '') NOT LIKE 'telegram-%'
`;
/**
 * A failed attempt that an automatic retry is already redoing, or has fixed,
 * is not news: the arXiv briefing's failed scheduled run and failed first
 * retry each raised "Response failed" above the answer that followed. The
 * retry's own failure still notifies.
 */
const RETRIED_FAILURE_SQL = `
    AND NOT (m.status = 'failed' AND EXISTS (
      SELECT 1 FROM conversation_messages retry
      WHERE retry.conversation_id = m.conversation_id AND retry.role = 'assistant'
        AND retry.id > m.id AND retry.client_message_id LIKE 'recovery:%'
        AND retry.status IN ('pending', 'complete')
    ))
`;
const NOTIFIABLE_MESSAGES_SQL = `${READABLE_MESSAGES_SQL}${NOTIFIABLE_SOURCES_SQL}${RETRIED_FAILURE_SQL}`;

/**
 * A retry that follows an answer the person already received is a follow-up,
 * not a replacement; its notice says so instead of repeating "Response ready"
 * under the same request heading.
 */
const FOLLOW_UP_SQL = `
      (COALESCE(m.client_message_id, '') LIKE 'recovery:%' AND EXISTS (
        SELECT 1 FROM conversation_messages earlier
        WHERE earlier.conversation_id = m.conversation_id AND earlier.role = 'assistant'
          AND earlier.status = 'complete' AND earlier.id < m.id AND trim(earlier.content) <> ''
          AND earlier.id > COALESCE((SELECT max(asked.id) FROM conversation_messages asked
            WHERE asked.conversation_id = m.conversation_id AND asked.role = 'user' AND asked.id < m.id
              AND COALESCE(json_extract(asked.metadata, '$.internalAgentContinuation'), 0) <> 1), 0)
      )) AS follow_up`;

/**
 * Every window polls the inbox every few seconds. Without this narrowing,
 * SQLite applies the JSON filters above to every answer ever dismissed before
 * reaching the dismissal check, and reading `updated_at` walks each row's
 * multi-megabyte `metadata` overflow chain — about a second of the dashboard's
 * only thread per poll. Answers dismissed by id are excluded from the index
 * alone; dismissed inline-selection copies are excluded by
 * UNDISMISSED_EQUIVALENT_SQL.
 */
const UNDISMISSED_ANSWER_SQL = `
      AND m.id IN (
        SELECT answer.id FROM conversation_messages answer
        WHERE answer.role = 'assistant' AND answer.status IN ('complete', 'failed')
          AND NOT EXISTS (
            SELECT 1 FROM chat_notification_dismissals d
            WHERE d.user_id = @userId AND d.message_id = answer.id
          )
      )`;

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

    CREATE TABLE IF NOT EXISTS chat_unread_baselines (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL,
      message_id INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_messages_answers
      ON conversation_messages(role, status);
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

function notificationIdentity(row: Pick<NotificationRow, "metadata" | "conversation_public_id" | "message_id">): string {
  const requestId = inlineSelectionRequestId(row.metadata);
  return requestId
    ? `${row.conversation_public_id}:inline-selection:${requestId}`
    : `message:${row.message_id}`;
}

/** Stable across the legacy/canonical copies of a selected-text answer. */
export function chatNotificationDeliveryId(database: Database.Database, userId: number, id: string): string {
  const messageId = chatNotificationMessageId(id);
  if (messageId === null) return id;
  const row = database.prepare(`
    SELECT m.id AS message_id, m.metadata, c.public_id AS conversation_public_id
    FROM conversation_message_reads m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = ? AND c.user_id = ?
  `).get(messageId, userId) as Pick<NotificationRow, "metadata" | "conversation_public_id" | "message_id"> | undefined;
  return row ? notificationIdentity(row) : id;
}

/**
 * The open Ask Here popup that shows this answer. Chat Ask Here saves only
 * `textSelection` (mode "inline"); its id is the popup's notification id.
 * Deliberately not used for the dismissal grouping: one popup holds many turns.
 */
function viewingSelectionId(metadata: string | null): string | null {
  const direct = inlineSelectionRequestId(metadata);
  if (direct || !metadata) return direct;
  try {
    const selection = (JSON.parse(metadata) as Record<string, unknown>).textSelection as Record<string, unknown> | undefined;
    return selection?.mode === "inline" && typeof selection.id === "string" && selection.id.trim() ? selection.id.trim() : null;
  } catch {
    return null;
  }
}

function inlineSelectionRequestIdSql(alias: string): string {
  return `COALESCE(
    CASE WHEN json_valid(${alias}.metadata)
      THEN json_extract(${alias}.metadata, '$.inlineSelection.requestId') END,
    CASE WHEN json_valid(${alias}.metadata)
      THEN json_extract(${alias}.metadata, '$.toolCalls.inlineSelection.requestId') END
  )`;
}

/** With UNDISMISSED_ANSWER_SQL: no dismissed copy of the same inline-selection answer. */
const UNDISMISSED_EQUIVALENT_SQL = `AND (${inlineSelectionRequestIdSql("m")} IS NULL OR NOT EXISTS (
        SELECT 1 FROM conversation_messages seen
        JOIN chat_notification_dismissals d ON d.user_id = @userId AND d.message_id = seen.id
        WHERE seen.conversation_id = m.conversation_id
          AND ${inlineSelectionRequestIdSql("seen")} = ${inlineSelectionRequestIdSql("m")}
      ))`;

function messageKeys(row: Pick<NotificationRow, 'message_id' | 'client_message_id' | 'metadata'>): string[] {
  let entryId: string | undefined;
  try { entryId = JSON.parse(row.metadata ?? '{}').documentAssistant?.entryId; } catch { /* legacy metadata */ }
  return notificationMessageKeys({ id: row.message_id, clientMessageId: row.client_message_id,
    entryId: typeof entryId === 'string' ? entryId : undefined });
}

/** Messaging chats say which channel; Breadboard chats show the prompt that was answered. */
function noticeHeading(row: Pick<NotificationRow, "origin_label" | "prompt" | "conversation_title">): string {
  if (row.origin_label === "Telegram" || row.origin_label === "WhatsApp") return row.origin_label;
  const prompt = (row.prompt ?? "").replace(/^\s*\/[a-z0-9:_-]+\s*/i, "").replace(/\s+/g, " ").trim();
  return prompt || row.conversation_title;
}

function notificationFromRow(row: NotificationRow): ChatNotificationRecord | null {
  const target = row.surface === "garden_chat" && row.legacy_chat_session_id !== null && row.garden_slug
      ? {
          surface: "garden_chat" as const,
          chatId: String(row.legacy_chat_session_id),
          gardenSlug: row.garden_slug,
          conversationId: row.conversation_public_id,
        }
    : {
        surface: "dashboard_terminal" as const,
        chatId: row.conversation_public_id,
      };
  if (!target) return null;

  const failed = row.status === "failed" || externalAgentFailed(row.metadata);
  const response = row.content.trim() || "The response could not be completed.";
  const inlineSelectionId = viewingSelectionId(row.metadata);
  return {
    id: `msg_${row.message_id}`,
    messageKeys: messageKeys(row),
    ...(inlineSelectionId ? { inlineSelectionId } : {}),
    title: failed ? "Response failed" : row.follow_up ? "Follow-up ready" : "Response ready",
    type: failed ? "error" : "success",
    response,
    chatTitle: noticeHeading(row),
    target,
    updatedAt: row.updated_at,
  };
}

/** Recent eligible answers for the center's initial history, including answers
 * already read. Restrict candidates before loading potentially large metadata. */
export function listRecentChatNotifications(database: Database.Database, userId: number): ChatNotificationRecord[] {
  const rows = database.prepare(`
    SELECT m.id AS message_id,m.client_message_id,m.content,m.status,m.metadata,m.updated_at,
      c.public_id AS conversation_public_id,c.title AS conversation_title,c.origin_label,
      (SELECT substr(u.content, 1, 400) FROM conversation_messages u
        WHERE u.conversation_id = m.conversation_id AND u.role = 'user' AND u.id < m.id
        ORDER BY u.id DESC LIMIT 1) AS prompt,c.surface,
      c.legacy_chat_session_id,g.slug AS garden_slug,${FOLLOW_UP_SQL}
    ${NOTIFIABLE_MESSAGES_SQL}
      AND m.id IN (SELECT recent.id FROM conversation_message_reads recent
        JOIN conversations owner ON owner.id=recent.conversation_id
        WHERE owner.user_id=@userId AND owner.temporary=0 AND owner.buzz_room_id IS NULL
          AND recent.role='assistant' AND recent.status IN ('complete','failed')
        ORDER BY recent.id DESC LIMIT 100)
    ORDER BY m.id DESC LIMIT 50
  `).all({userId}) as NotificationRow[];
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const identity = notificationIdentity(row);
    if (seen.has(identity)) return [];
    seen.add(identity);
    const item = notificationFromRow(row);
    return item ? [item] : [];
  });
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
    SELECT m.id AS message_id, m.client_message_id, m.content, m.status, m.metadata, m.updated_at,
           c.public_id AS conversation_public_id,
           c.title AS conversation_title,
           c.origin_label,
      (SELECT substr(u.content, 1, 400) FROM conversation_messages u
        WHERE u.conversation_id = m.conversation_id AND u.role = 'user' AND u.id < m.id
        ORDER BY u.id DESC LIMIT 1) AS prompt,
           c.surface,
           c.legacy_chat_session_id,
           g.slug AS garden_slug,${FOLLOW_UP_SQL}
    ${NOTIFIABLE_MESSAGES_SQL}${UNDISMISSED_ANSWER_SQL}
      AND (m.updated_at > @afterAt OR (m.updated_at = @afterAt AND m.id > @afterId))
      ${UNDISMISSED_EQUIVALENT_SQL}
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
    FROM conversation_message_reads
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

/** Unread indicators are not capped by the number of corner notification cards. */
export function listUnreadChatMessages(database: Database.Database, userId: number): UnreadChatRecord[] {
  const notificationBaseline = ensureChatNotificationBaseline(database, userId);
  let baseline = database.prepare(
    "SELECT updated_at, message_id FROM chat_unread_baselines WHERE user_id = ?",
  ).get(userId) as BaselineRow | undefined;
  if (!baseline) {
    // Newly covered surfaces have no prior read receipts. Baseline their old
    // history, while retaining existing corner-inbox answers in the query below.
    baseline = database.prepare(`
      SELECT m.updated_at, m.id AS message_id ${READABLE_MESSAGES_SQL}
      ORDER BY m.updated_at DESC, m.id DESC LIMIT 1
    `).get({ userId }) as BaselineRow | undefined ?? { updated_at: "", message_id: 0 };
    database.prepare("INSERT OR IGNORE INTO chat_unread_baselines (user_id, updated_at, message_id) VALUES (?, ?, ?)")
      .run(userId, baseline.updated_at, baseline.message_id);
  }
  const rows = database.prepare(`
    SELECT m.id AS message_id, m.client_message_id, m.metadata, c.public_id, c.legacy_chat_session_id, g.slug AS garden_slug
    ${READABLE_MESSAGES_SQL}${UNDISMISSED_ANSWER_SQL}
      AND (
        m.updated_at > @afterAt OR (m.updated_at = @afterAt AND m.id > @afterId)
        OR (1 = 1 ${NOTIFIABLE_SOURCES_SQL}
          AND (m.updated_at > @notificationAfterAt OR (m.updated_at = @notificationAfterAt AND m.id > @notificationAfterId)))
      )
      ${UNDISMISSED_EQUIVALENT_SQL}
  `).all({ userId, afterAt: baseline.updated_at, afterId: baseline.message_id,
    notificationAfterAt: notificationBaseline.updated_at, notificationAfterId: notificationBaseline.message_id }) as Array<{
    message_id: number; client_message_id: string | null; metadata: string | null; public_id: string; legacy_chat_session_id: number | null; garden_slug: string | null;
  }>;
  return rows.map(row => ({
    id: `msg_${row.message_id}`,
    messageKeys: messageKeys(row),
    ...(viewingSelectionId(row.metadata) ? { inlineSelectionId: viewingSelectionId(row.metadata)! } : {}),
    target: row.legacy_chat_session_id !== null && row.garden_slug
      ? { surface: "garden_chat", chatId: String(row.legacy_chat_session_id), gardenSlug: row.garden_slug, conversationId: row.public_id }
      : { surface: "dashboard_terminal", chatId: row.public_id },
  }));
}

/** Reading state also covers chat surfaces that deliberately do not send toasts. */
export function resolveViewedChatMessages(database: Database.Database, userId: number,
  target: ChatNotificationTarget, keys: readonly string[]): { ids: number[]; acknowledged: string[] } {
  if (target.surface === 'garden_learn' || !keys.length) return { ids: [], acknowledged: [] };
  const rows = database.prepare(`
    SELECT m.id AS message_id, m.client_message_id, m.metadata
    ${READABLE_MESSAGES_SQL}
      AND m.conversation_id IN (
        SELECT tc.id FROM conversations tc LEFT JOIN clusters tg ON tg.id = tc.default_garden_id
        WHERE (@publicId IS NOT NULL AND tc.public_id = @publicId)
          OR (@legacyId IS NOT NULL AND tc.legacy_chat_session_id = @legacyId AND tg.slug = @gardenSlug)
      )
      AND (m.id IN (SELECT value FROM json_each(@messageIds))
        OR m.client_message_id IN (SELECT value FROM json_each(@clientIds))
        OR CASE WHEN json_valid(m.metadata) THEN json_extract(m.metadata, '$.documentAssistant.entryId') END
          IN (SELECT value FROM json_each(@entryIds)))
  `).all({ userId, publicId: target.surface === 'dashboard_terminal' ? target.chatId : null,
    legacyId: target.surface === 'garden_chat' ? Number(target.chatId) : null, gardenSlug: target.gardenSlug ?? null,
    messageIds: JSON.stringify(keys.filter(key => /^message:\d+$/.test(key)).map(key => Number(key.slice(8)))),
    clientIds: JSON.stringify(keys.filter(key => key.startsWith('client:')).map(key => key.slice(7))),
    entryIds: JSON.stringify(keys.filter(key => key.startsWith('entry:')).map(key => key.slice(6))),
  }) as Pick<NotificationRow, 'message_id' | 'client_message_id' | 'metadata'>[];
  return { ids: rows.map(row => row.message_id),
    acknowledged: [...new Set(rows.flatMap(messageKeys))].filter(key => keys.includes(key)) };
}

/** Reading state also covers chat surfaces that deliberately do not send toasts. */
export function markUnreadChatMessagesSeen(
  database: Database.Database, userId: number, messageIds: readonly number[], target?: ChatNotificationTarget | null,
): number {
  if (target?.surface === "garden_learn") target = null;
  // Two shapes so each is an index seek. One `id = ? OR target` statement
  // hid both keys inside an OR and ran the JSON readability checks over every
  // message the person has: seconds per id on a large database.
  const insertSelect = `
    INSERT OR IGNORE INTO chat_notification_dismissals (user_id, message_id)
    SELECT @userId, m.id ${READABLE_MESSAGES_SQL}`;
  const insertMessage = database.prepare(`${insertSelect} AND m.id = @messageId`);
  const insertTarget = database.prepare(`${insertSelect}
      AND m.conversation_id IN (
        SELECT tc.id FROM conversations tc
        LEFT JOIN clusters tg ON tg.id = tc.default_garden_id
        WHERE (@publicId IS NOT NULL AND tc.public_id = @publicId)
           OR (@legacyId IS NOT NULL AND tc.legacy_chat_session_id = @legacyId AND tg.slug = @gardenSlug)
      )
  `);
  const params = {
    userId,
    publicId: target?.surface === "dashboard_terminal" ? target.chatId : null,
    legacyId: target?.surface === "garden_chat" ? Number(target.chatId) : null,
    gardenSlug: target?.gardenSlug ?? null,
  };
  return database.transaction(() => {
    let changed = 0;
    if (target) changed += insertTarget.run(params).changes;
    for (const messageId of new Set(messageIds)) changed += insertMessage.run({ userId, messageId }).changes;
    return changed;
  })();
}
