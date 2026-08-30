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
  evidenceTitleForTool,
  type EvidenceRecord,
  type ExternalAgentCall,
} from "./evidence.ts";
import { composeHermesSystemPrompt } from "./system-prompts.ts";
import { suppliedEvidenceText } from "./evidence-calibration.ts";
import { adjudicateWebGrounding } from "./web-grounding-decider.ts";
import { scheduleLoopxTickForConversation } from "../loopx/conversation-tick.ts";
import {
  prepareTurn,
  mergeSelectedTools,
  type PreparedTurn,
} from "./dispatch-core.ts";
import { listFilesystemGrants } from "./filesystem-grant-store.ts";
import { connectedAppRegistryForTurn } from "./unified-tool-registry.ts";
import { connectedRepositoryForTurn } from "../code-index/chat-turn.ts";
import {
  beginRuntimeRun,
  finishRuntimeRun,
  getLatestRuntimeRun,
  getRuntimeRun,
  markRuntimeRunSubmitted,
  parseRuntimeRunDispatch,
  touchRuntimeRunHeartbeat,
} from "./run-store.ts";
import { hermesMessageId } from "./message-id.ts";
import { RUN_HEARTBEAT_INTERVAL_MS } from "./run-liveness.ts";
import {
  annotateConversationTurn,
  completeAssistantMessage,
  ensureConversationForLegacyChatSession,
  failAssistantMessage,
  getConversationById,
  reserveLegacyGardenAssistantTurn,
  reserveConversationTurn,
  updateConversation,
} from "../conversations/store.ts";
import { generateAndApplyConversationTitle } from "../conversations/title-service.ts";
import { composeMemoryContext } from "../conversations/memory.ts";
import { loadConversationMemoryBundleHybrid } from "../mem0/retrieval.ts";
import { gardenInstructions } from "../garden-settings.ts";
import { associateArtifactToolCall, listArtifactEventsAfter } from "./artifact-store.ts";
import {
  externalAgentCallsForRun,
  listAgentLaunchRequestsAfter,
} from "./agent-launch-store.ts";
import { acquireDetachedEventPump } from "./detached-event-pump.ts";
import {
  findAgencyAgent,
  renderAgencyAgentPersona,
  type AgencyAgentDefinition,
} from "./agency-agents.ts";
import { prepareDocumentContext } from "../document-skills/turn.ts";
import { parseChatAttachments } from "../chat-attachments-request.ts";
import {
  resolveDocumentAttachments,
  stageEditableDocumentAttachments,
} from "../document-attachments-server.ts";
import { retrieveDocumentAttachments } from "../colpali/retrieval.ts";
import { visualizerCommandText } from "./interactive-visualizer-intent.ts";
import { premortemCommandText } from "./premortem-intent.ts";
import { factcheckCommandText } from "./factcheck-intent.ts";
import { agentLoopCommandText } from "./agent-loop-intent.ts";
import { messagingCommandText } from "./messaging-intent.ts";
import { humanizeCommandText } from "./humanize-intent.ts";
import { imageTo3dCommandText, IMAGE_TO_3D_SKILL } from "./image-3d-intent.ts";
import { diagramCommandText, DIAGRAM_DESIGN_SKILL } from "./diagram-intent.ts";
import {
  githubExplorerCommandText,
  GITHUB_EXPLORER_SKILL,
} from "./github-explorer-intent.ts";
import {
  INTERACTIVE_VISUALIZER_SKILL,
  INTERACTIVE_VISUALIZER_IN_CHAT_SKILL,
} from "./interactive-visualizer-skills.ts";
import { turnCapabilitySelection } from "./capability-usage.ts";
import { capabilitySummaryForRun } from "./capability-evidence.ts";
import { audioAnalysisCommandText, AUDIO_ANALYSIS_SKILL } from "./audio-intent.ts";
import { spotifyCommandText, SPOTIFY_SKILL } from "./spotify-intent.ts";
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
import {
  resolveSmallTalkReply,
  smallTalkEventStream,
} from "../chat-small-talk.ts";
import { quartzAssistantSelectionPromptContext } from "../quartz-assistant-selection.ts";

