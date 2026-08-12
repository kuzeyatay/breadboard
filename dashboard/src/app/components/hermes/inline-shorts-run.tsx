"use client";

// The Shorts run card.
//
// Four stages, and the slow ones are slow: a long video downloads, transcribes
// on this machine, and then re-encodes once per clip. So the card counts rather
// than sitting on one unchanging line, and it names the highlights the ranker
// chose as soon as it has them — long before the clips finish encoding.
//
// The clips themselves live in their own artifacts, not in the transcript, so
// the finished card is a short result and their cards sit directly beneath it.
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
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const STAGES = [
  { key: "download", label: "Fetching the video" },
  { key: "transcribe", label: "Transcribing the audio" },
  { key: "highlights", label: "Ranking the highlights" },
  { key: "clip", label: "Cutting and reframing" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];
type StageState = "pending" | "active" | "done";

const STREAMED_EVENT_TYPES = [
  "run.started",
  "stage.updated",
  "source.ready",
  "transcript.ready",
  "highlights.ready",
  "clip.started",
  "clip.cut",
  "clip.failed",
  "clip.stored",
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

function timecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

interface Highlight {
  title: string;
  startSec: number;
  endSec: number;
  score: number;
}

function readHighlights(value: unknown): Highlight[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return [
      {
        title: asString(record.title, "Untitled"),
        startSec: asNumber(record.startSec),
        endSec: asNumber(record.endSec),
        score: asNumber(record.score),
      },
    ];
  });
}

