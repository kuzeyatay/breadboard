// Where "send this to my WhatsApp" and "send this to my Telegram" actually go.
//
// Both messaging links were built inbound-first: a message arrives, Breadboard
// answers it, and the reply goes back to the chat it came from. Sending on the
// user's own initiative is the other direction, and it needs something the
// inbound path never had to work out — a destination. This module is that
// decision, and only that decision, so it can be unit-tested without a bridge,
// a bot token, or a database.
//
// The rule for both channels is the same: the only destination Breadboard will
// pick on its own is the owner's own thread. Not a contact, not a group, not a
// number the model wrote down. That keeps an outbound send incapable of
// reaching a third party even if the model is talked into trying.

/** A resolved place to send to, plus how it was chosen (for the receipt). */
export interface SelfTarget {
  chatId: string;
  label: string;
  /** How the destination was found, so a failure can be explained precisely. */
  via: "observed-self-chat" | "linked-number" | "owner-private-chat";
}

export type SelfTargetFailure =
  | "whatsapp_not_linked"
  | "whatsapp_self_chat_unknown"
  | "telegram_not_linked"
  | "telegram_no_owner_chat";

export type SelfTargetResult =
  | { ok: true; target: SelfTarget }
  | { ok: false; reason: SelfTargetFailure };

/** The subset of a `whatsapp_chats` row this decision needs. */
export interface WhatsAppChatCandidate {
  chat_id: string;
  contact_number: string;
  contact_label: string;
  is_group: number;
  last_message_at: string;
}

/** The subset of a `telegram_chats` row this decision needs. */
export interface TelegramChatCandidate {
  chat_id: string;
  user_id: number;
  contact_label: string;
  contact_handle: string;
  is_group: number;
  last_message_at: string;
}

function newestFirst<T extends { last_message_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) =>
    right.last_message_at.localeCompare(left.last_message_at),
  );
}

/**
 * The owner's own WhatsApp thread.
 *
 * Preferred source is a JID Breadboard has actually seen inbound for the linked
 * number, because a self-chat can legitimately arrive as either
 * `<number>@s.whatsapp.net` or `<number>@lid` — WhatsApp's linked-identity
 * domain — and only one of those will deliver. A JID assembled from the stored
 * number is the fallback for the case where the user has linked the device but
 * never messaged themselves yet; it is correct for ordinary accounts and is the
 * best guess available when there is nothing observed to copy.
 *
 * `normalize` is injected rather than imported so this module stays free of the
 * WhatsApp stack; callers pass `normalizeWhatsAppIdentifier`.
 */
export function resolveWhatsAppSelfTarget(input: {
  linkedNumber: string | null;
  linkedName?: string | null;
  chats: readonly WhatsAppChatCandidate[];
  normalize: (value: unknown) => string;
}): SelfTargetResult {
  const linked = input.normalize(input.linkedNumber);
  if (!linked) return { ok: false, reason: "whatsapp_not_linked" };

  const observed = newestFirst(input.chats).find(
    (chat) =>
      chat.is_group !== 1 &&
      Boolean(chat.chat_id) &&
      input.normalize(chat.contact_number) === linked,
  );
  if (observed) {
    return {
      ok: true,
      target: {
        chatId: observed.chat_id,
        label: input.linkedName?.trim() || observed.contact_label || `+${linked}`,
        via: "observed-self-chat",
      },
    };
  }

  return {
    ok: true,
    target: {
      chatId: `${linked}@s.whatsapp.net`,
      label: input.linkedName?.trim() || `+${linked}`,
      via: "linked-number",
    },
  };
}

/**
 * The owner's own Telegram thread.
 *
 * There is no self-chat to fall back on here and no way to construct a
 * destination: a bot cannot open a conversation, so a chat id only exists once
 * the owner has messaged the bot at least once. When they have not, that is a
 * real, reportable state — "message your bot once and I can reach you" — rather
 * than a guess that would fail at the API.
 *
 * Group chats are excluded even when the owner is in them: "my Telegram" means
 * the private thread, and sending a chat's contents to a group is exactly the
 * accident this module exists to make impossible.
 */
export function resolveTelegramSelfTarget(input: {
  linked: boolean;
  ownerUserId: number | null;
  chats: readonly TelegramChatCandidate[];
}): SelfTargetResult {
  if (!input.linked) return { ok: false, reason: "telegram_not_linked" };
  if (input.ownerUserId === null) return { ok: false, reason: "telegram_no_owner_chat" };

  const owned = newestFirst(input.chats).find(
    (chat) =>
      chat.is_group !== 1 &&
      chat.user_id === input.ownerUserId &&
      Boolean(chat.chat_id) &&
      // A private chat id is Telegram's positive user id; the negative ids are
      // groups and supergroups, which `is_group` should already have excluded.
      !chat.chat_id.startsWith("-"),
  );
  if (!owned) return { ok: false, reason: "telegram_no_owner_chat" };

  return {
    ok: true,
    target: {
      chatId: owned.chat_id,
      label: owned.contact_label || owned.contact_handle || "Telegram",
      via: "owner-private-chat",
    },
  };
}

/** What the user is told when there is nowhere to send. */
export function explainSelfTargetFailure(reason: SelfTargetFailure): string {
  switch (reason) {
    case "whatsapp_not_linked":
      return "WhatsApp is not linked yet. Open Settings → Messaging → WhatsApp and pair your phone with the QR code.";
    case "whatsapp_self_chat_unknown":
      return "WhatsApp is linked but Breadboard has not seen your own chat yet. Message yourself once on WhatsApp and try again.";
    case "telegram_not_linked":
      return "Telegram is not linked yet. Open Settings → Messaging → Telegram and link your bot with its BotFather token.";
    case "telegram_no_owner_chat":
      return "Telegram bots cannot start a conversation, so there is no chat to send to yet. Message your bot once from Telegram and try again.";
  }
}
