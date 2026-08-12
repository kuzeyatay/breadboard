"use client";

// The Video Use run card.
//
// An edit has four stages and only one of them is fast. Transcribing runs once
// per video and is cached forever after; planning is one model call; rendering
// re-encodes every kept segment and then normalizes the loudness of the whole
// thing. So the card names the stage it is in and, during the render, the
// segment it is on — a cut of thirty pieces would otherwise sit on "rendering"
// for minutes with nothing to show for it.
//
// The video itself lives in its artifact, not in the transcript, so the finished
// card is a short result with the video's own card directly beneath it.
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
  { key: "fetch", label: "Fetching the video" },
  { key: "read", label: "Reading the video" },
  { key: "plan", label: "Planning the cut" },
  { key: "render", label: "Rendering" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];
type StageState = "pending" | "active" | "done";

const STREAMED_EVENT_TYPES = [
  "run.started",
  "source.ready",
  "source.probed",
  "stage.updated",
  "fetch.progress",
  "plan.ready",
  "render.progress",
  "artifact.stored",
  "run.completed",
  "run.failed",
  "run.aborted",
];

const TERMINAL = new Set(["completed", "failed", "aborted"]);
const TERMINAL_EVENT_TYPES = new Set([
  "run.completed",
  "run.failed",
  "run.aborted",
]);

/** Reopen attempts before the card settles for polling instead. */
const MAX_STREAM_ATTEMPTS = 4;
const POLL_INTERVAL_MS = 2_000;

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

