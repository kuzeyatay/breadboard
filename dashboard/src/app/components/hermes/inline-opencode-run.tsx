"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import AgentEditsCard from "@/app/components/hermes/agent-edits-card";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import type {
  ExternalAgentActivityEntry,
  ExternalAgentEdits,
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs.ts";
import { notifyTaskCompleted } from "@/lib/task-completion-notification.ts";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface ReasoningEvent {
  key: number;
  kind: "reasoning";
  text: string;
}

interface ToolEvent {
  key: number;
  kind: "tool";
  tool: string;
  status: string;
  title: string;
  summary: string;
}

type ActivityEvent = ReasoningEvent | ToolEvent;

const STREAMED_EVENT_TYPES = [
  "run.started",
  "reasoning.completed",
  "tool.completed",
  "agent.usage",
  "text.completed",
  "run.retrying",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

/** How many timeline entries a live run keeps on screen. */
const VISIBLE_ACTIVITY = 6;

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The duration belongs to the turn, not to the browser tab that watched it: a
 * reload restarts every client-side stopwatch at zero, and a finished card that
 * was never told how long it took shows nothing at all. Carrying it in the
 * persisted usage is what makes "Thinking · 4m 12s" survive a refresh.
 */
function usageWithDuration(
  usage: ChatTokenUsage | null,
  durationMs: number | undefined,
): ChatTokenUsage | undefined {
  if (!usage && durationMs === undefined) return undefined;
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    ...(usage ?? {}),
    ...(durationMs === undefined
      ? {}
      : { responseDurationMs: Math.max(0, Math.round(durationMs)) }),
  };
}

function appendActivity(
  current: ActivityEvent[],
  event: ActivityEvent,
): ActivityEvent[] {
  if (current.some((item) => item.key === event.key)) return current;
  return [...current, event]
    .sort((left, right) => left.key - right.key)
    .slice(-80);
}

