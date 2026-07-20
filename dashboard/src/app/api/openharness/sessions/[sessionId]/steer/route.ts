import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
} from "@/lib/openharness/route-helpers.ts";
import { authorizeRuntimeSession } from "@/lib/openharness/session-service.ts";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { recordAuditEvent } from "@/lib/openharness/runtime-store.ts";
import {
  acceptSteerRequest,
  beginRuntimeRun,
  failSteerRequest,
  getActiveRuntimeRun,
  getRuntimeRun,
  parseRuntimeRunDispatch,
  reserveSteerRequest,
} from "@/lib/openharness/run-store.ts";

export const dynamic = "force-dynamic";

function parseSessionId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "invalid_session_id", "Invalid session id.");
  }
  return id;
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
    const session = authorizeRuntimeSession(userId, parseSessionId(sessionId));
    const body = await readJsonBody(request);
    const runId = requireString(body.runId, "runId", 200);
    const text = requireString(body.text, "text", 200_000);
    const clientRequestId = requireString(
      body.clientRequestId,
      "clientRequestId",
      200,
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

    const dispatch = parseRuntimeRunDispatch(requestedRun);
    try {
      await getOpenHarnessGateway().steerRun({
        openHarnessSessionId: session.openHarnessSessionId,
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
      deduplicated: !reserved.created,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
