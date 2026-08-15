import {
  chatMessageAttachments,
  type ChatAttachment,
} from "../chat-attachments.ts";
import { resolveCommandMessage } from "../hermes/commands.ts";
import { prepareDocumentContext } from "../document-skills/turn.ts";
import { prepareTurn, mergeSelectedTools } from "../hermes/dispatch-core.ts";
import { listFilesystemGrants } from "../hermes/filesystem-grant-store.ts";
import { getAgentRuntimeByKind } from "../agent-runtime/runtime.ts";
import { hermesMessageId } from "../hermes/message-id.ts";
import { resolveHermesEngine } from "../hermes/model-selection.ts";
import {
  beginRuntimeRun,
  finishRuntimeRun,
  getActiveRuntimeRun,
  markRuntimeRunSubmitted,
  type RuntimeRunRow,
} from "../hermes/run-store.ts";
import { reclaimAbandonedRunForSession } from "../hermes/run-recovery.ts";
import {
  listAuthorizedGardens,
  authorizeConversationRuntime,
  markStatus,
  resolveConversationRuntime,
  type AuthorizedRuntimeSession,
} from "../hermes/session-service.ts";
import {
  persistCapabilityDecision,
  recordAuditEvent,
} from "../hermes/runtime-store.ts";
import { scheduleCapabilityExpiry } from "../hermes/capability-lifecycle.ts";
import { composeHermesSystemPrompt } from "../hermes/system-prompts.ts";
import { ApiError } from "../hermes/route-helpers.ts";
import type { HermesSurface } from "../hermes/config.ts";
import {
  reserveConversationTurn,
  retryAssistantMessage,
  annotateConversationTurn,
  completeAssistantMessage,
  failAssistantMessage,
  updateConversation,
  ConversationStoreError,
  type ConversationRow,
  type ConversationMessageRow,
} from "./store.ts";
import { generateAndApplyConversationTitle } from "./title-service.ts";
import {
  composeMemoryContext,
  maintainDurableMemoryFromUserTurn,
} from "./memory.ts";
import { scheduleMemoryProfileSynthesisForConversation } from "./memory-profile.ts";
import { loadConversationMemoryBundleHybrid } from "../mem0/retrieval.ts";
import {
  findAgencyAgent,
  renderAgencyAgentPersona,
  renderChiefOfStaffOrchestration,
  loadAgencyAgentsCatalog,
  CHIEF_OF_STAFF_SLUG,
  type AgencyAgentDefinition,
} from "../hermes/agency-agents.ts";
import {
  hasFilesystemReferenceIntent,
  resolveVerifiedCrossChatFilesystemReferences,
  resolveVerifiedFilesystemReferences,
} from "./reference-resolution.ts";
import { runtimeMessagesForBranch } from "./branch-history.ts";
import { visualizerCommandText } from "../hermes/interactive-visualizer-intent.ts";
import { selectedInteractiveVisualizerSkill } from "../hermes/interactive-visualizer-skills.ts";
import { premortemCommandText } from "../hermes/premortem-intent.ts";
import { agentLoopCommandText } from "../hermes/agent-loop-intent.ts";
import { messagingCommandText } from "../hermes/messaging-intent.ts";
import { watchCommandText } from "../hermes/watch-intent.ts";
import {
  imageTo3dCommandText,
  IMAGE_TO_3D_SKILL,
} from "../hermes/image-3d-intent.ts";
import {
  hasReconstructableAttachment,
  hasReconstructableImages,
  mergeImages,
  reconstructableFromAttachments,
  reconstructableImages,
  renderImageTo3dContext,
} from "../sf3d/images.ts";
import {
  audioAnalysisCommandText,
  AUDIO_ANALYSIS_SKILL,
} from "../hermes/audio-intent.ts";
import {
  analyzableTracks,
  hasAnalyzableAttachment,
  hasRecentAnalyzableAudio,
  mergeTracks,
  renderAudioAnalysisContext,
  tracksFromAttachments,
} from "../audio-analyzer/tracks.ts";
import {
  prepareVideosForWatch,
  recentVideoAttachment,
  renderWatchVideoContext,
  videoAttachments,
  type VideoAttachment,
} from "../hermes/watch-turn.ts";
import { firstVideoSource } from "../video-sources/identity.ts";
import { cachedVideoSource, ensureVideoSource } from "../video-sources/resolve.ts";
import type { VideoAttachmentFormat } from "../video-attachments.ts";
import {
  retrieveTerminalGardenGrounding,
  type TerminalGardenGrounding,
} from "../hermes/terminal-garden-grounding.ts";
import { connectedAppRegistryForTurn } from "../hermes/unified-tool-registry.ts";
import {
  loadSuperAgentInventory,
  renderSuperAgentDirective,
  type SuperAgentInventory,
} from "../hermes/super-agent.ts";
import {
  chatTextSelectionQuestionPrompt,
  type ChatTextSelectionReference,
} from "../chat-text-selection.ts";
import {
  renderArisTurnGuidance,
} from "../aris/agent.ts";
import { ARIS_AGENT_SLUG } from "../aris/identity.ts";
import type { CurrentLocationSnapshot } from "../current-location.ts";
import { renderCurrentLocationContext } from "../hermes/current-location-context.ts";
import {
  renderGeographicGroundingDirective,
  requiresGeographicGroundingInContext,
} from "../map/grounding.ts";
import { readGeographicContext, recordCurrentLocation } from "../map/store.ts";
import { parseCurrentLocationPayload } from "../hermes/current-location-context.ts";
import {
  activateGoalMode,
  GOAL_MODE_CONNECTION,
  type GoalModeState,
} from "../goal-mode.ts";

export interface ConversationSurfaceContext {
  activeGardenSlug?: string;
  activePageSlug?: string;
  pageTitle?: string;
  selectedText?: string;
  selectedDocumentIds?: string[];
  graphContext?: unknown;
  /** Server-assembled, authorized page context; never accepted from a browser. */
  authorizedContext?: string;
  /**
   * Where the answer is actually delivered when that is not the app itself.
   * A messaging turn is still a Terminal chat, so the surface alone cannot tell
   * the agent it is writing to a phone under a different set of constraints.
   */
  deliveryChannel?: DeliveryChannel;
}

