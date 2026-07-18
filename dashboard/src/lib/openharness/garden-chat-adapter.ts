// Compatibility adapter for the existing garden workspace chat UI.
// It preserves that UI's SSE contract while replacing its model transport with
// an authorized, garden-scoped OpenHarness session.

import db from "../db.ts";
import { normalizeChatTokenUsage } from "../chat-token-usage.ts";
import { requireUserId } from "../server-auth.ts";
import { getOpenHarnessGateway } from "./gateway.ts";
import { resolveOpenHarnessEngine } from "./model-selection.ts";
import {
  authorizeGardenAccess,
  authorizeRuntimeSession,
  createSessionForSurface,
  markStatus,
  type AuthorizedRuntimeSession,
} from "./session-service.ts";
import {
  appendChatMessage,
  getRuntimeSessionByChatSession,
  recordAuditEvent,
} from "./runtime-store.ts";
import { ApiError } from "./route-core.ts";
import { resolveCommandMessage } from "./commands.ts";
import {
  assessVerification,
  evidenceKindForTool,
  type EvidenceRecord,
} from "./evidence.ts";

type GardenChatPayload = {
  clusterSlug?: unknown;
  chatSessionId?: unknown;
  messages?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
  selectedDocumentSlugs?: unknown;
  activeMarkdown?: unknown;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function openGardenAgentChat(
  payload: GardenChatPayload,
  signal: AbortSignal,
): Promise<Response> {
  const userId = await requireUserId();
  const clusterSlug =
    typeof payload.clusterSlug === "string" ? payload.clusterSlug.trim() : "";
  if (!clusterSlug)
    throw new ApiError(400, "garden_required", "clusterSlug is required.");
  const access = authorizeGardenAccess(userId, clusterSlug);
  const chatSessionId = Number(payload.chatSessionId);
  if (!Number.isInteger(chatSessionId) || chatSessionId <= 0) {
    throw new ApiError(
      400,
      "chat_session_required",
      "A Breadboard chat session is required.",
    );
  }
  const chat = db
    .prepare(
      "SELECT id FROM chat_sessions WHERE id = ? AND user_id = ? AND cluster_id = ?",
    )
    .get(chatSessionId, userId, access.clusterId) as { id: number } | undefined;
  if (!chat)
    throw new ApiError(
      404,
      "chat_session_not_found",
      "Chat session not found.",
    );

  const messages = parseMessages(payload.messages);
  const text = [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.trim();
  if (!text)
    throw new ApiError(400, "message_required", "A user message is required.");
  const page = parseActivePage(payload.activeMarkdown);
  const engine = resolveOpenHarnessEngine(
    payload.model,
    payload.reasoningEffort,
  );
  const existing = getRuntimeSessionByChatSession(chatSessionId);
  const session = existing
    ? authorizeRuntimeSession(userId, existing.id)
    : await createSessionForSurface({
        userId,
        surface: "garden_chat",
        title: `Garden chat ${chatSessionId}`,
        gardenSlug: clusterSlug,
        pageSlug: page?.slug,
        chatSessionId,
      });
  const resolved = await resolveCommandMessage(
    userId,
    text,
    session.activeDirectory,
  );

  const gateway = getOpenHarnessGateway();
  await gateway.health();
  markStatus(session, "busy");
  recordAuditEvent({
    eventType: "message.submitted",
    runtimeSessionId: session.row.id,
    userId,
    gardenId: clusterSlug,
    payload: {
      characterCount: text.length,
      chatSessionId,
      modelId: engine.model.modelID,
      reasoningEffort: engine.variant,
      reasoningEffortAdjusted: engine.adjusted,
      commands: resolved.invocations,
    },
  });
  return legacyGardenEventStream(session, signal, () =>
    gateway.sendMessage({
      openHarnessSessionId: session.openHarnessSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      agentName: session.agentName,
      text: resolved.text,
      tools: resolved.tools,
      model: engine.model,
      variant: engine.variant,
      system: gardenTurnContext(
        clusterSlug,
        chatSessionId,
        page,
        payload.selectedDocumentSlugs,
      ),
    }),
  );
}

function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if (
      (role !== "user" && role !== "assistant") ||
      typeof content !== "string"
    )
      return [];
    return [{ role, content }];
  });
}

function parseActivePage(
  value: unknown,
): { slug: string; title?: string } | null {
  if (!value || typeof value !== "object") return null;
  const slug =
    typeof (value as { slug?: unknown }).slug === "string"
      ? (value as { slug: string }).slug.trim()
      : "";
  const title =
    typeof (value as { title?: unknown }).title === "string"
      ? (value as { title: string }).title.trim()
      : undefined;
  return slug ? { slug, title } : null;
}

function gardenTurnContext(
  gardenSlug: string,
  chatSessionId: number,
  page: { slug: string; title?: string } | null,
  selectedDocumentSlugs: unknown,
): string {
  const selected = Array.isArray(selectedDocumentSlugs)
    ? selectedDocumentSlugs
        .filter((value): value is string => typeof value === "string")
        .slice(0, 12)
    : [];
  return [
    `Authorized garden: ${gardenSlug}`,
    `Breadboard chat session: ${chatSessionId}`,
    page
      ? `Current page: ${page.title ?? page.slug} (${page.slug})`
      : "Current page: garden workspace",
    selected.length
      ? `User-selected garden documents: ${selected.join(", ")}`
      : "",
    "Garden context is high priority but additive: general filesystem, web, shell, skill, and subagent tools remain available.",
    "Published Garden content is still changed only through typed Breadboard proposals; ordinary files outside that boundary follow normal tool permissions.",
  ]
    .filter(Boolean)
    .join("\n");
}

