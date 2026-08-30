import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { isChatHighlight } from "./highlights.ts";
import { removeConversationModelBlobs } from "./model-uploads.ts";
import { removeConversationVideoBlobs } from "./video-uploads.ts";
import { removeConversationAudioBlobs } from "./audio-uploads.ts";
import db from "../db.ts";
import { scrubbed } from "../watermarks/scrub-text.ts";
import type { HermesSurface } from "../hermes/config.ts";

export type ConversationScopeKind = "global" | "garden" | "page";
export type ConversationMessageStatus = "pending" | "complete" | "failed" | "aborted";

export interface ConversationRow {
  id: number;
  public_id: string;
  user_id: number;
  title: string;
  surface: HermesSurface;
  scope_kind: ConversationScopeKind;
  default_garden_id: number | null;
  active_agency_agent_slug: string | null;
  legacy_chat_session_id: number | null;
  legacy_runtime_session_id: number | null;
  next_order_index: number;
  pinned_at: string | null;
  highlight: string | null;
  /** 1 for an off-the-record chat. See `conversationIsTemporary`. */
  temporary: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessageRow {
  id: number;
  conversation_id: number;
  client_message_id: string;
  role: "user" | "assistant";
  surface: HermesSurface;
  content: string;
  status: ConversationMessageStatus;
  order_index: number;
  metadata: string | null;
  sources: string | null;
  token_usage: string | null;
  created_at: string;
  updated_at: string;
}

export interface PresentedConversationMessage {
  id: string;
  clientMessageId: string;
  role: "user" | "assistant";
  surface: HermesSurface;
  content: string;
  status: ConversationMessageStatus;
  orderIndex: number;
  metadata: Record<string, unknown>;
  sources: unknown;
  usage: unknown;
  createdAt: string;
  updatedAt: string;
}

export class ConversationStoreError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConversationStoreError";
    this.status = status;
    this.code = code;
  }
}

export interface CreateConversationInput {
  userId: number;
  title?: string;
  surface?: HermesSurface;
  scopeKind?: ConversationScopeKind;
  defaultGardenId?: number | null;
  /** Off the record: hidden from history and invisible to memory, for good. */
  temporary?: boolean;
}

