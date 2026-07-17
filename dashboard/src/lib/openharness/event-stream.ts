// Shared SSE relay: turns an authorized runtime session's OpenHarness event
// subscription into a browser SSE stream of normalized events, and persists the
// finalized assistant turn exactly once (idempotent across reconnects). Used by
// both the dashboard terminal/garden events route and the Quartz AI events
// route so the streaming + persistence policy lives in one place.

import db from "../db.ts";
import { getOpenHarnessGateway } from "./gateway.ts";
import { encodeSseEvent, type NormalizedAgentEvent } from "./events.ts";
import {
  appendRuntimeMessage,
  appendChatMessage,
  listRuntimeMessages,
  setRuntimeStatus,
} from "./runtime-store.ts";
import type { AuthorizedRuntimeSession } from "./session-service.ts";

function persistAssistantOnce(
  session: AuthorizedRuntimeSession,
  content: string,
  sources: string[],
  toolCalls: unknown[],
): void {
  if (!content.trim() && toolCalls.length === 0) return;
  if (session.row.chat_session_id) {
    const last = db
      .prepare("SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY order_index DESC LIMIT 1")
      .get(session.row.chat_session_id) as { role: string; content: string } | undefined;
    if (last && last.role === "assistant" && last.content === content) return;
    appendChatMessage({
      chatSessionId: session.row.chat_session_id,
      role: "assistant",
      content,
      sources,
      toolCalls: toolCalls.length ? toolCalls : undefined,
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
    toolCalls: toolCalls.length ? toolCalls : undefined,
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
  signal.addEventListener("abort", () => abortController.abort());

  let assistantText = "";
  const sources: string[] = [];
  const toolCalls: Array<Record<string, unknown>> = [];
  let persisted = false;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: NormalizedAgentEvent | { type: string; [k: string]: unknown }) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event)));
      };
      controller.enqueue(encoder.encode(": connected\n\n"));

      const finalize = (status: string) => {
        if (persisted) return;
        persisted = true;
        setRuntimeStatus(session.row.id, status);
        try {
          persistAssistantOnce(session, assistantText, sources, toolCalls);
        } catch {
          // Persistence is best-effort; never crash the stream.
        }
      };

      try {
        for await (const event of gateway.subscribeToSession(
          { openHarnessSessionId: session.openHarnessSessionId, workspaceKey: session.workspaceKey },
          abortController.signal,
        )) {
          if (event.type === "assistant.delta") assistantText += event.payload.text;
          else if (event.type === "tool.completed") {
            toolCalls.push({
              toolName: event.payload.toolName,
              success: event.payload.success,
              summary: event.payload.summary,
            });
          }
          emit(event);

          if (event.type === "session.status") {
            if (event.payload.status === "idle") {
              finalize("idle");
              emit({ type: "done" });
              break;
            }
            if (event.payload.status === "aborted" || event.payload.status === "failed") {
              finalize(event.payload.status);
              emit({ type: "done" });
              break;
            }
          }
        }
      } catch (error) {
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
      } finally {
        finalize("idle");
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
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
