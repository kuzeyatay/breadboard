import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
} from "@/lib/hermes/route-helpers.ts";
import { authorizeRuntimeReference } from "@/lib/hermes/session-service.ts";
import { getAgentRuntimeByKind } from "@/lib/agent-runtime/runtime.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";
import {
  appendConversationSteerMessage,
  ConversationStoreError,
} from "@/lib/conversations/store.ts";
import {
  getActiveRuntimeRun,
  parseRuntimeRunDispatch,
} from "@/lib/hermes/run-store.ts";

export const dynamic = "force-dynamic";

const MAX_ANSWER_LENGTH = 20_000;

function parseAssistantContentOffset(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2_000_000) {
    throw new ApiError(
      400,
      "invalid_assistant_content_offset",
      "The assistant response boundary is invalid.",
    );
  }
  return Number(value);
}

// POST: answer a mid-turn `clarify` question. The body carries the Breadboard
// runtime-session id (which the user owns) and the answer; the requestId in
// the path is the Hermes clarify id. The answer is relayed first — that is
// what unblocks the turn — and then written into the transcript as a course
// correction on the active response, so it survives reload like a steer does.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { requestId } = await params;
    if (!requestId || requestId.length > 200) {
      throw new ApiError(400, "invalid_request_id", "Invalid clarify request id.");
    }
    const body = await readJsonBody(request);
    const answer = requireString(body.answer, "answer", MAX_ANSWER_LENGTH);
    const assistantContentOffset = parseAssistantContentOffset(
      body.assistantContentOffset,
    );

    const session = authorizeRuntimeReference(userId, body.sessionId);
    await getAgentRuntimeByKind(session.runtimeKind).resolveClarification({
      externalSessionId: session.externalSessionId,
      liveSessionId: session.liveSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      requestId,
      answer,
    });

    const activeRun = getActiveRuntimeRun(session.row.id);
    const courseCorrectionTargetClientMessageId = activeRun
      ? parseRuntimeRunDispatch(activeRun).clientMessageId
      : undefined;
    let persisted = false;
    if (session.row.conversation_id !== null) {
      try {
        appendConversationSteerMessage({
          conversationId: session.row.conversation_id,
          clientMessageId: `clarify:${requestId}`,
          surface: session.row.surface,
          content: answer,
          clarificationAnswer: true,
          targetClientMessageId: courseCorrectionTargetClientMessageId,
          assistantContentOffset,
        });
        persisted = true;
      } catch (error) {
        // The answer already reached the runtime; a transcript without a
        // pending assistant row (compatibility garden streams, or a turn that
        // finished between relay and write) must not turn that into a failure.
        if (
          !(error instanceof ConversationStoreError) ||
          error.code !== "turn_not_active"
        ) {
          throw error;
        }
      }
    }
    recordAuditEvent({
      eventType: "clarify.answered",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: { requestId, characterCount: answer.length, persisted },
    });

    return NextResponse.json({
      ok: true,
      courseCorrectionTargetClientMessageId,
      courseCorrectionOffset: assistantContentOffset,
      persisted,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
