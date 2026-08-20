"use client";

// The Vox Director run card.
//
// A production is long and almost entirely local, so the card's job is to say
// which of the six stages is happening and how far through it is — a person
// watching their own CPU render 700 frames deserves a count, not a spinner.
//
// When the film is finished the card hands off: the MP4 is an ordinary video
// artifact and its card sits directly beneath this one, so the result line here
// is short and points at it rather than restating it.
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
import { normalizeChatTokenUsage, type ChatTokenUsage } from "@/lib/chat-token-usage";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const STAGES = [
  { key: "story", label: "Story" },
  { key: "style", label: "Style" },
  { key: "posters", label: "Posters" },
  { key: "motion", label: "Motion" },
  { key: "narration", label: "Narration" },
  { key: "render", label: "Final render" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];
type StageState = "pending" | "active" | "done";

const STREAMED_EVENT_TYPES = [
  "run.started",
  "plan.started",
  "plan.completed",
  "style.started",
  "style.completed",
  "prompts.completed",
  "keyframes.started",
  "keyframes.planned",
  "keyframe.started",
  "keyframe.completed",
  "keyframe.failed",
  "keyframes.completed",
  "motion.started",
  "motion.planUnavailable",
  "motion.planned",
  "beat_motion.started",
  "beat_motion.completed",
  "beat_motion.failed",
  "motion.completed",
  "audio.started",
  "narration.voice",
  "narration.beat",
  "narration.completed",
  "audio.completed",
  "assembly.started",
  "assembly.completed",
  "artifact.created",
  "artifact.failed",
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

export default function InlineVoxDirectorRun({
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
    style: "pending",
    posters: "pending",
    motion: "pending",
    narration: "pending",
    render: "pending",
  });
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [headlines, setHeadlines] = useState<string[]>([]);
  const [theme, setTheme] = useState("");
  const [specs, setSpecs] = useState<Array<[string, string]>>([]);
  const [posters, setPosters] = useState({ done: 0, total: 0, backend: "" });
  const [clips, setClips] = useState({ done: 0, total: 0 });
  // How many posters were cut into pieces rather than moved whole.
  const [plannedPosters, setPlannedPosters] = useState(0);
  const [narration, setNarration] = useState({ done: 0, total: 0, voice: "" });
  const [notice, setNotice] = useState("");
  const [videoArtifactId, setVideoArtifactId] = useState("");
  const [result, setResult] = useState(persistedOutcome === "completed" ? persistedContent : "");
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [usage, setUsage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  const [startedAt, setStartedAt] = useState<string | undefined>();
  const [completedAt, setCompletedAt] = useState<string | undefined>();
  const onTerminalRef = useRef(onTerminal);
  const usageRef = useRef(usage);
  const reportedRef = useRef(false);
  const base = `/api/vox-director/runs/${runId}`;

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
        case "plan.started":
          advance("story", "active");
          break;
        case "plan.completed":
          advance("story", "done");
          setTitle(asString(payload.title));
          setLogline(asString(payload.logline));
          setHeadlines(
            Array.isArray(payload.headlines)
              ? (payload.headlines as unknown[]).map((entry) => asString(entry)).filter(Boolean)
              : [],
          );
          break;
        case "style.started":
          advance("style", "active");
          break;
        case "style.completed":
          advance("style", "done");
          setTheme(asString(payload.theme));
          break;
        case "keyframes.started":
          advance("posters", "active");
          setPosters((current) => ({ ...current, total: asNumber(payload.count) }));
          break;
        case "keyframes.planned":
          setPosters((current) => ({ ...current, backend: asString(payload.backend) }));
          if (asString(payload.reason)) setNotice((current) => current || asString(payload.reason));
          break;
        case "keyframe.completed":
          setPosters((current) => ({ ...current, done: current.done + 1 }));
          break;
        case "keyframes.completed":
          advance("posters", "done");
          setPosters((current) => ({
            ...current,
            done: asNumber(payload.total) || current.done,
            total: asNumber(payload.total) || current.total,
          }));
          break;
        case "motion.started":
          advance("posters", "done");
          advance("motion", "active");
          setClips((current) => ({ ...current, total: asNumber(payload.count) }));
          break;
        case "beat_motion.completed":
          setClips((current) => ({
            done: current.done + 1,
            total: asNumber(payload.total) || current.total,
          }));
          break;
        case "motion.planned":
          setPlannedPosters(asNumber(payload.planned));
          break;
        case "motion.planUnavailable":
          setNotice((current) => current || asString(payload.reason));
          break;
        case "motion.completed":
          advance("motion", "done");
          break;
        case "audio.started":
          advance("motion", "done");
          advance("narration", "active");
          break;
        case "narration.voice":
          setNarration((current) => ({ ...current, voice: asString(payload.name) }));
          break;
        case "narration.beat":
          setNarration((current) => ({
            ...current,
            done: current.done + 1,
            total: asNumber(payload.total) || current.total,
          }));
          break;
        case "narration.completed":
          advance("narration", "done");
          setNarration((current) => ({
            ...current,
            voice: asString(payload.voice) || current.voice,
          }));
          break;
        case "audio.completed":
          if (asString(payload.reason) && payload.music === "silence") {
            setNotice((current) => current || asString(payload.reason));
          }
          break;
        case "assembly.started":
          advance("narration", "done");
          advance("render", "active");
          break;
        case "assembly.completed":
          advance("render", "done");
          break;
        case "artifact.created":
          if (payload.kind === "video") setVideoArtifactId(asString(payload.artifactId));
          break;
        case "artifact.failed":
          setNotice((current) => current || asString(payload.reason));
          break;
        case "run.completed": {
          setStatus("completed");
          setResult(asString(payload.summary));
          setTitle((current) => asString(payload.title) || current);
          setLogline((current) => asString(payload.logline) || current);
          setTheme((current) => asString(payload.theme) || current);
          setCompletedAt(event.at);
          if (Array.isArray(payload.headlines)) {
            setHeadlines(
              (payload.headlines as unknown[]).map((entry) => asString(entry)).filter(Boolean),
            );
          }
          setVideoArtifactId((current) => asString(payload.videoArtifactId) || current);
          setNotice(
            (current) =>
              current ||
              asString(payload.storageFailure) ||
              asString(payload.imageNotice) ||
              asString(payload.motionNotice),
          );
          setSpecs(
            (
              [
                ["Beats", asNumber(payload.beatCount) ? String(asNumber(payload.beatCount)) : ""],
                ["Shots", asNumber(payload.shotCount) ? String(asNumber(payload.shotCount)) : ""],
                [
                  "Runtime",
                  asNumber(payload.runtimeSeconds) ? `${asNumber(payload.runtimeSeconds)}s` : "",
                ],
                ["Look", asString(payload.theme)],
                ["Motion", asString(payload.motionBackend)],
                ["Voice", asString(payload.narrationVoice)],
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
          setFailure(asString(payload.error, "The Vox Director run failed."));
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
    // with an error, so a saved turn renders from what was saved with it.
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
    // EventSource reconnects on error by default, forever. Closing here is what
    // keeps a restored transcript from hammering a dead endpoint.
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
    notifyTaskCompleted(`Vox Director — ${title || brief.slice(0, 80)}`);
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
  const hasDetail = Boolean(specs.length || running || !result || headlines.length);

  const stageDetail: Record<StageKey, string> = {
    story: headlines.length ? `${headlines.length} beats` : "",
    style: theme,
    posters: posters.total
      ? `${posters.done} / ${posters.total}${
          posters.backend === "title-card" ? " · paper title cards" : ""
        }`
      : "",
    motion: clips.total
      ? `${clips.done} / ${clips.total}${
          plannedPosters ? ` · ${plannedPosters} cut into pieces` : ""
        }`
      : "",
    narration: narration.total
      ? `${narration.done} / ${narration.total}${narration.voice ? ` · ${narration.voice}` : ""}`
      : narration.voice,
    render: "",
  };

  return (
    <>
      <AssistantResponseMeta
        active={running}
        failed={!running && status !== "completed"}
        agentName="Vox Director"
        usage={usage}
        startedAt={startedAt}
        completedAt={completedAt}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <div className="bb-agent-run-header">
          <span className="bb-agent-run-title truncate">Vox Director</span>
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
              working says exactly where it is and how far through. */}
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
                    {stages[stage.key] !== "pending" && stageDetail[stage.key]
                      ? ` — ${stageDetail[stage.key]}`
                      : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {headlines.length ? (
            <section className="space-y-[5px]">
              <p className="bb-agent-run-label">Beats · {headlines.length}</p>
              <p className="bb-agent-run-readout">{headlines.join("  ·  ")}</p>
            </section>
          ) : null}

          {notice ? <p className="bb-agent-run-text text-[var(--ink-muted)]">{notice}</p> : null}

          {videoArtifactId ? (
            <p className="bb-agent-run-text text-[var(--ink)]">
              The film rendered locally as an MP4; it plays on the card below.
            </p>
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
