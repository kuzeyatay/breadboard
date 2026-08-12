"use client";

// The Parametric CAD run card.
//
// The card shows the design pipeline as it runs and then hands off: the part
// lives in the artifact, not in the transcript, so the finished card is a short
// result line plus the design's own card underneath it.
//
// Styling uses the shared run material (bb-agent-run-*) so this card reads as
// the same object as every other external-agent run.

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { normalizeChatTokenUsage, type ChatTokenUsage } from "@/lib/chat-token-usage";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const STAGES = [
  { key: "spec", label: "Reading the request into a design" },
  { key: "source", label: "Writing the parametric source" },
  { key: "execute", label: "Building the solid" },
  { key: "validate", label: "Validating the geometry" },
  { key: "export", label: "Exporting STEP, STL, GLB and 3MF" },
  { key: "artifact", label: "Publishing the design" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];
type StageState = "pending" | "active" | "done";

const STREAMED_EVENT_TYPES = [
  "run.started",
  "safety.limited",
  "interpret.started",
  "interpret.completed",
  "cad.spec.created",
  "cad.source.generated",
  "cad.execution.started",
  "cad.execution.failed",
  "cad.execution.completed",
  "cad.validation.started",
  "cad.validation.failed",
  "cad.validation.completed",
  "cad.repair.started",
  "cad.export.started",
  "cad.export.completed",
  "cad.artifact.created",
  "cad.artifact.updated",
  "artifact.unavailable",
  "run.usage",
  "run.completed",
  "run.failed",
  "run.aborted",
];

const TERMINAL = new Set(["completed", "failed", "aborted"]);

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => asString(entry)).filter(Boolean) : [];
}

interface Finding {
  code: string;
  severity: "error" | "warning";
  message: string;
  repairHint?: string;
}

function asFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      return {
        code: asString(row.code) || "issue",
        severity: (row.severity === "error" ? "error" : "warning") as Finding["severity"],
        message: asString(row.message),
        ...(asString(row.repairHint) ? { repairHint: asString(row.repairHint) } : {}),
      };
    })
    .filter((finding) => finding.message);
}

/**
 * The summary leads with `**Title** — …` so the design is still identifiable
 * wherever the message is read on its own. In the card the header owns the
 * title, so split it off and render only what follows.
 */
function splitSummary(summary: string): { title: string; body: string } {
  const lead = /^\*\*(.+?)\*\*\s+—\s+/.exec(summary);
  return lead
    ? { title: lead[1], body: summary.slice(lead[0].length) }
    : { title: "", body: summary };
}