function toolLabel(value: string): string {
  return value
    .replace(/^(?:functions\.|tools\.)/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function InlineOpenCodeRun({
  runId,
  task,
  gardenSlug,
  persistedContent = "",
  persistedOutcome,
  persistedActivity,
  persistedEdits,
  persistedUsage,
  onTerminal,
  onRetry,
  agentName = "OpenCode",
  apiSlug = "opencode",
}: {
  runId: string;
  task: string;
  /** The Garden whose repository this run edits. */
  gardenSlug?: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  /** The stored timeline, so a finished run still shows what it did. */
  persistedActivity?: ExternalAgentActivityEntry[];
  /** Snapshots bracketing the run, so its edits stay reviewable and undoable. */
  persistedEdits?: ExternalAgentEdits;
  /** The stored tokens and duration, so a reloaded card keeps its meta row. */
  persistedUsage?: ChatTokenUsage;
  onTerminal?: (result: {
    outcome: ExternalAgentTerminalOutcome;
    content: string;
    activity: ExternalAgentActivityEntry[];
    usage?: ChatTokenUsage;
    edits?: ExternalAgentEdits;
  }) => void;
  onRetry?: () => void;
  agentName?: "OpenCode" | "Codex";
  apiSlug?: "opencode" | "codex";
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running"
      ? persistedOutcome
      : "starting",
  );
  const [activity, setActivity] = useState<ActivityEvent[]>(
    () => persistedActivity ?? [],
  );
  // The call list is expanded while the run is live and folds itself away once
  // the run lands, so an active card shows its work and a finished one stays
  // compact. Either state is still a click away.
  const [activityOpen, setActivityOpen] = useState(
    () => !(persistedOutcome && persistedOutcome !== "running"),
  );
  const [edits, setEdits] = useState<ExternalAgentEdits | null>(persistedEdits ?? null);
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted"
      ? persistedContent
      : "",
  );
  const [elapsed, setElapsed] = useState(
    () => (persistedUsage?.responseDurationMs ?? 0) / 1_000,
  );
  const [usage, setUsage] = useState<ChatTokenUsage | null>(
    persistedUsage ?? null,
  );
  // When the run started, in this browser's clock. A reload has no memory of
  // it, so it is recovered from the timestamp on the first replayed event
  // rather than restarted — a resumed card keeps counting from the real start.
  const startedAtRef = useRef<number | null>(null);
  const reportedRef = useRef(false);
  const onTerminalRef = useRef(onTerminal);
  // The timeline and usage are reported with the terminal result, so they have
  // to be readable synchronously — a queued state update is not yet visible
  // when a run ends.
  const activityRef = useRef<ActivityEvent[]>(activity);
  const usageRef = useRef<ChatTokenUsage | null>(usage);
  const timelineId = useId();
  const base = `/api/${apiSlug}/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  /**
   * Close the run's undo bracket before reporting it, so the snapshot pair is
   * stored with the turn and the edits stay revertable after a reload.
   */
  const reportTerminal = useCallback(
    async (
      outcome: ExternalAgentTerminalOutcome,
      content: string,
      durationMs?: number,
    ) => {
      const measured =
        durationMs ??
        (startedAtRef.current === null
          ? undefined
          : Math.max(0, Date.now() - startedAtRef.current));
      const reportedUsage = usageWithDuration(usageRef.current, measured);
      let finalized: ExternalAgentEdits | undefined;
      if (gardenSlug) {
        try {
          const response = await fetch("/api/agent-edits", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "finalize", gardenSlug, runId }),
          });
          const data = (await response.json().catch(() => ({}))) as {
            edits?: { before?: unknown; after?: unknown };
          };
          if (
            typeof data.edits?.before === "string" &&
            typeof data.edits?.after === "string"
          ) {
            finalized = { before: data.edits.before, after: data.edits.after };
            setEdits(finalized);
          }
        } catch {
          // No undo for this run; the result itself still lands.
        }
      }
      onTerminalRef.current?.({
        outcome,
        content,
        activity: activityRef.current,
        ...(reportedUsage ? { usage: reportedUsage } : {}),
        ...(finalized ? { edits: finalized } : {}),
      });
    },
    [gardenSlug, runId],
  );

  const pushActivity = useCallback((event: ActivityEvent) => {
    const next = appendActivity(activityRef.current, event);
    if (next === activityRef.current) return;
    activityRef.current = next;
    setActivity(next);
  }, []);

  // History can arrive after the card mounts, so fall back to it until the
  // stream produces something of its own.
  const timeline = activity.length ? activity : (persistedActivity ?? []);
  // Same fallback for the undo bracket: the server stores it with the turn the
  // moment the run ends, so even when this tab's own finalize call lost the
  // race (or failed), the stored bracket still puts the edits card on screen.
  const shownEdits = edits ?? persistedEdits ?? null;

  useEffect(() => {
    reportedRef.current = false;
    startedAtRef.current = null;
  }, [runId]);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      // Every replayed frame carries when it happened, so the earliest one seen
      // dates the run. Without this a refreshed card would start its clock at
      // the moment the tab reopened and report minutes of work as seconds.
      const at = Date.parse(event.at);
      if (
        Number.isFinite(at) &&
        (startedAtRef.current === null || at < startedAtRef.current)
      ) {
        startedAtRef.current = at;
      }
      if (event.type === "run.started") setStatus("running");
      if (
        event.type === "reasoning.completed" &&
        typeof payload.text === "string"
      ) {
        pushActivity({
          key: event.sequenceNumber,
          kind: "reasoning",
          text: payload.text as string,
        });
      }
      if (event.type === "agent.usage") {
        const next = normalizeChatTokenUsage(payload);
        usageRef.current = next;
        setUsage(next);
      }
      if (event.type === "run.retrying") {
        setStatus("running");
        setFailure("");
        pushActivity({
          key: event.sequenceNumber,
          kind: "reasoning",
          text:
            typeof payload.summary === "string"
              ? payload.summary
              : "The model request failed before any changes were made. Retrying once…",
        });
      }
      if (event.type === "tool.completed") {
        pushActivity({
          key: event.sequenceNumber,
          kind: "tool",
          tool: typeof payload.tool === "string" ? payload.tool : "tool",
          status:
            typeof payload.status === "string" ? payload.status : "completed",
          title: typeof payload.title === "string" ? payload.title : "",
          summary: typeof payload.summary === "string" ? payload.summary : "",
        });
      }
      if (event.type === "text.completed" && typeof payload.text === "string") {
        setResult((current) =>
          [current.trim(), (payload.text as string).trim()]
            .filter(Boolean)
            .join("\n\n"),
        );
      }
      if (event.type === "run.completed") {
        const summary =
          typeof payload.summary === "string"
            ? payload.summary
            : `${agentName} completed the task.`;
        // The run measured itself; that reading outlives whatever this tab
        // happened to observe.
        const elapsedSec = numberValue(payload.elapsedSec);
        setStatus("completed");
        setResult(summary);
        if (elapsedSec > 0) setElapsed(elapsedSec);
        if (!reportedRef.current) {
          reportedRef.current = true;
          notifyTaskCompleted(`${agentName} finished: ${task}`);
          void reportTerminal(
            "completed",
            summary,
            elapsedSec > 0 ? elapsedSec * 1_000 : undefined,
          );
        }
      }
      if (event.type === "run.failed" || event.type === "run.aborted") {
        const outcome = event.type === "run.aborted" ? "aborted" : "failed";
        const message =
          typeof payload.summary === "string"
            ? payload.summary
            : typeof payload.error === "string"
              ? payload.error
              : outcome === "aborted"
                ? `${agentName} task stopped.`
                : `${agentName} could not complete the task.`;
        const failedAfterSec = numberValue(payload.elapsedSec);
        setStatus(outcome);
        setFailure(message);
        if (failedAfterSec > 0) setElapsed(failedAfterSec);
        if (!reportedRef.current) {
          reportedRef.current = true;
          void reportTerminal(
            outcome,
            message,
            failedAfterSec > 0 ? failedAfterSec * 1_000 : undefined,
          );
        }
      }
    },
    [agentName, pushActivity, reportTerminal, task],
  );

  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running" && persistedContent) {
      return;
    }
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // Ignore a malformed frame without breaking later run events.
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
          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          setStatus("failed");
          setFailure(
            data.error === "run_not_found"
              ? `This ${agentName} process is no longer live, but its saved result remains.`
              : `The ${agentName} event stream is unavailable.`,
          );
        })
        .catch(() => undefined);
    };
    return () => source.close();
  }, [agentName, applyEvent, base, persistedContent, persistedOutcome]);

  // The start is read on every tick rather than captured once: the first
  // replayed event can move it backwards after the timer is already running.
  useEffect(() => {
    if (TERMINAL.has(status)) return;
    const tick = () => {
      // Until a frame dates the run, now is the best guess; a replayed event
      // then pulls the start backwards to where it really was.
      const startedAt = startedAtRef.current ?? Date.now();
      startedAtRef.current = startedAt;
      setElapsed(Math.max(0, (Date.now() - startedAt) / 1_000));
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (TERMINAL.has(status)) setActivityOpen(false);
  }, [status]);

  const terminal = TERMINAL.has(status);
  const callCount = timeline.filter((item) => item.kind === "tool").length;
  const callLabel = `${callCount} ${callCount === 1 ? "call" : "calls"}`;
  // A live run shows the tail of what it is doing rather than every step it has
  // ever taken, which is what keeps the card slim while it works. Reopening a
  // finished one is a deliberate act — "show me the whole run" — so that view
  // holds nothing back.
  const visibleTimeline = !activityOpen
    ? []
    : terminal
      ? timeline
      : timeline.slice(-VISIBLE_ACTIVITY);
  const hiddenCount = timeline.length - visibleTimeline.length;
  const terminalContent =
    result.trim() ||
    failure.trim() ||
    (status === "aborted"
      ? `${agentName} task stopped.`
      : status === "failed"
        ? `${agentName} could not complete the task.`
        : `${agentName} completed the task.`);

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        usage={usage ?? undefined}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        agentName={agentName}
      />
      <div className="bb-agent-run-card overflow-hidden">
      <header className="bb-agent-run-header">
        <p className="bb-agent-run-title truncate">{agentName}</p>
        <div className="flex shrink-0 items-center gap-[8px]">
          <span className="bb-agent-run-label inline-flex items-center gap-1.5">
            <span
              className={`bb-agent-run-led h-1.5 w-1.5 ${
                status === "completed"
                  ? "bg-[var(--botanical)]"
                  : terminal
                    ? "bg-[var(--danger)]"
                    : "animate-pulse bg-[var(--botanical-2)]"
              }`}
            />
            {terminal ? (
              <span className="capitalize">{status}</span>
            ) : (
              <span className="tabular-nums">{callLabel}</span>
            )}
          </span>
        </div>
      </header>

      {timeline.length ? (
        <div className="space-y-[9px] px-[15px] py-[13px]">
          <button
            type="button"
            onClick={() => setActivityOpen((open) => !open)}
            aria-expanded={activityOpen}
            aria-controls={timelineId}
            className="bb-agent-run-label flex w-full items-center gap-[8px] transition-colors hover:text-[var(--ink-heading)]"
          >
            <svg
              aria-hidden
              className={`h-3 w-3 transition-transform ${activityOpen ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
            </svg>
            <span className="tabular-nums">{callLabel}</span>
            <span className="ml-auto">{activityOpen ? "Hide" : "Show"}</span>
          </button>
          {hiddenCount > 0 && activityOpen ? (
            <p className="bb-agent-run-label tabular-nums">
              {hiddenCount} earlier {hiddenCount === 1 ? "step" : "steps"}
            </p>
          ) : null}
          {visibleTimeline.length ? (
            <ol
              id={timelineId}
              className="relative space-y-[11px] py-1"
              aria-label={`${agentName} activity timeline`}
            >
              <span
                aria-hidden
                className="absolute bottom-2 left-[3px] top-2 w-px bg-[var(--line)]"
              />
              {visibleTimeline.map((item) => (
                <li
                  key={item.key}
                  className="relative grid min-w-0 grid-cols-[8px_minmax(0,1fr)] gap-3"
                >
                  <span
                    aria-hidden
                    className={`relative z-10 mt-[7px] h-2 w-2 rounded-full ${
                      item.kind === "tool" && (item.status === "error" || item.status === "failed")
                        ? "bg-[var(--danger)]"
                        : item.kind === "tool"
                          ? "bg-[var(--botanical-2)]"
                          : "bg-[var(--ink-muted)]"
                    } ${
                      !terminal && item.key === timeline[timeline.length - 1]?.key
                        ? "motion-safe:animate-pulse"
                        : ""
                    }`}
                  />
                  {item.kind === "tool" ? (
                    <div className="min-w-0">
                      <p
                        className={`text-[13px] leading-[1.4] text-[var(--ink-muted)] ${
                          terminal ? "break-words" : "truncate"
                        }`}
                      >
                        <span className="font-medium text-[var(--ink-heading)]">
                          {toolLabel(item.tool)}
                        </span>
                        {item.title ? ` ${item.title}` : ""}
                      </p>
                      {item.summary ? (
                        // A live card keeps each readout short so the tail of the
                        // run stays on screen; a reopened one is being read, so it
                        // gets the room the edits card gets.
                        <pre
                          className={`bb-agent-run-inset bb-agent-run-readout mt-[5px] max-w-full overflow-y-auto whitespace-pre-wrap break-words p-[9px] ${
                            terminal ? "max-h-80" : "max-h-[120px]"
                          }`}
                        >
                          {item.summary}
                        </pre>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      className={`bb-agent-run-text ${terminal ? "" : "line-clamp-3"}`}
                    >
                      <ChatMarkdown content={item.text} compact />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      </div>
      {result ? (
        <section className="bb-agent-run-text mt-[13px] px-1">
          <ChatMarkdown content={result} compact />
        </section>
      ) : failure ? (
        <p className="bb-agent-run-text mt-[13px] px-1 text-[var(--danger)]">{failure}</p>
      ) : terminal ? (
        <p className="bb-agent-run-text mt-[13px] px-1 text-[var(--ink-muted)]">
          {terminalContent}
        </p>
      ) : null}
      {terminal && shownEdits && gardenSlug ? (
        <AgentEditsCard gardenSlug={gardenSlug} edits={shownEdits} agentName={agentName} />
      ) : null}
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
