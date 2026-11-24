"use client";

// Hooks: inbound webhooks plus Breadboard-owned lifecycle triggers. An event
// either runs a native workflow or starts a programmatic chat turn — see
// src/lib/hooks/{schema,store,dispatch}.ts and the receive route at
// app/api/webhooks/trigger/[path]/route.ts.
//
// The panel is laid out like the Scheduled panel beside it: one sentence in a
// composer ("whenever a chat about invoices finishes, file the totals"), a line
// saying what that sentence was understood as, and a short list of ready-made
// suggestions underneath. The trigger and action pickers sit behind the "+"
// for anything the sentence reader gets wrong; a webhook's secret is the only
// field that is ever asked for up front, because nothing can guess it.
//
// The provider field map below is intentionally hand-written and small — sim
// vendors ~70 providers behind a subBlocks UI-definition machinery; Breadboard
// ships a deliberately small set, so a declarative array is simpler than
// porting that machinery.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { useConfirmDialog } from "@/app/components/confirm-dialog";
import { parseHookRequest, resolveWorkflowByName } from "@/lib/hooks/natural-language.ts";

type HookActionMode = "chat" | "workflow" | "command";

interface Props {
  /**
   * Set inside a garden: the panel lists only that garden's hooks, and a hook
   * created here belongs to it — the chat its events start opens in that
   * garden, with that garden's notes and tools.
   */
  gardenSlug?: string | null;
}

interface PresentedHook {
  id: string;
  name: string;
  provider: string;
  mode: HookActionMode;
  command: string | null;
  lastResult: string | null;
  workflowId: string | null;
  chatInstructions: string | null;
  providerConfig: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  lastFiredAt: string | null;
  fireCount: number;
  url: string | null;
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
  /** Not a secret: shown as typed rather than masked. */
  plain?: boolean;
}

interface ProviderDef {
  id: string;
  label: string;
  emoji: string;
  fields: ProviderField[];
  instructions: string[];
  internal?: boolean;
  /** Internal triggers: when it runs, completing "Runs automatically …". */
  summary?: string;
}

interface HookTemplate {
  emoji: string;
  name: string;
  description: string;
}

const TOOL_MATCHER_FIELD: ProviderField = {
  key: "matcher",
  label: "Only these tools",
  placeholder: "Optional — a tool name, or several such as web_search|web_extract",
  optional: true,
  plain: true,
};

function randomToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "chat_completed",
    label: "Chat finished",
    emoji: "✅",
    fields: [
      {
        key: "matcher",
        label: "Only chats that mention",
        placeholder: "Optional — a word, or a pattern such as invoice|receipt",
        optional: true,
        plain: true,
      },
    ],
    internal: true,
    summary: "after a successful chat",
    instructions: [
      "Runs only after an assistant answer is saved successfully.",
      "Failed, cancelled, temporary, and hook-created chats are ignored.",
      "A Garden hook reacts to chats in that Garden; a dashboard hook reacts everywhere.",
    ],
  },
  {
    id: "session_started",
    label: "Chat started",
    emoji: "🌅",
    fields: [],
    internal: true,
    summary: "when a new chat starts",
    instructions: [
      "Runs once when a new chat is created.",
      "Temporary and hook-created chats are ignored.",
    ],
  },
  {
    id: "prompt_submitted",
    label: "Prompt sent",
    emoji: "✉️",
    fields: [
      {
        key: "matcher",
        label: "Only prompts that mention",
        placeholder: "Optional — a word, or a pattern such as deploy|release",
        optional: true,
        plain: true,
      },
    ],
    internal: true,
    summary: "when a prompt is sent",
    instructions: [
      "Runs when a message is accepted for an answer.",
      "It is told about the prompt; it cannot change or stop it.",
    ],
  },
  {
    id: "tool_started",
    label: "Tool started",
    emoji: "🛠️",
    fields: [TOOL_MATCHER_FIELD],
    internal: true,
    summary: "when a tool starts",
    instructions: [
      "Runs as the assistant begins a tool call.",
      "It is told about the call; it cannot approve or block it.",
    ],
  },
  {
    id: "tool_used",
    label: "Tool finished",
    emoji: "🧰",
    fields: [TOOL_MATCHER_FIELD],
    internal: true,
    summary: "after a tool finishes",
    instructions: [
      "Runs after each tool call the assistant completes.",
      "Leave the filter empty to react to every tool.",
    ],
  },
  {
    id: "generic",
    label: "Webhook",
    emoji: "🪝",
    fields: [{ key: "token", label: "Authentication token", prefillRandom: true }],
    instructions: [
      "Copy the webhook URL below and give it to your service or script.",
      "Send it any HTTP POST with a JSON body — that body becomes the hook's payload.",
      "Include the token as \"Authorization: Bearer TOKEN\" on every request.",
    ],
  },
  {
    id: "github",
    label: "GitHub",
    emoji: "🐙",
    fields: [{ key: "webhookSecret", label: "Webhook secret", optional: true }],
    instructions: [
      "In your repository, go to Settings > Webhooks > Add webhook.",
      "Paste the webhook URL below into the Payload URL field.",
      "Set Content type to application/json.",
      "Paste the secret into the Secret field (recommended, not required).",
      "Choose the events you want, then save.",
    ],
  },
  {
    id: "telegram",
    label: "Telegram",
    emoji: "✈️",
    fields: [{ key: "botToken", label: "Bot token" }],
    instructions: [
      "Message /newbot to @BotFather in Telegram to create a bot and copy its token.",
      "Paste the bot token — Breadboard registers the webhook with Telegram automatically on save.",
      "Any message sent to your bot will fire this hook once it is created.",
    ],
  },
  {
    id: "stripe",
    label: "Stripe",
    emoji: "💳",
    fields: [{ key: "webhookSecret", label: "Signing secret" }],
    instructions: [
      "In the Stripe Dashboard, go to Developers > Webhooks > Add destination.",
      "Paste the webhook URL below into the Endpoint URL field.",
      "Select the events you want to listen for.",
      "After creating the endpoint, reveal the signing secret and paste it into the hook.",
    ],
  },
  {
    id: "slack",
    label: "Slack",
    emoji: "💬",
    fields: [
      { key: "signingSecret", label: "Signing secret" },
      { key: "botToken", label: "Bot token (optional, for reaction text)", optional: true },
    ],
    instructions: [
      "In your Slack app's settings, copy the Signing Secret and paste it into the hook.",
      "Under Event Subscriptions, paste the webhook URL below as the Request URL — Slack will send a challenge Breadboard answers automatically.",
      "Subscribe to the events you want, then reinstall the app.",
    ],
  },
  {
    id: "linear",
    label: "Linear",
    emoji: "📐",
    fields: [{ key: "webhookSecret", label: "Webhook secret", optional: true }],
    instructions: [
      "In Linear, go to Settings > API > Webhooks > Create webhook.",
      "Paste the webhook URL below into the URL field.",
      "Paste the secret into the secret field (recommended, not required).",
      "Select the resource types you want, then create.",
    ],
  },
  {
    id: "gitlab",
    label: "GitLab",
    emoji: "🦊",
    fields: [{ key: "webhookSecret", label: "Secret token" }],
    instructions: [
      "In your GitLab project, go to Settings > Webhooks.",
      "Paste the webhook URL below into the URL field.",
      "Paste the secret into the Secret token field — GitLab echoes it back on every delivery.",
      "Select the triggers you want, then add the webhook.",
    ],
  },
];

const MODES: Array<{ id: HookActionMode; emoji: string; label: string }> = [
  { id: "chat", emoji: "💬", label: "Start a chat" },
  { id: "workflow", emoji: "🔀", label: "Run a workflow" },
  { id: "command", emoji: "⌨️", label: "Run a command" },
];