export default function InlineParametricCadRun({
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
  const [stages, setStages] = useState<Record<StageKey, StageState>>({
    spec: "pending",
    source: "pending",
    execute: "pending",
    validate: "pending",
    export: "pending",
    artifact: "pending",
  });
  const [safetyNotice, setSafetyNotice] = useState("");
  const [specs, setSpecs] = useState<Array<[string, string]>>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [exports, setExports] = useState<string[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [designTitle, setDesignTitle] = useState("");
  const [designSummary, setDesignSummary] = useState("");
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [usage, setUsage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  const [startedAt, setStartedAt] = useState<string | undefined>();
  const [completedAt, setCompletedAt] = useState<string | undefined>();
  const onTerminalRef = useRef(onTerminal);
  const usageRef = useRef(usage);
  const reportedRef = useRef(false);
  const base = `/api/cad/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedRef.current = false;
  }, [runId]);

  const advance = useCallback((key: StageKey, state: StageState) => {
    setStages((current) =>
      current[key] === "done" && state === "active" ? current : { ...current, [key]: state },
    );
  }, []);

  const applyEvent = useCallback(
    (event: RunEvent) => {
      const payload = event.payload;
      if (event.at) setStartedAt((current) => current ?? event.at);
      switch (event.type) {
        case "run.started":
          setStatus("running");
          if (event.at) setStartedAt(event.at);
          break;
        case "run.usage": {
          const next = normalizeChatTokenUsage(payload);
          if (next) {
            usageRef.current = next;
            setUsage(next);
          }
          break;
        }
        case "safety.limited":
          setSafetyNotice(`${asString(payload.category)} — ${asString(payload.reason)}`);
          break;
        case "interpret.started":
          advance("spec", "active");
          break;
        case "cad.spec.created":
          advance("spec", "done");
          setAssumptions(asStringList(payload.assumptions));
          setSpecs((current) => [
            ...current.filter(([key]) => key !== "Units" && key !== "Process"),
            ["Units", asString(payload.units, "mm")],
            ["Process", asString(payload.process, "fdm").toUpperCase()],
          ]);
          break;
        case "cad.source.generated":
          advance("spec", "done");
          advance("source", "done");
          setAttempts((current) => current + 1);
          break;
        case "cad.execution.started":
          advance("execute", "active");
          break;
        case "cad.execution.completed": {
          advance("execute", "done");
          const box = payload.boundingBox as { x?: number; y?: number; z?: number } | null;
          setSpecs((current) => [
            ...current.filter(([key]) => key !== "Size" && key !== "Bodies"),
            ...(box
              ? ([
                  [
                    "Size",
                    `${asNumber(box.x).toFixed(1)} × ${asNumber(box.y).toFixed(1)} × ${asNumber(box.z).toFixed(1)} mm`,
                  ],
                ] as Array<[string, string]>)
              : []),
            ["Bodies", String(asNumber(payload.solidCount))],
          ]);
          break;
        }
        case "cad.execution.failed":
          advance("execute", "active");
          setFindings((current) => [
            ...current,
            {
              code: asString(payload.code, "build_failed"),
              severity: "error",
              message: asString(payload.message, "The build failed."),
              ...(asString(payload.repairHint) ? { repairHint: asString(payload.repairHint) } : {}),
            },
          ]);
          break;
        case "cad.validation.started":
          advance("validate", "active");
          break;
        case "cad.validation.completed":
        case "cad.validation.failed":
          advance("validate", "done");
          setFindings(asFindings(payload.issues));
          break;
        case "cad.export.started":
          advance("export", "active");
          break;
        case "cad.export.completed":
          advance("export", "done");
          setExports(asStringList(payload.formats));
          break;
        case "cad.artifact.created":
        case "cad.artifact.updated":
        case "artifact.unavailable":
          advance("artifact", "done");
          break;
        case "run.completed": {
          setStatus("completed");
          setResult(asString(payload.summary));
          setDesignTitle(asString(payload.designTitle));
          setDesignSummary(asString(payload.designSummary));
          setCompletedAt(event.at);
          setFindings(asFindings(payload.findings));
          setAssumptions(asStringList(payload.assumptions));
          setExports(asStringList(payload.exports));
          setAttempts(asNumber(payload.attemptsUsed));
          const measurements = payload.measurements as
            | { boundingBox?: { x: number; y: number; z: number }; solidCount?: number; volume?: number }
            | undefined;
          setSpecs(
            (
              [
                measurements?.boundingBox
                  ? [
                      "Size",
                      `${measurements.boundingBox.x.toFixed(1)} × ${measurements.boundingBox.y.toFixed(1)} × ${measurements.boundingBox.z.toFixed(1)} mm`,
                    ]
                  : ["", ""],
                ["Bodies", String(asNumber(measurements?.solidCount))],
                measurements?.volume
                  ? ["Volume", `${(measurements.volume / 1000).toFixed(1)} cm³`]
                  : ["", ""],
                ["Revision", String(asNumber(payload.revision))],
              ] as Array<[string, string]>
            ).filter(([key, value]) => key && value && value !== "0"),
          );
          const total = normalizeChatTokenUsage(payload.usage);
          if (total) {
            usageRef.current = total;
            setUsage(total);
          }
          break;
        }
        case "run.failed":
          setStatus("failed");
          setFailure(asString(payload.error, "The parametric CAD run failed."));
          setCompletedAt(event.at);
          break;
        case "run.aborted":
          setStatus("aborted");
          setFailure(asString(payload.summary, "The run was stopped."));
          setCompletedAt(event.at);
          break;
        default:
          break;
      }
    },
    [advance],
  );

  useEffect(() => {
    if (persistedOutcome && persistedOutcome !== "running") return;
    const source = new EventSource(`${base}/events`);
    const handler = (event: MessageEvent) => {
      try {
        applyEvent(JSON.parse(event.data) as RunEvent);
      } catch {
        // A malformed frame must not take the card down.
      }
    };
    for (const type of STREAMED_EVENT_TYPES) source.addEventListener(type, handler);
    source.onerror = () => source.close();
    return () => {
      for (const type of STREAMED_EVENT_TYPES) source.removeEventListener(type, handler);
      source.close();
    };
  }, [applyEvent, base, persistedOutcome]);

  useEffect(() => {
    if (!TERMINAL.has(status) || reportedRef.current) return;
    reportedRef.current = true;
    const content = status === "completed" ? result : failure;
    if (!content) return;
    notifyTaskCompleted(`Parametric CAD — ${designTitle || brief.slice(0, 80)}`);
    onTerminalRef.current?.({
      outcome: status as ExternalAgentTerminalOutcome,
      content,
      ...(usageRef.current ? { usage: usageRef.current } : {}),
    });
  }, [brief, designTitle, failure, result, status]);

  const running = !TERMINAL.has(status);
  const statusDot = running
    ? "animate-pulse bg-[var(--botanical-2)]"
    : status === "completed"
      ? "bg-[var(--botanical)]"
      : "bg-[var(--danger)]";
  const summary = splitSummary(result);
  const heading = designTitle || summary.title;
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.length - errors;
  const hasDetail = Boolean(
    specs.length ||
      safetyNotice ||
      running ||
      !result ||
      findings.length ||
      assumptions.length ||
      exports.length,
  );

  return (
    <>
      <AssistantResponseMeta
        active={running}
        failed={!running && status !== "completed"}
        agentName="Parametric CAD"
        usage={usage}
        startedAt={startedAt}
        completedAt={completedAt}
      />
      <div className="bb-agent-run-card overflow-hidden">
        <div className="bb-agent-run-header">
          <span className="bb-agent-run-title truncate">Parametric CAD</span>
          <div className="flex shrink-0 items-center gap-[8px]">
            <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
              <span className={`bb-agent-run-led h-1.5 w-1.5 ${statusDot}`} />
              {running ? "designing" : status}
            </span>
            {running ? (
              <button
                type="button"
                className="bb-agent-run-action"
                onClick={() => {
                  void fetch(`${base}/abort`, { method: "POST" });
                }}
              >
                Stop
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-[13px] p-[21px]">
          {heading ? (
            <div>
              <p className="truncate text-[16px] font-semibold leading-[1.4] text-[var(--ink-heading)]">
                {heading}
              </p>
              {designSummary ? (
                <p className="bb-agent-run-text mt-[5px] text-[var(--ink-muted)]">
                  {designSummary}
                </p>
              ) : null}
            </div>
          ) : null}

          {specs.length ? (
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(89px,1fr))] gap-x-[21px] gap-y-[13px]">
              {specs.map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="bb-agent-run-label">{key}</dt>
                  <dd className="text-[13px] font-medium leading-[1.4] text-[var(--ink-heading)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {safetyNotice ? (
            <p className="bb-agent-run-text text-[var(--danger)]">{safetyNotice}</p>
          ) : null}

          {running || !result ? (
            <ol className="bb-agent-run-inset space-y-[5px] p-[13px]">
              {STAGES.map((stage) => (
                <li key={stage.key} className="flex items-center gap-[8px]">
                  <span
                    aria-hidden="true"
                    className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                      stages[stage.key] === "done"
                        ? "bg-[var(--botanical)]"
                        : stages[stage.key] === "active"
                          ? "animate-pulse bg-[var(--botanical-2)]"
                          : "bg-[var(--line-strong)]"
                    }`}
                  />
                  <span
                    className={`text-[13px] leading-[1.618] ${
                      stages[stage.key] === "pending"
                        ? "text-[var(--ink-muted)]"
                        : "text-[var(--ink)]"
                    }`}
                  >
                    {stage.label}
                    {stage.key === "source" && attempts > 1 ? ` · attempt ${attempts}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {findings.length ? (
            <section className="space-y-[8px]">
              <p className="bb-agent-run-label">
                {[
                  errors ? `${errors} error${errors === 1 ? "" : "s"}` : "",
                  warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "Validation findings"}
              </p>
              <ul className="space-y-[8px]">
                {findings.map((finding, index) => (
                  <li
                    key={`${finding.code}-${index}`}
                    className="bb-agent-run-panel flex gap-[8px] p-[13px]"
                  >
                    <span
                      aria-hidden
                      className={`bb-agent-run-led mt-[7px] h-1.5 w-1.5 shrink-0 ${
                        finding.severity === "error"
                          ? "bg-[var(--danger)]"
                          : "bg-[var(--selection-yellow-line)]"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium leading-[1.4] text-[var(--ink-heading)]">
                        {finding.code}
                      </p>
                      <p className="bb-agent-run-text text-[var(--ink-muted)]">{finding.message}</p>
                      {finding.repairHint ? (
                        <p className="bb-agent-run-text text-[var(--botanical)]">
                          {finding.repairHint}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {assumptions.length ? (
            <section className="space-y-[5px]">
              <p className="bb-agent-run-label">Assumed, not stated</p>
              <ul className="space-y-[3px]">
                {assumptions.map((assumption) => (
                  <li key={assumption} className="bb-agent-run-text text-[var(--ink-muted)]">
                    {assumption}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {exports.length ? (
            <section className="space-y-[5px]">
              <p className="bb-agent-run-label">Exports</p>
              <p className="bb-agent-run-readout">
                {exports.map((format) => format.toUpperCase()).join("  ·  ")}
              </p>
            </section>
          ) : null}

          {summary.body ? (
            <div
              className={
                hasDetail
                  ? "bb-agent-run-text border-t border-[color-mix(in_srgb,var(--line)_55%,transparent)] pt-[21px]"
                  : "bb-agent-run-text"
              }
            >
              <ChatMarkdown content={summary.body} compact />
            </div>
          ) : null}

          {failure ? <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p> : null}
        </div>
      </div>
      {!running ? (
        <AssistantMessageActions content={result || failure} onRetry={onRetry} />
      ) : null}
    </>
  );
}
