"use client";

// The OpenScience setup panel.
//
// OpenScience is a wrapped runtime, so "unavailable" means one of two things:
// the clone is missing, or the pinned CLI has not been installed yet. Only the
// second is something Breadboard can fix on the person's behalf, and it is the
// one button here.
//
// The panel also names the workspace directory and says whether it is isolated.
// Both matter more than they look. The workspace is the durable part of this
// agent — scripts, datasets and figures accumulate there across runs — and its
// isolation is what keeps a run from treating the whole surrounding repository
// as its project.

import { useCallback, useEffect, useState } from "react";
import AgentRunDefaults from "@/app/components/agents/agent-run-defaults";
import { OPENSCIENCE_AGENT_ID } from "@/lib/openscience/identity.ts";

interface SetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  cli: { found: boolean; version: string; source: string };
  workspace: { path: string; isolated: boolean };
  targetVersion: string;
}

function StatusIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path strokeLinecap="round" d="M9 3h6M10 3v6.5L5.2 18a2 2 0 0 0 1.7 3h10.2a2 2 0 0 0 1.7-3L14 9.5V3" />
      <path strokeLinecap="round" d="M8 15h8" />
    </svg>
  );
}

export { StatusIcon as OpenscienceSettingsIcon };

function Row({
  label,
  detail,
  ok,
  optional,
  children,
}: {
  label: string;
  detail: string;
  ok: boolean;
  optional?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 px-2 py-3">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          ok ? "bg-[var(--botanical)]" : optional ? "bg-amber-500" : "bg-[var(--danger)]"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[var(--ink-heading)]">{label}</span>
        <span className="mt-0.5 block break-all text-xs leading-5 text-[var(--ink-muted)]">
          {ok ? detail : (optional ?? detail)}
        </span>
      </span>
      {children}
    </li>
  );
}

export default function OpenscienceSettingsDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // No setState before the first await: the mount effect calls this, and a
  // synchronous state write there is a cascading render.
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/openscience/health", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        setup?: SetupStatus;
        error?: string;
      };
      if (!response.ok || !data.setup) {
        throw new Error(data.error || "OpenScience could not be checked.");
      }
      setStatus(data.setup);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "OpenScience could not be checked.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(action: "install" | "restart", pending: string) {
    setInstalling(true);
    setNotice(pending);
    try {
      const response = await fetch("/api/openscience/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        status?: SetupStatus;
        error?: string;
      };
      if (data.status) setStatus(data.status);
      setNotice(data.message || data.error || "OpenScience could not be set up.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "OpenScience could not be set up.");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[150] flex items-center justify-center px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="openscience-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(48rem,94vh)] w-full max-w-[min(44rem,94vw)] flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--line)] px-5 py-4">
          <span className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--botanical)]">
            <StatusIcon />
          </span>
          <span className="min-w-0 flex-1">
            <h2
              id="openscience-settings-title"
              className="font-serif text-lg text-[var(--ink-heading)]"
            >
              OpenScience setup
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              OpenScience reads the literature, writes and runs code, and writes up what it
              found — inside its own workspace, on ChatMock.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Close OpenScience setup"
          >
            <svg
              aria-hidden
              className="h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path strokeLinecap="round" d="m4 4 8 8m0-8-8 8" />
            </svg>
          </button>
        </header>

        <div className="border-b border-[var(--line)] px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="neu-inset inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-[var(--ink-muted)]">
              <span
                className={`h-2 w-2 rounded-full ${
                  status?.ready ? "bg-[var(--botanical)]" : "bg-amber-500"
                }`}
              />
              {status?.ready ? "Ready to run" : loading ? "Checking…" : "Setup needed"}
            </span>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              disabled={loading || installing}
              className="neu-button ml-auto rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
          {notice || status?.reason ? (
            <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]" role="status">
              {notice ?? status?.reason}
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {loading && !status ? (
            <div className="px-4 py-16 text-center text-sm text-[var(--ink-muted)]">
              Checking OpenScience…
            </div>
          ) : status ? (
            <>
              <ul className="divide-y divide-[var(--line)]">
                <Row
                  label="OpenScience clone"
                  ok={status.clone.found}
                  detail={status.clone.path}
                  optional="Not found. Clone synthetic-sciences/openscience next to the dashboard — it pins the version an install uses."
                />
                <Row
                  label="OpenScience CLI"
                  ok={status.cli.found}
                  detail={`Version ${status.cli.version} · ${status.cli.source}`}
                  optional={`Not installed. Breadboard installs the platform build of version ${status.targetVersion}, the one the clone ships.`}
                >
                  <button
                    type="button"
                    onClick={() => void post("install", "Installing OpenScience. This takes a minute.")}
                    disabled={installing}
                    className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {installing ? "Working…" : status.cli.found ? "Reinstall" : "Install"}
                  </button>
                </Row>
                <Row
                  label="Workspace"
                  ok={status.workspace.isolated}
                  detail={status.workspace.path}
                  optional={`${status.workspace.path} — not yet its own project root. Installing sets that up; without it a run would treat the surrounding repository as its project.`}
                />
              </ul>
              <div className="px-2 pb-2 pt-1">
                <button
                  type="button"
                  onClick={() => void post("restart", "Stopping the server.")}
                  disabled={installing}
                  className="neu-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  Restart the server
                </button>
                <p className="mt-1.5 text-xs leading-5 text-[var(--ink-muted)]">
                  The server reads its configuration once at boot. Restart it after changing
                  your background model or provider.
                </p>
              </div>
              <AgentRunDefaults agentId={OPENSCIENCE_AGENT_ID} />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
