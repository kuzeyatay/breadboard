"use client";

// MatrAIx's one settings surface: what the study runtime needs before it can
// run, and the run defaults underneath it.
//
// The install button is here rather than anywhere a run could reach it. It
// builds the clone's Python environment, which is the only preparation MatrAIx
// needs — everything else it uses is checked into the clone, including the
// 200-persona sample it draws cohorts from.
//
// The million-persona release is shown as a command rather than a button on
// purpose: it is a multi-gigabyte download from Hugging Face, and starting one
// because a dialog was open is not a decision Breadboard should make.

import { useCallback, useEffect, useState } from "react";
import AgentRunDefaults from "@/app/components/agents/agent-run-defaults";
import { MATRAIX_AGENT_ID } from "@/lib/matraix/identity.ts";

interface PoolStatus {
  pool: string;
  label: string;
  personas: number;
  present: boolean;
}

interface SetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  python: { found: boolean; path: string; version: string; venv: string };
  pools: PoolStatus[];
  productionPoolCommand: string;
}

export default function MatraixSettingsDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/matraix/setup", { cache: "no-store" });
      const data = (await response.json()) as { status?: SetupStatus; error?: string };
      if (data.status) setStatus(data.status);
      else setNotice(data.error || "Setup could not be checked.");
    } catch {
      setNotice("Setup could not be checked.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function install() {
    setBusy(true);
    setNotice("Building MatrAIx's Python environment. This takes a few minutes the first time.");
    try {
      const response = await fetch("/api/matraix/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "install-runtime" }),
      });
      const data = (await response.json()) as {
        status?: SetupStatus;
        message?: string;
        error?: string;
      };
      if (data.status) setStatus(data.status);
      setNotice(data.message || data.error || "Setup finished.");
    } catch {
      setNotice("The install could not be started.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[150] flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="matraix-title"
        className="bb-modal-panel neu-dialog max-h-[85vh] w-full max-w-[42rem] overflow-y-auto rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-3 border-b border-[var(--line)] p-5">
          <div className="min-w-0 flex-1">
            <h2 id="matraix-title" className="font-serif text-lg text-[var(--ink-heading)]">
              MatrAIx setup
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              Puts a question to a sampled population of persona agents. Every respondent is a
              separate model call through your configured provider.
            </p>
          </div>
          <button
            type="button"
            className="neu-button-icon h-9 w-9 rounded-full"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${status?.ready ? "bg-[var(--botanical)]" : "bg-amber-500"}`}
            />
            <span className="text-sm">
              {status?.ready
                ? `Ready · Python ${status.python.version || "3.12"}`
                : "Setup needed"}
            </span>
            <button
              type="button"
              className="neu-button ml-auto rounded-lg px-3 py-1.5 text-xs"
              onClick={() => void load()}
            >
              Refresh
            </button>
          </div>
          {notice || status?.reason ? (
            <p className="text-xs leading-5 text-[var(--ink-muted)]" role="status">
              {notice || status?.reason}
            </p>
          ) : null}
          <div className="bb-agent-run-panel space-y-1 p-3 text-xs leading-5 text-[var(--ink-muted)]">
            <p>
              <strong className="text-[var(--ink-heading)]">Clone:</strong>{" "}
              {status?.clone.found ? status.clone.path : "not found"}
            </p>
            <p>
              <strong className="text-[var(--ink-heading)]">Environment:</strong>{" "}
              {status?.python.found ? status.python.path : "not installed"}
            </p>
          </div>
          {status?.ready ? null : (
            <button
              type="button"
              disabled={busy || !status?.clone.found}
              className="neu-button rounded-lg px-3 py-2 text-xs disabled:opacity-50"
              onClick={() => void install()}
            >
              Install MatrAIx&apos;s Python environment
            </button>
          )}
          {status?.pools.length ? (
            <ul className="space-y-1">
              {status.pools.map((pool) => (
                <li
                  key={pool.pool}
                  className="bb-agent-run-row flex items-center gap-2 p-2 text-xs"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${pool.present ? "bg-[var(--botanical)]" : "bg-amber-500"}`}
                  />
                  <span className="text-[var(--ink-heading)]">{pool.label}</span>
                  <span className="ml-auto text-[var(--ink-muted)]">
                    {pool.present
                      ? pool.personas
                        ? `${pool.personas} personas`
                        : "present"
                      : "not imported"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {status && !status.pools[1]?.present ? (
            <div className="space-y-1">
              <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
                Studies run on the 200-persona sample the clone ships with, which is enough for a
                cohort of a dozen. To sample from the full million-persona release, run this inside
                the clone — it is a large download, so Breadboard does not start it for you.
              </p>
              <pre className="bb-agent-run-panel overflow-x-auto p-2 font-mono text-[10px] leading-4">
                {status.productionPoolCommand}
              </pre>
            </div>
          ) : null}
          <AgentRunDefaults agentId={MATRAIX_AGENT_ID} />
        </div>
      </section>
    </div>
  );
}
