"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import AgentEditsCard from "@/app/components/hermes/agent-edits-card";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import type {
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
  /** Ruflo coordination call (`mcp__ruflo__*`) rather than a file/shell tool. */
  swarm: boolean;
  summary: string;
}

type ActivityEvent = ReasoningEvent | ToolEvent;

interface SwarmPlan {
  swarmId: string;
  queenType: string;
  consensus: string;
  topology: string;
  workerCount: number;
  workerTypes: string[];
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "swarm.planning",
  "swarm.configured",
  "swarm.started",
  "hive.connected",
  "reasoning.completed",
  "tool.completed",
  "agent.usage",
  "text.completed",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

/** `mcp__ruflo__hive-mind_consensus` reads as "Hive Mind Consensus". */
function toolLabel(value: string): string {
  return value
    .replace(/^mcp__[a-z0-9_-]+__/i, "")
    .replace(/^(?:functions\.|tools\.)/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function InlineRufloRun({
  runId,
  task,
  gardenSlug,
  persistedContent = "",
  persistedOutcome,
  persistedEdits,
  onTerminal,
  onRetry,
}: {
  runId: string;
  task: string;
  /** The Garden whose repository this swarm edits. */
  gardenSlug?: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  /** Snapshots bracketing the run, so its edits stay reviewable and undoable. */
  persistedEdits?: ExternalAgentEdits;
  onTerminal?: (result: {
    outcome: ExternalAgentTerminalOutcome;
    content: string;
    edits?: ExternalAgentEdits;
  }) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running"
      ? persistedOutcome
      : "starting",
  );
  const [phase, setPhase] = useState<"planning" | "running">("planning");
  const [plan, setPlan] = useState<SwarmPlan | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
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
  const [edits, setEdits] = useState<ExternalAgentEdits | null>(persistedEdits ?? null);
  const base = `/api/ruflo/runs/${runId}`;

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
        ...(finalized ? { edits: finalized } : {}),
      });
    },
    [gardenSlug, runId],
  );

  useEffect(() => {
    reportedRef.current = false;
    startedAtRef.current = Date.now();
  }, [runId]);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.type === "run.started") {
        setStatus("running");
        setPhase("planning");
      }
      if (event.type === "swarm.planning" && typeof payload.summary === "string") {
        setActivity((current) =>
          appendActivity(current, {
            key: event.sequenceNumber,
            kind: "reasoning",
            text: payload.summary as string,
          }),
        );
      }
      if (event.type === "swarm.configured") {
        setPlan({
          swarmId: textValue(payload.swarmId, "unknown"),
          queenType: textValue(payload.queenType, "strategic"),
          consensus: textValue(payload.consensus, "byzantine"),
          topology: textValue(payload.topology, "hierarchical-mesh"),
          workerCount: numberValue(payload.workerCount),
          workerTypes: Array.isArray(payload.workerTypes)
            ? payload.workerTypes.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        });
      }
      if (event.type === "swarm.started") setPhase("running");
      if (
        event.type === "reasoning.completed" &&
        typeof payload.text === "string"
      ) {
        setActivity((current) =>
          appendActivity(current, {
            key: event.sequenceNumber,
            kind: "reasoning",
            text: payload.text as string,
          }),
        );
      }
      if (event.type === "agent.usage") setUsage(normalizeChatTokenUsage(payload));
      if (event.type === "tool.completed") {
        setActivity((current) =>
          appendActivity(current, {
            key: event.sequenceNumber,
            kind: "tool",
            tool: typeof payload.tool === "string" ? payload.tool : "tool",
            status:
              typeof payload.status === "string" ? payload.status : "completed",
            swarm: payload.swarm === true,
            summary: typeof payload.summary === "string" ? payload.summary : "",
          }),
        );
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
            : "The Ruflo swarm finished.";
        setStatus("completed");
        setResult(summary);
        setElapsed(numberValue(payload.elapsedSec));
        if (!reportedRef.current) {
          reportedRef.current = true;
          notifyTaskCompleted(`Ruflo swarm finished: ${task}`);
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
                ? "Ruflo swarm stopped."
                : "The Ruflo swarm could not complete the objective.";
        setStatus(outcome);
        setFailure(message);
        if (!reportedRef.current) {
          reportedRef.current = true;
          void reportTerminal(outcome, message);
        }
      }
    },
    [reportTerminal, task],
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
              ? "This Ruflo swarm is no longer live, but its saved result remains."
              : "The Ruflo event stream is unavailable.",
          );
        })
        .catch(() => undefined);
    };
    return () => source.close();
  }, [applyEvent, base, persistedContent, persistedOutcome]);

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
      ? "Ruflo swarm stopped."
      : status === "failed"
        ? "The Ruflo swarm could not complete the objective."
        : "The Ruflo swarm finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        usage={usage ?? undefined}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        agentName="Ruflo"
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title truncate">Ruflo</p>
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
            {terminal
              ? status
              : `${phase === "planning" ? "forming hive" : "swarming"} · ${elapsedLabel(elapsed)}`}
          </span>
        </header>

        <div className="space-y-[13px] p-[21px]">
        {/* How the hive was actually formed. It is the one thing about a Ruflo
            run you cannot reconstruct from the timeline below. */}
        {plan ? (
          <dl
            className="grid grid-cols-[repeat(auto-fit,minmax(89px,1fr))] gap-x-[21px] gap-y-[13px]"
            aria-label="Hive mind configuration"
          >
            {[
              { term: "Queen", detail: plan.queenType },
              {
                term: "Workers",
                detail: plan.workerTypes.length
                  ? `${plan.workerCount} · ${plan.workerTypes.join(", ")}`
                  : String(plan.workerCount),
              },
              { term: "Topology", detail: plan.topology },
              { term: "Consensus", detail: plan.consensus },
              { term: "Swarm", detail: plan.swarmId },
            ].map((item) => (
              <div key={item.term} className="min-w-0">
                <dt className="bb-agent-run-label">{item.term}</dt>
                <dd className="max-w-[16rem] truncate text-[13px] font-medium leading-[1.4] text-[var(--ink-heading)]">
                  {item.detail}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {activity.length ? (
          <ol className="relative space-y-4 py-1" aria-label="Ruflo swarm timeline">
            <span
              aria-hidden
              className="absolute bottom-2 left-[3px] top-2 w-px bg-[var(--line)]"
            />
            {activity.map((item) => (
              <li
                key={item.key}
                className="relative grid min-w-0 grid-cols-[8px_minmax(0,1fr)] gap-4"
              >
                <span
                  aria-hidden
                  className={`relative z-10 mt-[7px] h-2 w-2 rounded-full ${
                    item.kind === "tool" &&
                    (item.status === "error" || item.status === "failed")
                      ? "bg-[var(--danger)]"
                      : item.kind === "tool" && item.swarm
                        ? "bg-[var(--botanical)]"
                        : item.kind === "tool"
                          ? "bg-[var(--botanical-2)]"
                          : "bg-[var(--ink-muted)]"
                  } ${
                    !terminal && item.key === activity[activity.length - 1]?.key
                      ? "motion-safe:animate-pulse"
                      : ""
                  }`}
                />
                {item.kind === "tool" ? (
                  <div className="min-w-0">
                    <p className="text-[13px] leading-[1.4]">
                      <span className="font-medium text-[var(--ink-heading)]">
                        {toolLabel(item.tool)}
                      </span>
                      {item.swarm ? (
                        <span className="ml-[8px] text-[11px] text-[var(--botanical)]">hive</span>
                      ) : null}
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
        <AgentEditsCard gardenSlug={gardenSlug} edits={edits} agentName="Ruflo" />
      ) : null}
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
