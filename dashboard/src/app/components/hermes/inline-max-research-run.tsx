"use client";

// The Max Research card.
//
// A run here is measured in tens of minutes, so the card's real job is not the
// answer at the end — it is making a long silence legible while it works. What
// it shows is the roster: which of the six were commissioned, why each, and
// where each one currently stands. A run that says nothing for forty minutes is
// indistinguishable from one that has died, and the difference matters most
// exactly when the wait is longest.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { externalRunStartedAtMs } from "./external-run-clock";

type ParticipantState =
  | "planned"
  | "running"
  | "completed"
  | "failed"
  | "unavailable"
  | "aborted";

interface ParticipantRow {
  participant: string;
  rationale: string;
  state: ParticipantState;
  reason?: string;
  pages?: number;
  artifacts?: number;
}

const LABEL: Record<string, string> = {
  deep_research: "Deep Research",
  agent_reach: "Agent Reach",
  get_doc: "Get Doc",
  openscience: "OpenScience",
  praxist: "Praxist",
  aris: "ARIS",
};

const STATE_TEXT: Record<ParticipantState, string> = {
  planned: "queued",
  running: "working",
  completed: "done",
  failed: "failed",
  unavailable: "unavailable",
  aborted: "stopped",
};

/**
 * The run's position in a few words, for a label rather than a card: who is
 * still working once the plan is known, otherwise the stage itself.
 */
export function describeStage(
  stage: string,
  participants: readonly Pick<ParticipantRow, "participant" | "state">[],
): string {
  const working = participants
    .filter((row) => row.state === "planned" || row.state === "running")
    .map((row) => LABEL[row.participant] ?? row.participant);
  if (stage === "Commissioned" && working.length) {
    return `${working.join(", ")} working`;
  }
  return stage;
}

