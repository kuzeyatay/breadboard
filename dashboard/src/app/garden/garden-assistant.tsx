'use client';

import { useStarredMessageJump, type StarredMessageTarget } from '@/app/components/use-starred-message-jump';
import { normalizeQuartzChatLink } from '@/lib/quartz-chat-link';
import { handleGardenSourceImportResult } from '@/lib/hermes/garden-source-import-client';
import { useUnreadChats } from '@/lib/conversations/unread-client';
import { useChatNotificationView } from '@/lib/use-chat-notification-view';
import { notificationMessageKeys } from '@/lib/chat-notification-visibility';
import { ActiveChatIcon, UnreadChatDot } from '@/app/components/hermes/history-client';

import {
  type ChangeEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import AssistantComposer from '@/app/components/assistant-composer';
import { useRecommendations } from '@/app/components/use-recommendations';
import { ChatSuggestionCards } from '@/app/components/hermes/chat-greeting-empty-state';
import QuartzInlineAnswerPopover, { type QuartzAnswerSelection } from '@/app/garden/quartz-inline-answer-popover';
import InlineArtifactCards, { InlineArtifactCardsProvider } from '@/app/components/hermes/inline-artifact-cards';
import { useComposerInset } from '@/app/components/chat/use-composer-inset';
import ChatDisclaimer from '@/app/components/chat/chat-disclaimer';
import AssistantMessageActions, { MessageActionsSlot, type AssistantResponseBranch } from '@/app/components/assistant-message-actions';
import { messageRewriteReview } from '@/app/components/humanizer/rewrite-status';
import UserMessageControls from '@/app/components/chat/user-message-controls';
import { applyBranchVariant, cloneMessages, createConversationBranch, messageBranchId, previousUserMessageIndex, type ConversationBranchGroup } from '@/app/components/hermes/conversation-branches';
import { isDirectModeEnabled } from '@/app/components/use-direct-mode';
import { isPersonalizeEnabled } from '@/app/components/use-personalize';
import {
  chatAutoScrollContentKey,
  chatAutoScrollResponseKey,
  useChatAutoScroll,
  useChatVirtualBridge,
} from '@/app/components/use-chat-auto-scroll';
import VirtualizedMessageList from '@/app/components/chat/virtualized-message-list';
import { chatRowKey, estimateChatRowHeight } from '@/app/components/chat/chat-row-identity';
import ChatJumpToBottom from '@/app/components/chat-jump-to-bottom';
import ChatMessageRail, { type ChatMessageRailItem } from '@/app/components/chat-message-rail';
import ChatMessageAttachments from '@/app/components/chat-message-attachments';
import ChatVideoLinkEmbeds from '@/app/components/chat-video-link-embed';
import { QuotedChatSelection, SelectableAssistantMarkdown, SelectionComposerContext, type ChatTextSelectionCandidate, type FloatingAnchorRect } from '@/app/components/chat-text-selection-ui';
import { useTextSelectionController } from '@/app/components/use-text-selection-controller';
import type { ChatTextAnnotation } from '@/app/components/chat-markdown';
import type { ChatTextSelectionReference } from '@/lib/chat-text-selection';
import ChatTimeSeparator from '@/app/components/chat-time-separator';
import { useAssistantIntelligence } from '@/app/components/use-assistant-intelligence';
import { isSuperAgentEnabled } from '@/app/components/use-agent-mode';
import { isYoloModeEnabled } from '@/app/components/use-yolo-mode';
import ActivityPanel from '@/app/components/hermes/activity-panel';
import { applyAutoHumanizeOutcome, useAutoHumanize, type NaturalRewriteActivity } from '@/app/components/humanizer/use-auto-humanize';
import { UserMessageText } from '@/app/components/hermes/command-text';
import CollapsibleUserMessage from '@/app/components/chat/collapsible-user-message';
import { useLegacyAgentActivity } from '@/app/components/hermes/use-legacy-agent-activity';
import type { ChatRuntimeControl } from '@/lib/hermes/chat-runtime-control.ts';
import { restoreQueuedFollowUpDraft, useQueuedFollowUps } from '@/app/components/hermes/queued-follow-ups';
import { useChatDraft } from '@/app/components/hermes/use-chat-draft';
import { forgetChatDrafts } from '@/lib/conversations/drafts';
import AssistantRichResponse from '@/app/components/assistant-rich-response';
import InlineProposalCards, { InlineProposalCardsProvider } from '@/app/components/hermes/inline-proposal-cards';
import { normalizeGenerativeUiResources, type GenerativeUiResource } from '@/lib/generative-ui/contracts';
import { uiResourcesForUserRequest } from '@/lib/generative-ui/request-policy';
import { useSmoothStreamText } from '@/app/components/chat/use-smooth-stream-text';
import { useAssistantModels } from '@/app/components/use-assistant-models';
import { useChatModelChanges } from '@/app/components/use-chat-model-changes';
import { ChatModelChangeSeparators } from '@/app/components/chat-model-change-separator';
import {
  CHAT_ATTACHMENT_ACCEPT,
  attachmentOnlyMessageText,
  chatMessageAttachments,
  extractChatAttachments,
  reusableChatAttachments,
  type ChatAttachment,
  type ChatMessageAttachment,
} from '@/lib/chat-attachments';
import { distillAttachments } from '@/lib/document-skills/client';
import { useAttachmentPreparation } from '@/app/components/use-attachment-preparation';
import { type ChatTokenUsage, normalizeChatTokenUsage } from '@/lib/chat-token-usage';
import { chatTimeSeparatorLabels } from '@/lib/chat-time-separators';
import { isClarificationAnswerMessage } from '@/lib/steered-response';
import { trimVerificationForTransport, type VerificationSummary } from '@/lib/hermes/evidence';
import { applyGardenStableTextEvent } from '@/lib/hermes/garden-stable-stream';
import { assistantVisibleContent } from '@/lib/hermes/assistant-visible-content';
import { delegatedAgentCompletedLabelForMessage, delegatedThinkingUpdates } from '@/lib/hermes/super-agent-activity';
import type {
  QuartzAssistantSelectionRequest,
  QuartzInlineAnswerStopRequest,
  QuartzInlineAnswerUpdate,
} from '@/lib/quartz-assistant-selection';
import type { QuartzTopologyInvestigationRequest } from '@/lib/quartz-topology-investigation';
import { abortGardenTurnCheckpoint, fetchGardenChat, reserveGardenTurnCheckpoint } from '@/lib/conversations/garden-turn-client';
import { gardenTurnCompletedOnServer, readGardenResponseData } from '@/lib/hermes/garden-response-stream';
import { runGardenInlineQuestion, preserveInlineQuestionMessages, reconcileInlineQuestionMessages, retireCompletedInlineQuestionViewers } from '@/lib/conversations/garden-inline-question';

interface QuartzInlineSelectionReference {
  requestId: string;
  highlightId: string;
  pageSlug?: string;
}

interface ChatMessage {
  artifactMessageId?: string;
  humanizerReview?: import('@/lib/humanizer/review-types').HumanizerReviewPresentation;
  contentVersions?: import('@/app/components/hermes/use-agent-session').AgentMessage['contentVersions'];
  id?: string;
  clientMessageId?: string;
  branchGroupId?: string;
  clarificationAnswer?: boolean;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  uiResources?: GenerativeUiResource[];
  sources?: string[];
  thinking?: string;
  progressNotes?: string[];
  attachmentNames?: string[];
  attachments?: ChatMessageAttachment[];
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  responseCompletedAt?: string;
  verification?: VerificationSummary;
  selectedText?: string;
  textSelection?: ChatTextSelectionReference;
  /** A Garden "Ask here" turn is kept in history but drawn on its page mark. */
  inlineSelection?: QuartzInlineSelectionReference;
  /** A durable pre-dispatch pause restored from chat history. */
  pendingPermissions?: Array<Record<string, unknown>>;
  runtimeError?: string;
  pending?: boolean;
  failed?: boolean;
  interrupted?: boolean;
}

interface ChatSession {
  runtimeControl?: ChatRuntimeControl | null;
  id: number;
  conversationId?: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  isOwn?: boolean;
  ownerUsername?: string;
  messages: ChatMessage[];
  /** Off-record sessions are kept only for the lifetime of this mounted view. */
  temporary?: boolean;
  /** A server-owned Garden turn is still running for this chat. */
  active?: boolean;
}

function withRecoveredAssistant(messages: ChatMessage[], active: boolean): ChatMessage[] {
  const last = messages.at(-1);
  if (!active || last?.role !== 'user') return messages;
  return [
    ...messages,
    {
      role: 'assistant',
      content: '',
      pending: true,
      createdAt: last.createdAt,
      clientMessageId: last.clientMessageId,
      textSelection: last.textSelection,
      inlineSelection: last.inlineSelection,
      sources: [],
    },
  ];
}

function visibleGardenChatMessages(messages: ChatMessage[]): ChatMessage[] {
  let pendingInlineAnswers = 0;
  const visibleMessages: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user' && isClarificationAnswerMessage(message)) {
      continue;
    }
    if (message.inlineSelection || message.textSelection?.mode === 'inline') {
      if (message.role === 'user') {
        pendingInlineAnswers += 1;
      } else if (pendingInlineAnswers > 0) {
        pendingInlineAnswers -= 1;
      }
      continue;
    }

    // Older Garden transcripts can be missing inline metadata on the answer.
    // Pair it with the preceding inline question instead of leaking that answer
    // into the ordinary assistant stream.
    if (message.role === 'assistant' && pendingInlineAnswers > 0) {
      pendingInlineAnswers -= 1;
      continue;
    }

    visibleMessages.push(message);
  }

  return visibleMessages;
}

/**
 * A filesystem access request raised by the server mid-turn. `originalText` and
 * `history` are kept so approving resumes the same task automatically — the
 * user should never have to retype the request they already made.
 */
interface PermissionRequest {
  requestId: string;
  message: string;
  path?: string;
  operations: string[];
  originalText: string;
  history: ChatMessage[];
  attachments: ChatAttachment[];
  selectedText?: string;
  selectionContext?: QuartzAssistantSelectionRequest;
  textSelection?: ChatTextSelectionReference;
}

function permissionRequestFromMessages(messages: ChatMessage[]): PermissionRequest | null {
  const assistantIndex = messages.length - 1;
  const assistant = messages[assistantIndex];
  if (
    assistant?.role !== 'assistant' ||
    assistant.runtimeError !== 'awaiting_permission' ||
    !assistant.pendingPermissions?.length
  ) {
    return null;
  }
  const pending = assistant.pendingPermissions.find(
    (item) => item?.kind === 'filesystem' && typeof item.path === 'string' && Boolean(item.path.trim()),
  );
  if (!pending) return null;
  let userIndex = assistantIndex - 1;
  while (userIndex >= 0 && messages[userIndex]?.role !== 'user') userIndex -= 1;
  const user = messages[userIndex];
  if (!user || user.role !== 'user') return null;
  return {
    requestId: String(pending.id ?? 'preflight-permission'),
    message: String(pending.message ?? 'This task needs access to a folder.'),
    path: String(pending.path),
    operations: Array.isArray(pending.operations)
      ? pending.operations.filter((operation): operation is string => typeof operation === 'string')
      : ['read'],
    originalText: user.content,
    history: messages.slice(0, userIndex),
    attachments: reusableChatAttachments(user.attachments),
    selectedText: user.selectedText,
    textSelection: user.textSelection,
  };
}

function gardenAssistantVisibleContent(message: ChatMessage): string {
  const visible = assistantVisibleContent(message.content, message);
  if (visible || message.role !== 'assistant') return visible;
  const pending = message.pendingPermissions?.find(
    (item) => item && typeof item === 'object',
  );
  if (typeof pending?.message === 'string' && pending.message.trim()) {
    return pending.message.trim();
  }
  if (message.runtimeError === 'awaiting_permission') {
    return 'This response paused before it started because access was required. Retry it to continue.';
  }
  return '';
}

interface GraphStats {
  documents: number;
  topics: number;
  textbookPages: number;
  conceptPages: number;
  conceptNodes: number;
  generatedNotes: number;
  links: number;
  words: number;
}

interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  category: string;
  isDefault?: boolean;
}

interface ActiveMarkdown {
  cluster: string;
  slug: string;
  title?: string;
  content?: string;
  loading?: boolean;
}

interface Props {
  activeClusterSlug: string | null;
  activeClusterName?: string;
  activeMarkdown?: ActiveMarkdown | null;
  selectedTextRequest?: QuartzAssistantSelectionRequest | null;
  topologyInvestigationRequest?: QuartzTopologyInvestigationRequest | null;
  inlineAnswerStopRequest?: QuartzInlineAnswerStopRequest | null;
  onInlineAnswerUpdate?: (update: QuartzInlineAnswerUpdate) => void;
  initialOpen?: boolean;
  launcherHidden?: boolean;
  onPanelWidthChange?: (width: number) => void;
  /** The Quartz reader whose page "Ask here" answers this assistant hosts. */
  quartzIframeRef?: RefObject<HTMLIFrameElement | null>;
  quartzOrigin?: string;
}

const EMPTY_STATS: GraphStats = {
  documents: 0,
  topics: 0,
  textbookPages: 0,
  conceptPages: 0,
  conceptNodes: 0,
  generatedNotes: 0,
  links: 0,
  words: 0,
};

const PROMPTS_KEY = 'sb_prompts_v1';
const DEFAULT_PROMPTS: SavedPrompt[] = [
  {
    id: 'dp-1',
    title: 'Summarize all documents',
    content:
      'Summarize the key points from all documents in this garden into a concise, structured overview with clear headings.',
    category: 'Summary',
    isDefault: true,
  },
  {
    id: 'dp-2',
    title: 'Study guide',
    content:
      'Create a comprehensive study guide from my materials. Include key concepts, definitions, important facts, and any formulas or equations. Organize by topic.',
    category: 'Study',
    isDefault: true,
  },
  {
    id: 'dp-3',
    title: 'Quiz me',
    content:
      'Generate 8 quiz questions based on the content in this garden to test my understanding. Mix multiple choice and open questions. Include correct answers at the end.',
    category: 'Study',
    isDefault: true,
  },
  {
    id: 'dp-4',
    title: "Explain like I'm a beginner",
    content:
      'Explain the main concepts in this garden as if I have no prior background in the subject. Use simple language, analogies, and real-world examples.',
    category: 'Study',
    isDefault: true,
  },
  {
    id: 'dp-5',
    title: 'Find connections',
    content:
      'Identify and explain the key connections, relationships, and dependencies between the topics and documents in this garden. Show how ideas link together.',
    category: 'Analysis',
    isDefault: true,
  },
  {
    id: 'dp-6',
    title: 'Gaps and contradictions',
    content:
      'Analyze my documents and identify: (1) gaps in information where more research is needed, (2) any contradictions or conflicting information between sources, (3) assumptions that may be worth questioning.',
    category: 'Analysis',
    isDefault: true,
  },
  {
    id: 'dp-7',
    title: 'Extract key formulas and terms',
    content:
      'List all important formulas, equations, technical terms, and definitions from my documents. Format each with a brief explanation of what it means and when to use it.',
    category: 'Analysis',
    isDefault: true,
  },
  {
    id: 'dp-8',
    title: 'Essay outline',
    content:
      'Based on my documents, write a detailed outline for an academic essay or report covering the main topic. Include thesis, main arguments, supporting points, and a suggested conclusion.',
    category: 'Writing',
    isDefault: true,
  },
  {
    id: 'dp-9',
    title: 'Action items and tasks',
    content:
      'Extract all action items, tasks, to-dos, deadlines, and next steps mentioned anywhere in my documents. Present as a prioritized list.',
    category: 'Summary',
    isDefault: true,
  },
  {
    id: 'dp-10',
    title: 'Timeline of events',
    content:
      'Create a chronological timeline of all events, milestones, dates, or sequential steps mentioned in my materials. Include brief descriptions for each entry.',
    category: 'Summary',
    isDefault: true,
  },
];
const PROMPT_CATEGORIES = ['All', 'Summary', 'Study', 'Analysis', 'Writing', 'Custom'];
const PANEL_WIDTH_KEY = 'second-brain:garden-assistant-width';
const QUARTZ_CHAT_HISTORY_KEY_PREFIX = 'second-brain:quartz-ai-history:';
const QUARTZ_CHAT_SELECTION_KEY_PREFIX = 'second-brain:quartz-ai-selection:';
const QUARTZ_BRANCH_KEY_PREFIX = 'breadboard:quartz-conversation-branches:';
const MAX_QUARTZ_CHAT_SESSIONS = 30;
const DEFAULT_PANEL_WIDTH = 520;
const MIN_PANEL_WIDTH = 480;
const MAX_PANEL_WIDTH = 680;

