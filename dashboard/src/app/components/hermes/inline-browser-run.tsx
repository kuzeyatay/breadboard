"use client";

// In-chat Agent TARS run workspace. Rendered inside the conversation transcript
// for an assistant message flagged as an Agent TARS run. It connects to the
// already-created run's SSE stream and shows the live screenshot, a step
// timeline, and inline approve/reject — the same surface as the standalone
// operator, sized for the chat column.
//
// The run is created by the host (the terminal) before this mounts; this
// component only observes and decides on approvals. It never sees provider
// secrets — every call goes through the authenticated /api/ui-tars routes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AgentTarsScreenshotGallery from "@/app/components/agent-tars-screenshot-gallery";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import { useYoloMode } from "@/app/components/use-yolo-mode";
import { normalizeChatTokenUsage } from "@/lib/chat-token-usage";
import { appendBoundedAgentRunEvent } from "@/lib/agent-run-history";
import { agentTarsFailureMessage } from "@/lib/ui-tars/identity.ts";
import { agentTarsChatResponse, safeAgentTarsMessage } from "@/lib/ui-tars/chat-response.ts";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

interface PendingApproval {
  actionId: string;
  action: string;
  target: string;
  explanation: string;
  risk: string;
  requestedAt: string;
  expiresAt: string;
}

const RISK_STYLE: Record<string, string> = {
  high: "text-[var(--danger)]",
  medium: "text-[#8a6f00]",
  low: "text-[var(--botanical)]",
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted", "runtime_lost"]);

interface Step {
  key: number;
  title: string;
  detail?: string;
  failed?: boolean;
}

function cleanText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  return text || undefined;
}

// Turn a raw run event into a human step for the vertical activity list.
// Noise (screenshots, usage, run.started/terminal frames) returns null — the
// live screenshot and the final summary already cover those.
function describeStep(event: RunEvent): Step | null {
  const p = event.payload as Record<string, unknown>;
  const key = event.sequenceNumber;
  switch (event.type) {
    case "run.status": {
      const message = safeAgentTarsMessage(p.message);
      return message ? { key, title: message } : null;
    }
    case "agent.thinking":
      // No detail field under a thinking step — just the beat itself.
      return { key, title: "Thinking" };
    case "observation.page":
      return { key, title: "Opened page", detail: cleanText(p.url ?? p.title) };
    case "action.proposed": {
      const action = cleanText(p.action);
      return {
        key,
        title: action ? action[0].toUpperCase() + action.slice(1) : "Action",
        detail: cleanText(p.target),
      };
    }
    case "action.completed":
      return { key, title: "Completed step", detail: cleanText(p.summary) };
    case "action.failed":
      return {
        key,
        title: "Step failed",
        detail: cleanText(safeAgentTarsMessage(p.error ?? p.message)),
        failed: true,
      };
    case "approval.requested":
      return {
        key,
        title: "Approval requested",
        detail: cleanText(`${p.action ?? ""} ${p.target ?? ""}`.trim()),
      };
    case "approval.approved":
      return { key, title: "Approved" };
    case "approval.rejected":
      return { key, title: "Rejected" };
    default:
      return null;
  }
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "run.status",
  "agent.thinking",
  "agent.usage",
  "observation.page",
  "observation.screenshot",
  "action.proposed",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "action.started",
  "action.completed",
  "action.failed",
  "run.completed",
  "run.failed",
  "run.aborted",
  "runtime.disconnected",
];

