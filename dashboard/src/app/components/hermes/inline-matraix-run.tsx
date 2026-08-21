"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
}
interface Artifact {
  id: string;
  relativePath: string;
  name: string;
  kind: string;
  size: number;
}
interface Persona {
  personaId: string;
  name: string;
  source: string;
  dimensions: Record<string, string>;
}

const EVENTS = [
  "run.queued",
  "stage.changed",
  "pool.read",
  "study.designed",
  "study.ready",
  "cohort.adjusted",
  "cohort.sampled",
  "trial.started",
  "trial.completed",
  "trial.failed",
  "study.summary",
  "artifacts.updated",
  "log",
  "run.completed",
  "run.failed",
  "run.aborted",
];
const TERMINAL = new Set(["completed", "failed", "aborted"]);
const STAGE_LABEL: Record<string, string> = {
  designing: "writing the questionnaire",
  sampling: "drawing the cohort",
  answering: "asking the population",
  reporting: "aggregating",
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function artifacts(value: unknown): Artifact[] {
  return Array.isArray(value) ? (value as Artifact[]).filter((item) => item?.id) : [];
}
function personas(value: unknown): Persona[] {
  return Array.isArray(value) ? (value as Persona[]).filter((item) => item?.personaId) : [];
}
function notes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export default function InlineMatraixRun({
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
  const [stage, setStage] = useState("designing");
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState(0);
  const [adjustments, setAdjustments] = useState<string[]>([]);
  const [cohort, setCohort] = useState<Persona[]>([]);
  const [matched, setMatched] = useState<number | null>(null);
  const [answered, setAnswered] = useState(0);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState("");
  const [outputs, setOutputs] = useState<Artifact[]>([]);
  const [result, setResult] = useState(persistedOutcome === "completed" ? persistedContent : "");
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const reported = useRef(false);
  const terminalRef = useRef(onTerminal);
  const base = `/api/matraix/runs/${runId}`;
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
      if (outcome === "completed") notifyTaskCompleted(`MatrAIx — ${brief.slice(0, 80)}`);
      terminalRef.current?.({ outcome, content });
    },
    [brief],
  );

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.type === "stage.changed") {
        setStatus("running");
        setStage(text(payload.stage, "designing"));
      } else if (event.type === "study.ready") {
        // The bridge's own view of the study, once it has loaded it. Only fills
        // gaps: the design event above is more specific and arrives first.
        setTitle((value) => value || text(payload.title));
        setQuestions((value) => value || (count(payload.questions) ?? 0));
      } else if (event.type === "study.designed") {
        setTitle(text(payload.title));
        setQuestions(Array.isArray(payload.questions) ? payload.questions.length : 0);
        setTotal(count(payload.respondents) ?? 0);
      } else if (event.type === "cohort.adjusted") {
        setAdjustments(notes(payload.notes));
      } else if (event.type === "cohort.sampled") {
        setCohort(personas(payload.personas));
        setMatched(count(payload.matchedCount));
        setTotal(count(payload.sampleSize) ?? 0);
      } else if (event.type === "trial.started") {
        setCurrent(text(payload.personaName));
      } else if (event.type === "trial.completed" || event.type === "trial.failed") {
        setAnswered((value) => value + 1);
      } else if (event.type === "artifacts.updated") {
        setOutputs(artifacts(payload.artifacts));
      } else if (event.type === "run.completed") {
        setStatus("completed");
        setOutputs(artifacts(payload.artifacts));
        const finished = text(payload.report) || text(payload.summary, "The study finished.");
        setResult(finished);
        report("completed", finished);
      } else if (event.type === "run.failed" || event.type === "run.aborted") {
        const outcome = event.type === "run.aborted" ? "aborted" : "failed";
        const message =
          text(payload.summary) || text(payload.error) || "The MatrAIx study could not finish.";
        setStatus(outcome);
        setFailure(message);
        setOutputs(artifacts(payload.artifacts));
        report(outcome, message);
      }
    },
    [report],
  );

  useEffect(() => {
    if (replaying) return;
    const source = new EventSource(`${base}/events?since=0`);
    const handle = (message: MessageEvent) => {
      try {
        applyEvent(JSON.parse(message.data) as RunEvent);
      } catch {
        // Malformed frame.
      }
    };
    EVENTS.forEach((type) => source.addEventListener(type, handle as EventListener));
    source.onerror = () => source.close();
    return () => source.close();
  }, [applyEvent, base, replaying]);

  useEffect(() => {
    if (!replaying) return;
    void fetch(`${base}/artifacts`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { artifacts?: unknown } | null) => {
        if (data) setOutputs(artifacts(data.artifacts));
      })
      .catch(() => undefined);
  }, [base, replaying]);

  const terminal = TERMINAL.has(status);
  const report_ = useMemo(
    () => outputs.find((item) => item.kind === "report") ?? null,
    [outputs],
  );
  const data = useMemo(
    () => outputs.filter((item) => item.kind === "data" && item.name.startsWith("results.")),
    [outputs],
  );
  const terminalContent = result || failure || "The MatrAIx study finished.";

  return (
    <>
      <AssistantResponseMeta
        active={!terminal}
        failed={terminal && status !== "completed"}
        agentName="MatrAIx"
        usage={persistedUsage}
        summary={current ? `Asking ${current}` : STAGE_LABEL[stage]}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <header className="bb-agent-run-header">
          <p className="bb-agent-run-title">
            MatrAIx
            {title ? (
              <span className="ml-2 text-[11px] font-normal text-[var(--ink-muted)]">{title}</span>
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
              {terminal ? status : (STAGE_LABEL[stage] ?? stage)}
            </span>
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
          {questions || total ? (
            <p className="bb-agent-run-text text-[var(--ink-muted)]">
              {questions ? `${questions} question${questions === 1 ? "" : "s"}` : null}
              {questions && total ? " · " : null}
              {total
                ? `${terminal ? total : `${answered} of ${total}`} respondent${total === 1 ? "" : "s"}`
                : null}
              {matched !== null ? ` · drawn from ${matched} matching personas` : null}
            </p>
          ) : null}
          {adjustments.length ? (
            <ul className="bb-agent-run-text space-y-1 text-[var(--ink-muted)]">
              {adjustments.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          {!terminal && cohort.length ? (
            <ul className="flex flex-wrap gap-1">
              {cohort.slice(0, 24).map((persona) => (
                <li
                  key={persona.personaId}
                  className="bb-agent-run-row px-2 py-1 text-[11px]"
                  title={Object.entries(persona.dimensions)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join("\n")}
                >
                  {persona.name}
                </li>
              ))}
            </ul>
          ) : null}
          {report_ ? (
            <a
              className="bb-agent-run-panel flex items-center justify-between gap-3 p-[13px] hover:text-[var(--botanical)]"
              href={`${base}/artifacts/${encodeURIComponent(report_.id)}?download=1`}
              download={report_.name}
            >
              <span className="min-w-0 truncate font-mono text-[12px]">{report_.relativePath}</span>
              <span className="shrink-0 text-[11px] text-[var(--ink-muted)]">
                The full report · Download
              </span>
            </a>
          ) : null}
          {data.length ? (
            <ul className="grid gap-1 sm:grid-cols-3">
              {data.map((item) => (
                <li key={item.id}>
                  <a
                    className="bb-agent-run-row flex items-center justify-between gap-2 p-2"
                    href={`${base}/artifacts/${encodeURIComponent(item.id)}?download=1`}
                  >
                    <span className="truncate font-mono text-[11px]">{item.name}</span>
                  </a>
                </li>
              ))}
            </ul>
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
