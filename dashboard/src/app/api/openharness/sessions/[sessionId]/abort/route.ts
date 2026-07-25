import { NextResponse } from "next/server";
import { leastPrivilegeDecision } from "@/lib/openharness/dispatch-core.ts";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled } from "@/lib/openharness/route-helpers.ts";
import { authorizeRuntimeReference, markStatus } from "@/lib/openharness/session-service.ts";
import { getAgentRuntimeByKind } from "@/lib/agent-runtime/runtime.ts";
import {
  recordAuditEvent,
  revokeCapabilityDecision,
} from "@/lib/openharness/runtime-store.ts";
import {
  finishRuntimeRun,
  getActiveRuntimeRun,
  getLatestRuntimeRun,
  parseRuntimeRunDispatch,
} from "@/lib/openharness/run-store.ts";
import { failAssistantMessage } from "@/lib/conversations/store.ts";
import { cancelAuthorizedTerminalCommand } from "@/lib/openharness/terminal-execution.ts";

export const dynamic = "force-dynamic";

// POST: abort active generation for a session. The OpenHarness session id is
// derived server-side from the authorized runtime-session record.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const session = authorizeRuntimeReference(userId, sessionId);
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
    const runtime = getAgentRuntimeByKind(session.runtimeKind);
    markStatus(session, "stopping");
    const [runtimeStop, terminalStop] = await Promise.allSettled([
      runtime.stopRun({
        externalSessionId: session.externalSessionId,
        liveSessionId: session.liveSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
      }),
      cancelAuthorizedTerminalCommand(session.row.id),
    ]);
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
      payload: {
        runtimeStopAcknowledged: runtimeStop.status === "fulfilled",
        activeTerminalStopped:
          terminalStop.status === "fulfilled" && terminalStop.value,
      },
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
