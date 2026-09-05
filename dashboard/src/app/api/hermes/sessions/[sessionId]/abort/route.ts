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
import {
  cancelLatestConversationTurn,
  failAssistantMessage,
} from "@/lib/conversations/store.ts";
import { finishExternalAgentTurn } from "@/lib/conversations/external-agent-turns.ts";
import { cancelRunningExternalAgentRuns } from "@/lib/conversations/external-agent-cancel.ts";
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
    const externalRuns = session.row.conversation_id === null
      ? []
      : await cancelRunningExternalAgentRuns(
          userId,
          session.row.conversation_id,
        );
    if (session.row.conversation_id !== null) {
      for (const run of externalRuns) {
        // The manager may already have retired a stale run, but the user has
        // explicitly stopped waiting for it. Seal the durable owner either way
        // so Recents cannot keep spinning on old `running` metadata.
        try {
          finishExternalAgentTurn({
            conversationId: session.row.conversation_id,
            clientMessageId: run.clientMessageId,
            outcome: "aborted",
            content: "Stopped by the user.",
          });
        } catch {
          // A concurrent terminal event won the race; that terminal result is
          // already more authoritative than this cancellation acknowledgement.
        }
      }
    }
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
        externalRuns: externalRuns.length,
      });
    }
    const activeRun = getActiveRuntimeRun(session.row.id);
    if (!activeRun) {
      // Stop can beat runtime/direct-provider registration after the user and
      // assistant placeholders are already durable. Seal that latest turn so
      // the request still preparing in another handler cannot revive it.
      const pendingTurn = session.row.conversation_id === null
        ? null
        : cancelLatestConversationTurn(session.row.conversation_id);
      if (pendingTurn) {
        markStatus(session, "aborted");
        return NextResponse.json({
          aborted: true,
          alreadyFinished: false,
          runId: null,
          status: "cancelled",
          clientMessageId: pendingTurn.client_message_id,
          externalRuns: externalRuns.length,
        });
      }
      const latest = getLatestRuntimeRun(session.row.id);
      return NextResponse.json({
        aborted: externalRuns.length > 0,
        alreadyFinished: externalRuns.length === 0,
        runId: latest?.id ?? null,
        status: externalRuns.length > 0 ? "cancelled" : latest?.status ?? "completed",
        externalRuns: externalRuns.length,
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
      externalRuns: externalRuns.length,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
