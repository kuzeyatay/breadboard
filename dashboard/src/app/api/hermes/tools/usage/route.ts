import { NextResponse } from "next/server";
import { localChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getActiveCapabilityDecision, getRuntimeSessionById, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { readCodexUsageStatus } from "@/lib/hermes/usage-status.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const TOOL = "breadboard_usage";

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(403, "usage_denied", "Usage access is not authorized.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    const conversation = session?.conversation_id ? getConversationById(session.conversation_id) : null;
    if (!session || !session.user_id || !["dashboard_terminal", "garden_chat"].includes(session.surface)
      || verified.token.surface !== session.surface || verified.token.userId !== session.user_id
      || verified.token.conversationId !== session.conversation_id || conversation?.user_id !== session.user_id
      || runtimeExternalSessionId(session) !== verified.token.hermesSessionId) {
      throw new ApiError(403, "usage_session_denied", "Usage access requires an authenticated conversation.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision?.allowedTools.includes(TOOL)) {
      throw new ApiError(403, "usage_not_granted", "Usage access is not available on this turn.");
    }
    if (!getActiveRuntimeRun(session.id)) {
      throw new ApiError(409, "usage_run_required", "An active conversation turn is required.");
    }
    const body = await readJsonBody(request, 4096);
    if (body.action !== TOOL) {
      throw new ApiError(400, "usage_unknown_tool", "Unknown usage tool.");
    }
    if (body.args !== undefined && (!body.args || typeof body.args !== "object"
      || Array.isArray(body.args) || Object.keys(body.args).length > 0)) {
      throw new ApiError(400, "usage_invalid_args", "This tool reads the connected account and accepts no arguments.");
    }
    return NextResponse.json({ ok: true, data: await readCodexUsageStatus(localChatmockBaseUrl()) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