export default function InlineBrowserRun({
  agentId,
  runId,
  task,
  persistedContent = "",
  persistedOutcome,
  onTerminal,
  onRetry,
}: {
  agentId: string;
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
  const [status, setStatus] = useState<string>(
    persistedOutcome && persistedOutcome !== "running"
      ? persistedOutcome
      : "starting",
  );
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [controlsDesktop, setControlsDesktop] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [yoloMode] = useYoloMode();
  const esRef = useRef<EventSource | null>(null);
  const seqRef = useRef(0);
  const onTerminalRef = useRef(onTerminal);
  const reportedTerminalRef = useRef(false);

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedTerminalRef.current = false;
  }, [runId]);

  const applyEvent = useCallback((event: RunEvent) => {
    seqRef.current = Math.max(seqRef.current, event.sequenceNumber);
    setEvents((previous) => appendBoundedAgentRunEvent(previous, event));
    if (event.type === "run.started") {
      setControlsDesktop(event.payload.operator === "computer");
    }
    if (event.type === "observation.page") {
      const url = (event.payload as { url?: string }).url;
      if (url) setPageUrl(url);
    }
    if (event.type === "approval.requested") {
      setPending(event.payload as unknown as PendingApproval);
    }
    if (event.type === "approval.approved" || event.type === "approval.rejected") {
      setPending(null);
    }
    if (["run.completed", "run.failed", "run.aborted", "runtime.disconnected"].includes(event.type)) {
      setPending(null);
    }
    if (event.type === "run.completed" && agentTarsFailureMessage(event.payload.summary)) {
      setStatus("failed");
    } else if (event.type === "run.started") {
      setStatus("running");
    } else if (["run.completed", "run.failed", "run.aborted"].includes(event.type)) {
      setStatus(event.type.replace("run.", ""));
    }
    if (event.type === "runtime.disconnected") setStatus("runtime_lost");
    if (
      !reportedTerminalRef.current &&
      ["run.completed", "run.failed", "run.aborted", "runtime.disconnected"].includes(event.type)
    ) {
      esRef.current?.close();
      esRef.current = null;
      reportedTerminalRef.current = true;
      const failedCompletion =
        event.type === "run.completed" &&
        Boolean(agentTarsFailureMessage(event.payload.summary));
      const outcome: ExternalAgentTerminalOutcome =
        event.type === "run.completed" && !failedCompletion
          ? "completed"
          : event.type === "run.aborted"
            ? "aborted"
            : "failed";
      if (outcome === "completed") notifyTaskCompleted(task);
      onTerminalRef.current?.({
        outcome,
        content: agentTarsChatResponse([event]),
      });
    }
  }, [task]);

  useEffect(() => {
    // A finished turn already carries its result, and its run is long gone from
    // the run manager's memory. Opening a stream for it would leave an
    // EventSource retrying a dead endpoint for as long as the transcript is on
    // screen — once per restored card.
    if (persistedOutcome && persistedOutcome !== "running" && persistedContent) return;
    const eventSource = new EventSource(`/api/ui-tars/agents/${agentId}/runs/${runId}/events?since=0`);
    eventSource.onmessage = (message) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    STREAMED_EVENT_TYPES.forEach((type) => {
      eventSource.addEventListener(type, (message) => {
        try {
          applyEvent(JSON.parse((message as MessageEvent).data) as RunEvent);
        } catch {
          /* ignore malformed frame */
        }
      });
    });
    // A run that has already been cleaned up answers with an error rather than a
    // stream; without this the browser reconnects to it forever.
    eventSource.onerror = () => {
      eventSource.close();
      esRef.current = null;
    };
    esRef.current = eventSource;
    return () => {
      eventSource.close();
      esRef.current = null;
    };
  }, [agentId, runId, applyEvent, persistedContent, persistedOutcome]);

  const decide = useCallback(async (kind: "approve" | "reject") => {
    if (!pending || deciding) return;
    setDeciding(true);
    try {
      const response = await fetch(`/api/ui-tars/agents/${agentId}/runs/${runId}/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId: pending.actionId }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setPending(null);
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setDeciding(false);
    }
  }, [agentId, deciding, pending, runId]);

  useEffect(() => {
    if (!yoloMode || !pending || deciding) return;
    void decide("approve");
  }, [decide, deciding, pending, yoloMode]);

  const stop = async () => {
    try {
      await fetch(`/api/ui-tars/agents/${agentId}/runs/${runId}/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } catch (error) {
      setErr((error as Error).message);
    }
  };

  const terminal = TERMINAL_STATUSES.has(status);
  const streamedResponse = useMemo(() => agentTarsChatResponse(events), [events]);
  const response =
    terminal && persistedContent
      ? persistedContent
      : streamedResponse || persistedContent;
  const terminalContent =
    response.trim() ||
    (status === "aborted"
      ? "Agent TARS task stopped."
      : status === "failed" || status === "runtime_lost"
        ? "Agent TARS could not complete the task."
        : "Agent TARS completed the task.");
  const usage = useMemo(
    () =>
      normalizeChatTokenUsage(
        events.findLast((event) => event.type === "agent.usage")?.payload,
      ),
    [events],
  );
  const latestThinking = events.findLast(
    (event) => event.type === "agent.thinking",
  );
  const reportedDurationMs =
    typeof latestThinking?.payload.durationMs === "number"
      ? latestThinking.payload.durationMs
      : undefined;
  const startedAt = events.find((event) => event.type === "run.started")?.at;
  const completedAt = events.findLast((event) =>
    [
      "run.completed",
      "run.failed",
      "run.aborted",
      "runtime.disconnected",
    ].includes(event.type),
  )?.at;
  const ledColor = terminal
    ? status === "completed"
      ? "var(--botanical)"
      : "var(--danger)"
    : "var(--botanical-2)";
  const steps = useMemo(() => {
    const list = events.map(describeStep).filter((step): step is Step => step !== null);
    // The final answer often also arrives as the last run.status; don't repeat it
    // as a step when it's already shown as the terminal summary below.
    const finalText = response.trim();
    return terminal && finalText
      ? list.filter((step) => step.title.trim() !== finalText)
      : list;
  }, [events, terminal, response]);

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        usage={usage ?? undefined}
        responseDurationMs={reportedDurationMs}
        startedAt={startedAt}
        completedAt={completedAt}
        summary={
          typeof latestThinking?.payload.summary === "string"
            ? latestThinking.payload.summary
            : undefined
        }
        agentName="Agent TARS"
      />
      <div className="bb-agent-run-card overflow-hidden text-[var(--ink)]">
      {/* The task is the user's own message directly above this card, so the
          header is just the agent, what it is driving, and the state of its run. */}
      <div className="bb-agent-run-header">
        <span className="bb-agent-run-title truncate">Agent&nbsp;TARS</span>
        <div className="flex shrink-0 items-center gap-[8px]">
          <span className="bb-agent-run-label">
            {controlsDesktop ? "Desktop" : "Browser"}
          </span>
          <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
            <span
              className={`bb-agent-run-led h-1.5 w-1.5 ${terminal ? "" : "animate-pulse"}`}
              style={{ backgroundColor: ledColor }}
            />
            {status.replaceAll("_", " ")}
          </span>
          {!terminal ? (
            <button type="button" onClick={stop} className="bb-agent-run-action">
              Stop
            </button>
          ) : null}
        </div>
      </div>

      <div className="p-[21px]">
        <div className="bb-agent-run-inset relative flex aspect-[16/9] min-h-52 flex-col overflow-hidden">
          {pageUrl ? (
            <div className="bb-agent-run-readout truncate border-b border-[color-mix(in_srgb,var(--line)_55%,transparent)] bg-[var(--paper-surface)] px-[13px] py-[5px]">
              {pageUrl}
            </div>
          ) : null}
          <AgentTarsScreenshotGallery
            key={runId}
            events={events}
            imageUrl={(screenshotId) => `/api/ui-tars/agents/${agentId}/runs/${runId}/screenshots/${screenshotId}`}
            alt={controlsDesktop ? "Actual desktop screenshot" : "Browser screenshot"}
            emptyLabel={terminal ? "No screenshot was captured" : "Waiting for the first screenshot…"}
          />
          {pending ? (
            <div className="bb-agent-run-output absolute inset-x-[13px] bottom-[13px] p-[13px]">
              <div className="bb-agent-run-title">
                Approval required ·{" "}
                <span className={RISK_STYLE[pending.risk] ?? "text-[var(--ink-muted)]"}>
                  {pending.risk} risk
                </span>
              </div>
              <div className="bb-agent-run-text mt-[5px]">{pending.explanation}</div>
              <div className="bb-agent-run-readout mt-[5px] break-all">
                {pending.action}: {pending.target}
              </div>
              <div className="mt-[8px] flex justify-end gap-[8px]">
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => decide("reject")}
                  className="bb-agent-run-action bb-agent-run-action-danger"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => decide("approve")}
                  className="bb-agent-run-action bb-agent-run-action-primary"
                >
                  Approve
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {err ? <p className="mt-2 px-1 text-[12px] text-[var(--danger)]">{err}</p> : null}
      </div>
      </div>

      {steps.length > 0 ? (
        <ol
          className="relative mt-3 space-y-4 py-1"
          aria-label="Agent TARS activity timeline"
        >
          <span
            aria-hidden
            className="absolute bottom-2 left-[3px] top-2 w-px bg-[var(--line)]"
          />
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const active = !terminal && isLast;
            return (
              <li
                key={step.key}
                className="relative grid min-w-0 grid-cols-[8px_minmax(0,1fr)] gap-4"
              >
                <span
                  aria-hidden
                  className={`relative z-10 mt-[7px] h-2 w-2 rounded-full ${
                    step.failed ? "bg-[var(--danger)]" : "bg-[var(--botanical-2)]"
                  } ${active ? "motion-safe:animate-pulse" : ""}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-5 text-[var(--ink-heading)]">
                    {step.title}
                  </div>
                  {step.detail ? (
                    <div className="mt-0.5 break-words text-[12px] leading-5 text-[var(--ink-muted)]">
                      {step.detail}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {terminal ? (
        <div className="mt-3 text-sm leading-7 text-[var(--ink)]">
          <ChatMarkdown content={terminalContent} compact />
          <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
        </div>
      ) : null}
    </>
  );
}
