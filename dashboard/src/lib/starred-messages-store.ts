import type Database from "better-sqlite3";
import { ApiError } from "./hermes/route-core.ts";
import type { StarredMessage } from "./starred-messages-types.ts";

export function ensureStarredMessagesSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS starred_messages (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
    starred_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, message_id)
  )`);
}

export function listStarredMessages(db: Database.Database, userId: number): StarredMessage[] {
  return db.prepare(`SELECT c.public_id AS conversationId, 'msg_' || m.id AS messageId,
    m.client_message_id AS clientMessageId,
    CASE WHEN c.surface = 'garden_chat' THEN CAST(c.legacy_chat_session_id AS TEXT) ELSE c.public_id END AS chatId,
    c.title, substr(m.content, 1, 300) AS preview,
    CASE WHEN c.surface = 'garden_chat' THEN g.slug ELSE NULL END AS gardenSlug,
    s.starred_at AS starredAt
    FROM starred_messages s JOIN conversation_messages m ON m.id = s.message_id
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN clusters g ON g.id = c.default_garden_id
    WHERE s.user_id = ? AND c.user_id = ? AND c.temporary = 0
    ORDER BY s.starred_at DESC, m.id DESC`).all(userId, userId) as StarredMessage[];
}

export function setMessageStar(db: Database.Database, userId: number, input: {
  conversationId: string; messageId: string; starred: boolean;
}) {
  const message = db.prepare(`SELECT m.id FROM conversation_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND c.temporary = 0
      AND (c.public_id = ? OR (c.surface = 'garden_chat' AND CAST(c.legacy_chat_session_id AS TEXT) = ?))
      AND (('msg_' || m.id) = ? OR m.client_message_id = ?) AND m.role = 'assistant'
  `).get(userId, input.conversationId, input.conversationId, input.messageId, input.messageId) as { id: number } | undefined;
  if (!message) throw new ApiError(404, "message_not_found", "This message is no longer available.");
  if (input.starred) {
    db.prepare("INSERT OR IGNORE INTO starred_messages(user_id, message_id) VALUES (?, ?)").run(userId, message.id);
  } else {
    db.prepare("DELETE FROM starred_messages WHERE user_id = ? AND message_id = ?").run(userId, message.id);
  }
}
