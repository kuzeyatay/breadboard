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
import ChatMessageAttachments from "@/app/components/chat-message-attachments";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import AssistantComposer, {
  type ComposerAttachment,
} from "@/app/components/assistant-composer";
import AssistantMessageActions, {
  MessageActionsSlot,
} from "@/app/components/assistant-message-actions";
import {
  chatAutoScrollResponseKey,
  useChatAutoScroll,
} from "@/app/components/use-chat-auto-scroll";
import BreadboardLoader from "@/app/components/breadboard-loader";
import ChatJumpToBottom from "@/app/components/chat-jump-to-bottom";
import ActivityPanel from "./activity-panel";
import InlineBrowserRun from "./inline-browser-run";
import InlineAgentBrowserRun from "./inline-agent-browser-run";
import InlineArtifactCards, {
  InlineArtifactCardsProvider,
  useInlineArtifactPrefetch,
} from "./inline-artifact-cards";
import { ARTIFACT_BROWSER_EVENT } from "./artifact-viewer";
import InlineProposalCards from "./inline-proposal-cards";
import InlineDeepResearchRun from "./inline-deep-research-run";
import InlineAgentReachRun from "./inline-agent-reach-run";
import InlineGetDocRun from "./inline-get-doc-run";
import InlineMeetingNotesRun from "./inline-meeting-notes-run";
import type { MeetingRecording } from "@/lib/meeting-notes/use-meeting-recorder";
import InlineDeepTutorRun from "./inline-deep-tutor-run";
import InlineCareerOpsRun from "./inline-career-ops-run";
import InlineVibeTradingRun from "./inline-vibe-trading-run";
import InlineStockAnalystRun from "./inline-stock-analyst-run";
import InlinePaperTraderRun from "./inline-paper-trader-run";
import InlineDeerFlowRun from "./inline-deer-flow-run";
import InlineTradingAgentsRun from "./inline-tradingagents-run";
import type { TradingAgentsRequest } from "@/lib/tradingagents/identity.ts";
import InlineOpenPlanterRun from "./inline-openplanter-run";
import InlineSocialsManagerRun from "./inline-socials-manager-run";
import InlineHardwareBlueprintRun from "./inline-hardware-blueprint-run";
import InlineParametricCadRun from "./inline-parametric-cad-run";
import InlineHyperframesRun from "./inline-hyperframes-run";
import InlineResource2SkillRun from "./inline-resource2skill-run";
import InlineOpenMontageRun from "./inline-openmontage-run";
import InlineOpenworkRun from "./inline-openwork-run";
import InlineOpenscienceRun from "./inline-openscience-run";
import InlineInboxZeroRun from "./inline-inbox-zero-run";
import InlineVimaxRun from "./inline-vimax-run";
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
import SavePromptDialog from "./save-prompt-dialog";
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
  cloneMessages,
  createConversationBranch,
  messageBranchId,
  previousUserMessageIndex,
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
  onSubmit: () => void;
  /** Rendered directly above the composer — currently the agent-launch prompt. */
  beforeComposer?: ReactNode;
  onRunWorkflow?: (workflow: LocalWorkflowSummary, input: string) => void | Promise<void>;
  onAskSelection?: (
    question: string,
    selection: ChatTextSelectionReference,
  ) => Promise<void>;
  onSteer: (text: string) => Promise<boolean>;
  onSendQueued: (text: string) => Promise<void>;
  onEditMessage?: (
    messageIndex: number,
    text: string,
    branchGroupId: string,
  ) => void;
  onSelectBranch?: (messages: AgentMessage[]) => void;
  onAbort: () => void;
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
  vibeTradingAgent?: { id: string; name: string } | null;
  onClearVibeTrading?: () => void;
  onSelectVibeTrading?: () => void;
  stockAnalystAgent?: { id: string; name: string } | null;
  onClearStockAnalyst?: () => void;
  onSelectStockAnalyst?: () => void;
  paperTraderAgent?: { id: string; name: string } | null;
  onClearPaperTrader?: () => void;
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
  onSelectOpenMontage?: () => void;
  onSelectOpenwork?: () => void;
  onSelectOpenscience?: () => void;
  onSelectInboxZero?: () => void;
  onSelectVimax?: () => void;
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

