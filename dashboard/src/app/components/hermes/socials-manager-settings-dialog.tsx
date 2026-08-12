"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AgentRunDefaults from "@/app/components/agents/agent-run-defaults";
import { announceAgentSettingsChanged } from "@/lib/agent-settings/client";

type ProviderField = {
  key: string;
  label: string;
  type: "text" | "password";
  defaultValue?: string;
  hint?: string;
};

type Provider = {
  id: string;
  name: string;
  editor: string;
  maxCharacters: number;
  note?: string;
  description?: string | null;
  connectionMode: "oauth" | "credentials" | "guided" | "extension" | "external" | "unavailable";
  fields: ProviderField[];
};

type Account = {
  id: string;
  name: string;
  identifier: string;
  profile?: string;
  disabled?: boolean;
};

type SettingsResponse = {
  ok: boolean;
  state?: string;
  reason?: string | null;
  providers?: Provider[];
  accounts?: Account[];
  /** The networks a run drafts for when the message names none. */
  networks?: string[];
  error?: string;
};

const TWO_STEP_PROVIDERS = new Set([
  "facebook",
  "instagram",
  "linkedin-page",
  "youtube",
  "gmb",
  "tumblr",
]);

function SettingsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.6 4.1c.1-.6.6-1.1 1.3-1.1h2.2c.7 0 1.2.5 1.3 1.1l.2 1.1c.1.4.3.7.7.9l.8.5c.3.2.8.2 1.1.1l1.1-.4c.6-.2 1.3 0 1.6.6l1.1 2c.3.6.2 1.3-.3 1.7l-.9.7c-.3.3-.5.7-.4 1.1v.9c0 .4.1.8.4 1.1l.9.7c.5.4.6 1.1.3 1.7l-1.1 2c-.3.6-1 .8-1.6.6l-1.1-.4c-.4-.1-.8-.1-1.1.1l-.8.5c-.3.2-.6.5-.7.9l-.2 1.1c-.1.6-.6 1.1-1.3 1.1h-2.2c-.7 0-1.2-.5-1.3-1.1l-.2-1.1c-.1-.4-.3-.7-.7-.9l-.8-.5c-.3-.2-.8-.2-1.1-.1l-1.1.4c-.6.2-1.3 0-1.6-.6l-1.1-2c-.3-.6-.2-1.3.3-1.7l.9-.7c.3-.3.5-.7.4-1.1v-.9c0-.4-.1-.8-.4-1.1l-.9-.7c-.5-.4-.6-1.1-.3-1.7l1.1-2c.3-.6 1-.8 1.6-.6l1.1.4c.4.1.8.1 1.1-.1l.8-.5c.3-.2.6-.5.7-.9l.2-1.1Z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}

export { SettingsIcon as SocialsManagerSettingsIcon };

