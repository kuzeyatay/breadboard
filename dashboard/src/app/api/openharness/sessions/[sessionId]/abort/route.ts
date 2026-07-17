import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { authorizeRuntimeSession, markStatus } from "@/lib/openharness/session-service.ts";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";

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
    await getOpenHarnessGateway().abortSession({
      openHarnessSessionId: session.openHarnessSessionId,
      workspaceKey: session.workspaceKey,
    });
    markStatus(session, "aborted");
    return NextResponse.json({ aborted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
