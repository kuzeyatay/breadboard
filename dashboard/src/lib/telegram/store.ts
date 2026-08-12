// SQLite-backed persistence for the Telegram link. A plain class over an injected
// database handle (matching src/lib/whatsapp/store.ts) so it can be unit-tested
// against an in-memory database.

import type DatabaseType from "better-sqlite3";

import { ensureTelegramSchema } from "./schema.ts";
import { formatAllowedUsers, parseAllowedUsers } from "./identity.ts";

type Db = DatabaseType.Database;

export class TelegramError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TelegramError";
    this.status = status;
  }
}

export interface TelegramSettingsRow {
  id: number;
  owner_user_id: number | null;
  allowed_users: string;
  autostart: number;
  bot_id: string | null;
  bot_username: string | null;
  bot_name: string | null;
  linked_at: string | null;
  last_update_id: number;
  updated_at: string;
}

export interface TelegramSettings {
  ownerUserId: number | null;
  allowedUsers: string[];
  autostart: boolean;
  botId: string | null;
  botUsername: string | null;
  botName: string | null;
  linkedAt: string | null;
  lastUpdateId: number;
}

export interface TelegramChatRow {
  id: number;
  chat_id: string;
  user_id: number;
  conversation_id: number | null;
  contact_label: string;
  contact_handle: string;
  is_group: number;
  message_count: number;
  first_seen_at: string;
  last_message_at: string;
}

export function presentTelegramSettings(row: TelegramSettingsRow): TelegramSettings {
  return {
    ownerUserId: row.owner_user_id,
    allowedUsers: parseAllowedUsers(row.allowed_users),
    autostart: row.autostart === 1,
    botId: row.bot_id,
    botUsername: row.bot_username,
    botName: row.bot_name,
    linkedAt: row.linked_at,
    lastUpdateId: row.last_update_id,
  };
}

