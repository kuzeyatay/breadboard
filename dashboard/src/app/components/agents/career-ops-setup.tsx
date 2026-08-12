"use client";

// Career Ops setup: what the job-search workspace looks like right now, and the
// three steps only the user can authorize. A run never installs anything — that
// separation is why this exists at all, and why it sits in the agent's settings
// panel rather than happening quietly before a run.

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
  dependenciesInstalled: boolean;
  browsersInstalled: boolean;
  onboardingNeeded: boolean | null;
  warnings: string[];
  modeCount: number;
  trackedApplications: number | null;
  reason: string | null;
  setupActions: SetupAction[];
}

function statusOf(health: Health | null): { label: string; ready: boolean } {
  if (!health) return { label: "Checking clone", ready: false };
  if (!health.cloned) return { label: "Not cloned", ready: false };
  if (!health.dependenciesInstalled) return { label: "Needs setup", ready: false };
  if (health.onboardingNeeded) return { label: "Needs your CV", ready: false };
  return { label: "Ready", ready: true };
}

export default function CareerOpsSetup() {
  const [health, setHealth] = useState<Health | null>(null);
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState("");
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/career-ops/health${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as Partial<Health>;
      if (!response.ok) throw new Error("Career Ops status is unavailable.");
      setHealth({
        available: payload.available === true,
        cloned: payload.cloned === true,
        root: typeof payload.root === "string" ? payload.root : null,
        dependenciesInstalled: payload.dependenciesInstalled === true,
        browsersInstalled: payload.browsersInstalled === true,
        onboardingNeeded:
          typeof payload.onboardingNeeded === "boolean" ? payload.onboardingNeeded : null,
        warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
        modeCount: typeof payload.modeCount === "number" ? payload.modeCount : 0,
        trackedApplications:
          typeof payload.trackedApplications === "number" ? payload.trackedApplications : null,
        reason: typeof payload.reason === "string" ? payload.reason : null,
        setupActions: Array.isArray(payload.setupActions) ? payload.setupActions : [],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setHealth({
        available: false,
        cloned: false,
        root: null,
        dependenciesInstalled: false,
        browsersInstalled: false,
        onboardingNeeded: null,
        warnings: [],
        modeCount: 0,
        trackedApplications: null,
        reason: error instanceof Error ? error.message : "Career Ops status is unavailable.",
        setupActions: [],
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  async function runSetup(action: SetupAction) {
    setRunning(action.id);
    setNotice(`${action.label}…`);
    setDetail("");
    try {
      const response = await fetch("/api/career-ops/setup", {
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
          {health?.trackedApplications === null || health === null
            ? "No tracker yet"
            : `${health.trackedApplications} application${health.trackedApplications === 1 ? "" : "s"} tracked · ${health.modeCount} modes`}
        </span>
      </div>

      {health?.root ? (
        <p className="neu-surface-subtle truncate rounded-xl px-3 py-2 text-[11px] text-[var(--ink-muted)]">
          <span className="font-medium text-[var(--ink-heading)]">Workspace</span> {health.root}
        </p>
      ) : null}

      {health?.reason ? (
        <p className="text-[11px] leading-5 text-[#9a4e43] dark:text-[#efb4aa]">{health.reason}</p>
      ) : null}
      {health?.warnings.length ? (
        <ul className="space-y-1">
          {health.warnings.map((warning) => (
            <li key={warning} className="text-[11px] leading-5 text-[var(--ink-muted)]">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {health?.cloned && health.setupActions.length ? (
        <div className="flex flex-wrap gap-2">
          {health.setupActions.map((action) => {
            const done =
              (action.id === "install" && health.dependenciesInstalled) ||
              (action.id === "browsers" && health.browsersInstalled) ||
              (action.id === "scaffold" && health.onboardingNeeded === false);
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
