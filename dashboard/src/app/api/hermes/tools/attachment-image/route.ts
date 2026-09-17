import db from "@/lib/db";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { verifyCapabilityToken, tokenAllows } from "@/lib/hermes/capability-token.ts";
import { getRuntimeSessionById, getActiveCapabilityDecision, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import { inspectAttachedImage, type ImageMessage } from "@/lib/hermes/attachment-image.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: "attachment_image" })) {
      throw new ApiError(403, "image_denied", "Image inspection is not authorized.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    if (!session?.user_id || !session.conversation_id ||
        session.user_id !== verified.token.userId ||
        session.conversation_id !== verified.token.conversationId ||
        runtimeExternalSessionId(session) !== verified.token.hermesSessionId) {
      throw new ApiError(403, "image_scope", "Image inspection requires an authenticated conversation.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run || !getActiveCapabilityDecision(session.id)?.allowedTools.includes("attachment_image")) {
      throw new ApiError(403, "image_turn", "Image inspection is unavailable on this turn.");
    }
    const dispatch = parseRuntimeRunDispatch(run);
    const messages = db.prepare(`SELECT m.id, m.metadata FROM conversation_messages m
      JOIN conversations c ON c.id=m.conversation_id
      WHERE m.conversation_id=? AND c.user_id=? AND m.role='user'
        AND m.order_index < (SELECT order_index FROM conversation_messages
          WHERE conversation_id=? AND client_message_id=? AND role='assistant')
      ORDER BY m.order_index DESC LIMIT 40`).all(
      session.conversation_id, session.user_id, session.conversation_id, dispatch.clientMessageId ?? "",
    ) as ImageMessage[];
    const body = await readJsonBody(request, 4096);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args as Record<string, unknown> : {};
    const data = await inspectAttachedImage(messages, args);
    if (request.signal.aborted || getActiveRuntimeRun(session.id)?.id !== run.id) {
      throw new ApiError(409, "image_stopped", "The image request was stopped.");
    }
    return Response.json({ data });
  } catch (error) {
    return apiErrorResponse(error instanceof ApiError ? error : new ApiError(400, "image_inspection", error instanceof Error ? error.message : "Image inspection failed."));
  }
}
