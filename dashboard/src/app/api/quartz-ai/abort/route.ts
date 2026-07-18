import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { authorizeQuartzRuntimeSession, markStatus } from "@/lib/openharness/session-service.ts";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { corsHeaders } from "@/lib/openharness/quartz-support.ts";
import { recordAuditEvent } from "@/lib/openharness/runtime-store.ts";

export const dynamic = "force-dynamic";

async function optionalUserId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const id = Number((session?.user as { id?: string } | undefined)?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    requireEnabled();
    const body = await readJsonBody(request);
    const sessionId = Number(body.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      throw new ApiError(400, "invalid_session_id", "A valid sessionId is required.");
    }
    const clientToken = typeof body.clientToken === "string" ? body.clientToken : null;
    const userId = await optionalUserId();
    const session = authorizeQuartzRuntimeSession(sessionId, {
      userId,
      clientToken,
    });
    await getOpenHarnessGateway().abortSession({
      openHarnessSessionId: session.openHarnessSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
    });
    markStatus(session, "aborted");
    recordAuditEvent({
      eventType: "session.cancelled",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: { surface: "quartz_ai" },
    });
    return NextResponse.json({ aborted: true }, { headers: cors });
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
}
