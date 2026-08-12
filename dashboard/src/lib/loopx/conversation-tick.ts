// The one call each runtime completion hook makes.
//
// Everything the tick needs about a turn is already in Breadboard's own tables,
// so the hooks stay a single line and the lookups live here. This is also where
// the honesty boundary sits: what the turn delivered is read from the tools that
// actually ran and the status the stream ended with, never from the answer text.

import {
  getConversationById,
  listConversationMessages,
} from "../conversations/store.ts";
import { getActiveCapabilityDecision } from "../hermes/runtime-store.ts";
import type { CapabilityMode } from "../hermes/capability-policy.ts";
import { loopxEnabled } from "./runtime.ts";
import { scheduleLoopxTick } from "./tick.ts";

const ARTIFACT_TOOL = /artifact|document|render|image|video/i;

export interface ConversationTickInput {
  conversationId: number | null | undefined;
  runtimeSessionId: number;
  outcome: "completed" | "error" | "cancelled";
  /** Names of the tools that actually completed during the turn. */
  toolNames: string[];
}

export function scheduleLoopxTickForConversation(
  input: ConversationTickInput,
): void {
  if (!loopxEnabled()) return;
  if (input.conversationId === null || input.conversationId === undefined) return;
  let conversation: ReturnType<typeof getConversationById>;
  try {
    conversation = getConversationById(input.conversationId);
  } catch {
    return;
  }
  if (!conversation) return;
  if (
    conversation.surface !== "dashboard_terminal" &&
    conversation.surface !== "garden_chat"
  ) {
    return;
  }

  let userMessages: string[];
  try {
    userMessages = listConversationMessages(conversation.id, { limit: 500 })
      .filter((message) => message.role === "user")
      .map((message) => message.content.trim())
      .filter(Boolean);
  } catch {
    return;
  }
  if (!userMessages.length) return;

  let mode: CapabilityMode = "knowledge";
  try {
    // Read before the caller revokes the turn's decision: an authorized write
    // turn is what tells the loop this conversation is real work.
    mode = getActiveCapabilityDecision(input.runtimeSessionId)?.mode ?? "knowledge";
  } catch {
    mode = "knowledge";
  }

  scheduleLoopxTick({
    conversationPublicId: conversation.public_id,
    surface: conversation.surface,
    mode,
    userText: userMessages[userMessages.length - 1],
    userTurnCount: userMessages.length,
    // The first request is what the whole conversation is about; the title is a
    // generated label and can drift.
    objective: userMessages[0],
    outcome: input.outcome,
    toolCalls: input.toolNames.length,
    producedArtifact: input.toolNames.some((name) => ARTIFACT_TOOL.test(name)),
  });
}
