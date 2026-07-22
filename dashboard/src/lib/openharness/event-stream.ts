// Shared SSE relay: turns an authorized runtime session's OpenHarness event
// subscription into a browser SSE stream of normalized events, and persists the
// finalized assistant turn exactly once (idempotent across reconnects). Used by
// both the dashboard terminal/garden events route and the Quartz AI events
// route so the streaming + persistence policy lives in one place.

import { leastPrivilegeDecision } from "./dispatch-core.ts";
import db from "../db.ts";
import { getOpenHarnessGateway } from "./gateway.ts";
import { encodeSseEvent, type NormalizedAgentEvent } from "./events.ts";
import {
  appendRuntimeMessage,
  appendChatMessage,
  listRuntimeMessages,
  setRuntimeStatus,
  recordAuditEvent,
  revokeCapabilityDecision,
} from "./runtime-store.ts";
import type { AuthorizedRuntimeSession } from "./session-service.ts";
import {
  assessVerification,
  evidenceKindForTool,
  type EvidenceRecord,
  type VerificationSummary,
} from "./evidence.ts";
import { finishActiveRuntimeRun } from "./run-store.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "./run-store.ts";
import {
  completeAssistantMessage,
  failAssistantMessage,
} from "../conversations/store.ts";
import { compactConversationMemoryIfNeeded } from "../conversations/memory.ts";

function persistAssistantOnce(
  session: AuthorizedRuntimeSession,
  content: string,
  sources: string[],
  toolCalls: unknown[],
  verification: VerificationSummary,
  runtimeStatus: string,
  tokenUsage?: unknown,
): void {
  if (session.row.conversation_id !== null) {
    const activeRun = getActiveRuntimeRun(session.row.id);
    const clientMessageId = activeRun
      ? parseRuntimeRunDispatch(activeRun).clientMessageId
      : undefined;
    if (!clientMessageId) {
      throw new Error("Canonical runtime run is missing clientMessageId.");
    }
    const metadata = { toolCalls, verification, runtimeStatus };
    if (runtimeStatus === "idle") {
      completeAssistantMessage({
        conversationId: session.row.conversation_id,
        clientMessageId,
        content,
        metadata,
        sources,
        tokenUsage,
      });
      compactConversationMemoryIfNeeded(session.row.conversation_id);
    } else {
      failAssistantMessage({
        conversationId: session.row.conversation_id,
        clientMessageId,
        status: runtimeStatus === "aborted" ? "aborted" : "failed",
        content,
        metadata,
        error: runtimeStatus,
      });
    }
    return;
  }
  if (!content.trim() && toolCalls.length === 0) return;
  if (session.row.chat_session_id) {
    const last = db
      .prepare(
        "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY order_index DESC LIMIT 1",
      )
      .get(session.row.chat_session_id) as
      { role: string; content: string } | undefined;
    if (last && last.role === "assistant" && last.content === content) return;
    appendChatMessage({
      chatSessionId: session.row.chat_session_id,
      role: "assistant",
      content,
      sources,
      tokenUsage,
      toolCalls: { calls: toolCalls, verification },
      runtimeStatus,
    });
    return;
  }
  const existing = listRuntimeMessages(session.row.id);
  const last = existing[existing.length - 1];
  if (last && last.role === "assistant" && last.content === content) return;
  appendRuntimeMessage({
    runtimeSessionId: session.row.id,
    role: "assistant",
    content,
    sources,
    tokenUsage,
    toolCalls: { calls: toolCalls, verification },
    runtimeStatus,
  });
}

/**
 * Build an SSE Response streaming this session's normalized events. `signal`
 * should be the incoming request's abort signal so a client disconnect tears
 * down the upstream subscription.
 */
