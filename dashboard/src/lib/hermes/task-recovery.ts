import db from "../db.ts";
import { randomUUID } from "node:crypto";
import { getConversationById, failAssistantMessage } from "../conversations/store.ts";
import { normalizeChatMessageAttachments, reusableChatAttachments } from "../chat-attachments.ts";
import { getRuntimeRun, parseRuntimeRunDispatch } from "./run-store.ts";
import { recordAuditEvent } from "./runtime-store.ts";
import { readGoalModeState } from "../goal-mode.ts";
import { taskRecoveryCheckpoint, TASK_RECOVERY_INSTRUCTIONS,
  type RecoveryFailure, type RecoveryToolResult, type TaskRecoveryCheckpoint } from "./task-recovery-policy.ts";
import type { StartConversationTurnInput, StartConversationTurnResult } from "../conversations/turn-service.ts";
import { sourceRepairOutcome, cancelConversationSourceRepairs } from "../source-repair/checkpoint.ts";

export interface TaskRecoveryState {
  request: string;
  rootClientMessageId: string;
  turn: number;
  previousRunIds?: string[];
  context?: StartConversationTurnInput["surfaceContext"];
  superAgent?: boolean;
  personalize?: boolean;
  adhdMode?: boolean;
  yoloMode?: boolean;
  checkpoint?: TaskRecoveryCheckpoint;
  pending?: boolean;
  stopped?: string;
  outcomeRecorded?: boolean;
  sourceRepairId?: string;
  sourceRepairReplay?: boolean;
  claim?: { id: string; expiresAt: number };
}

function saveState(runId: string, state: TaskRecoveryState): void {
  // Patch only our field: another worker can be publishing/acknowledging this run.
  db.prepare("UPDATE hermes_runs SET dispatch_json=json_set(dispatch_json, '$.taskRecovery', json(?)) WHERE id=?")
    .run(JSON.stringify(state), runId);
}

export function recordTaskRecoveryOutcome(input: {
  runId: string; status: string; failure?: RecoveryFailure;
  tools: readonly RecoveryToolResult[]; artifacts?: unknown[]; now?: number;
}): TaskRecoveryState | null {
  const run = getRuntimeRun(input.runId);
  if (!run) return null;
  const dispatch = parseRuntimeRunDispatch(run);
  const state = dispatch.taskRecovery;
  if (!state || dispatch.goalMode?.enabled || state.stopped === "cancelled" || state.outcomeRecorded) return null;
  const decision = taskRecoveryCheckpoint({ ...input, turn: state.turn, previous: state.checkpoint });
  const next = sourceRepairOutcome(run.id, { ...state, checkpoint: decision.checkpoint ?? state.checkpoint,
    pending: Boolean(decision.checkpoint), stopped: decision.stopped, outcomeRecorded: true },
    !decision.checkpoint && !decision.stopped && (input.status === "idle" || input.status === "completed"));
  saveState(run.id, next);
  recordAuditEvent({ eventType: decision.checkpoint ? "task.recovery_queued" : "task.recovery_finished",
    runtimeSessionId: run.runtime_session_id,
    payload: { runId: run.id, turn: state.turn, reason: decision.stopped ?? decision.checkpoint?.code ?? "completed" } });
  return next;
}

/** Stop also cancels work queued between turns, before any new runtime exists. */
export function cancelTaskRecovery(conversationId: number): void {
  db.prepare(`UPDATE hermes_runs SET dispatch_json=json_set(dispatch_json,
    '$.taskRecovery.pending', json('false'), '$.taskRecovery.stopped', 'cancelled')
    WHERE runtime_session_id IN (SELECT id FROM hermes_runtime_sessions WHERE conversation_id=?)
      AND json_type(dispatch_json, '$.taskRecovery')='object'`).run(conversationId);
  try { cancelConversationSourceRepairs(conversationId); } catch { /* persisted task Stop still wins */ }
}

