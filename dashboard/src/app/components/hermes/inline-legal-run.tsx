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
  /** One of the harness's six tools: bash, read, write, edit, glob, grep. */
  tool: string;
  detail: string;
  state: "running" | "done" | "failed";
  result: string;
}

interface DeliverableRow {
  path: string;
  bytes: number;
  artifactId: string | null;
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "harness.started",
  "turn.started",
  "agent.text",
  "agent.usage",
  "step.started",
  "step.completed",
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readDeliverables(value: unknown): DeliverableRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const filePath = asString(row.path);
    if (!filePath) return [];
    return [
      {
        path: filePath,
        bytes: asNumber(row.bytes),
        artifactId: typeof row.artifactId === "string" ? row.artifactId : null,
      },
    ];
  });
}

function readProblems(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => asString(entry)).filter(Boolean) : [];
}

export default function InlineLegalRun({
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
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [note, setNote] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [documentCount, setDocumentCount] = useState(0);
  const [turn, setTurn] = useState(0);
  const [maxTurns, setMaxTurns] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [deliverables, setDeliverables] = useState<DeliverableRow[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
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
  const base = `/api/legal/runs/${runId}`;

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
        setMaxTurns(asNumber(payload.maxTurns));
        setDocumentCount(
          Array.isArray(payload.documents) ? payload.documents.length : 0,
        );
      }
      if (event.type === "harness.started") {
        setDocumentCount(asNumber(payload.documentCount));
        // Both of these change what the run can do without stopping it, so
        // saying so beats a Word file that reads oddly for no visible reason.
        const missing: string[] = [];
        if (payload.pandoc !== true) {
          missing.push(
            "Pandoc is missing, so Word files are read with a simpler reader — tables and formatting may come through less faithfully.",
          );
        }
        if (payload.shell !== true) {
          missing.push(
            "No shell on this run, so the deliverable will be markdown rather than Word, Excel or PowerPoint.",
          );
        }
        setWarnings(missing);
      }
      if (event.type === "turn.started") setTurn(asNumber(payload.turn));
      if (event.type === "agent.text") setNote(asString(payload.text));

      if (event.type === "step.started") {
        setSteps((current) =>
          [
            ...current,
            {
              key: String(event.sequenceNumber),
              callId: asString(payload.callId),
              tool: asString(payload.tool, "tool"),
              detail: asString(payload.detail),
              state: "running" as const,
              result: "",
            },
          ].slice(-160),
        );
      }
      if (event.type === "step.completed") {
        const callId = asString(payload.callId);
        const failed = asString(payload.status, "ok") === "error";
        setSteps((current) => {
          const index = current.findLastIndex((row) => row.callId === callId);
          if (index < 0) return current;
          const next = [...current];
          next[index] = {
            ...next[index],
            state: failed ? ("failed" as const) : ("done" as const),
            result: asString(payload.detail) || next[index].result,
          };
          return next;
        });
      }

      if (event.type === "artifacts") setDeliverables(readDeliverables(payload.files));

      if (event.type === "run.completed") {
        const summary = asString(payload.summary, "The Legal Agent finished.");
        setStatus("completed");
        setResult(summary);
        setElapsed(asNumber(payload.elapsedSec));
        setDeliverables(readDeliverables(payload.files));
        setProblems(readProblems(payload.artifactProblems));
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
            ? "The Legal Agent stopped."
            : "The Legal Agent could not complete this assignment.");
        setStatus(outcome);
        setFailure([message, asString(payload.detail)].filter(Boolean).join("\n\n"));
        setElapsed(asNumber(payload.elapsedSec));
        setProblems(readProblems(payload.artifactProblems));
        if (!reportedRef.current) {
          reportedRef.current = true;
          // A stopped review still keeps whatever it had written, so the saved
          // turn is the partial work rather than only the reason it ended.
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
    (status === "aborted" ? "The Legal Agent stopped." : "The Legal Agent finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={steps.at(-1)?.detail || note}
        agentName="Legal Agent"
      />
      <div className="bb-agent-run-card overflow-hidden">
        {/* The assignment is the user's own message directly above this card.
            The header carries the agent, its model, and how far it has got. */}
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Legal Agent
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
          {!terminal ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {documentCount
                ? `Working through ${documentCount} document${documentCount === 1 ? "" : "s"}`
                : "Reading the assignment"}
              {turn ? ` · turn ${turn}${maxTurns ? ` of ${maxTurns}` : ""}` : ""}
            </p>
          ) : null}
          {warnings.map((warning) => (
            <p key={warning} className="bb-agent-run-text text-[var(--ink-muted)]">
              {warning}
            </p>
          ))}

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
                      <span className="shrink-0 font-mono text-[11px] leading-[1.618] text-[var(--ink-heading)]">
                        {row.tool}
                      </span>
                      {row.detail ? (
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--ink-muted)]">
                          {row.detail}
                        </span>
                      ) : null}
                    </div>
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
                {note || "Opening the documents…"}
              </p>
            )}
          </section>

          {deliverables.length ? (
            <section>
              <p className="bb-agent-run-label mb-[8px]">
                Deliverables · {deliverables.length}
              </p>
              <ul className="space-y-[5px]">
                {deliverables.map((file) => (
                  <li
                    key={file.path}
                    className="bb-agent-run-row flex items-center gap-[8px] p-[8px]"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--ink-heading)]">
                      {file.path}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--ink-muted)]">
                      {formatBytes(file.bytes)}
                    </span>
                    {/* A file the artifact store kept is already a card of its
                        own in this chat; this link is the copy the run still
                        holds, which is all there is for one it would not take. */}
                    <a
                      href={`${base}/files/${file.path
                        .split("/")
                        .map(encodeURIComponent)
                        .join("/")}`}
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

          {result.trim() ? (
            <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
              <ChatMarkdown content={result} compact />
            </section>
          ) : null}
          {problems.map((problem) => (
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
