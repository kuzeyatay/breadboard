"use client";

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

interface ChannelSnapshot {
  channel: string;
  status: string;
  activeBackend: string | null;
  tier: number;
}

interface FetchRow {
  key: string;
  tool: string;
  display: string;
  url: string | null;
  state: "running" | "done" | "refused";
  detail: string;
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "doctor.started",
  "doctor.completed",
  "agent.thinking",
  "agent.usage",
  "fetch.started",
  "fetch.completed",
  "fetch.refused",
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

export default function InlineAgentReachRun({
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
  const [channels, setChannels] = useState<ChannelSnapshot[]>([]);
  const [probing, setProbing] = useState(false);
  const [fetches, setFetches] = useState<FetchRow[]>([]);
  const [thinking, setThinking] = useState("");
  const [model, setModel] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0, calls: 0 });
  const [usageReported, setUsageReported] = useState(false);
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
  const base = `/api/agent-reach/runs/${runId}`;

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
      if (event.type === "doctor.started") setProbing(true);
      if (event.type === "doctor.completed") {
        setProbing(false);
        if (Array.isArray(payload.channels)) {
          setChannels(payload.channels as unknown as ChannelSnapshot[]);
        }
      }
      if (event.type === "agent.thinking") setThinking(asString(payload.summary));
      if (event.type === "agent.usage") {
        setUsage({
          inputTokens: asNumber(payload.inputTokens),
          outputTokens: asNumber(payload.outputTokens),
          calls: asNumber(payload.calls),
        });
        setUsageReported(true);
      }
      if (event.type === "fetch.started") {
        setFetches((current) =>
          [
            ...current,
            {
              key: String(event.sequenceNumber),
              tool: asString(payload.tool, asString(payload.kind, "read")),
              display: asString(payload.display),
              url: typeof payload.url === "string" ? payload.url : null,
              state: "running" as const,
              detail: "",
            },
          ].slice(-40),
        );
      }
      if (event.type === "fetch.completed") {
        const display = asString(payload.display);
        setFetches((current) => {
          const index = current.findLastIndex(
            (row) => row.display === display && row.state === "running",
          );
          if (index < 0) return current;
          const next = [...current];
          next[index] = {
            ...next[index],
            state: "done",
            detail:
              asString(payload.preview) ||
              `${asNumber(payload.chars).toLocaleString()} characters`,
          };
          return next;
        });
      }
      if (event.type === "fetch.refused") {
        setFetches((current) =>
          [
            ...current,
            {
              key: String(event.sequenceNumber),
              tool: "refused",
              display: asString(payload.command),
              url: null,
              state: "refused" as const,
              detail: asString(payload.reason),
            },
          ].slice(-40),
        );
      }
      if (event.type === "run.completed") {
        const summary = asString(payload.summary, "Agent Reach finished.");
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
          asString(payload.summary) ||
          asString(payload.error) ||
          (outcome === "aborted"
            ? "Agent Reach stopped."
            : "Agent Reach could not complete this task.");
        setStatus(outcome);
        setFailure(message);
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
              ? "This Agent Reach run is no longer live, but its saved result remains below."
              : "The Agent Reach event stream is unavailable.",
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
  const liveChannels = channels.filter((channel) => channel.status === "ok");
  const terminalContent =
    result.trim() ||
    failure.trim() ||
    (status === "aborted" ? "Agent Reach stopped." : "Agent Reach finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        totalTokens={usageReported ? usage.inputTokens + usage.outputTokens : undefined}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={fetches.at(-1)?.display || thinking}
        agentName="Agent Reach"
      />
      <div className="bb-agent-run-card overflow-hidden">
        {/* The task is the user's own message directly above this card. The
            header carries the agent, the model it is using, and its state. */}
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Agent Reach
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
              {terminal ? status : `reaching · ${formatElapsed(elapsed)}`}
            </span>
            {!terminal ? (
              <button type="button" onClick={stop} className="bb-agent-run-action">
                Stop
              </button>
            ) : null}
          </div>
        </header>

        <div className="space-y-[13px] p-[21px]">
        {/* Which platforms answered, and through which backend. What this run
            could actually reach is the constraint everything below sits under. */}
        <section className="space-y-[5px]">
          <p className="bb-agent-run-label">
            Reachable{" "}
            {probing ? "· checking…" : `· ${liveChannels.length}/${channels.length || "–"}`}
          </p>
          {liveChannels.length ? (
            <ul className="flex flex-wrap gap-[5px]">
              {liveChannels.map((channel) => (
                <li
                  key={channel.channel}
                  className="bb-agent-run-pill px-[8px] py-[3px] text-[11px] leading-[1.618] text-[var(--ink-muted)]"
                  title={channel.activeBackend ?? undefined}
                >
                  <span className="font-medium text-[var(--ink-heading)]">
                    {channel.channel}
                  </span>
                  {channel.activeBackend ? ` · ${channel.activeBackend}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {probing
                ? "Asking agent-reach doctor which platforms are reachable…"
                : "No platform reported itself as reachable."}
            </p>
          )}
        </section>

        <section>
          <p className="bb-agent-run-label mb-[8px]">
            Fetches{fetches.length ? ` · ${fetches.length}` : ""}
          </p>
          {fetches.length ? (
            <ol className="max-h-64 space-y-[5px] overflow-y-auto pr-1">
              {fetches.map((row) => (
                <li key={row.key} className="bb-agent-run-row p-[8px]">
                  <div className="flex items-center gap-[8px]">
                    <span
                      className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                        row.state === "running"
                          ? "animate-pulse bg-[var(--botanical-2)]"
                          : row.state === "refused"
                            ? "bg-[var(--danger)]"
                            : "bg-[var(--botanical)]"
                      }`}
                    />
                    <span className="truncate font-mono text-[11px] leading-[1.618] text-[var(--ink-heading)]">
                      {row.display}
                    </span>
                  </div>
                  {row.detail ? (
                    <p
                      className={`bb-agent-run-text mt-[5px] line-clamp-2 ${
                        row.state === "refused" ? "text-[var(--danger)]" : "text-[var(--ink-muted)]"
                      }`}
                    >
                      {row.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {thinking || "Choosing a platform and backend…"}
            </p>
          )}
        </section>

        {result ? (
          <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
            <ChatMarkdown content={result} compact />
          </section>
        ) : failure ? (
          <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p>
        ) : null}
        </div>
      </div>
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
