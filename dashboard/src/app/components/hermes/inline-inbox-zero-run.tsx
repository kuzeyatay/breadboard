"use client";

import { externalRunStartedAtMs } from "./external-run-clock";

// The Inbox Zero run card.
//
// Every other run card is built around its answer. This one is built around the
// answer *and the list of things it touched*, because this is the only agent
// here that can archive, label, reply and send from someone's real address. A
// run that says "cleaned up your newsletters" without showing what it acted on
// is asking to be trusted; showing the trail is how it earns it.
//
// The setup states get first-class treatment for the same reason a wrong answer
// is worse than no answer: the four ways this agent cannot start — no clone, no
// container engine, no OAuth client, no connected mailbox — are all things the
// person can fix, and each is rendered as the next step rather than as an error.
//
// Styling uses the shared run material (bb-agent-run-*) so this reads as the
// same object as every other external-agent run.

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import { closeAgentRunStream, resolveAgentRunStreamError } from "@/lib/agent-run-stream";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface Action {
  key: number;
  tool: string;
  detail: string;
}

const STAGES = [
  { key: "connecting", label: "Opening your mailbox" },
  { key: "working", label: "Working through the mail" },
  { key: "answering", label: "Writing it up" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

const STREAMED_EVENT_TYPES = [
  "run.started",
  "run.connecting",
  "run.connected",
  "run.setup_required",
  "run.stage",
  "run.text",
  "run.action",
  "run.action_result",
  "run.error",
  "run.completed",
  "run.failed",
  "run.aborted",
];

const TERMINAL = new Set(["completed", "failed", "aborted"]);

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function formatElapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${String(rounded % 60).padStart(2, "0")}s` : `${rounded}s`;
}

export default function InlineInboxZeroRun({
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
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "connecting",
  );
  const [stage, setStage] = useState<StageKey>("connecting");
  const [mailbox, setMailbox] = useState("");
  const [answer, setAnswer] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [setupUrl, setSetupUrl] = useState("");
  const [actions, setActions] = useState<Action[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const onTerminalRef = useRef(onTerminal);
  const reportedRef = useRef(false);
  // Stamped in the effect below rather than here: reading the clock during
  // render is impure, and a re-render would move the run's start time.
  const startedRef = useRef(0);
  const base = `/api/inbox-zero/runs/${runId}`;
  const replaying = Boolean(
    persistedOutcome && persistedOutcome !== "running" && persistedContent,
  );

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedRef.current = false;
    startedRef.current = externalRunStartedAtMs(runId);
    setElapsed(Math.max(0, (Date.now() - startedRef.current) / 1_000));
  }, [runId]);

  const reportTerminal = useCallback(
    (outcome: "completed" | "failed" | "aborted", content: string) => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      if (outcome === "completed") notifyTaskCompleted(`Inbox Zero — ${task.slice(0, 80)}`);
      onTerminalRef.current?.({ outcome, content });
    },
    [task],
  );

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      switch (event.type) {
        case "run.started":
          setStatus("running");
          break;
        case "run.connected":
          setMailbox(asString(payload.mailbox));
          break;
        case "run.setup_required":
          // The one place a URL is offered: the step the person completes in
          // Inbox Zero's own browser window, which nothing here can do for them.
          setSetupUrl(asString(payload.url));
          break;
        case "run.stage": {
          const next = asString(payload.stage);
          if (STAGES.some((item) => item.key === next)) setStage(next as StageKey);
          break;
        }
        case "run.text":
          // Assembled here rather than waiting for the terminal event, so a long
          // turn reads as it is written.
          setAnswer((current) => current + asString(payload.delta));
          break;
        case "run.action":
          setActions((current) =>
            current.length >= 100
              ? current
              : [
                  ...current,
                  {
                    key: event.sequenceNumber,
                    tool: asString(payload.tool),
                    detail: asString(payload.detail),
                  },
                ],
          );
          break;
        case "run.completed": {
          const content = asString(payload.content);
          setStatus("completed");
          if (content) setAnswer(content);
          reportTerminal("completed", content);
          break;
        }
        case "run.failed":
        case "run.aborted": {
          const outcome = event.type === "run.aborted" ? "aborted" : "failed";
          const message =
            asString(payload.content) ||
            (outcome === "aborted" ? "The run was stopped." : "The Inbox Zero run failed.");
          setStatus(outcome);
          setFailure(message);
          reportTerminal(outcome, message);
          break;
        }
        default:
          break;
      }
    },
    [reportTerminal],
  );

  useEffect(() => {
    // A finished run is gone from the manager's memory and its endpoint answers
    // with an error, so a replayed turn must never open a stream.
    if (replaying) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // Ignore malformed frames and keep the rest of the stream usable.
      }
    };
    STREAMED_EVENT_TYPES.forEach((type) =>
      source.addEventListener(type, handle as EventListener),
    );
    // EventSource reconnects on error by default, forever. Closing here is what
    // keeps a restored turn from hammering a dead endpoint.
    source.onerror = () => {
      resolveAgentRunStreamError({
        source,
        base,
        replayEnding: applyEvent,
        onUnavailable: (reason) => {
          setStatus("failed");
          setFailure(
            reason === "run_not_found"
              ? "This run is no longer live, but its saved result remains below."
              : "The Inbox Zero event stream is unavailable.",
          );
        },
      });
    };
    return () => closeAgentRunStream(source);
  }, [applyEvent, base, replaying]);

  const terminal = TERMINAL.has(status);

  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedRef.current) / 1_000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [terminal]);

  const activeStageIndex = STAGES.findIndex((item) => item.key === stage);
  const terminalContent =
    answer.trim() ||
    failure.trim() ||
    (status === "aborted" ? "The run was stopped." : "The run finished.");

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        agentName="Inbox Zero"
        responseDurationMs={!terminal || elapsed > 0 ? elapsed * 1_000 : undefined}
        summary={STAGES[activeStageIndex]?.label}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title min-w-0 truncate">
            Inbox Zero
            {mailbox ? (
              <span className="ml-[8px] font-mono text-[11px] font-normal text-[var(--ink-muted)]">
                {mailbox}
              </span>
            ) : null}
          </p>
          <div className="flex shrink-0 items-center gap-[8px]">
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
                : `${STAGES[activeStageIndex]?.key ?? "working"} · ${formatElapsed(elapsed)}`}
            </span>
            {!terminal ? (
              <button
                type="button"
                className="bb-agent-run-action"
                onClick={() => {
                  void fetch(`${base}/abort`, { method: "POST" }).catch(() => undefined);
                }}
              >
                Stop
              </button>
            ) : null}
          </div>
        </header>

        <div className="space-y-[13px] p-[21px]">
          {/* A first run starts the mail app's containers, which takes long
              enough that an empty card reads as a hang. Say what it is doing. */}
          {!terminal && !answer && !actions.length ? (
            <ol className="space-y-[5px]">
              {STAGES.map((item, index) => {
                const state =
                  index < activeStageIndex
                    ? "done"
                    : index === activeStageIndex
                      ? "active"
                      : "pending";
                return (
                  <li key={item.key} className="flex items-center gap-[8px]">
                    <span
                      className={`bb-agent-run-led h-1.5 w-1.5 ${
                        state === "done"
                          ? "bg-[var(--botanical)]"
                          : state === "active"
                            ? "animate-pulse bg-[var(--botanical-2)]"
                            : "bg-[color-mix(in_srgb,var(--line)_80%,transparent)]"
                      }`}
                    />
                    <span
                      className={`text-[11px] leading-[1.4] ${
                        state === "pending"
                          ? "text-[var(--ink-muted)]"
                          : "text-[var(--ink-heading)]"
                      }`}
                    >
                      {item.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {actions.length ? (
            <section className="bb-agent-run-panel p-[13px]">
              <p className="bb-agent-run-label mb-[8px]">
                Touched your mailbox · {actions.length}
              </p>
              <ul className="space-y-[5px]">
                {actions.map((action) => (
                  <li key={action.key} className="bb-agent-run-row p-[8px]">
                    <span className="block truncate text-[11px] leading-[1.4] text-[var(--ink-heading)]">
                      {action.detail || action.tool}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {answer ? (
            <section className="bb-agent-run-text">
              <ChatMarkdown content={answer} compact />
            </section>
          ) : null}

          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}

          {setupUrl ? (
            <a
              className="bb-agent-run-action inline-flex"
              href={setupUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open Inbox Zero
            </a>
          ) : null}
        </div>
      </div>
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
