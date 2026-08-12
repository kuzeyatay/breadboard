"use client";

// MoneyPrinter setup: whether the cloned video pipeline can run, which footage
// library it may search, and the steps only the user can authorize. A run never
// installs anything — the environment is well over a gigabyte of Python, and
// that is a decision worth asking for rather than taking.
//
// Keys typed here are written and never read back. The panel only ever learns
// whether one is set and where it came from, so a key already sitting in the
// clone's own config.toml shows as configured without being editable from here.

import { useCallback, useEffect, useState } from "react";

interface SetupAction {
  id: string;
  label: string;
  unlocks: string;
}

interface Credential {
  key: string;
  label: string;
  unlocks: string;
  link: string;
  set: boolean;
  source: "environment" | "stored" | "clone" | null;
}

interface Health {
  available: boolean;
  cloned: boolean;
  root: string | null;
  environmentReady: boolean;
  packageInstalled: boolean;
  uvAvailable: boolean;
  ffmpegPath: string | null;
  version: string | null;
  serviceRunning: boolean;
  footageSources: string[];
  reason: string | null;
  setupActions: SetupAction[];
  credentials: Credential[];
}

const EMPTY: Health = {
  available: false,
  cloned: false,
  root: null,
  environmentReady: false,
  packageInstalled: false,
  uvAvailable: false,
  ffmpegPath: null,
  version: null,
  serviceRunning: false,
  footageSources: [],
  reason: null,
  setupActions: [],
  credentials: [],
};

function statusOf(health: Health | null): { label: string; ready: boolean } {
  if (!health) return { label: "Checking clone", ready: false };
  if (!health.cloned) return { label: "Not cloned", ready: false };
  if (!health.environmentReady) return { label: "Needs setup", ready: false };
  if (!health.packageInstalled) return { label: "Install incomplete", ready: false };
  if (!health.ffmpegPath) return { label: "No ffmpeg", ready: false };
  return { label: "Ready", ready: true };
}

/** What a run can search right now, said as a consequence rather than a list. */
function footageLine(health: Health | null): string {
  if (!health) return "…";
  if (!health.footageSources.length) {
    return "No key yet, so a run can only use clips you have put in the clone's storage/local_videos folder. Add a Pexels key below to search the web for footage.";
  }
  const names = health.footageSources.join(", ");
  return `Runs search ${names}. The first one listed is used unless a message says --pixabay or --coverr.`;
}

function sourceNote(credential: Credential): string {
  if (!credential.set) return "";
  if (credential.source === "environment") return "set in the environment";
  if (credential.source === "clone") return "set in the clone's own config.toml";
  return "saved";
}

export default function MoneyPrinterSetup() {
  const [health, setHealth] = useState<Health | null>(null);
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/money-printer/health${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as Partial<Health>;
      if (!response.ok) throw new Error("MoneyPrinter status is unavailable.");
      setHealth({
        ...EMPTY,
        ...payload,
        setupActions: Array.isArray(payload.setupActions) ? payload.setupActions : [],
        credentials: Array.isArray(payload.credentials) ? payload.credentials : [],
        footageSources: Array.isArray(payload.footageSources) ? payload.footageSources : [],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setHealth({
        ...EMPTY,
        reason: error instanceof Error ? error.message : "MoneyPrinter status is unavailable.",
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  async function post(body: Record<string, unknown>, working: string, done: string) {
    setRunning(working);
    setNotice(
      working === "install"
        ? "Building the environment. This takes several minutes — you can close this panel."
        : `${done}…`,
    );
    setDetail("");
    try {
      const response = await fetch("/api/money-printer/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: { ok?: boolean; message?: string; detail?: string };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "That setup step could not run.");
      }
      setNotice(payload.result?.message ?? `${done} finished.`);
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
          {health?.version ? `MoneyPrinterTurbo ${health.version}` : "Cloned MoneyPrinterTurbo"}
          {health?.serviceRunning ? " · service running" : ""}
        </span>
      </div>

      {/* Where the footage comes from is the whole difference between a video
          and a slideshow of nothing, so it is stated before anything technical. */}
      <p className="neu-surface-subtle rounded-xl px-3 py-2 text-[11px] leading-5 text-[var(--ink-muted)]">
        <span className="font-medium text-[var(--ink-heading)]">Footage</span>{" "}
        {footageLine(health)}
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
          Installing without uv falls back to pip and the system Python. uv is worth having here:
          it installs the exact versions the project pins and can fetch a Python the speech engine
          has wheels for. Install it from docs.astral.sh/uv, then reopen this panel.
        </p>
      ) : null}

      {health?.cloned ? (
        <div className="flex flex-wrap gap-2">
          {health.setupActions.map((action) => {
            if (action.id === "remove" && !health.environmentReady) return null;
            const done = action.id === "install" && health.packageInstalled;
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => void post({ action: action.id }, action.id, action.label)}
                disabled={Boolean(running)}
                title={action.unlocks}
                className="neu-button rounded-xl px-3 py-2 text-xs text-[var(--ink-heading)] disabled:opacity-50"
              >
                {running === action.id ? "Working…" : done ? `${action.label} ✓` : action.label}
              </button>
            );
          })}
          {health.serviceRunning ? (
            <button
              type="button"
              onClick={() => void post({ action: "stop" }, "stop", "Stop service")}
              disabled={Boolean(running)}
              title="Stops the supervised service. The next run starts a fresh one."
              className="neu-button rounded-xl px-3 py-2 text-xs text-[var(--ink-heading)] disabled:opacity-50"
            >
              {running === "stop" ? "Working…" : "Stop service"}
            </button>
          ) : null}
        </div>
      ) : null}

      {health?.credentials.length ? (
        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            Footage libraries
          </h4>
          {health.credentials.map((credential) => (
            <div key={credential.key} className="neu-surface-subtle space-y-2 rounded-xl px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-medium text-[var(--ink-heading)]">
                  {credential.label}
                </span>
                {credential.set ? (
                  <span className="text-[10px] text-[var(--botanical)]">
                    {sourceNote(credential)}
                  </span>
                ) : null}
                <a
                  href={credential.link}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-[10px] text-[var(--ink-muted)] underline"
                >
                  Get a key
                </a>
              </div>
              <p className="text-[10px] leading-4 text-[var(--ink-muted)]">{credential.unlocks}</p>
              {credential.source === "environment" || credential.source === "clone" ? null : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={keyDrafts[credential.key] ?? ""}
                    onChange={(event) =>
                      setKeyDrafts((current) => ({
                        ...current,
                        [credential.key]: event.target.value,
                      }))
                    }
                    placeholder={credential.set ? "Replace the saved key" : "Paste the key"}
                    aria-label={`${credential.label} API key`}
                    className="neu-inset min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1 text-[11px] text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)]"
                  />
                  <button
                    type="button"
                    disabled={Boolean(running)}
                    onClick={() => {
                      const value = keyDrafts[credential.key] ?? "";
                      setKeyDrafts((current) => ({ ...current, [credential.key]: "" }));
                      void post(
                        { credential: credential.key, value },
                        `key:${credential.key}`,
                        value.trim() ? "Save key" : "Remove key",
                      );
                    }}
                    className="neu-button shrink-0 rounded-lg px-2 py-1 text-[11px] text-[var(--ink-heading)] disabled:opacity-50"
                  >
                    {running === `key:${credential.key}`
                      ? "Saving…"
                      : (keyDrafts[credential.key] ?? "").trim()
                        ? "Save"
                        : credential.set
                          ? "Remove"
                          : "Save"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
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
