"use client";

// A workflow that was taught rather than built, and running it again.
//
// This is what opens instead of the canvas when a workflow's source is a
// demonstration. It shows what the workflow learned, takes the inputs for a run,
// and — while a run is going — shows what the agent is doing, asks before the
// steps that need asking, and offers a Stop that actually stops.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DemonstratedProcedure,
  DemonstrationRunEvent,
  DemonstrationRunState,
} from "@/lib/teach/types";

const RUN_POLL_MS = 900;

interface DemonstratedDetail {
  id: string;
  name: string;
  description: string;
  version: number;
  updatedAt: string;
  procedure: DemonstratedProcedure;
  versions: Array<{ version: number; note: string; createdAt: string; demonstrationId: string | null }>;
  runs: Array<{
    runId: string;
    state: DemonstrationRunState;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
    inputs: Record<string, string>;
  }>;
  demonstrations: Array<{
    id: string;
    startedAt: string;
    durationMs: number;
    eventCount: number;
    transcriptAvailable: boolean;
    recordingRetained: boolean;
    isReteach: boolean;
  }>;
}

interface RunView {
  runId: string;
  state: DemonstrationRunState;
  events: DemonstrationRunEvent[];
  pendingApproval: { stepId: string; instruction: string; reason: string; target?: string } | null;
  error: string | null;
  live: boolean;
}

