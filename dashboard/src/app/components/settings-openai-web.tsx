"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notifyAssistantModelsChanged } from "@/app/components/use-assistant-models";
import type { ChatgptWebAction, ChatgptWebSession } from "@/lib/chatmock-providers";
import { chatgptWebTabRelayAvailable } from "@/lib/desktop-browser-tabs";
import { fetchCachedSettings, invalidateSettingsCache } from "@/lib/settings-client-cache";

/**
 * The "OpenAI (web)" row of the account list: the same ChatGPT plan as the
 * OpenAI row above it, reached the way the website reaches it.
 *
 * Signing in is done on chatgpt.com itself, in a browser tab: Breadboard's
 * own browser when the desktop shell is present, a system Chrome/Edge on
 * ChatMock's own profile otherwise. ChatMock watches that page and reports
 * back; this row only starts the sign-in, shows what ChatMock found, and
 * ends it. No credential ever passes through here.
 */

const SESSION_URL = "/api/chatmock/openaiweb";
const LOGIN_POLL_MS = 3_000;

const DOT: Record<"active" | "off", { label: string; className: string }> = {
  active: { label: "Signed in", className: "bg-[var(--botanical)]" },
  off: { label: "Not signed in", className: "bg-[var(--danger)]" },
};

function Dot({ state }: { state: "active" | "off" }) {
  const { label, className } = DOT[state];
  return (
    <span role="status" aria-label={label} title={label} className={`h-2 w-2 shrink-0 rounded-full ${className}`} />
  );
}

function planLabel(plan: string | null): string | null {
  if (!plan) return null;
  const known: Record<string, string> = {
    free: "Free",
    plus: "Plus",
    pro: "Pro",
    team: "Team",
    business: "Business",
    enterprise: "Enterprise",
    edu: "Edu",
  };
  return known[plan.toLowerCase()] ?? plan;
}

export default function SettingsOpenaiWeb() {
  const [session, setSession] = useState<ChatgptWebSession | null>(null);
  const [busy, setBusy] = useState<ChatgptWebAction | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const modelCountRef = useRef<number>(0);

  const apply = useCallback((next: ChatgptWebSession) => {
    setSession(next);
    // A sign-in or a sync changed what the pickers may offer.
    const count = next.models.length;
    if (count !== modelCountRef.current) {
      modelCountRef.current = count;
      notifyAssistantModelsChanged();
    }
  }, []);

  const refresh = useCallback(
    async (options: { force?: boolean; refresh?: boolean } = {}): Promise<ChatgptWebSession | null> => {
      try {
        const url = options.refresh ? `${SESSION_URL}?refresh=1` : SESSION_URL;
        const response = await fetchCachedSettings(url, { force: options.force || options.refresh });
        const payload = (await response.json().catch(() => ({}))) as ChatgptWebSession & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "The chatgpt.com sign-in could not be read.");
        apply(payload);
        return payload;
      } catch {
        // ChatMock down, or no browser: the row still renders as signed out
        // and the action's own error says why when the person acts.
        return null;
      }
    },
    [apply],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  /** While a sign-in is pending, ask ChatMock every few seconds whether it landed. */
  useEffect(() => {
    if (session?.login?.status !== "awaiting") {
      stopPolling();
      return;
    }
    if (pollRef.current !== null) return;
    pollRef.current = window.setInterval(() => {
      void refresh({ force: true }).then((fresh) => {
        if (!fresh || fresh.login?.status === "awaiting") return;
        stopPolling();
        if (fresh.login?.status === "done" && fresh.signedIn) {
          setNotice(`Signed in to chatgpt.com${fresh.email ? ` as ${fresh.email}` : ""}.`);
          setError(null);
        } else if (fresh.login?.status === "failed") {
          setError(fresh.login.error ?? "Signing in to chatgpt.com did not finish.");
        }
      });
    }, LOGIN_POLL_MS);
  }, [session?.login?.status, refresh, stopPolling]);

  async function run(action: ChatgptWebAction, successNotice: string | null) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => ({}))) as ChatgptWebSession & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The request could not be completed.");
      invalidateSettingsCache(SESSION_URL);
      apply(payload);
      if (payload.error) setError(payload.error);
      else if (successNotice) setNotice(successNotice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  const signedIn = session?.signedIn === true;
  const awaiting = session?.login?.status === "awaiting";
  const inDesktop = chatgptWebTabRelayAvailable();
  const noBrowser = session !== null && !session.browser.available && !inDesktop;

  return (
    <>
      <li className="neu-surface-subtle overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--ink-heading)]">OpenAI (web)</p>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
              {signedIn
                ? `chatgpt.com in ${session?.surface === "browser" ? "its own browser window" : "Breadboard's browser"}${
                    session?.models.length ? ` · ${session.models.length} models` : ""
                  }`
                : "Your ChatGPT plan through chatgpt.com itself, in a signed-in browser tab - the website's own models and limits."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {signedIn ? (
              <button
                type="button"
                onClick={() => void run("sync", "Models refreshed from chatgpt.com.")}
                disabled={busy !== null || awaiting}
                className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {busy === "sync" ? "Syncing…" : "Sync models"}
              </button>
            ) : null}
          </div>
        </div>
        <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-xs text-[var(--ink-muted)]">
                {signedIn
                  ? [session?.email ?? "Signed in to chatgpt.com", planLabel(session?.plan ?? null)]
                      .filter(Boolean)
                      .join(" · ")
                  : awaiting
                    ? "Waiting for you to sign in on chatgpt.com…"
                    : noBrowser
                      ? "Signs in through the browser inside the Breadboard app - open Breadboard to connect it."
                      : "Not signed in."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Dot state={signedIn ? "active" : "off"} />
              {signedIn ? (
                confirmingSignOut ? (
                  <>
                    <span className="text-xs text-[var(--ink-muted)]">Sign out?</span>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingSignOut(false);
                        void run("logout", "Signed out of chatgpt.com.");
                      }}
                      disabled={busy !== null}
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--danger)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
                    >
                      {busy === "logout" ? "Signing out…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingSignOut(false)}
                      disabled={busy !== null}
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingSignOut(true)}
                    disabled={busy !== null}
                    className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                  >
                    Sign out
                  </button>
                )
              ) : awaiting ? (
                <button
                  type="button"
                  onClick={() => void run("cancel-login", null)}
                  disabled={busy !== null}
                  className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                >
                  {busy === "cancel-login" ? "Cancelling…" : "Cancel"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void run("login", null)}
                  disabled={busy !== null || noBrowser}
                  className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {busy === "login" ? "Opening…" : "Sign in"}
                </button>
              )}
            </div>
          </li>
        </ul>
      </li>

      {awaiting ? (
        <li className="neu-inset rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
          <p className="text-xs font-medium text-[var(--ink-heading)]">Sign in on chatgpt.com</p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
            {inDesktop
              ? "A ChatGPT tab just opened in Breadboard's browser. Sign in there as you normally would; this updates as soon as the page is signed in. Leave the tab open afterwards - it is the page your OpenAI (web) requests go through."
              : "A browser window just opened on chatgpt.com. Sign in there as you normally would; this updates as soon as the page is signed in. The window stays open in the background afterwards - it is the page your OpenAI (web) requests go through."}
          </p>
        </li>
      ) : null}

      {notice ? (
        <li className="text-xs leading-5 text-[var(--botanical)]" role="status">
          {notice}
        </li>
      ) : null}
      {error ? (
        <li className="text-xs leading-5 text-[var(--danger)]" role="alert">
          {error}
        </li>
      ) : null}
    </>
  );
}
