"use client";

// In-chat run workspace for an agent-browser run (vercel-labs/agent-browser
// driven by ChatMock). Mirrors the Agent TARS inline card but reads the
// /api/agent-browser event stream and its event vocabulary. The run is created
// by the host before this mounts; this component only observes.

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import { useYoloMode } from "@/app/components/use-yolo-mode";
import { normalizeChatTokenUsage } from "@/lib/chat-token-usage";
import { appendBoundedAgentRunEvent } from "@/lib/agent-run-history";
import {
  showSignInRequest,
  type SignInStartResult,
} from "@/app/components/sign-in-required-card";
import type { BrowserProfileState } from "@/lib/agent-browser/service.ts";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import type { HermesSurface } from "@/lib/hermes/config.ts";
import {
  desktopTabsBridge,
  openBrowserAgentRunInDesktop,
} from "@/lib/desktop-browser-tabs";

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
}

interface AuthRequired {
  url: string;
  origin?: string;
  title?: string;
}

const RISK_STYLE: Record<string, string> = {
  high: "text-[var(--danger)]",
  medium: "text-[#8a6f00]",
  low: "text-[var(--botanical)]",
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);

function summarize(event: RunEvent): string {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === "run.status") return String(payload.message ?? "");
  if (event.type === "agent.thinking") return String(payload.summary ?? "Thinking");
  if (event.type === "agent.usage") {
    return `${payload.estimated === true ? "~" : ""}${payload.totalTokens ?? 0} tokens`;
  }
  if (event.type === "observation.page") return String(payload.url ?? "");
  if (event.type === "auth.required") return `sign-in required: ${payload.origin ?? payload.url ?? ""}`;
  if (event.type === "action.proposed") return `${payload.action ?? ""} ${payload.target ?? ""}`.trim();
  if (event.type === "action.completed") return String(payload.summary ?? "done");
  if (event.type === "approval.requested") return `needs approval: ${payload.action ?? ""} ${payload.target ?? ""}`.trim();
  if (event.type === "approval.approved") return "approved";
  if (event.type === "approval.rejected") return "rejected";
  if (event.type === "run.completed") return String(payload.summary ?? "completed");
  if (event.type === "run.failed") return String(payload.message ?? "failed");
  if (event.type === "observation.screenshot") return "screenshot captured";
  return "";
}

const STREAMED_EVENT_TYPES = [
  "run.started",
  "run.status",
  "agent.thinking",
  "agent.usage",
  "observation.page",
  "observation.screenshot",
  "auth.required",
  "action.proposed",
  "action.completed",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "run.completed",
  "run.failed",
  "run.aborted",
];

