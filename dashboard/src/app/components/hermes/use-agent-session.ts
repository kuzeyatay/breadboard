"use client";

// Client-side hook that drives an Hermes-backed agent session for any of
// the three surfaces (terminal, garden chat, Quartz AI). It owns the runtime
// session lifecycle, streaming, tool activity, permission prompts, abort, and
// reconnect state — so surface components stay thin and none of this logic
// lands in dashboard-client.tsx.
//
// The browser only ever talks to Breadboard's /api/hermes/* routes. It
// references conversations by an opaque Breadboard id; the Hermes
// session id, workspace, and agent are all server-derived.

import { useCallback, useEffect, useRef, useState } from "react";
import { isDirectModeEnabled } from "@/app/components/use-direct-mode";
import { isYoloModeEnabled, useYoloMode } from "@/app/components/use-yolo-mode";
import {
  isAgentModeEnabled,
  isSuperAgentEnabled,
} from "@/app/components/use-agent-mode";
import {
  parseAgentLaunchRequest,
  type AgentLaunchRequestPayload,
} from "@/lib/hermes/agent-launch.ts";
import type { AssistantReasoningEffort } from "@/lib/assistant-reasoning";
import {
  chatMessageAttachments,
  normalizeChatMessageAttachments,
  type ChatAttachment,
  type ChatMessageAttachment,
} from "@/lib/chat-attachments";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import {
  activityLabelForTool,
  evidenceKindForTool,
  type EvidenceKind,
  type VerificationSummary,
} from "@/lib/hermes/evidence";
import type { PermissionRisk } from "@/lib/hermes/events";
import { selectRestorableAgentSession } from "@/lib/hermes/session-selection";
import {
  cachedHermesSessionDetail,
  loadHermesSessionDetail,
  loadHermesSessionSummaries,
  notifyHermesSessionsChanged,
  updateCachedHermesSessionMessages,
} from "@/lib/hermes/session-client";
import type {
  ExternalAgentActivityEntry,
  ExternalAgentEdits,
  ExternalAgentOutcome,
  ExternalAgentRun,
  ExternalAgentRunKind,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { externalAgentAbortUrl } from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import {
  AgentStreamDisconnectedError,
  agentStreamReconnectDelay,
  agentStreamTimeout,
  isRecoverableAgentStreamDisconnect,
  isAgentStreamTurnActivity,
  isAgentStreamTimeoutError,
  waitForAgentStreamReconnect,
  withAgentStreamTimeout,
} from "./agent-stream-watchdog";
import { primeInlineArtifacts } from "./inline-artifact-cards";
import { submitPermissionDecision } from "./permission-client";
import {
  normalizeChatTextSelectionReference,
  type ChatTextSelectionReference,
} from "@/lib/chat-text-selection";
import {
  getStoredCurrentLocationPreference,
  type CurrentLocationSnapshot,
} from "@/lib/current-location";
import { requestUsesCurrentLocation } from "@/lib/hermes/current-location-context";
import { scrubbed } from "@/lib/watermarks/scrub-text";

export type AgentSurface = "dashboard_terminal" | "garden_chat" | "quartz_ai";

export interface ToolActivity {
  toolCallId: string;
  toolName: string;
  summary?: string;
  status: "running" | "completed" | "failed";
}

export interface PermissionPrompt {
  requestId: string;
  permission: string;
  description: string;
  risk: PermissionRisk;
  affectedPaths: string[];
  command?: string;
  sourcePath?: string;
  destinationPath?: string;
  allowSession: boolean;
  /** A Breadboard capability preflight pauses before any Hermes run. */
  preflight?: {
    kind: "filesystem" | "confirmation" | "connection";
    path?: string;
    operations: string[];
  };
}

export interface ActivityItem {
  id: string;
  kind: EvidenceKind | "reasoning" | "permission" | "answer" | "artifact";
  label: string;
  detail?: string;
  status:
    | "running"
    | "permission_required"
    | "completed"
    | "failed"
    | "cancelled"
    | "denied";
  startedAt: string;
  completedAt?: string;
  toolCallId?: string;
  parentId?: string;
}

export interface AgentMessage {
  id?: string;
  /** Canonical assistant message that owns artifacts emitted during this turn. */
  artifactMessageId?: string;
  clientMessageId?: string;
  createdAt?: string;
  role: "user" | "assistant";
  content: string;
  /** Model-to-model hand-back; kept in context but never rendered as the user. */
  internalAgentContinuation?: boolean;
  reasoning?: string;
  sources?: string[];
  attachmentNames?: string[];
  attachments?: ChatMessageAttachment[];
  tools?: ToolActivity[];
  /**
   * A durable memory was written this turn (the `save_memory` tool completed).
   * Derived here so the response UI can show a "Memory updated" chip without
   * ever inspecting raw tool names in the assistant response area.
   */
  memoryUpdated?: boolean;
  proposal?: unknown;
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  verification?: VerificationSummary;
  interrupted?: boolean;
  courseCorrection?: boolean;
  /** Assistant turn this mid-run correction was inserted into. */
  courseCorrectionTargetClientMessageId?: string;
  /** UTF-16 character boundary in the assistant response at steer time. */
  courseCorrectionOffset?: number;
  clientRequestId?: string;
  branchGroupId?: string;
  textSelection?: ChatTextSelectionReference;
  /**
   * Present when this assistant turn is a browser-operator (Agent TARS) run
   * rather than a normal model reply. The transcript renders the live run
   * workspace (screenshot + timeline + approvals) for it instead of markdown.
   */
  browserRun?: { agentId: string; runId: string; task: string };
  /**
   * Present when this assistant turn is an agent-browser run (vercel-labs
   * agent-browser CLI driven by ChatMock). Rendered as its own live run
   * workspace, separate from the Agent TARS one.
   */
  agentBrowserRun?: { agentId: string; runId: string; task: string };
  /**
   * Present when this assistant turn is an Agent Reach run (upstream platform
   * readers routed by the cloned agent-reach CLI, driven by ChatMock). Renders
   * the live channel map, the fetches it made, and the sourced answer.
   */
  agentReachRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is a Career Ops run (the cloned career-ops
   * job-search command center, driven by ChatMock). Renders the workspace it
   * found, the scripts it ran, the files it wrote, and its answer.
   */
  careerOpsRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is a TradingAgents analysis (the cloned
   * multi-agent trading framework, driven by ChatMock). Renders the firm's
   * agents as they run, then every report and the final rating. `task` is the
   * run's label — this agent takes no prompt.
   */
  tradingAgentsRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is a Vibe Trading run (the cloned
   * finance-research project, running as its own service against ChatMock).
   * Renders the tools it called — market data, factors, backtests — and streams
   * its answer as it is written.
   */
  vibeTradingRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is a Stock Analyst run (the cloned
   * daily-analysis backend, running as its own service against ChatMock).
   * Renders the pipeline stages and the market-data tools it called, then the
   * analysis it wrote.
   */
  stockAnalystRun?: { runId: string; task: string };
  paperTraderRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is a DeerFlow run. Rendered as a live task
   * card — its steps, the files it produced, and the answer as it is written —
   * instead of markdown.
   */
  deerFlowRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is a Deep Research run. Rendered as a live
   * research card (progress, learnings, sources, final report) instead of
   * markdown; the report itself arrives inside that card.
   */
  deepResearchRun?: { runId: string; query: string; output: "report" | "answer" };
  /**
   * Present when this assistant turn is a Get Doc search. The card lists the
   * documents it found with a Download button each, which saves the PDF into
   * this conversation's artifacts.
   */
  getDocRun?: { runId: string; query: string };
  /**
   * Present when this assistant turn is a Meeting Notes run. The card carries
   * the notes themselves as the body of the turn, so the saved message stays
   * readable long after the run and its artifacts have scrolled away.
   */
  meetingNotesRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is a Deep Tutor turn. The card names the
   * material the tutor read before it answers, which is the part of a tutoring
   * answer that cannot be inferred from the answer itself.
   */
  deepTutorRun?: { runId: string; task: string; capability: string };
  /**
   * Present when this assistant turn is an OpenPlanter investigation. Its
   * graph, investigation trail, artifacts, and final result render inline.
   */
  openPlanterRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is a Socials Manager drafting run. Its drafts,
   * calendar slots and artifacts render inline — this is the only place the
   * agent surface appears.
   */
  socialsManagerRun?: { runId: string; brief: string };
  /**
   * Present when this assistant turn is a Hardware Blueprint run. The card
   * shows the compile pipeline live and then points at the blueprint artifact,
   * which is where the design itself lives.
   */
  hardwareBlueprintRun?: { runId: string; brief: string };
  /**
   * Present when this assistant turn is a Parametric CAD run. The card shows
   * the design pipeline live and then points at the CAD artifact, which is
   * where the model, its source and its exports live.
   */
  parametricCadRun?: { runId: string; brief: string };
  /**
   * Present when this assistant turn is a HyperFrames run. The card streams the
   * video build and then plays the rendered file inline.
   */
  hyperframesRun?: { runId: string; brief: string };
  /** Present when this assistant turn is a Resource2Skill artifact run. */
  resource2SkillRun?: { runId: string; brief: string };
  /**
   * Present when this assistant turn is an OpenMontage run. The card streams
   * the production and replays it from the workspace afterwards.
   */
  openMontageRun?: { runId: string; brief: string };
  /**
   * Present when this assistant turn is a ViMax run. The card streams the
   * production and the finished film opens from its own artifact card.
   */
  vimaxRun?: { runId: string; brief: string };
  /**
   * Present when this assistant turn is a Shorts run. The card streams the cut
   * and each finished clip opens from its own video artifact.
   */
  shortsRun?: { runId: string; task: string };
  /** Present when this assistant turn is an image-only ShapeR reconstruction. */
  formsmithRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is a Video Use run. The card streams the
   * edit and the finished video opens in the studio from its own artifact.
   */
  videoUseRun?: { runId: string; task: string; quiet?: boolean };
  /**
   * Present when this assistant turn is a MoneyPrinter run. The card narrates
   * the clone's pipeline and the finished video opens from its own artifact.
   */
  moneyPrinterRun?: { runId: string; brief: string };
  /**
   * Present when this assistant turn is a Legal Agent run. The card streams the
   * harness's steps and each deliverable it wrote becomes its own artifact.
   */
  legalRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is an OpenWork run. The card streams the
   * answer as the workspace writes it and links anything left in the outbox.
   */
  openworkRun?: { runId: string; task: string };
  openscienceRun?: { runId: string; task: string };
  /**
   * Present when this assistant turn is an Inbox Zero run. The card streams the
   * answer and lists everything the run touched in the mailbox.
   */
  inboxZeroRun?: { runId: string; task: string };
  /** OpenCode task running against the repository linked to a Garden. */
  openCodeRun?: {
    runId: string;
    task: string;
    gardenSlug: string;
    repository: string;
  };
  /** Codex coding task running against the repository linked to a Garden. */
  codexRun?: {
    runId: string;
    task: string;
    gardenSlug: string;
    repository: string;
  };
  /**
   * Ruflo hive-mind swarm running against the repository linked to a Garden.
   * Renders the swarm's topology, coordination calls, and result inline.
   */
  rufloRun?: {
    runId: string;
    task: string;
    gardenSlug: string;
    repository: string;
  };
  externalAgentOutcome?: ExternalAgentOutcome;
  /** Model-selected worker state; its observer stays mounted but its card is hidden. */
  delegatedAgentRun?: boolean;
  /** The Super Agent text that remains visible while its worker runs. */
  delegatedAgentPreamble?: string;
  /** Worker output returned to the Super Agent without replacing its message. */
  externalAgentResult?: string;
  externalAgentName?: string;
  /** What an external agent did, restored with the finished turn. */
  externalAgentActivity?: ExternalAgentActivityEntry[];
  /** Snapshots bracketing a coding run, so its edits stay undoable. */
  externalAgentEdits?: ExternalAgentEdits;
  /** Saved presentation state for result cards with structured detail. */
  externalAgentState?: Record<string, unknown>;
}

export interface ExternalAgentTurnInput {
  clientMessageId: string;
  userContent: string;
  assistantContent?: string;
  run?: ExternalAgentRun;
  outcome?: ExternalAgentOutcome;
  /** Groups a retried/edited external turn with the original response branch. */
  branchGroupId?: string;
  attachments?: ChatMessageAttachment[];
  /** Attach a delegated run to the existing assistant turn; create no user row. */
  attachToExistingTurn?: boolean;
}

export interface ExternalAgentTurnResult {
  clientMessageId: string;
  outcome: ExternalAgentTerminalResult["outcome"];
  content: ExternalAgentTerminalResult["content"];
  usage?: ExternalAgentTerminalResult["usage"];
  activity?: ExternalAgentTerminalResult["activity"];
  edits?: ExternalAgentTerminalResult["edits"];
  state?: ExternalAgentTerminalResult["state"];
}

export type ExternalAgentTurnPreview = Pick<
  ExternalAgentTurnInput,
  "clientMessageId" | "userContent" | "attachments" | "branchGroupId"
>;

/**
 * Drop the branch being replaced. A retried external turn is a new variant of an
 * existing user message, so the transcript has to lose the old turn the moment
 * the retry is previewed — otherwise the same request sits in the transcript
 * twice for as long as the run takes to start, and forever if starting fails.
 */
function withoutReplacedBranch(
  messages: AgentMessage[],
  branchGroupId: string | undefined,
): AgentMessage[] {
  const groupId = branchGroupId?.trim();
  if (!groupId) return messages;
  const branchStart = messages.findIndex(
    (message) =>
      message.clientMessageId === groupId || message.branchGroupId === groupId,
  );
  return branchStart >= 0 ? messages.slice(0, branchStart) : messages;
}

export interface SkillContinuation {
  parentTaskId: string;
  skillId: string;
  capability: string;
  approvedPermissions: string[];
}

export interface AgentSendOptions {
  model?: string;
  reasoningEffort?: AssistantReasoningEffort;
  /** Keep this model-to-model hand-back out of the visible user transcript. */
  internalAgentContinuation?: boolean;
  continuation?: SkillContinuation;
  attachments?: ChatAttachment[];
  confirmedPermissionIds?: string[];
  historyOverride?: AgentMessage[];
  branchGroupId?: string;
  /** Selected assistant text this question quotes or answers in place. */
  textSelection?: ChatTextSelectionReference;
}

interface BranchHistoryReference {
  role: "user" | "assistant";
  clientMessageId?: string;
  messageId?: string;
}

function branchHistoryReferences(
  transcript: readonly AgentMessage[],
): BranchHistoryReference[] {
  return transcript.flatMap((message) => {
    const clientMessageId = message.clientMessageId?.trim();
    const messageId =
      typeof message.id === "string" && /^msg_\d+$/.test(message.id)
        ? message.id
        : undefined;
    if (!clientMessageId && !messageId) return [];
    return [{
      role: message.role,
      ...(clientMessageId ? { clientMessageId } : {}),
      ...(messageId ? { messageId } : {}),
    }];
  });
}

interface BlockedTurn {
  text: string;
  options?: AgentSendOptions;
  userMessageId: string;
  assistantMessageId: string;
}

function normalizeRestoredMessages(value: unknown): AgentMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((message): message is AgentMessage => {
      if (!message || typeof message !== "object") return false;
      const candidate = message as Record<string, unknown>;
      return (
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.content === "string"
      );
    })
    .map((message) => {
      const usage = normalizeChatTokenUsage(message.usage);
      const normalized = { ...message };
      const attachments = normalizeChatMessageAttachments(message.attachments);
      if (attachments.length) normalized.attachments = attachments;
      else delete normalized.attachments;
      if (Array.isArray(message.attachmentNames)) {
        const attachmentNames = message.attachmentNames
          .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
          .map((name) => name.trim().slice(0, 240))
          .slice(0, 12);
        if (attachmentNames.length) normalized.attachmentNames = attachmentNames;
        else delete normalized.attachmentNames;
      } else {
        delete normalized.attachmentNames;
      }
      if (usage) normalized.usage = usage;
      else delete normalized.usage;
      if (
        typeof message.responseDurationMs === "number" &&
        Number.isFinite(message.responseDurationMs) &&
        message.responseDurationMs >= 0
      ) {
        normalized.responseDurationMs = Math.trunc(message.responseDurationMs);
      } else {
        delete normalized.responseDurationMs;
      }
      if (
        typeof message.branchGroupId !== "string" ||
        !message.branchGroupId.trim()
      ) {
        delete normalized.branchGroupId;
      }
      const textSelection = normalizeChatTextSelectionReference(
        message.textSelection,
      );
      if (textSelection) normalized.textSelection = textSelection;
      else delete normalized.textSelection;
      if (message.courseCorrection !== true) {
        delete normalized.courseCorrection;
      }
      if (
        typeof message.courseCorrectionTargetClientMessageId !== "string" ||
        !message.courseCorrectionTargetClientMessageId.trim()
      ) {
        delete normalized.courseCorrectionTargetClientMessageId;
      }
      if (
        typeof message.courseCorrectionOffset !== "number" ||
        !Number.isSafeInteger(message.courseCorrectionOffset) ||
        message.courseCorrectionOffset < 0
      ) {
        delete normalized.courseCorrectionOffset;
      }
      if (
        message.memoryUpdated === true ||
        message.tools?.some(
          (tool) =>
            tool.status === "completed" &&
            tool.toolName.toLowerCase() === "save_memory",
        )
      ) {
        normalized.memoryUpdated = true;
      } else {
        delete normalized.memoryUpdated;
      }
      if (
        typeof message.createdAt !== "string" ||
        !Number.isFinite(Date.parse(message.createdAt))
      ) {
        delete normalized.createdAt;
      }
      if (message.internalAgentContinuation !== true) {
        delete normalized.internalAgentContinuation;
      }
      return normalized;
    });
}

