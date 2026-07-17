import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import { authorizeRuntimeSession } from "@/lib/openharness/session-service.ts";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { appendRuntimeMessage } from "@/lib/openharness/runtime-store.ts";
import db from "@/lib/db";

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
    const runtimeSessionId = Number(body.sessionId);
    if (!Number.isInteger(runtimeSessionId) || runtimeSessionId <= 0) {
      throw new ApiError(400, "invalid_session_id", "A valid sessionId is required.");
    }
    const decision = typeof body.decision === "string" ? body.decision : "";
    if (!DECISIONS.has(decision)) {
      throw new ApiError(400, "invalid_decision", "decision must be once, always, or reject.");
    }

    const session = authorizeRuntimeSession(userId, runtimeSessionId);
    await getOpenHarnessGateway().respondToPermission({
      openHarnessSessionId: session.openHarnessSessionId,
      workspaceKey: session.workspaceKey,
      requestId,
      decision: decision as "once" | "always" | "reject",
    });

    // Record the permission decision alongside the transcript for auditability.
    db.prepare(
      `UPDATE openharness_runtime_sessions SET updated_at = datetime('now') WHERE id = ?`,
    ).run(session.row.id);
    if (!session.row.chat_session_id) {
      appendRuntimeMessage({
        runtimeSessionId: session.row.id,
        role: "assistant",
        content: `Permission ${decision}: ${requestId}`,
        permissionDecisions: [{ requestId, decision, at: new Date().toISOString() }],
        runtimeStatus: "permission",
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
