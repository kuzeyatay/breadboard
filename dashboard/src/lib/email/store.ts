// Reading and writing the email channel's link state.

import type Database from "better-sqlite3";

import db from "../db.ts";

export interface EmailSettings {
  ownerUserId: number | null;
  allowedSenders: string[];
  autostart: boolean;
  address: string | null;
  linkedAt: string | null;
  lastPollAt: string | null;
  lastError: string | null;
}

export interface EmailThreadRow {
  id: number;
  address: string;
  user_id: number;
  conversation_id: number | null;
  contact_label: string;
  last_message_id: string;
  last_subject: string;
  message_count: number;
  first_seen_at: string;
  last_message_at: string;
}

export function readSettings(database: Database.Database = db): EmailSettings {
  const row = database
    .prepare(
      `SELECT owner_user_id, allowed_senders, autostart, address, linked_at,
              last_poll_at, last_error
       FROM email_settings WHERE id = 1`,
    )
    .get() as
    | {
        owner_user_id: number | null;
        allowed_senders: string;
        autostart: number;
        address: string | null;
        linked_at: string | null;
        last_poll_at: string | null;
        last_error: string | null;
      }
    | undefined;

  return {
    ownerUserId: row?.owner_user_id ?? null,
    allowedSenders: (row?.allowed_senders ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
    autostart: row?.autostart === 1,
    address: row?.address ?? null,
    linkedAt: row?.linked_at ?? null,
    lastPollAt: row?.last_poll_at ?? null,
    lastError: row?.last_error ?? null,
  };
}

export function saveSettings(
  input: Partial<Omit<EmailSettings, "allowedSenders">> & { allowedSenders?: string[] },
  database: Database.Database = db,
): EmailSettings {
  const current = readSettings(database);
  const next = {
    ownerUserId: input.ownerUserId === undefined ? current.ownerUserId : input.ownerUserId,
    allowedSenders: input.allowedSenders ?? current.allowedSenders,
    autostart: input.autostart ?? current.autostart,
    address: input.address === undefined ? current.address : input.address,
    linkedAt: input.linkedAt === undefined ? current.linkedAt : input.linkedAt,
    lastPollAt: input.lastPollAt === undefined ? current.lastPollAt : input.lastPollAt,
    lastError: input.lastError === undefined ? current.lastError : input.lastError,
  };
  database
    .prepare(
      `UPDATE email_settings
       SET owner_user_id = ?, allowed_senders = ?, autostart = ?, address = ?,
           linked_at = ?, last_poll_at = ?, last_error = ?, updated_at = datetime('now')
       WHERE id = 1`,
    )
    .run(
      next.ownerUserId,
      next.allowedSenders.join(","),
      next.autostart ? 1 : 0,
      next.address,
      next.linkedAt,
      next.lastPollAt,
      next.lastError,
    );
  return next;
}

/**
 * Whether an address may write to the assistant.
 *
 * Closed by default and closed on misconfiguration: with no owner there is
 * nobody to answer as, so nothing is answered. The owner's own address is
 * always allowed, since linking a mailbox you own and then not being able to
 * write to it from it would be absurd.
 */
export function senderIsAllowed(
  address: string,
  settings: EmailSettings,
  ownerAddress: string | null,
): boolean {
  if (settings.ownerUserId === null) return false;
  const normalized = address.trim().toLowerCase();
  if (!normalized) return false;
  if (ownerAddress && normalized === ownerAddress.trim().toLowerCase()) return true;
  return settings.allowedSenders.includes(normalized);
}

export function getThread(
  address: string,
  database: Database.Database = db,
): EmailThreadRow | null {
  const row = database
    .prepare(`SELECT * FROM email_threads WHERE address = ?`)
    .get(address.trim().toLowerCase()) as EmailThreadRow | undefined;
  return row ?? null;
}

export function recordInbound(
  input: { address: string; userId: number; label: string; messageId: string; subject: string },
  database: Database.Database = db,
): EmailThreadRow {
  const address = input.address.trim().toLowerCase();
  database
    .prepare(
      `INSERT INTO email_threads
         (address, user_id, contact_label, last_message_id, last_subject, message_count)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(address) DO UPDATE SET
         contact_label = CASE WHEN excluded.contact_label <> '' THEN excluded.contact_label
                              ELSE email_threads.contact_label END,
         last_message_id = excluded.last_message_id,
         last_subject = excluded.last_subject,
         message_count = email_threads.message_count + 1,
         last_message_at = datetime('now')`,
    )
    .run(address, input.userId, input.label, input.messageId, input.subject.slice(0, 300));
  return getThread(address, database)!;
}

export function bindConversation(
  address: string,
  conversationId: number,
  database: Database.Database = db,
): void {
  database
    .prepare(`UPDATE email_threads SET conversation_id = ? WHERE address = ?`)
    .run(conversationId, address.trim().toLowerCase());
}

/** True the first time a Message-ID is seen; false every time after. */
export function claimMessage(messageId: string, database: Database.Database = db): boolean {
  const id = messageId.trim();
  if (!id) return false;
  const result = database
    .prepare(`INSERT OR IGNORE INTO email_seen_messages (message_id) VALUES (?)`)
    .run(id);
  return result.changes > 0;
}

export function listThreads(
  userId: number,
  database: Database.Database = db,
): EmailThreadRow[] {
  return database
    .prepare(
      `SELECT * FROM email_threads WHERE user_id = ? ORDER BY last_message_at DESC LIMIT 50`,
    )
    .all(userId) as EmailThreadRow[];
}

/** Drop seen-message rows older than a month; the mailbox no longer has them. */
export function pruneSeen(database: Database.Database = db): void {
  database
    .prepare(`DELETE FROM email_seen_messages WHERE seen_at < datetime('now', '-30 days')`)
    .run();
}
