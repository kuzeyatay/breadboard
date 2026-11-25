import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import { authorizeRuntimeReference } from "@/lib/hermes/session-service.ts";
import { getAgentRuntimeByKind } from "@/lib/agent-runtime/runtime.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";
import { resolveApprovalNotification } from "@/lib/chat-notifications/approvals.ts";
import db from "@/lib/db";
import {
  addTerminalCommandRule,
  takePendingTerminalCommand,
} from "@/lib/hermes/terminal-command-rules.ts";

export const dynamic = "force-dynamic";

const DECISIONS = new Set(["once", "always", "reject"]);

// POST: respond to a permission request. The body carries the Breadboard
// runtime-session id (which the user owns) and the decision. The requestId is
// the Hermes permission id from the path. We authorize the session, record
// the decision for audit, then relay to Hermes.
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
    resolveApprovalNotification(db, session.row.id, requestId);
    // "Always" on a terminal card saves a Codex-style prefix rule from the
    // command the server refused, never from text the browser sends.
    const pendingCommand = takePendingTerminalCommand(session.row.id);
    const savedRule =
      decision === "always" && pendingCommand
        ? addTerminalCommandRule(userId, pendingCommand)
        : null;
    recordAuditEvent({
      eventType: "permission.decided",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: {
        requestId,
        decision,
        ...(savedRule ? { savedTerminalRule: savedRule.join(" ") } : {}),
      },
    });

    return NextResponse.json({ ok: true, ...(savedRule ? { savedRule } : {}) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