export type ConnectionState =
  "idle" | "connecting" | "streaming" | "waiting" | "error";

export type AgentRunState =
  | "idle"
  | "submitting"
  | "connecting"
  | "running"
  | "waiting_for_permission"
  | "steering"
  | "stopping"
  | "completed"
  | "cancelled"
  | "error";

export function isActiveAgentRunState(state: AgentRunState): boolean {
  return (
    state === "submitting" ||
    state === "connecting" ||
    state === "running" ||
    state === "waiting_for_permission" ||
    state === "steering" ||
    state === "stopping"
  );
}

/**
 * Every per-kind run field an assistant message can carry, paired with the kind
 * it is. The message shape drops the discriminant that `ExternalAgentRun` has,
 * so this list is what puts it back — and it serves both readers of that fact:
 * whether a message is a run card at all, and where its run is stopped.
 */
const EXTERNAL_AGENT_RUN_FIELDS = [
  ["browserRun", "agent_tars"],
  ["agentBrowserRun", "agent_browser"],
  ["agentReachRun", "agent_reach"],
  ["careerOpsRun", "career_ops"],
  ["tradingAgentsRun", "trading_agents"],
  ["vibeTradingRun", "vibe_trading"],
  ["stockAnalystRun", "stock_analyst"],
  ["paperTraderRun", "paper_trader"],
  ["deerFlowRun", "deer_flow"],
  ["deepResearchRun", "deep_research"],
  ["getDocRun", "get_doc"],
  ["meetingNotesRun", "meeting_notes"],
  ["deepTutorRun", "deep_tutor"],
  ["openPlanterRun", "openplanter"],
  ["socialsManagerRun", "socials_manager"],
  ["hardwareBlueprintRun", "hardware_blueprint"],
  ["parametricCadRun", "parametric_cad"],
  ["hyperframesRun", "hyperframes"],
  ["resource2SkillRun", "resource2skill"],
  ["openMontageRun", "openmontage"],
  ["vimaxRun", "vimax"],
  ["shortsRun", "shorts"],
  ["formsmithRun", "formsmith"],
  ["videoUseRun", "video_use"],
  ["moneyPrinterRun", "money_printer"],
  ["legalRun", "legal_agent"],
  ["openworkRun", "openwork"],
  ["openscienceRun", "openscience"],
  ["inboxZeroRun", "inbox_zero"],
  ["openCodeRun", "opencode"],
  ["codexRun", "codex"],
  ["rufloRun", "ruflo"],
] as const satisfies ReadonlyArray<
  readonly [keyof AgentMessage, ExternalAgentRunKind]
>;

/**
 * An assistant message that renders as an external agent's inline run card —
 * a browser operator, research, coding, socials or hardware run — rather than
 * as plain chat text.
 */
export function isExternalAgentRunMessage(message: AgentMessage): boolean {
  return (
    message.role === "assistant" &&
    EXTERNAL_AGENT_RUN_FIELDS.some(([field]) => Boolean(message[field]))
  );
}

/**
 * Where the runs still working in this transcript are stopped. A turn carries
 * one run, but a transcript can hold several in flight, so this reads them all.
 */
