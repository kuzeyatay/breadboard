import type Database from "better-sqlite3";
import { ApiError } from "./hermes/route-core.ts";
import type { StarredMessage, StarredMessageContent } from "./starred-messages-types.ts";

export function ensureStarredMessagesSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS starred_messages (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
    garden_id INTEGER REFERENCES clusters(id) ON DELETE SET NULL,
    starred_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, message_id)
  )`);
  const columns = db.pragma("table_info(starred_messages)") as { name: string }[];
  if (!columns.some(column => column.name === "garden_id")) {
    db.exec("ALTER TABLE starred_messages ADD COLUMN garden_id INTEGER REFERENCES clusters(id) ON DELETE SET NULL");
  }
}

export function listStarredMessages(db: Database.Database, userId: number): StarredMessage[] {
  return db.prepare(`SELECT c.public_id AS conversationId, 'msg_' || m.id AS messageId,
    m.client_message_id AS clientMessageId,
    CAST(c.legacy_chat_session_id AS TEXT) AS legacyChatId,
    CASE WHEN c.surface = 'garden_chat' AND cs.history_surface = 'garden_chat' THEN CAST(cs.id AS TEXT) ELSE c.public_id END AS chatId,
    c.surface = 'garden_chat' AND cs.history_surface = 'garden_chat' AS workspaceChat,
    c.origin_label = 'Side chat' AS sideChat,
    c.title, substr(m.content, 1, 300) AS preview,
    g.slug AS gardenSlug,
    s.starred_at AS starredAt
    FROM starred_messages s JOIN conversation_messages m ON m.id = s.message_id
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN chat_sessions cs ON cs.id = c.legacy_chat_session_id
    LEFT JOIN clusters g ON g.id = COALESCE(s.garden_id, c.default_garden_id)
    WHERE s.user_id = ? AND c.user_id = ? AND (c.temporary = 0 OR c.origin_label = 'Side chat')
    ORDER BY s.starred_at DESC, m.id DESC`).all(userId, userId).map((row) => {
      const message = row as Omit<StarredMessage, "sideChat" | "workspaceChat"> & { sideChat: number | null; workspaceChat: number | null };
      return { ...message, sideChat: message.sideChat === 1, workspaceChat: message.workspaceChat === 1 };
    });
}

/** Read one saved answer on demand without sending every full answer in the list. */
export function getStarredMessageContent(db: Database.Database, userId: number, messageId: string): StarredMessageContent {
  const message = db.prepare(`SELECT 'msg_' || m.id AS messageId, m.content
    FROM starred_messages s JOIN conversation_messages m ON m.id = s.message_id
    JOIN conversations c ON c.id = m.conversation_id
    WHERE s.user_id = ? AND c.user_id = ? AND (c.temporary = 0 OR c.origin_label = 'Side chat')
      AND ('msg_' || m.id) = ? AND m.role = 'assistant'
  `).get(userId, userId, messageId) as StarredMessageContent | undefined;
  if (!message) throw new ApiError(404, "message_not_found", "This starred message is no longer available.");
  return message;
}

export function setMessageStar(db: Database.Database, userId: number, input: {
  conversationId: string; messageId: string; starred: boolean;
  /** Resolve PDF ownership only after authorizing the conversation and reply. */
  pdfGardenId?: () => number | null;
}) {
  const message = db.prepare(`SELECT m.id, c.origin_label FROM conversation_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND (c.temporary = 0 OR c.origin_label = 'Side chat')
      AND (c.public_id = ? OR (c.surface = 'garden_chat' AND CAST(c.legacy_chat_session_id AS TEXT) = ?))
      AND (('msg_' || m.id) = ? OR m.client_message_id = ?) AND m.role = 'assistant'
  `).get(userId, input.conversationId, input.conversationId, input.messageId, input.messageId) as { id: number; origin_label: string | null } | undefined;
  if (!message) throw new ApiError(404, "message_not_found", "This message is no longer available.");
  if (input.starred) {
    const gardenId = ["PDF", "PDF Assistant"].includes(message.origin_label ?? "") ? input.pdfGardenId?.() ?? null : null;
    db.prepare(`INSERT INTO starred_messages(user_id, message_id, garden_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, message_id) DO UPDATE SET garden_id = COALESCE(excluded.garden_id, starred_messages.garden_id)`)
      .run(userId, message.id, gardenId);
  } else {
    db.prepare("DELETE FROM starred_messages WHERE user_id = ? AND message_id = ?").run(userId, message.id);
  }
}

/** Checked again inside deletion's transaction so a concurrent star wins. */
export function sideChatHasStars(db: Database.Database, userId: number, conversationId: number): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM starred_messages s
    JOIN conversation_messages m ON m.id = s.message_id
    WHERE s.user_id = ? AND m.conversation_id = ? LIMIT 1`).get(userId, conversationId));
}
