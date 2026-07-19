'use client';

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import AssistantComposer from '@/app/components/assistant-composer';
import ChatMarkdown from '@/app/components/chat-markdown';
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
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from '@/lib/chat-token-usage';
import { chatTitleFromFirstMessage } from '@/lib/chat-session-title';

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
  messages: ChatMessage[];
}

type TerminalScope = 'mine' | 'public';

interface Props {
  scope: TerminalScope;
}

const HISTORY_KEY = 'breadboard:knowledge-terminal-history';
const HEIGHT_KEY = 'breadboard:knowledge-terminal-height';
const MAX_SESSIONS = 40;
// Collapsed height shows just the grab bar; drag the top edge up to open it,
// the same way garden cards are resized.
const COLLAPSED_HEIGHT = 48;
const MIN_HEIGHT = COLLAPSED_HEIGHT;

const SUGGESTED_PROMPTS: Record<TerminalScope, string[]> = {
  mine: [
    'What topics span more than one of my gardens?',
    'Summarize everything I know about a concept across all gardens.',
    'Which gardens should I review before an exam?',
    'Find connections between ideas in different gardens.',
  ],
  public: [
    'What topics show up across multiple public gardens?',
    'Summarize what the public gardens cover about a concept.',
    'Which public gardens are the best starting point for a subject?',
    'Find connections between ideas in different public gardens.',
  ],
};

// Bottom edge of the breadboard navbar, so a fully opened terminal stops right
// below the main header instead of covering it.
function navOffset(): number {
  if (typeof document === 'undefined') return 64;
  const nav = document.querySelector('nav');
  return nav ? Math.ceil(nav.getBoundingClientRect().bottom) : 64;
}

function maxHeight(): number {
  if (typeof window === 'undefined') return 720;
  return Math.max(MIN_HEIGHT, Math.round(window.innerHeight - navOffset()));
}

function clampHeight(height: number): number {
  return Math.min(maxHeight(), Math.max(MIN_HEIGHT, Math.round(height)));
}

function formatChatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function historyKeyFor(scope: TerminalScope): string {
  return `${HISTORY_KEY}:${scope}`;
}

function loadSessions(scope: TerminalScope): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(historyKeyFor(scope));
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
            )
          : [],
      }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

function persistSessions(scope: TerminalScope, sessions: ChatSession[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    historyKeyFor(scope),
    JSON.stringify(
      sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, MAX_SESSIONS),
    ),
  );
}

