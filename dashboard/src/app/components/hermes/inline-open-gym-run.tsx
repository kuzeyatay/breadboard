"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type { ExternalAgentOutcome, ExternalAgentTerminalOutcome } from "@/lib/conversations/external-agent-runs";
import { parseOpenGymResult, type OpenGymAnimationReference } from "@/lib/open-gym/result.ts";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const STREAMED_EVENT_TYPES = [
  "run.started", "catalog.loaded", "catalog.searched", "state.reading", "state.loaded",
  "state.saved", "artifact.published", "agent.thinking", "agent.usage", "run.completed",
  "run.failed", "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export default function InlineOpenGymRun({
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
  const persisted = parseOpenGymResult(persistedContent);
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [progress, setProgress] = useState("Loading the openGym catalogue");
  const [catalogCount, setCatalogCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0 });
  const [result, setResult] = useState(persistedOutcome === "completed" ? persisted.content : "");
  const [animations, setAnimations] = useState<OpenGymAnimationReference[]>(
    persistedOutcome === "completed" ? persisted.animations : [],
  );
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const [manuallyPlaying, setManuallyPlaying] = useState<Set<string>>(() => new Set());
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const reportedRef = useRef(false);
  const onTerminalRef = useRef(onTerminal);
  const startedRef = useRef(0);
  const base = `/api/open-gym/runs/${runId}`;

  useEffect(() => { onTerminalRef.current = onTerminal; }, [onTerminal]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    reportedRef.current = false;
    startedRef.current = Date.now();
  }, [runId]);

  const applyEvent = useCallback((event: RunEvent) => {
    const payload = event.payload;
    if (event.type === "run.started") { setStatus("running"); setProgress("Reading your training context"); }
    if (event.type === "catalog.loaded") {
      setCatalogCount(number(payload.exerciseCount));
      setProgress("Catalogue ready");
    }
    if (event.type === "catalog.searched") {
      setProgress(`Matched ${number(payload.matches)} registered exercise${number(payload.matches) === 1 ? "" : "s"}`);
    }
    if (event.type === "state.loaded") setProgress("Persistent training state loaded");
    if (event.type === "state.saved") setProgress(`Saved ${text(payload.kind, "training state")}`);
    if (event.type === "artifact.published") {
      setProgress(payload.created === true ? "Program artifact published" : "Program saved to openGym state");
    }
    if (event.type === "agent.thinking") setProgress(text(payload.summary, "Working on the request"));
    if (event.type === "agent.usage") {
      setUsage({ inputTokens: number(payload.inputTokens), outputTokens: number(payload.outputTokens) });
    }
    if (event.type === "run.completed") {
      const raw = text(payload.summary, "openGym finished.");
      const parsed = parseOpenGymResult(raw);
      setStatus("completed");
      setResult(parsed.content);
      setAnimations(parsed.animations);
      setElapsed(number(payload.elapsedSec));
      if (!reportedRef.current) {
        reportedRef.current = true;
        notifyTaskCompleted(task);
        onTerminalRef.current?.({ outcome: "completed", content: raw });
      }
    }
    if (event.type === "run.failed" || event.type === "run.aborted") {
      const outcome = event.type === "run.aborted" ? "aborted" : "failed";
      const message = text(payload.summary) || (outcome === "aborted" ? "openGym stopped." : "openGym could not complete this run.");
      setStatus(outcome);
      setFailure(message);
      setElapsed(number(payload.elapsedSec));
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
      try { applyEvent(JSON.parse(message.data) as RunEvent); } catch { /* keep stream usable */ }
    };
    STREAMED_EVENT_TYPES.forEach((type) => source.addEventListener(type, handle as EventListener));
    source.onerror = () => {
      void fetch(`${base}/events?since=0`).then(async (response) => {
        if (response.ok) return;
        const data = await response.json().catch(() => ({})) as { error?: string };
        source.close();
        setStatus("failed");
        setFailure(data.error === "run_not_found"
          ? "This openGym run is no longer live, but its saved result remains below."
          : "The openGym event stream is unavailable.");
      }).catch(() => undefined);
    };
    return () => source.close();
  }, [applyEvent, base, persistedContent, persistedOutcome]);

  useEffect(() => {
    if (TERMINAL.has(status)) return;
    const timer = window.setInterval(() => setElapsed((Date.now() - startedRef.current) / 1_000), 1_000);
    return () => window.clearInterval(timer);
  }, [status]);

  const terminal = TERMINAL.has(status);
  const terminalContent = result.trim() || failure.trim() || "openGym finished.";

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        totalTokens={usage.inputTokens + usage.outputTokens || undefined}
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={progress}
        agentName="openGym"
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title">openGym</p>
          <div className="flex items-center gap-[8px]">
            {catalogCount ? <span className="bb-agent-run-label">{catalogCount.toLocaleString()} exercises</span> : null}
            <span className="bb-agent-run-label capitalize">{terminal ? status : "working"}</span>
            {!terminal ? (
              <button type="button" onClick={() => void fetch(`${base}/abort`, { method: "POST" })} className="bb-agent-run-action">Stop</button>
            ) : null}
          </div>
        </header>
        <div className="space-y-[17px] p-[21px]">
          {!terminal ? <p className="bb-agent-run-text text-[var(--ink-muted)]">{progress}</p> : null}
          {animations.length ? (
            <section className="grid gap-[13px] sm:grid-cols-2">
              {animations.map((exercise) => (
                <figure key={exercise.id} className="overflow-hidden rounded-[12px] border border-[var(--line)] bg-black/5">
                  {reducedMotion === false || manuallyPlaying.has(exercise.id) ? (
                    <>
                      {/* The authenticated source is an animated GIF. Next/Image's
                          optimizer is deliberately bypassed so motion is preserved. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/open-gym/exercises/${encodeURIComponent(exercise.id)}/animation`}
                        alt={`${exercise.name} exercise demonstration`}
                        className="aspect-square w-full object-contain"
                        loading="lazy"
                      />
                    </>
                  ) : (
                    <div className="flex aspect-square items-center justify-center p-6 text-center">
                      {reducedMotion === true ? (
                        <button
                          type="button"
                          className="bb-agent-run-action"
                          onClick={() => setManuallyPlaying((current) => new Set(current).add(exercise.id))}
                        >
                          Play animation
                        </button>
                      ) : (
                        <span className="bb-agent-run-label">Loading demonstration…</span>
                      )}
                    </div>
                  )}
                  <figcaption className="border-t border-[var(--line)] px-[11px] py-[9px]">
                    <p className="text-[12px] font-medium text-[var(--ink-heading)]">{exercise.name}</p>
                    <p className="mt-[2px] text-[11px] text-[var(--ink-muted)]">
                      {[exercise.bodyPart, exercise.equipment].filter(Boolean).join(" · ")}
                    </p>
                  </figcaption>
                </figure>
              ))}
            </section>
          ) : null}
          {result ? <section className="bb-agent-run-text"><ChatMarkdown content={result} compact /></section> : null}
          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}
        </div>
      </div>
      {terminal ? <AssistantMessageActions content={terminalContent} onRetry={onRetry} /> : null}
    </>
  );
}
