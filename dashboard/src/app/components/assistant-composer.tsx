'use client';

import type {
  ClipboardEvent,
  CSSProperties,
  KeyboardEvent,
  ReactNode,
  Ref,
} from 'react';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import SettingsDialog, { type SettingsTab } from '@/app/components/settings-dialog';
import SpeechDictationButton from '@/app/components/speech-dictation-button';
import VoiceConversationOverlay from '@/app/components/voice-conversation-overlay';
import type { VoiceMessage } from '@/lib/speech/voice-conversation';
import UsageLimitsPopover from '@/app/components/usage-limits-popover';
import { CommandHub, type CommandHubHandle } from '@/app/components/hermes/command-hub';
import SlashCommandMenu, {
  type SlashCommandMenuHandle,
} from '@/app/components/hermes/slash-command-menu';
import { splitLeadingCommandTokens } from '@/app/components/hermes/command-text';
import { slashQueryAt, slashQueryReplacementRange } from '@/lib/hermes/slash-query';
import {
  caretOnFirstLine,
  caretOnLastLine,
  composerHistory,
  composerHistoryMove,
} from '@/lib/hermes/composer-history';
import { useDirectMode } from '@/app/components/use-direct-mode';
import { useGoalMode } from '@/app/components/use-goal-mode';
import { useYoloMode } from '@/app/components/use-yolo-mode';
import { useAgentMode, useSuperAgent } from '@/app/components/use-agent-mode';
import type { ModelFailoverNotice } from '@/app/components/use-assistant-intelligence';
import type { CommandHubItem } from '@/lib/hermes/commands.ts';
import type { HermesSurface } from '@/lib/hermes/config.ts';
import type { LocalWorkflowSummary } from '@/lib/workflows/types';
import { formatAssistantModelName, groupAssistantModels } from '@/lib/ai-models';
import type { AssistantReasoningEffort } from '@/lib/assistant-reasoning';
import type { IntelligenceMode } from '@/lib/intelligence-modes';
import type { AgentRunState } from '@/app/components/hermes/use-agent-session';
import { AGENT_BROWSER_SLASH_COMMAND } from '@/lib/agent-browser/identity.ts';
import { DEEP_RESEARCH_SLASH_COMMAND } from '@/lib/deep-research/identity.ts';
import { AGENT_REACH_COMMAND } from '@/lib/agent-reach/identity.ts';
import { GET_DOC_COMMAND } from '@/lib/get-doc/identity.ts';
import { MEETING_NOTES_COMMAND } from '@/lib/meeting-notes/identity.ts';
import MeetingRecorderBar from '@/app/components/hermes/meeting-recorder-bar';
import type { MeetingRecording } from '@/lib/meeting-notes/use-meeting-recorder';
import { DEEP_TUTOR_COMMAND } from '@/lib/deep-tutor/identity.ts';
import { CAREER_OPS_COMMAND } from '@/lib/career-ops/identity.ts';
import { TRADINGAGENTS_AGENT_ID, TRADINGAGENTS_COMMAND } from '@/lib/tradingagents/identity.ts';
import { VIBE_TRADING_COMMAND } from '@/lib/vibe-trading/identity.ts';
import { STOCK_ANALYST_COMMAND } from '@/lib/stock-analyst/identity.ts';
import {
  PAPER_TRADER_AGENT_ID,
  PAPER_TRADER_AGENT_NAME,
  PAPER_TRADER_COMMAND,
} from '@/lib/paper-trader/identity.ts';
import { DEER_FLOW_COMMAND } from '@/lib/deer-flow/identity.ts';
import { tradingAgentsSettingsFrom } from '@/lib/tradingagents/settings.ts';
import { loadAgentSettings } from '@/lib/agent-settings/client.ts';
import { preloadSettingsOverview } from '@/lib/settings-client-cache';
import TradingAgentsRequestForm, {
  initialTradingAgentsForm,
  tradingAgentsRequestFrom,
  type TradingAgentsFormState,
} from '@/app/components/hermes/tradingagents-request-form';
import type { TradingAgentsRequest } from '@/lib/tradingagents/identity.ts';
import { SHORTS_AGENT_ID, SHORTS_COMMAND } from '@/lib/shorts/identity.ts';
import type { ShortsRequest } from '@/lib/shorts/identity.ts';
import { shortsDefaults } from '@/lib/agent-settings/defaults.ts';
import ShortsRequestForm, {
  initialShortsForm,
  shortsRequestFrom,
  type ShortsFormState,
} from '@/app/components/hermes/shorts-request-form';
import {
  FORMSMITH_COMMAND,
  type FormsmithRequest,
} from '@/lib/shaper/identity.ts';
import FormsmithRequestForm, {
  formsmithRequestFrom,
  initialFormsmithForm,
  type FormsmithFormState,
} from '@/app/components/hermes/formsmith-request-form';
import { OPENPLANTER_COMMAND } from '@/lib/openplanter/identity.ts';
import { SOCIALS_MANAGER_COMMAND } from '@/lib/socials-manager/identity.ts';
import { HARDWARE_BLUEPRINT_COMMAND } from '@/lib/hardware/identity.ts';
import { PARAMETRIC_CAD_COMMAND } from '@/lib/cad/identity.ts';
import { HYPERFRAMES_COMMAND } from '@/lib/hyperframes/identity.ts';
import { RESOURCE2SKILL_COMMAND } from '@/lib/resource2skill/identity.ts';
import { OPENMONTAGE_COMMAND } from '@/lib/openmontage/identity.ts';
import { OPENWORK_COMMAND } from '@/lib/openwork/identity.ts';
import { OPENSCIENCE_COMMAND } from '@/lib/openscience/identity.ts';
import { INBOX_ZERO_COMMAND } from '@/lib/inbox-zero/identity.ts';
import { VIMAX_COMMAND } from '@/lib/vimax/identity.ts';
import { VOX_DIRECTOR_COMMAND } from '@/lib/vox-director/identity.ts';
import { MONEY_PRINTER_COMMAND } from '@/lib/money-printer/identity.ts';
import { LEGAL_COMMAND } from '@/lib/legal/identity.ts';
import { WARDROBE_COMMAND } from '@/lib/wardrobe/identity.ts';
import { describeDocumentSummary, type DocumentAttachmentSummary } from '@/lib/document-attachments.ts';
import { useDocumentIndexStatus } from '@/app/components/use-document-index-status';
import type { ModelAttachmentSummary } from '@/lib/model-attachments.ts';
import { OPENCODE_COMMAND } from '@/lib/opencode/identity.ts';
import { CODEX_COMMAND } from '@/lib/codex/identity.ts';
import { RUFLO_COMMAND } from '@/lib/ruflo/identity.ts';
import { AGENT_TARS_SLASH_COMMAND } from '@/lib/ui-tars/identity.ts';
import { imageFilesFromClipboard } from '@/lib/chat-attachments';
import { composerSegments } from '@/lib/composer-links';
import { modelAttachmentHref } from '@/lib/model-attachments';
import ModelCubeIcon from '@/app/components/model-cube-icon';

