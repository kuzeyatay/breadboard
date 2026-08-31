'use client';

import {
  type ChangeEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import AssistantComposer from '@/app/components/assistant-composer';
import {
  restoreQueuedFollowUpDraft,
  useQueuedFollowUps,
} from '@/app/components/hermes/queued-follow-ups';
import { useComposerInset } from '@/app/components/chat/use-composer-inset';
import ChatDisclaimer from '@/app/components/chat/chat-disclaimer';
import ChatGreetingEmptyState from '@/app/components/hermes/chat-greeting-empty-state';
import { useChatGreeting } from '@/app/components/hermes/use-chat-greeting';
import AssistantMessageActions from '@/app/components/assistant-message-actions';
import AssistantResponseMeta from '@/app/components/assistant-response-meta';
import { isDirectModeEnabled } from '@/app/components/use-direct-mode';
import { isPersonalizeEnabled } from '@/app/components/use-personalize';
import {
  chatAutoScrollContentKey,
  chatAutoScrollResponseKey,
  useChatAutoScroll,
  useChatVirtualBridge,
} from '@/app/components/use-chat-auto-scroll';
import VirtualizedMessageList from '@/app/components/chat/virtualized-message-list';
import {
  chatRowKey,
  estimateChatRowHeight,
} from '@/app/components/chat/chat-row-identity';
import ChatJumpToBottom from '@/app/components/chat-jump-to-bottom';
import ChatMessageRail, {
  type ChatMessageRailItem,
} from '@/app/components/chat-message-rail';
import ChatMarkdown from '@/app/components/chat-markdown';
import { useSmoothStreamText } from '@/app/components/chat/use-smooth-stream-text';
import ChatTimeSeparator from '@/app/components/chat-time-separator';
import { useAssistantIntelligence } from '@/app/components/use-assistant-intelligence';
import { useAssistantModels } from '@/app/components/use-assistant-models';
import { UserMessageText } from '@/app/components/hermes/command-text';
import CollapsibleUserMessage from '@/app/components/chat/collapsible-user-message';
import {
  CHAT_ATTACHMENT_ACCEPT,
  extractChatAttachments,
  type ChatAttachment,
} from '@/lib/chat-attachments';
import { distillAttachments } from '@/lib/document-skills/client';
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from '@/lib/chat-token-usage';
import { chatTimeSeparatorLabels } from '@/lib/chat-time-separators';
import { requestChatTitleFromFirstMessage } from '@/lib/chat-session-title';
import { forgetChatDrafts } from '@/lib/conversations/drafts';
import { useChatDraft } from '@/app/components/hermes/use-chat-draft';
import { useTerminalHeaderClickGuard } from '@/app/components/terminal-header-click-guard';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  sources?: string[];
  attachmentNames?: string[];
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
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
const MAX_SESSIONS = 40;
// Collapsed height shows just the grab bar; drag the top edge up to open it,
// the same way garden cards are resized.
const COLLAPSED_HEIGHT = 48;
const MIN_HEIGHT = COLLAPSED_HEIGHT;

// Bottom edge of the breadboard navbar, so a fully opened terminal stops right
// below the main header instead of covering it.
// Clamped because the navbar scrolls with the page: a negative bottom would
// make the dock taller than the viewport and hide its header off the top edge.
function navOffset(): number {
  if (typeof document === 'undefined') return 64;
  const nav = document.querySelector('nav');
  if (!nav) return 64;
  const bottom = Math.ceil(nav.getBoundingClientRect().bottom);
  return Math.min(Math.max(0, bottom), window.innerHeight);
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

/** Wrapped so the list's `(item, index)` call cannot land on the options bag. */
const estimateTerminalRowHeight = (message: ChatMessage) =>
  estimateChatRowHeight(message);

type TranscriptRowProps = {
  message: ChatMessage;
  /** Row identity, so a folded long message stays folded across remounts. */
  messageKey: string;
  /** The separator that belongs above this message, if any. */
  separatorLabel: string | null;
  /** True only for the newest answer while it is still being written. */
  responding: boolean;
  onRetry?: () => void;
};

/**
 * One transcript row. Extracted and memoized so a streaming answer re-renders
 * only itself, not every message still mounted around the fold.
 */
const TranscriptRow = memo(function TranscriptRow({
  message,
  messageKey,
  separatorLabel,
  responding,
  onRetry,
}: TranscriptRowProps) {
  return (
    <div className={separatorLabel ? 'space-y-3' : undefined}>
      {separatorLabel ? (
        <ChatTimeSeparator
          label={separatorLabel}
          dateTime={message.createdAt}
        />
      ) : null}
      <div className={message.role === 'user' ? 'flex justify-end' : ''}>
        <div className={message.role === 'user' ? 'max-w-[80%]' : 'w-full'}>
        {message.role === 'user' ? (
          <div className="neu-chat-message neu-chat-message-user rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-6">
            <CollapsibleUserMessage messageKey={messageKey}>
              <UserMessageText content={message.content} />
            </CollapsibleUserMessage>
            {message.attachmentNames?.length ? (
              <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
                {message.attachmentNames.join(' · ')}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="text-sm leading-7 text-gray-200">
            <AssistantResponseMeta
              active={responding}
              usage={message.usage}
              responseDurationMs={message.responseDurationMs}
            />
            {message.content ? (
              <ChatMarkdown content={message.content} compact />
            ) : (
              <span className="text-gray-500">Reading across your gardens...</span>
            )}
            {!responding ? (
              <AssistantMessageActions
                content={message.content || 'Response unavailable'}
                onRetry={onRetry}
              />
            ) : null}
          </div>
        )}
        </div>
      </div>
    </div>
  );
});

export default function KnowledgeTerminal({ scope }: Props) {
  const resizeStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const [height, setHeight] = useState(COLLAPSED_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const headerClickGuard = useTerminalHeaderClickGuard();

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
      }, 200);
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
  // Same greeting engine the runtime terminal uses, so the legacy transport
  // opens on the same words rather than on a heading of its own.
  const chatGreeting = useChatGreeting({ scope, temporary: false });
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fillComposerWithPrompt = useCallback((prompt: string) => {
    setInput(prompt);
    window.setTimeout(() => {
      const composer = composerTextareaRef.current;
      if (!composer) return;
      composer.focus();
      composer.setSelectionRange(composer.value.length, composer.value.length);
    }, 0);
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const timeSeparators = useMemo(
    () => chatTimeSeparatorLabels(messages),
    [messages],
  );
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  // The chat this terminal minted out of its own blank state, so an unsent
  // draft can follow it there and nowhere else. See useChatDraft.
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  // The in-flight answer's request, so the composer's stop control can cancel
  // it instead of leaving a working turn unstoppable.
  const streamControllerRef = useRef<AbortController | null>(null);
  // Messages typed while an answer is streaming queue above the composer
  // instead of being dropped, and send as ordinary follow-ups once it settles.
  // This transport has no runtime session behind it, so a queued message can
  // never steer the active answer — it always waits its turn.
  const { queueFollowUp, headerContent: queuedFollowUpsHeader } =
    useQueuedFollowUps({
      conversationKey: activeId === null ? null : String(activeId),
      runInFlight: isStreaming,
      steerableRunActive: false,
      onRestoreDraft: (text) =>
        restoreQueuedFollowUpDraft(text, setInput, composerTextareaRef),
      onSendQueued: async (text) => {
        await sendMessage(text);
      },
    });
  // The newest answer's text is revealed at a readable pace rather than drawn
  // straight from the buffer, so a reply that arrives in bursts (or whole)
  // still reads as a stream. Older messages render their content directly.
  const newestMessage = messages[messages.length - 1];
  const revealedAssistantContent = useSmoothStreamText(
    newestMessage?.role === 'assistant' ? newestMessage.content : '',
    isStreaming,
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // Unsent text outlives a reload, filed under the chat it was typed in. These
  // chats are already a per-scope thing in this browser, so their drafts are too.
  const draftSurface = `knowledge_terminal:${scope}`;
  useChatDraft({
    surface: draftSurface,
    sessionId: activeId === null ? null : String(activeId),
    createdSessionId: createdId === null ? null : String(createdId),
    value: input,
    onRestore: setInput,
  });

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

  const activeSession = sessions.find((session) => session.id === activeId) ?? null;
  const isPublic = scope === 'public';
  const scopeTagline = isPublic ? 'chat across all public gardens' : 'chat across every garden you own';

  useEffect(() => {
    const onResize = () => setHeight((current) => clampHeight(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Switching the dashboard between My/Public gardens re-points the terminal at
  // that scope's history and clears the open chat so its welcome screen shows.
  useEffect(() => {
    setSessions(loadSessions(scope));
    setActiveId(null);
    setCreatedId(null);
    setMessages([]);
    setConfirmDeleteId(null);
    setInput('');
  }, [scope]);

  const transcriptVirtual = useChatVirtualBridge();
  const composerInset = useComposerInset();
  const {
    ref: transcriptScrollRef,
    awayFromBottom: transcriptAwayFromBottom,
    scrollToBottom: jumpToNewestMessage,
  } = useChatAutoScroll<HTMLDivElement>({
    isResponding: isStreaming,
    responseKey: chatAutoScrollResponseKey(messages),
    contentKey: chatAutoScrollContentKey(messages),
    enabled: isOpen,
    conversationKey: activeId,
    virtual: transcriptVirtual,
  });

  // One tick per question asked. The terminal hands the virtualizer `messages`
  // untouched, so a message's place in the conversation is also its row.
  const railItems = useMemo<ChatMessageRailItem[]>(
    () =>
      messages.flatMap((message, index) =>
        message.role === 'user'
          ? [{ rowIndex: index, label: message.content }]
          : [],
      ),
    [messages],
  );

  // What the composer's arrow keys recall — the same messages the rail ticks,
  // as text rather than as landmarks.
  const sentMessages = useMemo(
    () =>
      messages.flatMap((message) => (message.role === 'user' ? [message.content] : [])),
    [messages],
  );

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

  function updateSessionTitle(sessionId: number, title: string) {
    setSessions((previous) => {
      const next = previous.map((session) =>
        session.id === sessionId ? { ...session, title } : session,
      );
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
    setCreatedId(session.id);
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
    // An existing chat, so nothing typed in the blank composer belongs to it.
    setCreatedId(null);
    setMessages(session.messages ?? []);
  }

  function deleteSession(sessionId: number) {
    if (isStreaming) return;
    setConfirmDeleteId(null);
    forgetChatDrafts(window.localStorage, draftSurface, [String(sessionId)]);
    setSessions((previous) => {
      const next = previous.filter((session) => session.id !== sessionId);
      persistSessions(scope, next);
      if (activeId === sessionId) {
        setActiveId(next[0]?.id ?? null);
        setCreatedId(null);
        setMessages(next[0]?.messages ?? []);
      }
      return next;
    });
  }

  async function sendMessage(
    textOverride?: string,
    historyOverride?: ChatMessage[],
  ) {
    const text = (textOverride ?? input).trim();
    const pendingAttachments = historyOverride ? [] : chatAttachments;
    if ((!text && pendingAttachments.length === 0) || isStreaming) return;

    const history = historyOverride ?? messages;
    const attachmentNames = pendingAttachments.map((attachment) => attachment.name);
    const displayText = text || 'Please review the attached document(s).';
    let session = activeSession;
    if (!session) {
      session = createSession();
    }
    const sessionId = session.id;
    const isFirstPrompt = session.messages.length === 0;
    if (isFirstPrompt) {
      void requestChatTitleFromFirstMessage(
        text || attachmentNames[0] || 'Document review',
        model,
      ).then((title) => {
        if (title) updateSessionTitle(sessionId, title);
      });
    }

    const turnCreatedAt = new Date().toISOString();
    const userMessage: ChatMessage = {
      role: 'user',
      content: displayText,
      createdAt: turnCreatedAt,
      attachmentNames,
    };
    const nextMessages = [...history, userMessage];
    let assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      createdAt: turnCreatedAt,
      sources: [],
    };
    const responseStartedAt = performance.now();

    setInput('');
    setChatAttachments([]);
    setAttachmentStatus('');
    setIsStreaming(true);
    setMessages([...nextMessages, assistantMessage]);
    const controller = new AbortController();
    streamControllerRef.current = controller;

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
          adhdMode: isDirectModeEnabled(),
          personalize: isPersonalizeEnabled(),
        }),
        signal: controller.signal,
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
      assistantMessage = {
        ...assistantMessage,
        responseDurationMs: Math.round(performance.now() - responseStartedAt),
      };
      const finalMessages = [...nextMessages, assistantMessage];
      setMessages(finalMessages);
      updateSessionMessages(session.id, finalMessages);
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      const message = error instanceof Error ? error.message : 'Assistant could not answer right now';
      const finalMessages: ChatMessage[] = [
        ...nextMessages,
        {
          role: 'assistant',
          content: aborted
            ? 'The request was stopped.'
            : `I could not reach the knowledge base assistant yet. ${message}`,
          createdAt: turnCreatedAt,
          sources: [],
          responseDurationMs: Math.round(performance.now() - responseStartedAt),
        },
      ];
      setMessages(finalMessages);
      updateSessionMessages(session.id, finalMessages);
    } finally {
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
      setIsStreaming(false);
    }
  }

  function retryAssistantMessage(messageIndex: number) {
    if (isStreaming) return;
    let userIndex = messageIndex - 1;
    while (userIndex >= 0 && messages[userIndex]?.role !== 'user') {
      userIndex -= 1;
    }
    const previousUser = messages[userIndex];
    if (!previousUser || previousUser.role !== 'user') return;
    if (previousUser.attachmentNames?.length) {
      setAttachmentStatus('Reattach the original document before trying this response again.');
      return;
    }
    void sendMessage(previousUser.content, messages.slice(0, userIndex));
  }

  const renderTranscriptRow = useCallback(
    (message: ChatMessage, index: number) => {
      const isNewest = index === messages.length - 1;
      const paced =
        isNewest &&
        message.role === 'assistant' &&
        revealedAssistantContent !== message.content;
      return (
        <TranscriptRow
          message={paced ? { ...message, content: revealedAssistantContent } : message}
          messageKey={chatRowKey(message, index)}
          separatorLabel={timeSeparators[index] ?? null}
          responding={isStreaming && isNewest}
          onRetry={isNewest ? () => retryAssistantMessage(index) : undefined}
        />
      );
    },
    // `retryAssistantMessage` is re-declared every render and is reachable only
    // from the newest row, which re-renders anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages.length, timeSeparators, isStreaming, revealedAssistantContent],
  );

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

  function handleResizeStart(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    if (event.currentTarget.tagName === 'HEADER') {
      headerClickGuard.beginPointerSequence();
    }
    resizeStartRef.current = { startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    document.body.style.cursor = 'var(--bb-cursor-row-resize, row-resize)';
    document.body.style.userSelect = 'none';
  }

  function handleResizeMove(event: ReactPointerEvent<HTMLElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    setHeight(clampHeight(start.startHeight + (start.startY - event.clientY)));
  }

  function handleResizeEnd(event: ReactPointerEvent<HTMLElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    const moved = Math.abs(start.startY - event.clientY) >= 4;
    resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (event.currentTarget.tagName === 'HEADER') {
      headerClickGuard.endPointerSequence();
    }
    if (!moved && event.type !== 'pointercancel' && !isOpen) {
      setHeight(maxHeight());
    }
  }

  function handleHeaderClick(event: ReactMouseEvent<HTMLElement>) {
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, input, select, textarea')
    ) {
      return;
    }
    if (!headerClickGuard.shouldHandleClick() || isOpen) return;
    setHeight(maxHeight());
  }

  const terminalStyle: CSSProperties = {
    height,
    background: isOpen ? 'var(--paper-surface)' : 'var(--terminal-bar)',
    borderTopColor: 'rgba(169, 193, 177, 0.7)',
  };

  const headerItemAnim = headerClosing
    ? 'terminal-boot-conceal'
    : 'terminal-boot-reveal';

  const terminalClassName =
    'neu-surface-raised fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden border-t text-gray-100';

  return (
    <>
      <section
        // Same as the dashboard dock: a viewport-positioned bar gives up its
        // own right edge when the artifact dock opens beside it.
        data-terminal-dock
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
        onClick={handleHeaderClick}
        role={isOpen ? undefined : 'button'}
        tabIndex={isOpen ? undefined : 0}
        aria-expanded={isOpen ? undefined : false}
        aria-label={isOpen ? undefined : 'Open terminal'}
        title={isOpen ? 'Drag to resize the terminal' : 'Click or drag up to open the terminal'}
        onKeyDown={(event) => {
          if (
            !isOpen &&
            (event.key === 'Enter' || event.key === ' ')
          ) {
            event.preventDefault();
            setHeight(maxHeight());
          }
        }}
        style={{ background: 'var(--terminal-bar)' }}
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
            style={{ animationDelay: headerClosing ? '0ms' : '40ms' }}
            className={`${headerItemAnim} neu-button-icon flex h-7 w-7 items-center justify-center rounded-md border border-gray-800 text-gray-400 transition hover:border-gray-700 hover:text-white`}
            title={sidebarOpen ? 'Hide history' : 'Show history'}
            aria-label="Toggle history"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>
          <div className="min-w-0">
            <p
              style={{ animationDelay: headerClosing ? '0ms' : '210ms' }}
              className={`${headerItemAnim} truncate text-sm font-semibold text-[#172A22]`}
            >
              {isPublic ? 'Public knowledge assistant' : 'Breadboard Assistant'}
            </p>
            <p
              style={{ animationDelay: headerClosing ? '0ms' : '300ms' }}
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
                className="neu-button flex w-full items-center gap-2 rounded-md border border-gray-800 bg-gray-900/60 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-700 hover:bg-gray-900 disabled:opacity-50"
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
                            ? 'neu-selected bg-gray-800 text-white'
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
        <div className="relative flex min-w-0 flex-1 flex-col" style={composerInset.style}>
          {/* Positioning context for the jump control, so it floats at the foot
              of the transcript rather than below the composer. */}
          <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={transcriptScrollRef}
            className="bb-chat-scroller min-h-0 flex-1 overflow-y-auto"
          >
            <div className="bb-chat-scroll-tail mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-5">
              {messages.length === 0 ? (
                <ChatGreetingEmptyState
                  greeting={chatGreeting.greeting}
                  suggestions={chatGreeting.suggestions}
                  onSelectSuggestion={fillComposerWithPrompt}
                />
              ) : (
                <VirtualizedMessageList
                  surface="knowledge-terminal"
                  className="w-full"
                  items={messages}
                  scrollRef={transcriptScrollRef}
                  bridge={transcriptVirtual}
                  // What `space-y-5` drew between rows.
                  gap={20}
                  resetKey={activeId}
                  getItemKey={chatRowKey}
                  estimateSize={estimateTerminalRowHeight}
                  renderItem={renderTranscriptRow}
                />
              )}
              {messages.length > 0 ? <ChatDisclaimer /> : null}
            </div>
          </div>
            <ChatMessageRail
              surface="knowledge-terminal"
              items={railItems}
              scrollRef={transcriptScrollRef}
              bridge={transcriptVirtual}
            />
            <ChatJumpToBottom
              visible={transcriptAwayFromBottom}
              busy={isStreaming}
              onJump={jumpToNewestMessage}
            />
          </div>

          {/* Composer */}
          <div ref={composerInset.ref} className="bb-composer-overlay px-4 pb-3">
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
              textareaRef={composerTextareaRef}
              history={sentMessages}
              onSubmit={() => void sendMessage()}
              placeholder={isPublic ? 'Ask anything across all public gardens...' : 'Ask anything.'}
              isSending={isStreaming}
              runState={isStreaming ? 'running' : 'idle'}
              onQueueSteer={queueFollowUp}
              headerContent={queuedFollowUpsHeader}
              onStop={() => streamControllerRef.current?.abort()}
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
        </div>
      </div>
      ) : null}
      </section>
    </>
  );
}