export function externalAgentAbortUrls(messages: AgentMessage[]): string[] {
  const urls = new Set<string>();
  for (const message of messages) {
    if (!externalAgentRunInFlight(message)) continue;
    for (const [field, kind] of EXTERNAL_AGENT_RUN_FIELDS) {
      const run = message[field] as
        | { runId?: string; agentId?: string }
        | undefined;
      if (!run?.runId) continue;
      const url = externalAgentAbortUrl(kind, run.runId, run.agentId);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

/**
 * True while an external agent still owns this turn. Those agents execute
 * outside the Hermes run-state machine: their inline card polls the run and
 * `runState` stays "idle", so the message itself is the only authority on
 * whether the conversation is still busy.
 */
export function externalAgentRunInFlight(message: AgentMessage): boolean {
  return (
    isExternalAgentRunMessage(message) &&
    (message.externalAgentOutcome ?? "running") === "running"
  );
}

function connectionForRunState(state: AgentRunState): ConnectionState {
  if (state === "submitting" || state === "connecting") return "connecting";
  if (state === "waiting_for_permission") return "waiting";
  if (state === "running" || state === "steering" || state === "stopping") {
    return "streaming";
  }
  if (state === "error") return "error";
  return "idle";
}

function isExpectedCancellationError(message: string): boolean {
  return /\b(?:abort(?:ed)?|cancel(?:led|ed)?|cancelled_by_user)\b/i.test(
    message,
  );
}

interface CreateOptions {
  gardenSlug?: string;
  pageSlug?: string;
  title?: string;
  /**
   * Create the next conversation off the record: kept out of history and out
   * of memory, both ways, for as long as it exists. Read at creation time, so
   * flipping it only affects chats started afterwards — never the one on
   * screen.
   */
  temporary?: boolean;
}

function activeConversationStorageKey(
  surface: AgentSurface,
  options?: CreateOptions,
): string {
  const context = options?.gardenSlug ?? options?.pageSlug ?? "global";
  return `breadboard-active-conversation:${surface}:${context}`;
}

export interface UseAgentSessionResult {
  sessionId: string | null;
  activeDirectory: string | null;
  filesystemMode: "restricted" | "full";
  messages: AgentMessage[];
  /** A restore or open fetch is in flight; the transcript on screen isn't final. */
  loadingSession: boolean;
  connection: ConnectionState;
  runState: AgentRunState;
  activeRunId: string | null;
  activeInstruction: string | null;
  steerError: string | null;
  error: string | null;
  pendingPermission: PermissionPrompt | null;
  activeTools: ToolActivity[];
  activities: ActivityItem[];
  /**
   * Runtime-agent launches a super-agent turn asked for, in arrival order and
   * never cleared here. The surface owns starting them, and de-duplicates by
   * `requestId`, so this stays a log rather than a queue.
   */
  agentLaunchRequests: AgentLaunchRequestPayload[];
  setMessages: (messages: AgentMessage[]) => void;
  setSessionId: (id: string | null) => void;
  openSession: (id: string, messages?: AgentMessage[]) => Promise<void>;
  refreshSession: () => Promise<void>;
  ensureConversation: (clientMessageId?: string) => Promise<string>;
  /** Arm the next external-agent preview to reuse this assistant turn. */
  beginDelegatedExternalAgentTurn: (clientMessageId: string) => void;
  /** Cancel an armed delegation; true means no launcher ever previewed it. */
  cancelDelegatedExternalAgentTurn: (clientMessageId: string) => boolean;
  /** Returns the durable client id that the launcher must pass to its run API. */
  previewExternalAgentTurn: (input: ExternalAgentTurnPreview) => string;
  appendExternalAgentTurn: (input: ExternalAgentTurnInput) => Promise<void>;
  finishExternalAgentTurn: (input: ExternalAgentTurnResult) => Promise<void>;
  send: (
    text: string,
    options?: AgentSendOptions,
  ) => Promise<void>;
  steer: (text: string) => Promise<boolean>;
  respondToPermission: (
    decision: "once" | "always" | "reject",
  ) => Promise<void>;
  abort: () => Promise<void>;
  reset: () => void;
}

async function ensureSession(
  surface: AgentSurface,
  options: CreateOptions | undefined,
  currentId: string | null,
  current: {
    activeDirectory: string | null;
    filesystemMode: "restricted" | "full";
  },
): Promise<{
  id: string;
  activeDirectory: string | null;
  filesystemMode: "restricted" | "full";
}> {
  if (currentId) return { id: currentId, ...current };
  const response = await fetch("/api/hermes/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ surface, ...options }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : "Could not start an agent session.",
    );
  }
  const data = await response.json();
  notifyHermesSessionsChanged(surface);
  return {
    id: data.session.id as string,
    activeDirectory:
      typeof data.session.activeDirectory === "string"
        ? data.session.activeDirectory
        : null,
    filesystemMode:
      data.session.filesystemMode === "full" ? "full" : "restricted",
  };
}

export function useAgentSession(
  surface: AgentSurface,
  createOptions?: CreateOptions,
): UseAgentSessionResult {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeDirectory, setActiveDirectory] = useState<string | null>(null);
  const [filesystemMode, setFilesystemMode] = useState<"restricted" | "full">(
    "restricted",
  );
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const messagesRef = useRef<AgentMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [runState, setRunState] = useState<AgentRunState>("idle");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeInstruction, setActiveInstruction] = useState<string | null>(null);
  const [steerError, setSteerError] = useState<string | null>(null);
  const [runToResume, setRunToResume] = useState<{
    sessionId: string;
    runId: string;
    instruction: string;
    startedAt?: string;
    clientMessageId?: string;
    viewEpoch: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Starts true: the mount effect below immediately goes looking for the
  // conversation to restore, and until it answers an empty transcript is
  // indistinguishable from a chat whose messages haven't arrived yet.
  const [loadingSession, setLoadingSession] = useState(true);
  const [pendingPermission, setPendingPermission] =
    useState<PermissionPrompt | null>(null);
  const [activeTools, setActiveTools] = useState<ToolActivity[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  // Runtime-agent launches a super-agent turn asked for. Kept as raw requests
  // rather than acted on here: this hook drives the Hermes turn, and starting a
  // runtime agent is the surface's job.
  const [agentLaunchRequests, setAgentLaunchRequests] = useState<
    AgentLaunchRequestPayload[]
  >([]);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const runStateRef = useRef<AgentRunState>("idle");
  const activeRunIdRef = useRef<string | null>(null);
  const externalThinkingTurnIdsRef = useRef(new Set<string>());
  // A background agent belongs to the conversation that launched it, not to
  // whichever conversation happens to be selected when its start request (or
  // terminal event) comes back. Keep that binding outside transcript state so
  // switching chats cannot move a run card -- and therefore its artifacts --
  // into another conversation.
  const externalAgentConversationIdsRef = useRef(new Map<string, string>());
  const unboundExternalTurnIdsRef = useRef(new Set<string>());
  const pendingConversationCreationRef = useRef<{
    viewEpoch: number;
    promise: ReturnType<typeof ensureSession>;
  } | null>(null);
  const pendingDelegatedExternalTurnRef = useRef<string | null>(null);
  const delegatedExternalTurnIdsRef = useRef(new Set<string>());
  const activeStreamRef = useRef<Promise<"completed" | "cancelled" | "failed"> | null>(null);
  const steeringRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const resumedRunIdRef = useRef<string | null>(null);
  const blockedTurnRef = useRef<BlockedTurn | null>(null);
  const pendingHistoryOverrideRef = useRef<AgentMessage[] | null>(null);
  const viewEpochRef = useRef(0);
  const latestSendOptionsRef = useRef<{
    model?: string;
    reasoningEffort?: AssistantReasoningEffort;
  }>({});
  const [yoloMode] = useYoloMode();
  const yoloSyncRef = useRef<Promise<void>>(Promise.resolve());
  const storageKey = activeConversationStorageKey(surface, createOptions);
  const temporaryChats = createOptions?.temporary === true;

  /**
   * Remember where the reader was, so a reload comes back to it — unless this
   * is a temporary chat, which is deliberately not somewhere you can come back
   * to. The server already keeps temporary chats out of the restore list; not
   * writing the id keeps the browser from holding a pointer to one either.
   */
  const rememberActiveConversation = useCallback(
    (id: string) => {
      if (temporaryChats) return;
      window.localStorage.setItem(storageKey, id);
      window.localStorage.setItem("breadboard-active-conversation", id);
    },
    [storageKey, temporaryChats],
  );

  const transition = useCallback((next: AgentRunState) => {
    runStateRef.current = next;
    setRunState(next);
    setConnection(connectionForRunState(next));
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    if (sessionRef.current) {
      updateCachedHermesSessionMessages(surface, sessionRef.current, messages);
    }
  }, [messages, surface]);

  useEffect(() => {
    if (!sessionId || sessionRef.current !== sessionId) return;
    for (const message of messages) {
      const clientMessageId = message.clientMessageId?.trim();
      if (clientMessageId && isExternalAgentRunMessage(message)) {
        externalAgentConversationIdsRef.current.set(clientMessageId, sessionId);
      }
    }
  }, [messages, sessionId]);

  // Breadboard owns the durable transcript. Restore the newest matching
  // runtime session after a refresh; Hermes ids remain server-side.
  useEffect(() => {
    let cancelled = false;
    setLoadingSession(true);
    void loadHermesSessionSummaries(surface)
      .then(async (sessions) => {
        if (cancelled || sessionRef.current) return;
        const preferredId =
          window.localStorage.getItem(storageKey) ??
          window.localStorage.getItem("breadboard-active-conversation");
        const selected = selectRestorableAgentSession(
          sessions,
          preferredId,
          {
            gardenSlug: createOptions?.gardenSlug,
            pageSlug: createOptions?.pageSlug,
          },
        );
        if (!selected) return;
        primeInlineArtifacts({ conversationId: selected.id });
        const restored = await loadHermesSessionDetail(surface, selected.id);
        if (cancelled || sessionRef.current) return;
        if (restored.id !== selected.id) return;
        sessionRef.current = selected.id;
        setSessionId(selected.id);
        window.localStorage.setItem(storageKey, selected.id);
        window.localStorage.setItem("breadboard-active-conversation", selected.id);
        setActiveDirectory(
          typeof restored.activeDirectory === "string"
            ? restored.activeDirectory
            : null,
        );
        setFilesystemMode(
          restored.filesystemMode === "full" ? "full" : "restricted",
        );
        setMessages(normalizeRestoredMessages(restored.messages));
        const restoredRun =
          restored.activeRun && typeof restored.activeRun === "object"
            ? (restored.activeRun as Record<string, unknown>)
            : null;
        if (
          restoredRun &&
          typeof restoredRun.id === "string" &&
          typeof restoredRun.instruction === "string"
        ) {
          activeRunIdRef.current = restoredRun.id;
          setActiveRunId(restoredRun.id);
          setActiveInstruction(restoredRun.instruction);
          transition("connecting");
          setRunToResume({
            sessionId: selected.id,
            runId: restoredRun.id,
            instruction: restoredRun.instruction,
            startedAt:
              typeof restoredRun.startedAt === "string"
                ? restoredRun.startedAt
                : undefined,
            clientMessageId:
              typeof restoredRun.clientMessageId === "string"
                ? restoredRun.clientMessageId
                : undefined,
            viewEpoch: viewEpochRef.current,
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    surface,
    createOptions?.gardenSlug,
    createOptions?.pageSlug,
    storageKey,
    transition,
  ]);

  // Component teardown detaches this page's viewer only. The server-owned pump
  // continues consuming and persisting the active Hermes run.
  useEffect(
    () => () => {
      viewEpochRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  const streamEvents = useCallback(
    async (
      activeSessionId: string,
      assistant: AgentMessage,
      commit: (message: AgentMessage) => void,
      onConnected: () => void,
      responseStartedAtMs: number,
      reconnectAttempt = 0,
      controller = new AbortController(),
      seenEventFrames = new Set<string>(),
    ): Promise<"completed" | "cancelled" | "failed"> => {
      abortRef.current = controller;
      const streamContext = new URLSearchParams({ surface });
      if (createOptions?.gardenSlug) streamContext.set("gardenSlug", createOptions.gardenSlug);
      if (createOptions?.pageSlug) streamContext.set("pageSlug", createOptions.pageSlug);
      const decoder = new TextDecoder();
      let buffer = "";
      let failed = false;
      let connected = false;
      let sawTurnActivity = false;
      const tools = new Map<string, ToolActivity>();
      for (const tool of assistant.tools ?? []) tools.set(tool.toolCallId, tool);
      // Mid-turn narration sealed off the answer bubble (text the model wrote
      // before/between tool calls). Kept so an aborted or answerless turn can
      // fall back to its last words instead of an empty message.
      const narrationSegments: string[] = [];
      const upsertActivity = (item: ActivityItem) => {
        setActivities((current) => {
          const index = current.findIndex(
            (candidate) => candidate.id === item.id,
          );
          if (index < 0) return [...current, item];
          const next = [...current];
          next[index] = {
            ...next[index],
            ...item,
            // Repeated reasoning/tool events update status and detail without
            // restarting the full response timer.
            startedAt: next[index].startedAt,
          };
          return next;
        });
      };

      const commitResponseDuration = (completedAtMs = Date.now()) => {
        assistant = {
          ...assistant,
          responseDurationMs: Math.max(0, completedAtMs - responseStartedAtMs),
        };
        commit(assistant);
      };

      const flushAssistant = () => {
        assistant = { ...assistant, tools: Array.from(tools.values()) };
        commit(assistant);
      };

      const retryAfterDisconnect = async (
        streamError: unknown,
      ): Promise<"completed" | "cancelled" | "failed"> => {
        const delayMs = agentStreamReconnectDelay(reconnectAttempt);
        if (
          failed ||
          stopRequestedRef.current ||
          controller.signal.aborted ||
          delayMs === null ||
          !isRecoverableAgentStreamDisconnect(streamError)
        ) {
          throw streamError;
        }
        transition("connecting");
        await waitForAgentStreamReconnect(delayMs, controller.signal);
        return streamEvents(
          activeSessionId,
          assistant,
          commit,
          onConnected,
          responseStartedAtMs,
          reconnectAttempt + 1,
          controller,
          seenEventFrames,
        );
      };

      try {
        const response = await fetch(
          `/api/hermes/sessions/${activeSessionId}/events?${streamContext.toString()}`,
          {
            method: "GET",
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          },
        );
        if (!response.ok || !response.body) {
          throw response.status >= 500
            ? new AgentStreamDisconnectedError(
                `The agent event stream returned ${response.status}.`,
              )
            : new Error("Could not open the agent event stream.");
        }
        const reader = response.body.getReader();
        for (;;) {
          const timeout = agentStreamTimeout({
            connected,
            sawTurnActivity,
            waitingForPermission:
              runStateRef.current === "waiting_for_permission",
          });
          const { done, value } = await withAgentStreamTimeout(
            reader.read(),
            timeout,
          );
          if (done) {
            throw new AgentStreamDisconnectedError();
          }
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            if (
              frame
                .split("\n")
                .some((line) => line.trim() === ": connected")
            ) {
              connected = true;
              onConnected();
              continue;
            }
            const dataLine = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("");
            if (!dataLine) continue;
            // A surviving server-side pump replays its buffered chunks to a
            // replacement SSE viewer. Ignore byte-identical frames already
            // handled by this turn so reconnecting cannot duplicate answer
            // deltas or tool activity in the transcript.
            if (seenEventFrames.has(dataLine)) continue;
            seenEventFrames.add(dataLine);
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(dataLine);
            } catch {
              continue;
            }
            const payload = (event.payload ?? {}) as Record<string, unknown>;
            if (isAgentStreamTurnActivity(event.type, payload)) {
              sawTurnActivity = true;
              reconnectAttempt = 0;
            }
            if (
              typeof event.type === "string" &&
              event.type.startsWith("artifact.")
            ) {
              const artifactActivityId =
                typeof payload.artifactId === "string"
                  ? `artifact-${payload.artifactId}`
                  : null;
              if (artifactActivityId) {
                const metadata =
                  payload.metadata && typeof payload.metadata === "object"
                    ? (payload.metadata as Record<string, unknown>)
                    : {};
                setActivities((current) => {
                  const existing = current.find(
                    (item) => item.id === artifactActivityId,
                  );
                  const title =
                    typeof metadata.title === "string" && metadata.title.trim()
                      ? metadata.title.trim()
                      : existing?.detail || "artifact";
                  const failed =
                    event.type === "artifact.failed" || payload.status === "failed";
                  const completed =
                    event.type === "artifact.completed" || payload.status === "ready";
                  const item: ActivityItem = {
                    id: artifactActivityId,
                    kind: "artifact",
                    label: failed
                      ? `Could not build ${title}`
                      : `Building ${title}…`,
                    detail: title,
                    status: failed ? "failed" : completed ? "completed" : "running",
                    startedAt:
                      existing?.startedAt ??
                      (typeof event.timestamp === "string"
                        ? event.timestamp
                        : new Date().toISOString()),
                    ...(failed || completed
                      ? { completedAt: new Date().toISOString() }
                      : {}),
                  };
                  return existing
                    ? current.map((candidate) =>
                        candidate.id === artifactActivityId ? item : candidate,
                      )
                    : [...current, item];
                });
              }
              if (typeof payload.assistantMessageId === "string") {
                assistant = {
                  ...assistant,
                  artifactMessageId: payload.assistantMessageId,
                };
                commit(assistant);
              }
              window.dispatchEvent(
                new CustomEvent("breadboard:artifact-event", {
                  detail: { type: event.type, ...payload },
                }),
              );
              continue;
            }
            // Subagent delegation events feed the "company" org-chart panel. Like
            // artifact events, re-broadcast on window and skip the chat activity
            // switch so the tree stays decoupled from the message transcript.
            if (event.type === "subagent.update") {
              window.dispatchEvent(
                new CustomEvent("breadboard:subagent-event", {
                  detail: { ...payload },
                }),
              );
              continue;
            }
            switch (event.type) {
            case "assistant.delta":
              assistant = {
                ...assistant,
                content: assistant.content + String(payload.text ?? ""),
              };
              upsertActivity({
                id: "writing-answer",
                kind: "answer",
                label: "Writing answer",
                status: "running",
                startedAt: new Date().toISOString(),
              });
              commit(assistant);
              break;
            case "assistant.segment": {
              // Everything streamed since the last seal was narration written
              // around tool calls, not the answer. Move it out of the bubble so
              // an agentic turn ends with just its final message instead of
              // every status note glued together.
              const sealed = payload.streamed
                ? assistant.content || String(payload.text ?? "")
                : String(payload.text ?? "");
              if (sealed.trim()) {
                narrationSegments.push(sealed);
                upsertActivity({
                  id: `narration-${narrationSegments.length}`,
                  kind: "answer",
                  label: "Progress note",
                  detail: sealed,
                  status: "completed",
                  startedAt: new Date().toISOString(),
                  completedAt: new Date().toISOString(),
                });
              }
              if (payload.streamed && assistant.content) {
                assistant = { ...assistant, content: "" };
                commit(assistant);
              }
              break;
            }
            case "reasoning.status":
              if (typeof payload.detail === "string" && payload.detail) {
                assistant = {
                  ...assistant,
                  reasoning:
                    payload.detailMode === "replace"
                      ? payload.detail
                      : `${assistant.reasoning ?? ""}${payload.detail}`,
                };
                commit(assistant);
              }
              upsertActivity({
                id: "reasoning",
                kind: "reasoning",
                label: String(payload.label ?? "Thinking"),
                status: "running",
                startedAt: new Date().toISOString(),
              });
              break;
            case "assistant.completed": {
              const usage = normalizeChatTokenUsage(payload.usage);
              const replacementText =
                typeof payload.replacementText === "string"
                  ? payload.replacementText
                  : undefined;
              if (usage || replacementText !== undefined) {
                assistant = {
                  ...assistant,
                  ...(usage ? { usage } : {}),
                  ...(replacementText !== undefined
                    ? { content: replacementText }
                    : {}),
                };
                commit(assistant);
              }
              break;
            }
            case "tool.started":
              tools.set(String(payload.toolCallId), {
                toolCallId: String(payload.toolCallId),
                toolName: String(payload.toolName),
                summary: payload.summary as string | undefined,
                status: "running",
              });
              setActiveTools(Array.from(tools.values()));
              upsertActivity({
                id: `tool-${String(payload.toolCallId)}`,
                kind: evidenceKindForTool(String(payload.toolName)),
                label: activityLabelForTool(String(payload.toolName)),
                detail: payload.summary as string | undefined,
                status: "running",
                startedAt: new Date().toISOString(),
                toolCallId: String(payload.toolCallId),
              });
              flushAssistant();
              break;
            case "tool.completed": {
              const id = String(payload.toolCallId);
              const existing = tools.get(id);
              tools.set(id, {
                toolCallId: id,
                toolName: String(payload.toolName),
                summary:
                  (payload.summary as string | undefined) ?? existing?.summary,
                status: payload.success ? "completed" : "failed",
              });
              if (payload.success && String(payload.toolName) === "save_memory") {
                assistant = { ...assistant, memoryUpdated: true };
              }
              setActiveTools(Array.from(tools.values()));
              upsertActivity({
                id: `tool-${id}`,
                kind: evidenceKindForTool(String(payload.toolName)),
                label: activityLabelForTool(String(payload.toolName)),
                detail:
                  (payload.summary as string | undefined) ?? existing?.summary,
                status: payload.success ? "completed" : "failed",
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                toolCallId: id,
              });
              flushAssistant();
              break;
            }
            case "agent.launch_requested": {
              const request = parseAgentLaunchRequest(event);
              if (request) {
                setAgentLaunchRequests((current) =>
                  current.some(
                    (item) => item.requestId === request.requestId,
                  )
                    ? current
                    : [...current, request],
                );
              }
              break;
            }
            case "permission.requested": {
              const prompt: PermissionPrompt = {
                requestId: String(payload.requestId),
                permission: String(payload.permission),
                description: String(payload.description),
                risk: payload.risk as PermissionRisk,
                affectedPaths: Array.isArray(payload.affectedPaths)
                  ? payload.affectedPaths.filter(
                      (value): value is string => typeof value === "string",
                    )
                  : [],
                command: payload.command as string | undefined,
                sourcePath: payload.sourcePath as string | undefined,
                destinationPath: payload.destinationPath as string | undefined,
                allowSession: payload.allowSession === true,
              };
              if (isYoloModeEnabled()) {
                setPendingPermission(null);
                if (runStateRef.current !== "stopping") transition("running");
                try {
                  await submitPermissionDecision(
                    prompt.requestId,
                    activeSessionId,
                    "once",
                  );
                } catch (permissionError) {
                  transition("error");
                  setError(
                    permissionError instanceof Error
                      ? permissionError.message
                      : "Automatic permission approval failed.",
                  );
                }
                break;
              }
              setPendingPermission(prompt);
              upsertActivity({
                id: `permission-${prompt.requestId}`,
                kind: "permission",
                label: "Permission required",
                detail: prompt.description,
                status: "permission_required",
                startedAt: new Date().toISOString(),
              });
              if (runStateRef.current !== "stopping") {
                transition("waiting_for_permission");
              }
              break;
            }
            case "session.status":
              if (runStateRef.current !== "stopping") {
                if (payload.status === "waiting") {
                  transition("waiting_for_permission");
                } else if (
                  payload.status === "busy" &&
                  runStateRef.current !== "steering"
                ) {
                  transition("running");
                }
              }
              break;
            case "error":
              {
                const message = String(
                  payload.message ?? "The agent reported an error.",
                );
                if (
                  stopRequestedRef.current &&
                  isExpectedCancellationError(message)
                ) {
                  setError(null);
                  break;
                }
                failed = true;
                setError(message);
              }
              break;
            case "verification.updated":
              assistant = {
                ...assistant,
                verification: payload as unknown as VerificationSummary,
              };
              commit(assistant);
              break;
            case "cancelled":
              failed = false;
              setError(null);
              commitResponseDuration();
              setActivities((current) =>
                current.map((item) =>
                  item.status === "running" ||
                  item.status === "permission_required"
                    ? {
                        ...item,
                        status: "cancelled",
                        completedAt: new Date().toISOString(),
                      }
                    : item,
                ),
              );
              assistant = {
                ...assistant,
                interrupted: true,
                // A turn stopped after its text was sealed as narration keeps
                // its last words as the partial answer (mirrors the server's
                // finalize promotion, so the reload shows the same thing).
                ...(!assistant.content.trim() && narrationSegments.length
                  ? { content: narrationSegments[narrationSegments.length - 1] }
                  : {}),
              };
              commit(assistant);
              return "cancelled";
            case "done":
              if (!assistant.content.trim() && narrationSegments.length) {
                assistant = {
                  ...assistant,
                  content: narrationSegments[narrationSegments.length - 1],
                };
                commit(assistant);
              }
              // The answer was assembled here from stream deltas, and this hook
              // keeps it rather than refetching — so without this the bubble on
              // screen would still carry the invisible-Unicode marks the store
              // already had removed, and copying the answer would copy them.
              //
              // Only at `done`, never per delta: the decision to keep or remove
              // a zero-width joiner depends on the character before it, and a
              // chunk boundary falling between an emoji and its joiner would
              // make that decision wrong and break the emoji.
              {
                const clean = scrubbed(assistant.content);
                if (clean !== assistant.content) {
                  assistant = { ...assistant, content: clean };
                  commit(assistant);
                }
              }
              commitResponseDuration();
              setActivities((current) =>
                current.map((item) =>
                  item.status === "running"
                    ? {
                        ...item,
                        status: "completed",
                        completedAt: new Date().toISOString(),
                      }
                    : item,
                ),
              );
              if (!failed && surface !== "quartz_ai") {
                notifyHermesSessionsChanged(surface);
              }
              return failed ? "failed" : "completed";
            default:
              break;
            }
          }
        }
      } catch (streamError) {
        if ((streamError as Error).name === "AbortError") {
          throw streamError;
        }
        if (
          isRecoverableAgentStreamDisconnect(streamError) &&
          !failed
        ) {
          return retryAfterDisconnect(streamError);
        }
        commitResponseDuration();
        setActivities((current) =>
          current.map((item) =>
            item.status === "running" || item.status === "permission_required"
              ? {
                  ...item,
                  status: "failed",
                  completedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
        if (isAgentStreamTimeoutError(streamError)) {
          controller.abort();
          await fetch(
            `/api/hermes/sessions/${activeSessionId}/abort`,
            { method: "POST" },
          ).catch(() => undefined);
        }
        throw streamError;
      }
    },
    [createOptions?.gardenSlug, createOptions?.pageSlug, surface, transition],
  );

  const adoptDispatchedRun = useCallback(
    async (
      activeSessionId: string,
      runId: string,
      instruction: string,
      startedAt?: string,
      clientMessageId?: string,
      viewEpoch = viewEpochRef.current,
    ) => {
      await activeStreamRef.current?.catch(() => undefined);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (viewEpochRef.current !== viewEpoch) return;

      const parsedStartedAt = startedAt ? Date.parse(startedAt) : Number.NaN;
      const responseStartedAtMs = Number.isFinite(parsedStartedAt)
        ? parsedStartedAt
        : Date.now();
      const restoredAssistant = [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            (clientMessageId
              ? message.clientMessageId === clientMessageId
              : !message.content),
        );
      const assistant: AgentMessage = restoredAssistant
        ? { ...restoredAssistant, sources: [], tools: [] }
        : {
            id: crypto.randomUUID(),
            clientMessageId,
            createdAt: new Date(responseStartedAtMs).toISOString(),
            role: "assistant",
            content: "",
            sources: [],
            tools: [],
          };
      if (!restoredAssistant) {
        setMessages((current) => [...current, assistant]);
      }
      const commit = (message: AgentMessage) => {
        if (viewEpochRef.current !== viewEpoch) return;
        setMessages((current) => {
          const next = [...current];
          const index = next.findIndex(
            (candidate) => candidate.id === assistant.id,
          );
          if (index >= 0) next[index] = { ...message };
          return next;
        });
      };

      activeRunIdRef.current = runId;
      setActiveRunId(runId);
      setActiveInstruction(instruction);
      setError(null);
      setActiveTools([]);
      setActivities([
        {
          id: "reasoning",
          kind: "reasoning",
          label: "Thinking",
          status: "running",
          startedAt: new Date(responseStartedAtMs).toISOString(),
        },
      ]);
      transition("connecting");

      let adoptedStream: Promise<"completed" | "cancelled" | "failed"> | null = null;
      let streamController: AbortController | null = null;
      try {
        let markConnected!: () => void;
        const connected = new Promise<void>((resolve) => {
          markConnected = resolve;
        });
        const streamPromise = streamEvents(
          activeSessionId,
          assistant,
          commit,
          markConnected,
          responseStartedAtMs,
        );
        adoptedStream = streamPromise;
        streamController = abortRef.current;
        activeStreamRef.current = streamPromise;
        await Promise.race([
          connected,
          streamPromise.then(() => {
            throw new Error(
              "The follow-up event stream closed before it became ready.",
            );
          }),
        ]);
        if (viewEpochRef.current !== viewEpoch) {
          streamController?.abort();
          return;
        }
        if (activeRunIdRef.current === runId) transition("running");
        const outcome = await streamPromise;
        if (
          viewEpochRef.current !== viewEpoch ||
          activeRunIdRef.current !== runId
        ) {
          return;
        }
        activeRunIdRef.current = null;
        setActiveRunId(null);
        if (outcome === "cancelled") {
          setError(null);
          transition("cancelled");
        }
        else if (outcome === "failed") transition("error");
        else {
          transition("completed");
          if (surface !== "quartz_ai") notifyTaskCompleted(instruction);
        }
      } catch (streamError) {
        if (viewEpochRef.current !== viewEpoch) return;
        if ((streamError as Error).name !== "AbortError") {
          setError(
            streamError instanceof Error
              ? streamError.message
              : "The follow-up event stream failed.",
          );
          transition("error");
        }
      } finally {
        if (activeStreamRef.current === adoptedStream) {
          activeStreamRef.current = null;
        }
        if (abortRef.current === streamController) {
          abortRef.current = null;
        }
      }
    },
    [messages, streamEvents, surface, transition],
  );

  useEffect(() => {
    if (!runToResume || resumedRunIdRef.current === runToResume.runId) return;
    resumedRunIdRef.current = runToResume.runId;
    void adoptDispatchedRun(
      runToResume.sessionId,
      runToResume.runId,
      runToResume.instruction,
      runToResume.startedAt,
      runToResume.clientMessageId,
      runToResume.viewEpoch,
    );
  }, [adoptDispatchedRun, runToResume]);

  const ensureConversation = useCallback(async (clientMessageId?: string): Promise<string> => {
    const externalTurnId = clientMessageId?.trim() ?? "";
    const boundConversationId = externalTurnId
      ? externalAgentConversationIdsRef.current.get(externalTurnId)
      : undefined;
    if (boundConversationId) return boundConversationId;

    const startingSessionId = sessionRef.current;
    const startingViewEpoch = viewEpochRef.current;
    let creation = pendingConversationCreationRef.current;
    if (
      startingSessionId ||
      !creation ||
      creation.viewEpoch !== startingViewEpoch
    ) {
      creation = {
        viewEpoch: startingViewEpoch,
        promise: ensureSession(
          surface,
          createOptions,
          startingSessionId,
          { activeDirectory, filesystemMode },
        ),
      };
      if (!startingSessionId) pendingConversationCreationRef.current = creation;
    }
    let ensured: Awaited<ReturnType<typeof ensureSession>>;
    try {
      ensured = await creation.promise;
    } finally {
      if (pendingConversationCreationRef.current === creation) {
        pendingConversationCreationRef.current = null;
      }
    }
    // `ensureSession` may have created a conversation while the person opened
    // another one. Return the launch conversation to the caller, but never
    // steal the visible selection back from the newer view.
    if (
      viewEpochRef.current === startingViewEpoch &&
      sessionRef.current === startingSessionId
    ) {
      sessionRef.current = ensured.id;
      setSessionId(ensured.id);
      rememberActiveConversation(ensured.id);
      setActiveDirectory(ensured.activeDirectory);
      setFilesystemMode(ensured.filesystemMode);
    }
    if (externalTurnId) {
      if (!externalAgentConversationIdsRef.current.has(externalTurnId)) {
        externalAgentConversationIdsRef.current.set(externalTurnId, ensured.id);
      }
      unboundExternalTurnIdsRef.current.delete(externalTurnId);
    }
    return ensured.id;
  }, [
    activeDirectory,
    createOptions,
    filesystemMode,
    rememberActiveConversation,
    surface,
  ]);

  const beginDelegatedExternalAgentTurn = useCallback(
    (clientMessageId: string) => {
      const origin = clientMessageId.trim();
      if (origin) pendingDelegatedExternalTurnRef.current = origin;
    },
    [],
  );

  const cancelDelegatedExternalAgentTurn = useCallback(
    (clientMessageId: string) => {
      if (pendingDelegatedExternalTurnRef.current === clientMessageId.trim()) {
        pendingDelegatedExternalTurnRef.current = null;
        return true;
      }
      if (delegatedExternalTurnIdsRef.current.has(clientMessageId.trim())) {
        delegatedExternalTurnIdsRef.current.delete(clientMessageId.trim());
        return true;
      }
      return false;
    },
    [],
  );

  const bindExternalAgentToCurrentConversation = useCallback(
    (clientMessageId: string) => {
      const conversationId = sessionRef.current;
      if (conversationId) {
        externalAgentConversationIdsRef.current.set(clientMessageId, conversationId);
      } else {
        unboundExternalTurnIdsRef.current.add(clientMessageId);
      }
    },
    [],
  );

  const previewExternalAgentTurn = useCallback(
    (input: ExternalAgentTurnPreview) => {
      // External agents own their response card. Clear feedback left by an
      // earlier Hermes request so it cannot appear as part of this turn.
      setError(null);
      setSteerError(null);
      if (!isActiveAgentRunState(runStateRef.current)) {
        transition("idle");
        setActivities([]);
      }
      const createdAt = new Date().toISOString();
      const delegatedOrigin = pendingDelegatedExternalTurnRef.current;
      pendingDelegatedExternalTurnRef.current = null;
      const clientMessageId = delegatedOrigin ?? input.clientMessageId;
      const delegated = Boolean(delegatedOrigin);
      bindExternalAgentToCurrentConversation(clientMessageId);
      // User-started launches get a pending assistant row while their run API
      // starts. Delegations already have their owning assistant row, so they
      // leave it in place until the inline card or start failure is attached.
      if (delegated) {
        delegatedExternalTurnIdsRef.current.add(clientMessageId);
      } else {
        externalThinkingTurnIdsRef.current.add(clientMessageId);
        setConnection("streaming");
      }
      setMessages((current) => {
        if (
          current.some(
            (message) =>
              message.role === "assistant" &&
              message.clientMessageId === clientMessageId,
          )
        ) {
          return current;
        }
        // A delegation is never allowed to fall back to the ordinary preview:
        // that would manufacture the exact `/agents:*` user bubble this path
        // exists to avoid if the person switched conversations mid-launch.
        if (delegated) return current;
        const preview: AgentMessage[] = [
          ...withoutReplacedBranch(current, input.branchGroupId),
          {
            id: clientMessageId,
            clientMessageId,
            role: "user",
            content: input.userContent,
            createdAt,
            ...(input.attachments?.length
              ? {
                  attachments: input.attachments,
                  attachmentNames: input.attachments.map(
                    (attachment) => attachment.name,
                  ),
                }
              : {}),
          },
          {
            id: `external-thinking-${clientMessageId}`,
            clientMessageId,
            role: "assistant",
            content: "",
            createdAt,
          },
        ];
        return preview;
      });
      return clientMessageId;
    },
    [bindExternalAgentToCurrentConversation, transition],
  );

  const appendExternalAgentTurn = useCallback(
    async (input: ExternalAgentTurnInput) => {
      const showedThinking = externalThinkingTurnIdsRef.current.has(input.clientMessageId);
      const attachToExistingTurn =
        input.attachToExistingTurn === true ||
        delegatedExternalTurnIdsRef.current.has(input.clientMessageId);
      try {
        const targetSessionId =
          externalAgentConversationIdsRef.current.get(input.clientMessageId) ??
          (await ensureConversation(input.clientMessageId));
        externalAgentConversationIdsRef.current.set(
          input.clientMessageId,
          targetSessionId,
        );
        const response = await fetch(
          `/api/hermes/sessions/${targetSessionId}/external-turns`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...input,
              attachToExistingTurn,
              surface,
            }),
          },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "The external agent turn could not be saved.",
          );
        }
        const restored = normalizeRestoredMessages(body.messages);
        const expectedMessageCount = attachToExistingTurn ? 1 : 2;
        if (restored.length !== expectedMessageCount) {
          throw new Error("The external agent turn returned an invalid transcript.");
        }
        // The durable write above always targets the launch conversation. Only
        // mirror it into React state when that conversation is still visible;
        // otherwise the newly selected transcript must remain untouched.
        if (sessionRef.current !== targetSessionId) return;
        setMessages((current) =>
          attachToExistingTurn
            ? current.map((message) =>
                message.role === "assistant" &&
                message.clientMessageId === input.clientMessageId
                  ? restored[0]!
                  : message,
              )
            : [
                ...withoutReplacedBranch(
                  current.filter(
                    (message) => message.clientMessageId !== input.clientMessageId,
                  ),
                  input.branchGroupId,
                ),
                ...restored,
              ],
        );
      } catch (appendError) {
        if (showedThinking) {
          setMessages((current) => current.filter(
            (message) => message.id !== `external-thinking-${input.clientMessageId}`,
          ));
        }
        throw appendError;
      } finally {
        delegatedExternalTurnIdsRef.current.delete(input.clientMessageId);
        if (showedThinking) {
          externalThinkingTurnIdsRef.current.delete(input.clientMessageId);
          if (!isActiveAgentRunState(runStateRef.current)) setConnection("idle");
        }
      }
    },
    [ensureConversation, surface],
  );

  const finishExternalAgentTurn = useCallback(
    async (input: ExternalAgentTurnResult) => {
      const targetSessionId =
        externalAgentConversationIdsRef.current.get(input.clientMessageId) ??
        sessionRef.current;
      if (!targetSessionId) return;
      const response = await fetch(
        `/api/hermes/sessions/${targetSessionId}/external-turns`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "The external agent result could not be saved.",
        );
      }
      const [restored] = normalizeRestoredMessages([body.message]);
      if (!restored) return;
      if (sessionRef.current !== targetSessionId) return;
      setMessages((current) =>
        current.map((message) =>
          message.role === "assistant" &&
          message.clientMessageId === input.clientMessageId
            ? restored
            : message,
        ),
      );
      if (input.outcome === "completed" && surface !== "quartz_ai") {
        notifyHermesSessionsChanged(surface);
      }
    },
    [surface],
  );

  /**
   * The Agent-mode-off turn: the answer arrives on this request instead of on the
   * session's event stream, because no runtime run exists to stream from. The
   * server owns the transcript either way, so this only has to render what comes
   * back and leave the same terminal run state behind as an agent turn does.
   */
  const streamDirectTurn = useCallback(
    async (input: {
      sessionId: string;
      text: string;
      assistant: AgentMessage;
      commit: (message: AgentMessage) => void;
      options?: AgentSendOptions;
      retry: boolean;
      responseStartedAtMs: number;
      viewEpoch: number;
      currentLocation?: CurrentLocationSnapshot;
    }): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;
      let assistant = input.assistant;
      const response = await fetch(
        `/api/hermes/sessions/${input.sessionId}/direct`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            clientMessageId: assistant.clientMessageId,
            text: input.text,
            surface,
            model: input.options?.model,
            reasoningEffort: input.options?.reasoningEffort,
            attachments: input.options?.attachments,
            branchGroupId: input.options?.branchGroupId,
            internalAgentContinuation:
              input.options?.internalAgentContinuation === true,
            retry: input.retry,
            adhdMode: isDirectModeEnabled(),
            currentLocation: input.currentLocation,
          }),
        },
      );
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "The model provider could not answer this message.",
        );
      }
      transition("running");
      setActivities((current) =>
        current.map((item) =>
          item.id === "reasoning" && item.status === "running"
            ? { ...item, label: "Answering" }
            : item,
        ),
      );

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failure: string | null = null;
      let reasoning = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (!data || data === "[DONE]") continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(data) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (event.type === "delta" && typeof event.text === "string") {
            assistant = { ...assistant, content: assistant.content + event.text };
          } else if (event.type === "replace" && typeof event.text === "string") {
            assistant = { ...assistant, content: event.text };
          } else if (event.type === "thinking" && typeof event.text === "string") {
            reasoning += event.text;
            assistant = { ...assistant, reasoning };
          } else if (event.type === "usage") {
            const usage = normalizeChatTokenUsage(event.usage);
            if (usage) assistant = { ...assistant, usage };
          } else if (event.type === "error" && typeof event.message === "string") {
            failure = event.message;
          }
          if (input.viewEpoch !== viewEpochRef.current) return;
          input.commit(assistant);
        }
      }

      if (input.viewEpoch !== viewEpochRef.current) return;
      const completedAt = new Date().toISOString();
      input.commit({
        ...assistant,
        responseDurationMs: Math.max(0, Date.now() - input.responseStartedAtMs),
      });
      setActivities((current) =>
        current.map((item) =>
          item.status === "running"
            ? { ...item, status: "completed", completedAt }
            : item,
        ),
      );
      // A provider that failed with nothing on screen is a failed turn; one that
      // failed mid-answer already showed what it produced, so the text stands and
      // the reason is surfaced beside it.
      if (failure && !assistant.content.trim()) throw new Error(failure);
      if (failure) setError(failure);
      transition("completed");
      if (surface !== "quartz_ai") {
        notifyHermesSessionsChanged(surface);
        notifyTaskCompleted(input.text);
      }
    },
    [surface, transition],
  );

  const send = useCallback(
    async (text: string, options?: AgentSendOptions) => {
      const trimmed = text.trim();
      if (!trimmed || isActiveAgentRunState(runStateRef.current)) return;
      const viewEpoch = viewEpochRef.current;
      const resumedBlockedTurn =
        blockedTurnRef.current?.text === trimmed ? blockedTurnRef.current : null;
      const selectedHistory =
        options?.historyOverride ?? pendingHistoryOverrideRef.current ?? undefined;
      const transcript = resumedBlockedTurn
        ? messages.filter(
            (message) =>
              message.id !== resumedBlockedTurn.userMessageId &&
              message.id !== resumedBlockedTurn.assistantMessageId,
          )
        : selectedHistory ?? messages;
      const priorLocationRequests = transcript
        .filter(
          (message) =>
            message.role === "user" &&
            message.internalAgentContinuation !== true,
        )
        .slice(-8)
        .map((message) => message.content);
      const locationPreference = getStoredCurrentLocationPreference(
        window.localStorage,
      );
      const currentLocation =
        options?.internalAgentContinuation !== true &&
        locationPreference.useForAnswers &&
        locationPreference.state === "available" &&
        locationPreference.snapshot &&
        requestUsesCurrentLocation(trimmed, priorLocationRequests)
          ? locationPreference.snapshot
          : undefined;
      const branchHistory =
        selectedHistory !== undefined
          ? branchHistoryReferences(selectedHistory)
          : undefined;
      if (resumedBlockedTurn) blockedTurnRef.current = null;
      latestSendOptionsRef.current = {
        model: options?.model,
        reasoningEffort: options?.reasoningEffort,
      };
      stopRequestedRef.current = false;
      setError(null);
      setSteerError(null);
      setActiveInstruction(trimmed);
      setActiveRunId(null);
      activeRunIdRef.current = null;
      transition("submitting");
      setActiveTools([]);
      const responseStartedAtMs = Date.now();
      const resumedCreatedAt = resumedBlockedTurn
        ? messages.find(
            (message) => message.id === resumedBlockedTurn.userMessageId,
          )?.createdAt
        : undefined;
      const turnCreatedAt =
        resumedCreatedAt ?? new Date(responseStartedAtMs).toISOString();
      setActivities([
        {
          id: "reasoning",
          kind: "reasoning",
          label: "Thinking",
          status: "running",
          startedAt: new Date(responseStartedAtMs).toISOString(),
        },
      ]);

      const userMessage: AgentMessage = {
        id: resumedBlockedTurn?.userMessageId ?? crypto.randomUUID(),
        createdAt: turnCreatedAt,
        role: "user",
        content: trimmed,
        ...(options?.internalAgentContinuation
          ? { internalAgentContinuation: true }
          : {}),
        ...(options?.attachments?.length
          ? {
              attachmentNames: options.attachments.map((attachment) => attachment.name),
              attachments: chatMessageAttachments(options.attachments),
            }
          : {}),
        ...(options?.branchGroupId
          ? { branchGroupId: options.branchGroupId }
          : {}),
        ...(options?.textSelection
          ? { textSelection: options.textSelection }
          : {}),
      };
      userMessage.clientMessageId = userMessage.id;
      const assistant: AgentMessage = {
        id: resumedBlockedTurn?.assistantMessageId ?? crypto.randomUUID(),
        createdAt: turnCreatedAt,
        role: "assistant",
        content: "",
        sources: [],
        tools: [],
        ...(options?.branchGroupId
          ? { branchGroupId: options.branchGroupId }
          : {}),
        ...(options?.textSelection
          ? { textSelection: options.textSelection }
          : {}),
      };
      assistant.clientMessageId = userMessage.id;
      const baseline = [...transcript, userMessage, assistant];
      setMessages(baseline);

      const commit = (message: AgentMessage) => {
        if (viewEpochRef.current !== viewEpoch) return;
        setMessages((current) => {
          const next = [...current];
          const assistantIndex = next.findIndex(
            (candidate) => candidate.id === assistant.id,
          );
          if (assistantIndex >= 0) next[assistantIndex] = { ...message };
          return next;
        });
      };

      let ownedStream: Promise<
        "completed" | "cancelled" | "failed"
      > | null = null;
      let streamController: AbortController | null = null;
      try {
        const ensured = await ensureSession(
          surface,
          createOptions,
          sessionRef.current,
          { activeDirectory, filesystemMode },
        );
        const activeSessionId = ensured.id;
        if (viewEpochRef.current !== viewEpoch) return;
        if (stopRequestedRef.current) {
          transition("cancelled");
          return;
        }
        sessionRef.current = activeSessionId;
        setSessionId(activeSessionId);
        rememberActiveConversation(activeSessionId);
        setActiveDirectory(ensured.activeDirectory);
        setFilesystemMode(ensured.filesystemMode);
        // Agent mode off: the message goes to the provider instead of the
        // runtime. Read at send time, not at render time, so the switch the user
        // sees is the one that governs the message they just sent.
        if (!isAgentModeEnabled()) {
          await streamDirectTurn({
            sessionId: activeSessionId,
            text: trimmed,
            assistant,
            commit,
            options,
            retry: Boolean(resumedBlockedTurn),
            responseStartedAtMs,
            viewEpoch,
            currentLocation,
          });
          return;
        }
        let branchContextId: string | undefined;
        if (branchHistory !== undefined) {
          const branchResponse = await fetch(
            `/api/hermes/sessions/${activeSessionId}/branch-runtime`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                surface,
                surfaceContext: {
                  activeGardenSlug: createOptions?.gardenSlug,
                  activePageSlug: createOptions?.pageSlug,
                },
                branchHistory,
              }),
            },
          );
          const branchBody = await branchResponse.json().catch(() => ({}));
          if (
            !branchResponse.ok ||
            typeof branchBody.branchContextId !== "string"
          ) {
            throw new Error(
              typeof branchBody.error === "string"
                ? branchBody.error
                : "The regenerated response context could not be prepared.",
            );
          }
          branchContextId = branchBody.branchContextId;
          if (viewEpochRef.current !== viewEpoch) return;
        }
        transition("connecting");

        // Open the event stream, then dispatch the message so no early deltas are
        // missed. The stream stays open until the turn goes idle.
        let markConnected!: () => void;
        const connected = new Promise<void>((resolve) => {
          markConnected = resolve;
        });
        const streamPromise = streamEvents(
          activeSessionId,
          assistant,
          commit,
          markConnected,
          responseStartedAtMs,
        );
        let dispatchAccepted = false;
        let streamFailedBeforeDispatch = false;
        // A cold messages route can finish compiling after the already-open
        // event route closes. Remember that race so an accepted server run is
        // reattached instead of being mislabeled Interrupted and offered as a
        // conflicting retry.
        void streamPromise.catch(() => {
          if (!dispatchAccepted) streamFailedBeforeDispatch = true;
        });
        ownedStream = streamPromise;
        streamController = abortRef.current;
        activeStreamRef.current = streamPromise;
        await Promise.race([
          connected,
          streamPromise.then(() => {
            throw new Error(
              "The agent event stream closed before it became ready.",
            );
          }),
        ]);
        if (viewEpochRef.current !== viewEpoch) {
          streamController?.abort();
          return;
        }
        if (stopRequestedRef.current) {
          abortRef.current?.abort();
          transition("cancelled");
          return;
        }
        // A rapid toggle followed by Send must not let an older session update
        // land after this turn's authoritative value.
        await yoloSyncRef.current;
        const sendResponse = await fetch(
          `/api/hermes/sessions/${activeSessionId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientMessageId: userMessage.id,
              text: trimmed,
              surface,
              surfaceContext: {
                activeGardenSlug: createOptions?.gardenSlug,
                activePageSlug: createOptions?.pageSlug,
                selectedText: options?.textSelection?.quote,
              },
              model: options?.model,
              reasoningEffort: options?.reasoningEffort,
              continuation: options?.continuation,
              internalAgentContinuation:
                options?.internalAgentContinuation === true,
              attachments: options?.attachments,
              confirmedPermissionIds: options?.confirmedPermissionIds,
              retry: Boolean(resumedBlockedTurn),
              branchGroupId: options?.branchGroupId,
              textSelection: options?.textSelection,
              branchHistory,
              branchContextId,
              // Per-message, like the model and the effort beside it: the switch
              // as it stood when this message was sent governs this turn only.
              superAgent: isSuperAgentEnabled(),
              adhdMode: isDirectModeEnabled(),
              yoloMode: isYoloModeEnabled(),
              currentLocation,
            }),
          },
        );
        if (viewEpochRef.current !== viewEpoch) {
          streamController?.abort();
          return;
        }
        if (!sendResponse.ok) {
          const body = await sendResponse.json().catch(() => ({}));
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "The agent could not accept the message.",
          );
        }
        const responseBody = await sendResponse.json().catch(() => ({}));
        if (
          responseBody.clarified === true &&
          typeof responseBody.message === "string" &&
          responseBody.message.trim()
        ) {
          if (selectedHistory !== undefined) {
            pendingHistoryOverrideRef.current = null;
          }
          const completedAt = new Date().toISOString();
          commit({
            ...assistant,
            content: responseBody.message.trim(),
            responseDurationMs: Math.max(0, Date.now() - responseStartedAtMs),
          });
          setActivities((current) =>
            current.map((item) =>
              item.status === "running"
                ? { ...item, status: "completed", completedAt }
                : item,
            ),
          );
          transition("completed");
          if (surface !== "quartz_ai") {
            notifyHermesSessionsChanged(surface);
          }
          abortRef.current?.abort();
          await streamPromise.catch((streamError) => {
            if ((streamError as Error).name !== "AbortError") throw streamError;
          });
          return;
        }
        if (
          responseBody.blocked === true &&
          Array.isArray(responseBody.pendingPermissions)
        ) {
          const pending = responseBody.pendingPermissions.find(
            (value: unknown) => value && typeof value === "object",
          ) as Record<string, unknown> | undefined;
          if (!pending) {
            throw new Error("The agent paused without a permission request.");
          }
          const operations = Array.isArray(pending.operations)
            ? pending.operations.filter(
                (value): value is string => typeof value === "string",
              )
            : [];
          const path = typeof pending.path === "string" ? pending.path : undefined;
          const targetPath =
            typeof pending.targetPath === "string"
              ? pending.targetPath
              : path;
          const targetPaths = Array.isArray(pending.targetPaths)
            ? pending.targetPaths.filter(
                (item): item is string => typeof item === "string",
              )
            : targetPath
              ? [targetPath]
              : [];
          const kind =
            pending.kind === "filesystem" ||
            pending.kind === "connection" ||
            pending.kind === "confirmation"
              ? pending.kind
              : "confirmation";
          const prompt: PermissionPrompt = {
            requestId: String(pending.id ?? "preflight-permission"),
            permission: String(pending.capability ?? "capability"),
            description: String(
              pending.message ?? "This task needs additional permission.",
            ),
            risk: operations.includes("delete")
              ? "delete"
              : operations.includes("move")
                ? "move"
                : operations.some((operation) =>
                      ["create", "modify", "write"].includes(operation),
                    )
                  ? "write"
                  : "read",
            affectedPaths: targetPaths,
            allowSession: kind === "filesystem",
            preflight: { kind, path, operations },
          };
          blockedTurnRef.current = {
            text: trimmed,
            options,
            userMessageId: userMessage.id!,
            assistantMessageId: assistant.id!,
          };
          setPendingPermission(prompt);
          setActivities([
            {
              id: `permission-${prompt.requestId}`,
              kind: "permission",
              label: "Permission required",
              detail: prompt.description,
              status: "permission_required",
              startedAt: new Date().toISOString(),
            },
          ]);
          transition("waiting_for_permission");
          abortRef.current?.abort();
          await streamPromise.catch((streamError) => {
            if ((streamError as Error).name !== "AbortError") throw streamError;
          });
          return;
        }
        if (typeof responseBody.runId !== "string" || !responseBody.runId) {
          throw new Error("The agent did not return an active run id.");
        }
        dispatchAccepted = true;
        if (selectedHistory !== undefined) {
          pendingHistoryOverrideRef.current = null;
        }
        activeRunIdRef.current = responseBody.runId;
        setActiveRunId(responseBody.runId);
        if (streamFailedBeforeDispatch) {
          // The POST is authoritative: the run exists even though its first
          // viewer disappeared. Keep the run active and let the normal durable
          // resume path attach a fresh viewer to the same assistant turn.
          transition("connecting");
          setRunToResume({
            sessionId: activeSessionId,
            runId: responseBody.runId,
            instruction: trimmed,
            startedAt: new Date(responseStartedAtMs).toISOString(),
            clientMessageId: userMessage.id,
            viewEpoch,
          });
          return;
        }
        if (stopRequestedRef.current) {
          transition("stopping");
          await fetch(
            `/api/hermes/sessions/${activeSessionId}/abort`,
            { method: "POST" },
          ).catch(() => undefined);
        } else if (runStateRef.current !== "stopping") {
          transition("running");
        }
        const outcome = await streamPromise;
        if (viewEpochRef.current !== viewEpoch) return;
        activeRunIdRef.current = null;
        setActiveRunId(null);
        if (outcome === "cancelled") {
          setError(null);
          transition("cancelled");
        }
        else if (outcome === "failed") transition("error");
        else {
          transition("completed");
          if (surface !== "quartz_ai") notifyTaskCompleted(trimmed);
        }
      } catch (err) {
        streamController?.abort();
        if (viewEpochRef.current !== viewEpoch) return;
        if ((err as Error).name === "AbortError") {
          if (runStateRef.current !== "cancelled") transition("idle");
          return;
        }
        setError(
          err instanceof Error ? err.message : "The agent is unavailable.",
        );
        activeRunIdRef.current = null;
        setActiveRunId(null);
        transition("error");
      } finally {
        if (abortRef.current === streamController) {
          abortRef.current = null;
        }
        if (activeStreamRef.current === ownedStream) {
          activeStreamRef.current = null;
        }
      }
    },
    [
      activeDirectory,
      createOptions,
      filesystemMode,
      messages,
      rememberActiveConversation,
      streamDirectTurn,
      streamEvents,
      surface,
      transition,
    ],
  );

  const steer = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      const activeSessionId = sessionRef.current;
      const runId = activeRunIdRef.current;
      if (!trimmed || !activeSessionId || !runId || steeringRef.current) {
        return false;
      }

      steeringRef.current = true;
      const clientRequestId = crypto.randomUUID();
      const activeAssistant = [...messagesRef.current]
        .reverse()
        .find((message) => message.role === "assistant");
      const assistantContentOffset = activeAssistant?.content.length ?? 0;
      setSteerError(null);
      transition("steering");
      try {
        const response = await fetch(
          `/api/hermes/sessions/${activeSessionId}/steer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              runId,
              text: trimmed,
              clientRequestId,
              assistantContentOffset,
            }),
          },
        );
        const body = await response.json().catch(() => ({}));

        // This is the only automatic fallback: the server authoritatively says
        // the run ended before it could accept steering. Reuse the same
        // Breadboard session and let normal send create the next run.
        if (response.status === 409 && body.code === "run_not_active") {
          await activeStreamRef.current?.catch(() => undefined);
          await Promise.resolve();
          activeRunIdRef.current = null;
          setActiveRunId(null);
          if (isActiveAgentRunState(runStateRef.current)) {
            transition("completed");
          }
          void send(trimmed, latestSendOptionsRef.current);
          return true;
        }
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "The course correction could not be applied.",
          );
        }

        setMessages((current) => {
          if (
            current.some(
              (message) => message.clientRequestId === clientRequestId,
            )
          ) {
            return current;
          }
          return [
            ...current,
            {
              id: crypto.randomUUID(),
              clientMessageId: `steer:${clientRequestId}`,
              createdAt: new Date().toISOString(),
              role: "user",
              content: trimmed,
              courseCorrection: true,
              courseCorrectionTargetClientMessageId:
                typeof body.courseCorrectionTargetClientMessageId === "string"
                  ? body.courseCorrectionTargetClientMessageId
                  : activeAssistant?.clientMessageId,
              courseCorrectionOffset:
                typeof body.courseCorrectionOffset === "number"
                  ? body.courseCorrectionOffset
                  : assistantContentOffset,
              clientRequestId,
            },
          ];
        });
        setActiveInstruction(trimmed);
        if (body.mode === "follow_up" && typeof body.runId === "string") {
          void adoptDispatchedRun(activeSessionId, body.runId, trimmed);
          return true;
        }
        if (
          activeRunIdRef.current === runId &&
          runStateRef.current !== "stopping"
        ) {
          transition(
            pendingPermission ? "waiting_for_permission" : "running",
          );
        }
        return true;
      } catch (steeringError) {
        setSteerError(
          steeringError instanceof Error
            ? steeringError.message
            : "The course correction could not be applied.",
        );
        if (
          activeRunIdRef.current === runId &&
          runStateRef.current !== "stopping"
        ) {
          transition(
            pendingPermission ? "waiting_for_permission" : "running",
          );
        }
        return false;
      } finally {
        steeringRef.current = false;
      }
    },
    [adoptDispatchedRun, pendingPermission, send, transition],
  );

  const respondToPermission = useCallback(
    async (decision: "once" | "always" | "reject") => {
      const prompt = pendingPermission;
      const activeSessionId = sessionRef.current;
      if (!prompt || !activeSessionId) return;

      if (prompt.preflight) {
        const blocked = blockedTurnRef.current;
        if (!blocked) return;
        if (decision === "reject") {
          blockedTurnRef.current = null;
          setPendingPermission(null);
          setMessages((current) =>
            current.map((message) =>
              message.id === blocked.assistantMessageId
                ? {
                    ...message,
                    content:
                      "I didn’t access that resource because permission wasn’t granted.",
                  }
                : message,
            ),
          );
          setActivities((current) =>
            current.map((item) =>
              item.id === `permission-${prompt.requestId}`
                ? { ...item, status: "denied", completedAt: new Date().toISOString() }
                : item,
            ),
          );
          transition("completed");
          return;
        }

        // Remove the actionable card before the network round trip so a slow
        // grant POST cannot be submitted repeatedly by double-clicking. The
        // catch path restores the same prompt if approval fails.
        setPendingPermission(null);
        transition("submitting");
        let oneTimeGrantId: string | null = null;
        try {
          if (prompt.preflight.kind === "filesystem") {
            if (!prompt.preflight.path) {
              throw new Error("The permission request did not identify a folder.");
            }
            const permissions = Object.fromEntries(
              prompt.preflight.operations.map((operation) => [operation, true]),
            );
            const response = await fetch("/api/hermes/filesystem-grants", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: prompt.preflight.path,
                permissions,
                scope: decision === "always" ? "remembered" : "one_time",
              }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(
                typeof body.message === "string"
                  ? body.message
                  : "The folder permission could not be saved.",
              );
            }
            if (
              decision === "once" &&
              body.grant &&
              typeof body.grant.id === "string"
            ) {
              oneTimeGrantId = body.grant.id;
            }
          }
          setActivities((current) =>
            current.map((item) =>
              item.id === `permission-${prompt.requestId}`
                ? { ...item, status: "completed", completedAt: new Date().toISOString() }
                : item,
            ),
          );
          transition("idle");
          await send(blocked.text, {
            ...blocked.options,
            confirmedPermissionIds:
              prompt.preflight.kind === "confirmation"
                ? [prompt.requestId]
                : blocked.options?.confirmedPermissionIds,
          });
        } catch (permissionError) {
          setPendingPermission(prompt);
          transition("error");
          setError(
            permissionError instanceof Error
              ? permissionError.message
              : "The permission decision failed.",
          );
        } finally {
          if (oneTimeGrantId) {
            await fetch(
              `/api/hermes/filesystem-grants?id=${encodeURIComponent(oneTimeGrantId)}`,
              { method: "DELETE" },
            ).catch(() => undefined);
          }
        }
        return;
      }

      setPendingPermission(null);
      transition("running");
      try {
        await submitPermissionDecision(
          prompt.requestId,
          activeSessionId,
          decision,
        );
      } catch (permissionError) {
        setPendingPermission(prompt);
        transition("error");
        setError(
          permissionError instanceof Error
            ? permissionError.message
            : "The permission decision failed.",
        );
        return;
      }
      setActivities((current) =>
        current.map((item) =>
          item.id === `permission-${prompt.requestId}`
            ? {
                ...item,
                status: decision === "reject" ? "denied" : "completed",
                completedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
    },
    [pendingPermission, send, transition],
  );

  useEffect(() => {
    if (!yoloMode || !pendingPermission) return;
    const timer = window.setTimeout(() => {
      // YOLO is a live mode, not a permanent grant. A one-turn decision keeps
      // the fallback path aligned with the switch when it is later disabled.
      void respondToPermission("once");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingPermission, respondToPermission, yoloMode]);

  useEffect(() => {
    const activeSessionId = sessionRef.current;
    if (!activeSessionId) return;
    // Keep toggles ordered. Two quick clicks must not let the slower, older
    // request win and leave Hermes in the opposite state from the switch.
    yoloSyncRef.current = yoloSyncRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch(
          `/api/hermes/sessions/${activeSessionId}/yolo`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: yoloMode }),
          },
        );
        if (!response.ok) {
          throw new Error("Could not update YOLO mode for the active session.");
        }
      })
      // The next message reasserts the switch, so a transient sync failure must
      // not create an unhandled rejection or block later toggles.
      .catch(() => undefined);
  }, [yoloMode]);

  const abort = useCallback(async () => {
    const activeSessionId = sessionRef.current;
    if (!isActiveAgentRunState(runStateRef.current)) return;
    setError(null);
    stopRequestedRef.current = true;
    transition("stopping");
    if (!activeSessionId || !activeRunIdRef.current) {
      abortRef.current?.abort();
      transition("cancelled");
      setPendingPermission(null);
      setActivities((current) =>
        current.map((item) =>
          item.status === "running" || item.status === "permission_required"
            ? {
                ...item,
                status: "cancelled",
                completedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      return;
    }
    try {
      const response = await fetch(
        `/api/hermes/sessions/${activeSessionId}/abort`,
        { method: "POST" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "The active run could not be stopped.",
        );
      }

      if (body.alreadyFinished && body.status === "completed") {
        activeRunIdRef.current = null;
        setActiveRunId(null);
        transition("completed");
        return;
      }

      if (activeStreamRef.current) {
        await Promise.race([
          activeStreamRef.current.catch(() => "failed" as const),
          new Promise<"timeout">((resolve) => {
            window.setTimeout(() => resolve("timeout"), 2_000);
          }),
        ]);
      }
      if (runStateRef.current === "stopping") {
        abortRef.current?.abort();
        activeRunIdRef.current = null;
        setActiveRunId(null);
        transition("cancelled");
      }
    } catch (stopError) {
      setError(
        stopError instanceof Error
          ? stopError.message
          : "The active run could not be stopped.",
      );
      transition(pendingPermission ? "waiting_for_permission" : "running");
      return;
    }
    setPendingPermission(null);
    setMessages((current) => {
      const next = [...current];
      for (let index = next.length - 1; index >= 0; index -= 1) {
        if (next[index].role === "assistant") {
          next[index] = { ...next[index], interrupted: true };
          break;
        }
      }
      return next;
    });
    setActivities((current) =>
      current.map((item) =>
        item.status === "running" || item.status === "permission_required"
          ? {
              ...item,
              status: "cancelled",
              completedAt: new Date().toISOString(),
            }
          : item,
        ),
    );
  }, [pendingPermission, transition]);

  const reset = useCallback(() => {
    const previousSessionId = sessionRef.current;
    viewEpochRef.current += 1;
    abortRef.current?.abort();
    sessionRef.current = null;
    setSessionId(null);
    window.localStorage.removeItem(storageKey);
    if (
      window.localStorage.getItem("breadboard-active-conversation") ===
      previousSessionId
    ) {
      window.localStorage.removeItem("breadboard-active-conversation");
    }
    setActiveDirectory(null);
    setMessages([]);
    transition("idle");
    activeRunIdRef.current = null;
    stopRequestedRef.current = false;
    resumedRunIdRef.current = null;
    setActiveRunId(null);
    setActiveInstruction(null);
    setSteerError(null);
    setError(null);
    // A blank chat is fully loaded the moment it exists; nothing is in flight.
    setLoadingSession(false);
    setPendingPermission(null);
    setActiveTools([]);
    setActivities([]);
    setRunToResume(null);
    pendingHistoryOverrideRef.current = null;
  }, [storageKey, transition]);

  const setMessagesExternal = useCallback((nextMessages: AgentMessage[]) => {
    pendingHistoryOverrideRef.current = nextMessages;
    setMessages(nextMessages);
  }, []);

  const setSessionIdExternal = useCallback((id: string | null) => {
    sessionRef.current = id;
    setSessionId(id);
    if (id) {
      window.localStorage.setItem(storageKey, id);
      window.localStorage.setItem("breadboard-active-conversation", id);
    }
  }, [storageKey]);

  const openSession = useCallback(
    async (id: string, optimisticMessages: AgentMessage[] = []) => {
      reset();
      setLoadingSession(true);
      const viewEpoch = viewEpochRef.current;
      sessionRef.current = id;
      setSessionId(id);
      // Alongside the transcript, not after it: the artifact cards belong to
      // the same chat and should arrive in the same paint as its messages.
      primeInlineArtifacts({ conversationId: id });
      const cached = cachedHermesSessionDetail(surface, id);
      const normalizedOptimistic = normalizeRestoredMessages(
        optimisticMessages.length > 0 ? optimisticMessages : cached?.messages,
      );
      setMessages(normalizedOptimistic);
      pendingHistoryOverrideRef.current = normalizedOptimistic;
      window.localStorage.setItem(storageKey, id);
      window.localStorage.setItem("breadboard-active-conversation", id);

      try {
        const restored = await loadHermesSessionDetail(surface, id);
        if (viewEpochRef.current !== viewEpoch) return;
        if (restored.id !== id) {
          throw new Error("This chat is no longer available.");
        }

        sessionRef.current = id;
        setActiveDirectory(
          typeof restored.activeDirectory === "string"
            ? restored.activeDirectory
            : null,
        );
        setFilesystemMode(
          restored.filesystemMode === "full" ? "full" : "restricted",
        );
        setMessages(normalizeRestoredMessages(restored.messages));

        const restoredRun =
          restored.activeRun && typeof restored.activeRun === "object"
            ? (restored.activeRun as Record<string, unknown>)
            : null;
        if (
          restoredRun &&
          typeof restoredRun.id === "string" &&
          typeof restoredRun.instruction === "string"
        ) {
          pendingHistoryOverrideRef.current = null;
          activeRunIdRef.current = restoredRun.id;
          setActiveRunId(restoredRun.id);
          setActiveInstruction(restoredRun.instruction);
          transition("connecting");
          setRunToResume({
            sessionId: id,
            runId: restoredRun.id,
            instruction: restoredRun.instruction,
            startedAt:
              typeof restoredRun.startedAt === "string"
                ? restoredRun.startedAt
                : undefined,
            clientMessageId:
              typeof restoredRun.clientMessageId === "string"
                ? restoredRun.clientMessageId
                : undefined,
            viewEpoch,
          });
        }
      } catch (openError) {
        if (viewEpochRef.current !== viewEpoch) return;
        setError(
          openError instanceof Error
            ? openError.message
            : "This chat could not be loaded.",
        );
      } finally {
        // A newer view already owns the flag; leaving it alone keeps this
        // superseded open from clearing the newer one's spinner.
        if (viewEpochRef.current === viewEpoch) setLoadingSession(false);
      }
    },
    [
      reset,
      storageKey,
      surface,
      transition,
    ],
  );

  const refreshSession = useCallback(async () => {
    const activeSessionId = sessionRef.current;
    if (!activeSessionId || isActiveAgentRunState(runStateRef.current)) return;
    const restored = await loadHermesSessionDetail(surface, activeSessionId).catch(() => null);
    if (sessionRef.current !== activeSessionId) return;
    if (restored?.id === activeSessionId) {
      setMessages(normalizeRestoredMessages(restored.messages));
    }
  }, [surface]);

  return {
    sessionId,
    activeDirectory,
    filesystemMode,
    messages,
    loadingSession,
    connection,
    runState,
    activeRunId,
    activeInstruction,
    steerError,
    error,
    pendingPermission,
    activeTools,
    activities,
    agentLaunchRequests,
    setMessages: setMessagesExternal,
    setSessionId: setSessionIdExternal,
    openSession,
    refreshSession,
    ensureConversation,
    beginDelegatedExternalAgentTurn,
    cancelDelegatedExternalAgentTurn,
    previewExternalAgentTurn,
    appendExternalAgentTurn,
    finishExternalAgentTurn,
    send,
    steer,
    respondToPermission,
    abort,
    reset,
  };
}
