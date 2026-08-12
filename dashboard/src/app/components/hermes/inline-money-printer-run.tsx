"use client";

// The MoneyPrinter run card.
//
// The clone reports one number for a run that takes minutes, so the card's job
// is to turn that number into six named stages a person can watch go by — and to
// say which one is slow, because "finding and downloading footage" and "cutting
// the video" fail for completely different reasons.
//
// The video itself lives in its artifact, not in the transcript, so the finished
// card is a short result line with the narration under it and the video's own
// card directly beneath.
//
// Styling uses the shared run material (bb-agent-run-*) so this reads as the
// same object as every other external-agent run.

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

/**
 * The pipeline as the clone runs it, with the progress mark each stage is
 * announced at. Kept in step with `STAGES` in the run manager: the card reads
 * the stage out of the event, and these numbers only decide which rows are
 * already behind it.
 */
const STAGES = [
  { at: 5, label: "Writing the script" },
  { at: 10, label: "Choosing what footage to search for" },
  { at: 20, label: "Recording the voiceover" },
  { at: 30, label: "Timing the subtitles" },
  { at: 40, label: "Finding and downloading footage" },
  { at: 50, label: "Cutting the video" },
] as const;

const STREAMED_EVENT_TYPES = [
  "run.started",
  "service.starting",
  "service.ready",
  "source.substituted",
  "task.created",
  "task.progress",
  "stage.started",
  "video.ready",
  "artifact.unavailable",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

/** How far the supervised service has got, which is most of a cold run's wait. */
type ServiceState = "unknown" | "starting" | "ready";

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

export default function InlineMoneyPrinterRun({
  runId,
  brief,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onRetry,
}: {
  runId: string;
  brief: string;
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
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [notice, setNotice] = useState("");
  const [model, setModel] = useState("");
  const [shape, setShape] = useState("");
  const [videos, setVideos] = useState<Array<{ key: string; title: string }>>([]);
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
  const base = `/api/money-printer/runs/${runId}`;

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
        setShape(
          [
            asString(payload.aspect),
            asString(payload.source),
            asString(payload.voice).replace(/-(?:Female|Male)$/, ""),
          ]
            .filter(Boolean)
            .join(" · "),
        );
      }
      if (event.type === "service.starting") setService("starting");
      if (event.type === "service.ready") {
        setService("ready");
        setColdStart(payload.coldStart === true);
        const running = asString(payload.model);
        if (running) setModel(running);
      }
      // A library without a key would fail deep into the run, so the swap is
      // announced where it happens rather than discovered in the result.
      if (event.type === "source.substituted") setNotice(asString(payload.reason));
      if (event.type === "task.progress") setProgress(asNumber(payload.progress));
      if (event.type === "stage.started") {
        setStage(asString(payload.stage));
        setProgress(asNumber(payload.progress));
      }
      if (event.type === "video.ready") {
        setVideos((current) => [
          ...current,
          { key: asString(payload.artifactId, String(event.sequenceNumber)), title: asString(payload.title) },
        ]);
      }
      if (event.type === "artifact.unavailable") setNotice(asString(payload.reason));

      if (event.type === "run.completed") {
        const summary = asString(payload.summary, "MoneyPrinter finished.");
        setStatus("completed");
        setProgress(100);
        setResult(summary);
        setElapsed(asNumber(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          notifyTaskCompleted(`MoneyPrinter — ${brief.slice(0, 80)}`);
          onTerminalRef.current?.({ outcome: "completed", content: summary });
        }
      }
      if (event.type === "run.failed" || event.type === "run.aborted") {
        const outcome = event.type === "run.aborted" ? "aborted" : "failed";
        const stageName = asString(payload.stage);
        const message =
          asString(payload.error) ||
          asString(payload.summary) ||
          (outcome === "aborted"
            ? "The video was stopped."
            : "MoneyPrinter could not finish this video.");
        setStatus(outcome);
        setFailure(
          [stageName ? `Failed while working on: ${stageName}` : "", message, asString(payload.detail)]
            .filter(Boolean)
            .join("\n\n"),
        );
        setElapsed(asNumber(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          onTerminalRef.current?.({ outcome, content: message });
        }
      }
    },
    [brief],
  );

  useEffect(() => {
    // A finished run is gone from the manager's memory and its endpoint answers
    // with an error, so a restored turn never opens a stream.
    if (persistedOutcome && persistedOutcome !== "running") return;
    const source = new EventSource(`${base}/events?since=0`);
    const handler = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // A malformed frame must not take the card down.
      }
    };
    for (const type of STREAMED_EVENT_TYPES) source.addEventListener(type, handler);
    // EventSource reconnects on error by default, forever. Closing is what keeps
    // a dead run from being polled for the life of the tab.
    source.onerror = () => source.close();
    return () => {
      for (const type of STREAMED_EVENT_TYPES) source.removeEventListener(type, handler);
      source.close();
    };
  }, [applyEvent, base, persistedOutcome]);

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
    (status === "aborted" ? "The video was stopped." : "MoneyPrinter finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={stage}
        agentName="MoneyPrinter"
      />
      <div className="bb-agent-run-card overflow-hidden">
        {/* The subject is the user's own message directly above this card. The
            header carries the agent, the model it writes with, and its state. */}
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            MoneyPrinter
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
              {terminal ? status : `cutting · ${formatElapsed(elapsed)}`}
            </span>
            {!terminal ? (
              <button type="button" onClick={stop} className="bb-agent-run-action">
                Stop
              </button>
            ) : null}
          </div>
        </header>

        <div className="space-y-[13px] p-[21px]">
          {/* A first run has to start the cloned service, which is most of a
              minute of importing video libraries before any work begins. Saying
              so is the difference between "slow" and "broken". */}
          {!terminal && service !== "ready" ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {service === "starting"
                ? "Starting the MoneyPrinter service — the first run of a session loads its video and speech libraries."
                : "Preparing the run…"}
            </p>
          ) : null}
          {service === "ready" && coldStart && !terminal ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              Service started. Later runs in this session reuse it.
            </p>
          ) : null}
          {shape ? (
            <p className="bb-agent-run-text font-mono text-[10px] text-[var(--ink-muted)]">
              {shape}
            </p>
          ) : null}
          {notice ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">{notice}</p>
          ) : null}

          {!terminal || status !== "completed" ? (
            <section>
              <p className="bb-agent-run-label mb-[8px]">
                Pipeline{progress ? ` · ${Math.min(100, Math.round(progress))}%` : ""}
              </p>
              <ol className="space-y-[5px]">
                {STAGES.map((row) => {
                  const active = stage === row.label && !terminal;
                  const done = progress > row.at || (terminal && status === "completed");
                  return (
                    <li key={row.label} className="bb-agent-run-row flex items-center gap-[8px] p-[8px]">
                      <span
                        className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                          active
                            ? "animate-pulse bg-[var(--botanical-2)]"
                            : done
                              ? "bg-[var(--botanical)]"
                              : "bg-[color-mix(in_srgb,var(--line)_80%,transparent)]"
                        }`}
                      />
                      <span
                        className={`truncate text-[11px] leading-[1.618] ${
                          active || done ? "text-[var(--ink-heading)]" : "text-[var(--ink-muted)]"
                        }`}
                      >
                        {row.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {videos.length ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {videos.length === 1
                ? "The finished video is on the card below."
                : `${videos.length} cuts finished — each one is on its own card below.`}
            </p>
          ) : null}

          {result.trim() ? (
            <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
              <ChatMarkdown content={result} compact />
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
