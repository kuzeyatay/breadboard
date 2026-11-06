"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirmDialog } from "@/app/components/confirm-dialog";
import { AGENT_MANAGER_CATALOG, AGENT_MANAGER_WORKFLOWS, type AgentManagerEntry, type AgentManagerAction } from "@/lib/agent-manager/catalog.ts";
import { agentManagerStatus, type AgentManagerStatus, type AgentManagerOperation } from "@/lib/agent-manager/status.ts";

export interface AgentManagerPanelProps {
  onOpenAgentSettings?: (agentId: string) => void;
  onChanged?: () => void;
}
const controlClass = "rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[var(--bg-hover)]";

export function AgentManagerPanel({ onOpenAgentSettings, onChanged }: AgentManagerPanelProps) {
  const [statuses, setStatuses] = useState<Record<string, AgentManagerStatus>>({});
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [operations, setOperations] = useState<Record<string, AgentManagerOperation>>({});
  const [submitting, setSubmitting] = useState<Set<string>>(new Set());
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [storageRoot, setStorageRoot] = useState<string | null>(null);
  const [bulkStorageRoot, setBulkStorageRoot] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [filter, setFilter] = useState("all");
  const refreshController = useRef<AbortController | null>(null);
  const changedCallback = useRef(onChanged);
  changedCallback.current = onChanged;
  const { confirm, confirmDialog } = useConfirmDialog();

  const checkAgent = useCallback(async (entry: AgentManagerEntry, signal?: AbortSignal, force = false) => {
    if (!entry.healthUrl) {
      setStatuses((current) => ({ ...current, [entry.id]: agentManagerStatus(entry) }));
      return;
    }
    setChecking((current) => new Set(current).add(entry.id));
    try {
      const response = await fetch(`${entry.healthUrl}${force ? "?refresh=1&force=1" : ""}`, { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) });
      const body = await response.json();
      if (!signal?.aborted) setStatuses((current) => ({ ...current, [entry.id]: agentManagerStatus(entry, body, response.ok) }));
    } catch {
      if (!signal?.aborted) setStatuses((current) => ({ ...current, [entry.id]: agentManagerStatus(entry, { error: "Status check did not complete. Retry or open agent settings." }, false) }));
    } finally {
      if (!signal?.aborted) setChecking((current) => { const next = new Set(current); next.delete(entry.id); return next; });
    }
  }, []);

  const readOperation = useCallback(async (agentId: string, signal?: AbortSignal, update = true) => {
    const response = await fetch(`/api/agent-manager?agentId=${encodeURIComponent(agentId)}`, { cache: "no-store", signal });
    const body = await response.json() as { ok?: boolean; operation?: AgentManagerOperation | null; error?: string };
    if (!response.ok || !body.ok) throw new Error(body.error || "Setup progress could not be checked.");
    if (body.operation && update) setOperations((current) => ({ ...current, [agentId]: body.operation! }));
    return body.operation;
  }, []);

  const refresh = useCallback(async (force = false) => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    setError("");
    setChecking(new Set(AGENT_MANAGER_CATALOG.filter((entry) => entry.healthUrl).map((entry) => entry.id)));
    // Rows exist from the first render. Bound health probes so opening settings
    // does not flood Runtime with 41 concurrent checks or start any installs.
    const queue = [...AGENT_MANAGER_CATALOG];
    const checks = Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length && !controller.signal.aborted) await checkAgent(queue.shift()!, controller.signal, force);
    }));
    try {
      const response = await fetch("/api/agent-manager", { cache: "no-store", signal: controller.signal });
      const body = await response.json() as { ok?: boolean; operationAgentIds?: string[]; storageRoot?: string; bulkStorageRoot?: string | null; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Agent Manager is unavailable.");
      setStorageRoot(typeof body.storageRoot === "string" && body.storageRoot ? body.storageRoot : null);
      setBulkStorageRoot(typeof body.bulkStorageRoot === "string" && body.bulkStorageRoot ? body.bulkStorageRoot : null);
      for (const id of body.operationAgentIds ?? []) {
        if (controller.signal.aborted) break;
        await readOperation(id, controller.signal).catch(() => {
          if (!controller.signal.aborted) setNotices((current) => ({ ...current, [id]: "Setup progress could not be checked. Use Check status to reconnect." }));
        });
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Agent Manager is unavailable.");
    }
    await checks;
  }, [checkAgent, readOperation]);

  useEffect(() => { void refresh(); return () => refreshController.current?.abort(); }, [refresh]);

  useEffect(() => {
    const active = Object.values(operations).filter((operation) => !operation.finished);
    if (!active.length) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const updates: Record<string, AgentManagerOperation> = {};
      for (const previous of active) {
        try {
          const current = await readOperation(previous.agentId, controller.signal, false);
          if (current) updates[previous.agentId] = current;
          if (current?.finished) {
            const entry = AGENT_MANAGER_CATALOG.find((item) => item.id === previous.agentId);
            if (entry) void checkAgent(entry, undefined, true);
            changedCallback.current?.();
          }
        } catch {
          if (!controller.signal.aborted) {
            setNotices((current) => ({ ...current, [previous.agentId]: "The connection to setup progress was interrupted. The Runtime may still be working. Check status to reconnect." }));
            // Keep the durable job visible, but do not claim completion or
            // restart an installer because its polling connection failed.
          }
        }
      }
      if (!controller.signal.aborted) setOperations((current) => ({ ...current, ...updates }));
    }, 2000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [operations, readOperation, checkAgent]);

  async function run(entry: AgentManagerEntry, action: AgentManagerAction) {
    if (action.destructive && !await confirm({ title: "Remove downloaded tools?", subject: entry.name, body: entry.id === "music-producer" ? "Removes the local music models and tools. Your tracks, chats and settings are kept." : "Removes this agent’s downloaded tools. Your chats, generated files and settings are kept.", detail: "Finish this agent's active jobs first. You can download its tools again here.", confirmLabel: "Remove dependencies", tone: "danger" })) return;
    setSubmitting((current) => new Set(current).add(entry.id));
    setNotices((current) => ({ ...current, [entry.id]: "" }));
    try {
      const response = await fetch("/api/agent-manager", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: entry.id, actionId: action.id, ...(action.destructive ? { confirmRemoval: true } : {}) }) });
      const body = await response.json() as { ok?: boolean; operation?: AgentManagerOperation; error?: string };
      if (!response.ok || !body.ok || !body.operation) throw new Error(body.error || "The setup action could not be started.");
      setOperations((current) => ({ ...current, [entry.id]: body.operation! }));
      if (body.operation.finished) { await checkAgent(entry, undefined, true); changedCallback.current?.(); }
    } catch (failure) {
      setNotices((current) => ({ ...current, [entry.id]: failure instanceof Error ? failure.message : "The setup action could not be started." }));
    } finally {
      setSubmitting((current) => { const next = new Set(current); next.delete(entry.id); return next; });
    }
  }

  async function stopSetup(agentId: string) {
    setSubmitting((current) => new Set(current).add(agentId));
    try {
      const response = await fetch(`/api/agent-manager?agentId=${encodeURIComponent(agentId)}`, { method: "DELETE" });
      const body = await response.json() as { ok?: boolean; operation?: AgentManagerOperation | null; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Setup cancellation could not be requested.");
      if (body.operation) setOperations((current) => ({ ...current, [agentId]: body.operation! }));
      if (body.operation?.finished) {
        const entry = AGENT_MANAGER_CATALOG.find((item) => item.id === agentId);
        if (entry) void checkAgent(entry, undefined, true);
      }
      setNotices((current) => ({ ...current, [agentId]: "" }));
      changedCallback.current?.();
    } catch (failure) {
      setNotices((current) => ({ ...current, [agentId]: failure instanceof Error ? failure.message : "Setup cancellation could not be requested." }));
    } finally {
      setSubmitting((current) => { const next = new Set(current); next.delete(agentId); return next; });
    }
  }

  const visible = useMemo(() => AGENT_MANAGER_CATALOG.filter((entry) => {
    const status = statuses[entry.id];
    return (!workflowId || workflowId === entry.workflowId) && (!query || `${entry.name} ${entry.description} ${entry.requirements}`.toLowerCase().includes(query.toLowerCase())) &&
      (filter === "all" || (filter === "installed" ? status?.installed === true || status?.state === "included" : status && !["ready", "included"].includes(status.state)));
  }), [statuses, workflowId, query, filter]);

  return <section className="space-y-4 text-[var(--ink)]" aria-label="Agent Manager">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-serif text-xl text-[var(--ink-heading)]">Agent Manager</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">Manage the {AGENT_MANAGER_CATALOG.length} specialists behind your eight workflows. Each specialist remains available to select on its own.</p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Removing dependencies preserves conversations, generated artifacts and user files. Shared models and connected accounts are managed in settings.</p>
        {storageRoot && <p className="mt-1 break-all text-xs leading-5 text-[var(--ink-muted)]">{bulkStorageRoot ? "Chats and settings" : "Managed storage"}: {storageRoot}</p>}
        {bulkStorageRoot && <p className="mt-1 break-all text-xs leading-5 text-[var(--ink-muted)]">Agent downloads: {bulkStorageRoot}</p>}
      </div>
      <button className={controlClass} type="button" onClick={() => void refresh(true)}>Refresh status{checking.size ? ` · ${checking.size} remaining` : ""}</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-600">{error} <button className="underline" onClick={() => void refresh(true)}>Retry</button></p>}
    <div className="flex flex-wrap gap-2">
      <input aria-label="Search agents" placeholder="Search agents" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-48 flex-1 rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm" />
      <select aria-label="Filter by workflow" value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} className={controlClass}><option value="">All workflows</option>{AGENT_MANAGER_WORKFLOWS.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select>
      <select aria-label="Filter by installation" value={filter} onChange={(event) => setFilter(event.target.value)} className={controlClass}><option value="all">All agents</option><option value="installed">Installed / included</option><option value="attention">Needs attention</option></select>
    </div>
    <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
      {visible.map((entry) => {
        const status = statuses[entry.id] ?? (!entry.healthUrl ? agentManagerStatus(entry) : null);
        const operation = operations[entry.id];
        const busy = submitting.has(entry.id) || Boolean(operation && !operation.finished);
        const workflow = AGENT_MANAGER_WORKFLOWS.find((item) => item.id === entry.workflowId);
        return <article key={entry.id} className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 className="text-sm font-semibold text-[var(--ink-heading)]">{entry.name} <span className="ml-2 text-xs font-normal text-[var(--ink-muted)]">{workflow?.name}</span></h3><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{entry.description}</p></div>
            <span className={`text-xs ${status?.state === "ready" || status?.state === "included" ? "text-[var(--botanical)]" : "text-[var(--ink-muted)]"}`}>{checking.has(entry.id) ? `${status?.label ?? "Status"} · checking` : status?.label ?? "Not checked"}</span>
          </div>
          {status?.message && <p className="text-xs leading-5 text-[var(--ink-muted)]">{status.message}</p>}
          <details className="text-xs text-[var(--ink-muted)]">
            <summary className="cursor-pointer">Dependencies and storage</summary>
            <p className="mt-2 leading-5">{entry.requirements}</p>
            {status?.sourcePresent !== null && status?.sourcePresent !== undefined && <p className="mt-1">Source: {status.sourcePresent ? "present" : "not found"}{status.installed !== null ? ` · Dependencies: ${status.installed ? "installed" : "not ready"}` : ""}</p>}
            {status?.storagePath && <p className="mt-1 break-all">Location: {status.storagePath}</p>}
            {!entry.actions.some((item) => item.destructive) && <p className="mt-1 leading-5">{entry.distribution === "included"
              ? "This capability is included with Breadboard; there is no separate installation to remove."
              : entry.hasSettings
                ? "A safe separate removal recipe is not available for this agent. Use its settings to manage supported dependencies and accounts."
                : "A safe separate removal recipe is not available for this agent. Its required external dependencies are described above."}</p>}
          </details>
          <div className="flex flex-wrap gap-2">
            {entry.actions.map((action) => <button key={action.id} type="button" className={`${controlClass} ${action.destructive ? "text-red-600" : ""}`} disabled={busy} onClick={() => void run(entry, action)}>{action.label}</button>)}
            {operation && !operation.finished && <button type="button" className={controlClass} disabled={submitting.has(entry.id)} onClick={() => void stopSetup(entry.id)}>Stop setup</button>}
            <button type="button" className={controlClass} onClick={() => { void checkAgent(entry, undefined, true); void readOperation(entry.id).catch((failure) => setNotices((current) => ({ ...current, [entry.id]: failure.message }))); }}>Check status</button>
            {entry.hasSettings && onOpenAgentSettings && <button type="button" className={controlClass} onClick={() => onOpenAgentSettings(entry.id)}>Agent settings</button>}
          </div>
          {(busy || operation || notices[entry.id]) && <div aria-live="polite" className="text-xs leading-5"><p className={operation?.state === "failed" || notices[entry.id] ? "text-red-600" : "text-[var(--ink-muted)]"}>{submitting.has(entry.id) ? "Submitting setup to Runtime…" : operation ? `${operation.finished ? "" : "Setup in progress · "}${operation.message}` : ""}</p>{notices[entry.id] && <p className="text-red-600">{notices[entry.id]}</p>}</div>}
        </article>;
      })}
      {!visible.length && <p className="p-4 text-sm text-[var(--ink-muted)]">No agents match these filters.</p>}
    </div>
    {confirmDialog}
  </section>;
}

export default AgentManagerPanel;