// Suggestions, not built-ins: each one is only a sentence the composer reads,
// so what you get is exactly what the line under the box says it understood.
// Several lean on Recall, the assistant's memory of what was on screen, since
// "pick up where I left off" is what a hook is best placed to do.
const TERMINAL_TEMPLATES: HookTemplate[] = [
  {
    emoji: "☀️",
    name: "Pick up where I left off",
    description:
      "When a new chat starts, use Recall to remind me in two lines what I was working on last",
  },
  {
    emoji: "🧾",
    name: "Receipt keeper",
    description:
      "Whenever a chat mentioning invoice or receipt finishes, list the amounts, dates and vendors it found",
  },
  {
    emoji: "🔎",
    name: "Source catcher",
    description:
      "After the web_search tool finishes, keep the three most useful sources with a one-line note on each",
  },
  {
    emoji: "🚀",
    name: "Release check",
    description:
      "Whenever I send a prompt about deploy or release, check what I changed recently with Recall and list anything that looks unfinished",
  },
  {
    emoji: "✨",
    name: "Follow-up spotter",
    description:
      "Whenever a chat finishes, note any promise, deadline or follow-up it mentions so nothing slips",
  },
  {
    emoji: "🐙",
    name: "PR buddy",
    description: "When a GitHub pull request is opened, review it and tell me what needs attention",
  },
];

const GARDEN_TEMPLATES: HookTemplate[] = [
  {
    emoji: "🌱",
    name: "Grow the garden",
    description:
      "Whenever a chat finishes, add anything new I learned to the right note in this garden",
  },
  {
    emoji: "🧠",
    name: "Recall the context",
    description:
      "When a new chat starts, recall the notes in this garden closest to what I was last reading on screen",
  },
  {
    emoji: "📚",
    name: "Reading list",
    description:
      "Whenever a chat mentioning paper or article finishes, add it to this garden's reading list with a one-line summary",
  },
  {
    emoji: "🃏",
    name: "Flashcard maker",
    description:
      "Whenever a chat about exam or quiz finishes, turn the key points into flashcards in this garden",
  },
  {
    emoji: "🔗",
    name: "Link weaver",
    description:
      "Whenever a chat finishes, suggest links between the notes it touched and the rest of this garden",
  },
  {
    emoji: "📎",
    name: "Clip to notes",
    description:
      "After the web_extract tool finishes, save the page as a source note in this garden",
  },
];

function providerDef(id: string): ProviderDef {
  return (
    PROVIDERS.find((candidate) => candidate.id === id) ??
    PROVIDERS.find((candidate) => candidate.id === "generic")!
  );
}

function modeDef(id: HookActionMode) {
  return MODES.find((candidate) => candidate.id === id) ?? MODES[0];
}

function freshFieldValues(provider: string, matcher?: string | null): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of providerDef(provider).fields) {
    next[field.key] = field.prefillRandom ? randomToken() : "";
  }
  if ("matcher" in next && matcher) next.matcher = matcher;
  return next;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
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
      className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--botanical)]"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

const CONTROL_CLASS =
  "neu-control mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]";

function chipClass(selected: boolean): string {
  return `rounded-full border px-3 py-1 text-xs transition ${
    selected
      ? "border-[var(--botanical)] bg-[var(--botanical)] font-medium text-white"
      : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
  }`;
}

