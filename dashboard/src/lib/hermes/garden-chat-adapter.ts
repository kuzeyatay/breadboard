// Compatibility adapter for the existing garden workspace chat UI.
// It preserves that UI's SSE contract while replacing its model transport with
// an authorized, garden-scoped Hermes session.

import db from "../db.ts";
import { normalizeChatTokenUsage } from "../chat-token-usage.ts";
import { requireUserId } from "../server-auth.ts";
import { getAgentRuntimeByKind } from "../agent-runtime/runtime.ts";
import { resolveHermesEngine } from "./model-selection.ts";
import {
  authorizeGardenAccess,
  authorizeRuntimeSession,
  markStatus,
  resolveConversationRuntime,
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
  enforceRequiredWebEvidence,
  evidenceKindForTool,
  type EvidenceRecord,
} from "./evidence.ts";
import { composeHermesSystemPrompt } from "./system-prompts.ts";
import { scheduleLoopxTickForConversation } from "../loopx/conversation-tick.ts";
import {
  prepareTurn,
  mergeSelectedTools,
  type PreparedTurn,
} from "./dispatch-core.ts";
import { listFilesystemGrants } from "./filesystem-grant-store.ts";
import { connectedAppRegistryForTurn } from "./unified-tool-registry.ts";
import {
  beginRuntimeRun,
  finishRuntimeRun,
  markRuntimeRunSubmitted,
} from "./run-store.ts";
import { hermesMessageId } from "./message-id.ts";
import {
  ensureConversationForLegacyChatSession,
  getConversationById,
  updateConversation,
} from "../conversations/store.ts";
import { composeMemoryContext } from "../conversations/memory.ts";
import { loadConversationMemoryBundleHybrid } from "../mem0/retrieval.ts";
import { associateArtifactToolCall, listArtifactEventsAfter } from "./artifact-store.ts";
import { listAgentLaunchRequestsAfter } from "./agent-launch-store.ts";
import { acquireDetachedEventPump } from "./detached-event-pump.ts";
import {
  findAgencyAgent,
  renderAgencyAgentPersona,
  type AgencyAgentDefinition,
} from "./agency-agents.ts";
import { prepareDocumentContext } from "../document-skills/turn.ts";
import { parseChatAttachments } from "../chat-attachments-request.ts";
import { resolveDocumentAttachments } from "../document-attachments-server.ts";
import { visualizerCommandText } from "./interactive-visualizer-intent.ts";
import { premortemCommandText } from "./premortem-intent.ts";
import { agentLoopCommandText } from "./agent-loop-intent.ts";
import { messagingCommandText } from "./messaging-intent.ts";
import { imageTo3dCommandText, IMAGE_TO_3D_SKILL } from "./image-3d-intent.ts";
import { audioAnalysisCommandText, AUDIO_ANALYSIS_SKILL } from "./audio-intent.ts";
import {
  hasAnalyzableAttachment,
  renderAudioAnalysisContext,
  tracksFromAttachments,
} from "../audio-analyzer/tracks.ts";
import {
  hasReconstructableAttachment,
  reconstructableFromAttachments,
  renderImageTo3dContext,
} from "../sf3d/images.ts";

