// Shared SSE relay: turns an authorized runtime session's OpenHarness event
// subscription into a browser SSE stream of normalized events, and persists the
// finalized assistant turn exactly once (idempotent across reconnects). Used by
// both the dashboard terminal/garden events route and the Quartz AI events
// route so the streaming + persistence policy lives in one place.

import { leastPrivilegeDecision } from "./dispatch-core.ts";
import db from "../db.ts";
import { getAgentRuntimeByKind } from "../agent-runtime/runtime.ts";
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
import { openHarnessMessageId } from "./message-id.ts";
import { compactConversationMemoryIfNeeded } from "../conversations/memory.ts";
import {
  associateArtifactToolCall,
  listArtifactEventsAfter,
} from "./artifact-store.ts";

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
    const startedAt = activeRun ? Date.parse(activeRun.started_at) : Number.NaN;
    const responseDurationMs = Number.isFinite(startedAt)
      ? Math.max(0, Date.now() - startedAt)
      : undefined;
    const metadata = {
      toolCalls,
      verification,
      runtimeStatus,
      ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
    };
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
  const runtime = getAgentRuntimeByKind(session.runtimeKind);
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let clientDisconnected = false;
  const disconnectSubscription = () => {
    clientDisconnected = true;
    abortController.abort();
  };
  signal.addEventListener("abort", disconnectSubscription, { once: true });

  let assistantText = "";
  const sources: string[] = [];
  const toolCalls: Array<Record<string, unknown>> = [];
  const evidence: EvidenceRecord[] = [];
  let persisted = false;
  // An event stream that closes without an explicit terminal runtime status is
  // a failure, not a completed answer.
  let finalStatus = "failed";
  let tokenUsage: unknown;
  // The browser deliberately opens this stream before POSTing the prompt so
  // the first text delta cannot be missed. That means there may not be an
  // active run yet, and the upstream session can still deliver a trailing idle
  // event from its previous turn. Bind lazily to the first durable run created
  // after the stream opens and do not let a zero-output idle event finalize it.
  let streamRun = getActiveRuntimeRun(session.row.id);
  const activeRunReference = () => {
    // The SSE connection is established before the prompt POST. Re-read the
    // durable run lazily so Hermes recovery receives the turn identity even
    // when the GET and POST execute in separate Next.js module contexts.
    streamRun ??= getActiveRuntimeRun(session.row.id);
    if (!streamRun) return {};
    const dispatch = parseRuntimeRunDispatch(streamRun);
    return {
      messageId: dispatch.clientMessageId
        ? openHarnessMessageId(dispatch.clientMessageId)
        : undefined,
      instruction: dispatch.runtimeText ?? streamRun.instruction,
    };
  };
  let assistantMessageId = activeRunReference().messageId;
  let sawTurnOutput = false;
  let lastArtifactEventId = 0;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (
        event: NormalizedAgentEvent | { type: string; [k: string]: unknown },
      ) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event)));
      };
      const emitArtifactEvents = () => {
        if (!streamRun) return;
        for (const artifactEvent of listArtifactEventsAfter({
          runId: streamRun.id,
          afterId: lastArtifactEventId,
        })) {
          lastArtifactEventId = artifactEvent.id;
          emit({
            type: artifactEvent.type,
            sessionId: session.openHarnessSessionId,
            timestamp: artifactEvent.timestamp,
            payload: {
              eventId: artifactEvent.id,
              artifactId: artifactEvent.artifactId,
              runId: artifactEvent.runId,
              conversationId: artifactEvent.conversationId,
              gardenId: artifactEvent.gardenId,
              assistantMessageId: artifactEvent.assistantMessageId,
              status: artifactEvent.status,
              version: artifactEvent.version,
              metadata: artifactEvent.payload,
            },
          });
        }
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
          void runtime
            .applyCapabilityDecision({
              externalSessionId: session.externalSessionId,
              liveSessionId: session.liveSessionId,
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
        // Replays lifecycle events already committed before the browser managed
        // to attach, making refresh/reconnect deterministic and idempotent.
        emitArtifactEvents();
        for await (const event of runtime.streamSession(
          {
            externalSessionId: session.externalSessionId,
            liveSessionId: session.liveSessionId,
            workspaceKey: session.workspaceKey,
            directory: session.activeDirectory,
            ...activeRunReference(),
            resolveActiveTurn: activeRunReference,
          },
          abortController.signal,
          () => controller.enqueue(encoder.encode(": connected\n\n")),
        )) {
          if (!streamRun) {
            streamRun = getActiveRuntimeRun(session.row.id);
            assistantMessageId ??= activeRunReference().messageId;
          }

          // Events received before the message POST has created its run belong
          // to the previous turn. Dropping them prevents an edit/new send from
          // completing empty while its real generation continues orphaned.
          if (!streamRun) continue;

          if (event.type === "assistant.delta") {
            if (
              assistantMessageId &&
              event.messageId &&
              event.messageId !== assistantMessageId
            ) {
              continue;
            }
            assistantMessageId ??= event.messageId;
            assistantText += event.payload.text;
            sawTurnOutput = sawTurnOutput || event.payload.text.length > 0;
          } else if (event.type === "assistant.completed") {
            if (
              !sawTurnOutput ||
              (assistantMessageId &&
                event.messageId &&
                event.messageId !== assistantMessageId)
            ) {
              continue;
            }
            tokenUsage = event.payload.usage;
          } else if (event.type === "tool.started") {
            sawTurnOutput = true;
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
            if (streamRun) {
              associateArtifactToolCall(
                streamRun.id,
                event.payload.toolName,
                event.payload.toolCallId,
              );
            }
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
          emitArtifactEvents();

          if (event.type === "session.status") {
            if (event.payload.status === "idle") {
              // A just-opened session subscription can receive the previous
              // turn's terminal idle event. It is not completion for this run
              // until the run has emitted answer text or tool activity.
              if (!sawTurnOutput) continue;
              emitArtifactEvents();
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
        if (clientDisconnected) {
          return;
        }
        finalStatus = "failed";
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
        if (clientDisconnected) return;
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
        try {
          controller.close();
        } catch {
          // The browser may close immediately after the terminal event.
        }
      }
    },
    cancel() {
      disconnectSubscription();
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
