"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const STAGES = [
  { key: "prepare", label: "Preparing the picture" },
  { key: "depth", label: "Estimating depth and camera" },
  { key: "reconstruct", label: "Reconstructing the 3D shape" },
] as const;
type StageKey = (typeof STAGES)[number]["key"];
type StageState = "pending" | "active" | "done";
const STREAMED = ["run.started", "stage.updated", "run.completed", "run.failed", "run.aborted"];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export default function InlineFormsmithRun({
  runId,
  task,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
}: {
  runId: string;
  task: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [stages, setStages] = useState<Record<StageKey, StageState>>({
    prepare: "pending",
    depth: "pending",
    reconstruct: "pending",
  });
  const [result, setResult] = useState(persistedOutcome === "completed" ? persistedContent : "");
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [startedAt, setStartedAt] = useState<string | undefined>();
  const [completedAt, setCompletedAt] = useState<string | undefined>();
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  const base = `/api/shaper/runs/${runId}`;

  useEffect(() => { onTerminalRef.current = onTerminal; }, [onTerminal]);
  useEffect(() => { reportedRef.current = false; }, [runId]);

  const applyEvent = useCallback((event: RunEvent) => {
    if (event.at) setStartedAt((current) => current ?? event.at);
    if (event.type === "run.started") {
      setStatus("running");
      setStartedAt(event.at);
      return;
    }
    if (event.type === "stage.updated") {
      const key = asString(event.payload.stage) as StageKey;
      if (!STAGES.some((stage) => stage.key === key)) return;
      const state = asString(event.payload.status);
      setStages((current) => ({
        ...current,
        [key]: state === "completed" ? "done" : state === "running" ? "active" : "pending",
      }));
      return;
    }
    if (event.type === "run.completed") {
      setStatus("completed");
      setResult(asString(event.payload.summary));
      setCompletedAt(event.at);
      setStages({ prepare: "done", depth: "done", reconstruct: "done" });
      return;
    }
    if (event.type === "run.failed") {
      setStatus("failed");
      setFailure(asString(event.payload.error, "ShapeR could not reconstruct this picture."));
      setCompletedAt(event.at);
      return;
    }
    if (event.type === "run.aborted") {
      setStatus("aborted");
      setFailure(asString(event.payload.summary, "The reconstruction was stopped."));
      setCompletedAt(event.at);
    }
  }, []);

  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running") return;
    const stream = new EventSource(`${base}/events`);
    const handler = (event: MessageEvent) => {
      try { applyEvent(JSON.parse(event.data) as RunEvent); } catch { /* malformed frame */ }
    };
    for (const type of STREAMED) stream.addEventListener(type, handler);
    stream.onerror = () => stream.close();
    return () => {
      for (const type of STREAMED) stream.removeEventListener(type, handler);
      stream.close();
    };
  }, [applyEvent, base, persistedOutcome]);

  useEffect(() => {
    if (!TERMINAL.has(status) || reportedRef.current) return;
    const content = status === "completed" ? result : failure;
    if (!content) return;
    reportedRef.current = true;
    notifyTaskCompleted(`Formsmith — ${task.slice(0, 80)}`);
    onTerminalRef.current?.({
      outcome: status as ExternalAgentTerminalOutcome,
      content,
    });
  }, [failure, result, status, task]);

  const running = !TERMINAL.has(status);
  const statusDot = running
    ? "animate-pulse bg-[var(--botanical-2)]"
    : status === "completed"
      ? "bg-[var(--botanical)]"
      : "bg-[var(--danger)]";

  return (
    <>
      <AssistantResponseMeta
        active={running}
        failed={!running && status !== "completed"}
        agentName="Formsmith"
        startedAt={startedAt}
        completedAt={completedAt}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <div className="bb-agent-run-header">
          <span className="bb-agent-run-title truncate">Formsmith</span>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span className={`bb-agent-run-led h-1.5 w-1.5 ${statusDot}`} />
              {running ? "shaping" : status}
            </span>
            {running ? (
              <button type="button" className="bb-agent-run-action" onClick={() => void fetch(`${base}/abort`, { method: "POST" })}>
                Stop
              </button>
            ) : null}
          </div>
        </div>
        <div className="space-y-[13px] p-[21px]">
          <p className="truncate text-[13px] leading-[1.4] text-[var(--ink-muted)]">{task}</p>
          {running || !result ? (
            <ol className="bb-agent-run-inset space-y-[5px] p-[13px]">
              {STAGES.map((stage) => (
                <li key={stage.key} className="flex items-center gap-[8px]">
                  <span aria-hidden className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                    stages[stage.key] === "done"
                      ? "bg-[var(--botanical)]"
                      : stages[stage.key] === "active"
                        ? "animate-pulse bg-[var(--botanical-2)]"
                        : "bg-[var(--line-strong)]"
                  }`} />
                  <span className={`text-[13px] leading-[1.618] ${stages[stage.key] === "pending" ? "text-[var(--ink-muted)]" : "text-[var(--ink)]"}`}>
                    {stage.label}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {result ? <div className="bb-agent-run-text"><ChatMarkdown content={result} compact /></div> : null}
          {failure ? <p className="bb-agent-run-text whitespace-pre-wrap text-[var(--danger)]">{failure}</p> : null}
        </div>
      </div>
      {!running ? <AssistantMessageActions content={result || failure} /> : null}
    </>
  );
}
