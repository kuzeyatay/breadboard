"use client";

// Hooks: real inbound webhooks. An external event either runs a native
// workflow or starts a programmatic chat turn — see src/lib/hooks/{schema,
// store,dispatch}.ts and the receive route at
// app/api/webhooks/trigger/[path]/route.ts. Data loading follows
// processes-panel.tsx's idiom (snapshot state + a guarded load()).
//
// The provider field map below is intentionally hand-written and small — sim
// vendors ~70 providers behind a subBlocks UI-definition machinery; Breadboard
// ships 7 and each one's setup asks for exactly one or two secrets, so a
// declarative array is simpler than porting that machinery.

import { useCallback, useEffect, useRef, useState } from "react";

interface PresentedHook {
  id: string;
  name: string;
  provider: string;
  mode: "chat" | "workflow";
  workflowId: string | null;
  chatInstructions: string | null;
  providerConfig: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  lastFiredAt: string | null;
  fireCount: number;
  url: string;
}

interface WorkflowOption {
  id: string;
  name: string;
}

interface ProviderField {
  key: string;
  label: string;
  placeholder?: string;
  optional?: boolean;
  prefillRandom?: boolean;
}

interface ProviderDef {
  id: string;
  label: string;
  fields: ProviderField[];
  instructions: string[];
}

function randomToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "generic",
    label: "Generic",
    fields: [{ key: "token", label: "Authentication token", prefillRandom: true }],
    instructions: [
      "Copy the webhook URL below and give it to your service or script.",
      "Send it any HTTP POST with a JSON body — that body becomes the hook's payload.",
      "Include the token above as \"Authorization: Bearer TOKEN\" on every request.",
    ],
  },
  {
    id: "github",
    label: "GitHub",
    fields: [{ key: "webhookSecret", label: "Webhook secret", optional: true }],
    instructions: [
      "In your repository, go to Settings > Webhooks > Add webhook.",
      "Paste the webhook URL below into the Payload URL field.",
      "Set Content type to application/json.",
      "Paste the secret above into the Secret field (recommended, not required).",
      "Choose the events you want, then save.",
    ],
  },
  {
    id: "telegram",
    label: "Telegram",
    fields: [{ key: "botToken", label: "Bot token" }],
    instructions: [
      "Message /newbot to @BotFather in Telegram to create a bot and copy its token.",
      "Paste the bot token above — Breadboard registers the webhook with Telegram automatically on save.",
      "Any message sent to your bot will fire this hook once it is created.",
    ],
  },
  {
    id: "stripe",
    label: "Stripe",
    fields: [{ key: "webhookSecret", label: "Signing secret" }],
    instructions: [
      "In the Stripe Dashboard, go to Developers > Webhooks > Add destination.",
      "Paste the webhook URL below into the Endpoint URL field.",
      "Select the events you want to listen for.",
      "After creating the endpoint, reveal the signing secret and paste it above.",
    ],
  },
  {
    id: "slack",
    label: "Slack",
    fields: [
      { key: "signingSecret", label: "Signing secret" },
      { key: "botToken", label: "Bot token (optional, for reaction text)", optional: true },
    ],
    instructions: [
      "In your Slack app's settings, copy the Signing Secret and paste it above.",
      "Under Event Subscriptions, paste the webhook URL below as the Request URL — Slack will send a challenge Breadboard answers automatically.",
      "Subscribe to the events you want, then reinstall the app.",
    ],
  },
  {
    id: "linear",
    label: "Linear",
    fields: [{ key: "webhookSecret", label: "Webhook secret", optional: true }],
    instructions: [
      "In Linear, go to Settings > API > Webhooks > Create webhook.",
      "Paste the webhook URL below into the URL field.",
      "Paste the secret above into the secret field (recommended, not required).",
      "Select the resource types you want, then create.",
    ],
  },
  {
    id: "gitlab",
    label: "GitLab",
    fields: [{ key: "webhookSecret", label: "Secret token" }],
    instructions: [
      "In your GitLab project, go to Settings > Webhooks.",
      "Paste the webhook URL below into the URL field.",
      "Paste the secret above into the Secret token field — GitLab echoes it back on every delivery.",
      "Select the triggers you want, then add the webhook.",
    ],
  },
];

