import type { ChatAttachment } from "../chat-attachments.ts";
import { resolveCommandMessage } from "../openharness/commands.ts";
import { prepareTurn, mergeSelectedTools } from "../openharness/dispatch-core.ts";
import { listFilesystemGrants } from "../openharness/filesystem-grant-store.ts";
import { getAgentRuntimeByKind } from "../agent-runtime/runtime.ts";
import { openHarnessMessageId } from "../openharness/message-id.ts";
import { resolveOpenHarnessEngine } from "../openharness/model-selection.ts";
import {
  beginRuntimeRun,
  finishRuntimeRun,
  getActiveRuntimeRun,
  type RuntimeRunRow,
} from "../openharness/run-store.ts";
import {
  listAuthorizedGardens,
  authorizeConversationRuntime,
  markStatus,
  resolveConversationRuntime,
  type AuthorizedRuntimeSession,
} from "../openharness/session-service.ts";
import {
  persistCapabilityDecision,
  recordAuditEvent,
} from "../openharness/runtime-store.ts";
import { scheduleCapabilityExpiry } from "../openharness/capability-lifecycle.ts";
import { composeOpenHarnessSystemPrompt } from "../openharness/system-prompts.ts";
import { ApiError } from "../openharness/route-helpers.ts";
import type { OpenHarnessSurface } from "../openharness/config.ts";
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
import {
  composeMemoryContext,
  loadConversationMemoryBundle,
  maintainDurableMemoryFromUserTurn,
} from "./memory.ts";
import {
  findAgencyAgent,
  renderAgencyAgentPersona,
  type AgencyAgentDefinition,
} from "../openharness/agency-agents.ts";
import {
  hasFilesystemReferenceIntent,
  resolveVerifiedCrossChatFilesystemReferences,
  resolveVerifiedFilesystemReferences,
} from "./reference-resolution.ts";

export interface ConversationSurfaceContext {
  activeGardenSlug?: string;
  activePageSlug?: string;
  pageTitle?: string;
  selectedText?: string;
  selectedDocumentIds?: string[];
  graphContext?: unknown;
  /** Server-assembled, authorized page context; never accepted from a browser. */
  authorizedContext?: string;
}

export interface StartConversationTurnInput {
  conversation: ConversationRow;
  clientMessageId: string;
  text: string;
  surface: OpenHarnessSurface;
  surfaceContext?: ConversationSurfaceContext;
  model?: unknown;
  reasoningEffort?: unknown;
  attachments?: ChatAttachment[];
  confirmedPermissionIds?: string[];
  retry?: boolean;
  branchGroupId?: string;
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
        ...(input.branchGroupId ? { branchGroupId: input.branchGroupId } : {}),
      },
    });
  } catch (error) {
    throw asApiError(error);
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

  let session = await resolveConversationRuntime({
    conversation: input.conversation,
    surface: input.surface,
    activeGardenSlug: context.activeGardenSlug ?? null,
    activePageSlug: context.activePageSlug ?? null,
  });
  annotateConversationTurn({
    conversationId: input.conversation.id,
    clientMessageId: input.clientMessageId,
    metadata: {
      activeGardenId: session.row.cluster_id,
      activeGardenSlug: session.row.garden_id,
      activePageSlug: session.row.page_slug,
    },
  });

  const activeRun = getActiveRuntimeRun(session.row.id);
  if (activeRun) {
    failAssistantMessage({
      conversationId: input.conversation.id,
      clientMessageId: input.clientMessageId,
      status: "failed",
      error: "runtime_run_already_active",
    });
    throw new ApiError(409, "run_already_active", "This conversation already has an active run.");
  }

  const memory = loadConversationMemoryBundle({
    conversation: reservation.conversation,
    query: input.text,
    activeGardenId: session.row.cluster_id,
    projectScopeId: "breadboard",
  });
  const currentConversationMessages = memory.recentMessages.filter(
    (message) => message.client_message_id !== input.clientMessageId,
  );
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
    priorRequests: memory.recentMessages
      .filter((message) => message.role === "user" && message.client_message_id !== input.clientMessageId)
      .slice(-8)
      .map((message) => message.content),
    resolvedResources,
    surface: input.surface,
    userId: input.conversation.user_id,
    grants: listFilesystemGrants(input.conversation.user_id),
    workspaceRoot: session.activeDirectory,
    confirmedPermissionIds: input.confirmedPermissionIds,
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
    return {
      accepted: false,
      clarified: true,
      session,
      message,
    };
  }
  const decision = prepared.decision;
  const resolved = await resolveCommandMessage(
    input.conversation.user_id,
    input.text,
    session.activeDirectory,
    {
      mode: decision.mode,
      surface: input.surface,
      runtimeKind: session.runtimeKind,
    },
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
  const engine = resolveOpenHarnessEngine(input.model, input.reasoningEffort);

  await getAgentRuntimeByKind(session.runtimeKind).applyCapabilityDecision({
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
      allowedTools: decision.allowedTools,
      allowedGardenIds: parseAllowedGardenIds(session.row.allowed_garden_ids),
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

  if (resolved.userText.trim()) {
    maintainDurableMemoryFromUserTurn({
      conversation: turnConversation,
      content: resolved.userText,
      activeGardenId: session.row.cluster_id,
    });
  }
  if (turnConversation.title === "New chat" && resolved.userText.trim()) {
    turnConversation = updateConversation(turnConversation, {
      title: titleFromMessage(resolved.userText),
    });
  }

  const tools = mergeSelectedTools(prepared.grant.allowedTools, resolved.tools);
  const system = composeOpenHarnessSystemPrompt({
    surface: input.surface,
    decision,
    additional: [
      composeMemoryContext(memory),
      renderResolvedFilesystemContext(resolvedResources, referenceSource),
      authorizedGardenContext(input.conversation.user_id, session.row.garden_id),
      renderSurfaceContext(input.surface, context),
    ].filter(Boolean).join("\n\n"),
    persona: activeAgencyAgent
      ? renderAgencyAgentPersona(activeAgencyAgent)
      : undefined,
  });
  const run = beginRuntimeRun({
    runtimeSessionId: session.row.id,
    instruction: resolved.userText || input.text,
    dispatch: {
      conversationPublicId: input.conversation.public_id,
      clientMessageId: input.clientMessageId,
      runtimeText:
        resolved.text ||
        "Acknowledge the persona selection briefly and ask how you can help.",
      model: engine.model,
      variant: engine.variant,
      tools,
      system,
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
      text:
        resolved.text ||
        "Acknowledge the persona selection briefly and ask how you can help.",
      attachments: input.attachments,
      tools,
      model: engine.model,
      variant: engine.variant,
      system,
      messageId: openHarnessMessageId(input.clientMessageId),
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
  };
}

function renderSurfaceContext(surface: OpenHarnessSurface, context: ConversationSurfaceContext): string {
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

function titleFromMessage(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80) || "New chat";
}

function bounded(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function asApiError(error: unknown): unknown {
  return error instanceof ConversationStoreError
    ? new ApiError(error.status, error.code, error.message)
    : error;
}
