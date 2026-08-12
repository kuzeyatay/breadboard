"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ASSISTANT_MODELS_CHANGED_EVENT } from "@/app/components/use-assistant-models";
import type { CliproxyStatus } from "@/lib/cliproxy/management";
import {
  fetchCachedSettings,
  invalidateSettingsCache,
} from "@/lib/settings-client-cache";

/**
 * Sign in to AI subscriptions you already pay for — Claude Pro/Max, ChatGPT,
 * Google/Gemini, Kimi, Grok — with no API key.
 *
 * The local CLIProxyAPI service performs the OAuth flow and stores the
 * credential itself; Breadboard only opens the URL and polls for completion.
 * Once connected, the models are synced into ChatMock as `cliproxy/<model>`.
 */

const POLL_INTERVAL_MS = 2000;

interface PendingLogin {
  provider: string;
  label: string;
  url: string;
  state: string;
  flow: "redirect" | "device";
  userCode?: string;
}

interface SubscriptionsProps {
  /** Called after a sign-in lands so the provider list can pick up new models. */
  onModelsSynced?: () => void;
  /** Scrolls back to the account list, which owns the ChatGPT sign-in. */
  onOpenAccount?: () => void;
  /**
   * Whether the ChatGPT account is signed in. ChatGPT is a subscription too, so
   * it belongs in this list rather than in a provider card of its own — it just
   * authenticates through ChatMock instead of the proxy. Only the connected
   * flag is asked for, and only to choose between Connect and Add another: the
   * identity behind it is the account list's to show.
   */
  chatgptAccount?: { signedIn: boolean } | null;
}

