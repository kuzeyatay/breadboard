import { decideCapabilityMode, type CapabilityDecision } from "./capability-policy.ts";
import { leastPrivilegeDecision } from "./dispatch-core.ts";
import { getAgentRuntimeByKind } from "../agent-runtime/runtime.ts";
import {
  getActiveCapabilityDecision,
  recordAuditEvent,
  revokeCapabilityDecision,
} from "./runtime-store.ts";
import type { AuthorizedRuntimeSession } from "./session-service.ts";

/**
 * Enforce the wall-clock expiry even when an event stream is abandoned. The
 * database check prevents an old timer from revoking a newer task decision.
 */
export function scheduleCapabilityExpiry(
  session: AuthorizedRuntimeSession,
  decision: CapabilityDecision,
  decisionId: number,
): void {
  if (!decision.expiresAt) return;
  const expiresAt = Date.parse(decision.expiresAt);
  if (!Number.isFinite(expiresAt)) return;
  const delay = Math.max(0, expiresAt - Date.now() + 25);
  const timer = setTimeout(() => {
    const active = getActiveCapabilityDecision(
      session.row.id,
      new Date(expiresAt - 1),
    );
    if (!active || active.id !== decisionId) return;
    const runtime = getAgentRuntimeByKind(session.runtimeKind);
    void (async () => {
      await runtime
        .stopRun({
          externalSessionId: session.externalSessionId,
          liveSessionId: session.liveSessionId,
          workspaceKey: session.workspaceKey,
          directory: session.activeDirectory,
        })
        .catch(() => undefined);
      revokeCapabilityDecision(session.row.id, "expired", new Date(expiresAt));
      await runtime.applyCapabilityDecision({
        externalSessionId: session.externalSessionId,
        liveSessionId: session.liveSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
        decision: leastPrivilegeDecision(session.activeDirectory),
      });
      recordAuditEvent({
        eventType: "capability.expired",
        runtimeSessionId: session.row.id,
        userId: session.row.user_id,
        gardenId: session.row.garden_id,
        payload: { decisionId, restoredMode: "knowledge" },
      });
    })().catch(() => {
      recordAuditEvent({
        eventType: "capability.expiry_restore_failed",
        runtimeSessionId: session.row.id,
        userId: session.row.user_id,
        gardenId: session.row.garden_id,
        payload: { decisionId },
      });
    });
  }, delay);
  timer.unref?.();
}
