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
  persistCapabilityDecision,
  recordAuditEvent,
  revokeCapabilityDecision,
} from "./runtime-store.ts";
import { ApiError } from "./route-core.ts";
import { resolveCommandMessage } from "./commands.ts";
import {
  assessVerification,
  evidenceKindForTool,
  type EvidenceRecord,
} from "./evidence.ts";
import { composeOpenHarnessSystemPrompt } from "./system-prompts.ts";
import {
  prepareTurn,
  mergeSelectedTools,
  type PreparedTurn,
} from "./dispatch-core.ts";
import { listFilesystemGrants } from "./filesystem-grant-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "./run-store.ts";
import {
  getConversationById,
  updateConversation,
} from "../conversations/store.ts";
import { associateArtifactToolCall, listArtifactEventsAfter } from "./artifact-store.ts";
import {
  findAgencyAgent,
  renderAgencyAgentPersona,
  type AgencyAgentDefinition,
} from "./agency-agents.ts";

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
  // The shared planner records the requested outcome, while the broker's
  // surface ceiling keeps Garden Chat on curated Garden, artifact, and selected
  // MCP tools. Filesystem grants can never turn this surface into a Terminal.
  const prepared = prepareTurn({
    request: text,
    priorRequests: messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .slice(-6, -1),
    surface: "garden_chat",
    userId,
    grants: listFilesystemGrants(userId),
    workspaceRoot: session.activeDirectory,
  });
  const decision = prepared.decision;
  const resolved = await resolveCommandMessage(
    userId,
    text,
    session.activeDirectory,
    { mode: decision.mode, surface: "garden_chat" },
  );
  decision.selectedConditionalSkills = resolved.invocations
    .filter((item) => item.kind === "skill")
    .map((item) => item.slug);
  decision.selectedConnections = resolved.invocations
    .filter((item) => item.kind === "mcp")
    .map((item) => item.slug);

  const gateway = getOpenHarnessGateway();
  await gateway.health();
  await gateway.applyCapabilityDecision({
    openHarnessSessionId: session.openHarnessSessionId,
    workspaceKey: session.workspaceKey,
    directory: session.activeDirectory,
    decision,
  });
  const storedDecision = persistCapabilityDecision(session.row.id, decision);
  recordAuditEvent({
    eventType: "capability.decision",
    runtimeSessionId: session.row.id,
    userId,
    gardenId: clusterSlug,
    payload: {
      decisionId: storedDecision.id,
      mode: decision.mode,
      implementationRequired: false,
      decisionReason: decision.decisionReason,
      decisionSource: decision.decisionSource,
    },
  });
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
      capabilityDecisionId: storedDecision.id,
      capabilityMode: decision.mode,
      intendedOutcome: prepared.plan.intendedOutcome,
      requiredCapabilities: prepared.plan.requiredCapabilities,
      grantedCapabilities: prepared.grant.grantedCapabilities,
      withheldCapabilities: prepared.grant.withheldCapabilities,
      pendingPermissions: prepared.pendingPermissions.map((item) => item.id),
      riskLevel: prepared.plan.riskLevel,
    },
  });
  if (session.row.conversation_id === null) {
    throw new ApiError(409, "conversation_required", "Garden artifacts require a canonical conversation.");
  }
  let conversation = getConversationById(session.row.conversation_id);
  if (!conversation || conversation.surface !== "garden_chat") {
    throw new ApiError(409, "conversation_scope_mismatch", "The Garden conversation scope is invalid.");
  }
  let activeAgencyAgent: AgencyAgentDefinition | null = null;
  if (resolved.agencyAgentSelection?.action === "clear") {
    conversation = updateConversation(conversation, { activeAgencyAgentSlug: null });
  } else if (resolved.agencyAgentSelection?.action === "set") {
    conversation = updateConversation(conversation, {
      activeAgencyAgentSlug: resolved.agencyAgentSelection.slug,
    });
    activeAgencyAgent = findAgencyAgent(resolved.agencyAgentSelection.slug);
  } else if (conversation.active_agency_agent_slug) {
    activeAgencyAgent = findAgencyAgent(conversation.active_agency_agent_slug);
    if (!activeAgencyAgent) {
      conversation = updateConversation(conversation, { activeAgencyAgentSlug: null });
    }
  }
  const runTools = mergeSelectedTools(
    prepared.grant.allowedTools,
    resolved.tools,
  );
  const runSystem = composeOpenHarnessSystemPrompt({
    surface: "garden_chat",
    decision,
    additional: gardenTurnContext(
      clusterSlug,
      chatSessionId,
      page,
      payload.selectedDocumentSlugs,
      prepared,
    ),
    persona: activeAgencyAgent
      ? renderAgencyAgentPersona(activeAgencyAgent)
      : undefined,
  });
  const run = beginRuntimeRun({
    runtimeSessionId: session.row.id,
    instruction: text,
    dispatch: {
      conversationPublicId: conversation.public_id,
      model: engine.model,
      variant: engine.variant,
      tools: runTools,
      system: runSystem,
    },
  });
  return legacyGardenEventStream(session, signal, prepared, run.id, () =>
    gateway.sendMessage({
      openHarnessSessionId: session.openHarnessSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      agentName: session.agentName,
      text: resolved.text || "Acknowledge the persona selection briefly and ask how you can help.",
      // The brokered map is authoritative. A selected MCP/skill tool may only
      // narrow it, never widen it.
      tools: runTools,
      model: engine.model,
      variant: engine.variant,
      system: runSystem,
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

/**
 * Surface context for the turn.
 *
 * This deliberately no longer asserts that shell, file, and repository
 * capabilities are unavailable. That sentence became false once capability
 * started coming from the task plan, and a prompt that misdescribes the
 * runtime is exactly the failure mode to avoid — the agent would refuse work
 * it was actually authorized to do. The capability set is stated from the
 * brokered grant instead, so the prompt always matches the real tool map.
 */
function gardenTurnContext(
  gardenSlug: string,
  chatSessionId: number,
  page: { slug: string; title?: string } | null,
  selectedDocumentSlugs: unknown,
  prepared: PreparedTurn,
): string {
  const selected = Array.isArray(selectedDocumentSlugs)
    ? selectedDocumentSlugs
        .filter((value): value is string => typeof value === "string")
        .slice(0, 12)
    : [];
  const roots = prepared.grant.authorizedRoots;
  return [
    `Authorized garden: ${gardenSlug}`,
    `Breadboard chat session: ${chatSessionId}`,
    page
      ? `Current page: ${page.title ?? page.slug} (${page.slug})`
      : "Current page: garden workspace",
    selected.length
      ? `User-selected garden documents: ${selected.join(", ")}`
      : "",
    `Identified goal: ${prepared.plan.intendedOutcome}`,
    `Capabilities active for this turn: ${
      prepared.grant.grantedCapabilities.join(", ") || "conversation only"
    }.`,
    roots.length
      ? `Approved local folders: ${roots
          .map((root) => `${root.displayName} (${root.canonicalPath})`)
          .join("; ")}.`
      : "No local folders are approved for this turn.",
    prepared.grant.withheldCapabilities.length
      ? `Withheld pending the user's approval: ${prepared.grant.withheldCapabilities.join(", ")}. Breadboard has already shown the user a permission request; do not ask for approval in prose and do not restate the task.`
      : "",
    "Published Garden content is changed only through typed Breadboard proposals.",
  ]
    .filter(Boolean)
    .join("\n");
}


function legacyGardenEventStream(
  session: AuthorizedRuntimeSession,
  requestSignal: AbortSignal,
  prepared: PreparedTurn,
  runId: string,
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
      let lastArtifactEventId = 0;
      const emitArtifactEvents = () => {
        for (const event of listArtifactEventsAfter({ runId, afterId: lastArtifactEventId })) {
          lastArtifactEventId = event.id;
          emit({
            type: event.type,
            artifactId: event.artifactId,
            runId: event.runId,
            conversationId: event.conversationId,
            gardenId: event.gardenId,
            assistantMessageId: event.assistantMessageId,
            status: event.status,
            version: event.version,
            metadata: event.payload,
          });
        }
      };
      emit({
        type: "runtime",
        backend: "openharness",
        fallback: false,
        sessionId: session.row.id,
        runId,
      });
      // Tell the client what this turn understood and what it may do, so the
      // UI can show active work rather than a bare spinner.
      emit({
        type: "plan",
        intendedOutcome: prepared.plan.intendedOutcome,
        steps: prepared.plan.steps.map((step) => step.description),
        capabilities: prepared.grant.grantedCapabilities,
        riskLevel: prepared.plan.riskLevel,
      });
      // Missing authority is a request, not a refusal: the client renders an
      // approval prompt and re-sends, and the same task continues.
      for (const pending of prepared.pendingPermissions) {
        emit({
          type: "permission",
          requestId: pending.id,
          kind: pending.kind,
          permission: pending.capability,
          message: pending.message,
          path: pending.path,
          operations: pending.operations,
        });
        recordAuditEvent({
          eventType: "permission.requested",
          runtimeSessionId: session.row.id,
          userId: session.row.user_id,
          gardenId: session.row.garden_id,
          payload: { permission: pending.capability, requestId: pending.id },
        });
      }
      if (prepared.blocked) {
        // Nothing in the plan can run yet. Do not prompt the model: a turn that
        // cannot act must not produce prose that sounds like it acted.
        emit({
          type: "blocked",
          reason: "awaiting_permission",
          pending: prepared.pendingPermissions.map((item) => item.id),
        });
        markStatus(session, "idle");
        finishRuntimeRun(runId, "cancelled");
        // Nothing executed under this decision. It is abandoned rather than
        // completed; approving the permission produces a fresh decision on the
        // resumed turn.
        revokeCapabilityDecision(session.row.id, "abandoned");
        output.enqueue(encoder.encode("data: [DONE]\n\n"));
        output.close();
        return;
      }
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
        emitArtifactEvents();
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
            associateArtifactToolCall(runId, event.payload.toolName, event.payload.toolCallId);
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
          emitArtifactEvents();
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
            emitArtifactEvents();
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
        finishRuntimeRun(runId, controller.signal.aborted ? "cancelled" : "completed");
        revokeCapabilityDecision(
          session.row.id,
          controller.signal.aborted ? "cancelled" : "completed",
        );
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
        finishRuntimeRun(runId, controller.signal.aborted ? "cancelled" : "error");
        revokeCapabilityDecision(session.row.id, "abandoned");
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
