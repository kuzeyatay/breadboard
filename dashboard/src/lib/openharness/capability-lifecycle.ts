import { decideCapabilityMode, type CapabilityDecision } from "./capability-policy.ts";
import { getOpenHarnessGateway } from "./gateway.ts";
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
    const gateway = getOpenHarnessGateway();
    void (async () => {
      await gateway
        .abortSession({
          openHarnessSessionId: session.openHarnessSessionId,
          workspaceKey: session.workspaceKey,
          directory: session.activeDirectory,
        })
        .catch(() => undefined);
      revokeCapabilityDecision(session.row.id, "expired", new Date(expiresAt));
      await gateway.applyCapabilityDecision({
        openHarnessSessionId: session.openHarnessSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
        decision: decideCapabilityMode({
          surface: session.row.surface,
          userId: session.row.user_id,
          requestedOutcome: "Resume default knowledge work.",
          authorizedRoot: session.activeDirectory,
        }),
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
