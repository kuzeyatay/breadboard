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
import { resolveAgentRunStreamError } from "@/lib/agent-run-stream";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface StepRow {
  key: string;
  kind: string;
  display: string;
  state: "running" | "done" | "refused";
  detail: string;
}

interface WorkspaceSnapshot {
  onboardingNeeded: boolean;
  missing: string[];
  browsersInstalled: boolean;
  trackedApplications: number | null;
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "workspace.checking",
  "workspace.checked",
  "mode.resolved",
  "agent.thinking",
  "agent.usage",
  "step.started",
  "step.completed",
  "step.refused",
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

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatElapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

export default function InlineCareerOpsRun({
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
  const [mode, setMode] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [checking, setChecking] = useState(false);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [written, setWritten] = useState<string[]>([]);
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
  const base = `/api/career-ops/runs/${runId}`;

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
        setMode(asString(payload.mode));
      }
      if (event.type === "workspace.checking") setChecking(true);
      if (event.type === "workspace.checked") {
        setChecking(false);
        setWorkspace({
          onboardingNeeded: payload.onboardingNeeded === true,
          missing: asStrings(payload.missing),
          browsersInstalled: payload.browsersInstalled === true,
          trackedApplications:
            typeof payload.trackedApplications === "number" ? payload.trackedApplications : null,
        });
      }
      if (event.type === "mode.resolved" && typeof payload.mode === "string") {
        setMode(payload.mode);
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
      if (event.type === "step.started") {
        setSteps((current) =>
          [
            ...current,
            {
              key: String(event.sequenceNumber),
              kind: asString(payload.kind, "step"),
              display: asString(payload.display),
              state: "running" as const,
              detail: "",
            },
          ].slice(-60),
        );
      }
      if (event.type === "step.completed") {
        const display = asString(payload.display);
        setSteps((current) => {
          const index = current.findLastIndex(
            (row) => row.display === display && row.state === "running",
          );
          if (index < 0) return current;
          const next = [...current];
          next[index] = { ...next[index], state: "done", detail: asString(payload.detail) };
          return next;
        });
      }
      if (event.type === "step.refused") {
        setSteps((current) =>
          [
            ...current,
            {
              key: String(event.sequenceNumber),
              kind: "refused",
              display: asString(payload.command),
              state: "refused" as const,
              detail: asString(payload.reason),
            },
          ].slice(-60),
        );
      }
      if (event.type === "run.completed") {
        const summary = asString(payload.summary, "Career Ops finished.");
        setStatus("completed");
        setResult(summary);
        setWritten(asStrings(payload.written));
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
            ? "Career Ops stopped."
            : "Career Ops could not complete this task.");
        setStatus(outcome);
        setFailure(message);
        setWritten(asStrings(payload.written));
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
      resolveAgentRunStreamError({
        source,
        base,
        replayEnding: applyEvent,
        onUnavailable: (reason) => {
          setStatus("failed");
          setFailure(
            reason === "run_not_found"
              ? "This Career Ops run is no longer live, but its saved result remains below."
              : "The Career Ops event stream is unavailable.",
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
    (status === "aborted" ? "Career Ops stopped." : "Career Ops finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        totalTokens={usageReported ? usage.inputTokens + usage.outputTokens : undefined}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={steps.at(-1)?.display || thinking}
        agentName="Career Ops"
      />
      <div className="bb-agent-run-card overflow-hidden">
        {/* The task is the user's own message directly above this card. The
            header carries the agent, the mode it routed to, and its state. */}
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Career Ops
            {mode ? (
              <span className="ml-[8px] font-mono text-[11px] font-normal text-[var(--botanical)]">
                {mode}
              </span>
            ) : null}
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
          {/* What the workspace could offer this run. A missing candidate layer
              is the single thing that most changes what the answer can claim. */}
          <section className="space-y-[5px]">
            <p className="bb-agent-run-label">Workspace</p>
            {checking || !workspace ? (
              <p className="bb-agent-run-text text-[var(--ink-muted)]">
                {checking ? "Checking the career-ops workspace…" : "Waiting for the workspace check…"}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-[5px]">
                <li className="bb-agent-run-pill px-[8px] py-[3px] text-[11px] leading-[1.618] text-[var(--ink-muted)]">
                  <span className="font-medium text-[var(--ink-heading)]">Tracker</span>
                  {workspace.trackedApplications === null
                    ? " · not created yet"
                    : ` · ${workspace.trackedApplications} application${workspace.trackedApplications === 1 ? "" : "s"}`}
                </li>
                <li className="bb-agent-run-pill px-[8px] py-[3px] text-[11px] leading-[1.618] text-[var(--ink-muted)]">
                  <span className="font-medium text-[var(--ink-heading)]">Candidate files</span>
                  {workspace.onboardingNeeded
                    ? ` · missing ${workspace.missing.join(", ")}`
                    : " · ready"}
                </li>
                <li className="bb-agent-run-pill px-[8px] py-[3px] text-[11px] leading-[1.618] text-[var(--ink-muted)]">
                  <span className="font-medium text-[var(--ink-heading)]">Portal scanning</span>
                  {workspace.browsersInstalled ? " · available" : " · browser not installed"}
                </li>
              </ul>
            )}
          </section>

          <section>
            <p className="bb-agent-run-label mb-[8px]">
              Steps{steps.length ? ` · ${steps.length}` : ""}
            </p>
            {steps.length ? (
              <ol className="max-h-64 space-y-[5px] overflow-y-auto pr-1">
                {steps.map((row) => (
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
                          row.state === "refused"
                            ? "text-[var(--danger)]"
                            : "text-[var(--ink-muted)]"
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
                {thinking || "Reading the workspace and the mode…"}
              </p>
            )}
          </section>

          {written.length ? (
            <section className="space-y-[5px]">
              <p className="bb-agent-run-label">Files written · {written.length}</p>
              <ul className="flex flex-wrap gap-[5px]">
                {written.map((file) => (
                  <li
                    key={file}
                    className="bb-agent-run-pill px-[8px] py-[3px] font-mono text-[11px] leading-[1.618] text-[var(--ink-heading)]"
                  >
                    {file}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
