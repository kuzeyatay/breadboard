import { NextResponse } from "next/server";
import db from "@/lib/db.ts";
import { DEFAULT_NOTIFICATION_LIMIT, MAX_NOTIFICATION_LIMIT, readLatestNotifications } from "@/lib/chat-notifications/read.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getActiveCapabilityDecision, getRuntimeSessionById, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const TOOL = "notifications_read";

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(403, "notifications_denied", "Notification access is not authorized.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    const conversation = session?.conversation_id ? getConversationById(session.conversation_id) : null;
    if (!session || !session.user_id || session.surface !== "dashboard_terminal"
      || verified.token.surface !== session.surface || verified.token.userId !== session.user_id
      || verified.token.conversationId !== session.conversation_id || conversation?.user_id !== session.user_id
      || runtimeExternalSessionId(session) !== verified.token.hermesSessionId) {
      throw new ApiError(403, "notifications_session_denied", "Only the account's own Voice or Terminal conversation can read its notifications.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(TOOL)) {
      throw new ApiError(403, "notifications_not_granted", "Notification access is not available on this turn.");
    }
    if (!getActiveRuntimeRun(session.id)) {
      throw new ApiError(409, "notifications_run_required", "An active conversation turn is required.");
    }
    const body = await readJsonBody(request, 4096);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args as Record<string, unknown> : {};
    const limit = args.limit ?? DEFAULT_NOTIFICATION_LIMIT;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > MAX_NOTIFICATION_LIMIT) {
      throw new ApiError(400, "notifications_invalid_limit", `Limit must be an integer from 1 to ${MAX_NOTIFICATION_LIMIT}.`);
    }
    return NextResponse.json({ ok: true, data: readLatestNotifications(db, session.user_id, Number(limit)) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
