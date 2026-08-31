"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
import { classroomIdFromText, classroomOpenPath } from "@/lib/classroom/identity.ts";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
}

const EVENTS = [
  "run.queued",
  "service.starting",
  "service.ready",
  "classroom.queued",
  "classroom.progress",
  "classroom.ready",
  "artifact.saved",
  "artifact.failed",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);

/**
 * OpenMAIC's job steps (`ClassroomGenerationStep` in the clone's
 * lib/server/classroom-generation.ts), in the words a person waiting on them
 * would use. `tests/classroom-agent.test.mjs` checks the clone's union against
 * this list.
 */
const STEP_LABEL: Record<string, string> = {
  queued: "waiting to start",
  initializing: "starting the lesson",
  researching: "searching the web",
  generating_outlines: "writing the lesson outline",
  generating_scenes: "building the scenes",
  generating_media: "generating images and video",
  generating_tts: "recording narration",
  persisting: "saving the classroom",
  completed: "done",
  failed: "failed",
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default function InlineClassroomRun({
  runId,
  brief,
  persistedContent = "",
  persistedOutcome,
  persistedUsage,
  onTerminal,
  onRetry,
}: {
  runId: string;
  brief: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  persistedUsage?: ChatTokenUsage;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [phase, setPhase] = useState("starting the classroom server");
  const [step, setStep] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [scenes, setScenes] = useState<{ done: number; total: number | null }>({
    done: 0,
    total: null,
  });
  const [description, setDescription] = useState("");
  // A reopened card finds its classroom in the saved summary; a live one is
  // told by the run. Either way the id is what the preview and the link need.
  const [classroomId, setClassroomId] = useState<string | null>(() =>
    persistedOutcome === "completed" ? classroomIdFromText(persistedContent) : null,
  );
  const [result, setResult] = useState(persistedOutcome === "completed" ? persistedContent : "");
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const reported = useRef(false);
  const terminalRef = useRef(onTerminal);
  const base = `/api/classroom/runs/${runId}`;
  const replaying = Boolean(persistedOutcome && persistedOutcome !== "running" && persistedContent);

  useEffect(() => {
    terminalRef.current = onTerminal;
  }, [onTerminal]);
  useEffect(() => {
    reported.current = false;
  }, [runId]);

  const report = useCallback(
    (outcome: "completed" | "failed" | "aborted", content: string) => {
      if (reported.current) return;
      reported.current = true;
      if (outcome === "completed") notifyTaskCompleted(`Classroom — ${brief.slice(0, 80)}`);
      terminalRef.current?.({ outcome, content });
    },
    [brief],
  );

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.type === "run.queued") {
        setDescription(text(payload.description));
      } else if (event.type === "service.starting") {
        setPhase("starting the classroom server");
      } else if (event.type === "service.ready") {
        setStatus("running");
        setPhase("asking for the lesson");
      } else if (event.type === "classroom.queued") {
        setStatus("running");
        setPhase("generating");
      } else if (event.type === "classroom.progress") {
        setStatus("running");
        setPhase("generating");
        setStep(text(payload.step));
        setMessage(text(payload.message));
        setProgress(count(payload.progress));
        setScenes({
          done: count(payload.scenesGenerated) ?? 0,
          total: count(payload.totalScenes),
        });
      } else if (event.type === "classroom.ready") {
        setClassroomId(text(payload.classroomId) || null);
        setPhase("filing the lesson");
      } else if (event.type === "run.completed") {
        setStatus("completed");
        const id = text(payload.classroomId);
        if (id) setClassroomId(id);
        const finished = text(payload.summary, "The classroom is ready.");
        setResult(finished);
        report("completed", finished);
      } else if (event.type === "run.failed" || event.type === "run.aborted") {
        const outcome = event.type === "run.aborted" ? "aborted" : "failed";
        const reason =
          text(payload.summary) || text(payload.error) || "The classroom could not be generated.";
        setStatus(outcome);
        setFailure(reason);
        report(outcome, reason);
      }
    },
    [report],
  );

  useEffect(() => {
    if (replaying) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (frame: MessageEvent) => {
      try {
        applyEvent(JSON.parse(frame.data) as RunEvent);
      } catch {
        // Malformed frame.
      }
    };
    EVENTS.forEach((type) => source.addEventListener(type, handle as EventListener));
    source.onerror = () => source.close();
    return () => source.close();
  }, [applyEvent, base, replaying]);

  const terminal = TERMINAL.has(status);
  const showClassroom = Boolean(classroomId) && status === "completed";
  const openUrl = classroomId ? classroomOpenPath(classroomId) : "";
  const stepLabel = STEP_LABEL[step] ?? (step ? step.replace(/[-_]/g, " ") : phase);
  const summaryLine = terminal ? status : stepLabel;
  const sceneLine =
    scenes.total !== null
      ? `${scenes.done} of ${scenes.total} scene${scenes.total === 1 ? "" : "s"}`
      : scenes.done
        ? `${scenes.done} scene${scenes.done === 1 ? "" : "s"}`
        : "";
  const terminalContent = result || failure || "The classroom run finished.";

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        agentName="Classroom"
        usage={persistedUsage}
        summary={summaryLine}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title">
            Classroom
            {description ? (
              <span className="ml-2 text-[11px] font-normal text-[var(--ink-muted)]">
                {description}
              </span>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <span className="bb-agent-run-label">
              <span
                className={`bb-agent-run-led mr-1.5 inline-block h-1.5 w-1.5 ${
                  status === "completed"
                    ? "bg-[var(--botanical)]"
                    : terminal
                      ? "bg-[var(--danger)]"
                      : "animate-pulse bg-[var(--botanical-2)]"
                }`}
              />
              {summaryLine}
            </span>
            {showClassroom ? (
              <a className="bb-agent-run-action" href={openUrl} target="_blank" rel="noreferrer">
                Open
              </a>
            ) : null}
            {!terminal ? (
              <button
                type="button"
                className="bb-agent-run-action"
                onClick={() => void fetch(`${base}/abort`, { method: "POST" })}
              >
                Stop
              </button>
            ) : null}
          </div>
        </header>
        <div className="space-y-[13px] p-[21px]">
          {!terminal ? (
            <div className="space-y-1.5">
              <p className="bb-agent-run-text text-[var(--ink-muted)]">
                {message || `${stepLabel[0]?.toUpperCase() ?? ""}${stepLabel.slice(1)}…`}
                {sceneLine ? ` · ${sceneLine}` : ""}
              </p>
              {progress !== null ? (
                <div
                  className="h-1 w-full overflow-hidden rounded-full bg-[var(--line)]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(Math.min(100, Math.max(0, progress)))}
                >
                  <div
                    className="h-full bg-[var(--botanical)] transition-[width] duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {showClassroom ? (
            <div className="overflow-hidden rounded-xl border border-[var(--line)]">
              {/* The classroom is OpenMAIC's own player on its local port, reached
                  through the dashboard's link route so a saved card still finds
                  it after the server has restarted on a different port. It is a
                  full app — narration, quizzes, simulations — so it keeps its
                  own origin and scripts. */}
              <iframe
                title="Classroom preview"
                src={openUrl}
                allow="autoplay; fullscreen"
                referrerPolicy="no-referrer"
                className="block h-[32rem] w-full border-0 bg-black"
              />
            </div>
          ) : null}
          {result ? (
            <section className="bb-agent-run-text border-t border-[var(--line)] pt-[13px]">
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