export function taskRecoveryCurrent(conversationId: number, sourceRunId: string, ownClientMessageId = ""): boolean {
  const conversation = getConversationById(conversationId);
  const run = getRuntimeRun(sourceRunId);
  if (!conversation || conversation.archived_at || !run || run.status === "active" || run.status === "cancelled") return false;
  const owner = db.prepare("SELECT conversation_id FROM hermes_runtime_sessions WHERE id=?")
    .get(run.runtime_session_id) as { conversation_id: number } | undefined;
  if (owner?.conversation_id !== conversationId) return false;
  const dispatch = parseRuntimeRunDispatch(run);
  if (!dispatch.taskRecovery?.pending || dispatch.taskRecovery.stopped || dispatch.goalMode?.enabled) return false;
  const goal = readGoalModeState(conversation.public_id);
  if (goal && goal.status !== "complete") return false;
  const latest = db.prepare(`SELECT r.id FROM hermes_runs r JOIN hermes_runtime_sessions s ON s.id=r.runtime_session_id
    WHERE s.conversation_id=? AND json_extract(r.dispatch_json, '$.clientMessageId') IS NOT NULL
    ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`).get(conversationId) as { id: string } | undefined;
  if (latest?.id !== sourceRunId) return false;
  const source = db.prepare(`SELECT order_index FROM conversation_messages
    WHERE conversation_id=? AND client_message_id=? AND role='user'`).get(conversationId, dispatch.clientMessageId ?? "") as { order_index: number } | undefined;
  if (!source) return false;
  // A newer human message supersedes recovery even if its own dispatch failed.
  if (db.prepare(`SELECT 1 FROM conversation_messages WHERE conversation_id=? AND role='user'
    AND order_index>? AND client_message_id<>? AND COALESCE(json_extract(metadata, '$.internalAgentContinuation'),0)<>1 LIMIT 1`)
    .get(conversationId, source.order_index, ownClientMessageId)) return false;
  if (db.prepare(`SELECT 1 FROM conversation_messages WHERE conversation_id=? AND client_message_id<>?
    AND (status='pending' OR json_extract(metadata, '$.externalAgentOutcome')='running') LIMIT 1`)
    .get(conversationId, ownClientMessageId)) return false;
  return !db.prepare(`SELECT 1 FROM hermes_steer_requests q JOIN hermes_runtime_sessions s ON s.id=q.runtime_session_id
    WHERE s.conversation_id=? AND q.status='pending' LIMIT 1`).get(conversationId);
}

export function taskRecoveryForContinuation(sourceRunId: string): TaskRecoveryState {
  const run = getRuntimeRun(sourceRunId);
  const previous = run && parseRuntimeRunDispatch(run).taskRecovery;
  if (!previous?.pending || !previous.checkpoint) throw new Error("Task recovery is no longer pending.");
  return { ...previous, turn: previous.turn + 1, pending: false, stopped: undefined,
    outcomeRecorded: false, claim: undefined, previousRunIds: [...(previous.previousRunIds ?? []), sourceRunId] };
}

export function prepareTaskRecovery(conversationId: number, sourceRunId: string): StartConversationTurnInput | null {
  const clientMessageId = `recovery:${sourceRunId}`;
  if (!taskRecoveryCurrent(conversationId, sourceRunId, clientMessageId)) return null;
  const conversation = getConversationById(conversationId)!;
  const run = getRuntimeRun(sourceRunId)!;
  const dispatch = parseRuntimeRunDispatch(run);
  const state = dispatch.taskRecovery!;
  const original = db.prepare(`SELECT metadata FROM conversation_messages
    WHERE conversation_id=? AND client_message_id=? AND role='user'`)
    .get(conversationId, state.rootClientMessageId) as { metadata: string | null } | undefined;
  const metadata = original?.metadata ? JSON.parse(original.metadata) : {};
  return {
    conversation, clientMessageId, text: state.request, surface: conversation.surface,
    surfaceContext: { ...state.context, authorizedContext: [state.context?.authorizedContext,
      TASK_RECOVERY_INSTRUCTIONS, JSON.stringify({ error: state.checkpoint, previousRunId: sourceRunId })].filter(Boolean).join("\n\n") },
    attachments: reusableChatAttachments(normalizeChatMessageAttachments(metadata.attachments)),
    model: dispatch.modelIdentity?.modelID ?? dispatch.model?.modelID,
    reasoningEffort: dispatch.variant, superAgent: state.superAgent, personalize: state.personalize,
    adhdMode: state.adhdMode, yoloMode: state.yoloMode,
    internalAgentContinuation: true, taskContinuation: { sourceRunId },
    retry: true,
  };
}

type DispatchTurn = (input: StartConversationTurnInput) => Promise<StartConversationTurnResult>;

function failRecoveryReservation(conversationId: number, clientMessageId: string, error: string): void {
  if (!db.prepare(`SELECT 1 FROM conversation_messages WHERE conversation_id=?
    AND client_message_id=? AND role='assistant' AND status='pending'`).get(conversationId, clientMessageId)) return;
  failAssistantMessage({ conversationId, clientMessageId, status: "failed", error });
}

