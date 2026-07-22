import crypto from "node:crypto";
import type Database from "better-sqlite3";
import db from "../db.ts";
import type { OpenHarnessSurface } from "../openharness/config.ts";

export type ConversationScopeKind = "global" | "garden" | "page";
export type ConversationMessageStatus = "pending" | "complete" | "failed" | "aborted";

export interface ConversationRow {
  id: number;
  public_id: string;
  user_id: number;
  title: string;
  scope_kind: ConversationScopeKind;
  default_garden_id: number | null;
  legacy_chat_session_id: number | null;
  legacy_runtime_session_id: number | null;
  next_order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessageRow {
  id: number;
  conversation_id: number;
  client_message_id: string;
  role: "user" | "assistant";
  surface: OpenHarnessSurface;
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
  surface: OpenHarnessSurface;
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

export function createConversation(input: {
  userId: number;
  title?: string;
  scopeKind?: ConversationScopeKind;
  defaultGardenId?: number | null;
}, database: Database.Database = db): ConversationRow {
  const publicId = `conv_${crypto.randomBytes(18).toString("base64url")}`;
  const result = database.prepare(`
    INSERT INTO conversations(public_id, user_id, title, scope_kind, default_garden_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    publicId,
    input.userId,
    normalizeTitle(input.title),
    input.scopeKind ?? "global",
    input.defaultGardenId ?? null,
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

export function listConversationsForUser(
  userId: number,
  database: Database.Database = db,
): ConversationRow[] {
  return database.prepare(`
    SELECT * FROM conversations
    WHERE user_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 100
  `).all(userId) as ConversationRow[];
}

export function updateConversation(
  conversation: ConversationRow,
  input: { title?: string; scopeKind?: ConversationScopeKind; defaultGardenId?: number | null },
  database: Database.Database = db,
): ConversationRow {
  database.prepare(`
    UPDATE conversations
    SET title = ?, scope_kind = ?, default_garden_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.title === undefined ? conversation.title : normalizeTitle(input.title),
    input.scopeKind ?? conversation.scope_kind,
    input.defaultGardenId === undefined ? conversation.default_garden_id : input.defaultGardenId,
    conversation.id,
  );
  return getConversationById(conversation.id, database)!;
}

export function deleteConversation(
  conversation: ConversationRow,
  database: Database.Database = db,
): void {
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
 * Reserve deterministic adjacent transcript slots under an IMMEDIATE SQLite
 * transaction. A retry returns the original rows; a different simultaneous
 * turn receives 409 until the pending assistant row reaches a terminal state.
 */
export function reserveConversationTurn(input: {
  conversation: ConversationRow;
  clientMessageId: string;
  surface: OpenHarnessSurface;
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
    return {
      conversation: getConversationById(current.id, database)!,
      userMessage,
      assistantMessage,
      isNew: true,
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
}, database: Database.Database = db): ConversationMessageRow {
  return finishAssistantMessage({
    conversationId: input.conversationId,
    clientMessageId: input.clientMessageId,
    status: input.status,
    content: input.content ?? "",
    metadata: { ...input.metadata, ...(input.error ? { error: input.error } : {}) },
  }, database);
}

export function retryAssistantMessage(
  conversationId: number,
  clientMessageId: string,
  database: Database.Database = db,
): ConversationMessageRow {
  const result = database.prepare(`
    UPDATE conversation_messages
    SET status = 'pending', content = '', metadata = NULL, sources = NULL,
        token_usage = NULL, updated_at = datetime('now')
    WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
      AND status IN ('failed','aborted')
  `).run(conversationId, normalizeClientMessageId(clientMessageId));
  if (result.changes !== 1) {
    throw new ConversationStoreError(409, "turn_not_retryable", "The conversation turn cannot be retried.");
  }
  return getMessageByClientRole(conversationId, clientMessageId, "assistant", database)!;
}

/** Insert a visible course-correction immediately before the pending answer. */
export function appendConversationSteerMessage(input: {
  conversationId: number;
  clientMessageId: string;
  surface: OpenHarnessSurface;
  content: string;
}, database: Database.Database = db): ConversationMessageRow {
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  const content = normalizeMessageContent(input.content);
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
      VALUES (?, ?, 'user', ?, ?, 'complete', ?, '{"courseCorrection":true}')
    `).run(
      input.conversationId,
      clientMessageId,
      input.surface,
      content,
      pending.order_index,
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
    database.prepare(`
      UPDATE conversation_messages
      SET content = ?, status = ?, metadata = ?, sources = ?, token_usage = ?,
          updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `).run(
      input.content,
      input.status,
      Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
      input.sources === undefined ? null : JSON.stringify(input.sources),
      input.tokenUsage === undefined ? null : JSON.stringify(input.tokenUsage),
      row.id,
    );
    const completed = getConversationMessageById(row.id, database)!;
    const conversation = getConversationById(input.conversationId, database)!;
    if (input.status === "complete") dualWriteAssistantMessage(conversation, completed, database);
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
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: row.public_id,
    title: row.title,
    scopeKind: row.scope_kind,
    defaultGardenId: row.default_garden_id,
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
        (session_id, role, content, order_index, canonical_message_id, runtime_status)
      VALUES (?, 'user', ?, ?, ?, 'complete')
    `).run(conversation.legacy_chat_session_id, message.content, order.value, message.id);
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
  const order = database.prepare(`
    SELECT COALESCE(MAX(order_index) + 1, 0) AS value FROM chat_messages WHERE session_id = ?
  `).get(conversation.legacy_chat_session_id) as { value: number };
  database.prepare(`
    INSERT OR IGNORE INTO chat_messages
      (session_id, role, content, sources, token_usage, order_index,
       canonical_message_id, runtime_status, tool_calls)
    VALUES (?, 'assistant', ?, ?, ?, ?, ?, 'complete', ?)
  `).run(
    conversation.legacy_chat_session_id,
    message.content,
    message.sources,
    message.token_usage,
    order.value,
    message.id,
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
