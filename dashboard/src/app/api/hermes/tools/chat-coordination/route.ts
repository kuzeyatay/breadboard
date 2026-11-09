import { NextResponse } from "next/server";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getActiveCapabilityDecision, getRuntimeSessionById, recordAuditEvent, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import { listAuthorizedGardens } from "@/lib/hermes/session-service.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled, requireString } from "@/lib/hermes/route-helpers.ts";
import { CHAT_COORDINATION_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import { authorizeCoordinationChat, coordinationStore, deliverChatMessages, waitForChatMessage } from "@/lib/conversations/coordination.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > max) throw new ApiError(400, "chat_invalid_number", `Expected an integer from 0 to ${max}.`);
  return Number(value);
}

export async function POST(request: Request) {
  let sessionId: number | null = null;
  try {
    requireEnabled();
    const body = await readJsonBody(request, 24 * 1024);
    const tool = typeof body.tool === "string" ? body.tool : "";
    if (!(CHAT_COORDINATION_TOOLS as readonly string[]).includes(tool)) throw new ApiError(400, "chat_unknown_tool", "Unknown chat coordination tool.");
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool })) throw new ApiError(403, "chat_capability_denied", "Chat coordination is not authorized.");
    sessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(sessionId);
    const decision = getActiveCapabilityDecision(sessionId);
    const run = getActiveRuntimeRun(sessionId);
    if (!session || session.user_id === null || session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      verified.token.userId !== session.user_id || verified.token.surface !== session.surface ||
      verified.token.conversationId !== session.conversation_id ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      !decision?.allowedTools.includes(tool) || !run) throw new ApiError(403, "chat_session_scope_denied", "An active authorized chat turn is required.");
    const source = authorizeCoordinationChat(session.user_id, session.conversation_id);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args as Record<string, unknown> : {};
    const store = coordinationStore();
    let data: unknown;
    if (tool === "chat_list") {
      if (args.query !== undefined && typeof args.query !== "string") throw new ApiError(400, "chat_invalid_query", "query must be text.");
      const limit = integer(args.limit, 20, 50);
      if (!limit) throw new ApiError(400, "chat_invalid_limit", "limit must be at least 1.");
      const rows = store.list(session.user_id, String(args.query ?? "").slice(0, 300), integer(args.after_id, 0, Number.MAX_SAFE_INTEGER), limit + 1, listAuthorizedGardens(session.user_id).map(g => g.id));
      data = { currentChatId: source.public_id, chats: rows.slice(0, limit).map(row => ({ ...row, busy: Boolean(row.busy) })),
        nextAfterId: rows.length > limit ? rows[limit - 1].id : null };
    } else if (tool === "chat_send_message") {
      const targetId = requireString(args.chat_id, "chat_id", 100).trim();
      authorizeCoordinationChat(session.user_id, targetId);
      const currentClientId = parseRuntimeRunDispatch(run).clientMessageId;
      const parentId = currentClientId?.startsWith("chat-message:") ? currentClientId.slice("chat-message:".length) : undefined;
      const envelope = store.enqueue({ userId: session.user_id, sourceId: source.id, targetId,
        sourceRunId: run.id, parentId, requestId: requireString(args.request_id, "request_id", 100).trim(),
        message: requireString(args.message, "message", 12_000).trim() });
      void deliverChatMessages(envelope.target_id);
      data = store.receipt(session.user_id, source.id, envelope.id);
    } else {
      data = await waitForChatMessage({ userId: session.user_id, sourceId: source.id,
        messageId: requireString(args.message_id, "message_id", 100), timeoutMs: integer(args.timeout_ms, 30_000, 30_000), signal: request.signal });
    }
    recordAuditEvent({ eventType: "chatCoordination.tool_completed", runtimeSessionId: sessionId, userId: session.user_id, payload: { tool } });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    recordAuditEvent({ eventType: "chatCoordination.tool_failed", runtimeSessionId: sessionId,
      payload: { reason: error instanceof ApiError ? error.code : "chat_coordination_failed" } });
    return apiErrorResponse(error);
  }
}