export default function HooksPanel({ gardenSlug = null }: Props = {}) {
  const { confirm: confirmDelete, confirmDialog } = useConfirmDialog();
  const [hooks, setHooks] = useState<PresentedHook[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const requestActive = useRef(false);

  const [text, setText] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [provider, setProvider] = useState("chat_completed");
  const [mode, setMode] = useState<HookActionMode>("chat");
  const [command, setCommand] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    freshFieldValues("chat_completed"),
  );
  // Once a picker is used by hand, the sentence stops overriding that choice.
  const [providerPinned, setProviderPinned] = useState(false);
  const [modePinned, setModePinned] = useState(false);
  // A suggestion used as-is keeps its friendly name ("Receipt keeper") rather
  // than the trigger clause, which several suggestions share.
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justCreated, setJustCreated] = useState<PresentedHook | null>(null);

  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (requestActive.current) return;
    requestActive.current = true;
    try {
      const response = await fetch(
        gardenSlug ? `/api/hooks?gardenSlug=${encodeURIComponent(gardenSlug)}` : "/api/hooks",
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        hooks?: PresentedHook[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Hooks could not be loaded.");
      setHooks(Array.isArray(payload.hooks) ? payload.hooks : []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Hooks could not be loaded.");
    } finally {
      requestActive.current = false;
      setLoading(false);
    }
  }, [gardenSlug]);

  useEffect(() => {
    void load();
    // Hooks fire in the background; keep the "last fired" lines honest.
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
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
  }, []);

  const parsed = useMemo(() => parseHookRequest(text), [text]);
  const activeDef = providerDef(provider);
  const activeMode = modeDef(mode);
  const templates = gardenSlug ? GARDEN_TEMPLATES : TERMINAL_TEMPLATES;

  /**
   * The sentence fills the pickers rather than bypassing them: what was
   * understood stays visible on the line below and can be corrected behind +.
   */
  function describe(next: string) {
    setText(next);
    if (!next.trim()) return;
    const reading = parseHookRequest(next);
    if (!providerPinned) {
      if (reading.provider !== provider) {
        setProvider(reading.provider);
        setFieldValues(freshFieldValues(reading.provider, reading.matcher));
      } else if (providerDef(reading.provider).fields.some((field) => field.key === "matcher")) {
        setFieldValues((prev) => ({ ...prev, matcher: reading.matcher ?? "" }));
      }
    }
    if (!modePinned) {
      setMode(reading.mode);
      setCommand(reading.command ?? "");
      setWorkflowId(resolveWorkflowByName(reading.workflowName, workflows)?.id ?? "");
    }
  }

  function pickProvider(next: string) {
    setProviderPinned(true);
    if (next === provider) return;
    setProvider(next);
    setFieldValues(freshFieldValues(next, fieldValues.matcher));
  }

  function pickMode(next: HookActionMode) {
    setModePinned(true);
    setMode(next);
  }

  function resetComposer() {
    setText("");
    setTemplateName(null);
    setOptionsOpen(false);
    setProviderPinned(false);
    setModePinned(false);
    setProvider("chat_completed");
    setFieldValues(freshFieldValues("chat_completed"));
    setMode("chat");
    setCommand("");
    setWorkflowId("");
  }

  // A secret nobody could guess is asked for inline; everything else waits
  // behind +. The pre-filled webhook token never needs to be typed.
  const inlineFields = activeDef.fields.filter(
    (field) => field.key !== "matcher" && !field.prefillRandom,
  );

  const instructions = (parsed.instructions || text).trim();

  async function create() {
    if (saving || !text.trim()) return;
    setMessage(null);
    if (mode === "workflow" && !workflowId) {
      setOptionsOpen(true);
      setMessage("Pick the workflow this hook should run.");
      return;
    }
    if (mode === "command" && !command.trim()) {
      setOptionsOpen(true);
      setMessage("Enter the command to run — or put it between `backticks` in the sentence.");
      return;
    }
    const missing = activeDef.fields.find(
      (field) => !field.optional && !(fieldValues[field.key] ?? "").trim(),
    );
    if (missing) {
      setMessage(`${activeDef.label} needs its ${missing.label.toLowerCase()} first.`);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName ?? (parsed.name || "New hook"),
          provider,
          mode,
          chatInstructions: mode === "chat" ? instructions : null,
          workflowId: mode === "workflow" ? workflowId : null,
          command: mode === "command" ? command.trim() : null,
          providerConfig: fieldValues,
          gardenSlug,
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
      resetComposer();
      // Only a webhook has something left to do: hand its URL to the service.
      setJustCreated(payload.hook.url ? payload.hook : null);
      setMessage(
        payload.telegramWarning
          ? `Hook created, but Telegram registration failed: ${payload.telegramWarning}`
          : providerDef(payload.hook.provider).internal
            ? `🎉 "${payload.hook.name}" is live — it runs ${providerDef(payload.hook.provider).summary}.`
            : `🎉 "${payload.hook.name}" is ready. Give its URL to ${providerDef(payload.hook.provider).label}.`,
      );
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "This hook could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(hook: PresentedHook) {
    setMessage(null);
    try {
      const response = await fetch(`/api/hooks/${hook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !hook.enabled }),
      });
      if (!response.ok) throw new Error("This hook could not be updated.");
      await load();
      setMessage(hook.enabled ? "Hook paused." : "Hook resumed.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "This hook could not be updated.");
    }
  }

  async function removeHook(hook: PresentedHook) {
    if (
      !(await confirmDelete({
        title: "Delete hook?",
        subject: hook.name,
        body: "This stops the hook from reacting to any more events.",
        detail: "Chats it already started are kept.",
        confirmLabel: "Delete hook",
        tone: "danger",
      }))
    ) {
      return;
    }
    setMessage(null);
    try {
      const response = await fetch(`/api/hooks/${hook.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("This hook could not be deleted.");
      if (justCreated?.id === hook.id) setJustCreated(null);
      await load();
      setMessage("Hook deleted.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "This hook could not be deleted.");
    }
  }

  const visible = showActiveOnly ? hooks.filter((hook) => hook.enabled) : hooks;
  const understoodMatcher = activeDef.fields.some((field) => field.key === "matcher")
    ? fieldValues.matcher
    : "";

  return (
    <section
      aria-label="Hooks"
      className="flex h-full min-h-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)]"
    >
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--ink-heading)]">Hooks</h2>
          <button
            type="button"
            onClick={() => setShowActiveOnly((value) => !value)}
            aria-pressed={showActiveOnly}
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
              showActiveOnly
                ? "border-[var(--botanical)] text-[var(--botanical)]"
                : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16l-6.2 7.3v5.2L10.2 20v-7.7L4 5Z" />
            </svg>
            {showActiveOnly ? "Active" : "All"}
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Say what should happen and when. Hooks react to your chats, tools, and outside services
          {gardenSlug ? ", and answer inside this garden." : "."}
        </p>

        <div className="neu-composer relative mt-5 rounded-[30px] p-2">
          <div className="flex min-w-0 items-end gap-1.5">
            <button
              type="button"
              onClick={() => setOptionsOpen((value) => !value)}
              aria-expanded={optionsOpen}
              aria-label={optionsOpen ? "Hide trigger and action" : "Choose the trigger and action by hand"}
              title={optionsOpen ? "Hide trigger and action" : "Choose the trigger and action by hand"}
              className="neu-button-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--ink)] transition hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
            >
              <svg
                className={`h-5 w-5 transition-transform duration-150 ${optionsOpen ? "rotate-45" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            <div className="relative flex min-h-11 min-w-0 flex-1 items-center">
              <textarea
                ref={inputRef}
                value={text}
                rows={1}
                onChange={(event) => {
                  setTemplateName(null);
                  describe(event.target.value);
                }}
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void create();
                  }
                }}
                placeholder="When something happens, do this…"
                aria-label="Describe a hook"
                className="block max-h-32 min-h-6 w-full min-w-0 max-w-full resize-none overflow-y-auto bg-transparent px-1 py-0 text-[15px] leading-6 text-[var(--ink)] caret-[var(--composer-caret)] outline-none placeholder:text-[var(--ink-muted)]"
              />
            </div>
            <button
              type="button"
              onClick={() => void create()}
              disabled={saving || !text.trim()}
              aria-label="Create this hook"
              className="neu-button-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] text-[var(--paper-raised)] transition-colors hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)]"
            >
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0-6 6m6-6 6 6" />
              </svg>
            </button>
          </div>

          {text.trim() ? (
            <p className="mt-1.5 border-t border-[var(--line)] pt-1.5 text-[11px] text-[var(--ink-muted)]">
              {parsed.recognized || providerPinned ? "Understood" : "Assuming"}:{" "}
              <span className="font-medium text-[var(--ink)]">
                {activeDef.emoji} {activeDef.label}
                {understoodMatcher ? ` · ${understoodMatcher}` : ""} → {activeMode.emoji}{" "}
                {activeMode.label.toLowerCase()}
                {mode === "workflow" && workflowId
                  ? ` “${workflows.find((w) => w.id === workflowId)?.name ?? ""}”`
                  : ""}
              </span>
              {!optionsOpen ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => setOptionsOpen(true)}
                    className="font-medium text-[var(--botanical)] underline-offset-2 hover:underline"
                  >
                    change
                  </button>
                </>
              ) : null}
            </p>
          ) : null}

          {inlineFields.length > 0 && text.trim() ? (
            <div className="mt-2 space-y-2 border-t border-[var(--line)] px-1 pt-2">
              {inlineFields.map((field) => (
                <label key={field.key} className="block text-xs font-medium">
                  🔑 {field.label}
                  <input
                    type={field.plain ? "text" : "password"}
                    value={fieldValues[field.key] ?? ""}
                    onChange={(event) =>
                      setFieldValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                    placeholder={field.placeholder ?? (field.optional ? "Optional" : `Paste your ${activeDef.label} ${field.label.toLowerCase()}`)}
                    className={`${CONTROL_CLASS} font-mono`}
                  />
                </label>
              ))}
            </div>
          ) : null}

          {optionsOpen ? (
            <div className="mt-2 space-y-3 border-t border-[var(--line)] px-1 pb-1 pt-2">
              <div>
                <p className="text-[11px] font-medium text-[var(--ink-muted)]">When</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {PROVIDERS.map((def) => (
                    <button
                      key={def.id}
                      type="button"
                      aria-pressed={provider === def.id}
                      onClick={() => pickProvider(def.id)}
                      className={chipClass(provider === def.id)}
                    >
                      {def.emoji} {def.label}
                    </button>
                  ))}
                </div>
                {activeDef.fields.some((field) => field.key === "matcher") ? (
                  <label className="mt-2 block text-xs font-medium">
                    {activeDef.fields.find((field) => field.key === "matcher")?.label}
                    <input
                      value={fieldValues.matcher ?? ""}
                      onChange={(event) =>
                        setFieldValues((prev) => ({ ...prev, matcher: event.target.value }))
                      }
                      placeholder={activeDef.fields.find((field) => field.key === "matcher")?.placeholder}
                      className={`${CONTROL_CLASS} font-mono`}
                    />
                  </label>
                ) : null}
              </div>

              <div>
                <p className="text-[11px] font-medium text-[var(--ink-muted)]">Then</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {MODES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={mode === item.id}
                      onClick={() => pickMode(item.id)}
                      className={chipClass(mode === item.id)}
                    >
                      {item.emoji} {item.label}
                    </button>
                  ))}
                </div>
                {mode === "workflow" ? (
                  <select
                    value={workflowId}
                    onChange={(event) => setWorkflowId(event.target.value)}
                    aria-label="Workflow"
                    className={`${CONTROL_CLASS} mt-2`}
                  >
                    <option value="">
                      {workflowsLoading
                        ? "Loading workflows…"
                        : workflows.length === 0
                          ? "No workflows yet"
                          : "Select a workflow"}
                    </option>
                    {workflows.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                ) : mode === "command" ? (
                  <>
                    <input
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      spellCheck={false}
                      aria-label="Command"
                      placeholder="node scripts/on-event.mjs"
                      className={`${CONTROL_CLASS} mt-2 font-mono`}
                    />
                    <p className="mt-1 text-[10px] text-[var(--ink-muted)]">
                      Runs in a shell on this computer, from your home folder, with nobody asked
                      first. The event arrives as JSON on standard input. Stopped after 60 seconds.
                    </p>
                  </>
                ) : (
                  <p className="mt-1.5 text-[10px] text-[var(--ink-muted)]">
                    The assistant gets your sentence as its instructions, with the event attached.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {message ? (
          <p role="status" className="mt-2 text-xs text-[#8a6f00]">
            {message}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {justCreated?.url ? (
          <div className="neu-surface-subtle mb-3 rounded-2xl border border-[var(--line)] p-3">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium text-[var(--ink-heading)]">
                {providerDef(justCreated.provider).emoji} Connect {providerDef(justCreated.provider).label}
              </p>
              <button
                type="button"
                onClick={() => setJustCreated(null)}
                aria-label="Dismiss setup steps"
                className="rounded-lg px-1.5 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                ×
              </button>
            </div>
            <div className="neu-control mt-2 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-1.5">
              <code className="min-w-0 flex-1 truncate text-xs">{justCreated.url}</code>
              <CopyUrlButton url={justCreated.url} />
            </div>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-[var(--ink-muted)]">
              {providerDef(justCreated.provider).instructions.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="mt-2 text-[10px] text-[var(--ink-muted)]">
              The service must be able to reach this computer over the internet to deliver events.
            </p>
          </div>
        ) : null}

        <ul className="space-y-0.5">
          {templates.map((template) => (
            <li key={template.name}>
              <button
                type="button"
                onClick={() => {
                  describe(template.description);
                  setTemplateName(`${template.emoji} ${template.name}`);
                  inputRef.current?.focus();
                }}
                className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-[var(--paper-strong)]"
              >
                <span className="mt-0.5 shrink-0 text-[var(--ink-muted)]">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                    <circle cx="12" cy="12" r="8.5" />
                    <path strokeLinecap="round" d="M12 8.5v7M8.5 12h7" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[var(--ink-heading)]">
                    {template.emoji} {template.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                    {template.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-[var(--line)] pt-3">
          <h3 className="text-xs font-semibold text-[var(--ink-muted)]">
            {showActiveOnly ? "Active hooks" : "All hooks"}
          </h3>
          {loading && hooks.length === 0 ? (
            <p className="mt-4 text-center text-xs text-[var(--ink-muted)]">Loading hooks…</p>
          ) : visible.length === 0 ? (
            <p className="mt-4 text-center text-xs text-[var(--ink-muted)]">
              {hooks.length === 0
                ? "🪝 No hooks yet — pick a suggestion above or describe your own."
                : "Nothing is active right now."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {visible.map((hook) => {
                const def = providerDef(hook.provider);
                const action = modeDef(hook.mode);
                const matcher =
                  typeof hook.providerConfig.matcher === "string" ? hook.providerConfig.matcher : "";
                return (
                  <li
                    key={hook.id}
                    className={`neu-surface-subtle rounded-xl border p-3 ${hook.enabled ? "" : "opacity-70"}`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--paper-strong)] text-base"
                      >
                        {def.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium leading-5 text-[var(--ink-heading)]">
                          {hook.name}
                        </p>
                        <p className="mt-1 text-[10px] text-[var(--ink-muted)]">
                          {def.internal ? `Runs ${def.summary}` : `${def.label} webhook`}
                          {matcher ? ` · matching ${matcher}` : ""} → {action.emoji}{" "}
                          {action.label.toLowerCase()}
                        </p>
                        {hook.mode === "chat" && hook.chatInstructions ? (
                          <p className="mt-1 line-clamp-2 text-xs text-[var(--ink-body,var(--ink))]">
                            {hook.chatInstructions}
                          </p>
                        ) : null}
                        {hook.command ? (
                          <code className="mt-1 block truncate text-[11px] text-[var(--ink-muted)]">
                            {hook.command}
                          </code>
                        ) : null}
                        {hook.url ? (
                          <div className="neu-control mt-2 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2 py-0.5">
                            <code className="min-w-0 flex-1 truncate text-[11px]">{hook.url}</code>
                            <CopyUrlButton url={hook.url} />
                          </div>
                        ) : null}
                        <p className="mt-1.5 text-[10px] text-[var(--ink-muted)]">
                          {hook.enabled ? "🟢 On" : "⏸️ Paused"} · fired {hook.fireCount}×
                          {hook.lastFiredAt ? `, last ${formatRelative(hook.lastFiredAt)}` : ""}
                          {hook.lastResult ? ` · ${hook.lastResult}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() => void toggleEnabled(hook)}
                          className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]"
                        >
                          {hook.enabled ? "Pause" : "Resume"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeHook(hook)}
                          className="rounded-lg px-2 py-1 text-xs text-[#9a4438]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}
