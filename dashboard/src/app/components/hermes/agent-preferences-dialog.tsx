"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import { taskPresetCandidates } from "@/lib/agent-preferences/task-presets";
import {
  MAX_PREFERENCE_AGENTS, MAX_PREFERENCE_TASKS, renderAgentPreferences,
  validateAgentPreferences, type AgentPreferences, type AgentPreferenceOption,
  type AgentPreferenceTask,
} from "@/lib/agent-preferences/preferences";

const field = "w-full rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]";
const iconButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:opacity-35 active:scale-[0.97]";

function Toggle({ id, checked, onChange, disabled = false }: { id: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <Switch.Root id={id} checked={checked} onCheckedChange={onChange} disabled={disabled}
      className="h-5 w-9 shrink-0 rounded-full bg-[var(--line)] p-0.5 data-[state=checked]:bg-[var(--botanical)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] disabled:opacity-40">
      <Switch.Thumb className="block h-4 w-4 rounded-full shadow-sm data-[state=checked]:translate-x-4" style={{ background: "var(--paper-raised)" }} />
    </Switch.Root>
  );
}

function AgentPicker({ task, options, onChange }: { task: AgentPreferenceTask; options: AgentPreferenceOption[]; onChange: (agents: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const suggested = useMemo(() => taskPresetCandidates(task.id), [task.id]);
  const available = useMemo(() => options.filter((agent) => !task.agents.includes(agent.command) &&
    `${agent.name} ${agent.command} ${agent.description} ${agent.group}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(suggested.includes(b.command)) - Number(suggested.includes(a.command))), [options, query, task.agents, suggested]);
  function move(index: number, direction: number) {
    const next = [...task.agents];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  }
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-medium text-[var(--ink-muted)]">Preferred agents · first choice first</p>
      <button type="button" aria-pressed={!task.agents.length} onClick={() => { onChange([]); setExpanded(false); }} className={`rounded-md px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-[var(--botanical)] ${!task.agents.length ? "bg-[var(--paper-strong)] font-medium text-[var(--ink-heading)]" : "text-[var(--ink-muted)] hover:bg-[var(--paper-surface)]"}`}>No preference</button>
    </div>
    {task.agents.length ? <ol className="space-y-1">
      {task.agents.map((command, index) => {
        const agent = options.find((option) => option.command === command);
        return <li key={command} className="flex items-center gap-2 rounded-lg bg-[var(--paper-surface)] py-1 pl-3 pr-1">
          <span className="w-3 text-xs tabular-nums text-[var(--ink-muted)]">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-sm" title={command}>{agent?.name ?? command}
            {agent?.manualOnly ? <span className="ml-2 text-[10px] text-[var(--ink-muted)]">Manual selection</span> : null}
            {!agent ? <span className="ml-2 text-[10px] text-[var(--ink-muted)]">Unavailable</span> : null}
          </span>
          <button type="button" className={iconButton} disabled={index === 0} aria-label={`Move ${agent?.name ?? command} up`} onClick={() => move(index, -1)}><ArrowUp size={13} /></button>
          <button type="button" className={iconButton} disabled={index === task.agents.length - 1} aria-label={`Move ${agent?.name ?? command} down`} onClick={() => move(index, 1)}><ArrowDown size={13} /></button>
          <button type="button" className={iconButton} aria-label={`Remove ${agent?.name ?? command}`} onClick={() => onChange(task.agents.filter((value) => value !== command))}><X size={13} /></button>
        </li>;
      })}
    </ol> : <p className="text-xs text-[var(--ink-muted)]">Hermes chooses freely for this task.</p>}
    <button type="button" aria-expanded={expanded} aria-controls={`agent-picker-${task.id}`} onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 rounded-md py-1 text-xs font-medium text-[var(--botanical)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">
      <Plus size={13} /> {expanded ? "Close agent picker" : "Choose agents"}
    </button>
    {expanded ? <div id={`agent-picker-${task.id}`} className="overflow-hidden rounded-lg border border-[var(--line)]">
      <div className="relative border-b border-[var(--line)]">
        <Search size={14} className="absolute left-3 top-3 text-[var(--ink-muted)]" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all agents…" aria-label={`Search agents for ${task.name}`} className={`${field} rounded-none border-0 pl-9`} />
      </div>
      <div className="max-h-48 overflow-y-auto overscroll-contain" role="group" aria-label={`Available agents for ${task.name}`}>
        {available.map((agent) => <button key={agent.command} type="button" disabled={task.agents.length >= MAX_PREFERENCE_AGENTS}
          onClick={() => onChange([...task.agents, agent.command])} className="block w-full px-3 py-2 text-left hover:bg-[var(--paper-surface)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)] disabled:opacity-40">
          <span className="flex items-center justify-between gap-2 text-xs font-medium"><span>{agent.name}</span><span className="text-[10px] font-normal text-[var(--ink-muted)]">{agent.group}</span></span>
          <span className="mt-0.5 block text-[11px] leading-4 text-[var(--ink-muted)]">{agent.description}</span>
        </button>)}
        {!available.length ? <p className="px-3 py-4 text-xs text-[var(--ink-muted)]">No matching agents.</p> : null}
      </div>
      {task.agents.length >= MAX_PREFERENCE_AGENTS ? <p className="px-3 py-2 text-xs text-[var(--ink-muted)]">Up to {MAX_PREFERENCE_AGENTS} choices per task.</p> : null}
    </div> : null}
  </div>;
}

export default function AgentPreferencesDialog({ onClose, returnFocusTo }: { onClose: () => void; returnFocusTo?: HTMLElement | null }) {
  const [settings, setSettings] = useState<AgentPreferences | null>(null);
  const [saved, setSaved] = useState("");
  const [agents, setAgents] = useState<AgentPreferenceOption[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [reload, setReload] = useState(0);
  const [taskQuery, setTaskQuery] = useState("");
  const returnFocus = useRef<HTMLElement | null>(returnFocusTo ?? null);
  const dirty = settings !== null && JSON.stringify(settings) !== saved;

  useEffect(() => {
    if (!returnFocus.current) returnFocus.current = document.activeElement as HTMLElement | null;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/agent-preferences", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Preferences could not be loaded.");
        setSettings(data.settings); setSaved(JSON.stringify(data.settings));
        setAgents(data.agents); setNotice(data.notice); setError(null);
      }).catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Preferences could not be loaded.");
      });
    return () => controller.abort();
  }, [reload]);

  function update(patch: Partial<AgentPreferences>) {
    setSettings((current) => current ? { ...current, ...patch } : current);
    setStatus("");
  }
  function updateTask(id: string, patch: Partial<AgentPreferenceTask>) {
    if (settings) update({ tasks: settings.tasks.map((task) => task.id === id ? { ...task, ...patch } : task) });
  }
  async function save() {
    if (!settings || saving) return;
    setError(null); setSaving(true); setStatus("");
    try {
      const valid = validateAgentPreferences(settings);
      const response = await fetch("/api/agent-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Preferences could not be saved.");
      setSettings(data.settings); setSaved(JSON.stringify(data.settings));
      setStatus(data.settings.enabled ? "Saved. Applies to your next message." : "Saved. Agent preferences are off.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Preferences could not be saved."); }
    finally { setSaving(false); }
  }

  return <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="bb-modal-backdrop fixed inset-0 z-[150]" />
      <Dialog.Content aria-busy={saving} onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); event.stopPropagation(); }}
        onPointerDownOutside={(event) => { if (dirty || saving) event.preventDefault(); }}
        className="bb-modal-panel neu-dialog fixed left-1/2 top-1/2 z-[151] flex max-h-[min(88dvh,760px)] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--line)] text-[var(--ink)] focus:outline-none">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div><Dialog.Title className="text-base font-semibold text-[var(--ink-heading)]">Agent settings</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Choose who Hermes turns to for different kinds of work.</Dialog.Description></div>
          <Dialog.Close className={iconButton} disabled={saving} aria-label="Close agent settings"><X size={16} /></Dialog.Close>
        </header>
          <div className="flex shrink-0 items-center justify-between gap-5 border-b border-[var(--line)] px-5 py-4">
            <div><label htmlFor="agent-preferences-enabled" className="text-sm font-medium">Use task preferences</label>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{settings?.enabled ? "Bias agent choices toward your saved preferences." : "Off by default. Hermes chooses agents based on the request."}</p></div>
            <Toggle id="agent-preferences-enabled" checked={settings?.enabled ?? false} onChange={(enabled) => update({ enabled })} disabled={!settings || saving} />
          </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {settings ? <fieldset disabled={saving} className="min-w-0 border-0 p-0">
            <section className="space-y-4 px-5 py-4">
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">Task preferences</h3>
                {!settings.enabled ? <span className="rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]">Inactive</span> : null}</div>
              <p className="text-xs leading-5 text-[var(--ink-muted)]">Only tasks you customize get a bias. Leave any task at No preference to let Hermes choose. Your explicit request always takes priority. {settings.enabled ? "" : "You can edit while this is off."}</p>
              {notice ? <p className="text-xs text-[var(--ink-muted)]">{notice}</p> : null}
              <input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} aria-label="Filter task preferences" placeholder="Find a task: music, stocks, video…" className={field} />
              <div className="divide-y divide-[var(--line)]">
              {settings.tasks.filter((task) => `${task.name} ${task.when}`.toLowerCase().includes(taskQuery.toLowerCase())).map((task) => <details key={task.id} className="group/task py-1">
                <summary className="cursor-pointer rounded-lg py-2 text-sm font-medium text-[var(--ink-heading)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">
                  {task.name || "New task"}<span className="ml-4 block truncate pl-0 text-[11px] font-normal leading-5 text-[var(--ink-muted)]">{task.agents.map((command) => agents.find((agent) => agent.command === command)?.name ?? command).join(" · ") || "No preference"}</span>
                </summary>
                <div className="space-y-3 pb-3 pt-2">
                <div className="flex items-center gap-2"><input aria-label="Task name" value={task.name} maxLength={100} placeholder="Task name" onChange={(event) => updateTask(task.id, { name: event.target.value })} className={`${field} font-medium`} />
                  <button type="button" className={iconButton} aria-label={`Remove ${task.name || "task"} rule`} onClick={() => update({ tasks: settings.tasks.filter((item) => item.id !== task.id) })}><X size={14} /></button></div>
                <label className="block space-y-1"><span className="text-xs text-[var(--ink-muted)]">For requests like</span>
                  <textarea value={task.when} maxLength={800} rows={2} placeholder="Describe the request this preference applies to…" onChange={(event) => updateTask(task.id, { when: event.target.value })} className={`${field} resize-y leading-5`} /></label>
                <AgentPicker task={task} options={agents} onChange={(choices) => updateTask(task.id, { agents: choices })} />
                </div>
              </details>)}
              </div>
              {taskQuery && !settings.tasks.some((task) => `${task.name} ${task.when}`.toLowerCase().includes(taskQuery.toLowerCase())) ? <p className="text-xs text-[var(--ink-muted)]">No matching tasks. Add your own below.</p> : null}
              <button type="button" disabled={settings.tasks.length >= MAX_PREFERENCE_TASKS} onClick={() => { setTaskQuery(""); update({ tasks: [...settings.tasks, { id: crypto.randomUUID(), name: "New task", when: "", agents: [] }] }); }}
                className="flex items-center gap-1.5 rounded-md text-xs font-medium text-[var(--botanical)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:opacity-40"><Plus size={14} /> Add task</button>
              <label className="block space-y-1.5"><span className="text-xs font-medium">Additional preferences</span>
                <textarea value={settings.guidance} onChange={(event) => update({ guidance: event.target.value })} maxLength={6000} rows={3} placeholder="For example: prefer HyperFrames for precise charts and animated diagrams. Markdown is supported." className={`${field} resize-y leading-5`} /></label>
            </section>
            <section className="space-y-4 border-t border-[var(--line)] px-5 py-4">
              <label className="block space-y-1.5"><span className="text-sm font-medium">If a preferred agent cannot do the task</span>
                <select className={field} value={settings.fallback} onChange={(event) => update({ fallback: event.target.value as AgentPreferences["fallback"] })}>
                  <option value="auto">Choose another suitable agent</option><option value="ask">Ask me before switching agents</option>
                </select></label>
              <div className="flex items-center justify-between gap-5"><div><label htmlFor="agent-preferences-explain" className="text-sm font-medium">Explain agent choices</label>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">Briefly say which agent fits and why before starting.</p></div>
                <Toggle id="agent-preferences-explain" checked={settings.explainChoice} onChange={(explainChoice) => update({ explainChoice })} /></div>
              <p className="text-[11px] leading-5 text-[var(--ink-muted)]">These settings apply when task preferences are on. They guide Hermes; agent availability, manual inputs, and launch approvals still apply.</p>
            </section>
            <details className="border-t border-[var(--line)] px-5 py-3"><summary className="cursor-pointer text-xs text-[var(--ink-muted)]">Preview preferences for Hermes</summary>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-[var(--paper-surface)] p-3 text-[11px] leading-5">{renderAgentPreferences({ ...settings, enabled: true }) || "No agent preferences selected. Hermes chooses freely for every task."}</pre>
              <p className="mt-2 text-[11px] text-[var(--ink-muted)]">Saved in AGENT_PREFERENCES.md. {settings.enabled ? "Read on future messages." : "Nothing in this preview is active while preferences are off."}</p>
            </details>
          </fieldset> : null}
        </div>
        <footer className="space-y-3 border-t border-[var(--line)] px-5 py-3">
          {error ? <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error} {!settings ? <button type="button" onClick={() => setReload((value) => value + 1)} className="underline">Retry</button> : null}</p> : null}
          <div className="flex items-center justify-between gap-3"><p role="status" className="text-[11px] text-[var(--ink-muted)]">{status || (dirty ? "Unsaved changes" : "Changes apply to future messages.")}</p>
            <div className="flex shrink-0 gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-surface)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">{dirty ? "Cancel" : "Done"}</button>
              <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="rounded-lg bg-[var(--botanical)] px-3 py-2 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] disabled:opacity-40 active:scale-[0.97]">{saving ? "Saving…" : "Save changes"}</button></div>
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