export default function InlineShortsRun({
  runId,
  task,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onRetry,
}: {
  runId: string;
  /** The run's label — the video and what was asked for, not a prompt. */
  task: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [stages, setStages] = useState<Record<StageKey, StageState>>({
    download: "pending",
    transcribe: "pending",
    highlights: "pending",
    clip: "pending",
  });
  const [source, setSource] = useState("");
  const [transcript, setTranscript] = useState({ segments: 0, durationSec: 0 });
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [cut, setCut] = useState({ done: 0, total: 0, failed: 0 });
  const [specs, setSpecs] = useState<Array<[string, string]>>([]);
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [startedAt, setStartedAt] = useState<string | undefined>();
  const [completedAt, setCompletedAt] = useState<string | undefined>();
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  const base = `/api/shorts/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedRef.current = false;
  }, [runId]);

  const advance = useCallback((key: StageKey, state: StageState) => {
    setStages((current) => ({ ...current, [key]: state }));
  }, []);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.at) setStartedAt((current) => current ?? event.at);
      switch (event.type) {
        case "run.started":
          setStatus("running");
          setSource(asString(payload.source));
          if (event.at) setStartedAt(event.at);
          break;
        case "stage.updated": {
          const key = asString(payload.stage) as StageKey;
          if (!STAGES.some((stage) => stage.key === key)) break;
          const state = asString(payload.status);
          advance(key, state === "completed" ? "done" : state === "running" ? "active" : "pending");
          break;
        }
        case "transcript.ready":
          setTranscript({
            segments: asNumber(payload.segments),
            durationSec: asNumber(payload.durationSec),
          });
          break;
        case "highlights.ready":
          setHighlights(readHighlights(payload.items));
          setCut((current) => ({ ...current, total: asNumber(payload.kept) || current.total }));
          break;
        case "clip.started":
          setCut((current) => ({
            ...current,
            total: asNumber(payload.total) || current.total,
          }));
          break;
        case "clip.cut":
          setCut((current) => ({
            ...current,
            done: current.done + 1,
            total: asNumber(payload.total) || current.total,
          }));
          break;
        case "clip.failed":
          setCut((current) => ({ ...current, failed: current.failed + 1 }));
          break;
        case "run.completed": {
          setStatus("completed");
          setResult(asString(payload.summary));
          setCompletedAt(event.at);
          for (const stage of STAGES) advance(stage.key, "done");
          const clipCount = asNumber(payload.clipCount);
          setSpecs(
            (
              [
                ["Clips", clipCount ? String(clipCount) : ""],
                [
                  "Source",
                  transcriptLabel(asNumber(payload.durationSec) || 0),
                ],
                [
                  "Attached",
                  asNumber(payload.attached) ? `${asNumber(payload.attached)} of ${clipCount}` : "",
                ],
              ] as Array<[string, string]>
            ).filter(([, value]) => value),
          );
          break;
        }
        case "run.failed":
          setStatus("failed");
          setFailure(
            [asString(payload.error, "The run failed."), asString(payload.detail)]
              .filter(Boolean)
              .join("\n\n"),
          );
          setCompletedAt(event.at);
          break;
        case "run.aborted":
          setStatus("aborted");
          setFailure(asString(payload.summary, "The run was stopped."));
          setCompletedAt(event.at);
          break;
        default:
          break;
      }
    },
    [advance],
  );

  useEffect(() => {
    // A finished run is gone from the manager's memory and its endpoint answers
    // with an error, so a restored turn must not open a stream at all.
    if (persistedOutcome && persistedOutcome !== "running") return;
    const stream = new EventSource(`${base}/events`);
    const handler = (event: MessageEvent) => {
      try {
        applyEvent(JSON.parse(event.data) as RunEvent);
      } catch {
        // A malformed frame must not take the card down.
      }
    };
    for (const type of STREAMED_EVENT_TYPES) stream.addEventListener(type, handler);
    // EventSource reconnects on error by default, forever.
    stream.onerror = () => stream.close();
    return () => {
      for (const type of STREAMED_EVENT_TYPES) stream.removeEventListener(type, handler);
      stream.close();
    };
  }, [applyEvent, base, persistedOutcome]);

  useEffect(() => {
    if (!TERMINAL.has(status) || reportedRef.current) return;
    reportedRef.current = true;
    const content = status === "completed" ? result : failure;
    if (!content) return;
    notifyTaskCompleted(`Shorts — ${task.slice(0, 80)}`);
    onTerminalRef.current?.({
      outcome: status as ExternalAgentTerminalOutcome,
      content,
    });
  }, [failure, result, status, task]);

  const running = !TERMINAL.has(status);
  const statusDot = running
    ? "animate-pulse bg-[var(--botanical-2)]"
    : status === "completed"
      ? "bg-[var(--botanical)]"
      : "bg-[var(--danger)]";
  const transcribeLine = transcript.segments
    ? `${transcript.segments} segments · ${timecode(transcript.durationSec)}`
    : "";
  const cuttingLine = cut.total ? `${cut.done}/${cut.total} clips` : "";
  const hasDetail = Boolean(specs.length || running || !result || highlights.length);

  return (
    <>
      <AssistantResponseMeta
        active={running}
        failed={!running && status !== "completed"}
        agentName="Shorts"
        startedAt={startedAt}
        completedAt={completedAt}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <div className="bb-agent-run-header">
          <span className="bb-agent-run-title truncate">Shorts</span>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span className={`bb-agent-run-led h-1.5 w-1.5 ${statusDot}`} />
              {running ? "cutting" : status}
            </span>
            {running ? (
              <button
                type="button"
                className="bb-agent-run-action"
                onClick={() => {
                  void fetch(`${base}/abort`, { method: "POST" });
                }}
              >
                Stop
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-[13px] p-[21px]">
          <p className="truncate text-[13px] leading-[1.4] text-[var(--ink-muted)]">
            {source || task}
          </p>

          {specs.length ? (
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(89px,1fr))] gap-x-[21px] gap-y-[13px]">
              {specs.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="bb-agent-run-label">{label}</dt>
                  <dd className="truncate text-[13px] font-medium leading-[1.4] text-[var(--ink-heading)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {running || !result ? (
            <ol className="bb-agent-run-inset space-y-[5px] p-[13px]">
              {STAGES.map((stage) => (
                <li key={stage.key} className="flex items-center gap-[8px]">
                  <span
                    aria-hidden="true"
                    className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                      stages[stage.key] === "done"
                        ? "bg-[var(--botanical)]"
                        : stages[stage.key] === "active"
                          ? "animate-pulse bg-[var(--botanical-2)]"
                          : "bg-[var(--line-strong)]"
                    }`}
                  />
                  <span
                    className={`text-[13px] leading-[1.618] ${
                      stages[stage.key] === "pending"
                        ? "text-[var(--ink-muted)]"
                        : "text-[var(--ink)]"
                    }`}
                  >
                    {stage.label}
                    {stage.key === "transcribe" && stages.transcribe !== "pending" && transcribeLine
                      ? ` — ${transcribeLine}`
                      : ""}
                    {stage.key === "clip" && stages.clip === "active" && cuttingLine
                      ? ` — ${cuttingLine}`
                      : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {highlights.length ? (
            <section className="space-y-[5px]">
              <p className="bb-agent-run-label">Chosen moments · {highlights.length}</p>
              <ul className="space-y-[3px]">
                {highlights.map((highlight, index) => (
                  <li
                    key={`${highlight.title}-${index}`}
                    className="flex items-baseline gap-[8px] text-[13px] leading-[1.5]"
                  >
                    <span className="shrink-0 font-mono text-[11px] text-[var(--ink-muted)]">
                      {timecode(highlight.startSec)}–{timecode(highlight.endSec)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
                      {highlight.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--ink-muted)]">
                      {highlight.score}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {cut.failed ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {cut.failed} clip{cut.failed === 1 ? "" : "s"} could not be encoded and
              {cut.failed === 1 ? " was" : " were"} left out.
            </p>
          ) : null}

          {result ? (
            <div
              className={
                hasDetail
                  ? "bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]"
                  : "bb-agent-run-text"
              }
            >
              <ChatMarkdown content={result} compact />
            </div>
          ) : null}

          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}
        </div>
      </div>
      {!running ? (
        <AssistantMessageActions content={result || failure} onRetry={onRetry} />
      ) : null}
    </>
  );
}

function transcriptLabel(durationSec: number): string {
  return durationSec ? timecode(durationSec) : "";
}
