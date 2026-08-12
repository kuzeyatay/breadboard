"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASSISTANT_MODELS_CHANGED_EVENT,
  notifyAssistantModelsChanged,
} from "@/app/components/use-assistant-models";
import type { CliproxyStatus } from "@/lib/cliproxy/management";
import {
  fetchCachedSettings,
  invalidateSettingsCache,
} from "@/lib/settings-client-cache";

/**
 * Every account Breadboard is signed in to, in one list.
 *
 * ChatGPT and the subscription plans used to be two panels with two headings,
 * which read as two different kinds of thing. They are not: each row is an
 * account, named after the vendor whose models it unlocks — the same naming the
 * model picker uses, so "Claude" and "Anthropic" cannot look like two entries.
 *
 * ChatGPT authenticates through ChatMock's own OAuth (this panel drives it);
 * the rest authenticate through the subscription proxy and are connected from
 * the providers section further down the same page, beside the models each one
 * unlocks.
 */

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

interface Props {
  /** Scrolls to the providers section, which connects a new subscription. */
  onOpenProviders?: () => void;
}

const POLL_INTERVAL_MS = 2000;

/**
 * Connectedness as a dot rather than a word. The row already names the account
 * and the address it belongs to; all the badge added was one bit, in a pill
 * wide enough to crowd the buttons next to it. A dot carries that bit, and —
 * unlike the badge, which could only be present or absent — it can say "not
 * connected" as plainly as it says "connected". The label stays as the
 * accessible name and the tooltip: colour on its own is not a status anyone
 * should have to decode.
 *
 * Deliberately the same bare 8px circle as the runtime lamp in the terminal
 * header, so one shape means "is this thing up" everywhere. Its colours come
 * from the palette rather than the terminal's literal hexes, because this
 * panel is themed and that header is not.
 */
function ConnectionDot({ connected }: { connected: boolean }) {
  const label = connected ? "Connected" : "Not connected";
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={`h-2 w-2 shrink-0 rounded-full ${
        connected ? "bg-[var(--botanical)]" : "bg-[var(--danger)]"
      }`}
    />
  );
}

