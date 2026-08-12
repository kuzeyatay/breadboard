// Telegram identities, normalized once so an allowlist written in the panel
// means the same thing as the ids arriving on the wire.
//
// Telegram identifies a person two ways: a numeric user id, which never changes
// and is what the API sends, and an optional @username, which is what a human
// knows about themselves. Both are accepted; usernames are matched
// case-insensitively because Telegram treats them that way.

export type TelegramAllowEntry = string;

/** Reduce a username, id, or allowlist entry to its comparable form. */
export function normalizeTelegramIdentifier(value: unknown): string {
  const text = String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, "");
  if (text === "*") return "*";
  return /^-?\d+$/.test(text) ? text : text.toLowerCase();
}

/** Parse a comma/space/newline separated allowlist into normalized entries. */
export function parseAllowedUsers(raw: unknown): string[] {
  const entries = String(raw ?? "")
    .split(/[,\s;]+/)
    .map((entry) => normalizeTelegramIdentifier(entry))
    .filter(Boolean);
  return [...new Set(entries)];
}

/** How the allowlist is stored, and how the panel shows it back. */
export function formatAllowedUsers(users: readonly string[]): string {
  return users.join(",");
}

/**
 * Breadboard's own gate. A bot token is a public endpoint — anyone who learns
 * the bot's @name can message it — so an empty allowlist means nobody, not
 * everybody. `*` is the explicit opt-in to answering strangers.
 */
export function senderIsAllowed(
  sender: { senderId?: unknown; senderUsername?: unknown },
  allowed: readonly string[],
): boolean {
  if (allowed.includes("*")) return true;
  const id = normalizeTelegramIdentifier(sender.senderId);
  const username = normalizeTelegramIdentifier(sender.senderUsername);
  return (
    (id.length > 0 && allowed.includes(id)) ||
    (username.length > 0 && allowed.includes(username))
  );
}

export function isGroupChat(chatType: unknown): boolean {
  const type = String(chatType ?? "");
  return type === "group" || type === "supergroup";
}

/** A human label for a chat: the sender's name, else their @handle, else the id. */
export function contactLabel(input: {
  senderName?: unknown;
  senderUsername?: unknown;
  chatTitle?: unknown;
  senderId?: unknown;
  chatId?: unknown;
  isGroup?: unknown;
}): string {
  if (input.isGroup) {
    const title = typeof input.chatTitle === "string" ? input.chatTitle.trim() : "";
    if (title) return title.slice(0, 60);
  }
  const name = typeof input.senderName === "string" ? input.senderName.trim() : "";
  if (name) return name.slice(0, 60);
  const username = normalizeTelegramIdentifier(input.senderUsername);
  if (username) return `@${username}`;
  const id = normalizeTelegramIdentifier(input.senderId ?? input.chatId);
  return id ? `Telegram ${id}` : "Telegram";
}

/** Title for the Breadboard conversation a Telegram thread opens. */
export function conversationTitleFor(label: string, firstMessage: string): string {
  const summary = firstMessage.replace(/\s+/g, " ").trim().slice(0, 60);
  const title = summary ? `Telegram · ${label}: ${summary}` : `Telegram · ${label}`;
  return title.slice(0, 120);
}

/** The handle stored alongside a chat: @username when there is one, else the id. */
export function contactHandle(input: {
  senderUsername?: unknown;
  senderId?: unknown;
  chatId?: unknown;
}): string {
  const username = normalizeTelegramIdentifier(input.senderUsername);
  if (username) return `@${username}`;
  return normalizeTelegramIdentifier(input.senderId ?? input.chatId);
}
