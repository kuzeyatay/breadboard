"use client";

// The Hardware Blueprint run card.
//
// The card shows the compile pipeline as it runs and then hands off: the design
// lives in the artifact, not in the transcript, so the finished card is a short
// result line plus a button that opens the blueprint.
//
// Styling uses the shared run material (bb-agent-run-*) so this card reads as
// the same object as every other external-agent run: a flat sheet, a ruled
// header, and results printed straight onto the card rather than into a nested
// panel. Nothing in the body repeats what the header or the artifact already
// says.

import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import ChatMarkdown from "@/app/components/chat-markdown";
import type {
  ExternalAgentOutcome,
  ExternalAgentTerminalOutcome,
  ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";

interface RunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const STAGES = [
  { key: "interpret", label: "Reading the request" },
  { key: "research", label: "Researching missing parts" },
  { key: "compile", label: "Compiling the circuit" },
  { key: "validation", label: "Validating electrically" },
  { key: "firmware", label: "Generating firmware" },
  { key: "artifact", label: "Building the blueprint" },
] as const;

/** Shown only when the brief asked for a case, so a circuit-only run reads clean. */
const ENCLOSURE_STAGE = { key: "enclosure", label: "Designing the physical product" } as const;

type StageKey = (typeof STAGES)[number]["key"];
type StageState = "pending" | "active" | "done";

const STREAMED_EVENT_TYPES = [
  "run.started",
  "safety.limited",
  "interpret.started",
  "interpret.completed",
  "component-discovery.started",
  "component-discovery.completed",
  "compile.started",
  "compile.completed",
  "validation.completed",
  "firmware.started",
  "firmware.completed",
  "enclosure.started",
  "enclosure.completed",
  "enclosure.failed",
  "enclosure.skipped",
  "artifact.ready",
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

interface PersistedBlueprintState {
  designTitle: string;
  designSummary: string;
  note: string;
  safetyNotice: string;
  pins: Array<{ pin: string; purpose: string }>;
  counts: { errors: number; warnings: number; info: number };
  findings: Finding[];
  specs: Array<[string, string]>;
  firmwareFiles: string[];
  firmwareNotice: string;
  enclosureTitle: string;
  enclosureNotice: string;
  startedAt?: string;
  completedAt?: string;
}

function persistedBlueprintState(value: unknown): PersistedBlueprintState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== "hardware-blueprint") return null;
  const rawCounts =
    row.counts && typeof row.counts === "object" && !Array.isArray(row.counts)
      ? (row.counts as Record<string, unknown>)
      : {};
  const specs = Array.isArray(row.specs)
    ? row.specs
        .map((entry): [string, string] | null =>
          Array.isArray(entry) && entry.length >= 2
            ? [asString(entry[0]), asString(entry[1])]
            : null,
        )
        .filter((entry): entry is [string, string] => Boolean(entry?.[0] && entry[1]))
    : [];
  const pins = Array.isArray(row.pins)
    ? row.pins
        .map((entry) => {
          const pin = (entry ?? {}) as Record<string, unknown>;
          return { pin: asString(pin.pin), purpose: asString(pin.purpose) };
        })
        .filter((entry) => entry.pin)
    : [];
  return {
    designTitle: asString(row.designTitle),
    designSummary: asString(row.designSummary),
    note: asString(row.note),
    safetyNotice: asString(row.safetyNotice),
    pins,
    counts: {
      errors: asNumber(rawCounts.errors),
      warnings: asNumber(rawCounts.warnings),
      info: asNumber(rawCounts.info),
    },
    findings: asFindings(row.findings),
    specs,
    firmwareFiles: asStringList(row.firmwareFiles),
    firmwareNotice: asString(row.firmwareNotice),
    enclosureTitle: asString(row.enclosureTitle),
    enclosureNotice: asString(row.enclosureNotice),
    ...(asString(row.startedAt) ? { startedAt: asString(row.startedAt) } : {}),
    ...(asString(row.completedAt) ? { completedAt: asString(row.completedAt) } : {}),
  };
}

/** One thing validation wants you to know before you build. */
interface Finding {
  id: string;
  severity: "error" | "warning";
  title: string;
  message: string;
  remediation?: string;
}

function asFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const severity = row.severity === "error" ? "error" : "warning";
      return {
        id: asString(row.id) || asString(row.title),
        severity: severity as Finding["severity"],
        title: asString(row.title),
        message: asString(row.message),
        ...(asString(row.remediation) ? { remediation: asString(row.remediation) } : {}),
      };
    })
    .filter((finding) => finding.title || finding.message);
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

