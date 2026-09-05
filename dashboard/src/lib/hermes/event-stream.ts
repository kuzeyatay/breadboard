// Shared SSE relay: turns an authorized runtime session's Hermes event
// subscription into a browser SSE stream of normalized events, and persists the
// finalized assistant turn exactly once (idempotent across reconnects). Used by
// both the dashboard terminal/garden events route and the Quartz AI events
// route so the streaming + persistence policy lives in one place.

import { leastPrivilegeDecision } from "./dispatch-core.ts";
import db from "../db.ts";
import { getAgentRuntimeByKind } from "../agent-runtime/runtime.ts";
import { runtimeStartupResourceFailure } from "../agent-runtime/startup-error.ts";
import { encodeSseEvent, type NormalizedAgentEvent } from "./events.ts";
import {
  appendRuntimeMessage,
  appendChatMessage,
  listRuntimeMessages,
  setRuntimeStatus,
  recordAuditEvent,
  revokeCapabilityDecision,
} from "./runtime-store.ts";
import { currentRuntimeIdentity } from "./session-service.ts";
import type { AuthorizedRuntimeSession } from "./session-service.ts";
import {
  PRE_DISPATCH_STREAM_TIMEOUT_MS,
  runtimeIdentityKey,
  streamSupervisorDecision,
  STREAM_SUPERVISOR_POLL_MS,
} from "./stream-supervisor.ts";
import { RUN_HEARTBEAT_INTERVAL_MS } from "./run-liveness.ts";
import {
  assessVerification,
  reportWebGrounding,
  evidenceKindForTool,
  evidenceTitleForTool,
  type EvidenceRecord,
  type ExternalAgentCall,
  type ResearchExhaustion,
  type VerificationSummary,
} from "./evidence.ts";
import {
  exhaustedFieldLabels,
  researchCoverageSummary,
} from "../research/session.ts";
import { getResearchState } from "../research/store.ts";
import { finishActiveRuntimeRun } from "./run-store.ts";
import { scheduleLoopxTickForConversation } from "../loopx/conversation-tick.ts";
import { accountGoalModeTurn, readGoalModeState } from "../goal-mode.ts";
import { scheduleDurableExtractionForConversation } from "../mem0/conversation-extraction.ts";
import { scheduleMemoryProfileSynthesisForConversation } from "../conversations/memory-profile.ts";
import {
  getActiveRuntimeRun,
  getRuntimeRun,
  parseRuntimeRunDispatch,
  touchRuntimeRunHeartbeat,
} from "./run-store.ts";
import {
  completeAssistantMessage,
  failAssistantMessage,
} from "../conversations/store.ts";
import { hermesMessageId } from "./message-id.ts";
import {
  associateArtifactToolCall,
  hasReadyArtifactForRun,
  listArtifactEventsAfter,
} from "./artifact-store.ts";
import {
  externalAgentCallsForRun,
  listAgentLaunchRequestsAfter,
} from "./agent-launch-store.ts";
import { listSuccessfulMemorySavesForRun } from "./memory-evidence.ts";
import { capabilitySummaryForRun } from "./capability-evidence.ts";
import { listCompletedTerminalCommandsForRun } from "./terminal-evidence.ts";
import {
  acquireDetachedEventPump,
  type DetachedEventPumpSink,
} from "./detached-event-pump.ts";
import { normalizeChatTokenUsage } from "../chat-token-usage.ts";
import {
  gardenNavigationResourceFromSources,
  type GenerativeUiResource,
} from "../generative-ui/contracts.ts";

type CompletedToolEvent = Extract<
  NormalizedAgentEvent,
  { type: "tool.completed" }
>;

