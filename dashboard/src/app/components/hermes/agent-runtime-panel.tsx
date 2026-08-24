"use client";

// Shared conversation UI for Hermes-backed surfaces. Renders streaming
// assistant output, reasoning, tool activity, source citations, permission
// prompts, an abort control, and error/reconnect state — without ever exposing
// raw internal event JSON. The dashboard terminal, garden chat, and Quartz panel
// all embed this so the runtime experience stays consistent and the surface
// wrappers stay thin.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ChatMarkdown from "@/app/components/chat-markdown";
import ChatTimeSeparator from "@/app/components/chat-time-separator";
import ChatModelChangeSeparator from "@/app/components/chat-model-change-separator";
import ChatMessageAttachments from "@/app/components/chat-message-attachments";
import ChatVideoLinkEmbeds from "@/app/components/chat-video-link-embed";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import AssistantComposer, {
  type ComposerAttachment,
} from "@/app/components/assistant-composer";
import { useHumanizerMode } from "@/app/components/use-humanizer-mode";
import { autoHumanizeMessage } from "@/app/components/humanizer/auto-humanize";
import AssistantMessageActions, {
  MessageActionsSlot,
  AssistantResponseBranchNavigation,
  type AssistantResponseBranch,
} from "@/app/components/assistant-message-actions";
import {
  chatAutoScrollResponseKey,
  useChatAutoScroll,
  useChatVirtualBridge,
} from "@/app/components/use-chat-auto-scroll";
import VirtualizedMessageList from "@/app/components/chat/virtualized-message-list";
import {
  chatRowKey,
  estimateChatRowHeight,
} from "@/app/components/chat/chat-row-identity";
import BreadboardLoader from "@/app/components/breadboard-loader";
import ChatJumpToBottom from "@/app/components/chat-jump-to-bottom";
import { useComposerInset } from "@/app/components/chat/use-composer-inset";
import { useSmoothStreamText } from "@/app/components/chat/use-smooth-stream-text";
import ChatDisclaimer from "@/app/components/chat/chat-disclaimer";
import { useConfirmDialog } from "@/app/components/confirm-dialog";
import ChatMessageRail, {
  type ChatMessageRailItem,
} from "@/app/components/chat-message-rail";
import ActivityPanel from "./activity-panel";
import InlineBrowserRun from "./inline-browser-run";
import InlineAgentBrowserRun from "./inline-agent-browser-run";
import InlineArtifactCards, {
  InlineArtifactCardsProvider,
  useInlineArtifactPrefetch,
} from "./inline-artifact-cards";
import { ARTIFACT_BROWSER_EVENT } from "./artifact-viewer";
import InlineProposalCards from "./inline-proposal-cards";
import InlineConversationMap, {
  type InlineConversationMapKind,
} from "./inline-conversation-map";
import InlineSpotifyPlayer from "./inline-spotify-player";
import InlineDeepResearchRun from "./inline-deep-research-run";
import InlineMaxResearchRun from "./inline-max-research-run";
import InlineAgentReachRun from "./inline-agent-reach-run";
import InlineGetDocRun from "./inline-get-doc-run";
import InlineMeetingNotesRun from "./inline-meeting-notes-run";
import type { MeetingRecording } from "@/lib/meeting-notes/use-meeting-recorder";
import InlineDeepTutorRun from "./inline-deep-tutor-run";
import InlineCareerOpsRun from "./inline-career-ops-run";
import InlineOpenGymRun from "./inline-open-gym-run";
import InlineVibeTradingRun from "./inline-vibe-trading-run";
import InlineStockAnalystRun from "./inline-stock-analyst-run";
import InlineDeerFlowRun from "./inline-deer-flow-run";
import InlineTradingAgentsRun from "./inline-tradingagents-run";
import type { TradingAgentsRequest } from "@/lib/tradingagents/identity.ts";
import InlineOpenPlanterRun from "./inline-openplanter-run";
import InlineSocialsManagerRun from "./inline-socials-manager-run";
import InlineHardwareBlueprintRun from "./inline-hardware-blueprint-run";
import InlineParametricCadRun from "./inline-parametric-cad-run";
import InlineHyperframesRun from "./inline-hyperframes-run";
import InlineResource2SkillRun from "./inline-resource2skill-run";
import InlineMatraixRun from "./inline-matraix-run";
import InlineBoltSlidesRun from "./inline-bolt-slides-run";
import InlineOpenMontageRun from "./inline-openmontage-run";
import InlineOpenworkRun from "./inline-openwork-run";
import InlineOpenscienceRun from "./inline-openscience-run";
import InlineInboxZeroRun from "./inline-inbox-zero-run";
import InlineVimaxRun from "./inline-vimax-run";
import InlineVoxDirectorRun from "./inline-vox-director-run";
import InlineMoneyPrinterRun from "./inline-money-printer-run";
import InlineLegalRun from "./inline-legal-run";
import InlineWardrobeRun from "./inline-wardrobe-run";
import InlineShortsRun from "./inline-shorts-run";
import InlineFormsmithRun from "./inline-formsmith-run";
import InlineVideoUseRun from "./inline-video-use-run";
import type { ShortsRequest } from "@/lib/shorts/identity.ts";
import type { FormsmithRequest } from "@/lib/shaper/identity.ts";
import InlineOpenCodeRun from "./inline-opencode-run";
import InlineRufloRun from "./inline-ruflo-run";
import { UserMessageText } from "./command-text";
import CollapsibleUserMessage from "@/app/components/chat/collapsible-user-message";
import SavePromptDialog from "./save-prompt-dialog";
import {
  restoreQueuedFollowUpDraft,
  useQueuedFollowUps,
} from "./queued-follow-ups";
import {
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "@/lib/assistant-reasoning";
import type { IntelligenceMode } from "@/lib/intelligence-modes";
import type { ModelFailoverNotice as ComposerModelFailover } from "@/app/components/use-assistant-intelligence";
import {
  externalAgentAbortUrls,
  externalAgentRunInFlight,
  isExternalAgentRunMessage,
  type AgentMessage,
  type ActivityItem,
  type AgentRunState,
  type ConnectionState,
  type PermissionPrompt,
} from "./use-agent-session";
import type { HermesSurface } from "@/lib/hermes/config.ts";
import { requiresGeographicGrounding } from "@/lib/map/grounding.ts";
import { spotifyPlayerAssistantIndex } from "@/lib/hermes/spotify-intent.ts";
import type { LocalWorkflowSummary } from "@/lib/workflows/types";
import {
  externalAgentCardContent,
  type ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { chatTimeSeparatorLabels } from "@/lib/chat-time-separators";
import {
  splitSteeredResponse,
  type CourseCorrectionBoundary,
} from "@/lib/steered-response";
import {
  applyBranchVariant,
  cloneMessages,
  createConversationBranch,
  messageBranchId,
  previousUserMessageIndex,
  retryTargetUserMessageIndex,
  type ConversationBranchGroup,
} from "./conversation-branches";
import {
  ChatSelectionMenu,
  InlineSelectionAnswerPopover,
  QuotedChatSelection,
  SelectableAssistantMarkdown,
  SelectionComposerContext,
  type ChatTextSelectionCandidate,
  type FloatingAnchorRect,
} from "@/app/components/chat-text-selection-ui";
import {
  chatTextSelectionsOverlap,
  normalizeChatTextSelectionReference,
  type ChatTextSelectionReference,
} from "@/lib/chat-text-selection";
import {
  delegatedAgentActivityLabelForMessage,
  delegatedAgentCompletedLabelForMessage,
  delegatedAgentStartedAtForMessage,
  delegatedTurnCarriedDurationMs,
  delegatedTurnTotalUsage,
} from "@/lib/hermes/super-agent-activity";

interface Props {
  messages: AgentMessage[];
  connection: ConnectionState;
  runState: AgentRunState;
  /**
   * An external agent launch that has not reached the transcript yet. The turn
   * only becomes visible once its run id comes back, and the composer must
   * already be queueing during that window.
   */
  externalRunLaunching?: boolean;
  /**
   * A model-delegated worker is somewhere in its hand-off — queued behind the
   * turn that asked for it, starting, running, or finished and waiting to be
   * handed back. It is passed in rather than read off the transcript because
   * for most of that span there is nothing in the transcript to read: the run
   * has no card, no chat connection, and often no row of its own yet.
   */
  delegationInFlight?: boolean;
  /**
   * This chat is off the record. Only the transcript's appearance changes here:
   * what the user says is drawn on a broken outline, so the thing that will not
   * be kept looks unlike the thing that will. Every rule behind that promise
   * lives on the server.
   */
  temporaryChat?: boolean;
  steerError: string | null;
  error: string | null;
  pendingPermission: PermissionPrompt | null;
  activities: ActivityItem[];
  input: string;
  onInputChange: (value: string) => void;
  /**
   * Lent by the owner when it needs to focus the composer itself — putting the
   * caret after an opener it just dropped in, for instance. Left out, the panel
   * keeps its own.
   */
  composerTextareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onSubmit: () => void;
  /** Rendered directly above the composer — currently the agent-launch prompt. */
  beforeComposer?: ReactNode;
  onRunWorkflow?: (workflow: LocalWorkflowSummary, input: string) => void | Promise<void>;
  onAskSelection?: (
    question: string,
    selection: ChatTextSelectionReference,
  ) => Promise<void>;
  onSteer: (text: string) => Promise<boolean>;
  /**
   * Whether a run that can actually take a course correction is behind the
   * working answer. `runState` alone is not enough: a provider-direct turn
   * (agent mode off) and a turn still being dispatched both look active while
   * having no runtime run for `onSteer` to reach, and offering Steer there
   * gives a control that can only fail. Defaults to true so a surface that
   * does not know keeps the old behaviour.
   */
  steerableRun?: boolean;
  onSendQueued: (text: string) => Promise<void>;
  onEditMessage?: (
    messageIndex: number,
    text: string,
    branchGroupId: string,
  ) => void;
  onSelectBranch?: (messages: AgentMessage[]) => void;
  /**
   * Remove one exchange — this message and the answer it produced — for good.
   * Absent on a transcript with nothing durable behind it to remove.
   */
  onDeleteMessage?: (
    message: AgentMessage,
    messageIndex: number,
  ) => void | Promise<unknown>;
  onAbort: () => void;
  /** Stop also ends any pending delegated-agent hand-back owned by the surface. */
  onStopRequested?: (externalClientMessageIds: string[]) => void;
  onPermissionDecision: (decision: "once" | "always" | "reject") => void;
  onRetryMessage?: (userMessageIndex: number, branchGroupId: string) => void;
  placeholder?: string;
  emptyState?: React.ReactNode;
  /** The transcript is still being restored; show a loader, not the empty state. */
  loadingTranscript?: boolean;
  model?: string;
  models?: string[];
  onModelChange?: (model: string) => void;
  reasoningEffort?: AssistantReasoningEffort;
  onReasoningEffortChange?: (effort: AssistantReasoningEffort) => void;
  /** Modes the active model honours; forwarded straight to the composer. */
  intelligenceModes?: IntelligenceMode[];
  /** Quota-failover notice; forwarded straight to the composer. */
  modelFailover?: ComposerModelFailover | null;
  disabled?: boolean;
  onAddDocuments?: () => void;
  onPasteFiles?: (files: File[]) => void | Promise<void>;
  isAddingDocuments?: boolean;
  attachments?: ComposerAttachment[];
  onRemoveAttachment?: (index: number) => void;
  statusMessage?: string;
  compact?: boolean;
  sessionId?: string | null;
  surface?: HermesSurface;
  /** Garden this panel belongs to; scheduled chats open inside it. */
  gardenSlug?: string | null;
  /** Active Agent TARS (browser operator) for this conversation, if selected. */
  browserAgent?: { id: string; name: string } | null;
  onClearBrowserAgent?: () => void;
  onSelectBrowserAgent?: () => void;
  /** Active Agent Browser (agent-browser runtime) for this conversation, if selected. */
  agentBrowserAgent?: { id: string; name: string } | null;
  onClearAgentBrowser?: () => void;
  onSelectAgentBrowser?: () => void;
  /** Active Agent Reach agent for this conversation, if selected. */
  agentReachAgent?: { id: string; name: string } | null;
  onClearAgentReach?: () => void;
  onSelectAgentReach?: () => void;
  getDocAgent?: { id: string; name: string } | null;
  onClearGetDoc?: () => void;
  onSelectGetDoc?: () => void;
  meetingNotesAgent?: { id: string; name: string } | null;
  onClearMeetingNotes?: () => void;
  onSelectMeetingNotes?: () => void;
  onMeetingRecorded?: (recording: MeetingRecording) => void;
  deepTutorAgent?: { id: string; name: string } | null;
  onClearDeepTutor?: () => void;
  onSelectDeepTutor?: () => void;
  careerOpsAgent?: { id: string; name: string } | null;
  onClearCareerOps?: () => void;
  onSelectCareerOps?: () => void;
  onSelectOpenGym?: () => void;
  vibeTradingAgent?: { id: string; name: string } | null;
  onClearVibeTrading?: () => void;
  onSelectVibeTrading?: () => void;
  stockAnalystAgent?: { id: string; name: string } | null;
  onClearStockAnalyst?: () => void;
  onSelectStockAnalyst?: () => void;
  deerFlowAgent?: { id: string; name: string } | null;
  onClearDeerFlow?: () => void;
  onSelectDeerFlow?: () => void;
  tradingAgentsAgent?: { id: string; name: string } | null;
  tradingAgentsSeed?: Partial<TradingAgentsRequest> | null;
  onClearTradingAgents?: () => void;
  onSelectTradingAgents?: () => void;
  onSubmitTradingAgents?: (request: TradingAgentsRequest) => void;
  shortsAgent?: { id: string; name: string } | null;
  shortsSeed?: Partial<ShortsRequest> | null;
  onClearShorts?: () => void;
  onSelectShorts?: () => void;
  onSubmitShorts?: (request: ShortsRequest) => void;
  formsmithAgent?: { id: string; name: string } | null;
  onClearFormsmith?: () => void;
  onSelectFormsmith?: () => void;
  onSubmitFormsmith?: (request: FormsmithRequest) => void;
  /** Active Deep Research agent for this conversation, if selected. */
  deepResearchAgent?: { id: string; name: string } | null;
  onClearDeepResearch?: () => void;
  onSelectDeepResearch?: () => void;
  /** Active OpenPlanter investigation agent for this conversation. */
  openPlanterAgent?: { id: string; name: string } | null;
  onClearOpenPlanter?: () => void;
  onSelectOpenPlanter?: () => void;
  /** The Socials Manager has no selectable agent; this only inserts its command token. */
  onSelectSocialsManager?: () => void;
  onSelectHardwareBlueprint?: () => void;
  onSelectParametricCad?: () => void;
  onSelectHyperframes?: () => void;
  onSelectResource2Skill?: () => void;
  onSelectMatraix?: () => void;
  onSelectBoltSlides?: () => void;
  onSelectOpenMontage?: () => void;
  onSelectOpenwork?: () => void;
  onSelectOpenscience?: () => void;
  onSelectMaxResearch?: () => void;
  onSelectInboxZero?: () => void;
  onSelectVimax?: () => void;
  onSelectVoxDirector?: () => void;
  onSelectMoneyPrinter?: () => void;
  onSelectLegal?: () => void;
  onSelectWardrobe?: () => void;
  /** Active OpenCode agent for the repository linked to a Garden. */
  openCodeAgent?: { id: string; name: string } | null;
  onClearOpenCode?: () => void;
  onSelectOpenCode?: () => void;
  /** Active Codex coding agent for the repository linked to a Garden. */
  codexAgent?: { id: string; name: string } | null;
  onClearCodex?: () => void;
  onSelectCodex?: () => void;
  /** Active Ruflo hive-mind swarm for the repository linked to a Garden. */
  rufloAgent?: { id: string; name: string } | null;
  onClearRuflo?: () => void;
  onSelectRuflo?: () => void;
  onExternalAgentTerminal?: (
    clientMessageId: string,
    result: ExternalAgentTerminalResult,
  ) => void;
  /** A linked Video Use source was persisted onto its user turn. */
  onExternalAgentSourceReady?: () => void;
}

function SteeredAssistantResponse({
  content,
  corrections,
}: {
  content: string;
  corrections: readonly CourseCorrectionBoundary[];
}) {
  const segments = splitSteeredResponse(content, corrections);
  return (
    <div className="space-y-4">
      {segments.map((segment) =>
        segment.kind === "assistant" ? (
          <div key={segment.key}>
            <ChatMarkdown content={segment.content} compact />
          </div>
        ) : (
          <div key={segment.key} className="group flex justify-end py-1">
            <div className="w-fit max-w-[75%]">
              <div className="neu-chat-message neu-chat-message-user rounded-[22px] px-4 py-2.5 text-sm leading-6">
                <CollapsibleUserMessage messageKey={`steer:${segment.key}`}>
                  <UserMessageText content={segment.content} />
                </CollapsibleUserMessage>
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

const BRANCH_STORAGE_PREFIX = "breadboard:conversation-branches:";
const INLINE_SELECTION_STORAGE_PREFIX = "breadboard:inline-selections:";
const DELETED_INLINE_SELECTION_STORAGE_PREFIX =
  "breadboard:deleted-inline-selections:";

interface InlineSelectionThread {
  selection: ChatTextSelectionReference;
  question?: string;
  answer?: string;
  pending: boolean;
  usage?: AgentMessage["usage"];
  responseDurationMs?: number;
  startedAt?: string;
}

function loadInlineSelections(sessionId: string): ChatTextSelectionReference[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(
        `${INLINE_SELECTION_STORAGE_PREFIX}${sessionId}`,
      ) ?? "[]",
    ) as unknown[];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((value) => {
      const selection = normalizeChatTextSelectionReference(value);
      if (!selection || selection.mode !== "inline" || seen.has(selection.id)) {
        return [];
      }
      seen.add(selection.id);
      return [selection];
    });
  } catch {
    return [];
  }
}

function loadDeletedInlineSelectionIds(sessionId: string): Set<string> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(
        `${DELETED_INLINE_SELECTION_STORAGE_PREFIX}${sessionId}`,
      ) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0 && value.length <= 160,
      ),
    );
  } catch {
    return new Set();
  }
}

function messageSelectionSourceId(
  message: AgentMessage,
  messageIndex: number,
): string {
  return message.clientMessageId ?? message.id ?? `assistant-${messageIndex}`;
}

function loadBranchGroups(sessionId: string): Record<string, ConversationBranchGroup> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(`${BRANCH_STORAGE_PREFIX}${sessionId}`) ?? "{}",
    ) as Record<string, ConversationBranchGroup>;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, group]) =>
        Boolean(
          group &&
            typeof group.id === "string" &&
            Number.isInteger(group.activeIndex) &&
            Array.isArray(group.variants) &&
            group.variants.length > 1,
        ),
      ),
    );
  } catch {
    return {};
  }
}