export function createConversation(
  input: CreateConversationInput,
  database: Database.Database = db,
): ConversationRow {
  const publicId = `conv_${crypto.randomBytes(18).toString("base64url")}`;
  const result = database.prepare(`
    INSERT INTO conversations(public_id, user_id, title, surface, scope_kind, default_garden_id, temporary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    publicId,
    input.userId,
    normalizeTitle(input.title),
    input.surface ?? "dashboard_terminal",
    input.scopeKind ?? "global",
    input.defaultGardenId ?? null,
    input.temporary ? 1 : 0,
  );
  const id = Number(result.lastInsertRowid);
  database.prepare("INSERT INTO conversation_memory_state(conversation_id) VALUES (?)").run(id);
  return getConversationById(id, database)!;
}

export function getConversationById(
  id: number,
  database: Database.Database = db,
): ConversationRow | null {
  return (database.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined) ?? null;
}

export function getConversationForUser(
  publicId: string,
  userId: number,
  database: Database.Database = db,
): ConversationRow {
  const row = database.prepare(`
    SELECT * FROM conversations WHERE public_id = ? AND user_id = ?
  `).get(publicId, userId) as ConversationRow | undefined;
  if (!row) {
    // Intentionally identical for missing and foreign conversations.
    throw new ConversationStoreError(404, "conversation_not_found", "Conversation not found.");
  }
  return row;
}

export function getConversationForLegacyChatSession(
  chatSessionId: number,
  userId: number,
  database: Database.Database = db,
): ConversationRow {
  const row = database.prepare(`
    SELECT c.* FROM conversations c
    JOIN chat_sessions cs ON cs.conversation_id = c.id
    WHERE cs.id = ? AND cs.user_id = ? AND c.user_id = ? AND c.surface = 'garden_chat'
  `).get(chatSessionId, userId, userId) as ConversationRow | undefined;
  if (!row) throw new ConversationStoreError(404, "conversation_not_found", "Conversation not found.");
  return row;
}

/**
 * Bind the legacy Garden workspace chat row to the canonical conversation
 * store at creation/use time. Process-start backfills remain useful for old
 * data, but a newly created chat must never depend on a later module reload
 * before its first turn can run.
 */
export function ensureConversationForLegacyChatSession(
  chatSessionId: number,
  userId: number,
  database: Database.Database = db,
): ConversationRow {
  const ensure = database.transaction(() => {
    const session = database.prepare(`
      SELECT id, user_id, cluster_id, title, conversation_id, created_at, updated_at
      FROM chat_sessions
      WHERE id = ? AND user_id = ?
    `).get(chatSessionId, userId) as {
      id: number;
      user_id: number;
      cluster_id: number;
      title: string;
      conversation_id: number | null;
      created_at: string;
      updated_at: string;
    } | undefined;
    if (!session) {
      throw new ConversationStoreError(
        404,
        "conversation_not_found",
        "Conversation not found.",
      );
    }

    if (session.conversation_id !== null) {
      const linked = getConversationById(session.conversation_id, database);
      if (
        linked &&
        linked.user_id === userId &&
        linked.surface === "garden_chat"
      ) {
        return linked;
      }
      throw new ConversationStoreError(
        409,
        "conversation_scope_mismatch",
        "The Garden conversation link is invalid.",
      );
    }

    const existing = database.prepare(`
      SELECT * FROM conversations
      WHERE legacy_chat_session_id = ? AND user_id = ? AND surface = 'garden_chat'
    `).get(chatSessionId, userId) as ConversationRow | undefined;
    if (existing) {
      database.prepare(
        "UPDATE chat_sessions SET conversation_id = ? WHERE id = ?",
      ).run(existing.id, chatSessionId);
      database.prepare(
        "INSERT OR IGNORE INTO conversation_memory_state(conversation_id) VALUES (?)",
      ).run(existing.id);
      return existing;
    }

    const publicId = `conv_${crypto.randomBytes(18).toString("base64url")}`;
    const result = database.prepare(`
      INSERT INTO conversations
        (public_id, user_id, title, surface, scope_kind, default_garden_id,
         legacy_chat_session_id, created_at, updated_at)
      VALUES (?, ?, ?, 'garden_chat', 'garden', ?, ?, ?, ?)
    `).run(
      publicId,
      userId,
      normalizeTitle(session.title),
      session.cluster_id,
      session.id,
      session.created_at,
      session.updated_at,
    );
    const conversationId = Number(result.lastInsertRowid);
    database.prepare(
      "UPDATE chat_sessions SET conversation_id = ? WHERE id = ?",
    ).run(conversationId, session.id);
    database.prepare(
      "INSERT INTO conversation_memory_state(conversation_id) VALUES (?)",
    ).run(conversationId);
    return getConversationById(conversationId, database)!;
  });

  return ensure();
}

/**
 * Whether this chat is off the record.
 *
 * One predicate for every caller: the flag is stored as SQLite's 0/1 integer,
 * and a row read before the column existed can still arrive as null/undefined
 * from an old cached shape, which must read as "not temporary" rather than
 * throw.
 */
export function conversationIsTemporary(
  conversation: Pick<ConversationRow, "temporary"> | null | undefined,
): boolean {
  return Number(conversation?.temporary ?? 0) === 1;
}

export function listConversationsForUser(
  userId: number,
  database: Database.Database = db,
): ConversationRow[] {
  // Pinned chats sort first so an old-but-pinned conversation survives the
  // limit. The sidebar re-groups them; this only guarantees they are present.
  //
  // Temporary chats are excluded here rather than at each rail: this is the one
  // query behind history and restore-after-reload, so leaving them out is what
  // makes "it will not appear in your history" true even for the tab that
  // created it.
  //
  // A conversation carrying a Buzz room id is an agent member's private
  // thinking for one room, not a chat this account started. It is excluded for
  // the same reason and in the same place: this is the only query that decides
  // what "my chats" contains.
  return database.prepare(`
    SELECT * FROM conversations
    WHERE user_id = ? AND temporary = 0 AND buzz_room_id IS NULL
    ORDER BY (pinned_at IS NOT NULL) DESC, updated_at DESC, id DESC
    LIMIT 100
  `).all(userId) as ConversationRow[];
}

/**
 * Rename without bumping updated_at: renaming a chat is not activity, and
 * Recents is ordered by activity.
 */
export function renameConversation(
  conversation: ConversationRow,
  title: string,
  database: Database.Database = db,
): ConversationRow {
  const next = normalizeTitle(title);
  database.prepare("UPDATE conversations SET title = ? WHERE id = ?")
    .run(next, conversation.id);
  if (conversation.legacy_chat_session_id !== null) {
    database.prepare("UPDATE chat_sessions SET title = ? WHERE id = ?")
      .run(next, conversation.legacy_chat_session_id);
  }
  return getConversationById(conversation.id, database)!;
}

export function setConversationPinned(
  conversation: ConversationRow,
  pinned: boolean,
  database: Database.Database = db,
): ConversationRow {
  database.prepare(`
    UPDATE conversations
    SET pinned_at = CASE WHEN ? = 1 THEN COALESCE(pinned_at, datetime('now')) ELSE NULL END
    WHERE id = ?
  `).run(pinned ? 1 : 0, conversation.id);
  return getConversationById(conversation.id, database)!;
}

/**
 * Mark a chat with one of the palette colors, or clear it with null.
 *
 * Like pinning, this is a sidebar affordance rather than activity, so it leaves
 * updated_at alone: highlighting a months-old chat must not drag it back to the
 * top of Recents.
 */
export function setConversationHighlight(
  conversation: ConversationRow,
  highlight: string | null,
  database: Database.Database = db,
): ConversationRow {
  database.prepare("UPDATE conversations SET highlight = ? WHERE id = ?")
    .run(highlight, conversation.id);
  return getConversationById(conversation.id, database)!;
}

export function updateConversation(
  conversation: ConversationRow,
  input: {
    title?: string;
    scopeKind?: ConversationScopeKind;
    defaultGardenId?: number | null;
    activeAgencyAgentSlug?: string | null;
  },
  database: Database.Database = db,
): ConversationRow {
  // Callers hold their row across awaits, so its fields can predate a rename
  // (or any other edit) that landed mid-turn. Unspecified columns default to
  // the live row rather than the snapshot: this writes only what the caller
  // means to change instead of quietly restoring what it happened to see.
  const current = getConversationById(conversation.id, database) ?? conversation;
  const title =
    input.title === undefined ? current.title : normalizeTitle(input.title);
  database.prepare(`
    UPDATE conversations
    SET title = ?, scope_kind = ?, default_garden_id = ?,
        active_agency_agent_slug = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title,
    input.scopeKind ?? current.scope_kind,
    input.defaultGardenId === undefined ? current.default_garden_id : input.defaultGardenId,
    input.activeAgencyAgentSlug === undefined
      ? current.active_agency_agent_slug
      : input.activeAgencyAgentSlug,
    conversation.id,
  );
  if (input.title !== undefined && conversation.legacy_chat_session_id !== null) {
    database.prepare(`
      UPDATE chat_sessions
      SET title = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(title, conversation.legacy_chat_session_id);
  }
  return getConversationById(conversation.id, database)!;
}

export function deleteConversation(
  conversation: ConversationRow,
  database: Database.Database = db,
): void {
  // The attachment payloads kept outside the message. Their blobs are read out
  // of the messages that reference them, so this has to happen while those rows
  // still exist — a cascade would take the references with it.
  removeConversationModelBlobs(conversation.id, database);
  removeConversationVideoBlobs(conversation.id, conversation.user_id, database);
  removeConversationAudioBlobs(conversation.id, conversation.user_id, database);
  database.prepare("DELETE FROM conversations WHERE id = ?").run(conversation.id);
}

export function listConversationMessages(
  conversationId: number,
  options: { limit?: number; afterOrder?: number; includePending?: boolean } = {},
  database: Database.Database = db,
): ConversationMessageRow[] {
  const limit = Math.max(1, Math.min(500, options.limit ?? 200));
  const pendingClause = options.includePending === false ? "AND status <> 'pending'" : "";
  const after = options.afterOrder ?? -1;
  return database.prepare(`
    SELECT * FROM conversation_messages
    WHERE conversation_id = ? AND order_index > ? ${pendingClause}
    ORDER BY order_index ASC
    LIMIT ?
  `).all(conversationId, after, limit) as ConversationMessageRow[];
}

export interface ConversationMessageSummary {
  messageCount: number;
  externalAgentActive: boolean;
}

/** One aggregate query for history rows, avoiding a transcript read per chat. */
export function summarizeConversationMessages(
  conversationIds: number[],
  database: Database.Database = db,
): Map<number, ConversationMessageSummary> {
  const ids = [...new Set(conversationIds.filter(Number.isSafeInteger))];
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = database.prepare(`
    SELECT conversation_id,
           COUNT(*) AS message_count,
           MAX(CASE
             WHEN role = 'assistant'
              AND metadata IS NOT NULL
              AND json_valid(metadata)
              AND json_extract(metadata, '$.externalAgentOutcome') = 'running'
             THEN 1 ELSE 0 END) AS external_agent_active
    FROM conversation_messages
    WHERE conversation_id IN (${placeholders})
    GROUP BY conversation_id
  `).all(...ids) as Array<{
    conversation_id: number;
    message_count: number;
    external_agent_active: number;
  }>;
  return new Map(rows.map((row) => [
    row.conversation_id,
    {
      messageCount: row.message_count,
      externalAgentActive: row.external_agent_active === 1,
    },
  ]));
}

export function listRecentConversationMessages(
  conversationId: number,
  limit = 20,
  database: Database.Database = db,
): ConversationMessageRow[] {
  const rows = database.prepare(`
    SELECT * FROM conversation_messages
    WHERE conversation_id = ?
      AND (role = 'user' OR status = 'complete')
    ORDER BY order_index DESC
    LIMIT ?
  `).all(conversationId, Math.max(1, Math.min(30, limit))) as ConversationMessageRow[];
  return rows.reverse();
}

export interface ReservedConversationTurn {
  conversation: ConversationRow;
  userMessage: ConversationMessageRow;
  assistantMessage: ConversationMessageRow;
  isNew: boolean;
}

/**
 * Create a conversation and reserve its first user/assistant pair in one
 * commit. The assistant is deliberately left aborted: the caller still has to
 * open the event stream before the ordinary turn endpoint claims and dispatches
 * it. If the process disappears between those requests, the prompt is already
 * in history and the aborted row supplies the normal Retry action.
 */
export function createConversationWithInitialTurn(input: {
  conversation: CreateConversationInput;
  turn: {
    clientMessageId: string;
    surface: HermesSurface;
    content: string;
    metadata?: Record<string, unknown>;
  };
}, database: Database.Database = db): {
  conversation: ConversationRow;
  turn: ReservedConversationTurn;
} {
  const create = database.transaction(() => {
    const conversation = createConversation(input.conversation, database);
    const turn = reserveConversationTurn({
      conversation,
      ...input.turn,
    }, database);
    const assistantMessage = failAssistantMessage({
      conversationId: conversation.id,
      clientMessageId: input.turn.clientMessageId,
      status: "aborted",
      error: "turn_dispatch_pending",
      metadata: { preDispatchReserved: true },
    }, database);
    return {
      conversation: turn.conversation,
      turn: { ...turn, assistantMessage },
    };
  });
  return create.immediate();
}

/** True only for the recoverable placeholder made with a new conversation. */
export function isPreDispatchReservedAssistant(
  message: ConversationMessageRow,
): boolean {
  return (
    message.role === "assistant" &&
    message.status === "aborted" &&
    parseObject(message.metadata).preDispatchReserved === true
  );
}

/**
 * Reserve deterministic adjacent transcript slots under an IMMEDIATE SQLite
 * transaction. A retry returns the original rows; a different simultaneous
 * turn receives 409 until the pending assistant row reaches a terminal state.
 */
export function reserveConversationTurn(input: {
  conversation: ConversationRow;
  clientMessageId: string;
  surface: HermesSurface;
  content: string;
  metadata?: Record<string, unknown>;
}, database: Database.Database = db): ReservedConversationTurn {
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  const content = normalizeMessageContent(input.content);
  const reserve = database.transaction((): ReservedConversationTurn => {
    const existingUser = getMessageByClientRole(
      input.conversation.id,
      clientMessageId,
      "user",
      database,
    );
    if (existingUser) {
      if (existingUser.content !== content || existingUser.surface !== input.surface) {
        throw new ConversationStoreError(
          409,
          "client_message_id_conflict",
          "That clientMessageId was already used for a different turn.",
        );
      }
      const existingAssistant = getMessageByClientRole(
        input.conversation.id,
        clientMessageId,
        "assistant",
        database,
      );
      if (!existingAssistant) {
        throw new ConversationStoreError(409, "turn_incomplete", "The existing turn is incomplete.");
      }
      return {
        conversation: getConversationById(input.conversation.id, database)!,
        userMessage: existingUser,
        assistantMessage: existingAssistant,
        isNew: false,
      };
    }

    const active = database.prepare(`
      SELECT client_message_id FROM conversation_messages
      WHERE conversation_id = ? AND role = 'assistant' AND status = 'pending'
      LIMIT 1
    `).get(input.conversation.id) as { client_message_id: string } | undefined;
    if (active) {
      throw new ConversationStoreError(
        409,
        "conversation_turn_active",
        "Another turn is already active for this conversation.",
      );
    }

    const current = getConversationById(input.conversation.id, database);
    if (!current) throw new ConversationStoreError(404, "conversation_not_found", "Conversation not found.");
    const userOrder = current.next_order_index;
    const assistantOrder = userOrder + 1;
    const serializedMetadata = input.metadata ? JSON.stringify(input.metadata) : null;
    const userResult = database.prepare(`
      INSERT INTO conversation_messages
        (conversation_id, client_message_id, role, surface, content, status,
         order_index, metadata)
      VALUES (?, ?, 'user', ?, ?, 'complete', ?, ?)
    `).run(
      current.id,
      clientMessageId,
      input.surface,
      content,
      userOrder,
      serializedMetadata,
    );
    const assistantResult = database.prepare(`
      INSERT INTO conversation_messages
        (conversation_id, client_message_id, role, surface, content, status,
         order_index, metadata)
      VALUES (?, ?, 'assistant', ?, '', 'pending', ?, ?)
    `).run(
      current.id,
      clientMessageId,
      input.surface,
      assistantOrder,
      serializedMetadata,
    );
    database.prepare(`
      UPDATE conversations
      SET next_order_index = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(assistantOrder + 1, current.id);

    const userMessage = getConversationMessageById(Number(userResult.lastInsertRowid), database)!;
    const assistantMessage = getConversationMessageById(Number(assistantResult.lastInsertRowid), database)!;
    dualWriteUserMessage(current, userMessage, database);
    // Garden Chat still has two readers while the canonical migration is in
    // flight. Persist the empty answer beside the user row in the legacy
    // transcript in the same transaction, otherwise a dashboard crash during
    // pre-dispatch preparation leaves that reader with a question and no turn
    // to recover or fail.
    dualWriteAssistantMessage(current, assistantMessage, database);
    return {
      conversation: getConversationById(current.id, database)!,
      userMessage,
      assistantMessage,
      isNew: true,
    };
  });
  return reserve.immediate();
}

