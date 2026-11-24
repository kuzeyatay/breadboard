import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ChatNotificationRecord } from "../chat-notification-inbox.ts";
import { chatNotificationMessageId, chatNotificationDeliveryId, ensureChatNotificationSchema, listPendingChatNotifications } from "../chat-notifications/store.ts";
import { ensureLearnNotificationSchema, listPendingLearnNotifications } from "../chat-notifications/learn.ts";
import { listPendingQuestionNotifications } from "../chat-notifications/questions.ts";
import { TelegramStore } from "../telegram/store.ts";
import { resolveTelegramSelfTarget, type SelfTargetResult } from "../messaging/self-target.ts";
import { WhatsAppStore } from "../whatsapp/store.ts";
import { normalizeWhatsAppIdentifier, senderIsAllowed as whatsAppSenderIsAllowed } from "../whatsapp/identity.ts";
import type { MessagingNotificationSettings, NotificationChannel } from "./types.ts";

interface PreferenceRow {
  enabled: number;
  recipient: string;
  link_id: string;
  enabled_at: number;
  chat_completions_since: number | null;
  revision: string;
  last_error: string | null;
  last_sent_at: string | null;
}

export class MessagingNotificationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function notificationTime(value: string): number {
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

/** A single bounded message, so retries cannot repeat the first half of a split reply. */
export function formatMessagingNotification(notice: ChatNotificationRecord): string {
  const text = [notice.title, notice.chatTitle.trim(), notice.message || notice.response]
    .filter(Boolean).join("\n\n").trim();
  return text.length > 3_500 ? `${text.slice(0, 3_499).trimEnd()}…` : text;
}

export class MessagingNotificationStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    ensureChatNotificationSchema(db);
    ensureLearnNotificationSchema(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS messaging_notification_settings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel TEXT NOT NULL CHECK(channel IN ('whatsapp', 'telegram')),
        enabled INTEGER NOT NULL DEFAULT 0,
        recipient TEXT NOT NULL DEFAULT '',
        link_id TEXT NOT NULL DEFAULT '',
        enabled_at INTEGER NOT NULL DEFAULT 0,
        chat_completions_since INTEGER DEFAULT 0,
        revision TEXT NOT NULL,
        last_error TEXT,
        last_sent_at TEXT,
        PRIMARY KEY(user_id, channel)
      );
      CREATE TABLE IF NOT EXISTS messaging_notification_deliveries (
        user_id INTEGER NOT NULL,
        channel TEXT NOT NULL,
        notification_id TEXT NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        retry_at INTEGER NOT NULL DEFAULT 0,
        claim_id TEXT,
        PRIMARY KEY(user_id, channel, notification_id),
        FOREIGN KEY(user_id, channel) REFERENCES messaging_notification_settings(user_id, channel) ON DELETE CASCADE
      );
    `);
    db.transaction(() => {
      const columns = db.pragma("table_info(messaging_notification_settings)") as { name: string }[];
      if (!columns.some(column => column.name === "chat_completions_since")) {
        db.exec("ALTER TABLE messaging_notification_settings ADD COLUMN chat_completions_since INTEGER DEFAULT 0");
      }
    }).immediate();
  }

  private preference(userId: number, channel: NotificationChannel): PreferenceRow | undefined {
    return this.db.prepare("SELECT * FROM messaging_notification_settings WHERE user_id = ? AND channel = ?")
      .get(userId, channel) as PreferenceRow | undefined;
  }

  private telegramConnection(userId: number) {
    const store = new TelegramStore(this.db);
    const settings = store.settings();
    if (settings.ownerUserId !== userId) return { linkId: "", chats: [] };
    return { linkId: settings.botId ?? "", chats: store.allowedPrivateChats(userId, settings.allowedUsers) };
  }

  /** Use the chosen destination for reminders and reviews even if inbox forwarding is off. */
  telegramOwnerTarget(userId: number): SelfTargetResult {
    const { linkId, chats } = this.telegramConnection(userId);
    const preference = this.preference(userId, "telegram");
    if (preference?.recipient && preference.link_id !== linkId && linkId) {
      return { ok: false, reason: "telegram_choose_owner_chat" };
    }
    return resolveTelegramSelfTarget({
      linked: Boolean(linkId), ownerUserId: userId, chats, selectedChatId: preference?.recipient,
    });
  }

  /** Destinations are explicit private chats owned by this account; never broadcast to an allowlist. */
  private connection(userId: number, channel: NotificationChannel) {
    if (channel === "telegram") {
      const { linkId, chats } = this.telegramConnection(userId);
      return {
        linkId,
        recipients: chats.map(chat => ({ id: chat.chat_id, label: chat.contact_label || chat.contact_handle || chat.chat_id })),
      };
    }
    const store = new WhatsAppStore(this.db);
    const settings = store.settings();
    if (settings.ownerUserId !== userId) return { linkId: "", recipients: [] };
    const number = normalizeWhatsAppIdentifier(settings.linkedNumber);
    const self = number ? [{ id: `${number}@s.whatsapp.net`, label: `Your WhatsApp · +${number}` }] : [];
    const chats = settings.mode === "bot" ? store.listChats(userId)
      .filter(chat => chat.is_group === 0 && whatsAppSenderIsAllowed(chat.contact_number, settings.allowedNumbers, settings.mode))
      .map(chat => ({ id: chat.chat_id, label: `${chat.contact_label || "WhatsApp"} · +${chat.contact_number}` })) : [];
    return { linkId: number, recipients: [...new Map([...self, ...chats].map(item => [item.id, item])).values()] };
  }

  settings(userId: number, channel: NotificationChannel): MessagingNotificationSettings {
    const row = this.preference(userId, channel);
    const connection = this.connection(userId, channel);
    const valid = Boolean(connection.linkId && row?.link_id === connection.linkId &&
      connection.recipients.some(item => item.id === row.recipient));
    return {
      enabled: row?.enabled === 1,
      includeChatCompletions: row?.chat_completions_since !== null,
      recipient: row?.recipient ?? "",
      recipients: connection.recipients,
      available: Boolean(connection.linkId && connection.recipients.length),
      lastError: row?.enabled && !valid ? "Choose your chat again after reconnecting or changing who can talk to this app." : row?.last_error ?? null,
      lastSentAt: row?.last_sent_at ?? null,
    };
  }

  private pending(userId: number, chatCompletionsSince: number | null = 0): ChatNotificationRecord[] {
    // Phone reminders and review replies are saved for continuing their chats.
    // Keep those local notices, but never forward the delivered transcript back
    // to either phone channel as a second "Response ready" message.
    const excluded = this.db.prepare(`SELECT 1 FROM conversation_messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = ? AND c.user_id = ?
        AND (json_extract(CASE WHEN json_valid(m.metadata) THEN m.metadata ELSE '{}' END,
          '$.externalMessagingChannel') IN ('telegram', 'whatsapp')
          OR (? AND (c.scheduled_chat_job_id IS NULL OR coalesce(m.client_message_id, '') NOT LIKE 'schedule-%')))`);
    const messages = listPendingChatNotifications(this.db, userId).filter(notice => {
      const messageId = chatNotificationMessageId(notice.id);
      const mutedCompletion = notice.type === "success" &&
        (chatCompletionsSince === null || notificationTime(notice.updatedAt) < chatCompletionsSince);
      return messageId === null || !excluded.get(messageId, userId, Number(mutedCompletion));
    });
    return [...messages, ...listPendingQuestionNotifications(this.db, userId), ...listPendingLearnNotifications(this.db, userId)];
  }

  update(userId: number, channel: NotificationChannel, input: { enabled?: unknown; recipient?: unknown; includeChatCompletions?: unknown }): MessagingNotificationSettings {
    if (typeof input.enabled !== "boolean" || (input.recipient !== undefined && typeof input.recipient !== "string")) {
      throw new MessagingNotificationError(400, "Choose a notification switch and a chat.");
    }
    if (input.includeChatCompletions !== undefined && typeof input.includeChatCompletions !== "boolean") {
      throw new MessagingNotificationError(400, "Choose whether to send completed chat alerts.");
    }
    const current = this.preference(userId, channel);
    const connection = this.connection(userId, channel);
    const recipient = typeof input.recipient === "string" ? input.recipient : current?.recipient ?? "";
    if (input.enabled && (!connection.linkId || !connection.recipients.some(item => item.id === recipient))) {
      throw new MessagingNotificationError(400, "Connect this messaging app and choose your private chat first.");
    }
    this.db.transaction(() => {
      const reset = input.enabled && (current?.enabled !== 1 || current.recipient !== recipient || current.link_id !== connection.linkId);
      this.db.prepare(`
        INSERT INTO messaging_notification_settings (user_id, channel, enabled, recipient, link_id, enabled_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, channel) DO UPDATE SET enabled = excluded.enabled, recipient = excluded.recipient,
          link_id = excluded.link_id, enabled_at = excluded.enabled_at, revision = excluded.revision, last_error = NULL
      `).run(userId, channel, input.enabled ? 1 : 0, recipient, connection.linkId,
        reset ? Math.floor(Date.now() / 1_000) * 1_000 : current?.enabled_at ?? 0, randomUUID());
      if (typeof input.includeChatCompletions === "boolean") {
        // NULL mutes completions. On re-enabling, only new answers should reach the phone.
        this.db.prepare(`UPDATE messaging_notification_settings SET chat_completions_since =
          CASE WHEN ? THEN coalesce(chat_completions_since, ?) ELSE NULL END
          WHERE user_id = ? AND channel = ?`)
          .run(Number(input.includeChatCompletions), Date.now(), userId, channel);
      }
      if (reset) {
        // Initialize the shared inbox baseline and skip its current contents.
        // The timestamp also excludes older notices that enter the bounded inbox later.
        this.db.prepare("DELETE FROM messaging_notification_deliveries WHERE user_id = ? AND channel = ?").run(userId, channel);
        const skip = this.db.prepare(`INSERT OR IGNORE INTO messaging_notification_deliveries
          (user_id, channel, notification_id, state) VALUES (?, ?, ?, 'skipped')`);
        for (const notice of this.pending(userId)) skip.run(userId, channel, chatNotificationDeliveryId(this.db, userId, notice.id));
      }
    })();
    return this.settings(userId, channel);
  }

  /** Called by the native-owned gateway loop, independent of any open browser window. */
  async deliver(userId: number, channel: NotificationChannel, send: (recipient: string, text: string) => Promise<void>): Promise<void> {
    const initial = this.preference(userId, channel);
    if (initial?.enabled !== 1) return;
    const connection = this.connection(userId, channel);
    if (!connection.linkId || initial.link_id !== connection.linkId || !connection.recipients.some(item => item.id === initial.recipient)) return;
    const pending = this.pending(userId, initial.chat_completions_since)
      .filter(notice => notificationTime(notice.updatedAt) >= initial.enabled_at);
    let attempted = 0;
    for (const notice of pending) {
      const current = this.preference(userId, channel);
      if (current?.enabled !== 1 || current.revision !== initial.revision) return;
      const latestConnection = this.connection(userId, channel);
      if (latestConnection.linkId !== initial.link_id || !latestConnection.recipients.some(item => item.id === initial.recipient)) return;
      const now = Date.now();
      const claimId = randomUUID();
      const claimed = this.db.prepare(`
        INSERT INTO messaging_notification_deliveries (user_id, channel, notification_id, state, attempts, retry_at, claim_id)
        VALUES (?, ?, ?, 'sending', 1, ?, ?)
        ON CONFLICT(user_id, channel, notification_id) DO UPDATE SET state = 'sending', attempts = attempts + 1,
          retry_at = excluded.retry_at, claim_id = excluded.claim_id
        WHERE state IN ('retry', 'sending') AND attempts < 3 AND retry_at <= ?
      `).run(userId, channel, chatNotificationDeliveryId(this.db, userId, notice.id), now + 5 * 60_000, claimId, now).changes;
      if (!claimed) continue;
      try {
        await send(initial.recipient, formatMessagingNotification(notice));
        this.db.prepare("UPDATE messaging_notification_deliveries SET state = 'sent' WHERE claim_id = ?").run(claimId);
        this.db.prepare(`UPDATE messaging_notification_settings SET last_error = NULL, last_sent_at = ?
          WHERE user_id = ? AND channel = ? AND revision = ?`)
          .run(new Date().toISOString(), userId, channel, initial.revision);
      } catch {
        // Provider errors may contain addresses or credentials; expose only a stable message.
        this.db.prepare(`UPDATE messaging_notification_deliveries SET state = 'retry', retry_at = ? WHERE claim_id = ?`)
          .run(Date.now() + 60_000, claimId);
        this.db.prepare(`UPDATE messaging_notification_settings SET last_error = ? WHERE user_id = ? AND channel = ? AND revision = ?`)
          .run("A notification could not be delivered. Check the connection; Breadboard retries up to three times.", userId, channel, initial.revision);
      }
      // Keep the gateway responsive even when many tasks complete together.
      if (++attempted >= 4) break;
    }
  }
}
