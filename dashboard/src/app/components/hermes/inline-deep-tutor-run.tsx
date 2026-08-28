"use client";

import { externalRunStartedAtMs } from "./external-run-clock";

// One Deep Tutor turn, live in the transcript.
//
// The card leads with the thing that is easy to get wrong about this agent:
// what it is reading. A tutoring answer that quietly came from nowhere looks
// exactly like one grounded in your notes, so the material line is stated
// before the answer rather than hidden in a details pane.

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import { closeAgentRunStream, resolveAgentRunStreamError } from "@/lib/agent-run-stream";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface StepRow {
  key: string;
  tool: string;
  title: string;
  state: "running" | "done" | "failed";
  detail: string;
}

interface MaterialSnapshot {
  scopeKind: string;
  scopeLabel: string;
  rootCount: number;
  browsable: boolean;
  attached: string[];
  /** How this turn could reach the material beyond what was attached. */
  retrieval: string;
  indexedDocuments: number;
  indexError: string;
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "materials.resolved",
  "turn.started",
  "tutor.stage",
  "tutor.note",
  "tutor.asked",
  "reasoning.completed",
  "tool.started",
  "tool.completed",
  "block.settled",
  "sources.found",
  "agent.usage",
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

/** What the tutor can see, said in one line a learner can act on. */
function materialLine(material: MaterialSnapshot | null): string {
  if (!material) return "Working out what is in scope…";
  if (material.rootCount === 0) {
    return `${material.scopeLabel} has no files on disk, so this answer comes from the conversation alone.`;
  }
  const reach = material.browsable
    ? material.scopeKind === "garden"
      ? `Reading ${material.scopeLabel}`
      : `Reading ${material.scopeLabel}`
    : `${material.scopeLabel} is in scope but the file tools are unavailable`;
  const start = material.attached.length
    ? `started from ${material.attached.slice(0, 4).join(", ")}${
        material.attached.length > 4 ? ` and ${material.attached.length - 4} more` : ""
      }`
    : "searching it as needed";
  return `${reach} — ${start}${retrievalSuffix(material)}.`;
}

/**
 * What the tutor could do beyond the files it was handed. Worth a clause of its
 * own: "searched 74 notes by meaning" and "read the files it could name" are
 * different answers to the same question, and only one of them finds a note
 * that never uses your words.
 */
function retrievalSuffix(material: MaterialSnapshot): string {
  if (material.retrieval === "ready") {
    return material.indexedDocuments
      ? `, with all ${material.indexedDocuments} of its files searchable by meaning`
      : ", with its files searchable by meaning";
  }
  if (material.retrieval === "building") return ", while its search index builds";
  if (material.retrieval === "stale") return ", with its search index rebuilding after your edits";
  if (material.retrieval === "missing") return ", with its search index building for next time";
  if (material.retrieval === "failed") {
    return material.indexError ? `. Indexing failed: ${material.indexError}` : ". Indexing failed";
  }
  return "";
}

export default function InlineDeepTutorRun({
  runId,
  task,
  capability,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onRetry,
}: {
  runId: string;
  task: string;
  capability?: string;
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
  const [model, setModel] = useState("");
  const [continuing, setContinuing] = useState(false);
  const [material, setMaterial] = useState<MaterialSnapshot | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [stage, setStage] = useState("");
  const [thought, setThought] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [streamed, setStreamed] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState({ totalTokens: 0, rounds: 0, toolSteps: 0 });
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
  const base = `/api/deep-tutor/runs/${runId}`;

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
        setMode(asString(payload.capabilityLabel));
        setModel(asString(payload.model));
        setContinuing(payload.continuing === true);
      }
      if (event.type === "materials.resolved") {
        setMaterial({
          scopeKind: asString(payload.scopeKind, "workspace"),
          scopeLabel: asString(payload.scopeLabel, "your material"),
          rootCount: asNumber(payload.rootCount),
          browsable: payload.browsable === true,
          attached: asStrings(payload.attached),
          retrieval: asString(payload.retrieval, "off"),
          indexedDocuments: asNumber(payload.indexedDocuments),
          indexError: asString(payload.indexError),
        });
      }
      if (event.type === "tutor.stage") {
        const label = asString(payload.label) || asString(payload.stage);
        if (label) setStage(label);
      }
      if (event.type === "tutor.note") {
        const note = asString(payload.text);
        if (note) setNotes((current) => [...current, note].slice(-4));
      }
      if (event.type === "tutor.asked") {
        setNotes((current) =>
          [
            ...current,
            "The tutor asked a question mid-turn. Nobody was there to answer, so it carried on with what it had — ask again with more detail if the answer hedges.",
          ].slice(-4),
        );
      }
      if (event.type === "reasoning.completed") setThought(true);
      if (event.type === "tool.started") {
        setSteps((current) =>
          [
            ...current,
            {
              key: String(event.sequenceNumber),
              tool: asString(payload.tool, "tool"),
              title: asString(payload.title),
              state: "running" as const,
              detail: "",
            },
          ].slice(-40),
        );
      }
      if (event.type === "tool.completed") {
        const tool = asString(payload.tool, "tool");
        const failed = asString(payload.status) === "failed";
        setSteps((current) => {
          const index = current.findLastIndex(
            (row) => row.tool === tool && row.state === "running",
          );
          const detail = asString(payload.summary).split(/\r?\n/).slice(0, 2).join(" ");
          if (index < 0) {
            return [
              ...current,
              {
                key: String(event.sequenceNumber),
                tool,
                title: asString(payload.title),
                state: failed ? ("failed" as const) : ("done" as const),
                detail,
              },
            ].slice(-40);
          }
          const next = [...current];
          next[index] = { ...next[index], state: failed ? "failed" : "done", detail };
          return next;
        });
      }
      if (event.type === "block.settled") {
        const body = asString(payload.text);
        // Narration is the tutor talking itself through the next step. It is
        // worth watching live and not worth keeping in the answer.
        if (body && asString(payload.role) !== "narration") {
          setStreamed((current) => (current ? `${current}\n\n${body}` : body));
        }
      }
      if (event.type === "agent.usage") {
        setUsage({
          totalTokens: asNumber(payload.totalTokens),
          rounds: asNumber(payload.rounds),
          toolSteps: asNumber(payload.toolSteps),
        });
        setUsageReported(asNumber(payload.totalTokens) > 0);
      }
      if (event.type === "run.completed") {
        const summary = asString(payload.summary, "The tutor finished.");
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
        const partial = asString(payload.summary);
        const message =
          asString(payload.error) ||
          (outcome === "aborted" ? "The tutor was stopped." : "The tutoring turn failed.");
        setStatus(outcome);
        setFailure(message);
        setElapsed(asNumber(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          // Half an explanation still teaches something; the error is appended
          // rather than replacing it.
          onTerminalRef.current?.({
            outcome,
            content: partial ? `${partial}\n\n---\n\n_${message}_` : message,
          });
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
              ? "This tutoring turn is no longer live, but its saved answer remains below."
              : "The Deep Tutor event stream is unavailable.",
          );
        },
      });
    };
    return () => closeAgentRunStream(source);
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
  const answer = result || streamed;
  const terminalContent =
    result.trim() || streamed.trim() || failure.trim() || "The tutor finished.";
  const headerMode = mode || capability?.replace(/_/g, " ") || "";

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        totalTokens={usageReported ? usage.totalTokens : undefined}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={steps.at(-1)?.title || stage}
        agentName="Deep Tutor"
      />
      <div className="bb-agent-run-card overflow-hidden">
        {/* The question is the user's own message directly above this card. The
            header carries the agent, the mode it ran, and its state. */}
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Deep Tutor
            {headerMode ? (
              <span className="ml-[8px] font-mono text-[11px] font-normal capitalize text-[var(--botanical)]">
                {headerMode}
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
          {/* The single most load-bearing fact about a tutoring answer. */}
          <section className="space-y-[5px]">
            <p className="bb-agent-run-label">
              Material{continuing ? " · continuing this thread" : ""}
            </p>
            <p className="bb-agent-run-text text-[var(--ink-muted)]">{materialLine(material)}</p>
          </section>

          {steps.length ? (
            <section>
              <p className="bb-agent-run-label mb-[8px]">Looked at · {steps.length}</p>
              <ol className="max-h-56 space-y-[5px] overflow-y-auto pr-1">
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
                        {row.tool}
                        {row.title ? (
                          <span className="text-[var(--ink-muted)]">({row.title})</span>
                        ) : null}
                      </span>
                    </div>
                    {row.detail ? (
                      <p
                        className={`bb-agent-run-text mt-[5px] line-clamp-2 ${
                          row.state === "failed" ? "text-[var(--danger)]" : "text-[var(--ink-muted)]"
                        }`}
                      >
                        {row.detail}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : !answer ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {stage || (thought ? "Thinking it through…" : "Starting the tutoring turn…")}
            </p>
          ) : null}

          {notes.length ? (
            <ul className="space-y-[5px]">
              {notes.map((note) => (
                <li key={note} className="bb-agent-run-text text-[var(--ink-muted)]">
                  {note}
                </li>
              ))}
            </ul>
          ) : null}

          {answer ? (
            <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
              <ChatMarkdown content={answer} compact />
            </section>
          ) : null}
          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}
        </div>
      </div>
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