export function buildSessionEventStream(
  session: AuthorizedRuntimeSession,
  signal: AbortSignal,
  extraHeaders: Record<string, string> = {},
): Response {
  const gateway = getOpenHarnessGateway();
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let runtimeAbortSent = false;
  const abortRuntime = () => {
    abortController.abort();
    if (runtimeAbortSent) return;
    runtimeAbortSent = true;
    void gateway
      .abortSession({
        openHarnessSessionId: session.openHarnessSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
      })
      .catch(() => undefined);
  };
  signal.addEventListener("abort", abortRuntime, { once: true });

  let assistantText = "";
  const sources: string[] = [];
  const toolCalls: Array<Record<string, unknown>> = [];
  const evidence: EvidenceRecord[] = [];
  let persisted = false;
  // An event stream that closes without an explicit terminal runtime status is
  // a failure, not a completed answer.
  let finalStatus = "failed";
  let tokenUsage: unknown;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (
        event: NormalizedAgentEvent | { type: string; [k: string]: unknown },
      ) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event)));
      };
      const finalize = (status: string) => {
        if (persisted) return;
        persisted = true;
        finalStatus = status;
        setRuntimeStatus(session.row.id, status);
        const verification = assessVerification(assistantText, evidence);
        try {
          persistAssistantOnce(
            session,
            assistantText,
            sources,
            toolCalls,
            verification,
            status,
            tokenUsage,
          );
        } catch {
          // Do not strand the canonical placeholder in `pending` if final
          // persistence fails. A later explicit retry can safely reuse the
          // same client id; if completion committed before an unrelated error,
          // this is an idempotent no-op.
          if (session.row.conversation_id !== null) {
            try {
              const activeRun = getActiveRuntimeRun(session.row.id);
              const clientMessageId = activeRun
                ? parseRuntimeRunDispatch(activeRun).clientMessageId
                : undefined;
              if (clientMessageId) {
                failAssistantMessage({
                  conversationId: session.row.conversation_id,
                  clientMessageId,
                  status: status === "aborted" ? "aborted" : "failed",
                  content: assistantText,
                  error: "assistant_persistence_failed",
                });
              }
            } catch {
              // The audit below is the final recovery path if SQLite itself is
              // unavailable. Never hide the original stream outcome.
            }
          }
          recordAuditEvent({
            eventType: "conversation.persistence_failed",
            runtimeSessionId: session.row.id,
            userId: session.row.user_id,
            gardenId: session.row.garden_id,
            payload: { status },
          });
        }
        finishActiveRuntimeRun(
          session.row.id,
          status === "idle"
            ? "completed"
            : status === "aborted"
              ? "cancelled"
              : "error",
        );
        const revocationReason =
          status === "idle"
            ? "completed"
            : status === "aborted"
              ? "cancelled"
              : "abandoned";
        if (revokeCapabilityDecision(session.row.id, revocationReason)) {
          recordAuditEvent({
            eventType: "capability.revoked",
            runtimeSessionId: session.row.id,
            userId: session.row.user_id,
            gardenId: session.row.garden_id,
            payload: { reason: revocationReason, restoredMode: "knowledge" },
          });
          const restoredDecision = leastPrivilegeDecision(session.activeDirectory);
          void gateway
            .applyCapabilityDecision({
              openHarnessSessionId: session.openHarnessSessionId,
              workspaceKey: session.workspaceKey,
              directory: session.activeDirectory,
              decision: restoredDecision,
            })
            .catch(() => {
              recordAuditEvent({
                eventType: "capability.runtime_restore_failed",
                runtimeSessionId: session.row.id,
                userId: session.row.user_id,
                gardenId: session.row.garden_id,
              });
            });
        }
      };

      try {
        for await (const event of gateway.subscribeToSession(
          {
            openHarnessSessionId: session.openHarnessSessionId,
            workspaceKey: session.workspaceKey,
            directory: session.activeDirectory,
          },
          abortController.signal,
          () => controller.enqueue(encoder.encode(": connected\n\n")),
        )) {
          if (event.type === "assistant.delta")
            assistantText += event.payload.text;
          else if (event.type === "assistant.completed")
            tokenUsage = event.payload.usage;
          else if (event.type === "tool.started") {
            recordAuditEvent({
              eventType: "tool.requested",
              runtimeSessionId: session.row.id,
              userId: session.row.user_id,
              gardenId: session.row.garden_id,
              payload: {
                toolName: event.payload.toolName,
                toolCallId: event.payload.toolCallId,
              },
            });
          } else if (event.type === "tool.completed") {
            toolCalls.push({
              toolCallId: event.payload.toolCallId,
              toolName: event.payload.toolName,
              success: event.payload.success,
              summary: event.payload.summary,
              completedAt: event.timestamp,
            });
            const inferredKind =
              /(?:^|\s)(?:test|lint|typecheck)(?:\s|$)/i.test(
                event.payload.summary ?? "",
              )
                ? "test"
                : evidenceKindForTool(event.payload.toolName);
            evidence.push({
              id: `evidence-${event.payload.toolCallId}`,
              kind: inferredKind,
              title: event.payload.summary ?? event.payload.toolName,
              location: event.payload.location,
              success: event.payload.success,
              toolCallId: event.payload.toolCallId,
              timestamp: event.timestamp,
              details: { toolName: event.payload.toolName },
            });
            recordAuditEvent({
              eventType: "tool.completed",
              runtimeSessionId: session.row.id,
              userId: session.row.user_id,
              gardenId: session.row.garden_id,
              payload: {
                toolName: event.payload.toolName,
                success: event.payload.success,
              },
            });
          } else if (event.type === "permission.requested") {
            recordAuditEvent({
              eventType: "permission.requested",
              runtimeSessionId: session.row.id,
              userId: session.row.user_id,
              gardenId: session.row.garden_id,
              payload: {
                requestId: event.payload.requestId,
                permission: event.payload.permission,
              },
            });
          }
          emit(event);

          if (event.type === "session.status") {
            if (event.payload.status === "idle") {
              emit({
                type: "verification.updated",
                sessionId: session.openHarnessSessionId,
                timestamp: new Date().toISOString(),
                payload: assessVerification(assistantText, evidence),
              });
              finalize("idle");
              emit({ type: "done" });
              break;
            }
            if (
              event.payload.status === "aborted" ||
              event.payload.status === "failed"
            ) {
              finalize(event.payload.status);
              emit({ type: event.payload.status === "aborted" ? "cancelled" : "done" });
              break;
            }
          }
        }
      } catch (error) {
        finalStatus = abortController.signal.aborted ? "aborted" : "failed";
        if (abortController.signal.aborted) {
          finalize("aborted");
          emit({ type: "cancelled" });
          return;
        }
        emit({
          type: "error",
          sessionId: session.openHarnessSessionId,
          timestamp: new Date().toISOString(),
          payload: {
            code: "stream_error",
            message: error instanceof Error ? error.message : "stream error",
            recoverable: true,
          },
        });
        recordAuditEvent({
          eventType: "error",
          runtimeSessionId: session.row.id,
          userId: session.row.user_id,
          gardenId: session.row.garden_id,
          payload: { stage: "event_stream" },
        });
      } finally {
        recordAuditEvent({
          eventType:
            finalStatus === "aborted"
              ? "session.cancelled"
              : finalStatus === "failed"
                ? "message.failed"
                : "message.completed",
          runtimeSessionId: session.row.id,
          userId: session.row.user_id,
          gardenId: session.row.garden_id,
          payload: {
            characterCount: assistantText.length,
            toolCalls: toolCalls.length,
          },
        });
        finalize(finalStatus);
        controller.close();
      }
    },
    cancel() {
      abortRuntime();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...extraHeaders,
    },
  });
}
