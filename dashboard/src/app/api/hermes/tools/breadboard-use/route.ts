import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getRuntimeSessionById, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { executeBreadboardAction } from "@/lib/hermes/breadboard-use.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: "breadboard_use" })) {
      throw new ApiError(403, "breadboard_use_denied", "Breadboard control is not authorized.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    const conversation = session?.conversation_id ? getConversationById(session.conversation_id) : null;
    if (!session || session.surface === "quartz_ai" || !session.user_id ||
      verified.token.surface !== session.surface || verified.token.userId !== session.user_id ||
      conversation?.user_id !== session.user_id || verified.token.conversationId !== session.conversation_id ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId) {
      throw new ApiError(403, "breadboard_use_session_denied", "Only an authenticated Breadboard conversation can control the app.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) throw new ApiError(409, "breadboard_use_run_required", "A current conversation run is required.");
    const body = await readJsonBody(request, 32768);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args as Record<string, unknown> : body;
    let data = await executeBreadboardAction(args, String(session.id), session.user_id, run.id);
    if (["recording_stop", "recording_status"].includes(String(args.action))) {
      const { attachScreenRecording } = await import("@/lib/hermes/screen-recording-artifact.ts");
      data = await attachScreenRecording(data, session, run.id);
    }
    return NextResponse.json({ ok: true, data });
  } catch (error) { return apiErrorResponse(error); }
}
