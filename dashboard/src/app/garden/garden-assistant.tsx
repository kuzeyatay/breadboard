'use client';

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import AssistantComposer from '@/app/components/assistant-composer';
import AssistantMessageActions from '@/app/components/assistant-message-actions';
import { isDirectModeEnabled } from '@/app/components/use-direct-mode';
import {
  chatAutoScrollContentKey,
  chatAutoScrollResponseKey,
  useChatAutoScroll,
} from '@/app/components/use-chat-auto-scroll';
import ChatJumpToBottom from '@/app/components/chat-jump-to-bottom';
import ChatTimeSeparator from '@/app/components/chat-time-separator';
import { useAssistantIntelligence } from '@/app/components/use-assistant-intelligence';
import ActivityPanel from '@/app/components/hermes/activity-panel';
import { UserMessageText } from '@/app/components/hermes/command-text';
import { useLegacyAgentActivity } from '@/app/components/hermes/use-legacy-agent-activity';
import { useChatDraft } from '@/app/components/hermes/use-chat-draft';
import { forgetChatDrafts } from '@/lib/conversations/drafts';
import ChatMarkdown from '@/app/components/chat-markdown';
import { useAssistantModels } from '@/app/components/use-assistant-models';
import {
  CHAT_ATTACHMENT_ACCEPT,
  chatMessageAttachments,
  extractChatAttachments,
  reusableChatAttachments,
  type ChatAttachment,
  type ChatMessageAttachment,
} from '@/lib/chat-attachments';
import { distillAttachments } from '@/lib/document-skills/client';
import {
  type ChatTokenUsage,
  normalizeChatTokenUsage,
} from '@/lib/chat-token-usage';
import { chatTimeSeparatorLabels } from '@/lib/chat-time-separators';
import type { VerificationSummary } from '@/lib/hermes/evidence';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  sources?: string[];
  thinking?: string;
  attachmentNames?: string[];
  attachments?: ChatMessageAttachment[];
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  verification?: VerificationSummary;
}

interface ChatSession {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  isOwn?: boolean;
  ownerUsername?: string;
  messages: ChatMessage[];
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
}

interface GraphStats {
  documents: number;
  topics: number;
  textbookPages: number;
  conceptNodes: number;
  generatedNotes: number;
  links: number;
  words: number;
}

type LearnStatus =
  | 'idle'
  | 'planning'
  | 'awaiting_confirmation'
  | 'analyzing_issues'
  | 'repairing'
  | 'revalidating'
  | 'publishing_repair'
  | 'generating_learning_pages'
  | 'generating_textbook'
  | 'generating_visuals'
  | 'writing_quartz'
  | 'building_navigation'
  | 'paused'
  | 'complete'
  | 'failed'
  | 'cancelled';

interface AssistantLearnState {
  job?: {
    id: string;
    status: LearnStatus;
    currentStep?: string;
    currentSectionTitle?: string;
    currentPageTitle?: string;
    error?: string;
  } | null;
  confirmedLearningMapId?: string;
  latestTextbookVersionId?: string;
  hasSources?: boolean;
  selectedSourceIds?: string[];
  hasTextbook?: boolean;
  buttonLabel?: string;
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
  initialOpen?: boolean;
}

const EMPTY_STATS: GraphStats = {
  documents: 0,
  topics: 0,
  textbookPages: 0,
  conceptNodes: 0,
  generatedNotes: 0,
  links: 0,
  words: 0,
};

function isAssistantLearnActive(status?: LearnStatus): boolean {
  return (
    status === 'planning' ||
    status === 'analyzing_issues' ||
    status === 'repairing' ||
    status === 'revalidating' ||
    status === 'publishing_repair' ||
    status === 'generating_learning_pages' ||
    status === 'generating_textbook' ||
    status === 'generating_visuals' ||
    status === 'writing_quartz' ||
    status === 'building_navigation' ||
    // A paused run still owns the garden, so the assistant must not start one.
    status === 'paused'
  );
}

