"use client";

// The Meeting Notes run card.
//
// A run is three steps with wildly different durations — finding the recording
// is instant, transcribing it is most of an hour on a long meeting, and writing
// the notes is a model call per chunk — so the card's job is to make the wait
// legible. The stage list says which step it is on, the transcriber's own
// progress line says what it is doing inside the slow one, and the chunk counter
// turns the last step into a number that moves.
//
// The payoff is the notes themselves, rendered as markdown and kept as the body
// of the turn, because "see the artifact" is worthless to somebody scrolling
// back through a transcript a week later.
//
// Styling uses the shared run material (bb-agent-run-*) so this reads as the
// same object as every other external-agent run.

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
import { resolveAgentRunStreamError } from "@/lib/agent-run-stream";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const STAGES = [
  { key: "finding", label: "Finding the recording" },
  { key: "transcribing", label: "Transcribing" },
  { key: "writing", label: "Writing the notes" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

const STREAMED_EVENT_TYPES = [
  "run.started",
  "source.resolving",
  "source.resolved",
  "transcribe.started",
  "transcribe.progress",
  "transcribe.completed",
  "notes.started",
  "notes.chunk",
  "notes.retry",
  "notes.completed",
  "run.usage",
  "artifacts.saved",
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

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function formatElapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} kB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export default function InlineMeetingNotesRun({
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
  const [stage, setStage] = useState<StageKey>("finding");
  // Seeded from the saved turn, or a reloaded run renders empty.
  const [notes, setNotes] = useState(persistedOutcome === "completed" ? persistedContent : "");
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceBytes, setSourceBytes] = useState(0);
  const [transcriberStage, setTranscriberStage] = useState("");
  const [engine, setEngine] = useState("");
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [chunk, setChunk] = useState({ index: 0, total: 0 });
  const [retries, setRetries] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  // Stamped in the effect below rather than here: reading the clock during
  // render is impure, and a re-render would move the run's start time.
  const startedRef = useRef(0);
  const base = `/api/meeting-notes/runs/${runId}`;
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
      if (outcome === "completed") {
        notifyTaskCompleted(`Meeting Notes — ${(task || "the recording in this chat").slice(0, 80)}`);
      }
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
          setStage("finding");
          break;
        case "source.resolved":
          setSourceLabel(asString(payload.label));
          setSourceBytes(asNumber(payload.byteSize));
          break;
        case "transcribe.started":
          setStage("transcribing");
          break;
        case "transcribe.progress":
          setTranscriberStage(asString(payload.stage));
          break;
        case "transcribe.completed":
          setEngine(asString(payload.engine));
          setSpeakers(asStringList(payload.speakers));
          setTranscriberStage("");
          break;
        case "notes.started":
          setStage("writing");
          break;
        case "notes.chunk":
          setChunk({ index: asNumber(payload.index), total: asNumber(payload.total) });
          break;
        case "notes.retry":
          // Counted rather than shown one by one: a retry is normal, a lot of
          // them is the thing worth noticing.
          setRetries((current) => current + 1);
          break;
        case "run.usage":
          setUsage({
            inputTokens: asNumber(payload.inputTokens),
            outputTokens: asNumber(payload.outputTokens),
            totalTokens: asNumber(payload.inputTokens) + asNumber(payload.outputTokens),
            cachedInputTokens: 0,
            reasoningTokens: 0,
            scope: "turn",
            apiCalls: asNumber(payload.calls),
          });
          break;
        case "run.completed": {
          const summary = asString(payload.summary);
          setStatus("completed");
          if (summary) setNotes(summary);
          reportTerminal("completed", summary);
          break;
        }
        case "run.failed":
        case "run.aborted": {
          const outcome = event.type === "run.aborted" ? "aborted" : "failed";
          const message =
            asString(payload.summary) ||
            asString(payload.error) ||
            (outcome === "aborted" ? "The run was stopped." : "The meeting notes run failed.");
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
    // A finished run is gone from the manager's memory and its endpoint answers
    // with an error, so a replayed turn must never open a stream.
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
    // EventSource reconnects on error by default, forever. Closing here is what
    // keeps a restored turn from hammering a dead endpoint.
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
              : "The Meeting Notes event stream is unavailable.",
          );
        },
      });
    };
    return () => source.close();
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
    notes.trim() ||
    failure.trim() ||
    (status === "aborted" ? "The run was stopped." : "The run finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        agentName="Meeting Notes"
        usage={usage}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={STAGES[activeStageIndex]?.label}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Meeting Notes
            {engine ? (
              <span className="ml-[8px] text-[11px] font-normal text-[var(--ink-muted)]">
                {engine === "scriberr" ? "Scriberr" : "local speech"}
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
              {terminal
                ? status
                : `${STAGES[activeStageIndex]?.key ?? "working"} · ${formatElapsed(elapsed)}`}
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
          {/* Which recording was picked is said out loud, because on a delegated
              run nobody chose it — the agent took the newest one in the chat,
              and a wrong guess should cost one message to correct rather than
              being a mystery. */}
          {sourceLabel ? (
            <p className="bb-agent-run-label">
              Reading {sourceLabel}
              {sourceBytes ? ` · ${formatBytes(sourceBytes)}` : ""}
            </p>
          ) : null}

          {!terminal && !notes ? (
            <ol className="space-y-[5px]">
              {STAGES.map((item, index) => {
                const state =
                  index < activeStageIndex
                    ? "done"
                    : index === activeStageIndex
                      ? "active"
                      : "pending";
                const detail =
                  state === "active" && item.key === "transcribing"
                    ? transcriberStage
                    : state === "active" && item.key === "writing" && chunk.total
                      ? `section ${chunk.index} of ${chunk.total}`
                      : "";
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
                      {detail ? (
                        <span className="ml-[6px] text-[var(--ink-muted)]">{detail}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {speakers.length ? (
            <p className="bb-agent-run-label">
              {speakers.length} speaker{speakers.length === 1 ? "" : "s"} · {speakers.join(", ")}
            </p>
          ) : null}

          {notes ? (
            <section className="bb-agent-run-text">
              <ChatMarkdown content={notes} compact />
            </section>
          ) : null}

          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}

          {retries ? (
            <p className="bb-agent-run-label">
              {retries} section{retries === 1 ? "" : "s"} needed rewriting to fit the notes format
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