type GardenChatPayload = {
  clusterSlug?: unknown;
  chatSessionId?: unknown;
  messages?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
  selectedDocumentSlugs?: unknown;
  activeMarkdown?: unknown;
  attachments?: unknown;
  adhdMode?: unknown;
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
  // Attachments reach this surface in the request body but used to stop here:
  // the payload was parsed for messages only, so a file picked in the Garden
  // composer never reached the runtime at all.
  const attachments = resolveDocumentAttachments(
    userId,
    parseChatAttachments(payload.attachments),
  );
  const selectedSlugs = parseSelectedDocumentSlugs(payload.selectedDocumentSlugs);
  const engine = resolveHermesEngine(
    payload.model,
    payload.reasoningEffort,
  );
  const existing = getRuntimeSessionByChatSession(chatSessionId);
  let conversation = ensureConversationForLegacyChatSession(
    chatSessionId,
    userId,
  );
  const session = existing
    ? authorizeRuntimeSession(userId, existing.id)
    : await resolveConversationRuntime({
        conversation,
        surface: "garden_chat",
        activeGardenSlug: clusterSlug,
        activePageSlug: page?.slug ?? null,
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
  const premortemSelection = premortemCommandText({
    text,
    surface: "garden_chat",
    authenticated: true,
    priorMessages: messages,
  });
  const visualizerSelection = visualizerCommandText({
    text: premortemSelection.text,
    surface: "garden_chat",
    authenticated: true,
    priorMessages: messages,
  });
  const agentLoopSelection = agentLoopCommandText({
    text: visualizerSelection.text,
    surface: "garden_chat",
    authenticated: true,
    priorMessages: messages,
  });
  // Garden Chat's own copy of the chain in conversations/turn-service.ts. A
  // picture attached here has to select the skill for itself exactly as it does
  // there — missing this second pipeline is how a feature silently works on one
  // surface and not the other. There is no carried-picture case here: this
  // legacy path parses messages as role and content only, so an attachment from
  // an earlier turn is not visible from it.
  const imageTo3dSelection = imageTo3dCommandText({
    text: agentLoopSelection.text,
    surface: "garden_chat",
    authenticated: true,
    hasImageAttachment: hasReconstructableAttachment(attachments),
  });
  // The same second copy of the chain: an attached song has to select the skill
  // here exactly as it does in conversations/turn-service.ts. No carried-track
  // case, for the same reason there is no carried-picture one — this legacy path
  // parses messages as role and content only.
  const audioSelection = audioAnalysisCommandText({
    text: imageTo3dSelection.text,
    surface: "garden_chat",
    authenticated: true,
    hasAudioAttachment: hasAnalyzableAttachment(attachments),
  });
  // Last in the chain: see the same call in conversations/turn-service.ts.
  const messagingSelection = messagingCommandText({
    text: audioSelection.text,
    surface: "garden_chat",
    authenticated: true,
    priorMessages: messages,
  });
  const commandContext = {
    mode: decision.mode,
    surface: "garden_chat" as const,
    runtimeKind: session.runtimeKind,
  };
  // An automatic selection must never cost the user their turn: if the 3D
  // runtime is not installed here, the same message is resolved again without
  // it and the person gets an ordinary answer rather than an error.
  const resolved = await resolveCommandMessage(
    userId,
    messagingSelection.text,
    session.activeDirectory,
    commandContext,
  ).catch(async (error: unknown) => {
    if (!imageTo3dSelection.automatic && !audioSelection.automatic) throw error;
    return await resolveCommandMessage(
      userId,
      messagingCommandText({
        text: agentLoopSelection.text,
        surface: "garden_chat",
        authenticated: true,
        priorMessages: messages,
      }).text,
      session.activeDirectory,
      commandContext,
    );
  });
  decision.selectedConditionalSkills = resolved.invocations
    .filter((item) => item.kind === "skill")
    .map((item) => item.slug);
  decision.selectedConnections = resolved.invocations
    .filter((item) => item.kind === "mcp")
    .map((item) => item.slug);

  const runtime = getAgentRuntimeByKind(session.runtimeKind);
  const connectedApps = await connectedAppRegistryForTurn({
    runtime,
    directory: session.activeDirectory,
    userId,
    mode: decision.mode,
  });
  decision.selectedConnections = [
    ...new Set([
      ...decision.selectedConnections,
      ...connectedApps.connectionNames,
    ]),
  ];
  await runtime.health();
  await runtime.applyCapabilityDecision({
    externalSessionId: session.externalSessionId,
    liveSessionId: session.liveSessionId,
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
      automaticPremortem: premortemSelection.automatic,
      automaticInteractiveVisualizer: visualizerSelection.automatic,
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
  conversation = getConversationById(session.row.conversation_id) ?? conversation;
  if (conversation.surface !== "garden_chat") {
    throw new ApiError(409, "conversation_scope_mismatch", "The Garden conversation scope is invalid.");
  }
  const memory = await loadConversationMemoryBundleHybrid({
    conversation,
    query: text,
    activeGardenId: session.row.cluster_id,
    projectScopeId: "breadboard",
  });
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
    {
      ...resolved.tools,
      ...connectedApps.tools,
    },
  );
  // Documents the turn can see — files the user just attached and garden
  // sources they ticked in the sidebar — become book-to-skill skills when they
  // are large enough to be worth distilling, and the turn gets their structured
  // index instead of their raw text.
  const documents = await prepareDocumentContext({
    userId,
    attachments,
    garden: { clusterSlug, selectedDocumentSlugs: selectedSlugs },
    signal,
  });
  const runSystem = composeHermesSystemPrompt({
    surface: "garden_chat",
    decision,
    userText: resolved.userText || text,
    conversationPublicId: conversation.public_id,
    adhdMode: payload.adhdMode === true,
    additional: [
      composeMemoryContext(memory),
      connectedApps.systemContext,
      documents.context,
      decision.selectedConditionalSkills.includes(IMAGE_TO_3D_SKILL)
        ? renderImageTo3dContext(reconstructableFromAttachments(attachments))
        : "",
      decision.selectedConditionalSkills.includes(AUDIO_ANALYSIS_SKILL)
        ? renderAudioAnalysisContext(tracksFromAttachments(userId, attachments))
        : "",
      gardenTurnContext(
        clusterSlug,
        chatSessionId,
        page,
        selectedSlugs,
        prepared,
      ),
    ].filter(Boolean).join("\n\n"),
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
      modelIdentity: { modelID: engine.selectedModelID },
      variant: engine.variant,
      tools: runTools,
      system: runSystem,
    },
  });
  const runtimeText =
    resolved.text ||
    "Acknowledge the persona selection briefly and ask how you can help.";
  const runtimeMessageId = hermesMessageId(run.id);
  return legacyGardenEventStream(
    session,
    signal,
    prepared,
    run.id,
    { messageId: runtimeMessageId, instruction: runtimeText },
    () =>
    runtime.startRun({
      externalSessionId: session.externalSessionId,
      liveSessionId: session.liveSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      agentName: session.agentName,
      text: runtimeText,
      // Everything that was not distilled into a skill: images, 3D models, and
      // documents small enough to stay verbatim.
      attachments: documents.inlineAttachments,
      // The brokered map is authoritative. A selected MCP/skill tool may only
      // narrow it, never widen it.
      tools: runTools,
      model: engine.model,
      modelIdentity: { modelID: engine.selectedModelID },
      variant: engine.variant,
      system: runSystem,
      messageId: runtimeMessageId,
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
function parseSelectedDocumentSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

function gardenTurnContext(
  gardenSlug: string,
  chatSessionId: number,
  page: { slug: string; title?: string } | null,
  selected: readonly string[],
  prepared: PreparedTurn,
): string {
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
  turnReference: { messageId: string; instruction: string },
  sendMessage: () => Promise<void>,
): Response {
  const runtime = getAgentRuntimeByKind(session.runtimeKind);
  const encoder = new TextEncoder();
  const pump = acquireDetachedEventPump(
    `legacy-garden:${runId}`,
    async (sink) => {
      const emit = (value: unknown) =>
        sink.emit(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      let assistantText = "";
      // Mid-turn narration sealed off the answer buffer; the last segment is
      // promoted back if the turn ends with nothing left in the buffer.
      const narrationSegments: string[] = [];
      const evidence: EvidenceRecord[] = [];
      const toolCalls: Array<Record<string, unknown>> = [];
      let tokenUsage: unknown;
      let lastArtifactEventId = 0;
      let lastAgentLaunchRequestId = 0;
      // A launch the agent asked for, on its way to the only thing that can
      // perform it. Drained beside the artifact events, on every beat.
      const emitAgentLaunchRequests = () => {
        for (const request of listAgentLaunchRequestsAfter({
          runId,
          afterId: lastAgentLaunchRequestId,
        })) {
          lastAgentLaunchRequestId = request.id;
          emit({
            type: "agent_launch",
            requestId: request.requestId,
            agentId: request.agentId,
            agentName: request.agentName,
            command: request.command,
            brief: request.brief,
            reason: request.reason,
            awaitResult: request.awaitResult,
            requiresApproval: request.requiresApproval,
            ...(request.originClientMessageId
              ? { originClientMessageId: request.originClientMessageId }
              : {}),
          });
        }
      };
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
        backend: "hermes",
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
        sink.emit(encoder.encode("data: [DONE]\n\n"));
        sink.close();
        return;
      }
      try {
        let connected!: () => void;
        const ready = new Promise<void>((resolve) => {
          connected = resolve;
        });
        const events = runtime
          .streamSession(
            {
              externalSessionId: session.externalSessionId,
              liveSessionId: session.liveSessionId,
              workspaceKey: session.workspaceKey,
              directory: session.activeDirectory,
              ...turnReference,
            },
            undefined,
            connected,
          )
          [Symbol.asyncIterator]();
        const firstEvent = events.next();
        await Promise.race([
          ready,
          firstEvent.then((result) => {
            if (result.done)
              throw new Error(
                "Agent event stream closed before the prompt was sent.",
              );
          }),
        ]);
        await sendMessage();
        markRuntimeRunSubmitted(runId);
        emitArtifactEvents();
        emitAgentLaunchRequests();
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
          if (event.type === "assistant.segment") {
            // Streamed text up to here was tool-call narration, not the
            // answer. Only the final segment is persisted as the message; the
            // last sealed segment is the fallback for answerless turns.
            const sealed = event.payload.streamed
              ? assistantText.trim()
                ? assistantText
                : event.payload.text
              : event.payload.text;
            if (sealed.trim()) narrationSegments.push(sealed);
            if (event.payload.streamed) assistantText = "";
            emit({
              type: "segment",
              text: sealed,
              streamed: event.payload.streamed,
            });
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
          emitAgentLaunchRequests();
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
            if (!assistantText.trim() && narrationSegments.length) {
              assistantText = narrationSegments[narrationSegments.length - 1];
            }
            const webGroundingRequired =
              prepared.plan.requiredCapabilities.includes("web_research");
            const groundedAssistantText = enforceRequiredWebEvidence(
              assistantText,
              evidence,
              webGroundingRequired,
            );
            if (groundedAssistantText !== assistantText) {
              assistantText = groundedAssistantText;
              emit({ type: "replace", text: assistantText });
            }
            const verification = assessVerification(assistantText, evidence, {
              webGroundingRequired,
            });
            emitArtifactEvents();
            // Last chance before the stream closes: an unemitted launch would be
            // a run the agent believes it started and nobody ever will.
            emitAgentLaunchRequests();
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
        markStatus(session, "idle");
        finishRuntimeRun(runId, "completed");
        // Same placement as the Terminal hook: after persistence, before the
        // decision is revoked. See lib/loopx/conversation-tick.ts.
        scheduleLoopxTickForConversation({
          conversationId: session.row.conversation_id,
          runtimeSessionId: session.row.id,
          outcome: "completed",
          toolNames: toolCalls.map((call) => String(call.toolName)),
        });
        revokeCapabilityDecision(
          session.row.id,
          "completed",
        );
        recordAuditEvent({
          eventType: "message.completed",
          runtimeSessionId: session.row.id,
          userId: session.row.user_id,
          gardenId: session.row.garden_id,
        });
      } catch (error) {
        await runtime
          .stopRun({
            externalSessionId: session.externalSessionId,
            liveSessionId: session.liveSessionId,
            workspaceKey: session.workspaceKey,
            directory: session.activeDirectory,
          })
          .catch(() => undefined);
        markStatus(session, "failed");
        finishRuntimeRun(runId, "error");
        revokeCapabilityDecision(session.row.id, "abandoned");
        emit({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Agent stream failed.",
        });
        recordAuditEvent({
          eventType: "error",
          runtimeSessionId: session.row.id,
          userId: session.row.user_id,
          gardenId: session.row.garden_id,
          payload: { stage: "garden_event_stream" },
        });
      } finally {
        sink.emit(encoder.encode("data: [DONE]\n\n"));
        sink.close();
      }
    },
  );
  return pump.response(requestSignal, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Breadboard-AI-Backend": "hermes",
      "X-Breadboard-Runtime-Session": String(session.row.id),
  });
}
