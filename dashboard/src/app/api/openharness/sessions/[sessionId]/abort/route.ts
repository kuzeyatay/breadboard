import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { authorizeRuntimeSession, markStatus } from "@/lib/openharness/session-service.ts";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import {
  recordAuditEvent,
  revokeCapabilityDecision,
} from "@/lib/openharness/runtime-store.ts";
import { decideCapabilityMode } from "@/lib/openharness/capability-policy.ts";

export const dynamic = "force-dynamic";

// POST: abort active generation for a session. The OpenHarness session id is
// derived server-side from the authorized runtime-session record.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const id = Number(sessionId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, "invalid_session_id", "Invalid session id.");
    }
    const session = authorizeRuntimeSession(userId, id);
    const gateway = getOpenHarnessGateway();
    await gateway.abortSession({
      openHarnessSessionId: session.openHarnessSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
    });
    markStatus(session, "aborted");
    revokeCapabilityDecision(session.row.id, "cancelled");
    await gateway.applyCapabilityDecision({
      openHarnessSessionId: session.openHarnessSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      decision: decideCapabilityMode({
        surface: session.row.surface,
        userId,
        requestedOutcome: "Resume default knowledge work.",
        authorizedRoot: session.activeDirectory,
      }),
    });
    recordAuditEvent({
      eventType: "session.cancelled",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
    });
    return NextResponse.json({ aborted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
