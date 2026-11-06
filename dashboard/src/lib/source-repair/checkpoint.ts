import db from "../db.ts";
import { getRuntimeRun, parseRuntimeRunDispatch } from "../hermes/run-store.ts";
import { getConversationById } from "../conversations/store.ts";
import type { SourceRepairRequest } from "../../../../desktop/src/shared/source-repair.ts";
import { sourceRepairAuthority } from "./authority.ts";
import type { TaskRecoveryState } from "../hermes/task-recovery.ts";

export function repairDataRoot(): string | null { return process.env.BREADBOARD_DATA_DIR?.trim() || null; }

/** Only the recovery controller can enqueue a repair; tool/model text cannot. */
export function sourceRepairOutcome(runId: string, state: TaskRecoveryState, completed: boolean): TaskRecoveryState {
  const data = repairDataRoot();
  if (!data) return state;
  try {
    const authority = sourceRepairAuthority(); if (!authority) return state;
    const { enqueueSourceRepair, readSourceRepair, updateSourceRepair, sourceRepairConfig, MAX_SOURCE_REPAIR_ATTEMPTS } = authority;
    if (state.sourceRepairId && state.sourceRepairReplay) {
      const request = readSourceRepair(data, state.sourceRepairId);
      if (request?.stage === "probation") {
        updateSourceRepair(data, request.id, { stage: completed ? "committed" : "rollback_requested", resumedRunId: runId,
          resumeAfterRollback: !["cancelled", "requires_user_or_external_change"].includes(state.stopped ?? ""),
          reason: completed ? "The resumed task completed with its artifact requirements verified." : "The resumed task failed verification; restoring the previous release." });
        return { ...state, pending: false, stopped: completed ? undefined : "awaiting_source_rollback" };
      }
      return { ...state, pending: false };
    }
    if (state.sourceRepairId) {
      // A rollback restores executable code, but may restore the original bug
      // too. If ordinary recovery reproduces it again, spend only the remaining
      // candidate allowance instead of permanently stranding the saved task.
      const request = readSourceRepair(data, state.sourceRepairId);
      if (request?.stage !== "rolled_back" || completed || state.stopped !== "repeated_failure_without_progress" ||
          !state.checkpoint || !repairTaskStillCurrent(request) || !sourceRepairConfig(data)?.enabled) return state;
      if (request.attempt >= MAX_SOURCE_REPAIR_ATTEMPTS || Date.now() > request.deadline) {
        updateSourceRepair(data, request.id, { stage: "blocked", reason: "The defect persisted after rollback and the remaining repair allowance is exhausted; saved progress is preserved." });
        return state;
      }
      updateSourceRepair(data, request.id, { stage: "queued", sourceRunId: runId, failure: state.checkpoint,
        generation: (request.generation ?? 0) + 1, jobId: undefined, release: undefined, candidateRoot: undefined,
        checks: undefined, resumedRunId: undefined, resumeAfterRollback: undefined,
        reason: `The previous candidate was rolled back: ${request.reason ?? "verification failed"}. The original task reproduced the defect again.` });
      return { ...state, sourceRepairReplay: false, pending: false, stopped: "awaiting_source_repair" };
    }
    if (state.stopped !== "repeated_failure_without_progress" || !state.checkpoint) return state;
    const run = getRuntimeRun(runId);
    if (!run) return state;
    const owner = db.prepare("SELECT conversation_id, user_id FROM hermes_runtime_sessions WHERE id=?")
      .get(run.runtime_session_id) as { conversation_id: number; user_id: number } | undefined;
    if (!owner?.conversation_id || !owner.user_id) return state;
    const dispatch = parseRuntimeRunDispatch(run);
    const model = dispatch.modelIdentity?.modelID ?? dispatch.model?.modelID;
    if (!model) return state;
    const request = enqueueSourceRepair(data, { userId: owner.user_id, conversationId: owner.conversation_id,
      sourceRunId: runId, rootClientMessageId: state.rootClientMessageId, request: state.request,
      failure: state.checkpoint, model });
    return request ? { ...state, sourceRepairId: request.id, pending: false, stopped: "awaiting_source_repair" } : state;
  } catch { return state; /* Repair infrastructure must not break saving the original outcome. */ }
}

export function cancelConversationSourceRepairs(conversationId: number): void {
  const data = repairDataRoot(); if (!data) return;
  const authority = sourceRepairAuthority(); if (!authority) return;
  const { listSourceRepairs, cancelSourceRepair } = authority;
  for (const request of listSourceRepairs(data)) {
    if (request.conversationId === conversationId && !["committed", "rolled_back", "blocked", "failed"].includes(request.stage)) cancelSourceRepair(data, request.id);
  }
}

/** A newer human request or Stop always wins over this saved task. */
export function repairTaskStillCurrent(request: SourceRepairRequest): boolean {
  const conversation = getConversationById(request.conversationId);
  if (!conversation || conversation.archived_at || conversation.user_id !== request.userId) return false;
  const latest = db.prepare(`SELECT r.id, r.dispatch_json FROM hermes_runs r JOIN hermes_runtime_sessions s ON s.id=r.runtime_session_id
    WHERE s.conversation_id=? AND json_extract(r.dispatch_json, '$.clientMessageId') IS NOT NULL
    ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`).get(request.conversationId) as { id: string; dispatch_json: string } | undefined;
  if (!latest) return false;
  const state = JSON.parse(latest.dispatch_json).taskRecovery as TaskRecoveryState | undefined;
  if (!state || state.stopped === "cancelled" || state.rootClientMessageId !== request.rootClientMessageId || state.sourceRepairId !== request.id) return false;
  const original = db.prepare("SELECT order_index FROM conversation_messages WHERE conversation_id=? AND client_message_id=? AND role='user'")
    .get(request.conversationId, request.rootClientMessageId) as { order_index: number } | undefined;
  return Boolean(original) && !db.prepare(`SELECT 1 FROM conversation_messages WHERE conversation_id=? AND role='user'
    AND order_index>? AND COALESCE(json_extract(metadata, '$.internalAgentContinuation'),0)<>1 LIMIT 1`)
    .get(request.conversationId, original!.order_index);
}

/** Compare-and-set the durable queue; the existing dispatcher owns its lease. */
export function releaseRepairCheckpoint(request: SourceRepairRequest, replay: boolean): string | null {
  if (!replay && request.resumeAfterRollback === false) return null;
  if (!repairTaskStillCurrent(request)) return null;
  const runId = replay ? request.sourceRunId : request.resumedRunId ?? request.sourceRunId;
  const run = getRuntimeRun(runId);
  const state = run && parseRuntimeRunDispatch(run).taskRecovery;
  if (!state?.checkpoint || !["awaiting_source_repair", "awaiting_source_rollback"].includes(state.stopped ?? "")) return null;
  const next: TaskRecoveryState = { ...state, pending: true, stopped: undefined, sourceRepairReplay: replay,
    checkpoint: { ...state.checkpoint, repeated: 0, notBefore: Date.now() }, claim: undefined };
  const result = db.prepare(`UPDATE hermes_runs SET dispatch_json=json_set(dispatch_json, '$.taskRecovery', json(?)) WHERE id=?
    AND json_extract(dispatch_json, '$.taskRecovery.stopped')=?`).run(JSON.stringify(next), runId, state.stopped);
  return result.changes ? runId : null;
}
