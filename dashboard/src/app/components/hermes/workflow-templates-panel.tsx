"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { PublicWorkflowTemplate } from "@/lib/workflows/template-safety";
import type { LocalWorkflowSummary } from "@/lib/workflows/types";
import { isSameTabNavigationClick, rememberWorkflowReturnPath } from "@/lib/workflows/navigation";

type TemplateResponse = {
  workflows?: PublicWorkflowTemplate[];
  total?: number;
  page?: number;
  pageSize?: number;
  error?: string;
};

type LocalResponse = {
  workflows?: LocalWorkflowSummary[];
  error?: string;
};

type Props = {
  onRunWorkflow?: (workflow: LocalWorkflowSummary) => void;
  onNavigate?: () => void;
  disabled?: boolean;
};

function SearchIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="6.5" />
      <path strokeLinecap="round" d="m16 16 4 4" />
    </svg>
  );
}

function WorkflowIcon() {
  return (
    <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="6" cy="6" r="2.25" />
      <circle cx="18" cy="12" r="2.25" />
      <circle cx="6" cy="18" r="2.25" />
      <path strokeLinecap="round" d="M8.2 6h2.3a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3M8.2 18h2.3a3 3 0 0 0 3-3v0a3 3 0 0 1 3-3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.6 4.1c.1-.6.6-1.1 1.3-1.1h2.2c.7 0 1.2.5 1.3 1.1l.2 1.1c.1.4.3.7.7.9l.8.5c.3.2.8.2 1.1.1l1.1-.4c.6-.2 1.3 0 1.6.6l1.1 2c.3.6.2 1.3-.3 1.7l-.9.7c-.3.3-.5.7-.4 1.1v.9c0 .4.1.8.4 1.1l.9.7c.5.4.6 1.1.3 1.7l-1.1 2c-.3.6-1 .8-1.6.6l-1.1-.4c-.4-.1-.8-.1-1.1.1l-.8.5c-.3.2-.6.5-.7.9l-.2 1.1c-.1.6-.6 1.1-1.3 1.1h-2.2c-.7 0-1.2-.5-1.3-1.1l-.2-1.1c-.1-.4-.3-.7-.7-.9l-.8-.5c-.3-.2-.8-.2-1.1-.1l-1.1.4c-.6.2-1.3 0-1.6-.6l-1.1-2c-.3-.6-.2-1.3.3-1.7l.9-.7c.3-.3.5-.7.4-1.1v-.9c0-.4-.1-.8-.4-1.1l-.9-.7c-.5-.4-.6-1.1-.3-1.7l1.1-2c.3-.6 1-.8 1.6-.6l1.1.4c.4.1.8.1 1.1-.1l.8-.5c.3-.2.6-.5.7-.9l.2-1.1Z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}

function formatViews(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export default function WorkflowTemplatesPanel({ onRunWorkflow, onNavigate, disabled = false }: Props) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<PublicWorkflowTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateReload, setTemplateReload] = useState(0);
  const [localReload, setLocalReload] = useState(0);
  const [localItems, setLocalItems] = useState<LocalWorkflowSummary[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const debouncedQuery = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | null = null;
    let retrying = false;
    async function loadLocalWorkflows() {
      try {
        const response = await fetch("/api/workflows/local", { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as LocalResponse;
        if (!response.ok && (response.status === 502 || response.status === 503)) {
          retrying = true;
          setLocalError(null);
          setLocalLoading(true);
          retryTimer = window.setTimeout(() => setLocalReload((current) => current + 1), 1_200);
          return;
        }
        if (!response.ok) throw new Error(payload.error || "Your automations could not be loaded.");
        setLocalItems(payload.workflows ?? []);
        setLocalError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setLocalError(cause instanceof Error ? cause.message : "Your automations could not be loaded.");
      } finally {
        if (!controller.signal.aborted && !retrying) setLocalLoading(false);
      }
    }
    void loadLocalWorkflows();
    return () => {
      controller.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [localReload]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = input.trim();
      if (nextQuery === debouncedQuery.current) return;
      debouncedQuery.current = nextQuery;
      setLoading(true);
      setError(null);
      setQuery(nextQuery);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, page: String(page) });
    fetch(`/api/workflows/templates?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as TemplateResponse;
        if (!response.ok) throw new Error(payload.error || "The public workflow library is unavailable.");
        const nextItems = payload.workflows ?? [];
        setItems((current) => page === 1
          ? nextItems
          : [...current, ...nextItems.filter((item) => !current.some((existing) => existing.id === item.id))]);
        setTotal(payload.total ?? nextItems.length);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "The public workflow library is unavailable.");
        if (page === 1) setItems([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, query, templateReload]);

  const visibleLocalItems = localItems.filter((workflow) =>
    !input.trim() || workflow.name.toLowerCase().includes(input.trim().toLowerCase()),
  );

  function prepareWorkflowNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (!isSameTabNavigationClick(event)) return;
    rememberWorkflowReturnPath();
    onNavigate?.();
  }

  return (
    <div className="space-y-4 p-2">
      <div className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2 text-[var(--botanical)]">
              <WorkflowIcon />
              <h3 className="font-semibold text-[var(--ink-heading)]">Workflow automations</h3>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-[var(--ink-muted)]">
              Start from a free n8n community template or build an automation from scratch. Imported workflows open in Breadboard&apos;s private local n8n workspace.
            </p>
          </div>
          <a
            href="/workflows?mode=new"
            onClick={prepareWorkflowNavigation}
            className="neu-button-accent inline-flex shrink-0 items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
          >
            Create automation
          </a>
        </div>
      </div>

      <section>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink-heading)]">My automations</h3>
            <p className="text-[11px] text-[var(--ink-muted)]">Click an automation to run it from this chat</p>
          </div>
          {localItems.length ? <span className="text-[11px] text-[var(--ink-muted)]">{localItems.length}</span> : null}
        </div>
        {localError ? (
          <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
            {localError}
            <button type="button" onClick={() => { setLocalLoading(true); setLocalReload((current) => current + 1); }} className="ml-2 underline underline-offset-2">Try again</button>
          </div>
        ) : null}
        {localLoading ? <div className="py-4 text-center text-xs text-[var(--ink-muted)]">Loading your automations…</div> : null}
        {!localLoading && !localError && visibleLocalItems.length ? (
          <div className="space-y-2">
            {visibleLocalItems.map((workflow) => (
              <div key={workflow.id} className="neu-button flex items-center gap-2 rounded-2xl border border-[var(--line)] p-2">
                <button
                  type="button"
                  onClick={() => onRunWorkflow?.(workflow)}
                  disabled={disabled || !onRunWorkflow}
                  className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)] text-[var(--botanical)]"><WorkflowIcon /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--ink-heading)] group-hover:text-[var(--botanical)]">{workflow.name}</span>
                    <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">{workflow.active ? "Active" : "Ready to run"}{workflow.nodeCount ? ` · ${workflow.nodeCount} nodes` : ""}</span>
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-[var(--botanical)]">Run in chat</span>
                </button>
                <a
                  href={`/workflows?workflow=${encodeURIComponent(workflow.id)}`}
                  onClick={prepareWorkflowNavigation}
                  className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)] transition hover:text-[var(--botanical)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
                  aria-label={`Open settings for ${workflow.name}`}
                  title="Edit automation in n8n"
                >
                  <SettingsIcon />
                </a>
              </div>
            ))}
          </div>
        ) : null}
        {!localLoading && !localError && !visibleLocalItems.length ? (
          <div className="neu-inset rounded-2xl border border-[var(--line)] px-4 py-5 text-center">
            <p className="text-sm font-medium text-[var(--ink-heading)]">{localItems.length ? "No matching automations" : "No automations yet"}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Create one or import a public workflow below.</p>
          </div>
        ) : null}
      </section>

      <div>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink-heading)]">Discover</h3>
            <p className="text-[11px] text-[var(--ink-muted)]">Free templates from n8n&apos;s public community library</p>
          </div>
          {items.length ? <span className="text-[11px] text-[var(--ink-muted)]">{items.length} shown</span> : null}
        </div>
        <label className="neu-control flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-[var(--ink-muted)] focus-within:border-[var(--botanical)]">
          <SearchIcon />
          <span className="sr-only">Search public workflows</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Search Gmail, Slack, AI summaries…"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
          />
          {input ? (
            <button type="button" onClick={() => setInput("")} className="rounded px-1 text-xs hover:text-[var(--ink)]" aria-label="Clear workflow search">×</button>
          ) : null}
        </label>
      </div>

      {error ? (
        <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
          {error}
          <button type="button" onClick={() => { setLoading(true); setError(null); setTemplateReload((current) => current + 1); }} className="ml-2 underline underline-offset-2">Try again</button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((template) => (
          <a
            key={template.id}
            href={`/workflows?template=${template.id}`}
            onClick={prepareWorkflowNavigation}
            className="neu-button group flex min-h-44 flex-col rounded-2xl border border-[var(--line)] p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)] text-[var(--botanical)]"><WorkflowIcon /></span>
              <span className="text-[10px] text-[var(--ink-faint)]">{formatViews(template.totalViews)} views</span>
            </div>
            <h4 className="mt-3 text-sm font-semibold leading-5 text-[var(--ink-heading)] group-hover:text-[var(--botanical)]">{template.name}</h4>
            <p className="mt-1.5 max-h-10 overflow-hidden text-xs leading-5 text-[var(--ink-muted)]">{template.description || "A ready-to-customize community automation."}</p>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
              {template.nodeNames.slice(0, 3).map((node) => <span key={node} className="rounded-full bg-[var(--paper-strong)] px-2 py-1 text-[10px] text-[var(--ink-muted)]">{node}</span>)}
            </div>
            <p className="mt-2 text-[10px] text-[var(--ink-faint)]">By {template.author}{template.authorVerified ? " · Verified" : ""}</p>
          </a>
        ))}
      </div>

      {loading ? <div className="py-5 text-center text-xs text-[var(--ink-muted)]">Loading public workflows…</div> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="neu-inset rounded-2xl border border-[var(--line)] px-4 py-8 text-center">
          <p className="text-sm font-medium text-[var(--ink-heading)]">No free workflows found</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">Try a broader search, or create your own automation.</p>
        </div>
      ) : null}
      {!loading && items.length > 0 && items.length < total && page < 50 ? (
        <button type="button" onClick={() => { setLoading(true); setError(null); setPage((current) => current + 1); }} className="neu-button w-full rounded-xl border border-[var(--line)] py-2.5 text-sm text-[var(--ink)]">Load more workflows</button>
      ) : null}
    </div>
  );
}
