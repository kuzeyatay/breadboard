// What to do with a run whose pump is gone.
//
// Two callers need this. On boot, every active run in the database is a turn
// this process did not start and may have inherited from a version of itself
// that died mid-answer — resuming its pump is the only way the answer Hermes
// already produced reaches the transcript. And when a new turn finds the
// conversation's run slot occupied, the run holding it is either genuinely
// live (wait for it) or abandoned (take it over), which is the difference
// between a chat that is busy and a chat that is bricked.
//
// Both paths end with the run in a terminal state, because a run that can end
// in neither an answer nor a failure is the bug this module exists to remove.

import { failAssistantMessage } from "../conversations/store.ts";
import { startSessionEventPump } from "./event-stream.ts";
import { isRuntimeRunAbandoned } from "./run-liveness.ts";
import {
  finishRuntimeRun,
  getActiveRuntimeRun,
  listAbandonedRuntimeRuns,
  parseRuntimeRunDispatch,
  type RuntimeRunRow,
} from "./run-store.ts";
import {
  getRuntimeSessionById,
  recordAuditEvent,
  setRuntimeStatus,
} from "./runtime-store.ts";
import { currentRuntimeIdentity } from "./session-service.ts";

/**
 * End an abandoned run and the turn it was carrying. Returns false when
 * another caller finished the run first, so the two entry points below can
 * race without either of them acting twice.
 */
export function reclaimAbandonedRun(run: RuntimeRunRow): boolean {
  if (!finishRuntimeRun(run.id, "error")) return false;

  const session = getRuntimeSessionById(run.runtime_session_id);
  const dispatch = parseRuntimeRunDispatch(run);
  if (session?.conversation_id && dispatch.clientMessageId) {
    try {
      failAssistantMessage({
        conversationId: session.conversation_id,
        clientMessageId: dispatch.clientMessageId,
        status: "failed",
        error: "runtime_run_abandoned",
      });
    } catch {
      // The placeholder may already be finalized — a pump that persisted the
      // answer and then died before clearing its run row lands here. Its
      // answer is the truth; only the run row needed closing.
    }
  }
  if (session) setRuntimeStatus(session.id, "failed");

  recordAuditEvent({
    eventType: "run.reclaimed",
    runtimeSessionId: run.runtime_session_id,
    userId: session?.user_id ?? null,
    payload: {
      runId: run.id,
      startedAt: run.started_at,
      heartbeatAt: run.heartbeat_at,
    },
  });
  return true;
}

/**
 * Free a conversation's run slot when the run holding it has no owner left.
 * Returns true when the caller may proceed with a new turn.
 */
export function reclaimAbandonedRunForSession(
  runtimeSessionId: number,
  now = Date.now(),
): boolean {
  const active = getActiveRuntimeRun(runtimeSessionId);
  if (!active || !isRuntimeRunAbandoned(active, now)) return false;
  return reclaimAbandonedRun(active);
}

/**
 * Adopt every run left without a pump — at boot, and periodically for runs
 * orphaned by another process while this one keeps running.
 *
 * Resuming beats reclaiming: the pump asks Hermes for the turn's durable
 * result, so a turn that finished while nobody was listening is persisted with
 * its real answer instead of being reported as a failure. A pump that finds
 * nothing to recover fails the turn itself through its own silence timeout, so
 * the run is still guaranteed to end.
 */
export function resumeAbandonedRuntimeRuns(now = Date.now()): number {
  let resumed = 0;
  for (const run of listAbandonedRuntimeRuns(now)) {
    const session = currentRuntimeIdentity(run.runtime_session_id);
    if (!session) {
      // No runtime identity survives for this row, so there is nothing left to
      // ask about the turn.
      reclaimAbandonedRun(run);
      continue;
    }
    try {
      startSessionEventPump(session);
      recordAuditEvent({
        eventType: "run.resumed",
        runtimeSessionId: run.runtime_session_id,
        userId: session.row.user_id,
        payload: { runId: run.id, startedAt: run.started_at },
      });
      resumed += 1;
    } catch {
      reclaimAbandonedRun(run);
    }
  }
  return resumed;
}
