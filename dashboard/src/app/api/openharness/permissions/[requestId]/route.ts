import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import { authorizeRuntimeReference } from "@/lib/openharness/session-service.ts";
import { getAgentRuntimeByKind } from "@/lib/agent-runtime/runtime.ts";
import { recordAuditEvent } from "@/lib/openharness/runtime-store.ts";

export const dynamic = "force-dynamic";

const DECISIONS = new Set(["once", "always", "reject"]);

// POST: respond to a permission request. The body carries the Breadboard
// runtime-session id (which the user owns) and the decision. The requestId is
// the OpenHarness permission id from the path. We authorize the session, record
// the decision for audit, then relay to OpenHarness.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { requestId } = await params;
    if (!requestId || requestId.length > 200) {
      throw new ApiError(400, "invalid_request_id", "Invalid permission request id.");
    }
    const body = await readJsonBody(request);
    const decision = typeof body.decision === "string" ? body.decision : "";
    if (!DECISIONS.has(decision)) {
      throw new ApiError(400, "invalid_decision", "decision must be once, always, or reject.");
    }

    const session = authorizeRuntimeReference(userId, body.sessionId);
    await getAgentRuntimeByKind(session.runtimeKind).resolveApproval({
      externalSessionId: session.externalSessionId,
      liveSessionId: session.liveSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      requestId,
      decision: decision as "once" | "always" | "reject",
    });
    recordAuditEvent({
      eventType: "permission.decided",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: { requestId, decision },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
