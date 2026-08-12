"use client";

// The OpenMontage setup panel.
//
// OpenMontage is a production system with 102 tools, and how good a video it can
// make depends entirely on which of them are reachable on this machine. So the
// headline number here is not "ready / not ready" but how many tools report
// themselves available — read from the clone's own registry, not guessed. Two
// pieces move that number a lot and Breadboard can install both: the Python
// dependencies, and the Remotion composition runtime.
//
// The provider row is the honest part. With no API keys OpenMontage still makes
// a real video from stock footage, music and local composition; keys widen what
// it can generate. The panel says which keys it found rather than implying the
// agent is broken without them.

import { useCallback, useEffect, useState } from "react";

interface Piece {
  found: boolean;
  path?: string;
  source?: string;
  version?: string;
}

interface ToolchainStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  python: Piece & { dependencies: boolean; installable: boolean };
  ffmpeg: Piece;
  ffprobe: Piece;
  node: { found: boolean; version: string };
  remotion: { found: boolean; path: string; installable: boolean };
  codex: { found: boolean; version: string };
  tools: { available: number; total: number; reason: string };
  providers: string[];
}

type InstallAction = "install-dependencies" | "install-remotion";

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
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path strokeLinecap="round" d="M7 4.5v15M17 4.5v15" />
      <path strokeLinecap="round" d="M2.5 12h4.5M17 12h4.5" />
    </svg>
  );
}

export { StatusIcon as OpenMontageSettingsIcon };

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

export default function OpenMontageSettingsDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<ToolchainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<InstallAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/openmontage/setup", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: ToolchainStatus;
        error?: string;
      };
      if (!response.ok || !data.status) {
        throw new Error(data.error || "The production toolchain could not be checked.");
      }
      setStatus(data.status);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The production toolchain could not be checked.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function install(action: InstallAction) {
    setInstalling(action);
    setNotice(
      action === "install-dependencies"
        ? "Installing OpenMontage's Python dependencies. This takes a few minutes."
        : "Installing the Remotion composition runtime. This takes a few minutes.",
    );
    try {
      const response = await fetch("/api/openmontage/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        status?: ToolchainStatus;
        error?: string;
      };
      if (data.status) setStatus(data.status);
      setNotice(data.message || data.error || "That could not be installed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That could not be installed.");
    } finally {
      setInstalling(null);
    }
  }

  const tools = status?.tools;

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
        aria-labelledby="openmontage-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(48rem,94vh)] w-full max-w-[min(44rem,94vw)] flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--line)] px-5 py-4">
          <span className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--botanical)]">
            <StatusIcon />
          </span>
          <span className="min-w-0 flex-1">
            <h2
              id="openmontage-settings-title"
              className="font-serif text-lg text-[var(--ink-heading)]"
            >
              Video production setup
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              OpenMontage runs a real production pipeline — script, scene plan, assets, edit,
              render. These are the pieces it needs, and what they unlock.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Close video production setup"
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
              {status?.ready ? "Ready to produce" : loading ? "Checking…" : "Setup needed"}
            </span>
            {tools && tools.total > 0 ? (
              <span className="neu-inset inline-flex items-center rounded-full px-3 py-1.5 text-xs tabular-nums text-[var(--ink-muted)]">
                {tools.available} of {tools.total} tools available
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || Boolean(installing)}
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
              Checking the production toolchain…
            </div>
          ) : status ? (
            <ul className="divide-y divide-[var(--line)]">
              <Row
                label="OpenMontage"
                ok={status.clone.found}
                detail={status.clone.path}
                optional="The OpenMontage clone was not found next to the dashboard. Clone it there, or set OPENMONTAGE_ROOT."
              />
              <Row
                label="Python tools"
                ok={status.python.found && status.python.dependencies}
                detail={`${status.python.version || "Python"} · ${status.python.source}`}
                optional={
                  status.python.found
                    ? "The dependencies are not installed yet, so none of OpenMontage's tools can be imported."
                    : "Python was not found. Install Python 3.10 or newer, or set OPENMONTAGE_PYTHON."
                }
              >
                {status.python.dependencies || !status.python.installable ? null : (
                  <button
                    type="button"
                    onClick={() => void install("install-dependencies")}
                    disabled={Boolean(installing)}
                    className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {installing === "install-dependencies" ? "Installing…" : "Install"}
                  </button>
                )}
              </Row>
              <Row
                label="FFmpeg"
                ok={status.ffmpeg.found}
                detail={`${status.ffmpeg.path} · ${status.ffmpeg.source}`}
                optional="Not found. Without it OpenMontage loses every edit and compose tool — there is no way to turn a plan into a video. Put ffmpeg on PATH or set OPENMONTAGE_FFMPEG_PATH."
              />
              <Row
                label="Remotion runtime"
                ok={status.remotion.found}
                detail={`Installed at ${status.remotion.path}`}
                optional="Not installed. Optional: the ffmpeg render path works without it, but Remotion is what gives animated text, charts and word-level captions."
              >
                {status.remotion.found || !status.remotion.installable ? null : (
                  <button
                    type="button"
                    onClick={() => void install("install-remotion")}
                    disabled={Boolean(installing)}
                    className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {installing === "install-remotion" ? "Installing…" : "Install"}
                  </button>
                )}
              </Row>
              <Row
                label="Coding runtime"
                ok={status.codex.found}
                detail={`Codex · ${status.codex.version}`}
                optional="Codex was not found. Install it or set CODEX_BIN — it is the agent that drives the pipeline."
              />
              <Row
                label="Provider keys"
                ok={status.providers.length > 0}
                detail={status.providers.join(", ")}
                optional="None set. OpenMontage still makes a real video from stock footage, music and local composition — add keys to OpenMontage/.env to unlock AI image, video and voice generation."
              />
            </ul>
          ) : null}
        </div>

        <footer className="border-t border-[var(--line)] px-5 py-3">
          <p className="text-xs leading-5 text-[var(--ink-muted)]">
            The agent runs on the model you picked in chat, through ChatMock — the same account
            as every other agent. Productions stay on this machine, and each one keeps its own
            folder so a finished video still plays later.
          </p>
        </footer>
      </section>
    </div>
  );
}
