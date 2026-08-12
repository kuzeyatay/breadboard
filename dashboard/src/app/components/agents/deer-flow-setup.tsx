"use client";

// DeerFlow setup: whether the cloned harness can run, and the steps only the
// user can authorize. A run never installs anything — the environment is over a
// gigabyte of Python, and that is a decision worth asking for rather than
// taking.

import { useCallback, useEffect, useState } from "react";

interface Health {
  available: boolean;
  cloned: boolean;
  root: string | null;
  environmentReady: boolean;
  packageInstalled: boolean;
  uvAvailable: boolean;
  version: string | null;
  serviceRunning: boolean;
  reason: string | null;
}

const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks:
      "Creates deer-flow/backend/.venv and installs the Gateway and the agent harness. Takes several minutes.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Re-syncs the environment against the clone's current lockfile.",
  },
  {
    id: "stop",
    label: "Stop the Gateway",
    unlocks: "Stops the supervised DeerFlow process. The next run starts a fresh one.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks: "Deletes deer-flow/backend/.venv. Nothing else in the clone is touched.",
  },
] as const;

const EMPTY: Health = {
  available: false,
  cloned: false,
  root: null,
  environmentReady: false,
  packageInstalled: false,
  uvAvailable: false,
  version: null,
  serviceRunning: false,
  reason: null,
};

function statusOf(health: Health | null): { label: string; ready: boolean } {
  if (!health) return { label: "Checking clone", ready: false };
  if (!health.cloned) return { label: "Not cloned", ready: false };
  if (!health.environmentReady) return { label: "Needs setup", ready: false };
  if (!health.packageInstalled) return { label: "Install incomplete", ready: false };
  return { label: health.serviceRunning ? "Running" : "Ready", ready: true };
}

export default function DeerFlowSetup() {
  const [health, setHealth] = useState<Health | null>(null);
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState("");
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/deer-flow/health${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as Partial<Health>;
      if (!response.ok) throw new Error("DeerFlow status is unavailable.");
      setHealth({
        ...EMPTY,
        available: payload.available === true,
        cloned: payload.cloned === true,
        root: typeof payload.root === "string" ? payload.root : null,
        environmentReady: payload.environmentReady === true,
        packageInstalled: payload.packageInstalled === true,
        uvAvailable: payload.uvAvailable === true,
        version: typeof payload.version === "string" ? payload.version : null,
        serviceRunning: payload.serviceRunning === true,
        reason: typeof payload.reason === "string" ? payload.reason : null,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setHealth({
        ...EMPTY,
        reason: error instanceof Error ? error.message : "DeerFlow status is unavailable.",
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  async function runSetup(action: (typeof SETUP_ACTIONS)[number]) {
    setRunning(action.id);
    setNotice(
      action.id === "install"
        ? "Building the environment. This takes several minutes — you can close this panel."
        : `${action.label}…`,
    );
    setDetail("");
    try {
      const response = await fetch("/api/deer-flow/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: action.id }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: { ok?: boolean; message?: string; detail?: string };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "That setup step could not run.");
      }
      setNotice(payload.result?.message ?? `${action.label} finished.`);
      setDetail(payload.result?.ok === false ? (payload.result.detail ?? "") : "");
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That setup step could not run.");
    } finally {
      setRunning(null);
    }
  }

  const status = statusOf(health);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] ${
            status.ready
              ? "bg-[var(--paper-strong)] text-[var(--botanical)]"
              : "bg-[#f5e8df] text-[#9a4e43] dark:bg-[#4c302c] dark:text-[#efb4aa]"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${status.ready ? "bg-[var(--botanical)]" : "bg-current"}`}
          />
          {status.label}
        </span>
        <span className="text-[11px] text-[var(--ink-muted)]">
          {health?.version ? `DeerFlow ${health.version}` : "Cloned DeerFlow"}
        </span>
      </div>

      {/* What the agent is, stated before anything technical: this is the whole
          reason someone would build a gigabyte of Python for it. */}
      <p className="neu-surface-subtle rounded-xl px-3 py-2 text-[11px] leading-5 text-[var(--ink-muted)]">
        <span className="font-medium text-[var(--ink-heading)]">Runs</span> the cloned DeerFlow
        harness on ChatMock: one lead agent with a per-task workspace, delegated subagents, skills
        and memory. Files it produces are kept as artifacts of the chat that asked for them.
      </p>

      {health?.root ? (
        <p className="neu-surface-subtle truncate rounded-xl px-3 py-2 text-[11px] text-[var(--ink-muted)]">
          <span className="font-medium text-[var(--ink-heading)]">Clone</span> {health.root}
        </p>
      ) : null}

      {health?.reason ? (
        <p className="text-[11px] leading-5 text-[#9a4e43] dark:text-[#efb4aa]">{health.reason}</p>
      ) : null}
      {health?.cloned && !health.uvAvailable && !health.environmentReady ? (
        <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
          Building the environment needs uv: DeerFlow&apos;s backend is a uv workspace, and its two
          local packages only install through it. Install uv from docs.astral.sh/uv, then reopen
          this panel.
        </p>
      ) : null}

      {health?.cloned ? (
        <div className="flex flex-wrap gap-2">
          {SETUP_ACTIONS.map((action) => {
            const done = action.id === "install" && health.packageInstalled;
            const hidden =
              (action.id === "remove" && !health.environmentReady) ||
              (action.id === "stop" && !health.serviceRunning);
            if (hidden) return null;
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => void runSetup(action)}
                disabled={Boolean(running)}
                title={action.unlocks}
                className="neu-button rounded-xl px-3 py-2 text-xs text-[var(--ink-heading)] disabled:opacity-50"
              >
                {running === action.id ? "Working…" : done ? `${action.label} ✓` : action.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {notice ? (
        <p className="text-[11px] leading-5 text-[var(--botanical)]" role="status">
          {notice}
        </p>
      ) : null}
      {detail ? (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--paper-strong)] p-2 text-[10px] leading-4 text-[var(--ink-muted)]">
          {detail}
        </pre>
      ) : null}
    </div>
  );
}
