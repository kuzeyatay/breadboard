"use client";

// One Stock Analyst turn, as it happens.
//
// The clone reports two different kinds of progress and the card keeps them
// apart: pipeline *stages* (data, news, strategy, risk, decision) are the shape
// of the answer, and *tools* (quotes, K-lines, chip distribution, sector
// rankings, news search) are the evidence under it. A quick-answer run has no
// stages at all, so the stage list only appears when there is one.
//
// Unlike Vibe Trading, nothing streams here: the clone sends its answer once, in
// the terminal `done` event, because its executor writes the report in a single
// completion. The card therefore shows the work until the end, then the report.

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import { resolveAgentRunStreamError } from "@/lib/agent-run-stream";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface StepRow {
  key: string;
  /** Matches a start to its completion; the clone reuses tool names per step. */
  callId: string;
  /** The clone's tool id, or the readable name of a pipeline stage. */
  display: string;
  state: "running" | "done" | "failed";
  elapsedMs: number;
}

/** How far the supervised backend has got, which is most of a cold run's wait. */
type ServiceState = "unknown" | "starting" | "ready";

const STREAMED_EVENT_TYPES = [
  "run.started",
  "service.starting",
  "service.ready",
  "agent.thinking",
  "agent.warning",
  "step.started",
  "step.completed",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function formatElapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

function formatToolElapsed(milliseconds: number): string {
  if (!milliseconds) return "";
  return milliseconds >= 1_000
    ? `${(milliseconds / 1_000).toFixed(1)}s`
    : `${Math.round(milliseconds)}ms`;
}

export default function InlineStockAnalystRun({
  runId,
  task,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onRetry,
}: {
  runId: string;
  task: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  onTerminal?: (result: {
    outcome: ExternalAgentTerminalOutcome;
    content: string;
  }) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [service, setService] = useState<ServiceState>("unknown");
  const [coldStart, setColdStart] = useState(false);
  const [stages, setStages] = useState<StepRow[]>([]);
  const [tools, setTools] = useState<StepRow[]>([]);
  const [thinking, setThinking] = useState("");
  const [warning, setWarning] = useState("");
  const [model, setModel] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  // Stamped in the runId effect below — reading the clock during render is not
  // idempotent, and the effect always runs before the elapsed-time interval.
  const startedRef = useRef(0);
  const base = `/api/stock-analyst/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedRef.current = false;
    startedRef.current = Date.now();
  }, [runId]);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.type === "run.started") {
        setStatus("running");
        setModel(asString(payload.model));
      }
      if (event.type === "service.starting") setService("starting");
      if (event.type === "service.ready") {
        setService("ready");
        setColdStart(payload.coldStart === true);
        const running = asString(payload.model);
        if (running) setModel(running);
      }
      if (event.type === "agent.thinking") setThinking(asString(payload.summary));
      if (event.type === "agent.warning") setWarning(asString(payload.message));

      if (event.type === "step.started" || event.type === "step.completed") {
        const setRows = payload.kind === "stage" ? setStages : setTools;
        const callId = asString(payload.callId);
        if (event.type === "step.started") {
          setRows((current) =>
            [
              ...current,
              {
                key: String(event.sequenceNumber),
                callId,
                display: asString(payload.display, "step"),
                state: "running" as const,
                elapsedMs: 0,
              },
            ].slice(-80),
          );
        } else {
          const failed = asString(payload.status, "ok") !== "ok";
          setRows((current) => {
            const index = current.findLastIndex(
              (row) => row.callId === callId && row.state === "running",
            );
            if (index < 0) return current;
            const next = [...current];
            next[index] = {
              ...next[index],
              state: failed ? "failed" : "done",
              elapsedMs: asNumber(payload.elapsedMs),
            };
            return next;
          });
        }
      }

      if (event.type === "run.completed") {
        const summary = asString(payload.summary, "Stock Analyst finished.");
        setStatus("completed");
        setResult(summary);
        setElapsed(asNumber(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          notifyTaskCompleted(task);
          onTerminalRef.current?.({ outcome: "completed", content: summary });
        }
      }
      if (event.type === "run.failed" || event.type === "run.aborted") {
        const outcome = event.type === "run.aborted" ? "aborted" : "failed";
        const message =
          asString(payload.error) ||
          asString(payload.summary) ||
          (outcome === "aborted"
            ? "Stock Analyst stopped."
            : "Stock Analyst could not answer this question.");
        setStatus(outcome);
        setFailure([message, asString(payload.detail)].filter(Boolean).join("\n\n"));
        setElapsed(asNumber(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          // A failure that still carried partial analysis keeps it, so the
          // stored turn is the work rather than only the reason it ended.
          const kept = asString(payload.summary);
          onTerminalRef.current?.({ outcome, content: kept || message });
        }
      }
    },
    [task],
  );

  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running" && persistedContent) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // Ignore malformed frames and keep the remaining stream usable.
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
              ? "This Stock Analyst run is no longer live, but its saved result remains below."
              : "The Stock Analyst event stream is unavailable.",
          );
        },
      });
    };
    return () => source.close();
  }, [applyEvent, base, persistedContent, persistedOutcome]);

  useEffect(() => {
    if (TERMINAL.has(status)) return;
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedRef.current) / 1_000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  const terminal = TERMINAL.has(status);
  const stop = () => {
    void fetch(`${base}/abort`, { method: "POST" }).catch(() => undefined);
  };
  const terminalContent =
    result.trim() ||
    failure.trim() ||
    (status === "aborted" ? "Stock Analyst stopped." : "Stock Analyst finished.");

  const rows = (list: StepRow[]) => (
    <ol className="max-h-64 space-y-[5px] overflow-y-auto pr-1">
      {list.map((row) => (
        <li key={row.key} className="bb-agent-run-row p-[8px]">
          <div className="flex items-center gap-[8px]">
            <span
              className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                row.state === "running"
                  ? "animate-pulse bg-[var(--botanical-2)]"
                  : row.state === "failed"
                    ? "bg-[var(--danger)]"
                    : "bg-[var(--botanical)]"
              }`}
            />
            <span className="truncate font-mono text-[11px] leading-[1.618] text-[var(--ink-heading)]">
              {row.display}
            </span>
            {row.elapsedMs ? (
              <span className="ml-auto shrink-0 font-mono text-[10px] leading-[1.618] text-[var(--ink-muted)]">
                {formatToolElapsed(row.elapsedMs)}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={stages.at(-1)?.display || tools.at(-1)?.display || thinking}
        agentName="Stock Analyst"
      />
      <div className="bb-agent-run-card overflow-hidden">
        {/* The question is the user's own message directly above this card. The
            header carries the agent, the model it is running on, and its state. */}
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Stock Analyst
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
              {terminal ? status : `working · ${formatElapsed(elapsed)}`}
            </span>
            {!terminal ? (
              <button type="button" onClick={stop} className="bb-agent-run-action">
                Stop
              </button>
            ) : null}
          </div>
        </header>

        <div className="space-y-[13px] p-[21px]">
          {/* A first run has to start the cloned backend, which is a minute of
              importing market-data libraries before any work begins. Saying so is
              the difference between "slow" and "broken". */}
          {!terminal && service !== "ready" ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {service === "starting"
                ? "Starting the Stock Analyst backend — the first run of a session loads its market-data sources."
                : "Preparing the run…"}
            </p>
          ) : null}
          {service === "ready" && coldStart && !terminal ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              Backend started. Later questions in this session reuse it.
            </p>
          ) : null}
          {warning ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">{warning}</p>
          ) : null}

          {stages.length ? (
            <section>
              <p className="bb-agent-run-label mb-[8px]">Stages · {stages.length}</p>
              {rows(stages)}
            </section>
          ) : null}

          {/* A restored turn has no steps — the run manager keeps events in
              memory only — so on a finished run with nothing recorded the whole
              section goes rather than showing a live placeholder. Without this
              a completed analysis reads "Reading the question…" underneath its
              own answer, which is what a headless render of the saved state
              showed. */}
          {tools.length || !terminal ? (
            <section>
              <p className="bb-agent-run-label mb-[8px]">
                Data{tools.length ? ` · ${tools.length}` : ""}
              </p>
              {tools.length ? (
                rows(tools)
              ) : (
                <p className="bb-agent-run-text text-[var(--ink-muted)]">
                  {thinking || "Reading the question…"}
                </p>
              )}
            </section>
          ) : null}

          {result.trim() ? (
            <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
              <ChatMarkdown content={result} compact />
            </section>
          ) : null}
          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}

          {terminal && status === "completed" ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              Analysis output, not financial advice.
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