const DELIVERY_CHANNELS = ["whatsapp", "telegram"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export interface StartConversationTurnInput {
  conversation: ConversationRow;
  clientMessageId: string;
  text: string;
  surface: HermesSurface;
  surfaceContext?: ConversationSurfaceContext;
  model?: unknown;
  reasoningEffort?: unknown;
  attachments?: ChatAttachment[];
  confirmedPermissionIds?: string[];
  retry?: boolean;
  branchGroupId?: string;
  textSelection?: ChatTextSelectionReference;
  branchHistory?: ConversationMessageRow[];
  branchContextId?: string;
  /** Internal result hand-back from a delegated agent, not a person's message. */
  internalAgentContinuation?: boolean;
  /**
   * The user had Super agent on for this message: the turn is planned with the
   * inventory classes, every reviewed skill and connection is selected for it,
   * and it is given the catalogue to choose from. Per-message, never stored.
   */
  superAgent?: boolean;
  /**
   * The user had Direct mode on for this message, so the turn is written in the
   * underlying `i-have-adhd` output style. Shape only: it selects no skill, grants no
   * capability, and never reaches the capability decision. Per-message, never
   * stored, exactly like Super agent above.
   */
  adhdMode?: boolean;
  /**
   * The user switched Goal Mode on for this turn. Breadboard creates or resumes
   * its per-conversation Goal-compatible state before dispatch.
   */
  goalMode?: boolean;
  /**
   * The user had YOLO mode on for this message. This configures Hermes's
   * session-scoped approval bypass only; Breadboard's capability policy and
   * filesystem preflight remain authoritative.
   */
  yoloMode?: boolean;
  /** Coarse, short-lived browser context; never durable message metadata. */
  currentLocation?: CurrentLocationSnapshot;
}

export type StartConversationTurnResult =
  | {
      accepted: true;
      session: AuthorizedRuntimeSession;
      run: RuntimeRunRow;
      userMessage: ConversationMessageRow;
      replayed: boolean;
      capability: { mode: string; expiresAt: string | null; decisionId: number };
    }
  | {
      accepted: false;
      blocked: true;
      session: AuthorizedRuntimeSession;
      reason: "awaiting_permission";
      pendingPermissions: unknown[];
      request: string;
      plan: { intendedOutcome: string; steps: string[]; riskLevel: string };
    }
  | {
      accepted: false;
      clarified: true;
      session: AuthorizedRuntimeSession;
      message: string;
    }
  | {
      accepted: false;
      replayed: true;
      status: "complete" | "pending";
      session: AuthorizedRuntimeSession;
      run: RuntimeRunRow | null;
    };

/** Shared authenticated turn pipeline for Terminal, Garden Chat, and Quartz. */
export async function startConversationTurn(
  input: StartConversationTurnInput,
): Promise<StartConversationTurnResult> {
  if (input.surface !== input.conversation.surface) {
    throw new ApiError(
      403,
      "surface_scope_mismatch",
      "This conversation is bound to a different assistant surface.",
    );
  }
  const context = normalizeSurfaceContext(input.surfaceContext);
  let preparedBranchSession: AuthorizedRuntimeSession | null = null;
  if (input.branchHistory) {
    preparedBranchSession = await resolveConversationRuntime({
      conversation: input.conversation,
      surface: input.surface,
      activeGardenSlug: context.activeGardenSlug ?? null,
      activePageSlug: context.activePageSlug ?? null,
    });
    if (
      !input.branchContextId ||
      runtimeBranchContextId(preparedBranchSession) !== input.branchContextId
    ) {
      throw new ApiError(
        409,
        "branch_runtime_not_prepared",
        "The regenerated branch runtime is stale. Try resending again.",
      );
    }
  }
  let reservation;
  try {
    reservation = reserveConversationTurn({
      conversation: input.conversation,
      clientMessageId: input.clientMessageId,
      surface: input.surface,
      content: input.text,
      metadata: {
        activeGardenSlug: context.activeGardenSlug ?? null,
        activePageSlug: context.activePageSlug ?? null,
        attachmentNames: (input.attachments ?? []).map((attachment) => attachment.name),
        attachments: chatMessageAttachments(input.attachments),
        ...(input.branchGroupId ? { branchGroupId: input.branchGroupId } : {}),
        ...(input.textSelection ? { textSelection: input.textSelection } : {}),
        ...(input.internalAgentContinuation
          ? { internalAgentContinuation: true }
          : {}),
      },
    });
  } catch (error) {
    throw asApiError(error);
  }

  if (reservation.isNew && reservation.userMessage.order_index === 0) {
    const titledConversation = await generateAndApplyConversationTitle({
      conversation: reservation.conversation,
      firstPrompt: input.text,
      model: input.model,
    });
    if (titledConversation) {
      reservation = { ...reservation, conversation: titledConversation };
      input = { ...input, conversation: titledConversation };
    }
  }

  if (!reservation.isNew) {
    const assistant = reservation.assistantMessage;
    if (assistant.status === "complete") {
      return {
        accepted: false,
        replayed: true,
        status: "complete",
        session: authorizeConversationRuntime(input.conversation),
        run: null,
      };
    }
    if (assistant.status === "pending") {
      const existingSession = authorizeConversationRuntime(input.conversation);
      return {
        accepted: false,
        replayed: true,
        status: "pending",
        session: existingSession,
        run: getActiveRuntimeRun(existingSession.row.id),
      };
    }
    if (!input.retry && !(input.confirmedPermissionIds?.length)) {
      throw new ApiError(409, "turn_requires_retry", "This failed turn requires an explicit retry.");
    }
    retryAssistantMessage(input.conversation.id, input.clientMessageId);
  }

  let session =
    preparedBranchSession ??
    (await resolveConversationRuntime({
      conversation: input.conversation,
      surface: input.surface,
      activeGardenSlug: context.activeGardenSlug ?? null,
      activePageSlug: context.activePageSlug ?? null,
    }));
  annotateConversationTurn({
    conversationId: input.conversation.id,
    clientMessageId: input.clientMessageId,
    metadata: {
      activeGardenId: session.row.cluster_id,
      activeGardenSlug: session.row.garden_id,
      activePageSlug: session.row.page_slug,
    },
  });

  // An occupied run slot means one of two very different things. A run with a
  // beating pump is a turn genuinely in flight and this send has to wait for
  // it; a run whose pump died is debris that would otherwise reject every
  // future message in this conversation, so it is closed out here instead.
  reclaimAbandonedRunForSession(session.row.id);
  const activeRun = getActiveRuntimeRun(session.row.id);
  if (activeRun) {
    failAssistantMessage({
      conversationId: input.conversation.id,
      clientMessageId: input.clientMessageId,
      status: "failed",
      error: "runtime_run_already_active",
    });
    throw new ApiError(
      409,
      "run_already_active",
      "This chat is still working on the previous message. Stop it or wait for it to finish.",
    );
  }

  // Hybrid: the deterministic lexical ranking, fused with mem0 semantic
  // recall when that layer is available. Falls back to lexical-only silently.
  const memory = await loadConversationMemoryBundleHybrid({
    conversation: reservation.conversation,
    query: input.text,
    activeGardenId: session.row.cluster_id,
    projectScopeId: "breadboard",
  });
  const currentConversationMessages =
    input.branchHistory ??
    memory.recentMessages.filter(
      (message) => message.client_message_id !== input.clientMessageId,
    );
  const priorRequests = currentConversationMessages
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => message.content);
  let resolvedResources = resolveVerifiedFilesystemReferences(
    input.text,
    currentConversationMessages,
  );
  let referenceSource: "current_chat" | "cross_chat" | null =
    resolvedResources.length > 0 ? "current_chat" : null;
  if (resolvedResources.length === 0 && memory.crossConversation) {
    resolvedResources = resolveVerifiedCrossChatFilesystemReferences(
      input.text,
      memory.crossConversation.messages,
    );
    if (resolvedResources.length > 0) referenceSource = "cross_chat";
  }
  if (resolvedResources.length > 0) {
    annotateConversationTurn({
      conversationId: input.conversation.id,
      clientMessageId: input.clientMessageId,
      metadata: {
        resolvedFilesystemReferences: resolvedResources.map((resource) =>
          resource.value),
        resolvedFilesystemReferenceSource: referenceSource,
        ...(referenceSource === "cross_chat" && memory.crossConversation
          ? {
              resolvedFilesystemSourceConversationId:
                memory.crossConversation.publicId,
            }
          : {}),
      },
    });
  }
  const prepared = prepareTurn({
    request: input.text,
    priorRequests,
    resolvedResources,
    surface: input.surface,
    userId: input.conversation.user_id,
    grants: listFilesystemGrants(input.conversation.user_id),
    workspaceRoot: session.activeDirectory,
    confirmedPermissionIds: input.confirmedPermissionIds,
    // WhatsApp and Telegram cannot surface Hermes's native approval request.
    // Withholding the executor here makes any attempted fallback fail at the
    // capability boundary immediately instead of waiting five minutes.
    interactiveApprovals: !context.deliveryChannel,
    superAgent: input.superAgent === true,
  });
  const missingFilesystemTarget = prepared.pendingPermissions.some(
    (permission) =>
      permission.kind === "filesystem" && !permission.path?.trim(),
  );
  if (prepared.blocked && missingFilesystemTarget) {
    const message = hasFilesystemReferenceIntent(input.text)
      ? "I couldn't identify exactly which verified file or files you mean. Name the file, its list number, or paste the full path; if it was in another chat, identify that chat explicitly."
      : "Which folder should I inspect? Name a folder such as Downloads or Documents, or paste its full path.";
    markStatus(session, "idle");
    completeAssistantMessage({
      conversationId: input.conversation.id,
      clientMessageId: input.clientMessageId,
      content: message,
      metadata: { clarification: "filesystem_target_required" },
    });
    scheduleMemoryProfileSynthesisForConversation({
      conversationId: input.conversation.id,
      outcome: "completed",
    });
    return {
      accepted: false,
      clarified: true,
      session,
      message,
    };
  }
  const decision = prepared.decision;
  const premortemSelection = premortemCommandText({
    text: input.text,
    surface: input.surface,
    authenticated: true,
    priorMessages: currentConversationMessages,
  });
  const visualizerSelection = visualizerCommandText({
    text: premortemSelection.text,
    surface: input.surface,
    authenticated: true,
    priorMessages: currentConversationMessages,
  });
  const agentLoopSelection = agentLoopCommandText({
    text: visualizerSelection.text,
    surface: input.surface,
    authenticated: true,
    priorMessages: currentConversationMessages,
  });
  // A video is unreadable without Watch, so a turn carrying one selects the
  // skill itself. The video may also have arrived a question or two ago: a
  // follow-up about the same file is still a question about a video.
  const turnVideos = videoAttachments(input.attachments);
  const carriedVideo = turnVideos.length === 0
    ? recentVideoAttachment(
        memory.recentMessages.filter(
          (message) => message.client_message_id !== input.clientMessageId,
        ),
      )
    : null;
  const watchSelection = watchCommandText({
    text: agentLoopSelection.text,
    surface: input.surface,
    authenticated: true,
    hasVideoAttachment: turnVideos.length > 0,
    hasRecentVideoAttachment: Boolean(carriedVideo),
  });
  // A picture, unlike a video, is usually not the subject of the turn — people
  // paste screenshots to ask what is wrong with them. So this selection needs
  // the request to actually ask for a three-dimensional thing, and a picture
  // from an earlier message counts because "now make it a quad mesh" arrives
  // with no attachment of its own.
  // Asked without decoding anything: this runs on every turn, and a
  // conversation carrying a few screenshots would otherwise base64-decode
  // megabytes per message only to compare a count against zero.
  const earlierMessages = memory.recentMessages.filter(
    (message) => message.client_message_id !== input.clientMessageId,
  );
  const imageTo3dSelection = imageTo3dCommandText({
    text: watchSelection.text,
    surface: input.surface,
    authenticated: true,
    hasImageAttachment: hasReconstructableAttachment(input.attachments),
    hasRecentImageAttachment: hasReconstructableImages(earlierMessages),
  });
  // An attached song, unlike an attached picture, is nearly always the subject
  // of the turn — so this reads like Watch rather than like Image to 3D: the
  // track selects the skill unless the words say the file is being handled
  // rather than listened to. A track from an earlier message counts too,
  // because "and what about the chorus?" arrives with no attachment.
  const audioSelection = audioAnalysisCommandText({
    text: imageTo3dSelection.text,
    surface: input.surface,
    authenticated: true,
    hasAudioAttachment: hasAnalyzableAttachment(input.attachments),
    hasRecentAudioAttachment: hasRecentAnalyzableAudio(earlierMessages),
  });
  // Last in the chain on purpose: "send this to my WhatsApp" is an errand
  // attached to whatever the turn was already about, so any skill that claimed
  // the turn on its own wording keeps it.
  const messagingSelection = messagingCommandText({
    text: audioSelection.text,
    surface: input.surface,
    authenticated: true,
    priorMessages: currentConversationMessages,
  });
  const commandContext = {
    mode: decision.mode,
    surface: input.surface,
    runtimeKind: session.runtimeKind,
    activeAgentSlug: reservation.conversation.active_agency_agent_slug,
  };
  // An automatic selection must never cost the user their turn: if Watch or
  // Image to 3D turns out to be unavailable here — no Python, no ffmpeg, no
  // GPU, not approved for this mode — the same message is resolved again
  // without it. Retrying from the agent-loop text drops both, which is correct
  // because neither adds a prefix unless it selected automatically.
  const resolved = await resolveCommandMessage(
    input.conversation.user_id,
    messagingSelection.text,
    session.activeDirectory,
    commandContext,
  ).catch(async (error: unknown) => {
    if (
      !watchSelection.automatic &&
      !imageTo3dSelection.automatic &&
      !audioSelection.automatic
    ) {
      throw error;
    }
    return await resolveCommandMessage(
      input.conversation.user_id,
      messagingCommandText({
        text: agentLoopSelection.text,
        surface: input.surface,
        authenticated: true,
        priorMessages: currentConversationMessages,
      }).text,
      session.activeDirectory,
      commandContext,
    );
  });
  // Whether the automatic selection actually took: the fallback above may have
  // resolved the same message without it.
  const automaticWatch = watchSelection.automatic &&
    resolved.invocations.some(
      (invocation) => invocation.kind === "skill" && invocation.slug === "watch",
    );
  const automaticImageTo3d = imageTo3dSelection.automatic &&
    resolved.invocations.some(
      (invocation) => invocation.kind === "skill" && invocation.slug === IMAGE_TO_3D_SKILL,
    );
  const automaticAudioAnalysis = audioSelection.automatic &&
    resolved.invocations.some(
      (invocation) => invocation.kind === "skill" && invocation.slug === AUDIO_ANALYSIS_SKILL,
    );
  let turnConversation = reservation.conversation;
  let activeAgencyAgent: AgencyAgentDefinition | null = null;
  if (resolved.agencyAgentSelection?.action === "clear") {
    turnConversation = updateConversation(turnConversation, {
      activeAgencyAgentSlug: null,
    });
  } else if (resolved.agencyAgentSelection?.action === "set") {
    turnConversation = updateConversation(turnConversation, {
      activeAgencyAgentSlug: resolved.agencyAgentSelection.slug,
    });
    activeAgencyAgent = findAgencyAgent(resolved.agencyAgentSelection.slug);
  } else if (turnConversation.active_agency_agent_slug) {
    activeAgencyAgent = findAgencyAgent(turnConversation.active_agency_agent_slug);
    if (!activeAgencyAgent) {
      turnConversation = updateConversation(turnConversation, {
        activeAgencyAgentSlug: null,
      });
    }
  }
  annotateConversationTurn({
    conversationId: input.conversation.id,
    clientMessageId: input.clientMessageId,
    metadata: {
      commands: resolved.invocations,
      automaticPremortem: premortemSelection.automatic,
      automaticInteractiveVisualizer: visualizerSelection.automatic,
      automaticMessaging: messagingSelection.automatic,
      automaticWatch,
      automaticImageTo3d,
      automaticAudioAnalysis,
      activeAgencyAgentSlug: activeAgencyAgent?.slug ?? null,
    },
  });
  if (resolved.agencyAgentSelection) {
    recordAuditEvent({
      eventType: resolved.agencyAgentSelection.action === "set"
        ? "conversation.agency_agent_selected"
        : "conversation.agency_agent_cleared",
      runtimeSessionId: session.row.id,
      userId: input.conversation.user_id,
      gardenId: session.row.garden_id,
      payload: {
        conversationPublicId: input.conversation.public_id,
        slug: activeAgencyAgent?.slug ?? null,
      },
    });
  }
  decision.selectedConditionalSkills = resolved.invocations
    .filter((invocation) => invocation.kind === "skill")
    .map((invocation) => invocation.slug);
  decision.selectedConnections = resolved.invocations
    .filter((invocation) => invocation.kind === "mcp")
    .map((invocation) => invocation.slug);
  // A super-agent turn selects the whole inventory rather than the one thing the
  // user named. That is what unlocks the skill-gated first-party tools — each of
  // their routes checks that its own skill is selected for the turn — and what
  // lets the directive below offer those skills at all.
  const superAgent = input.superAgent === true;
  const superAgentInventory: SuperAgentInventory | null = superAgent
    ? await loadSuperAgentInventory({
        userId: input.conversation.user_id,
        surface: input.surface,
      })
    : null;
  if (superAgentInventory) {
    decision.selectedConditionalSkills = [
      ...new Set([
        ...decision.selectedConditionalSkills,
        ...superAgentInventory.skillSlugs,
      ]),
    ];
    decision.selectedConnections = [
      ...new Set([
        ...decision.selectedConnections,
        ...superAgentInventory.connections,
      ]),
    ];
  }
  // Goal Mode is explicitly selected by the person for this message. It starts
  // from the task they sent, after command tokens have been stripped, and then
  // remains bound to this conversation only. The state bridge is local and
  // deterministic; it never launches the cloned server in the request path.
  const goalMode = input.goalMode === true && input.surface !== "quartz_ai";
  let goalModeState: GoalModeState | null = null;
  if (goalMode) {
    try {
      goalModeState = activateGoalMode({
        conversationPublicId: input.conversation.public_id,
        objective: resolved.userText || input.text,
      });
      decision.allowedTools = [...new Set([...decision.allowedTools, "mcp_call"])];
      decision.selectedConnections = [
        ...new Set([...decision.selectedConnections, GOAL_MODE_CONNECTION]),
      ];
    } catch (error) {
      // A malformed / oversized objective must not make an otherwise valid
      // chat turn disappear. The normal task runs, without Goal Mode context,
      // and the audit trail exposes why activation was unavailable.
      recordAuditEvent({
        eventType: "goal_mode.activation_failed",
        runtimeSessionId: session.row.id,
        userId: input.conversation.user_id,
        gardenId: session.row.garden_id,
        payload: {
          conversationPublicId: input.conversation.public_id,
          message: error instanceof Error ? error.message.slice(0, 300) : "goal_mode_activation_failed",
        },
      });
    }
  }
  const engine = resolveHermesEngine(input.model, input.reasoningEffort);
  const runtime = getAgentRuntimeByKind(session.runtimeKind);
  const connectedApps =
    input.surface === "quartz_ai"
      ? {
          connectionNames: [],
          tools: {},
          systemContext: "",
          toolCount: 0,
        }
      : await connectedAppRegistryForTurn({
          runtime,
          directory: session.activeDirectory,
          userId: input.conversation.user_id,
          mode: decision.mode,
          // The user asked for every connection to be on the table. Writes are
          // unaffected: each one still pauses for their approval at call time.
          allowAllConnectionTools: superAgent,
        });
  decision.selectedConnections = [
    ...new Set([
      ...decision.selectedConnections,
      ...connectedApps.connectionNames,
    ]),
  ];

  await runtime.applyCapabilityDecision({
    externalSessionId: session.externalSessionId,
    liveSessionId: session.liveSessionId,
    workspaceKey: session.workspaceKey,
    directory: session.activeDirectory,
    decision,
  });
  const storedDecision = persistCapabilityDecision(session.row.id, decision);
  scheduleCapabilityExpiry(session, decision, storedDecision.id);
  recordAuditEvent({
    eventType: "conversation.capability_decision",
    runtimeSessionId: session.row.id,
    userId: input.conversation.user_id,
    gardenId: session.row.garden_id,
    payload: {
      conversationPublicId: input.conversation.public_id,
      decisionId: storedDecision.id,
      mode: decision.mode,
      superAgent,
      goalMode: Boolean(goalModeState),
      yoloMode: input.yoloMode === true,
      ...(superAgentInventory
        ? {
            superAgentSkillCount: superAgentInventory.skillSlugs.length,
            superAgentWorkflowCount: superAgentInventory.workflows.length,
          }
        : {}),
      allowedTools: decision.allowedTools,
      automaticPremortem: premortemSelection.automatic,
      automaticInteractiveVisualizer: visualizerSelection.automatic,
      automaticWatch,
      automaticImageTo3d,
      allowedGardenIds: parseAllowedGardenIds(session.row.allowed_garden_ids),
      connectedAppToolCount: connectedApps.toolCount,
    },
  });

  if (prepared.blocked) {
    markStatus(session, "idle");
    failAssistantMessage({
      conversationId: input.conversation.id,
      clientMessageId: input.clientMessageId,
      status: "failed",
      error: "awaiting_permission",
      metadata: { pendingPermissions: prepared.pendingPermissions },
    });
    return {
      accepted: false,
      blocked: true,
      session,
      reason: "awaiting_permission",
      plan: {
        intendedOutcome: prepared.plan.intendedOutcome,
        steps: prepared.plan.steps.map((step) => step.description),
        riskLevel: prepared.plan.riskLevel,
      },
      pendingPermissions: prepared.pendingPermissions,
      request: input.text,
    };
  }

  if (input.retry || (input.confirmedPermissionIds?.length ?? 0) > 0) {
    recordAuditEvent({
      eventType: "task.resumed",
      runtimeSessionId: session.row.id,
      userId: input.conversation.user_id,
      gardenId: session.row.garden_id,
      payload: {
        conversationPublicId: input.conversation.public_id,
        clientMessageId: input.clientMessageId,
        confirmedPermissionIds: input.confirmedPermissionIds ?? [],
      },
    });
  }

  // Garden Chat and Terminal now save memory through the explicit `save_memory`
  // tool (which surfaces a "Memory updated" chip and can resolve pronouns), so
  // the silent regex extractor is only a fallback for surfaces without it. This
  // prevents a double write and a badge-less silent save on "remember X".
  if (
    resolved.userText.trim() &&
    input.surface !== "garden_chat" &&
    input.surface !== "dashboard_terminal"
  ) {
    maintainDurableMemoryFromUserTurn({
      conversation: turnConversation,
      content: resolved.userText,
      activeGardenId: session.row.cluster_id,
    });
  }
  const gardenGrounding: TerminalGardenGrounding =
    input.surface === "dashboard_terminal"
      ? await retrieveTerminalGardenGrounding({
          userId: input.conversation.user_id,
          request: resolved.userText || input.text,
          plan: prepared.plan,
          hasAttachments: Boolean(input.attachments?.length),
        })
      : { attempted: false, sources: [], context: "" };
  if (gardenGrounding.attempted) {
    annotateConversationTurn({
      conversationId: input.conversation.id,
      clientMessageId: input.clientMessageId,
      metadata: {
        gardenGroundingAttempted: true,
        gardenGroundingSourceCount: gardenGrounding.sources.length,
        gardenGroundingSources: gardenGrounding.sources.map((source) => ({
          title: source.title,
          gardenName: source.gardenName,
          gardenSlug: source.gardenSlug,
          pageSlug: source.pageSlug,
          location: source.location,
        })),
        ...(gardenGrounding.warning
          ? { gardenGroundingWarning: gardenGrounding.warning }
          : {}),
      },
    });
  }
  // Documents big enough to crowd out the conversation are distilled into
  // book-to-skill skills first, and enter the turn as a structured index the
  // model reads on demand. Anything smaller keeps travelling verbatim.
  const documents = await prepareDocumentContext({
    userId: input.conversation.user_id,
    attachments: input.attachments,
  });
  // A linked video is fetched only once Watch is actually going to open it, and
  // into the same store an attached one lives in — so the copy is shared with
  // every later mention, including an edit, instead of Watch downloading its own
  // and throwing it away.
  //
  // Bounded, because this runs before the turn is dispatched: past the budget
  // the fetch keeps going in the background to fill the cache, and this turn
  // falls back to handing Watch the URL, which it already knows how to open.
  const linkedVideo =
    decision.selectedConditionalSkills.includes("watch") &&
    turnVideos.length === 0 &&
    !carriedVideo
      ? await fetchLinkedVideoForWatch({
          userId: input.conversation.user_id,
          text: resolved.userText || input.text,
        })
      : null;
  // Only once the skill is actually in play — by its own wording, by the user
  // typing /watch, or by super agent selecting everything. Linking gigabytes
  // into the workspace for a turn that will never open them is pure cost.
  const preparedVideos = decision.selectedConditionalSkills.includes("watch")
    ? prepareVideosForWatch({
        userId: input.conversation.user_id,
        workspaceRoot: session.activeDirectory,
        attachments:
          turnVideos.length > 0
            ? turnVideos
            : carriedVideo
              ? [carriedVideo]
              : linkedVideo
                ? [linkedVideo]
                : [],
        carriedForward: turnVideos.length === 0 && !linkedVideo,
      })
    : [];
  const tools = mergeSelectedTools(prepared.grant.allowedTools, {
    ...resolved.tools,
    ...connectedApps.tools,
    ...(goalModeState ? { mcp_call: true } : {}),
  });
  // Whether this turn needs verified map data is decided here, before dispatch,
  // from the request and Breadboard's own geographic state — never from what the
  // model later writes. The decision travels on the run, so the finished answer
  // is judged against an obligation it could not talk itself out of. See
  // lib/map/grounding.ts.
  const geographicGrounding =
    input.internalAgentContinuation
      ? {
          required: false,
          asks: [],
          reason: "trusted model-to-model continuation, not a user location request",
        }
      : tools.map_search === true
      ? requiresGeographicGroundingInContext(
          resolved.userText || input.text,
          readGeographicContext({
            userId: input.conversation.user_id,
            conversationId: input.conversation.id,
          }),
          priorRequests,
        )
      : { required: false, asks: [], reason: "map tools not available" };
  const baseSystem = composeHermesSystemPrompt({
    surface: input.surface,
    decision,
    userText: resolved.userText || input.text,
    conversationPublicId: input.conversation.public_id,
    adhdMode: input.adhdMode === true,
    goalMode: goalModeState,
    additional: [
      superAgentInventory ? renderSuperAgentDirective(superAgentInventory) : "",
      composeMemoryContext(
        memory,
        input.branchHistory
          ? {
              recentMessages: input.branchHistory,
              includeConversationState: false,
            }
          : undefined,
      ),
      renderResolvedFilesystemContext(resolvedResources, referenceSource),
      gardenGrounding.context,
      renderGeographicGroundingDirective(geographicGrounding),
      renderWatchVideoContext(preparedVideos),
      // Only when the skill is actually in play. The block names an exact
      // `image_to_3d` argument, and offering that vocabulary on a turn that
      // cannot call the tool is how a model ends up promising a mesh it has no
      // way to produce.
      decision.selectedConditionalSkills.includes(IMAGE_TO_3D_SKILL)
        ? renderImageTo3dContext(
            mergeImages(
              reconstructableFromAttachments(input.attachments),
              reconstructableImages(earlierMessages).map((image) => ({
                ...image,
                carriedForward: true,
              })),
            ),
          )
        : "",
      // Only when the skill is actually in play, for the same reason the 3D
      // block is: it names exact `audio_analyze` arguments, and offering that
      // vocabulary on a turn that cannot call the tool is how a model ends up
      // promising an analysis it has no way to run.
      decision.selectedConditionalSkills.includes(AUDIO_ANALYSIS_SKILL)
        ? renderAudioAnalysisContext(
            mergeTracks(
              tracksFromAttachments(input.conversation.user_id, input.attachments),
              analyzableTracks(input.conversation.user_id, earlierMessages).map((track) => ({
                ...track,
                carriedForward: true,
              })),
            ),
          )
        : "",
      documents.context,
      connectedApps.systemContext,
      authorizedGardenContext(input.conversation.user_id, session.row.garden_id),
      renderSurfaceContext(input.surface, context),
      renderDeliveryChannel(context.deliveryChannel),
    ].filter(Boolean).join("\n\n"),
    persona: activeAgencyAgent
      ? activeAgencyAgent.slug === CHIEF_OF_STAFF_SLUG
        ? `${renderAgencyAgentPersona(activeAgencyAgent)}\n\n${renderChiefOfStaffOrchestration(loadAgencyAgentsCatalog())}`
        : activeAgencyAgent.slug === ARIS_AGENT_SLUG
          ? `${renderAgencyAgentPersona(activeAgencyAgent)}\n\n${renderArisTurnGuidance(resolved.userText || input.text)}`
          : renderAgencyAgentPersona(activeAgencyAgent)
      : undefined,
  });
  const currentLocationContext = input.internalAgentContinuation
    ? ""
    : renderCurrentLocationContext({
        request: resolved.userText || input.text,
        priorRequests,
        location: input.currentLocation,
      });
  // The same coarse fix, put where the map tools can reach it. Without this,
  // "what's near me" has no anchor unless the /map page happens to be open —
  // and an agent with no anchor and a geographic question is exactly the
  // situation this whole feature exists to prevent. It is written only when
  // renderCurrentLocationContext already decided this request uses location, so
  // an unrelated turn never records where the user is, and the next fix
  // replaces it rather than accumulating a trail.
  if (currentLocationContext && tools.map_search === true) {
    const snapshot = parseCurrentLocationPayload(input.currentLocation);
    if (snapshot) {
      recordCurrentLocation(
        { userId: input.conversation.user_id, conversationId: input.conversation.id },
        {
          lat: snapshot.latitude,
          lon: snapshot.longitude,
          accuracyMeters: snapshot.accuracyMeters,
          source: "device",
          capturedAt: snapshot.capturedAt,
        },
      );
    }
  }
  // Coordinates are useful for this one answer, not durable conversation
  // state. Persist only the location-free prompt so recovery, audit, and memory
  // cannot silently replay where the user was.
  const runtimeSystem = currentLocationContext
    ? `${baseSystem}\n\n${currentLocationContext}`
    : baseSystem;
  const defaultRuntimeText =
    resolved.text ||
    "Acknowledge the persona selection briefly and ask how you can help.";
  const runtimeText = input.textSelection
    ? chatTextSelectionQuestionPrompt(defaultRuntimeText, input.textSelection)
    : defaultRuntimeText;
  const requiredVisualizerSkill = selectedInteractiveVisualizerSkill(
    new Set(
      resolved.invocations
        .filter((invocation) => invocation.kind === "skill")
        .map((invocation) => invocation.slug),
    ),
  );
  const run = beginRuntimeRun({
    runtimeSessionId: session.row.id,
    instruction: resolved.userText || input.text,
    dispatch: {
      conversationPublicId: input.conversation.public_id,
      clientMessageId: input.clientMessageId,
      runtimeText,
      model: engine.model,
      modelIdentity: { modelID: engine.selectedModelID },
      variant: engine.variant,
      tools,
      system: baseSystem,
      ...(goalModeState
        ? {
            goalMode: {
              goalId: goalModeState.goal_id,
              enabled: true,
            },
          }
        : {}),
      ...(requiredVisualizerSkill
        ? {
            requiredArtifacts: [
              {
                kind: "html",
                rendererId: "interactive-visualizer",
                sourceSkill: requiredVisualizerSkill,
                readyEventType: "artifact.completed",
                previewRequired: true,
              },
            ],
          }
        : {}),
      ...(gardenGrounding.attempted
        ? {
            gardenGrounding: {
              attempted: true,
              sources: gardenGrounding.sources,
              lexicalUsed: gardenGrounding.lexicalUsed,
              semanticUsed: gardenGrounding.semanticUsed,
              warning: gardenGrounding.warning,
            },
          }
        : {}),
      ...(geographicGrounding.required
        ? {
            geographicGrounding: {
              required: true,
              asks: geographicGrounding.asks,
              reason: geographicGrounding.reason,
            },
          }
        : {}),
      ...(!input.internalAgentContinuation &&
      prepared.plan.requiredCapabilities.includes("web_research")
        ? {
            webGrounding: {
              required: true,
              reason: "The deterministic task plan requires current external evidence.",
            },
          }
        : {}),
    },
  });
  markStatus(session, "busy");

  const dispatch = async (target: AuthorizedRuntimeSession) => {
    await getAgentRuntimeByKind(target.runtimeKind).startRun({
      externalSessionId: target.externalSessionId,
      liveSessionId: target.liveSessionId,
      workspaceKey: target.workspaceKey,
      directory: target.activeDirectory,
      agentName: target.agentName,
      text: runtimeText,
      // Only what was not distilled: a document that became a skill is already
      // in the system prompt as an index, and re-sending its raw text would
      // undo the saving the skill exists for.
      attachments: documents.inlineAttachments,
      tools,
      model: engine.model,
      modelIdentity: { modelID: engine.selectedModelID },
      variant: engine.variant,
      system: runtimeSystem,
      messageId: hermesMessageId(input.clientMessageId),
      yoloMode: input.yoloMode === true,
    });
  };

  try {
    await dispatch(session);
  } catch (firstError) {
    try {
      session = await resolveConversationRuntime({
        conversation: input.conversation,
        surface: input.surface,
        activeGardenSlug: context.activeGardenSlug ?? null,
        activePageSlug: context.activePageSlug ?? null,
        forceRecreate: true,
        historyOverride: input.branchHistory
          ? runtimeMessagesForBranch(input.branchHistory)
          : undefined,
        branchContextId: input.branchContextId,
      });
      await getAgentRuntimeByKind(session.runtimeKind).applyCapabilityDecision({
        externalSessionId: session.externalSessionId,
        liveSessionId: session.liveSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
        decision,
      });
      await dispatch(session);
    } catch (retryError) {
      finishRuntimeRun(run.id, "error");
      markStatus(session, "failed");
      failAssistantMessage({
        conversationId: input.conversation.id,
        clientMessageId: input.clientMessageId,
        status: "failed",
        error: retryError instanceof Error ? retryError.message : "runtime_dispatch_failed",
      });
      throw firstError;
    }
  }

  markRuntimeRunSubmitted(run.id);

  recordAuditEvent({
    eventType: "conversation.message_submitted",
    runtimeSessionId: session.row.id,
    userId: input.conversation.user_id,
    gardenId: session.row.garden_id,
    payload: {
      conversationPublicId: input.conversation.public_id,
      clientMessageId: input.clientMessageId,
      surface: input.surface,
      modelId: engine.model.modelID,
      reasoningEffort: engine.variant,
    },
  });
  return {
    accepted: true,
    session,
    run,
    userMessage: reservation.userMessage,
    replayed: !reservation.isNew,
    capability: { mode: decision.mode, expiresAt: decision.expiresAt, decisionId: storedDecision.id },
  };
}

