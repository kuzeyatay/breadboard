"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import { closeAgentRunStream, resolveAgentRunStreamError } from "@/lib/agent-run-stream";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import { OPENEXECUTIVE_AGENT_NAME } from "@/lib/openexecutive/identity.ts";
import { externalRunStartedAtMs } from "./external-run-clock";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "executive.progress",
  "executive.delta",
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

function elapsedLabel(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

export default function InlineOpenExecutiveRun({
  runId,
  task,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onRetry,
}: {
  runId: string;
  task: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  onTerminal?: (result: {
    outcome: ExternalAgentTerminalOutcome;
    content: string;
  }) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [stage, setStage] = useState("Assembling the executive team");
  const [model, setModel] = useState("");
  const [committee, setCommittee] = useState(false);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [elapsed, setElapsed] = useState(0);
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  const startedRef = useRef(0);
  const base = `/api/openexecutive/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);
  useEffect(() => {
    reportedRef.current = false;
    startedRef.current = externalRunStartedAtMs(runId);
    setElapsed(Math.max(0, (Date.now() - startedRef.current) / 1_000));
  }, [runId]);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.type === "run.started") {
        setStatus("running");
        setModel(asString(payload.model));
        setCommittee(payload.committeeReview === true);
      }
      if (event.type === "executive.progress") {
        setStage(asString(payload.summary, "Consulting the executive team"));
      }
      if (event.type === "executive.delta") {
        setDraft((current) => `${current}${asString(payload.text)}`.slice(-120_000));
      }
      if (event.type === "run.completed") {
        const summary = asString(payload.summary, "Open Executive finished.");
        setStatus("completed");
        setResult(summary);
        setElapsed(asNumber(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          notifyTaskCompleted(task);
          onTerminalRef.current?.({ outcome: "completed", content: summary });
        }
      }
      if (event.type === "run.failed" || event.type === "run.aborted") {
        const outcome = event.type === "run.aborted" ? "aborted" : "failed";
        const message =
          asString(payload.summary) ||
          (outcome === "aborted"
            ? "Open Executive stopped."
            : "Open Executive could not complete this task.");
        setStatus(outcome);
        setFailure(message);
        setElapsed(asNumber(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          onTerminalRef.current?.({ outcome, content: message });
        }
      }
    },
    [task],
  );

  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running" && persistedContent) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // Ignore one malformed frame and keep the bounded stream alive.
      }
    };
    STREAMED_EVENT_TYPES.forEach((type) =>
      source.addEventListener(type, handle as EventListener),
    );
    source.onerror = () => {
      resolveAgentRunStreamError({
        source,
        base,
        replayEnding: applyEvent,
        onUnavailable: (reason) => {
          if (persistedOutcome && persistedOutcome !== "running") return;
          const message =
            reason === "run_not_found"
              ? "This OpenExecutive run is no longer live, but its saved result remains below."
              : "The OpenExecutive event stream is unavailable.";
          setStatus("failed");
          setFailure(message);
          if (!reportedRef.current) {
            reportedRef.current = true;
            onTerminalRef.current?.({ outcome: "failed", content: message });
          }
        },
      });
    };
    return () => closeAgentRunStream(source);
  }, [applyEvent, base, persistedContent, persistedOutcome]);

  useEffect(() => {
    if (TERMINAL.has(status)) return;
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedRef.current) / 1_000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  const terminal = TERMINAL.has(status);
  const terminalContent =
    result.trim() || failure.trim() || (status === "aborted" ? "Open Executive stopped." : "Open Executive finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={stage}
        agentName={OPENEXECUTIVE_AGENT_NAME}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            {OPENEXECUTIVE_AGENT_NAME}
            {model ? <span className="ml-[8px] font-mono text-[11px] font-normal text-[var(--ink-muted)]">{model}</span> : null}
          </p>
          <div className="flex shrink-0 items-center gap-[8px]">
            {committee ? <span className="bb-agent-run-label">committee</span> : null}
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span className={`bb-agent-run-led h-1.5 w-1.5 ${status === "completed" ? "bg-[var(--botanical)]" : terminal ? "bg-[var(--danger)]" : "animate-pulse bg-[var(--botanical-2)]"}`} />
              {terminal ? status : `advising · ${elapsedLabel(elapsed)}`}
            </span>
            {!terminal ? (
              <button type="button" className="bb-agent-run-action" onClick={() => void fetch(`${base}/abort`, { method: "POST" })}>
                Stop
              </button>
            ) : null}
          </div>
        </header>
        <div className="space-y-[13px] p-[21px]">
          {!terminal ? (
            <section className="bb-agent-run-row p-[13px]">
              <p className="bb-agent-run-label mb-[5px]">Executive team</p>
              <p className="bb-agent-run-text text-[var(--ink-muted)]">{stage}</p>
              {draft ? <p className="bb-agent-run-text mt-[8px] line-clamp-3 text-[var(--ink-muted)]">{draft}</p> : null}
            </section>
          ) : null}
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
