"use client";

// God's Eye's one settings surface: whether the clone is installed, whether an
// optional Google Maps enhancement key is configured, and the server's state.
//
// Only `npm install` is required. A run that installed its own runtime would be
// a network install started by a sentence in a chat. The optional key travels
// one way: this dialog can save or clear it, and only ever reads back whether
// one is set.

import { useCallback, useEffect, useState } from "react";

interface SetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  installed: boolean;
  key: { set: boolean; source: "environment" | "stored" | null };
  service: { running: boolean; baseUrl: string };
  setup: {
    running: boolean;
    step: string;
    log: string;
    error: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
}

const POLL_MS = 4_000;

function lastLine(log: string): string {
  const lines = log.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

export default function GodsEyeSettingsDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/gods-eye/setup", { cache: "no-store" });
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

  // While the install runs, keep reading its progress.
  const running = Boolean(status?.setup.running);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, running]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setNotice("");
      try {
        const response = await fetch("/api/gods-eye/setup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as {
          status?: SetupStatus;
          message?: string;
          error?: string;
        };
        if (data.status) setStatus(data.status);
        setNotice(data.message || data.error || "");
      } catch {
        setNotice("The request could not be sent.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="God's Eye settings"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--ink-heading)]">God&apos;s Eye</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
          >
            Close
          </button>
        </header>

        <p className="text-xs leading-5 text-[var(--ink-muted)]">
          A 3D globe with live aircraft, ships, satellites, earthquakes and public cameras, from
          the cloned <span className="font-mono">gods-eye-view</span> app. It runs keyless on
          OpenStreetMap imagery and Re:Earth terrain after the clone is installed once. A Google
          Maps key is optional and adds Google&apos;s photorealistic 3D planet and place services.
        </p>

        {status ? (
          <ul className="space-y-1.5 text-xs text-[var(--ink)]">
            <li>
              {status.clone.found ? "✓" : "✗"} Clone{" "}
              <span className="font-mono text-[var(--ink-muted)]">{status.clone.path || "not found"}</span>
            </li>
            <li>{status.installed ? "✓ Dependencies installed" : "✗ Dependencies not installed"}</li>
            <li>
              {status.key.set
                ? `✓ Google 3D enabled (${status.key.source === "environment" ? "key from the environment" : "stored key"})`
                : "✓ Keyless OSM globe ready (Google 3D optional)"}
            </li>
            <li>
              {status.service.running ? "✓ Globe server running" : "· Globe server not running (starts with the first view)"}
            </li>
          </ul>
        ) : (
          <p className="text-xs text-[var(--ink-muted)]">Checking…</p>
        )}

        <div className="space-y-2 border-t border-[var(--line)] pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || running || !status?.clone.found}
              onClick={() => void act({ action: "install" })}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-heading)] hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Installing…" : status?.installed ? "Reinstall dependencies" : "Install"}
            </button>
            {status?.service.running ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act({ action: "stop" })}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] disabled:opacity-40"
              >
                Stop server
              </button>
            ) : null}
          </div>
          {running && status ? (
            <p className="truncate font-mono text-[11px] text-[var(--ink-muted)]">
              {lastLine(status.setup.log) || status.setup.step}
            </p>
          ) : null}
          {status?.setup.error ? (
            <p className="text-[11px] text-[var(--danger)]">{status.setup.error}</p>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-[var(--line)] pt-3">
          <label className="block text-xs font-medium text-[var(--ink-heading)]" htmlFor="gods-eye-key">
            Google Maps API key <span className="font-normal text-[var(--ink-muted)]">(optional)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="gods-eye-key"
              type="password"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              placeholder={status?.key.set ? "A key is set — paste to replace" : "Optional: enable Google 3D"}
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-bg)] px-2.5 py-1.5 text-xs text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
              autoComplete="off"
            />
            <button
              type="button"
              disabled={busy || !keyDraft.trim()}
              onClick={() => {
                void act({ action: "set-key", key: keyDraft }).then(() => setKeyDraft(""));
              }}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-heading)] hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save
            </button>
            {status?.key.source === "stored" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act({ action: "clear-key" })}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] disabled:opacity-40"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        {notice ? <p className="text-[11px] text-[var(--ink-muted)]">{notice}</p> : null}
      </div>
    </div>
  );
}
