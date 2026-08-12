"use client";

// Shorts setup: whether the cloned generator can run, and the one step only the
// user can authorize. A run never installs anything — the environment is
// faster-whisper, opencv and yt-dlp, which is a few hundred megabytes and
// several minutes, and that is a decision worth asking for.

import { useCallback, useEffect, useState } from "react";

interface Health {
  available: boolean;
  cloned: boolean;
  root: string | null;
  environmentReady: boolean;
  dependenciesInstalled: boolean;
  missing: string[];
  uvAvailable: boolean;
  ffmpeg: string | null;
  bridgeFound: boolean;
  reason: string | null;
}

const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks:
      "Creates AI-Youtube-Shorts-Generator/.venv and installs yt-dlp, faster-whisper and opencv.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the dependencies into the existing environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks: "Deletes AI-Youtube-Shorts-Generator/.venv. Nothing else in the clone is touched.",
  },
] as const;

const EMPTY: Health = {
  available: false,
  cloned: false,
  root: null,
  environmentReady: false,
  dependenciesInstalled: false,
  missing: [],
  uvAvailable: false,
  ffmpeg: null,
  bridgeFound: false,
  reason: null,
};

function statusOf(health: Health | null): { label: string; ready: boolean } {
  if (!health) return { label: "Checking clone", ready: false };
  if (!health.cloned) return { label: "Not cloned", ready: false };
  if (!health.environmentReady) return { label: "Needs setup", ready: false };
  if (!health.dependenciesInstalled) return { label: "Install incomplete", ready: false };
  if (!health.ffmpeg) return { label: "No ffmpeg", ready: false };
  return { label: "Ready", ready: true };
}

export default function ShortsSetup() {
  const [health, setHealth] = useState<Health | null>(null);
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState("");
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/shorts/health${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as Partial<Health>;
      if (!response.ok) throw new Error("Shorts status is unavailable.");
      setHealth({
        available: payload.available === true,
        cloned: payload.cloned === true,
        root: typeof payload.root === "string" ? payload.root : null,
        environmentReady: payload.environmentReady === true,
        dependenciesInstalled: payload.dependenciesInstalled === true,
        missing: Array.isArray(payload.missing) ? payload.missing : [],
        uvAvailable: payload.uvAvailable === true,
        ffmpeg: typeof payload.ffmpeg === "string" ? payload.ffmpeg : null,
        bridgeFound: payload.bridgeFound === true,
        reason: typeof payload.reason === "string" ? payload.reason : null,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setHealth({
        ...EMPTY,
        reason: error instanceof Error ? error.message : "Shorts status is unavailable.",
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
      const response = await fetch("/api/shorts/setup", {
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
          Cloned AI-Youtube-Shorts-Generator
        </span>
      </div>

      {/* What a run actually does on this machine, before anything technical:
          the video and its audio never leave it, only the transcript does. */}
      <p className="neu-surface-subtle rounded-xl px-3 py-2 text-[11px] leading-5 text-[var(--ink-muted)]">
        <span className="font-medium text-[var(--ink-heading)]">Runs here</span> the download,
        the transcription and every cut happen on this machine. Only the transcript is sent to a
        model, to pick which moments are worth clipping.
      </p>

      {health?.root ? (
        <p className="neu-surface-subtle truncate rounded-xl px-3 py-2 text-[11px] text-[var(--ink-muted)]">
          <span className="font-medium text-[var(--ink-heading)]">Clone</span> {health.root}
        </p>
      ) : null}

      <p className="neu-surface-subtle truncate rounded-xl px-3 py-2 text-[11px] text-[var(--ink-muted)]">
        <span className="font-medium text-[var(--ink-heading)]">ffmpeg</span>{" "}
        {health?.ffmpeg ?? "not found — every clip is cut and muxed with one, so a run cannot finish without it."}
      </p>

      {health?.reason ? (
        <p className="text-[11px] leading-5 text-[#9a4e43] dark:text-[#efb4aa]">{health.reason}</p>
      ) : null}

      {health?.cloned ? (
        <div className="flex flex-wrap gap-2">
          {SETUP_ACTIONS.map((action) => {
            const done = action.id === "install" && health.dependenciesInstalled;
            if (action.id === "remove" && !health.environmentReady) return null;
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

      {health?.environmentReady && !health.dependenciesInstalled && health.missing.length ? (
        <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
          Missing: {health.missing.join(", ")}.
        </p>
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
