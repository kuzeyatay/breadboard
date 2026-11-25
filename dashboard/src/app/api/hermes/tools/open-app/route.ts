import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getRuntimeSessionById, recordAuditEvent, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { normalizeOpenAppArgs, openDesktopApp } from "@/lib/hermes/open-app.ts";

export const dynamic = "force-dynamic";

// Hermes's pre-tool approval (answered by YOLO's session bypass) has already
// run when this is reached; this route checks who is asking, then hands the
// launch to the desktop shell, outside the runtime's kill-on-close job.
export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: "open_app" })) {
      throw new ApiError(403, "open_app_denied", "Opening apps is not authorized for this turn.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    const conversation = session?.conversation_id ? getConversationById(session.conversation_id) : null;
    if (!session || session.surface === "quartz_ai" || !session.user_id ||
      verified.token.surface !== session.surface || verified.token.userId !== session.user_id ||
      conversation?.user_id !== session.user_id || verified.token.conversationId !== session.conversation_id ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId) {
      throw new ApiError(403, "open_app_session_denied", "Only an authenticated Breadboard conversation can open apps.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) throw new ApiError(409, "open_app_run_required", "A current conversation run is required.");
    const body = await readJsonBody(request, 32768);
    const raw = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args as Record<string, unknown> : body as Record<string, unknown>;
    const args = normalizeOpenAppArgs(raw);
    const data = await openDesktopApp(args, session.user_id);
    recordAuditEvent({
      eventType: "desktop.app_opened",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { runId: run.id, target: args.target.slice(0, 300), method: data.method ?? null, pid: data.pid ?? null },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) { return apiErrorResponse(error); }
}