export interface ComposerAttachment {
  name: string;
  type?: 'text' | 'image' | 'model' | 'video' | 'audio' | 'document';
  /** Data URL for image attachments — enables an inline thumbnail + lightbox preview. */
  dataUrl?: string;
  /** Set for 3D models, videos, audio and documents; the chip links to the stored file so it can be checked before sending. */
  blobId?: string;
  /**
   * For a document, what the extractor found in it. Declared here so a
   * `ChatAttachment` still assigns to this structurally and no caller has to
   * map — the chip reads it to say "12 pages · 3 tables · 2 figures", which is
   * the one moment the person can see that the figures were noticed before
   * they press send. A mesh carries a `summary` of its own shape, so this
   * accepts either and the chip reads whichever the attachment actually is.
   */
  summary?: DocumentAttachmentSummary | ModelAttachmentSummary;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Invokes a saved automation with the current composer text as input. */
  onRunWorkflow?: (workflow: LocalWorkflowSummary, input: string) => void | Promise<void>;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /**
   * What the person has already sent in this conversation, oldest first. Up and
   * Down walk it from the edges of the draft, the way a terminal does — see
   * `@/lib/hermes/composer-history` for the rules.
   *
   * Memoize it at the call site. A fresh array identity reads as a new
   * conversation and drops the walk in progress, which is right when the
   * conversation really did change and wrong on every unrelated re-render.
   */
  history?: readonly string[];
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onPasteFiles?: (files: File[]) => void | Promise<void>;
  textareaRef?: Ref<HTMLTextAreaElement>;
  textareaStyle?: CSSProperties;
  placeholder: string;
  disabled?: boolean;
  /**
   * The conversation under the composer is still arriving. Typing stays open —
   * the box keeps its own placeholder — and a submitted draft joins the visible
   * follow-up queue until the transcript is ready. With no draft, the send button
   * keeps showing the loading state rather than greying out.
   */
  loading?: boolean;
  /**
   * Blocks loading-time queueing independently from the other disabled composer
   * controls. This lets a host keep attachments and modes locked while history
   * loads without also disabling the typed draft's queue arrow.
   */
  queueDisabled?: boolean;
  isSending?: boolean;
  canSubmit: boolean;
  model: string;
  models: string[];
  modelsLoading?: boolean;
  onLoadModels?: () => void;
  onModelChange: (model: string) => void;
  reasoningEffort: AssistantReasoningEffort;
  onReasoningEffortChange: (effort: AssistantReasoningEffort) => void;
  /**
   * Modes the active model honours, from `useAssistantIntelligence`. Omitted
   * (or empty) means the model has no reasoning notion and the menu shows none
   * rather than a ladder that would silently do nothing.
   */
  intelligenceModes?: IntelligenceMode[];
  /** Set when the chosen model is out of quota and a stand-in is serving. */
  modelFailover?: ModelFailoverNotice | null;
  onAddDocuments?: () => void;
  isAddingDocuments?: boolean;
  attachments?: ComposerAttachment[];
  onRemoveAttachment?: (index: number) => void;
  utilityActions?: ReactNode;
  /**
   * Accepted so the many call sites keep compiling, but nothing is drawn: the
   * composer no longer shows a status line under the input.
   */
  statusMessage?: string;
  headerContent?: ReactNode;
  className?: string;
  compact?: boolean;
  capabilitySessionId?: string | number | null;
  capabilitySurface?: HermesSurface;
  /** Garden this composer belongs to; scheduled chats open inside it. */
  capabilityGardenSlug?: string | null;
  runState?: AgentRunState;
  /**
   * An external agent run owns the conversation even though `runState` is idle
   * — those runs live in their own inline card, not in the Hermes run-state
   * machine. The next message must queue behind it exactly as it would behind a
   * chat turn, and the composer exposes the same Stop affordance even when the
   * agent's own card is hidden by a delegated turn.
   */
  externalRunActive?: boolean;
  onQueueSteer?: (text: string) => void;
  onStop?: () => void;
  /** A stop request was accepted locally and is waiting for terminal state. */
  stopPending?: boolean;
  permissionPending?: boolean;
  /**
   * Active Agent TARS (browser operator). When set, a chip shows in the composer
   * and the host routes sends to a browser run instead of the chat model.
   */
  browserAgent?: { id: string; name: string } | null;
  onClearBrowserAgent?: () => void;
  onSelectBrowserAgent?: () => void;
  /**
   * Active Agent Browser (agent-browser runtime). Parallel to browserAgent and
   * represented by its canonical slash command.
   */
  agentBrowserAgent?: { id: string; name: string } | null;
  onClearAgentBrowser?: () => void;
  onSelectAgentBrowser?: () => void;
  /**
   * Active Agent Reach agent. Same contract as the browser agents: a chip in the
   * composer, and the host routes sends to an internet-reading run.
   */
  agentReachAgent?: { id: string; name: string } | null;
  onClearAgentReach?: () => void;
  onSelectAgentReach?: () => void;
  /**
   * Active Get Doc agent. Same contract as the other ChatMock-driven agents: a
   * chip in the composer, and the host routes sends to a document search whose
   * results can be downloaded into the conversation's artifacts.
   */
  getDocAgent?: { id: string; name: string } | null;
  onClearGetDoc?: () => void;
  onSelectGetDoc?: () => void;
  meetingNotesAgent?: { id: string; name: string } | null;
  onClearMeetingNotes?: () => void;
  onSelectMeetingNotes?: () => void;
  /** Present only where a captured meeting can actually start a run. */
  onMeetingRecorded?: (recording: MeetingRecording) => void;
  deepTutorAgent?: { id: string; name: string } | null;
  onClearDeepTutor?: () => void;
  onSelectDeepTutor?: () => void;
  /**
   * Active Career Ops agent. Same contract as the other ChatMock-driven agents:
   * a chip in the composer, and the host routes sends to a job-search run.
   */
  careerOpsAgent?: { id: string; name: string } | null;
  onClearCareerOps?: () => void;
  onSelectCareerOps?: () => void;
  /**
   * Active Vibe Trading agent. A prompt agent like the ones above, even though
   * the run is owned by the cloned project's own service rather than by a
   * ChatMock loop Breadboard drives.
   */
  vibeTradingAgent?: { id: string; name: string } | null;
  onClearVibeTrading?: () => void;
  onSelectVibeTrading?: () => void;
  /**
   * Active Stock Analyst agent. Another prompt agent owned by a cloned
   * project's own backend rather than by a ChatMock loop Breadboard drives.
   */
  stockAnalystAgent?: { id: string; name: string } | null;
  onClearStockAnalyst?: () => void;
  onSelectStockAnalyst?: () => void;
  /**
   * Active Paper Trader agent. The message is an instruction to a desk that is
   * already running or about to be — start, stop, or show — rather than a task.
   */
  paperTraderAgent?: { id: string; name: string } | null;
  onClearPaperTrader?: () => void;
  /**
   * Active DeerFlow agent. The message is the task, forwarded verbatim to the
   * cloned harness's own lead agent.
   */
  deerFlowAgent?: { id: string; name: string } | null;
  onClearDeerFlow?: () => void;
  onSelectDeerFlow?: () => void;
  /**
   * Active Trading Agent. Unlike every other agent here, selecting it
   * replaces the message field: the cloned framework analyses an instrument on a
   * date and has nowhere to put a sentence, so the composer refuses free text
   * and collects a request instead. `onSubmitTradingAgents` receives it.
   */
  tradingAgentsAgent?: { id: string; name: string } | null;
  onClearTradingAgents?: () => void;
  onSelectTradingAgents?: () => void;
  onSubmitTradingAgents?: (request: TradingAgentsRequest) => void;
  /** Pre-fill for the request form, from a typed or pasted command. */
  tradingAgentsSeed?: Partial<TradingAgentsRequest> | null;
  /**
   * Active Shorts agent. The second agent that replaces the message field: it
   * cuts a video into clips and has nowhere to put a sentence, so the composer
   * collects a video and the shape of the clips instead of free text.
   * `onSubmitShorts` receives the request.
   */
  shortsAgent?: { id: string; name: string } | null;
  onClearShorts?: () => void;
  onSelectShorts?: () => void;
  onSubmitShorts?: (request: ShortsRequest) => void;
  /** Pre-fill for the request form, from a typed or pasted command. */
  shortsSeed?: Partial<ShortsRequest> | null;
  /** Formsmith replaces free text with one image-only upload. */
  formsmithAgent?: { id: string; name: string } | null;
  onClearFormsmith?: () => void;
  onSelectFormsmith?: () => void;
  onSubmitFormsmith?: (request: FormsmithRequest) => void;
  /**
   * Active Deep Research agent. Same contract as the browser agents: a chip in
   * the composer, and the host routes sends to a research run.
   */
  deepResearchAgent?: { id: string; name: string } | null;
  onClearDeepResearch?: () => void;
  onSelectDeepResearch?: () => void;
  /** Active OpenPlanter agent. Investigations render graph and output widgets. */
  openPlanterAgent?: { id: string; name: string } | null;
  onClearOpenPlanter?: () => void;
  onSelectOpenPlanter?: () => void;
  /** The Socials Manager needs no agent selection — the command carries the whole brief. */
  onSelectSocialsManager?: () => void;
  onSelectHardwareBlueprint?: () => void;
  onSelectParametricCad?: () => void;
  /** HyperFrames needs no agent selection either — the command carries the brief. */
  onSelectHyperframes?: () => void;
  onSelectResource2Skill?: () => void;
  /** OpenMontage likewise: the command carries the whole production brief. */
  onSelectOpenMontage?: () => void;
  /** OpenWork likewise: the command carries the task for its workspace. */
  onSelectOpenwork?: () => void;
  /** OpenScience likewise: the command carries the research goal. */
  onSelectOpenscience?: () => void;
  /** Inbox Zero likewise: the command carries the instruction for the mailbox. */
  onSelectInboxZero?: () => void;
  onSelectVimax?: () => void;
  onSelectVoxDirector?: () => void;
  onSelectMoneyPrinter?: () => void;
  /** The Legal Agent likewise: the command carries the assignment. */
  onSelectLegal?: () => void;
  /** Wardrobe likewise: the photos are attached and the command carries direction. */
  onSelectWardrobe?: () => void;
  /** Active OpenCode agent for a Garden-linked local repository. */
  openCodeAgent?: { id: string; name: string } | null;
  onClearOpenCode?: () => void;
  onSelectOpenCode?: () => void;
  /** Active Codex agent for a Garden-linked local repository. */
  codexAgent?: { id: string; name: string } | null;
  onClearCodex?: () => void;
  onSelectCodex?: () => void;
  /** Active Ruflo hive-mind swarm for a Garden-linked local repository. */
  rufloAgent?: { id: string; name: string } | null;
  onClearRuflo?: () => void;
  onSelectRuflo?: () => void;
  /**
   * This chat's messages. Passing them turns on voice mode (double-tap the
   * microphone): spoken turns go through `onSubmit` like any other message, and
   * the newest assistant reply is what voice mode reads back.
   */
  voiceMessages?: readonly VoiceMessage[];
}

/**
 * Fallback ladder for callers that do not yet pass `intelligenceModes` (and for
 * the moment before ChatMock's model list has loaded). The real list comes from
 * the active model — see lib/intelligence-modes.ts.
 */
// Trading Agent keeps its defaults in its own settings panel (the page that
// used to hold them is gone), so the request form can open it in place.
const TradingAgentsSettingsDialog = dynamic(
  () => import('@/app/components/hermes/tradingagents-settings-dialog'),
  { ssr: false },
);

const FALLBACK_EFFORT_OPTIONS: IntelligenceMode[] = [
  { value: 'low', label: 'Light', detail: 'Quick, light reasoning' },
  { value: 'medium', label: 'Medium', detail: 'Balanced reasoning' },
  { value: 'high', label: 'High', detail: 'Deeper thinking' },
  { value: 'xhigh', label: 'Extra high', detail: 'Extended thinking' },
  { value: 'max', label: 'Ultra', detail: 'Maximum reasoning depth' },
];

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
    </svg>
  );
}

// How far the field may grow before it starts scrolling instead. Pasting a page
// of text used to grow the composer without limit, which pushed the whole
// conversation off screen; past this many lines the extra text scrolls inside
// the field. The viewport share keeps that promise on a short window, where ten
// lines would already be most of the screen, and the floor keeps at least a few
// lines visible however short the window gets.
const COMPOSER_MAX_LINES = 10;
const COMPOSER_MIN_LINES = 3;
const COMPOSER_MAX_VIEWPORT_SHARE = 0.35;

function composerMaxHeight(lineHeight: number) {
  const roomy = lineHeight * COMPOSER_MAX_LINES;
  const viewport = typeof window === 'undefined' ? 0 : window.innerHeight;
  if (!viewport) return roomy;
  return Math.max(
    lineHeight * COMPOSER_MIN_LINES,
    Math.min(roomy, Math.round(viewport * COMPOSER_MAX_VIEWPORT_SHARE)),
  );
}

// One frozen empty list for every composer that is not given a history, so the
// absence of one is a stable identity and never restarts the walk on its own.
const NO_SENT_MESSAGES: readonly string[] = [];

type ActiveAgencyAgent = {
  id: string;
  slug: string;
  name: string;
  divisionLabel: string;
  divisionColor?: string;
  emoji?: string;
};

