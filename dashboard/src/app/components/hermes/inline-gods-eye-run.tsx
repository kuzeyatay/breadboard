"use client";

// The God's Eye run card, and the framed globe it exists for.
//
// Two presentations, like openGym's: the ordinary agent card
// (`bb-agent-run-card` chrome, same as every other agent), and a quiet one for
// a Super Agent delegation, where the framed view plus a sentence or two IS
// the answer — no card chrome, no second synthesis turn.
//
// The frame itself borrows the clone's own design language (style.css in
// gods-eye-view: "Apple meets Blade Runner") — near-black ground, glass
// borders, cyan accent with a glow, mono readouts — so the widget reads as a
// window into that cockpit rather than a themed dashboard panel. It is
// deliberately the same in light and dark: the cockpit has one look.

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { godsEyeOpenPath, parseGodsEyeResult, type GodsEyeView } from "@/lib/gods-eye/view.ts";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
}

const EVENTS = [
  "run.queued",
  "service.starting",
  "service.ready",
  "view.resolving",
  "view.resolved",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

const HUD_MONO = "'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace";
const HUD_ACCENT = "#00d4ff";
const HUD_BORDER = "rgba(255, 255, 255, 0.08)";

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function coordinateReadout(view: GodsEyeView): string {
  const ns = view.lat >= 0 ? "N" : "S";
  const ew = view.lon >= 0 ? "E" : "W";
  const altitude =
    view.altM >= 1_000 ? `${(view.altM / 1_000).toFixed(view.altM >= 100_000 ? 0 : 1)}KM` : `${view.altM}M`;
  return `${Math.abs(view.lat).toFixed(3)}°${ns} ${Math.abs(view.lon).toFixed(3)}°${ew} · ALT ${altitude}`;
}

/**
 * The globe, framed in the clone's own cockpit chrome. As wide as the text
 * column it sits in — never wider than the prose around it. A live completion
 * mounts the feed at once; a reopened card parks it behind one click, so
 * scrolling old chats neither boots the dev server nor spins up Cesium.
 */
function GodsEyeViewport({ view, parked }: { view: GodsEyeView; parked: boolean }) {
  const [mounted, setMounted] = useState(!parked);
  const src = godsEyeOpenPath(view);
  return (
    <figure
      className="w-full overflow-hidden"
      style={{
        margin: 0,
        borderRadius: 16,
        border: `1px solid ${HUD_BORDER}`,
        background: "#0a0a0f",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
      }}
    >
      <figcaption
        className="flex items-center justify-between gap-3 px-3.5 py-2"
        style={{
          fontFamily: HUD_MONO,
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(232, 234, 237, 0.5)",
          borderBottom: `1px solid ${HUD_BORDER}`,
          background: "rgba(12, 12, 20, 0.72)",
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={mounted ? "animate-pulse" : ""}
            style={{
              width: 6,
              height: 6,
              borderRadius: 9999,
              background: mounted ? HUD_ACCENT : "rgba(232, 234, 237, 0.3)",
              boxShadow: mounted ? `0 0 8px ${HUD_ACCENT}` : "none",
              flexShrink: 0,
            }}
          />
          <span className="truncate" style={{ color: "#e8eaed" }}>
            {view.label}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span>{coordinateReadout(view)}</span>
          <span style={{ color: HUD_ACCENT, textShadow: `0 0 12px rgba(0, 212, 255, 0.4)` }}>
            {view.style === "normal" ? "EO" : view.style.toUpperCase()}
          </span>
        </span>
      </figcaption>
      {mounted ? (
        <iframe
          title={`God's Eye view of ${view.label}`}
          src={src}
          allow="fullscreen"
          referrerPolicy="no-referrer"
          className="block aspect-video w-full border-0"
          style={{ background: "#0a0a0f" }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setMounted(true)}
          className="flex aspect-video w-full flex-col items-center justify-center gap-3"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(0, 212, 255, 0.08) 0%, transparent 65%), #0a0a0f",
            border: 0,
            cursor: "pointer",
          }}
        >
          <span
            style={{
              fontFamily: HUD_MONO,
              fontSize: 11,
              letterSpacing: "0.22em",
              color: HUD_ACCENT,
              textShadow: "0 0 16px rgba(0, 212, 255, 0.4)",
              border: `1px solid ${HUD_ACCENT}`,
              borderRadius: 10,
              padding: "8px 18px",
            }}
          >
            REACQUIRE FEED
          </span>
          <span
            style={{
              fontFamily: HUD_MONO,
              fontSize: 10,
              letterSpacing: "0.12em",
              color: "rgba(232, 234, 237, 0.3)",
              textTransform: "uppercase",
            }}
          >
            feed parked — starts the local globe server
          </span>
        </button>
      )}
    </figure>
  );
}