function legacyGardenEventStream(
  session: AuthorizedRuntimeSession,
  requestSignal: AbortSignal,
  sendMessage: () => Promise<void>,
): Response {
  const gateway = getOpenHarnessGateway();
  const encoder = new TextEncoder();
  const controller = new AbortController();
  let abortSent = false;
  const abortRuntime = () => {
    controller.abort();
    if (abortSent) return;
    abortSent = true;
    void gateway
      .abortSession({
        openHarnessSessionId: session.openHarnessSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
      })
      .catch(() => undefined);
  };
  requestSignal.addEventListener("abort", abortRuntime, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      const emit = (value: unknown) =>
        output.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      let assistantText = "";
      const evidence: EvidenceRecord[] = [];
      const toolCalls: Array<Record<string, unknown>> = [];
      let tokenUsage: unknown;
      emit({
        type: "runtime",
        backend: "openharness",
        fallback: false,
        sessionId: session.row.id,
      });
      try {
        let connected!: () => void;
        const ready = new Promise<void>((resolve) => {
          connected = resolve;
        });
        const events = gateway
          .subscribeToSession(
            {
              openHarnessSessionId: session.openHarnessSessionId,
              workspaceKey: session.workspaceKey,
              directory: session.activeDirectory,
            },
            controller.signal,
            connected,
          )
          [Symbol.asyncIterator]();
        const firstEvent = events.next();
        await Promise.race([
          ready,
          firstEvent.then((result) => {
            if (result.done)
              throw new Error(
                "OpenHarness event stream closed before the prompt was sent.",
              );
          }),
        ]);
        await sendMessage();
        for (
          let next = await firstEvent;
          !next.done;
          next = await events.next()
        ) {
          const event = next.value;
          if (event.type === "assistant.delta") {
            assistantText += event.payload.text;
            emit({ type: "delta", text: event.payload.text });
          }
          if (event.type === "assistant.completed") {
            const usage = normalizeChatTokenUsage(event.payload.usage);
            if (usage) {
              tokenUsage = usage;
              emit({ type: "usage", usage });
            }
          }
          if (event.type === "reasoning.status" && event.payload.detail) {
            emit({ type: "thinking", text: event.payload.detail });
          }
          if (event.type === "tool.started") {
            emit({ type: "tool", status: "running", ...event.payload });
            recordAuditEvent({
              eventType: "tool.requested",
              runtimeSessionId: session.row.id,
              userId: session.row.user_id,
              gardenId: session.row.garden_id,
              payload: { toolName: event.payload.toolName },
            });
          }
          if (event.type === "tool.completed") {
            emit({
              type: "tool",
              status: event.payload.success ? "completed" : "failed",
              ...event.payload,
            });
            toolCalls.push({
              toolCallId: event.payload.toolCallId,
              toolName: event.payload.toolName,
              success: event.payload.success,
              summary: event.payload.summary,
              completedAt: event.timestamp,
            });
            evidence.push({
              id: `evidence-${event.payload.toolCallId}`,
              kind: /(?:^|\s)(?:test|lint|typecheck)(?:\s|$)/i.test(
                event.payload.summary ?? "",
              )
                ? "test"
                : evidenceKindForTool(event.payload.toolName),
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
          }
          if (event.type === "permission.requested") {
            emit({ type: "permission", ...event.payload });
            recordAuditEvent({
              eventType: "permission.requested",
              runtimeSessionId: session.row.id,
              userId: session.row.user_id,
              gardenId: session.row.garden_id,
              payload: { permission: event.payload.permission },
            });
          }
          if (event.type === "error")
            emit({ type: "error", error: event.payload.message });
          if (
            event.type === "session.status" &&
            event.payload.status === "idle"
          ) {
            const verification = assessVerification(assistantText, evidence);
            emit({ type: "verification", verification });
            if (assistantText.trim() || toolCalls.length) {
              const last = db
                .prepare(
                  "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY order_index DESC LIMIT 1",
                )
                .get(session.row.chat_session_id) as
                { role: string; content: string } | undefined;
              if (
                !last ||
                last.role !== "assistant" ||
                last.content !== assistantText
              ) {
                appendChatMessage({
                  chatSessionId: session.row.chat_session_id!,
                  role: "assistant",
                  content: assistantText,
                  tokenUsage,
                  toolCalls: { calls: toolCalls, verification },
                  runtimeStatus: "idle",
                });
              }
            }
            break;
          }
        }
        markStatus(session, controller.signal.aborted ? "aborted" : "idle");
        recordAuditEvent({
          eventType: controller.signal.aborted
            ? "session.cancelled"
            : "message.completed",
          runtimeSessionId: session.row.id,
          userId: session.row.user_id,
          gardenId: session.row.garden_id,
        });
      } catch (error) {
        abortRuntime();
        markStatus(session, "failed");
        emit({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "OpenHarness stream failed.",
        });
        recordAuditEvent({
          eventType: "error",
          runtimeSessionId: session.row.id,
          userId: session.row.user_id,
          gardenId: session.row.garden_id,
          payload: { stage: "garden_event_stream" },
        });
      } finally {
        output.enqueue(encoder.encode("data: [DONE]\n\n"));
        output.close();
      }
    },
    cancel() {
      abortRuntime();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Breadboard-AI-Backend": "openharness",
      "X-Breadboard-Runtime-Session": String(session.row.id),
    },
  });
}