type GardenChatPayload = {
  clusterSlug?: unknown;
  chatSessionId?: unknown;
  clientMessageId?: unknown;
  messages?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
  selectedDocumentSlugs?: unknown;
  activeMarkdown?: unknown;
  selectedText?: unknown;
  selectedTextContext?: unknown;
  attachments?: unknown;
  adhdMode?: unknown;
  /** Personalize, as it stood when the message was sent. Absent means on. */
  personalize?: unknown;
  /** This turn exists to report a delegated worker's finished run. */
  internalAgentContinuation?: unknown;
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
  let conversation = ensureConversationForLegacyChatSession(
    chatSessionId,
    userId,
  );
  const suppliedClientMessageId =
    typeof payload.clientMessageId === "string"
      ? payload.clientMessageId.trim()
      : "";
  let reservedClientMessageId: string;
  if (suppliedClientMessageId) {
    const reserved = reserveConversationTurn({
      conversation,
      clientMessageId: suppliedClientMessageId,
      surface: "garden_chat",
      content: text,
      metadata: { gardenPreDispatch: true },
    });
    reservedClientMessageId = reserved.userMessage.client_message_id;
  } else {
    reservedClientMessageId = reserveLegacyGardenAssistantTurn({
      conversation,
      chatSessionId,
      content: text,
    }).clientMessageId;
  }
  const touchPreDispatch = () =>
    annotateConversationTurn({
      conversationId: conversation.id,
      clientMessageId: reservedClientMessageId,
      metadata: { gardenPreDispatch: true },
    });
  touchPreDispatch();
  const preDispatchHeartbeat = setInterval(touchPreDispatch, 10_000);
  preDispatchHeartbeat.unref?.();
  try {
  // Attachments reach this surface in the request body but used to stop here:
  // the payload was parsed for messages only, so a file picked in the Garden
  // composer never reached the runtime at all.
  // ColPali narrows a long document to the pages this question is about, and
  // hands the attachment back untouched when it cannot — an unindexed document
  // still arrives whole.
  const attachments = await retrieveDocumentAttachments(
    userId,
    resolveDocumentAttachments(userId, parseChatAttachments(payload.attachments)),
    text,
    process.env,
    signal,
  );
  const selectedSlugs = parseSelectedDocumentSlugs(payload.selectedDocumentSlugs);
  // Garden Chat's own copy of the first-turn titling in
  // conversations/turn-service.ts. This surface persists its transcript through
  // the legacy chat-session route rather than reserveConversationTurn, so the
  // canonical pipeline's `order_index === 0` test is not available here; the
  // payload carrying exactly one user message is the same first turn. Awaiting
  // matches the Terminal, where the title lands before the run is dispatched.
  // applyGeneratedConversationTitle writes chat_sessions too, so the Garden
  // sidebar reads the same title, and its compare-and-swap on the observed
  // title means a manual rename racing this call still wins.
  if (isFirstUserTurn(messages)) {
    conversation =
      (await generateAndApplyConversationTitle({
        conversation,
        firstPrompt: text,
        model: payload.model,
      })) ?? conversation;
  }
  // A greeting does not need a 600k-word garden, memories, tools, or an agent
  // run. Keep this intentionally narrow and fail closed for attachments,
  // task-bearing text, and active personas, all of which need the full path.
  const smallTalkReply =
    attachments.length === 0 && !conversation.active_agency_agent_slug
      ? resolveSmallTalkReply(text)
      : null;
  if (smallTalkReply) {
    recordAuditEvent({
      eventType: "small_talk.fast_path",
      userId,
      gardenId: clusterSlug,
      payload: { intent: smallTalkReply.intent, chatSessionId },
    });
    completeAssistantMessage({
      conversationId: conversation.id,
      clientMessageId: reservedClientMessageId,
      content: smallTalkReply.text,
      metadata: { runtimeStatus: "idle", fastPath: true },
    });
    return smallTalkEventStream(smallTalkReply);
  }

  const engine = resolveHermesEngine(
    payload.model,
    payload.reasoningEffort,
  );
  const existing = getRuntimeSessionByChatSession(chatSessionId);
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
  const factcheckSelection = factcheckCommandText({
    text: premortemSelection.text,
    surface: "garden_chat",
    authenticated: true,
    priorMessages: messages,
  });
  const visualizerSelection = visualizerCommandText({
    text: factcheckSelection.text,
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
  const spotifySelection = spotifyCommandText({
    text: imageTo3dSelection.text,
    surface: "garden_chat",
    authenticated: true,
    hasAudioAttachment: hasAnalyzableAttachment(attachments),
    activeAgentSlug: conversation.active_agency_agent_slug,
  });
  // The same second copy of the chain: an attached song has to select the skill
  // here exactly as it does in conversations/turn-service.ts. No carried-track
  // case, for the same reason there is no carried-picture one — this legacy path
  // parses messages as role and content only.
  const audioSelection = audioAnalysisCommandText({
    text: spotifySelection.text,
    surface: "garden_chat",
    authenticated: true,
    hasAudioAttachment: hasAnalyzableAttachment(attachments),
  });
  // The same second copy of the chain: a request to draw something has to
  // select the skill here exactly as it does in conversations/turn-service.ts,
  // and for the same reason it sits after the attachment-driven selections
  // there.
  const diagramSelection = diagramCommandText({
    text: audioSelection.text,
    surface: "garden_chat",
    authenticated: true,
    priorMessages: messages,
  });
  // The same second copy of the chain: a repo named for inspection has to
  // select the skill here exactly as it does in conversations/turn-service.ts,
  // after Diagram Design and before messaging for the same reasons.
  const githubExplorerSelection = githubExplorerCommandText({
    text: diagramSelection.text,
    surface: "garden_chat",
    authenticated: true,
    priorMessages: messages,
  });
  // The same place in the chain as the copy in conversations/turn-service.ts:
  // after every skill that claims a turn on its subject, before the errand.
  const humanizeSelection = humanizeCommandText({
    text: githubExplorerSelection.text,
    surface: "garden_chat",
    authenticated: true,
    priorMessages: messages,
  });
  // Last in the chain: see the same call in conversations/turn-service.ts.
  const messagingSelection = messagingCommandText({
    text: humanizeSelection.text,
    surface: "garden_chat",
    authenticated: true,
    priorMessages: messages,
  });
  const commandContext = {
    mode: decision.mode,
    surface: "garden_chat" as const,
    runtimeKind: session.runtimeKind,
    activeAgentSlug: conversation.active_agency_agent_slug,
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
    if (
      !imageTo3dSelection.automatic &&
      !spotifySelection.automatic &&
      !audioSelection.automatic &&
      !diagramSelection.automatic &&
      !githubExplorerSelection.automatic &&
      !humanizeSelection.automatic
    ) throw error;
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

  // Whether this turn owes live web evidence. The keyword planner's "no" is
  // final and free; its "yes" is a proposal a cheap model adjudicates, because
  // the planner matches keywords anywhere in the message and cannot tell an
  // instruction from text the user pasted to be worked on. Fixed here, before
  // dispatch, so the finished answer is judged against a standard it could not
  // lower. See web-grounding-decider.ts.
  const webGroundingVerdict = await adjudicateWebGrounding({
    request: resolved.userText || text,
    plannerRequired: prepared.plan.requiresWebEvidence,
  });

  const runtime = getAgentRuntimeByKind(session.runtimeKind);
  const connectedApps = await connectedAppRegistryForTurn({
    runtime,
    directory: session.activeDirectory,
    userId,
    mode: decision.mode,
  });
  // The repository this Garden is connected to, read from the checkout for
  // this turn: a description of what it is and how it is laid out, plus its
  // code index as tools when the graph is ready. Nothing about the repository
  // is written into this file — the same call describes whichever repository
  // the user connected, and a Garden without one gets exactly the turn it
  // always had.
  const repository = await connectedRepositoryForTurn({
    userId,
    gardenSlug: clusterSlug,
  });
  decision.selectedConnections = [
    ...new Set([
      ...decision.selectedConnections,
      ...connectedApps.connectionNames,
      ...(repository?.connection ? [repository.connection] : []),
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
      automaticFactcheck: factcheckSelection.automatic,
      automaticInteractiveVisualizer: visualizerSelection.automatic,
      automaticDiagramDesign: diagramSelection.automatic,
      automaticGithubExplorer: githubExplorerSelection.automatic,
      ...(repository
        ? {
            connectedRepository: repository.repository.name,
            connectedRepositoryCodeIndex: repository.codeIndex,
          }
        : {}),
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
    personalize: payload.personalize !== false,
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
      ...(repository?.tools ?? {}),
    },
  );
  // Documents the turn can see — files the user just attached and garden
  // sources they ticked in the sidebar — become book-to-skill skills when they
  // are large enough to be worth distilling, and the turn gets their structured
  // index instead of their raw text.
  const editableDocuments = stageEditableDocumentAttachments({
    userId,
    attachments,
    workspace: session.activeDirectory,
  });
  const documents = await prepareDocumentContext({
    userId,
    conversationId: conversation.public_id,
    attachments,
    garden: { clusterSlug, selectedDocumentSlugs: selectedSlugs },
    signal,
  });
  const runSystem = composeHermesSystemPrompt({
    surface: "garden_chat",
    decision,
    userText: resolved.userText || text,
    // Only the attachments that still travel verbatim: a distilled document
    // reaches the model as an index, which has no values to check.
    suppliedEvidence: suppliedEvidenceText(documents.inlineAttachments),
    conversationPublicId: conversation.public_id,
    adhdMode: payload.adhdMode === true,
    additional: [
      // The garden's own standing instructions, set from the workspace header's
      // settings dialog. Placed ahead of the rest of the turn's context so it
      // reads as a preference the assistant carries into the work, not as a
      // late correction bolted onto the end of the prompt.
      gardenInstructionsContext(session.row.cluster_id),
      composeMemoryContext(memory),
      // Directly after memory, so the repository reads as something the
      // assistant knows about this Garden rather than a tool it was handed.
      repository?.systemContext ?? "",
      connectedApps.systemContext,
      documents.context,
      editableDocuments.context,
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
      quartzAssistantSelectionPromptContext(payload.selectedTextContext) ||
        quartzAssistantSelectionPromptContext(payload.selectedText),
    ].filter(Boolean).join("\n\n"),
    persona: activeAgencyAgent
      ? renderAgencyAgentPersona(activeAgencyAgent)
      : undefined,
  });
  // Garden Chat's copy of the capability ledger the Terminal keeps. Same rule:
  // only selections the resolver kept are recorded, so an automatic pick the
  // availability fallback dropped never appears in this turn's provenance.
  // Super agent does not reach this surface, so there is no inventory here.
  const capabilitySelection = turnCapabilitySelection({
    invocations: resolved.invocations,
    automaticSkills: [
      ...(imageTo3dSelection.automatic ? [{ slug: IMAGE_TO_3D_SKILL }] : []),
      ...(spotifySelection.automatic ? [{ slug: SPOTIFY_SKILL }] : []),
      ...(audioSelection.automatic ? [{ slug: AUDIO_ANALYSIS_SKILL }] : []),
      ...(diagramSelection.automatic ? [{ slug: DIAGRAM_DESIGN_SKILL }] : []),
      ...(githubExplorerSelection.automatic
        ? [{ slug: GITHUB_EXPLORER_SKILL }]
        : []),
      ...(premortemSelection.automatic ? [{ slug: "premortem" }] : []),
      ...(factcheckSelection.automatic ? [{ slug: "bullshit-detector" }] : []),
      ...(messagingSelection.automatic ? [{ slug: "send-to-my-phone" }] : []),
      ...(agentLoopSelection.automatic
        ? [{ slug: "agent-loop-engineering" }]
        : []),
      ...(visualizerSelection.automatic
        ? [
            { slug: INTERACTIVE_VISUALIZER_SKILL },
            { slug: INTERACTIVE_VISUALIZER_IN_CHAT_SKILL },
          ]
        : []),
    ],
  });
  // A delegated worker is launched on one turn and reported on the next, and
  // only the second is visible: the hand-back arrives as a hidden message, so
  // the answer the user reads belongs to a run that queued nothing and called
  // no tool. Carry the delegation across that seam, or the one turn anybody
  // opens the evidence panel on shows no trace of whose work it is. Read before
  // the new run begins, so this is still the turn that did the delegating.
  const carriedDelegations =
    payload.internalAgentContinuation === true
      ? externalAgentCallsForRun(getLatestRuntimeRun(session.row.id)?.id).map(
          (call) => ({ ...call, carried: true }),
        )
      : [];
  const runtimeText =
    resolved.text ||
    "Acknowledge the persona selection briefly and ask how you can help.";
  let run: ReturnType<typeof beginRuntimeRun>;
  try {
    run = beginRuntimeRun({
      runtimeSessionId: session.row.id,
      instruction: text,
      dispatch: {
        conversationPublicId: conversation.public_id,
        clientMessageId: reservedClientMessageId,
        runtimeText,
        model: engine.model,
        modelIdentity: { modelID: engine.selectedModelID },
        variant: engine.variant,
        tools: runTools,
        system: runSystem,
        capabilities: capabilitySelection,
        ...(carriedDelegations.length
          ? { delegatedAgents: carriedDelegations }
          : {}),
      },
    });
  } catch (error) {
    failAssistantMessage({
      conversationId: conversation.id,
      clientMessageId: reservedClientMessageId,
      status: "failed",
      error: "garden_run_not_started",
    });
    throw error;
  }
  const runtimeMessageId = hermesMessageId(reservedClientMessageId);
  const finalConversation = conversation;
  return legacyGardenEventStream(
    session,
    signal,
    prepared,
    run.id,
    reservedClientMessageId,
    { messageId: runtimeMessageId, instruction: runtimeText },
    webGroundingVerdict.required,
    (target) =>
    runtime.startRun({
      externalSessionId: target.externalSessionId,
      liveSessionId: target.liveSessionId,
      workspaceKey: target.workspaceKey,
      directory: target.activeDirectory,
      agentName: target.agentName,
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
    // Hermes keeps live sessions in memory, so the first Garden turn after a
    // Hermes restart addresses a session id the gateway no longer knows and
    // prompt.submit answers "session not found". The Terminal already
    // re-dispatches onto a recreated session (startConversationTurn's retry);
    // this surface used to fail the turn with the gateway's message as the
    // answer. Same recovery: rebuild the live session from the canonical
    // transcript, re-apply this turn's decision, and send again.
    async () => {
      const replacement = await resolveConversationRuntime({
        conversation: finalConversation,
        surface: "garden_chat",
        activeGardenSlug: clusterSlug,
        activePageSlug: page?.slug ?? null,
        forceRecreate: true,
      });
      await runtime.applyCapabilityDecision({
        externalSessionId: replacement.externalSessionId,
        liveSessionId: replacement.liveSessionId,
        workspaceKey: replacement.workspaceKey,
        directory: replacement.activeDirectory,
        decision,
      });
      return replacement;
    },
  );
  } catch (error) {
    annotateConversationTurn({
      conversationId: conversation.id,
      clientMessageId: reservedClientMessageId,
      metadata: {
        gardenPreDispatch: true,
        preDispatchError:
          error instanceof Error ? error.message : "Garden dispatch failed.",
      },
    });
    throw error;
  } finally {
    clearInterval(preDispatchHeartbeat);
  }
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

/**
 * The transcript the composer just sent holds one user message and nothing
 * before it: this send is the chat's first turn, the one that names it.
 */
function isFirstUserTurn(messages: ChatMessage[]): boolean {
  return messages.filter((message) => message.role === "user").length === 1;
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

/**
 * The garden's standing instructions, if it has any.
 *
 * Read per turn rather than cached: the settings dialog can change them while a
 * chat is open, and a stale cache would make the change look like it had not
 * saved. Truncated because this is free text a user typed into a box.
 */
function gardenInstructionsContext(clusterId: number | null): string {
  const instructions = gardenInstructions(clusterId).trim();
  if (!instructions) return "";
  return [
    "Instructions for this garden, set by the user:",
    instructions.slice(0, 4_000),
  ].join("\n");
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


/**
 * The capability selection recorded on a run, or nothing if the row has gone.
 * Read back rather than closed over so the stream describes the exact turn it
 * is finishing, the way the Terminal pump does.
 */
function capabilitySelectionForRun(runId: string) {
  const run = getRuntimeRun(runId);
  return run ? parseRuntimeRunDispatch(run).capabilities : undefined;
}

/**
 * Every runtime agent this answer stands on: the ones this turn queued, plus
 * the one an earlier turn launched whose finished result this turn was
 * dispatched to report. The second kind is recorded on the run at dispatch,
 * because nothing in this stream would otherwise witness it — a hand-back turn
 * queues no launch and calls no tool.
 */
function externalAgentsForRun(runId: string): ExternalAgentCall[] {
  const run = getRuntimeRun(runId);
  const carried = run ? (parseRuntimeRunDispatch(run).delegatedAgents ?? []) : [];
  return [...carried, ...externalAgentCallsForRun(runId)];
}

function legacyGardenEventStream(
  initialSession: AuthorizedRuntimeSession,
  requestSignal: AbortSignal,
  prepared: PreparedTurn,
  runId: string,
  clientMessageId: string,
  turnReference: { messageId: string; instruction: string },
  /**
   * Adjudicated before dispatch by the web-grounding decider, and passed in
   * rather than re-derived here: the obligation must be the one this turn was
   * sent under, and `prepared.plan.requiresWebEvidence` is only the keyword
   * planner's proposal. Reading the proposal back at completion time is how a
   * pasted report full of citation links came to owe live web evidence.
   */
  webGroundingRequired: boolean,
  /** Submit the prompt on the given runtime session. */
  dispatch: (target: AuthorizedRuntimeSession) => Promise<void>,
  /**
   * Replace a runtime session the gateway no longer knows. Called once, only
   * when opening the turn fails before any answer text arrived; its failure
   * surfaces the original error, not its own.
   */
  recoverSession: () => Promise<AuthorizedRuntimeSession>,
): Response {
  const runtime = getAgentRuntimeByKind(initialSession.runtimeKind);
  const encoder = new TextEncoder();
  // Never cache the runtime identity for the turn: recovery rewrites the
  // row's external/live ids in place, and every later call (stop, status)
  // must address the session the answer is actually streaming on.
  let session = initialSession;
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
            ...(request.startedRun ? { startedRun: request.startedRun } : {}),
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
        if (session.row.conversation_id !== null) {
          failAssistantMessage({
            conversationId: session.row.conversation_id,
            clientMessageId,
            status: "aborted",
            error: "awaiting_permission",
          });
        }
        // Nothing executed under this decision. It is abandoned rather than
        // completed; approving the permission produces a fresh decision on the
        // resumed turn.
        revokeCapabilityDecision(session.row.id, "abandoned");
        sink.emit(encoder.encode("data: [DONE]\n\n"));
        sink.close();
        return;
      }
      // This compatibility pump owns the run just as surely as the canonical
      // session pump does. Keep its durable claim alive so periodic recovery
      // never adopts a healthy long-running Garden turn and starts a second
      // consumer after the two-minute abandonment window.
      touchRuntimeRunHeartbeat(runId);
      const heartbeat = setInterval(
        () => touchRuntimeRunHeartbeat(runId),
        RUN_HEARTBEAT_INTERVAL_MS,
      );
      heartbeat.unref?.();
      try {
        // Open the event stream, then submit the prompt on the same session.
        // The stream is subscribed first so no early delta is missed; the
        // subscription itself never fails for a dead session — the gateway
        // only answers "session not found" to prompt.submit.
        const openTurn = async (target: AuthorizedRuntimeSession) => {
          const attempt = new AbortController();
          let connected!: () => void;
          const ready = new Promise<void>((resolve) => {
            connected = resolve;
          });
          const events = runtime
            .streamSession(
              {
                externalSessionId: target.externalSessionId,
                liveSessionId: target.liveSessionId,
                workspaceKey: target.workspaceKey,
                directory: target.activeDirectory,
                ...turnReference,
              },
              attempt.signal,
              connected,
            )
            [Symbol.asyncIterator]();
          const firstEvent = events.next();
          try {
            await Promise.race([
              ready,
              firstEvent.then((result) => {
                if (result.done)
                  throw new Error(
                    "Agent event stream closed before the prompt was sent.",
                  );
              }),
            ]);
            await dispatch(target);
          } catch (error) {
            // Release the abandoned subscription before the retry opens its
            // own, so the old session's listener cannot outlive the turn.
            attempt.abort();
            firstEvent.catch(() => undefined);
            void events.return?.(undefined).catch(() => undefined);
            throw error;
          }
          return { events, firstEvent };
        };
        let opened: Awaited<ReturnType<typeof openTurn>>;
        try {
          opened = await openTurn(session);
        } catch (firstError) {
          let replacement: AuthorizedRuntimeSession;
          try {
            replacement = await recoverSession();
          } catch {
            throw firstError;
          }
          session = replacement;
          recordAuditEvent({
            eventType: "conversation.turn_redispatched",
            runtimeSessionId: session.row.id,
            userId: session.row.user_id,
            gardenId: session.row.garden_id,
            payload: {
              runId,
              reason:
                firstError instanceof Error
                  ? firstError.message
                  : "runtime_dispatch_failed",
            },
          });
          opened = await openTurn(session);
        }
        const { events, firstEvent } = opened;
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
            // A segment closed by a tool call is provisional narration, not a
            // chat answer. Put it straight into the Thinking surface instead
            // of briefly drawing it as a message that must later disappear.
            emit({
              type: "provisional",
              text: sealed,
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
              title: evidenceTitleForTool(
                event.payload.toolName,
                event.payload.summary,
              ),
              location: event.payload.location,
              success: event.payload.success,
              toolCallId: event.payload.toolCallId,
              timestamp: event.timestamp,
              // Carry the resolved sources, not just the tool's name: the
              // evidence panel's whole claim is that it can show which pages
              // an answer came from.
              details: {
                ...(event.payload.details ?? {}),
                toolName: event.payload.toolName,
              },
              ...(event.payload.websites?.length
                ? { websites: event.payload.websites }
                : {}),
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
            // A provider/runtime can close a successful stream without ever
            // emitting answer text. Do not leave the Garden transcript with a
            // blank assistant bubble and an apparently completed turn: make
            // the terminal state explicit and give the user a safe retry path.
            if (!assistantText.trim() && toolCalls.length === 0) {
              assistantText =
                "The assistant returned no answer. Please try again.";
              recordAuditEvent({
                eventType: "message.empty_response",
                runtimeSessionId: session.row.id,
                userId: session.row.user_id,
                gardenId: session.row.garden_id,
              });
            }
            // Text is provisional until Hermes reaches idle because any
            // earlier segment may still become tool-call narration. Reveal the
            // stable answer once, after that decision.
            emit({ type: "replace", text: assistantText });
            const verification = assessVerification(assistantText, evidence, {
              webGroundingRequired,
              externalAgents: externalAgentsForRun(runId),
              // Selections were fixed before dispatch — read back off the run
              // rather than closed over, so this stream describes the turn it
              // is finishing. Usage comes from the calls that completed.
              capabilities: capabilitySummaryForRun({
                runtimeSessionId: session.row.id,
                runId,
                selection: capabilitySelectionForRun(runId),
                toolCalls,
              }),
            });
            emitArtifactEvents();
            // Last chance before the stream closes: an unemitted launch would be
            // a run the agent believes it started and nobody ever will.
            emitAgentLaunchRequests();
            emit({ type: "verification", verification });
            if (
              session.row.conversation_id !== null &&
              (assistantText.trim() || toolCalls.length)
            ) {
              const runtimeRun = getRuntimeRun(runId);
              const runtimeStartedAt = runtimeRun
                ? Date.parse(runtimeRun.started_at)
                : Number.NaN;
              const responseDurationMs = Number.isFinite(runtimeStartedAt)
                ? Math.max(0, Date.now() - runtimeStartedAt)
                : undefined;
              completeAssistantMessage({
                conversationId: session.row.conversation_id,
                clientMessageId,
                content: assistantText,
                sources: [],
                tokenUsage,
                metadata: {
                  calls: toolCalls,
                  verification,
                  ...(responseDurationMs !== undefined
                    ? { responseDurationMs }
                    : {}),
                  runtimeStatus: "idle",
                },
              });
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
        const failureMessage =
          error instanceof Error ? error.message : "Agent stream failed.";
        if (session.row.conversation_id !== null) {
          failAssistantMessage({
            conversationId: session.row.conversation_id,
            clientMessageId,
            status: "failed",
            content: assistantText,
            error: "garden_event_stream_failed",
            metadata: {
              calls: toolCalls,
              runtimeStatus: "failed",
              runtimeError: failureMessage,
            },
            tokenUsage,
          });
        }
        emit({
          type: "error",
          error: failureMessage,
        });
        recordAuditEvent({
          eventType: "error",
          runtimeSessionId: session.row.id,
          userId: session.row.user_id,
          gardenId: session.row.garden_id,
          payload: { stage: "garden_event_stream" },
        });
      } finally {
        clearInterval(heartbeat);
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
