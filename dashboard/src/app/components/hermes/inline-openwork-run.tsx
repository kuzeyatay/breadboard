"use client";

// The OpenWork run card.
//
// Unlike the video and film cards, an OpenWork run's payoff is usually the
// answer itself, so the card is built around the streaming text: it appears as
// it is written and stays as the body of the turn. Two things sit around it —
// a short line for what the workspace is doing (starting, working, delivering)
// and, when the run produced files, the outbox deliverables.
//
// Styling uses the shared run material (bb-agent-run-*) so this card reads as
// the same object as every other external-agent run.

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import { closeAgentRunStream, resolveAgentRunStreamError } from "@/lib/agent-run-stream";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface Deliverable {
  id: string;
  path: string;
  size: number;
}

const STAGES = [
  { key: "starting", label: "Opening the workspace" },
  { key: "working", label: "Working" },
  { key: "delivering", label: "Collecting what it made" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

const STREAMED_EVENT_TYPES = [
  "run.started",
  "service.starting",
  "service.ready",
  "session.created",
  "assistant.delta",
  "tool.used",
  "artifact.ready",
  "stage",
  "run.completed",
  "run.failed",
  "run.aborted",
];

const TERMINAL = new Set(["completed", "failed", "aborted"]);

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatElapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export default function InlineOpenworkRun({
  runId,
  task,
  persistedContent = "",
  persistedOutcome,
  persistedUsage,
  onTerminal,
  onRetry,
}: {
  runId: string;
  task: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  persistedUsage?: ChatTokenUsage;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [stage, setStage] = useState<StageKey>("starting");
  const [model, setModel] = useState("");
  const [answer, setAnswer] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [tools, setTools] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [usage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  // Stamped in the effect below rather than here: reading the clock during
  // render is impure, and a re-render would move the run's start time.
  const startedRef = useRef(0);
  const base = `/api/openwork/runs/${runId}`;
  const replaying = Boolean(
    persistedOutcome && persistedOutcome !== "running" && persistedContent,
  );

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedRef.current = false;
    startedRef.current = Date.now();
  }, [runId]);

  const reportTerminal = useCallback(
    (outcome: "completed" | "failed" | "aborted", content: string) => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      if (outcome === "completed") notifyTaskCompleted(`OpenWork — ${task.slice(0, 80)}`);
      onTerminalRef.current?.({ outcome, content });
    },
    [task],
  );

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      switch (event.type) {
        case "run.started":
          setStatus("running");
          setModel(asString(payload.model));
          break;
        case "session.created":
          setStage("working");
          break;
        case "stage": {
          const next = asString(payload.stage);
          if (STAGES.some((item) => item.key === next)) setStage(next as StageKey);
          break;
        }
        case "assistant.delta":
          // The answer is assembled here rather than waiting for the terminal
          // event, so a long turn reads as it is written.
          setAnswer((current) => current + asString(payload.text));
          break;
        case "tool.used":
          setTools((current) => current + 1);
          break;
        case "artifact.ready":
          setDeliverables((current) => {
            const id = asString(payload.id);
            if (!id || current.some((item) => item.id === id)) return current;
            return [
              ...current,
              { id, path: asString(payload.path, id), size: asNumber(payload.size) },
            ];
          });
          break;
        case "run.completed": {
          const content = asString(payload.content);
          setStatus("completed");
          if (content) setAnswer(content);
          reportTerminal("completed", content);
          break;
        }
        case "run.failed":
        case "run.aborted": {
          const outcome = event.type === "run.aborted" ? "aborted" : "failed";
          const message =
            asString(payload.content) ||
            (outcome === "aborted" ? "The run was stopped." : "The OpenWork run failed.");
          setStatus(outcome);
          setFailure(message);
          reportTerminal(outcome, message);
          break;
        }
        default:
          break;
      }
    },
    [reportTerminal],
  );

  useEffect(() => {
    if (replaying) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // Ignore malformed frames and keep the rest of the stream usable.
      }
    };
    STREAMED_EVENT_TYPES.forEach((type) =>
      source.addEventListener(type, handle as EventListener),
    );
    source.onerror = () => {
      resolveAgentRunStreamError({
        source,
        base,
        replayEnding: applyEvent,
        onUnavailable: (reason) => {
          setStatus("failed");
          setFailure(
            reason === "run_not_found"
              ? "This run is no longer live, but its saved result remains below."
              : "The OpenWork event stream is unavailable.",
          );
        },
      });
    };
    return () => closeAgentRunStream(source);
  }, [applyEvent, base, replaying]);

  const terminal = TERMINAL.has(status);

  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedRef.current) / 1_000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [terminal]);

  const activeStageIndex = STAGES.findIndex((item) => item.key === stage);
  const terminalContent =
    answer.trim() ||
    failure.trim() ||
    (status === "aborted" ? "The run was stopped." : "The run finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        agentName="OpenWork"
        usage={usage}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={STAGES[activeStageIndex]?.label}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            OpenWork
            {model ? (
              <span className="ml-[8px] font-mono text-[11px] font-normal text-[var(--ink-muted)]">
                {model}
              </span>
            ) : null}
          </p>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span
                className={`bb-agent-run-led h-1.5 w-1.5 ${
                  status === "completed"
                    ? "bg-[var(--botanical)]"
                    : terminal
                      ? "bg-[var(--danger)]"
                      : "animate-pulse bg-[var(--botanical-2)]"
                }`}
              />
              {terminal ? status : `${STAGES[activeStageIndex]?.key ?? "working"} · ${formatElapsed(elapsed)}`}
            </span>
            {!terminal ? (
              <button
                type="button"
                className="bb-agent-run-action"
                onClick={() => {
                  void fetch(`${base}/abort`, { method: "POST" }).catch(() => undefined);
                }}
              >
                Stop
              </button>
            ) : null}
          </div>
        </header>

        <div className="space-y-[13px] p-[21px]">
          {/* The workspace has to open before the first token can arrive, and
              that is the slowest part of a cold run — so it is said out loud
              rather than left as an empty card. */}
          {!terminal && !answer ? (
            <ol className="space-y-[5px]">
              {STAGES.map((item, index) => {
                const state =
                  index < activeStageIndex
                    ? "done"
                    : index === activeStageIndex
                      ? "active"
                      : "pending";
                return (
                  <li key={item.key} className="flex items-center gap-[8px]">
                    <span
                      className={`bb-agent-run-led h-1.5 w-1.5 ${
                        state === "done"
                          ? "bg-[var(--botanical)]"
                          : state === "active"
                            ? "animate-pulse bg-[var(--botanical-2)]"
                            : "bg-[color-mix(in_srgb,var(--line)_80%,transparent)]"
                      }`}
                    />
                    <span
                      className={`text-[11px] leading-[1.4] ${
                        state === "pending"
                          ? "text-[var(--ink-muted)]"
                          : "text-[var(--ink-heading)]"
                      }`}
                    >
                      {item.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {deliverables.length ? (
            <section className="bb-agent-run-panel p-[13px]">
              <p className="bb-agent-run-label mb-[8px]">
                Delivered · {deliverables.length}
              </p>
              <ul className="grid gap-[5px] sm:grid-cols-2">
                {deliverables.map((item) => (
                  <li key={item.id}>
                    <a
                      className="bb-agent-run-row flex items-center gap-[8px] p-[8px] transition-colors hover:text-[var(--ink-heading)]"
                      href={`${base}/artifacts/${encodeURIComponent(item.id)}`}
                      download
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--ink-heading)]">
                        {item.path}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--ink-muted)]">
                        {formatBytes(item.size)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {answer ? (
            <section className="bb-agent-run-text">
              <ChatMarkdown content={answer} compact />
            </section>
          ) : null}

          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}

          {tools ? (
            <p className="bb-agent-run-label">
              {tools} tool call{tools === 1 ? "" : "s"} in the workspace
            </p>
          ) : null}
        </div>
      </div>
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