/**
 * Complete the canonical half of a Garden workspace turn that was checkpointed
 * through the legacy chat-session API before the Hermes request began.
 *
 * That API has already dual-written the user row, so calling
 * `reserveConversationTurn` would correctly reject the half-existing turn.
 * Garden's compatibility adapter still needs the adjacent pending assistant
 * row, though: the detached recovery pump uses it to finish the answer after a
 * Next.js reload. Keeping this repair narrow avoids making arbitrary incomplete
 * canonical turns silently recoverable.
 */
export function reserveLegacyGardenAssistantTurn(input: {
  conversation: ConversationRow;
  chatSessionId: number;
  content: string;
}, database: Database.Database = db): {
  clientMessageId: string;
  assistantMessage: ConversationMessageRow;
} {
  const content = normalizeMessageContent(input.content);
  const reserve = database.transaction(() => {
    const user = database.prepare(`
      SELECT canonical.*
      FROM chat_messages legacy
      JOIN conversation_messages canonical
        ON canonical.id = legacy.canonical_message_id
      WHERE legacy.session_id = ?
        AND legacy.role = 'user'
        AND canonical.conversation_id = ?
        AND canonical.role = 'user'
      ORDER BY legacy.order_index DESC, legacy.id DESC
      LIMIT 1
    `).get(
      input.chatSessionId,
      input.conversation.id,
    ) as ConversationMessageRow | undefined;
    if (!user || user.content !== content) {
      throw new ConversationStoreError(
        409,
        "legacy_turn_not_checkpointed",
        "The Garden message checkpoint was not found.",
      );
    }

    const existing = getMessageByClientRole(
      input.conversation.id,
      user.client_message_id,
      "assistant",
      database,
    );
    if (existing) {
      dualWriteAssistantMessage(input.conversation, existing, database);
      return {
        clientMessageId: user.client_message_id,
        assistantMessage: existing,
      };
    }

    const conversation = getConversationById(input.conversation.id, database);
    if (!conversation || user.order_index !== conversation.next_order_index - 1) {
      throw new ConversationStoreError(
        409,
        "legacy_turn_not_latest",
        "The Garden message is no longer the latest conversation turn.",
      );
    }
    const result = database.prepare(`
      INSERT INTO conversation_messages
        (conversation_id, client_message_id, role, surface, content, status,
         order_index, metadata)
      VALUES (?, ?, 'assistant', 'garden_chat', '', 'pending', ?, ?)
    `).run(
      conversation.id,
      user.client_message_id,
      conversation.next_order_index,
      JSON.stringify({
        legacyGardenAdapter: true,
        gardenPreDispatch: true,
      }),
    );
    database.prepare(`
      UPDATE conversations
      SET next_order_index = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(conversation.next_order_index + 1, conversation.id);
    const assistantMessage = getConversationMessageById(
      Number(result.lastInsertRowid),
      database,
    );
    if (!assistantMessage) {
      throw new ConversationStoreError(
        500,
        "legacy_turn_reservation_failed",
        "The Garden answer checkpoint could not be created.",
      );
    }
    dualWriteAssistantMessage(conversation, assistantMessage, database);
    return {
      clientMessageId: user.client_message_id,
      assistantMessage,
    };
  });
  return reserve.immediate();
}

export function completeAssistantMessage(input: {
  conversationId: number;
  clientMessageId: string;
  content: string;
  metadata?: Record<string, unknown>;
  sources?: unknown;
  tokenUsage?: unknown;
}, database: Database.Database = db): ConversationMessageRow {
  return finishAssistantMessage({
    ...input,
    status: "complete",
  }, database);
}

export function failAssistantMessage(input: {
  conversationId: number;
  clientMessageId: string;
  status: "failed" | "aborted";
  content?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  /**
   * A turn that ended badly still spent what it spent. Dropping the usage here
   * left every failed and aborted answer with a null count: the live meter ran
   * during the answer and the row it was written to reported nothing after a
   * reload, so the tokens vanished from cost accounting entirely.
   */
  tokenUsage?: unknown;
}, database: Database.Database = db): ConversationMessageRow {
  return finishAssistantMessage({
    conversationId: input.conversationId,
    clientMessageId: input.clientMessageId,
    status: input.status,
    content: input.content ?? "",
    metadata: { ...input.metadata, ...(input.error ? { error: input.error } : {}) },
    ...(input.tokenUsage === undefined ? {} : { tokenUsage: input.tokenUsage }),
  }, database);
}

export function retryAssistantMessage(
  conversationId: number,
  clientMessageId: string,
  database: Database.Database = db,
  metadata: Record<string, unknown> = {},
): ConversationMessageRow {
  const serializedMetadata = Object.keys(metadata).length
    ? JSON.stringify(metadata)
    : null;
  const result = database.prepare(`
    UPDATE conversation_messages
    SET status = 'pending', content = '', metadata = ?, sources = NULL,
        token_usage = NULL, updated_at = datetime('now')
    WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
      AND status IN ('failed','aborted')
  `).run(
    serializedMetadata,
    conversationId,
    normalizeClientMessageId(clientMessageId),
  );
  if (result.changes !== 1) {
    throw new ConversationStoreError(409, "turn_not_retryable", "The conversation turn cannot be retried.");
  }
  const pending = getMessageByClientRole(
    conversationId,
    clientMessageId,
    "assistant",
    database,
  )!;
  const conversation = getConversationById(conversationId, database);
  if (conversation) dualWriteAssistantMessage(conversation, pending, database);
  return pending;
}

/**
 * Close pre-dispatch Garden turns whose owner disappeared before it could
 * create a runtime run. The adapter refreshes `updated_at` while it prepares;
 * an active run is protected by its own durable heartbeat/recovery path.
 */
export function failStaleGardenPreDispatchTurns(input: {
  chatSessionIds: number[];
  staleBefore: string;
}, database: Database.Database = db): number {
  const ids = [...new Set(input.chatSessionIds)].filter(
    (id) => Number.isSafeInteger(id) && id > 0,
  );
  if (ids.length === 0 || !Number.isFinite(Date.parse(input.staleBefore))) {
    return 0;
  }
  const placeholders = ids.map(() => "?").join(",");
  const candidates = database.prepare(`
    SELECT message.*, conversation.id AS owner_conversation_id
    FROM conversation_messages message
    JOIN conversations conversation
      ON conversation.id = message.conversation_id
    WHERE conversation.legacy_chat_session_id IN (${placeholders})
      AND message.role = 'assistant'
      AND message.status = 'pending'
      AND julianday(message.updated_at) < julianday(?)
      AND NOT EXISTS (
        SELECT 1
        FROM hermes_runs run
        JOIN hermes_runtime_sessions session
          ON session.id = run.runtime_session_id
        WHERE session.conversation_id = conversation.id
          AND run.status = 'active'
      )
  `).all(...ids, input.staleBefore) as Array<
    ConversationMessageRow & { owner_conversation_id: number }
  >;

  let failed = 0;
  for (const candidate of candidates) {
    const metadata = parseObject(candidate.metadata);
    if (metadata.gardenPreDispatch !== true) continue;
    try {
      failAssistantMessage({
        conversationId: candidate.owner_conversation_id,
        clientMessageId: candidate.client_message_id,
        status: "failed",
        content:
          "This response was interrupted before it could finish. Please try again.",
        error: "garden_dispatch_interrupted",
        metadata: { runtimeStatus: "failed" },
      }, database);
      failed += 1;
    } catch {
      // Another request or the runtime pump may have finalized it first.
    }
  }
  return failed;
}

/** Insert a visible course-correction immediately before the pending answer. */
export function appendConversationSteerMessage(input: {
  conversationId: number;
  clientMessageId: string;
  surface: HermesSurface;
  content: string;
  targetClientMessageId?: string;
  assistantContentOffset?: number;
}, database: Database.Database = db): ConversationMessageRow {
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  const content = normalizeMessageContent(input.content);
  const targetClientMessageId = input.targetClientMessageId
    ? normalizeClientMessageId(input.targetClientMessageId)
    : undefined;
  if (
    input.assistantContentOffset !== undefined &&
    (!Number.isSafeInteger(input.assistantContentOffset) ||
      input.assistantContentOffset < 0)
  ) {
    throw new ConversationStoreError(
      400,
      "invalid_course_correction_offset",
      "The course-correction response offset is invalid.",
    );
  }
  const metadata = JSON.stringify({
    courseCorrection: true,
    ...(targetClientMessageId
      ? { courseCorrectionTargetClientMessageId: targetClientMessageId }
      : {}),
    ...(input.assistantContentOffset !== undefined
      ? { courseCorrectionOffset: input.assistantContentOffset }
      : {}),
  });
  const append = database.transaction(() => {
    const existing = getMessageByClientRole(input.conversationId, clientMessageId, "user", database);
    if (existing) {
      if (existing.content !== content) {
        throw new ConversationStoreError(409, "client_message_id_conflict", "Steering id was reused.");
      }
      return existing;
    }
    const pending = database.prepare(`
      SELECT * FROM conversation_messages
      WHERE conversation_id = ? AND role = 'assistant' AND status = 'pending'
      ORDER BY order_index LIMIT 1
    `).get(input.conversationId) as ConversationMessageRow | undefined;
    if (!pending) throw new ConversationStoreError(409, "turn_not_active", "There is no active answer to steer.");

    // Move the pending assistant and any later rows through a collision-free
    // offset, opening exactly one deterministic slot for the correction.
    database.prepare(`
      UPDATE conversation_messages SET order_index = order_index + 1000000
      WHERE conversation_id = ? AND order_index >= ?
    `).run(input.conversationId, pending.order_index);
    const result = database.prepare(`
      INSERT INTO conversation_messages
        (conversation_id, client_message_id, role, surface, content, status,
         order_index, metadata)
      VALUES (?, ?, 'user', ?, ?, 'complete', ?, ?)
    `).run(
      input.conversationId,
      clientMessageId,
      input.surface,
      content,
      pending.order_index,
      metadata,
    );
    database.prepare(`
      UPDATE conversation_messages SET order_index = order_index - 999999
      WHERE conversation_id = ? AND order_index >= 1000000
    `).run(input.conversationId);
    database.prepare(`
      UPDATE conversations SET next_order_index = next_order_index + 1,
        updated_at = datetime('now') WHERE id = ?
    `).run(input.conversationId);
    return getConversationMessageById(Number(result.lastInsertRowid), database)!;
  });
  return append.immediate();
}

/**
 * Persist a model selection on the answer it follows. Presentation derives
 * boundaries after that row, so no fake message can enter runtime context,
 * search, memory windows, or history counts.
 */
export function setConversationModelChange(input: {
  conversationId: number;
  afterClientMessageId: string;
  modelId: string;
  modelLabel: string;
}, database: Database.Database = db): ConversationMessageRow {
  const afterClientMessageId = normalizeClientMessageId(
    input.afterClientMessageId,
  );
  const modelId = input.modelId.trim();
  const modelLabel = input.modelLabel.trim();
  if (!modelId || modelId.length > 128 || !modelLabel || modelLabel.length > 160) {
    throw new ConversationStoreError(
      400,
      "invalid_model_change",
      "The model change is invalid.",
    );
  }
  const persist = database.transaction(() => {
    const conversation = getConversationById(input.conversationId, database);
    if (!conversation) {
      throw new ConversationStoreError(
        404,
        "conversation_not_found",
        "Conversation not found.",
      );
    }
    const answer = getMessageByClientRole(
      conversation.id,
      afterClientMessageId,
      "assistant",
      database,
    );
    if (!answer) {
      throw new ConversationStoreError(
        404,
        "turn_not_found",
        "Conversation turn not found.",
      );
    }

    const previousMetadata = parseObject(answer.metadata);
    const previousModelChangeLabels = Array.isArray(
      previousMetadata.modelChangeLabels,
    )
      ? previousMetadata.modelChangeLabels.filter(
          (value): value is string =>
            typeof value === "string" && Boolean(value.trim()),
        )
      : typeof previousMetadata.modelChangeLabel === "string" &&
          previousMetadata.modelChangeLabel.trim()
        ? [previousMetadata.modelChangeLabel]
        : [];
    const metadata = JSON.stringify({
      ...previousMetadata,
      modelChangeModelId: modelId,
      modelChangeLabel: modelLabel,
      modelChangeLabels: [...previousModelChangeLabels, modelLabel].slice(-50),
    });
    database.prepare(`
      UPDATE conversation_messages
      SET metadata = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(metadata, answer.id);
    database.prepare(`
      UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `).run(conversation.id);
    return getConversationMessageById(answer.id, database)!;
  });
  return persist.immediate();
}

export function annotateConversationTurn(input: {
  conversationId: number;
  clientMessageId: string;
  metadata: Record<string, unknown>;
}, database: Database.Database = db): void {
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  const rows = database.prepare(`
    SELECT id, metadata FROM conversation_messages
    WHERE conversation_id = ? AND client_message_id = ?
  `).all(input.conversationId, clientMessageId) as Array<{ id: number; metadata: string | null }>;
  const update = database.prepare("UPDATE conversation_messages SET metadata = ?, updated_at = datetime('now') WHERE id = ?");
  for (const row of rows) {
    update.run(JSON.stringify({ ...parseObject(row.metadata), ...input.metadata }), row.id);
  }
}

function finishAssistantMessage(input: {
  conversationId: number;
  clientMessageId: string;
  status: "complete" | "failed" | "aborted";
  content: string;
  metadata?: Record<string, unknown>;
  sources?: unknown;
  tokenUsage?: unknown;
}, database: Database.Database): ConversationMessageRow {
  const finish = database.transaction(() => {
    const row = getMessageByClientRole(
      input.conversationId,
      normalizeClientMessageId(input.clientMessageId),
      "assistant",
      database,
    );
    if (!row) throw new ConversationStoreError(404, "turn_not_found", "Conversation turn not found.");
    if (row.status !== "pending") return row;
    const mergedMetadata = { ...parseObject(row.metadata), ...input.metadata };
    // Every finished answer, on every surface and from every runtime, lands
    // here — which makes it the one place invisible-Unicode marks can be taken
    // out of what Breadboard says without asking each pipeline to remember.
    // Only invisible characters are removed; the wording is untouched.
    const content = scrubbed(input.content);
    if (
      mergedMetadata.delegatedAgentRun === true &&
      !(typeof mergedMetadata.delegatedAgentPreamble === "string" &&
        mergedMetadata.delegatedAgentPreamble.trim()) &&
      content.trim()
    ) {
      // A server-owned delegation can attach while the assistant placeholder
      // is still pending. Capture the hand-off once the model's text is known,
      // so a reload shows that immediate status while keeping the worker card
      // private.
      mergedMetadata.delegatedAgentPreamble = content;
    }
    database.prepare(`
      UPDATE conversation_messages
      SET content = ?, status = ?, metadata = ?, sources = ?, token_usage = ?,
          updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `).run(
      content,
      input.status,
      Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
      input.sources === undefined ? null : JSON.stringify(input.sources),
      input.tokenUsage === undefined ? null : JSON.stringify(input.tokenUsage),
      row.id,
    );
    const completed = getConversationMessageById(row.id, database)!;
    const conversation = getConversationById(input.conversationId, database)!;
    // Failed and aborted answers are transcript state too. Keeping only
    // successful answers in the legacy Garden store is what made a restored
    // chat look as though its assistant message had been deleted.
    dualWriteAssistantMessage(conversation, completed, database);
    return completed;
  });
  return finish.immediate();
}

export function getConversationMessageById(
  id: number,
  database: Database.Database = db,
): ConversationMessageRow | null {
  return (database.prepare("SELECT * FROM conversation_messages WHERE id = ?").get(id) as ConversationMessageRow | undefined) ?? null;
}

/** Resolve the durable half of a turn while its browser UUID is still on screen. */
export function getConversationMessageByClientId(
  conversationId: number,
  clientMessageId: string,
  role: "user" | "assistant",
  database: Database.Database = db,
): ConversationMessageRow | null {
  return getMessageByClientRole(
    conversationId,
    normalizeClientMessageId(clientMessageId),
    role,
    database,
  );
}

export function presentConversationMessage(row: ConversationMessageRow): PresentedConversationMessage {
  return {
    id: `msg_${row.id}`,
    clientMessageId: row.client_message_id,
    role: row.role,
    surface: row.surface,
    content: row.content,
    status: row.status,
    orderIndex: row.order_index,
    metadata: parseObject(row.metadata),
    sources: parseUnknown(row.sources),
    usage: parseUnknown(row.token_usage),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function presentConversation(row: ConversationRow): {
  id: string;
  title: string;
  scopeKind: ConversationScopeKind;
  defaultGardenId: number | null;
  activeAgencyAgentSlug: string | null;
  pinned: boolean;
  pinnedAt: string | null;
  highlight: string | null;
  temporary: boolean;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: row.public_id,
    title: row.title,
    scopeKind: row.scope_kind,
    defaultGardenId: row.default_garden_id,
    activeAgencyAgentSlug: row.active_agency_agent_slug,
    pinned: row.pinned_at !== null,
    pinnedAt: row.pinned_at ?? null,
    // The client mirrors this rather than remembering what it asked for: a
    // reopened chat has to be able to say what it is on its own.
    temporary: conversationIsTemporary(row),
    // An unknown slug (an older palette, a hand-edited row) presents as no
    // highlight rather than as a color the rail cannot paint.
    highlight: isChatHighlight(row.highlight) ? row.highlight : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getMessageByClientRole(
  conversationId: number,
  clientMessageId: string,
  role: "user" | "assistant",
  database: Database.Database,
): ConversationMessageRow | null {
  return (database.prepare(`
    SELECT * FROM conversation_messages
    WHERE conversation_id = ? AND client_message_id = ? AND role = ?
  `).get(conversationId, clientMessageId, role) as ConversationMessageRow | undefined) ?? null;
}

function dualWriteUserMessage(
  conversation: ConversationRow,
  message: ConversationMessageRow,
  database: Database.Database,
): void {
  if (conversation.legacy_chat_session_id !== null) {
    const order = database.prepare(`
      SELECT COALESCE(MAX(order_index) + 1, 0) AS value FROM chat_messages WHERE session_id = ?
    `).get(conversation.legacy_chat_session_id) as { value: number };
    database.prepare(`
      INSERT OR IGNORE INTO chat_messages
        (session_id, role, content, order_index, canonical_message_id, runtime_status, tool_calls)
      VALUES (?, 'user', ?, ?, ?, 'complete', ?)
    `).run(
      conversation.legacy_chat_session_id,
      message.content,
      order.value,
      message.id,
      message.metadata,
    );
    database.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?")
      .run(conversation.legacy_chat_session_id);
  }
}

function dualWriteAssistantMessage(
  conversation: ConversationRow,
  message: ConversationMessageRow,
  database: Database.Database,
): void {
  if (conversation.legacy_chat_session_id === null) return;
  const metadata = parseObject(message.metadata);
  const runtimeError =
    typeof metadata.runtimeError === "string"
      ? metadata.runtimeError
      : typeof metadata.error === "string"
        ? metadata.error
        : null;
  const updated = database.prepare(`
    UPDATE chat_messages
    SET content = ?, sources = ?, token_usage = ?, runtime_status = ?,
        runtime_error = ?, tool_calls = ?
    WHERE session_id = ? AND canonical_message_id = ? AND role = 'assistant'
  `).run(
    message.content,
    message.sources,
    message.token_usage,
    message.status,
    runtimeError,
    message.metadata,
    conversation.legacy_chat_session_id,
    message.id,
  );
  if (updated.changes > 0) {
    database.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?")
      .run(conversation.legacy_chat_session_id);
    return;
  }
  const order = database.prepare(`
    SELECT COALESCE(MAX(order_index) + 1, 0) AS value FROM chat_messages WHERE session_id = ?
  `).get(conversation.legacy_chat_session_id) as { value: number };
  database.prepare(`
    INSERT OR IGNORE INTO chat_messages
      (session_id, role, content, sources, token_usage, order_index,
       canonical_message_id, runtime_status, runtime_error, tool_calls)
    VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conversation.legacy_chat_session_id,
    message.content,
    message.sources,
    message.token_usage,
    order.value,
    message.id,
    message.status,
    runtimeError,
    message.metadata,
  );
  database.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?")
    .run(conversation.legacy_chat_session_id);
}

function normalizeClientMessageId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(normalized)) {
    throw new ConversationStoreError(
      400,
      "invalid_client_message_id",
      "clientMessageId must be an opaque 8-128 character identifier.",
    );
  }
  return normalized;
}

function normalizeMessageContent(value: string): string {
  const content = value.trim();
  if (!content) throw new ConversationStoreError(400, "empty_message", "Message text is required.");
  if (content.length > 100_000) {
    throw new ConversationStoreError(413, "message_too_large", "Message text is too large.");
  }
  return content;
}

function normalizeTitle(value: string | undefined): string {
  const title = value?.trim() || "New chat";
  return title.slice(0, 200);
}

function parseObject(value: string | null): Record<string, unknown> {
  const parsed = parseUnknown(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function parseUnknown(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
