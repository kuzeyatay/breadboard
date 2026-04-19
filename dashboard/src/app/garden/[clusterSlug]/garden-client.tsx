'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import ChatMarkdown from '@/app/components/chat-markdown';
import { QUARTZ_BASE_URL, quartzUrl } from '@/lib/quartz-url';

interface Props {
  clusterSlug: string;
  clusterName: string;
  note?: string;
  initialChatOpen?: boolean;
  trackPublicView?: boolean;
}

interface QuartzMessage {
  type?: string;
  slug?: string;
  flagColor?: string;
  content?: string;
  fileName?: string;
  mimeType?: string;
  dataUrl?: string;
  images?: Array<{
    fileName?: string;
    mimeType?: string;
    dataUrl?: string;
  }>;
}

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

function decodeQuartzSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function noteSlugFromQuartzSlug(slug: string): string {
  const decoded = decodeQuartzSlug(slug);
  return decoded.replace(/^\/+|\/+$/g, '').trim();
}

function clusterFromQuartzSlug(slug: string): string {
  const decoded = decodeQuartzSlug(slug).replace(/^\/+|\/+$/g, '');
  const parts = decoded.split('/').filter(Boolean);
  return parts[0] || '';
}

function quartzUrlWithRefresh(...segments: string[]): string {
  const url = new URL(quartzUrl(...segments));
  url.searchParams.set('refresh', Date.now().toString());
  return url.toString();
}