export default function AssistantComposer({
  value,
  onChange,
  onSubmit,
  onRunWorkflow,
  onKeyDown,
  history: sentMessages = NO_SENT_MESSAGES,
  onPaste,
  onPasteFiles,
  textareaRef,
  textareaStyle,
  placeholder,
  disabled = false,
  loading = false,
  queueDisabled = disabled,
  isSending = false,
  canSubmit,
  model,
  models,
  modelsLoading = false,
  onLoadModels,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  intelligenceModes,
  modelFailover,
  onAddDocuments,
  isAddingDocuments = false,
  attachments = [],
  onRemoveAttachment,
  utilityActions,
  headerContent,
  className = '',
  compact = false,
  capabilitySessionId,
  capabilitySurface = 'dashboard_terminal',
  capabilityGardenSlug = null,
  runState = 'idle',
  externalRunActive = false,
  onQueueSteer,
  onStop,
  stopPending = false,
  permissionPending = false,
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
  onClearTradingAgents,
  onSelectTradingAgents,
  onSubmitTradingAgents,
  tradingAgentsSeed,
  shortsAgent,
  onClearShorts,
  onSelectShorts,
  onSubmitShorts,
  shortsSeed,
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
  voiceMessages,
}: Props) {
  // Which attached documents have been read into searchable pages yet. Polls
  // only while one is still being read, and only when documents are attached.
  const documentIndexStatus = useDocumentIndexStatus(
    useMemo(
      () =>
        attachments.flatMap((attachment) =>
          attachment.type === 'document' && attachment.blobId ? [attachment.blobId] : [],
        ),
      [attachments],
    ),
  );
  const [showIntelligence, setShowIntelligence] = useState(false);
  const [intelligencePanel, setIntelligencePanel] = useState<'usage' | 'settings' | null>(null);
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('account');
  const [showCommandHub, setShowCommandHub] = useState(false);
  const [showSlashCommands, setShowSlashCommands] = useState(false);
  // The token the caret was in when the picker opened — the picker's filter,
  // which is not the whole box once the sentence has a body after the token.
  const [slashQuery, setSlashQuery] = useState('');
  // The TradingAgents request lives here rather than in the host: it is the
  // composer's input while that agent is selected, exactly as `value` is
  // otherwise, and no host needs to know its shape to route a send.
  const [tradingAgentsForm, setTradingAgentsForm] = useState<TradingAgentsFormState>(
    initialTradingAgentsForm,
  );
  const [tradingAgentsModelNote, setTradingAgentsModelNote] = useState('');
  const [tradingAgentsSettingsOpen, setTradingAgentsSettingsOpen] = useState(false);
  // Shorts keeps its request here for the same reason: while that agent is
  // selected this form is the composer's input, exactly as `value` is otherwise.
  const [shortsForm, setShortsForm] = useState<ShortsFormState>(initialShortsForm);
  const [formsmithForm, setFormsmithForm] = useState<FormsmithFormState>(initialFormsmithForm);
  const [activeAgencyAgent, setActiveAgencyAgent] = useState<ActiveAgencyAgent | null>(null);
  // Kept only so the agency-agent fetches below still have somewhere to put a
  // failure; nothing reads it now that the status line is gone.
  const [, setAgencyAgentNotice] = useState<string | null>(null);
  const commandBackdropRef = useRef<HTMLDivElement | null>(null);
  const [directMode, setDirectMode] = useDirectMode();
  const [goalMode, setGoalMode] = useGoalMode();
  const [yoloMode, setYoloMode] = useYoloMode();
  const [agentMode, setAgentMode] = useAgentMode();
  const [superAgent, setSuperAgent] = useSuperAgent();
  const [voiceOpen, setVoiceOpen] = useState(false);

  // Migrate a Super Agent preference saved by an older build, before the two
  // modes were coupled. New toggles already set YOLO in the shared store.
  useEffect(() => {
    if (superAgent && !yoloMode) setYoloMode(true);
  }, [setYoloMode, superAgent, yoloMode]);

  // The overview calls several local services. Warm their renderer-only cache
  // after the composer is interactive so opening Settings never owns that wait.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void preloadSettingsOverview();
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, []);
  const commandHubRef = useRef<CommandHubHandle>(null);
  const slashCommandMenuRef = useRef<SlashCommandMenuHandle>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(textareaRef, () => internalTextareaRef.current as HTMLTextAreaElement);

  // Voice mode has to send through the host's own submit so a spoken turn is an
  // ordinary chat message. `onSubmit` reads the host's draft state, which only
  // holds the transcript one render after `onChange` — so the send waits for the
  // draft to come back as `value`, then fires the submit from that render.
  const pendingVoiceSendRef = useRef<string | null>(null);
  const composerValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  composerValueRef.current = value;
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    if (pendingVoiceSendRef.current === null || pendingVoiceSendRef.current !== value) return;
    pendingVoiceSendRef.current = null;
    onSubmitRef.current();
  }, [value]);

  // Stable for the life of the composer: the voice screen captures it once, in
  // an audio callback that never re-subscribes.
  const sendSpokenTurn = useCallback((text: string) => {
    const spoken = text.trim();
    if (!spoken) return;
    if (composerValueRef.current === spoken) {
      onSubmitRef.current();
      return;
    }
    pendingVoiceSendRef.current = spoken;
    onChangeRef.current(spoken);
  }, []);

  // Selecting the agent starts its request from the stored defaults. Functional
  // updates mean the effect never has to depend on the request it is updating,
  // so a keystroke cannot re-trigger the load.
  useEffect(() => {
    if (!tradingAgentsAgent) return;
    let cancelled = false;
    void loadAgentSettings(TRADINGAGENTS_AGENT_ID).then((values) => {
      if (cancelled) return;
      const settings = tradingAgentsSettingsFrom(values);
      const pinned = [settings.deepModel, settings.quickModel].filter(Boolean);
      setTradingAgentsModelNote(
        pinned.length === 2 && settings.deepModel !== settings.quickModel
          ? `${settings.deepModel} for decisions, ${settings.quickModel} for analysts`
          : pinned.length
            ? `${pinned[0]} for every step`
            : '',
      );
      setTradingAgentsForm((current) => ({
        ...current,
        analysts: settings.analysts,
        researchDepth: settings.researchDepth,
        riskRounds: settings.riskRounds,
        assetType: settings.assetType,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [tradingAgentsAgent]);

  // A pasted command fills in what it named and leaves the rest alone.
  useEffect(() => {
    if (!tradingAgentsSeed) return;
    setTradingAgentsForm((current) => ({
      ...current,
      ...(tradingAgentsSeed.ticker ? { ticker: tradingAgentsSeed.ticker } : {}),
      ...(tradingAgentsSeed.tradeDate ? { tradeDate: tradingAgentsSeed.tradeDate } : {}),
      ...(tradingAgentsSeed.analysts?.length
        ? { analysts: [...tradingAgentsSeed.analysts] }
        : {}),
      ...(tradingAgentsSeed.researchDepth
        ? { researchDepth: tradingAgentsSeed.researchDepth }
        : {}),
      ...(tradingAgentsSeed.riskRounds ? { riskRounds: tradingAgentsSeed.riskRounds } : {}),
      ...(tradingAgentsSeed.assetType ? { assetType: tradingAgentsSeed.assetType } : {}),
    }));
  }, [tradingAgentsSeed]);

  // Shorts does the same: selecting it starts the form from the stored
  // defaults, so the shape you always cut to is already chosen.
  useEffect(() => {
    if (!shortsAgent) return;
    let cancelled = false;
    void loadAgentSettings(SHORTS_AGENT_ID).then((values) => {
      if (cancelled) return;
      const settings = shortsDefaults(values);
      setShortsForm((current) => ({
        ...current,
        clipCount: settings.clipCount,
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
        language: settings.language,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [shortsAgent]);

  // A pasted command fills in what it named and leaves the rest alone.
  useEffect(() => {
    if (!shortsSeed) return;
    setShortsForm((current) => ({
      ...current,
      ...(shortsSeed.source?.kind === 'url' ? { url: shortsSeed.source.url, upload: null } : {}),
      ...(shortsSeed.clipCount ? { clipCount: shortsSeed.clipCount } : {}),
      ...(shortsSeed.aspectRatio ? { aspectRatio: shortsSeed.aspectRatio } : {}),
      ...(shortsSeed.resolution ? { resolution: shortsSeed.resolution } : {}),
    }));
  }, [shortsSeed]);

  // The mirror that paints command tokens and links sits on top of the
  // textarea, so once the field scrolls the two layers have to scroll together —
  // otherwise the colouring drifts away from the text it belongs to.
  const syncCommandBackdrop = useCallback(() => {
    const textarea = internalTextareaRef.current;
    const backdrop = commandBackdropRef.current;
    if (!textarea || !backdrop) return;
    backdrop.scrollTop = textarea.scrollTop;
  }, []);

  const resizeTextarea = useCallback(() => {
    const textarea = internalTextareaRef.current;
    if (!textarea) return;
    // Measure with the scrollbar suppressed: an `auto` scrollbar that appears
    // mid-measurement narrows the field, rewraps the text and inflates the
    // height it reports.
    textarea.style.overflowY = 'hidden';
    textarea.style.height = 'auto';
    const natural = textarea.scrollHeight;
    const lineHeight =
      Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || (compact ? 20 : 24);
    const cap = composerMaxHeight(lineHeight);
    const capped = natural > cap;
    textarea.style.height = `${capped ? cap : natural}px`;
    // Uncapped, the class-level `overflow-y-hidden` stays in charge.
    textarea.style.overflowY = capped ? 'auto' : '';

    const backdrop = commandBackdropRef.current;
    if (backdrop) {
      // Centring is what keeps the mirror on a one-line field; once the text is
      // taller than the box it would instead hide the first lines above the top
      // edge, out of reach of any scroll.
      backdrop.style.alignItems = capped ? 'flex-start' : '';
      // Give the mirror the same usable width as the scrolling field, so both
      // layers wrap at the same place.
      backdrop.style.paddingRight = capped
        ? `${Math.max(0, textarea.offsetWidth - textarea.clientWidth)}px`
        : '';
    }
    syncCommandBackdrop();
  }, [compact, syncCommandBackdrop]);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  useEffect(() => {
    window.addEventListener('resize', resizeTextarea);
    return () => window.removeEventListener('resize', resizeTextarea);
  }, [resizeTextarea]);

  useEffect(() => {
    const textarea = internalTextareaRef.current;
    const container = textarea?.parentElement;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => resizeTextarea());
    observer.observe(container);
    return () => observer.disconnect();
  }, [resizeTextarea]);

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    onPaste?.(event);
    if (event.defaultPrevented || !onPasteFiles) return;

    const imageFiles = imageFilesFromClipboard(event.clipboardData);
    if (imageFiles.length === 0) return;

    event.preventDefault();
    void onPasteFiles(imageFiles);
  };

  // Zoomable preview for image attachments. `lightboxIndex` is the position
  // within `imageAttachments` (the images only), so prev/next skips text files.
  const imageAttachments = attachments
    .map((attachment, index) => ({ attachment, index }))
    .filter(
      (entry): entry is { attachment: ComposerAttachment & { dataUrl: string }; index: number } =>
        entry.attachment.type === 'image' && typeof entry.attachment.dataUrl === 'string',
    );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const activeLightbox =
    lightboxIndex !== null ? imageAttachments[lightboxIndex] ?? null : null;
  const hasMultipleImages = imageAttachments.length > 1;

  const openLightbox = (attachmentIndex: number) => {
    const position = imageAttachments.findIndex((entry) => entry.index === attachmentIndex);
    if (position !== -1) setLightboxIndex(position);
  };
  const stepLightbox = (delta: number) => {
    setLightboxIndex((current) => {
      if (current === null || imageAttachments.length === 0) return current;
      return (current + delta + imageAttachments.length) % imageAttachments.length;
    });
  };

  // Close the lightbox when its image disappears (e.g. the attachment is removed).
  useEffect(() => {
    if (lightboxIndex !== null && lightboxIndex >= imageAttachments.length) {
      setLightboxIndex(imageAttachments.length > 0 ? imageAttachments.length - 1 : null);
    }
  }, [imageAttachments.length, lightboxIndex]);

  // Keyboard controls: Escape closes, arrows navigate between images.
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setLightboxIndex(null);
      } else if (event.key === 'ArrowRight' && imageAttachments.length > 1) {
        event.preventDefault();
        stepLightbox(1);
      } else if (event.key === 'ArrowLeft' && imageAttachments.length > 1) {
        event.preventDefault();
        stepLightbox(-1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex, imageAttachments.length]);
  // Modes come from the active model; the fallback covers the moment before
  // ChatMock's model list has loaded.
  const effortOptions = intelligenceModes?.length
    ? intelligenceModes
    : FALLBACK_EFFORT_OPTIONS;
  const selectedEffort =
    effortOptions.find((option) => option.value === reasoningEffort) ??
    effortOptions[Math.min(2, effortOptions.length - 1)];
  const activeRun =
    runState === 'submitting' ||
    runState === 'connecting' ||
    runState === 'running' ||
    runState === 'waiting_for_permission' ||
    runState === 'steering' ||
    runState === 'stopping';
  // Anything still working on this conversation — a chat turn or an external
  // agent run — makes the next message a queued one rather than a send.
  const runInFlight = activeRun || externalRunActive;
  const stopping = runState === 'stopping' || stopPending;
  // Transcript loading holds messages for the same reason as an active run: a
  // direct send would race history restoration and could be overwritten by it.
  // Unlike `runInFlight`, loading has nothing to stop, so it only changes the
  // draft's send path into a queue path.
  const queueHeld = loading || runInFlight;
  // Runtime availability controls actions, not drafting. Keeping the textarea
  // editable means a transient runtime health check never eats or blocks the
  // user's next message.
  const sessionActionsDisabled = disabled || stopping;
  // Two agents take a request rather than a message — Trading Agent analyses an
  // instrument, Shorts cuts a video — and while either is selected there is no
  // message to send, so the whole send path runs off its form's validity
  // instead of the draft text. Everything downstream keys off `formAgent`, so a
  // third one is a matching pair of lines rather than a new special case.
  const tradingAgentsRequest = tradingAgentsAgent
    ? tradingAgentsRequestFrom(tradingAgentsForm)
    : null;
  const shortsRequest = shortsAgent ? shortsRequestFrom(shortsForm) : null;
  const formsmithRequest = formsmithAgent ? formsmithRequestFrom(formsmithForm) : null;
  // A typed bare Paper Trader command is already a complete selection. Waiting
  // for Enter leaves a normal textarea on screen even though this agent accepts
  // no prompt, which invites text that the desk will never read. Keep this as
  // local derived state. Paper Trader is intentionally absent from the agent
  // pickers, while manually typing its token still leaves Send as the explicit
  // start action.
  const typedPaperTraderCommand =
    !paperTraderAgent && value.trim().toLowerCase() === PAPER_TRADER_COMMAND.toLowerCase();
  const paperTraderSelection = paperTraderAgent ??
    (typedPaperTraderCommand
      ? { id: PAPER_TRADER_AGENT_ID, name: PAPER_TRADER_AGENT_NAME }
      : null);
  // Paper Trader belongs in this group for the same reason the other three do —
  // it has no prompt — but it is the one member with nothing to fill in either.
  // A desk is started, stopped or shown; there is no request to compose, so it
  // gets the locked composer without a form above it, and Send is always ready.
  const formAgent = tradingAgentsAgent ?? shortsAgent ?? formsmithAgent ?? paperTraderSelection ?? null;
  const formRequestReady = tradingAgentsAgent
    ? Boolean(tradingAgentsRequest)
    : shortsAgent
      ? Boolean(shortsRequest)
      : paperTraderSelection
        ? true
        : Boolean(formsmithRequest);
  const submitTradingAgents = () => {
    if (!tradingAgentsRequest || isSending || disabled) return;
    onSubmitTradingAgents?.(tradingAgentsRequest);
  };
  const submitShorts = () => {
    if (!shortsRequest || isSending || disabled) return;
    onSubmitShorts?.(shortsRequest);
  };
  const submitFormsmith = () => {
    if (!formsmithRequest || isSending || disabled) return;
    onSubmitFormsmith?.(formsmithRequest);
  };
  const submitFormAgent = () => {
    if (tradingAgentsAgent) submitTradingAgents();
    else if (shortsAgent) submitShorts();
    else if (formsmithAgent) submitFormsmith();
    // The desk takes no request, so the send button is the whole instruction.
    else if (paperTraderSelection) onSubmit();
  };
  const canSend = formAgent ? formRequestReady : canSubmit;
  const canQueueFollowUp =
    queueHeld &&
    !queueDisabled &&
    Boolean(value.trim()) &&
    Boolean(onQueueSteer);

  useEffect(() => {
    if (!capabilitySessionId || capabilitySurface === 'quartz_ai') {
      setActiveAgencyAgent(null);
      setAgencyAgentNotice(null);
      return;
    }
    const controller = new AbortController();
    void fetch(
      `/api/hermes/sessions/${encodeURIComponent(String(capabilitySessionId))}/agency-agent`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as {
          activeAgent?: ActiveAgencyAgent | null;
          notice?: string | null;
        };
      })
      .then((payload) => {
        if (!payload) return;
        setActiveAgencyAgent(payload.activeAgent ?? null);
        setAgencyAgentNotice(payload.notice ?? null);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setAgencyAgentNotice('The active agent status could not be refreshed.');
        }
      });
    return () => controller.abort();
  }, [capabilitySessionId, capabilitySurface, runState]);

  async function clearAgencyAgent() {
    if (!capabilitySessionId) return;
    try {
      const response = await fetch(
        `/api/hermes/sessions/${encodeURIComponent(String(capabilitySessionId))}/agency-agent`,
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error('clear_failed');
      setActiveAgencyAgent(null);
      setAgencyAgentNotice(null);
      window.setTimeout(() => internalTextareaRef.current?.focus(), 0);
    } catch {
      setAgencyAgentNotice('The active agent could not be cleared.');
    }
  }

  function toggleIntelligence() {
    const next = !showIntelligence;
    setShowIntelligence(next);
    if (!next) setIntelligencePanel(null);
    if (next) onLoadModels?.();
  }

  function closeIntelligence() {
    setShowIntelligence(false);
    setIntelligencePanel(null);
  }

  // Where the arrow-key walk through sent messages currently stands, and the
  // draft it interrupted. A ref rather than state: nothing renders from it —
  // the recalled text goes to the host through `onChange` like any keystroke.
  const historyWalkRef = useRef<{ index: number; draft: string } | null>(null);
  const messageHistory = useMemo(() => composerHistory(sentMessages), [sentMessages]);

  // A new list means a message was just sent, or the conversation changed under
  // the composer. Either way the walk is over and the next Up starts from the
  // newest message rather than from wherever it had got to.
  useEffect(() => {
    historyWalkRef.current = null;
  }, [messageHistory]);

  /**
   * Up and Down recall what was sent, as in a terminal — but only from the
   * edges of the draft, so inside a message being written they still move the
   * caret. Returns whether the key was spent on the walk.
   */
  function walkMessageHistory(event: KeyboardEvent<HTMLTextAreaElement>) {
    const older = event.key === 'ArrowUp';
    if (!older && event.key !== 'ArrowDown') return false;
    // A modifier makes the arrow mean something else — selecting, moving by
    // paragraph, jumping to the ends of the field — and none of those are recall.
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.nativeEvent.isComposing) return false;

    const textarea = event.currentTarget;
    const caret = textarea.selectionStart;
    // A live selection is being extended or replaced; recall would throw it away.
    if (caret !== textarea.selectionEnd) return false;
    if (older ? !caretOnFirstLine(value, caret) : !caretOnLastLine(value, caret)) return false;

    const walk = historyWalkRef.current;
    const draft = walk?.draft ?? value;
    const move = composerHistoryMove(
      messageHistory,
      walk?.index ?? null,
      older ? 'older' : 'newer',
      draft,
    );
    // Nowhere to go: leave the key to the caret rather than swallowing it.
    if (!move) return false;

    event.preventDefault();
    historyWalkRef.current = move.index === null ? null : { index: move.index, draft };
    onChange(move.text);
    // The recalled message is the host's state, so it lands one render later;
    // the caret goes to its end then, ready to be edited rather than sitting
    // wherever the previous draft happened to leave it.
    window.setTimeout(() => {
      const node = internalTextareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(move.text.length, move.text.length);
    }, 0);
    return true;
  }

  function assignTextareaRef(node: HTMLTextAreaElement | null) {
    internalTextareaRef.current = node;
    if (node) resizeTextarea();
  }

  function queueSteer() {
    const text = value.trim();
    if (!text || !canQueueFollowUp) return;
    onQueueSteer?.(text);
    onChange('');
    window.setTimeout(() => internalTextareaRef.current?.focus(), 0);
  }

  function insertCommand(item: CommandHubItem) {
    if (item.requiresOpenCode) {
      const codingCommand =
        codexAgent || /^\/agents:codex(?:\s+|$)/i.test(value.trimStart())
          ? CODEX_COMMAND
          : OPENCODE_COMMAND;
      // Whatever the sentence says minus the token being replaced, and minus a
      // coding runtime it already names — the prefix below puts one back.
      const replaced = slashQueryReplacementRange(
        value,
        internalTextareaRef.current?.selectionStart,
      );
      const remainder = replaced
        ? `${value.slice(0, replaced.start)}${value.slice(replaced.end)}`
        : value;
      const existing = remainder
        .trimStart()
        .replace(/^\/agents:(?:codex|opencode)(?:\s+|$)/i, "");
      const prefix = `${codingCommand} /${item.token}`;
      const next = `${prefix}${existing ? ` ${existing}` : " "}`;
      onChange(next);
      window.setTimeout(() => {
        internalTextareaRef.current?.focus();
        internalTextareaRef.current?.setSelectionRange(next.length, next.length);
      }, 0);
      return;
    }
    insertCommandToken(`/${item.token}`);
  }

  function insertCommandToken(command: string) {
    const node = internalTextareaRef.current;
    // A token being edited is overwritten in place; anything else (the palette
    // button, an agent shortcut) goes to the head of the sentence, where a
    // capability selector has to sit anyway.
    const replaced = slashQueryReplacementRange(value, node?.selectionStart);
    const start = replaced?.start ?? 0;
    const end = replaced?.end ?? 0;
    const token = `${command} `;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);
    window.setTimeout(() => {
      node?.focus();
      const cursor = replaced
        ? start + token.length
        : token.length + (node?.selectionStart ?? value.length);
      node?.setSelectionRange(cursor, cursor);
    }, 0);
  }

  function selectDirectSlashCommand(item: CommandHubItem) {
    setShowSlashCommands(false);
    const runtimeAgentId = item.id.startsWith('runtime-agent:')
      ? item.id.slice('runtime-agent:'.length)
      : null;
    if (runtimeAgentId === 'trading-agent' && onSelectTradingAgents) {
      onChange('');
      onSelectTradingAgents();
      return;
    }
    if (runtimeAgentId === 'shorts' && onSelectShorts) {
      onChange('');
      onSelectShorts();
      return;
    }
    if (runtimeAgentId === 'formsmith' && onSelectFormsmith) {
      onChange('');
      onSelectFormsmith();
      return;
    }
    insertCommand(item);
  }

  const availableRuntimeAgentIds = [
    onSelectBrowserAgent ? 'agent-tars' : null,
    onSelectAgentBrowser ? 'agent-browser' : null,
    onSelectAgentReach ? 'agent-reach' : null,
    onSelectGetDoc ? 'get-doc' : null,
    onSelectMeetingNotes ? 'meeting-notes' : null,
    onSelectDeepTutor ? 'deep-tutor' : null,
    onSelectCareerOps ? 'career-ops' : null,
    onSelectTradingAgents ? 'trading-agent' : null,
    onSelectShorts ? 'shorts' : null,
    onSelectFormsmith ? 'formsmith' : null,
    onSelectVibeTrading ? 'vibe-trading' : null,
    onSelectStockAnalyst ? 'stock-analyst' : null,
    onSelectDeerFlow ? 'deer-flow' : null,
    onSelectDeepResearch ? 'deep-research' : null,
    onSelectOpenPlanter ? 'openplanter' : null,
    onSelectSocialsManager ? 'socials-manager' : null,
    onSelectHardwareBlueprint ? 'hardware-blueprint' : null,
    onSelectParametricCad ? 'parametric-cad' : null,
    onSelectHyperframes ? 'hyperframes' : null,
    onSelectResource2Skill ? 'resource2skill' : null,
    onSelectOpenMontage ? 'openmontage' : null,
    onSelectOpenwork ? 'openwork' : null,
    onSelectOpenscience ? 'openscience' : null,
    onSelectInboxZero ? 'inbox-zero' : null,
    onSelectVimax ? 'vimax' : null,
    onSelectVoxDirector ? 'vox-director' : null,
    onSelectMoneyPrinter ? 'money-printer' : null,
    onSelectLegal ? 'legal' : null,
    onSelectWardrobe ? 'wardrobe' : null,
    onSelectOpenCode ? 'opencode' : null,
    onSelectCodex ? 'codex' : null,
    onSelectRuflo ? 'ruflo' : null,
  ].filter((id): id is string => id !== null);

  return (
    <div className={className}>
      <div className="neu-composer relative rounded-[30px] p-2">
        <SlashCommandMenu
          ref={slashCommandMenuRef}
          open={showSlashCommands}
          query={slashQuery}
          sessionId={capabilitySessionId}
          surface={capabilitySurface}
          availableRuntimeAgentIds={availableRuntimeAgentIds}
          onClose={() => setShowSlashCommands(false)}
          onSelect={selectDirectSlashCommand}
        />
        {headerContent ? (
          <div className="mb-1 border-b border-[var(--line)] px-1 pb-1.5">
            {headerContent}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="flex flex-wrap items-start gap-1.5 px-2 pb-1.5 pt-1">
            {attachments.map((attachment, index) =>
              attachment.type === 'image' && attachment.dataUrl ? (
                <div
                  key={`${attachment.name}-${index}`}
                  className="group relative h-36 w-36 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] sm:h-44 sm:w-44"
                >
                  <button
                    type="button"
                    onClick={() => openLightbox(index)}
                    className="block h-full w-full focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                    aria-label={`Zoom ${attachment.name}`}
                    title={attachment.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  {onRemoveAttachment ? (
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(index)}
                      className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-raised)] text-[var(--ink)] shadow-[var(--neu-soft-shadow)] transition hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                      aria-label={`Remove ${attachment.name}`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              ) : (
                <div
                  key={`${attachment.name}-${index}`}
                  className="neu-surface-subtle flex h-8 max-w-[220px] items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-2.5 py-1.5 text-xs text-[var(--ink)]"
                >
                  {attachment.type === 'model' ? (
                    <span className="shrink-0 text-[var(--botanical)]">
                      <ModelCubeIcon className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <svg className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                      {attachment.type === 'image' ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 4.5h16.5v15H3.75z" />
                      ) : attachment.type === 'video' ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h10.5v10.5H3.75zM14.25 10.5 20.25 7.5v9l-6-3z" />
                      ) : attachment.type === 'audio' ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 18V5.25l10.5-1.5V16.5M9 18a2.25 2.25 0 1 1-4.5 0A2.25 2.25 0 0 1 9 18Zm10.5-1.5a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 2.25H6.375A1.875 1.875 0 0 0 4.5 4.125v15.75c0 1.036.84 1.875 1.875 1.875h11.25c1.036 0 1.875-.84 1.875-1.875V7.5m-5.25-5.25L19.5 7.5m-5.25-5.25V7.5h5.25" />
                      )}
                    </svg>
                  )}
                  {/* Neither a 3D file nor a video has a thumbnail, so the chip
                      links to it: the user can open what was stored before
                      deciding to send. */}
                  {attachment.type === 'model' && attachment.blobId ? (
                    <a
                      href={modelAttachmentHref(attachment.blobId, { download: true })}
                      download={attachment.name}
                      className="truncate underline decoration-dotted underline-offset-2"
                      title={`Download ${attachment.name}`}
                    >
                      {attachment.name}
                    </a>
                  ) : attachment.type === 'audio' && attachment.blobId ? (
                    <a
                      href={`/api/chat-attachments/audio/${attachment.blobId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate underline decoration-dotted underline-offset-2"
                      title={`Play ${attachment.name}`}
                    >
                      {attachment.name}
                    </a>
                  ) : attachment.type === 'video' && attachment.blobId ? (
                    <a
                      href={`/api/chat-attachments/videos/${attachment.blobId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate underline decoration-dotted underline-offset-2"
                      title={`Open ${attachment.name}`}
                    >
                      {attachment.name}
                    </a>
                  ) : attachment.type === 'document' && attachment.blobId ? (
                    // The document is kept whole now, so the chip links to the
                    // stored original — and `detail` says what was found inside
                    // it, which is the one moment the person can check that the
                    // figures and tables were noticed before they press send.
                    <a
                      href={`/api/chat-attachments/documents/${attachment.blobId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate underline decoration-dotted underline-offset-2"
                      title={
                        [
                          describeDocumentSummary(
                            // Only a document's own summary describes a document;
                            // a mesh's shares the field but not the shape.
                            attachment.summary && 'figureCount' in attachment.summary
                              ? attachment.summary
                              : null,
                          ) || `Open ${attachment.name}`,
                          // Whether a question about this file will be answered
                          // from retrieved pages or from the whole document.
                          // Both are honest; they are not the same answer.
                          documentIndexStatus[attachment.blobId]?.label,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      }
                    >
                      {attachment.name}
                    </a>
                  ) : (
                    <span className="truncate">{attachment.name}</span>
                  )}
                  {onRemoveAttachment ? (
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(index)}
                      className="ml-0.5 shrink-0 rounded-full p-0.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
                      aria-label={`Remove ${attachment.name}`}
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              ),
            )}
          </div>
        ) : null}
        {browserAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${browserAgent.name} · Agent TARS operator`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{AGENT_TARS_SLASH_COMMAND}</span>
              {onClearBrowserAgent ? (
                <button
                  type="button"
                  onClick={() => onClearBrowserAgent()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${browserAgent.name}`}
                  title="Clear Agent TARS"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {agentBrowserAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${AGENT_BROWSER_SLASH_COMMAND} · agent-browser (ChatMock)`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{AGENT_BROWSER_SLASH_COMMAND}</span>
              {onClearAgentBrowser ? (
                <button
                  type="button"
                  onClick={() => onClearAgentBrowser()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${agentBrowserAgent.name}`}
                  title="Clear Agent Browser"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {agentReachAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${AGENT_REACH_COMMAND} · internet reading and search (ChatMock)`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{AGENT_REACH_COMMAND}</span>
              {onClearAgentReach ? (
                <button
                  type="button"
                  onClick={() => onClearAgentReach()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${agentReachAgent.name}`}
                  title="Clear Agent Reach"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {deepTutorAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${DEEP_TUTOR_COMMAND} · teaches from the material in scope here`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{DEEP_TUTOR_COMMAND}</span>
              {onClearDeepTutor ? (
                <button
                  type="button"
                  onClick={() => onClearDeepTutor()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${deepTutorAgent.name}`}
                  title="Clear Deep Tutor"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {meetingNotesAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${MEETING_NOTES_COMMAND} · transcribe a meeting and write notes from it`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{MEETING_NOTES_COMMAND}</span>
              {onClearMeetingNotes ? (
                <button
                  type="button"
                  onClick={() => onClearMeetingNotes()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${meetingNotesAgent.name}`}
                  title="Clear Meeting Notes"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {meetingNotesAgent && onMeetingRecorded ? (
          <MeetingRecorderBar onRecorded={onMeetingRecorded} />
        ) : null}
        {getDocAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${GET_DOC_COMMAND} · find papers and save their PDFs to artifacts`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{GET_DOC_COMMAND}</span>
              {onClearGetDoc ? (
                <button
                  type="button"
                  onClick={() => onClearGetDoc()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${getDocAgent.name}`}
                  title="Clear Get Doc"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {careerOpsAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${CAREER_OPS_COMMAND} · job search: evaluate, tailor, track (ChatMock)`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{CAREER_OPS_COMMAND}</span>
              {onClearCareerOps ? (
                <button
                  type="button"
                  onClick={() => onClearCareerOps()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${careerOpsAgent.name}`}
                  title="Clear Career Ops"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {vibeTradingAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${VIBE_TRADING_COMMAND} · finance research: data, factors, backtests (ChatMock)`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{VIBE_TRADING_COMMAND}</span>
              {onClearVibeTrading ? (
                <button
                  type="button"
                  onClick={() => onClearVibeTrading()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${vibeTradingAgent.name}`}
                  title="Clear Vibe Trading"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {stockAnalystAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${STOCK_ANALYST_COMMAND} · a question about a named stock: prices, charts, news, strategies (ChatMock)`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{STOCK_ANALYST_COMMAND}</span>
              {onClearStockAnalyst ? (
                <button
                  type="button"
                  onClick={() => onClearStockAnalyst()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${stockAnalystAgent.name}`}
                  title="Clear Stock Analyst"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {paperTraderSelection ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${PAPER_TRADER_COMMAND} · a paper trading desk that keeps running: send it to start, stop or show`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{PAPER_TRADER_COMMAND}</span>
              {onClearPaperTrader || typedPaperTraderCommand ? (
                <button
                  type="button"
                  onClick={() => {
                    if (typedPaperTraderCommand) onChange('');
                    else onClearPaperTrader?.();
                  }}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${paperTraderSelection.name}`}
                  title="Clear Paper Trader"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {deerFlowAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${DEER_FLOW_COMMAND} · a task agent with its own workspace and helpers (ChatMock)`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{DEER_FLOW_COMMAND}</span>
              {onClearDeerFlow ? (
                <button
                  type="button"
                  onClick={() => onClearDeerFlow()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${deerFlowAgent.name}`}
                  title="Clear DeerFlow"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {tradingAgentsAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${TRADINGAGENTS_COMMAND} · analyst firm on one instrument (ChatMock)`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{TRADINGAGENTS_COMMAND}</span>
              {onClearTradingAgents ? (
                <button
                  type="button"
                  onClick={() => onClearTradingAgents()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${tradingAgentsAgent.name}`}
                  title="Clear Trading Agent"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {shortsAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${SHORTS_COMMAND} · cuts a video into short clips (runs on this machine)`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{SHORTS_COMMAND}</span>
              {onClearShorts ? (
                <button
                  type="button"
                  onClick={() => onClearShorts()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${shortsAgent.name}`}
                  title="Clear Shorts"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {formsmithAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${FORMSMITH_COMMAND} · reconstructs one picture as a 3D model with ShapeR`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{FORMSMITH_COMMAND}</span>
              {onClearFormsmith ? (
                <button
                  type="button"
                  onClick={() => onClearFormsmith()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${formsmithAgent.name}`}
                  title="Clear Formsmith"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {deepResearchAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${DEEP_RESEARCH_SLASH_COMMAND} · web research (ChatMock)`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{DEEP_RESEARCH_SLASH_COMMAND}</span>
              {onClearDeepResearch ? (
                <button
                  type="button"
                  onClick={() => onClearDeepResearch()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${deepResearchAgent.name}`}
                  title="Clear Deep Research"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {openPlanterAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${OPENPLANTER_COMMAND} · recursive investigation (ChatMock)`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">{OPENPLANTER_COMMAND}</span>
              {onClearOpenPlanter ? (
                <button
                  type="button"
                  onClick={() => onClearOpenPlanter()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${openPlanterAgent.name}`}
                  title="Clear OpenPlanter"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {openCodeAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${OPENCODE_COMMAND} · local repository via ChatMock`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">
                {OPENCODE_COMMAND}
              </span>
              {onClearOpenCode ? (
                <button
                  type="button"
                  onClick={() => onClearOpenCode()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${openCodeAgent.name}`}
                  title="Clear OpenCode"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {codexAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${CODEX_COMMAND} · local repository via ChatMock`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">
                {CODEX_COMMAND}
              </span>
              {onClearCodex ? (
                <button
                  type="button"
                  onClick={() => onClearCodex()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${codexAgent.name}`}
                  title="Clear Codex"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {rufloAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${RUFLO_COMMAND} · hive-mind swarm over the connected repository`}
            >
              <span className="truncate font-mono font-medium text-[var(--botanical)]">
                {RUFLO_COMMAND}
              </span>
              {onClearRuflo ? (
                <button
                  type="button"
                  onClick={() => onClearRuflo()}
                  className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Clear ${rufloAgent.name}`}
                  title="Clear Ruflo"
                >
                  <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {activeAgencyAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${activeAgencyAgent.name} · ${activeAgencyAgent.divisionLabel}`}
            >
              <span aria-hidden style={activeAgencyAgent.divisionColor ? { color: activeAgencyAgent.divisionColor } : undefined}>
                {activeAgencyAgent.emoji ?? '●'}
              </span>
              <span className="truncate">
                <span className="font-medium text-[var(--ink)]">{activeAgencyAgent.name}</span>
                <span className="hidden sm:inline"> · {activeAgencyAgent.divisionLabel}</span>
              </span>
              <button
                type="button"
                onClick={() => void clearAgencyAgent()}
                className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                aria-label={`Clear ${activeAgencyAgent.name} agent`}
                title="Clear active agent"
              >
                <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                </svg>
              </button>
            </span>
          </div>
        ) : null}

        {tradingAgentsAgent ? (
          <TradingAgentsRequestForm
            form={tradingAgentsForm}
            onChange={setTradingAgentsForm}
            onSubmit={submitTradingAgents}
            onOpenSettings={() => setTradingAgentsSettingsOpen(true)}
            modelNote={tradingAgentsModelNote}
            disabled={disabled || isSending}
            busy={runInFlight}
          />
        ) : null}

        {shortsAgent ? (
          <ShortsRequestForm
            form={shortsForm}
            onChange={setShortsForm}
            onSubmit={submitShorts}
            onOpenSettings={() => commandHubRef.current?.openAgentSettings(SHORTS_AGENT_ID)}
            disabled={disabled || isSending}
            busy={runInFlight}
          />
        ) : null}

        {formsmithAgent ? (
          <FormsmithRequestForm
            form={formsmithForm}
            onChange={setFormsmithForm}
            onSubmit={submitFormsmith}
            disabled={disabled || isSending}
            busy={runInFlight}
          />
        ) : null}

        <div className="flex min-w-0 items-end gap-1.5">
          <CommandHub
            ref={commandHubRef}
            open={showCommandHub}
            onOpenChange={(nextOpen) => {
              setShowCommandHub(nextOpen);
              if (nextOpen) setShowSlashCommands(false);
            }}
            onSelect={insertCommand}
            onRunWorkflow={onRunWorkflow ? (workflow) => {
              const workflowInput = value.trim() === '/' ? '' : value.trim();
              onChange('');
              window.setTimeout(() => internalTextareaRef.current?.focus(), 0);
              void onRunWorkflow(workflow, workflowInput);
            } : undefined}
            onOpenMcpSettings={() => {
              setSettingsInitialTab('mcp');
              setSettingsMounted(true);
              setShowIntelligence(true);
              setIntelligencePanel('settings');
            }}
            onSelectBrowserAgent={onSelectBrowserAgent ? () => insertCommandToken(AGENT_TARS_SLASH_COMMAND) : undefined}
            onSelectAgentBrowser={onSelectAgentBrowser ? () => insertCommandToken(AGENT_BROWSER_SLASH_COMMAND) : undefined}
            onSelectAgentReach={onSelectAgentReach ? () => insertCommandToken(AGENT_REACH_COMMAND) : undefined}
            onSelectGetDoc={onSelectGetDoc ? () => insertCommandToken(GET_DOC_COMMAND) : undefined}
            onSelectMeetingNotes={onSelectMeetingNotes ? () => insertCommandToken(MEETING_NOTES_COMMAND) : undefined}
            onSelectDeepTutor={onSelectDeepTutor ? () => insertCommandToken(DEEP_TUTOR_COMMAND) : undefined}
            onSelectCareerOps={onSelectCareerOps ? () => insertCommandToken(CAREER_OPS_COMMAND) : undefined}
            onSelectVibeTrading={onSelectVibeTrading ? () => insertCommandToken(VIBE_TRADING_COMMAND) : undefined}
            onSelectStockAnalyst={onSelectStockAnalyst ? () => insertCommandToken(STOCK_ANALYST_COMMAND) : undefined}
            onSelectDeerFlow={onSelectDeerFlow ? () => insertCommandToken(DEER_FLOW_COMMAND) : undefined}
            onSelectTradingAgents={onSelectTradingAgents}
            onSelectShorts={onSelectShorts}
            onSelectFormsmith={onSelectFormsmith}
            onSelectDeepResearch={onSelectDeepResearch ? () => insertCommandToken(DEEP_RESEARCH_SLASH_COMMAND) : undefined}
            onSelectOpenPlanter={onSelectOpenPlanter ? () => insertCommandToken(OPENPLANTER_COMMAND) : undefined}
            onSelectSocialsManager={onSelectSocialsManager ? () => insertCommandToken(SOCIALS_MANAGER_COMMAND) : undefined}
            onSelectHardwareBlueprint={onSelectHardwareBlueprint ? () => insertCommandToken(HARDWARE_BLUEPRINT_COMMAND) : undefined}
            onSelectParametricCad={onSelectParametricCad ? () => insertCommandToken(PARAMETRIC_CAD_COMMAND) : undefined}
            onSelectHyperframes={onSelectHyperframes ? () => insertCommandToken(HYPERFRAMES_COMMAND) : undefined}
            onSelectResource2Skill={onSelectResource2Skill ? () => insertCommandToken(RESOURCE2SKILL_COMMAND) : undefined}
            onSelectOpenMontage={onSelectOpenMontage ? () => insertCommandToken(OPENMONTAGE_COMMAND) : undefined}
            onSelectOpenwork={onSelectOpenwork ? () => insertCommandToken(OPENWORK_COMMAND) : undefined}
            onSelectOpenscience={onSelectOpenscience ? () => insertCommandToken(OPENSCIENCE_COMMAND) : undefined}
            onSelectInboxZero={onSelectInboxZero ? () => insertCommandToken(INBOX_ZERO_COMMAND) : undefined}
            onSelectVimax={onSelectVimax ? () => insertCommandToken(VIMAX_COMMAND) : undefined}
            onSelectVoxDirector={
              onSelectVoxDirector ? () => insertCommandToken(VOX_DIRECTOR_COMMAND) : undefined
            }
            onSelectMoneyPrinter={
              onSelectMoneyPrinter ? () => insertCommandToken(MONEY_PRINTER_COMMAND) : undefined
            }
            onSelectLegal={onSelectLegal ? () => insertCommandToken(LEGAL_COMMAND) : undefined}
            onSelectWardrobe={
              onSelectWardrobe ? () => insertCommandToken(WARDROBE_COMMAND) : undefined
            }
            onSelectOpenCode={onSelectOpenCode ? () => insertCommandToken(OPENCODE_COMMAND) : undefined}
            onSelectCodex={onSelectCodex ? () => insertCommandToken(CODEX_COMMAND) : undefined}
            onSelectRuflo={onSelectRuflo ? () => insertCommandToken(RUFLO_COMMAND) : undefined}
            disabled={sessionActionsDisabled}
            compact={compact}
            sessionId={capabilitySessionId}
            surface={capabilitySurface}
            gardenSlug={capabilityGardenSlug}
            requestedOutcome={value}
          />

          {onAddDocuments && !formAgent ? (
            <button
              type="button"
              onClick={onAddDocuments}
              disabled={sessionActionsDisabled || isAddingDocuments}
              className={`neu-button-icon flex shrink-0 items-center justify-center rounded-full text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-40 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
              title="Add documents"
              aria-label="Add documents"
            >
              {isAddingDocuments ? (
                <Spinner />
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              )}
            </button>
          ) : null}

          {activeRun && permissionPending ? (
            <span
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#a86b3b] sm:flex"
              title="Permission decision required"
              aria-label="Permission decision required"
            >
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75 5.25 6v5.25c0 4.14 2.83 7.98 6.75 9 3.92-1.02 6.75-4.86 6.75-9V6L12 3.75Z" />
                <path strokeLinecap="round" d="M12 8.25v4.5m0 3h.008" />
              </svg>
            </span>
          ) : null}

          {utilityActions ? <div className="flex shrink-0 items-center gap-1">{utilityActions}</div> : null}

          {formAgent ? (
            <div
              className={`relative flex min-w-0 flex-1 items-center ${compact ? 'min-h-9' : 'min-h-11'}`}
            >
              {/* No textarea: these agents have no prompt, and a field that
                  silently discarded what you typed would be worse than none. */}
              <p className="w-full px-1 text-xs leading-5 text-[var(--ink-muted)]">
                {tradingAgentsAgent
                  ? 'Trading Agent reads a symbol and a date, not a message. Fill in the request above, or clear the agent to write normally.'
                  : shortsAgent
                    ? 'Shorts reads a video, not a message. Give it one above, or clear the agent to write normally.'
                    : paperTraderSelection
                      ? 'The trading desk takes no instructions — what it trades and how is set in its settings. Send to open it, or clear the agent to write normally.'
                      : 'Formsmith reads one picture, not a message. Choose it above, or clear the agent to write normally.'}
              </p>
            </div>
          ) : (
          <div className={`relative flex min-w-0 flex-1 items-center ${compact ? 'min-h-9' : 'min-h-11'}`}>
            {(() => {
              const commandSplit = splitLeadingCommandTokens(value);
              // Links are painted in the same mirror the command tokens use.
              // Only the part after a command is scanned, so a slash token can
              // never be swallowed by a URL that happens to follow it.
              const linkBody = commandSplit ? commandSplit.rest : value;
              const bodySegments = composerSegments(linkBody);
              const hasLink = bodySegments.some((segment) => segment.kind === 'link');
              const mirrored = Boolean(commandSplit) || hasLink;
              return (
                <>
                  {/* Keep the mirror centered with a one-line textarea. Once
                      the textarea grows past its minimum height, both layers
                      naturally start at the same top edge. */}
                  {mirrored ? (
                    <div
                      ref={commandBackdropRef}
                      aria-hidden
                      // Above the textarea, not behind it, so an anchor can be
                      // clicked. The layer itself passes every event through;
                      // only the anchors take one, so typing, selecting and
                      // placing the caret all still land on the textarea.
                      className="pointer-events-none absolute inset-0 z-10 flex select-none items-center overflow-hidden"
                    >
                      <div
                        className={`w-full whitespace-pre-wrap break-words px-1 py-0 ${compact ? 'min-h-5 text-sm leading-5' : 'min-h-6 text-[15px] leading-6'}`}
                      >
                        {commandSplit ? (
                          <span className="text-[var(--botanical)]">{commandSplit.command}</span>
                        ) : null}
                        {bodySegments.map((segment, index) =>
                          segment.kind === 'link' ? (
                            <a
                              key={`${index}-${segment.text}`}
                              href={segment.href}
                              target="_blank"
                              rel="noreferrer noopener"
                              // The one part of the mirror that is interactive.
                              // The trade: a click that *starts* on the link
                              // opens it instead of placing the caret there.
                              // Everything else — typing, arrow keys, a drag
                              // that starts anywhere else and passes over it —
                              // still reaches the textarea underneath.
                              className="pointer-events-auto cursor-pointer text-[var(--botanical)] underline decoration-[var(--botanical)]/40 underline-offset-2 hover:decoration-[var(--botanical)]"
                              title={`Open ${segment.href}`}
                            >
                              {segment.text}
                            </a>
                          ) : (
                            <span key={`${index}-text`} className="text-[var(--ink)]">
                              {segment.text}
                            </span>
                          ),
                        )}
                        {'\u200b'}
                      </div>
                    </div>
                  ) : null}
                  <textarea
                    ref={assignTextareaRef}
                    value={value}
                    onChange={(event) => {
                      const next = event.target.value;
                      onChange(next);
                      if (next.trim().toLowerCase() === PAPER_TRADER_COMMAND.toLowerCase()) {
                        setShowSlashCommands(false);
                        setShowCommandHub(false);
                        return;
                      }
                      // Typing in a leading slash token opens the direct command
                      // picker, never the full capability manager — including
                      // the token of a sentence that already has a body, which
                      // is how an existing capability gets swapped. Backspacing
                      // a command down to "/" still does not reopen anything.
                      const { inputType } = event.nativeEvent as Partial<InputEvent>;
                      const slashQuery = slashQueryAt(next, event.target.selectionStart);
                      if (
                        slashQuery &&
                        (showSlashCommands || !inputType?.startsWith('delete'))
                      ) {
                        setSlashQuery(slashQuery.query);
                        setShowSlashCommands(true);
                        setShowCommandHub(false);
                      } else if (showSlashCommands) {
                        setShowSlashCommands(false);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (slashCommandMenuRef.current?.handleKeyDown(event)) return;
                      if (commandHubRef.current?.handleKeyDown(event)) return;
                      onKeyDown?.(event);
                      if (event.defaultPrevented) return;
                      if (walkMessageHistory(event)) return;
                      if (
                        event.key !== 'Enter' ||
                        event.shiftKey ||
                        event.nativeEvent.isComposing
                      ) {
                        return;
                      }
                      event.preventDefault();
                      // Loading history and an active response both hold this
                      // message in the visible follow-up queue. The host drains
                      // it only after the conversation is safe to write.
                      if (queueHeld) {
                        queueSteer();
                        return;
                      }
                      if (!canSubmit || isSending || disabled) return;
                      onSubmit();
                    }}
                    onPaste={handlePaste}
                    onScroll={syncCommandBackdrop}
                    rows={1}
                    wrap="soft"
                    placeholder={placeholder}
                    className={`block w-full min-w-0 max-w-full resize-none overflow-y-hidden bg-transparent px-1 py-0 caret-[var(--composer-caret)] outline-none placeholder:text-[var(--ink-muted)] disabled:opacity-50 ${mirrored ? 'text-transparent' : 'text-[var(--ink)]'} ${compact ? 'min-h-5 text-sm leading-5' : 'min-h-6 text-[15px] leading-6'}`}
                    style={textareaStyle}
                  />
                </>
              );
            })()}
          </div>
          )}

          <div className="relative shrink-0 self-end">
            <button
              type="button"
              onClick={toggleIntelligence}
              className={`neu-button flex items-center gap-1.5 rounded-full bg-[var(--paper-strong)] text-[var(--ink)] transition hover:bg-[var(--paper-bg)] ${compact ? 'h-9 px-2.5 text-xs' : 'h-11 px-3.5 text-sm'}`}
              title={`${selectedEffort.label} reasoning · ${formatAssistantModelName(model)}${activeRun ? ' (changes apply to the next message)' : ''}`}
              aria-expanded={showIntelligence}
            >
              <span>{selectedEffort.label}</span>
              <svg className="h-3.5 w-3.5 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {showIntelligence ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={closeIntelligence}
                  aria-label="Close intelligence menu"
                />
                <div className="neu-popover absolute bottom-full right-0 z-40 mb-2 flex max-h-[min(40rem,calc(100vh-6rem))] w-64 flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-2 text-sm">
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="px-2.5 pb-1.5 pt-1 text-sm text-[var(--ink-muted)]">Intelligence</div>
                    {effortOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          onReasoningEffortChange(option.value);
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--paper-strong)] ${option.value === reasoningEffort ? 'neu-selected bg-[var(--paper-surface)] text-[var(--ink-heading)]' : 'text-[var(--ink)]'}`}
                      >
                        <span>
                          <span className="block">{option.label}</span>
                          <span className="block text-[11px] text-[var(--ink-muted)]">{option.detail}</span>
                        </span>
                        {option.value === reasoningEffort ? <CheckIcon /> : null}
                      </button>
                    ))}

                    <div className="my-1.5 border-t border-[var(--line)]" />
                    <div className="flex items-center justify-between px-2.5 pb-1 pt-1 text-xs text-[var(--ink-muted)]">
                      <span>Model</span>
                      {modelsLoading ? <span>Loading…</span> : null}
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {groupAssistantModels(models).map((group) => (
                        <div key={group.vendorId}>
                          <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                            <span className="underline decoration-[var(--line-strong)] underline-offset-4">
                              {group.vendorLabel}
                            </span>
                          </div>
                          {group.models.map((item) => (
                            <button
                              key={item}
                              type="button"
                              onClick={() => {
                                onModelChange(item);
                              }}
                              className={`flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--paper-strong)] ${item === model ? 'neu-selected bg-[var(--paper-surface)] text-[var(--ink-heading)]' : 'text-[var(--ink)]'}`}
                            >
                              <span className="truncate">{formatAssistantModelName(item)}</span>
                              {item === model ? <CheckIcon /> : null}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>

                    <div className="my-1.5 border-t border-[var(--line)]" />
                    <button
                      type="button"
                      role="switch"
                      aria-checked={directMode}
                      onClick={() => setDirectMode(!directMode)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
                    >
                      <span className="min-w-0">
                        <span className="block">Direct mode</span>
                        <span className="block text-[11px] text-[var(--ink-muted)]">
                          Direct answers; next actions only when useful
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${directMode ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
                      >
                        <span
                          className={`neu-surface-raised absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${directMode ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </span>
                    </button>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={yoloMode}
                      onClick={() => setYoloMode(!yoloMode)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
                    >
                      <span className="min-w-0">
                        <span className="block">YOLO mode</span>
                        <span className="block text-[11px] text-[var(--ink-muted)]">
                          Bypass permission prompts
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${yoloMode ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
                      >
                        <span
                          className={`neu-surface-raised absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${yoloMode ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </span>
                    </button>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={agentMode}
                      onClick={() => setAgentMode(!agentMode)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
                    >
                      <span className="min-w-0">
                        <span className="block">Agent mode</span>
                        <span className="block text-[11px] text-[var(--ink-muted)]">
                          {agentMode
                            ? 'Answers run on the agent runtime, with tools'
                            : 'Answers come straight from the model, no tools'}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${agentMode ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
                      >
                        <span
                          className={`neu-surface-raised absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${agentMode ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </span>
                    </button>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={goalMode}
                      onClick={() => setGoalMode(!goalMode)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
                    >
                      <span className="min-w-0">
                        <span className="block">Goal mode</span>
                        <span className="block text-[11px] text-[var(--ink-muted)]">
                          Keep a verified objective across this chat’s turns
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${goalMode ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
                      >
                        <span
                          className={`neu-surface-raised absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${goalMode ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </span>
                    </button>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={superAgent}
                      onClick={() => setSuperAgent(!superAgent)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
                    >
                      <span className="min-w-0">
                        <span className="block">Super agent</span>
                        <span className="block text-[11px] text-[var(--ink-muted)]">
                          Every skill, workflow, connection and specialist
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${superAgent ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
                      >
                        <span
                          className={`neu-surface-raised absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${superAgent ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </span>
                    </button>
                  </div>

                  <div className="shrink-0">
                    <div className="my-1.5 border-t border-[var(--line)]" />
                    <UsageLimitsPopover
                      open={intelligencePanel === 'usage'}
                      onOpenChange={(open) => setIntelligencePanel(open ? 'usage' : null)}
                      showBackdrop={false}
                      activeModel={model}
                      modelFailover={modelFailover}
                      buttonClassName="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition"
                      activeButtonClassName="bg-[var(--paper-surface)] text-[var(--botanical)]"
                      inactiveButtonClassName="text-[var(--ink)] hover:bg-[var(--paper-strong)]"
                      popoverClassName="absolute bottom-0 right-full z-50 mr-2 w-72 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-4 text-xs text-[var(--ink)] shadow-2xl"
                      light
                    />

                    <button
                      type="button"
                      onPointerEnter={() => void preloadSettingsOverview()}
                      onClick={() => {
                        setSettingsMounted(true);
                        setIntelligencePanel((current) => current === 'settings' ? null : 'settings');
                      }}
                      aria-expanded={intelligencePanel === 'settings'}
                      className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${intelligencePanel === 'settings' ? 'bg-[var(--paper-surface)] text-[var(--botanical)]' : 'text-[var(--ink)] hover:bg-[var(--paper-strong)]'}`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.375.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247c.275.476.17 1.081-.26 1.431l-1.003.827c-.293.24-.438.613-.43.992a7.03 7.03 0 0 1 0 .255c-.008.378.137.752.43.992l1.004.827c.43.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a7.03 7.03 0 0 1 0-.255c.007-.379-.138-.752-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                        />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                      Settings
                    </button>
                    {settingsMounted ? (
                      <SettingsDialog
                        key={settingsInitialTab}
                        presentation="popover"
                        open={intelligencePanel === 'settings'}
                        initialTab={settingsInitialTab}
                        onClose={() => setIntelligencePanel(null)}
                      />
                    ) : null}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <SpeechDictationButton
            value={value}
            onChange={onChange}
            // Dictation writes into the message field, which does not exist
            // while a request-form agent is selected.
            disabled={disabled || isSending || Boolean(formAgent)}
            compact={compact}
            textareaRef={internalTextareaRef}
            onOpenVoiceMode={voiceMessages ? () => setVoiceOpen(true) : undefined}
          />

          {/* An external agent used to leave this a send button on the grounds
              that its card carries its own Stop — but a card can be suppressed
              (a quiet run) or never arrive at all, and then nothing on screen
              could stop a working conversation. Enter still queues the draft
              either way, exactly as it does during a chat turn. */}
          {runInFlight && onStop && !canQueueFollowUp ? (
            <button
              type="button"
              onClick={onStop}
              disabled={stopping}
              className={`neu-button-accent flex shrink-0 items-center justify-center rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] text-[var(--paper-raised)] transition-colors hover:bg-[var(--botanical-hover)] disabled:cursor-wait disabled:opacity-55 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
              aria-label={stopping ? 'Stopping active run' : 'Stop active run'}
              aria-busy={stopping}
              title={stopping ? 'Stopping...' : 'Stop'}
            >
              {stopping ? <Spinner /> : <span className="h-3 w-3 rounded-[3px] bg-current" aria-hidden />}
            </button>
          ) : (
          <button
            type="button"
            // A typed draft takes precedence over the loading/stop affordance:
            // its arrow queues the message, matching Enter. With the field empty
            // the active run still exposes Stop above.
            onClick={() =>
              formAgent
                ? submitFormAgent()
                : queueHeld
                  ? queueSteer()
                  : onSubmit()
            }
            disabled={
              !canSend ||
              (formAgent
                ? disabled || queueHeld || isSending
                : queueHeld
                  ? !canQueueFollowUp
                  : disabled || isSending)
            }
            // While the chat loads with no draft, the button keeps its accent
            // colour and spinner. A draft restores the enabled arrow immediately.
            className={`neu-button-accent flex shrink-0 items-center justify-center rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] text-[var(--paper-raised)] transition-colors hover:bg-[var(--botanical-hover)] ${loading ? 'disabled:cursor-wait disabled:opacity-55' : 'disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)]'} ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
            aria-label={
              canQueueFollowUp
                ? 'Queue message'
                : loading
                  ? 'Loading this chat'
                  : tradingAgentsAgent
                  ? 'Run analysis'
                  : shortsAgent
                    ? 'Cut the clips'
                    : formsmithAgent
                      ? 'Reconstruct the picture'
                      : paperTraderSelection
                        ? 'Open the trading desk'
                        : 'Send'
            }
            title={
              canQueueFollowUp
                ? 'Queue until the conversation is ready'
                : loading
                  ? 'Loading this chat…'
                  : formAgent
                  ? runInFlight
                    ? 'Wait for the running agent to finish'
                    : tradingAgentsAgent
                      ? 'Run the analysis'
                      : shortsAgent
                        ? 'Cut the clips'
                        : paperTraderSelection
                          ? 'Open the trading desk'
                          : 'Reconstruct the picture'
                  : 'Send'
            }
          >
            {(isSending || loading) && !canQueueFollowUp ? (
              <Spinner />
            ) : (
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0-6 6m6-6 6 6" />
              </svg>
            )}
          </button>
          )}
        </div>

      </div>

      {activeLightbox ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Image preview: ${activeLightbox.attachment.name}`}
          onClick={() => setLightboxIndex(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
            aria-label="Close preview"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>

          {hasMultipleImages ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                stepLightbox(-1);
              }}
              className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
              aria-label="Previous image"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
          ) : null}

          <figure
            className="flex max-h-full max-w-full flex-col items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeLightbox.attachment.dataUrl}
              alt={activeLightbox.attachment.name}
              className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
            />
            <figcaption className="flex items-center gap-2 text-xs text-white/80">
              <span className="max-w-[60vw] truncate">{activeLightbox.attachment.name}</span>
              {hasMultipleImages ? (
                <span className="rounded-full bg-white/15 px-2 py-0.5 tabular-nums">
                  {(lightboxIndex ?? 0) + 1} / {imageAttachments.length}
                </span>
              ) : null}
            </figcaption>
          </figure>

          {hasMultipleImages ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                stepLightbox(1);
              }}
              className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
              aria-label="Next image"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}

      {tradingAgentsSettingsOpen ? (
        <TradingAgentsSettingsDialog onClose={() => setTradingAgentsSettingsOpen(false)} />
      ) : null}

      {voiceMessages ? (
        <VoiceConversationOverlay
          open={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          onSend={sendSpokenTurn}
          messages={voiceMessages}
          busy={isSending || runInFlight}
        />
      ) : null}
    </div>
  );
}