/**
 * A message paired with its position in the whole conversation. The rows the
 * transcript draws are a subset of the messages it holds, and everything the
 * row body does — editing, retrying, branching, "is this the newest answer" —
 * is expressed against the position in the full list, so it travels along.
 */
type TranscriptRow = { index: number; message: AgentMessage };

function deepResearchAbortTerminalResult(
  payload: unknown,
): ExternalAgentTerminalResult | null {
  if (!payload || typeof payload !== "object") return null;
  const run = (payload as {
    run?: {
      status?: unknown;
      result?: unknown;
      failure?: { message?: unknown };
    };
  }).run;
  if (!run || typeof run.status !== "string" || run.status === "running") {
    return null;
  }
  if (run.status === "completed") {
    return {
      outcome: "completed",
      content:
        typeof run.result === "string" && run.result.trim()
          ? run.result
          : "Research completed.",
    };
  }
  if (run.status === "failed") {
    return {
      outcome: "failed",
      content:
        typeof run.failure?.message === "string" && run.failure.message.trim()
          ? run.failure.message
          : "The research run failed.",
    };
  }
  if (run.status === "aborted") {
    return { outcome: "aborted", content: "Research was aborted." };
  }
  return null;
}

const transcriptRowKey = (row: TranscriptRow) =>
  chatRowKey(row.message, row.index);

const transcriptRowHeight = (row: TranscriptRow) =>
  row.message.modelChange
    ? 40
    : estimateChatRowHeight(row.message, { minimum: 88 });

/**
 * Decide whether this answer owes an inline native map from the request that
 * produced it. The map itself still reads only structured provider state; this
 * function decides presentation, never coordinates or route geometry.
 */
function inlineMapKindForAssistant(
  messages: AgentMessage[],
  assistantIndex: number,
): InlineConversationMapKind | null {
  const userIndex = previousUserMessageIndex(messages, assistantIndex);
  if (userIndex < 0) return null;
  const request = messages[userIndex];
  if (!request || request.role !== "user") return null;
  const priorRequests = messages
    .slice(0, userIndex)
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => message.content);
  const assessment = requiresGeographicGrounding(request.content, {
    priorRequests,
  });
  if (
    assessment.asks.some((ask) =>
      ["route", "distance", "travel_time"].includes(ask),
    )
  ) {
    return "route";
  }
  if (
    assessment.asks.some((ask) =>
      ["recommendation", "proximity"].includes(ask),
    )
  ) {
    return "places";
  }
  return null;
}