export default function KnowledgeTerminal({ scope }: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const [height, setHeight] = useState(COLLAPSED_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const isOpen = height > COLLAPSED_HEIGHT + 8;

  // Keep the header items mounted through their exit animation so they can
  // retract (not just vanish) when the terminal collapses. `headerMounted`
  // drives DOM presence; `headerClosing` swaps the reveal for the conceal.
  const [headerMounted, setHeaderMounted] = useState(false);
  const [headerClosing, setHeaderClosing] = useState(false);
  const headerMountedRef = useRef(false);
  const headerCloseTimer = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (headerCloseTimer.current !== null) {
        window.clearTimeout(headerCloseTimer.current);
        headerCloseTimer.current = null;
      }
      headerMountedRef.current = true;
      setHeaderClosing(false);
      setHeaderMounted(true);
    } else if (headerMountedRef.current) {
      setHeaderClosing(true);
      headerCloseTimer.current = window.setTimeout(() => {
        headerMountedRef.current = false;
        setHeaderMounted(false);
        setHeaderClosing(false);
        headerCloseTimer.current = null;
      }, 660);
    }
  }, [isOpen]);

  useEffect(
    () => () => {
      if (headerCloseTimer.current !== null) {
        window.clearTimeout(headerCloseTimer.current);
      }
    },
    [],
  );

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

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

  const activeSession = sessions.find((session) => session.id === activeId) ?? null;
  const isPublic = scope === 'public';
  const scopeTagline = isPublic ? 'chat across all public gardens' : 'chat across every garden you own';

  useEffect(() => {
    const savedHeight = Number(window.localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(savedHeight) && savedHeight > 0) setHeight(clampHeight(savedHeight));

    const onResize = () => setHeight((current) => clampHeight(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Switching the dashboard between My/Public gardens re-points the terminal at
  // that scope's history and clears the open chat so its welcome screen shows.
  useEffect(() => {
    setSessions(loadSessions(scope));
    setActiveId(null);
    setMessages([]);
    setConfirmDeleteId(null);
    setInput('');
  }, [scope]);

  useEffect(() => {
    window.localStorage.setItem(HEIGHT_KEY, String(height));
  }, [height]);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isStreaming, isOpen]);

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
      if (ids.length > 0) setModels(mergeAssistantModels(ids));
      setModelsLoaded(true);
    } catch {
      // Keep local defaults when the endpoint is unavailable.
    } finally {
      setModelsLoading(false);
    }
  }, [modelsLoaded, modelsLoading]);

  function updateSessionMessages(sessionId: number, nextMessages: ChatMessage[], title?: string) {
    setSessions((previous) => {
      const next = previous
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
      persistSessions(scope, next);
      return next;
    });
  }

  function createSession(title = 'New chat'): ChatSession {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: Date.now(),
      title,
      created_at: now,
      updated_at: now,
      messages: [],
    };
    setSessions((previous) => {
      const next = [session, ...previous].slice(0, MAX_SESSIONS);
      persistSessions(scope, next);
      return next;
    });
    setActiveId(session.id);
    setMessages([]);
    return session;
  }

  function startNewChat() {
    if (isStreaming) return;
    setConfirmDeleteId(null);
    createSession();
    setMessages([]);
    setInput('');
  }

  function openSession(session: ChatSession) {
    if (isStreaming) return;
    setConfirmDeleteId(null);
    setActiveId(session.id);
    setMessages(session.messages ?? []);
  }

  function deleteSession(sessionId: number) {
    if (isStreaming) return;
    setConfirmDeleteId(null);
    setSessions((previous) => {
      const next = previous.filter((session) => session.id !== sessionId);
      persistSessions(scope, next);
      if (activeId === sessionId) {
        setActiveId(next[0]?.id ?? null);
        setMessages(next[0]?.messages ?? []);
      }
      return next;
    });
  }

  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if ((!text && chatAttachments.length === 0) || isStreaming) return;

    const pendingAttachments = chatAttachments;
    const attachmentNames = pendingAttachments.map((attachment) => attachment.name);
    const displayText = text || 'Please review the attached document(s).';
    const firstMessageTitle = chatTitleFromFirstMessage(
      text || attachmentNames[0] || 'Document review',
    );

    let session = activeSession;
    let sessionTitle: string | undefined;
    if (!session) {
      sessionTitle = firstMessageTitle;
      session = createSession(sessionTitle);
    } else if (session.messages.length === 0) {
      sessionTitle = firstMessageTitle;
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: displayText,
      attachmentNames,
    };
    const nextMessages = [...messages, userMessage];
    let assistantMessage: ChatMessage = { role: 'assistant', content: '', sources: [] };
    const responseStartedAt = performance.now();

    setInput('');
    setChatAttachments([]);
    setAttachmentStatus('');
    setIsStreaming(true);
    setMessages([...nextMessages, assistantMessage]);

    try {
      const response = await fetch('/api/knowledge-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          model,
          reasoningEffort,
          attachments: pendingAttachments,
          scope,
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
      updateSessionMessages(session.id, [...nextMessages, assistantMessage], sessionTitle);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Assistant could not answer right now';
      const finalMessages: ChatMessage[] = [
        ...nextMessages,
        {
          role: 'assistant',
          content: `I could not reach the knowledge base assistant yet. ${message}`,
          sources: [],
        },
      ];
      setMessages(finalMessages);
      updateSessionMessages(session.id, finalMessages, sessionTitle);
    } finally {
      setIsStreaming(false);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
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

  function handleResizeStart(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    resizeStartRef.current = { startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }

  function handleResizeMove(event: ReactPointerEvent<HTMLElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    setHeight(clampHeight(start.startHeight + (start.startY - event.clientY)));
  }

  function handleResizeEnd(event: ReactPointerEvent<HTMLElement>) {
    resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  const terminalStyle: CSSProperties = {
    height,
    background: isOpen ? 'var(--paper-surface)' : '#EFE8D6',
    borderTopColor: 'rgba(169, 193, 177, 0.7)',
  };

  const headerItemAnim = headerClosing
    ? 'terminal-boot-conceal'
    : 'terminal-boot-reveal';

  const terminalClassName =
    'fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden border-t text-gray-100';

  return (
    <>
      <section
        style={terminalStyle}
        className={terminalClassName}
      >
      <div
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        className="group absolute inset-x-0 -top-1.5 z-10 flex h-3 cursor-row-resize items-center justify-center"
      >
        <span
          className={`h-1.5 w-14 rounded-full border border-[rgba(169,193,177,0.7)] shadow-[0_1px_4px_rgba(74,91,70,0.10)] transition-colors ${
            isResizing ? 'bg-[#8faf9a]' : 'bg-[#A9C1B1] group-hover:bg-[#8faf9a]'
          }`}
        />
      </div>
      {/* Drag the top edge to open, resize, or collapse — like resizing a garden card. */}
      {/* Header — also a drag handle so you can pull the terminal open from the bar. */}
      <header
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        style={{ background: '#EFE8D6' }}
        className={`flex shrink-0 cursor-row-resize touch-none select-none items-center gap-3 border-b border-[rgba(169,193,177,0.55)] px-4 ${
          headerMounted ? 'py-2.5' : 'h-full justify-center py-0'
        }`}
      >
        {headerMounted ? (
          <>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setSidebarOpen((value) => !value)}
            style={{ animationDelay: '40ms' }}
            className={`${headerItemAnim} flex h-7 w-7 items-center justify-center rounded-md border border-gray-800 text-gray-400 transition hover:border-gray-700 hover:text-white`}
            title={sidebarOpen ? 'Hide history' : 'Show history'}
            aria-label="Toggle history"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>
          <div className="min-w-0">
            <p
              style={{ animationDelay: '210ms' }}
              className={`${headerItemAnim} truncate text-sm font-semibold text-[#172A22]`}
            >
              {isPublic ? 'Public knowledge assistant' : 'Breadboard Assistant'}
            </p>
            <p
              style={{ animationDelay: '300ms' }}
              className={`${headerItemAnim} truncate text-[11px] text-[#5F6F68]`}
            >
              {`${scopeTagline.charAt(0).toUpperCase()}${scopeTagline.slice(1)}`}
            </p>
          </div>
          </>
        ) : null}
      </header>

      {isOpen ? (
      <div className="flex min-h-0 flex-1">
        {/* History sidebar */}
        {sidebarOpen ? (
          <aside className="flex w-56 shrink-0 flex-col border-r border-gray-800 bg-gray-950">
            <div className="p-2">
              <button
                type="button"
                onClick={startNewChat}
                disabled={isStreaming}
                className="flex w-full items-center gap-2 rounded-md border border-gray-800 bg-gray-900/60 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-700 hover:bg-gray-900 disabled:opacity-50"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New chat
              </button>
            </div>
            <div className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-gray-600">
              Recents
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {sessions.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-gray-600">No chats yet</p>
              ) : (
                <ul className="space-y-0.5">
                  {sessions.map((session) => (
                    <li key={session.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openSession(session)}
                        disabled={isStreaming}
                        className={`min-w-0 flex-1 rounded-md px-2.5 py-2 text-left transition ${
                          session.id === activeId
                            ? 'bg-gray-800 text-white'
                            : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium">{session.title}</span>
                          <span className="shrink-0 text-[10px] text-gray-600">
                            {formatChatTime(session.updated_at)}
                          </span>
                        </div>
                      </button>
                      {confirmDeleteId === session.id ? (
                        <span className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => deleteSession(session.id)}
                            disabled={isStreaming}
                            className="rounded p-1 text-red-400 transition hover:text-red-300 disabled:opacity-30"
                            aria-label="Confirm delete chat"
                            title="Confirm delete"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded p-1 text-gray-500 transition hover:text-white"
                            aria-label="Cancel delete chat"
                            title="Cancel"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="m6 6 12 12M18 6 6 18" />
                            </svg>
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(session.id)}
                          disabled={isStreaming}
                          className="shrink-0 rounded p-1 text-gray-600 opacity-0 transition hover:text-red-300 group-hover:opacity-100 disabled:opacity-30"
                          aria-label="Delete chat"
                          title="Delete chat"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.228 5.79 18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .563c.34-.059.68-.114 1.022-.166m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                            />
                          </svg>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        ) : null}

        {/* Chat column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-5">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center gap-5 py-8 text-center">
                  <div>
                    <p className="text-lg font-medium text-white">
                      {isPublic ? 'Ask the public knowledge hub' : 'Ask your whole knowledge base'}
                    </p>
                    <p className="mt-1.5 text-sm text-gray-500">
                      {isPublic
                        ? 'Answers are grounded in the notes across every public garden on Breadboard.'
                        : 'Answers are grounded in the notes across every garden you own.'}
                    </p>
                  </div>
                  <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
                    {SUGGESTED_PROMPTS[scope].map((prompt) => (
                      <button
                        type="button"
                        key={prompt}
                        onClick={() => void sendMessage(prompt)}
                        disabled={isStreaming}
                        className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5 text-left text-sm text-gray-300 transition hover:border-gray-600 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {messages.map((message, index) => (
                    <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'flex justify-end' : ''}>
                      <div className={message.role === 'user' ? 'max-w-[80%]' : 'w-full'}>
                        {message.role === 'user' ? (
                          <div className="rounded-2xl rounded-br-sm bg-gray-800 px-4 py-2.5 text-sm leading-6 text-gray-100">
                            <p className="whitespace-pre-wrap">{message.content}</p>
                            {message.attachmentNames?.length ? (
                              <p className="mt-1.5 text-[11px] text-gray-400">
                                {message.attachmentNames.join(' · ')}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <div className="text-sm leading-7 text-gray-200">
                            {message.thinking ? (
                              <details className="mb-2 rounded-md border border-gray-800 bg-gray-900/50 px-3 py-2 text-xs text-gray-400">
                                <summary className="cursor-pointer text-gray-300">Thinking</summary>
                                <pre className="mt-2 whitespace-pre-wrap font-sans leading-5">{message.thinking}</pre>
                              </details>
                            ) : null}
                            {message.content ? (
                              <ChatMarkdown content={message.content} compact />
                            ) : (
                              <span className="text-gray-500">Reading across your gardens...</span>
                            )}
                            {message.sources && message.sources.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {message.sources.map((source) => (
                                  <span
                                    key={source}
                                    className="rounded-full border border-gray-800 bg-gray-900/60 px-2 py-0.5 text-[10px] text-gray-500"
                                  >
                                    {source}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 px-4 pb-3">
            <input
              ref={attachmentInputRef}
              type="file"
              accept={CHAT_ATTACHMENT_ACCEPT}
              multiple
              onChange={handleAttachmentInput}
              className="hidden"
            />
            <AssistantComposer
              className="mx-auto w-full max-w-3xl"
              compact
              value={input}
              onChange={setInput}
              onSubmit={() => void sendMessage()}
              onKeyDown={handleInputKeyDown}
              placeholder={isPublic ? 'Ask anything across all public gardens...' : 'Ask anything across your gardens...'}
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
            />
          </div>
        </div>
      </div>
      ) : null}
      </section>
    </>
  );
}