export default function DemonstratedWorkflow(props: {
  workflowId: string;
  initialRunId?: string | null;
  onBack: () => void;
  onReteach: () => void;
  onDelete: () => void;
}) {
  const [detail, setDetail] = useState<DemonstratedDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [run, setRun] = useState<RunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDemonstration, setShowDemonstration] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/workflows/${encodeURIComponent(props.workflowId)}/demonstration`,
        { cache: "no-store", signal },
      );
      const payload = (await response.json().catch(() => ({}))) as DemonstratedDetail & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "This workflow could not be opened.");
      setDetail(payload);
    },
    [props.workflowId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError((cause as Error).message);
    });
    return () => controller.abort();
  }, [load]);

  /* ---------------- running ---------------- */

  const pollRef = useRef<number | null>(null);

  const followRun = useCallback(
    (runId: string) => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      const poll = async (): Promise<void> => {
        try {
          const response = await fetch(
            `/api/workflows/${encodeURIComponent(props.workflowId)}/demonstration/runs/${encodeURIComponent(runId)}`,
            { cache: "no-store" },
          );
          const payload = (await response.json()) as RunView;
          setRun(payload);
          if (["completed", "failed", "stopped"].includes(payload.state)) {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            void load().catch(() => undefined);
          }
        } catch {
          // A missed tick is not a lost run; the record is on the server.
        }
      };
      void poll();
      pollRef.current = window.setInterval(() => void poll(), RUN_POLL_MS);
    },
    [load, props.workflowId],
  );

  useEffect(() => {
    if (props.initialRunId) followRun(props.initialRunId);
  }, [followRun, props.initialRunId]);

  useEffect(
    () => () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    },
    [],
  );

  const startRun = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workflows/${encodeURIComponent(props.workflowId)}/demonstration/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inputs }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!response.ok || !payload.runId) throw new Error(payload.error || "The run could not be started.");
      setRun({ runId: payload.runId, state: "queued", events: [], pendingApproval: null, error: null, live: true });
      followRun(payload.runId);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, followRun, inputs, props.workflowId]);

  const act = useCallback(
    async (action: "approve" | "reject" | "stop") => {
      if (!run) return;
      await fetch(
        `/api/workflows/${encodeURIComponent(props.workflowId)}/demonstration/runs/${encodeURIComponent(run.runId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        },
      ).catch(() => undefined);
    },
    [props.workflowId, run],
  );

  const procedure = detail?.procedure;
  const missing = useMemo(
    () =>
      (procedure?.inputs ?? [])
        .filter((input) => input.required && !(inputs[input.name] ?? "").trim())
        .map((input) => input.label),
    [inputs, procedure],
  );

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-sm text-[var(--ink-muted)]">{error}</p>
        <button
          type="button"
          onClick={props.onBack}
          className="neu-button mt-4 rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm"
        >
          Back to workflows
        </button>
      </div>
    );
  }

  if (!detail || !procedure) {
    return (
      <div className="p-8 text-center text-xs text-[var(--ink-muted)]">Opening this workflow…</div>
    );
  }

  const running = run !== null && ["queued", "running", "awaiting_approval"].includes(run.state);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6">
      <header className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[var(--ink-heading)]">{detail.name}</h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Learned from demonstration · version {detail.version}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={props.onReteach}
              className="neu-button rounded-xl border border-[var(--line)] px-3 py-2 text-xs"
            >
              Re-teach
            </button>
            <button
              type="button"
              onClick={props.onDelete}
              className="neu-button rounded-xl border border-[var(--line)] px-3 py-2 text-xs text-[var(--danger)]"
            >
              Delete
            </button>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-body)]">
          {procedure.description || procedure.goal}
        </p>
      </header>

      {/* Run */}
      <section className="neu-inset rounded-2xl border border-[var(--line)] p-5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">Run</h3>
        {procedure.inputs.length > 0 ? (
          <div className="mt-3 space-y-3">
            {procedure.inputs.map((input) => (
              <label key={input.name} className="block">
                <span className="text-sm text-[var(--ink-body)]">{input.label}</span>
                {input.notes ? (
                  <span className="ml-2 text-[11px] text-[var(--ink-muted)]">{input.notes}</span>
                ) : null}
                <input
                  value={inputs[input.name] ?? ""}
                  onChange={(event) =>
                    setInputs((current) => ({ ...current, [input.name]: event.target.value }))
                  }
                  disabled={running}
                  placeholder={
                    input.demonstratedValue ? `e.g. ${input.demonstratedValue}` : undefined
                  }
                  className="neu-input mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] px-3 py-2 text-sm disabled:opacity-60"
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--ink-muted)]">This workflow takes no inputs.</p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void startRun()}
            disabled={busy || running || missing.length > 0}
            className="neu-button-primary rounded-xl border px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            Run
          </button>
          {running ? (
            <button
              type="button"
              onClick={() => void act("stop")}
              className="neu-button rounded-xl border border-[var(--danger)]/50 px-4 py-2.5 text-sm font-medium text-[var(--danger)]"
            >
              Stop
            </button>
          ) : null}
          {missing.length > 0 ? (
            <span className="text-[11px] text-[var(--ink-muted)]">Needs {missing.join(", ")}</span>
          ) : null}
          {running ? (
            <span className="ml-auto flex items-center gap-2 text-[11px] text-[var(--ink-muted)]">
              <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[var(--botanical)]" />
              Breadboard is driving your desktop
            </span>
          ) : null}
        </div>

        {run?.pendingApproval ? (
          <div className="mt-4 rounded-xl border border-[var(--botanical)]/50 bg-[var(--paper-bg)] p-4">
            <p className="text-sm font-medium text-[var(--ink-heading)]">
              {run.pendingApproval.instruction}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              {run.pendingApproval.reason}
              {run.pendingApproval.target ? ` — ${run.pendingApproval.target}` : ""}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void act("approve")}
                className="neu-button-primary rounded-lg border px-3 py-1.5 text-xs font-medium"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => void act("reject")}
                className="neu-button rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--danger)]"
              >
                Reject
              </button>
            </div>
          </div>
        ) : null}

        {run && run.events.length > 0 ? (
          <ol className="mt-4 max-h-72 space-y-1 overflow-y-auto border-l border-[var(--line)] pl-3">
            {run.events.map((event) => (
              <li key={event.sequence} className="text-[11px] leading-5 text-[var(--ink-muted)]">
                <span
                  className={
                    event.type === "run.failed" || event.type === "step.failed"
                      ? "text-[var(--danger)]"
                      : event.type === "run.completed"
                        ? "text-[var(--botanical)]"
                        : ""
                  }
                >
                  {event.message}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {run?.error ? (
          <p className="mt-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
            {run.error}
          </p>
        ) : null}
      </section>

      <ReadOnlySection title="Steps">
        <ol className="space-y-1.5">
          {procedure.steps.map((step, index) => (
            <li key={step.id} className="text-sm leading-6 text-[var(--ink-body)]">
              <span className="mr-2 text-xs text-[var(--ink-muted)]">{index + 1}.</span>
              {step.instruction}
              {step.approvalRequired ? (
                <span className="ml-2 rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                  asks first
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </ReadOnlySection>

      {procedure.constraints.length > 0 ? (
        <ReadOnlySection title="Rules">
          <ul className="space-y-1">
            {procedure.constraints.map((constraint, index) => (
              <li key={index} className="text-sm leading-6 text-[var(--ink-body)]">
                {constraint.text}
              </li>
            ))}
          </ul>
        </ReadOnlySection>
      ) : null}

      {procedure.successCriteria.length > 0 ? (
        <ReadOnlySection title="Success condition">
          <ul className="space-y-1">
            {procedure.successCriteria.map((criterion, index) => (
              <li key={index} className="text-sm leading-6 text-[var(--ink-body)]">
                {criterion.text}
              </li>
            ))}
          </ul>
        </ReadOnlySection>
      ) : null}

      {detail.versions.length > 1 ? (
        <ReadOnlySection title="History">
          <ul className="space-y-1">
            {detail.versions.map((version) => (
              <li key={version.version} className="text-xs leading-5 text-[var(--ink-muted)]">
                v{version.version} · {version.note} ·{" "}
                {new Date(version.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </li>
            ))}
          </ul>
        </ReadOnlySection>
      ) : null}

      {detail.runs.length > 0 ? (
        <ReadOnlySection title="Recent runs">
          <ul className="space-y-1">
            {detail.runs.map((entry) => (
              <li key={entry.runId} className="text-xs leading-5 text-[var(--ink-muted)]">
                {entry.state} ·{" "}
                {new Date(entry.startedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {entry.error ? ` · ${entry.error}` : ""}
              </li>
            ))}
          </ul>
        </ReadOnlySection>
      ) : null}

      <section className="neu-inset rounded-2xl border border-[var(--line)] p-5">
        <button
          type="button"
          onClick={() => setShowDemonstration((current) => !current)}
          className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)] underline underline-offset-4"
        >
          {showDemonstration ? "Hide demonstration" : "View demonstration"}
        </button>
        {showDemonstration ? (
          <div className="mt-3 space-y-2">
            {detail.demonstrations.map((entry) => (
              <p key={entry.id} className="text-xs leading-5 text-[var(--ink-muted)]">
                {entry.isReteach ? "Re-teach" : "First demonstration"} ·{" "}
                {new Date(entry.startedAt).toLocaleString()} · {Math.round(entry.durationMs / 1000)}s ·{" "}
                {entry.eventCount} actions
                {entry.transcriptAvailable ? " · narrated" : ""}
                {entry.recordingRetained
                  ? ""
                  : " · the recording was deleted once this workflow was built from it"}
              </p>
            ))}
            <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
              A demonstrated workflow runs from what it learned, not from the recording, so it keeps
              working after the recording is gone.
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ReadOnlySection(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="neu-inset rounded-2xl border border-[var(--line)] p-5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
        {props.title}
      </h3>
      <div className="mt-3">{props.children}</div>
    </section>
  );
}
