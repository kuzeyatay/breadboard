"use client";

import { externalRunStartedAtMs } from "./external-run-clock";

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

interface StepRow {
  key: string;
  /** The call this row belongs to, so a result finds its own call. */
  callId: string;
  /** A DeerFlow tool (`bash`, `write_file`, `web_search`) or a subagent. */
  display: string;
  kind: "tool" | "subagent";
  detail: string;
  state: "running" | "done" | "failed";
  result: string;
}

interface ArtifactRow {
  id: string;
  name: string;
  path: string;
  artifactId: string | null;
}

/** How far the supervised Gateway has got, which is most of a cold run's wait. */
type ServiceState = "unknown" | "starting" | "ready";

const STREAMED_EVENT_TYPES = [
  "run.started",
  "service.starting",
  "service.ready",
  "thread.opened",
  "agent.thinking",
  "agent.warning",
  "step.started",
  "step.progress",
  "step.completed",
  "answer.delta",
  "artifacts",
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

function readArtifacts(value: unknown): ArtifactRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = asString(row.id);
    const path = asString(row.path);
    if (!id || !path) return [];
    return [
      {
        id,
        path,
        name: asString(row.name) || path.split("/").filter(Boolean).pop() || path,
        artifactId: typeof row.artifactId === "string" ? row.artifactId : null,
      },
    ];
  });
}

