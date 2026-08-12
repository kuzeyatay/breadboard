"use client";

// Stock Analyst setup: whether the cloned analysis backend can run, which market
// data it may reach for, and the steps only the user can authorize. A run never
// installs anything — the environment is well over a gigabyte of Python, and
// that is a decision worth asking for rather than taking.
//
// Keys typed here are written and never read back. The panel only ever learns
// whether one is set and where it came from, so a key already exported in the
// environment shows as configured without being editable from here.

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
  source: "environment" | "stored" | null;
}

interface Health {
  available: boolean;
  cloned: boolean;
  root: string | null;
  environmentReady: boolean;
  packageInstalled: boolean;
  uvAvailable: boolean;
  version: string | null;
  serviceRunning: boolean;
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
  version: null,
  serviceRunning: false,
  reason: null,
  setupActions: [],
  credentials: [],
};

function statusOf(health: Health | null): { label: string; ready: boolean } {
  if (!health) return { label: "Checking clone", ready: false };
  if (!health.cloned) return { label: "Not cloned", ready: false };
  if (!health.environmentReady) return { label: "Needs setup", ready: false };
  if (!health.packageInstalled) return { label: "Install incomplete", ready: false };
  return { label: "Ready", ready: true };
}

function sourceNote(credential: Credential): string {
  if (!credential.set) return "";
  return credential.source === "environment" ? "set in the environment" : "saved";
}

export default function StockAnalystSetup() {
  const [health, setHealth] = useState<Health | null>(null);
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/stock-analyst/health${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as Partial<Health>;
      if (!response.ok) throw new Error("Stock Analyst status is unavailable.");
      setHealth({
        ...EMPTY,
        ...payload,
        setupActions: Array.isArray(payload.setupActions) ? payload.setupActions : [],
        credentials: Array.isArray(payload.credentials) ? payload.credentials : [],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setHealth({
        ...EMPTY,
        reason: error instanceof Error ? error.message : "Stock Analyst status is unavailable.",
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
      const response = await fetch("/api/stock-analyst/setup", {
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
          {health?.version
            ? `daily_stock_analysis ${health.version}`
            : "Cloned daily_stock_analysis"}
          {health?.serviceRunning ? " · backend running" : ""}
        </span>
      </div>

      {/* Where the numbers come from decides whether a run is useful, so it is
          stated before anything technical — and the honest version is that the
          free sources work but are scrapers. */}
      <p className="neu-surface-subtle rounded-xl px-3 py-2 text-[11px] leading-5 text-[var(--ink-muted)]">
        <span className="font-medium text-[var(--ink-heading)]">Market data</span> Works with no
        keys at all: Eastmoney, AkShare and Baostock cover mainland China, Yahoo Finance covers Hong
        Kong, the US, Japan, Korea and Taiwan, and public SearXNG instances cover news. Those are
        scrapers and free tiers, so they rate-limit; the keys below are what make a busy day
        reliable.
      </p>

      {/* This agent runs its own copy of the project. Someone who already uses
          the clone will assume otherwise, so say it plainly. */}
      <p className="neu-surface-subtle rounded-xl px-3 py-2 text-[11px] leading-5 text-[var(--ink-muted)]">
        <span className="font-medium text-[var(--ink-heading)]">Separate from your own setup</span>{" "}
        Breadboard never reads the clone&rsquo;s <span className="font-mono">.env</span> and never
        runs its scheduled daily analysis or its notification pushes. The watchlist, language and
        depth come from the defaults below, and the database and logs live under Breadboard&rsquo;s
        own runtime folder.
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
          Installing without uv falls back to pip and the system Python. uv is worth having here: it
          can fetch a Python version that every one of these market-data packages ships wheels for.
          Install it from docs.astral.sh/uv, then reopen this panel.
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
              onClick={() => void post({ action: "stop" }, "stop", "Stop backend")}
              disabled={Boolean(running)}
              title="Stops the supervised backend. The next run starts a fresh one."
              className="neu-button rounded-xl px-3 py-2 text-xs text-[var(--ink-heading)] disabled:opacity-50"
            >
              {running === "stop" ? "Working…" : "Stop backend"}
            </button>
          ) : null}
        </div>
      ) : null}

      {health?.credentials.length ? (
        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            Data and news keys — all optional
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
              {credential.source === "environment" ? null : (
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
