"use client";

// The dashboard terminal keeps the original Breadboard dock, history sidebar,
// and paper styling while OpenHarness remains responsible for the runtime,
// streaming events, permissions, tools, persistence, and skill review.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import KnowledgeTerminal from "@/app/components/knowledge-terminal";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import AgentRuntimePanel from "./agent-runtime-panel";
import {
  useAgentSession,
  type AgentMessage,
} from "./use-agent-session";
import {
  DEFAULT_ASSISTANT_MODELS,
  mergeAssistantModels,
} from "@/lib/ai-models";
import {
  CHAT_ATTACHMENT_ACCEPT,
  extractChatAttachments,
  type ChatAttachment,
} from "@/lib/chat-attachments";

type TerminalScope = "mine" | "public";

interface Props {
  scope: TerminalScope;
}

interface RuntimeHistorySession {
  id: string;
  title: string;
  updatedAt: string;
  messages: AgentMessage[];
}

const HEIGHT_KEY = "breadboard:knowledge-terminal-height";
const COLLAPSED_HEIGHT = 48;
const MIN_HEIGHT = COLLAPSED_HEIGHT;

const SUGGESTED_PROMPTS: Record<TerminalScope, string[]> = {
  mine: [
    "What topics span more than one of my gardens?",
    "Summarize everything I know about a concept across all gardens.",
    "Which gardens should I review before an exam?",
    "Find connections between ideas in different gardens.",
  ],
  public: [
    "What topics show up across multiple public gardens?",
    "Summarize what the public gardens cover about a concept.",
    "Which public gardens are the best starting point for a subject?",
    "Find connections between ideas in different public gardens.",
  ],
};

function navOffset(): number {
  if (typeof document === "undefined") return 64;
  const nav = document.querySelector("nav");
  return nav ? Math.ceil(nav.getBoundingClientRect().bottom) : 64;
}

function maxHeight(): number {
  if (typeof window === "undefined") return 720;
  return Math.max(MIN_HEIGHT, Math.round(window.innerHeight - navOffset()));
}

function clampHeight(height: number): number {
  return Math.min(maxHeight(), Math.max(MIN_HEIGHT, Math.round(height)));
}

function formatChatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

type HealthState = {
  status: "checking" | "runtime" | "disabled" | "unavailable";
  mode: "required" | "preferred" | "legacy";
};

