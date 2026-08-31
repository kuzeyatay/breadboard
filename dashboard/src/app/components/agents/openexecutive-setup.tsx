"use client";

import { useCallback, useEffect, useState } from "react";

interface SetupAction {
  id: string;
  label: string;
  unlocks: string;
}
interface Health {
  available: boolean;
  cloned: boolean;
  root: string | null;
  environmentReady: boolean;
  bridgeFound: boolean;
  reason: string | null;
  setupActions: SetupAction[];
}

export default function OpenExecutiveSetup() {
  const [health, setHealth] = useState<Health | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/openexecutive/health", { cache: "no-store", signal });
      const payload = (await response.json()) as Partial<Health>;
      if (!response.ok) throw new Error("Open Executive status is unavailable.");
      setHealth({
        available: payload.available === true,
        cloned: payload.cloned === true,
        root: typeof payload.root === "string" ? payload.root : null,
        environmentReady: payload.environmentReady === true,
        bridgeFound: payload.bridgeFound === true,
        reason: typeof payload.reason === "string" ? payload.reason : null,
        setupActions: Array.isArray(payload.setupActions) ? payload.setupActions : [],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setHealth({
        available: false,
        cloned: false,
        root: null,
        environmentReady: false,
        bridgeFound: false,
        reason: error instanceof Error ? error.message : "Open Executive status is unavailable.",
        setupActions: [],
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function runSetup(action: SetupAction) {
    setRunning(action.id);
    setNotice(`${action.label}…`);
    setDetail("");
    try {
      const response = await fetch("/api/openexecutive/setup", {
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
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That setup step could not run.");
    } finally {
      setRunning(null);
    }
  }

  const status = !health
    ? "Checking clone"
    : health.available
      ? "Ready"
      : health.cloned
        ? "Needs setup"
        : "Not cloned";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] ${
            health?.available
              ? "bg-[var(--paper-strong)] text-[var(--botanical)]"
              : "bg-[#f5e8df] text-[#9a4e43] dark:bg-[#4c302c] dark:text-[#efb4aa]"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {status}
        </span>
        <span className="text-[11px] text-[var(--ink-muted)]">
          Eight specialist executives · isolated local memory
        </span>
      </div>
      {health?.root ? (
        <p className="neu-surface-subtle truncate rounded-xl px-3 py-2 text-[11px] text-[var(--ink-muted)]">
          <span className="font-medium text-[var(--ink-heading)]">Source</span> {health.root}
        </p>
      ) : null}
      {health?.reason ? (
        <p className="text-[11px] leading-5 text-[#9a4e43] dark:text-[#efb4aa]">{health.reason}</p>
      ) : null}
      {health?.cloned ? (
        <div className="flex flex-wrap gap-2">
          {health.setupActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => void runSetup(action)}
              disabled={Boolean(running)}
              title={action.unlocks}
              className="neu-button rounded-xl px-3 py-2 text-xs text-[var(--ink-heading)] disabled:opacity-50"
            >
              {running === action.id
                ? "Working…"
                : action.id === "install" && health.environmentReady
                  ? `${action.label} ✓`
                  : action.label}
            </button>
          ))}
        </div>
      ) : null}
      {notice ? <p className="text-[11px] leading-5 text-[var(--botanical)]" role="status">{notice}</p> : null}
      {detail ? <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--paper-strong)] p-2 text-[10px] leading-4 text-[var(--ink-muted)]">{detail}</pre> : null}
    </div>
  );
}