export default function InlineVideoUseRun({
  runId,
  task,
  quiet = false,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onSourceReady,
  onRetry,
}: {
  runId: string;
  /** The run's label — the video and what was asked of it. */
  task: string;
  /**
   * Sent with Super Agent on, so the person chose no agent. The run still
   * streams, still stores its artifact, and still reports its result — it just
   * does not announce itself as an agent, because from where they sit no
   * hand-off happened.
   */
  quiet?: boolean;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  /** Refresh the owning transcript after a linked video becomes an attachment. */
  onSourceReady?: () => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [stages, setStages] = useState<Record<StageKey, StageState>>({
    fetch: "pending",
    read: "pending",
    plan: "pending",
    render: "pending",
  });
  const [fetchLine, setFetchLine] = useState("");
  const [readingLine, setReadingLine] = useState("");
  const [planLine, setPlanLine] = useState("");
  const [renderLine, setRenderLine] = useState("");
  const [source, setSource] = useState("");
  const [plan, setPlan] = useState("");
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
  const onSourceReadyRef = useRef(onSourceReady);
  const reportedRef = useRef(false);
  const sourceReadyReportedRef = useRef(false);
  /** Highest sequence number applied, so a reconnect resumes rather than replays. */
  const cursorRef = useRef(0);
  const statusRef = useRef(status);
  const base = `/api/video-use/runs/${runId}`;

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    onSourceReadyRef.current = onSourceReady;
  }, [onSourceReady]);

  useEffect(() => {
    reportedRef.current = false;
    sourceReadyReportedRef.current = false;
  }, [runId]);

  const advance = useCallback((key: StageKey, state: StageState) => {
    setStages((current) => ({ ...current, [key]: state }));
  }, []);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.sequenceNumber > cursorRef.current) {
        cursorRef.current = event.sequenceNumber;
      }
      if (event.at) setStartedAt((current) => current ?? event.at);
      switch (event.type) {
        case "run.started":
          setStatus("running");
          if (event.at) setStartedAt(event.at);
          break;
        case "source.ready":
          // Adoption is finished by the time this arrives, whether it involved
          // a download or not — so this is where fetching settles and reading
          // begins, for both kinds of source.
          setSource(asString(payload.sourceName));
          advance("fetch", "done");
          advance("read", "active");
          if (payload.sourceAttached === true && !sourceReadyReportedRef.current) {
            sourceReadyReportedRef.current = true;
            onSourceReadyRef.current?.();
          }
          break;
        case "source.probed": {
          const duration = asNumber(payload.durationSeconds);
          const width = asNumber(payload.width);
          const height = asNumber(payload.height);
          setReadingLine(
            [duration ? timecode(duration) : "", width && height ? `${width}×${height}` : ""]
              .filter(Boolean)
              .join(" · "),
          );
          break;
        }
        case "stage.updated": {
          // The server names its own stages more finely than the card shows
          // them: transcribing and silence-mapping are both "reading".
          const stage = asString(payload.stage);
          const state = asString(payload.status);
          const label = asString(payload.label);
          if (stage === "fetch") {
            advance("fetch", state === "done" ? "done" : "active");
            if (label) setFetchLine(label);
          } else if (stage === "transcribe" || stage === "silences") {
            advance("read", state === "done" || state === "failed" ? "done" : "active");
            if (label) setReadingLine(label);
          } else if (stage === "plan") {
            advance("read", "done");
            advance("plan", state === "done" ? "done" : "active");
            // Only a retry names this stage; the ordinary run has nothing to
            // add to "Planning the cut".
            if (label) setPlanLine(label);
          } else if (stage === "render") {
            advance("plan", "done");
            advance("render", state === "done" ? "done" : "active");
          }
          break;
        }
        case "plan.ready": {
          advance("plan", "done");
          setPlan(asString(payload.summary));
          const cuts = asNumber(payload.cuts);
          const runtimeSeconds = asNumber(payload.runtimeSeconds);
          setSpecs(
            (
              [
                ["Cuts", cuts ? String(cuts) : ""],
                ["Runtime", runtimeSeconds ? timecode(runtimeSeconds) : ""],
                [
                  "Frame",
                  asString(payload.aspect) === "original" ? "" : asString(payload.aspect),
                ],
                ["Captions", payload.subtitles === "burn" ? "burned in" : ""],
              ] as Array<[string, string]>
            ).filter(([, value]) => value),
          );
          break;
        }
        case "fetch.progress":
          advance("fetch", "active");
          setFetchLine(asString(payload.detail) || "Downloading");
          break;
        case "render.progress": {
          const stage = asString(payload.stage);
          const detail = asString(payload.detail);
          setRenderLine(detail ? `${stage} — ${detail}` : stage);
          break;
        }
        case "run.completed":
          setStatus("completed");
          setResult(asString(payload.summary));
          setCompletedAt(event.at);
          for (const stage of STAGES) advance(stage.key, "done");
          setRenderLine("");
          break;
        case "run.failed":
          setStatus("failed");
          setFailure(asString(payload.error, "The edit failed."));
          setCompletedAt(event.at);
          break;
        case "run.aborted":
          setStatus("aborted");
          setFailure(asString(payload.summary, "The edit was stopped."));
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

    let disposed = false;
    let stream: EventSource | null = null;
    let timer: number | undefined;
    let attempt = 0;
    // `status` only reaches its ref after a render, which is a tick too late
    // for the checks below, so the run's end is read off the events instead.
    let finished = false;

    const apply = (event: RunEvent) => {
      if (TERMINAL_EVENT_TYPES.has(event.type)) finished = true;
      applyEvent(event);
    };

    const handler = (event: MessageEvent) => {
      try {
        apply(JSON.parse(event.data) as RunEvent);
        // The stream is delivering, so whatever went wrong before is over and
        // the reconnect budget is worth restoring.
        attempt = 0;
      } catch {
        // A malformed frame must not take the card down.
      }
    };

    const closeStream = () => {
      if (!stream) return;
      for (const type of STREAMED_EVENT_TYPES) {
        stream.removeEventListener(type, handler);
      }
      stream.close();
      stream = null;
    };

    // The same route serves the run's events as plain JSON when nothing asks
    // for a stream, which is how a card that lost its stream catches up on what
    // it missed before deciding whether there is anything left to watch.
    const catchUp = async (): Promise<"gone" | "live" | "unreachable"> => {
      try {
        const response = await fetch(`${base}/events?since=${cursorRef.current}`, {
          headers: { accept: "application/json" },
        });
        // The manager forgets a run once it ends, so a run that is no longer
        // there is a run that is over.
        if (response.status === 404) return "gone";
        if (!response.ok) return "unreachable";
        const body = (await response.json()) as { events?: RunEvent[] };
        for (const event of body.events ?? []) apply(event);
        return "live";
      } catch {
        return "unreachable";
      }
    };

    const over = () => finished || TERMINAL.has(statusRef.current);

    const recover = async () => {
      if (disposed) return;
      const state = await catchUp();
      if (disposed || state === "gone" || over()) return;
      if (attempt <= MAX_STREAM_ATTEMPTS) {
        open();
        return;
      }
      // The stream will not stay up. Finish the run on polling alone rather
      // than leave a working run with nothing watching it — that is what left
      // a live edit stuck on "Thinking" until the page was reloaded.
      timer = window.setTimeout(() => void recover(), POLL_INTERVAL_MS);
    };

    function open() {
      if (disposed) return;
      stream = new EventSource(`${base}/events?since=${cursorRef.current}`);
      for (const type of STREAMED_EVENT_TYPES) {
        stream.addEventListener(type, handler);
      }
      // EventSource retries on its own, forever and from sequence zero. Drive
      // it here instead so each attempt resumes where this card left off and
      // gives up in favour of polling rather than hammering a broken route.
      stream.onerror = () => {
        closeStream();
        if (disposed || over()) return;
        attempt += 1;
        timer = window.setTimeout(
          () => void recover(),
          Math.min(1_000 * 2 ** (attempt - 1), 8_000),
        );
      };
    }

    open();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      closeStream();
    };
  }, [applyEvent, base, persistedOutcome]);

  useEffect(() => {
    if (!TERMINAL.has(status) || reportedRef.current) return;
    reportedRef.current = true;
    const content = status === "completed" ? result : failure;
    if (!content) return;
    notifyTaskCompleted(`Video Use — ${task.slice(0, 80)}`);
    onTerminalRef.current?.({
      outcome: status as ExternalAgentTerminalOutcome,
      content,
    });
  }, [failure, result, status, task]);

  const running = !TERMINAL.has(status);
  const stop = useCallback(() => {
    void fetch(`${base}/abort`, { method: "POST" }).catch(() => {
      // The run may have ended between the click and the request; the stream
      // reports the real outcome either way.
    });
  }, [base]);
  const statusDot = running
    ? "animate-pulse bg-[var(--botanical-2)]"
    : status === "completed"
      ? "bg-[var(--botanical)]"
      : "bg-[var(--danger)]";

  if (quiet) {
    // Super Agent owns the visible turn, so Video Use must use the same
    // response-state row as every other assistant message. Internal edit-stage
    // labels belong in the named Video Use card; promoting one here created a
    // detached-looking "Assembling the cut" row beneath the message.
    return (
      <>
        <AssistantResponseMeta
          active={running}
          failed={!running && status !== "completed"}
          startedAt={startedAt}
          completedAt={completedAt}
        />
        {result ? <ChatMarkdown content={result} compact /> : null}
        {/* A failure in Super Agent mode *is* the answer to that turn — there is
            no card around it to explain what went wrong — so it is set like any
            other reply rather than as red diagnostic text. The failed state is
            already carried by the response-state row above it. */}
        {failure ? (
          <div role="alert">
            <ChatMarkdown content={failure} compact />
          </div>
        ) : null}
        {!running ? (
          <AssistantMessageActions content={result || failure} onRetry={onRetry} />
        ) : null}
      </>
    );
  }

  return (
    <>
      <AssistantResponseMeta
        active={running}
        failed={!running && status !== "completed"}
        agentName="Video Use"
        startedAt={startedAt}
        completedAt={completedAt}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <div className="bb-agent-run-header">
          <span className="bb-agent-run-title truncate">Video Use</span>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span className={`bb-agent-run-led h-1.5 w-1.5 ${statusDot}`} />
              {running ? "editing" : status}
            </span>
            {running ? (
              <button type="button" className="bb-agent-run-action" onClick={stop}>
                Stop
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-[13px] p-[21px]">
          <p className="truncate text-[13px] leading-[1.4] text-[var(--ink-muted)]">
            {source ? `${source} — ${task}` : task}
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
                    className={`min-w-0 flex-1 truncate text-[13px] leading-[1.618] ${
                      stages[stage.key] === "pending"
                        ? "text-[var(--ink-muted)]"
                        : "text-[var(--ink)]"
                    }`}
                  >
                    {stage.label}
                    {stage.key === "fetch" && stages.fetch !== "pending" && fetchLine
                      ? ` — ${fetchLine}`
                      : ""}
                    {stage.key === "read" && stages.read !== "pending" && readingLine
                      ? ` — ${readingLine}`
                      : ""}
                    {stage.key === "plan" && stages.plan === "active" && planLine
                      ? ` — ${planLine}`
                      : ""}
                    {stage.key === "render" && stages.render === "active" && renderLine
                      ? ` — ${renderLine}`
                      : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {plan && running ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">{plan}</p>
          ) : null}

          {result ? (
            <div className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
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
