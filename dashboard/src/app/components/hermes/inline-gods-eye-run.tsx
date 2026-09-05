"use client";

// The God's Eye run card, and the framed globe it exists for.
//
// Two presentations, like openGym's: the ordinary agent card
// (`bb-agent-run-card` chrome, same as every other agent), and a quiet one for
// a Super Agent delegation, where the framed view plus a sentence or two IS
// the answer — no card chrome, no second synthesis turn.
//
// The frame is a Breadboard panel, not a window into the clone's cockpit: the
// same raised paper, line and botanical tokens as every other run card, in
// whichever scheme the chat is showing. The globe inside is asked to match —
// the open route forwards the scheme and the clone's breadboard-theme.css
// re-dresses its HUD, panels and type in the dashboard's palette, and the
// dashboard's theme runtime posts later switches into every iframe, so the
// frame and its contents change together.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import { APP_THEME_CHANGE_EVENT, type AppTheme } from "@/lib/app-theme";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
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

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function currentTheme(): AppTheme {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeToTheme(onChange: () => void): () => void {
  window.addEventListener(APP_THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(APP_THEME_CHANGE_EVENT, onChange);
}

/**
 * The scheme the chat is showing, so the frame can be opened in it: null on
 * the server, read from the document on the client and kept current with the
 * theme runtime's change event. The frame itself is re-dressed by the
 * runtime's postMessage broadcast, so this only has to be right when a URL is
 * built.
 */
function useChatTheme(): AppTheme | null {
  return useSyncExternalStore(subscribeToTheme, currentTheme, () => null);
}

function coordinateReadout(view: GodsEyeView): string {
  const ns = view.lat >= 0 ? "N" : "S";
  const ew = view.lon >= 0 ? "E" : "W";
  const altitude =
    view.altM >= 1_000 ? `${(view.altM / 1_000).toFixed(view.altM >= 100_000 ? 0 : 1)}KM` : `${view.altM}M`;
  return `${Math.abs(view.lat).toFixed(3)}°${ns} ${Math.abs(view.lon).toFixed(3)}°${ew} · ALT ${altitude}`;
}

/**
 * The feed itself. Its URL is built once, in the scheme the chat shows at that
 * moment, and kept: a later theme switch reaches the running globe through the
 * theme runtime's postMessage rather than a reload that would lose the camera.
 */
function GodsEyeFrame({ view, theme }: { view: GodsEyeView; theme: AppTheme }) {
  const [src] = useState(() => godsEyeOpenPath(view, theme));
  return (
    <iframe
      title={`God's Eye view of ${view.label}`}
      src={src}
      allow="fullscreen"
      referrerPolicy="no-referrer"
      className="block aspect-video w-full border-0 bg-[var(--paper-bg)]"
    />
  );
}

/**
 * The globe, framed as a Breadboard run panel: label and coordinates in the
 * caption, the feed below. As wide as the text column it sits in — never
 * wider than the prose around it. A live completion mounts the feed at once;
 * a reopened card parks it behind one click, so scrolling old chats neither
 * boots the dev server nor spins up Cesium.
 */
function GodsEyeViewport({
  view,
  parked,
  theme,
}: {
  view: GodsEyeView;
  parked: boolean;
  theme: AppTheme | null;
}) {
  const [mounted, setMounted] = useState(!parked);
  const live = mounted && theme !== null;
  return (
    <figure className="bb-agent-run-panel w-full overflow-hidden" style={{ margin: 0 }}>
      <figcaption
        className="flex items-center justify-between gap-3 px-3.5 py-2"
        style={{
          borderBottom: "1px solid color-mix(in srgb, var(--line) 55%, transparent)",
          background: "color-mix(in srgb, var(--paper-strong) 22%, transparent)",
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={`bb-agent-run-led inline-block h-1.5 w-1.5 shrink-0 ${
              live ? "animate-pulse bg-[var(--botanical)]" : "bg-[var(--line-strong)]"
            }`}
          />
          <span className="bb-agent-run-title truncate">{view.label}</span>
        </span>
        <span className="bb-agent-run-readout flex shrink-0 items-center gap-3 uppercase tracking-[0.08em]">
          <span>{coordinateReadout(view)}</span>
          <span className="font-medium text-[var(--botanical)]">
            {view.style === "normal" ? "EO" : view.style.toUpperCase()}
          </span>
        </span>
      </figcaption>
      {live && theme ? (
        <GodsEyeFrame view={view} theme={theme} />
      ) : mounted ? (
        <div aria-hidden className="aspect-video w-full bg-[var(--paper-bg)]" />
      ) : (
        <button
          type="button"
          onClick={() => setMounted(true)}
          className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-3 border-0"
          style={{
            background:
              "radial-gradient(ellipse at center, color-mix(in srgb, var(--botanical) 12%, transparent) 0%, transparent 65%), var(--paper-bg)",
          }}
        >
          <span className="bb-agent-run-action bb-agent-run-action-primary">Reacquire feed</span>
          <span className="bb-agent-run-label">Feed parked — starts the local globe server</span>
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
  persistedUsage,
  onTerminal,
  onRetry,
}: {
  runId: string;
  task: string;
  /** Super Agent selected God's Eye, so the framed view is the whole answer. */
  quiet?: boolean;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  persistedUsage?: ChatTokenUsage;
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
  const [usage, setUsage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  const reported = useRef(false);
  const terminalRef = useRef(onTerminal);
  const base = `/api/gods-eye/runs/${runId}`;
  const replaying = Boolean(persistedOutcome && persistedOutcome !== "running" && persistedContent);
  const theme = useChatTheme();

  useEffect(() => {
    terminalRef.current = onTerminal;
  }, [onTerminal]);
  useEffect(() => {
    reported.current = false;
  }, [runId]);

  const report = useCallback(
    (
      outcome: "completed" | "failed" | "aborted",
      content: string,
      terminalUsage?: ChatTokenUsage,
    ) => {
      if (reported.current) return;
      reported.current = true;
      if (outcome === "completed") notifyTaskCompleted(`God's Eye — ${task.slice(0, 80)}`);
      terminalRef.current?.({
        outcome,
        content,
        ...(terminalUsage ? { usage: terminalUsage } : {}),
      });
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
        const terminalUsage = normalizeChatTokenUsage(payload.usage) ?? undefined;
        setStatus("completed");
        setResult(parsed.content);
        if (parsed.view) setView(parsed.view);
        if (terminalUsage) setUsage(terminalUsage);
        report("completed", raw, terminalUsage);
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
          usage={usage}
          summary={terminal ? undefined : phase}
        />
        {status === "completed" && (result || showView) ? (
          <div className="space-y-[17px]">
            {result ? <ChatMarkdown content={result} compact /> : null}
            {showView && view ? <GodsEyeViewport view={view} parked={replaying} theme={theme} /> : null}
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
        usage={usage}
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
                href={godsEyeOpenPath(view, theme ?? undefined)}
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
          {showView && view ? <GodsEyeViewport view={view} parked={replaying} theme={theme} /> : null}
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
