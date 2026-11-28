// The one call the runtime completion hook makes to extract durable memory.
//
// Modelled on loopx/conversation-tick.ts: the hook stays a single line, the
// lookups live here, and the work is deliberately detached — extraction is an
// LLM call, and a turn must never wait on it to finish streaming. Failure is
// silent by design; the canonical memory the user actually stated is written
// by paths that do not depend on this one.

import {
  conversationIsTemporary,
  getConversationById,
  listConversationMessages,
} from "../conversations/store.ts";
import db from "../db.ts";
import { parseComposerSwitches } from "../hermes/composer-switches.ts";
import { mem0Config } from "./config.ts";
import { extractDurableCandidates } from "./extraction.ts";

export function scheduleDurableExtractionForConversation(input: {
  conversationId: number | null | undefined;
  runtimeSessionId: number;
  activeGardenId?: number | null;
  outcome: "completed" | "error" | "cancelled";
}): void {
  if (input.outcome !== "completed") return;
  if (!mem0Config().extractionEnabled) return;
  if (input.conversationId === null || input.conversationId === undefined) return;

  let conversation: ReturnType<typeof getConversationById>;
  try {
    conversation = getConversationById(input.conversationId);
  } catch {
    return;
  }
  if (!conversation) return;
  if (!memoryExtractionEnabled(conversation.user_id)) return;
  // A temporary chat is the one transcript the extractor never reads.
  if (conversationIsTemporary(conversation)) return;
  // Same surfaces that own the save_memory tool. Anonymous Quartz never
  // reaches durable memory at all.
  if (
    conversation.surface !== "dashboard_terminal" &&
    conversation.surface !== "garden_chat"
  ) {
    return;
  }

  let userText = "";
  let assistantText = "";
  try {
    const messages = listConversationMessages(conversation.id, { limit: 500 })
      .filter((message) => message.status !== "pending");
    userText = lastContent(messages, "user");
    assistantText = lastContent(messages, "assistant");
  } catch {
    return;
  }
  if (!userText) return;

  void extractDurableCandidates({
    userId: conversation.user_id,
    conversationId: conversation.id,
    runtimeSessionId: input.runtimeSessionId,
    activeGardenId: input.activeGardenId ?? null,
    userText,
    assistantText,
  }).catch(() => {});
}

/**
 * The account's Settings → Memory switch. A key that was never written reads
 * as on: extraction is the default, so only an explicit "off" opts out.
 */
export function memoryExtractionEnabled(userId: number): boolean {
  try {
    const row = db
      .prepare("SELECT composer_switches FROM hermes_user_settings WHERE user_id = ?")
      .get(userId) as { composer_switches: string | null } | undefined;
    return parseComposerSwitches(row?.composer_switches).memoryExtraction !== false;
  } catch {
    return true;
  }
}

function lastContent(
  messages: Array<{ role: string; content: string }>,
  role: string,
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === role && message.content.trim()) return message.content.trim();
  }
  return "";
}
