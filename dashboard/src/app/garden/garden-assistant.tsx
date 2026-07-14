'use client';

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import AssistantComposer from '@/app/components/assistant-composer';
import ChatMarkdown from '@/app/components/chat-markdown';
import LearnErrorDialog from '@/app/components/learn-error-dialog';
import UsageLimitsPopover from '@/app/components/usage-limits-popover';
import {
  DEFAULT_ASSISTANT_MODELS,
  DEFAULT_MODEL,
  mergeAssistantModels,
} from '@/lib/ai-models';
import {
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from '@/lib/assistant-reasoning';
import {
  CHAT_ATTACHMENT_ACCEPT,
  extractChatAttachments,
  type ChatAttachment,
} from '@/lib/chat-attachments';
import {
  type ChatTokenUsage,
  normalizeChatTokenUsage,
  summarizeChatTokenUsage,
} from '@/lib/chat-token-usage';
import {
  forgetDismissedLearnErrorsForGarden,
  learnErrorDismissalKey,
  loadDismissedLearnErrorKeys,
  rememberDismissedLearnErrorKey,
} from '@/lib/learn-error-dismissal';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  thinking?: string;
  attachmentNames?: string[];
  usage?: ChatTokenUsage;
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
  | 'generating_learning_pages'
  | 'generating_textbook'
  | 'generating_visuals'
  | 'writing_quartz'
  | 'building_navigation'
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
  hasSources?: boolean;
  hasTextbook?: boolean;
  buttonLabel?: string;
  validationReport?: {
    relativePath?: string;
    url?: string;
    markdown?: string;
    truncated?: boolean;
    accepted?: boolean;
    generatedAt?: string;
  } | null;
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
    status === 'generating_learning_pages' ||
    status === 'generating_textbook' ||
    status === 'generating_visuals' ||
    status === 'writing_quartz' ||
    status === 'building_navigation'
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

function chatTitleFromText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 64) || 'New chat';
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const previousClusterRef = useRef<string | null>(activeClusterSlug);
  const [chatOpen, setChatOpen] = useState(initialOpen);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [stats, setStats] = useState<GraphStats>(EMPTY_STATS);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [reasoningEffort, setReasoningEffort] = useState<AssistantReasoningEffort>(
    DEFAULT_ASSISTANT_REASONING_EFFORT,
  );
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [models, setModels] = useState<string[]>([...DEFAULT_ASSISTANT_MODELS]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState('');
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [learnState, setLearnState] = useState<AssistantLearnState | null>(null);
  const [learnBusy, setLearnBusy] = useState(false);
  const [dismissedLearnErrorKeys, setDismissedLearnErrorKeys] = useState<string[]>(
    () => loadDismissedLearnErrorKeys(),
  );
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [showPrompts, setShowPrompts] = useState(false);
  const [promptSearch, setPromptSearch] = useState('');
  const [promptCategory, setPromptCategory] = useState('All');
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);

  const hasActiveCluster = Boolean(activeClusterSlug);
  const clusterLabel = activeClusterName || activeClusterSlug || 'Open a garden';
  const activeChat = chatSessions.find((session) => session.id === activeChatId) ?? null;
  const tokenUsage = useMemo(() => summarizeChatTokenUsage(messages), [messages]);

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

  useEffect(() => {
    const sessions = loadQuartzChatSessions(activeClusterSlug);
    setChatSessions(sessions);
    setActiveChatId(sessions[0]?.id ?? null);
    setMessages(sessions[0]?.messages ?? []);
  }, [activeClusterSlug]);

  useEffect(() => {
    setMessages(activeChat?.messages ?? []);
  }, [activeChat?.id, activeChat?.messages]);

  const loadModels = useCallback(async () => {
    if (modelsLoading || modelsLoaded) return;
    setModelsLoading(true);
    try {
      const response = await fetch('/api/models');
      const data = await response.json().catch(() => ({}));
      const ids = Array.isArray(data.data)
        ? data.data
            .map((item: { id?: unknown }) => (typeof item?.id === 'string' ? item.id : null))
            .filter((id: string | null): id is string => Boolean(id))
        : [];
      if (ids.length > 0) {
        setModels(mergeAssistantModels(ids));
      }
      setModelsLoaded(true);
    } catch {
      // Keep local defaults when the endpoint is unavailable.
    } finally {
      setModelsLoading(false);
    }
  }, [modelsLoaded, modelsLoading]);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isStreaming]);

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

  async function createChatSession(title = 'New chat'): Promise<ChatSession | null> {
    if (!activeClusterSlug) return null;
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: Date.now(),
      title,
      created_at: now,
      updated_at: now,
      isOwn: true,
      messages: [],
    };
    setChatSessions((previous) => {
      const sessions = [session, ...previous].slice(0, MAX_QUARTZ_CHAT_SESSIONS);
      persistQuartzChatSessions(activeClusterSlug, sessions);
      return sessions;
    });
    setActiveChatId(session.id);
    setMessages([]);
    return session;
  }

  async function persistChatSession(sessionId: number, nextMessages: ChatMessage[], title?: string) {
    updateSessionMessages(sessionId, nextMessages, title);
  }

  async function startNewChat() {
    if (isStreaming) return;
    const session = await createChatSession();
    if (session) {
      setMessages([]);
      setShowHistory(false);
    }
  }

  function openChatSession(session: ChatSession) {
    if (isStreaming) return;
    setActiveChatId(session.id);
    setMessages(session.messages ?? []);
    setShowHistory(false);
  }

  function deleteChatSession(sessionId: number) {
    if (isStreaming) return;
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

  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if ((!text && chatAttachments.length === 0) || isStreaming || !activeClusterSlug) return;

    const pendingAttachments = chatAttachments;
    const attachmentNames = pendingAttachments.map((attachment) => attachment.name);
    const displayText = text || 'Please review the attached document(s).';

    let session = activeChat;
    let sessionTitle: string | undefined;
    if (!session || session.isOwn === false) {
      sessionTitle = chatTitleFromText(text || attachmentNames[0] || 'Document review');
      session = await createChatSession(sessionTitle);
      if (!session) {
        setMessages([
          ...messages,
          { role: 'user', content: displayText, attachmentNames },
          { role: 'assistant', content: 'I could not create a chat history entry yet.', sources: [] },
        ]);
        return;
      }
    }

    const userMessage: ChatMessage = { role: 'user', content: displayText, attachmentNames };
    const nextMessages = [...messages, userMessage];
    let assistantMessage: ChatMessage = { role: 'assistant', content: '', sources: [] };
    const responseStartedAt = performance.now();

    setInput('');
    setChatAttachments([]);
    setAttachmentStatus('');
    setIsStreaming(true);
    setMessages([...nextMessages, assistantMessage]);

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

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterSlug: activeClusterSlug,
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          model,
          reasoningEffort,
          attachments: pendingAttachments,
          activeMarkdown: activeMarkdownContext,
        }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : 'Assistant request failed');
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
            if (event.type === 'sources' && Array.isArray(event.sources)) {
              assistantMessage = {
                ...assistantMessage,
                sources: Array.from(
                  new Set(event.sources.filter((source: unknown) => typeof source === 'string')),
                ),
              };
              updateAssistant();
            }
            if (event.type === 'thinking' && typeof event.text === 'string') {
              assistantMessage = {
                ...assistantMessage,
                thinking: `${assistantMessage.thinking ?? ''}${event.text}`,
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
          } catch {
            // Ignore malformed stream fragments and keep reading.
          }
        }
      }
      await persistChatSession(session.id, [...nextMessages, assistantMessage], sessionTitle);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Assistant could not answer right now';
      const finalMessages: ChatMessage[] = [
        ...nextMessages,
        {
          role: 'assistant',
          content: `I could not reach the assistant for this garden yet. ${message}`,
          sources: [],
        },
      ];
      setMessages(finalMessages);
      await persistChatSession(session.id, finalMessages, sessionTitle);
    } finally {
      setIsStreaming(false);
    }
  }

  async function handleAttachmentInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setExtractingAttachments(true);
    setAttachmentStatus('Reading documents…');
    const result = await extractChatAttachments(files);
    setChatAttachments((current) => [...current, ...result.attachments]);
    setAttachmentStatus([...result.errors, ...result.warnings].join(' · '));
    setExtractingAttachments(false);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
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
    if (!session) {
      setMessages((previous) => [...previous, { role: 'assistant', content }]);
      return;
    }
    const nextMessages = [...session.messages, { role: 'assistant' as const, content }];
    updateSessionMessages(session.id, nextMessages);
    setMessages(nextMessages);
  }

  async function handleAssistantLearn() {
    if (!activeClusterSlug || learnBusy || isAssistantLearnActive(learnState?.job?.status)) return;
    if (!learnState?.hasSources) {
      await appendAssistantNotice('Upload source documents before running Learn.');
      return;
    }
    if (learnState?.job?.status === 'awaiting_confirmation') {
      await appendAssistantNotice(
        `A learning map is ready for confirmation. Open the garden dashboard to review the section order: [${clusterLabel}](/gardens/${activeClusterSlug}).`,
      );
      return;
    }

    setLearnBusy(true);
    setDismissedLearnErrorKeys(forgetDismissedLearnErrorsForGarden(activeClusterSlug));
    try {
      const endpoint = learnState?.confirmedLearningMapId ? 'regenerate' : 'plan';
      const response = await fetch(`/api/gardens/${encodeURIComponent(activeClusterSlug)}/learn/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          sourceOnly: true,
          includeSourceSnapshots: false,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error ?? 'Learn action failed');
      await fetchLearnStatus();
      await appendAssistantNotice(
        endpoint === 'plan'
          ? `Learning map drafted. Open the garden dashboard to confirm the lesson order: [${clusterLabel}](/gardens/${activeClusterSlug}).`
          : `Lesson generation finished for [${clusterLabel}](/garden/${activeClusterSlug}).`,
      );
    } catch (error) {
      await appendAssistantNotice(error instanceof Error ? error.message : 'Learn action failed.');
    } finally {
      setLearnBusy(false);
    }
  }

  function dismissLearnError(job: NonNullable<AssistantLearnState['job']>) {
    if (!activeClusterSlug) return;
    const dismissalKey = learnErrorDismissalKey(activeClusterSlug, job);
    setDismissedLearnErrorKeys(rememberDismissedLearnErrorKey(dismissalKey));
  }

  const chatPanelStyle = {
    '--assistant-panel-width': `${panelWidth}px`,
  } as CSSProperties;
  const resizeHandleStyle = {
    right: panelWidth,
  } as CSSProperties;
  const currentLearnErrorKey =
    activeClusterSlug && learnState?.job?.status === 'failed' && learnState.job.error
      ? learnErrorDismissalKey(activeClusterSlug, learnState.job)
      : null;
  const learnErrorJob =
    learnState?.job?.status === 'failed' &&
    learnState.job.error &&
    currentLearnErrorKey &&
    !dismissedLearnErrorKeys.includes(currentLearnErrorKey)
      ? learnState.job
      : null;

  const chatPanel = (
    <aside
      className="fixed inset-x-3 bottom-3 top-20 z-40 flex flex-col overflow-hidden rounded-md border border-gray-800 bg-gray-900 text-gray-100 shadow-2xl lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:w-[var(--assistant-panel-width)] lg:rounded-none lg:border-y-0 lg:border-l lg:border-r-0"
      style={chatPanelStyle}
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
              onClick={handleAssistantLearn}
              disabled={
                !hasActiveCluster ||
                learnBusy ||
                isAssistantLearnActive(learnState?.job?.status)
              }
              className="rounded-md border border-gray-700 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-950 transition hover:bg-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-800 disabled:text-gray-500"
              title={learnState?.buttonLabel ?? 'Learn'}
            >
              {learnBusy || isAssistantLearnActive(learnState?.job?.status)
                ? 'Learning...'
                : 'Learn'}
            </button>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition hover:border-gray-500 hover:text-white"
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
            <div key={item.label} className="rounded-md border border-gray-800 bg-gray-950/60 px-2 py-1.5">
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
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-800 text-gray-500 transition hover:border-gray-700 hover:text-gray-300"
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
                  className="block w-full rounded-md border border-gray-800 bg-gray-950/50 px-3 py-2 text-left text-sm text-gray-300 transition hover:border-gray-600 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
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
                className={message.role === 'user' ? 'ml-6' : 'mr-2'}
              >
                <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">
                  {message.role === 'user' ? 'You' : 'Assistant'}
                </div>
                <div
                  className={
                    message.role === 'user'
                      ? 'rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm leading-6 text-gray-100'
                      : 'rounded-md border border-gray-800 bg-gray-950/70 px-3 py-2 text-sm leading-6 text-gray-200'
                  }
                >
                  {message.role === 'assistant' ? (
                    message.content ? (
                      <ChatMarkdown content={message.content} compact />
                    ) : (
                      <span className="text-gray-500">Reading the Learning Map...</span>
                    )
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                  {message.attachmentNames?.length ? (
                    <p className="mt-1.5 text-[11px] text-gray-500">
                      {message.attachmentNames.join(' · ')}
                    </p>
                  ) : null}
                </div>
                {message.thinking ? (
                  <details className="mt-2 rounded-md border border-gray-800 bg-gray-950/50 px-3 py-2 text-xs text-gray-400">
                    <summary className="cursor-pointer text-gray-300">Thinking</summary>
                    <pre className="mt-2 whitespace-pre-wrap font-sans leading-5">{message.thinking}</pre>
                  </details>
                ) : null}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 p-3">
        <input
          ref={attachmentInputRef}
          type="file"
          accept={CHAT_ATTACHMENT_ACCEPT}
          multiple
          onChange={handleAttachmentInput}
          className="hidden"
        />
        <AssistantComposer
          compact
          value={input}
          onChange={setInput}
          onSubmit={() => void sendMessage()}
          onKeyDown={handleInputKeyDown}
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
          onAddDocuments={() => attachmentInputRef.current?.click()}
          isAddingDocuments={extractingAttachments}
          attachments={chatAttachments}
          onRemoveAttachment={(index) =>
            setChatAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
          }
          statusMessage={attachmentStatus}
          tokenUsage={tokenUsage}
          tokenUsagePending={isStreaming}
          utilityActions={
            <>
              <UsageLimitsPopover
                buttonClassName="flex h-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs transition"
                activeButtonClassName="bg-[var(--paper-strong)] text-[var(--botanical)]"
                inactiveButtonClassName="text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)]"
                popoverClassName="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-4 text-xs text-[var(--ink)] shadow-2xl"
                showIcon
                light
              />
              <button
                type="button"
                onClick={() => setShowPrompts(true)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink)]"
                title="Prompt library"
                aria-label="Prompt library"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
                </svg>
              </button>
            </>
          }
        />
      </div>

    </aside>
  );

  const historyPanel = showHistory ? (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) setShowHistory(false);
      }}
    >
      <div className="flex max-h-[78vh] w-full max-w-lg flex-col overflow-hidden rounded-t-md border border-gray-700 bg-gray-900 shadow-2xl sm:rounded-md">
        <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Quartz AI history</h2>
            <p className="text-xs text-gray-500">{chatSessions.length} chats for {clusterLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void startNewChat()}
              disabled={isStreaming || !activeClusterSlug}
              className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-950 disabled:opacity-50"
            >
              New chat
            </button>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300"
            >
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {chatSessions.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">No Quartz AI chats yet.</div>
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
                      className="mr-1 mt-2 rounded p-1 text-gray-600 opacity-0 transition hover:bg-gray-900 hover:text-red-300 group-hover:opacity-100 disabled:opacity-30"
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) setShowPrompts(false);
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-md border border-gray-700 bg-gray-900 shadow-2xl sm:rounded-md">
        <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Prompt library</h2>
            <p className="text-xs text-gray-500">{filteredPrompts.length} prompts</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openNewPrompt}
              className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-950"
            >
              New prompt
            </button>
            <button
              type="button"
              onClick={() => setShowPrompts(false)}
              className="rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300"
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
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-gray-500"
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
                      className="rounded-md border border-gray-800 px-2 py-1 text-xs text-gray-400 hover:text-white"
                    >
                      Edit
                    </button>
                    {!prompt.isDefault ? (
                      <button
                        type="button"
                        onClick={() => deletePrompt(prompt.id)}
                        className="rounded-md border border-gray-800 px-2 py-1 text-xs text-red-300"
                      >
                        Delete
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => applyPrompt(prompt)}
                      className="rounded-md bg-white px-3 py-1 text-xs font-medium text-gray-950"
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) setEditingPrompt(null);
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (editingPrompt.title.trim() && editingPrompt.content.trim()) savePrompt(editingPrompt);
        }}
        className="w-full max-w-lg rounded-md border border-gray-800 bg-gray-900 p-5 shadow-2xl"
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
            className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-gray-600"
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
            className="w-full resize-none rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-gray-600"
          />
        </label>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => setEditingPrompt(null)}
            className="flex-1 rounded-md border border-gray-800 py-2 text-sm text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!editingPrompt.title.trim() || !editingPrompt.content.trim()}
            className="flex-1 rounded-md bg-white py-2 text-sm font-medium text-gray-950 disabled:opacity-50"
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
      {learnErrorJob ? (
        <LearnErrorDialog
          message={learnErrorJob.error ?? 'Learn failed while creating a section.'}
          currentStep={learnErrorJob.currentStep}
          currentSectionTitle={learnErrorJob.currentSectionTitle}
          currentPageTitle={learnErrorJob.currentPageTitle}
          validationReport={learnState?.validationReport}
          onDismiss={() => dismissLearnError(learnErrorJob)}
          onOpenPanel={() => {
            setChatOpen(true);
            dismissLearnError(learnErrorJob);
          }}
          openPanelLabel="Open assistant"
        />
      ) : null}
    </>
  ) : (
    <>
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-5 right-5 z-[70] rounded-md border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-100 shadow-xl transition hover:border-gray-500 hover:bg-gray-900"
      >
        Ask map
      </button>
      {historyPanel}
      {promptsPanel}
      {promptEditor}
      {learnErrorJob ? (
        <LearnErrorDialog
          message={learnErrorJob.error ?? 'Learn failed while creating a section.'}
          currentStep={learnErrorJob.currentStep}
          currentSectionTitle={learnErrorJob.currentSectionTitle}
          currentPageTitle={learnErrorJob.currentPageTitle}
          validationReport={learnState?.validationReport}
          onDismiss={() => dismissLearnError(learnErrorJob)}
          onOpenPanel={() => {
            setChatOpen(true);
            dismissLearnError(learnErrorJob);
          }}
          openPanelLabel="Open assistant"
        />
      ) : null}
    </>
  );
}