export default function AgentRuntimePanel({
  messages,
  connection,
  runState,
  externalRunLaunching = false,
  delegationInFlight = false,
  temporaryChat = false,
  steerError,
  error,
  pendingPermission,
  activities,
  input,
  onInputChange,
  onSubmit,
  beforeComposer,
  onRunWorkflow,
  onAskSelection,
  onSteer,
  steerableRun = true,
  onSendQueued,
  onEditMessage,
  onSelectBranch,
  onDeleteMessage,
  onAbort,
  onStopRequested,
  onPermissionDecision,
  onRetryMessage,
  placeholder,
  emptyState,
  loadingTranscript = false,
  model,
  models,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  intelligenceModes,
  modelFailover,
  disabled,
  onAddDocuments,
  onPasteFiles,
  isAddingDocuments,
  attachments,
  onRemoveAttachment,
  statusMessage,
  compact,
  sessionId,
  surface = "dashboard_terminal",
  gardenSlug = null,
  browserAgent,
  onClearBrowserAgent,
  onSelectBrowserAgent,
  agentBrowserAgent,
  onClearAgentBrowser,
  onSelectAgentBrowser,
  agentReachAgent,
  onClearAgentReach,
  onSelectAgentReach,
  getDocAgent,
  onClearGetDoc,
  onSelectGetDoc,
  meetingNotesAgent,
  onClearMeetingNotes,
  onSelectMeetingNotes,
  onMeetingRecorded,
  deepTutorAgent,
  onClearDeepTutor,
  onSelectDeepTutor,
  careerOpsAgent,
  onClearCareerOps,
  onSelectCareerOps,
  onSelectOpenGym,
  vibeTradingAgent,
  onClearVibeTrading,
  onSelectVibeTrading,
  stockAnalystAgent,
  onClearStockAnalyst,
  onSelectStockAnalyst,
  deerFlowAgent,
  onClearDeerFlow,
  onSelectDeerFlow,
  tradingAgentsAgent,
  tradingAgentsSeed,
  onClearTradingAgents,
  onSelectTradingAgents,
  onSubmitTradingAgents,
  shortsAgent,
  shortsSeed,
  onClearShorts,
  onSelectShorts,
  onSubmitShorts,
  formsmithAgent,
  onClearFormsmith,
  onSelectFormsmith,
  onSubmitFormsmith,
  deepResearchAgent,
  onClearDeepResearch,
  onSelectDeepResearch,
  openPlanterAgent,
  onClearOpenPlanter,
  onSelectOpenPlanter,
  onSelectSocialsManager,
  onSelectHardwareBlueprint,
  onSelectParametricCad,
  onSelectHyperframes,
  onSelectResource2Skill,
  onSelectMatraix,
  onSelectBoltSlides,
  onSelectOpenMontage,
  onSelectOpenwork,
  onSelectOpenscience,
  onSelectMaxResearch,
  onSelectInboxZero,
  onSelectVimax,
  onSelectVoxDirector,
  onSelectMoneyPrinter,
  onSelectLegal,
  onSelectWardrobe,
  openCodeAgent,
  onClearOpenCode,
  onSelectOpenCode,
  codexAgent,
  onClearCodex,
  onSelectCodex,
  rufloAgent,
  onClearRuflo,
  onSelectRuflo,
  onExternalAgentTerminal,
  onExternalAgentSourceReady,
  composerTextareaRef: ownerComposerTextareaRef,
}: Props) {
  // The panel focuses the composer for its own reasons (asking about a
  // selection, opening an annotation). An owner that also puts text there —
  // picking an opener from the empty state — needs the same handle, so it may
  // lend one rather than the panel keeping its ref to itself.
  const fallbackComposerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerTextareaRef = ownerComposerTextareaRef ?? fallbackComposerTextareaRef;
  const copiedUserTimerRef = useRef<number | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageEditText, setMessageEditText] = useState("");
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [promptToSave, setPromptToSave] = useState<string | null>(null);
  const {
    confirm: confirmMessageDeletion,
    confirmDialog: messageDeleteDialog,
  } = useConfirmDialog();
  const [inlineArtifactRetireVersion, setInlineArtifactRetireVersion] = useState(0);
  const [stopRequestPending, setStopRequestPending] = useState(false);
  const stopRequestPendingRef = useRef(false);
  // Ask for this chat's artifacts as soon as it is selected, not after its
  // transcript has rendered, so the cards arrive with the messages.
  useInlineArtifactPrefetch({
    conversationId: surface !== "quartz_ai" ? sessionId : null,
  });
  const [branchGroups, setBranchGroups] = useState<
    Record<string, ConversationBranchGroup>
  >({});
  const [branchStorageSession, setBranchStorageSession] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] =
    useState<ChatTextSelectionCandidate | null>(null);
  const [composerSelection, setComposerSelection] =
    useState<ChatTextSelectionReference | null>(null);
  const [savedInlineSelections, setSavedInlineSelections] = useState<
    ChatTextSelectionReference[]
  >([]);
  const [deletedInlineSelectionIds, setDeletedInlineSelectionIds] = useState<
    Set<string>
  >(() => new Set());
  const [inlineSelectionStorageSession, setInlineSelectionStorageSession] =
    useState<string | null>(null);
  const [openInlineAnswer, setOpenInlineAnswer] = useState<{
    id: string;
    anchor: FloatingAnchorRect;
  } | null>(null);
  const streaming = connection === "streaming" || connection === "connecting" || connection === "waiting";
  const activeRun =
    runState === "submitting" ||
    runState === "connecting" ||
    runState === "running" ||
    runState === "waiting_for_permission" ||
    runState === "steering" ||
    runState === "stopping";
  // External agents run outside `runState`, so without this the conversation
  // would look free while a blueprint, research or coding card is still
  // working, and the next message would overtake it instead of queueing.
  const externalRunActive =
    externalRunLaunching ||
    delegationInFlight ||
    messages.some(externalAgentRunInFlight);
  const runInFlight = activeRun || externalRunActive;
  // A transcript still being restored holds follow-ups too. Keeping this
  // separate from `runInFlight` avoids offering Stop for a history request,
  // while the queue remains visible and drains as soon as loading settles.
  const queueHeld = loadingTranscript || runInFlight;
  // Messages typed while the conversation is working queue here; each can be
  // applied to the active chat turn as a course correction, and whatever is
  // still queued when the run settles is sent as ordinary follow-ups.
  const { queueFollowUp, headerContent: queuedFollowUpsHeader } =
    useQueuedFollowUps({
      conversationKey: sessionId ?? null,
      runInFlight: queueHeld,
      steerableRunActive: activeRun && steerableRun,
      stopping: runState === "stopping",
      externalRunActive,
      onSteer,
      onRestoreDraft: (text) =>
        restoreQueuedFollowUpDraft(text, onInputChange, composerTextareaRef),
      onSendQueued,
    });
  // Until the transcript has landed there is no history to answer against, and
  // the arriving one would overwrite whatever a direct turn had already put on
  // screen. Destructive/direct actions stay locked; the composer instead adds
  // typed messages to the held queue above it.
  const conversationLocked = Boolean(disabled) || loadingTranscript;
  // The composer's stop has to reach whatever is actually working. A Hermes
  // turn is stopped through the session; an external agent runs outside that
  // state machine and is stopped at its own endpoint. Both can be true when a
  // run was delegated mid-turn, so this stops everything in flight rather than
  // picking one — a stop button that stops only some of a busy conversation
  // reads as broken.
  const externalStops = useMemo(() => {
    const stops = new Map<
      string,
      { url: string; clientMessageId?: string }
    >();
    for (const message of messages) {
      if (!externalAgentRunInFlight(message)) continue;
      for (const url of externalAgentAbortUrls([message])) {
        stops.set(url, { url, clientMessageId: message.clientMessageId });
      }
    }
    return [...stops.values()];
  }, [messages]);
  /**
   * Fire the cancellations. Extracted because a stop can be asked for before
   * anything exists to cancel, and the deferred sweep below has to send exactly
   * the same requests the click would have sent.
   */
  const abortExternalRuns = useCallback(
    async (stops: ReadonlyArray<{ url: string; clientMessageId?: string }>) =>
      Promise.all(
        stops.map(async ({ url, clientMessageId }) => {
        try {
          const response = await fetch(url, { method: "POST" });
          const payload = await response.json().catch(() => null);
          if (
            !response.ok ||
            (payload &&
              typeof payload === "object" &&
              (payload as { ok?: unknown }).ok === false)
          ) {
            return false;
          }
          // Deep Research returns its terminal snapshot from abort. Consume it
          // here so a hidden delegated card is not the only thing capable of
          // persisting the stop (or an already-failed stale run).
          if (url.startsWith("/api/deep-research/") && clientMessageId) {
            const terminal = deepResearchAbortTerminalResult(payload);
            if (terminal) onExternalAgentTerminal?.(clientMessageId, terminal);
          }
          return true;
        } catch {
          return false;
        }
      }),
      ),
    [onExternalAgentTerminal],
  );

  /**
   * A stop asked for before the run exists.
   *
   * The composer used to keep its send button through the dispatch window, on
   * the reasoning that a square which cancels nothing is worse than no square.
   * In practice a long research launch takes seconds, and a person who has
   * decided to stop wants to say so once, not watch for the button to appear.
   * So the square is offered immediately and the request is held here until
   * there is a run to spend it on.
   */
  const awaitingStopRef = useRef(false);

  const stopEverything = useCallback(async () => {
    // State updates land on the next render; the ref makes the click lock
    // synchronous so a double-click cannot dispatch a second cancellation.
    if (stopRequestPendingRef.current) return;
    stopRequestPendingRef.current = true;
    setStopRequestPending(true);
    onStopRequested?.(
      externalStops.flatMap(({ clientMessageId }) =>
        clientMessageId ? [clientMessageId] : [],
      ),
    );
    if (activeRun) onAbort();
    if (!activeRun && externalStops.length === 0) {
      // Still dispatching. Keep the request standing rather than dropping it.
      awaitingStopRef.current = true;
      return;
    }
    const accepted = await abortExternalRuns(externalStops);
    // A refused/unreachable cancellation is retryable. Accepted requests stay
    // locked until their terminal transcript update removes runInFlight.
    if (!activeRun && !accepted.some(Boolean)) {
      stopRequestPendingRef.current = false;
      setStopRequestPending(false);
    }
  }, [
    activeRun,
    externalStops,
    onAbort,
    onExternalAgentTerminal,
    onStopRequested,
  ]);
  useEffect(() => {
    if (runInFlight) return;
    stopRequestPendingRef.current = false;
    setStopRequestPending(false);
  }, [runInFlight]);
  useEffect(() => {
    stopRequestPendingRef.current = false;
    setStopRequestPending(false);
  }, [sessionId]);
  // During the dispatch window a launch is in flight but its run does not exist
  // yet, so there is genuinely nothing to stop. Withholding the handler leaves
  // the composer on its send button, which queues — a square that did nothing
  // would be worse than no square.
  // The moment a run is asked for, not the moment it exists. `externalRunActive`
  // covers the dispatch window, which is where the Stop square used to be
  // missing for the seconds a long research launch takes.
  const canStop = activeRun || externalStops.length > 0 || externalRunActive;

  // Spend a stop that was asked for while the launch was still in flight, as
  // soon as there is something to spend it on.
  useEffect(() => {
    if (!awaitingStopRef.current || externalStops.length === 0) return;
    awaitingStopRef.current = false;
    void abortExternalRuns(externalStops).then((accepted) => {
      if (accepted.some(Boolean)) return;
      stopRequestPendingRef.current = false;
      setStopRequestPending(false);
    });
  }, [abortExternalRuns, externalStops]);

  // A launch that failed before producing a run leaves the request stranded;
  // clear it so the composer is usable again rather than stuck on a dead square.
  useEffect(() => {
    if (!externalRunActive && externalStops.length === 0) {
      awaitingStopRef.current = false;
    }
  }, [externalRunActive, externalStops.length]);
  const [humanizerEnabled] = useHumanizerMode();
  // Whether this panel has watched a run finish. Auto-rewriting an answer
  // it merely found on screen would rewrite history on page load.
  const sawRunRef = useRef(false);
  const attemptedRef = useRef<Set<string>>(new Set());
  const autoHumanizeAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (runInFlight) sawRunRef.current = true;
  }, [runInFlight]);
  // The one place an automatic rewrite is torn down: the panel going away.
  useEffect(() => () => autoHumanizeAbortRef.current?.abort(), []);

  const lastAssistantIndex = messages.reduce(
    (lastIndex, message, index) =>
      message.role === "assistant" &&
      !message.modelChange &&
      message.textSelection?.mode !== "inline"
        ? index
        : lastIndex,
    -1,
  );
  const newestAssistant =
    lastAssistantIndex >= 0 ? messages[lastAssistantIndex] : undefined;
  const transcriptRevealKey = sessionId ?? "new";
  // The newest answer's text is revealed at a readable pace rather than drawn
  // straight from the buffer, so a reply that arrives in bursts (or whole)
  // still reads as a stream. Older messages render their content directly.
  const revealedAssistantContent = useSmoothStreamText(
    newestAssistant?.content ?? "",
    streaming,
    transcriptRevealKey,
  );
  // A turn failure reads as part of the answer it broke, so when the
  // transcript ends with a plain assistant message the error text renders
  // inside that message, under its thinking header. Run cards and inline
  // selection answers render elsewhere, so failures there keep the
  // standalone notice below the transcript.
  const failureText = error || steerError || null;
  const lastMessage = messages.findLast((message) => !message.modelChange);
  const failureInline = Boolean(
    failureText &&
      lastMessage &&
      lastMessage.role === "assistant" &&
      lastMessage.textSelection?.mode !== "inline" &&
      !isExternalAgentRunMessage(lastMessage),
  );
  const timeSeparators = useMemo(
    () => chatTimeSeparatorLabels(messages),
    [messages],
  );
  const spotifyPlayerOwner = useMemo(
    () => spotifyPlayerAssistantIndex(messages),
    [messages],
  );
  const inlinedCourseCorrections = useMemo(() => {
    const byAssistantIndex = new Map<number, CourseCorrectionBoundary[]>();
    const hiddenMessageIndices = new Set<number>();

    messages.forEach((message, correctionIndex) => {
      if (
        message.role !== "user" ||
        message.courseCorrection !== true ||
        typeof message.courseCorrectionTargetClientMessageId !== "string" ||
        typeof message.courseCorrectionOffset !== "number"
      ) {
        return;
      }
      const assistantIndex = messages.findIndex(
        (candidate) =>
          candidate.role === "assistant" &&
          candidate.clientMessageId ===
            message.courseCorrectionTargetClientMessageId,
      );
      if (assistantIndex < 0) return;
      const boundaries = byAssistantIndex.get(assistantIndex) ?? [];
      boundaries.push({
        id:
          message.clientRequestId ??
          message.id ??
          `course-correction-${correctionIndex}`,
        content: message.content,
        offset: message.courseCorrectionOffset,
      });
      byAssistantIndex.set(assistantIndex, boundaries);
      hiddenMessageIndices.add(correctionIndex);
    });

    return { byAssistantIndex, hiddenMessageIndices };
  }, [messages]);
  // Every message that actually draws something, paired with its position in
  // the whole conversation. Rows that draw nothing — a continuation, an
  // inline selection, a folded course correction, or a delegated turn folded
  // into its continuation — are dropped rather than kept as
  // zero-height rows, which would still claim the spacing on both sides of
  // themselves. The original index travels with the message because editing,
  // retrying, branching and the newest-answer checks all speak in those terms.
  const transcriptRows = useMemo(() => {
    const rows: TranscriptRow[] = [];
    messages.forEach((storedMessage, index) => {
      if (
        // Only the hand-back itself is internal. The turn is persisted with the
        // flag on *both* of its messages, so dropping every flagged row also
        // dropped the assistant's answer — the one the person actually reads
        // after a delegation. It survived while it streamed (the optimistic row
        // carries no flag) and vanished on the next reload, leaving a question
        // with nothing under it. The answer is a normal assistant message; the
        // "Research synthesized" label is read off the preceding row's flag,
        // not this one, so keeping it costs nothing.
        (storedMessage.role === "user" &&
          storedMessage.internalAgentContinuation === true) ||
        storedMessage.textSelection?.mode === "inline" ||
        inlinedCourseCorrections.hiddenMessageIndices.has(index) ||
        (storedMessage.delegatedAgentRun === true &&
          messages[index + 1]?.internalAgentContinuation === true)
      ) {
        return;
      }
      rows.push({
        index,
        // Delegated worker output is persisted separately so the Super Agent's
        // own message remains intact. Resolved here so a row's measured height
        // and its drawn height come from the same text.
        message:
          storedMessage.delegatedAgentRun === true
            ? {
                ...storedMessage,
                content: externalAgentCardContent(storedMessage),
              }
            : storedMessage,
      });
      const modelChanges = storedMessage.modelChangesAfter?.length
        ? storedMessage.modelChangesAfter
        : storedMessage.modelChangeAfter
          ? [storedMessage.modelChangeAfter]
          : [];
      if (!(runInFlight && index === lastAssistantIndex)) {
        modelChanges.forEach((modelChange, modelChangeIndex) => {
          rows.push({
            index,
            message: {
              id: `${storedMessage.id ?? storedMessage.clientMessageId ?? index}:model-change:${modelChangeIndex}`,
              role: "assistant",
              content: "",
              modelChange,
            },
          });
        });
      }
    });
    return rows;
  }, [messages, inlinedCourseCorrections, lastAssistantIndex, runInFlight]);
  // One tick per question asked, for the rail down the right edge. Numbered off
  // the rows rather than off `messages`, because everything dropped above —
  // continuations, inline selections and folded corrections — is exactly what makes
  // the two differ, and the rail has to speak the virtualizer's indices.
  const railItems = useMemo<ChatMessageRailItem[]>(
    () =>
      transcriptRows.flatMap((row, rowIndex) =>
        row.message.role === "user"
          ? [{ rowIndex, label: row.message.content }]
          : [],
      ),
    [transcriptRows],
  );
  // What the arrow keys recall in the composer. Off the drawn rows for the same
  // reason as the rail: continuations and folded corrections are messages this
  // app wrote, and pressing Up should only ever return your own sentences.
  const sentMessages = useMemo(
    () =>
      transcriptRows.flatMap((row) =>
        row.message.role === "user" ? [row.message.content] : [],
      ),
    [transcriptRows],
  );
  const inlineSelectionThreads = useMemo(() => {
    const byId = new Map<string, InlineSelectionThread>();
    for (const selection of savedInlineSelections) {
      if (deletedInlineSelectionIds.has(selection.id)) continue;
      byId.set(selection.id, { selection, pending: false });
    }
    messages.forEach((message, messageIndex) => {
      const selection = message.textSelection;
      if (
        !selection ||
        selection.mode !== "inline" ||
        deletedInlineSelectionIds.has(selection.id)
      ) {
        return;
      }
      const current = byId.get(selection.id) ?? {
        selection,
        pending: false,
      };
      if (message.role === "user") {
        current.question = message.content;
        // The turn is pending from the moment the question is sent, not from
        // the moment its answer row exists. Without this, a re-asked question
        // shows a retry — and its predecessor's answer — for the frames before
        // the assistant row arrives.
        if (activeRun && messageIndex === messages.length - 1) {
          current.pending = true;
          current.answer = undefined;
          current.usage = undefined;
          current.responseDurationMs = undefined;
          current.startedAt = message.createdAt;
        }
      } else {
        current.answer = message.content || undefined;
        current.pending = activeRun && messageIndex === messages.length - 1;
        current.usage = message.usage;
        current.responseDurationMs = message.responseDurationMs;
        current.startedAt = message.createdAt;
      }
      byId.set(selection.id, current);
    });
    return byId;
  }, [activeRun, deletedInlineSelectionIds, messages, savedInlineSelections]);
  const annotationsByMessage = useMemo(() => {
    const byMessage = new Map<string, ChatTextSelectionReference[]>();
    for (const thread of inlineSelectionThreads.values()) {
      const entries = byMessage.get(thread.selection.sourceMessageId) ?? [];
      entries.push(thread.selection);
      byMessage.set(thread.selection.sourceMessageId, entries);
    }
    return byMessage;
  }, [inlineSelectionThreads]);
  const inlineRunActive = activeRun && messages.some(
    (message) =>
      message.role === "assistant" &&
      message.textSelection?.mode === "inline" &&
      !message.content,
  );
  const visibleScrollKey = useMemo(() => {
    const visible = messages.findLast(
      (message) =>
        message.textSelection?.mode !== "inline" &&
        !(message.modelChange && runInFlight),
    );
    return visible
      ? `${visible.clientMessageId ?? visible.id ?? visible.role}:${visible.content.length}:${visible.content.slice(-32)}:${runInFlight ? "" : (visible.modelChangesAfter ?? [visible.modelChangeAfter ?? ""]).join("|")}`
      : "empty";
  }, [messages, runInFlight]);
  const visibleResponseKey = useMemo(
    () =>
      chatAutoScrollResponseKey(
        messages.filter(
          (message) =>
            message.textSelection?.mode !== "inline" && !message.modelChange,
        ),
      ),
    [messages],
  );
  const respondingToInlineSelection =
    activeRun &&
    messages.findLast((message) => !message.modelChange)?.textSelection?.mode ===
      "inline";
  // An external agent's card is the only thing still working after a reload —
  // `runState` is idle and no stream is open — so without it the transcript
  // would look settled while a coding or research run is mid-flight, stop
  // following the output, and drop the busy affordances the composer keeps.
  const transcriptResponding =
    (activeRun || streaming || externalRunActive) &&
    !respondingToInlineSelection;
  const transcriptVirtual = useChatVirtualBridge();
  const composerInset = useComposerInset();
  const {
    ref: transcriptScrollRef,
    awayFromBottom: transcriptAwayFromBottom,
    scrollToBottom: jumpToNewestMessage,
  } = useChatAutoScroll<HTMLDivElement>({
    isResponding: transcriptResponding,
    responseKey: visibleResponseKey,
    contentKey: visibleScrollKey,
    // An omitted session and an unsaved one are the same absence of a
    // conversation; the hook reads `undefined` as "this surface does not open
    // conversations at all", which this one very much does.
    conversationKey: sessionId ?? null,
    virtual: transcriptVirtual,
  });

  // An external agent writes its artifacts from a background run, so no chat
  // stream announces them the way a Hermes turn does. Refreshing when the run
  // ends is what makes its file appear under the turn that produced it.
  const externalRunWasActive = useRef(externalRunActive);
  useEffect(() => {
    const finished = externalRunWasActive.current && !externalRunActive;
    externalRunWasActive.current = externalRunActive;
    if (!finished || !sessionId) return;
    window.dispatchEvent(
      new CustomEvent(ARTIFACT_BROWSER_EVENT, {
        detail: {
          type: "artifact.completed",
          conversationId: sessionId,
          gardenId: gardenSlug ?? null,
        },
      }),
    );
  }, [externalRunActive, gardenSlug, sessionId]);

  useEffect(
    () => () => {
      if (copiedUserTimerRef.current !== null) {
        window.clearTimeout(copiedUserTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!sessionId) {
      setBranchGroups({});
      setBranchStorageSession(null);
      return;
    }
    setBranchGroups(loadBranchGroups(sessionId));
    setBranchStorageSession(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || branchStorageSession !== sessionId) return;
    try {
      window.localStorage.setItem(
        `${BRANCH_STORAGE_PREFIX}${sessionId}`,
        JSON.stringify(branchGroups),
      );
    } catch {
      // Branch switching remains available for this page even if storage is full.
    }
  }, [branchGroups, branchStorageSession, sessionId]);

  useEffect(() => {
    setSelectionMenu(null);
    setComposerSelection(null);
    setOpenInlineAnswer(null);
    if (!sessionId) {
      setSavedInlineSelections([]);
      setDeletedInlineSelectionIds(new Set());
      setInlineSelectionStorageSession(null);
      return;
    }
    const deletedIds = loadDeletedInlineSelectionIds(sessionId);
    setDeletedInlineSelectionIds(deletedIds);
    setSavedInlineSelections(
      loadInlineSelections(sessionId).filter(
        (selection) => !deletedIds.has(selection.id),
      ),
    );
    setInlineSelectionStorageSession(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || inlineSelectionStorageSession !== sessionId) return;
    try {
      window.localStorage.setItem(
        `${INLINE_SELECTION_STORAGE_PREFIX}${sessionId}`,
        JSON.stringify(savedInlineSelections),
      );
      window.localStorage.setItem(
        `${DELETED_INLINE_SELECTION_STORAGE_PREFIX}${sessionId}`,
        JSON.stringify([...deletedInlineSelectionIds]),
      );
    } catch {
      // The canonical message metadata still restores completed inline answers.
    }
  }, [
    deletedInlineSelectionIds,
    inlineSelectionStorageSession,
    savedInlineSelections,
    sessionId,
  ]);

  useEffect(() => {
    const restored = messages.flatMap((message) => {
      const selection = normalizeChatTextSelectionReference(
        message.textSelection,
      );
      return selection?.mode === "inline" &&
        !deletedInlineSelectionIds.has(selection.id)
        ? [selection]
        : [];
    });
    if (restored.length === 0) return;
    setSavedInlineSelections((current) => {
      const next = new Map(current.map((selection) => [selection.id, selection]));
      let changed = false;
      for (const selection of restored) {
        if (next.has(selection.id)) continue;
        next.set(selection.id, selection);
        changed = true;
      }
      return changed ? [...next.values()] : current;
    });
  }, [deletedInlineSelectionIds, messages]);

  useEffect(() => {
    if (messages.length === 0) return;
    setBranchGroups((current) => {
      let changed = false;
      const next = { ...current };
      for (const [groupId, group] of Object.entries(current)) {
        const isVisible = messages.some(
          (message, index) =>
            message.role === "user" && messageBranchId(message, index) === groupId,
        );
        if (!isVisible || group.variants[group.activeIndex] === messages) continue;
        const variants = [...group.variants];
        variants[group.activeIndex] = messages;
        next[groupId] = { ...group, variants };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [messages]);

  async function copyUserMessage(message: AgentMessage, messageId: string) {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      return;
    }
    setCopiedUserId(messageId);
    if (copiedUserTimerRef.current !== null) {
      window.clearTimeout(copiedUserTimerRef.current);
    }
    copiedUserTimerRef.current = window.setTimeout(
      () => setCopiedUserId(null),
      1_600,
    );
  }

  function beginMessageEdit(message: AgentMessage, messageId: string) {
    setEditingMessageId(messageId);
    setMessageEditText(message.content);
  }

  function saveMessageEdit(message: AgentMessage, messageIndex: number) {
    const text = messageEditText.trim();
    if (!text || !onEditMessage) {
      setEditingMessageId(null);
      return;
    }
    const branch = createConversationBranch({
      messages,
      branchGroups,
      userMessageIndex: messageIndex,
      content: text,
      createId: () => crypto.randomUUID(),
    });
    setBranchGroups((current) => ({
      ...current,
      [branch.groupId]: branch.group,
    }));
    setEditingMessageId(null);
    setMessageEditText("");
    onEditMessage(messageIndex, text, branch.groupId);
  }

  /**
   * Delete one exchange: the message and the answer it produced.
   *
   * The branch group goes with it. Its variants are snapshots of a transcript
   * that no longer exists, so leaving the group behind would keep offering a
   * "1/2" switcher that restores the deleted turn.
   */
  async function deleteMessageTurn(
    message: AgentMessage,
    messageIndex: number,
  ) {
    if (!onDeleteMessage || activeRun || conversationLocked) return;
    const confirmed = await confirmMessageDeletion({
      title: "Delete this message?",
      body: "The message and the answer it produced will be removed from this chat.",
      detail:
        "Any files that answer created will be deleted too. This cannot be undone.",
      confirmLabel: "Delete message",
    });
    if (!confirmed) return;
    const groupId = messageBranchId(message, messageIndex);
    setBranchGroups((current) => {
      if (!(groupId in current)) return current;
      const next = { ...current };
      delete next[groupId];
      return next;
    });
    // The turn's artifacts are deleted server-side. Re-read once the request
    // settles, so a card the delete removed cannot linger in the cached list
    // and reappear at the end of the chat as an unassigned file.
    void Promise.resolve(onDeleteMessage(message, messageIndex)).then(() => {
      if (!sessionId) return;
      window.dispatchEvent(
        new CustomEvent(ARTIFACT_BROWSER_EVENT, {
          detail: {
            type: "artifact.deleted",
            conversationId: sessionId,
            gardenId: gardenSlug ?? null,
          },
        }),
      );
    });
  }

  function retryAssistantAsBranch(assistantMessageIndex: number) {
    if (!onRetryMessage || activeRun || conversationLocked) return;
    const userMessageIndex = retryTargetUserMessageIndex(
      messages,
      assistantMessageIndex,
    );
    const userMessage = messages[userMessageIndex];
    if (!userMessage || userMessage.role !== "user") return;
    const failedAttempt = messages[assistantMessageIndex];
    if (
      failedAttempt?.role === "assistant" &&
      !failedAttempt.content?.trim() &&
      assistantMessageIndex === messages.length - 1
    ) {
      // An attempt that died without producing any words is not worth
      // keeping: re-run the turn in place instead of parking the dead
      // attempt in a branch the switcher would keep offering. Only safe for
      // the transcript's last message — retrying an earlier one relies on
      // the branch snapshot to preserve everything after it.
      setInlineArtifactRetireVersion((current) => current + 1);
      onRetryMessage(
        userMessageIndex,
        failedAttempt.branchGroupId ??
          messageBranchId(userMessage, userMessageIndex),
      );
      return;
    }
    const branch = createConversationBranch({
      messages,
      branchGroups,
      userMessageIndex,
      content: userMessage.content,
      createId: () => crypto.randomUUID(),
    });
    setBranchGroups((current) => ({
      ...current,
      [branch.groupId]: branch.group,
    }));
    setInlineArtifactRetireVersion((current) => current + 1);
    onRetryMessage(userMessageIndex, branch.groupId);
  }

  function branchForAssistant(
    message: AgentMessage,
    messageIndex: number,
  ): ConversationBranchGroup | null {
    if (message.role !== "assistant") return null;
    const userIndex = previousUserMessageIndex(messages, messageIndex);
    if (userIndex < 0) return null;
    const groupId =
      message.branchGroupId ?? messageBranchId(messages[userIndex], userIndex);
    const group = branchGroups[groupId];
    return group && group.variants.length > 1 ? group : null;
  }

  function branchNavigationForAssistant(
    message: AgentMessage,
    messageIndex: number,
  ): AssistantResponseBranch | undefined {
    const branch = branchForAssistant(message, messageIndex);
    if (branch) {
      return {
        current: branch.activeIndex + 1,
        total: branch.variants.length,
        onPrevious: () => switchBranch(branch, -1),
        onNext: () => switchBranch(branch, 1),
      };
    }
    // A rewritten answer is versioned rather than branched: same question, same
    // turn, different wording. The arrows are the same arrows, but they move
    // between stored versions of this one message and the original is always
    // version 1.
    const versions = message.contentVersions;
    if (!versions || versions.total <= 1) return undefined;
    return {
      current: versions.activeIndex + 1,
      total: versions.total,
      onPrevious: () => void selectContentVersion(messageIndex, versions.activeIndex - 1),
      onNext: () => void selectContentVersion(messageIndex, versions.activeIndex + 1),
    };
  }

  /**
   * Replace one message in place, without disturbing the rest of the
   * transcript.
   *
   * `onSelectBranch` is the surface's existing "here is the transcript now"
   * seam, and reusing it keeps this component free of any opinion about how
   * the transcript is stored.
   */
  const replaceMessage = useCallback(
    (messageIndex: number, patch: Partial<AgentMessage>): void => {
      if (!onSelectBranch) return;
      const next = cloneMessages(messages);
      const current = next[messageIndex];
      if (!current) return;
      next[messageIndex] = { ...current, ...patch };
      onSelectBranch(next);
    },
    [messages, onSelectBranch],
  );

  /** Move between stored versions of one answer. The server owns which is active. */
  async function selectContentVersion(messageIndex: number, index: number): Promise<void> {
    const message = messages[messageIndex];
    const versions = message?.contentVersions;
    if (!sessionId || !message?.id || !versions) return;
    if (index < 0 || index >= versions.total || index === versions.activeIndex) return;
    try {
      const response = await fetch("/api/humanizer/versions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: sessionId,
          messageId: message.id,
          index,
        }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        content?: string;
        versions?: AgentMessage["contentVersions"];
      };
      if (typeof body.content !== "string" || !body.versions) return;
      replaceMessage(messageIndex, {
        content: body.content,
        contentVersions: body.versions,
        humanizerReview: body.versions.review
          ? {
              ...body.versions.review,
              adopted: true,
              disposition: "adopted",
            }
          : undefined,
        // Evidence describes the original wording. Selecting a derived version
        // takes it off the row; selecting the original is the only thing that
        // could put it back, and a reload does exactly that.
        ...(body.versions.derived ? { verification: undefined } : {}),
      });
    } catch {
      // A failed switch leaves the version that is already on screen in place.
    }
  }

  /**
   * With the switch on, rewrite each finished answer without being asked.
   *
   * Three guards, and each one exists for a reason worth keeping:
   *
   *   * Only after a run this panel actually watched. Without that, opening an
   *     old chat would rewrite its last answer on sight, months after it was
   *     written and with no run to attribute it to.
   *   * Only once per message. `attemptedRef` survives re-renders, so a
   *     transcript update mid-rewrite cannot start a second one - and the
   *     service takes one job at a time, so a second would only be told it is
   *     busy.
   *   * Never an agent run card. Those carry cited findings whose wording the
   *     citations refer to, and rewording them would quietly decouple the two.
   *
   * The answer is on screen throughout. An improved intact rewrite replaces it,
   * with the model's own words kept behind the version arrows. A tied, worse,
   * or damaged candidate leaves it in place. The review result stays internal.
   */
  useEffect(() => {
    if (!humanizerEnabled || runInFlight || !sessionId || !onSelectBranch) return;
    if (!sawRunRef.current) return;
    const index = lastAssistantIndex;
    const message = messages[index];
    if (
      !message ||
      message.role !== "assistant" ||
      !message.id ||
      !message.content?.trim() ||
      message.interrupted ||
      message.contentVersions ||
      isExternalAgentRunMessage(message) ||
      conversationLocked
    ) {
      return;
    }
    const key = `${sessionId}:${message.id}`;
    if (attemptedRef.current.has(key)) return;
    attemptedRef.current.add(key);

    // Deliberately not aborted by this effect's cleanup. `messages` is in the
    // dependency list, so the effect re-runs on every transcript tick - an
    // inline card settling, an artifact arriving - and cleanup-on-rerun would
    // cancel the rewrite a few milliseconds after starting it, every time. The
    // request is tied to the panel's lifetime instead, and `attemptedRef` is
    // what stops a second one.
    const controller = new AbortController();
    autoHumanizeAbortRef.current?.abort();
    autoHumanizeAbortRef.current = controller;
    const content = message.content;
    void autoHumanizeMessage({
      conversationId: sessionId,
      // A live answer keeps its browser UUID until the transcript is restored.
      // The apply route accepts that durable turn identity as well as msg_N.
      messageId: message.clientMessageId ?? message.id,
      content,
      signal: controller.signal,
    }).then((outcome) => {
      if (!outcome || controller.signal.aborted) return;
      // Re-find the row: the transcript may have moved on while the rewrite ran,
      // and replacing by stale index would rewrite the wrong answer.
      const current = messages.findIndex(
        (candidate) => candidate.id === message.id && candidate.content === content,
      );
      if (current < 0) return;
      replaceMessage(current, {
        content: outcome.content,
        humanizerReview: outcome.review,
        ...(outcome.adopted && outcome.versions
          ? {
              contentVersions: outcome.versions,
              // Evidence describes the wording the model produced, not a
              // later rewrite of it. Selecting version 1 brings it back.
              verification: undefined,
            }
          : {}),
      });
    });
  }, [
    conversationLocked,
    humanizerEnabled,
    lastAssistantIndex,
    messages,
    onSelectBranch,
    replaceMessage,
    runInFlight,
    sessionId,
  ]);

  function switchBranch(
    group: ConversationBranchGroup,
    direction: -1 | 1,
  ) {
    if (activeRun || !onSelectBranch) return;
    const targetIndex = Math.min(
      group.variants.length - 1,
      Math.max(0, group.activeIndex + direction),
    );
    if (targetIndex === group.activeIndex) return;

    const variants = group.variants.map((variant) => cloneMessages(variant));
    variants[group.activeIndex] = cloneMessages(messages);
    const nextGroup = { ...group, activeIndex: targetIndex, variants };
    setBranchGroups((current) => ({
      ...current,
      [group.id]: nextGroup,
    }));
    onSelectBranch(
      applyBranchVariant({
        messages,
        variant: variants[targetIndex],
        groupId: group.id,
      }),
    );
  }

  // Stable identities: these two are props of every memoized assistant
  // markdown row, and a fresh function on each panel render would re-render —
  // and re-parse — every mounted message on every streaming tick.
  const receiveTextSelection = useCallback(
    (selection: ChatTextSelectionCandidate) => {
      if (!onAskSelection || activeRun || conversationLocked) return;
      const overlapping = (
        annotationsByMessage.get(selection.sourceMessageId) ?? []
      ).find((annotation) => chatTextSelectionsOverlap(annotation, selection));
      if (overlapping) {
        setSelectionMenu(null);
        setOpenInlineAnswer({ id: overlapping.id, anchor: selection.anchor });
        window.getSelection()?.removeAllRanges();
        return;
      }
      setOpenInlineAnswer(null);
      setSelectionMenu(selection);
    },
    [activeRun, annotationsByMessage, conversationLocked, onAskSelection],
  );

  function beginSelectionQuestion(mode: "chat" | "inline") {
    if (!selectionMenu) return;
    const selection: ChatTextSelectionReference = {
      id: crypto.randomUUID(),
      mode,
      sourceMessageId: selectionMenu.sourceMessageId,
      start: selectionMenu.start,
      end: selectionMenu.end,
      quote: selectionMenu.quote,
      prefix: selectionMenu.prefix,
      suffix: selectionMenu.suffix,
    };
    if (mode === "inline") {
      setSavedInlineSelections((current) => [...current, selection]);
    }
    setComposerSelection(selection);
    setSelectionMenu(null);
    setOpenInlineAnswer(null);
    window.getSelection()?.removeAllRanges();
    window.setTimeout(() => composerTextareaRef.current?.focus(), 0);
  }

  function cancelSelectionQuestion() {
    const selection = composerSelection;
    setComposerSelection(null);
    if (
      selection?.mode === "inline" &&
      !messages.some((message) => message.textSelection?.id === selection.id)
    ) {
      setSavedInlineSelections((current) =>
        current.filter((candidate) => candidate.id !== selection.id),
      );
    }
  }

  function submitComposer() {
    // Voice mode submits through here without going near the send button, so
    // the lock is re-checked rather than left to the disabled control.
    if (loadingTranscript) return;
    if (!composerSelection || !onAskSelection) {
      onSubmit();
      return;
    }
    const question = input.trim();
    if (!question || activeRun || conversationLocked) return;
    const selection = composerSelection;
    setComposerSelection(null);
    setSelectionMenu(null);
    setOpenInlineAnswer(null);
    onInputChange("");
    void onAskSelection(question, selection);
  }

  const openAnnotation = useCallback(
    (annotationId: string, anchor: FloatingAnchorRect) => {
      const thread = inlineSelectionThreads.get(annotationId);
      if (!thread) return;
      if (!thread.question) {
        setComposerSelection(thread.selection);
        window.setTimeout(() => composerTextareaRef.current?.focus(), 0);
        return;
      }
      setOpenInlineAnswer((current) =>
        current?.id === annotationId
          ? null
          : { id: annotationId, anchor },
      );
    },
    [composerTextareaRef, inlineSelectionThreads],
  );

  function deleteInlineSelection(annotationId: string) {
    setOpenInlineAnswer(null);
    setSelectionMenu(null);
    setComposerSelection((current) =>
      current?.id === annotationId ? null : current,
    );
    setSavedInlineSelections((current) =>
      current.filter((selection) => selection.id !== annotationId),
    );
    setDeletedInlineSelectionIds((current) => {
      const next = new Set(current);
      next.add(annotationId);
      return next;
    });
  }

  // The inline popover's own Stop. An "Ask here" question runs as an
  // ordinary Hermes turn, so cancelling it is the same abort the composer would
  // have sent — only reachable from the highlight it belongs to.
  const stopInlineAnswer = useCallback(() => {
    if (activeRun) onAbort();
  }, [activeRun, onAbort]);

  // Retry and edit are one path: both send the question again against the same
  // highlight, and the thread map keeps the newest question/answer pair for the
  // selection id, so the popover redraws around the new turn.
  function askInlineSelectionAgain(
    selection: ChatTextSelectionReference,
    question: string,
  ) {
    const trimmed = question.trim();
    if (!trimmed || !onAskSelection || activeRun || conversationLocked) return;
    // A question the composer is still holding for some other highlight is
    // left alone: it belongs to that highlight, not to this turn.
    void onAskSelection(trimmed, selection);
  }

  const openThread = openInlineAnswer
    ? inlineSelectionThreads.get(openInlineAnswer.id)
    : undefined;

  return (
    // One attribute rather than a prop on every bubble: user messages are drawn
    // in three places (a turn, an edit form, a steered segment) and some of them
    // are nested components, so the mode is announced once here and the styling
    // is a descendant rule in globals.css.
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      style={composerInset.style}
      data-temporary-chat={temporaryChat ? "true" : undefined}
    >
      {/* Positioning context for the jump control, so it floats at the foot of
          the transcript rather than below the composer. The transcript keeps
          its own indentation; only this wrapper is new. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={transcriptScrollRef}
        className="bb-chat-scroller min-h-0 flex-1 overflow-y-auto"
      >
        <div className="bb-chat-scroll-tail mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-5">
          {messages.length === 0 ? (
            // The suggestion cards invite a new chat, so showing them over a
            // transcript that is still arriving reads as "this chat is empty".
            loadingTranscript ? (
              <div className="flex items-center justify-center py-12">
                <BreadboardLoader
                  label="Loading this chat"
                  className="h-5 w-5 text-gray-400"
                />
              </div>
            ) : failureText ? (
              // A turn that died before it wrote anything — a preflight that
              // could not be granted, say — leaves an empty transcript with a
              // reason attached. Greeting someone under the reason their last
              // attempt failed reads as two screens stacked by accident, so the
              // failure notice below stands on its own.
              null
            ) : (
              emptyState ?? (
                <p className="py-8 text-center text-sm text-gray-500">
                  Ask the agent anything. It can use tools, and will ask before doing anything sensitive.
                </p>
              )
            )
          ) : (
            <InlineArtifactCardsProvider
              conversationId={surface !== "quartz_ai" ? sessionId : null}
              retireVersion={inlineArtifactRetireVersion}
            >
            <div className="space-y-5">
              <VirtualizedMessageList
                surface={surface === "quartz_ai" ? "quartz-ai" : "hermes-chat"}
                className="w-full"
                items={transcriptRows}
                scrollRef={transcriptScrollRef}
                bridge={transcriptVirtual}
                // What `space-y-5` drew between rows.
                gap={20}
                resetKey={sessionId}
                getItemKey={transcriptRowKey}
                estimateSize={transcriptRowHeight}
                renderItem={({ message, index }) => {
                if (message.modelChange) {
                  return (
                    <ChatModelChangeSeparator modelName={message.modelChange} />
                  );
                }
                const responseInterrupted = Boolean(
                  message.role === "assistant" &&
                    !isExternalAgentRunMessage(message) &&
                    (message.interrupted ||
                      (failureInline && index === lastAssistantIndex)),
                );
                const isAgentContinuationResponse = Boolean(
                  message.role === "assistant" &&
                    messages[index - 1]?.internalAgentContinuation === true,
                );
                const continuationOwner = isAgentContinuationResponse
                  ? messages[index - 2]
                  : undefined;
                const continuationPreamble =
                  continuationOwner?.delegatedAgentRun === true
                    ? continuationOwner.delegatedAgentPreamble?.trim() ||
                      continuationOwner.content.trim()
                    : "";
                // The delegating turn is hidden behind this row, so its time
                // belongs to this row's clock. Without it the answer claimed
                // the seconds of its synthesis as the whole operation's.
                const carriedDurationMs =
                  delegatedTurnCarriedDurationMs(continuationOwner);
                // The hidden turn's tokens are part of what this answer cost.
                const totalUsage = delegatedTurnTotalUsage(
                  continuationOwner,
                  message.usage,
                );
                // Keep one visible assistant row during the hand-back. Until
                // synthesis emits its first text, the row retains the sentence
                // the person was already reading instead of collapsing to an
                // otherwise empty status line.
                const visibleAssistantContent =
                  index === lastAssistantIndex
                    ? revealedAssistantContent || continuationPreamble
                    : message.content || continuationPreamble;
                const inlineMapKind =
                  message.role === "assistant" &&
                  index === lastAssistantIndex &&
                  !runInFlight &&
                  !isExternalAgentRunMessage(message)
                    ? inlineMapKindForAssistant(messages, index)
                    : null;
                const inlineMapRequestStartedAt = inlineMapKind
                  ? messages[previousUserMessageIndex(messages, index)]?.createdAt
                  : undefined;
                const inlineSpotify =
                  message.role === "assistant" &&
                  index === spotifyPlayerOwner &&
                  !isExternalAgentRunMessage(message)
                    ? {
                        requestedAt:
                          messages[previousUserMessageIndex(messages, index)]
                            ?.createdAt,
                      }
                    : null;
                const delegatedAgentCompleted =
                  delegatedAgentCompletedLabelForMessage(message);
                const delegatedAgentStartedAt =
                  delegatedAgentStartedAtForMessage(message);
                // A delegated worker owns no visible card, so this row is the
                // only sign the turn is still going — and it has to hold that
                // sign across the whole hand-off, not just the part with a run
                // row behind it. `delegationInFlight` covers the launch that
                // has not produced a run yet and the result not yet handed
                // back; both used to settle this row into its past tense and
                // stop its timer while the work carried on.
                const delegatedAgentActive =
                  externalAgentRunInFlight(message) ||
                  (index === lastAssistantIndex && delegationInFlight);
                // Past tense while it runs read as an answer that had stopped
                // mid-thought.
                const delegatedAgentLabel = delegatedAgentActive
                  ? delegatedAgentActivityLabelForMessage(message) ??
                    delegatedAgentCompleted
                  : delegatedAgentCompleted;
                return (
                <div
                  className={timeSeparators[index] ? "space-y-3" : undefined}
                >
                  {timeSeparators[index] ? (
                    <ChatTimeSeparator
                      label={timeSeparators[index]}
                      dateTime={message.createdAt}
                    />
                  ) : null}
                  <div
                    className={message.role === "user" ? "group flex justify-end" : ""}
                  >
                    <div className={message.role === "user" ? "flex w-fit max-w-[75%] flex-col items-end gap-1" : "w-full"}>
                    <MessageActionsSlot
                      suppressActions={
                        message.delegatedAgentRun === true ||
                        (index === lastAssistantIndex && delegationInFlight)
                      }
                    >
                    {message.role === "user" ? (
                      <ChatMessageAttachments
                        attachments={message.attachments}
                        attachmentNames={message.attachmentNames}
                      />
                    ) : null}
                    {message.role === "user" ? (
                      <ChatVideoLinkEmbeds
                        text={message.content}
                        attachments={message.attachments}
                      />
                    ) : null}
                    {message.role === "assistant" &&
                    message.delegatedAgentPreamble &&
                    !message.openGymRun ? (
                      <div className="mb-3 text-sm leading-7 text-gray-200">
                        <ActivityPanel
                          activities={[]}
                          connection={delegatedAgentActive ? "streaming" : "idle"}
                          pendingPermission={null}
                          usage={message.usage}
                          responseDurationMs={message.responseDurationMs}
                          activePhaseStartedAt={delegatedAgentStartedAt}
                          onPermissionDecision={onPermissionDecision}
                          stateLabel={delegatedAgentLabel}
                          completedLabel={delegatedAgentCompleted}
                        />
                        <SelectableAssistantMarkdown
                          content={message.delegatedAgentPreamble}
                          sourceMessageId={`${messageSelectionSourceId(
                            message,
                            index,
                          )}-delegation-preamble`}
                          annotations={[]}
                          onSelection={receiveTextSelection}
                          onOpenAnnotation={openAnnotation}
                        />
                      </div>
                    ) : null}
                    {message.role === "user" ? (
                      editingMessageId === messageBranchId(message, index) ? (
                        <form
                          className="neu-chat-message neu-chat-message-user min-w-64 rounded-[22px] p-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveMessageEdit(message, index);
                          }}
                        >
                          <textarea
                            value={messageEditText}
                            onChange={(event) => setMessageEditText(event.target.value)}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                (event.ctrlKey || event.metaKey)
                              ) {
                                event.preventDefault();
                                event.currentTarget.form?.requestSubmit();
                              }
                            }}
                            rows={Math.min(6, Math.max(2, messageEditText.split("\n").length))}
                            className="max-h-40 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-[var(--ink)] outline-none"
                            aria-label="Edit message"
                            autoFocus
                          />
                          <div className="mt-1 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingMessageId(null)}
                              className="rounded-full px-3 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={activeRun || !messageEditText.trim()}
                              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] px-3 text-xs font-medium text-[var(--paper-raised)] shadow-sm transition-colors hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)] disabled:shadow-none"
                            >
                              <span>Save &amp; send</span>
                              <svg
                                className="h-3.5 w-3.5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2.2}
                                aria-hidden
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0-6 6m6-6 6 6" />
                              </svg>
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          {message.textSelection?.mode === "chat" ? (
                            <QuotedChatSelection selection={message.textSelection} />
                          ) : null}
                          <div className="neu-chat-message neu-chat-message-user rounded-[22px] px-4 py-2.5 text-sm leading-6">
                            <CollapsibleUserMessage
                              messageKey={messageBranchId(message, index)}
                            >
                              <UserMessageText content={message.content} />
                            </CollapsibleUserMessage>
                          </div>
                          <div className="mt-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() =>
                                void copyUserMessage(
                                  message,
                                  messageBranchId(message, index),
                                )
                              }
                              className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
                              title={copiedUserId === messageBranchId(message, index) ? "Copied" : "Copy message"}
                              aria-label={copiedUserId === messageBranchId(message, index) ? "Message copied" : "Copy message"}
                            >
                              {copiedUserId === messageBranchId(message, index) ? (
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                                </svg>
                              ) : (
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                                  <rect x="8" y="8" width="11" height="11" rx="2" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                                </svg>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPromptToSave(message.content)}
                              className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
                              title="Save to Prompts"
                              aria-label="Save message to Prompts"
                            >
                              <svg
                                className="h-4 w-4"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={1.7}
                                aria-hidden
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.75L6 21V4.75Z"
                                />
                                <path strokeLinecap="round" d="M9 7.5h6" />
                              </svg>
                            </button>
                            {onEditMessage ? (
                              <button
                                type="button"
                                onClick={() =>
                                  beginMessageEdit(
                                    message,
                                    messageBranchId(message, index),
                                  )
                                }
                                disabled={activeRun}
                                className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:cursor-not-allowed disabled:opacity-35"
                                title="Edit message"
                                aria-label="Edit message and create a branch"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z" />
                                </svg>
                              </button>
                            ) : null}
                            {onDeleteMessage ? (
                              <button
                                type="button"
                                onClick={() => deleteMessageTurn(message, index)}
                                disabled={activeRun || conversationLocked}
                                className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-35"
                                title="Delete message"
                                aria-label="Delete this message and its answer"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7m-7 0 .8 11.2A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.8L17 7" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        </>
                      )
                    ) : isExternalAgentRunMessage(message) ? (
                      <div
                        className={
                          message.delegatedAgentRun && !message.openGymRun
                            ? "hidden"
                            : "contents"
                        }
                        aria-hidden={
                          (message.delegatedAgentRun && !message.openGymRun) ||
                          undefined
                        }
                      >
                      {message.browserRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineBrowserRun
                          agentId={message.browserRun.agentId}
                          runId={message.browserRun.runId}
                          task={message.browserRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.agentBrowserRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineAgentBrowserRun
                          agentId={message.agentBrowserRun.agentId}
                          runId={message.agentBrowserRun.runId}
                          task={message.agentBrowserRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.maxResearchRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineMaxResearchRun
                          runId={message.maxResearchRun.runId}
                          query={message.maxResearchRun.query}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.deepResearchRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineDeepResearchRun
                          runId={message.deepResearchRun.runId}
                          query={message.deepResearchRun.query}
                          output={message.deepResearchRun.output}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.getDocRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineGetDocRun
                          runId={message.getDocRun.runId}
                          query={message.getDocRun.query}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.meetingNotesRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineMeetingNotesRun
                          runId={message.meetingNotesRun.runId}
                          task={message.meetingNotesRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.deepTutorRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineDeepTutorRun
                          runId={message.deepTutorRun.runId}
                          task={message.deepTutorRun.task}
                          capability={message.deepTutorRun.capability}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.agentReachRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineAgentReachRun
                          runId={message.agentReachRun.runId}
                          task={message.agentReachRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.careerOpsRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineCareerOpsRun
                          runId={message.careerOpsRun.runId}
                          task={message.careerOpsRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.openGymRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineOpenGymRun
                          runId={message.openGymRun.runId}
                          task={message.openGymRun.task}
                          quiet={
                            message.openGymRun.quiet === true ||
                            message.delegatedAgentRun === true
                          }
                          persistedContent={externalAgentCardContent(message)}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted || index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.vibeTradingRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineVibeTradingRun
                          runId={message.vibeTradingRun.runId}
                          task={message.vibeTradingRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.stockAnalystRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineStockAnalystRun
                          runId={message.stockAnalystRun.runId}
                          task={message.stockAnalystRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.deerFlowRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineDeerFlowRun
                          runId={message.deerFlowRun.runId}
                          task={message.deerFlowRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.tradingAgentsRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineTradingAgentsRun
                          runId={message.tradingAgentsRun.runId}
                          task={message.tradingAgentsRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.openPlanterRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineOpenPlanterRun
                          runId={message.openPlanterRun.runId}
                          task={message.openPlanterRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.socialsManagerRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineSocialsManagerRun
                          runId={message.socialsManagerRun.runId}
                          brief={message.socialsManagerRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.hardwareBlueprintRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineHardwareBlueprintRun
                          runId={message.hardwareBlueprintRun.runId}
                          brief={message.hardwareBlueprintRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          persistedState={message.externalAgentState}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.parametricCadRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineParametricCadRun
                          runId={message.parametricCadRun.runId}
                          brief={message.parametricCadRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.openMontageRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineOpenMontageRun
                          runId={message.openMontageRun.runId}
                          brief={message.openMontageRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.hyperframesRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineHyperframesRun
                          runId={message.hyperframesRun.runId}
                          brief={message.hyperframesRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.resource2SkillRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineResource2SkillRun
                          runId={message.resource2SkillRun.runId}
                          brief={message.resource2SkillRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted || index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.matraixRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineMatraixRun
                          runId={message.matraixRun.runId}
                          brief={message.matraixRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted || index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.boltSlidesRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineBoltSlidesRun
                          runId={message.boltSlidesRun.runId}
                          brief={message.boltSlidesRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted || index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.openworkRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineOpenworkRun
                          runId={message.openworkRun.runId}
                          task={message.openworkRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.openscienceRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineOpenscienceRun
                          runId={message.openscienceRun.runId}
                          task={message.openscienceRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.inboxZeroRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineInboxZeroRun
                          runId={message.inboxZeroRun.runId}
                          task={message.inboxZeroRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.vimaxRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineVimaxRun
                          runId={message.vimaxRun.runId}
                          brief={message.vimaxRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.voxDirectorRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineVoxDirectorRun
                          runId={message.voxDirectorRun.runId}
                          brief={message.voxDirectorRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.shortsRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineShortsRun
                          runId={message.shortsRun.runId}
                          task={message.shortsRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted || index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.formsmithRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineFormsmithRun
                          runId={message.formsmithRun.runId}
                          task={message.formsmithRun.task}
                          persistedContent={externalAgentCardContent(message)}
                          persistedOutcome={message.externalAgentOutcome}
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.videoUseRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineVideoUseRun
                          runId={message.videoUseRun.runId}
                          task={message.videoUseRun.task}
                          quiet={message.videoUseRun.quiet === true}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onSourceReady={onExternalAgentSourceReady}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted || index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.moneyPrinterRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineMoneyPrinterRun
                          runId={message.moneyPrinterRun.runId}
                          brief={message.moneyPrinterRun.brief}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted || index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.legalRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineLegalRun
                          runId={message.legalRun.runId}
                          task={message.legalRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted || index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.wardrobeRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineWardrobeRun
                          runId={message.wardrobeRun.runId}
                          task={message.wardrobeRun.task}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted || index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.codexRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineOpenCodeRun
                          runId={message.codexRun.runId}
                          task={message.codexRun.task}
                          gardenSlug={message.codexRun.gardenSlug}
                          agentName="Codex"
                          apiSlug="codex"
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedActivity={message.externalAgentActivity}
                          persistedEdits={message.externalAgentEdits}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted || index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.openCodeRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineOpenCodeRun
                          runId={message.openCodeRun.runId}
                          task={message.openCodeRun.task}
                          gardenSlug={message.openCodeRun.gardenSlug}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedActivity={message.externalAgentActivity}
                          persistedEdits={message.externalAgentEdits}
                          persistedUsage={message.usage}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : message.rufloRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlineRufloRun
                          runId={message.rufloRun.runId}
                          task={message.rufloRun.task}
                          gardenSlug={message.rufloRun.gardenSlug}
                          persistedContent={message.content}
                          persistedOutcome={message.externalAgentOutcome}
                          persistedEdits={message.externalAgentEdits}
                          onRetry={
                            onRetryMessage &&
                            !activeRun &&
                            (message.interrupted ||
                              index === lastAssistantIndex)
                              ? () => retryAssistantAsBranch(index)
                              : undefined
                          }
                          onTerminal={(result) => {
                            if (message.clientMessageId) {
                              onExternalAgentTerminal?.(message.clientMessageId, result);
                            }
                          }}
                        />
                      </div>
                    ) : null}
                      </div>
                    ) : (
                      <div className="text-sm leading-7 text-gray-200">
                        <ActivityPanel
                          activities={
                            index === lastAssistantIndex && !inlineRunActive
                              ? activities
                              : []
                          }
                          connection={
                            // A worker running behind this row keeps it alive
                            // even though the chat connection itself is idle:
                            // the turn is not over until its delegation is.
                            delegatedAgentActive
                              ? "streaming"
                              : index === lastAssistantIndex && !inlineRunActive
                                ? connection
                                : "idle"
                          }
                          pendingPermission={
                            index === lastAssistantIndex && !inlineRunActive
                              ? pendingPermission
                              : null
                          }
                          usage={totalUsage}
                          responseDurationMs={message.responseDurationMs}
                          // The row survives navigation even though this
                          // component's activity state does not. Its timestamp
                          // keeps a restored live timer on the original turn.
                          responseStartedAt={
                            delegatedAgentActive || isAgentContinuationResponse
                              ? undefined
                              : message.createdAt
                          }
                          // The delegation's own clock. Without it the timer
                          // restarts from zero when the worker phase begins,
                          // losing the time the turn had already spent.
                          activePhaseStartedAt={delegatedAgentStartedAt}
                          carriedDurationMs={carriedDurationMs}
                          onPermissionDecision={onPermissionDecision}
                          completedLabel={delegatedAgentLabel}
                          stateLabel={
                            responseInterrupted
                              ? "Interrupted"
                              : delegatedAgentActive && delegatedAgentLabel
                                ? delegatedAgentLabel
                                : isAgentContinuationResponse
                                  ? index === lastAssistantIndex && streaming
                                    ? "Synthesizing research"
                                    : "Research synthesized"
                                  : undefined
                          }
                          stateFailed={responseInterrupted}
                        />
                        {message.memoryUpdated ? (
                          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                            <span aria-hidden>📖</span>
                            <span>Memory updated</span>
                          </div>
                        ) : null}
                        {inlineMapKind && sessionId && surface !== "quartz_ai" ? (
                          <InlineConversationMap
                            conversationPublicId={sessionId}
                            kind={inlineMapKind}
                            requestedAt={inlineMapRequestStartedAt}
                          />
                        ) : null}
                        {inlineSpotify && sessionId && surface !== "quartz_ai" ? (
                          <InlineSpotifyPlayer
                            key={`${sessionId}:${inlineSpotify.requestedAt ?? ""}`}
                            conversationPublicId={sessionId}
                            requestedAt={inlineSpotify.requestedAt}
                          />
                        ) : null}
                        {visibleAssistantContent ||
                        inlinedCourseCorrections.byAssistantIndex.has(index) ? (
                          inlinedCourseCorrections.byAssistantIndex.has(index) ? (
                            <SteeredAssistantResponse
                              content={visibleAssistantContent}
                              corrections={
                                inlinedCourseCorrections.byAssistantIndex.get(index) ?? []
                              }
                            />
                          ) : (
                            <SelectableAssistantMarkdown
                              content={visibleAssistantContent}
                              sourceMessageId={messageSelectionSourceId(
                                message,
                                index,
                              )}
                              annotations={
                                annotationsByMessage.get(
                                  messageSelectionSourceId(message, index),
                                ) ?? []
                              }
                              onSelection={receiveTextSelection}
                              onOpenAnnotation={openAnnotation}
                            />
                          )
                        ) : null}
                        {failureInline &&
                        index === lastAssistantIndex &&
                        // A gate that replaces the answer with its own
                        // explanation sends that sentence twice: once as the
                        // message, once as this notice. Print it once.
                        (failureText ?? "").trim() !==
                          visibleAssistantContent.trim() ? (
                          <div role="alert">
                            <ChatMarkdown content={failureText ?? ""} />
                          </div>
                        ) : null}
                      </div>
                    )}
                    {message.role === "assistant" &&
                    sessionId &&
                    surface !== "quartz_ai" ? (
                      <InlineArtifactCards
                        ownerMessageId={
                          message.artifactMessageId ?? message.id ?? null
                        }
                       />
                     ) : null}
                    {message.role === "assistant" &&
                    isExternalAgentRunMessage(message) &&
                    !(runInFlight && index === lastAssistantIndex) ? (
                      (() => {
                        const branch = branchNavigationForAssistant(
                          message,
                          index,
                        );
                        return branch ? (
                          <AssistantResponseBranchNavigation
                            branch={branch}
                            className="mt-2"
                          />
                        ) : null;
                      })()
                    ) : null}
                    {message.role === "assistant" &&
                    !isExternalAgentRunMessage(message) &&
                    !(runInFlight && index === lastAssistantIndex) ? (
                      <AssistantMessageActions
                        content={
                          message.content ||
                          (failureInline && index === lastAssistantIndex
                            ? failureText
                            : null) ||
                          (message.interrupted
                            ? "Interrupted"
                            : "Response unavailable")
                        }
                        verification={message.verification}
                        branch={branchNavigationForAssistant(message, index)}
                        onRewrite={
                          onRetryMessage &&
                          message.content?.trim() &&
                          !activeRun &&
                          !conversationLocked &&
                          (message.interrupted || index === lastAssistantIndex)
                            ? () => retryAssistantAsBranch(index)
                            : undefined
                        }
                        onRetry={
                          (!responseInterrupted || !disabled) &&
                          onRetryMessage &&
                          !activeRun &&
                          (message.interrupted || index === lastAssistantIndex)
                            ? () => retryAssistantAsBranch(index)
                            : undefined
                        }
                      />
                    ) : null}
                    </MessageActionsSlot>
                    </div>
                  </div>
                </div>
              );
              }}
              />
              {sessionId && surface !== "quartz_ai" ? (
                <InlineArtifactCards ownerMessageId={null} />
              ) : null}
              {sessionId && surface !== "quartz_ai" ? (
                // Garden proposals this conversation created and nobody has
                // decided on yet. Without this the Terminal can propose a note
                // it has no way to apply.
                <InlineProposalCards
                  conversationId={sessionId}
                  gardenSlug={gardenSlug}
                  refreshKey={activeRun}
                />
              ) : null}
            </div>
            </InlineArtifactCardsProvider>
          )}

          {failureText && !failureInline ? (
            // Some run cards cannot host the plain assistant response header.
            // Keep the fallback in the transcript, but use the same lifecycle
            // row instead of appending a second status strip below the chat.
            <div className="mt-5 w-full text-sm leading-7 text-gray-200" role="alert">
              <AssistantResponseMeta
                active={false}
                failed
                // Nothing was interrupted when the transcript is empty: no
                // answer ever started, so there was no line to cut short.
                label={messages.length === 0 ? "Couldn’t run that turn" : "Interrupted"}
                // This notice is the fallback for a failure with no message to
                // measure, so it never carries a usage record — left on, the
                // row would always end in "tokens unavailable", which states
                // an absence nobody asked about.
                showTokenUsage={false}
                action={
                  onRetryMessage && lastAssistantIndex >= 0 && !activeRun ? (
                    <button
                      type="button"
                      onClick={() => retryAssistantAsBranch(lastAssistantIndex)}
                      className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] focus:outline-none focus:ring-2 focus:ring-[var(--line-strong)]"
                      title="Regenerate response"
                      aria-label="Regenerate response"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.7}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M20 6v5h-5M4 18v-5h5m9.7-3A7 7 0 0 0 6.1 7.1L4 11m16 2-2.1 3.9A7 7 0 0 1 5.3 14"
                        />
                      </svg>
                    </button>
                  ) : undefined
                }
              />
              <ChatMarkdown content={failureText} />
            </div>
          ) : null}
          {messages.some((message) => !message.modelChange) ? (
            <ChatDisclaimer />
          ) : null}
        </div>
      </div>
        <ChatMessageRail
          surface={surface === "quartz_ai" ? "quartz-ai" : "hermes-chat"}
          items={railItems}
          scrollRef={transcriptScrollRef}
          bridge={transcriptVirtual}
        />
        <ChatJumpToBottom
          visible={transcriptAwayFromBottom}
          busy={Boolean(transcriptResponding)}
          onJump={jumpToNewestMessage}
        />
      </div>

      {selectionMenu ? (
        <ChatSelectionMenu
          selection={selectionMenu}
          onAskInChat={() => beginSelectionQuestion("chat")}
          onAskHere={() => beginSelectionQuestion("inline")}
          onClose={() => setSelectionMenu(null)}
        />
      ) : null}
      {openInlineAnswer && openThread ? (
        <InlineSelectionAnswerPopover
          anchor={openInlineAnswer.anchor}
          question={openThread.question}
          answer={openThread.answer}
          pending={openThread.pending}
          usage={openThread.usage}
          responseDurationMs={openThread.responseDurationMs}
          startedAt={openThread.startedAt}
          onClose={() => setOpenInlineAnswer(null)}
          onDelete={() => deleteInlineSelection(openThread.selection.id)}
          onStop={openThread.pending ? stopInlineAnswer : undefined}
          onAskAgain={
            onAskSelection && !activeRun && !conversationLocked
              ? (question: string) =>
                  askInlineSelectionAgain(openThread.selection, question)
              : undefined
          }
        />
      ) : null}

      <div ref={composerInset.ref} className="bb-composer-overlay px-4 pb-3">
        {beforeComposer ? (
          <div
            className={`mx-auto w-full ${compact ? "max-w-3xl" : "max-w-5xl"}`}
          >
            {beforeComposer}
          </div>
        ) : null}
        {composerSelection ? (
          <SelectionComposerContext
            selection={composerSelection}
            onCancel={cancelSelectionQuestion}
          />
        ) : null}
        <AssistantComposer
          className={`mx-auto w-full ${compact ? "max-w-3xl" : "max-w-5xl"}`}
          compact={compact}
          value={input}
          onChange={onInputChange}
          onSubmit={submitComposer}
          onRunWorkflow={onRunWorkflow}
          history={sentMessages}
          textareaRef={composerTextareaRef}
          // A chat that is still arriving keeps its ordinary invitation and
          // stays typable: the wait belongs on the send button, which spins,
          // and not in the box, where it looked like the field was dead.
          placeholder={placeholder ?? "Ask the agent…"}
          disabled={conversationLocked}
          loading={loadingTranscript}
          queueDisabled={Boolean(disabled)}
          isSending={streaming}
          canSubmit={Boolean(input.trim() || (!streaming && attachments?.length))}
          model={model ?? ""}
          models={models ?? []}
          onModelChange={onModelChange ?? (() => undefined)}
          reasoningEffort={reasoningEffort ?? DEFAULT_ASSISTANT_REASONING_EFFORT}
          onReasoningEffortChange={onReasoningEffortChange ?? (() => undefined)}
          intelligenceModes={intelligenceModes}
          modelFailover={modelFailover}
          onAddDocuments={onAddDocuments}
          onPasteFiles={onPasteFiles}
          isAddingDocuments={isAddingDocuments}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          statusMessage={statusMessage}
          browserAgent={browserAgent}
          onClearBrowserAgent={onClearBrowserAgent}
          onSelectBrowserAgent={onSelectBrowserAgent}
          agentBrowserAgent={agentBrowserAgent}
          onClearAgentBrowser={onClearAgentBrowser}
          onSelectAgentBrowser={onSelectAgentBrowser}
          agentReachAgent={agentReachAgent}
          onClearAgentReach={onClearAgentReach}
          onSelectAgentReach={onSelectAgentReach}
          getDocAgent={getDocAgent}
          onClearGetDoc={onClearGetDoc}
          onSelectGetDoc={onSelectGetDoc}
          meetingNotesAgent={meetingNotesAgent}
          onClearMeetingNotes={onClearMeetingNotes}
          onSelectMeetingNotes={onSelectMeetingNotes}
          onMeetingRecorded={onMeetingRecorded}
          deepTutorAgent={deepTutorAgent}
          onClearDeepTutor={onClearDeepTutor}
          onSelectDeepTutor={onSelectDeepTutor}
          careerOpsAgent={careerOpsAgent}
          onClearCareerOps={onClearCareerOps}
          onSelectCareerOps={onSelectCareerOps}
          onSelectOpenGym={onSelectOpenGym}
          vibeTradingAgent={vibeTradingAgent}
          onClearVibeTrading={onClearVibeTrading}
          onSelectVibeTrading={onSelectVibeTrading}
          stockAnalystAgent={stockAnalystAgent}
          onClearStockAnalyst={onClearStockAnalyst}
          onSelectStockAnalyst={onSelectStockAnalyst}
          deerFlowAgent={deerFlowAgent}
          onClearDeerFlow={onClearDeerFlow}
          onSelectDeerFlow={onSelectDeerFlow}
          tradingAgentsAgent={tradingAgentsAgent}
          tradingAgentsSeed={tradingAgentsSeed}
          onClearTradingAgents={onClearTradingAgents}
          onSelectTradingAgents={onSelectTradingAgents}
          onSubmitTradingAgents={onSubmitTradingAgents}
          shortsAgent={shortsAgent}
          shortsSeed={shortsSeed}
          onClearShorts={onClearShorts}
          onSelectShorts={onSelectShorts}
          onSubmitShorts={onSubmitShorts}
          formsmithAgent={formsmithAgent}
          onClearFormsmith={onClearFormsmith}
          onSelectFormsmith={onSelectFormsmith}
          onSubmitFormsmith={onSubmitFormsmith}
          deepResearchAgent={deepResearchAgent}
          onClearDeepResearch={onClearDeepResearch}
          onSelectDeepResearch={onSelectDeepResearch}
          openPlanterAgent={openPlanterAgent}
          onClearOpenPlanter={onClearOpenPlanter}
          onSelectOpenPlanter={onSelectOpenPlanter}
          onSelectSocialsManager={onSelectSocialsManager}
          onSelectHardwareBlueprint={onSelectHardwareBlueprint}
          onSelectParametricCad={onSelectParametricCad}
          onSelectHyperframes={onSelectHyperframes}
          onSelectResource2Skill={onSelectResource2Skill}
          onSelectMatraix={onSelectMatraix}
          onSelectBoltSlides={onSelectBoltSlides}
          onSelectOpenMontage={onSelectOpenMontage}
          onSelectOpenwork={onSelectOpenwork}
          onSelectOpenscience={onSelectOpenscience}
          onSelectMaxResearch={onSelectMaxResearch}
          onSelectInboxZero={onSelectInboxZero}
          onSelectVimax={onSelectVimax}
          onSelectVoxDirector={onSelectVoxDirector}
          onSelectMoneyPrinter={onSelectMoneyPrinter}
          onSelectLegal={onSelectLegal}
          onSelectWardrobe={onSelectWardrobe}
          openCodeAgent={openCodeAgent}
          onClearOpenCode={onClearOpenCode}
          onSelectOpenCode={onSelectOpenCode}
          codexAgent={codexAgent}
          onClearCodex={onClearCodex}
          onSelectCodex={onSelectCodex}
          rufloAgent={rufloAgent}
          onClearRuflo={onClearRuflo}
          onSelectRuflo={onSelectRuflo}
          voiceMessages={messages}
          headerContent={queuedFollowUpsHeader}
          capabilitySessionId={sessionId}
          capabilitySurface={surface}
          capabilityGardenSlug={gardenSlug}
          runState={runState}
          externalRunActive={externalRunActive}
          onQueueSteer={queueFollowUp}
          // An "Ask here" turn is the popover's run, not the chat's: its
          // question and answer never enter the transcript, so a square where
          // the send button lives would be stopping something the composer is
          // not showing. The popover carries that turn's own Stop instead.
          onStop={canStop && !respondingToInlineSelection ? stopEverything : undefined}
          stopPending={stopRequestPending}
          permissionPending={Boolean(pendingPermission)}
        />
      </div>
      {promptToSave !== null ? (
        <SavePromptDialog
          content={promptToSave}
          onClose={() => setPromptToSave(null)}
        />
      ) : null}
      {messageDeleteDialog}
    </div>
  );
}