/** Exported boundary lets integration tests use the real store and a controlled runtime. */
export async function continueTaskRecovery(conversationId: number, sourceRunId: string, dispatchTurn?: DispatchTurn): Promise<boolean> {
  const input = prepareTaskRecovery(conversationId, sourceRunId);
  if (!input) return false;
  const claimId = randomUUID();
  const claim = db.prepare(`UPDATE hermes_runs SET dispatch_json=json_set(dispatch_json, '$.taskRecovery.claim', json(?))
    WHERE id=? AND json_extract(dispatch_json, '$.taskRecovery.pending')=1
    AND json_extract(dispatch_json, '$.taskRecovery.stopped') IS NULL
    AND COALESCE(json_extract(dispatch_json, '$.taskRecovery.claim.expiresAt'),0)<?`)
    .run(JSON.stringify({ id: claimId, expiresAt: Date.now() + 120_000 }), sourceRunId, Date.now());
  if (!claim.changes) return false;
  const heartbeat = setInterval(() => {
    db.prepare(`UPDATE hermes_runs SET dispatch_json=json_set(dispatch_json, '$.taskRecovery.claim.expiresAt', ?)
      WHERE id=? AND json_extract(dispatch_json, '$.taskRecovery.claim.id')=?`).run(Date.now() + 120_000, sourceRunId, claimId);
  }, 30_000);
  heartbeat.unref();
  try {
    // An expired dispatch lease may leave a reservation but no runtime run.
    // Only this claimed, deterministic continuation is ours to reclaim.
    failRecoveryReservation(conversationId, input.clientMessageId, "recovery_dispatch_interrupted");
    const dispatch = dispatchTurn ?? (await import("../conversations/turn-service.ts")).startConversationTurn;
    if (!taskRecoveryCurrent(conversationId, sourceRunId, input.clientMessageId)) return false;
    const result = await dispatch(input);
    // The child now owns the next decision. A permission/question response also
    // consumes this queue entry; it must not be submitted again in the background.
    const source = getRuntimeRun(sourceRunId);
    const state = source && parseRuntimeRunDispatch(source).taskRecovery;
    if (state) saveState(sourceRunId, { ...state, pending: false });
    recordAuditEvent({ eventType: "task.recovery_dispatched", userId: input.conversation.user_id,
      payload: { sourceRunId, accepted: result.accepted } });
    return true;
  } catch (error) {
    // Do not leave a half-reserved automatic message blocking the whole chat.
    failRecoveryReservation(conversationId, input.clientMessageId, error instanceof Error ? error.message : String(error));
    const source = getRuntimeRun(sourceRunId);
    if (source) {
      const state = parseRuntimeRunDispatch(source).taskRecovery;
      if (state?.pending && !state.stopped && taskRecoveryCurrent(conversationId, sourceRunId, input.clientMessageId)) {
        saveState(sourceRunId, { ...state, turn: state.turn + 1, outcomeRecorded: false });
        recordTaskRecoveryOutcome({ runId: sourceRunId, status: "failed", tools: [],
          failure: { code: typeof (error as { code?: unknown })?.code === "string"
            ? (error as { code: string }).code : "recovery_dispatch_failed",
            message: error instanceof Error ? error.message : String(error) } });
      } else if (state?.pending) saveState(sourceRunId, { ...state, pending: false });
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    db.prepare(`UPDATE hermes_runs SET dispatch_json=json_remove(dispatch_json, '$.taskRecovery.claim')
      WHERE id=? AND json_extract(dispatch_json, '$.taskRecovery.claim.id')=?`).run(sourceRunId, claimId);
  }
}

type RecoveryGlobal = typeof globalThis & { __breadboardTaskRecoveryPromises?: Map<string, Promise<void>> };
const pending = (globalThis as RecoveryGlobal).__breadboardTaskRecoveryPromises ??= new Map<string, Promise<void>>();

export function scheduleTaskRecovery(conversationId: number, sourceRunId: string): void {
  if (pending.has(sourceRunId)) return;
  const run = getRuntimeRun(sourceRunId);
  const state = run && parseRuntimeRunDispatch(run).taskRecovery;
  if (!state?.pending || state.stopped) return;
  const due = Math.max(state.checkpoint?.notBefore ?? 0, state.claim?.expiresAt ?? 0);
  const delay = Math.max(100, Math.min(30_000, due - Date.now()));
  const work = new Promise<void>(resolve => setTimeout(resolve, delay))
    .then(async () => { await continueTaskRecovery(conversationId, sourceRunId); })
    .catch(error => { recordAuditEvent({ eventType: "task.recovery_dispatch_failed",
      payload: { sourceRunId, message: error instanceof Error ? error.message : String(error) } }); })
    .finally(() => {
      pending.delete(sourceRunId);
      if (taskRecoveryCurrent(conversationId, sourceRunId, `recovery:${sourceRunId}`)) scheduleTaskRecovery(conversationId, sourceRunId);
    });
  pending.set(sourceRunId, work);
}

/** Restart-safe queue, drained by the existing background recovery worker. */
export function resumePendingTaskRecoveries(): number {
  const rows = db.prepare(`SELECT r.id, s.conversation_id FROM hermes_runs r
    JOIN hermes_runtime_sessions s ON s.id=r.runtime_session_id
    WHERE r.status IN ('completed','error') AND s.conversation_id IS NOT NULL
      AND json_extract(r.dispatch_json, '$.taskRecovery.pending')=1`).all() as Array<{ id: string; conversation_id: number }>;
  let resumed = 0;
  for (const row of rows) {
    if (!taskRecoveryCurrent(row.conversation_id, row.id, `recovery:${row.id}`)) continue;
    scheduleTaskRecovery(row.conversation_id, row.id);
    resumed++;
  }
  return resumed;
}
