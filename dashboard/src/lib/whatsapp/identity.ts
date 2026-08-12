// WhatsApp identifiers, normalized the same way the Hermes bridge normalizes
// them (scripts/whatsapp-bridge/allowlist.js), so an allowlist written in
// Breadboard means exactly what it means to the bridge.
//
// A WhatsApp JID is `<identifier>[:<device>]@<domain>`, where the domain is
// `s.whatsapp.net` for a phone number, `lid` for a linked identity, and `g.us`
// for a group.

export type WhatsAppMode = "self-chat" | "bot";

export const WHATSAPP_MODES: readonly WhatsAppMode[] = ["self-chat", "bot"];

export function normalizeWhatsAppMode(value: unknown): WhatsAppMode {
  return value === "bot" ? "bot" : "self-chat";
}

/** Reduce any JID, phone number, or allowlist entry to its bare identifier. */
export function normalizeWhatsAppIdentifier(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/:.*@/, "@")
    .replace(/@.*/, "")
    .replace(/^\+/, "")
    .replace(/[\s()-]/g, "");
}

export function isGroupChat(chatId: unknown): boolean {
  return String(chatId ?? "").endsWith("@g.us");
}

/** Parse a comma/space/newline separated allowlist into normalized entries. */
export function parseAllowedNumbers(raw: unknown): string[] {
  const entries = String(raw ?? "")
    .split(/[,\s;]+/)
    .map((entry) => (entry.trim() === "*" ? "*" : normalizeWhatsAppIdentifier(entry)))
    .filter(Boolean);
  return [...new Set(entries)];
}

/** The value handed to the bridge as `WHATSAPP_ALLOWED_USERS`. */
export function formatAllowedNumbers(numbers: readonly string[]): string {
  return numbers.join(",");
}

/**
 * Breadboard's own allowlist check. The bridge already gates inbound traffic,
 * but it is a separate process reading environment variables that may be stale
 * relative to the stored settings, so the decision is re-made here before any
 * message is allowed to spend tokens.
 */
export function senderIsAllowed(
  senderId: unknown,
  allowed: readonly string[],
  mode: WhatsAppMode,
): boolean {
  // Self-chat mode is inherently single-user: the bridge only forwards messages
  // the linked account sent to itself, so there is no third party to allow.
  if (mode === "self-chat") return true;
  if (allowed.includes("*")) return true;
  const normalized = normalizeWhatsAppIdentifier(senderId);
  return normalized.length > 0 && allowed.includes(normalized);
}

/** A human label for a chat: pushname when WhatsApp gave one, else the number. */
export function contactLabel(input: {
  senderName?: unknown;
  chatName?: unknown;
  senderId?: unknown;
  chatId?: unknown;
}): string {
  for (const candidate of [input.senderName, input.chatName]) {
    const text = typeof candidate === "string" ? candidate.trim() : "";
    // WhatsApp falls back to the bare number for `chatName`; that is not a name.
    if (text && !/^\+?\d[\d\s()-]*$/.test(text)) return text.slice(0, 60);
  }
  const number = normalizeWhatsAppIdentifier(input.senderId ?? input.chatId);
  return number ? `+${number}` : "WhatsApp";
}

/** Title for the Breadboard conversation a WhatsApp thread opens. */
export function conversationTitleFor(label: string, firstMessage: string): string {
  const summary = firstMessage.replace(/\s+/g, " ").trim().slice(0, 60);
  const title = summary ? `WhatsApp · ${label}: ${summary}` : `WhatsApp · ${label}`;
  return title.slice(0, 120);
}
