"use client";

// The OpenWork setup panel.
//
// OpenWork is a wrapped runtime rather than a library, so "unavailable" can
// mean four different things: the clone is missing, Bun is missing, the server
// has not been prepared, or no OpenCode engine can be launched. Each gets its
// own row with its own fix, because only one of the four — preparing the
// server — is something Breadboard can do on the person's behalf.
//
// The panel also names the workspace directory. That directory is the durable
// part of this agent: skills, connections and delivered files accumulate there
// across runs, so knowing where it is matters more here than for agents whose
// runs are self-contained.

import { useCallback, useEffect, useState } from "react";

interface SetupStatus {
  ready: boolean;
  reason: string;
  cloned: boolean;
  clonePath: string;
  prepared: boolean;
  stale: boolean;
  version: string;
  bun: { found: boolean; source: string };
  engine: { found: boolean; version: string; source: string };
  workspacePath: string;
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
      <rect x="3" y="4" width="18" height="14" rx="2.5" />
      <path strokeLinecap="round" d="M8 21h8M12 18v3M7 9h5M7 12.5h8" />
    </svg>
  );
}

export { StatusIcon as OpenworkSettingsIcon };

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

export default function OpenworkSettingsDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/openwork/setup", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        status?: SetupStatus;
        error?: string;
      };
      if (!response.ok || !data.status) {
        throw new Error(data.error || "OpenWork could not be checked.");
      }
      setStatus(data.status);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "OpenWork could not be checked.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function prepareServer() {
    setPreparing(true);
    setNotice("Preparing the OpenWork server from the clone. This takes a minute.");
    try {
      const response = await fetch("/api/openwork/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "prepare-server" }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        status?: SetupStatus;
        error?: string;
      };
      if (data.status) setStatus(data.status);
      setNotice(data.message || data.error || "The OpenWork server could not be prepared.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The OpenWork server could not be prepared.",
      );
    } finally {
      setPreparing(false);
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
        aria-labelledby="openwork-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(48rem,94vh)] w-full max-w-[min(44rem,94vw)] flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--line)] px-5 py-4">
          <span className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--botanical)]">
            <StatusIcon />
          </span>
          <span className="min-w-0 flex-1">
            <h2
              id="openwork-settings-title"
              className="font-serif text-lg text-[var(--ink-heading)]"
            >
              OpenWork workspace setup
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              OpenWork runs work inside a workspace of skills and connections. Breadboard runs
              its server from the clone and points it at an OpenCode engine on ChatMock.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Close OpenWork setup"
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
              onClick={() => void load()}
              disabled={loading || preparing}
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
              Checking OpenWork…
            </div>
          ) : status ? (
            <ul className="divide-y divide-[var(--line)]">
              <Row
                label="OpenWork clone"
                ok={status.cloned}
                detail={status.clonePath}
                optional="Not found. Clone openworklabs/openwork next to the dashboard."
              />
              <Row
                label="Bun"
                ok={status.bun.found}
                detail={status.bun.source}
                optional="Not found. The OpenWork server is TypeScript that Bun runs directly — install Bun from bun.sh."
              />
              <Row
                label="OpenWork server"
                ok={status.prepared && !status.stale}
                detail={
                  status.stale
                    ? `Version ${status.version} — the clone has changed since this was prepared.`
                    : `Version ${status.version}, prepared from the clone.`
                }
                optional={
                  status.prepared
                    ? `Version ${status.version} — the clone has changed since this was prepared.`
                    : "Not prepared yet. Breadboard copies the server out of the clone and installs its dependencies."
                }
              >
                {status.prepared && !status.stale ? null : (
                  <button
                    type="button"
                    onClick={() => void prepareServer()}
                    disabled={preparing || !status.cloned || !status.bun.found}
                    className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {preparing ? "Preparing…" : status.prepared ? "Update" : "Prepare"}
                  </button>
                )}
              </Row>
              <Row
                label="OpenCode engine"
                ok={status.engine.found}
                detail={`${status.engine.version} · ${status.engine.source}`}
                optional="No engine could be launched. Install OpenCode or Bun so Breadboard can run the pinned version."
              />
              <Row label="Workspace" ok detail={status.workspacePath} />
            </ul>
          ) : null}
        </div>
      </section>
    </div>
  );
}
