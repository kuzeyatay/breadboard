import { NextResponse } from "next/server";
import { leastPrivilegeDecision } from "@/lib/hermes/dispatch-core.ts";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { authorizeRuntimeReference, markStatus } from "@/lib/hermes/session-service.ts";
import { getAgentRuntimeByKind } from "@/lib/agent-runtime/runtime.ts";
import {
  recordAuditEvent,
  revokeCapabilityDecision,
} from "@/lib/hermes/runtime-store.ts";
import {
  finishRuntimeRun,
  getActiveRuntimeRun,
  getLatestRuntimeRun,
  parseRuntimeRunDispatch,
} from "@/lib/hermes/run-store.ts";
import { failAssistantMessage } from "@/lib/conversations/store.ts";
import { stopRuntimeSessionWork } from "@/lib/hermes/session-cancel.ts";
import { abortDirectProviderTurn } from "@/lib/conversations/direct-turn-service.ts";

export const dynamic = "force-dynamic";

// POST: abort active generation for a session. The Hermes session id is
// derived server-side from the authorized runtime-session record.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { sessionId } = await params;
    const session = authorizeRuntimeReference(userId, sessionId);
    const directTurn = session.row.conversation_id === null
      ? null
      : abortDirectProviderTurn(session.row.conversation_id);
    if (directTurn && session.row.conversation_id !== null) {
      failAssistantMessage({
        conversationId: session.row.conversation_id,
        clientMessageId: directTurn.clientMessageId,
        status: "aborted",
        error: "cancelled_by_user",
      });
      recordAuditEvent({
        eventType: "direct_provider.cancelled",
        runtimeSessionId: session.row.id,
        userId,
        gardenId: session.row.garden_id,
        payload: { clientMessageId: directTurn.clientMessageId },
      });
      return NextResponse.json({
        aborted: true,
        alreadyFinished: false,
        runId: null,
        status: "cancelled",
      });
    }
    const activeRun = getActiveRuntimeRun(session.row.id);
    if (!activeRun) {
      const latest = getLatestRuntimeRun(session.row.id);
      return NextResponse.json({
        aborted: false,
        alreadyFinished: true,
        runId: latest?.id ?? null,
        status: latest?.status ?? "completed",
      });
    }
    requireEnabled();
    const runtime = getAgentRuntimeByKind(session.runtimeKind);
    markStatus(session, "stopping");
    // The turn, the terminal command it started and the visualizer it opened
    // all stop together; deleting the chat cancels the same three.
    const stopped = await stopRuntimeSessionWork(session.row.id, session);
    if (session.row.conversation_id !== null) {
      const clientMessageId = parseRuntimeRunDispatch(activeRun).clientMessageId;
      if (clientMessageId) {
        failAssistantMessage({
          conversationId: session.row.conversation_id,
          clientMessageId,
          status: "aborted",
          error: "cancelled_by_user",
        });
      }
    }
    const cancelled = finishRuntimeRun(activeRun.id, "cancelled");
    if (!cancelled) {
      const latest = getLatestRuntimeRun(session.row.id);
      return NextResponse.json({
        aborted: false,
        alreadyFinished: true,
        runId: latest?.id ?? activeRun.id,
        status: latest?.status ?? "completed",
      });
    }
    markStatus(session, "aborted");
    revokeCapabilityDecision(session.row.id, "cancelled");
    await runtime.applyCapabilityDecision({
      externalSessionId: session.externalSessionId,
      liveSessionId: session.liveSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      decision: leastPrivilegeDecision(session.activeDirectory),
    });
    recordAuditEvent({
      eventType: "session.cancelled",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: stopped,
    });
    return NextResponse.json({
      aborted: true,
      alreadyFinished: false,
      runId: activeRun.id,
      status: "cancelled",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
