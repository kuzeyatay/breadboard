"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { LocalWorkflowSummary } from "@/lib/workflows/types";
import { isSameTabNavigationClick, rememberWorkflowReturnPath } from "@/lib/workflows/navigation";

// Native replacement for the n8n-backed template/local-automation browser.
// Lists the user's own workflows from the native engine (/api/workflows/local)
// and lets a chat surface run one, or open it on the canvas. The public
// n8n community template library is gone with n8n itself.

type LocalWorkflowListItem = {
  id: string;
  name: string;
  description?: string | null;
  blockCount?: number;
  updatedAt: string | null;
};

type LocalResponse = {
  workflows?: LocalWorkflowListItem[];
  error?: string;
};

type Props = {
  onRunWorkflow?: (workflow: LocalWorkflowSummary) => void;
  onNavigate?: () => void;
  disabled?: boolean;
};

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

function PlusIcon() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
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

/**
 * Adapts the native list item into the shared `LocalWorkflowSummary` shape
 * `onRunWorkflow` callers expect (use-workflow-automation.ts and its garden
 * counterpart, which this panel does not own and must keep working
 * unchanged). The cast through `unknown` is deliberate: it decouples this
 * file from that type's exact field set — which the engine owns and may
 * still be settling — while keeping the fields those callers actually read
 * (`id`, `name`) always populated.
 */
function toLocalWorkflowSummary(item: LocalWorkflowListItem): LocalWorkflowSummary {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? undefined,
    active: true,
    updatedAt: item.updatedAt,
    nodeCount: item.blockCount ?? 0,
    blockCount: item.blockCount ?? 0,
  } as unknown as LocalWorkflowSummary;
}

export default function WorkflowTemplatesPanel({ onRunWorkflow, onNavigate, disabled = false }: Props) {
  const [input, setInput] = useState("");
  const [items, setItems] = useState<LocalWorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const debouncedQuery = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | null = null;
    let retrying = false;
    async function load() {
      try {
        const response = await fetch("/api/workflows/local", { cache: "no-store", signal: controller.signal });
        const payload = (await response.json()) as LocalResponse;
        if (!response.ok && (response.status === 502 || response.status === 503)) {
          retrying = true;
          setError(null);
          setLoading(true);
          retryTimer = window.setTimeout(() => setReload((current) => current + 1), 1_200);
          return;
        }
        if (!response.ok) throw new Error(payload.error || "Your workflows could not be loaded.");
        setItems(payload.workflows ?? []);
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Your workflows could not be loaded.");
      } finally {
        if (!controller.signal.aborted && !retrying) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [reload]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      debouncedQuery.current = input.trim();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  const visibleItems = items.filter(
    (workflow) => !input.trim() || workflow.name.toLowerCase().includes(input.trim().toLowerCase()),
  );

  function navigateToWorkflow(event: MouseEvent<HTMLAnchorElement>) {
    if (!isSameTabNavigationClick(event)) return;
    rememberWorkflowReturnPath();
    onNavigate?.();
  }

  async function createWorkflow() {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/workflows/local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Untitled workflow" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || "The workflow could not be created.");
      rememberWorkflowReturnPath();
      window.location.href = `/workflows?workflow=${encodeURIComponent(payload.id)}`;
      onNavigate?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workflow could not be created.");
      setCreating(false);
    }
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
              Build an automation on Breadboard&apos;s canvas, then run it from this chat or open it to keep editing.
            </p>
          </div>
          <button
            type="button"
            onClick={createWorkflow}
            disabled={creating}
            className="neu-button-accent inline-flex shrink-0 items-center gap-1.5 justify-center rounded-xl border px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlusIcon /> New workflow
          </button>
        </div>
      </div>

      <div>
        <label className="neu-control flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-[var(--ink-muted)] focus-within:border-[var(--botanical)]">
          <span className="sr-only">Search your workflows</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Search your workflows…"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
          />
          {input ? (
            <button type="button" onClick={() => setInput("")} className="rounded px-1 text-xs hover:text-[var(--ink)]" aria-label="Clear workflow search">
              ×
            </button>
          ) : null}
        </label>
      </div>

      {error ? (
        <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">
          {error}
          <button type="button" onClick={() => { setLoading(true); setError(null); setReload((current) => current + 1); }} className="ml-2 underline underline-offset-2">
            Try again
          </button>
        </div>
      ) : null}

      {loading ? <div className="py-4 text-center text-xs text-[var(--ink-muted)]">Loading your workflows…</div> : null}

      {!loading && !error && visibleItems.length ? (
        <div className="space-y-2">
          {visibleItems.map((workflow) => (
            <div key={workflow.id} className="neu-button flex items-center gap-2 rounded-2xl border border-[var(--line)] p-2">
              <button
                type="button"
                onClick={() => onRunWorkflow?.(toLocalWorkflowSummary(workflow))}
                disabled={disabled || !onRunWorkflow}
                className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)] text-[var(--botanical)]">
                  <WorkflowIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--ink-heading)] group-hover:text-[var(--botanical)]">{workflow.name}</span>
                  <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">
                    {typeof workflow.blockCount === "number" ? `${workflow.blockCount} blocks` : "Ready to run"}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-[var(--botanical)]">Run in chat</span>
              </button>
              <a
                href={`/workflows?workflow=${encodeURIComponent(workflow.id)}`}
                onClick={navigateToWorkflow}
                className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)] transition hover:text-[var(--botanical)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
                aria-label={`Open ${workflow.name} on the canvas`}
                title="Open on the canvas"
              >
                <SettingsIcon />
              </a>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && !error && !visibleItems.length ? (
        <div className="neu-inset rounded-2xl border border-[var(--line)] px-4 py-8 text-center">
          <p className="text-sm font-medium text-[var(--ink-heading)]">{items.length ? "No matching workflows" : "No workflows yet"}</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">Create one to start building an automation on the canvas.</p>
        </div>
      ) : null}
    </div>
  );
}