const SUGGESTED_PROMPTS = [
  'What are the main topics in this garden?',
  'Where is this concept discussed in the source pages?',
  'Summarize the source tree and how the topics connect.',
  'Which notes should I read first?',
];
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
const MAX_QUARTZ_CHAT_SESSIONS = 30;
const DEFAULT_PANEL_WIDTH = 420;
const MIN_PANEL_WIDTH = 320;
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
          ? session.messages.filter(
              (message) =>
                (message.role === 'user' || message.role === 'assistant') &&
                typeof message.content === 'string',
            ).map((message) => ({
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

function persistQuartzChatSessions(clusterSlug: string | null, sessions: ChatSession[]) {
  if (typeof window === 'undefined' || !clusterSlug) return;
  window.localStorage.setItem(
    quartzHistoryKey(clusterSlug),
    JSON.stringify(
      sessions
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, MAX_QUARTZ_CHAT_SESSIONS),
    ),
  );
}

export default function GardenAssistant({
  activeClusterSlug,
  activeClusterName,
  activeMarkdown,
  initialOpen = false,
}: Props) {
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const previousClusterRef = useRef<string | null>(activeClusterSlug);
  const [chatOpen, setChatOpen] = useState(initialOpen);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const timeSeparators = useMemo(
    () => chatTimeSeparatorLabels(messages),
    [messages],
  );
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  // Raised for as long as a turn this tab started owns what is on screen. The
  // transcript is put up before the chat row that will hold it exists, so the
  // empty session arriving must not be allowed to wipe it.
  const localTurnRef = useRef(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [approvingPermission, setApprovingPermission] = useState(false);
  const agentActivity = useLegacyAgentActivity();
  const [isResizing, setIsResizing] = useState(false);
  const [stats, setStats] = useState<GraphStats>(EMPTY_STATS);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const {
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    intelligenceModes,
    failover: modelFailover,
  } = useAssistantIntelligence();
  const { models, modelsLoading, loadModels } = useAssistantModels();
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState('');
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [learnState, setLearnState] = useState<AssistantLearnState | null>(null);
  const [learnBusy, setLearnBusy] = useState(false);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [showPrompts, setShowPrompts] = useState(false);
  const [promptSearch, setPromptSearch] = useState('');
  const [promptCategory, setPromptCategory] = useState('All');
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);

  const hasActiveCluster = Boolean(activeClusterSlug);
  const clusterLabel = activeClusterName || activeClusterSlug || 'Open a garden';
  const activeChat = chatSessions.find((session) => session.id === activeChatId) ?? null;
  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(savedWidth)) setPanelWidth(clampPanelWidth(savedWidth));
    setPrompts(loadPrompts());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    if (previousClusterRef.current === activeClusterSlug) return;
    previousClusterRef.current = activeClusterSlug;
    setInput('');
    setShowHistory(false);
  }, [activeClusterSlug]);

  // Unsent text outlives a reload, filed under the chat it was typed in — and
  // under the cluster, since that is what the chats themselves are kept by.
  // Declared after the cluster-switch reset above so that on a switch the draft
  // of the cluster being opened has the last word over the emptying.
  const draftSurface = `garden_assistant:${activeClusterSlug ?? 'none'}`;
  useChatDraft({
    surface: draftSurface,
    sessionId: activeChatId === null ? null : String(activeChatId),
    value: input,
    onRestore: setInput,
  });

  useEffect(() => {
    // The local cache is a fast first paint only. Server-side chat sessions are
    // authoritative: a cached entry whose id no longer exists (notably the
    // legacy `Date.now()` ids this component used to mint) can never be
    // addressed by the Hermes runtime, so it is dropped on reconcile.
    const cached = loadQuartzChatSessions(activeClusterSlug);
    setChatSessions(cached);
    setActiveChatId(cached[0]?.id ?? null);
    setMessages(cached[0]?.messages ?? []);

    if (!activeClusterSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/chat-sessions?clusterSlug=${encodeURIComponent(activeClusterSlug)}`,
        );
        if (!response.ok) return;
        const body = (await response.json()) as { sessions?: ChatSession[] };
        const serverSessions = body.sessions;
        if (cancelled || !Array.isArray(serverSessions)) return;

        const serverIds = new Set(serverSessions.map((session) => session.id));
        setChatSessions((previous) => {
          // Keep cached transcripts for sessions the server still knows about,
          // so an in-flight reply is not lost by the reconcile.
          const cachedById = new Map(previous.map((session) => [session.id, session]));
          const reconciled = serverSessions
            .map((session) => ({
              ...session,
              messages: session.messages?.length
                ? session.messages
                : (cachedById.get(session.id)?.messages ?? []),
            }))
            .slice(0, MAX_QUARTZ_CHAT_SESSIONS);
          persistQuartzChatSessions(activeClusterSlug, reconciled);
          return reconciled;
        });
        setActiveChatId((current) =>
          current !== null && serverIds.has(current) ? current : (serverSessions[0]?.id ?? null),
        );
      } catch {
        /* offline: the cached view stays until the next successful reconcile */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeClusterSlug]);

  useEffect(() => {
    if (localTurnRef.current) return;
    setMessages(activeChat?.messages ?? []);
  }, [activeChat?.id, activeChat?.messages]);

  const fetchLearnStatus = useCallback(async () => {
    if (!activeClusterSlug) {
      setLearnState(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/gardens/${encodeURIComponent(activeClusterSlug)}/learn/status`,
      );
      if (!response.ok) return;
      const data = (await response.json().catch(() => ({}))) as AssistantLearnState;
      setLearnState(data);
    } catch {
      // Learn status is best-effort in the assistant panel.
    }
  }, [activeClusterSlug]);

  useEffect(() => {
    void fetchLearnStatus();
  }, [fetchLearnStatus]);

  useEffect(() => {
    const active = isAssistantLearnActive(learnState?.job?.status) || learnBusy;
    if (!active) return;
    const id = window.setInterval(() => {
      void fetchLearnStatus();
    }, 2500);
    return () => window.clearInterval(id);
  }, [fetchLearnStatus, learnBusy, learnState?.job?.status]);

  const activeMarkdownContext =
    activeMarkdown?.content
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
      const matchSearch =
        !q ||
        prompt.title.toLowerCase().includes(q) ||
        prompt.content.toLowerCase().includes(q);
      return matchCategory && matchSearch;
    });
  }, [promptCategory, promptSearch, prompts]);

  useEffect(() => {
    if (!activeClusterSlug) {
      setStats(EMPTY_STATS);
      return;
    }

    let cancelled = false;

    fetch(`/api/knowledge-graph?clusterSlug=${encodeURIComponent(activeClusterSlug)}`)
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json().catch(() => ({}));
        const nextStats = body?.stats;
        if (!cancelled && nextStats) {
          setStats({
            documents: Number(nextStats.documents) || 0,
            topics: Number(nextStats.topics) || 0,
            textbookPages: Number(nextStats.textbookPages) || Number(nextStats.topics) || 0,
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

  const {
    ref: transcriptScrollRef,
    awayFromBottom: transcriptAwayFromBottom,
    scrollToBottom: jumpToNewestMessage,
  } = useChatAutoScroll<HTMLDivElement>({
    isResponding: isStreaming,
    responseKey: chatAutoScrollResponseKey(messages),
    contentKey: chatAutoScrollContentKey(messages),
    enabled: chatOpen,
  });

  function updateSessionMessages(sessionId: number, nextMessages: ChatMessage[], title?: string) {
    setChatSessions((previous) => {
      const sessions = previous
        .map((session) =>
          session.id === sessionId
            ? {
                ...session,
                title: title ?? session.title,
                messages: nextMessages,
                updated_at: new Date().toISOString(),
              }
            : session,
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      persistQuartzChatSessions(activeClusterSlug, sessions);
      return sessions;
    });
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
    options: { keepMessages?: boolean } = {},
  ): Promise<ChatSession | null> {
    if (!activeClusterSlug) return null;
    try {
      const response = await fetch('/api/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterSlug: activeClusterSlug, title }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { session?: ChatSession };
      const created = body.session;
      if (!created || typeof created.id !== 'number') return null;

      const session: ChatSession = { ...created, isOwn: true, messages: [] };
      setChatSessions((previous) => {
        const sessions = [session, ...previous.filter((entry) => entry.id !== session.id)].slice(
          0,
          MAX_QUARTZ_CHAT_SESSIONS,
        );
        persistQuartzChatSessions(activeClusterSlug, sessions);
        return sessions;
      });
      setActiveChatId(session.id);
      if (!options.keepMessages) setMessages([]);
      return session;
    } catch {
      return null;
    }
  }

  async function persistChatSession(sessionId: number, nextMessages: ChatMessage[], title?: string) {
    updateSessionMessages(sessionId, nextMessages, title);
  }

  async function startNewChat() {
    if (isStreaming) return;
    localTurnRef.current = false;
    const session = await createChatSession();
    if (session) {
      setMessages([]);
      setShowHistory(false);
    }
  }

  function openChatSession(session: ChatSession) {
    if (isStreaming) return;
    localTurnRef.current = false;
    setActiveChatId(session.id);
    setMessages(session.messages ?? []);
    setShowHistory(false);
  }

  function deleteChatSession(sessionId: number) {
    if (isStreaming) return;
    forgetChatDrafts(window.localStorage, draftSurface, [String(sessionId)]);
    setChatSessions((previous) => {
      const sessions = previous.filter((session) => session.id !== sessionId);
      persistQuartzChatSessions(activeClusterSlug, sessions);
      if (activeChatId === sessionId) {
        setActiveChatId(sessions[0]?.id ?? null);
        setMessages(sessions[0]?.messages ?? []);
      }
      return sessions;
    });
  }

  async function sendMessage(
    textOverride?: string,
    historyOverride?: ChatMessage[],
    attachmentOverride?: readonly ChatAttachment[],
  ) {
    const text = (textOverride ?? input).trim();
    const pendingAttachments: ChatAttachment[] = attachmentOverride
      ? [...attachmentOverride]
      : textOverride === undefined
        ? chatAttachments
        : [];
    if ((!text && pendingAttachments.length === 0) || isStreaming || !activeClusterSlug) return;

    const history = historyOverride ?? messages;
    const attachmentNames = pendingAttachments.map((attachment) => attachment.name);
    const displayText = text || 'Please review the attached document(s).';
    const turnCreatedAt = new Date().toISOString();
    const userMessage: ChatMessage = {
      role: 'user',
      content: displayText,
      createdAt: turnCreatedAt,
      attachmentNames,
      attachments: chatMessageAttachments(pendingAttachments),
    };
    const nextMessages = [...history, userMessage];
    let assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      createdAt: turnCreatedAt,
      sources: [],
    };
    const responseStartedAt = performance.now();

    // Everything below needs a chat row, and on a fresh chat that is a round
    // trip to the server. The message goes up first: what was typed appears
    // the moment it is sent, not when the server has somewhere to keep it.
    localTurnRef.current = true;
    setInput('');
    setChatAttachments([]);
    setAttachmentStatus('');
    setIsStreaming(true);
    setMessages([...nextMessages, assistantMessage]);
    // Thinking belongs to the turn, not to the request that answers it, so it
    // is raised here rather than once there is a chat row to send against.
    const turnSignal = agentActivity.start();
    let activityStarted = true;

    let session = activeChat;
    let sessionTitle: string | undefined;
    if (!session || session.isOwn === false) {
      session = await createChatSession(undefined, { keepMessages: true });
      if (!session) {
        setMessages([
          ...nextMessages,
          {
            ...assistantMessage,
            content: 'I could not create a chat history entry yet.',
          },
        ]);
        agentActivity.finish(true);
        activityStarted = false;
        setIsStreaming(false);
        localTurnRef.current = false;
        return;
      }
    }

    let agentFailed = false;
    let pendingApproval: PermissionRequest | null = null;
    try {
      if (activeMarkdown && wantsOpenMarkdownEdit(text) && pendingAttachments.length === 0) {
        const response = await fetch('/api/markdown-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        if (!response.ok || !body.success) {
          throw new Error(typeof body.error === 'string' ? body.error : 'Markdown edit failed');
        }
        const title =
          typeof body.title === 'string' && body.title.trim()
            ? body.title.trim()
            : activeMarkdown.title || activeMarkdown.slug;
        const slug =
          typeof body.slug === 'string' && body.slug.trim()
            ? body.slug.trim()
            : activeMarkdown.slug;
        const content =
          typeof body.content === 'string' ? body.content : activeMarkdown.content;
        const summary =
          typeof body.summary === 'string' && body.summary.trim()
            ? body.summary.trim()
            : 'Updated the open page.';
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
          role: 'assistant',
          createdAt: turnCreatedAt,
          content: [
            `${summary}`,
            '',
            `Saved changes to **${title}**.`,
            tags.length > 0
              ? `Tags now: ${tags.map((tag: string) => `\`${tag}\``).join(', ')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
          sources: [title || slug],
          ...(usage ? { usage } : {}),
          responseDurationMs: Math.round(performance.now() - responseStartedAt),
        };
        const finalMessages = [...nextMessages, assistantMessage];
        setMessages(finalMessages);
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

      const signal = turnSignal;
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterSlug: activeClusterSlug,
          chatSessionId: session.id,
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          model,
          reasoningEffort,
          attachments: pendingAttachments,
          activeMarkdown: activeMarkdownContext,
          adhdMode: isDirectModeEnabled(),
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
          thinking:
            'Hermes failed at runtime. HERMES_MODE=preferred allowed this visible legacy ChatMock fallback.\n',
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const updateAssistant = () => {
        setMessages([...nextMessages, { ...assistantMessage }]);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const eventBlock of events) {
          const payload = eventBlock
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s?/, ''))
            .join('\n')
            .trim();

          if (!payload || payload === '[DONE]') continue;

          try {
            const event = JSON.parse(payload);
            agentActivity.handleEvent(event as Record<string, unknown>);
            if (event.type === 'sources' && Array.isArray(event.sources)) {
              assistantMessage = {
                ...assistantMessage,
                sources: Array.from(
                  new Set(event.sources.filter((source: unknown) => typeof source === 'string')),
                ),
              };
              updateAssistant();
            }
            if (event.type === 'error') {
              assistantMessage = {
                ...assistantMessage,
                content: `${assistantMessage.content}\n\n${event.error ?? 'Hermes reported an error.'}`,
              };
              updateAssistant();
            }
            if (event.type === 'runtime' && event.fallback) {
              assistantMessage = {
                ...assistantMessage,
                thinking: `${assistantMessage.thinking ?? ''}\nHermes unavailable — using the visible preferred-mode ChatMock fallback.`,
              };
              updateAssistant();
            }
            if (event.type === 'delta' && typeof event.text === 'string') {
              assistantMessage = {
                ...assistantMessage,
                content: `${assistantMessage.content}${event.text}`,
              };
              updateAssistant();
            }
            if (event.type === 'replace' && typeof event.text === 'string') {
              assistantMessage = { ...assistantMessage, content: event.text };
              updateAssistant();
            }
            if (event.type === 'segment' && typeof event.text === 'string') {
              // The streamed text so far was tool-call narration, not the
              // answer. Move it into the thinking strip and let the bubble
              // restart with the next segment.
              assistantMessage = {
                ...assistantMessage,
                thinking: `${assistantMessage.thinking ?? ''}\n${event.text}`.trim(),
                ...(event.streamed ? { content: '' } : {}),
              };
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
              assistantMessage = { ...assistantMessage, verification: event.verification as VerificationSummary };
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
                operations: Array.isArray(event.operations)
                  ? (event.operations as string[])
                  : [],
                originalText: text,
                history,
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
          } catch {
            // Ignore malformed stream fragments and keep reading.
          }
        }
      }
      assistantMessage = {
        ...assistantMessage,
        responseDurationMs: Math.round(performance.now() - responseStartedAt),
      };
      const finalMessages = [...nextMessages, assistantMessage];
      setMessages(finalMessages);
      await persistChatSession(session.id, finalMessages, sessionTitle);
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      agentFailed = !aborted;
      const message = aborted ? 'The request was stopped.' : error instanceof Error ? error.message : 'Assistant could not answer right now';
      const finalMessages: ChatMessage[] = [
        ...nextMessages,
        {
          role: 'assistant',
          createdAt: turnCreatedAt,
          content: `I could not reach the assistant for this garden yet. ${message}`,
          sources: [],
          responseDurationMs: Math.round(performance.now() - responseStartedAt),
        },
      ];
      setMessages(finalMessages);
      await persistChatSession(session.id, finalMessages, sessionTitle);
    } finally {
      if (activityStarted) agentActivity.finish(agentFailed);
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
    try {
      const permissions = Object.fromEntries(
        request.operations.map((operation) => [operation, true]),
      );
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
            content:
              typeof body.message === 'string'
                ? body.message
                : 'That folder could not be approved.',
            sources: [],
          },
        ]);
        return;
      }
      setPermissionRequest(null);
      // Resume the same task. The user does not restate it.
      await sendMessage(request.originalText, request.history);
    } finally {
      setApprovingPermission(false);
    }
  }

  async function addAttachmentFiles(files: File[]) {
    if (files.length === 0) return;
    setExtractingAttachments(true);
    // The add-documents button spins while the read runs, so a status line
    // saying the same thing only adds noise under the composer. Clear it so a
    // message from an earlier attachment does not sit there stale.
    setAttachmentStatus('');
    try {
      const result = await extractChatAttachments(files);
      setChatAttachments((current) => [...current, ...result.attachments]);
      setAttachmentStatus([...result.errors, ...result.warnings].join(' · '));
      // Distil now, while the user is still typing, so the answer comes from a
      // structured document rather than a dumped one.
      const distillErrors = await distillAttachments(result.attachments, {
        onStatus: setAttachmentStatus,
      });
      if (distillErrors.length > 0) setAttachmentStatus(distillErrors.join(' · '));
    } finally {
      setExtractingAttachments(false);
    }
  }

  function handleAttachmentInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void addAttachmentFiles(files);
  }

  function retryAssistantMessage(messageIndex: number) {
    if (isStreaming) return;
    let userIndex = messageIndex - 1;
    while (userIndex >= 0 && messages[userIndex]?.role !== 'user') userIndex -= 1;
    const previousUser = messages[userIndex];
    if (!previousUser || previousUser.role !== 'user') return;
    void sendMessage(
      previousUser.content,
      messages.slice(0, userIndex),
      reusableChatAttachments(previousUser.attachments),
    );
  }

  function handlePanelResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();

    resizeStartRef.current = {
      startX: event.clientX,
      startWidth: panelWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
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
    const next = prompt.id
      ? { ...prompt }
      : { ...prompt, id: `user-${Date.now()}`, isDefault: false };
    const updated = prompt.id
      ? prompts.map((item) => (item.id === next.id ? next : item))
      : [next, ...prompts];
    setPrompts(updated);
    persistPrompts(updated);
    setEditingPrompt(null);
  }

  function deletePrompt(id: string) {
    const updated = prompts.filter((prompt) => prompt.id !== id);
    setPrompts(updated);
    persistPrompts(updated);
  }

  async function appendAssistantNotice(content: string) {
    let session = activeChat;
    if (!session && activeClusterSlug) {
      session = await createChatSession('Learn');
    }
    const notice: ChatMessage = {
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
    };
    if (!session) {
      setMessages((previous) => [...previous, notice]);
      return;
    }
    const nextMessages = [...session.messages, notice];
    updateSessionMessages(session.id, nextMessages);
    setMessages(nextMessages);
  }

  async function handleAssistantLearn() {
    if (!activeClusterSlug || learnBusy || isAssistantLearnActive(learnState?.job?.status)) return;
    if (!learnState?.hasSources) {
      await appendAssistantNotice('Upload source documents before running Learn.');
      return;
    }
    if (learnState.job?.status === 'awaiting_confirmation') {
      await appendAssistantNotice(
        `A learning map is ready for confirmation. Open the garden dashboard to review the section order: [${clusterLabel}](/gardens/${activeClusterSlug}).`,
      );
      return;
    }

    setLearnBusy(true);
    try {
      const hasExistingLearnContent = Boolean(
        learnState.latestTextbookVersionId || learnState.hasTextbook,
      );
      const endpoint = hasExistingLearnContent
        ? 'regenerate'
        : learnState.confirmedLearningMapId
          ? 'generate'
          : 'plan';
      const response = await fetch(
        `/api/gardens/${encodeURIComponent(activeClusterSlug)}/learn/${endpoint}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            ...(endpoint === 'regenerate' ? { mode: 'repair' } : {}),
            ...(endpoint === 'generate'
              ? { confirmedLearningMapId: learnState.confirmedLearningMapId }
              : {}),
            sourceOnly: true,
            ...(Array.isArray(learnState.selectedSourceIds)
              ? { includedSourceIds: learnState.selectedSourceIds }
              : {}),
            includeSourceSnapshots: false,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error ?? 'Learn action failed');
      await fetchLearnStatus();
      await appendAssistantNotice(
        endpoint === 'plan'
          ? `Learning map drafted. Open the garden dashboard to confirm the lesson order: [${clusterLabel}](/gardens/${activeClusterSlug}).`
          : endpoint === 'generate'
            ? `Lessons generated for [${clusterLabel}](/garden/${activeClusterSlug}).`
            : `Current validation issues were repaired for [${clusterLabel}](/garden/${activeClusterSlug}); unaffected pages were preserved.`,
      );
    } catch (error) {
      await appendAssistantNotice(error instanceof Error ? error.message : 'Learn action failed.');
    } finally {
      setLearnBusy(false);
    }
  }

  const chatPanelStyle = {
    '--assistant-panel-width': `${panelWidth}px`,
  } as CSSProperties;
  const resizeHandleStyle = {
    right: panelWidth,
  } as CSSProperties;

  const chatPanel = (
    <aside
      className="neu-surface-raised fixed inset-x-3 bottom-3 top-20 z-40 flex flex-col overflow-hidden rounded-md border border-gray-800 bg-gray-900 text-gray-100 lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:w-[var(--assistant-panel-width)] lg:rounded-none lg:border-y-0 lg:border-l lg:border-r-0"
      style={chatPanelStyle}
    >
      <div className="border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">Quartz AI</p>
            <p className="truncate text-xs text-gray-400">
              {hasActiveCluster ? `${clusterLabel} Learning Map` : 'Open a garden or page to ask its map'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleAssistantLearn}
              disabled={
                !hasActiveCluster ||
                learnBusy ||
                isAssistantLearnActive(learnState?.job?.status)
              }
              className="neu-button-primary rounded-md border border-gray-700 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-950 transition hover:bg-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-800 disabled:text-gray-500"
              title={learnState?.buttonLabel ?? 'Learn'}
            >
              {learnBusy || isAssistantLearnActive(learnState?.job?.status)
                ? 'Learning...'
                : 'Learn'}
            </button>
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
            { label: 'Pages', value: stats.textbookPages },
            { label: 'Concepts', value: stats.conceptNodes },
            { label: 'Links', value: stats.links },
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
          <div
            className={`flex min-w-0 max-w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${
              activeMarkdown && activeMarkdown.cluster === activeClusterSlug
                ? 'bg-gray-800 text-gray-200'
                : 'border border-gray-800 bg-gray-950/60 text-gray-600'
            }`}
            title={
              activeMarkdown && activeMarkdown.cluster === activeClusterSlug
                ? `Current markdown: ${activeMarkdown.slug}`
                : 'No page is currently open'
            }
          >
            <svg className="h-3.5 w-3.5 shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H6.75A2.25 2.25 0 0 0 4.5 4.5v15A2.25 2.25 0 0 0 6.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-5.25Z" />
            </svg>
            <span className="truncate">
              {activeMarkdown && activeMarkdown.cluster === activeClusterSlug
                ? markdownFileLabel(activeMarkdown)
                : 'No markdown open'}
            </span>
            {activeMarkdown?.loading && activeMarkdown.cluster === activeClusterSlug ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" title="Loading markdown context" />
            ) : activeMarkdown?.content && activeMarkdown.cluster === activeClusterSlug ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" title="Markdown context loaded" />
            ) : null}
          </div>
        </div>
      </div>

      {/* Positioning context for the jump control, so it floats at the foot of
          the transcript rather than below the composer. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={transcriptScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-100">
                {hasActiveCluster ? 'Ask about the map, notes, pages, or relationships.' : 'Open a garden to start asking.'}
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
            <div className="space-y-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  type="button"
                  key={prompt}
                  onClick={() => void sendMessage(prompt)}
                  disabled={isStreaming || !hasActiveCluster}
                  className="neu-button block w-full rounded-md border border-gray-800 bg-gray-950/50 px-3 py-2 text-left text-sm text-gray-300 transition hover:border-gray-600 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={timeSeparators[index] ? 'space-y-3' : undefined}
              >
                {timeSeparators[index] ? (
                  <ChatTimeSeparator
                    label={timeSeparators[index]}
                    dateTime={message.createdAt}
                  />
                ) : null}
                <div className={message.role === 'user' ? 'ml-6' : 'mr-2'}>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">
                    {message.role === 'user' ? 'You' : 'Assistant'}
                  </div>
                  <div
                    className={
                      message.role === 'user'
                        ? 'neu-chat-message neu-chat-message-user rounded-xl rounded-tr-sm px-3 py-2 text-sm leading-6'
                        : 'text-sm leading-6 text-gray-200'
                    }
                  >
                  {message.role === 'assistant' ? (
                    <>
                      <ActivityPanel
                        activities={index === messages.length - 1 ? agentActivity.activities : []}
                        connection={index === messages.length - 1 ? agentActivity.connection : 'idle'}
                        pendingPermission={index === messages.length - 1 ? agentActivity.pendingPermission : null}
                        usage={message.usage}
                        responseDurationMs={message.responseDurationMs}
                        onPermissionDecision={(decision) =>
                          void agentActivity.respondToPermission(decision)
                        }
                      />
                      {message.content ? <ChatMarkdown content={message.content} compact /> : null}
                    </>
                  ) : (
                    <UserMessageText content={message.content} />
                  )}
                  {message.attachmentNames?.length ? (
                    <p className="mt-1.5 text-[11px] text-gray-500">
                      {message.attachmentNames.join(' · ')}
                    </p>
                  ) : null}
                  </div>
                  {message.role === 'assistant' &&
                  !(isStreaming && index === messages.length - 1) ? (
                    <AssistantMessageActions
                      content={message.content || 'Response unavailable'}
                      verification={message.verification}
                      onRetry={
                        index === messages.length - 1
                          ? () => retryAssistantMessage(index)
                          : undefined
                      }
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        <ChatJumpToBottom
          visible={transcriptAwayFromBottom}
          busy={isStreaming}
          onJump={jumpToNewestMessage}
        />
      </div>

      <div className="p-3">
        {permissionRequest && (
          <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50/80 p-3 text-sm dark:border-amber-400/30 dark:bg-amber-950/30">
            <p className="font-medium text-amber-900 dark:text-amber-200">Access needed</p>
            <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
              {permissionRequest.message}
            </p>
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
        <AssistantComposer
          capabilitySurface="garden_chat"
          capabilityGardenSlug={activeClusterSlug}
          compact
          value={input}
          onChange={setInput}
          onSubmit={() => void sendMessage()}
          placeholder={hasActiveCluster ? 'Ask about a topic, page, source, or link...' : 'Open a garden first...'}
          disabled={!hasActiveCluster}
          isSending={isStreaming}
          canSubmit={Boolean(input.trim() || chatAttachments.length > 0)}
          model={model}
          models={models}
          modelsLoading={modelsLoading}
          onLoadModels={() => void loadModels()}
          onModelChange={setModel}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
          intelligenceModes={intelligenceModes}
          modelFailover={modelFailover}
          onAddDocuments={() => attachmentInputRef.current?.click()}
          onPasteFiles={addAttachmentFiles}
          isAddingDocuments={extractingAttachments}
          attachments={chatAttachments}
          onRemoveAttachment={(index) =>
            setChatAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
          }
          statusMessage={attachmentStatus}
          voiceMessages={messages}
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
            <p className="text-xs text-gray-500">{chatSessions.length} chats for {clusterLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void startNewChat()}
              disabled={isStreaming || !activeClusterSlug}
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
          {chatSessions.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">No chats yet.</div>
          ) : (
            <ul className="space-y-1">
              {chatSessions.map((session) => {
                const preview =
                  session.messages.find((message) => message.role === 'user')?.content ||
                  session.messages.at(-1)?.content ||
                  'Empty chat';
                return (
                  <li key={session.id} className="group flex items-start gap-2 rounded-md hover:bg-gray-800/70">
                    <button
                      type="button"
                      onClick={() => openChatSession(session)}
                      disabled={isStreaming}
                      className={`min-w-0 flex-1 rounded-md px-3 py-2 text-left transition ${
                        session.id === activeChatId ? 'bg-gray-800 text-white' : 'text-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium">{session.title}</p>
                        <span className="shrink-0 text-[10px] text-gray-600">
                          {formatChatTime(session.updated_at)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{preview}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteChatSession(session.id)}
                      disabled={isStreaming}
                      className="neu-button-icon mr-1 mt-2 rounded-full p-1 text-red-300 opacity-0 group-hover:opacity-100 disabled:opacity-30"
                      aria-label="Delete chat"
                      title="Delete chat"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
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
        <h2 className="mb-4 text-lg font-semibold text-white">
          {editingPrompt.id ? 'Edit prompt' : 'New prompt'}
        </h2>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-gray-400">Title</span>
          <input
            value={editingPrompt.title}
            onChange={(event) =>
              setEditingPrompt((prompt) =>
                prompt ? { ...prompt, title: event.target.value } : prompt,
              )
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
                onClick={() =>
                  setEditingPrompt((prompt) =>
                    prompt ? { ...prompt, category } : prompt,
                  )
                }
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
              setEditingPrompt((prompt) =>
                prompt ? { ...prompt, content: event.target.value } : prompt,
              )
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

  return chatOpen ? (
    <>
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
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="neu-button fixed bottom-5 right-5 z-[70] rounded-md border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-100 transition hover:border-gray-500 hover:bg-gray-900"
      >
        Quartz AI
      </button>
      {historyPanel}
      {promptsPanel}
      {promptEditor}
    </>
  );
}
