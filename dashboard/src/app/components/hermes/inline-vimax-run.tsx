"use client";

// The ViMax run card.
//
// The card shows the production pipeline as it runs — story, screenplay, cast,
// storyboard, frames, drawing — and then hands off: the film lives in its
// artifact, not in the transcript, so the finished card is a short result line
// and the film's own card sits directly beneath it.
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
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const STAGES = [
  { key: "story", label: "Writing the story" },
  { key: "scenes", label: "Cutting it into scenes" },
  { key: "characters", label: "Casting the characters" },
  { key: "storyboard", label: "Storyboarding each scene" },
  { key: "frames", label: "Breaking shots into frames" },
  { key: "imagery", label: "Drawing the storyboard" },
  { key: "video", label: "Encoding the film" },
  { key: "artifact", label: "Assembling the film" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];
type StageState = "pending" | "active" | "done";

const STREAMED_EVENT_TYPES = [
  "run.started",
  "story.started",
  "story.completed",
  "scenes.started",
  "scenes.completed",
  "characters.started",
  "characters.completed",
  "storyboard.started",
  "storyboard.scene",
  "frames.started",
  "frames.completed",
  "portraits.started",
  "portrait.drawn",
  "portraits.completed",
  "storyboardFrames.started",
  "frame.drawn",
  "storyboardFrames.completed",
  "imagery.planned",
  "imagery.unavailable",
  "video.started",
  "video.progress",
  "video.completed",
  "video.failed",
  "artifact.ready",
  "artifact.unavailable",
  "run.usage",
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

/**
 * The summary leads with `**Title** — …` so the film is still identifiable
 * wherever the message is read on its own. In the card the first line owns the
 * title, so split it off and render only what follows.
 */
function splitSummary(summary: string): { title: string; body: string } {
  const lead = /^\*\*(.+?)\*\*\s+—\s+/.exec(summary);
  return lead
    ? { title: lead[1], body: summary.slice(lead[0].length) }
    : { title: "", body: summary };
}

export default function InlineVimaxRun({
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
  const [stages, setStages] = useState<Record<StageKey, StageState>>({
    story: "pending",
    scenes: "pending",
    characters: "pending",
    storyboard: "pending",
    frames: "pending",
    imagery: "pending",
    video: "pending",
    artifact: "pending",
  });
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [headings, setHeadings] = useState<string[]>([]);
  const [cast, setCast] = useState<string[]>([]);
  const [specs, setSpecs] = useState<Array<[string, string]>>([]);
  // Drawing is the slow part of a run, so the card counts frames as they land
  // rather than sitting on one unchanging line.
  const [drawn, setDrawn] = useState({ frames: 0, frameTarget: 0, portraits: 0 });
  // What drew the frames, and anything that stopped them being drawn — the run
  // used to finish silently when a provider refused every image.
  const [generator, setGenerator] = useState("");
  const [notice, setNotice] = useState("");
  const [encoded, setEncoded] = useState({ done: 0, total: 0 });
  const [videoArtifactId, setVideoArtifactId] = useState("");
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [usage, setUsage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  const [startedAt, setStartedAt] = useState<string | undefined>();
  const [completedAt, setCompletedAt] = useState<string | undefined>();
  const onTerminalRef = useRef(onTerminal);
  const usageRef = useRef(usage);
  const reportedRef = useRef(false);
  const base = `/api/vimax/runs/${runId}`;

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
          if (event.at) setStartedAt(event.at);
          break;
        case "run.usage": {
          const next = normalizeChatTokenUsage(payload);
          if (next) {
            usageRef.current = next;
            setUsage(next);
          }
          break;
        }
        case "story.started":
          advance("story", "active");
          break;
        case "story.completed":
          advance("story", "done");
          setTitle(asString(payload.title));
          setLogline(asString(payload.logline));
          break;
        case "scenes.started":
          advance("scenes", "active");
          break;
        case "scenes.completed":
          advance("scenes", "done");
          setHeadings(
            Array.isArray(payload.headings)
              ? (payload.headings as unknown[]).map((entry) => asString(entry)).filter(Boolean)
              : [],
          );
          break;
        case "characters.started":
          advance("characters", "active");
          break;
        case "characters.completed":
          advance("characters", "done");
          setCast(
            Array.isArray(payload.characters)
              ? (payload.characters as Array<Record<string, unknown>>)
                  .map((entry) => asString(entry.identifier))
                  .filter(Boolean)
              : [],
          );
          break;
        case "storyboard.started":
          advance("storyboard", "active");
          break;
        case "frames.started":
          advance("storyboard", "done");
          advance("frames", "active");
          break;
        case "frames.completed":
          advance("frames", "done");
          break;
        case "imagery.planned": {
          const models = Array.isArray(payload.models)
            ? (payload.models as unknown[]).map((entry) => asString(entry)).filter(Boolean)
            : [];
          setGenerator(models[0] ?? (payload.responsesTool ? "the chat model's image tool" : ""));
          break;
        }
        case "imagery.unavailable":
          setNotice(asString(payload.reason));
          break;
        case "portraits.started":
          advance("imagery", "active");
          break;
        case "portrait.drawn":
          setDrawn((current) => ({ ...current, portraits: current.portraits + 1 }));
          break;
        case "storyboardFrames.started":
          advance("imagery", "active");
          setDrawn((current) => ({ ...current, frameTarget: asNumber(payload.count) }));
          break;
        case "frame.drawn":
          setDrawn((current) => ({ ...current, frames: current.frames + 1 }));
          break;
        case "storyboardFrames.completed":
          advance("imagery", "done");
          setNotice((current) => current || asString(payload.failure));
          break;
        case "video.started":
          advance("imagery", "done");
          advance("video", "active");
          break;
        case "video.progress":
          setEncoded({ done: asNumber(payload.done), total: asNumber(payload.total) });
          break;
        case "video.completed":
          advance("video", "done");
          setVideoArtifactId(asString(payload.artifactId));
          break;
        case "video.failed":
          advance("video", "done");
          setNotice(asString(payload.reason));
          break;
        case "artifact.ready":
        case "artifact.unavailable":
          advance("imagery", "done");
          advance("video", "done");
          advance("artifact", "done");
          break;
        case "run.completed": {
          setStatus("completed");
          setResult(asString(payload.summary));
          setTitle((current) => asString(payload.title) || current);
          setLogline((current) => asString(payload.logline) || current);
          setCompletedAt(event.at);
          if (Array.isArray(payload.headings)) {
            setHeadings(
              (payload.headings as unknown[]).map((entry) => asString(entry)).filter(Boolean),
            );
          }
          setVideoArtifactId((current) => asString(payload.videoArtifactId) || current);
          setNotice(
            (current) =>
              current || asString(payload.imageNotice) || asString(payload.videoNotice),
          );
          setSpecs(
            (
              [
                ["Scenes", asNumber(payload.sceneCount) ? String(asNumber(payload.sceneCount)) : ""],
                ["Shots", asNumber(payload.shotCount) ? String(asNumber(payload.shotCount)) : ""],
                ["Cast", asNumber(payload.characterCount) ? String(asNumber(payload.characterCount)) : ""],
                [
                  "Runtime",
                  asNumber(payload.durationSeconds)
                    ? `${asNumber(payload.durationSeconds)}s`
                    : "",
                ],
                [
                  "Frames drawn",
                  asNumber(payload.drawnFrameCount)
                    ? String(asNumber(payload.drawnFrameCount))
                    : "",
                ],
                ["Style", asString(payload.style)],
              ] as Array<[string, string]>
            ).filter(([, value]) => value),
          );
          const total = normalizeChatTokenUsage(payload.usage);
          if (total) {
            usageRef.current = total;
            setUsage(total);
          }
          break;
        }
        case "run.failed":
          setStatus("failed");
          setFailure(asString(payload.error, "The ViMax run failed."));
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
    if (persistedOutcome && persistedOutcome !== "running") return;
    const source = new EventSource(`${base}/events`);
    const handler = (event: MessageEvent) => {
      try {
        applyEvent(JSON.parse(event.data) as RunEvent);
      } catch {
        // A malformed frame must not take the card down.
      }
    };
    for (const type of STREAMED_EVENT_TYPES) source.addEventListener(type, handler);
    source.onerror = () => source.close();
    return () => {
      for (const type of STREAMED_EVENT_TYPES) source.removeEventListener(type, handler);
      source.close();
    };
  }, [applyEvent, base, persistedOutcome]);

  useEffect(() => {
    if (!TERMINAL.has(status) || reportedRef.current) return;
    reportedRef.current = true;
    const content = status === "completed" ? result : failure;
    if (!content) return;
    notifyTaskCompleted(`ViMax — ${title || brief.slice(0, 80)}`);
    onTerminalRef.current?.({
      outcome: status as ExternalAgentTerminalOutcome,
      content,
      ...(usageRef.current ? { usage: usageRef.current } : {}),
    });
  }, [brief, failure, result, status, title]);

  const running = !TERMINAL.has(status);
  const statusDot = running
    ? "animate-pulse bg-[var(--botanical-2)]"
    : status === "completed"
      ? "bg-[var(--botanical)]"
      : "bg-[var(--danger)]";
  const summary = splitSummary(result);
  const heading = title || summary.title;
  const hasDetail = Boolean(
    specs.length || running || !result || headings.length || cast.length,
  );
  const drawingLine =
    drawn.frameTarget > 0
      ? `${drawn.frames}/${drawn.frameTarget} frames${generator ? ` · ${generator}` : ""}`
      : drawn.portraits > 0
        ? `${drawn.portraits} portrait${drawn.portraits === 1 ? "" : "s"}`
        : generator;
  const encodingLine = encoded.total > 0 ? `${encoded.done}/${encoded.total} shots` : "";

  return (
    <>
      <AssistantResponseMeta
        active={running}
        failed={!running && status !== "completed"}
        agentName="ViMax"
        usage={usage}
        startedAt={startedAt}
        completedAt={completedAt}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <div className="bb-agent-run-header">
          <span className="bb-agent-run-title truncate">ViMax</span>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span className={`bb-agent-run-led h-1.5 w-1.5 ${statusDot}`} />
              {running ? "producing" : status}
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
          {heading ? (
            <div>
              <p className="truncate text-[16px] font-semibold leading-[1.4] text-[var(--ink-heading)]">
                {heading}
              </p>
              {logline ? (
                <p className="bb-agent-run-text mt-[5px] text-[var(--ink-muted)]">{logline}</p>
              ) : null}
            </div>
          ) : null}

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

          {/* The production log: a lamped stage list, so a card that is still
              working says exactly where it is. */}
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
                    {stage.key === "imagery" && stages.imagery === "active" && drawingLine
                      ? ` — ${drawingLine}`
                      : ""}
                    {stage.key === "video" && stages.video === "active" && encodingLine
                      ? ` — ${encodingLine}`
                      : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {headings.length ? (
            <section className="space-y-[5px]">
              <p className="bb-agent-run-label">
                Scenes{headings.length ? ` · ${headings.length}` : ""}
              </p>
              <p className="bb-agent-run-readout">{headings.join("  ·  ")}</p>
            </section>
          ) : null}

          {notice ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">{notice}</p>
          ) : null}

          {videoArtifactId ? (
            <p className="bb-agent-run-text text-[var(--ink)]">
              The film was encoded as an MP4; it plays on the card below.
            </p>
          ) : null}

          {cast.length ? (
            <section className="space-y-[5px]">
              <p className="bb-agent-run-label">Cast</p>
              <p className="bb-agent-run-readout">{cast.join("  ·  ")}</p>
            </section>
          ) : null}

          {summary.body ? (
            <div
              className={
                hasDetail
                  ? "bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]"
                  : "bb-agent-run-text"
              }
            >
              <ChatMarkdown content={summary.body} compact />
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