interface QueuedFollowUp {
  id: string;
  text: string;
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
                <UserMessageText content={segment.content} />
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function reorderQueuedFollowUps(
  items: QueuedFollowUp[],
  sourceId: string,
  targetId: string,
): QueuedFollowUp[] {
  if (sourceId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return items;

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
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

export default function AgentRuntimePanel({
  messages,
  connection,
  runState,
  externalRunLaunching = false,
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
  onSendQueued,
  onEditMessage,
  onSelectBranch,
  onAbort,
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
  vibeTradingAgent,
  onClearVibeTrading,
  onSelectVibeTrading,
  stockAnalystAgent,
  onClearStockAnalyst,
  onSelectStockAnalyst,
  paperTraderAgent,
  onClearPaperTrader,
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
  onSelectOpenMontage,
  onSelectOpenwork,
  onSelectOpenscience,
  onSelectInboxZero,
  onSelectVimax,
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
}: Props) {
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const copiedUserTimerRef = useRef<number | null>(null);
  const [queuedFollowUps, setQueuedFollowUps] = useState<QueuedFollowUp[]>([]);
  const [applyingSteerId, setApplyingSteerId] = useState<string | null>(null);
  const [sendingQueuedId, setSendingQueuedId] = useState<string | null>(null);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [queuedEditText, setQueuedEditText] = useState("");
  const [draggedQueuedId, setDraggedQueuedId] = useState<string | null>(null);
  const [dragOverQueuedId, setDragOverQueuedId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageEditText, setMessageEditText] = useState("");
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [promptToSave, setPromptToSave] = useState<string | null>(null);
  const [inlineArtifactRetireVersion, setInlineArtifactRetireVersion] = useState(0);
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
    externalRunLaunching || messages.some(externalAgentRunInFlight);
  const runInFlight = activeRun || externalRunActive;
  // Until the transcript has landed there is no history to answer against, and
  // the arriving one would overwrite whatever the turn had already put on
  // screen. Everything that writes to the conversation waits for it: the
  // composer, a retry, and a question asked of a selection.
  const conversationLocked = Boolean(disabled) || loadingTranscript;
  // The composer's stop has to reach whatever is actually working. A Hermes
  // turn is stopped through the session; an external agent runs outside that
  // state machine and is stopped at its own endpoint. Both can be true when a
  // run was delegated mid-turn, so this stops everything in flight rather than
  // picking one — a stop button that stops only some of a busy conversation
  // reads as broken.
  const externalStops = useMemo(
    () => externalAgentAbortUrls(messages),
    [messages],
  );
  const stopEverything = useCallback(() => {
    if (activeRun) onAbort();
    for (const url of externalStops) {
      void fetch(url, { method: "POST" }).catch(() => {
        // The run may have finished between the click and the request; its
        // card reports the real outcome either way.
      });
    }
  }, [activeRun, externalStops, onAbort]);
  // During the dispatch window a launch is in flight but its run does not exist
  // yet, so there is genuinely nothing to stop. Withholding the handler leaves
  // the composer on its send button, which queues — a square that did nothing
  // would be worse than no square.
  const canStop = activeRun || externalStops.length > 0;
  const lastAssistantIndex = messages.reduce(
    (lastIndex, message, index) =>
      message.role === "assistant" && message.textSelection?.mode !== "inline"
        ? index
        : lastIndex,
    -1,
  );
  // A turn failure reads as part of the answer it broke, so when the
  // transcript ends with a plain assistant message the error text renders
  // inside that message, under its thinking header. Run cards and inline
  // selection answers render elsewhere, so failures there keep the
  // standalone notice below the transcript.
  const failureText = error || steerError || null;
  const lastMessage = messages[messages.length - 1];
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
      if (message.role === "user") current.question = message.content;
      else {
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
      (message) => message.textSelection?.mode !== "inline",
    );
    return visible
      ? `${visible.clientMessageId ?? visible.id ?? visible.role}:${visible.content.length}:${visible.content.slice(-32)}`
      : "empty";
  }, [messages]);
  const visibleResponseKey = useMemo(
    () =>
      chatAutoScrollResponseKey(
        messages.filter((message) => message.textSelection?.mode !== "inline"),
      ),
    [messages],
  );
  const respondingToInlineSelection =
    activeRun && messages.at(-1)?.textSelection?.mode === "inline";
  const transcriptResponding =
    (activeRun || streaming) && !respondingToInlineSelection;
  const {
    ref: transcriptScrollRef,
    awayFromBottom: transcriptAwayFromBottom,
    scrollToBottom: jumpToNewestMessage,
  } = useChatAutoScroll<HTMLDivElement>({
    isResponding: transcriptResponding,
    responseKey: visibleResponseKey,
    contentKey: visibleScrollKey,
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

  useEffect(() => {
    if (
      queuedFollowUps.length === 0 ||
      runInFlight ||
      applyingSteerId ||
      sendingQueuedId
    ) {
      return;
    }
    const next = queuedFollowUps[0];
    setQueuedFollowUps((current) => current.filter((item) => item.id !== next.id));
    setSendingQueuedId(next.id);
    void onSendQueued(next.text).finally(() => setSendingQueuedId(null));
  }, [
    runInFlight,
    applyingSteerId,
    onSendQueued,
    queuedFollowUps,
    sendingQueuedId,
  ]);

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

  function queueFollowUp(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setQueuedFollowUps((current) => [
      ...current,
      { id: crypto.randomUUID(), text: trimmed },
    ]);
  }

  async function applyQueuedSteer(item: QueuedFollowUp) {
    if (!activeRun || applyingSteerId) return;
    setApplyingSteerId(item.id);
    try {
      if (await onSteer(item.text)) {
        setQueuedFollowUps((current) =>
          current.filter((candidate) => candidate.id !== item.id),
        );
      }
    } finally {
      setApplyingSteerId(null);
    }
  }

  function beginQueuedEdit(item: QueuedFollowUp) {
    setEditingQueuedId(item.id);
    setQueuedEditText(item.text);
  }

  function saveQueuedEdit(itemId: string) {
    const text = queuedEditText.trim();
    if (!text) return;
    setQueuedFollowUps((current) =>
      current.map((item) => (item.id === itemId ? { ...item, text } : item)),
    );
    setEditingQueuedId(null);
    setQueuedEditText("");
  }

  function moveQueuedFollowUp(itemId: string, offset: -1 | 1) {
    setQueuedFollowUps((current) => {
      const currentIndex = current.findIndex((item) => item.id === itemId);
      const target = current[currentIndex + offset];
      if (currentIndex < 0 || !target) return current;
      return reorderQueuedFollowUps(current, itemId, target.id);
    });
  }

  function finishQueuedDrop(targetId: string) {
    if (draggedQueuedId) {
      setQueuedFollowUps((current) =>
        reorderQueuedFollowUps(current, draggedQueuedId, targetId),
      );
    }
    setDraggedQueuedId(null);
    setDragOverQueuedId(null);
  }

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

  function retryAssistantAsBranch(assistantMessageIndex: number) {
    if (!onRetryMessage || activeRun || conversationLocked) return;
    const userMessageIndex = previousUserMessageIndex(
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
    onSelectBranch(cloneMessages(variants[targetIndex]));
  }

  function receiveTextSelection(selection: ChatTextSelectionCandidate) {
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
  }

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

  function openAnnotation(annotationId: string, anchor: FloatingAnchorRect) {
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
  }

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

  const openThread = openInlineAnswer
    ? inlineSelectionThreads.get(openInlineAnswer.id)
    : undefined;

  return (
    // One attribute rather than a prop on every bubble: user messages are drawn
    // in three places (a turn, an edit form, a steered segment) and some of them
    // are nested components, so the mode is announced once here and the styling
    // is a descendant rule in globals.css.
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-temporary-chat={temporaryChat ? "true" : undefined}
    >
      {/* Positioning context for the jump control, so it floats at the foot of
          the transcript rather than below the composer. The transcript keeps
          its own indentation; only this wrapper is new. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={transcriptScrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-5">
          {messages.length === 0 ? (
            // The suggestion cards invite a new chat, so showing them over a
            // transcript that is still arriving reads as "this chat is empty".
            loadingTranscript ? (
              <div className="flex items-center justify-center py-12">
                <BreadboardLoader label="Loading this chat" />
              </div>
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
              {messages.map((storedMessage, index) => {
                // Delegated worker output is persisted separately so the
                // Super Agent's own message remains intact. Only the hidden
                // observer card reads the worker result as its content.
                const message =
                  storedMessage.delegatedAgentRun === true
                    ? {
                        ...storedMessage,
                        content: externalAgentCardContent(storedMessage),
                      }
                    : storedMessage;
                const responseInterrupted = Boolean(
                  message.role === "assistant" &&
                    !isExternalAgentRunMessage(message) &&
                    (message.interrupted ||
                      (failureInline && index === lastAssistantIndex)),
                );
                const delegatedTurnHasContinuation = Boolean(
                  message.delegatedAgentRun === true &&
                    messages[index + 1]?.internalAgentContinuation === true,
                );
                const isAgentContinuationResponse = Boolean(
                  message.role === "assistant" &&
                    messages[index - 1]?.internalAgentContinuation === true,
                );
                return message.internalAgentContinuation === true ||
                message.textSelection?.mode === "inline" ||
                inlinedCourseCorrections.hiddenMessageIndices.has(index) ? null : (
                <div
                  key={message.id ?? `${message.role}-${index}`}
                  className={
                    delegatedTurnHasContinuation
                      ? "hidden"
                      : timeSeparators[index]
                        ? "space-y-3"
                        : undefined
                  }
                  aria-hidden={delegatedTurnHasContinuation || undefined}
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
                      suppressActions={message.delegatedAgentRun === true}
                    >
                    {message.role === "user" ? (
                      <ChatMessageAttachments
                        attachments={message.attachments}
                        attachmentNames={message.attachmentNames}
                      />
                    ) : null}
                    {message.role === "assistant" &&
                    message.delegatedAgentPreamble &&
                    !delegatedTurnHasContinuation ? (
                      <div className="mb-3 text-sm leading-7 text-gray-200">
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
                            <UserMessageText content={message.content} />
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
                          </div>
                        </>
                      )
                    ) : isExternalAgentRunMessage(message) ? (
                      <div
                        className={message.delegatedAgentRun ? "hidden" : "contents"}
                        aria-hidden={message.delegatedAgentRun || undefined}
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
                    ) : message.paperTraderRun ? (
                      <div className="text-sm leading-7 text-gray-200">
                        <InlinePaperTraderRun
                          runId={message.paperTraderRun.runId}
                          task={message.paperTraderRun.task}
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
                            index === lastAssistantIndex && !inlineRunActive
                              ? connection
                              : "idle"
                          }
                          pendingPermission={
                            index === lastAssistantIndex && !inlineRunActive
                              ? pendingPermission
                              : null
                          }
                          usage={message.usage}
                          responseDurationMs={message.responseDurationMs}
                          onPermissionDecision={onPermissionDecision}
                          stateLabel={
                            responseInterrupted
                              ? "Interrupted"
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
                        {message.content ||
                        inlinedCourseCorrections.byAssistantIndex.has(index) ? (
                          inlinedCourseCorrections.byAssistantIndex.has(index) ? (
                            <SteeredAssistantResponse
                              content={message.content}
                              corrections={
                                inlinedCourseCorrections.byAssistantIndex.get(index) ?? []
                              }
                            />
                          ) : (
                            <SelectableAssistantMarkdown
                              content={message.content}
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
                        {failureInline && index === lastAssistantIndex ? (
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
                        branch={(() => {
                          const branch = branchForAssistant(message, index);
                          return branch
                            ? {
                                current: branch.activeIndex + 1,
                                total: branch.variants.length,
                                onPrevious: () => switchBranch(branch, -1),
                                onNext: () => switchBranch(branch, 1),
                              }
                            : undefined;
                        })()}
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
              })}
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
                label="Interrupted"
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
        </div>
      </div>
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
        />
      ) : null}

      <div className="shrink-0 px-4 pb-3">
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
          textareaRef={composerTextareaRef}
          placeholder={
            loadingTranscript ? "Loading this chat…" : placeholder ?? "Ask the agent…"
          }
          disabled={conversationLocked}
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
          vibeTradingAgent={vibeTradingAgent}
          onClearVibeTrading={onClearVibeTrading}
          onSelectVibeTrading={onSelectVibeTrading}
          stockAnalystAgent={stockAnalystAgent}
          onClearStockAnalyst={onClearStockAnalyst}
          onSelectStockAnalyst={onSelectStockAnalyst}
          paperTraderAgent={paperTraderAgent}
          onClearPaperTrader={onClearPaperTrader}
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
          onSelectOpenMontage={onSelectOpenMontage}
          onSelectOpenwork={onSelectOpenwork}
          onSelectOpenscience={onSelectOpenscience}
          onSelectInboxZero={onSelectInboxZero}
          onSelectVimax={onSelectVimax}
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
          headerContent={
            queuedFollowUps.length > 0 ? (
              <div className="space-y-0.5 py-0.5">
                {queuedFollowUps.map((item, index) => (
                  <div
                    key={item.id}
                    onDragOver={(event) => {
                      if (!draggedQueuedId || draggedQueuedId === item.id) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverQueuedId(item.id);
                    }}
                    onDragLeave={() =>
                      setDragOverQueuedId((current) =>
                        current === item.id ? null : current,
                      )
                    }
                    onDrop={(event) => {
                      event.preventDefault();
                      finishQueuedDrop(item.id);
                    }}
                    className={`flex min-h-9 items-center gap-2 rounded-xl px-2 text-sm text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] ${
                      dragOverQueuedId === item.id
                        ? "bg-[var(--paper-strong)] ring-1 ring-inset ring-[var(--line-strong)]"
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      draggable={editingQueuedId !== item.id}
                      onDragStart={(event) => {
                        setDraggedQueuedId(item.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item.id);
                      }}
                      onDragEnd={() => {
                        setDraggedQueuedId(null);
                        setDragOverQueuedId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp" && index > 0) {
                          event.preventDefault();
                          moveQueuedFollowUp(item.id, -1);
                        } else if (
                          event.key === "ArrowDown" &&
                          index < queuedFollowUps.length - 1
                        ) {
                          event.preventDefault();
                          moveQueuedFollowUp(item.id, 1);
                        }
                      }}
                      className="grid h-7 w-7 shrink-0 cursor-grab place-items-center rounded-lg opacity-70 transition hover:bg-[var(--paper-surface)] hover:opacity-100 active:cursor-grabbing"
                      aria-label={`Reorder queued message ${index + 1} of ${queuedFollowUps.length}: ${item.text}. Drag, or use the Up and Down arrow keys.`}
                      title="Drag to change steering order"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h8.5a2 2 0 0 1 2 2v.75m0 0-2.25-2.25m2.25 2.25L15 12.5" />
                      </svg>
                    </button>
                    {editingQueuedId === item.id ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveQueuedEdit(item.id);
                        }}
                      >
                        <input
                          value={queuedEditText}
                          onChange={(event) => setQueuedEditText(event.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1 text-sm text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
                          aria-label="Edit queued message"
                          autoFocus
                        />
                        <button type="submit" className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)] hover:bg-[var(--paper-surface)]">
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingQueuedId(null)}
                          className="rounded-lg px-2 py-1 text-xs hover:bg-[var(--paper-surface)]"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate" title={item.text}>
                          {item.text}
                        </span>
                        <button
                          type="button"
                          onClick={() => void applyQueuedSteer(item)}
                          disabled={
                            Boolean(applyingSteerId) ||
                            !activeRun ||
                            runState === "stopping"
                          }
                          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Steer the active response with: ${item.text}`}
                          title={
                            activeRun
                              ? "Steer the active response"
                              : externalRunActive
                                // Only a chat turn can take a mid-run
                                // correction; an agent run is steered by its
                                // own card, so this message waits its turn.
                                ? "This agent run cannot be steered — the message sends when it finishes"
                                : "Nothing is running to steer"
                          }
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.7}
                            aria-hidden
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19.5 8.25H9.75a4.5 4.5 0 0 0-4.5 4.5v.75m0 0 3-3m-3 3 3 3"
                            />
                          </svg>
                          <span>
                            {applyingSteerId === item.id ? "Steering..." : "Steer"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setQueuedFollowUps((current) =>
                              current.filter((candidate) => candidate.id !== item.id),
                            )
                          }
                          disabled={applyingSteerId === item.id}
                          className="rounded-lg p-1.5 transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:opacity-40"
                          aria-label={`Delete queued message: ${item.text}`}
                          title="Delete queued message"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 7.5h15m-9-3h3m-7.5 3 .75 12h10.5l.75-12M9.75 10.5v6m4.5-6v6" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => beginQueuedEdit(item)}
                          disabled={applyingSteerId === item.id}
                          className="rounded-lg p-1.5 transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:opacity-40"
                          aria-label={`Edit queued message: ${item.text}`}
                          title="Edit queued message"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : undefined
          }
          capabilitySessionId={sessionId}
          capabilitySurface={surface}
          capabilityGardenSlug={gardenSlug}
          runState={runState}
          externalRunActive={externalRunActive}
          onQueueSteer={queueFollowUp}
          onStop={canStop ? stopEverything : undefined}
          permissionPending={Boolean(pendingPermission)}
        />
      </div>
      {promptToSave !== null ? (
        <SavePromptDialog
          content={promptToSave}
          onClose={() => setPromptToSave(null)}
        />
      ) : null}
    </div>
  );
}