export default function InlineHardwareBlueprintRun({
  runId,
  brief,
  persistedContent = "",
  persistedOutcome,
  persistedUsage,
  persistedState,
  onTerminal,
  onRetry,
}: {
  runId: string;
  brief: string;
  persistedContent?: string;
  persistedOutcome?: ExternalAgentOutcome;
  persistedUsage?: ChatTokenUsage;
  persistedState?: Record<string, unknown>;
  onTerminal?: (result: ExternalAgentTerminalResult) => void;
  onRetry?: () => void;
}) {
  const restored = persistedBlueprintState(persistedState);
  const [status, setStatus] = useState(
    persistedOutcome && persistedOutcome !== "running" ? persistedOutcome : "starting",
  );
  const [stages, setStages] = useState<Record<StageKey, StageState>>({
    interpret: "pending",
    research: "pending",
    compile: "pending",
    validation: "pending",
    firmware: "pending",
    artifact: "pending",
  });
  const [note, setNote] = useState(restored?.note ?? "");
  const [safetyNotice, setSafetyNotice] = useState(restored?.safetyNotice ?? "");
  const [pins, setPins] = useState<Array<{ pin: string; purpose: string }>>(restored?.pins ?? []);
  const [counts, setCounts] = useState(restored?.counts ?? { errors: 0, warnings: 0, info: 0 });
  const [findings, setFindings] = useState<Finding[]>(restored?.findings ?? []);
  const [specs, setSpecs] = useState<Array<[string, string]>>(restored?.specs ?? []);
  const [firmwareFiles, setFirmwareFiles] = useState<string[]>(restored?.firmwareFiles ?? []);
  const [firmwareNotice, setFirmwareNotice] = useState(restored?.firmwareNotice ?? "");
  const [enclosureState, setEnclosureState] = useState<StageState | null>(null);
  const [enclosureTitle, setEnclosureTitle] = useState(restored?.enclosureTitle ?? "");
  const [enclosureNotice, setEnclosureNotice] = useState(restored?.enclosureNotice ?? "");
  const [designTitle, setDesignTitle] = useState(restored?.designTitle ?? "");
  const [designSummary, setDesignSummary] = useState(restored?.designSummary ?? "");
  const [result, setResult] = useState(
    persistedOutcome === "completed" ? persistedContent : "",
  );
  const [failure, setFailure] = useState(
    persistedOutcome === "failed" || persistedOutcome === "aborted" ? persistedContent : "",
  );
  const [usage, setUsage] = useState<ChatTokenUsage | undefined>(persistedUsage);
  // The run's own clock: the first event stamps the start so the Thinking line
  // ticks from when the compile actually began, not from when this card mounted.
  const [startedAt, setStartedAt] = useState<string | undefined>(restored?.startedAt);
  const [completedAt, setCompletedAt] = useState<string | undefined>(restored?.completedAt);
  const onTerminalRef = useRef(onTerminal);
  const usageRef = useRef(usage);
  const reportedRef = useRef(false);
  const base = `/api/hardware-blueprint/runs/${runId}`;

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    reportedRef.current = false;
  }, [runId]);

  const advance = useCallback((key: StageKey, state: StageState) => {
    setStages((current) => ({ ...current, [key]: state }));
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
          setSafetyNotice(
            `${asString(payload.category)} — ${asString(payload.reason)}`,
          );
          break;
        case "interpret.started":
          advance("interpret", "active");
          break;
        case "interpret.completed": {
          advance("interpret", "done");
          const applied = Array.isArray(payload.applied) ? (payload.applied as string[]) : [];
          setNote(
            [asString(payload.note), ...applied].filter(Boolean).join(" ").slice(0, 400),
          );
          break;
        }
        case "component-discovery.started":
          advance("research", "active");
          break;
        case "component-discovery.completed":
          advance("research", "done");
          break;
        case "compile.started":
          advance("compile", "active");
          break;
        case "compile.completed":
          advance("compile", "done");
          setPins(
            Array.isArray(payload.pins)
              ? (payload.pins as Array<{ pin?: unknown; purpose?: unknown }>)
                  .map((entry) => ({
                    pin: asString(entry.pin),
                    purpose: asString(entry.purpose),
                  }))
                  .filter((entry) => entry.pin)
              : [],
          );
          setSpecs(
            (
              [
                ["Controller", asString(payload.controller)],
                [
                  "Parts",
                  asNumber(payload.componentCount)
                    ? String(asNumber(payload.componentCount))
                    : "",
                ],
                ["Nets", asNumber(payload.netCount) ? String(asNumber(payload.netCount)) : ""],
              ] as Array<[string, string]>
            ).filter(([, value]) => value),
          );
          break;
        case "validation.completed":
          advance("validation", "done");
          setCounts({
            errors: asNumber(payload.errors),
            warnings: asNumber(payload.warnings),
            info: asNumber(payload.info),
          });
          setFindings(asFindings(payload.findings));
          break;
        case "firmware.started":
          advance("firmware", "active");
          break;
        case "firmware.completed":
          advance("firmware", "done");
          setFirmwareFiles(asStringList(payload.files));
          setFirmwareNotice(asString(payload.notice));
          break;
        case "enclosure.started":
          setEnclosureState("active");
          break;
        case "enclosure.completed":
          setEnclosureState("done");
          setEnclosureTitle(asString(payload.title));
          break;
        case "enclosure.failed":
        case "enclosure.skipped":
          setEnclosureState("done");
          setEnclosureNotice(asString(payload.reason));
          break;
        case "artifact.ready":
          advance("artifact", "done");
          break;
        case "artifact.unavailable":
          advance("artifact", "done");
          break;
        case "run.completed": {
          setStatus("completed");
          setResult(asString(payload.summary));
          setDesignTitle(asString(payload.designTitle));
          setDesignSummary(asString(payload.designSummary));
          setCompletedAt(event.at);
          if (asString(payload.enclosureTitle)) {
            setEnclosureTitle(asString(payload.enclosureTitle));
            setEnclosureState("done");
          }
          if (Array.isArray(payload.findings)) setFindings(asFindings(payload.findings));
          if (asStringList(payload.firmwareFiles).length) {
            setFirmwareFiles(asStringList(payload.firmwareFiles));
          }
          setSpecs(
            (
              [
                ["Controller", asString(payload.controller)],
                ["Parts", asNumber(payload.partCount) ? String(asNumber(payload.partCount)) : ""],
                ["Nets", asNumber(payload.netCount) ? String(asNumber(payload.netCount)) : ""],
                [
                  "Typical draw",
                  asNumber(payload.typicalCurrentMa)
                    ? `${asNumber(payload.typicalCurrentMa)} mA`
                    : "",
                ],
              ] as Array<[string, string]>
            ).filter(([, value]) => value),
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
          setFailure(asString(payload.error, "The hardware blueprint run failed."));
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
    notifyTaskCompleted(
      `Hardware Blueprint — ${designTitle || brief.slice(0, 80)}`,
    );
    onTerminalRef.current?.({
      outcome: status as ExternalAgentTerminalOutcome,
      content,
      ...(usageRef.current ? { usage: usageRef.current } : {}),
      state: {
        kind: "hardware-blueprint",
        designTitle,
        designSummary,
        note,
        safetyNotice,
        pins,
        counts,
        findings,
        specs,
        firmwareFiles,
        firmwareNotice,
        enclosureTitle,
        enclosureNotice,
        ...(startedAt ? { startedAt } : {}),
        ...(completedAt ? { completedAt } : {}),
      },
    });
  }, [brief, completedAt, counts, designSummary, designTitle, enclosureNotice, enclosureTitle, failure, findings, firmwareFiles, firmwareNotice, note, pins, result, safetyNotice, specs, startedAt, status]);

  const running = !TERMINAL.has(status);
  // `completed` is the transport lifecycle (the worker reached a terminal
  // result), not an engineering verdict.  Showing a green "Completed" badge
  // beside a blueprint with blocking findings made an invalid circuit look
  // build-ready.  Keep the durable terminal outcome unchanged, but make the
  // card report the design verdict people actually need to act on.
  const needsChanges = !running && status === "completed" && counts.errors > 0;
  const statusDot = running
    ? "animate-pulse bg-[var(--botanical-2)]"
    : status === "completed" && !needsChanges
      ? "bg-[var(--botanical)]"
      : "bg-[var(--danger)]";
  // A restored transcript has no run events, so the design's name comes back out
  // of the saved summary rather than from `designTitle`. Empty until one exists.
  const summary = splitSummary(result);
  const heading = designTitle || summary.title;
  // A restored transcript has only the name and the written result. With nothing
  // between them there is nothing to divide, and a rule across an otherwise
  // empty card is what makes it look unfinished.
  const hasDetail = Boolean(
    specs.length ||
      safetyNotice ||
      running ||
      !result ||
      note ||
      findings.length ||
      counts.errors ||
      counts.warnings ||
      pins.length ||
      firmwareFiles.length ||
      firmwareNotice ||
      enclosureState ||
      enclosureTitle,
  );

  return (
    <>
    <AssistantResponseMeta
      active={running}
      failed={!running && (status !== "completed" || needsChanges)}
      agentName="Hardware Blueprint"
      usage={usage}
      startedAt={startedAt}
      completedAt={completedAt}
    />
    <div className="bb-agent-run-card overflow-hidden">
      {/* The header names the agent, the way every run card does; the design it
          produced is named on the first line of the body. The brief is not
          repeated anywhere — it is the user's own message just above. */}
      <div className="bb-agent-run-header">
        <span className="bb-agent-run-title truncate">Hardware Blueprint</span>
        <div className="flex shrink-0 items-center gap-[8px]">
          <span className="bb-agent-run-label inline-flex items-center gap-1.5 capitalize">
            <span className={`bb-agent-run-led h-1.5 w-1.5 ${statusDot}`} />
            {running ? "compiling" : needsChanges ? "needs changes" : status}
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

        {/* What was actually built: controller, part and net counts, draw. */}
        {specs.length ? (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(89px,1fr))] gap-x-[21px] gap-y-[13px]">
            {specs.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="bb-agent-run-label">{label}</dt>
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

        {/* The compile log: a lamped stage list, so a card that is still working
            says exactly where it is, and a finished one is a record of the run. */}
        {running || !result ? (
          <ol className="bb-agent-run-inset space-y-[5px] p-[13px]">
            {[
              ...STAGES.map((stage) => ({ ...stage, state: stages[stage.key] })),
              ...(enclosureState
                ? [{ ...ENCLOSURE_STAGE, state: enclosureState }]
                : []),
            ].map((stage) => (
              <li key={stage.key} className="flex items-center gap-[8px]">
                <span
                  aria-hidden="true"
                  className={`bb-agent-run-led h-1.5 w-1.5 shrink-0 ${
                    stage.state === "done"
                      ? "bg-[var(--botanical)]"
                      : stage.state === "active"
                        ? "animate-pulse bg-[var(--botanical-2)]"
                        : "bg-[var(--line-strong)]"
                  }`}
                />
                <span
                  className={`text-[13px] leading-[1.618] ${
                    stage.state === "pending" ? "text-[var(--ink-muted)]" : "text-[var(--ink)]"
                  }`}
                >
                  {stage.label}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {note ? <p className="bb-agent-run-text text-[var(--ink-muted)]">{note}</p> : null}

        {/* The findings themselves, not a count of them: what validation caught,
            why it matters, and what to do about it. */}
        {findings.length ? (
          <section className="space-y-[8px]">
            <p className="bb-agent-run-label">
              {[
                counts.errors ? `${counts.errors} error${counts.errors === 1 ? "" : "s"}` : "",
                counts.warnings
                  ? `${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ") || "Validation findings"}
            </p>
            <ul className="space-y-[8px]">
              {findings.map((finding) => (
                <li
                  key={finding.id}
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
                      {finding.title}
                    </p>
                    <p className="bb-agent-run-text text-[var(--ink-muted)]">
                      {finding.message}
                    </p>
                    {finding.remediation ? (
                      <p className="bb-agent-run-text text-[var(--botanical)]">
                        {finding.remediation}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : counts.errors || counts.warnings ? (
          <p className="bb-agent-run-label">
            {[
              counts.errors ? `${counts.errors} error${counts.errors === 1 ? "" : "s"}` : "",
              counts.warnings
                ? `${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}

        {pins.length ? (
          <section className="space-y-[5px]">
            <p className="bb-agent-run-label">Pin map</p>
            <p className="bb-agent-run-inset bb-agent-run-readout p-[13px]">
              {pins.map((entry) => `${entry.pin} ${entry.purpose}`).join("  ·  ")}
            </p>
          </section>
        ) : null}

        {firmwareFiles.length || firmwareNotice ? (
          <section className="space-y-[5px]">
            <p className="bb-agent-run-label">
              Firmware
              {firmwareFiles.length
                ? ` · ${firmwareFiles.length} file${firmwareFiles.length === 1 ? "" : "s"}`
                : ""}
            </p>
            {firmwareFiles.length ? (
              <p className="bb-agent-run-readout">{firmwareFiles.join("  ·  ")}</p>
            ) : null}
            {firmwareNotice ? (
              <p className="bb-agent-run-text text-[var(--ink-muted)]">{firmwareNotice}</p>
            ) : null}
          </section>
        ) : null}

        {enclosureTitle || enclosureNotice ? (
          <section className="space-y-[5px]">
            <p className="bb-agent-run-label">Physical design</p>
            {enclosureTitle ? (
              <p className="bb-agent-run-text text-[var(--ink)]">
                {enclosureTitle} — designed by the Parametric CAD agent; its own card is below.
              </p>
            ) : null}
            {enclosureNotice ? (
              <p className="bb-agent-run-text text-[var(--ink-muted)]">{enclosureNotice}</p>
            ) : null}
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

        {failure ? (
          <p className="bb-agent-run-text text-[var(--danger)]">{failure}</p>
        ) : null}
      </div>
    </div>
    {/* Copy/read/retry belong to the assistant turn, not to the run card, so
        they sit under it the way they do for every other agent. */}
    {!running ? (
      <AssistantMessageActions content={result || failure} onRetry={onRetry} />
    ) : null}
    </>
  );
}