export default function SettingsSubscriptions({
  onModelsSynced,
  onOpenAccount,
  chatgptAccount,
}: SubscriptionsProps) {
  const [status, setStatus] = useState<CliproxyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  // Guards the self-heal below so it runs at most once per mount.
  const reconciledRef = useRef(false);

  const refresh = useCallback(async (force = false) => {
    try {
      const response = await fetchCachedSettings("/api/cliproxy/status", { force });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "The subscription proxy could not be read.");
      setStatus(payload as CliproxyStatus);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The subscription proxy could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Re-read the proxy when an account changes anywhere on the page.
   *
   * This card used to live on its own tab, so switching to it remounted it and
   * it could not be stale. It now sits below the account list, both mounted at
   * once: signing an account out up there would otherwise leave a row here
   * still offering "Add another" for a vendor with nothing left signed in. Every
   * such change already announces itself for the model pickers; this listens to
   * the same announcement.
   */
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener(ASSISTANT_MODELS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(ASSISTANT_MODELS_CHANGED_EVENT, handler);
  }, [refresh]);

  const syncModels = useCallback(async () => {
    const response = await fetch("/api/cliproxy/sync", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "The models could not be synced.");
    onModelsSynced?.();
    return payload.synced as number;
  }, [onModelsSynced]);

  /**
   * Reconcile a sign-in that completed while nobody was watching.
   *
   * The poll below only runs while this panel is mounted with a login pending.
   * A sign-in finished after the panel was closed — or in a previous session —
   * would leave the credential stored in the proxy but its models absent from
   * ChatMock, so the account looks connected and nothing works. Syncing on load
   * whenever the proxy reports models makes that self-correcting.
   */
  useEffect(() => {
    if (reconciledRef.current) return;
    if (!status?.running || status.models.length === 0) return;
    if (!status.accounts.length) return;

    reconciledRef.current = true;
    void (async () => {
      try {
        await syncModels();
      } catch {
        // A manual Sync button remains available.
      }
    })();
  }, [status, syncModels]);

  // While a sign-in is open in another tab, poll until the proxy reports the
  // credential is stored, then pull the models it unlocked.
  useEffect(() => {
    if (!pending) {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/cliproxy/login?state=${encodeURIComponent(pending.state)}`,
            { cache: "no-store" },
          );
          const payload = await response.json().catch(() => ({}));
          if (!payload.complete) return;

          setPending(null);
          await refresh(true);
          try {
            const synced = await syncModels();
            setNotice(`${pending.label} connected. ${synced} models are now available.`);
          } catch (caught) {
            setNotice(`${pending.label} connected.`);
            setError(caught instanceof Error ? caught.message : null);
          }
        } catch {
          // Transient: keep polling until the user cancels.
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [pending, refresh, syncModels]);

  async function connect(providerId: string, label: string) {
    setBusy(providerId);
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

      setPending({
        provider: providerId,
        label,
        url: payload.url,
        state: payload.state,
        flow: payload.flow === "device" ? "device" : "redirect",
        ...(payload.userCode ? { userCode: payload.userCode } : {}),
      });
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sign-in could not be started.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Reading your subscriptions…</p>;
  }

  return (
    <section className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* "Add an account", not "Subscriptions": the accounts already signed
            in are listed above this on the same page, so what is left for this
            card is the vendors you can still sign in to — and a second account
            with the same vendor, which is what Add another means. */}
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[var(--ink-heading)]">Add an account</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            Sign in to plans you already pay for. Nothing is billed per token, and no key is
            stored by Breadboard.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status?.running && status.models.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setBusy("sync");
                setError(null);
                void syncModels()
                  .then((synced) => setNotice(`${synced} models synced.`))
                  .catch((caught: unknown) =>
                    setError(caught instanceof Error ? caught.message : "The sync failed."),
                  )
                  .finally(() => setBusy(null));
              }}
              disabled={busy !== null}
              className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
            >
              {busy === "sync" ? "Syncing…" : "Sync models"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh(true)}
            className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          >
            Refresh
          </button>
        </div>
      </div>

      {!status?.running ? (
        <div className="neu-inset mt-3 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
          <p className="text-xs font-medium text-[var(--ink-heading)]">
            {status?.installed
              ? "The subscription proxy is not running."
              : "The subscription proxy is not installed yet."}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
            It starts with the rest of Breadboard, and the first launch downloads it
            automatically. Restarting the app is usually enough; from a repository checkout
            you can also start it on its own with{" "}
            <span className="font-mono">npm run cliproxy</span>.
          </p>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {/* ChatGPT first: it is a subscription like the rest, but it signs in
            through ChatMock's own OAuth, which the account list above owns —
            hence a button that takes you back up to it rather than a second
            sign-in for the same account.

            No connected marker on any row here. Whether a vendor is signed in
            is what the dots in that list say, one row per real account; a
            badge here would be the same claim a second time, and a vaguer one,
            because these rows are vendors rather than accounts. What this list
            adds is the verb: Connect, or Add another. */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm text-[var(--ink-heading)]">ChatGPT</p>
            {/* Every other row describes the plan rather than the account
                signed into it, and the signed-in identity is already in the
                account list. Saying it twice, in a different shape, made this
                row look like a different kind of entry. */}
            <p className="mt-0.5 truncate text-[11px] text-[var(--ink-muted)]">
              Your ChatGPT plan.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenAccount?.()}
            disabled={!onOpenAccount}
            className="neu-button shrink-0 rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
          >
            {chatgptAccount?.signedIn ? "Add another" : "Connect"}
          </button>
        </div>

        {status?.providers.map((provider) => (
          <div
            key={provider.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm text-[var(--ink-heading)]">{provider.label}</p>
              <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                {provider.description}
                {provider.id === "antigravity" && provider.connected
                  ? " If this account reaches its context quota, add another account here or set up a Google AI Studio key below."
                  : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void connect(provider.id, provider.label)}
              disabled={!status.running || busy !== null || pending !== null}
              className="neu-button shrink-0 rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === provider.id
                ? "Starting…"
                : provider.connected
                  ? "Add another"
                  : "Connect"}
            </button>
          </div>
        ))}
      </div>

      {pending ? (
        <div className="neu-inset mt-3 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
          <p className="text-xs font-medium text-[var(--ink-heading)]">
            Waiting for {pending.label}
          </p>
          {pending.flow === "device" && pending.userCode ? (
            <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
              Enter this code on the page that opened:{" "}
              <span className="font-mono text-sm text-[var(--ink-heading)]">
                {pending.userCode}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">
              Approve the sign-in in the tab that just opened. This panel updates as soon as it
              finishes.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={pending.url}
              target="_blank"
              rel="noopener noreferrer"
              className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
            >
              Reopen the sign-in page
            </a>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {status?.running && status.models.length > 0 ? (
        <p className="mt-3 text-[11px] leading-5 text-[var(--ink-muted)]">
          {status.models.length} subscription models available. They appear as{" "}
          <span className="font-mono">cliproxy/…</span> in the background-model list.
        </p>
      ) : null}

      {notice ? (
        <p className="mt-2 text-xs leading-5 text-[var(--botanical)]" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs leading-5 text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
