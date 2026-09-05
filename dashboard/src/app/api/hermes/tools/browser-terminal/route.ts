import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getRuntimeSessionById, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { getBrowserTerminalContext, readBrowserTerminal } from "@/lib/hermes/browser-terminal-context.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: "browser_terminal" })) {
      throw new ApiError(403, "browser_denied", "Browser access is not authorized.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    const conversation = session?.conversation_id ? getConversationById(session.conversation_id) : null;
    if (!session || session.surface === "quartz_ai" || !session.user_id
      || verified.token.surface !== session.surface
      || verified.token.userId !== session.user_id
      || conversation?.user_id !== session.user_id
      || verified.token.conversationId !== session.conversation_id
      || runtimeExternalSessionId(session) !== verified.token.hermesSessionId) {
      throw new ApiError(403, "browser_session_denied", "Only the linked Terminal conversation can access this page.");
    }
    if (!getActiveRuntimeRun(session.id)) throw new ApiError(409, "browser_run_required", "A current Terminal run is required.");
    const access = getBrowserTerminalContext(session.id);
    if (!access) throw new ApiError(409, "browser_not_linked", "Send a message from the Terminal beside the browser page to connect it.");
    const body = await readJsonBody(request, 4096);
    const args = body.args && typeof body.args === "object" ? body.args as Record<string, unknown> : body;
    if (!["read", "screenshot", "scroll"].includes(String(args.action))) {
      throw new ApiError(400, "invalid_browser_action", "Use read, screenshot, or scroll.");
    }
    if (args.action === "scroll" && !["up", "down", "top", "bottom"].includes(String(args.direction))) {
      throw new ApiError(400, "invalid_browser_direction", "Choose up, down, top, or bottom.");
    }
    const page = await readBrowserTerminal(access, args.action as "read" | "screenshot" | "scroll", args.direction as "up" | "down" | "top" | "bottom");
    return NextResponse.json({ ok: true, data: page });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