function clampPanelWidth(width: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

function markdownFileLabel(markdown: ActiveMarkdown): string {
  const label = markdown.title || markdown.slug;
  const clean = label.split('/').filter(Boolean).at(-1) || label;
  return /\.md$/i.test(clean) ? clean : `${clean}.md`;
}

function wantsOpenMarkdownEdit(text: string): boolean {
  const normalized = text.toLowerCase();
  // Figure edits need the agent's Garden search and source-figure tools. The
  // single-note rewrite endpoint cannot inspect assets or neighboring notes.
  if (/\b(figures?|images?|diagrams?|illustrations?|pictures?|plots?|charts?|visuals?|screenshots?)\b/.test(normalized)) return false;
  const refersToOpenMarkdown =
    /\b(this|current|open|opened|visible)\s+(markdown|md|note|file|document)\b/.test(normalized) ||
    /\b(markdown|md|note|file|document)\s+(i\s+have\s+open|is\s+open|currently\s+open)\b/.test(normalized) ||
    /\b(the|this)\s+(markdown|md|note|file|document)\b/.test(normalized) ||
    /\b(markdown|md|note|file|document)\b/.test(normalized);
  if (!refersToOpenMarkdown) return false;

  return /\b(add|append|insert|change|update|edit|rewrite|revise|fix|repair|clean|format|reformat|correct|remove|delete|replace|overwrite|swap|use|apply|tag|tags|frontmatter|yaml|latex|math|equation|version)\b/.test(
    normalized,
  );
}

function formatChatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function loadPrompts(): SavedPrompt[] {
  if (typeof window === 'undefined') return DEFAULT_PROMPTS;
  try {
    const raw = localStorage.getItem(PROMPTS_KEY);
    if (!raw) return DEFAULT_PROMPTS;
    const stored = JSON.parse(raw) as SavedPrompt[];
    const storedIds = new Set(stored.map((prompt) => prompt.id));
    return [...DEFAULT_PROMPTS.filter((prompt) => !storedIds.has(prompt.id)), ...stored];
  } catch {
    return DEFAULT_PROMPTS;
  }
}

function persistPrompts(prompts: SavedPrompt[]) {
  localStorage.setItem(PROMPTS_KEY, JSON.stringify(prompts));
}

function quartzHistoryKey(clusterSlug: string): string {
  return `${QUARTZ_CHAT_HISTORY_KEY_PREFIX}${clusterSlug}`;
}

function loadQuartzChatSessions(clusterSlug: string | null): ChatSession[] {
  if (typeof window === 'undefined' || !clusterSlug) return [];
  writeQuartzChatSessions(clusterSlug);
  try {
    const raw = window.localStorage.getItem(quartzHistoryKey(clusterSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((session) => typeof session.id === 'number' && typeof session.title === 'string')
      .map((session) => ({
        ...session,
        messages: Array.isArray(session.messages)
          ? session.messages
              .filter(
                (message) =>
                  (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string',
              )
              .map((message) => ({
                ...message,
                usage: normalizeChatTokenUsage(message.usage) ?? undefined,
              }))
          : [],
      }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, MAX_QUARTZ_CHAT_SESSIONS);
  } catch {
    return [];
  }
}

function loadQuartzChatSelection(clusterSlug: string | null): number | null | undefined {
  if (typeof window === 'undefined' || !clusterSlug) return undefined;
  try {
    const saved = window.localStorage.getItem(`${QUARTZ_CHAT_SELECTION_KEY_PREFIX}${clusterSlug}`);
    if (saved === 'new') return null;
    const id = Number(saved);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  } catch { return undefined; }
}

function persistQuartzChatSelection(clusterSlug: string | null, sessionId: number | null) {
  if (typeof window === 'undefined' || !clusterSlug) return;
  try {
    window.localStorage.setItem(`${QUARTZ_CHAT_SELECTION_KEY_PREFIX}${clusterSlug}`, sessionId === null ? 'new' : String(sessionId));
  } catch { /* Keep the selected conversation usable when storage is unavailable. */ }
}

// The history is a multi-MB JSON of up to 30 sessions, and every write sends a
// `storage` event carrying the old and new strings to every other Breadboard
// tab. Written on each streamed token of an "Ask here" answer, that grew all
// ~40 renderers to 1.3 GB at once and exhausted Windows commit (2026-10-19
// 10:18). The server holds the real history, so writes wait for a quiet moment.
const QUARTZ_HISTORY_QUIET_MS = 1_500;
const QUARTZ_HISTORY_MAX_WAIT_MS = 15_000;
const pendingQuartzHistory = new Map<string, { sessions: ChatSession[]; timer: ReturnType<typeof setTimeout>; since: number }>();
const writtenQuartzHistory = new Map<string, string>();

function writeQuartzChatSessions(clusterSlug: string) {
  const pending = pendingQuartzHistory.get(clusterSlug);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingQuartzHistory.delete(clusterSlug);
  const value = JSON.stringify(pending.sessions
    .filter((session) => session.temporary !== true)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, MAX_QUARTZ_CHAT_SESSIONS)
    // Raw tool payloads were 6.8 of this key's 8.3 MB, and Chromium keeps a
    // copy of the origin's whole localStorage in every renderer that reads it.
    .map((session) => ({
      ...session,
      messages: session.messages.map((message) => message.verification
        ? { ...message, verification: trimVerificationForTransport(message.verification) }
        : message),
    })));
  if (writtenQuartzHistory.get(clusterSlug) === value) return;
  writtenQuartzHistory.set(clusterSlug, value);
  try {
    window.localStorage.setItem(quartzHistoryKey(clusterSlug), value);
  } catch { /* The server keeps the history when local storage is full. */ }
}

function flushQuartzChatSessions() {
  for (const clusterSlug of [...pendingQuartzHistory.keys()]) writeQuartzChatSessions(clusterSlug);
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushQuartzChatSessions);

function persistQuartzChatSessions(clusterSlug: string | null, sessions: ChatSession[]) {
  if (typeof window === 'undefined' || !clusterSlug) return;
  const previous = pendingQuartzHistory.get(clusterSlug);
  if (previous) clearTimeout(previous.timer);
  const since = previous?.since ?? Date.now();
  const delay = Math.max(0, Math.min(QUARTZ_HISTORY_QUIET_MS, since + QUARTZ_HISTORY_MAX_WAIT_MS - Date.now()));
  pendingQuartzHistory.set(clusterSlug, { sessions, since, timer: setTimeout(() => writeQuartzChatSessions(clusterSlug), delay) });
}

type AgentActivityProps = ComponentProps<typeof ActivityPanel>;

/** Referentially stable, so a historical row's props never change mid-answer. */
const NO_ACTIVITIES: AgentActivityProps['activities'] = [];
const NO_TEXT_ANNOTATIONS: readonly ChatTextAnnotation[] = [];
const NO_BRANCH_GROUPS: Record<string, ConversationBranchGroup<ChatMessage>> = {};

function gardenSelectionMessageId(message: ChatMessage, index: number): string {
  // The client turn id survives the pending row receiving its database id.
  return message.clientMessageId ? `client:${message.clientMessageId}:${message.role}` : chatRowKey(message, index);
}

type TranscriptRowProps = {
  message: ChatMessage;
  userRequest: string;
  naturalRewrite?: NaturalRewriteActivity;
  chatSessionId: number | null;
  conversationId?: string;
  canStar: boolean;
  onSend: (text: string) => void;
  /** Row identity, so a folded long message stays folded across remounts. */
  messageKey: string;
  /** The separator that belongs above this message, if any. */
  separatorLabel: string | null;
  /** Live agent state belongs to the newest answer alone. */
  activities: AgentActivityProps['activities'];
  connection: AgentActivityProps['connection'];
  pendingPermission: AgentActivityProps['pendingPermission'];
  onPermissionDecision: AgentActivityProps['onPermissionDecision'];
  pendingClarification: AgentActivityProps['pendingClarification'];
  onClarificationAnswer: AgentActivityProps['onClarificationAnswer'];
  /** Withheld while the answer is still being written. */
  showActions: boolean;
  onRetry?: () => void;
  branch?: AssistantResponseBranch;
  userActionsDisabled: boolean;
  onEditUserMessage: (message: ChatMessage, text: string) => void;
  onDeleteUserMessage: (message: ChatMessage) => void;
  sourceMessageId: string;
  annotations: readonly ChatTextAnnotation[];
  onTextSelection: (selection: ChatTextSelectionCandidate) => void;
  onOpenAnnotation: (id: string, anchor: FloatingAnchorRect) => void;
};

/** Wrapped so the list's `(item, index)` call cannot land on the options bag. */
const estimateAssistantRowHeight = (message: ChatMessage) => estimateChatRowHeight(message);

/**
 * One transcript row. Extracted and memoized because virtualization keeps the
 * rows around the fold mounted, and a streaming answer re-renders the panel on
 * every token — the messages above it have no reason to follow along.
 */

/**
 * One transcript row. Extracted and memoized because virtualization keeps the
 * rows around the fold mounted, and a streaming answer re-renders the panel on
 * every token — the messages above it have no reason to follow along.
 */
const TranscriptRow = memo(function TranscriptRow({
  message,
  userRequest,
  naturalRewrite,
  chatSessionId,
  conversationId,
  canStar,
  onSend,
  messageKey,
  separatorLabel,
  activities,
  connection,
  pendingPermission,
  onPermissionDecision,
  pendingClarification,
  onClarificationAnswer,
  showActions,
  onRetry,
  branch,
  userActionsDisabled,
  onEditUserMessage,
  onDeleteUserMessage,
  sourceMessageId,
  annotations,
  onTextSelection,
  onOpenAnnotation,
}: TranscriptRowProps) {
  const visibleAssistantContent = gardenAssistantVisibleContent(message);
  const uiResources = uiResourcesForUserRequest(message.uiResources, userRequest);
  return (
    <div className={separatorLabel ? 'space-y-3' : undefined}
      data-notification-message={!message.pending && message.role === 'assistant' && visibleAssistantContent.trim()
        ? JSON.stringify(notificationMessageKeys(message)) : undefined}>
      {separatorLabel ? <ChatTimeSeparator label={separatorLabel} dateTime={message.createdAt} /> : null}
      <div className={message.role === 'user' ? 'ml-auto flex w-fit min-w-0 max-w-[75%] flex-col items-end gap-1 has-[[data-editing=true]]:w-full has-[[data-editing=true]]:max-w-none' : 'group/assistant-message w-full'}>
        {message.role === 'user' ? (
          <>
            <ChatMessageAttachments attachments={message.attachments} attachmentNames={message.attachmentNames} />
            <ChatVideoLinkEmbeds text={message.content} attachments={message.attachments} />
          </>
        ) : null}
        {message.role === 'user' && message.selectedText ? (
          <QuotedChatSelection selection={{ quote: message.selectedText }} />
        ) : null}
        {message.role === 'user' ? (
          <UserMessageControls
            content={message.content}
            disabled={userActionsDisabled}
            onEdit={(text) => onEditUserMessage(message, text)}
            onDelete={() => onDeleteUserMessage(message)}
          >
            <div className="neu-chat-message neu-chat-message-user w-fit max-w-full rounded-[22px] px-4 py-2.5 text-sm leading-6">
              <CollapsibleUserMessage messageKey={messageKey}>
                <UserMessageText content={message.content} />
              </CollapsibleUserMessage>
            </div>
          </UserMessageControls>
        ) : (
            <div className="text-sm leading-7 text-gray-200">
              <ActivityPanel
                activities={activities}
                progressNotes={delegatedThinkingUpdates(message)}
                reasoning={message.thinking}
                answerContent={visibleAssistantContent}
                connection={connection}
                pendingPermission={pendingPermission}
                pendingClarification={pendingClarification}
                onClarificationAnswer={onClarificationAnswer}
                usage={message.usage}
                responseDurationMs={message.responseDurationMs}
                responseCompletedAt={message.responseCompletedAt}
                onPermissionDecision={onPermissionDecision}
                completedLabel={delegatedAgentCompletedLabelForMessage(message)}
              />
              <AssistantRichResponse
                message={{ content: visibleAssistantContent, uiResources }}
                legacyChatSessionId={chatSessionId}
                onSend={onSend}
                markdown={<SelectableAssistantMarkdown content={visibleAssistantContent}
                  sourceMessageId={sourceMessageId} annotations={annotations}
                  onSelection={onTextSelection} onOpenAnnotation={onOpenAnnotation} />}
              />
              <InlineProposalCards ownerMessageId={message.id ?? null} />
              {message.id ? <InlineArtifactCards ownerMessageId={message.artifactMessageId ?? message.id} thinking={!showActions} /> : null}
            </div>
        )}
        {message.role === 'assistant' && showActions && (visibleAssistantContent || uiResources.length) ? (
          <MessageActionsSlot conversationId={conversationId} messageId={message.clientMessageId ?? message.id} canStar={canStar}>
          <AssistantMessageActions
            content={visibleAssistantContent || 'Response unavailable'}
            humanizerReview={messageRewriteReview(message)}
            naturalRewrite={naturalRewrite}
            responseStartedAt={message.createdAt}
            responseDurationMs={message.responseDurationMs}
            responseCompletedAt={message.responseCompletedAt}
            verification={message.verification}
            onRetry={onRetry}
            branch={branch}
          />
          </MessageActionsSlot>
        ) : null}
      </div>
    </div>
  );
});

export default function GardenAssistant({
  activeClusterSlug,
  activeClusterName,
  activeMarkdown,
  selectedTextRequest,
  topologyInvestigationRequest,
  inlineAnswerStopRequest,
  onInlineAnswerUpdate,
  initialOpen = false,
  launcherHidden = false,
  onPanelWidthChange,
  quartzIframeRef,
  quartzOrigin = '',
}: Props) {
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const previousClusterRef = useRef<string | null>(activeClusterSlug);
  const handledSelectionRequestRef = useRef<string | null>(null);
  const handledTopologyInvestigationRef = useRef<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [chatOpen, setChatOpen] = useState(initialOpen);
  const [chatQuestionTarget, setChatQuestionTarget] = useState<StarredMessageTarget | null>(null);
  const [input, setInput] = useState('');
  const [selectedTextContext, setSelectedTextContext] = useState<QuartzAssistantSelectionRequest | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const visibleMessages = useMemo(() => visibleGardenChatMessages(messages), [messages]);
  const timeSeparators = useMemo(() => chatTimeSeparatorLabels(visibleMessages), [visibleMessages]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const activeChatIdRef = useRef(activeChatId);
  activeChatIdRef.current = activeChatId;
  const chatSelectionVersionRef = useRef(0);
  const blankChatRequestedRef = useRef(false);
  const clusterSlugRef = useRef(activeClusterSlug);
  clusterSlugRef.current = activeClusterSlug;
  const inlineQuestionRunsRef = useRef(new Map<string, { clusterSlug: string; selectionId: string; sessionId: number | null; clientMessageId: string; controller: AbortController; viewerController: AbortController; retired: boolean }>());
  const turnSessionCreationRef = useRef<{ clusterSlug: string | null; chatId: number | null; promise: Promise<ChatSession | null> } | null>(null);
  const [temporaryChat, setTemporaryChat] = useState(false);
  const chatBeforeTemporary = useRef<number | null>(null);
  const [branchesByChat, setBranchesByChat] = useState<Record<number, Record<string, ConversationBranchGroup<ChatMessage>>>>({});
  const branchGroups = (activeChatId === null ? undefined : branchesByChat[activeChatId]) ?? NO_BRANCH_GROUPS;
  useEffect(() => {
    if (activeChatId === null || branchesByChat[activeChatId]) return;
    let restored = NO_BRANCH_GROUPS;
    try {
      restored = JSON.parse(window.localStorage.getItem(`${QUARTZ_BRANCH_KEY_PREFIX}${activeChatId}`) ?? '{}');
      if (!restored || typeof restored !== 'object' || Array.isArray(restored)) restored = NO_BRANCH_GROUPS;
    } catch { /* The transcript remains usable without locally saved variants. */ }
    setBranchesByChat((current) => ({ ...current, [activeChatId]: restored }));
  }, [activeChatId, branchesByChat]);
  const { unreadChats } = useUnreadChats(activeClusterSlug ?? undefined);
  const [isStreaming, setIsStreaming] = useState(false);
  const [updatingMessages, setUpdatingMessages] = useState(false);
  const messageMutationPendingRef = useRef(false);
  const activeChat = chatSessions.find((session) => session.id === activeChatId) ?? null;
  const viewingConversationId = activeChat?.conversationId ?? undefined;
  const starConversationId = viewingConversationId ?? (activeChatId === null ? undefined : String(activeChatId));
  const canStar = !temporaryChat && activeChat?.isOwn !== false;
  useChatNotificationView(chatOpen && activeClusterSlug && activeChatId !== null && !temporaryChat
    ? { surface: "garden_chat", gardenSlug: activeClusterSlug, chatId: String(activeChatId), conversationId: viewingConversationId }
    : null);
  const pendingMain = messages.some(message => message.role === 'assistant' && message.pending && message.textSelection?.mode !== 'inline' && !message.inlineSelection);
  const chatIsStreaming = isStreaming || (activeChat?.active === true && pendingMain);
  // The chat this assistant minted out of its own blank state, so an unsent
  // draft can follow it there and nowhere else. See useChatDraft.
  const [createdChatId, setCreatedChatId] = useState<number | null>(null);
  // Raised for as long as a turn this tab started owns what is on screen. The
  // transcript is put up before the chat row that will hold it exists, so the
  // empty session arriving must not be allowed to wipe it.
  const localTurnRef = useRef(false);
  const turnObserverRef = useRef<{
    sessionId: number;
    clientMessageId: string;
    recover: (session: ChatSession) => void;
  } | null>(null);
  const persistenceChainsRef = useRef<Map<number, Promise<boolean>>>(new Map());
  const persistenceVersionsRef = useRef<Map<number, number>>(new Map());
  const [showHistory, setShowHistory] = useState(false);
  // The newest answer's text is revealed at a readable pace rather than drawn
  // straight from the buffer, so a reply that arrives in bursts (or whole)
  // still reads as a stream. Older messages render their content directly.
  const newestMessage = visibleMessages[visibleMessages.length - 1];
  const newestAssistantVisibleContent =
    newestMessage?.role === 'assistant'
      ? gardenAssistantVisibleContent(newestMessage)
      : '';
  const revealedAssistantContent = useSmoothStreamText(
    newestAssistantVisibleContent,
    chatIsStreaming,
  );
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [approvingPermission, setApprovingPermission] = useState(false);
  const agentActivity = useLegacyAgentActivity({
    sessionReference: activeChat?.conversationId ?? activeChatId,
    runtimeControl: activeChat?.isOwn === false ? null : activeChat?.runtimeControl,
  });
  const abortConversationActivity = agentActivity.abort;
  const abortAgentActivity = useCallback(async () => {
    const stopped = await abortConversationActivity(viewingConversationId);
    setAttachmentStatus(stopped ? '' : 'Could not stop the conversation. Try Stop again.');
  }, [abortConversationActivity, viewingConversationId]);
  const selectionMessages = useMemo(() => messages.map((message, index) => ({
    ...message, id: gardenSelectionMessageId(message, index),
    starMessageId: message.clientMessageId ?? message.id,
    content: message.role === 'assistant' ? gardenAssistantVisibleContent(message) : message.content,
    progressNotes: delegatedThinkingUpdates(message),
  })).filter(message => !isClarificationAnswerMessage(message)), [messages]);
  // A follow-up may begin inside a page answer while the panel is closed; the
  // question is typed in the composer, so bring it up.
  const beginResponseQuestion = useCallback(() => {
    setSelectedTextContext(null);
    setShowHistory(false);
    setChatOpen(true);
  }, []);
  const renderAnswerArtifacts = useCallback((answerMessageId: string) => {
    // Selection ids stay stable while streaming; artifacts use the persisted
    // response id (or the original response's id after a branch is restored).
    const message = messages.find((candidate, index) => gardenSelectionMessageId(candidate, index) === answerMessageId);
    const ownerMessageId = message?.artifactMessageId ?? message?.id;
    return ownerMessageId ? <InlineArtifactCards legacyChatSessionId={activeChatId}
      gardenSlug={activeClusterSlug} ownerMessageId={ownerMessageId} /> : null;
  }, [messages, activeChatId, activeClusterSlug]);
  const textSelection = useTextSelectionController({
    conversationId: starConversationId,
    canStar,
    persistDraft: !temporaryChat,
    scope: activeChatId === null ? null : `quartz:${activeClusterSlug}:${activeChatId}`,
    renderArtifacts: renderAnswerArtifacts,
    messages: selectionMessages,
    busy: chatIsStreaming,
    concurrentInline: true,
    composerRef: composerTextareaRef,
    onBeginQuestion: beginResponseQuestion,
    onOpenChatQuestion: selectionId => {
      setChatOpen(true);
      setShowHistory(false);
      setChatQuestionTarget({ chatId: String(activeChatId), messageId: '', selectionId, requestId: Date.now() });
    },
    onAsk: (question, selection, attachments) => { void sendMessage(question, undefined, attachments, undefined, undefined, selection); },
    onStop: selectionId => { void stopInlineQuestion(selectionId); },
  });
  // Page answers are hidden turns of this transcript. Keying them by request id
  // lets the Quartz popover make its answer selectable, so "Ask here" nests.
  const inlineAnswerMessageIds = useMemo(() => {
    const ids = new Map<string, string>();
    messages.forEach((message, index) => {
      if (message.role === 'assistant' && message.inlineSelection) {
        ids.set(message.inlineSelection.requestId, gardenSelectionMessageId(message, index));
      }
    });
    return ids;
  }, [messages]);
  const quartzAnswerSelection = useMemo<QuartzAnswerSelection>(() => ({
    persistDraft: !temporaryChat,
    messageIdFor: (requestId) => inlineAnswerMessageIds.get(requestId),
    starMessageIdFor: (requestId) => {
      const answer = messages.findLast(message => message.role === 'assistant' && message.inlineSelection?.requestId === requestId);
      return answer?.clientMessageId ?? answer?.id;
    },
    conversationId: starConversationId,
    canStar,
    attachmentsFor: (requestId) => {
      const user = messages.findLast(message => message.role === 'user' && message.inlineSelection?.requestId === requestId);
      return user ? reusableChatAttachments(user.attachments).filter(item => item.context !== 'pdf') : undefined;
    },
    annotations: textSelection.annotations,
    onSelection: textSelection.receiveSelection,
    onOpenAnnotation: textSelection.openAnnotation,
    onReply: textSelection.replyToAnswer,
  }), [messages, inlineAnswerMessageIds, starConversationId, canStar, temporaryChat, textSelection.annotations, textSelection.receiveSelection, textSelection.openAnnotation, textSelection.replyToAnswer]);
  const stopInlineQuestionRef = useRef(stopInlineQuestion);
  stopInlineQuestionRef.current = stopInlineQuestion;
  useEffect(() => {
    if (inlineAnswerStopRequest) void stopInlineQuestionRef.current(inlineAnswerStopRequest.requestId);
  }, [inlineAnswerStopRequest]);
  const naturalRewriteFor = useAutoHumanize({
    conversationId: viewingConversationId,
    messages,
    active: chatIsStreaming || agentActivity.connection === 'connecting' ||
      agentActivity.connection === 'streaming' || agentActivity.connection === 'waiting',
    blocked: activeChat?.isOwn === false,
    onComplete: (message, outcome) => {
      setMessages((current) => applyAutoHumanizeOutcome(current, message, outcome));
      setChatSessions((sessions) => sessions.map((session) => session.id === activeChatId
        ? { ...session, messages: applyAutoHumanizeOutcome(session.messages ?? [], message, outcome) }
        : session));
    },
  });
  const visibleAgentConnection =
    chatIsStreaming && agentActivity.connection === 'idle' ? 'streaming' : agentActivity.connection;
  // The turn a mid-run correction may join. Corrections are kept beside the
  // turn's own message list so the streaming loop re-renders them in place
  // instead of clobbering them with its next delta.
  const activeSteerContextRef = useRef<{ messages: ChatMessage[] } | null>(null);
  // Messages typed while a turn is streaming queue above the composer instead
  // of being dropped; each can steer the active response, and whatever is
  // still queued when the turn settles is sent as an ordinary follow-up.
  const { queueFollowUp, headerContent: queuedFollowUpsHeader } = useQueuedFollowUps({
    conversationKey: activeChatId === null ? null : String(activeChatId),
    runInFlight: chatIsStreaming,
    steerableRunActive: Boolean(agentActivity.activeRunId) && activeChat?.isOwn !== false,
    onSteer: steerActiveResponse,
    onRestoreDraft: (text, attachments, selection) => {
      restoreQueuedFollowUpDraft(text, setInput, composerTextareaRef);
      setChatAttachments([...attachments]);
      if (selection) textSelection.restoreComposerSelection(selection);
      else textSelection.clearComposerSelection();
    },
    onSendQueued: async (text, attachments, selection) => {
      await sendMessage(text, undefined, attachments, undefined, undefined, selection);
    },
  });
  const [isResizing, setIsResizing] = useState(false);
  const [stats, setStats] = useState<GraphStats>(EMPTY_STATS);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const {
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    intelligenceModes,
  } = useAssistantIntelligence({
    scope: `garden_assistant:${activeClusterSlug ?? "none"}`,
    sessionId: activeChatId,
    createdSessionId: createdChatId,
    persist: !temporaryChat,
    shared: true,
  });
  const { models, modelsLoading, loadModels } = useAssistantModels();
  const { changeModel, labelsFor: modelChangesFor } = useChatModelChanges({
    scope: `garden_chat:${activeClusterSlug}`, sessionId: activeChatId, createdSessionId: createdChatId,
    conversationId: activeChat?.conversationId, messages: visibleMessages, model, onModelChange: setModel, persist: !temporaryChat,
  });
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const { begin: beginAttachmentPreparation, busy: extractingAttachments, error: attachmentUploadError } =
    useAttachmentPreparation(`${activeClusterSlug}:${activeChatId ?? ""}`);
  const [attachmentStatus, setAttachmentStatus] = useState('');
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const useFile = (event: Event) => {
      const detail = (event as CustomEvent<{ action: string; instruction?: string; file: { id: string; gardenId: string; name: string; mimeType: string; size: number; version: number } }>).detail;
      if (detail?.action !== 'chat' || detail.file.gardenId !== activeClusterSlug) return;
      setChatOpen(true); setShowHistory(false);
      if (typeof detail.instruction === 'string' && detail.instruction.length <= 10000) setInput(current => current || detail.instruction!);
      void (async () => {
        try {
          if (detail.file.size > 128 * 1024 * 1024) throw new Error('Chat attachments must be 128 MB or smaller.');
          setAttachmentStatus(`Preparing ${detail.file.name}…`);
          const response = await fetch(`/api/gardens/${encodeURIComponent(detail.file.gardenId)}/files/${encodeURIComponent(detail.file.id)}/content?version=${detail.file.version}`);
          if (!response.ok) throw new Error('The file could not be attached. Try again from its file menu.');
          const blob = await response.blob();
          if (clusterSlugRef.current !== detail.file.gardenId) return;
          await addAttachmentFiles([new File([blob], detail.file.name, { type: detail.file.mimeType })]);
          composerTextareaRef.current?.focus();
        } catch (cause) { setAttachmentStatus(cause instanceof Error ? cause.message : 'The file could not be attached.'); }
      })();
    };
    window.addEventListener('sb:garden-file-use', useFile);
    return () => window.removeEventListener('sb:garden-file-use', useFile);
  }, [activeClusterSlug, activeChatId, beginAttachmentPreparation]);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [showPrompts, setShowPrompts] = useState(false);
  const [promptSearch, setPromptSearch] = useState('');
  const [promptCategory, setPromptCategory] = useState('All');
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);

  const hasActiveCluster = Boolean(activeClusterSlug);
  const clusterLabel = activeClusterName || activeClusterSlug || 'Open a garden';
  useEffect(() => {
    const storedWidth = window.localStorage.getItem(PANEL_WIDTH_KEY);
    if (storedWidth !== null) {
      const savedWidth = Number(storedWidth);
      if (Number.isFinite(savedWidth)) setPanelWidth(clampPanelWidth(savedWidth));
    }
    setPrompts(loadPrompts());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    onPanelWidthChange?.(chatOpen ? panelWidth : 0);
  }, [chatOpen, panelWidth, onPanelWidthChange]);

  useEffect(() => {
    if (previousClusterRef.current === activeClusterSlug) return;
    previousClusterRef.current = activeClusterSlug;
    chatSelectionVersionRef.current += 1;
    blankChatRequestedRef.current = false;
    setTemporaryChat(false);
    chatBeforeTemporary.current = null;
    setInput('');
    setSelectedTextContext(null);
    setShowHistory(false);
  }, [activeClusterSlug]);

  useEffect(() => {
    if (
      !activeClusterSlug ||
      !selectedTextRequest ||
      handledSelectionRequestRef.current === selectedTextRequest.requestId
    ) {
      return;
    }
    handledSelectionRequestRef.current = selectedTextRequest.requestId;
    if (selectedTextRequest.mode !== 'inline') textSelection.cancelQuestion();
    if (selectedTextRequest.question && (selectedTextRequest.mode === 'inline' || !chatIsStreaming)) {
      const { attachments, ...selectionContext } = selectedTextRequest;
      void sendMessage(selectedTextRequest.question, undefined, attachments ?? [], selectedTextRequest.text, selectionContext);
      return;
    }
    setSelectedTextContext(selectedTextRequest);
    if (selectedTextRequest.question) setInput(selectedTextRequest.question);
    setShowHistory(false);
    setChatOpen(true);
    window.setTimeout(() => composerTextareaRef.current?.focus(), 0);
  }, [activeClusterSlug, selectedTextRequest]);

  useEffect(() => {
    if (
      !activeClusterSlug ||
      !topologyInvestigationRequest ||
      topologyInvestigationRequest.clusterSlug !== activeClusterSlug ||
      handledTopologyInvestigationRef.current === topologyInvestigationRequest.requestId
    ) {
      return;
    }
    handledTopologyInvestigationRef.current = topologyInvestigationRequest.requestId;
    setSelectedTextContext(null);
    setShowHistory(false);
    setChatOpen(true);
    // Draft restoration for a newly selected Garden registers just after this
    // effect. Put the explicit map action last so an older draft cannot cover
    // the topology prompt the person just requested.
    const timer = window.setTimeout(() => {
      setInput(topologyInvestigationRequest.prompt);
      composerTextareaRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeClusterSlug, topologyInvestigationRequest]);

  // The iframe keeps answers beside their marks in localStorage. Re-publish
  // completed inline turns from canonical chat history after a reload or page
  // navigation so a fresh Quartz document can rebuild that local association.
  useEffect(() => {
    if (!onInlineAnswerUpdate) return;
    const questions = new Map<string, string>();
    for (const message of messages) {
      const selection = message.inlineSelection;
      if (!selection) continue;
      if (message.role === 'user') {
        questions.set(selection.requestId, message.content);
        continue;
      }
      if (!message.content && !message.pending) continue;
      onInlineAnswerUpdate({
        ...selection,
        question: questions.get(selection.requestId) ?? 'Question about this highlight',
        answer: message.content,
        thinking: message.thinking,
        progressNotes: delegatedThinkingUpdates(message),
        state: message.pending ? (message.content ? 'streaming' : 'pending') : message.failed || message.interrupted ? 'error' : 'complete',
        ...(message.responseDurationMs !== undefined ? { responseDurationMs: message.responseDurationMs } : {}),
      });
    }
  }, [chatIsStreaming, messages, onInlineAnswerUpdate]);

  // Unsent text outlives a reload, filed under the chat it was typed in — and
  // under the cluster, since that is what the chats themselves are kept by.
  // Declared after the cluster-switch reset above so that on a switch the draft
  // of the cluster being opened has the last word over the emptying.
  const draftSurface = `garden_assistant:${activeClusterSlug ?? 'none'}`;
  useChatDraft({
    surface: draftSurface,
    sessionId: activeChatId === null ? null : String(activeChatId),
    createdSessionId: createdChatId === null ? null : String(createdChatId),
    value: input,
    onRestore: setInput,
    enabled: !temporaryChat,
  });

  useEffect(() => {
    // The local cache is a fast first paint only. Server-side chat sessions are
    // authoritative: a cached entry whose id no longer exists (notably the
    // legacy `Date.now()` ids this component used to mint) can never be
    // addressed by the Hermes runtime, so it is dropped on reconcile.
    const cached = loadQuartzChatSessions(activeClusterSlug);
    setChatSessions(cached);
    const savedSelection = loadQuartzChatSelection(activeClusterSlug);
    if (savedSelection === null) blankChatRequestedRef.current = true;
    // A reload must reopen the selected conversation, not a newer empty chat
    // left behind by a delayed creation request in another tab.
    if (!blankChatRequestedRef.current) {
      const selected = cached.find(session => session.id === savedSelection) ?? cached[0];
      setActiveChatId(selected?.id ?? null);
      setCreatedChatId(null);
      setMessages(selected?.messages ?? []);
    }

    if (!activeClusterSlug) return;
    let cancelled = false;
    const selectionVersion = chatSelectionVersionRef.current;
    (async () => {
      try {
        const response = await fetch(
          `/api/chat-sessions?clusterSlug=${encodeURIComponent(activeClusterSlug)}&historySurface=assistant`,
          { cache: 'no-store' },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { sessions?: ChatSession[] };
        const serverSessions = body.sessions;
        if (cancelled || selectionVersion !== chatSelectionVersionRef.current || !Array.isArray(serverSessions)) return;

        const serverIds = new Set(serverSessions.map((session) => session.id));
        setChatSessions((previous) => {
          // Keep cached transcripts for sessions the server still knows about,
          // so an in-flight reply is not lost by the reconcile.
          const cachedById = new Map(previous.map((session) => [session.id, session]));
          const reconciled = serverSessions
            .map((session) => ({
              ...session,
              // While the detached runtime is active, the server holds the
              // durable user checkpoint but this tab may have newer streamed
              // text. Once active clears, the finalized server transcript is
              // authoritative and replaces the cache.
              messages: reconcileInlineQuestionMessages(preserveInlineQuestionMessages(withRecoveredAssistant(
                session.active === true &&
                  (cachedById.get(session.id)?.messages.length ?? 0) >= (session.messages?.length ?? 0)
                  ? (cachedById.get(session.id)?.messages ?? [])
                  : session.messages?.length
                    ? session.messages
                    : (cachedById.get(session.id)?.messages ?? []),
                session.active === true,
              ), cachedById.get(session.id)?.messages ?? []), session.messages ?? []),
            }))
            .slice(0, MAX_QUARTZ_CHAT_SESSIONS);
          const mountedTemporary = previous.find(
            (session) => session.temporary === true,
          );
          const next = mountedTemporary && temporaryChat
            ? [mountedTemporary, ...reconciled]
            : reconciled;
          persistQuartzChatSessions(activeClusterSlug, next);
          return next;
        });
        setActiveChatId((current) => {
          if (blankChatRequestedRef.current || temporaryChat) return current;
          const selected = savedSelection != null && serverIds.has(savedSelection)
            ? savedSelection : current !== null && serverIds.has(current) ? current : serverSessions[0]?.id ?? null;
          persistQuartzChatSelection(activeClusterSlug, selected);
          return selected;
        });
      } catch {
        /* offline: the cached view stays until the next successful reconcile */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeClusterSlug, temporaryChat]);

  useEffect(() => {
    const restoredMessages = activeChat?.messages ?? [];
    if (localTurnRef.current) {
      setMessages(current => reconcileInlineQuestionMessages(current, restoredMessages));
      return;
    }
    setMessages(restoredMessages);
    setPermissionRequest(permissionRequestFromMessages(restoredMessages));
  }, [activeChat?.id, activeChat?.messages]);

  const activeChatIdsKey = chatSessions
    .filter((session) => (isStreaming && session.id === activeChatId) || session.active === true || session.messages.some(message => message.pending))
    .map((session) => session.id)
    .join(',');
  useEffect(() => {
    if (!activeClusterSlug || !activeChatIdsKey) return;
    const ids = activeChatIdsKey.split(',').map(Number).filter(Number.isInteger);
    const reconcile = () => {
      if (document.visibilityState !== 'visible') return;
      for (const sessionId of ids) {
        const params = new URLSearchParams({
          clusterSlug: activeClusterSlug,
          historySurface: 'assistant',
          sessionId: String(sessionId),
        });
        void fetch(`/api/chat-sessions?${params.toString()}`, {
          cache: 'no-store',
        })
          .then(async (response) => {
            if (!response.ok) return null;
            const body = (await response.json()) as {
              sessions?: ChatSession[];
            };
            return body.sessions?.[0] ?? null;
          })
          .then((refreshed) => {
            if (!refreshed) return;
            retireCompletedInlineQuestionViewers(inlineQuestionRunsRef.current, refreshed.id, refreshed.messages);
            const observer = turnObserverRef.current;
            if (observer?.sessionId === refreshed.id && gardenTurnCompletedOnServer(refreshed, observer.clientMessageId)) {
              observer.recover(refreshed);
            }
            setChatSessions((previous) => {
              const current = previous.find((session) => session.id === refreshed.id);
              if (!current) return previous;
              const keepLocal =
                (localTurnRef.current && activeChatId === refreshed.id) ||
                (refreshed.active === true && current.messages.length >= refreshed.messages.length);
              const merged = {
                ...refreshed,
                messages: reconcileInlineQuestionMessages(preserveInlineQuestionMessages(withRecoveredAssistant(
                  keepLocal ? current.messages : refreshed.messages,
                  refreshed.active === true,
                ), current.messages), refreshed.messages),
              };
              const next = previous.map((session) => (session.id === refreshed.id ? merged : session));
              persistQuartzChatSessions(activeClusterSlug, next);
              return next;
            });
          })
          .catch(() => undefined);
      }
    };
    reconcile();
    const timer = window.setInterval(reconcile, 2_000);
    window.addEventListener('focus', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [activeChatId, activeChatIdsKey, activeClusterSlug]);

  const activeMarkdownContext = activeMarkdown?.content
    ? {
        cluster: activeMarkdown.cluster,
        slug: activeMarkdown.slug,
        title: activeMarkdown.title || activeMarkdown.slug,
        content: activeMarkdown.content,
      }
    : undefined;

  const filteredPrompts = useMemo(() => {
    const q = promptSearch.toLowerCase();
    return prompts.filter((prompt) => {
      const matchCategory = promptCategory === 'All' || prompt.category === promptCategory;
      const matchSearch = !q || prompt.title.toLowerCase().includes(q) || prompt.content.toLowerCase().includes(q);
      return matchCategory && matchSearch;
    });
  }, [promptCategory, promptSearch, prompts]);

  useEffect(() => {
    if (!activeClusterSlug) {
      setStats(EMPTY_STATS);
      return;
    }

    let cancelled = false;

    fetch(`/api/knowledge-graph?clusterSlug=${encodeURIComponent(activeClusterSlug)}&statsOnly=1`)
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json().catch(() => ({}));
        const nextStats = body?.stats;
        if (!cancelled && nextStats) {
          setStats({
            documents: Number(nextStats.documents) || 0,
            topics: Number(nextStats.topics) || 0,
            textbookPages: Number(nextStats.textbookPages ?? nextStats.topics) || 0,
            conceptPages: Number(nextStats.conceptPages) || 0,
            conceptNodes: Number(nextStats.conceptNodes) || 0,
            generatedNotes: Number(nextStats.generatedNotes) || 0,
            links: Number(nextStats.links) || 0,
            words: Number(nextStats.words) || 0,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setStats(EMPTY_STATS);
      });

    return () => {
      cancelled = true;
    };
  }, [activeClusterSlug]);

  const transcriptVirtual = useChatVirtualBridge();
  const composerInset = useComposerInset();
  const {
    ref: transcriptScrollRef,
    awayFromBottom: transcriptAwayFromBottom,
    scrollToBottom: jumpToNewestMessage,
    scrollToMessage,
  } = useChatAutoScroll<HTMLDivElement>({
    isResponding: chatIsStreaming,
    responseKey: chatAutoScrollResponseKey(visibleMessages),
    contentKey: chatAutoScrollContentKey(visibleMessages),
    enabled: chatOpen,
    conversationKey: activeChatId,
    virtual: transcriptVirtual,
  });

  const questionJumpRows = useMemo(() => visibleMessages.map(message => ({ message })), [visibleMessages]);
  useStarredMessageJump({ target: chatQuestionTarget, chatId: activeChatId, loading: !chatOpen,
    rows: questionJumpRows, bridge: transcriptVirtual, scrollRef: transcriptScrollRef, scrollToMessage });

  // Rebuild reader links from durable question metadata when a chat is restored.
  useEffect(() => {
    if (activeChatId === null || !quartzOrigin) return;
    for (const message of messages) {
      const selection = message.textSelection;
      if (message.role !== 'user' || !message.id || selection?.mode !== 'chat' ||
          !selection.sourceMessageId.startsWith('quartz:')) continue;
      quartzIframeRef?.current?.contentWindow?.postMessage({
        type: 'second-brain:assistant-chat-link', highlightId: selection.sourceMessageId.slice(7),
        pageSlug: selection.sourcePageSlug,
        chatLink: { chatId: String(activeChatId), selectionId: selection.id, surface: 'garden' },
      }, quartzOrigin);
    }
  }, [activeChatId, messages, quartzIframeRef, quartzOrigin]);

  useEffect(() => {
    let cancelled = false;
    const openQuestion = async (event: MessageEvent) => {
      if (!quartzOrigin || event.origin !== quartzOrigin || event.source !== quartzIframeRef?.current?.contentWindow ||
          event.data?.type !== 'second-brain:assistant-open-chat') return;
      const link = normalizeQuartzChatLink(event.data.chatLink);
      if (!link || link.surface !== 'garden') return;
      setChatOpen(true);
      setShowHistory(false);
      if (String(activeChatId) === link.chatId) {
        setChatQuestionTarget({ ...link, messageId: '', requestId: Date.now() });
        return;
      }
      if (chatIsStreaming) {
        setAttachmentStatus('Stop the current response before opening another chat.');
        return;
      }
      let selected = chatSessions.find(session => String(session.id) === link.chatId);
      if (!selected && activeClusterSlug) {
        try {
          const query = new URLSearchParams({ clusterSlug: activeClusterSlug, historySurface: 'assistant', sessionId: link.chatId });
          const response = await fetch(`/api/chat-sessions?${query}`, { cache: 'no-store' });
          if (!response.ok) throw new Error('Could not open this question’s chat.');
          const body = await response.json();
          if (cancelled) return;
          selected = body.sessions?.find((session: ChatSession) => String(session.id) === link.chatId);
        } catch {
          if (!cancelled) setAttachmentStatus('Could not open this question’s chat. Try again.');
          return;
        }
      }
      if (selected) {
        setChatSessions(current => current.some(session => session.id === selected!.id) ? current : [...current, selected!]);
        openChatSession(selected);
        setChatQuestionTarget({ ...link, messageId: '', requestId: Date.now() });
      } else setAttachmentStatus('This question’s chat is no longer available.');
    };
    window.addEventListener('message', openQuestion);
    return () => { cancelled = true; window.removeEventListener('message', openQuestion); };
  }, [activeChatId, activeClusterSlug, chatSessions, chatIsStreaming, quartzIframeRef, quartzOrigin]);

  // One tick per question asked. This panel hands the virtualizer `messages`
  // untouched, so a message's place in the conversation is also its row.
  const railItems = useMemo<ChatMessageRailItem[]>(
    () =>
      visibleMessages.flatMap((message, index) =>
        message.role === 'user' ? [{ rowIndex: index, label: message.content }] : [],
      ),
    [visibleMessages],
  );

  // What the composer's arrow keys recall — the same messages the rail ticks,
  // as text rather than as landmarks.
  const sentMessages = useMemo(
    () => visibleMessages.flatMap((message) => (message.role === 'user' ? [message.content] : [])),
    [visibleMessages],
  );

  function updateSessionMessages(sessionId: number, nextMessages: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[]), title?: string) {
    setChatSessions((previous) => {
      const sessions = previous
        .map((session) =>
          session.id === sessionId
            ? {
                ...session,
                title: title ?? session.title,
                messages: typeof nextMessages === 'function' ? nextMessages(session.messages) : preserveInlineQuestionMessages(nextMessages, session.messages),
                updated_at: new Date().toISOString(),
              }
            : session,
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      persistQuartzChatSessions(activeClusterSlug, sessions);
      return sessions;
    });
  }

  function saveBranchGroups(groups: Record<string, ConversationBranchGroup<ChatMessage>>) {
    if (activeChatId === null) return;
    setBranchesByChat((current) => ({ ...current, [activeChatId]: groups }));
    try {
      window.localStorage.setItem(`${QUARTZ_BRANCH_KEY_PREFIX}${activeChatId}`, JSON.stringify(groups));
    } catch { /* Keep the in-memory branches when local storage is unavailable. */ }
  }

  /**
   * Create a real server-side chat session.
   *
   * This previously minted a local `Date.now()` id and stored it only in
   * localStorage. The Hermes garden adapter authorizes the incoming
   * `chatSessionId` against `chat_sessions` for (id, user_id, cluster_id), so a
   * timestamp id could never match a row and every turn failed with
   * `chat_session_not_found` before reaching the runtime. The id must be
   * server-issued for the session to be addressable at all.
   */
  async function createChatSession(
    title = 'New chat',
    // A session created by a turn already has that turn on screen: blanking
    // the transcript here would take the message back off it.
    options: { keepMessages?: boolean; temporary?: boolean } = {},
  ): Promise<ChatSession | null> {
    if (!activeClusterSlug) return null;
    const selectionVersion = chatSelectionVersionRef.current;
    try {
      const response = await fetch('/api/chat-sessions', {
        method: 'POST',
        priority: 'high',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterSlug: activeClusterSlug,
          title,
          historySurface: 'assistant',
          temporary: options.temporary ?? temporaryChat,
        }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { session?: ChatSession };
      const created = body.session;
      if (!created || typeof created.id !== 'number') return null;

      const session: ChatSession = { ...created, isOwn: true, messages: [] };
      if (clusterSlugRef.current !== activeClusterSlug) return session;
      setChatSessions((previous) => {
        const sessions = [session, ...previous.filter((entry) => entry.id !== session.id)].slice(
          0,
          MAX_QUARTZ_CHAT_SESSIONS,
        );
        persistQuartzChatSessions(activeClusterSlug, sessions);
        return sessions;
      });
      if (selectionVersion === chatSelectionVersionRef.current &&
          (!options.keepMessages || activeChatIdRef.current === activeChatId)) {
        chatSelectionVersionRef.current += 1;
        blankChatRequestedRef.current = false;
        if (session.temporary !== true) persistQuartzChatSelection(activeClusterSlug, session.id);
        setActiveChatId(session.id);
        activeChatIdRef.current = session.id;
        setCreatedChatId(session.id);
        if (!options.keepMessages) setMessages([]);
      }
      return session;
    } catch {
      return null;
    }
  }

  /** All questions started from a blank panel share one server-issued chat. */
  async function ensureTurnSession(): Promise<ChatSession | null> {
    if (activeChat?.isOwn !== false && activeChat) return activeChat;
    if (!turnSessionCreationRef.current || turnSessionCreationRef.current.clusterSlug !== activeClusterSlug || turnSessionCreationRef.current.chatId !== activeChatId) {
      turnSessionCreationRef.current = {
        clusterSlug: activeClusterSlug, chatId: activeChatId,
        promise: createChatSession(undefined, { keepMessages: true }),
      };
    }
    const creation = turnSessionCreationRef.current;
    try { return await creation.promise; }
    finally {
      if (turnSessionCreationRef.current === creation) turnSessionCreationRef.current = null;
    }
  }

  async function sendInlineQuestion(
    question: string,
    selection: ChatTextSelectionReference,
    attachments: readonly ChatAttachment[],
    quartzSelection?: QuartzAssistantSelectionRequest,
    voice?: import('@/lib/speech/voice-request').VoiceRequestOptions,
  ) {
    if (!activeClusterSlug) return;
    const clusterSlug = activeClusterSlug;
    const key = `${clusterSlug}:${activeChatId ?? 'new'}:${selection.id}`;
    if ([...inlineQuestionRunsRef.current.values()].some(run => run.clusterSlug === clusterSlug && run.sessionId === activeChatId && run.selectionId === selection.id)) return;
    const run = { clusterSlug, selectionId: selection.id, sessionId: activeChatId, clientMessageId: crypto.randomUUID(), controller: new AbortController(), viewerController: new AbortController(), retired: false };
    const startedAt = new Date().toISOString();
    inlineQuestionRunsRef.current.set(key, run);
    const publishPage = (answer: ChatMessage) => {
      if (!quartzSelection || clusterSlugRef.current !== clusterSlug) return;
      onInlineAnswerUpdate?.({
        requestId: quartzSelection.requestId, highlightId: quartzSelection.highlightId,
        pageSlug: quartzSelection.pageSlug, question, answer: answer.content,
        thinking: answer.thinking,
        progressNotes: delegatedThinkingUpdates(answer),
        state: answer.pending ? (answer.content ? 'streaming' : 'pending') : answer.failed || answer.interrupted ? 'error' : 'complete',
        responseDurationMs: answer.responseDurationMs,
      });
    };
    publishPage({ role: 'assistant', content: '', pending: true });
    try {
      const session = await ensureTurnSession();
      if (!session) throw new Error('Chat history could not be created. Please try again.');
      run.sessionId = session.id;
      await runGardenInlineQuestion({
        sessionId: session.id, clusterSlug, clientMessageId: run.clientMessageId,
        question, selection, quartzSelection, attachments, model, reasoningEffort, ...voice,
        activeMarkdown: activeMarkdownContext,
        superAgent: isSuperAgentEnabled(), yoloMode: isSuperAgentEnabled() || isYoloModeEnabled(),
        adhdMode: isDirectModeEnabled(), personalize: isPersonalizeEnabled(),
        sourceResponse: selectionMessages.find(message => message.id === selection.sourceMessageId)?.content,
        selectedDocumentSlugs: [], signal: run.controller.signal, viewerSignal: run.viewerController.signal,
        publish: pair => {
          if (run.retired || clusterSlugRef.current !== clusterSlug) return;
          updateSessionMessages(session.id, current => preserveInlineQuestionMessages(current, pair));
          if (activeChatIdRef.current === session.id) {
            setMessages(current => preserveInlineQuestionMessages(current, pair));
          }
          publishPage(pair[1]);
        },
      });
    } catch (error) {
      if (run.retired) return;
      const failure = run.controller.signal.aborted ? 'Stopped.'
        : error instanceof Error ? error.message : 'The highlight question could not be saved. Please try again.';
      publishPage({ role: 'assistant', content: failure, failed: true });
      if (clusterSlugRef.current === clusterSlug) {
        // The question was attempted even if storage never acknowledged it.
        // Keep its error at the highlight instead of reverting to the empty
        // "No question has been sent" card after a long connection wait.
        const userMessage: ChatMessage = {
          clientMessageId: run.clientMessageId, role: 'user', content: question,
          createdAt: startedAt, textSelection: selection, selectedText: selection.quote,
          attachments: chatMessageAttachments(attachments), attachmentNames: attachments.map(item => item.name),
          ...(quartzSelection ? { inlineSelection: {
            requestId: quartzSelection.requestId, highlightId: quartzSelection.highlightId, pageSlug: quartzSelection.pageSlug,
          } } : {}),
        };
        const failedMessages: ChatMessage[] = [userMessage, {
          ...userMessage, role: 'assistant', content: failure, pending: false,
          failed: !run.controller.signal.aborted, interrupted: run.controller.signal.aborted,
          responseCompletedAt: new Date().toISOString(),
        }];
        const retainFailure = (current: ChatMessage[]) => preserveInlineQuestionMessages(current, failedMessages);
        if (run.sessionId !== null) updateSessionMessages(run.sessionId, retainFailure);
        if (activeChatIdRef.current === run.sessionId) {
          setMessages(retainFailure);
          setAttachmentStatus(failure);
          setInput(current => current || question);
          setChatAttachments(current => current.length ? current : [...attachments]);
          if (quartzSelection) setSelectedTextContext(current => current ?? quartzSelection);
          else textSelection.restoreComposerSelection(selection);
        }
      }
    } finally {
      if (inlineQuestionRunsRef.current.get(key) === run) inlineQuestionRunsRef.current.delete(key);
    }
  }

  async function stopInlineQuestion(selectionId: string) {
    const run = [...inlineQuestionRunsRef.current.values()].find(candidate =>
      candidate.clusterSlug === activeClusterSlug && candidate.selectionId === selectionId &&
      (candidate.sessionId === activeChatIdRef.current || candidate.sessionId === null),
    );
    const answer = messages.findLast(message => message.role === 'assistant' &&
      (message.textSelection?.id === selectionId || message.inlineSelection?.requestId === selectionId));
    const sessionId = run?.sessionId ?? activeChatId;
    const clientMessageId = run?.clientMessageId ?? answer?.clientMessageId;
    // Stop before creation/checkpoint finishes is remembered by this controller.
    run?.controller.abort();
    if (sessionId !== null && clientMessageId) await abortGardenTurnCheckpoint(sessionId, clientMessageId);
  }

  async function persistChatSession(
    sessionId: number,
    nextMessages: ChatMessage[],
    title?: string,
    options: { updateLocal?: boolean } = {},
  ): Promise<boolean> {
    if (options.updateLocal !== false) {
      updateSessionMessages(sessionId, nextMessages, title);
    }
    const version = (persistenceVersionsRef.current.get(sessionId) ?? 0) + 1;
    persistenceVersionsRef.current.set(sessionId, version);
    const previous = persistenceChainsRef.current.get(sessionId) ?? Promise.resolve(true);
    const write = previous
      .catch(() => false)
      .then(async () => {
        try {
          const response = await fetch(`/api/chat-sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: nextMessages,
              ...(title ? { title } : {}),
            }),
          });
          if (!response.ok) throw new Error('Chat was not saved.');
          // A newer optimistic write owns the visible cache. The serialized
          // request still lands on the server, but this older completion cannot
          // roll the panel back to its snapshot.
          if (options.updateLocal !== false && persistenceVersionsRef.current.get(sessionId) === version) {
            updateSessionMessages(sessionId, nextMessages, title);
          }
          return true;
        } catch {
          setAttachmentStatus('Chat history could not be saved. Please try again.');
          return false;
        }
      });
    persistenceChainsRef.current.set(sessionId, write);
    void write.finally(() => {
      if (persistenceChainsRef.current.get(sessionId) === write) {
        persistenceChainsRef.current.delete(sessionId);
      }
    });
    return write;
  }

  function startNewChat() {
    if (chatIsStreaming || !activeClusterSlug) return;
    // Opening a blank composer must not wait for a network connection. The
    // first turn creates its durable session through ensureTurnSession.
    chatSelectionVersionRef.current += 1;
    blankChatRequestedRef.current = true;
    persistQuartzChatSelection(activeClusterSlug, null);
    turnSessionCreationRef.current = null;
    chatBeforeTemporary.current = null;
    setTemporaryChat(false);
    localTurnRef.current = false;
    setActiveChatId(null);
    activeChatIdRef.current = null;
    setCreatedChatId(null);
    setMessages([]);
    setPermissionRequest(null);
    setSelectedTextContext(null);
    textSelection.clearComposerSelection();
    setChatAttachments([]);
    setAttachmentStatus('');
    setShowHistory(false);
    window.setTimeout(() => composerTextareaRef.current?.focus(), 0);
  }

  function openChatSession(session: ChatSession) {
    if (chatIsStreaming) return;
    chatSelectionVersionRef.current += 1;
    blankChatRequestedRef.current = false;
    persistQuartzChatSelection(activeClusterSlug, session.id);
    chatBeforeTemporary.current = null;
    setTemporaryChat(false);
    localTurnRef.current = false;
    setActiveChatId(session.id);
    activeChatIdRef.current = session.id;
    // An existing chat, so nothing typed in the blank composer belongs to it.
    setCreatedChatId(null);
    setMessages(session.messages ?? []);
    setPermissionRequest(permissionRequestFromMessages(session.messages ?? []));
    setShowHistory(false);
  }

  async function toggleTemporaryChat() {
    if (chatIsStreaming || !activeClusterSlug) return;
    if (temporaryChat) {
      const previous = chatBeforeTemporary.current;
      chatBeforeTemporary.current = null;
      setTemporaryChat(false);
      const saved = previous === null
        ? null
        : chatSessions.find((session) => session.id === previous && session.temporary !== true) ?? null;
      if (saved) openChatSession(saved);
      else await startNewChat();
      return;
    }

    chatBeforeTemporary.current = activeChatId;
    setTemporaryChat(true);
    localTurnRef.current = false;
    const session = await createChatSession(undefined, { temporary: true });
    if (session) {
      setMessages([]);
      setPermissionRequest(null);
      setShowHistory(false);
      return;
    }
    setTemporaryChat(false);
    chatBeforeTemporary.current = null;
  }

  function deleteChatSession(sessionId: number) {
    if (chatIsStreaming) return;
    forgetChatDrafts(window.localStorage, draftSurface, [String(sessionId)]);
    setChatSessions((previous) => {
      const sessions = previous.filter((session) => session.id !== sessionId);
      persistQuartzChatSessions(activeClusterSlug, sessions);
      if (activeChatId === sessionId) {
        persistQuartzChatSelection(activeClusterSlug, sessions[0]?.id ?? null);
        setActiveChatId(sessions[0]?.id ?? null);
        setCreatedChatId(null);
        setMessages(sessions[0]?.messages ?? []);
      }
      return sessions;
    });
  }

  // Applies one queued message to the streaming turn as a course correction.
  // Resolves false when the turn ended first (or could not take it); the
  // message stays queued and sends as an ordinary follow-up when the queue
  // drains.
  async function steerActiveResponse(
    text: string,
    attachments: readonly ChatAttachment[],
    selection?: ChatTextSelectionReference,
  ): Promise<boolean> {
    const correction = text.trim() || attachmentOnlyMessageText(attachments);
    const context = activeSteerContextRef.current;
    if (!correction) return false;
    if (agentActivity.pendingClarification && attachments.length === 0 && !selection) {
      return agentActivity.respondToClarification(correction);
    }

    let accepted = false;
    try {
      accepted = await agentActivity.steer(correction, attachments, selection);
    } catch {
      return false;
    }
    if (!accepted) return false;
    // The server persists a restored turn's correction; the history poll brings it in.
    if (!context || activeSteerContextRef.current !== context) return true;

    const correctionMessage: ChatMessage = {
      role: 'user',
      content: correction,
      ...(selection ? { textSelection: selection } : {}),
      createdAt: new Date().toISOString(),
      ...(attachments.length > 0
        ? {
            attachmentNames: attachments.map((attachment) => attachment.name),
            attachments: chatMessageAttachments(attachments),
          }
        : {}),
    };
    context.messages.push(correctionMessage);
    setMessages((current) => {
      let pendingAssistantIndex = current.length - 1;
      while (pendingAssistantIndex >= 0 && current[pendingAssistantIndex]?.role !== 'assistant') {
        pendingAssistantIndex -= 1;
      }
      if (pendingAssistantIndex < 0) return [...current, correctionMessage];
      return [...current.slice(0, pendingAssistantIndex), correctionMessage, ...current.slice(pendingAssistantIndex)];
    });
    return true;
  }

  async function sendMessage(
    textOverride?: string,
    historyOverride?: ChatMessage[],
    attachmentOverride?: readonly ChatAttachment[],
    selectedTextOverride?: string,
    selectionContextOverride?: QuartzAssistantSelectionRequest,
    textSelectionOverride?: ChatTextSelectionReference,
    branchSource?: ChatMessage,
    voice?: import('@/lib/speech/voice-request').VoiceRequestOptions,
  ) {
    const text = (textOverride ?? input).trim();
    const responseSelection = textSelectionOverride ?? (textOverride === undefined ? textSelection.composerSelection ?? undefined : undefined);
    const selectionContext =
      responseSelection ? {
        requestId: responseSelection.id, highlightId: responseSelection.id, mode: responseSelection.mode,
        text: responseSelection.quote, prefix: responseSelection.prefix, suffix: responseSelection.suffix,
        sourceMessageId: responseSelection.sourceMessageId,
        sourceResponse: selectionMessages.find(message => message.id === responseSelection.sourceMessageId)?.content,
      } : selectionContextOverride ?? (textOverride === undefined ? (selectedTextContext ?? undefined) : undefined);
    const selectedText = (selectedTextOverride ?? selectionContext?.text)?.slice(0, 4_000);
    const pendingAttachments: ChatAttachment[] = attachmentOverride
      ? [...attachmentOverride]
      : textOverride === undefined
        ? chatAttachments
        : [];
    if (text && agentActivity.pendingClarification && !responseSelection && pendingAttachments.length === 0) {
      const answered = await agentActivity.respondToClarification(text);
      if (answered && textOverride === undefined) setInput(current => current.trim() === text ? '' : current);
      return;
    }
    const superAgentEnabled = isSuperAgentEnabled();
    const yoloModeEnabled = superAgentEnabled || isYoloModeEnabled();
    if (text && selectionContext?.mode === 'inline' && !messageMutationPendingRef.current && activeClusterSlug) {
      const selection = responseSelection ?? {
        id: selectionContext.requestId, mode: 'inline' as const,
        sourceMessageId: `quartz:${selectionContext.highlightId}`,
        start: 0, end: selectionContext.text.length, quote: selectionContext.text,
        prefix: selectionContext.prefix, suffix: selectionContext.suffix,
      };
      if (textOverride === undefined) {
        setInput('');
        setChatAttachments([]);
        textSelection.clearComposerSelection();
        setSelectedTextContext(null);
      }
      await sendInlineQuestion(text, selection, pendingAttachments, responseSelection ? undefined : selectionContext, voice);
      return;
    }
    if ((!text && pendingAttachments.length === 0) || chatIsStreaming || messageMutationPendingRef.current || !activeClusterSlug) return;

    const history = historyOverride ?? messages;
    const branchSourceIndex = branchSource ? messages.indexOf(branchSource) : -1;
    const branch = branchSourceIndex >= 0 ? createConversationBranch<ChatMessage>({
      messages,
      branchGroups,
      userMessageIndex: branchSourceIndex,
      content: text,
      createId: () => crypto.randomUUID(),
      createAssistantPlaceholder: (seed) => ({ ...seed, role: 'assistant', content: '', sources: [] }),
    }) : null;
    if (branch) saveBranchGroups({ ...branchGroups, [branch.groupId]: branch.group });
    const attachmentNames = pendingAttachments.map((attachment) => attachment.name);
    const displayText = text || 'Please review the attached document(s).';
    const turnCreatedAt = new Date().toISOString();
    const clientMessageId = crypto.randomUUID();
    const chatSelection = responseSelection ?? (selectionContext?.mode === 'chat' ? {
      id: selectionContext.requestId, mode: 'chat' as const,
      sourceMessageId: `quartz:${selectionContext.highlightId}`,
      sourcePageSlug: selectionContext.pageSlug,
      start: 0, end: selectionContext.text.length, quote: selectionContext.text,
      prefix: selectionContext.prefix, suffix: selectionContext.suffix,
    } : undefined);
    const userMessage: ChatMessage = {
      clientMessageId,
      ...(branch ? { branchGroupId: branch.groupId } : {}),
      role: 'user',
      content: displayText,
      createdAt: turnCreatedAt,
      attachmentNames,
      attachments: chatMessageAttachments(pendingAttachments),
      ...(selectedText ? { selectedText } : {}),
      ...(chatSelection ? { textSelection: chatSelection } : {}),
    };
    const nextMessages = [...history, userMessage];
    // Corrections steered into this turn land here, between the turn's user
    // message and its pending assistant answer, so every transcript assembly
    // below keeps them.
    const steerContext = { messages: [] as ChatMessage[] };
    activeSteerContextRef.current = steerContext;
    let assistantMessage: ChatMessage = {
      clientMessageId,
      ...(branch ? { branchGroupId: branch.groupId } : {}),
      role: 'assistant',
      content: '',
      createdAt: turnCreatedAt,
      sources: [],
      ...(chatSelection ? { textSelection: chatSelection } : {}),
    };
    const responseStartedAt = performance.now();

    // Everything below needs a chat row, and on a fresh chat that is a round
    // trip to the server. The message goes up first: what was typed appears
    // the moment it is sent, not when the server has somewhere to keep it.
    localTurnRef.current = true;
    setInput('');
    if (textOverride === undefined) textSelection.clearComposerSelection();
    if (textOverride === undefined && selectedTextContext) {
      setSelectedTextContext(null);
    }
    setChatAttachments([]);
    setAttachmentStatus('');
    setIsStreaming(true);
    setMessages(current => preserveInlineQuestionMessages([...nextMessages, assistantMessage], current));
    // Thinking belongs to the turn, not to the request that answers it, so it
    // is raised here rather than once there is a chat row to send against.
    const turnSignal = agentActivity.start(viewingConversationId);
    let activityStarted = true;

    let session = activeChat;
    let sessionTitle: string | undefined;
    if (!session || session.isOwn === false) {
      session = await ensureTurnSession();
      if (!session) {
        const creationError = 'I could not create this chat yet. Please try again.';
        setMessages([
          ...nextMessages,
          {
            ...assistantMessage,
            content: creationError,
            failed: true,
          },
        ]);
        agentActivity.finish(true, turnSignal);
        activityStarted = false;
        setIsStreaming(false);
        localTurnRef.current = false;
        if (activeSteerContextRef.current === steerContext) {
          activeSteerContextRef.current = null;
        }
        return;
      }
    }

    // Bind before checkpoint I/O so the newly selected chat cannot mistake
    // its own first local turn for a stale stream from a different chat.
    agentActivity.bindSession(session.conversationId ?? session.id);
    updateSessionMessages(session.id, [...nextMessages, assistantMessage], sessionTitle);

    // Reserve the question and its pending answer atomically. This happens
    // before local markdown work and runtime dispatch alike, so every Garden
    // agent has a terminalizable turn after a service restart.
    let checkpointSaved = false;
    try {
      const checkpoint = await reserveGardenTurnCheckpoint(session.id, clientMessageId, userMessage);
      agentActivity.bindSession(checkpoint.conversationId ?? session.conversationId ?? null);
      userMessage.id = checkpoint.userMessageId;
      assistantMessage.id = checkpoint.assistantMessageId;
      if (chatSelection?.sourceMessageId.startsWith('quartz:') && quartzOrigin) {
        quartzIframeRef?.current?.contentWindow?.postMessage({
          type: 'second-brain:assistant-chat-link', highlightId: chatSelection.sourceMessageId.slice(7),
          pageSlug: chatSelection.sourcePageSlug,
          chatLink: { chatId: String(session.id), selectionId: chatSelection.id, surface: 'garden' },
        }, quartzOrigin);
      }
      checkpointSaved = true;
    } catch {
      checkpointSaved = false;
    }
    if (!checkpointSaved) {
      setMessages(current => preserveInlineQuestionMessages(branch ? messages : history, current));
      if (branch) {
        saveBranchGroups(branchGroups);
        updateSessionMessages(session.id, messages);
      }
      setInput(text);
      if (responseSelection) textSelection.restoreComposerSelection(responseSelection);
      setChatAttachments(pendingAttachments);
      agentActivity.finish(true, turnSignal);
      activityStarted = false;
      setIsStreaming(false);
      localTurnRef.current = false;
      if (activeSteerContextRef.current === steerContext) {
        activeSteerContextRef.current = null;
      }
      return;
    }

    let agentFailed = false;
    let pendingApproval: PermissionRequest | null = null;
    const viewerAbort = new AbortController();
    const viewerSignal = AbortSignal.any([turnSignal, viewerAbort.signal]);
    const recovered: { session: ChatSession | null } = { session: null };
    try {
      if (turnSignal.aborted) {
        await abortGardenTurnCheckpoint(session.id, clientMessageId);
        turnSignal.throwIfAborted();
      }
      if (activeMarkdown && !selectedText && wantsOpenMarkdownEdit(text) && pendingAttachments.length === 0) {
        const response = await fetch('/api/markdown-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: turnSignal,
          body: JSON.stringify({
            clusterSlug: activeMarkdown.cluster || activeClusterSlug,
            slug: activeMarkdown.slug,
            instruction: text,
            messages: nextMessages.map(({ role, content }) => ({ role, content })).slice(-8),
            model,
            thinking: reasoningEffort !== 'none',
          }),
        });
        const body = await response.json().catch(() => ({}));
        turnSignal.throwIfAborted();
        if (!response.ok || !body.success) {
          throw new Error(typeof body.error === 'string' ? body.error : 'Markdown edit failed');
        }
        const title =
          typeof body.title === 'string' && body.title.trim()
            ? body.title.trim()
            : activeMarkdown.title || activeMarkdown.slug;
        const slug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : activeMarkdown.slug;
        const content = typeof body.content === 'string' ? body.content : activeMarkdown.content;
        const summary =
          typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : 'Updated the open page.';
        const tags = Array.isArray(body.tags)
          ? body.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
          : [];
        const normalizedUsage = normalizeChatTokenUsage(body.usage);
        const usage = normalizedUsage
          ? {
              ...normalizedUsage,
              responseDurationMs: Math.round(performance.now() - responseStartedAt),
            }
          : null;
        assistantMessage = {
          ...assistantMessage,
          role: 'assistant',
          createdAt: turnCreatedAt,
          content: [
            `${summary}`,
            '',
            `Saved changes to **${title}**.`,
            tags.length > 0 ? `Tags now: ${tags.map((tag: string) => `\`${tag}\``).join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          sources: [title || slug],
          ...(usage ? { usage } : {}),
          responseDurationMs: Math.round(performance.now() - responseStartedAt),
        };
        const finalMessages = [...nextMessages, ...steerContext.messages, assistantMessage];
        setMessages(current => preserveInlineQuestionMessages(finalMessages, current));
        await persistChatSession(session.id, finalMessages, sessionTitle);
        window.dispatchEvent(
          new CustomEvent('sb:markdown-updated', {
            detail: {
              cluster: activeMarkdown.cluster || activeClusterSlug,
              slug,
              title,
              content,
            },
          }),
        );
        return;
      }

      const signal = viewerSignal;
      turnObserverRef.current = {
        sessionId: session.id,
        clientMessageId,
        recover: durable => {
          recovered.session = durable;
          localTurnRef.current = false;
          // Retire this HTTP viewer only. The durable run already finished;
          // do not send Stop or overwrite its saved answer with local text.
          viewerAbort.abort();
        },
      };
      const response = await fetchGardenChat(session.id, clientMessageId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterSlug: activeClusterSlug,
          chatSessionId: session.id,
          clientMessageId,
          messages: nextMessages.map(({ role, content }) => ({
            role,
            content,
          })),
          model: voice?.model ?? model,
          reasoningEffort: voice?.reasoningEffort ?? reasoningEffort,
          browserAccess: voice?.browserAccess,
          voice: voice?.voice,
          voiceOpener: voice?.voiceOpener,
          attachments: pendingAttachments,
          activeMarkdown: activeMarkdownContext,
          selectedText,
          selectedTextContext: selectionContext,
          superAgent: superAgentEnabled,
          yoloMode: yoloModeEnabled,
          adhdMode: isDirectModeEnabled(),
          personalize: isPersonalizeEnabled(),
        }),
        signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : 'Assistant request failed');
      }

      if (response.headers.get('X-Breadboard-AI-Fallback') === '1') {
        assistantMessage = {
          ...assistantMessage,
          thinking: "The assistant is unavailable. Continuing in basic chat.\n",
        };
      }

      const updateAssistant = () => {
        setMessages(current => preserveInlineQuestionMessages([...nextMessages, ...steerContext.messages, { ...assistantMessage }], current));
      };

      for await (const payload of readGardenResponseData(response.body, signal)) {
        if (!payload || payload === '[DONE]') continue;
        let event;
        try { event = JSON.parse(payload); }
        catch { continue; }
        agentActivity.handleEvent(event as Record<string, unknown>, turnSignal);
        if (event.type === 'tool' && event.status === 'completed' && event.toolName === 'garden_import_source') {
          handleGardenSourceImportResult(event.details);
        }
        if (event.type === 'tool' && event.status === 'completed') {
          const resources = normalizeGenerativeUiResources(event.uiResources);
          if (resources.length) {
            assistantMessage = {
              ...assistantMessage,
              uiResources: [
                ...(assistantMessage.uiResources ?? []).filter(current => !resources.some(next => next.id === current.id)),
                ...resources,
              ],
            };
            updateAssistant();
          }
        }
        if (event.type === 'sources' && Array.isArray(event.sources)) {
          assistantMessage = {
            ...assistantMessage,
            sources: Array.from(new Set(event.sources.filter((source: unknown) => typeof source === 'string'))),
          };
          updateAssistant();
        }
        if (event.type === 'error') {
          throw new Error(typeof event.error === 'string' ? event.error :
            typeof event.payload?.message === 'string' ? event.payload.message : 'The assistant could not finish this response.');
        }
        if (event.type === 'runtime' && event.fallback) {
          assistantMessage = {
            ...assistantMessage,
            thinking: `${assistantMessage.thinking ?? ''}\nHermes unavailable — using the visible preferred-mode ChatMock fallback.`,
          };
          updateAssistant();
        }
        if (event.type === 'thinking' && typeof event.text === 'string') {
          assistantMessage = applyGardenStableTextEvent(assistantMessage, {
            type: 'thinking',
            text: event.text,
            detailMode: event.detailMode,
          });
          updateAssistant();
        }
        if (event.type === 'delta' && typeof event.text === 'string') {
          assistantMessage = applyGardenStableTextEvent(assistantMessage, {
            type: 'delta',
            text: event.text,
          });
          updateAssistant();
        }
        if (event.type === 'provisional' && typeof event.text === 'string') {
          assistantMessage = applyGardenStableTextEvent(assistantMessage, {
            type: 'provisional',
            text: event.text,
          });
          updateAssistant();
        }
        if (event.type === 'replace' && typeof event.text === 'string') {
          assistantMessage = applyGardenStableTextEvent(assistantMessage, {
            type: 'replace',
            text: event.text,
          });
          updateAssistant();
        }
        if (event.type === 'segment' && typeof event.text === 'string') {
          assistantMessage = applyGardenStableTextEvent(assistantMessage, {
            type: 'segment',
            text: event.text,
            streamed: event.streamed === true,
          });
          updateAssistant();
        }
        if (event.type === 'usage') {
          const usage = normalizeChatTokenUsage(event.usage);
          if (usage) {
            assistantMessage = {
              ...assistantMessage,
              usage: {
                ...usage,
                responseDurationMs: Math.round(performance.now() - responseStartedAt),
              },
            };
            updateAssistant();
          }
        }
        if (event.type === 'verification' && event.verification) {
          assistantMessage = {
            ...assistantMessage,
            verification: event.verification as VerificationSummary,
          };
          updateAssistant();
        }
        if (event.type === 'plan' && typeof event.intendedOutcome === 'string') {
          // Show the identified goal while work is in flight, so a
          // multi-step task reads as active work rather than a stall.
          assistantMessage = {
            ...assistantMessage,
            thinking: `${assistantMessage.thinking ?? ''}\n${event.intendedOutcome}`.trim(),
          };
          updateAssistant();
        }
        if (event.type === 'permission' && event.kind === 'filesystem') {
          // A missing grant is a request, not a refusal. Capture it so the
          // user can approve inline; `text` is retained so the same task
          // resumes without the user retyping it.
          pendingApproval = {
            requestId: String(event.requestId ?? ''),
            message: String(event.message ?? 'Additional access is required.'),
            path: typeof event.path === 'string' ? event.path : undefined,
            operations: Array.isArray(event.operations) ? (event.operations as string[]) : [],
            originalText: text,
            history,
            attachments: pendingAttachments,
            selectedText,
            selectionContext,
            textSelection: responseSelection,
          };
        }
        if (event.type === 'blocked' && pendingApproval) {
          setPermissionRequest(pendingApproval);
          assistantMessage = {
            ...assistantMessage,
            content: assistantMessage.content || pendingApproval.message,
          };
          updateAssistant();
        }
      }
      assistantMessage = {
        ...assistantMessage,
        responseDurationMs: Math.round(performance.now() - responseStartedAt),
        responseCompletedAt: new Date().toISOString(),
      };
      if (pendingApproval) {
        // The adapter already persisted this as an awaiting-permission turn.
        // Keep the optimistic transcript/card, but do not PATCH the blank
        // assistant into a completed canonical answer.
        const pausedMessages = [...nextMessages, ...steerContext.messages, assistantMessage];
        setMessages(current => preserveInlineQuestionMessages(pausedMessages, current));
        updateSessionMessages(session.id, pausedMessages, sessionTitle);
        return;
      }
      const finalMessages = [...nextMessages, ...steerContext.messages, assistantMessage];
      setMessages(current => preserveInlineQuestionMessages(finalMessages, current));
      await persistChatSession(session.id, finalMessages, sessionTitle);
    } catch (error) {
      if (recovered.session) {
        const durable = recovered.session;
        agentFailed = durable.messages.some(message => message.clientMessageId === clientMessageId && (message.failed || message.interrupted));
        setMessages(current => preserveInlineQuestionMessages(durable.messages, current));
        updateSessionMessages(durable.id, durable.messages, durable.title);
        return;
      }
      const aborted = error instanceof Error && error.name === 'AbortError';
      agentFailed = !aborted;
      const message = aborted
        ? 'The request was stopped.'
        : error instanceof Error
          ? error.message
          : 'Assistant could not answer right now';
      const failureAnswer = aborted
        ? 'The request was stopped.'
        : [assistantMessage.content, message].filter(Boolean).join('\n\n');
      const finalMessages: ChatMessage[] = [
        ...nextMessages,
        ...steerContext.messages,
        {
          ...assistantMessage,
          role: 'assistant',
          createdAt: turnCreatedAt,
          content: failureAnswer,
          pending: false,
          failed: !aborted,
          interrupted: aborted,
          sources: [],
          responseDurationMs: Math.round(performance.now() - responseStartedAt),
          responseCompletedAt: new Date().toISOString(),
        },
      ];
      setMessages(current => preserveInlineQuestionMessages(finalMessages, current));
      await persistChatSession(session.id, finalMessages, sessionTitle);
    } finally {
      if (turnObserverRef.current?.clientMessageId === clientMessageId) turnObserverRef.current = null;
      viewerAbort.abort();
      if (activityStarted) agentActivity.finish(agentFailed, turnSignal);
      if (activeSteerContextRef.current === steerContext) {
        activeSteerContextRef.current = null;
      }
      setIsStreaming(false);
      // The transcript this turn wrote has been persisted, so the session row
      // is authoritative again and may sync into the view.
      localTurnRef.current = false;
    }
  }

  /**
   * Approve the folder the server asked for, then resume the original task.
   *
   * The grant is created server-side (which canonicalizes the path, verifies it
   * exists, and resolves symlinks); only the operations the paused turn actually
   * needed are requested, so approving a read never confers write. On success
   * the stored request is re-dispatched automatically.
   */
  async function approvePermission(request: PermissionRequest, scope: 'remembered' | 'one_time') {
    if (approvingPermission || !request.path) return;
    setApprovingPermission(true);
    let oneTimeGrantId: string | null = null;
    try {
      const permissions = Object.fromEntries(request.operations.map((operation) => [operation, true]));
      const response = await fetch('/api/hermes/filesystem-grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: request.path, permissions, scope }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: typeof body.message === 'string' ? body.message : 'That folder could not be approved.',
            sources: [],
          },
        ]);
        return;
      }
      if (scope === 'one_time' && body.grant && typeof body.grant.id === 'string') {
        oneTimeGrantId = body.grant.id;
      }
      setPermissionRequest(null);
      // Resume the same task. The user does not restate it.
      await sendMessage(
        request.originalText,
        request.history,
        request.attachments,
        request.selectedText,
        request.selectionContext,
        request.textSelection,
      );
    } finally {
      if (oneTimeGrantId) {
        await fetch(`/api/hermes/filesystem-grants?id=${encodeURIComponent(oneTimeGrantId)}`, {
          method: 'DELETE',
        }).catch(() => undefined);
      }
      setApprovingPermission(false);
    }
  }

  async function addAttachmentFiles(files: File[]) {
    if (files.length === 0) return;
    const preparation = beginAttachmentPreparation();
    let errors: string[] = [];
    setAttachmentStatus('');
    try {
      const result = await extractChatAttachments(files, {
        onStatus: status => { if (preparation.isCurrent()) setAttachmentStatus(status); },
      });
      errors = result.errors;
      if (!preparation.isCurrent()) return;
      setChatAttachments(current => [...current, ...result.attachments]);
      setAttachmentStatus([...result.errors, ...result.warnings].join(' · '));
      void distillAttachments(result.attachments).catch(() => undefined);
    } catch (cause) {
      errors = [cause instanceof Error ? cause.message : 'Could not attach the files.'];
      if (preparation.isCurrent()) setAttachmentStatus(errors.join(' · '));
    } finally {
      preparation.finish(errors);
    }
  }

  function handleAttachmentInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void addAttachmentFiles(files);
  }

  function retryAssistantMessage(messageIndex: number) {
    if (chatIsStreaming) return;
    let userIndex = messageIndex - 1;
    while (userIndex >= 0 && messages[userIndex]?.role !== 'user') userIndex -= 1;
    const previousUser = messages[userIndex];
    if (!previousUser || previousUser.role !== 'user') return;
    void sendMessage(
      previousUser.content,
      messages.slice(0, userIndex),
      reusableChatAttachments(previousUser.attachments),
      previousUser.selectedText,
      previousUser.inlineSelection && previousUser.selectedText
        ? { ...previousUser.inlineSelection, requestId: crypto.randomUUID(), mode: 'inline', text: previousUser.selectedText }
        : undefined,
      previousUser.textSelection,
      previousUser,
    );
  }

  function editUserMessage(message: ChatMessage, text: string) {
    const index = messages.indexOf(message);
    if (chatIsStreaming || activeChat?.isOwn === false || index < 0 || message.role !== 'user') return;
    void sendMessage(text, messages.slice(0, index), reusableChatAttachments(message.attachments),
      message.selectedText, undefined, message.textSelection, message);
  }

  async function deleteUserMessage(message: ChatMessage) {
    const index = messages.indexOf(message);
    if (chatIsStreaming || messageMutationPendingRef.current || !activeChat || activeChat.isOwn === false || index < 0 || message.role !== 'user') return;
    let end = index + 1;
    while (end < messages.length && (messages[end].role === 'assistant' || isClarificationAnswerMessage(messages[end]))) end += 1;
    const nextMessages = [...messages.slice(0, index), ...messages.slice(end)];
    messageMutationPendingRef.current = true;
    setUpdatingMessages(true);
    try {
      if (!await persistChatSession(activeChat.id, nextMessages, undefined, { updateLocal: false })) return;
      updateSessionMessages(activeChat.id, nextMessages);
      setMessages((current) => current === messages ? nextMessages : current);
      // Variant snapshots include the transcript; discard them after a deletion
      // so a later branch switch cannot restore the removed exchange.
      saveBranchGroups({});
    } finally {
      messageMutationPendingRef.current = false;
      setUpdatingMessages(false);
    }
  }

  function switchBranch(groupId: string, direction: -1 | 1) {
    const group = branchGroups[groupId];
    if (chatIsStreaming || messageMutationPendingRef.current || !activeChat || activeChat.isOwn === false || !group) return;
    const activeIndex = group.activeIndex + direction;
    if (activeIndex < 0 || activeIndex >= group.variants.length) return;
    const variants = group.variants.map((variant, index) => index === group.activeIndex ? cloneMessages(messages) : variant);
    const nextMessages = applyBranchVariant({ messages, variant: variants[activeIndex], groupId });
    saveBranchGroups({ ...branchGroups, [groupId]: { ...group, activeIndex, variants } });
    setMessages(nextMessages);
    void persistChatSession(activeChat.id, nextMessages);
  }

  // Ownership stays with the chat's activity layer, not with the row: the
  // newest answer's panel unmounts whenever it is scrolled out of view, and
  // rebuilds from this state when it comes back.
  const respondToPermission = agentActivity.respondToPermission;
  const handlePermissionDecision = useCallback<NonNullable<AgentActivityProps['onPermissionDecision']>>(
    (decision) => {
      void respondToPermission(decision);
    },
    [respondToPermission],
  );
  const respondToClarification = agentActivity.respondToClarification;
  const handleClarificationAnswer = useCallback(
    (answer: string) => {
      void respondToClarification(answer);
    },
    [respondToClarification],
  );

  const widgetSendRef = useRef(sendMessage);
  useEffect(() => { widgetSendRef.current = sendMessage; });
  const sendWidgetMessage = useCallback((text: string) => { void widgetSendRef.current(text); }, []);
  const userMessageActionsRef = useRef({ editUserMessage, deleteUserMessage });
  useEffect(() => { userMessageActionsRef.current = { editUserMessage, deleteUserMessage }; });
  const handleEditUserMessage = useCallback((message: ChatMessage, text: string) => {
    userMessageActionsRef.current.editUserMessage(message, text);
  }, []);
  const handleDeleteUserMessage = useCallback((message: ChatMessage) => {
    void userMessageActionsRef.current.deleteUserMessage(message);
  }, []);

  const renderTranscriptRow = useCallback(
    (message: ChatMessage, index: number) => {
      const isNewest = index === visibleMessages.length - 1;
      const storedIndex = messages.indexOf(message);
      const userIndex = message.role === 'assistant' ? previousUserMessageIndex(messages, storedIndex) : -1;
      const groupId = userIndex >= 0 ? messageBranchId(messages[userIndex], userIndex) : null;
      const group = groupId ? branchGroups[groupId] : undefined;
      const paced =
        isNewest &&
        message.role === 'assistant' &&
        !naturalRewriteFor(message) && !messageRewriteReview(message) &&
        revealedAssistantContent !== gardenAssistantVisibleContent(message);
      return (
        <>
        <TranscriptRow
          naturalRewrite={naturalRewriteFor(message)}
          message={paced ? { ...message, content: revealedAssistantContent } : message}
          userRequest={messages.slice(0, storedIndex).findLast(item => item.role === 'user')?.content ?? ''}
          chatSessionId={activeChatId}
          conversationId={starConversationId}
          canStar={canStar}
          sourceMessageId={gardenSelectionMessageId(message, storedIndex)}
          annotations={textSelection.annotations.get(gardenSelectionMessageId(message, storedIndex)) ?? NO_TEXT_ANNOTATIONS}
          onTextSelection={textSelection.receiveSelection}
          onOpenAnnotation={textSelection.openAnnotation}
          onSend={sendWidgetMessage}
          messageKey={chatRowKey(message, index)}
          separatorLabel={timeSeparators[index] ?? null}
          activities={isNewest ? agentActivity.activities : NO_ACTIVITIES}
          connection={isNewest ? visibleAgentConnection : 'idle'}
          pendingPermission={isNewest ? agentActivity.pendingPermission : null}
          onPermissionDecision={handlePermissionDecision}
          pendingClarification={isNewest ? agentActivity.pendingClarification : null}
          onClarificationAnswer={handleClarificationAnswer}
          showActions={!(chatIsStreaming && isNewest)}
          onRetry={isNewest && storedIndex >= 0 ? () => retryAssistantMessage(storedIndex) : undefined}
          userActionsDisabled={chatIsStreaming || updatingMessages || activeChat?.isOwn === false}
          onEditUserMessage={handleEditUserMessage}
          onDeleteUserMessage={handleDeleteUserMessage}
          branch={!chatIsStreaming && !updatingMessages && group && group.variants.length > 1 ? {
            current: group.activeIndex + 1,
            total: group.variants.length,
            onPrevious: () => switchBranch(group.id, -1),
            onNext: () => switchBranch(group.id, 1),
          } : undefined}
        />
        <ChatModelChangeSeparators labels={modelChangesFor(message, index)} visible={!(chatIsStreaming && isNewest)} />
        </>
      );
    },
    // `retryAssistantMessage` is re-declared every render and is reachable only
    // from the newest row, which re-renders anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      messages,
      modelChangesFor,
      visibleMessages.length,
      naturalRewriteFor,
      activeChatId,
      activeChat?.isOwn,
      starConversationId,
      canStar,
      branchGroups,
      updatingMessages,
      handleEditUserMessage,
      handleDeleteUserMessage,
      sendWidgetMessage,
      timeSeparators,
      agentActivity.activities,
      visibleAgentConnection,
      agentActivity.pendingPermission,
      agentActivity.pendingClarification,
      handleClarificationAnswer,
      handlePermissionDecision,
      chatIsStreaming,
      revealedAssistantContent,
      textSelection.annotations,
      textSelection.receiveSelection,
      textSelection.openAnnotation,
    ],
  );

  function handlePanelResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();

    resizeStartRef.current = {
      startX: event.clientX,
      startWidth: panelWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    document.body.style.cursor = 'var(--bb-cursor-col-resize, col-resize)';
    document.body.style.userSelect = 'none';
  }

  function handlePanelResizeMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const resizeStart = resizeStartRef.current;
    if (!resizeStart) return;

    setPanelWidth(clampPanelWidth(resizeStart.startWidth + resizeStart.startX - event.clientX));
  }

  function handlePanelResizeEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  function applyPrompt(prompt: SavedPrompt) {
    setInput(prompt.content);
    setShowPrompts(false);
  }

  function openNewPrompt() {
    setEditingPrompt({ id: '', title: '', content: '', category: 'Custom' });
    setShowPrompts(false);
  }

  function openEditPrompt(prompt: SavedPrompt) {
    setEditingPrompt({ ...prompt });
    setShowPrompts(false);
  }

  function savePrompt(prompt: SavedPrompt) {
    const next = prompt.id ? { ...prompt } : { ...prompt, id: `user-${Date.now()}`, isDefault: false };
    const updated = prompt.id ? prompts.map((item) => (item.id === next.id ? next : item)) : [next, ...prompts];
    setPrompts(updated);
    persistPrompts(updated);
    setEditingPrompt(null);
  }

  function deletePrompt(id: string) {
    const updated = prompts.filter((prompt) => prompt.id !== id);
    setPrompts(updated);
    persistPrompts(updated);
  }

  const chatPanelStyle = {
    '--assistant-panel-width': `${panelWidth}px`,
    ...composerInset.style,
  } as CSSProperties;
  const newChatPageSelected =
    !chatIsStreaming && messages.length === 0 && activeChat?.isOwn !== false;
  const recommendations = useRecommendations({
    gardenSlug: activeClusterSlug, pageTitle: activeMarkdown?.title,
    temporary: temporaryChat, enabled: chatOpen && newChatPageSelected && hasActiveCluster,
  });
  const historySessions = chatSessions.filter(
    (session) => session.temporary !== true,
  );
  const resizeHandleStyle = {
    right: panelWidth,
  } as CSSProperties;

  const chatPanel = (
    <aside
      data-garden-assistant-panel
      className="neu-surface-raised fixed inset-x-3 bottom-3 top-20 z-40 flex flex-col overflow-hidden rounded-md border border-gray-800 bg-gray-900 text-gray-100 lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:w-[var(--assistant-panel-width)] lg:rounded-none lg:border-y-0 lg:border-l lg:border-r-0"
      style={chatPanelStyle}
      data-temporary-chat={temporaryChat ? 'true' : undefined}
    >
      <div className="border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">Assistant</p>
            <p className="truncate text-xs text-gray-400">
              {hasActiveCluster ? `${clusterLabel} Learning Map` : 'Open a garden or page to ask its map'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="neu-button rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition hover:border-gray-500 hover:text-white"
            >
              Hide
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] text-gray-400">
          {[
            { label: 'Sources', value: stats.documents },
            { label: 'Lessons', value: stats.textbookPages },
            { label: 'Concepts', value: stats.conceptPages },
            { label: 'Connections', value: stats.links },
          ].map((item) => (
            <div key={item.label} className="neu-inset rounded-md border border-gray-800 bg-gray-950/60 px-2 py-1.5">
              <div className="font-medium text-gray-100">{formatNumber(item.value)}</div>
              <div>{item.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-gray-900 pt-2">
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            disabled={!activeClusterSlug}
            className="neu-button-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-800 text-gray-500 transition hover:border-gray-700 hover:text-gray-300"
            title="Chat history"
            aria-label="Chat history"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.75A8.25 8.25 0 1 1 6.4 15.8" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25v4.5h4.5" />
            </svg>
          </button>
        </div>
      </div>

      {temporaryChat ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-emerald-800/50 bg-emerald-950/30 px-4 py-2 text-[11px] text-emerald-300"
        >
          <svg
            className="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path
              strokeDasharray="3.6 3"
              d="M20.25 12a8.25 8.25 0 01-11.9 7.4L4 20.5l1.16-4.2A8.25 8.25 0 1120.25 12z"
            />
          </svg>
          <strong className="font-semibold">Temporary chat enabled</strong>
        </div>
      ) : null}

      {/* Positioning context for the jump control, so it floats at the foot of
          the transcript rather than below the composer. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {newChatPageSelected ? (
          <button
            type="button"
            onClick={() => void toggleTemporaryChat()}
            disabled={chatIsStreaming || !activeClusterSlug}
            aria-pressed={temporaryChat}
            className={`absolute right-3 top-2 z-20 flex h-10 w-10 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              temporaryChat
                ? 'text-emerald-300'
                : 'text-gray-500 hover:text-gray-200'
            }`}
            title={
              temporaryChat
                ? 'Temporary chat is on — click to return. This chat is not in your history and is not used or saved as memory.'
                : "Temporary chats stay out of your history and don’t use or save memory."
            }
            aria-label={temporaryChat ? 'Turn off temporary chat' : 'Turn on temporary chat'}
          >
            <svg
              className="h-[26px] w-[26px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path
                strokeDasharray="3.6 3"
                d="M20.25 12a8.25 8.25 0 01-11.9 7.4L4 20.5l1.16-4.2A8.25 8.25 0 1120.25 12z"
              />
              {temporaryChat ? (
                <path strokeWidth={2} d="M8.6 12.1l2.4 2.4 4.6-5" />
              ) : null}
            </svg>
          </button>
        ) : null}
        <div
          ref={transcriptScrollRef}
          data-notification-chat={`garden_chat:${activeClusterSlug}:${activeChatId}`}
          className="bb-chat-scroller bb-chat-scroll-tail flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4"
        >
          <InlineArtifactCardsProvider legacyChatSessionId={activeChatId} gardenSlug={activeClusterSlug}>
          <InlineProposalCardsProvider
            key={viewingConversationId}
            conversationId={activeChat?.isOwn !== false ? viewingConversationId : null}
            gardenSlug={activeChat?.isOwn !== false && viewingConversationId ? activeClusterSlug : null}
            refreshKey={`${chatIsStreaming}:${messages.length}`}
            onRequestRevision={prompt => queueFollowUp(prompt, [])}
          >
          {visibleMessages.length === 0 ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-100">
                  {hasActiveCluster
                    ? 'Ask about the map, notes, pages, or relationships.'
                    : 'Open a garden to start asking.'}
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  {hasActiveCluster
                    ? 'I can use the garden inventory, topic notes, source locations, and graph links as context.'
                    : 'The assistant follows the garden or note you open from this library view.'}
                </p>
                <p className="mt-2 text-xs text-gray-500">
                  {formatNumber(stats.words)} words are indexed for this garden.
                </p>
              </div>
              {/* Only cards grounded in this garden; nothing generic when there are none. */}
              <ChatSuggestionCards
                suggestions={recommendations.map(item => item.prompt)}
                suggestionDetails={Object.fromEntries(recommendations.map(item => [item.prompt, { label: item.sourceLabel, usefulness: item.usefulness }]))}
                suggestionScopeKey={JSON.stringify([activeClusterSlug,activeMarkdown?.title,temporaryChat])}
                disabled={chatIsStreaming || !hasActiveCluster}
                onSelectSuggestion={prompt => { setInput(prompt); composerTextareaRef.current?.focus(); }}
              />
            </div>
          ) : (
            <VirtualizedMessageList
              surface="garden-assistant"
              className="w-full"
              items={visibleMessages}
              scrollRef={transcriptScrollRef}
              bridge={transcriptVirtual}
              // What `space-y-4` drew between rows.
              gap={16}
              resetKey={activeChatId}
              getItemKey={chatRowKey}
              estimateSize={estimateAssistantRowHeight}
              renderItem={renderTranscriptRow}
            />
          )}
          </InlineProposalCardsProvider>
          </InlineArtifactCardsProvider>
          {visibleMessages.length > 0 ? <ChatDisclaimer /> : null}
        </div>
        <ChatMessageRail
          surface="garden-assistant"
          items={railItems}
          scrollRef={transcriptScrollRef}
          bridge={transcriptVirtual}
        />
        <ChatJumpToBottom
          visible={transcriptAwayFromBottom}
          busy={chatIsStreaming}
          onJump={jumpToNewestMessage}
        />
      </div>

      <div ref={composerInset.ref} className="bb-composer-overlay p-3">
        {textSelection.overlays}
        {selectedTextContext ? (
          <SelectionComposerContext
            selection={{ mode: selectedTextContext.mode, quote: selectedTextContext.text }}
            widthClassName="max-w-none"
            onCancel={() => {
              setSelectedTextContext(null);
              composerTextareaRef.current?.focus();
            }}
          />
        ) : null}
        {permissionRequest && (
          <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50/80 p-3 text-sm dark:border-amber-400/30 dark:bg-amber-950/30">
            <p className="font-medium text-amber-900 dark:text-amber-200">Access needed</p>
            <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">{permissionRequest.message}</p>
            {permissionRequest.path && (
              <p className="mt-1 break-all font-mono text-xs text-amber-900/70 dark:text-amber-100/70">
                {permissionRequest.path}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={approvingPermission}
                onClick={() => approvePermission(permissionRequest, 'remembered')}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {approvingPermission ? 'Approving…' : 'Allow and remember'}
              </button>
              <button
                type="button"
                disabled={approvingPermission}
                onClick={() => approvePermission(permissionRequest, 'one_time')}
                className="rounded-md border border-amber-500/60 px-3 py-1.5 text-xs font-medium text-amber-900 disabled:opacity-60 dark:text-amber-200"
              >
                Allow once
              </button>
              <button
                type="button"
                disabled={approvingPermission}
                onClick={() => setPermissionRequest(null)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-amber-900/70 disabled:opacity-60 dark:text-amber-200/70"
              >
                Not now
              </button>
            </div>
          </div>
        )}
        <input
          ref={attachmentInputRef}
          type="file"
          accept={CHAT_ATTACHMENT_ACCEPT}
          multiple
          onChange={handleAttachmentInput}
          className="hidden"
        />
        {activeMarkdown && activeMarkdown.cluster === activeClusterSlug ? (
          <div
            className="mb-1 flex min-w-0 items-baseline gap-1 px-3 text-[11px] leading-5 text-[#6B7971]"
            title={activeMarkdown.slug}
          >
            <span className="shrink-0">Viewing</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{markdownFileLabel(activeMarkdown)}</span>
          </div>
        ) : null}
        <AssistantComposer
          personalizedSuggestions={!temporaryChat && activeChat?.isOwn !== false}
          viewportBoundedIntelligence
          textareaRef={composerTextareaRef}
          capabilitySurface="garden_chat"
          capabilityGardenSlug={activeClusterSlug}
          compact
          value={input}
          onChange={setInput}
          onSubmit={voice => void sendMessage(undefined, undefined, undefined, undefined, undefined, undefined, undefined, voice)}
          history={sentMessages}
          placeholder={hasActiveCluster ? 'Ask anything' : 'Open a garden first...'}
          disabled={!hasActiveCluster}
          isSending={chatIsStreaming}
          onSubmitDuringRun={textSelection.composerSelection?.mode === 'inline' || selectedTextContext?.mode === 'inline' ? () => void sendMessage() : undefined}
          runState={
            !chatIsStreaming
              ? 'idle'
              : visibleAgentConnection === 'waiting'
                ? 'waiting_for_permission'
                : visibleAgentConnection === 'connecting'
                  ? 'connecting'
                  : 'running'
          }
          onQueueSteer={(text, attachments) => {
            queueFollowUp(text, attachments, textSelection.composerSelection ?? undefined);
            textSelection.clearComposerSelection();
          }}
          headerContent={queuedFollowUpsHeader || textSelection.composerSelection ? (
            <>
              {queuedFollowUpsHeader}
              {textSelection.composerSelection ? (
                <SelectionComposerContext selection={textSelection.composerSelection} widthClassName="max-w-none"
                  onCancel={textSelection.cancelQuestion} attached />
              ) : null}
            </>
          ) : undefined}
          onStop={abortAgentActivity}
          permissionPending={Boolean(agentActivity.pendingPermission)}
          clarificationPending={Boolean(agentActivity.pendingClarification)}
          canSubmit={Boolean(input.trim() || chatAttachments.length > 0)}
          model={model}
          models={models}
          modelsLoading={modelsLoading}
          onLoadModels={() => void loadModels()}
          onModelChange={changeModel}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
          intelligenceModes={intelligenceModes}
          onAddDocuments={() => attachmentInputRef.current?.click()}
          onPasteFiles={addAttachmentFiles}
          isAddingDocuments={extractingAttachments}
              attachmentUploadError={attachmentUploadError}
          attachments={chatAttachments}
          onRemoveAttachment={(index) =>
            setChatAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
          }
          onReplaceAttachment={(index, attachment) =>
            setChatAttachments((current) => current.map((item, itemIndex) => (itemIndex === index ? attachment : item)))
          }
          statusMessage={attachmentStatus}
          voiceMessages={messages}
          voiceConversationId={activeChatId}
          voiceCreatedConversationId={createdChatId}
        />
      </div>
    </aside>
  );

  const historyPanel = showHistory ? (
    <div
      className="bb-modal-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) setShowHistory(false);
      }}
    >
      <div className="bb-modal-panel neu-dialog flex max-h-[78vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Chat history</h2>
            <p className="text-xs text-gray-500">
              {historySessions.length} chats for {clusterLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void startNewChat()}
              disabled={chatIsStreaming || !activeClusterSlug}
              className="neu-button-primary rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-950 disabled:opacity-50"
            >
              New chat
            </button>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="neu-button rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300"
            >
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {historySessions.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">No chats yet.</div>
          ) : (
            <ul className="space-y-1">
              {historySessions.map((session) => {
                const preview =
                  session.messages.find((message) => message.role === 'user')?.content ||
                  session.messages.at(-1)?.content ||
                  'Empty chat';
                return (
                  <li key={session.id} className="group flex items-start gap-2 rounded-md hover:bg-gray-800/70">
                    <button
                      type="button"
                      onClick={() => openChatSession(session)}
                      disabled={chatIsStreaming}
                      className={`min-w-0 flex-1 rounded-md px-3 py-2 text-left transition ${
                        session.id === activeChatId ? 'bg-gray-800 text-white' : 'text-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium">{session.title}</p>
                        {session.active ? <ActiveChatIcon label={`${session.title} is running`} /> : unreadChats.has(String(session.id)) ? <UnreadChatDot label={`${session.title} — unread`} /> : null}
                        <span className="shrink-0 text-[10px] text-gray-600">{formatChatTime(session.updated_at)}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{preview}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteChatSession(session.id)}
                      disabled={chatIsStreaming}
                      className="neu-button-icon mr-1 mt-2 rounded-full p-1 text-red-300 opacity-0 group-hover:opacity-100 disabled:opacity-30"
                      aria-label="Delete chat"
                      title="Delete chat"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.8}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m6 6 12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const promptsPanel = showPrompts ? (
    <div
      className="bb-modal-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) setShowPrompts(false);
      }}
    >
      <div className="bb-modal-panel neu-dialog flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Prompt library</h2>
            <p className="text-xs text-gray-500">{filteredPrompts.length} prompts</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openNewPrompt}
              className="neu-button-primary rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-950"
            >
              New prompt
            </button>
            <button
              type="button"
              onClick={() => setShowPrompts(false)}
              className="neu-button rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300"
            >
              Close
            </button>
          </div>
        </div>
        <div className="space-y-2 border-b border-gray-800 px-4 py-3">
          <input
            value={promptSearch}
            onChange={(event) => setPromptSearch(event.target.value)}
            placeholder="Search prompts..."
            className="neu-control w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-gray-500"
          />
          <div className="flex gap-1.5 overflow-x-auto">
            {PROMPT_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setPromptCategory(category)}
                className={`shrink-0 rounded-md border px-3 py-1 text-xs transition ${promptCategory === category ? 'border-gray-500 bg-gray-700 text-white' : 'border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-300'}`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredPrompts.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">No prompts match your search.</div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {filteredPrompts.map((prompt) => (
                <li key={prompt.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-white">{prompt.title}</p>
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                        {prompt.category}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{prompt.content}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditPrompt(prompt)}
                      className="neu-button px-2.5 py-1 text-xs"
                    >
                      Edit
                    </button>
                    {!prompt.isDefault ? (
                      <button
                        type="button"
                        onClick={() => deletePrompt(prompt.id)}
                        className="neu-button-destructive px-2.5 py-1 text-xs"
                      >
                        Delete
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => applyPrompt(prompt)}
                      className="neu-button-primary px-3 py-1 text-xs"
                    >
                      Use
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const promptEditor = editingPrompt ? (
    <div
      className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) setEditingPrompt(null);
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (editingPrompt.title.trim() && editingPrompt.content.trim()) savePrompt(editingPrompt);
        }}
        className="bb-modal-panel neu-dialog w-full max-w-lg rounded-2xl border p-5"
      >
        <h2 className="mb-4 text-lg font-semibold text-white">{editingPrompt.id ? 'Edit prompt' : 'New prompt'}</h2>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-gray-400">Title</span>
          <input
            value={editingPrompt.title}
            onChange={(event) =>
              setEditingPrompt((prompt) => (prompt ? { ...prompt, title: event.target.value } : prompt))
            }
            className="neu-control w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-gray-600"
          />
        </label>
        <div className="mb-3">
          <p className="mb-1 text-sm text-gray-400">Category</p>
          <div className="flex flex-wrap gap-2">
            {PROMPT_CATEGORIES.filter((category) => category !== 'All').map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setEditingPrompt((prompt) => (prompt ? { ...prompt, category } : prompt))}
                className={`rounded-md border px-3 py-1.5 text-xs ${editingPrompt.category === category ? 'border-gray-500 bg-gray-700 text-white' : 'border-gray-800 text-gray-500'}`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Prompt content</span>
          <textarea
            value={editingPrompt.content}
            onChange={(event) =>
              setEditingPrompt((prompt) => (prompt ? { ...prompt, content: event.target.value } : prompt))
            }
            rows={5}
            className="neu-control w-full resize-none rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-gray-600"
          />
        </label>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => setEditingPrompt(null)}
            className="neu-button flex-1 rounded-md border border-gray-800 py-2 text-sm text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!editingPrompt.title.trim() || !editingPrompt.content.trim()}
            className="neu-button-primary flex-1 rounded-md bg-white py-2 text-sm font-medium text-gray-950 disabled:opacity-50"
          >
            Save prompt
          </button>
        </div>
      </form>
    </div>
  ) : null;

  const quartzAnswerPopover = quartzIframeRef ? (
    <QuartzInlineAnswerPopover
      iframeRef={quartzIframeRef}
      quartzOrigin={quartzOrigin}
      answerSelection={quartzAnswerSelection}
      renderArtifacts={renderAnswerArtifacts}
    />
  ) : null;

  return chatOpen ? (
    <>
      {quartzAnswerPopover}
      <button
        type="button"
        aria-label="Resize assistant panel"
        title="Drag to resize"
        style={resizeHandleStyle}
        onPointerDown={handlePanelResizeStart}
        onPointerMove={handlePanelResizeMove}
        onPointerUp={handlePanelResizeEnd}
        onPointerCancel={handlePanelResizeEnd}
        className={`absolute top-0 z-50 hidden h-full w-2 cursor-col-resize items-center justify-center border-l border-gray-900 border-r border-gray-800 bg-gray-950 transition-colors hover:bg-gray-900 lg:flex ${isResizing ? 'bg-gray-900' : ''}`}
      >
        <span className={`h-16 w-px rounded-full transition-colors ${isResizing ? 'bg-gray-400' : 'bg-gray-700'}`} />
      </button>
      {chatPanel}
      {historyPanel}
      {promptsPanel}
      {promptEditor}
    </>
  ) : (
    <>
      {quartzAnswerPopover}
      {/* Nested answers opened from a page answer stay up with the panel shut. */}
      {textSelection.overlays}
      {!launcherHidden ? (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="garden-assistant-launcher neu-button fixed bottom-5 right-5 z-[70] rounded-md border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-100 transition hover:border-gray-500 hover:bg-gray-900"
        >
          Assistant
          {unreadChats.size > 0 ? <UnreadChatDot className="ml-2 h-2 w-2" multiple={unreadChats.size > 1} label="Unread chat responses" /> : null}
        </button>
      ) : null}
      {historyPanel}
      {promptsPanel}
      {promptEditor}
    </>
  );
}
