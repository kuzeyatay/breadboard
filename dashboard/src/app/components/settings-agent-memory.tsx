"use client";

import { useCallback, useEffect, useState } from "react";

type MemoryKind = "preference" | "project_fact" | "decision" | "working_pattern";
type MemoryScope = "global" | "project" | "garden";
type MemoryState = "candidate" | "confirmed" | "superseded";

interface DurableMemory {
  id: number;
  content: string;
  kind: MemoryKind;
  scope: MemoryScope;
  scopeId: string | null;
  state: MemoryState;
  confidence: number;
  salience: number;
  createdAt: string;
  lastConfirmedAt: string | null;
  supersededAt: string | null;
  sourceConversationId: number | null;
  sourceConversationTitle: string | null;
  scopeLabel: string | null;
}

interface WorkingState {
  currentGoal?: string;
  knownFacts: string[];
  decisions: string[];
  completedActions: string[];
  openQuestions: string[];
  referencedFiles: string[];
  temporaryPreferences: string[];
}

interface ConversationMemory {
  conversationId: number;
  publicId: string;
  title: string;
  surface: string;
  summary: string;
  workingState: WorkingState;
  messageCount: number;
  updatedAt: string;
}

interface MemoryOverview {
  durable: DurableMemory[];
  conversations: ConversationMemory[];
  counts: { confirmed: number; candidate: number; superseded: number };
}

type Filter = "active" | "confirmed" | "candidate" | "forgotten";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "All active" },
  { value: "confirmed", label: "Confirmed" },
  { value: "candidate", label: "Candidates" },
  { value: "forgotten", label: "Forgotten" },
];

const KIND_LABELS: Record<MemoryKind, string> = {
  preference: "Preference",
  project_fact: "Fact",
  decision: "Decision",
  working_pattern: "Pattern",
};

const SURFACE_LABELS: Record<string, string> = {
  dashboard_terminal: "Terminal",
  garden_chat: "Garden chat",
  quartz_ai: "Published site",
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  // SQLite datetime('now') is UTC without a zone marker.
  const normalized = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })
    : null;
}

function scopeText(memory: DurableMemory): string {
  if (memory.scope === "global") return "Everywhere";
  if (memory.scope === "garden") {
    return memory.scopeLabel ? `Garden · ${memory.scopeLabel}` : "One garden";
  }
  return "This workspace";
}