export default function SocialsManagerSettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  /** Which networks a run drafts for. Saved on every change, not on close. */
  const [networks, setNetworks] = useState<string[]>([]);
  const [savingNetworks, setSavingNetworks] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async (quiet = false): Promise<SettingsResponse | null> => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/socials-manager/settings", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as SettingsResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "Socials Manager settings could not be loaded.");
      setSettings(data);
      setNetworks(data.networks ?? []);
      return data;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Socials Manager settings could not be loaded.");
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [load, onClose]);

  const providers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const list = settings?.providers ?? [];
    if (!normalized) return list;
    return list.filter((provider) =>
      `${provider.name} ${provider.id} ${provider.description ?? ""}`.toLowerCase().includes(normalized),
    );
  }, [query, settings?.providers]);

  const accountsByProvider = useMemo(() => {
    const grouped = new Map<string, Account[]>();
    for (const account of settings?.accounts ?? []) {
      const items = grouped.get(account.identifier) ?? [];
      items.push(account);
      grouped.set(account.identifier, items);
    }
    return grouped;
  }, [settings?.accounts]);

  const connectedIds = useMemo(
    () =>
      [...new Set(
        (settings?.accounts ?? [])
          .filter((account) => !account.disabled)
          // Lower-cased for the same reason the run manager does it: a network
          // id that does not match the registry is silently dropped on save.
          .map((account) => account.identifier.toLowerCase()),
      )],
    [settings?.accounts],
  );

  /**
   * Persist the drafting selection. It is stored as the Socials Manager's saved
   * settings, the same value its settings page writes and the same one every
   * run reads, so this checkbox and that page can never drift apart.
   */
  async function saveNetworks(next: string[], describe: (saved: string[]) => string | null) {
    const previous = networks;
    setNetworks(next);
    setSavingNetworks(true);
    setNotice(null);
    try {
      const response = await fetch("/api/socials-manager/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "networks", networks: next }),
      });
      const data = (await response.json().catch(() => ({}))) as SettingsResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "That choice could not be saved.");
      setSettings(data);
      const saved = data.networks ?? next;
      setNetworks(saved);
      // The agent's own settings page caches these values for the life of the
      // page; tell it what changed rather than letting it serve a stale list.
      announceAgentSettingsChanged("socials-manager");
      setNotice(describe(saved));
    } catch (error) {
      setNetworks(previous);
      setNotice(error instanceof Error ? error.message : "That choice could not be saved.");
    } finally {
      setSavingNetworks(false);
    }
  }

  function toggleNetwork(provider: Provider) {
    const selected = networks.includes(provider.id);
    void saveNetworks(
      selected ? networks.filter((id) => id !== provider.id) : [...networks, provider.id],
      (saved) =>
        selected
          ? saved.length
            ? `${provider.name} removed from your posts.`
            : `${provider.name} removed — nothing is ticked, so posts fall back to your connected accounts.`
          : `${provider.name} added to your posts.`,
    );
  }

  function editProvider(provider: Provider) {
    setConfiguring(provider.id);
    setValues(Object.fromEntries(provider.fields.map((field) => [field.key, field.defaultValue ?? ""])));
    setNotice(null);
  }

  async function authorize(provider: Provider) {
    const baseline = new Set((settings?.accounts ?? []).map((account) => account.id));
    const popup = window.open("about:blank", "breadboard-socials-manager-connect", "popup,width=720,height=760");
    setBusy(provider.id);
    setNotice(null);
    try {
      const response = await fetch("/api/socials-manager/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "authorize", providerId: provider.id }),
      });
      const data = (await response.json().catch(() => ({}))) as SettingsResponse & { url?: string };
      if (!response.ok || !data.url) throw new Error(data.error || `${provider.name} could not connect.`);
      if (!popup) throw new Error("Allow pop-ups for Breadboard to open the social network consent screen.");
      popup.location.href = data.url;
      let attempts = 0;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(() => {
        attempts += 1;
        void load(true).then((fresh) => {
          const connected = fresh?.accounts?.some((account) => !baseline.has(account.id));
          const needsAccountChoice = TWO_STEP_PROVIDERS.has(provider.id);
          if ((!needsAccountChoice && connected) || popup.closed || attempts >= 120) {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            if (connected && !needsAccountChoice) popup.close();
            setBusy(null);
            setNotice(
              connected
                ? `${provider.name} connected. New runs will include it automatically.`
                : attempts >= 120
                  ? "Connection check timed out. Use Refresh after finishing the provider flow."
                  : null,
            );
          }
        });
      }, 2_500);
    } catch (error) {
      popup?.close();
      setBusy(null);
      setNotice(error instanceof Error ? error.message : `${provider.name} could not connect.`);
    }
  }

  async function saveCredentials(provider: Provider) {
    setBusy(provider.id);
    setNotice(null);
    try {
      const response = await fetch("/api/socials-manager/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "credentials",
          providerId: provider.id,
          values,
          timezone: -new Date().getTimezoneOffset(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as SettingsResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || `${provider.name} could not connect.`);
      setSettings(data);
      setNetworks(data.networks ?? []);
      setConfiguring(null);
      setValues({});
      setNotice(`${provider.name} connected. New runs will include it automatically.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${provider.name} could not connect.`);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(account: Account) {
    setBusy(account.id);
    setNotice(null);
    try {
      const response = await fetch("/api/socials-manager/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "disconnect", integrationId: account.id }),
      });
      const data = (await response.json().catch(() => ({}))) as SettingsResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "The account could not be disconnected.");
      setSettings(data);
      setNetworks(data.networks ?? []);
      setNotice(`${account.name} disconnected.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The account could not be disconnected.");
    } finally {
      setBusy(null);
    }
  }

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
        aria-labelledby="socials-manager-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(58rem,94vh)] w-full max-w-[min(64rem,94vw)] flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--line)] px-5 py-4">
          <span className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--botanical)]">
            <SettingsIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <h2 id="socials-manager-settings-title" className="font-serif text-lg text-[var(--ink-heading)]">Social networks</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              Tick the networks every post should be written for, and connect the accounts Postiz publishes them to. A network can be ticked without being connected — the post is drafted either way. Naming networks in a message with <code>--on</code> overrides the ticks for that message.
            </p>
          </span>
          <button type="button" onClick={onClose} className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full" aria-label="Close the Socials Manager settings">
            <svg aria-hidden className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" d="m4 4 8 8m0-8-8 8" /></svg>
          </button>
        </header>

        <div className="border-b border-[var(--line)] px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="neu-inset inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-[var(--ink-muted)]">
              <span className={`h-2 w-2 rounded-full ${settings?.state === "running" ? "bg-[var(--botanical)]" : "bg-amber-500"}`} />
              {settings?.state === "running" ? "Postiz ready" : settings?.state ?? "Checking Postiz"}
            </span>
            <span className="text-xs text-[var(--ink-muted)]">
              {(settings?.accounts ?? []).filter((account) => !account.disabled).length} connected account{(settings?.accounts ?? []).filter((account) => !account.disabled).length === 1 ? "" : "s"}
            </span>
            <button type="button" onClick={() => void load()} disabled={loading} className="neu-button ml-auto rounded-lg px-3 py-1.5 text-xs disabled:opacity-50">Refresh</button>
          </div>

          {/* What the ticks below currently add up to. An empty selection is a
              real state, not a mistake, so it says what happens instead. */}
          <div className="neu-inset mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
            <span className="text-xs text-[var(--ink)]">
              {networks.length
                ? `Every post is written for ${networks.length} chosen network${networks.length === 1 ? "" : "s"}`
                : connectedIds.length
                  ? "No networks chosen — posts go to whichever accounts are connected"
                  : "No networks chosen — posts fall back to a small default set"}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {connectedIds.length ? (
                <button
                  type="button"
                  onClick={() =>
                    void saveNetworks(connectedIds, () => "Your connected networks are now the ones every post is written for.")
                  }
                  disabled={savingNetworks || connectedIds.every((id) => networks.includes(id))}
                  className="neu-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-45"
                >
                  Tick connected
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  void saveNetworks([], () =>
                    connectedIds.length
                      ? "Cleared. Posts go to whichever accounts are connected."
                      : "Cleared. Posts fall back to a small default set until you tick or connect something.",
                  )
                }
                disabled={savingNetworks || !networks.length}
                className="neu-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-45"
              >
                Clear
              </button>
            </span>
          </div>

          {notice || settings?.reason ? (
            <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]" role="status">{notice ?? settings?.reason}</p>
          ) : null}
          <div className="relative mt-3">
            <svg aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="11" cy="11" r="6.5" /><path strokeLinecap="round" d="m16 16 4 4" /></svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--botanical)]" placeholder="Search Instagram, LinkedIn, Threads…" aria-label="Search social networks" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {loading && !settings ? (
            <div className="px-4 py-16 text-center text-sm text-[var(--ink-muted)]">Loading your accounts…</div>
          ) : providers.length ? (
            <ul className="divide-y divide-[var(--line)]">
              {providers.map((provider) => {
                const accounts = accountsByProvider.get(provider.id) ?? [];
                const editing = configuring === provider.id;
                const disabledMode = ["guided", "extension", "external", "unavailable"].includes(provider.connectionMode);
                const chosen = networks.includes(provider.id);
                return (
                  <li key={provider.id} className="px-2 py-3">
                    <div className="flex items-start gap-3">
                      <label
                        className="flex shrink-0 cursor-pointer items-center pt-2"
                        title={`Write every post for ${provider.name}`}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--botanical)]"
                          checked={chosen}
                          disabled={savingNetworks}
                          onChange={() => toggleNetwork(provider)}
                          aria-label={`Write every post for ${provider.name}`}
                        />
                      </label>
                      <span className="neu-inset flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-serif text-sm text-[var(--botanical)]">{provider.name.slice(0, 1).toUpperCase()}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[var(--ink-heading)]">{provider.name}</span>
                          {chosen ? <span className="rounded-full bg-[var(--paper-strong)] px-2 py-0.5 text-[10px] text-[var(--ink-heading)]">Posting here</span> : null}
                          {accounts.length ? <span className="rounded-full bg-[var(--paper-strong)] px-2 py-0.5 text-[10px] text-[var(--botanical)]">Connected</span> : null}
                          <span className="text-[10px] text-[var(--ink-muted)]">{provider.maxCharacters.toLocaleString()} characters</span>
                        </div>
                        {provider.description ? <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">{provider.description}</p> : null}
                        {accounts.map((account) => (
                          <div key={account.id} className="mt-2 flex items-center gap-2 rounded-xl bg-[var(--paper-surface)] px-3 py-2 text-xs">
                            <span className={`h-2 w-2 rounded-full ${account.disabled ? "bg-amber-500" : "bg-[var(--botanical)]"}`} />
                            <span className="min-w-0 flex-1 truncate">{account.name}{account.profile ? ` · ${account.profile}` : ""}</span>
                            <button type="button" onClick={() => void disconnect(account)} disabled={busy !== null} className="text-[var(--ink-muted)] hover:text-red-600 disabled:opacity-40">Disconnect</button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => provider.connectionMode === "credentials" ? editProvider(provider) : void authorize(provider)}
                        disabled={busy !== null || disabledMode}
                        className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--botanical)] disabled:opacity-45"
                        title={
                          provider.connectionMode === "unavailable"
                            ? "Ticking it still writes the post; connecting it needs Postiz running with this provider configured."
                            : disabledMode
                              ? "This provider requires a specialized Postiz setup flow."
                              : `Connect ${provider.name}`
                        }
                      >
                        {busy === provider.id
                          ? "Connecting…"
                          : provider.connectionMode === "unavailable"
                            ? settings?.state === "running" ? "Not offered" : "Postiz offline"
                            : disabledMode
                              ? "Special setup"
                              : accounts.length
                                ? "Add another"
                                : "Connect"}
                      </button>
                    </div>

                    {editing ? (
                      <form
                        className="neu-inset ml-12 mt-3 rounded-xl p-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveCredentials(provider);
                        }}
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          {provider.fields.map((field) => (
                            <label key={field.key} className="text-xs text-[var(--ink-muted)]">
                              <span className="mb-1 block">{field.label}</span>
                              <input
                                type={field.type}
                                value={values[field.key] ?? ""}
                                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                                className="neu-control w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]"
                                autoComplete="off"
                                required
                              />
                              {field.hint ? <span className="mt-1 block text-[10px] leading-4">{field.hint}</span> : null}
                            </label>
                          ))}
                        </div>
                        <div className="mt-3 flex justify-end gap-2">
                          <button type="button" onClick={() => setConfiguring(null)} className="neu-button rounded-lg px-3 py-1.5 text-xs">Cancel</button>
                          <button type="submit" disabled={busy !== null} className="neu-button-primary rounded-lg px-3 py-1.5 text-xs disabled:opacity-50">Connect securely</button>
                        </div>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-16 text-center text-sm text-[var(--ink-muted)]">{query ? "No social networks matched your search." : "Postiz did not report any available social networks."}</div>
          )}

          {/* One settings button per agent means the run defaults live here too,
              below the accounts rather than behind a second button. */}
          <section className="mt-4 border-t border-[var(--line)] px-1 pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Defaults
            </h3>
            <div className="mt-2">
              {/* The networks are ticked in the account list above, which knows
                  which of them are actually connected. */}
              <AgentRunDefaults agentId="socials-manager" omit={["networks"]} />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