export class TelegramStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    ensureTelegramSchema(db);
  }

  settings(): TelegramSettings {
    const row = this.db
      .prepare("SELECT * FROM telegram_settings WHERE id = 1")
      .get() as TelegramSettingsRow | undefined;
    if (row) return presentTelegramSettings(row);
    this.db.prepare("INSERT OR IGNORE INTO telegram_settings (id) VALUES (1)").run();
    return this.settings();
  }

  /**
   * The bot belongs to whoever linked it. Everyone else is refused — a Telegram
   * message must never be able to run as another user's agent.
   */
  requireOwner(userId: number): TelegramSettings {
    const settings = this.settings();
    if (settings.ownerUserId !== null && settings.ownerUserId !== userId) {
      throw new TelegramError(403, "Telegram is linked to a different Breadboard account.");
    }
    return settings;
  }

  claimOwner(userId: number): TelegramSettings {
    const settings = this.requireOwner(userId);
    if (settings.ownerUserId === userId) return settings;
    this.db
      .prepare(
        "UPDATE telegram_settings SET owner_user_id = ?, updated_at = datetime('now') WHERE id = 1",
      )
      .run(userId);
    return this.settings();
  }

  updateSettings(input: { allowedUsers?: unknown; autostart?: unknown }): TelegramSettings {
    const current = this.settings();
    const allowed =
      input.allowedUsers === undefined
        ? current.allowedUsers
        : parseAllowedUsers(
            Array.isArray(input.allowedUsers)
              ? input.allowedUsers.join(",")
              : input.allowedUsers,
          );
    const autostart =
      input.autostart === undefined ? current.autostart : input.autostart !== false;
    this.db
      .prepare(
        `UPDATE telegram_settings
            SET allowed_users = ?, autostart = ?, updated_at = datetime('now')
          WHERE id = 1`,
      )
      .run(formatAllowedUsers(allowed), autostart ? 1 : 0);
    return this.settings();
  }

  /** Add one sender to the allowlist without disturbing the rest of it. */
  allowSender(identifier: unknown): TelegramSettings {
    const current = this.settings();
    const entry = parseAllowedUsers(identifier)[0];
    if (!entry) throw new TelegramError(400, "That is not a Telegram username or id.");
    if (current.allowedUsers.includes(entry)) return current;
    return this.updateSettings({ allowedUsers: [...current.allowedUsers, entry] });
  }

  recordBot(input: { id: string | null; username: string | null; name: string | null }): TelegramSettings {
    this.db
      .prepare(
        `UPDATE telegram_settings
            SET bot_id = ?, bot_username = ?, bot_name = ?, linked_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = 1`,
      )
      .run(input.id, input.username, input.name);
    return this.settings();
  }

  /** Forget the bot. Called when the token is removed. */
  clearBot(): TelegramSettings {
    this.db
      .prepare(
        `UPDATE telegram_settings
            SET bot_id = NULL, bot_username = NULL, bot_name = NULL, linked_at = NULL,
                last_update_id = 0, updated_at = datetime('now')
          WHERE id = 1`,
      )
      .run();
    this.db.prepare("DELETE FROM telegram_seen_messages").run();
    return this.settings();
  }

  /**
   * Acknowledge the update stream up to `updateId`. Monotonic on purpose: a late
   * write from a poll that overlapped a restart must not rewind the offset and
   * replay messages that have already been answered.
   */
  recordOffset(updateId: unknown): number {
    const next = Number(updateId);
    if (!Number.isFinite(next) || next <= 0) return this.settings().lastUpdateId;
    this.db
      .prepare(
        `UPDATE telegram_settings
            SET last_update_id = ?, updated_at = datetime('now')
          WHERE id = 1 AND last_update_id < ?`,
      )
      .run(Math.floor(next), Math.floor(next));
    return this.settings().lastUpdateId;
  }

  getChat(chatId: string): TelegramChatRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM telegram_chats WHERE chat_id = ?")
        .get(chatId) as TelegramChatRow | undefined) ?? null
    );
  }

  upsertChat(input: {
    chatId: string;
    userId: number;
    contactLabel: string;
    contactHandle: string;
    isGroup: boolean;
  }): TelegramChatRow {
    this.db
      .prepare(
        `INSERT INTO telegram_chats
           (chat_id, user_id, contact_label, contact_handle, is_group)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
           contact_label = excluded.contact_label,
           contact_handle = excluded.contact_handle,
           is_group = excluded.is_group`,
      )
      .run(
        input.chatId,
        input.userId,
        input.contactLabel,
        input.contactHandle,
        input.isGroup ? 1 : 0,
      );
    return this.getChat(input.chatId)!;
  }

  bindConversation(chatId: string, conversationId: number): TelegramChatRow {
    this.db
      .prepare(
        `UPDATE telegram_chats
            SET conversation_id = ?, message_count = message_count + 1,
                last_message_at = datetime('now')
          WHERE chat_id = ?`,
      )
      .run(conversationId, chatId);
    return this.getChat(chatId)!;
  }

  listChats(userId: number, limit = 25): TelegramChatRow[] {
    return this.db
      .prepare(
        `SELECT * FROM telegram_chats
          WHERE user_id = ?
          ORDER BY last_message_at DESC, id DESC
          LIMIT ?`,
      )
      .all(userId, Math.max(1, Math.min(200, limit))) as TelegramChatRow[];
  }

  /**
   * Claim an update id. Returns false when it was already handled, which is how
   * a replayed backlog is prevented from running a turn twice.
   */
  claimMessage(messageId: string): boolean {
    if (!messageId) return true;
    const result = this.db
      .prepare("INSERT OR IGNORE INTO telegram_seen_messages (message_id) VALUES (?)")
      .run(messageId);
    if (result.changes === 0) return false;
    // Keep the dedupe table bounded; ids older than the newest 5,000 are already
    // behind the acknowledged offset and cannot be replayed.
    this.db
      .prepare(
        `DELETE FROM telegram_seen_messages
          WHERE message_id NOT IN (
            SELECT message_id FROM telegram_seen_messages
             ORDER BY seen_at DESC, rowid DESC LIMIT 5000
          )`,
      )
      .run();
    return true;
  }
}
