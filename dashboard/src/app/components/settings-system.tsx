"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_SYSTEM_PROMPT_LENGTH, type SystemPromptView } from "@/lib/system-prompts/types";

type Draft = { text: string; saved: string; revision: number; reset: boolean; saving: boolean; error: string | null; conflict: boolean };
const endpoint = "/api/system-prompts";

function mergePromptView(items: SystemPromptView[], prompt: SystemPromptView): SystemPromptView[] {
  return items.map(item => item.id === prompt.id ? prompt
    : item.scope === "installation" && prompt.scope === "installation"
      ? { ...item, editable: prompt.editable, installationOwner: prompt.installationOwner } : item);
}

export default function SettingsSystem() {
  const [prompts, setPrompts] = useState<SystemPromptView[]>([]);
  const [selected, setSelected] = useState("chat-core");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftRef = useRef(drafts);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const flushRef = useRef<(id: string) => Promise<void>>(async () => {});

  const changeDraft = useCallback((id: string, update: (draft: Draft) => Draft) => {
    const current = draftRef.current[id];
    if (!current) return;
    draftRef.current = { ...draftRef.current, [id]: update(current) };
    if (mounted.current) setDrafts(draftRef.current);
  }, []);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "System prompts could not be loaded.");
      const next = body.prompts as SystemPromptView[];
      if (!mounted.current || generation !== loadGeneration.current) return;
      const initial = Object.fromEntries(next.map((prompt) => [prompt.id, {
        text: prompt.content, saved: prompt.content, revision: prompt.revision,
        reset: false, saving: false, error: null, conflict: false,
      }]));
      draftRef.current = initial;
      setDrafts(initial);
      setPrompts(next);
    } catch (error) {
      if (mounted.current && generation === loadGeneration.current) setLoadError(error instanceof Error ? error.message : "System prompts could not be loaded.");
    } finally {
      if (mounted.current && generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  const flush = useCallback(async (id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    const draft = draftRef.current[id];
    if (!draft || draft.saving || draft.conflict || (!draft.reset && draft.text === draft.saved)) return;
    if (draft.text.length > MAX_SYSTEM_PROMPT_LENGTH) return;
    const sent = draft.text;
    const reset = draft.reset;
    changeDraft(id, (current) => ({ ...current, saving: true, error: null }));
    let succeeded = false;
    try {
      const payload = JSON.stringify({ id, content: reset ? null : sent, revision: draft.revision });
      const response = await fetch(endpoint, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: payload,
        // Closing the settings popover must not cancel the last keystrokes.
        keepalive: new Blob([payload]).size < 48_000,
      });
      const body = await response.json();
      if (!response.ok) {
        changeDraft(id, (current) => ({ ...current, conflict: response.status === 409 || response.status === 403 }));
        throw new Error(body.error ?? "Changes could not be saved.");
      }
      const prompt = body.prompt as SystemPromptView;
      changeDraft(id, (current) => ({ ...current, saved: prompt.content, revision: prompt.revision,
        reset: current.text === sent ? false : current.reset, error: null }));
      if (mounted.current) setPrompts((current) => mergePromptView(current, prompt));
      succeeded = true;
    } catch (error) {
      changeDraft(id, (current) => ({ ...current, error: error instanceof Error ? error.message : "Changes could not be saved." }));
    } finally {
      changeDraft(id, (current) => ({ ...current, saving: false }));
      // Serialize writes per prompt. An older response never replaces newer typing.
      const latest = draftRef.current[id];
      if (succeeded && latest && (latest.reset || latest.text !== latest.saved)) void flushRef.current(id);
    }
  }, [changeDraft]);
  flushRef.current = flush;

  useEffect(() => {
    mounted.current = true;
    const pendingTimers = timers.current;
    void load();
    return () => {
      mounted.current = false;
      loadGeneration.current += 1;
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      pendingTimers.clear();
      for (const id of Object.keys(draftRef.current)) void flushRef.current(id);
    };
  }, [load]);

  function edit(id: string, text: string, reset = false) {
    changeDraft(id, (current) => ({ ...current, text, reset, error: null }));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.set(id, setTimeout(() => { void flushRef.current(id); }, 500));
  }

  async function reloadPrompt(id: string) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The prompt could not be reloaded.");
      const prompt = (body.prompts as SystemPromptView[]).find((item) => item.id === id);
      if (!prompt) throw new Error("System prompt not found.");
      changeDraft(id, () => ({ text: prompt.content, saved: prompt.content, revision: prompt.revision,
        reset: false, saving: false, error: null, conflict: false }));
      setPrompts((current) => mergePromptView(current, prompt));
    } catch (error) {
      changeDraft(id, (current) => ({ ...current, error: error instanceof Error ? error.message : "Reload failed." }));
    }
  }

  const prompt = prompts.find((item) => item.id === selected) ?? prompts[0];
  const draft = prompt && drafts[prompt.id];
  const dirty = draft && (draft.text !== draft.saved || draft.reset);
  const filtered = prompts.filter((item) => `${item.title} ${item.group} ${item.description} ${item.id} ${item.content}`.toLowerCase().includes(query.toLowerCase()));
  const pending = Object.values(drafts).filter((item) => item.saving || item.text !== item.saved || item.reset);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-sm text-[var(--ink-muted)]">
          Changes save automatically for the next message or run. Maintenance prompts apply to this installation; other prompts apply to your account. Work already running keeps its instructions.
        </p>
        <span role="status" aria-live="polite" className="text-xs text-[var(--ink-muted)]">
          {loading ? "Loading prompts…" : loadError ? "Prompts unavailable" : pending.some((item) => item.error || item.conflict || item.text.length > MAX_SYSTEM_PROMPT_LENGTH) ? "Some changes are not saved" : pending.length ? "Saving changes…" : "All changes saved"}
        </span>
      </div>
      {loadError ? <div role="alert" className="text-sm text-[var(--ink)]">{loadError} <button type="button" className="underline" onClick={() => void load()}>Try again</button></div> : null}
      <label className="block text-sm text-[var(--ink-muted)]">
        <span className="sr-only">Search system prompts</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search system prompts…"
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[var(--ink)]" />
      </label>
      <div className="grid min-w-0 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="System prompts" className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-[var(--line)] p-2 sm:max-h-[29rem]">
          {filtered.map((item) => <button key={item.id} type="button" aria-current={prompt?.id === item.id ? "true" : undefined}
            onClick={() => { if (prompt) void flush(prompt.id); setSelected(item.id); }}
            className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${prompt?.id === item.id ? "bg-[var(--paper-strong)] text-[var(--ink-heading)]" : "text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"}`}>
            <span className="block">{item.title}{item.customized ? <span className="ml-1" aria-label="Customized">•</span> : null}</span>
            <span className="text-xs text-[var(--ink-muted)]">{item.group}{drafts[item.id]?.error ? " · Not saved" : ""}</span>
          </button>)}
          {!loading && filtered.length === 0 ? <p className="px-3 py-2 text-sm text-[var(--ink-muted)]">No matching prompts.</p> : null}
        </nav>
        {prompt && draft ? <section className="min-w-0 space-y-3" aria-labelledby="system-prompt-title">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 id="system-prompt-title" className="text-sm font-medium text-[var(--ink-heading)]">{prompt.title}</h3>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">{prompt.description}</p>
              {prompt.defaultContent.includes("{{") ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{"Keep {{…}} placeholders to include the current request’s values."}</p> : null}</div>
            <button type="button" disabled={prompt.editable === false || draft.saving || draft.conflict || (!prompt.customized && draft.text === prompt.defaultContent)}
              onClick={() => { edit(prompt.id, prompt.defaultContent, true); void flush(prompt.id); }}
              className="shrink-0 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--ink-muted)] disabled:opacity-40">Restore default</button>
          </div>
          {prompt.scope === "installation" ? <p className="text-xs text-[var(--ink-muted)]">
            Installation-wide · {prompt.installationOwner === "you" ? "You manage these prompts."
              : prompt.installationOwner === "other-account" ? "Managed by another account. You can view these prompts."
                : "Your first saved edit makes your account the owner of these prompts."}
          </p> : null}
          <textarea aria-label={`${prompt.title} system prompt`} aria-describedby="system-prompt-help" spellCheck={false}
            readOnly={prompt.editable === false}
            value={draft.text} onChange={(event) => edit(prompt.id, event.target.value)} onBlur={() => void flush(prompt.id)}
            className="min-h-64 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 font-mono text-sm leading-relaxed text-[var(--ink)] sm:min-h-80" />
          <div id="system-prompt-help" className="flex flex-wrap justify-between gap-2 text-xs text-[var(--ink-muted)]">
            <span>{draft.text.length.toLocaleString()} / {MAX_SYSTEM_PROMPT_LENGTH.toLocaleString()} characters</span>
            <span>{draft.saving ? "Saving…" : dirty ? "Unsaved changes" : prompt.customized ? "Custom prompt · Applied" : "Using default"}</span>
          </div>
          {draft.text.length > MAX_SYSTEM_PROMPT_LENGTH ? <p role="alert" className="text-sm text-[var(--ink)]">Shorten this prompt to save it.</p> : null}
          {draft.error ? <div role="alert" className="space-y-2 text-sm text-[var(--ink)]"><p>{draft.error}</p>
            {draft.conflict ? <button type="button" className="underline" onClick={() => void reloadPrompt(prompt.id)}>Discard draft and reload latest</button>
              : <button type="button" className="underline" onClick={() => void flush(prompt.id)}>Retry save</button>}
          </div> : null}
          <details className="text-xs text-[var(--ink-muted)]"><summary className="cursor-pointer">View default prompt</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--line)] p-3">{prompt.defaultContent}</pre>
          </details>
        </section> : null}
      </div>
    </div>
  );
}