export default function SettingsAccounts({ onOpenProviders }: Props) {
  const [account, setAccount] = useState<ChatmockAccount | null>(null);
  const [login, setLogin] = useState<ChatmockLoginState | null>(null);
  const [subscriptions, setSubscriptions] = useState<CliproxyStatus | null>(null);
  const [chatgptAccounts, setChatgptAccounts] = useState<
    Array<{
      key: string;
      email: string | null;
      plan: string | null;
      primary: boolean;
      available: boolean;
      cooldownSeconds: number;
      cooldownReason: string | null;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  // `add` and `forget:<key>` belong to the multi-ChatGPT-account helpers below,
  // which are wired but not yet rendered anywhere in this panel.
  const [busy, setBusy] = useState<
    | "login"
    | "cancel"
    | "signout"
    | "add"
    | `forget:${string}`
    | `switch:${string}`
    | `drop:${string}`
    | null
  >(null);
  /**
   * A subscription sign-in opened in another tab.
   *
   * `replacing` is what makes this a switch rather than a second account: the
   * old credential is removed only once a *different* one has landed, so a
   * cancelled or failed sign-in costs nothing. `before` is the set of files
   * that existed when the flow started, which is how "a different one landed"
   * is recognised — re-authorising the same account rewrites the same filename
   * and must not delete anything.
   */
  const [subscriptionLogin, setSubscriptionLogin] = useState<{
    provider: string;
    label: string;
    url: string;
    state: string;
    flow: "redirect" | "device";
    userCode?: string;
    replacing: string | null;
    before: string[];
  } | null>(null);
  /** The credential a Sign out click is waiting for confirmation on. */
  const [confirmingSignOut, setConfirmingSignOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const applyPayload = useCallback((payload: AccountPayload) => {
    if (payload.account) setAccount(payload.account);
    if (payload.login) setLogin(payload.login);
  }, []);

  const refresh = useCallback(async (force = false) => {
    try {
      const response = await fetchCachedSettings("/api/chatmock/account", { force });
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

  const refreshChatgptAccounts = useCallback(async (force = false) => {
    try {
      const response = await fetchCachedSettings("/api/chatmock/accounts", { force });
      if (!response.ok) return;
      const payload = await response.json();
      if (Array.isArray(payload?.accounts)) setChatgptAccounts(payload.accounts);
    } catch {
      // The primary account still renders from /api/chatmock/account.
    }
  }, []);

  const refreshSubscriptions = useCallback(async (force = false): Promise<CliproxyStatus | null> => {
    try {
      const response = await fetchCachedSettings("/api/cliproxy/status", { force });
      if (!response.ok) return null;
      const payload = (await response.json()) as CliproxyStatus;
      setSubscriptions(payload);
      return payload;
    } catch {
      // Optional service: its rows simply do not appear.
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshSubscriptions();
    void refreshChatgptAccounts();
  }, [refresh, refreshSubscriptions, refreshChatgptAccounts]);

  /**
   * Pick up an account connected further down the same page.
   *
   * The providers section below is mounted beside this list rather than on a
   * tab of its own, so a sign-in finished there no longer remounts this list on
   * the way back. A connected account announces itself for the model pickers;
   * the same announcement is what tells this list it has a new row.
   */
  useEffect(() => {
    const handler = () => {
      void refresh();
      void refreshSubscriptions();
    };
    window.addEventListener(ASSISTANT_MODELS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(ASSISTANT_MODELS_CHANGED_EVENT, handler);
  }, [refresh, refreshSubscriptions]);

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
          invalidateSettingsCache("/api/chatmock/account", "/api/chatmock/accounts");
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

  /**
   * Pull ChatMock's copy of the subscription model list back in line.
   *
   * That catalog is a snapshot taken when an account signs in, so removing or
   * replacing one leaves every model picker offering models the proxy can no
   * longer serve. Sign-in already syncs in the providers section below;
   * sign-out and switch have to do the same or they only half-happen.
   */
  const syncSubscriptionModels = useCallback(async () => {
    try {
      const response = await fetch("/api/cliproxy/sync", { method: "POST" });
      if (response.ok) notifyAssistantModelsChanged();
    } catch {
      // Not worth surfacing: the providers section keeps a manual Sync models
      // button.
    }
  }, []);

  /**
   * Finish a subscription switch once the new sign-in lands.
   *
   * The proxy stores one file per account, so signing in again *adds* rather
   * than replaces. Removing the old credential here — after a different one has
   * appeared, never before — is what turns the same flow into a switch, without
   * a window where the reader has no account at all.
   */
  useEffect(() => {
    if (!subscriptionLogin) return;

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/cliproxy/login?state=${encodeURIComponent(subscriptionLogin.state)}`,
            { cache: "no-store" },
          );
          const payload = await response.json().catch(() => ({}));
          if (!payload.complete) return;

          const { label, provider, replacing, before } = subscriptionLogin;
          setSubscriptionLogin(null);

          const fresh = await refreshSubscriptions(true);
          const landed = (fresh?.accounts ?? []).some(
            (entry) => entry.provider === provider && !before.includes(entry.file),
          );

          if (replacing && landed) {
            const removed = await fetch(
              `/api/cliproxy/accounts?file=${encodeURIComponent(replacing)}`,
              { method: "DELETE" },
            );
            if (removed.ok) {
              await refreshSubscriptions(true);
              await syncSubscriptionModels();
              setNotice(`${label} switched to the new account.`);
              return;
            }
            const detail = await removed.json().catch(() => ({}));
            setError(detail.error ?? "The previous account could not be removed.");
            return;
          }

          await syncSubscriptionModels();
          setNotice(
            landed ? `${label} connected.` : `${label} re-authorised on the same account.`,
          );
        } catch {
          // Transient: keep polling until the sign-in lands or is cancelled.
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [subscriptionLogin, refreshSubscriptions, syncSubscriptionModels]);

  /**
   * Start the OAuth flow for a subscription account.
   *
   * `replacing` names the credential this is meant to take the place of; the
   * effect above removes it only once a different account has landed.
   */
  async function startSubscriptionLogin(
    providerId: string,
    label: string,
    replacing: string | null,
  ) {
    setBusy(replacing ? `switch:${replacing}` : "login");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/cliproxy/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "The sign-in could not be started.");
      invalidateSettingsCache("/api/cliproxy/status");

      setSubscriptionLogin({
        provider: providerId,
        label,
        url: payload.url,
        state: payload.state,
        flow: payload.flow === "device" ? "device" : "redirect",
        ...(payload.userCode ? { userCode: payload.userCode } : {}),
        replacing,
        before: (subscriptions?.accounts ?? []).map((entry) => entry.file),
      });
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sign-in could not be started.");
    } finally {
      setBusy(null);
    }
  }

  /** Remove a subscription credential. Confirmed by the caller; not undoable. */
  async function signOutSubscription(file: string, label: string) {
    setBusy(`drop:${file}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/cliproxy/accounts?file=${encodeURIComponent(file)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "That account could not be signed out.");
      }
      await refreshSubscriptions(true);
      await syncSubscriptionModels();
      setNotice(`${label} signed out. Its models are no longer available.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That account could not be signed out.");
    } finally {
      setConfirmingSignOut(null);
      setBusy(null);
    }
  }

  /**
   * Sign in to an additional ChatGPT account.
   *
   * The login flow always writes `auth.json`, so signing in again would replace
   * the current account. Preserving it first turns the same flow into "add",
   * and requests then step to a sibling when one account's plan window is spent.
   */
  async function addAccount() {
    setBusy("add");
    setError(null);
    setNotice(null);
    try {
      const kept = await fetch("/api/chatmock/accounts", { method: "POST" });
      if (!kept.ok) {
        const payload = await kept.json().catch(() => ({}));
        throw new Error(payload.error ?? "The current account could not be kept.");
      }
      invalidateSettingsCache("/api/chatmock/accounts");
      await startLogin();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The account could not be added.");
      setBusy(null);
    }
  }

  async function forgetAccount(key: string) {
    setBusy(`forget:${key}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/chatmock/accounts?key=${encodeURIComponent(key)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("That account could not be removed.");
      await refreshChatgptAccounts(true);
      setNotice("Account removed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That account could not be removed.");
    } finally {
      setBusy(null);
    }
  }

  async function startLogin() {
    setBusy("login");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/chatmock/account/login", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as AccountPayload;
      applyPayload(payload);
      invalidateSettingsCache("/api/chatmock/account");
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
      invalidateSettingsCache("/api/chatmock/account");
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
      invalidateSettingsCache("/api/chatmock/account", "/api/chatmock/accounts");
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
  const subscriptionAccounts = subscriptions?.accounts ?? [];

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Reading your accounts…</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {/* OpenAI, through ChatMock's own OAuth.
            Deliberately the same two-line row as the subscription accounts
            below: every entry in this list is an account, and one of them
            rendering as a taller block with a plan line, a refresh timestamp
            and a file path read as a different kind of thing. The plan is in
            the providers section below, beside the models it unlocks; the
            credential path is a detail of where ChatMock keeps its token, not
            something the reader is being asked to act on. The buttons stay —
            the other rows
            lack a sign-out because their OAuth lives in the proxy, not because
            signing out is meant to be unavailable. */}
        <li className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--ink-heading)]">OpenAI</p>
              <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
                {account?.signedIn
                  ? account.email ?? "Signed in with ChatGPT"
                  : "Not signed in — Breadboard needs this to reach GPT models."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ConnectionDot connected={account?.signedIn === true} />
              <button
                type="button"
                onClick={() => void startLogin()}
                disabled={busy !== null || awaiting}
                className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {busy === "login" ? "Starting…" : account?.signedIn ? "Switch" : "Sign in"}
              </button>
              {account?.signedIn ? (
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={busy !== null || awaiting}
                  className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                >
                  {busy === "signout" ? "Signing out…" : "Sign out"}
                </button>
              ) : null}
            </div>
          </div>

          {awaiting ? (
            <div className="neu-inset mt-3 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
              <p className="text-xs font-medium text-[var(--ink-heading)]">
                Waiting for authorization
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
                Approve the sign-in in the browser tab that just opened. This updates as soon
                as it finishes. The page reuses whatever ChatGPT session your browser already
                has, so to reach a different account, sign out of chatgpt.com first or use a
                {" private window"}.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
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
            </div>
          ) : null}
        </li>

        {/* Everything signed in through the subscription proxy.
            Switch and Sign out mean the same here as they do for OpenAI above,
            but they are built differently: the proxy keeps one file per
            account, so a switch is "sign the new one in, then drop the old"
            and a sign-out is the removal of a credential that cannot be
            restored without redoing OAuth. Hence the confirm step. */}
        {subscriptionAccounts.map((subscription) => {
          const switching = busy === `switch:${subscription.file}`;
          const dropping = busy === `drop:${subscription.file}`;
          const confirming = confirmingSignOut === subscription.file;
          return (
            <li
              key={subscription.file}
              className="neu-surface-subtle flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--ink-heading)]">
                  {subscription.vendorLabel}
                </p>
                <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
                  {subscription.account}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ConnectionDot connected />
                {confirming ? (
                  <>
                    <span className="text-xs text-[var(--ink-muted)]">Sign out?</span>
                    <button
                      type="button"
                      onClick={() =>
                        void signOutSubscription(subscription.file, subscription.vendorLabel)
                      }
                      disabled={busy !== null}
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--danger)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
                    >
                      {dropping ? "Signing out…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingSignOut(null)}
                      disabled={busy !== null}
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void startSubscriptionLogin(
                          subscription.provider,
                          subscription.vendorLabel,
                          subscription.file,
                        )
                      }
                      disabled={busy !== null || subscriptionLogin !== null}
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {switching ? "Starting…" : "Switch"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingSignOut(subscription.file)}
                      disabled={busy !== null || subscriptionLogin !== null}
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                    >
                      Sign out
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {subscriptionLogin ? (
        <div className="neu-inset rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
          <p className="text-xs font-medium text-[var(--ink-heading)]">
            Waiting for {subscriptionLogin.label}
          </p>
          {subscriptionLogin.flow === "device" && subscriptionLogin.userCode ? (
            <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
              Enter this code on the page that opened:{" "}
              <span className="font-mono text-sm text-[var(--ink-heading)]">
                {subscriptionLogin.userCode}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
              Approve the sign-in in the tab that just opened.
              {subscriptionLogin.replacing
                ? " The account you are replacing stays signed in until the new one lands, so cancelling costs nothing."
                : ""}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={subscriptionLogin.url}
              target="_blank"
              rel="noopener noreferrer"
              className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
            >
              Reopen the sign-in page
            </a>
            <button
              type="button"
              onClick={() => setSubscriptionLogin(null)}
              className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* The place this leads is now the next section of the same page rather
            than another tab, so it is named after that section's heading. */}
        {onOpenProviders ? (
          <button
            type="button"
            onClick={onOpenProviders}
            className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3.5 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
          >
            Add an account
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void refresh(true);
            void refreshSubscriptions(true);
          }}
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
          The ChatGPT sign-in listens on port 1455, and the running proxy picks up new
          credentials on its next request — no restart needed.
        </p>
        {account?.fallbackProfiles.length ? (
          <p>
            Signing out of ChatGPT falls back to another profile already on this machine:{" "}
            <span className="break-all font-mono">{account.fallbackProfiles.join(", ")}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
