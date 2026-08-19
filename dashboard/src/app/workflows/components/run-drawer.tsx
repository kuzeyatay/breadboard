"use client";

// Bottom drawer: run input prompt, Run button (POST .../execute), result
// output, and per-block logs. Opens automatically when a run starts.

import { useState } from "react";
import { useRunStore } from "../stores/run-store";

function formatOutput(output: unknown): string {
  if (output === null || output === undefined) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function RunDrawer({ workflowId }: { workflowId: string }) {
  const status = useRunStore((state) => state.status);
  const runId = useRunStore((state) => state.runId);
  const logs = useRunStore((state) => state.logs);
  const output = useRunStore((state) => state.output);
  const error = useRunStore((state) => state.error);
  const drawerOpen = useRunStore((state) => state.drawerOpen);
  const setDrawerOpen = useRunStore((state) => state.setDrawerOpen);
  const startRun = useRunStore((state) => state.start);
  const finishRun = useRunStore((state) => state.finish);
  const [input, setInput] = useState("");

  async function runWorkflow() {
    startRun();
    try {
      const response = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: input.trim() || undefined }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        output?: unknown;
        logs?: Array<Record<string, unknown>>;
        runId?: string;
      };
      if (!response.ok || payload.success === false) {
        finishRun({
          status: "error",
          error: payload.error || `The workflow could not run (${response.status}).`,
          logs: (payload.logs as never) ?? [],
          runId: payload.runId ?? null,
        });
        return;
      }
      finishRun({
        status: "success",
        output: payload.output ?? payload,
        logs: (payload.logs as never) ?? [],
        runId: payload.runId ?? null,
      });
    } catch (cause) {
      finishRun({
        status: "error",
        error: cause instanceof Error ? cause.message : "The workflow could not run.",
      });
    }
  }

  if (!drawerOpen) {
    return (
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="neu-button-primary absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-lg"
      >
        <PlayIcon /> Run
      </button>
    );
  }

  return (
    <div className="neu-surface-raised absolute inset-x-3 bottom-3 z-10 flex max-h-[45%] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] shadow-xl">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Optional input for this run…"
            disabled={status === "running"}
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-1.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={runWorkflow}
            disabled={status === "running"}
            className="neu-button-primary flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlayIcon /> {status === "running" ? "Running…" : "Run"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close run panel"
          className="neu-button-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)]"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {status === "idle" ? (
          <p className="text-xs text-[var(--ink-muted)]">Run this workflow to see its output and per-block logs here.</p>
        ) : null}
        {error ? (
          <div className="mb-3 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">{error}</div>
        ) : null}
        {output !== null && output !== undefined ? (
          <div className="mb-3">
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">Output</h4>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--paper-surface)] p-2.5 font-mono text-xs text-[var(--ink)]">
              {formatOutput(output)}
            </pre>
          </div>
        ) : null}
        {logs.length ? (
          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
              Block logs {runId ? <span className="normal-case text-[var(--ink-faint)]">· {runId}</span> : null}
            </h4>
            <ul className="space-y-1">
              {logs.map((log, index) => (
                <li
                  key={`${log.blockId ?? index}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-[var(--paper-surface)] px-2.5 py-1.5 text-xs"
                >
                  <span className="min-w-0 truncate text-[var(--ink)]">{log.blockName ?? log.blockId ?? `Block ${index + 1}`}</span>
                  <span
                    className={
                      log.success === false || log.status === "error"
                        ? "shrink-0 text-[var(--danger)]"
                        : "shrink-0 text-[var(--botanical)]"
                    }
                  >
                    {log.success === false || log.status === "error" ? "Error" : "OK"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
