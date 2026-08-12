// The decisions taken about an inbound WhatsApp message before any of it reaches
// the chat pipeline: does it open a new chat or continue one, and what does the
// agent actually get to read.
//
// Kept apart from inbound.ts so it can be tested on its own — inbound.ts pulls in
// the whole conversation/runtime stack, including the app database.

import { whatsAppNewChatAfterMs } from "./config.ts";
import type { WhatsAppInboundMessage } from "./bridge.ts";

/** WhatsApp's practical display limit; the bridge chunks anything longer. */
export const MAX_REPLY_CHARS = 4_000;

export const HELP_TEXT = [
  "You are talking to Breadboard.",
  "",
  "Every message opens or continues a chat you can also see in the Breadboard app.",
  "",
  "*/new* — start a fresh chat",
  "*/help* — show this",
].join("\n");

/**
 * A WhatsApp thread keeps writing into the same Breadboard chat while it stays
 * warm. Once it has been quiet longer than the window, the next message opens a
 * new chat — the same instinct as picking up a conversation the next morning.
 */
export function conversationIsWarm(lastMessageAt: string, now: Date): boolean {
  const window = whatsAppNewChatAfterMs();
  if (window <= 0) return false;
  // SQLite writes `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker.
  const parsed = Date.parse(
    lastMessageAt.includes("T") ? lastMessageAt : `${lastMessageAt.replace(" ", "T")}Z`,
  );
  if (!Number.isFinite(parsed)) return false;
  return now.getTime() - parsed < window;
}

/**
 * What the agent reads. Media cannot be opened yet, so it is described rather
 * than silently dropped — an agent answering "what does this say?" about an image
 * it never received would be worse than one that says it cannot see it.
 */
export function messageText(message: WhatsAppInboundMessage): string {
  const body = message.body.trim();
  if (!message.hasMedia) return body;
  const label = message.fileName
    ? `${message.mediaType || "file"} “${message.fileName}”`
    : message.mediaType || "attachment";
  const note = `[The sender attached a ${label}. Breadboard cannot open WhatsApp attachments yet — ask them to share it in the app if you need it.]`;
  return body ? `${body}\n\n${note}` : note;
}
