"use client";

// In-chat run card for a Deep Research run. Mirrors the Agent TARS / Agent
// Browser inline cards: the host creates the run before this mounts, and this
// component only observes /api/deep-research/runs/<id>/events.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import {
  normalizeResearchBudget,
  normalizeResearchEvidenceSnapshot,
  type ResearchBudget,
  type ResearchCoverage,
  type ResearchEvidence,
  type ResearchSource,
  type ResearchWarning,
} from "@/lib/deep-research/events.ts";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

const ChatMarkdown = dynamic(() => import("@/app/components/chat-markdown"), { ssr: false });

function StopSpinner() {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3 animate-spin motion-reduce:animate-none"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
    </svg>
  );
}

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface Progress {
  currentDepth: number;
  totalDepth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);

const STREAMED_EVENT_TYPES = [
  "run.started",
  "run.status",
  "research.progress",
  "research.learnings",
  "research.evidence",
  "research.warning",
  "run.usage",
  "run.result",
  "run.completed",
  "run.failed",
  "run.aborted",
];

// Stable text for the service's error codes (the browser never sees internals).
const ERROR_TEXT: Record<string, string> = {
  run_not_found: "This run is no longer available — the research service restarted or the run expired.",
  service_unavailable: "The research service is not reachable.",
  service_misconfigured:
    "The dashboard and the research service do not share a secret (DEEP_RESEARCH_SECRET).",
  no_search_results: "The search found nothing usable, so there is nothing to report on.",
  engine_error: "The research engine failed mid-run.",
  search_not_configured: "No search backend is configured.",
  model_not_configured: "The research service has no model configured.",
};

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