export default function SettingsAgentMemory() {
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Keyed as "durable:<id>" / "chat:<id>" so both lists can share one in-flight slot.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agent-memory?includeForgotten=1", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as MemoryOverview & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "The memory could not be loaded.");
      setOverview(payload);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The memory could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function mutate(key: string, request: () => Promise<Response>) {
    setPendingKey(key);
    setError(null);
    try {
      const response = await request();
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "That change could not be applied.");
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change could not be applied.");
    } finally {
      setPendingKey(null);
    }
  }

  const durable = (overview?.durable ?? []).filter((memory) => {
    if (filter === "forgotten") return memory.state === "superseded";
    if (filter === "active") return memory.state !== "superseded";
    return memory.state === filter;
  });
  const counts = overview?.counts;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--ink-heading)]">
              What the agent remembers
            </h3>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
              {counts
                ? `${counts.confirmed} confirmed · ${counts.candidate} candidate · ${counts.superseded} forgotten`
                : "Facts, preferences, and decisions carried between chats."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          >
            Refresh
          </button>
        </div>

        <div
          className="neu-segmented inline-flex rounded-xl p-1"
          role="tablist"
          aria-label="Memory filter"
        >
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={`rounded-lg px-2.5 py-1 text-xs transition ${
                filter === option.value
                  ? "text-[var(--ink-heading)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading memory…</p>
      ) : durable.length === 0 ? (
        <p className="neu-inset rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-6 text-center text-xs text-[var(--ink-muted)]">
          {filter === "forgotten"
            ? "Nothing has been forgotten."
            : "Nothing remembered yet. Tell the agent to remember something and it will appear here."}
        </p>
      ) : (
        <ul className="space-y-2">
          {durable.map((memory) => {
            const created = formatDate(memory.createdAt);
            const busy = pendingKey === `durable:${memory.id}`;
            return (
              <li
                key={memory.id}
                className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-3.5"
              >
                <p
                  className={`text-sm leading-6 ${
                    memory.state === "superseded"
                      ? "text-[var(--ink-muted)] line-through decoration-[var(--line-strong)]"
                      : "text-[var(--ink)]"
                  }`}
                >
                  {memory.content}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--ink-muted)]">
                  <span className="rounded-full bg-[var(--paper-strong)] px-2 py-0.5">
                    {KIND_LABELS[memory.kind]}
                  </span>
                  <span>{scopeText(memory)}</span>
                  {memory.state === "candidate" ? (
                    <span className="text-[#8a6f00]">Unconfirmed</span>
                  ) : null}
                  {created ? <span>Added {created}</span> : null}
                  {memory.sourceConversationTitle ? (
                    <span className="min-w-0 truncate">
                      From “{memory.sourceConversationTitle}”
                    </span>
                  ) : null}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {memory.state === "candidate" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(`durable:${memory.id}`, () =>
                          fetch(`/api/agent-memory/durable/${memory.id}`, { method: "PATCH" }),
                        )
                      }
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
                    >
                      Keep this
                    </button>
                  ) : null}
                  {memory.state === "superseded" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(`durable:${memory.id}`, () =>
                          fetch(`/api/agent-memory/durable/${memory.id}?permanent=1`, {
                            method: "DELETE",
                          }),
                        )
                      }
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--danger)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
                    >
                      {busy ? "Deleting…" : "Delete permanently"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(`durable:${memory.id}`, () =>
                          fetch(`/api/agent-memory/durable/${memory.id}`, { method: "DELETE" }),
                        )
                      }
                      className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                    >
                      {busy ? "Forgetting…" : "Forget"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {overview?.conversations.length ? (
        <section className="space-y-2 border-t border-[var(--line)] pt-4">
          <div>
            <h3 className="text-sm font-medium text-[var(--ink-heading)]">
              Per-chat working memory
            </h3>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
              The compacted state each chat keeps once it grows past a few dozen messages.
              Clearing one leaves its transcript untouched.
            </p>
          </div>
          <ul className="space-y-2">
            {overview.conversations.map((conversation) => {
              const open = expanded === conversation.conversationId;
              const state = conversation.workingState;
              const busy = pendingKey === `chat:${conversation.conversationId}`;
              return (
                <li
                  key={conversation.conversationId}
                  className="neu-surface-subtle rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)]"
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : conversation.conversationId)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-[var(--ink)]">
                        {conversation.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">
                        {SURFACE_LABELS[conversation.surface] ?? conversation.surface} ·{" "}
                        {conversation.messageCount} messages
                        {formatDate(conversation.updatedAt)
                          ? ` · updated ${formatDate(conversation.updatedAt)}`
                          : ""}
                      </span>
                    </span>
                    <svg
                      aria-hidden
                      className={`h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)] transition-transform ${open ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {open ? (
                    <div className="space-y-3 border-t border-[var(--line)] px-3.5 py-3 text-xs leading-5 text-[var(--ink-muted)]">
                      {state.currentGoal ? (
                        <p>
                          <span className="font-medium text-[var(--ink-heading)]">Goal: </span>
                          {state.currentGoal}
                        </p>
                      ) : null}
                      {(
                        [
                          ["Decisions", state.decisions],
                          ["Known facts", state.knownFacts],
                          ["Completed", state.completedActions],
                          ["Open questions", state.openQuestions],
                          ["Preferences", state.temporaryPreferences],
                        ] as Array<[string, string[]]>
                      )
                        .filter(([, values]) => values.length > 0)
                        .map(([label, values]) => (
                          <div key={label}>
                            <p className="font-medium text-[var(--ink-heading)]">{label}</p>
                            <ul className="mt-1 space-y-1">
                              {values.map((value, index) => (
                                <li key={`${label}-${index}`} className="flex gap-1.5">
                                  <span aria-hidden>·</span>
                                  <span className="min-w-0">{value}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      {state.referencedFiles.length ? (
                        <div>
                          <p className="font-medium text-[var(--ink-heading)]">Files referenced</p>
                          <ul className="mt-1 space-y-0.5 font-mono text-[10px]">
                            {state.referencedFiles.map((file) => (
                              <li key={file} className="break-all">
                                {file}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {conversation.summary ? (
                        <details>
                          <summary className="cursor-pointer font-medium text-[var(--ink-heading)]">
                            Rolling summary
                          </summary>
                          <p className="mt-1 whitespace-pre-wrap">{conversation.summary}</p>
                        </details>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void mutate(`chat:${conversation.conversationId}`, () =>
                            fetch(`/api/agent-memory/conversations/${conversation.conversationId}`, {
                              method: "DELETE",
                            }),
                          )
                        }
                        className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                      >
                        {busy ? "Clearing…" : "Clear this chat's memory"}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {error ? (
        <p className="text-xs leading-5 text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}

      <p className="border-t border-[var(--line)] pt-3 text-[11px] leading-5 text-[var(--ink-muted)]">
        Forgetting removes an entry from every future retrieval but keeps the row until you
        delete it permanently. Memory is treated as untrusted context: it never grants the
        agent tool, filesystem, or garden access.
      </p>
    </div>
  );
}
