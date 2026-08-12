"use client";

// The Trading Agent setup panel.
//
// Two things stand between a fresh clone and a working analysis, and only the
// user can authorise either: a Python environment for the cloned framework (a
// few hundred megabytes of LangGraph, pandas and market-data libraries), and —
// optionally — the API keys for the data vendors that are not keyless. Both live
// here, alongside the run defaults: one settings button per agent means one
// panel, not a link out to a second one.
//
// A key travels one way only: it is written, and afterwards the panel can say
// that one is set but never what it is.

import { useCallback, useEffect, useState } from "react";
import AgentRunDefaults from "@/app/components/agents/agent-run-defaults";
import { TRADINGAGENTS_AGENT_ID } from "@/lib/tradingagents/identity.ts";

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
  systemPython: string | null;
  uvAvailable: boolean;
  version: string | null;
  bridgeFound: boolean;
  reason: string | null;
  setupActions: SetupAction[];
  credentials: Credential[];
}

function ChartIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path strokeLinecap="round" d="M3.5 19.5h17" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 15 4.5-5 3.5 3.5L20 6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 10V6h-4" />
    </svg>
  );
}

export { ChartIcon as TradingAgentsSettingsIcon };

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

export default function TradingAgentsSettingsDialog({ onClose }: { onClose: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/tradingagents/health${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<Health> & {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "The Trading Agent setup could not be checked.");
      }
      setHealth({
        available: payload.available === true,
        cloned: payload.cloned === true,
        root: typeof payload.root === "string" ? payload.root : null,
        environmentReady: payload.environmentReady === true,
        packageInstalled: payload.packageInstalled === true,
        systemPython: typeof payload.systemPython === "string" ? payload.systemPython : null,
        uvAvailable: payload.uvAvailable === true,
        version: typeof payload.version === "string" ? payload.version : null,
        bridgeFound: payload.bridgeFound === true,
        reason: typeof payload.reason === "string" ? payload.reason : null,
        setupActions: Array.isArray(payload.setupActions) ? payload.setupActions : [],
        credentials: Array.isArray(payload.credentials) ? payload.credentials : [],
      });
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The Trading Agent setup could not be checked.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, working: string, id: string) {
    setBusy(id);
    setNotice(working);
    setDetail("");
    try {
      const response = await fetch("/api/tradingagents/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        result?: { ok?: boolean; message?: string; detail?: string };
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "That step could not run.");
      }
      setNotice(payload.result?.message ?? "Done.");
      setDetail(payload.result?.ok === false ? (payload.result.detail ?? "") : "");
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That step could not run.");
    } finally {
      setBusy(null);
    }
  }

  const environmentLabel = health?.packageInstalled
    ? "Installed and importable"
    : health?.environmentReady
      ? "Created, but the framework does not import"
      : "Not built yet";

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
        aria-labelledby="tradingagents-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(48rem,94vh)] w-full max-w-[min(44rem,94vw)] flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--line)] px-5 py-4">
          <span className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--botanical)]">
            <ChartIcon />
          </span>
          <span className="min-w-0 flex-1">
            <h2
              id="tradingagents-settings-title"
              className="font-serif text-lg text-[var(--ink-heading)]"
            >
              Trading Agent setup
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              The analysis runs inside the cloned framework&apos;s own Python environment, with
              ChatMock as the model behind every agent in it.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Close Trading Agent setup"
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
                  health?.available ? "bg-[var(--botanical)]" : "bg-amber-500"
                }`}
              />
              {health?.available ? "Ready to analyse" : loading ? "Checking…" : "Setup needed"}
            </span>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading || Boolean(busy)}
              className="neu-button ml-auto rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
          {notice || health?.reason ? (
            <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]" role="status">
              {notice ?? health?.reason}
            </p>
          ) : null}
          {detail ? (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--paper-strong)] p-3 text-[11px] leading-5 text-[var(--ink-muted)]">
              {detail}
            </pre>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {loading && !health ? (
            <div className="px-4 py-16 text-center text-sm text-[var(--ink-muted)]">
              Checking the cloned framework…
            </div>
          ) : health ? (
            <>
              <ul className="divide-y divide-[var(--line)]">
                <Row
                  label="Cloned framework"
                  ok={health.cloned}
                  detail={`${health.root ?? ""}${health.version ? ` · v${health.version}` : ""}`}
                  optional="Not found. Clone TradingAgents next to the dashboard."
                />
                <Row
                  label="Python environment"
                  ok={health.packageInstalled}
                  detail={environmentLabel}
                  optional={
                    health.uvAvailable
                      ? "Not built yet. uv is available, so this takes a few minutes."
                      : health.systemPython
                        ? `Not built yet. Will use ${health.systemPython}.`
                        : "No Python found. Install Python 3.10 or newer, or uv."
                  }
                >
                  <span className="flex shrink-0 flex-wrap gap-1.5">
                    {health.setupActions.map((action) => {
                      const skip =
                        (action.id === "install" && health.packageInstalled) ||
                        (action.id === "remove" && !health.environmentReady) ||
                        (action.id === "reinstall" && !health.environmentReady);
                      if (skip) return null;
                      return (
                        <button
                          key={action.id}
                          type="button"
                          title={action.unlocks}
                          onClick={() =>
                            void post(
                              { action: action.id },
                              action.id === "remove"
                                ? "Removing the environment…"
                                : "Installing. This takes a few minutes on a cold cache.",
                              action.id,
                            )
                          }
                          disabled={Boolean(busy)}
                          className="neu-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                          {busy === action.id ? "Working…" : action.label}
                        </button>
                      );
                    })}
                  </span>
                </Row>
                <Row
                  label="Breadboard bridge"
                  ok={health.bridgeFound}
                  detail="scripts/tradingagents-bridge.py"
                  optional="Missing from scripts/. Reinstall or update Breadboard."
                />
              </ul>

              <div className="mt-4 px-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  Data vendors
                </h3>
                <p className="mt-1.5 text-xs leading-5 text-[var(--ink-muted)]">
                  Yahoo Finance needs no account and is what every run uses by default. These keys
                  are optional — they unlock a second price source and the macroeconomic series.
                </p>
                <ul className="mt-2 space-y-3">
                  {health.credentials.map((credential) => (
                    <li key={credential.key} className="rounded-xl border border-[var(--line)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[var(--ink-heading)]">
                          {credential.label}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] ${
                            credential.set
                              ? "bg-[var(--paper-strong)] text-[var(--botanical)]"
                              : "bg-[var(--paper-surface)] text-[var(--ink-muted)]"
                          }`}
                        >
                          {credential.set
                            ? credential.source === "environment"
                              ? "set in the environment"
                              : "saved"
                            : "not set"}
                        </span>
                        <a
                          href={credential.link}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto text-xs text-[var(--botanical)] underline underline-offset-2"
                        >
                          Get a key
                        </a>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                        {credential.unlocks}
                      </p>
                      {credential.source === "environment" ? (
                        <p className="mt-2 text-xs text-[var(--ink-muted)]">
                          This key comes from the environment, so it is not editable here.
                        </p>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <input
                            type="password"
                            value={keyDrafts[credential.key] ?? ""}
                            placeholder={credential.set ? "Replace the saved key" : "Paste the key"}
                            autoComplete="off"
                            onChange={(event) =>
                              setKeyDrafts((current) => ({
                                ...current,
                                [credential.key]: event.target.value,
                              }))
                            }
                            className="neu-inset min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-1.5 text-sm outline-none"
                          />
                          <button
                            type="button"
                            disabled={Boolean(busy) || !(keyDrafts[credential.key] ?? "").trim()}
                            onClick={() => {
                              const value = keyDrafts[credential.key] ?? "";
                              setKeyDrafts((current) => ({ ...current, [credential.key]: "" }));
                              void post(
                                { credential: credential.key, value },
                                "Saving the key…",
                                `key:${credential.key}`,
                              );
                            }}
                            className="neu-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                          >
                            Save
                          </button>
                          {credential.set ? (
                            <button
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() =>
                                void post(
                                  { credential: credential.key, value: "" },
                                  "Removing the key…",
                                  `key:${credential.key}`,
                                )
                              }
                              className="neu-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="mt-4 px-2 pb-2 text-xs leading-5 text-[var(--ink-muted)]">
                Trading Agent is a research framework. Its output is an argued position, not
                financial, investment or trading advice.
              </p>
            </>
          ) : null}

          {/* One settings button per agent, so the run defaults are here rather
              than behind a second one. */}
          <section className="mt-4 border-t border-[var(--line)] px-1 pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Defaults
            </h3>
            <div className="mt-2">
              <AgentRunDefaults agentId={TRADINGAGENTS_AGENT_ID} />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