function providerDef(id: string): ProviderDef {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "Never";
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="neu-button shrink-0 rounded-lg px-2 py-1 text-[11px]"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function HooksPanel() {
  const [hooks, setHooks] = useState<PresentedHook[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestActive = useRef(false);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("generic");
  const [mode, setMode] = useState<"chat" | "workflow">("chat");
  const [chatInstructions, setChatInstructions] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<PresentedHook | null>(null);

  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (requestActive.current) return;
    requestActive.current = true;
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/hooks", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        hooks?: PresentedHook[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Hooks could not be loaded.");
      setHooks(Array.isArray(payload.hooks) ? payload.hooks : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hooks could not be loaded.");
    } finally {
      requestActive.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreateForm() {
    setCreating(true);
    setJustCreated(null);
    setFormError(null);
    setName("");
    setProvider("generic");
    setMode("chat");
    setChatInstructions("");
    setWorkflowId("");
    setFieldValues({ token: randomToken() });

    if (mode === "workflow" || true) {
      // Fetched eagerly (not only when workflow mode is picked) so switching
      // the radio button never shows a loading flash.
      setWorkflowsLoading(true);
      fetch("/api/workflows/local", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : { workflows: [] }))
        .then((payload: { workflows?: Array<{ id: string; name: string }> }) => {
          setWorkflows(
            Array.isArray(payload.workflows)
              ? payload.workflows.map((w) => ({ id: w.id, name: w.name }))
              : [],
          );
        })
        .catch(() => setWorkflows([]))
        .finally(() => setWorkflowsLoading(false));
    }
  }

  function selectProvider(nextProvider: string) {
    setProvider(nextProvider);
    const def = providerDef(nextProvider);
    const next: Record<string, string> = {};
    for (const field of def.fields) {
      next[field.key] = field.prefillRandom ? randomToken() : "";
    }
    setFieldValues(next);
  }

  async function submitCreate() {
    if (saving) return;
    setFormError(null);
    if (!name.trim()) {
      setFormError("Give this hook a name.");
      return;
    }
    if (mode === "chat" && !chatInstructions.trim()) {
      setFormError("Tell the assistant what to do when this hook fires.");
      return;
    }
    if (mode === "workflow" && !workflowId) {
      setFormError("Pick a workflow to run.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          mode,
          chatInstructions: mode === "chat" ? chatInstructions.trim() : null,
          workflowId: mode === "workflow" ? workflowId : null,
          providerConfig: fieldValues,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        hook?: PresentedHook;
        telegramWarning?: string;
        error?: string;
      };
      if (!response.ok || !payload.hook) {
        throw new Error(payload.error ?? "This hook could not be created.");
      }
      setJustCreated(payload.hook);
      if (payload.telegramWarning) {
        setFormError(`Hook created, but Telegram registration failed: ${payload.telegramWarning}`);
      }
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "This hook could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(hook: PresentedHook) {
    setError(null);
    try {
      const response = await fetch(`/api/hooks/${hook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !hook.enabled }),
      });
      if (!response.ok) throw new Error("This hook could not be updated.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This hook could not be updated.");
    }
  }

  async function removeHook(hook: PresentedHook) {
    if (!window.confirm(`Delete the hook "${hook.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      const response = await fetch(`/api/hooks/${hook.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("This hook could not be deleted.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This hook could not be deleted.");
    }
  }

  const activeDef = providerDef(provider);

  return (
    <section
      aria-label="Hooks"
      className="flex h-full min-h-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)]"
    >
      <header className="shrink-0 border-b border-[var(--line)] px-4 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-[var(--ink-heading)]">Hooks</h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Create automations that react when something happens.
            </p>
          </div>
          {!creating && hooks.length > 0 ? (
            <button
              type="button"
              onClick={openCreateForm}
              className="neu-button-primary shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold"
            >
              + New hook
            </button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="mb-3 rounded-xl border border-[color-mix(in_srgb,var(--danger)_28%,var(--line))] bg-[var(--paper-raised)] p-3">
            <p className="text-xs text-[var(--danger)]">{error}</p>
            <button type="button" onClick={() => void load(true)} className="mt-2 text-xs font-medium text-[var(--botanical)]">
              Try again
            </button>
          </div>
        ) : null}

        {creating ? (
          <div className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-4">
            {justCreated ? (
              <div>
                <h3 className="text-base font-semibold text-[var(--ink-heading)]">Hook created</h3>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {providerDef(justCreated.provider).label} sends events to this URL.
                </p>
                <div className="neu-control mt-3 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs">{justCreated.url}</code>
                  <CopyUrlButton url={justCreated.url} />
                </div>
                <p className="mt-3 text-xs font-medium text-[var(--ink-heading)]">Setup</p>
                <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-[var(--ink-muted)]">
                  {providerDef(justCreated.provider).instructions.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="mt-3 text-[11px] text-[var(--ink-muted)]">
                  External providers must be able to reach this computer over the internet to deliver
                  events here.
                </p>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="neu-button mt-4 rounded-xl px-4 py-2 text-sm font-medium"
                >
                  Done
                </button>
              </div>
            ) : (
              <div>
                <h3 className="text-base font-semibold text-[var(--ink-heading)]">New hook</h3>

                <label className="mt-3 block text-xs font-medium">
                  Name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. GitHub issues"
                    className="neu-control mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
                  />
                </label>

                <label className="mt-3 block text-xs font-medium">
                  Provider
                  <select
                    value={provider}
                    onChange={(event) => selectProvider(event.target.value)}
                    className="neu-control mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
                  >
                    {PROVIDERS.map((def) => (
                      <option key={def.id} value={def.id}>
                        {def.label}
                      </option>
                    ))}
                  </select>
                </label>

                {activeDef.fields.map((field) => (
                  <label key={field.key} className="mt-3 block text-xs font-medium">
                    {field.label}
                    <input
                      type="password"
                      value={fieldValues[field.key] ?? ""}
                      onChange={(event) =>
                        setFieldValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      placeholder={field.optional ? "Optional" : undefined}
                      className="neu-control mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--botanical)]"
                    />
                  </label>
                ))}

                <div className="mt-4 border-t border-[var(--line)] pt-3">
                  <p className="text-xs font-medium">When this hook fires</p>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      aria-pressed={mode === "chat"}
                      onClick={() => setMode("chat")}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        mode === "chat"
                          ? "border-[var(--botanical)] bg-[var(--botanical)] font-medium text-white"
                          : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                      }`}
                    >
                      Start a chat
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === "workflow"}
                      onClick={() => setMode("workflow")}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        mode === "workflow"
                          ? "border-[var(--botanical)] bg-[var(--botanical)] font-medium text-white"
                          : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                      }`}
                    >
                      Run a workflow
                    </button>
                  </div>

                  {mode === "chat" ? (
                    <label className="mt-3 block text-xs font-medium">
                      Instructions for the assistant
                      <textarea
                        value={chatInstructions}
                        onChange={(event) => setChatInstructions(event.target.value)}
                        rows={3}
                        placeholder="Summarize this event and note anything that needs my attention."
                        className="neu-control mt-1 w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
                      />
                      <span className="mt-1 block text-[10px] font-normal text-[var(--ink-muted)]">
                        The event payload is attached automatically.
                      </span>
                    </label>
                  ) : (
                    <label className="mt-3 block text-xs font-medium">
                      Workflow
                      <select
                        value={workflowId}
                        onChange={(event) => setWorkflowId(event.target.value)}
                        className="neu-control mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
                      >
                        <option value="">
                          {workflowsLoading ? "Loading workflows…" : "Select a workflow"}
                        </option>
                        {workflows.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                      {!workflowsLoading && workflows.length === 0 ? (
                        <span className="mt-1 block text-[10px] font-normal text-[var(--ink-muted)]">
                          No workflows yet.
                        </span>
                      ) : null}
                    </label>
                  )}
                </div>

                {formError ? <p className="mt-3 text-xs text-[var(--danger)]">{formError}</p> : null}

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void submitCreate()}
                    disabled={saving}
                    className="neu-button-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {saving ? "Creating…" : "Create hook"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="neu-button rounded-xl px-4 py-2 text-sm font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : loading ? (
          <div className="space-y-2" aria-label="Loading hooks">
            {[0, 1].map((row) => (
              <div key={row} className="h-20 animate-pulse rounded-xl bg-[var(--paper-strong)] motion-reduce:animate-none" />
            ))}
          </div>
        ) : hooks.length === 0 ? (
          <div className="neu-surface-subtle flex min-h-56 flex-col items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] px-6 py-10 text-center">
            <h3 className="text-base font-semibold text-[var(--ink-heading)]">No hooks yet</h3>
            <p className="mt-1 max-w-sm text-sm text-[var(--ink-muted)]">
              Create a hook to automatically run an action when an event occurs.
            </p>
            <button
              type="button"
              onClick={openCreateForm}
              className="neu-button-primary mt-5 rounded-xl px-4 py-2 text-sm font-semibold"
            >
              + New hook
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {hooks.map((hook) => (
              <li key={hook.id} className="neu-surface-subtle rounded-xl border border-[var(--line)] p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-[var(--ink-heading)]">{hook.name}</p>
                      <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                        {providerDef(hook.provider).label}
                      </span>
                      <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                        {hook.mode === "chat" ? "Chat" : "Workflow"}
                      </span>
                      {!hook.enabled ? (
                        <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
                          Disabled
                        </span>
                      ) : null}
                    </div>
                    <div className="neu-control mt-2 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1">
                      <code className="min-w-0 flex-1 truncate text-[11px]">{hook.url}</code>
                      <CopyUrlButton url={hook.url} />
                    </div>
                    <p className="mt-2 text-[10px] text-[var(--ink-muted)]">
                      Last fired {formatRelative(hook.lastFiredAt)} · {hook.fireCount} total
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      onClick={() => void toggleEnabled(hook)}
                      className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]"
                    >
                      {hook.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeHook(hook)}
                      className="rounded-lg px-2 py-1 text-xs text-[var(--danger)]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!creating && hooks.length > 0 ? (
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="neu-button mt-3 w-full rounded-lg px-3 py-1.5 text-xs text-[var(--ink-muted)] disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
