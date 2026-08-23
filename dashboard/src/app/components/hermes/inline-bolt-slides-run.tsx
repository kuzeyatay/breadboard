"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
}
interface Artifact {
  id: string;
  relativePath: string;
  name: string;
  kind: string;
  size: number;
}
interface PlannedSlide {
  nav: string;
  component: string;
  headline: string;
}

const EVENTS = [
  "run.queued",
  "stage.changed",
  "deck.planned",
  "deck.authored",
  "build.failed",
  "deck.built",
  "artifact.saved",
  "artifact.failed",
  "artifacts.updated",
  "log",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);
const STAGE_LABEL: Record<string, string> = {
  planning: "planning the deck",
  authoring: "writing the slides",
  building: "building",
  repairing: "repairing the build",
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function artifacts(value: unknown): Artifact[] {
  return Array.isArray(value) ? (value as Artifact[]).filter((item) => item?.id) : [];
}
function slides(value: unknown): PlannedSlide[] {
  return Array.isArray(value)
    ? (value as PlannedSlide[]).filter((item) => typeof item?.nav === "string")
    : [];
}

export default function InlineBoltSlidesRun({
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
  const [stage, setStage] = useState("planning");
  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState("");
  const [arc, setArc] = useState("");
  const [plan, setPlan] = useState<PlannedSlide[]>([]);
  const [components, setComponents] = useState<string[]>([]);
  const [repaired, setRepaired] = useState(false);
  const [built, setBuilt] = useState(persistedOutcome === "completed");
  const [logLine, setLogLine] = useState("");
  const [outputs, setOutputs] = useState<Artifact[]>([]);
  const [result, setResult] = useState(persistedOutcome === "completed" ? persistedContent : "");
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const reported = useRef(false);
  const terminalRef = useRef(onTerminal);
  const base = `/api/bolt-slides/runs/${runId}`;
  const replaying = Boolean(persistedOutcome && persistedOutcome !== "running" && persistedContent);

  useEffect(() => {
    terminalRef.current = onTerminal;
  }, [onTerminal]);
  useEffect(() => {
    reported.current = false;
  }, [runId]);

  const report = useCallback(
    (outcome: "completed" | "failed" | "aborted", content: string) => {
      if (reported.current) return;
      reported.current = true;
      if (outcome === "completed") notifyTaskCompleted(`Bolt Slides — ${brief.slice(0, 80)}`);
      terminalRef.current?.({ outcome, content });
    },
    [brief],
  );

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.type === "stage.changed") {
        setStatus("running");
        setStage(text(payload.stage, "planning"));
      } else if (event.type === "deck.planned") {
        setTitle(text(payload.title));
        setTheme(text(payload.theme));
        setArc(text(payload.arc));
        setPlan(slides(payload.slides));
      } else if (event.type === "deck.authored") {
        setComponents(
          Array.isArray(payload.components)
            ? payload.components.filter((item): item is string => typeof item === "string")
            : [],
        );
      } else if (event.type === "build.failed") {
        setRepaired(true);
        setLogLine(text(payload.failure));
      } else if (event.type === "log") {
        setLogLine(text(payload.text));
      } else if (event.type === "deck.built") {
        setBuilt(true);
      } else if (event.type === "artifacts.updated") {
        setOutputs(artifacts(payload.artifacts));
      } else if (event.type === "run.completed") {
        setStatus("completed");
        setBuilt(true);
        setOutputs(artifacts(payload.artifacts));
        const finished = text(payload.report, "The deck is ready.");
        setResult(finished);
        report("completed", finished);
      } else if (event.type === "run.failed" || event.type === "run.aborted") {
        const outcome = event.type === "run.aborted" ? "aborted" : "failed";
        const message =
          text(payload.summary) || text(payload.error) || "The deck could not be built.";
        setStatus(outcome);
        setFailure(message);
        setOutputs(artifacts(payload.artifacts));
        report(outcome, message);
      }
    },
    [report],
  );

  useEffect(() => {
    if (replaying) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // Malformed frame.
      }
    };
    EVENTS.forEach((type) => source.addEventListener(type, handle as EventListener));
    source.onerror = () => source.close();
    return () => source.close();
  }, [applyEvent, base, replaying]);

  useEffect(() => {
    if (!replaying) return;
    void fetch(`${base}/artifacts`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { artifacts?: unknown } | null) => {
        if (data) setOutputs(artifacts(data.artifacts));
      })
      .catch(() => undefined);
  }, [base, replaying]);

  const terminal = TERMINAL.has(status);
  const showDeck = built && status !== "failed" && status !== "aborted";
  const deckUrl = `${base}/deck/`;
  const sources = useMemo(
    () => outputs.filter((item) => item.kind === "deck" || item.kind === "theme"),
    [outputs],
  );
  const terminalContent = result || failure || "The deck run finished.";

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        agentName="Bolt Slides"
        usage={persistedUsage}
        summary={STAGE_LABEL[stage] ?? stage}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title">
            Bolt Slides
            {title ? (
              <span className="ml-2 text-[11px] font-normal text-[var(--ink-muted)]">{title}</span>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <span className="bb-agent-run-label">
              <span
                className={`bb-agent-run-led mr-1.5 inline-block h-1.5 w-1.5 ${
                  status === "completed"
                    ? "bg-[var(--botanical)]"
                    : terminal
                      ? "bg-[var(--danger)]"
                      : "animate-pulse bg-[var(--botanical-2)]"
                }`}
              />
              {terminal ? status : (STAGE_LABEL[stage] ?? stage)}
            </span>
            {showDeck ? (
              <a
                className="bb-agent-run-action"
                href={deckUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </a>
            ) : null}
            {!terminal ? (
              <button
                type="button"
                className="bb-agent-run-action"
                onClick={() => void fetch(`${base}/abort`, { method: "POST" })}
              >
                Stop
              </button>
            ) : null}
          </div>
        </header>
        <div className="space-y-[13px] p-[21px]">
          {plan.length || theme ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {plan.length ? `${plan.length} slide${plan.length === 1 ? "" : "s"}` : null}
              {plan.length && theme ? " · " : null}
              {theme ? `${theme} theme` : null}
              {components.length
                ? ` · ${components.length} new component${components.length === 1 ? "" : "s"}`
                : null}
            </p>
          ) : null}
          {arc ? <p className="bb-agent-run-text">{arc}</p> : null}
          {!terminal && plan.length ? (
            <ul className="flex flex-wrap gap-1">
              {plan.slice(0, 30).map((slide, index) => (
                <li
                  key={`${slide.nav}-${index}`}
                  className="bb-agent-run-row px-2 py-1 text-[11px]"
                  title={`${slide.component} — ${slide.headline}`}
                >
                  {slide.nav}
                </li>
              ))}
            </ul>
          ) : null}
          {showDeck ? (
            <div className="overflow-hidden rounded-xl border border-[var(--line)]">
              {/* The deck is React written by a model, so it is framed the way
                  every other generated interactive page here is: scripts on,
                  same-origin off. Presenter mode needs a real origin, which is
                  what the Open link above is for. */}
              <iframe
                title={title ? `${title} — deck preview` : "Deck preview"}
                sandbox="allow-scripts"
                allow=""
                referrerPolicy="no-referrer"
                src={deckUrl}
                className="block h-[26rem] w-full border-0 bg-black"
              />
            </div>
          ) : !terminal && logLine ? (
            <p className="bb-agent-run-text truncate font-mono text-[11px] text-[var(--ink-muted)]">
              {logLine}
            </p>
          ) : null}
          {repaired && !terminal ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              The first build failed; the deck is being repaired.
            </p>
          ) : null}
          {sources.length ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {sources.map((item) => (
                <li key={item.id}>
                  <a
                    className="bb-agent-run-row flex items-center justify-between gap-2 p-2"
                    href={`${base}/artifacts/${encodeURIComponent(item.id)}?download=1`}
                    download={item.name}
                  >
                    <span className="truncate font-mono text-[11px]">{item.relativePath}</span>
                    <span className="shrink-0 text-[11px] text-[var(--ink-muted)]">
                      {item.kind === "deck" ? "The slides" : "The theme"}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {result ? (
            <section className="bb-agent-run-text border-t border-[var(--line)] pt-[13px]">
              <ChatMarkdown content={result} compact />
            </section>
          ) : failure ? (
            <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p>
          ) : null}
        </div>
      </div>
      {terminal ? <AssistantMessageActions content={terminalContent} onRetry={onRetry} /> : null}
    </>
  );
}
