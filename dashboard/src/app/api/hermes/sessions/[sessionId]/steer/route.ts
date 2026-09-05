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
import { parseChatAttachments } from "@/lib/chat-attachments-request.ts";
import { chatMessageAttachments } from "@/lib/chat-attachments.ts";
import { hermesMessageId } from "@/lib/hermes/message-id.ts";
import {
  appendConversationSteerMessage,
  ConversationStoreError,
} from "@/lib/conversations/store.ts";
import {
  acceptSteerRequest,
  failSteerRequest,
  getActiveRuntimeRun,
  getRuntimeRun,
  getSteerRequest,
  parseRuntimeRunDispatch,
  reserveSteerRequest,
} from "@/lib/hermes/run-store.ts";

export const dynamic = "force-dynamic";

function parseAssistantContentOffset(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2_000_000) {
    throw new ApiError(
      400,
      "invalid_assistant_content_offset",
      "The assistant response boundary is invalid.",
    );
  }
  return Number(value);
}

// POST: redirect the existing active run with a course correction. It deliberately
// does not create a session, run, assistant placeholder, or SSE subscription.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const session = authorizeRuntimeReference(userId, sessionId);
    const body = await readJsonBody(request);
    const runId = requireString(body.runId, "runId", 200);
    const text = requireString(body.text, "text", 200_000);
    const attachments = parseChatAttachments(body.attachments);
    const clientRequestId = requireString(
      body.clientRequestId,
      "clientRequestId",
      200,
    );
    const assistantContentOffset = parseAssistantContentOffset(
      body.assistantContentOffset,
    );

    const requestedRun = getRuntimeRun(runId);
    if (
      !requestedRun ||
      requestedRun.runtime_session_id !== session.row.id
    ) {
      throw new ApiError(
        409,
        "run_not_active",
        "That run is no longer active. Send this as a follow-up instead.",
      );
    }

    const dispatch = parseRuntimeRunDispatch(requestedRun);
    const courseCorrectionTargetClientMessageId = dispatch.clientMessageId;
    // Resolve acknowledgements before checking liveness: a delivered request
    // remains delivered even if the turn completed while its response travelled.
    const existing = getSteerRequest(session.row.id, clientRequestId);
    if (
      !existing && (
        requestedRun.status !== "active" ||
        getActiveRuntimeRun(session.row.id)?.id !== runId
      )
    ) {
      throw new ApiError(409, "run_not_active", "That run is no longer active.");
    }
    const reserved = existing
      ? { request: existing, created: false }
      : reserveSteerRequest({
          runtimeSessionId: session.row.id,
          runId,
          clientRequestId,
          content: text,
        });
    if (!reserved.created) {
      if (
        reserved.request.run_id !== runId ||
        reserved.request.content !== text
      ) {
        throw new ApiError(
          409,
          "client_request_conflict",
          "That steering request id was already used for different content.",
        );
      }
      if (reserved.request.status === "accepted") {
        return NextResponse.json({
          accepted: true,
          runId: reserved.request.result_run_id ?? runId,
          mode: reserved.request.result_mode ?? "steer",
          clientRequestId,
          courseCorrectionTargetClientMessageId,
          courseCorrectionOffset: assistantContentOffset,
          deduplicated: true,
        });
      }
      if (reserved.request.status === "failed") {
        throw new ApiError(
          409,
          reserved.request.error_code ?? "steer_failed",
          "That steering request previously failed.",
        );
      }
      // The first request owns delivery. A concurrent retry must never send
      // the same correction into Hermes a second time.
      throw new ApiError(409, "steer_pending", "The course correction is still being delivered.");
    }

    try {
      const accepted = await getAgentRuntimeByKind(session.runtimeKind).steerRun({
        externalSessionId: session.externalSessionId,
        liveSessionId: session.liveSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
        agentName: session.agentName,
        text,
        attachments,
        model: dispatch.model,
        variant: dispatch.variant,
        tools: dispatch.tools,
        system: dispatch.system,
        clientRequestId,
        messageId: dispatch.clientMessageId
          ? hermesMessageId(dispatch.clientMessageId)
          : undefined,
      });
      if (!accepted) {
        failSteerRequest(reserved.request.id, "steer_unavailable");
        throw new ApiError(409, "steer_unavailable", "This correction will send as a follow-up when the turn finishes.");
      }
    } catch (error) {
      failSteerRequest(reserved.request.id, "steer_dispatch_failed");
      throw error;
    }

    // A redirect was accepted by this exact turn. Its completion racing this
    // response never means that Hermes submitted a replacement prompt.
    acceptSteerRequest({
      requestId: reserved.request.id,
      runtimeSessionId: session.row.id,
      chatSessionId: session.row.chat_session_id,
      content: text,
      resultRunId: runId,
      resultMode: "steer",
    });
    if (session.row.conversation_id !== null) {
      try {
        appendConversationSteerMessage({
          conversationId: session.row.conversation_id,
          clientMessageId: `steer:${clientRequestId}`,
          surface: session.row.surface,
          content: text,
          attachments: chatMessageAttachments(attachments),
          targetClientMessageId: courseCorrectionTargetClientMessageId,
          assistantContentOffset,
        });
      } catch (error) {
        // Compatibility garden streams own their pending assistant row in the
        // legacy chat transcript. acceptSteerRequest already persisted the
        // visible correction there, so absence of a canonical pending row is
        // expected and must not turn an accepted upstream steer into an error.
        if (
          !session.row.chat_session_id ||
          !(error instanceof ConversationStoreError) ||
          error.code !== "turn_not_active"
        ) {
          throw error;
        }
      }
    }
    recordAuditEvent({
      eventType: "run.steered",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: {
        runId,
        clientRequestId,
        characterCount: text.length,
      },
    });

    return NextResponse.json({
      accepted: true,
      runId,
      mode: "steer",
      clientRequestId,
      courseCorrectionTargetClientMessageId,
      courseCorrectionOffset: assistantContentOffset,
      deduplicated: !reserved.created,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
