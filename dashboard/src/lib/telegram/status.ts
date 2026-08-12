// The single status payload every Telegram route and the Settings panel read.
//
// The bot token is not in it, and never will be: the browser learns that a token
// exists and which bot it resolved to, which is everything the panel has to
// render and nothing an attacker could use to read the bot's messages.

import { telegramFeatureEnabled } from "./config.ts";
import { hasBotToken, tokenIsFromEnvironment } from "./credentials.ts";
import { getTelegramGateway, type TelegramBlockedSender, type TelegramGatewayState } from "./gateway.ts";
import { getTelegramStore } from "./instance.ts";
import type { TelegramChatRow } from "./store.ts";

export interface TelegramChatSummary {
  chatId: string;
  label: string;
  handle: string;
  isGroup: boolean;
  messageCount: number;
  lastMessageAt: string;
}

export interface TelegramStatus {
  available: boolean;
  unavailableReason: string | null;
  state: TelegramGatewayState;
  error: string | null;
  /** A token is stored, so connecting needs no further input. */
  linked: boolean;
  /** The token came from the deployment and cannot be removed from the app. */
  tokenFromEnvironment: boolean;
  botUsername: string | null;
  botName: string | null;
  linkedAt: string | null;
  allowedUsers: string[];
  autostart: boolean;
  /** True when another Breadboard account owns the linked bot. */
  managedByAnotherUser: boolean;
  /** Senders the allowlist turned away, newest first. */
  blocked: TelegramBlockedSender[];
  chats: TelegramChatSummary[];
}

function presentChat(row: TelegramChatRow): TelegramChatSummary {
  return {
    chatId: row.chat_id,
    label: row.contact_label || row.contact_handle || "Telegram",
    handle: row.contact_handle,
    isGroup: row.is_group === 1,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
  };
}

export function telegramStatus(userId: number): TelegramStatus {
  const store = getTelegramStore();
  const settings = store.settings();
  const snapshot = getTelegramGateway().snapshot();
  const owned = settings.ownerUserId === null || settings.ownerUserId === userId;

  return {
    available: telegramFeatureEnabled(),
    unavailableReason: telegramFeatureEnabled()
      ? null
      : "Telegram is switched off for this installation.",
    state: snapshot.state,
    error: owned ? snapshot.error : null,
    linked: hasBotToken(),
    tokenFromEnvironment: tokenIsFromEnvironment(),
    botUsername: settings.botUsername,
    botName: settings.botName,
    linkedAt: settings.linkedAt,
    allowedUsers: owned ? settings.allowedUsers : [],
    autostart: settings.autostart,
    managedByAnotherUser: !owned,
    blocked: owned ? snapshot.blocked : [],
    chats: owned ? store.listChats(userId).map(presentChat) : [],
  };
}