function runtimeBranchContextId(
  session: AuthorizedRuntimeSession,
): string | null {
  try {
    if (!session.row.runtime_metadata) return null;
    const metadata = JSON.parse(session.row.runtime_metadata) as unknown;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }
    const value = (metadata as Record<string, unknown>).branchContextId;
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function renderResolvedFilesystemContext(
  resources: readonly { value: string; resourceType?: "file" | "directory" }[],
  source: "current_chat" | "cross_chat" | null,
): string {
  if (resources.length === 0) return "";
  const targets = resources.map((resource) => resource.value);
  const destructiveInstructions = targets.every((target) =>
    resources.find((resource) => resource.value === target)?.resourceType === "file")
    ? [
        "For a deletion request, these are the complete candidate files after applying the user's selections and exclusions.",
        "Never delete, move, rename, or overwrite a path outside this exact list.",
        process.platform === "win32"
          ? "Delete one approved file per terminal call with Remove-Item -LiteralPath '<exact path>'."
          : "Delete one approved file per terminal call with rm -- '<exact path>'.",
      ]
    : [];
  return [
    "# server_resolved_filesystem_scope",
    `Reference source: ${source ?? "server"}`,
    ...targets.map((target) => `- ${target}`),
    "These paths are server-resolved context, not authority; the active capability grant remains mandatory.",
    ...destructiveInstructions,
  ].join("\n");
}

function normalizeSurfaceContext(value: ConversationSurfaceContext | undefined): ConversationSurfaceContext {
  if (!value) return {};
  return {
    activeGardenSlug: bounded(value.activeGardenSlug, 160),
    activePageSlug: bounded(value.activePageSlug, 500),
    pageTitle: bounded(value.pageTitle, 500),
    selectedText: bounded(value.selectedText, 4_000),
    selectedDocumentIds: Array.isArray(value.selectedDocumentIds)
      ? value.selectedDocumentIds.filter((item): item is string => typeof item === "string")
          .slice(0, 20).map((item) => item.slice(0, 300))
      : undefined,
    graphContext: value.graphContext,
    authorizedContext: bounded(value.authorizedContext, 20_000),
    deliveryChannel: DELIVERY_CHANNELS.includes(value.deliveryChannel as DeliveryChannel)
      ? value.deliveryChannel
      : undefined,
  };
}

function renderSurfaceContext(surface: HermesSurface, context: ConversationSurfaceContext): string {
  const lines = [
    "# active_surface_context",
    `Surface: ${surface}`,
    `Active Garden: ${context.activeGardenSlug ?? "none"}`,
    `Active page: ${context.activePageSlug ?? "none"}`,
    context.pageTitle ? `Page title: ${context.pageTitle}` : "",
    context.selectedText ? `Current selection:\n${context.selectedText}` : "",
    context.selectedDocumentIds?.length ? `Selected document ids: ${context.selectedDocumentIds.join(", ")}` : "",
    context.graphContext ? `Bounded graph interaction:\n${JSON.stringify(context.graphContext).slice(0, 8_000)}` : "",
    context.authorizedContext ?? "",
    "This section is replaced on every turn. 'none' means no prior Garden/page remains active.",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Tell the agent it is answering into a messaging app rather than the
 * Breadboard window.
 *
 * Without this the turn looks like any other Terminal chat, so the answer comes
 * back shaped for a desktop transcript: markdown headings and tables that
 * WhatsApp renders as literal asterisks and pipes, an offer to open a file the
 * reader cannot see, a length no one scrolls on a phone. None of that is a
 * capability question — the constraints are entirely about where the text
 * lands, so they are stated as fact and kept out of the capability grant.
 */
function renderDeliveryChannel(channel: DeliveryChannel | undefined): string {
  if (!channel) return "";
  const app = channel === "whatsapp" ? "WhatsApp" : "Telegram";
  const formatting =
    channel === "whatsapp"
      ? "WhatsApp understands *bold*, _italic_, ~strikethrough~ and ```code```. It has no headings, tables, bullet syntax or links, so write those as plain sentences."
      : "Telegram understands *bold*, _italic_ and `code`. It has no headings or tables, so write those as plain sentences.";
  return [
    "# delivery_channel",
    `This answer is sent to the person as a ${app} message on their phone. It is not shown in the Breadboard window.`,
    "Only your final text is delivered. Your reasoning, tool calls and any status you would normally show alongside the answer are not visible there.",
    formatting,
    "Keep it to what reads well on a phone: a few short paragraphs. Anything past about 4000 characters is cut off mid-sentence.",
    "You cannot ask for a permission decision here. A turn that needs one is refused before it reaches you.",
    "The same chat is open in the Breadboard app, so anything genuinely long or visual belongs there; say so rather than trying to fit it into a message.",
  ].join("\n");
}

function authorizedGardenContext(userId: number, activeGardenSlug: string | null): string {
  const gardens = listAuthorizedGardens(userId);
  return [
    "# server_authorized_gardens",
    `Active Garden relevance hint: ${activeGardenSlug ?? "none"}`,
    gardens.length
      ? gardens.map((garden) => `- ${garden.slug} (${garden.name}; id=${garden.id}; ${garden.isOwner ? "owned" : "public"})`).join("\n")
      : "No Gardens are currently authorized.",
    "This list describes retrieval scope only. It does not authorize mutations.",
  ].join("\n");
}

function parseAllowedGardenIds(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is number => Number.isInteger(item)) : [];
  } catch {
    return [];
  }
}

function bounded(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/**
 * How long a turn will wait for a linked video before dispatching without it.
 *
 * Past this the fetch is not cancelled — it keeps running and fills the cache,
 * so the next mention of the same video, or an edit of it, is instant. This turn
 * simply stops waiting, because a chat that sits silent for minutes reads as a
 * hang no matter what it is doing.
 */
const LINKED_VIDEO_BUDGET_MS = 60_000;

async function fetchLinkedVideoForWatch(input: {
  userId: number;
  text: string;
}): Promise<VideoAttachment | null> {
  const source = firstVideoSource(input.text);
  if (!source) return null;

  const asAttachment = (resolved: { blob: { blobId: string; format: VideoAttachmentFormat; byteSize: number }; title: string }): VideoAttachment => ({
    type: "video",
    name: `${resolved.title || source.label}.${resolved.blob.format}`,
    blobId: resolved.blob.blobId,
    format: resolved.blob.format,
    sizeBytes: resolved.blob.byteSize,
  });

  // Already here: no wait at all, which is the common case once a conversation
  // is about one video.
  const cached = cachedVideoSource(input.userId, source);
  if (cached) return asAttachment(cached);

  try {
    const fetching = ensureVideoSource({ userId: input.userId, source });
    // The loser of this race is deliberately left running.
    const budget = new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), LINKED_VIDEO_BUDGET_MS);
      timer.unref?.();
    });
    const resolved = await Promise.race([fetching, budget]);
    return resolved ? asAttachment(resolved) : null;
  } catch {
    // A link that cannot be fetched is not a turn that should fail: Watch can
    // still try the URL itself, and says so plainly when it cannot.
    return null;
  }
}

function asApiError(error: unknown): unknown {
  return error instanceof ConversationStoreError
    ? new ApiError(error.status, error.code, error.message)
    : error;
}
