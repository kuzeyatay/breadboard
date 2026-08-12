"use client";

// The HyperFrames run card.
//
// A video build is a long job with a single payoff, so the card is built around
// two things: a stage strip that says what is happening right now (writing the
// composition / linting / checking / rendering), and the rendered video itself,
// playing inline the moment it exists. Everything else — the activity trail and
// the other files the project produced — is secondary and folds away.
//
// Styling uses the shared run material (bb-agent-run-*) so this card reads as
// the same object as every other external-agent run.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { normalizeChatTokenUsage, type ChatTokenUsage } from "@/lib/chat-token-usage";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface Artifact {
  id: string;
  relativePath: string;
  name: string;
  kind: "video" | "image" | "composition" | "document" | "audio";
  contentType: string;
  size: number;
  modifiedAt: string;
}

interface ActivityEntry {
  key: number;
  kind: "reasoning" | "tool";
  label: string;
  detail: string;
  status: string;
}

const STAGES = [
  { key: "scaffolding", label: "Setting up the project" },
  { key: "authoring", label: "Writing the composition" },
  { key: "linting", label: "Checking the structure" },
  { key: "checking", label: "Running it in a browser" },
  { key: "rendering", label: "Rendering the video" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

const STREAMED_EVENT_TYPES = [
  "run.started",
  "stage.changed",
  "reasoning.completed",
  "tool.completed",
  "text.completed",
  "artifacts.updated",
  "render.completed",
  "agent.usage",
  "runtime.error",
  "run.completed",
  "run.failed",
  "run.aborted",
];

const TERMINAL = new Set(["completed", "failed", "aborted"]);
const MAX_ACTIVITY = 60;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asArtifacts(value: unknown): Artifact[] {
  return Array.isArray(value) ? (value as Artifact[]).filter((item) => item && item.id) : [];
}

function formatElapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The command without its path noise, for the activity line. */
function shortCommand(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 119)}…` : collapsed;
}

export default function InlineHyperframesRun({
  runId,
  brief,
  persistedContent = "",
  persistedOutcome,
  persistedUsage,
  onTerminal,
  onRetry,
}: {
  runId: string;
  brief: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  persistedUsage?: ChatTokenUsage;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [stage, setStage] = useState<StageKey>("scaffolding");
  const [model, setModel] = useState("");
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [usage, setUsage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  const [renders, setRenders] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [showActivity, setShowActivity] = useState(false);
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const onTerminalRef = useRef(onTerminal);
  const usageRef = useRef(usage);
  const reportedRef = useRef(false);
  const startedRef = useRef(0);
  const base = `/api/hyperframes/runs/${runId}`;
  const replaying = Boolean(persistedOutcome && persistedOutcome !== "running" && persistedContent);

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
      if (outcome === "completed") notifyTaskCompleted(`HyperFrames — ${brief.slice(0, 80)}`);
      onTerminalRef.current?.({
        outcome,
        content,
        ...(usageRef.current ? { usage: usageRef.current } : {}),
      });
    },
    [brief],
  );

  const pushActivity = useCallback((entry: ActivityEntry) => {
    setActivity((current) => [...current, entry].slice(-MAX_ACTIVITY));
  }, []);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      switch (event.type) {
        case "run.started":
          setStatus("running");
          setModel(asString(payload.model));
          break;
        case "stage.changed": {
          const next = asString(payload.stage);
          if (STAGES.some((item) => item.key === next)) setStage(next as StageKey);
          break;
        }
        case "reasoning.completed":
          pushActivity({
            key: event.sequenceNumber,
            kind: "reasoning",
            label: "thinking",
            detail: asString(payload.text),
            status: "completed",
          });
          break;
        case "tool.completed":
          pushActivity({
            key: event.sequenceNumber,
            kind: "tool",
            label: asString(payload.tool, "tool"),
            detail: shortCommand(asString(payload.title) || asString(payload.summary)),
            status: asString(payload.status, "completed"),
          });
          break;
        case "artifacts.updated":
          setArtifacts(asArtifacts(payload.artifacts));
          break;
        case "render.completed":
          setRenders((current) => current + 1);
          break;
        case "agent.usage": {
          const next = normalizeChatTokenUsage(payload);
          if (next) {
            usageRef.current = next;
            setUsage(next);
          }
          break;
        }
        case "run.completed": {
          const summary = asString(payload.summary, "The video is ready.");
          setStatus("completed");
          setResult(summary);
          setElapsed(asNumber(payload.elapsedSec));
          if (Array.isArray(payload.artifacts)) setArtifacts(asArtifacts(payload.artifacts));
          reportTerminal("completed", summary);
          break;
        }
        case "run.failed":
        case "run.aborted": {
          const outcome = event.type === "run.aborted" ? "aborted" : "failed";
          const message =
            asString(payload.summary) ||
            asString(payload.error) ||
            (outcome === "aborted" ? "Video build stopped." : "The video could not be built.");
          setStatus(outcome);
          setFailure(message);
          setElapsed((current) => asNumber(payload.elapsedSec) || current);
          if (Array.isArray(payload.artifacts)) setArtifacts(asArtifacts(payload.artifacts));
          reportTerminal(outcome, message);
          break;
        }
        default:
          break;
      }
    },
    [pushActivity, reportTerminal],
  );

  useEffect(() => {
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
    source.onerror = () => {
      void fetch(`${base}/events?since=0`)
        .then(async (response) => {
          if (response.ok) return;
          source.close();
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setStatus("failed");
          setFailure(
            data.error === "run_not_found"
              ? "This video build is no longer live, but its saved result remains below."
              : "The HyperFrames event stream is unavailable.",
          );
        })
        .catch(() => undefined);
    };
    return () => source.close();
  }, [applyEvent, base, replaying]);

  // A finished run is re-read from its workspace, so the video still plays in a
  // transcript opened days later — the in-memory run is long gone by then.
  useEffect(() => {
    if (!replaying) return;
    let cancelled = false;
    void fetch(`${base}/artifacts`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { artifacts?: unknown } | null) => {
        if (!cancelled && data) setArtifacts(asArtifacts(data.artifacts));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base, replaying]);

  const terminal = TERMINAL.has(status);

  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedRef.current) / 1_000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [terminal]);

  const video = useMemo(
    () => artifacts.find((artifact) => artifact.kind === "video" && artifact.size > 0) ?? null,
    [artifacts],
  );
  const otherOutputs = useMemo(
    () => artifacts.filter((artifact) => artifact.id !== video?.id).slice(0, 12),
    [artifacts, video],
  );
  const activeStageIndex = STAGES.findIndex((item) => item.key === stage);
  const terminalContent =
    result.trim() ||
    failure.trim() ||
    (status === "aborted"
      ? "Video build stopped."
      : status === "failed"
        ? "The video could not be built."
        : "The video build finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        agentName="HyperFrames"
        usage={usage}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={activity.at(-1)?.detail}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            HyperFrames
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
              {terminal ? status : `building · ${formatElapsed(elapsed)}`}
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
          {/* What the build is doing now. Kept while it runs; once there is a
              video the video says everything the strip did. */}
          {!terminal ? (
            <ol className="space-y-[5px]">
              {STAGES.map((item, index) => {
                const state =
                  index < activeStageIndex ? "done" : index === activeStageIndex ? "active" : "pending";
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
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {video ? (
            <figure className="overflow-hidden rounded-[10px] border border-[color-mix(in_srgb,var(--line)_55%,transparent)] bg-black">
              <video
                className="block max-h-[420px] w-full bg-black"
                src={`${base}/artifacts/${encodeURIComponent(video.id)}`}
                controls
                preload="metadata"
                playsInline
              />
              <figcaption className="flex items-center justify-between gap-[13px] bg-[var(--paper-surface)] px-[13px] py-[8px]">
                <span className="min-w-0 truncate font-mono text-[11px] text-[var(--ink-heading)]">
                  {video.relativePath}
                </span>
                <span className="flex shrink-0 items-center gap-[13px] text-[11px] tabular-nums text-[var(--ink-muted)]">
                  {formatBytes(video.size)}
                  <a
                    className="text-[var(--botanical)] hover:underline"
                    href={`${base}/artifacts/${encodeURIComponent(video.id)}?download=1`}
                    download={video.name}
                  >
                    Download
                  </a>
                </span>
              </figcaption>
            </figure>
          ) : null}

          {otherOutputs.length ? (
            <section className="bb-agent-run-panel p-[13px]">
              <p className="bb-agent-run-label mb-[8px]">
                Project files · {otherOutputs.length}
              </p>
              <ul className="grid gap-[5px] sm:grid-cols-2">
                {otherOutputs.map((artifact) => (
                  <li key={artifact.id}>
                    <a
                      className="bb-agent-run-row flex items-center gap-[8px] p-[8px] transition-colors hover:text-[var(--ink-heading)]"
                      href={`${base}/artifacts/${encodeURIComponent(artifact.id)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--ink-heading)]">
                        {artifact.relativePath}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--ink-muted)]">
                        {formatBytes(artifact.size)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {activity.length ? (
            <section>
              <button
                type="button"
                className="bb-agent-run-label inline-flex items-center gap-[5px] hover:text-[var(--ink-heading)]"
                onClick={() => setShowActivity((current) => !current)}
                aria-expanded={showActivity}
              >
                {showActivity ? "Hide" : "Show"} what it did · {activity.length}
                {renders ? ` · ${renders} render${renders === 1 ? "" : "s"}` : ""}
              </button>
              {showActivity ? (
                <ol className="mt-[8px] max-h-64 space-y-[5px] overflow-y-auto pr-1">
                  {activity.map((entry) => (
                    <li key={entry.key} className="bb-agent-run-row p-[8px]">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono text-[11px] ${
                            entry.status === "failed"
                              ? "text-[var(--danger)]"
                              : "text-[var(--botanical)]"
                          }`}
                        >
                          {entry.label}
                        </span>
                      </div>
                      {entry.detail ? (
                        <p className="bb-agent-run-text mt-[5px] line-clamp-2 text-[var(--ink-muted)]">
                          {entry.detail}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
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