export default function InlineAgentBrowserRun({
  agentId,
  runId,
  task,
  persistedContent = "",
  persistedOutcome,
  signInSurface = "garden_chat",
  signInSessionId = null,
  onTerminal,
  onRetry,
}: {
  agentId: string;
  runId: string;
  task: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  /** Composer that owns the user-controlled sign-in handoff. */
  signInSurface?: HermesSurface;
  signInSessionId?: string | number | null;
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
  const [result, setResult] = useState(persistedContent);
  const [shot, setShot] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState<AuthRequired | null>(null);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [yoloMode] = useYoloMode();
  const esRef = useRef<EventSource | null>(null);
  const receivedEventRef = useRef(false);
  const timelineRef = useRef<HTMLUListElement | null>(null);
  const followRef = useRef(true);
  const onTerminalRef = useRef(onTerminal);
  const reportedTerminalRef = useRef(false);
  // The launchers own the one automatic open. This observer must stay passive:
  // a chat refresh or virtualized remount must not resurrect a user-closed tab.
  const usesDesktopBrowser = desktopTabsBridge() !== undefined;

  const base = `/api/agent-browser/agents/${agentId}/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedTerminalRef.current = false;
  }, [runId]);

  const applyEvent = useCallback((event: RunEvent) => {
    receivedEventRef.current = true;
    setEvents((previous) => appendBoundedAgentRunEvent(previous, event));
    if (event.type === "observation.screenshot") {
      const screenshotId = String((event.payload as { screenshotId?: string }).screenshotId ?? "");
      if (screenshotId) setShot(screenshotId);
    }
    if (event.type === "observation.page") {
      const url = (event.payload as { url?: string }).url;
      if (url) setPageUrl(url);
    }
    if (event.type === "auth.required") {
      const payload = event.payload as Partial<AuthRequired>;
      if (typeof payload.url === "string" && /^https?:\/\//iu.test(payload.url)) {
        setAuthRequired({
          url: payload.url,
          ...(typeof payload.origin === "string" ? { origin: payload.origin } : {}),
          ...(typeof payload.title === "string" ? { title: payload.title } : {}),
        });
        setStatus("waiting_for_sign_in");
      }
    }
    if (event.type === "approval.requested") {
      setPending(event.payload as unknown as PendingApproval);
      setStatus("awaiting_approval");
    }
    if (event.type === "approval.approved" || event.type === "approval.rejected") setPending(null);
    if (["run.completed", "run.failed", "run.aborted"].includes(event.type)) setPending(null);
    if (event.type.startsWith("run.")) setStatus(event.type.replace("run.", ""));
    if (
      !reportedTerminalRef.current &&
      ["run.completed", "run.failed", "run.aborted"].includes(event.type)
    ) {
      esRef.current?.close();
      esRef.current = null;
      reportedTerminalRef.current = true;
      const outcome = event.type.replace("run.", "") as ExternalAgentTerminalOutcome;
      const content =
        summarize(event) ||
        (outcome === "completed"
          ? "Task completed."
          : outcome === "aborted"
            ? "Request was aborted."
            : "Agent Browser could not complete the task.");
      setResult(content);
      if (outcome === "completed") notifyTaskCompleted(task);
      onTerminalRef.current?.({ outcome, content });
    }
  }, [task]);

  useEffect(() => {
    if (!authRequired) return;
    const requestId = `agent-browser-sign-in:${runId}`;

    async function readProfile(): Promise<BrowserProfileState> {
      const response = await fetch("/api/agent-browser/browser-profile", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.profile) {
        throw new Error("Breadboard could not read the browser sign-in profile.");
      }
      return data.profile as BrowserProfileState;
    }

    async function waitUntilRunReleasesBrowser(): Promise<BrowserProfileState> {
      // auth.required is immediately followed by a terminal run event, but the
      // Runtime and browser process finish independently. Ask it to stop as a
      // harmless idempotent nudge, then wait for the profile lock to clear.
      await fetch(`${base}/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).catch(() => undefined);
      const deadline = Date.now() + 15_000;
      let profile = await readProfile();
      while (profile.runInProgress && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        profile = await readProfile();
      }
      if (profile.runInProgress) {
        throw new Error("The browser task is still closing. Wait a moment and try again.");
      }
      if (!profile.runtimeAvailable || !profile.browserFound) {
        throw new Error("A compatible sign-in browser is not available right now.");
      }
      return profile;
    }

    async function startSignIn(): Promise<SignInStartResult> {
      if (usesDesktopBrowser) {
        const opened = await openBrowserAgentRunInDesktop(runId, authRequired!.url);
        if (!opened) throw new Error("Breadboard could not reopen the live browser tab.");
        return { browserName: "Breadboard browser" };
      }
      const profile = await waitUntilRunReleasesBrowser();
      const response = await fetch("/api/agent-browser/browser-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "open", url: authRequired!.url }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const code = typeof data?.error === "string" ? data.error : "";
        if (code === "run_in_progress") {
          throw new Error("The browser task is still closing. Wait a moment and try again.");
        }
        if (code === "browser_not_found") {
          throw new Error("No compatible Chrome or Edge browser was found.");
        }
        throw new Error("Breadboard could not open the sign-in window.");
      }
      const opened = data?.profile as BrowserProfileState | undefined;
      return { browserName: opened?.browserName ?? profile.browserName };
    }

    async function finishSignIn(): Promise<void> {
      if (usesDesktopBrowser) return;
      const profile = await readProfile();
      if (!profile.windowOpen) return;
      const response = await fetch("/api/agent-browser/browser-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok && data?.error !== "unmanaged_sign_in_window") {
        throw new Error("Breadboard could not close the sign-in window.");
      }
    }

    showSignInRequest({
      id: requestId,
      surface: signInSurface,
      sessionId: signInSessionId,
      url: authRequired.url,
      browserName: null,
      startSignIn,
      finishSignIn,
      retry: onRetry,
    });
  }, [authRequired, base, onRetry, runId, signInSessionId, signInSurface, usesDesktopBrowser]);

  useEffect(() => {
    // A finished turn already carries its result, and its run is long gone from
    // the run manager's memory. Opening a stream for it would leave an
    // EventSource retrying a dead endpoint for as long as the transcript is on
    // screen — once per restored card.
    if (persistedOutcome && persistedOutcome !== "running" && persistedContent) return;
    const eventSource = new EventSource(`${base}/events?since=0`);
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
      // A stream that ends before delivering a single event means the run is
      // unreachable — it crashed at startup, the server restarted, or the run
      // was cleaned up. Say so instead of showing "Starting run…" forever.
      if (!receivedEventRef.current) {
        setStatus((current) => (current === "starting" ? "failed" : current));
        setResult((current) =>
          current.trim()
            ? current
            : "The run ended before it reported any progress — it may have failed to start or the server restarted. Retry to start a new run.",
        );
      }
    };
    esRef.current = eventSource;
    return () => {
      eventSource.close();
      esRef.current = null;
    };
  }, [base, applyEvent, persistedContent, persistedOutcome]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || !followRef.current) return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [events]);

  const handleScroll = useCallback((event: UIEvent<HTMLUListElement>) => {
    const timeline = event.currentTarget;
    followRef.current = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 32;
  }, []);

  const decide = useCallback(async (kind: "approve" | "reject") => {
    if (!pending || deciding) return;
    setDeciding(true);
    try {
      const response = await fetch(`${base}/${kind}`, {
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
  }, [base, deciding, pending]);

  useEffect(() => {
    if (!yoloMode || !pending || deciding) return;
    void decide("approve");
  }, [decide, deciding, pending, yoloMode]);

  const stop = async () => {
    try {
      await fetch(`${base}/abort`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } catch (error) {
      setErr((error as Error).message);
    }
  };

  const terminal = TERMINAL_STATUSES.has(status);
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
    ["run.completed", "run.failed", "run.aborted"].includes(event.type),
  )?.at;
  const terminalContent =
    result.trim() ||
    (status === "aborted"
      ? "Request was aborted."
      : status === "failed"
        ? "Agent Browser could not complete the task."
        : "Task completed.");
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
        usage={usage ?? undefined}
        responseDurationMs={reportedDurationMs}
        startedAt={startedAt}
        completedAt={completedAt}
        summary={
          typeof latestThinking?.payload.summary === "string"
            ? latestThinking.payload.summary
            : undefined
        }
        agentName="Agent Browser"
      />
      <div className="bb-agent-run-card overflow-hidden">
      {/* The task is the user's own message directly above this card; repeating
          it here would only push the screenshot further down. */}
      <div className="bb-agent-run-header">
        <span className="bb-agent-run-title truncate">Agent Browser</span>
        <div className="flex shrink-0 items-center gap-[8px]">
          <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
            <span className={`bb-agent-run-led h-1.5 w-1.5 ${statusDot}`} />
            {status}
          </span>
          <span className="bb-agent-run-label tabular-nums">
            {events.length} step{events.length === 1 ? "" : "s"}
          </span>
          {!terminal && (
            <button type="button" onClick={stop} className="bb-agent-run-action">
              Stop
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[13px] p-[21px] lg:grid-cols-[1.618fr_1fr]">
        <div className="bb-agent-run-inset relative overflow-hidden">
          {pageUrl && (
            <div className="bb-agent-run-readout truncate border-b border-[color-mix(in_srgb,var(--line)_55%,transparent)] px-[13px] py-[5px]">
              {pageUrl}
            </div>
          )}
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${base}/screenshots/${shot}`} alt="Browser screenshot" className="block w-full" />
          ) : (
            <div className="bb-agent-run-label flex h-48 items-center justify-center">
              {terminal ? "No screenshot captured" : "Waiting for first screenshot…"}
            </div>
          )}
          {pending && (
            <div className="bb-agent-run-output absolute inset-x-[13px] bottom-[13px] p-[13px]">
              <div className="bb-agent-run-title">
                Approval required ·{" "}
                <span className={RISK_STYLE[pending.risk] ?? "text-[var(--ink-muted)]"}>
                  {pending.risk} risk
                </span>
              </div>
              <div className="bb-agent-run-text mt-[5px] break-all text-[var(--ink-muted)]">
                {pending.explanation}
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
          )}
        </div>

        {/* Every step the run took, live. The header counts them; this is the
            record of what each one actually did. */}
        <div className="bb-agent-run-panel flex max-h-[280px] flex-col overflow-hidden">
          <ul ref={timelineRef} onScroll={handleScroll} className="flex-1 overflow-auto p-[8px]">
            {events.length === 0 && (
              <li className="bb-agent-run-label p-[8px]">Starting run…</li>
            )}
            {events.map((event) => (
              <li
                key={event.sequenceNumber}
                className="border-b border-[color-mix(in_srgb,var(--line)_45%,transparent)] px-[8px] py-[5px] last:border-0"
              >
                <span className="mr-[8px] font-mono text-[11px] text-[var(--botanical)]">
                  {event.type}
                </span>
                <span className="bb-agent-run-text break-words text-[var(--ink-muted)]">
                  {summarize(event)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {err && <p className="bb-agent-run-text px-[21px] pb-[13px] text-[var(--danger)]">{err}</p>}
      {terminal ? (
        <div className="bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] p-[21px]">
          <ChatMarkdown content={terminalContent} compact />
        </div>
      ) : null}
      </div>
      {terminal ? (
        <AssistantMessageActions content={terminalContent} onRetry={onRetry} />
      ) : null}
    </>
  );
}