export default function InlineDeepResearchRun({
  runId,
  query,
  persistedContent = "",
  persistedOutcome,
  persistedUsage,
  onTerminal,
  onRetry,
}: {
  runId: string;
  query: string;
  output: "report" | "answer";
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  persistedUsage?: ChatTokenUsage;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState<string>(
    persistedOutcome && persistedOutcome !== "running"
      ? persistedOutcome
      : "running",
  );
  const [progress, setProgress] = useState<Progress | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [learnings, setLearnings] = useState<string[]>([]);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [evidence, setEvidence] = useState<ResearchEvidence[]>([]);
  const [warnings, setWarnings] = useState<ResearchWarning[]>([]);
  const [coverage, setCoverage] = useState<ResearchCoverage | null>(null);
  const [budget, setBudget] = useState<ResearchBudget | null>(null);
  const [result, setResult] = useState<string | null>(
    persistedOutcome === "completed" ? persistedContent || null : null,
  );
  const [failure, setFailure] = useState<string | null>(
    persistedOutcome === "failed" || persistedOutcome === "aborted"
      ? persistedContent || null
      : null,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [usage, setUsage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  const [showLearnings, setShowLearnings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopPending, setStopPending] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const resultRef = useRef(result);
  const failureRef = useRef(failure);
  const usageRef = useRef(usage);
  const onTerminalRef = useRef(onTerminal);
  const reportedTerminalRef = useRef(false);
  const stopPendingRef = useRef(false);

  const base = `/api/deep-research/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedTerminalRef.current = false;
  }, [runId]);

  const applyEvent = useCallback((event: RunEvent) => {
    const payload = event.payload;
    if (event.type === "research.progress") setProgress(payload as unknown as Progress);
    if (event.type === "run.status" && typeof payload.message === "string") {
      setNote(payload.message);
    }
    if (event.type === "research.learnings") {
      if (Array.isArray(payload.learnings)) setLearnings(payload.learnings as string[]);
    }
    if (
      event.type === "research.learnings" ||
      event.type === "research.evidence" ||
      event.type === "research.warning" ||
      event.type === "run.completed" ||
      event.type === "run.failed" ||
      event.type === "run.aborted"
    ) {
      const snapshot = normalizeResearchEvidenceSnapshot(
        event.type === "research.warning" && !Array.isArray(payload.warnings)
          ? { ...payload, warnings: [payload] }
          : payload,
      );
      if (Array.isArray(payload.sources) || Array.isArray(payload.visitedUrls)) {
        setSources((current) =>
          snapshot.sources.length > 0 ? snapshot.sources : current,
        );
      }
      if (Array.isArray(payload.evidence)) {
        setEvidence((current) =>
          snapshot.evidence.length > 0 || current.length === 0
            ? snapshot.evidence
            : current,
        );
      }
      if (Array.isArray(payload.warnings) || event.type === "research.warning") {
        setWarnings((current) => {
          const merged = [...current, ...snapshot.warnings];
          return merged.filter(
            (warning, index) =>
              merged.findIndex(
                (candidate) =>
                  candidate.code === warning.code &&
                  candidate.message === warning.message,
              ) === index,
          );
        });
      }
      if (payload.coverage && typeof payload.coverage === "object") {
        setCoverage(snapshot.coverage);
      }
      const nextBudget = normalizeResearchBudget(payload.budget);
      if (nextBudget) setBudget(nextBudget);
    }
    if (event.type === "run.usage") {
      const nextUsage = normalizeChatTokenUsage(payload);
      if (nextUsage) {
        usageRef.current = nextUsage;
        setUsage(nextUsage);
      }
    }
    if (event.type === "run.result" && typeof payload.result === "string") {
      resultRef.current = payload.result;
      setResult(payload.result);
    }
    if (event.type === "run.failed") {
      const code = typeof payload.error === "string" ? payload.error : null;
      const message =
        (code && ERROR_TEXT[code]) ??
        (typeof payload.message === "string" ? payload.message : "The run failed.");
      failureRef.current = message;
      setFailure(message);
    }
    if (event.type.startsWith("run.") && event.type !== "run.started" && event.type !== "run.status") {
      if (TERMINAL_STATUSES.has(event.type.replace("run.", ""))) {
        const outcome = event.type.replace("run.", "") as ExternalAgentTerminalResult["outcome"];
        const terminalUsage = normalizeChatTokenUsage(payload.usage);
        if (terminalUsage) {
          usageRef.current = terminalUsage;
          setUsage(terminalUsage);
        }
        setNote(null);
        setProgress((current) =>
          current ? { ...current, currentQuery: undefined } : current,
        );
        setStatus(outcome);
        eventSourceRef.current?.close();
        if (!reportedTerminalRef.current) {
          reportedTerminalRef.current = true;
          const content =
            outcome === "completed"
              ? resultRef.current ?? "Research completed."
              : outcome === "aborted"
                ? failureRef.current ?? "Research was aborted."
                : failureRef.current ?? "The research run failed.";
          if (outcome === "completed") notifyTaskCompleted(query);
          onTerminalRef.current?.({
            outcome,
            content,
            ...(usageRef.current ? { usage: usageRef.current } : {}),
          });
        }
      }
    }
  }, [query]);

  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running" && persistedContent) {
      // The report itself is stored on the conversation row, while the richer
      // evidence ledger lives in the sidecar's durable event log. Replay that
      // ledger once after a transcript reload; failure is non-fatal because the
      // persisted report remains the canonical visible result.
      reportedTerminalRef.current = true;
      void fetch(`${base}/events?since=0`, {
        headers: { accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) return;
          const data = (await response.json().catch(() => null)) as {
            events?: RunEvent[];
          } | null;
          for (const event of data?.events ?? []) applyEvent(event);
        })
        .catch(() => undefined);
      return;
    }
    const eventSource = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    eventSource.onmessage = handle;
    STREAMED_EVENT_TYPES.forEach((type) =>
      eventSource.addEventListener(type, handle as EventListener),
    );
    // A reopened transcript still shows this card, but the run it points at may
    // be gone (the service holds runs in memory and expires them). EventSource
    // would silently retry forever and look like a stuck run, so ask the route
    // once what actually happened and say so.
    eventSource.onerror = () => {
      void (async () => {
        try {
          const response = await fetch(`${base}/events?since=0`);
          if (response.ok) {
            const data = (await response.json().catch(() => null)) as {
              events?: RunEvent[];
            } | null;
            // The fallback is also a real event read. A terminal frame can land
            // here while EventSource is reconnecting, so consume it instead of
            // leaving the transcript marked as running.
            for (const event of data?.events ?? []) applyEvent(event);
            return;
          }
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          eventSource.close();
          const message =
            data.error === "run_not_found"
              ? "This run is no longer available — the research service restarted or the run expired."
              : ERROR_TEXT[data.error ?? ""] ?? "The research service is not reachable.";
          failureRef.current = message;
          setStatus("failed");
          setFailure(message);
          // Giving up locally is not enough. The durable turn still says
          // "running", which keeps the conversation locked and — for a
          // delegated run, whose card is hidden — leaves the person looking at
          // an answer that simply never continues. Report the terminal outcome
          // the same way a `run.failed` frame would, so the turn is written as
          // failed and a delegation hands back to the Super Agent.
          if (!reportedTerminalRef.current) {
            reportedTerminalRef.current = true;
            onTerminalRef.current?.({
              outcome: "failed",
              content: message,
              ...(usageRef.current ? { usage: usageRef.current } : {}),
            });
          }
        } catch {
          /* offline: leave the stream retrying */
        }
      })();
    };
    eventSourceRef.current = eventSource;
    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [base, applyEvent, persistedContent, persistedOutcome]);

  // Runs take minutes; a counter is the difference between "working" and "stuck".
  useEffect(() => {
    if (TERMINAL_STATUSES.has(status)) return;
    const started = Date.now();
    const timer = setInterval(
      () => setElapsedSeconds(Math.round((Date.now() - started) / 1000)),
      1_000,
    );
    return () => clearInterval(timer);
  }, [status]);

  const stop = async () => {
    if (stopPendingRef.current) return;
    stopPendingRef.current = true;
    setStopPending(true);
    setError(null);
    try {
      const response = await fetch(`${base}/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = (await response.json().catch(() => null)) as {
        run?: {
          status?: "running" | "completed" | "failed" | "aborted";
          lastSequence?: number;
          completedAt?: string;
          result?: string;
          failure?: { code?: string; message?: string };
          usage?: Record<string, unknown>;
        };
      } | null;
      if (!response.ok || !data?.run) throw new Error(String(response.status));
      const run = data.run;
      if (run.result) {
        applyEvent({
          sequenceNumber: run.lastSequence ?? 0,
          type: "run.result",
          at: run.completedAt ?? new Date().toISOString(),
          payload: { result: run.result },
        });
      }
      if (run.status && run.status !== "running") {
        applyEvent({
          sequenceNumber: run.lastSequence ?? 0,
          type: `run.${run.status}`,
          at: run.completedAt ?? new Date().toISOString(),
          payload: {
            ...(run.failure?.code ? { error: run.failure.code } : {}),
            ...(run.failure?.message ? { message: run.failure.message } : {}),
            ...(run.usage ? { usage: run.usage } : {}),
          },
        });
      }
      if (run.status === "running") {
        setNote("Stopping after the current step…");
      }
    } catch (cause) {
      stopPendingRef.current = false;
      setStopPending(false);
      setError((cause as Error).message);
    }
  };

  const terminal = TERMINAL_STATUSES.has(status);
  const terminalContent =
    result?.trim() ||
    failure?.trim() ||
    (status === "aborted"
      ? "Research was aborted."
      : status === "failed"
        ? "The research run failed."
        : "Research completed.");
  const statusDot = terminal
    ? status === "completed"
      ? "bg-[var(--botanical)]"
      : "bg-[var(--danger)]"
    : "animate-pulse bg-[var(--botanical-2)]";

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        responseDurationMs={
          !terminal || elapsedSeconds > 0 ? elapsedSeconds * 1_000 : undefined
        }
        usage={usage}
        agentName="Deep Research"
      />
      <div className="bb-agent-run-card overflow-hidden">
      {/* The query is the user's own message directly above this card, so the
          header carries the agent and its state and leaves the rest alone. */}
      <div className="bb-agent-run-header">
        <span className="bb-agent-run-title truncate">Deep Research</span>
        <div className="flex shrink-0 items-center gap-[8px]">
          <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
            <span className={`bb-agent-run-led h-1.5 w-1.5 ${statusDot}`} />
            {terminal ? status : `researching · ${formatDuration(elapsedSeconds)}`}
          </span>
          {!terminal && (
            <button
              type="button"
              onClick={stop}
              disabled={stopPending}
              aria-busy={stopPending}
              className="bb-agent-run-action inline-flex items-center gap-1.5 disabled:cursor-wait disabled:opacity-55"
            >
              {stopPending ? <StopSpinner /> : null}
              {stopPending ? "Stopping" : "Stop"}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-[13px] p-[21px]">
        {/* How much reading this answer stands on. The tally stays after the run
            finishes — it is what tells you how far the report actually reached. */}
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(89px,1fr))] gap-x-[21px] gap-y-[13px]">
          {(
            [
              [
                "Progress",
                terminal
                  ? status === "completed"
                    ? "Complete"
                    : status === "aborted"
                      ? "Stopped"
                      : "Failed"
                  : progress
                    ? `Round ${progress.totalDepth - progress.currentDepth + 1}/${progress.totalDepth}`
                    : "Planning",
              ],
              [
                "Searches",
                progress ? `${progress.completedQueries}/${progress.totalQueries}` : "—",
              ],
              ["Learnings", learnings.length ? String(learnings.length) : "—"],
              ["Sources", sources.length ? String(sources.length) : "—"],
              [
                "Cited claims",
                coverage?.totalClaims
                  ? `${coverage.citedClaims}/${coverage.totalClaims}`
                  : evidence.length
                    ? String(evidence.filter((item) => item.sourceIds.length > 0).length)
                    : "—",
              ],
              [
                "Processed",
                budget?.tokens ? `${Math.round(budget.tokens / 1_000)}k tokens` : "—",
              ],
            ] as Array<[string, string]>
          ).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="bb-agent-run-label">{label}</dt>
              <dd className="text-[13px] font-medium leading-[1.4] text-[var(--ink-heading)]">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {!terminal && (progress?.currentQuery || note) ? (
          <p className="bb-agent-run-text break-words text-[var(--ink-muted)]">
            {progress?.currentQuery ? `Searching: ${progress.currentQuery}` : note}
          </p>
        ) : null}

        {failure && <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p>}
        {error && <p className="bb-agent-run-text text-[var(--danger)]">{error}</p>}

        {warnings.length > 0 && (
          <div className="bb-agent-run-inset space-y-[5px] p-[13px]" role="status">
            <p className="bb-agent-run-label">Partial coverage</p>
            {warnings.map((warning) => (
              <p
                key={`${warning.code}-${warning.message}`}
                className="bb-agent-run-text text-[var(--ink-muted)]"
              >
                {warning.message}
              </p>
            ))}
          </div>
        )}

        {learnings.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowLearnings((open) => !open)}
              className="bb-agent-run-action"
              aria-expanded={showLearnings}
            >
              {showLearnings ? "Hide" : "Show"} what it learned ({learnings.length})
            </button>
            {showLearnings && (
              <ul className="bb-agent-run-inset mt-[8px] space-y-[8px] p-[13px]">
                {learnings.map((learning, index) => (
                  <li
                    key={`${index}-${learning.slice(0, 24)}`}
                    className="bb-agent-run-text text-[var(--ink-muted)]"
                  >
                    {learning}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {evidence.length > 0 && (
          <details>
            <summary className="bb-agent-run-label cursor-pointer hover:text-[var(--ink)]">
              Evidence ({evidence.length} claims)
            </summary>
            <ul className="bb-agent-run-inset mt-[8px] space-y-[8px] p-[13px]">
              {evidence.map((item) => (
                <li key={item.id} className="bb-agent-run-text text-[var(--ink-muted)]">
                  {item.claim}
                  {item.sourceIds.length > 0 ? (
                    <span className="ml-1 text-[var(--botanical)]">
                      [{item.sourceIds.join(", ")}]
                    </span>
                  ) : (
                    <span className="ml-1 text-[var(--danger)]">[uncited]</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* The report is the card's content, so it is printed on the card
            itself rather than inside a second sheet. */}
        {result ? (
          <div className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
            <ChatMarkdown content={result} compact />
          </div>
        ) : null}
        {terminal && !result && !failure ? (
          <p className="bb-agent-run-text text-[var(--ink-muted)]">{terminalContent}</p>
        ) : null}

        {sources.length > 0 && (
          <details>
            <summary className="bb-agent-run-label cursor-pointer hover:text-[var(--ink)]">
              Sources ({sources.length})
            </summary>
            <ul className="mt-[8px] space-y-[5px]">
              {sources.map((source) => (
                <li key={source.id} className="truncate text-[11px] leading-[1.618]">
                  <a href={source.url} target="_blank" rel="noreferrer" className="text-[var(--botanical)] hover:underline">
                    [{source.id}] {source.title || source.url}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      </div>
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
