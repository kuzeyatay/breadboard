// The decisions taken about an inbound Telegram message before any of it reaches
// the chat pipeline: does it open a new chat or continue one, and what does the
// agent actually get to read.
//
// Kept apart from inbound.ts so it can be tested on its own — inbound.ts pulls in
// the whole conversation/runtime stack, including the app database.

export { conversationIsSameDay } from "../conversations/messaging-days.ts";
import type { TelegramInboundMessage } from "./gateway.ts";
import { attachmentMessageText } from "../messaging-attachments/types.ts";

export const HELP_TEXT = [
  "You are talking to Breadboard.",
  "",
  "Messages from this thread share one daily chat in the Breadboard app.",
  "Send photos, voice messages, videos, stickers, files, contacts, locations or polls with an optional caption.",
  "",
  "/new — start a fresh chat",
  "/help — show this",
].join("\n");

/**
 * Captions remain user text; file bytes are prepared separately before dispatch.
 */
export function messageText(message: TelegramInboundMessage): string {
  return attachmentMessageText(message);
}
