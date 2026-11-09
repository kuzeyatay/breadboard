import db from "../db.ts";
import { ApiError } from "../hermes/route-core.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch, getLatestRuntimeRun, type RuntimeRunRow } from "../hermes/run-store.ts";
import { scheduleGoalContinuation } from "../goal-continuation.ts";
import { scheduleTaskRecovery } from "../hermes/task-recovery.ts";
import { getRuntimeSessionByConversation, recordAuditEvent } from "../hermes/runtime-store.ts";
import { authorizeConversationRuntime, listAuthorizedGardens } from "../hermes/session-service.ts";
import { startSessionEventPump, waitForSessionEventPump } from "../hermes/event-stream.ts";
import { startConversationTurn } from "./turn-service.ts";
import { getConversationById, failAssistantMessage } from "./store.ts";
import { CHAT_MESSAGE_TTL_MS, ChatCoordinationStore, chatMessageClientId, type CoordinatingChat } from "./coordination-store.ts";

const state = globalThis as typeof globalThis & { __breadboardChatCoordinationPromises?: Map<number, Promise<void>> };
const deliveries = state.__breadboardChatCoordinationPromises ??= new Map();
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export const coordinationStore = () => new ChatCoordinationStore(db);

function failDeliveryTurn(targetId: number, messageId: string, error: string): void {
  const clientMessageId = chatMessageClientId(messageId);
  if (db.prepare("SELECT 1 FROM conversation_messages WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant' AND status = 'pending'").get(targetId, clientMessageId)) {
    failAssistantMessage({ conversationId: targetId, clientMessageId, status: "failed", error });
  }
}

export function authorizeCoordinationChat(userId: number, id: number | string): CoordinatingChat {
  const chat = coordinationStore().chat(userId, id);
  if (chat.default_garden_id !== null && !listAuthorizedGardens(userId).some(garden => garden.id === chat.default_garden_id)) {
    throw new ApiError(404, "chat_unavailable", "This chat's Garden is no longer accessible.");
  }
  return chat;
}

/** Finite work owned by queued messages, like the existing detached turn pump.
 * No daemon, recurring scheduler, renderer, or additional agent process. */
export function deliverChatMessages(targetId: number): Promise<void> {
  const existing = deliveries.get(targetId);
  if (existing) return existing;
  const work = drain(targetId).catch(() => {
    recordAuditEvent({ eventType: "chatCoordination.delivery_failed", payload: { targetId } });
  }).finally(() => { deliveries.delete(targetId); });
  deliveries.set(targetId, work);
  return work;
}

