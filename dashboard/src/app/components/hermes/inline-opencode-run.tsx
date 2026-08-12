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

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function elapsedLabel(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  return `${Math.floor(rounded / 60)}m ${String(rounded % 60).padStart(2, "0")}s`;
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
  onTerminal?: (result: {
    outcome: ExternalAgentTerminalOutcome;
    content: string;
    activity: ExternalAgentActivityEntry[];
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
  const [activityOpen, setActivityOpen] = useState(true);
  const [edits, setEdits] = useState<ExternalAgentEdits | null>(persistedEdits ?? null);
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted"
      ? persistedContent
      : "",
  );
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState<ChatTokenUsage | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const reportedRef = useRef(false);
  const onTerminalRef = useRef(onTerminal);
  // The timeline is reported with the terminal result, so it has to be readable
  // synchronously — a queued state update is not yet visible when a run ends.
  const activityRef = useRef<ActivityEvent[]>(activity);
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
    async (outcome: ExternalAgentTerminalOutcome, content: string) => {
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

  useEffect(() => {
    reportedRef.current = false;
    startedAtRef.current = Date.now();
  }, [runId]);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
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
        setUsage(normalizeChatTokenUsage(payload));
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
        setStatus("completed");
        setResult(summary);
        setElapsed(numberValue(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          notifyTaskCompleted(`${agentName} finished: ${task}`);
          void reportTerminal("completed", summary);
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
        setStatus(outcome);
        setFailure(message);
        if (!reportedRef.current) {
          reportedRef.current = true;
          void reportTerminal(outcome, message);
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

  useEffect(() => {
    if (TERMINAL.has(status)) return;
    const startedAt = startedAtRef.current ?? Date.now();
    startedAtRef.current = startedAt;
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedAt) / 1_000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  const terminal = TERMINAL.has(status);
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
          {timeline.length ? (
            <span className="bb-agent-run-label tabular-nums">
              {timeline.length} step{timeline.length === 1 ? "" : "s"}
            </span>
          ) : null}
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
            {terminal ? status : `coding · ${elapsedLabel(elapsed)}`}
          </span>
        </div>
      </header>

      <div className="space-y-[13px] p-[21px]">
      {timeline.length && terminal ? (
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
          {timeline.length} {timeline.length === 1 ? "step" : "steps"}
          <span className="ml-auto">{activityOpen ? "Hide" : "Show"}</span>
        </button>
      ) : null}

      {timeline.length && (!terminal || activityOpen) ? (
        <ol
          id={timelineId}
          className="relative space-y-4 py-1"
          aria-label={`${agentName} activity timeline`}
        >
          <span
            aria-hidden
            className="absolute bottom-2 left-[3px] top-2 w-px bg-[var(--line)]"
          />
          {timeline.map((item) => (
            <li
              key={item.key}
              className="relative grid min-w-0 grid-cols-[8px_minmax(0,1fr)] gap-4"
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
                  <p className="text-[13px] leading-[1.4] text-[var(--ink-muted)]">
                    <span className="font-medium text-[var(--ink-heading)]">
                      {toolLabel(item.tool)}
                    </span>
                    {item.title ? ` ${item.title}` : ""}
                  </p>
                  {item.summary ? (
                    <pre className="bb-agent-run-inset bb-agent-run-readout mt-[5px] max-w-full whitespace-pre-wrap break-words p-[13px]">
                      {item.summary}
                    </pre>
                  ) : null}
                </div>
              ) : (
                <div className="bb-agent-run-text">
                  <ChatMarkdown content={item.text} compact />
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      </div>
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
      {terminal && edits && gardenSlug ? (
        <AgentEditsCard gardenSlug={gardenSlug} edits={edits} agentName={agentName} />
      ) : null}
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