export default function DashboardAgentTerminal({ scope }: Props) {
  const [health, setHealth] = useState<HealthState>({ status: "checking", mode: "required" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/openharness/health")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        const mode = data?.dashboardMode === "preferred" || data?.dashboardMode === "legacy"
          ? data.dashboardMode
          : "required";
        if (data?.enabled && data?.healthy) setHealth({ status: "runtime", mode });
        else if (data?.enabled) setHealth({ status: "unavailable", mode });
        else setHealth({ status: "disabled", mode });
      })
      .catch(() => {
        if (!cancelled) setHealth({ status: "unavailable", mode: "required" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (health.status === "runtime") {
    return <RuntimeTerminal scope={scope} />;
  }
  if (health.mode === "required") {
    return <RuntimeTerminal scope={scope} runtimeUnavailable />;
  }
  // Preferred and legacy modes may use the old transport. Required mode stays
  // on OpenHarness and surfaces unavailability instead of silently falling back.
  return (
    <>
      <KnowledgeTerminal scope={scope} />
      {health.status === "unavailable" ? (
        <div className="pointer-events-none fixed bottom-14 right-3 z-[60] rounded-md border border-amber-700/70 bg-amber-950/80 px-2.5 py-1 text-[11px] text-amber-200 shadow">
          Agent runtime unavailable — using legacy chat
        </div>
      ) : null}
    </>
  );
}

function RuntimeTerminal({ scope, runtimeUnavailable = false }: Props & { runtimeUnavailable?: boolean }) {
  const resizeStartRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [height, setHeight] = useState(() => {
    if (typeof window === "undefined") return COLLAPSED_HEIGHT;
    const saved = Number(window.localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampHeight(saved) : COLLAPSED_HEIGHT;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState("");
  const { model, setModel, reasoningEffort, setReasoningEffort } = useAssistantIntelligence();
  const [models, setModels] = useState<string[]>([...DEFAULT_ASSISTANT_MODELS]);
  const [history, setHistory] = useState<RuntimeHistorySession[]>([]);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const attachmentInputRef = useRef<HTMLInputElement>(null);

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
      // The last header item starts concealing at 380ms and the animation runs
      // 320ms; unmount only after both have finished.
      headerCloseTimer.current = window.setTimeout(() => {
        headerMountedRef.current = false;
        setHeaderMounted(false);
        setHeaderClosing(false);
        headerCloseTimer.current = null;
      }, 760);
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

  const session = useAgentSession("dashboard_terminal", { title: "Assistant conversation" });
  const runtimeOnline = !runtimeUnavailable && session.connection !== "error";
  const busy =
    session.connection === "connecting" ||
    session.connection === "streaming" ||
    session.connection === "waiting";
  const isPublic = scope === "public";

  useEffect(() => {
    const onResize = () => setHeight((current) => clampHeight(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(HEIGHT_KEY, String(height));
  }, [height]);

  useEffect(() => {
    fetch("/api/models")
      .then((response) => response.json())
      .then((data) => {
        const ids = Array.isArray(data?.data)
          ? data.data
              .map((item: { id?: unknown }) => (typeof item?.id === "string" ? item.id : null))
              .filter((id: string | null): id is string => Boolean(id))
          : [];
        if (ids.length > 0) setModels(mergeAssistantModels(ids));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (session.connection !== "idle") return;
    let cancelled = false;
    void fetch("/api/openharness/sessions?surface=dashboard_terminal")
      .then((response) => (response.ok ? response.json() : { sessions: [] }))
      .then((data) => {
        if (cancelled) return;
        const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
        setHistory(
          sessions
            .filter((item: { id?: unknown }) => typeof item.id === "string" && item.id.startsWith("conv_"))
            .map((item: {
              id: number;
              title?: unknown;
              updatedAt?: unknown;
              messages?: unknown;
            }) => ({
              id: item.id,
              title: typeof item.title === "string" ? item.title : "New chat",
              updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
              messages: Array.isArray(item.messages) ? item.messages as AgentMessage[] : [],
            })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scope, session.connection, session.sessionId]);

  const submit = useCallback(() => {
    const text = input.trim();
    if ((!text && chatAttachments.length === 0) || runtimeUnavailable || busy) return;
    const pendingAttachments = chatAttachments;
    const displayText = text || "Please review the attached document(s).";
    setInput("");
    setChatAttachments([]);
    setAttachmentStatus("");
    void session.send(displayText, {
      model,
      reasoningEffort,
      attachments: pendingAttachments,
    });
  }, [busy, chatAttachments, input, model, reasoningEffort, runtimeUnavailable, session]);

  const steer = useCallback(async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed || runtimeUnavailable) return false;
    return session.steer(trimmed);
  }, [runtimeUnavailable, session]);

  const sendQueued = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || runtimeUnavailable) return;
    await session.send(trimmed, { model, reasoningEffort });
  }, [model, reasoningEffort, runtimeUnavailable, session]);

  const editMessage = useCallback(
    (messageIndex: number, text: string, branchGroupId: string) => {
      if (runtimeUnavailable) return;
      void session.send(text, {
        model,
        reasoningEffort,
        historyOverride: session.messages.slice(0, messageIndex),
        branchGroupId,
      });
    },
    [model, reasoningEffort, runtimeUnavailable, session],
  );

  const selectBranch = useCallback(
    (messages: typeof session.messages) => session.setMessages(messages),
    [session],
  );

  const handleAttachmentInput = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0) return;
      setExtractingAttachments(true);
      setAttachmentStatus("Reading documents…");
      try {
        const result = await extractChatAttachments(files);
        setChatAttachments((current) => [...current, ...result.attachments]);
        setAttachmentStatus([...result.errors, ...result.warnings].join(" · "));
      } finally {
        setExtractingAttachments(false);
      }
    },
    [],
  );

  const sendSuggestedPrompt = useCallback(
    (text: string) => {
      if (runtimeUnavailable || busy) return;
      void session.send(text, { model, reasoningEffort });
    },
    [busy, model, reasoningEffort, runtimeUnavailable, session],
  );

  const retryMessage = useCallback(
    (messageIndex: number) => {
      if (runtimeUnavailable) return;
      const previousUser = session.messages
        .slice(0, messageIndex)
        .reverse()
        .find((message) => message.role === "user");
      if (previousUser) {
        void session.send(previousUser.content, { model, reasoningEffort });
      }
    },
    [model, reasoningEffort, runtimeUnavailable, session],
  );

  function startNewChat() {
    if (busy) return;
    session.reset();
    setInput("");
    setChatAttachments([]);
    setAttachmentStatus("");
  }

  function openHistorySession(item: RuntimeHistorySession) {
    if (busy) return;
    session.reset();
    session.setSessionId(item.id);
    session.setMessages(item.messages);
    setChatAttachments([]);
    setAttachmentStatus("");
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    resizeStartRef.current = { startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
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
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  const terminalStyle: CSSProperties = {
    height,
    background: isOpen ? "var(--paper-surface)" : "#EFE8D6",
    borderTopColor: "rgba(169, 193, 177, 0.7)",
  };
  const headerItemAnim = headerClosing
    ? "terminal-boot-conceal"
    : "terminal-boot-reveal";

  return (
    <section
      style={terminalStyle}
      className="neu-surface-raised fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden border-t text-gray-100"
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
            isResizing ? "bg-[#8faf9a]" : "bg-[#A9C1B1] group-hover:bg-[#8faf9a]"
          }`}
        />
      </div>

      <header
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        style={{ background: "#EFE8D6" }}
        className={`flex shrink-0 cursor-row-resize touch-none select-none items-center gap-3 border-b border-[rgba(169,193,177,0.55)] px-4 ${
          headerMounted ? "py-2.5" : "h-full justify-center py-0"
        }`}
      >
        {headerMounted ? (
          <>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setSidebarOpen((value) => !value)}
              style={{ animationDelay: "40ms" }}
              className={`${headerItemAnim} neu-button-icon flex h-7 w-7 items-center justify-center rounded-md border border-gray-800 text-gray-400 transition hover:border-gray-700 hover:text-white`}
              title={sidebarOpen ? "Hide history" : "Show history"}
              aria-label="Toggle history"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
              </svg>
            </button>
            <div
              style={{ animationDelay: "210ms" }}
              className={`${headerItemAnim} flex min-w-0 items-center gap-2`}
            >
              <span
                role="status"
                aria-label={runtimeOnline ? "OpenHarness is available" : "OpenHarness is unavailable"}
                title={runtimeOnline ? "OpenHarness available" : "OpenHarness unavailable"}
                className={`h-2 w-2 shrink-0 rounded-full ${
                  runtimeOnline ? "bg-[#4F805E]" : "bg-[#B65B5B]"
                }`}
              />
              <p
                className="truncate text-sm font-semibold text-[#172A22]"
              >
                Terminal
              </p>
            </div>
          </>
        ) : null}
      </header>

      {isOpen ? (
        <div className="flex min-h-0 flex-1">
          {sidebarOpen ? (
            <aside className="flex w-56 shrink-0 flex-col border-r border-gray-800 bg-gray-950">
              <div className="p-2">
                <button
                  type="button"
                  onClick={startNewChat}
                  disabled={busy}
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
                {history.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-gray-600">No chats yet</p>
                ) : (
                  <ul className="space-y-0.5">
                    {history.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => openHistorySession(item)}
                          disabled={busy}
                          className={`w-full rounded-md px-2.5 py-2 text-left transition ${
                            item.id === session.sessionId
                              ? "bg-gray-800 text-white"
                              : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-medium">{item.title}</span>
                            <span className="shrink-0 text-[10px] text-gray-600">
                              {formatChatTime(item.updatedAt)}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <input
              ref={attachmentInputRef}
              type="file"
              accept={CHAT_ATTACHMENT_ACCEPT}
              multiple
              onChange={handleAttachmentInput}
              className="hidden"
            />
            <AgentRuntimePanel
                compact
                sessionId={session.sessionId}
                surface="dashboard_terminal"
                messages={session.messages}
                connection={session.connection}
                runState={session.runState}
                steerError={session.steerError}
                error={runtimeUnavailable ? "OpenHarness is required but unavailable. No legacy request was sent." : session.error}
                pendingPermission={session.pendingPermission}
                activities={session.activities}
                input={input}
                onInputChange={setInput}
                onSubmit={submit}
                onSteer={steer}
                onSendQueued={sendQueued}
                onEditMessage={editMessage}
                onSelectBranch={selectBranch}
                disabled={runtimeUnavailable}
                onAbort={() => void session.abort()}
                onPermissionDecision={(decision) => void session.respondToPermission(decision)}
                onRetryMessage={retryMessage}
                placeholder={isPublic ? "Ask anything across all public gardens…" : "Ask anything across your gardens…"}
                model={model}
                models={models}
                onModelChange={setModel}
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={setReasoningEffort}
                onAddDocuments={() => attachmentInputRef.current?.click()}
                isAddingDocuments={extractingAttachments}
                attachments={chatAttachments}
                onRemoveAttachment={(index) =>
                  setChatAttachments((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                statusMessage={attachmentStatus}
                emptyState={
                  <div className="flex flex-col items-center gap-5 py-8 text-center">
                    <div>
                      <p className="text-lg font-medium text-white">
                        {isPublic ? "Ask the public knowledge hub" : "Ask your whole knowledge base"}
                      </p>
                      <p className="mt-1.5 text-sm text-gray-500">
                        {isPublic
                          ? "Answers are grounded in the notes across every public garden on Breadboard."
                          : "Answers are grounded in the notes across every garden you own."}
                      </p>
                    </div>
                    <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
                      {SUGGESTED_PROMPTS[scope].map((prompt) => (
                        <button
                          type="button"
                          key={prompt}
                          onClick={() => sendSuggestedPrompt(prompt)}
                          disabled={busy || runtimeUnavailable}
                          className="neu-button rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5 text-left text-sm text-gray-300 transition hover:border-gray-600 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                }
              />
          </div>
        </div>
      ) : null}
    </section>
  );
}