export default function InlineDeerFlowRun({
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
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [thinking, setThinking] = useState("");
  const [warning, setWarning] = useState("");
  const [model, setModel] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [answer, setAnswer] = useState("");
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [artifactProblems, setArtifactProblems] = useState<string[]>([]);
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
  const base = `/api/deer-flow/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedRef.current = false;
    startedRef.current = externalRunStartedAtMs(runId);
    setElapsed(Math.max(0, (Date.now() - startedRef.current) / 1_000));
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
      }
      if (event.type === "agent.thinking") setThinking(asString(payload.summary));
      if (event.type === "agent.warning") setWarning(asString(payload.message));

      if (event.type === "step.started") {
        setSteps((current) =>
          [
            ...current,
            {
              key: String(event.sequenceNumber),
              callId: asString(payload.callId),
              display: asString(payload.display, "tool"),
              kind: payload.kind === "subagent" ? ("subagent" as const) : ("tool" as const),
              detail: asString(payload.detail),
              state: "running" as const,
              result: "",
            },
          ].slice(-120),
        );
      }
      if (event.type === "step.progress" || event.type === "step.completed") {
        const callId = asString(payload.callId);
        const failed = asString(payload.status, "ok") === "error";
        setSteps((current) => {
          const index = current.findLastIndex((row) => row.callId === callId);
          if (index < 0) return current;
          const next = [...current];
          next[index] = {
            ...next[index],
            state:
              event.type === "step.completed"
                ? failed
                  ? ("failed" as const)
                  : ("done" as const)
                : next[index].state,
            result: asString(payload.detail) || next[index].result,
          };
          return next;
        });
      }

      // The answer streams in while the run is still working, so it is shown
      // live rather than held back until the terminal event.
      if (event.type === "answer.delta") {
        const chunk = asString(payload.text);
        if (chunk) setAnswer((current) => current + chunk);
      }

      if (event.type === "artifacts") setArtifacts(readArtifacts(payload.files));

      if (event.type === "run.completed") {
        const summary = asString(payload.summary, "DeerFlow finished.");
        setStatus("completed");
        setResult(summary);
        setElapsed(asNumber(payload.elapsedSec));
        setArtifacts(readArtifacts(payload.artifacts));
        setArtifactProblems(
          Array.isArray(payload.artifactProblems)
            ? payload.artifactProblems.map((entry) => asString(entry)).filter(Boolean)
            : [],
        );
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
            ? "DeerFlow stopped."
            : "DeerFlow could not complete this task.");
        setStatus(outcome);
        setFailure([message, asString(payload.detail)].filter(Boolean).join("\n\n"));
        setElapsed(asNumber(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          // A stopped run still keeps whatever it had written, so the stored
          // turn is the partial answer rather than only the reason it ended.
          const kept = outcome === "aborted" ? asString(payload.summary) : "";
          onTerminalRef.current?.({ outcome, content: kept || message });
        }
      }
    },
    [task],
  );

  useEffect(() => {
    // A finished turn renders from what was saved with it. Its run is long gone
    // from the manager's memory, and reopening the stream would only reconnect
    // to an endpoint that answers with an error.
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
    // EventSource reconnects on error forever by default, which on a run the
    // manager has already forgotten is an endless poll of a dead endpoint.
    source.onerror = () => source.close();
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
    (status === "aborted" ? "DeerFlow stopped." : "DeerFlow finished.");
  // While the run is live the streamed text is the answer; once it ends the
  // checkpointed reply replaces it.
  const shownAnswer = result.trim() || answer.trim();

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={steps.at(-1)?.display || thinking}
        agentName="DeerFlow"
      />
      <div className="bb-agent-run-card overflow-hidden">
        {/* The task is the user's own message directly above this card. The
            header carries the agent, the model it is running on, and its state. */}
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            DeerFlow
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
          {/* A first run has to start the cloned Gateway, which is most of a
              minute of imports and a schema migration before any work begins.
              Saying so is the difference between "slow" and "broken". */}
          {!terminal && service !== "ready" ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {service === "starting"
                ? "Starting the DeerFlow Gateway — the first run of a session loads its agent runtime."
                : "Preparing the run…"}
            </p>
          ) : null}
          {service === "ready" && coldStart && !terminal ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              Gateway started. Later runs in this session reuse it.
            </p>
          ) : null}
          {warning ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">{warning}</p>
          ) : null}

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
                            : row.state === "failed"
                              ? "bg-[var(--danger)]"
                              : "bg-[var(--botanical)]"
                        }`}
                      />
                      <span className="truncate font-mono text-[11px] leading-[1.618] text-[var(--ink-heading)]">
                        {row.kind === "subagent" ? "subagent" : row.display}
                      </span>
                    </div>
                    {row.detail ? (
                      <p className="bb-agent-run-text mt-[5px] line-clamp-1 font-mono text-[10px] text-[var(--ink-muted)]">
                        {row.detail}
                      </p>
                    ) : null}
                    {row.result ? (
                      <p
                        className={`bb-agent-run-text mt-[5px] line-clamp-2 ${
                          row.state === "failed"
                            ? "text-[var(--danger)]"
                            : "text-[var(--ink-muted)]"
                        }`}
                      >
                        {row.result}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="bb-agent-run-text text-[var(--ink-muted)]">
                {thinking || "Reading the task…"}
              </p>
            )}
          </section>

          {artifacts.length ? (
            <section>
              <p className="bb-agent-run-label mb-[8px]">Files · {artifacts.length}</p>
              <ul className="space-y-[5px]">
                {artifacts.map((file) => (
                  <li key={file.id} className="bb-agent-run-row flex items-center gap-[8px] p-[8px]">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--ink-heading)]">
                      {file.name}
                    </span>
                    {/* The link resolves the durable artifact named by the
                        sealed run projection, so it survives worker/service
                        disposal and a dashboard restart. */}
                    <a
                      href={`${base}/artifacts/${encodeURIComponent(file.id)}`}
                      className="bb-agent-run-action shrink-0"
                      download
                    >
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {shownAnswer ? (
            <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
              <ChatMarkdown content={shownAnswer} compact />
            </section>
          ) : null}
          {artifactProblems.map((problem) => (
            <p key={problem} className="bb-agent-run-text text-[var(--ink-muted)]">
              {problem}
            </p>
          ))}
          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}
        </div>
      </div>
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
