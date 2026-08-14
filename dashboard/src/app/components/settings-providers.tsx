"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notifyAssistantModelsChanged } from "@/app/components/use-assistant-models";
import { providerStatusBadge } from "@/lib/provider-status";
import type {
  ChatmockProvider,
  ChatmockProviderState,
} from "@/lib/chatmock-providers";
import { fetchCachedSettings } from "@/lib/settings-client-cache";

/**
 * Provider settings: which model backends ChatMock can reach, and which model
 * backs every Breadboard surface (chat, Hermes, UI-TARS, OpenCode, research).
 *
 * Keys are written straight through to ChatMock and never held by the
 * dashboard; the inputs are cleared as soon as a save succeeds.
 */

interface DraftState {
  apiKey: string;
  baseUrl: string;
  models: string;
}

type VerifyResult = { ok: boolean; models?: string[]; error?: string };

export default function SettingsProviders() {
  const [state, setState] = useState<ChatmockProviderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [verified, setVerified] = useState<Record<string, VerifyResult>>({});
  // Every card starts closed. A card that opens itself claims the height of a
  // key field, a base URL and four buttons from every reader who came here for
  // one of the others.
  const [expanded, setExpanded] = useState<string | null>(null);

  const applyState = useCallback((next: ChatmockProviderState) => {
    setState(next);
    // Stored keys are never returned, so drafts reset to blank on every load.
    setDrafts(
      Object.fromEntries(
        next.providers.map((provider) => [
          provider.id,
          {
            apiKey: "",
            baseUrl: provider.baseUrl ?? "",
            models: provider.customModels.join(", "),
          },
        ]),
      ),
    );
  }, []);

  const refresh = useCallback(async (force = false) => {
    try {
      const response = await fetchCachedSettings("/api/chatmock/providers", { force });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "The providers could not be read.");
      }
      applyState(payload as ChatmockProviderState);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The providers could not be read.");
    } finally {
      setLoading(false);
    }
  }, [applyState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Providers that need a card of their own.
   *
   * ChatGPT and the subscription proxy are both listed in the add-an-account
   * panel above — repeating them here was the same entry twice under two names.
   *
   * Pay-per-token providers normally appear only after a key was explicitly
   * stored; ChatMock deliberately ignores stray environment keys (see
   * `env_provider_keys_allowed`). Google is the one setup-first exception: it
   * is the reliable recovery path when an OAuth subscription account is
   * temporarily unable to carry Breadboard's full system context, and hiding it
   * before setup would make that path impossible to reach from the app.
   */
  const visibleProviders = useMemo(
    () =>
      (state?.providers ?? []).filter(
        (provider) =>
          provider.kind !== "chatgpt_oauth" &&
          provider.id !== "cliproxy" &&
          (provider.id === "google" || !provider.requiresApiKey || provider.hasStoredKey),
      ),
    [state],
  );


  async function mutate(
    key: string,
    run: () => Promise<Response>,
    successMessage: string,
  ) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const response = await run();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "The change could not be saved.");
      }
      applyState(payload as ChatmockProviderState);
      // Connecting, disabling or forgetting a provider changes which models
      // exist. ChatMock already serves the new list; tell the pickers so the
      // menu is not the one place still showing the old one.
      notifyAssistantModelsChanged();
      setNotice(successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  function saveProvider(provider: ChatmockProvider) {
    const draft = drafts[provider.id];
    if (!draft) return;
    const body: Record<string, unknown> = { providerId: provider.id };
    if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();
    if (provider.baseUrlEditable || draft.baseUrl !== (provider.baseUrl ?? "")) {
      body.baseUrl = draft.baseUrl.trim();
    }
    body.models = draft.models
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);

    void mutate(
      provider.id,
      () =>
        fetch("/api/chatmock/providers", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      `${provider.label} saved.`,
    );
  }

  function toggleProvider(provider: ChatmockProvider) {
    void mutate(
      provider.id,
      () =>
        fetch("/api/chatmock/providers", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId: provider.id, enabled: !provider.enabled }),
        }),
      provider.enabled ? `${provider.label} turned off.` : `${provider.label} turned on.`,
    );
  }

  function forgetProvider(provider: ChatmockProvider) {
    void mutate(
      provider.id,
      () =>
        fetch(`/api/chatmock/providers?providerId=${encodeURIComponent(provider.id)}`, {
          method: "DELETE",
        }),
      `${provider.label} credentials removed.`,
    );
  }

  async function testProvider(provider: ChatmockProvider) {
    setBusy(`verify:${provider.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/chatmock/providers/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as VerifyResult;
      setVerified((current) => ({ ...current, [provider.id]: payload }));
      if (payload.ok) {
        setNotice(
          payload.models?.length
            ? `${provider.label} responded with ${payload.models.length} models.`
            : `${provider.label} responded.`,
        );
      } else {
        setError(payload.error ?? `${provider.label} did not respond.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The check could not run.");
    } finally {
      setBusy(null);
    }
  }


  // No second "Reading…" line, and no rule above one. Both halves of the
  // Account tab load at once, so two waiting messages stacked either side of a
  // separator read as two things loading rather than one page. The account
  // list's line speaks for the tab; this half — separator included — simply
  // appears once it has something to show.
  if (loading) return null;

  return (
    <div className="space-y-4 border-t border-[var(--line)] pt-5">
      {/* No card for the subscription proxy. It reported on a service the
          reader never chose to run and cannot usefully act on: the account list
          above already says which subscriptions are signed in, syncs the models
          they unlock, and is the only place a sign-in starts. */}

      {/*
        No background-model panel here. The Intelligence menu next to the
        composer is the only place that setting lives; restating it made the tab
        look like a second control for something it does not own.
      */}

      {/* Named, because this section now follows two others on one page and an
          unlabelled run of cards after "Add an account" reads as more of the
          same. These are the providers billed by the token, which is the whole
          difference from the list above. */}
      {visibleProviders.length ? (
        <div className="pt-1">
          <h3 className="text-sm font-medium text-[var(--ink-heading)]">Pay-per-token providers</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            An API key you pay for by usage, rather than a plan you already subscribe to.
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        {visibleProviders.map((provider) => {
          /**
           * A card with nothing set up already says so twice — "no API key is
           * configured" under the description, and a button that reads Set up
           * rather than Edit. A "Not configured" badge was a third statement of
           * it, and the loudest of the three. The badge now speaks only when it
           * carries something the card does not: connected, or switched off.
           */
          const status = providerStatusBadge(provider);
          const badge = status && status.tone !== "idle" ? status : null;
          const draft = drafts[provider.id] ?? { apiKey: "", baseUrl: "", models: "" };
          const isOpen = expanded === provider.id;

          return (
            <section
              key={provider.id}
              className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--ink-heading)]">
                      {provider.label}
                    </p>
                    {badge ? (
                      <span
                        className={
                          badge.tone === "connected"
                            ? "rounded-full border border-[color-mix(in_srgb,var(--botanical)_45%,transparent)] bg-[color-mix(in_srgb,var(--botanical)_12%,var(--paper-raised))] px-2 py-0.5 text-[10px] font-medium text-[var(--botanical)]"
                            : "rounded-full border border-[var(--line-strong)] bg-[var(--paper-strong)] px-2 py-0.5 text-[10px] text-[var(--ink-muted)]"
                        }
                      >
                        {badge.text}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
                    {provider.description}
                  </p>
                  {provider.keyFromEnvironment ? (
                    <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                      Using a key from the environment ({provider.apiKeyEnv.join(" / ")}).
                    </p>
                  ) : null}
                  {provider.unavailableReason && provider.enabled ? (
                    <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                      {provider.unavailableReason}
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : provider.id)}
                  className="neu-button shrink-0 rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
                >
                  {isOpen ? "Close" : provider.configured ? "Edit" : "Set up"}
                </button>
              </div>

              {isOpen ? (
                <div className="mt-3 space-y-3 border-t border-[var(--line)] pt-3">
                  {provider.requiresApiKey || provider.apiKeyEnv.length ? (
                    <label className="block">
                      <span className="text-xs font-medium text-[var(--ink)]">
                        API key
                        {provider.hasStoredKey ? (
                          <span className="ml-1 font-normal text-[var(--ink-muted)]">
                            (stored: {provider.apiKeyHint})
                          </span>
                        ) : null}
                      </span>
                      <input
                        type="password"
                        autoComplete="off"
                        value={draft.apiKey}
                        placeholder={provider.hasStoredKey ? "Enter a new key to replace" : "Paste the key"}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [provider.id]: { ...draft, apiKey: event.target.value },
                          }))
                        }
                        className="neu-inset mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-2 font-mono text-xs text-[var(--ink)]"
                      />
                    </label>
                  ) : null}

                  <label className="block">
                    <span className="text-xs font-medium text-[var(--ink)]">Base URL</span>
                    <input
                      type="url"
                      inputMode="url"
                      value={draft.baseUrl}
                      placeholder={provider.defaultBaseUrl ?? "https://…"}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [provider.id]: { ...draft, baseUrl: event.target.value },
                        }))
                      }
                      className="neu-inset mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-2 font-mono text-xs text-[var(--ink)]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-[var(--ink)]">
                      Extra model ids
                      <span className="ml-1 font-normal text-[var(--ink-muted)]">
                        comma separated
                      </span>
                    </span>
                    <input
                      type="text"
                      value={draft.models}
                      placeholder={provider.suggestedModels.join(", ") || "model-id"}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [provider.id]: { ...draft, models: event.target.value },
                        }))
                      }
                      className="neu-inset mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-2 font-mono text-xs text-[var(--ink)]"
                    />
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => saveProvider(provider)}
                      disabled={busy !== null}
                      className="neu-button-accent rounded-lg border border-[var(--botanical-hover)] bg-[var(--botanical)] px-3 py-1.5 text-xs font-medium text-[var(--paper-raised)] transition hover:bg-[var(--botanical-hover)] disabled:opacity-55"
                    >
                      {busy === provider.id ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void testProvider(provider)}
                      disabled={busy !== null || !provider.configured}
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
                    >
                      {busy === `verify:${provider.id}` ? "Checking…" : "Test connection"}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleProvider(provider)}
                      disabled={busy !== null}
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                    >
                      {provider.enabled ? "Turn off" : "Turn on"}
                    </button>
                    {provider.hasStoredKey || provider.customModels.length ? (
                      <button
                        type="button"
                        onClick={() => forgetProvider(provider)}
                        disabled={busy !== null}
                        className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--danger)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
                      >
                        Forget
                      </button>
                    ) : null}
                    {provider.docsUrl ? (
                      <a
                        href={provider.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="self-center text-xs text-[var(--ink-muted)] underline underline-offset-2 hover:text-[var(--ink)]"
                      >
                        Get a key
                      </a>
                    ) : null}
                  </div>

                  {verified[provider.id]?.models?.length ? (
                    <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
                      {verified[provider.id]!.models!.length} models available, including{" "}
                      <span className="font-mono">
                        {verified[provider.id]!.models!.slice(0, 3).join(", ")}
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
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

      {/* No closing footnote. Where the keys are kept and when they take
          effect were reassurances about work the cards above already do and
          finish on their own, and the file path underneath was an address
          nothing on this page ever asks the reader to visit. */}
    </div>
  );
}