export default function InlineMaxResearchRun({
  runId,
  query,
  persistedContent = "",
  persistedOutcome,
  persistedUsage,
  persistedDurationMs,
  onTerminal,
  onRetry,
  onStage,
}: {
  runId: string;
  query: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  persistedUsage?: ChatTokenUsage;
  persistedDurationMs?: number;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
  /**
   * Where the run is, in a few words, for a surface that hides this card. A
   * delegated run draws nothing of its own, so without this the row that
   * launched it shows the same label for the whole hour it can take.
   */
  onStage?: (stage: string) => void;
}) {
  const terminalAtMount =
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : null;
  const [status, setStatus] = useState<string>(terminalAtMount ?? "running");
  const [stage, setStage] = useState<string>("Starting");
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [answer, setAnswer] = useState<string | null>(
    persistedOutcome === "completed" ? persistedContent || null : null,
  );
  const [failure, setFailure] = useState<string | null>(
    persistedOutcome === "failed" || persistedOutcome === "aborted"
      ? persistedContent || null
      : null,
  );
  const startedAtMs = useMemo(() => externalRunStartedAtMs(runId), [runId]);
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - startedAtMs) / 1_000)),
  );
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(Boolean(terminalAtMount));

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  const onStageRef = useRef(onStage);
  useEffect(() => {
    onStageRef.current = onStage;
  }, [onStage]);
  useEffect(() => {
    if (!onStageRef.current || terminalAtMount) return;
    onStageRef.current(
      status === "running" ? describeStage(stage, participants) : "",
    );
  }, [stage, participants, status, terminalAtMount]);

  const settle = useCallback(
    (outcome: ExternalAgentOutcome, content: string) => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      onTerminalRef.current?.({ outcome, content } as ExternalAgentTerminalResult);
    },
    [],
  );

  // Subscribed, not polled, like every other card here — and it closes on
  // error rather than reconnecting. A run the manager has already evicted
  // answers with a 404, and without `onerror` the browser would keep reaching
  // for it for as long as the transcript stayed on screen.
  useEffect(() => {
    if (terminalAtMount) return;

    const applyEvent = (type: string, payload: Record<string, unknown>) => {
      if (type === "plan.completed" && Array.isArray(payload.participants)) {
        setParticipants(
          (payload.participants as Array<Record<string, unknown>>).map((entry) => ({
            participant: String(entry.participant ?? ""),
            rationale: String(entry.rationale ?? ""),
            state: "planned" as ParticipantState,
          })),
        );
        setStage("Commissioned");
      }
      if (type === "participant.unavailable") {
        const name = String(payload.participant ?? "");
        setParticipants((rows) =>
          rows.map((row) =>
            row.participant === name
              ? { ...row, state: "unavailable", reason: String(payload.reason ?? "") }
              : row,
          ),
        );
      }
      if (type === "participant.started") {
        const name = String(payload.participant ?? "");
        setStage("Researching");
        setParticipants((rows) =>
          rows.map((row) =>
            row.participant === name ? { ...row, state: "running" } : row,
          ),
        );
      }
      if (type === "participant.settled") {
        const name = String(payload.participant ?? "");
        setParticipants((rows) =>
          rows.map((row) =>
            row.participant === name
              ? {
                  ...row,
                  state: (payload.status as ParticipantState) ?? "completed",
                  ...(payload.reason ? { reason: String(payload.reason) } : {}),
                  ...(Array.isArray(payload.websites)
                    ? { pages: payload.websites.length }
                    : {}),
                  ...(Array.isArray(payload.artifacts)
                    ? { artifacts: payload.artifacts.length }
                    : {}),
                }
              : row,
          ),
        );
      }
      if (type === "synthesis.started") setStage("Reconciling the findings");
      if (type === "run.completed") {
        const result = typeof payload.result === "string" ? payload.result : "";
        setAnswer(result);
        setStatus("completed");
        setStage("Done");
        settle("completed", result);
      }
      if (type === "run.failed") {
        const error = String(payload.error ?? "The run failed.");
        setFailure(error);
        setStatus("failed");
        settle("failed", error);
      }
      if (type === "run.aborted") {
        setStatus("aborted");
        setFailure("Stopped.");
        settle("aborted", "Stopped.");
      }
    };

    const eventSource = new EventSource(`/api/max-research/runs/${runId}/events`);
    const listen = (type: string) =>
      eventSource.addEventListener(type, (event) => {
        try {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as {
            type?: string;
            payload?: Record<string, unknown>;
          };
          applyEvent(parsed.type ?? type, parsed.payload ?? {});
        } catch {
          // A frame that will not parse is skipped; the next one carries the
          // same state, because every payload here is absolute rather than a
          // delta.
        }
      });
    for (const type of [
      "plan.completed",
      "participant.unavailable",
      "participant.started",
      "participant.settled",
      "synthesis.started",
      "run.completed",
      "run.failed",
      "run.aborted",
    ]) {
      listen(type);
    }
    eventSource.onerror = () => {
      eventSource.close();
    };
    return () => eventSource.close();
  }, [runId, settle, terminalAtMount]);

  useEffect(() => {
    if (status !== "running") return;
    const update = () =>
      setSeconds(
        Math.max(
          0,
          Math.floor((Date.now() - startedAtMs) / 1_000),
        ),
      );
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [startedAtMs, status]);

  // Stopping lives on the composer, which reaches this same
  // `/api/max-research/runs/<id>/abort` endpoint through
  // `externalAgentAbortUrls`. A second copy here would be a second control to
  // keep in step with it for no gain.

  const done = status !== "running";
  const settled = participants.filter(
    (row) => row.state !== "planned" && row.state !== "running",
  ).length;

  return (
    <>
      <AssistantResponseMeta
        active={!done}
        failed={done && status !== "completed"}
        label={status === "aborted" ? "Stopped" : undefined}
        totalTokens={
          persistedUsage ? persistedUsage.inputTokens + persistedUsage.outputTokens : undefined
        }
        responseDurationMs={
          done && persistedDurationMs !== undefined
            ? persistedDurationMs
            : !done || seconds > 0
              ? seconds * 1_000
              : undefined
        }
        // No summary. The card's own header already carries the stage and the
        // clock, and passing it here printed the same word again on a line of
        // its own between the thinking row and the card.
        agentName="Max Research"
      />
      <div className="bb-agent-run-card overflow-hidden">
        {/* The question is the user's own message directly above this card, so
            the header carries the agent and its state rather than repeating it. */}
        <header className="bb-agent-run-header">
          <p
            className="bb-agent-run-title min-w-0 justify-self-start truncate text-left"
            title={query}
          >
            Max Research
          </p>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span
                aria-hidden="true"
                className={`bb-agent-run-led h-1.5 w-1.5 ${
                  status === "completed"
                    ? "bg-[var(--botanical)]"
                    : done
                      ? "bg-[var(--danger)]"
                      : "animate-pulse bg-[var(--botanical-2)]"
                }`}
              />
              {status !== "aborted" ? (
                <>
                {done
                  ? STATE_TEXT[status as ParticipantState] ?? status
                  : stage.toLowerCase()}
                </>
              ) : null}
            </span>
            {/* No Stop here. One conversation has one stop control and it is
                the composer's, which already knows about every run in the
                transcript; a second one on the card is a second thing to find
                and a second thing to keep in step. */}
          </div>
        </header>

        <div className="space-y-[13px] p-[21px]">
          {/* The roster. Five agents working for tens of minutes is the whole
              reason this card exists: it is what makes a long silence legible. */}
          <section>
            <p className="bb-agent-run-label mb-[8px]">
              Agents
              {participants.length ? ` · ${settled}/${participants.length}` : ""}
            </p>
            {participants.length ? (
              <ol className="max-h-64 space-y-[5px] overflow-y-auto pr-1">
                {participants.map((row) => (
                  <li key={row.participant} className="bb-agent-run-row p-[8px]">
                    <div className="flex items-center gap-[8px]">
                      <span
                        className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                          row.state === "running"
                            ? "animate-pulse bg-[var(--botanical-2)]"
                            : row.state === "completed"
                              ? "bg-[var(--botanical)]"
                              : row.state === "planned"
                                ? "bg-[var(--ink-muted)]"
                                : "bg-[var(--danger)]"
                        }`}
                      />
                      <span className="truncate font-mono text-[11px] leading-[1.618] text-[var(--ink-heading)]">
                        {LABEL[row.participant] ?? row.participant}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] leading-[1.618] text-[var(--ink-muted)]">
                        {STATE_TEXT[row.state]}
                        {row.pages ? ` · ${row.pages} pages` : ""}
                        {row.artifacts ? ` · ${row.artifacts} saved` : ""}
                      </span>
                    </div>
                    <p
                      className={`bb-agent-run-text mt-[5px] line-clamp-2 ${
                        row.state === "failed" || row.state === "unavailable"
                          ? "text-[var(--danger)]"
                          : "text-[var(--ink-muted)]"
                      }`}
                    >
                      {row.reason || row.rationale}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="bb-agent-run-text text-[var(--ink-muted)]">
                {/* The usable roster is not known until every candidate's live
                    runtime check finishes. Name no agent before that result;
                    plan.completed replaces this with the exact selected roster. */}
                Checking which research agents are available…
              </p>
            )}
          </section>

          {answer ? (
            <section className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]">
              <ChatMarkdown content={answer} compact />
            </section>
          ) : failure && status !== "aborted" ? (
            <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p>
          ) : null}
        </div>
      </div>
      {done ? (
        <AssistantMessageActions content={answer ?? failure ?? ""} onRetry={onRetry} />
      ) : null}
    </>
  );
}
