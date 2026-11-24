import db from "../db.ts";
import { startSessionEventPump } from "../hermes/event-stream.ts";
import { getRuntimeSessionByConversation } from "../hermes/runtime-store.ts";
import { resolveConversationRuntime } from "../hermes/session-service.ts";
import { reconcileOuterAgentConversation } from "../runtime-v2/outer-agent-conversation.ts";
import { nextPendingHandBack } from "./delegated-hand-back.ts";
import {
  getConversationById,
  listConversationMessages,
  presentConversationMessage,
} from "./store.ts";
import { startConversationTurn } from "./turn-service.ts";

/**
 * Start the parent's hidden hand-back turn for one finished worker, with no
 * browser involved. Returns true when a turn was accepted. The pump persists
 * the answer, as for a scheduled run.
 */
export async function continueDelegatedHandBack(
  conversationId: number,
  options: { minAgeMs?: number; maxAgeMs?: number } = {},
): Promise<boolean> {
  const conversation = getConversationById(conversationId);
  if (!conversation) return false;
  const messages = listConversationMessages(conversation.id, { limit: 500 })
    .map(presentConversationMessage);
  const pending = nextPendingHandBack(messages, options);
  if (!pending) return false;
  const existing = getRuntimeSessionByConversation(conversation.id);
  const runtime = await resolveConversationRuntime({
    conversation,
    surface: conversation.surface,
    activeGardenSlug: existing?.garden_id ?? null,
    activePageSlug: null,
  });
  startSessionEventPump(runtime);
  const safe = pending.workerClientMessageId.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 100);
  const result = await startConversationTurn({
    conversation,
    clientMessageId: `server-handback-${safe}`,
    text: pending.text,
    surface: conversation.surface,
    internalAgentContinuation: true,
    superAgent: true,
    unattended: true,
  });
  return result.accepted;
}

// An open page gets this long to hand back itself before the server does.
const BROWSER_GRACE_MS = 2 * 60_000;
// Background sweeps never revive old delegations; opening the chat still does.
const SWEEP_MAX_AGE_MS = 48 * 60 * 60_000;
let sweeping = false;

/** Conversations with a delegated worker that is running or recently done. */
function candidateConversations(): Array<{ id: number; userId: number }> {
  return db.prepare(`
    SELECT DISTINCT conversation.id AS id, conversation.user_id AS userId
    FROM conversation_message_reads AS message
    JOIN conversations AS conversation ON conversation.id = message.conversation_id
    WHERE message.role = 'assistant'
      AND json_extract(message.metadata, '$.delegatedAgentRun') = 1
      AND message.updated_at >= datetime('now', '-2 days')
  `).all() as Array<{ id: number; userId: number }>;
}

export async function sweepDelegatedHandBacks(): Promise<number> {
  if (sweeping) return 0;
  sweeping = true;
  let started = 0;
  try {
    for (const { id, userId } of candidateConversations()) {
      try {
        await reconcileOuterAgentConversation(userId, id);
        if (await continueDelegatedHandBack(id, {
          minAgeMs: BROWSER_GRACE_MS,
          maxAgeMs: SWEEP_MAX_AGE_MS,
        })) started += 1;
      } catch {
        // Runtime off, turn already active, or a transient failure: next sweep.
      }
    }
  } finally {
    sweeping = false;
  }
  return started;
}
