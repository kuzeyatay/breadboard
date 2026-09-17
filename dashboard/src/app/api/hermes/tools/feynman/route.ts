import { NextResponse } from "next/server";
import { getConversationById } from "@/lib/conversations/store.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getActiveCapabilityDecision, getRuntimeSessionById, recordAuditEvent, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { FEYNMAN_TOOL, FeynmanError, researchFeynman, type FeynmanInput } from "@/lib/feynman/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: FEYNMAN_TOOL })) {
      throw new ApiError(403, "feynman_capability_denied", "Feynman research is not authorized.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    if (!session || session.user_id === null || session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id) {
      throw new ApiError(403, "feynman_session_scope_mismatch", "Feynman research session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision?.allowedTools.includes(FEYNMAN_TOOL)) {
      throw new ApiError(403, "feynman_tool_not_granted", "Feynman research is not available on this turn.");
    }
    const conversation = getConversationById(session.conversation_id);
    if (!conversation || conversation.user_id !== session.user_id) {
      throw new ApiError(403, "feynman_conversation_missing", "The research conversation is unavailable.");
    }
    const body = await readJsonBody(request, 16 * 1024);
    if (body.tool !== FEYNMAN_TOOL) throw new ApiError(400, "feynman_unknown_tool", "Unknown Feynman operation.");
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args as unknown as FeynmanInput : { query: "" };
    const data = await researchFeynman(args, { signal: request.signal });
    recordAuditEvent({ eventType: "feynman.tool_completed", runtimeSessionId: session.id, userId: session.user_id, gardenId: session.garden_id,
      payload: { papersReturned: data.papers.length, sources: data.sources.map(({ source, status }) => ({ source, status })) } });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof FeynmanError) return apiErrorResponse(new ApiError(error.code === "invalid_arguments" ? 400 : error.code === "aborted" ? 499 : 502, `feynman_${error.code}`, error.message));
    return apiErrorResponse(error);
  }
}