function persistAssistantOnce(
  session: AuthorizedRuntimeSession,
  content: string,
  sources: string[],
  toolCalls: unknown[],
  progressNotes: string[],
  verification: VerificationSummary,
  runtimeStatus: string,
  uiResources: GenerativeUiResource[],
  tokenUsage?: unknown,
  reasoning?: string,
): void {
  let persistedTokenUsage = normalizeChatTokenUsage(tokenUsage) ?? undefined;
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
    // Which model actually answered, recorded the same way the provider-only
    // path records it. The run's dispatch is the only place that knows: the
    // engine was resolved when the turn was sent, and by the time the answer
    // lands the user may have picked a different model in the composer.
    const dispatchedModel = activeRun
      ? (() => {
          const dispatch = parseRuntimeRunDispatch(activeRun);
          return dispatch.modelIdentity?.modelID ?? dispatch.model?.modelID;
        })()
      : undefined;
    const metadata = {
      toolCalls,
      ...(progressNotes.length ? { progressNotes } : {}),
      ...(reasoning ? { reasoning } : {}),
      verification,
      runtimeStatus,
      ...(uiResources.length ? { uiResources } : {}),
      ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
      ...(dispatchedModel ? { model: dispatchedModel } : {}),
    };
    persistedTokenUsage = persistedTokenUsage
      ? {
          ...persistedTokenUsage,
          ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
        }
      : undefined;
    if (runtimeStatus === "idle") {
      completeAssistantMessage({
        conversationId: session.row.conversation_id,
        clientMessageId,
        content,
        metadata,
        sources,
        tokenUsage: persistedTokenUsage,
      });
    } else {
      failAssistantMessage({
        conversationId: session.row.conversation_id,
        clientMessageId,
        status: runtimeStatus === "aborted" ? "aborted" : "failed",
        content,
        metadata,
        error: runtimeStatus,
        // The turn burned these tokens whether or not it ended well, and the
        // response meta reads them back off the row after a reload.
        tokenUsage: persistedTokenUsage,
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
      tokenUsage: persistedTokenUsage,
      toolCalls: {
        calls: toolCalls,
        progressNotes,
        ...(reasoning ? { reasoning } : {}),
        verification,
        ...(uiResources.length ? { uiResources } : {}),
      },
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
    tokenUsage: persistedTokenUsage,
    toolCalls: {
      calls: toolCalls,
      progressNotes,
      ...(reasoning ? { reasoning } : {}),
      verification,
      ...(uiResources.length ? { uiResources } : {}),
    },
    runtimeStatus,
  });
}

function driveSessionEventPump(
  initialSession: AuthorizedRuntimeSession,
  sink: DetachedEventPumpSink,
): Promise<void> {
  // The identity may be replaced mid-turn (see the supervisor timer below); the
  // durable row id never is, so the pump key and all persistence stay stable.
  let session = initialSession;
  let runtime = getAgentRuntimeByKind(session.runtimeKind);
  const encoder = new TextEncoder();
  let runtimeSubscription = new AbortController();

  let assistantText = "";
  let reasoning = "";
  // Mid-turn narration segments sealed off the answer buffer (text the model
  // wrote before/between tool calls). They remain durable, user-visible progress
  // notes. The last one is also promoted back if the turn ends with nothing in
  // the answer buffer, so an aborted run never collapses to an empty message.
  const narrationSegments: string[] = [];
  const sources: string[] = [];
  const toolCalls: Array<Record<string, unknown>> = [];
  const uiResources: GenerativeUiResource[] = [];
  const evidence: EvidenceRecord[] = [];
  let memorySavesReconciled = false;
  let terminalCommandsReconciled = false;
  let persisted = false;
  // An event stream that closes without an explicit terminal runtime status is
  // a failure, not a completed answer.
  let finalStatus = "failed";
  let tokenUsage: unknown;
  let stableAnswerEmitted = false;
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
    // startConversationTurn marks dispatch after prompt.submit returns. Refresh
    // the captured row so a GET stream and POST dispatch in separate module
    // contexts still share that proof through SQLite.
    streamRun = getRuntimeRun(streamRun.id) ?? streamRun;
    const dispatch = parseRuntimeRunDispatch(streamRun);
    return {
      messageId: dispatch.clientMessageId
        ? hermesMessageId(dispatch.clientMessageId)
        : undefined,
      instruction: dispatch.runtimeText ?? streamRun.instruction,
      submitted: Boolean(dispatch.submittedAt),
    };
  };
  let assistantMessageId = activeRunReference().messageId;
  let sawTurnOutput = false;
  let lastArtifactEventId = 0;
  let lastAgentLaunchRequestId = 0;
  let abandonedBeforeDispatch = false;
  // Identity the current upstream subscription is bound to, plus the
  // replacement to adopt when the durable row moves underneath it.
  let boundIdentity = runtimeIdentityKey(session);
  let pendingRebind: AuthorizedRuntimeSession | null = null;
  let sawRuntimeEvent = false;
  let silentStreamTimedOut = false;
  const streamOpenedAt = Date.now();
  let lastRuntimeEventAt = streamOpenedAt;
  // A permission request is answered by a person, so the runtime is expected to
  // say nothing at all until they do. Anything else the runtime sends means the
  // request was resolved and the turn is moving again.
  let awaitingPermission = false;
  let lastHeartbeatWrittenAt = 0;
  // Breadboard's pre-dispatch decision that this turn needs verified map data.
  // Read off the durable run rather than recomputed here, so the obligation is
  // fixed before the model has written a word of the answer being judged.
  const geographicGroundingRequired = () => {
    streamRun ??= getActiveRuntimeRun(session.row.id);
    if (!streamRun) return false;
    return parseRuntimeRunDispatch(streamRun).geographicGrounding?.required === true;
  };
  const webGroundingRequired = () => {
    streamRun ??= getActiveRuntimeRun(session.row.id);
    if (!streamRun) return false;
    return parseRuntimeRunDispatch(streamRun).webGrounding?.required === true;
  };
  // What the tracked research session, if one ran this turn, actually proved
  // about absence. Read at the end of the turn rather than carried on the run,
  // because the session's gaps are only exhausted by work the turn does.
  // What the tracked pipeline settled, for the evidence panel. Null for every
  // turn that did not run one, which is almost all of them.
  const researchCoverageForTurn = () =>
    session.row.conversation_id === null
      ? undefined
      : (researchCoverageSummary(session.row.conversation_id) ?? undefined);
  // Which skills, connected accounts, automations and Breadboard products this
  // turn actually reached for. The selections are read off the run — they were
  // fixed before dispatch — and the usage from the calls that completed, so a
  // capability the model merely had access to never appears.
  const capabilitiesForTurn = () => {
    streamRun ??= getActiveRuntimeRun(session.row.id);
    return capabilitySummaryForRun({
      runtimeSessionId: session.row.id,
      runId: streamRun?.id,
      selection: streamRun
        ? parseRuntimeRunDispatch(streamRun).capabilities
        : undefined,
      toolCalls,
    });
  };
  // Every runtime agent this answer stands on: the ones this turn queued, plus
  // the one an earlier turn launched whose finished result this turn was
  // dispatched to report. The second kind is recorded on the run at dispatch
  // (see `delegatedAgents` in turn-service) precisely because nothing in this
  // stream would otherwise witness it — a hand-back turn queues no launch and
  // calls no tool.
  const externalAgentsForTurn = (): ExternalAgentCall[] => {
    streamRun ??= getActiveRuntimeRun(session.row.id);
    const carried = streamRun
      ? (parseRuntimeRunDispatch(streamRun).delegatedAgents ?? [])
      : [];
    return [...carried, ...externalAgentCallsForRun(streamRun?.id)];
  };
  const researchExhaustionForTurn = (): ResearchExhaustion => {
    const conversationId = session.row.conversation_id;
    streamRun ??= getActiveRuntimeRun(session.row.id);
    // The obligation was fixed before dispatch. A turn that was told to run the
    // pipeline and then skipped it is exactly the old failure mode, so the gate
    // stays armed with nothing exhausted rather than switching itself off.
    const required =
      streamRun !== null &&
      parseRuntimeRunDispatch(streamRun).researchPipeline?.required === true;
    if (conversationId === null) {
      return { active: required, exhaustedFields: [], stopped: false };
    }
    const state = getResearchState(conversationId);
    if (!state) return { active: required, exhaustedFields: [], stopped: false };
    return {
      active: true,
      exhaustedFields: exhaustedFieldLabels(conversationId),
      stopped: Boolean(state.stopped),
    };
  };
  const missingRequiredArtifact = () => {
    streamRun ??= getActiveRuntimeRun(session.row.id);
    if (!streamRun) return null;
    const dispatch = parseRuntimeRunDispatch(streamRun);
    const requirements = dispatch.requiredArtifacts ?? [];
    const conversationId = session.row.conversation_id;
    const assistantClientMessageId = dispatch.clientMessageId?.trim();
    if (
      requirements.length > 0 &&
      (conversationId === null || !assistantClientMessageId)
    ) {
      return requirements[0];
    }
    return requirements.find(
      (requirement) =>
        !hasReadyArtifactForRun({
          runId: streamRun!.id,
          conversationId: conversationId!,
          assistantClientMessageId: assistantClientMessageId!,
          kind: requirement.kind,
          rendererId: requirement.rendererId,
          sourceSkill: requirement.sourceSkill,
          readyEventType: requirement.readyEventType,
          previewRequired: requirement.previewRequired,
        }),
    ) ?? null;
  };
  let gardenGroundingHydrated = false;
  const hydrateGardenGrounding = () => {
    if (gardenGroundingHydrated || !streamRun) return;
    gardenGroundingHydrated = true;
    const grounding = parseRuntimeRunDispatch(streamRun).gardenGrounding;
    if (!grounding?.attempted) return;

    if (grounding.sources.length > 0) {
      const navigator = gardenNavigationResourceFromSources({
        id: `garden-search:${streamRun.id}`,
        query: streamRun.instruction,
        createdAt: streamRun.started_at,
        sources: grounding.sources,
      });
      if (navigator) uiResources.push(navigator);
      for (const [index, source] of grounding.sources.entries()) {
        const label = `${source.title} (${source.gardenName})`;
        if (!sources.includes(label)) sources.push(label);
        evidence.push({
          id: `garden-grounding-${streamRun.id}-${index}`,
          kind: "garden",
          title: `Garden source: ${source.title}`,
          location: source.location,
          success: true,
          timestamp: streamRun.started_at,
          details: {
            gardenName: source.gardenName,
            gardenSlug: source.gardenSlug,
            pageSlug: source.pageSlug,
            pageRelPath: source.pageRelPath,
            heading: source.heading,
            sourceFile: source.sourceFile,
            evidenceAnchors: source.evidenceAnchors,
            locations: source.locations,
            lexicalUsed: grounding.lexicalUsed,
            semanticUsed: grounding.semanticUsed,
          },
        });
      }
    } else {
      evidence.push({
        id: `garden-grounding-${streamRun.id}`,
        kind: "garden",
        title: grounding.warning
          ? "Garden retrieval was unavailable"
          : "Garden searched — no relevant sources found",
        success: !grounding.warning,
        timestamp: streamRun.started_at,
        details: {
          resultCount: 0,
          ...(grounding.warning ? { warning: grounding.warning } : {}),
        },
      });
    }
  };
  let dispatchDeadline: ReturnType<typeof setTimeout> | null = null;
  const clearDispatchDeadline = () => {
    if (dispatchDeadline === null) return;
    clearTimeout(dispatchDeadline);
    dispatchDeadline = null;
  };
  const markPumpConnected = () => {
    sink.markConnected();
    // The browser cannot submit the prompt until this frame reaches it. Start
    // the orphan guard here, not while the runtime subscription itself is
    // still cold-starting.
    if (streamRun || dispatchDeadline !== null) return;
    dispatchDeadline = setTimeout(() => {
      streamRun ??= getActiveRuntimeRun(session.row.id);
      if (!streamRun) {
        abandonedBeforeDispatch = true;
        runtimeSubscription.abort();
      }
    }, PRE_DISPATCH_STREAM_TIMEOUT_MS);
    dispatchDeadline.unref?.();
  };

  return (async () => {
    const emit = (
      event: NormalizedAgentEvent | { type: string; [k: string]: unknown },
    ) => {
      sink.emit(encoder.encode(encodeSseEvent(event)));
    };
    const promoteNarrationFallback = () => {
      if (!assistantText.trim() && narrationSegments.length) {
        assistantText = narrationSegments[narrationSegments.length - 1];
      }
    };
    // A raw delta is ambiguous until the model either starts a tool (making it
    // progress narration) or completes the turn (making it the answer). Hold it
    // server-side and reveal the answer exactly once at a terminal boundary.
    // This prevents text from appearing in the answer bubble and then being
    // erased a moment later when a tool call classifies it as provisional.
    const emitStableAnswer = () => {
      if (stableAnswerEmitted) return;
      promoteNarrationFallback();
      stableAnswerEmitted = true;
      emit({
        type: "assistant.completed",
        sessionId: session.hermesSessionId,
        ...(assistantMessageId ? { messageId: assistantMessageId } : {}),
        timestamp: new Date().toISOString(),
        payload: {
          replacementText: assistantText,
          usage: tokenUsage,
          ...(uiResources.length ? { uiResources } : {}),
        },
      });
    };
    // A turn dispatched onto a dead runtime session is re-dispatched by
    // startConversationTurn's retry, which rewrites this row's identity. This
    // stream opens before the prompt POST, so that replacement routinely lands
    // after the upstream subscription already exists: without adopting it the
    // pump listens to the abandoned session forever while the answer streams on
    // the new one. The same timer bounds the two ways a turn can otherwise run
    // out of endings — never emitting at all, or emitting and then going quiet
    // — and stamps the heartbeat that proves to every other process that this
    // run still has an owner.
    const supervisor = setInterval(() => {
      const refreshed = persisted ? null : currentRuntimeIdentity(session.row.id);
      const submitted = activeRunReference().submitted === true;
      // Claim the run for as long as this pump is driving it. Everything else
      // that could take the run over reads this stamp, so a pump that stops
      // beating — because its process died — is the signal that releases the
      // conversation instead of wedging it.
      const now = Date.now();
      if (
        !persisted &&
        streamRun &&
        now - lastHeartbeatWrittenAt >= RUN_HEARTBEAT_INTERVAL_MS
      ) {
        lastHeartbeatWrittenAt = now;
        touchRuntimeRunHeartbeat(streamRun.id);
      }
      const decision = streamSupervisorDecision({
        boundIdentity,
        currentIdentity: refreshed ? runtimeIdentityKey(refreshed) : null,
        sawRuntimeEvent,
        submitted,
        elapsedMs: now - streamOpenedAt,
        msSinceLastEvent: now - lastRuntimeEventAt,
        awaitingPermission,
        finalized: persisted,
        timedOut: silentStreamTimedOut,
      });
      if (!decision) return;
      if (decision.kind === "rebind") {
        pendingRebind = refreshed;
        runtimeSubscription.abort();
        return;
      }
      silentStreamTimedOut = true;
      emit({
        type: "error",
        sessionId: session.hermesSessionId,
        timestamp: new Date().toISOString(),
        payload: {
          code:
            decision.kind === "inactivity_timeout"
              ? "runtime_stream_stalled"
              : "runtime_stream_silent",
          message:
            decision.kind === "inactivity_timeout"
              ? "The agent stopped responding partway through this turn. The turn was stopped so you can try again."
              : "The agent accepted this turn but never sent any output. The turn was stopped so you can try again.",
          recoverable: true,
        },
      });
      runtimeSubscription.abort();
    }, STREAM_SUPERVISOR_POLL_MS);
    const emitArtifactEvents = () => {
        if (!streamRun) return;
        for (const artifactEvent of listArtifactEventsAfter({
          runId: streamRun.id,
          afterId: lastArtifactEventId,
        })) {
          lastArtifactEventId = artifactEvent.id;
          emit({
            type: artifactEvent.type,
            sessionId: session.hermesSessionId,
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
      // Drained on the same beat as artifact events. A launch the agent asked
      // for has to reach the browser before the turn ends, because the browser
      // is the only thing that can start it.
      const emitAgentLaunchRequests = () => {
        if (!streamRun) return;
        for (const request of listAgentLaunchRequestsAfter({
          runId: streamRun.id,
          afterId: lastAgentLaunchRequestId,
        })) {
          lastAgentLaunchRequestId = request.id;
          emit({
            type: "agent.launch_requested",
            sessionId: session.hermesSessionId,
            timestamp: request.createdAt,
            payload: {
              requestId: request.requestId,
              workerClientMessageId: request.workerClientMessageId,
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
            },
          });
        }
      };
      // A successfully queued delegated run is the evidence-gathering action
      // for this parent turn. Its prose is only a handoff, so applying the
      // factual-answer web gate here would replace a valid handoff with the
      // misleading "I couldn't verify" fallback while the worker is running.
      const webGroundingAppliesToCompletion = () =>
        webGroundingRequired() && lastAgentLaunchRequestId === 0;
      const recordCompletedTool = (
        event: CompletedToolEvent,
        audit = true,
      ) => {
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
        for (const resource of event.payload.uiResources ?? []) {
          const existing = uiResources.findIndex(
            (item) =>
              item.id === resource.id ||
              (resource.kind === "garden-search" && item.kind === resource.kind),
          );
          if (existing >= 0) uiResources[existing] = resource;
          else uiResources.push(resource);
        }
        const inferredKind =
          /(?:^|\s)(?:test|lint|typecheck)(?:\s|$)/i.test(
            event.payload.summary ?? "",
          )
            ? "test"
            : evidenceKindForTool(event.payload.toolName);
        evidence.push({
          id: `evidence-${event.payload.toolCallId}`,
          kind: inferredKind,
          title: evidenceTitleForTool(
            event.payload.toolName,
            event.payload.summary,
          ),
          location: event.payload.location,
          success: event.payload.success,
          toolCallId: event.payload.toolCallId,
          timestamp: event.timestamp,
          // The runtime already resolved which pages a search or fetch
          // actually returned. Dropping them here is what made the evidence
          // panel able to say "did 5 searches" without ever naming a source.
          details: {
            ...(event.payload.details ?? {}),
            toolName: event.payload.toolName,
          },
          ...(event.payload.websites?.length
            ? { websites: event.payload.websites }
            : {}),
        });
        if (audit) {
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
      };
      const reconcileSuccessfulMemorySaves = () => {
        if (memorySavesReconciled || !streamRun) return;
        memorySavesReconciled = true;
        const saves = listSuccessfulMemorySavesForRun(
          session.row.id,
          streamRun.id,
        );
        const observedSaves = toolCalls.filter(
          (call) =>
            call.success === true &&
            String(call.toolName).toLowerCase() === "save_memory",
        ).length;
        for (const save of saves.slice(observedSaves)) {
          const event: CompletedToolEvent = {
            type: "tool.completed",
            sessionId: session.hermesSessionId,
            timestamp: save.timestamp,
            payload: {
              toolCallId: `memory-audit-${save.auditEventId}`,
              toolName: "save_memory",
              success: true,
              summary: "Memory updated",
            },
          };
          recordCompletedTool(event, false);
          emit(event);
        }
      };
      const reconcileCompletedTerminalCommands = () => {
        if (terminalCommandsReconciled || !streamRun) return;
        terminalCommandsReconciled = true;
        const commands = listCompletedTerminalCommandsForRun(
          session.row.id,
          streamRun.id,
        );
        const observed = toolCalls.filter(
          (call) =>
            String(call.toolName).toLowerCase() === "terminal_execute_command",
        ).length;
        for (const command of commands.slice(observed)) {
          const event: CompletedToolEvent = {
            type: "tool.completed",
            sessionId: session.hermesSessionId,
            timestamp: command.timestamp,
            payload: {
              toolCallId: `terminal-audit-${command.auditEventId}`,
              toolName: "terminal_execute_command",
              success: command.success,
              summary: command.commandFamily ?? "Terminal command",
            },
          };
          recordCompletedTool(event, false);
          emit(event);
        }
      };
      const finalize = (status: string) => {
        if (persisted) return;
        persisted = true;
        finalStatus = status;
        setRuntimeStatus(session.row.id, status);
        // Keep persistence byte-for-byte aligned with the one stable answer the
        // client receives, including the answerless/interrupted fallback.
        promoteNarrationFallback();
        // An unmet web obligation is carried by the verification summary
        // below, never by rewriting the answer. See `reportWebGrounding`.
        // Read from the launch store rather than from what the stream managed
        // to emit: a delegation the agent asked for in its last breath belongs
        // in this answer's provenance even if the client never saw the event.
        const verification = assessVerification(assistantText, evidence, {
          geographicGroundingRequired: geographicGroundingRequired(),
          webGroundingRequired: webGroundingAppliesToCompletion(),
          externalAgents: externalAgentsForTurn(),
          researchExhaustion: researchExhaustionForTurn(),
          researchCoverage: researchCoverageForTurn(),
          capabilities: capabilitiesForTurn(),
        });
        try {
          persistAssistantOnce(
            session,
            assistantText,
            sources,
            toolCalls,
            narrationSegments,
            verification,
            status,
            uiResources,
            tokenUsage,
            reasoning,
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
                  metadata: {
                    ...(reasoning ? { reasoning } : {}),
                    ...(narrationSegments.length
                      ? { progressNotes: narrationSegments }
                      : {}),
                    ...(uiResources.length ? { uiResources } : {}),
                  },
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
        // Goal's accounting belongs at the same boundary as the upstream Stop
        // hook: a dispatched turn has actually ended and its result is now
        // durable. If the agent called update_goal during this turn, the state
        // is complete and the helper intentionally leaves it untouched.
        if (session.row.conversation_id !== null && streamRun) {
          const goalMode = parseRuntimeRunDispatch(streamRun).goalMode;
          if (goalMode?.enabled) {
            const conversation = db
              .prepare("SELECT public_id FROM conversations WHERE id = ?")
              .get(session.row.conversation_id) as { public_id: string } | undefined;
            // The turn that starts a goal dispatches without an id, because the
            // model writes the objective during it. Reading the state back here
            // is what lets that first turn be accounted like every other one;
            // when the goal was already running the dispatched id still wins,
            // so a goal replaced mid-conversation cannot inherit its counters.
            const goalId =
              goalMode.goalId ??
              (conversation?.public_id
                ? readGoalModeState(conversation.public_id)?.goal_id ?? null
                : null);
            if (conversation?.public_id && goalId) {
              try {
                accountGoalModeTurn({
                  conversationPublicId: conversation.public_id,
                  goalId,
                  startedAt: streamRun.started_at,
                });
              } catch {
                recordAuditEvent({
                  eventType: "goal_mode.accounting_failed",
                  runtimeSessionId: session.row.id,
                  userId: session.row.user_id,
                  gardenId: session.row.garden_id,
                  payload: { runId: streamRun.id },
                });
              }
            }
          }
        }
        finishActiveRuntimeRun(
          session.row.id,
          status === "idle"
            ? "completed"
            : status === "aborted"
              ? "cancelled"
              : "error",
        );
        // The LoopX tick runs here, after the turn is persisted and before the
        // capability decision is revoked, so it can see what this turn was
        // authorized to do. It never blocks completion.
        scheduleLoopxTickForConversation({
          conversationId: session.row.conversation_id,
          runtimeSessionId: session.row.id,
          outcome:
            status === "idle"
              ? "completed"
              : status === "aborted"
                ? "cancelled"
                : "error",
          toolNames: toolCalls.map((call) => String(call.toolName)),
        });
        // Detached mem0 fact extraction over the finished exchange. Opt-in,
        // proposes candidates only, and never blocks the stream.
        scheduleDurableExtractionForConversation({
          conversationId: session.row.conversation_id,
          runtimeSessionId: session.row.id,
          activeGardenId: session.row.cluster_id,
          outcome:
            status === "idle"
              ? "completed"
              : status === "aborted"
                ? "cancelled"
                : "error",
        });
        // The consolidated profile is a separate, lower-trust memory layer.
        // Refresh it after every completed turn, outside the response path,
        // while keeping the evidence sent to the model hard-bounded.
        scheduleMemoryProfileSynthesisForConversation({
          conversationId: session.row.conversation_id,
          outcome:
            status === "idle"
              ? "completed"
              : status === "aborted"
                ? "cancelled"
                : "error",
        });
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

    // Presents the upstream as one uninterrupted event sequence even when the
    // turn moves to a replacement runtime session partway through. Consumers
    // below stay unaware of the switch; accumulated answer text and tool
    // evidence carry across because the abandoned session contributed none.
    async function* subscribeAcrossRebinds() {
      while (true) {
        try {
          yield* runtime.streamSession(
            {
              externalSessionId: session.externalSessionId,
              liveSessionId: session.liveSessionId,
              workspaceKey: session.workspaceKey,
              directory: session.activeDirectory,
              ...activeRunReference(),
              resolveActiveTurn: activeRunReference,
            },
            runtimeSubscription.signal,
            markPumpConnected,
          );
        } catch (error) {
          // An abort raised to hand over to the replacement is control flow,
          // not failure. Anything else is a real stream error.
          if (!pendingRebind) throw error;
        }
        if (!pendingRebind) return;
        session = pendingRebind;
        pendingRebind = null;
        boundIdentity = runtimeIdentityKey(session);
        runtime = getAgentRuntimeByKind(session.runtimeKind);
        runtimeSubscription = new AbortController();
        recordAuditEvent({
          eventType: "session.stream_rebound",
          runtimeSessionId: session.row.id,
          userId: session.row.user_id,
          gardenId: session.row.garden_id,
          payload: { externalSessionId: session.externalSessionId },
        });
      }
    }

    try {
        hydrateGardenGrounding();
        // Replays lifecycle events already committed before the browser managed
        // to attach, making refresh/reconnect deterministic and idempotent.
        emitArtifactEvents();
        emitAgentLaunchRequests();
        for await (const event of subscribeAcrossRebinds()) {
          sawRuntimeEvent = true;
          lastRuntimeEventAt = Date.now();
          // Only the request itself may leave the turn waiting: once the
          // runtime speaks again the decision has landed, one way or the other.
          // A clarify question is the same kind of silence: the model is
          // blocked on a person, not stuck.
          awaitingPermission =
            event.type === "permission.requested" ||
            event.type === "clarify.requested";
          if (!streamRun) {
            streamRun = getActiveRuntimeRun(session.row.id);
            assistantMessageId ??= activeRunReference().messageId;
          }
          hydrateGardenGrounding();
          if (streamRun) clearDispatchDeadline();

          // Events received before the message POST has created its run belong
          // to the previous turn. Dropping them prevents an edit/new send from
          // completing empty while its real generation continues orphaned.
          if (!streamRun) continue;

          let forwardEvent = true;
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
            // Do not paint an unclassified model segment as an answer. If a
            // tool follows, the upcoming assistant.segment event presents it
            // permanently as a progress note; otherwise emitStableAnswer shows
            // it once as the final response.
            forwardEvent = false;
          } else if (event.type === "assistant.segment") {
            if (
              assistantMessageId &&
              event.messageId &&
              event.messageId !== assistantMessageId
            ) {
              continue;
            }
            // The buffer so far is tool-call narration, not the answer. The
            // segment itself is forwarded only after that classification, so
            // clients can present it as a permanent progress note without ever
            // drawing it in the answer bubble first.
            if (event.payload.streamed) {
              const sealed = assistantText.trim()
                ? assistantText
                : event.payload.text;
              if (sealed.trim()) narrationSegments.push(sealed);
              assistantText = "";
            } else if (event.payload.text.trim()) {
              narrationSegments.push(event.payload.text);
            }
            sawTurnOutput = true;
          } else if (event.type === "reasoning.status") {
            if (event.payload.detail) {
              reasoning = event.payload.detailMode === "replace"
                ? event.payload.detail
                : reasoning + event.payload.detail;
            }
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
            // Completion metadata is emitted together with the stable answer
            // at the terminal status below. Forwarding it here would let the
            // browser settle before the response text is committed.
            forwardEvent = false;
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
            recordCompletedTool(event);
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
          } else if (event.type === "clarify.requested") {
            recordAuditEvent({
              eventType: "clarify.requested",
              runtimeSessionId: session.row.id,
              userId: session.row.user_id,
              gardenId: session.row.garden_id,
              payload: {
                requestId: event.payload.requestId,
                choiceCount: event.payload.choices.length,
              },
            });
          }
          if (
            event.type === "session.status" &&
            event.payload.status === "idle"
          ) {
            reconcileSuccessfulMemorySaves();
            reconcileCompletedTerminalCommands();
            if (sawTurnOutput) {
              // Tool completion and artifact persistence are synchronous, so a
              // required product must be durable before Hermes declares idle.
              // Replaying narration after a restart, or a model claiming it is
              // done without calling the publisher, must fail closed here.
              emitArtifactEvents();
              const missingArtifact = missingRequiredArtifact();
              if (missingArtifact) {
                assistantText =
                  missingArtifact.sourceSkill === "office"
                    ? "The requested Office file was not published as an artifact before this turn ended. Please retry the request."
                    : "The required visualizer was not published before this turn ended.";
                emitStableAnswer();
                emit({
                  type: "error",
                  sessionId: session.hermesSessionId,
                  timestamp: new Date().toISOString(),
                  payload: {
                    code: "required_artifact_missing",
                    message: assistantText,
                    recoverable: true,
                  },
                });
                emit({
                  type: "session.status",
                  sessionId: session.hermesSessionId,
                  timestamp: new Date().toISOString(),
                  payload: { status: "failed" },
                });
                recordAuditEvent({
                  eventType: "artifact.required_missing",
                  runtimeSessionId: session.row.id,
                  userId: session.row.user_id,
                  gardenId: session.row.garden_id,
                  payload: {
                    runId: streamRun?.id,
                    kind: missingArtifact.kind,
                    rendererId: missingArtifact.rendererId,
                    sourceSkill: missingArtifact.sourceSkill,
                  },
                });
                finalize("failed");
                emit({ type: "done" });
                break;
              }
            }
          }
          if (
            event.type === "session.status" &&
            (event.payload.status === "idle" ||
              event.payload.status === "aborted" ||
              event.payload.status === "failed") &&
            // A fresh subscription can replay the previous turn's idle frame.
            // Do not consume this turn's one stable-answer emission before it
            // has produced anything.
            (event.payload.status !== "idle" || sawTurnOutput)
          ) {
            emitStableAnswer();
          }
          if (forwardEvent) emit(event);
          emitArtifactEvents();
          emitAgentLaunchRequests();

          if (event.type === "session.status") {
            if (event.payload.status === "idle") {
              // A just-opened session subscription can receive the previous
              // turn's terminal idle event. It is not completion for this run
              // until the run has emitted answer text or tool activity.
              if (!sawTurnOutput) continue;
              emitArtifactEvents();
              // Last chance: after this the stream closes, and an unemitted
              // launch would be a run the agent believes it started.
              emitAgentLaunchRequests();
              emitStableAnswer();
              // The answer is never rewritten here any more. An unmet web
              // obligation is reported through the verification summary
              // emitted immediately below, which the evidence panel renders;
              // substituting a refusal deleted correct answers whenever the
              // pre-dispatch classifier misread the request. See
              // `reportWebGrounding` in evidence.ts.
              emit({
                type: "verification.updated",
                sessionId: session.hermesSessionId,
                timestamp: new Date().toISOString(),
                payload: assessVerification(assistantText, evidence, {
                  geographicGroundingRequired: geographicGroundingRequired(),
                  webGroundingRequired: webGroundingAppliesToCompletion(),
                  externalAgents: externalAgentsForTurn(),
                  researchExhaustion: researchExhaustionForTurn(),
                  researchCoverage: researchCoverageForTurn(),
                  capabilities: capabilitiesForTurn(),
                }),
              });
              finalize("idle");
              emit({ type: "done" });
              break;
            }
            if (
              event.payload.status === "aborted" ||
              event.payload.status === "failed"
            ) {
              emitStableAnswer();
              finalize(event.payload.status);
              emit({ type: event.payload.status === "aborted" ? "cancelled" : "done" });
              break;
            }
          }
        }
      } catch (error) {
        if (abandonedBeforeDispatch) return;
        finalStatus = "failed";
        emitStableAnswer();
        const resourceFailure = runtimeStartupResourceFailure(error);
        emit({
          type: "error",
          sessionId: session.hermesSessionId,
          timestamp: new Date().toISOString(),
          payload: {
            code: resourceFailure?.code ?? "stream_error",
            message:
              resourceFailure?.message ??
              (error instanceof Error ? error.message : "stream error"),
            recoverable: !resourceFailure,
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
        clearDispatchDeadline();
        clearInterval(supervisor);
        if (abandonedBeforeDispatch) {
          sink.close();
          return;
        }
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
        sink.close();
      }
    })();
}

function sessionEventPump(session: AuthorizedRuntimeSession) {
  return acquireDetachedEventPump(
    `hermes:${session.row.id}`,
    (sink) => driveSessionEventPump(session, sink),
  );
}

/**
 * Start (or reuse) the server-owned pump for a runtime session without attaching
 * a viewer. Turns dispatched without a browser — a scheduled chat, for instance —
 * still need their assistant output consumed, verified, and persisted.
 */
export function startSessionEventPump(session: AuthorizedRuntimeSession): void {
  sessionEventPump(session);
}

/** Join the same detached pump a scheduled worker started, until its turn ends. */
export function waitForSessionEventPump(
  session: AuthorizedRuntimeSession,
): Promise<void> {
  return sessionEventPump(session).settled();
}

/**
 * Attach an SSE viewer to a server-owned runtime pump. The pump is keyed by
 * durable runtime session and continues consuming/persisting Hermes events when
 * the request signal aborts because the user changes chat or route.
 */
export function buildSessionEventStream(
  session: AuthorizedRuntimeSession,
  signal: AbortSignal,
  extraHeaders: Record<string, string> = {},
): Response {
  const pump = sessionEventPump(session);
  return pump.response(signal, extraHeaders);
}
