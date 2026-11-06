import { NextResponse } from "next/server";
import { getConversationById } from "@/lib/conversations/store.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getActiveCapabilityDecision, getRuntimeSessionById, recordAuditEvent, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { readHermesConfig } from "@/lib/hermes/config.ts";
import { directoryForWorkspaceKey } from "@/lib/hermes/workspace.ts";
import { runMultisim } from "@/lib/hermes/multisim-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: "multisim" })) throw new ApiError(403, "multisim_capability_denied", "Circuit tools are not authorized.");
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    if (!session || session.user_id === null || session.conversation_id === null ||
        !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
        runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
        verified.token.conversationId !== session.conversation_id) throw new ApiError(403, "multisim_session_scope_mismatch", "Circuit session scope is invalid.");
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision?.allowedTools.includes("multisim")) throw new ApiError(403, "multisim_tool_not_granted", "Circuit tools are unavailable on this turn.");
    const conversation = getConversationById(session.conversation_id);
    if (!conversation || conversation.user_id !== session.user_id) throw new ApiError(403, "multisim_conversation_missing", "Circuit conversation is unavailable.");
    const body = await readJsonBody(request, 512 * 1024);
    if (body.tool !== "multisim") throw new ApiError(400, "multisim_unknown_tool", "Unknown circuit tool.");
    const workspace = directoryForWorkspaceKey(readHermesConfig(), session.workspace_key);
    const data = await runMultisim(workspace, body.args, { signal: request.signal });
    recordAuditEvent({ eventType: "multisim.tool_completed", runtimeSessionId: session.id, userId: session.user_id, gardenId: session.garden_id,
      payload: { action: (body.args as { action?: unknown })?.action } });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return apiErrorResponse(error instanceof ApiError ? error : new ApiError(400, "multisim_failed", error instanceof Error ? error.message : "Circuit operation failed"));
  }
}
