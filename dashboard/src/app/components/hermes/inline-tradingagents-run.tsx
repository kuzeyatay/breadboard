"use client";

// One Trading Agent analysis, live in the transcript.
//
// The framework's own CLI paints a table of agents that light up as the graph
// walks through them; this card is that table. Each row is a real node of the
// LangGraph — the analysts in the order they run, then the research debate, the
// trader, the risk debate and the portfolio manager — and a section's report
// appears under it the moment the node writes one.
//
// A run is long (minutes, sometimes tens of minutes), so the card has to be
// readable while nothing is happening: the stage list is the answer to "what is
// it doing", and the elapsed clock is the answer to "is it stuck".

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface StageRow {
  stage: string;
  label: string;
  status: "pending" | "running" | "completed";
  /** Characters of report written under this stage, when it produced one. */
  characters: number;
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "graph.started",
  "stage.updated",
  "report.section",
  "agent.usage",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

/** Which stage a finished report section belongs under. */
const SECTION_STAGE: Record<string, string> = {
  market_report: "market",
  sentiment_report: "social",
  news_report: "news",
  fundamentals_report: "fundamentals",
  investment_plan: "research",
  trader_investment_plan: "trader",
  final_trade_decision: "portfolio",
};

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

/** Buy and Sell read as opposite verdicts, so they must not look alike. */
function ratingTone(rating: string): string {
  const normalized = rating.trim().toLowerCase();
  if (normalized === "buy" || normalized === "overweight") return "text-[var(--botanical)]";
  if (normalized === "sell" || normalized === "underweight") return "text-[var(--danger)]";
  return "text-[var(--ink-heading)]";
}

export default function InlineTradingAgentsRun({
  runId,
  task,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onRetry,
}: {
  runId: string;
  /** The run's label — "NVDA · 2026-08-04". This agent has no prompt. */
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
  const [stages, setStages] = useState<StageRow[]>([]);
  const [models, setModels] = useState({ deep: "", quick: "" });
  const [rating, setRating] = useState("");
  const [reportPath, setReportPath] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0, calls: 0, tools: 0 });
  const [usageReported, setUsageReported] = useState(false);
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [detail, setDetail] = useState("");
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  // Stamped in the runId effect below — reading the clock during render is not
  // idempotent, and the effect always runs before the elapsed-time interval.
  const startedRef = useRef(0);
  const base = `/api/tradingagents/runs/${runId}`;

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
        setModels({ deep: asString(payload.deepModel), quick: asString(payload.quickModel) });
      }
      if (event.type === "graph.started") {
        setModels({ deep: asString(payload.deepModel), quick: asString(payload.quickModel) });
      }
      if (event.type === "stage.updated") {
        const stage = asString(payload.stage);
        if (!stage) return;
        const label = asString(payload.label, stage);
        const stageStatus = asString(payload.status, "pending") as StageRow["status"];
        setStages((current) => {
          const index = current.findIndex((row) => row.stage === stage);
          if (index < 0) {
            return [...current, { stage, label, status: stageStatus, characters: 0 }];
          }
          const next = [...current];
          next[index] = { ...next[index], label, status: stageStatus };
          return next;
        });
      }
      if (event.type === "report.section") {
        const stage = SECTION_STAGE[asString(payload.section)];
        const characters = asNumber(payload.characters);
        if (!stage) return;
        setStages((current) => {
          const index = current.findIndex((row) => row.stage === stage);
          if (index < 0) return current;
          const next = [...current];
          next[index] = { ...next[index], characters };
          return next;
        });
      }
      if (event.type === "agent.usage") {
        setUsage({
          inputTokens: asNumber(payload.inputTokens),
          outputTokens: asNumber(payload.outputTokens),
          calls: asNumber(payload.llmCalls),
          tools: asNumber(payload.toolCalls),
        });
        setUsageReported(true);
      }
      if (event.type === "run.completed") {
        const summary = asString(payload.summary, "The analysis finished.");
        setStatus("completed");
        setResult(summary);
        setRating(asString(payload.rating));
        setReportPath(asString(payload.reportPath));
        setElapsed(asNumber(payload.elapsedSec));
        if (asNumber(payload.inputTokens) || asNumber(payload.outputTokens)) {
          setUsage({
            inputTokens: asNumber(payload.inputTokens),
            outputTokens: asNumber(payload.outputTokens),
            calls: asNumber(payload.llmCalls),
            tools: asNumber(payload.toolCalls),
          });
          setUsageReported(true);
        }
        if (!reportedRef.current) {
          reportedRef.current = true;
          notifyTaskCompleted(task);
          onTerminalRef.current?.({ outcome: "completed", content: summary });
        }
      }
      if (event.type === "run.failed" || event.type === "run.aborted") {
        const outcome = event.type === "run.aborted" ? "aborted" : "failed";
        const message =
          asString(payload.summary) ||
          asString(payload.error) ||
          (outcome === "aborted"
            ? "The analysis was stopped."
            : "The analysis could not be completed.");
        setStatus(outcome);
        // A stopped run keeps whatever sections finished; a failed one has an
        // explanation instead, and the traceback tail goes underneath it.
        if (outcome === "aborted" && asString(payload.summary)) {
          setResult(asString(payload.summary));
        } else {
          setFailure(message);
        }
        setDetail(asString(payload.detail));
        setElapsed(asNumber(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          onTerminalRef.current?.({ outcome, content: message });
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
      void fetch(`${base}/events?since=0`)
        .then(async (response) => {
          if (response.ok) return;
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          source.close();
          setStatus("failed");
          setFailure(
            data.error === "run_not_found"
              ? "This analysis is no longer live, but its saved result remains below."
              : "The analysis event stream is unavailable.",
          );
        })
        .catch(() => undefined);
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
  const running = stages.find((row) => row.status === "running");
  const terminalContent =
    result.trim() ||
    failure.trim() ||
    (status === "aborted" ? "The analysis was stopped." : "The analysis finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        totalTokens={usageReported ? usage.inputTokens + usage.outputTokens : undefined}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={running ? `${running.label} working` : undefined}
        agentName="Trading Agent"
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Trading Agent
            <span className="ml-[8px] font-mono text-[11px] font-normal text-[var(--botanical)]">
              {task}
            </span>
            {models.deep ? (
              <span className="ml-[8px] font-mono text-[11px] font-normal text-[var(--ink-muted)]">
                {models.deep === models.quick ? models.deep : `${models.deep} / ${models.quick}`}
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
          <section>
            <p className="bb-agent-run-label mb-[8px]">The firm</p>
            {stages.length ? (
              <ol className="space-y-[5px]">
                {stages.map((row) => (
                  <li key={row.stage} className="bb-agent-run-row flex items-center gap-[8px] p-[8px]">
                    <span
                      className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                        row.status === "running"
                          ? "animate-pulse bg-[var(--botanical-2)]"
                          : row.status === "completed"
                            ? "bg-[var(--botanical)]"
                            : "bg-[var(--line-strong)]"
                      }`}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-[11px] leading-[1.618] ${
                        row.status === "pending"
                          ? "text-[var(--ink-muted)]"
                          : "text-[var(--ink-heading)]"
                      }`}
                    >
                      {row.label}
                    </span>
                    {row.characters ? (
                      <span className="shrink-0 font-mono text-[10px] text-[var(--ink-muted)]">
                        {row.characters.toLocaleString()} chars
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="bb-agent-run-text text-[var(--ink-muted)]">
                Starting the analysts and resolving the instrument…
              </p>
            )}
          </section>

          {usageReported ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {usage.calls.toLocaleString()} model call{usage.calls === 1 ? "" : "s"} ·{" "}
              {usage.tools.toLocaleString()} data lookup{usage.tools === 1 ? "" : "s"}
            </p>
          ) : null}

          {rating ? (
            <p className={`text-[13px] font-semibold ${ratingTone(rating)}`}>Rating: {rating}</p>
          ) : null}

          {result ? (
            <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
              <ChatMarkdown content={result} compact />
            </section>
          ) : failure ? (
            <div className="space-y-[5px]">
              <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p>
              {detail ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--paper-strong)] p-[8px] font-mono text-[10px] leading-[1.618] text-[var(--ink-muted)]">
                  {detail}
                </pre>
              ) : null}
            </div>
          ) : null}

          {reportPath ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              The framework also wrote its own report tree to{" "}
              <span className="font-mono break-all">{reportPath}</span>.
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
