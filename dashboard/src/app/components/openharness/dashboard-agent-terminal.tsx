"use client";

// The dashboard AI terminal, backed by the OpenHarness runtime.
//
// This preserves the existing bottom-docked, drag-to-resize terminal chrome and
// history sidebar, but routes execution through OpenHarness (streaming output,
// tool activity, permission prompts, abort) instead of the legacy knowledge-chat
// pipeline. When OpenHarness is disabled or unreachable it transparently falls
// back to the legacy KnowledgeTerminal so the surface never breaks (acceptance
// criterion 18).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import KnowledgeTerminal from "@/app/components/knowledge-terminal";
import AgentRuntimePanel from "./agent-runtime-panel";
import { useAgentSession } from "./use-agent-session";
import {
  DEFAULT_ASSISTANT_MODELS,
  DEFAULT_MODEL,
  mergeAssistantModels,
} from "@/lib/ai-models";
import {
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "@/lib/assistant-reasoning";

type TerminalScope = "mine" | "public";

interface Props {
  scope: TerminalScope;
}

const HEIGHT_KEY = "breadboard:agent-terminal-height";
const COLLAPSED_HEIGHT = 48;
const MIN_HEIGHT = COLLAPSED_HEIGHT;

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

// Three distinguishable states: agent runtime active, OpenHarness intentionally
// disabled (legacy), or enabled-but-unreachable (unavailable). The fallback is
// never silent — the unavailable state is surfaced with a non-intrusive badge.
type HealthState = "checking" | "runtime" | "disabled" | "unavailable";

export default function DashboardAgentTerminal({ scope }: Props) {
  const [health, setHealth] = useState<HealthState>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/openharness/health")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.enabled && data?.healthy) setHealth("runtime");
        else if (data?.enabled) setHealth("unavailable");
        else setHealth("disabled");
      })
      .catch(() => {
        if (!cancelled) setHealth("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (health === "runtime") {
    return <RuntimeTerminal scope={scope} />;
  }
  // Fall back to the existing terminal, but explicitly indicate the mode so the
  // runtime fallback is never hidden.
  return (
    <>
      <KnowledgeTerminal scope={scope} />
      {health === "unavailable" ? (
        <div className="pointer-events-none fixed bottom-14 right-3 z-[60] rounded-md border border-amber-700/70 bg-amber-950/80 px-2.5 py-1 text-[11px] text-amber-200 shadow">
          Agent runtime unavailable — using legacy chat
        </div>
      ) : null}
    </>
  );
}

function RuntimeTerminal({ scope }: Props) {
  const resizeStartRef = useRef<{ startY: number; startHeight: number } | null>(null);
  // Restore the saved height on first render via a lazy initializer so we never
  // setState inside a mount effect.
  const [height, setHeight] = useState(() => {
    if (typeof window === "undefined") return COLLAPSED_HEIGHT;
    const saved = Number(window.localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampHeight(saved) : COLLAPSED_HEIGHT;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [models, setModels] = useState<string[]>([...DEFAULT_ASSISTANT_MODELS]);
  const [reasoningEffort, setReasoningEffort] = useState<AssistantReasoningEffort>(
    DEFAULT_ASSISTANT_REASONING_EFFORT,
  );

  const isOpen = height > COLLAPSED_HEIGHT + 8;
  const session = useAgentSession("dashboard_terminal", { title: "Terminal session" });

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

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    void session.send(text);
  }, [input, session]);

  function handleResizeStart(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    resizeStartRef.current = { startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    document.body.style.cursor = "row-resize";
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
  }

  const terminalStyle: CSSProperties = {
    height,
    background: isOpen ? "#0b0f14" : "#EFE8D6",
    borderTopColor: "rgba(169, 193, 177, 0.7)",
  };

  return (
    <section
      style={terminalStyle}
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden border-t text-gray-100"
    >
      <div
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        className="group absolute inset-x-0 -top-1.5 z-10 flex h-3 cursor-row-resize items-center justify-center"
      >
        <span
          className={`h-1.5 w-14 rounded-full border border-[rgba(169,193,177,0.7)] ${
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
        className="flex shrink-0 cursor-row-resize touch-none select-none items-center gap-3 border-b border-[rgba(169,193,177,0.55)] px-4 py-2.5"
      >
        <span className="font-mono text-sm font-medium text-[#5f7f8e]">{">_"}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#172A22]">Agent terminal</p>
          <p className="truncate text-[11px] text-[#5F6F68]">
            Powered by OpenHarness · {scope === "public" ? "public gardens" : "your workspace"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full border border-[#A9C1B1] px-2 py-0.5 text-[10px] text-[#4A5B46]">
            {session.connection === "idle" ? "ready" : session.connection}
          </span>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => session.reset()}
            className="rounded-md border border-[#A9C1B1] px-2 py-0.5 text-[11px] text-[#4A5B46] hover:bg-[#e2dcc9]"
          >
            New chat
          </button>
        </div>
      </header>

      {isOpen ? (
        <AgentRuntimePanel
          compact
          messages={session.messages}
          connection={session.connection}
          error={session.error}
          pendingPermission={session.pendingPermission}
          input={input}
          onInputChange={setInput}
          onSubmit={submit}
          onAbort={() => void session.abort()}
          onPermissionDecision={(decision) => void session.respondToPermission(decision)}
          placeholder="Ask the agent to inspect code, run tests, search…"
          model={model}
          models={models}
          onModelChange={setModel}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
          emptyState={
            <div className="py-8 text-center">
              <p className="text-lg font-medium text-white">Agent terminal</p>
              <p className="mt-1.5 text-sm text-gray-500">
                A multipurpose agent that can inspect the repo, run focused commands, and edit files —
                asking permission before anything sensitive.
              </p>
            </div>
          }
        />
      ) : null}
    </section>
  );
}
