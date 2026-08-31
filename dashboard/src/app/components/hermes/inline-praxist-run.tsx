"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs";
import { closeAgentRunStream, resolveAgentRunStreamError } from "@/lib/agent-run-stream";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import { externalRunStartedAtMs } from "./external-run-clock";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "praxist.starting",
  "praxist.launched",
  "praxist.progress",
  "artifact.ready",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function taskName(task: string): string {
  return task.replace(/[\\/]+$/u, "").split(/[\\/]/u).at(-1) || "task project";
}

function elapsedLabel(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

export default function InlinePraxistRun({
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
  onTerminal?: (result: { outcome: ExternalAgentTerminalOutcome; content: string }) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [phase, setPhase] = useState("preparing the research run");
  const [model, setModel] = useState("");
  const [generation, setGeneration] = useState<number | null>(null);
  const [maxGenerations, setMaxGenerations] = useState<number | null>(null);
  const [findings, setFindings] = useState<number | null>(null);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  const startedRef = useRef(0);
  const base = `/api/praxist/runs/${runId}`;

  useEffect(() => { onTerminalRef.current = onTerminal; }, [onTerminal]);
  useEffect(() => {
    reportedRef.current = false;
    startedRef.current = externalRunStartedAtMs(runId);
    setElapsed(Math.max(0, (Date.now() - startedRef.current) / 1_000));
  }, [runId]);

  const applyEvent = useCallback((event: RunEvent) => {
    const payload = event.payload;
    if (event.type === "run.started") {
      setStatus("running");
      setModel(asString(payload.model));
    }
    if (event.type === "praxist.starting" || event.type === "praxist.launched") {
      setPhase(asString(payload.phase, "starting the Praxist orchestrator"));
    }
    if (event.type === "praxist.progress") {
      setPhase(asString(payload.phase, "researching"));
      setGeneration(asNumber(payload.generation));
      setMaxGenerations(asNumber(payload.maxGenerations));
      setFindings(asNumber(payload.findings));
    }
    if (event.type === "artifact.ready") {
      const artifact = payload.artifact;
      if (artifact && typeof artifact === "object" && !Array.isArray(artifact)) {
        const name = asString((artifact as Record<string, unknown>).name);
        if (name) setArtifacts((current) => current.includes(name) ? current : [...current, name]);
      }
    }
    if (event.type === "run.completed") {
      const summary = asString(payload.summary, "Praxist completed the research run.");
      setStatus("completed");
      setResult(summary);
      setElapsed((current) => asNumber(payload.elapsedSec) ?? current);
      if (!reportedRef.current) {
        reportedRef.current = true;
        notifyTaskCompleted(`Praxist: ${taskName(task)}`);
        onTerminalRef.current?.({ outcome: "completed", content: summary });
      }
    }
    if (event.type === "run.failed" || event.type === "run.aborted") {
      const outcome = event.type === "run.aborted" ? "aborted" : "failed";
      const message = asString(payload.summary) || asString(payload.error) ||
        (outcome === "aborted" ? "Praxist research stopped." : "Praxist could not complete the run.");
      setStatus(outcome);
      setFailure(message);
      setElapsed((current) => asNumber(payload.elapsedSec) ?? current);
      if (!reportedRef.current) {
        reportedRef.current = true;
        onTerminalRef.current?.({ outcome, content: message });
      }
    }
  }, [task]);

  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running" && persistedContent) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try { applyEvent(JSON.parse(message.data) as RunEvent); } catch { /* keep stream alive */ }
    };
    STREAMED_EVENT_TYPES.forEach((type) => source.addEventListener(type, handle as EventListener));
    source.onerror = () => {
      resolveAgentRunStreamError({
        source,
        base,
        replayEnding: applyEvent,
        onUnavailable: (reason) => {
          setStatus("failed");
          setFailure(reason === "run_not_found"
            ? "This Praxist run is no longer live, but its saved result remains below."
            : "The Praxist event stream is unavailable.");
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
  const terminalContent = result.trim() || failure.trim() || "Praxist finished.";

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={phase}
        agentName="Praxist"
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Praxist
            {model ? <span className="ml-[8px] font-mono text-[11px] font-normal text-[var(--ink-muted)]">{model}</span> : null}
          </p>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span className={`bb-agent-run-led h-1.5 w-1.5 ${status === "completed" ? "bg-[var(--botanical)]" : terminal ? "bg-[var(--danger)]" : "animate-pulse bg-[var(--botanical-2)]"}`} />
              {terminal ? status : `researching · ${elapsedLabel(elapsed)}`}
            </span>
            {!terminal ? (
              <button type="button" onClick={() => void fetch(`${base}/abort`, { method: "POST" }).catch(() => undefined)} className="bb-agent-run-action">Stop</button>
            ) : null}
          </div>
        </header>
        <div className="space-y-[13px] p-[21px]">
          <section className="bb-agent-run-row p-[10px]">
            <p className="bb-agent-run-label">Task project</p>
            <p className="bb-agent-run-text mt-[4px] break-all font-mono text-[var(--ink-heading)]" title={task}>{taskName(task)}</p>
          </section>
          {!terminal ? (
            <section className="grid grid-cols-3 gap-[8px]">
              <div className="bb-agent-run-pill px-[9px] py-[7px]"><p className="bb-agent-run-label">Phase</p><p className="bb-agent-run-text mt-[3px] truncate text-[var(--ink-heading)]">{phase}</p></div>
              <div className="bb-agent-run-pill px-[9px] py-[7px]"><p className="bb-agent-run-label">Generation</p><p className="bb-agent-run-text mt-[3px] text-[var(--ink-heading)]">{generation ?? "–"}{maxGenerations === null ? "" : ` / ${maxGenerations}`}</p></div>
              <div className="bb-agent-run-pill px-[9px] py-[7px]"><p className="bb-agent-run-label">Findings</p><p className="bb-agent-run-text mt-[3px] text-[var(--ink-heading)]">{findings ?? "–"}</p></div>
            </section>
          ) : null}
          {artifacts.length ? <p className="bb-agent-run-text text-[var(--ink-muted)]">Artifacts · {artifacts.join(" · ")}</p> : null}
          {result ? (
            <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]"><ChatMarkdown content={result} compact /></section>
          ) : failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}
        </div>
      </div>
      {terminal ? <AssistantMessageActions content={terminalContent} onRetry={onRetry} /> : null}
    </>
  );
}
