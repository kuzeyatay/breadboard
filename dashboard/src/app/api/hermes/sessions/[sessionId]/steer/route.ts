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
  acceptSteerRequest,
  beginRuntimeRun,
  failSteerRequest,
  getActiveRuntimeRun,
  getRuntimeRun,
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

// POST: enqueue a course correction on the existing active run. It deliberately
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
    const clientRequestId = requireString(
      body.clientRequestId,
      "clientRequestId",
      200,
    );
    const assistantContentOffset = parseAssistantContentOffset(
      body.assistantContentOffset,
    );

    const requestedRun = getRuntimeRun(runId);
    const activeRun = getActiveRuntimeRun(session.row.id);
    if (
      !requestedRun ||
      requestedRun.runtime_session_id !== session.row.id ||
      requestedRun.status !== "active" ||
      activeRun?.id !== requestedRun.id
    ) {
      throw new ApiError(
        409,
        "run_not_active",
        "That run is no longer active. Send this as a follow-up instead.",
      );
    }

    const dispatch = parseRuntimeRunDispatch(requestedRun);
    const courseCorrectionTargetClientMessageId = dispatch.clientMessageId;
    const reserved = reserveSteerRequest({
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
    }

    try {
      await getAgentRuntimeByKind(session.runtimeKind).steerRun({
        externalSessionId: session.externalSessionId,
        liveSessionId: session.liveSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
        agentName: session.agentName,
        text,
        model: dispatch.model,
        variant: dispatch.variant,
        tools: dispatch.tools,
        system: dispatch.system,
        clientRequestId,
      });
    } catch (error) {
      failSteerRequest(reserved.request.id, "steer_dispatch_failed");
      throw error;
    }

    const stillActive = getRuntimeRun(runId)?.status === "active";
    const adoptedRun = stillActive
      ? requestedRun
      : beginRuntimeRun({
          runtimeSessionId: session.row.id,
          instruction: text,
          dispatch,
        });
    acceptSteerRequest({
      requestId: reserved.request.id,
      runtimeSessionId: session.row.id,
      chatSessionId: session.row.chat_session_id,
      content: text,
      resultRunId: adoptedRun.id,
      resultMode: stillActive ? "steer" : "follow_up",
    });
    if (session.row.conversation_id !== null) {
      try {
        appendConversationSteerMessage({
          conversationId: session.row.conversation_id,
          clientMessageId: `steer:${clientRequestId}`,
          surface: session.row.surface,
          content: text,
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
      eventType: stillActive ? "run.steered" : "run.steer_fallback",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: {
        runId,
        adoptedRunId: adoptedRun.id,
        clientRequestId,
        characterCount: text.length,
      },
    });

    return NextResponse.json({
      accepted: true,
      runId: adoptedRun.id,
      mode: stillActive ? "steer" : "follow_up",
      clientRequestId,
      courseCorrectionTargetClientMessageId,
      courseCorrectionOffset: assistantContentOffset,
      deduplicated: !reserved.created,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
