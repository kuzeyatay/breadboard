"use client";

// The HyperFrames setup panel.
//
// Rendering video needs three things Breadboard does not ship — the CLI, ffmpeg
// and a Chromium — plus the coding runtime that drives them. Each row says
// whether that piece was found and where it came from, so "the video agent is
// unavailable" is never the whole answer. Only the CLI has an install button:
// it is the one piece with a package Breadboard can fetch into its own
// directory without admin rights.

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
  clone: { found: boolean; path: string; skills: number };
  cli: Piece & { installable: boolean };
  ffmpeg: Piece;
  browser: Piece;
  codex: { found: boolean; version: string };
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
      <rect x="2.5" y="5" width="14" height="14" rx="2.5" />
      <path strokeLinejoin="round" d="m16.5 13 5 3.2V7.8L16.5 11z" />
    </svg>
  );
}

export { StatusIcon as HyperframesSettingsIcon };

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

export default function HyperframesSettingsDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<ToolchainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/hyperframes/setup", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: ToolchainStatus;
        error?: string;
      };
      if (!response.ok || !data.status) {
        throw new Error(data.error || "The video toolchain could not be checked.");
      }
      setStatus(data.status);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The video toolchain could not be checked.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function installCli() {
    setInstalling(true);
    setNotice("Installing the HyperFrames CLI. This takes a couple of minutes.");
    try {
      const response = await fetch("/api/hyperframes/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "install-cli" }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        status?: ToolchainStatus;
        error?: string;
      };
      if (data.status) setStatus(data.status);
      setNotice(data.message || data.error || "The HyperFrames CLI could not be installed.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The HyperFrames CLI could not be installed.",
      );
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
        aria-labelledby="hyperframes-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(48rem,94vh)] w-full max-w-[min(44rem,94vw)] flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--line)] px-5 py-4">
          <span className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--botanical)]">
            <StatusIcon />
          </span>
          <span className="min-w-0 flex-1">
            <h2
              id="hyperframes-settings-title"
              className="font-serif text-lg text-[var(--ink-heading)]"
            >
              Video rendering setup
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              HyperFrames writes a video as an HTML page and records it frame by frame. These
              are the pieces that do the recording.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Close video rendering setup"
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
              {status?.ready ? "Ready to render" : loading ? "Checking…" : "Setup needed"}
            </span>
            <button
              type="button"
              onClick={() => void load()}
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
              Checking the video toolchain…
            </div>
          ) : status ? (
            <ul className="divide-y divide-[var(--line)]">
              <Row
                label="HyperFrames CLI"
                ok={status.cli.found}
                detail={`${status.cli.version || "installed"} · found via ${status.cli.source}`}
                optional={`Not installed. Breadboard can fetch version ${status.targetVersion} into its own folder.`}
              >
                {status.cli.found ? null : (
                  <button
                    type="button"
                    onClick={() => void installCli()}
                    disabled={installing}
                    className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {installing ? "Installing…" : "Install"}
                  </button>
                )}
              </Row>
              <Row
                label="FFmpeg"
                ok={status.ffmpeg.found}
                detail={`${status.ffmpeg.path} · ${status.ffmpeg.source}`}
                optional="Not found. Install FFmpeg and put it on PATH, or set HYPERFRAMES_FFMPEG_PATH — the frames cannot be encoded without it."
              />
              <Row
                label="Chromium"
                ok={status.browser.found}
                detail={`${status.browser.path} · ${status.browser.source}`}
                optional="No installed browser found. The first render downloads a headless Chrome, which takes a few minutes once."
              />
              <Row
                label="Coding runtime"
                ok={status.codex.found}
                detail={`Codex · ${status.codex.version}`}
                optional="Codex was not found. Install it or set CODEX_BIN — it is the agent that writes the composition."
              />
              <Row
                label="Skills"
                ok={status.clone.found && status.clone.skills > 0}
                detail={`${status.clone.skills} video skills read from ${status.clone.path}`}
                optional="The HyperFrames clone was not found next to the dashboard, so the agent has no video know-how to read."
              />
            </ul>
          ) : null}
        </div>

        <footer className="border-t border-[var(--line)] px-5 py-3">
          <p className="text-xs leading-5 text-[var(--ink-muted)]">
            The agent runs on the model you picked in chat, through ChatMock — the same account
            as every other agent. Renders stay on this machine.
          </p>
        </footer>
      </section>
    </div>
  );
}
