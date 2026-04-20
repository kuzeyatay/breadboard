'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import ChatMarkdown from '@/app/components/chat-markdown';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  thinking?: string;
}

interface GraphStats {
  documents: number;
  topics: number;
  generatedNotes: number;
  links: number;
  words: number;
}

interface Props {
  activeClusterSlug: string | null;
  activeClusterName?: string;
  initialOpen?: boolean;
}

const EMPTY_STATS: GraphStats = {
  documents: 0,
  topics: 0,
  generatedNotes: 0,
  links: 0,
  words: 0,
};

const SUGGESTED_PROMPTS = [
  'What are the main topics in this cluster?',
  'Where is this concept discussed in the source pages?',
  'Summarize the source tree and how the topics connect.',
  'Which notes should I read first?',
];
const PANEL_WIDTH_KEY = 'second-brain:garden-assistant-width';
const DEFAULT_PANEL_WIDTH = 420;
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 680;

function clampPanelWidth(width: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

export default function GardenAssistant({
  activeClusterSlug,
  activeClusterName,
  initialOpen = false,
}: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const previousClusterRef = useRef<string | null>(activeClusterSlug);
  const [chatOpen, setChatOpen] = useState(initialOpen);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [stats, setStats] = useState<GraphStats>(EMPTY_STATS);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);

  const hasActiveCluster = Boolean(activeClusterSlug);
  const clusterLabel = activeClusterName || activeClusterSlug || 'Open a cluster';

  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(savedWidth)) setPanelWidth(clampPanelWidth(savedWidth));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    if (previousClusterRef.current === activeClusterSlug) return;
    previousClusterRef.current = activeClusterSlug;
    setInput('');
    setMessages([]);
  }, [activeClusterSlug]);

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

  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || isStreaming || !activeClusterSlug) return;

    const userMessage: ChatMessage = { role: 'user', content: text };
    const nextMessages = [...messages, userMessage];
    let assistantMessage: ChatMessage = { role: 'assistant', content: '', sources: [] };

    setInput('');
    setIsStreaming(true);
    setMessages([...nextMessages, assistantMessage]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterSlug: activeClusterSlug,
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          model: 'gpt-5.4',
          thinking: false,
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
          } catch {
            // Ignore malformed stream fragments and keep reading.
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Assistant could not answer right now';
      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: `I could not reach the assistant for this cluster yet. ${message}`,
          sources: [],
        },
      ]);
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

  const chatPanelStyle = {
    '--assistant-panel-width': `${panelWidth}px`,
  } as CSSProperties;
  const resizeHandleStyle = {
    right: panelWidth,
  } as CSSProperties;

  const chatPanel = (
    <aside
      className="fixed inset-x-3 bottom-3 top-20 z-40 flex flex-col overflow-hidden rounded-md border border-gray-800 bg-gray-950 text-gray-100 shadow-2xl lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:w-[var(--assistant-panel-width)] lg:rounded-none lg:border-y-0 lg:border-l lg:border-r-0"
      style={chatPanelStyle}
    >
      <div className="border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Assistant</p>
            <p className="truncate text-xs text-gray-400">
              {hasActiveCluster ? `${clusterLabel} knowledge map` : 'Open a cluster or note to ask its map'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
            { label: 'Topics', value: stats.topics },
            { label: 'Notes', value: stats.generatedNotes },
            { label: 'Links', value: stats.links },
          ].map((item) => (
            <div key={item.label} className="rounded-md border border-gray-800 bg-gray-950/60 px-2 py-1.5">
              <div className="font-semibold text-gray-100">{formatNumber(item.value)}</div>
              <div>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-100">
                {hasActiveCluster ? 'Ask about the map, notes, pages, or relationships.' : 'Open a cluster to start asking.'}
              </p>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                {hasActiveCluster
                  ? 'I can use the cluster inventory, topic notes, source locations, and graph links as context.'
                  : 'The assistant follows the cluster or note you open from this library view.'}
              </p>
              <p className="mt-2 text-xs text-gray-500">
                {formatNumber(stats.words)} words are indexed for this cluster.
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
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
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
                      <span className="text-gray-500">Reading the knowledge map...</span>
                    )
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
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

      <form
        className="border-t border-gray-800 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={hasActiveCluster ? 'Ask about a topic, page, source, or link...' : 'Open a cluster first...'}
          rows={3}
          disabled={!hasActiveCluster}
          className="block w-full resize-none rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm leading-6 text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">Enter to send, Shift+Enter for a new line</span>
          <button
            type="submit"
            disabled={!input.trim() || isStreaming || !hasActiveCluster}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
          >
            {isStreaming ? 'Thinking' : 'Send'}
          </button>
        </div>
      </form>
    </aside>
  );

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
    </>
  ) : (
    <button
      type="button"
      onClick={() => setChatOpen(true)}
      className="fixed bottom-5 right-5 z-30 rounded-md border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-semibold text-gray-100 shadow-xl transition hover:border-gray-500 hover:bg-gray-900 lg:absolute"
    >
      Ask map
    </button>
  );
}