export default function GardenClient({
  clusterSlug,
  clusterName,
  note,
  initialChatOpen = false,
  trackPublicView = false,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(initialChatOpen);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeCluster, setActiveCluster] = useState(clusterSlug);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [stats, setStats] = useState<GraphStats>(EMPTY_STATS);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const quartzOrigin = useMemo(() => {
    try {
      return new URL(QUARTZ_BASE_URL).origin;
    } catch {
      return '';
    }
  }, []);

  useEffect(() => {
    setChatOpen(true);
  }, []);

  useEffect(() => {
    if (!trackPublicView) return;

    fetch(`/api/clusters/${encodeURIComponent(clusterSlug)}/view`, { method: 'POST' }).catch(() => {
      // Popularity is best-effort and should not interrupt reading.
    });
  }, [clusterSlug, trackPublicView]);

  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(savedWidth)) setPanelWidth(clampPanelWidth(savedWidth));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/knowledge-graph?clusterSlug=${encodeURIComponent(activeCluster)}`)
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
  }, [activeCluster]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isStreaming]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (quartzOrigin && event.origin !== quartzOrigin) return;

      const data = event.data as QuartzMessage;
      if (!data || !data.type) return;

      if (data.type === 'second-brain:navigate' && data.slug) {
        const cluster = clusterFromQuartzSlug(data.slug);
        if (cluster) {
          setActiveCluster(cluster);
          window.dispatchEvent(new CustomEvent('sb:active-cluster', { detail: { cluster } }));
        }
        return;
      }

      if (!data.slug) return;

      const slug = noteSlugFromQuartzSlug(data.slug);
      const effectiveCluster = clusterFromQuartzSlug(data.slug) || clusterSlug;
      const postToQuartz = (message: object) => {
        iframeRef.current?.contentWindow?.postMessage(message, quartzOrigin || '*');
      };

      if (data.type === 'second-brain:set-flag-color') {
        const flagColor = typeof data.flagColor === 'string' ? data.flagColor : '';

        fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(effectiveCluster)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flagColor }),
        })
          .then((response) => {
            const ok = response.ok;
            postToQuartz({ type: 'second-brain:flag-color-result', slug: data.slug, ok });
            if (ok) {
              window.setTimeout(() => {
                iframeRef.current?.contentWindow?.location.reload();
              }, 900);
            }
          })
          .catch(() => {
            postToQuartz({ type: 'second-brain:flag-color-result', slug: data.slug, ok: false });
          });
      }

      if (data.type === 'second-brain:get-markdown') {
        fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(effectiveCluster)}`)
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            postToQuartz({
              type: 'second-brain:markdown-content-result',
              slug: data.slug,
              ok: response.ok && body.success,
              content: typeof body.content === 'string' ? body.content : '',
              error: body.error,
            });
          })
          .catch(() => {
            postToQuartz({
              type: 'second-brain:markdown-content-result',
              slug: data.slug,
              ok: false,
              error: 'Could not open markdown',
            });
          });
      }

      if (data.type === 'second-brain:save-markdown') {
        const content = typeof data.content === 'string' ? data.content : '';

        fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(effectiveCluster)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            const ok = response.ok && body.success;
            postToQuartz({
              type: 'second-brain:markdown-save-result',
              slug: data.slug,
              ok,
              error: body.error,
            });
            if (ok) {
              window.setTimeout(() => {
                iframeRef.current?.contentWindow?.location.reload();
              }, 900);
            }
          })
          .catch(() => {
            postToQuartz({
              type: 'second-brain:markdown-save-result',
              slug: data.slug,
              ok: false,
              error: 'Could not save markdown',
            });
          });
      }

      if (data.type === 'second-brain:upload-markdown-image' || data.type === 'second-brain:upload-markdown-images') {
        fetch('/api/markdown-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clusterSlug: effectiveCluster,
            noteSlug: slug,
            fileName: data.fileName,
            mimeType: data.mimeType,
            dataUrl: data.dataUrl,
            images: data.images,
          }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            postToQuartz({
              type: 'second-brain:markdown-image-result',
              slug: data.slug,
              ok: response.ok && body.success,
              markdown: typeof body.markdown === 'string' ? body.markdown : '',
              count: typeof body.count === 'number' ? body.count : undefined,
              error: body.error,
            });
          })
          .catch(() => {
            postToQuartz({
              type: 'second-brain:markdown-image-result',
              slug: data.slug,
              ok: false,
              error: 'Could not add image',
            });
          });
      }

      if (data.type === 'second-brain:delete-markdown') {
        fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(effectiveCluster)}`, {
          method: 'DELETE',
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            const ok = response.ok && body.success;
            postToQuartz({
              type: 'second-brain:markdown-delete-result',
              slug: data.slug,
              ok,
              error: body.error,
            });
            if (ok) {
              window.setTimeout(() => {
                if (iframeRef.current) iframeRef.current.src = quartzUrlWithRefresh(effectiveCluster);
              }, 700);
            }
          })
          .catch(() => {
            postToQuartz({
              type: 'second-brain:markdown-delete-result',
              slug: data.slug,
              ok: false,
              error: 'Could not delete markdown',
            });
          });
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [clusterSlug, quartzOrigin]);

  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || isStreaming) return;

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
          clusterSlug,
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

  const chatPanel = (
    <aside
      className="fixed inset-x-3 bottom-3 top-20 z-40 flex flex-col overflow-hidden rounded-md border border-gray-800 bg-gray-950 text-gray-100 shadow-2xl lg:relative lg:inset-auto lg:z-auto lg:h-full lg:w-[var(--assistant-panel-width)] lg:shrink-0 lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r-0 lg:shadow-none"
      style={chatPanelStyle}
    >
      <div className="border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Assistant</p>
            <p className="truncate text-xs text-gray-400">{clusterName} knowledge map</p>
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
              <p className="text-sm font-medium text-gray-100">Ask about the map, notes, pages, or relationships.</p>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                I can use the cluster inventory, topic notes, source locations, and graph links as context.
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
                  disabled={isStreaming}
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
          placeholder="Ask about a topic, page, source, or link..."
          rows={3}
          className="block w-full resize-none rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm leading-6 text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-gray-500"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">Enter to send, Shift+Enter for a new line</span>
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
          >
            {isStreaming ? 'Thinking' : 'Send'}
          </button>
        </div>
      </form>
    </aside>
  );

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-gray-950">
      <iframe
        ref={iframeRef}
        src={note ? quartzUrl(clusterSlug, note) : quartzUrl(clusterSlug)}
        className={`h-full min-w-0 flex-1 border-0 bg-gray-950 ${isResizing ? 'pointer-events-none' : ''}`}
        title={`${clusterName} garden`}
      />

      {chatOpen ? (
        <>
          <button
            type="button"
            aria-label="Resize assistant panel"
            title="Drag to resize"
            onPointerDown={handlePanelResizeStart}
            onPointerMove={handlePanelResizeMove}
            onPointerUp={handlePanelResizeEnd}
            onPointerCancel={handlePanelResizeEnd}
            className={`relative z-30 hidden h-full w-2 shrink-0 cursor-col-resize items-center justify-center border-l border-gray-900 border-r border-gray-800 bg-gray-950 transition-colors hover:bg-gray-900 lg:flex ${isResizing ? 'bg-gray-900' : ''}`}
          >
            <span className={`h-16 w-px rounded-full transition-colors ${isResizing ? 'bg-gray-400' : 'bg-gray-700'}`} />
          </button>
          {chatPanel}
        </>
      ) : (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-semibold text-gray-100 shadow-2xl transition hover:border-gray-500 hover:bg-gray-900"
        >
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337 5.972 5.972 0 0 1-4.035 1.057 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
          </svg>
          Ask map
        </button>
      )}
    </div>
  );
}
