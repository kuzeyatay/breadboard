// Codex's idle continuation boundary, adapted to Breadboard's durable turn API.
// No second model, grader, or teaching pipeline: just another turn of this chat.
import db from "./db.ts";
import { conversationHasActiveSwarm } from "./swarm/activity.ts";
import { getConversationById, failAssistantMessage } from "./conversations/store.ts";
import { goalCanContinue, readGoalModeState } from "./goal-mode.ts";
import { getRuntimeRun, parseRuntimeRunDispatch, type RuntimeRunRow } from "./hermes/run-store.ts";
import { recordAuditEvent } from "./hermes/runtime-store.ts";

export function goalContinuationCurrent(conversationId: number, sourceRunId: string, goalId: string, ownClientMessageId = ""): boolean {
  if (conversationHasActiveSwarm(db, conversationId)) return false;
  const conversation = getConversationById(conversationId);
  if (!conversation || conversation.archived_at) return false;
  const goal = readGoalModeState(conversation.public_id);
  if (!goalCanContinue(goal) || goal?.goal_id !== goalId) return false;
  const latest = db.prepare(`SELECT r.id, r.status FROM hermes_runs r
    JOIN hermes_runtime_sessions s ON s.id=r.runtime_session_id
    WHERE s.conversation_id=?
    AND (r.status='active' OR COALESCE(json_extract(r.dispatch_json, '$.clientMessageId'),'') NOT LIKE 'chat-message:%')
    ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`)
    .get(conversationId) as { id: string; status: string } | undefined;
  if (latest?.id !== sourceRunId || latest.status === "active") return false;
  if (db.prepare(`SELECT 1 FROM conversation_messages WHERE conversation_id=? AND status='pending'
    AND client_message_id<>? LIMIT 1`).get(conversationId, ownClientMessageId)) return false;
  if (db.prepare(`SELECT 1 FROM conversation_messages WHERE conversation_id=?
    AND json_extract(metadata, '$.externalAgentOutcome')='running' LIMIT 1`).get(conversationId)) return false;
  return !db.prepare(`SELECT 1 FROM hermes_steer_requests q
    JOIN hermes_runtime_sessions s ON s.id=q.runtime_session_id
    WHERE s.conversation_id=? AND q.status='pending' LIMIT 1`).get(conversationId);
}

type PendingGoals = typeof globalThis & { __breadboardGoalContinuationPromises?: Map<number, Promise<void>> };
const shared = globalThis as PendingGoals;
const pending = shared.__breadboardGoalContinuationPromises ??= new Map<number, Promise<void>>();

export function scheduleGoalContinuation(conversationId: number, sourceRunId?: string): void {
  if (pending.has(conversationId)) return;
  // Let the old detached pump close and release its slot before dispatching.
  const work = new Promise<void>((resolve) => setTimeout(resolve, 100)).then(() =>
    continueGoal(conversationId, sourceRunId)).catch((error: unknown) => {
      recordAuditEvent({ eventType: "goal_mode.continuation_failed", payload: {
        conversationId, message: error instanceof Error ? error.message : String(error),
      }});
    }).finally(() => { pending.delete(conversationId); });
  pending.set(conversationId, work);
}

async function continueGoal(conversationId: number, sourceRunId?: string): Promise<void> {
  const conversation = getConversationById(conversationId);
  if (!conversation || conversation.archived_at) return;
  const goal = readGoalModeState(conversation.public_id);
  if (!goalCanContinue(goal) || !goal) return;
  const run = sourceRunId ? getRuntimeRun(sourceRunId) : db.prepare(`SELECT r.* FROM hermes_runs r
    JOIN hermes_runtime_sessions s ON s.id=r.runtime_session_id
    WHERE s.conversation_id=?
    AND COALESCE(json_extract(r.dispatch_json, '$.clientMessageId'),'') NOT LIKE 'chat-message:%'
    ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`)
    .get(conversationId) as RuntimeRunRow | undefined;
  if (!run || !goalContinuationCurrent(conversationId, run.id, goal.goal_id)) return;
  // A pending user answer, delegated result, or approval owns the next turn.
  if (db.prepare("SELECT 1 FROM conversation_messages WHERE conversation_id=? AND status='pending' LIMIT 1").get(conversationId)) return;
  const dispatch = parseRuntimeRunDispatch(run);
  if (!dispatch.goalMode?.enabled) return;
  const { startConversationTurn } = await import("./conversations/turn-service.ts");
  const clientMessageId = `goal:${goal.goal_id}:${run.id}:${goal.updated_at}`;
  let result;
  try {
    result = await startConversationTurn({
    conversation,
    clientMessageId,
    text: "Continue working toward the active conversation goal. Verify the actual result against its full requirements before marking it complete." +
      (run.status === "error" ? " The previous runtime turn failed. Inspect the preserved files, artifacts and command/job status before doing more work. Resume from verified progress; do not repeat a completed experiment, download, publication or other side effect merely because its response was interrupted." : ""),
    surface: conversation.surface,
    surfaceContext: dispatch.goalMode.context,
    model: dispatch.modelIdentity?.modelID ?? dispatch.model?.modelID,
    reasoningEffort: dispatch.variant,
    superAgent: dispatch.goalMode.superAgent,
    personalize: dispatch.goalMode.personalize,
    adhdMode: dispatch.goalMode.adhdMode,
    yoloMode: dispatch.goalMode.yoloMode,
    internalAgentContinuation: true,
    goalContinuation: { sourceRunId: run.id, goalId: goal.goal_id },
    });
  } catch (error) {
    failAssistantMessage({ conversationId, clientMessageId, status: "aborted",
      error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  recordAuditEvent({ eventType: "goal_mode.continuation_dispatched", userId: conversation.user_id,
    payload: { conversationId, sourceRunId: run.id, accepted: result.accepted } });
}
