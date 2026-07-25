"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ChatmockAccount {
  signedIn: boolean;
  email: string | null;
  plan: string;
  accountId: string | null;
  lastRefresh: string | null;
  authPath: string | null;
  profile: "configured" | "chatmock" | "codex" | null;
  fallbackProfiles: string[];
}

interface ChatmockLoginState {
  status: "idle" | "awaiting_authorization" | "completed" | "failed" | "cancelled";
  authorizationUrl: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

interface AccountPayload {
  account?: ChatmockAccount;
  login?: ChatmockLoginState;
  error?: string;
  archivedPath?: string | null;
  detail?: string;
}

const POLL_INTERVAL_MS = 2000;

const PROFILE_LABELS: Record<string, string> = {
  configured: "configured profile",
  chatmock: "ChatMock profile",
  codex: "Codex CLI profile",
};

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
}

export default function SettingsChatgptAccount() {
  const [account, setAccount] = useState<ChatmockAccount | null>(null);
  const [login, setLogin] = useState<ChatmockLoginState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"login" | "cancel" | "signout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const applyPayload = useCallback((payload: AccountPayload) => {
    if (payload.account) setAccount(payload.account);
    if (payload.login) setLogin(payload.login);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/chatmock/account", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as AccountPayload;
      if (!response.ok) throw new Error(payload.error ?? "The ChatGPT account could not be read.");
      applyPayload(payload);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The ChatGPT account could not be read.");
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While the browser half of the flow is open, poll until ChatMock's login
  // process exits so the panel reports the new account without a manual reload.
  useEffect(() => {
    if (login?.status !== "awaiting_authorization") {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = window.setInterval(() => {
      void (async () => {
        const response = await fetch("/api/chatmock/account/login", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as AccountPayload;
        applyPayload(payload);
        if (payload.login?.status === "completed") {
          setNotice("Signed in. New requests will use this account.");
        } else if (payload.login?.status === "failed") {
          setError(payload.login.error ?? "The sign-in did not complete.");
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [login?.status, applyPayload]);

  async function startLogin() {
    setBusy("login");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/chatmock/account/login", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as AccountPayload;
      applyPayload(payload);
      if (!response.ok || payload.login?.status === "failed") {
        throw new Error(payload.login?.error ?? payload.error ?? "The sign-in could not be started.");
      }
      if (payload.login?.authorizationUrl) {
        window.open(payload.login.authorizationUrl, "_blank", "noopener,noreferrer");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sign-in could not be started.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelLogin() {
    setBusy("cancel");
    try {
      const response = await fetch("/api/chatmock/account/login", { method: "DELETE" });
      applyPayload((await response.json().catch(() => ({}))) as AccountPayload);
      setNotice(null);
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy("signout");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/chatmock/account", { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as AccountPayload;
      applyPayload(payload);
      if (!response.ok) {
        throw new Error(payload.detail ?? payload.error ?? "The account could not be signed out.");
      }
      setNotice(
        payload.archivedPath
          ? `Signed out. The previous credentials were kept at ${payload.archivedPath}.`
          : "Signed out.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The account could not be signed out.");
    } finally {
      setBusy(null);
    }
  }

  const awaiting = login?.status === "awaiting_authorization";
  const lastRefresh = formatTimestamp(account?.lastRefresh ?? null);

  return (
    <div className="space-y-4">
      <section className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4">
        {loading ? (
          <p className="text-sm text-[var(--ink-muted)]">Reading the signed-in account…</p>
        ) : account?.signedIn ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--ink-heading)]">
                  {account.email ?? "Signed in with ChatGPT"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                  {account.plan} plan
                  {account.profile ? ` · ${PROFILE_LABELS[account.profile]}` : ""}
                  {lastRefresh ? ` · refreshed ${lastRefresh}` : ""}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--botanical)_45%,transparent)] bg-[color-mix(in_srgb,var(--botanical)_12%,var(--paper-raised))] px-2.5 py-1 text-[11px] font-medium text-[var(--botanical)]">
                Connected
              </span>
            </div>
            {account.authPath ? (
              <p className="break-all font-mono text-[11px] text-[var(--ink-muted)]">
                {account.authPath}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--ink-heading)]">Not signed in</p>
            <p className="text-xs text-[var(--ink-muted)]">
              Breadboard needs a ChatGPT account to reach the model. Sign in to start.
            </p>
          </div>
        )}
      </section>

      {awaiting ? (
        <section className="neu-inset rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4">
          <p className="text-sm font-medium text-[var(--ink-heading)]">
            Waiting for authorization
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            Approve the sign-in in the browser tab that just opened. This panel updates as
            soon as it finishes.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {login?.authorizationUrl ? (
              <a
                href={login.authorizationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
              >
                Reopen the authorization page
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => void cancelLogin()}
              disabled={busy === "cancel"}
              className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void startLogin()}
          disabled={busy !== null || awaiting}
          className="neu-button-accent rounded-lg border border-[var(--botanical-hover)] bg-[var(--botanical)] px-3.5 py-2 text-sm font-medium text-[var(--paper-raised)] transition hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy === "login"
            ? "Starting…"
            : account?.signedIn
              ? "Switch account"
              : "Sign in with ChatGPT"}
        </button>
        {account?.signedIn ? (
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={busy !== null || awaiting}
            className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3.5 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
          >
            {busy === "signout" ? "Signing out…" : "Sign out"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy !== null}
          className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3.5 py-2 text-sm text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {notice ? (
        <p className="text-xs leading-5 text-[var(--botanical)]" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs leading-5 text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-1.5 border-t border-[var(--line)] pt-3 text-[11px] leading-5 text-[var(--ink-muted)]">
        <p>
          Switching signs in through ChatGPT and replaces the stored credentials. The
          authorization page reuses whatever ChatGPT session your browser already has, so to
          reach a different account either sign out of chatgpt.com first or complete the flow
          in a private window.
        </p>
        <p>
          The sign-in listens on port 1455 and the running proxy picks up new credentials on
          its next request — no restart needed.
        </p>
        {account?.fallbackProfiles.length ? (
          <p>
            Signing out here falls back to another profile already on this machine:{" "}
            <span className="break-all font-mono">{account.fallbackProfiles.join(", ")}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