export default function InlineGodsEyeRun({
  runId,
  task,
  quiet = false,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onRetry,
}: {
  runId: string;
  task: string;
  /** Super Agent selected God's Eye, so the framed view is the whole answer. */
  quiet?: boolean;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const persisted = parseGodsEyeResult(persistedContent);
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [phase, setPhase] = useState("starting the globe server");
  const [view, setView] = useState<GodsEyeView | null>(
    persistedOutcome === "completed" ? persisted.view : null,
  );
  const [result, setResult] = useState(persistedOutcome === "completed" ? persisted.content : "");
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const reported = useRef(false);
  const terminalRef = useRef(onTerminal);
  const base = `/api/gods-eye/runs/${runId}`;
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
      if (outcome === "completed") notifyTaskCompleted(`God's Eye — ${task.slice(0, 80)}`);
      terminalRef.current?.({ outcome, content });
    },
    [task],
  );

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.type === "service.starting") {
        setPhase("starting the globe server");
      } else if (event.type === "service.ready") {
        setStatus("running");
        setPhase("resolving the view");
      } else if (event.type === "view.resolving") {
        setStatus("running");
        setPhase("resolving the view");
      } else if (event.type === "view.resolved") {
        setPhase("framing the view");
      } else if (event.type === "run.completed") {
        const raw = text(payload.summary, "The view is framed.");
        const parsed = parseGodsEyeResult(raw);
        setStatus("completed");
        setResult(parsed.content);
        if (parsed.view) setView(parsed.view);
        report("completed", raw);
      } else if (event.type === "run.failed" || event.type === "run.aborted") {
        const outcome = event.type === "run.aborted" ? "aborted" : "failed";
        const reason =
          text(payload.summary) || text(payload.error) || "The view could not be resolved.";
        setStatus(outcome);
        setFailure(reason);
        report(outcome, reason);
      }
    },
    [report],
  );

  useEffect(() => {
    if (replaying) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (frame: MessageEvent) => {
      try {
        applyEvent(JSON.parse(frame.data) as RunEvent);
      } catch {
        // Malformed frame.
      }
    };
    EVENTS.forEach((type) => source.addEventListener(type, handle as EventListener));
    source.onerror = () => source.close();
    return () => source.close();
  }, [applyEvent, base, replaying]);

  const terminal = TERMINAL.has(status);
  const showView = Boolean(view) && status === "completed";
  const terminalContent = result || failure || "The God's Eye run finished.";

  if (quiet) {
    return (
      <>
        <AssistantResponseMeta
          active={!terminal}
          failed={terminal && status !== "completed"}
          summary={terminal ? undefined : phase}
        />
        {status === "completed" && (result || showView) ? (
          <div className="space-y-[17px]">
            {result ? <ChatMarkdown content={result} compact /> : null}
            {showView && view ? <GodsEyeViewport view={view} parked={replaying} /> : null}
          </div>
        ) : null}
        {failure ? (
          <div role="alert">
            <ChatMarkdown content={failure} compact />
          </div>
        ) : null}
        {terminal ? <AssistantMessageActions content={terminalContent} onRetry={onRetry} /> : null}
      </>
    );
  }

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        agentName="God's Eye"
        summary={terminal ? status : phase}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title">God&apos;s Eye</p>
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
              {terminal ? status : phase}
            </span>
            {showView && view ? (
              <a
                className="bb-agent-run-action"
                href={godsEyeOpenPath(view)}
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
          {!terminal ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {phase[0]?.toUpperCase()}
              {phase.slice(1)}…
            </p>
          ) : null}
          {showView && view ? <GodsEyeViewport view={view} parked={replaying} /> : null}
          {result ? (
            <section className="bb-agent-run-text">
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
