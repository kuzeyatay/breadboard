// Stopping a runtime session's live work.
//
// Three things can be running under one runtime session: the turn itself inside
// the agent runtime, an authorized terminal command (a real child process
// group), and an interactive visualizer browsing the web. They are cancelled
// together because they are one turn from the person's side, and they are
// cancelled with `allSettled` because a runtime that has already dropped the
// session must not stop us from killing the child process it left behind.
//
// Both callers of this file are places a turn ends against the person's wishes:
// the abort button, and deleting the chat out from under it.

import { leastPrivilegeDecision } from "./dispatch-core.ts";
import { getAgentRuntimeByKind } from "../agent-runtime/runtime.ts";
import {
  authorizeRuntimeSession,
  markStatus,
  type AuthorizedRuntimeSession,
} from "./session-service.ts";
import { revokeCapabilityDecision, type RuntimeSessionRow } from "./runtime-store.ts";
import { cancelAuthorizedTerminalCommand } from "./terminal-execution.ts";
import { cancelInteractiveVisualizerWork } from "./interactive-visualizer-browser.ts";
import { finishRuntimeRun, getActiveRuntimeRun } from "./run-store.ts";

export interface RuntimeWorkStopReport {
  runtimeStopAcknowledged: boolean;
  activeTerminalStopped: boolean;
  activeVisualizerStopped: boolean;
}

/**
 * Stop the runtime turn, the terminal command and the visualizer at once.
 *
 * `session` is null when the runtime session was never initialized far enough
 * to be addressed — there is no turn to stop then, but a terminal command and a
 * visualizer are keyed by the session row id alone and may still be running.
 */
export async function stopRuntimeSessionWork(
  runtimeSessionId: number,
  session: AuthorizedRuntimeSession | null,
): Promise<RuntimeWorkStopReport> {
  const [runtimeStop, terminalStop, visualizerStop] = await Promise.allSettled([
    session
      ? getAgentRuntimeByKind(session.runtimeKind).stopRun({
          externalSessionId: session.externalSessionId,
          liveSessionId: session.liveSessionId,
          workspaceKey: session.workspaceKey,
          directory: session.activeDirectory,
        })
      : Promise.resolve(null),
    cancelAuthorizedTerminalCommand(runtimeSessionId),
    cancelInteractiveVisualizerWork(runtimeSessionId),
  ]);
  return {
    runtimeStopAcknowledged: runtimeStop.status === "fulfilled",
    activeTerminalStopped: terminalStop.status === "fulfilled" && terminalStop.value,
    activeVisualizerStopped:
      visualizerStop.status === "fulfilled" && visualizerStop.value,
  };
}

export interface RuntimeSessionCancelReport extends RuntimeWorkStopReport {
  /** The run that was moved to "cancelled", or null when none was active. */
  cancelledRunId: string | null;
}

/**
 * Cancel everything one runtime session is doing, on the way to throwing the
 * session away.
 *
 * Unlike the abort button this never refuses. The session is about to stop
 * existing, so a runtime that cannot be reached, a session that was never
 * initialized, or a run that finished a moment ago are all just details of how
 * quiet it already was — every one of them still leaves the local child
 * processes to kill and the run row to close out.
 */
export async function cancelRuntimeSessionWork(
  userId: number,
  row: RuntimeSessionRow,
): Promise<RuntimeSessionCancelReport> {
  const activeRun = getActiveRuntimeRun(row.id);
  let session: AuthorizedRuntimeSession | null = null;
  // Addressing the runtime is a network call, and a chat can own a long tail of
  // retired runtime sessions. Only a session with a live run has a turn to
  // stop; the local cancels below are map lookups and are always worth doing.
  if (activeRun) {
    try {
      session = authorizeRuntimeSession(userId, row.id);
    } catch {
      // Not addressable — never initialized, or the runtime forgot it. The
      // child process it left behind is still ours to kill.
      session = null;
    }
  }

  if (session) markStatus(session, "stopping");
  const report = await stopRuntimeSessionWork(row.id, session);
  const cancelledRunId =
    activeRun && finishRuntimeRun(activeRun.id, "cancelled") ? activeRun.id : null;
  if (session) markStatus(session, "aborted");

  // Whatever this session was allowed to touch, it is not allowed to touch now.
  try {
    revokeCapabilityDecision(row.id, "cancelled");
    if (session) {
      await getAgentRuntimeByKind(session.runtimeKind).applyCapabilityDecision({
        externalSessionId: session.externalSessionId,
        liveSessionId: session.liveSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
        decision: leastPrivilegeDecision(session.activeDirectory),
      });
    }
  } catch {
    // The grants are revoked in our own tables either way, and the runtime
    // session is being discarded.
  }

  return { ...report, cancelledRunId };
}
