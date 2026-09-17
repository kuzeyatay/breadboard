import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { getRuntimeSessionById, listRuntimeSessionsForConversation, recordAuditEvent, setRuntimeStatus } from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun, getLatestRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import { cancelConversationTurn, cancelLatestConversationTurn, failAssistantMessage, getConversationForUser } from "@/lib/conversations/store.ts";
import { finishExternalAgentTurn } from "@/lib/conversations/external-agent-turns.ts";
import { cancelRunningExternalAgentRuns } from "@/lib/conversations/external-agent-cancel.ts";
import { cancelRuntimeSessionWork } from "@/lib/hermes/session-cancel.ts";
import { abortDirectProviderTurn } from "@/lib/conversations/direct-turn-service.ts";

export const dynamic = "force-dynamic";

// Stop belongs to a conversation, even before it has an initialized runtime,
// and covers its main runtime and delegated workers. Highlight answers have
// independent Stop controls and keep running when the main answer is stopped.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { sessionId } = await params;
    const conversation = sessionId.startsWith("conv_")
      ? getConversationForUser(sessionId, userId) : null;
    const numericId = Number(sessionId);
    if (!conversation && (!Number.isInteger(numericId) || numericId <= 0)) {
      throw new ApiError(400, "invalid_session_id", "A valid conversation id is required.");
    }
    const legacySession = conversation ? null : getRuntimeSessionById(numericId);
    if (!conversation && (!legacySession || legacySession.user_id !== userId)) {
      throw new ApiError(404, "session_not_found", "Conversation not found.");
    }
    const conversationId = conversation?.id ?? legacySession!.conversation_id;
    const inlineTurnId = legacySession ? JSON.parse(legacySession.runtime_metadata || "{}").inlineTurnId as string | undefined : undefined;
    const sessions = inlineTurnId ? [legacySession!] : (conversationId !== null
      ? listRuntimeSessionsForConversation(conversationId)
      : [legacySession!]).filter(row => !JSON.parse(row.runtime_metadata || "{}").inlineTurnId);
    const activeRuns = sessions.flatMap((row) => {
      const run = getActiveRuntimeRun(row.id);
      return run ? [run] : [];
    });
    const directTurn = conversationId === null || inlineTurnId ? null : abortDirectProviderTurn(conversationId);
    // Discover workers before sealing the pending placeholder; the running
    // markers in the transcript are also how their managers are located.
    const externalStop = conversationId === null || inlineTurnId ? Promise.resolve([])
      : cancelRunningExternalAgentRuns(userId, conversationId);
    if (conversationId !== null) {
      for (const clientMessageId of [
        directTurn?.clientMessageId,
        ...activeRuns.map((run) => parseRuntimeRunDispatch(run).clientMessageId),
      ]) {
        if (clientMessageId) failAssistantMessage({
          conversationId, clientMessageId, status: "aborted", error: "cancelled_by_user",
        });
      }
    }
    // Seal before awaiting network cleanup so a still-preparing request sees
    // cancellation before it can register a new runtime/direct-provider turn.
    const pendingTurn = conversationId === null ? null : inlineTurnId
      ? cancelConversationTurn({ conversationId, clientMessageId: inlineTurnId })
      : cancelLatestConversationTurn(conversationId, undefined, true);
    const [externalRuns, stoppedSessions] = await Promise.all([
      externalStop,
      Promise.all(sessions.map(async (row) => {
        const stopped = await cancelRuntimeSessionWork(userId, row);
        if (stopped.cancelledRunId || pendingTurn || directTurn) setRuntimeStatus(row.id, "aborted");
        recordAuditEvent({
          eventType: "session.cancelled", runtimeSessionId: row.id, userId,
          gardenId: row.garden_id, payload: stopped,
        });
        return stopped;
      })),
    ]);
    if (conversationId !== null) {
      for (const run of externalRuns) {
        try {
          finishExternalAgentTurn({
            conversationId, clientMessageId: run.clientMessageId,
            outcome: "aborted", content: "Stopped by the user.",
          });
        } catch {
          // A concurrent terminal result already sealed this worker.
        }
      }
    }
    const cancelledRun = stoppedSessions.find((stopped) => stopped.cancelledRunId);
    const aborted = Boolean(directTurn || pendingTurn || cancelledRun || externalRuns.length);
    const latest = sessions.length ? getLatestRuntimeRun(sessions[0].id) : null;
    return NextResponse.json({
      aborted, alreadyFinished: !aborted,
      runId: cancelledRun?.cancelledRunId ?? latest?.id ?? null,
      status: aborted ? "cancelled" : latest?.status ?? "completed",
      externalRuns: externalRuns.length,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