async function drain(targetId: number): Promise<void> {
  const store = coordinationStore();
  for (;;) {
    const envelope = store.next(targetId);
    if (!envelope) {
      // A peer owns just this turn. Resume any user-owned work that yielded
      // between turns; an intervening human turn still supersedes it normally.
      const previous = db.prepare(`SELECT r.* FROM hermes_runs r JOIN hermes_runtime_sessions s ON s.id=r.runtime_session_id
        WHERE s.conversation_id=? AND COALESCE(json_extract(r.dispatch_json, '$.clientMessageId'),'') NOT LIKE 'chat-message:%'
        ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`).get(targetId) as RuntimeRunRow | undefined;
      const dispatch = previous && parseRuntimeRunDispatch(previous);
      if (dispatch?.goalMode?.enabled) scheduleGoalContinuation(targetId, previous!.id);
      else if (dispatch?.taskRecovery?.pending) scheduleTaskRecovery(targetId, previous!.id);
      return;
    }
    try {
      authorizeCoordinationChat(envelope.user_id, envelope.source_id);
      const target = authorizeCoordinationChat(envelope.user_id, targetId);
      if (!["queued", "dispatching", "running"].includes(store.reconcile(envelope.id)!.status)) continue;
      const runtime = getRuntimeSessionByConversation(targetId);
      const active = runtime && getActiveRuntimeRun(runtime.id);
      if (active) {
        // Also recovers a live receiver after dashboard reload; the event pump
        // is idempotent and persists the answer without an open browser tab.
        const session = authorizeConversationRuntime(getConversationById(targetId)!);
        startSessionEventPump(session);
        await waitForSessionEventPump(session);
        continue;
      }
      if (Date.now() - envelope.created_at > CHAT_MESSAGE_TTL_MS) {
        failDeliveryTurn(targetId, envelope.id, "Cross-chat delivery expired before an answer was produced.");
        store.finish(envelope.id, "failed", "Message expired before the receiving chat could answer.");
        continue;
      }
      if (envelope.status !== "queued") {
        // A different route bundle may still be preparing the turn. Never
        // replay an uncertain submission: that could execute tools twice.
        if (Date.now() - (envelope.claimed_at ?? envelope.created_at) > 120_000) {
          failDeliveryTurn(targetId, envelope.id, "Cross-chat delivery was interrupted before a runtime turn started.");
          store.finish(envelope.id, "failed", "Delivery was interrupted. Send a new request to retry.");
        } else await pause(250);
        continue;
      }
      const pending = db.prepare("SELECT 1 FROM conversation_messages WHERE conversation_id = ? AND role = 'assistant' AND status = 'pending' LIMIT 1").get(targetId);
      if (pending) { await pause(250); continue; }
      if (!store.claim(envelope.id)) continue;
      const source = store.chat(envelope.user_id, envelope.source_id);
      const garden = listAuthorizedGardens(envelope.user_id).find(item => item.id === target.default_garden_id);
      const previous = runtime ? getLatestRuntimeRun(runtime.id) : null;
      const previousDispatch = previous ? parseRuntimeRunDispatch(previous) : null;
      const result = await startConversationTurn({
        conversation: getConversationById(targetId)!, clientMessageId: chatMessageClientId(envelope.id),
        text: envelope.message, surface: target.surface as "dashboard_terminal" | "garden_chat",
        surfaceContext: { activeGardenSlug: garden?.slug ?? runtime?.garden_id ?? undefined,
          activePageSlug: runtime?.page_slug ?? undefined },
        model: previousDispatch?.modelIdentity?.modelID,
        reasoningEffort: previousDispatch?.variant,
        chatCoordination: { messageId: envelope.id, sourceChatId: source.public_id, sourceTitle: source.title },
        yoloMode: false,
      });
      if (result.accepted) {
        store.finish(envelope.id, "running");
        startSessionEventPump(result.session);
        await waitForSessionEventPump(result.session);
      } else if ("blocked" in result) {
        failDeliveryTurn(targetId, envelope.id, "This cross-chat request needs your permission. Continue it in this chat.");
        store.finish(envelope.id, "failed", "The receiving chat needs user permission; open it to continue.");
      } else if ("replayed" in result && result.status === "pending") {
        store.finish(envelope.id, "running");
      }
      store.reconcile(envelope.id);
    } catch (error) {
      // A human may win the turn reservation after our idle check.
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      if (code === "conversation_turn_active") {
        store.finish(envelope.id, "queued");
        await pause(250);
      } else {
        failDeliveryTurn(targetId, envelope.id, "Cross-chat delivery failed. Please send the request again.");
        store.finish(envelope.id, "failed", error instanceof ApiError ? error.message : "The receiving agent could not start or finish its answer.");
      }
    }
  }
}

/** One recovery pass at startup; messages and turn ids already live in SQLite. */
export function recoverChatMessages(): void {
  for (const targetId of coordinationStore().pendingTargets()) void deliverChatMessages(targetId);
}

export async function waitForChatMessage(input: { userId: number; sourceId: number; messageId: string; timeoutMs: number; signal?: AbortSignal }) {
  const store = coordinationStore();
  const deadline = Date.now() + input.timeoutMs;
  for (;;) {
    if (input.signal?.aborted) throw new ApiError(499, "chat_wait_cancelled", "Stopped waiting for the chat. The message is still delivered.");
    const receipt = store.receipt(input.userId, input.sourceId, input.messageId);
    authorizeCoordinationChat(input.userId, receipt.chatId);
    if (!["queued", "dispatching", "running"].includes(receipt.status)) return { ...receipt, timedOut: false };
    void deliverChatMessages(store.get(input.messageId)!.target_id);
    if (Date.now() >= deadline) return { ...receipt, timedOut: true };
    await pause(Math.min(250, Math.max(1, deadline - Date.now())));
  }
}
