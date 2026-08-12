// SQLite-backed persistence for the WhatsApp link. A plain class over an injected
// database handle (matching src/lib/schedules/store.ts) so it can be unit-tested
// against an in-memory database.

import type DatabaseType from "better-sqlite3";

import { ensureWhatsAppSchema } from "./schema.ts";
import {
  formatAllowedNumbers,
  normalizeWhatsAppMode,
  parseAllowedNumbers,
  type WhatsAppMode,
} from "./identity.ts";

type Db = DatabaseType.Database;

export class WhatsAppError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WhatsAppError";
    this.status = status;
  }
}

export interface WhatsAppSettingsRow {
  id: number;
  owner_user_id: number | null;
  mode: WhatsAppMode;
  allowed_numbers: string;
  autostart: number;
  linked_number: string | null;
  linked_name: string | null;
  linked_at: string | null;
  updated_at: string;
}

export interface WhatsAppSettings {
  ownerUserId: number | null;
  mode: WhatsAppMode;
  allowedNumbers: string[];
  autostart: boolean;
  linkedNumber: string | null;
  linkedName: string | null;
  linkedAt: string | null;
}

export interface WhatsAppChatRow {
  id: number;
  chat_id: string;
  user_id: number;
  conversation_id: number | null;
  contact_label: string;
  contact_number: string;
  is_group: number;
  message_count: number;
  first_seen_at: string;
  last_message_at: string;
}

export function presentWhatsAppSettings(row: WhatsAppSettingsRow): WhatsAppSettings {
  return {
    ownerUserId: row.owner_user_id,
    mode: normalizeWhatsAppMode(row.mode),
    allowedNumbers: parseAllowedNumbers(row.allowed_numbers),
    autostart: row.autostart === 1,
    linkedNumber: row.linked_number,
    linkedName: row.linked_name,
    linkedAt: row.linked_at,
  };
}

export class WhatsAppStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    ensureWhatsAppSchema(db);
  }

  settings(): WhatsAppSettings {
    const row = this.db
      .prepare("SELECT * FROM whatsapp_settings WHERE id = 1")
      .get() as WhatsAppSettingsRow | undefined;
    if (row) return presentWhatsAppSettings(row);
    this.db.prepare("INSERT OR IGNORE INTO whatsapp_settings (id) VALUES (1)").run();
    return this.settings();
  }

  /**
   * The linked device belongs to whoever paired it. Everyone else is refused —
   * a WhatsApp message must never be able to run as another user's agent.
   */
  requireOwner(userId: number): WhatsAppSettings {
    const settings = this.settings();
    if (settings.ownerUserId !== null && settings.ownerUserId !== userId) {
      throw new WhatsAppError(403, "WhatsApp is linked to a different Breadboard account.");
    }
    return settings;
  }

  claimOwner(userId: number): WhatsAppSettings {
    const settings = this.requireOwner(userId);
    if (settings.ownerUserId === userId) return settings;
    this.db
      .prepare(
        "UPDATE whatsapp_settings SET owner_user_id = ?, updated_at = datetime('now') WHERE id = 1",
      )
      .run(userId);
    return this.settings();
  }

  updateSettings(input: {
    mode?: unknown;
    allowedNumbers?: unknown;
    autostart?: unknown;
  }): WhatsAppSettings {
    const current = this.settings();
    const mode = input.mode === undefined ? current.mode : normalizeWhatsAppMode(input.mode);
    const allowed =
      input.allowedNumbers === undefined
        ? current.allowedNumbers
        : parseAllowedNumbers(
            Array.isArray(input.allowedNumbers)
              ? input.allowedNumbers.join(",")
              : input.allowedNumbers,
          );
    if (mode === "bot" && allowed.length === 0) {
      throw new WhatsAppError(
        400,
        "Bot mode needs at least one allowed number (or * to allow everyone).",
      );
    }
    const autostart =
      input.autostart === undefined ? current.autostart : input.autostart !== false;
    this.db
      .prepare(
        `UPDATE whatsapp_settings
            SET mode = ?, allowed_numbers = ?, autostart = ?, updated_at = datetime('now')
          WHERE id = 1`,
      )
      .run(mode, formatAllowedNumbers(allowed), autostart ? 1 : 0);
    return this.settings();
  }

  recordLink(input: { number: string | null; name: string | null }): WhatsAppSettings {
    this.db
      .prepare(
        `UPDATE whatsapp_settings
            SET linked_number = ?, linked_name = ?, linked_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = 1`,
      )
      .run(input.number, input.name);
    return this.settings();
  }

  /** Forget the link. Called when the device is unlinked and credentials wiped. */
  clearLink(): WhatsAppSettings {
    this.db
      .prepare(
        `UPDATE whatsapp_settings
            SET linked_number = NULL, linked_name = NULL, linked_at = NULL,
                updated_at = datetime('now')
          WHERE id = 1`,
      )
      .run();
    this.db.prepare("DELETE FROM whatsapp_seen_messages").run();
    return this.settings();
  }

  getChat(chatId: string): WhatsAppChatRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM whatsapp_chats WHERE chat_id = ?")
        .get(chatId) as WhatsAppChatRow | undefined) ?? null
    );
  }

  upsertChat(input: {
    chatId: string;
    userId: number;
    contactLabel: string;
    contactNumber: string;
    isGroup: boolean;
  }): WhatsAppChatRow {
    this.db
      .prepare(
        `INSERT INTO whatsapp_chats
           (chat_id, user_id, contact_label, contact_number, is_group)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
           contact_label = excluded.contact_label,
           contact_number = excluded.contact_number,
           is_group = excluded.is_group`,
      )
      .run(
        input.chatId,
        input.userId,
        input.contactLabel,
        input.contactNumber,
        input.isGroup ? 1 : 0,
      );
    return this.getChat(input.chatId)!;
  }

  bindConversation(chatId: string, conversationId: number): WhatsAppChatRow {
    this.db
      .prepare(
        `UPDATE whatsapp_chats
            SET conversation_id = ?, message_count = message_count + 1,
                last_message_at = datetime('now')
          WHERE chat_id = ?`,
      )
      .run(conversationId, chatId);
    return this.getChat(chatId)!;
  }

  listChats(userId: number, limit = 25): WhatsAppChatRow[] {
    return this.db
      .prepare(
        `SELECT * FROM whatsapp_chats
          WHERE user_id = ?
          ORDER BY last_message_at DESC, id DESC
          LIMIT ?`,
      )
      .all(userId, Math.max(1, Math.min(200, limit))) as WhatsAppChatRow[];
  }

  /**
   * Claim a message id. Returns false when this id was already handled, which is
   * how WhatsApp's redelivery on reconnect is prevented from running a turn twice.
   */
  claimMessage(messageId: string): boolean {
    if (!messageId) return true;
    const result = this.db
      .prepare("INSERT OR IGNORE INTO whatsapp_seen_messages (message_id) VALUES (?)")
      .run(messageId);
    if (result.changes === 0) return false;
    // Keep the dedupe table bounded; ids older than the newest 5,000 cannot be
    // redelivered by a reconnect any more.
    this.db
      .prepare(
        `DELETE FROM whatsapp_seen_messages
          WHERE message_id NOT IN (
            SELECT message_id FROM whatsapp_seen_messages
             ORDER BY seen_at DESC, rowid DESC LIMIT 5000
          )`,
      )
      .run();
    return true;
  }
}
