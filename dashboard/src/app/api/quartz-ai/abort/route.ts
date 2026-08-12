import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import { authorizeQuartzRuntimeSession, authorizeRuntimeReference, markStatus } from "@/lib/hermes/session-service.ts";
import { getAgentRuntimeByKind } from "@/lib/agent-runtime/runtime.ts";
import { corsHeaders } from "@/lib/hermes/quartz-support.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";
import { finishRuntimeRun, getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import { failAssistantMessage } from "@/lib/conversations/store.ts";

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
    const clientToken = typeof body.clientToken === "string" ? body.clientToken : null;
    const userId = await optionalUserId();
    const session = userId !== null && typeof body.sessionId === "string" && body.sessionId.startsWith("conv_")
      ? authorizeRuntimeReference(userId, body.sessionId)
      : authorizeQuartzRuntimeSession(requireNumericSessionId(body.sessionId), { userId, clientToken });
    const activeRun = getActiveRuntimeRun(session.row.id);
    await getAgentRuntimeByKind(session.runtimeKind).stopRun({
      externalSessionId: session.externalSessionId,
      liveSessionId: session.liveSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
    });
    markStatus(session, "aborted");
    if (activeRun) {
      const clientMessageId = parseRuntimeRunDispatch(activeRun).clientMessageId;
      if (session.row.conversation_id !== null && clientMessageId) {
        failAssistantMessage({
          conversationId: session.row.conversation_id,
          clientMessageId,
          status: "aborted",
          error: "cancelled_by_user",
        });
      }
      finishRuntimeRun(activeRun.id, "cancelled");
    }
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

function requireNumericSessionId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "invalid_session_id", "A valid sessionId is required.");
  }
  return id;
}
