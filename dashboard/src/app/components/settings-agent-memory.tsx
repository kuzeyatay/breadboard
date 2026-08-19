"use client";

import { useCallback, useEffect, useState } from "react";
import { HERMES_SESSIONS_CHANGED_EVENT } from "@/lib/hermes/session-client";

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

interface SemanticStatus {
  enabled: boolean;
  extractionEnabled: boolean;
  engineAvailable: boolean;
  fingerprint: string;
  indexedMemories: number;
  totalMemories: number;
  degradedReason: string | null;
}

interface MemoryProfile {
  summary: string;
  generationEnabled: boolean;
  useInChats: boolean;
  status: "idle" | "generating" | "ready" | "error";
  source: "generated" | "edited";
  sourceMessageId: number;
  evidenceMessageCount: number;
  pendingMessageCount: number;
  lastError: string | null;
  generatedAt: string | null;
  updatedAt: string;
}

interface MemoryOverview {
  profile: MemoryProfile;
  durable: DurableMemory[];
  conversations: ConversationMemory[];
  counts: { confirmed: number; candidate: number; superseded: number };
  semantic?: SemanticStatus;
}

interface InstructionChange {
  action: "add" | "update" | "forget";
  memoryId: number;
  content: string;
  kind: MemoryKind;
}

interface InstructionOutcome {
  reply: string;
  changes: InstructionChange[];
  summaryRefreshed: boolean;
}

const CHANGE_LABELS: Record<InstructionChange["action"], string> = {
  add: "Remembered",
  update: "Corrected",
  forget: "Dropped",
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

function profileSections(summary: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  let heading = "Overview";
  let body: string[] = [];
  const flush = () => {
    const text = body.join("\n").trim();
    if (text) sections.push({ heading, body: text });
    body = [];
  };
  for (const line of summary.split(/\r?\n/)) {
    const match = line.match(/^#{1,3}\s+(.+)$/);
    if (match) {
      flush();
      heading = match[1].trim();
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

export default function SettingsAgentMemory() {
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Keyed as "profile:<action>" / "chat:<id>" so every control shares one in-flight slot.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileContent, setProfileContent] = useState("");
  const [instruction, setInstruction] = useState("");
  const [instructionOutcome, setInstructionOutcome] = useState<InstructionOutcome | null>(null);

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
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const mutate = useCallback(async function mutate(
    key: string,
    request: () => Promise<Response>,
  ): Promise<boolean> {
    setPendingKey(key);
    setError(null);
    try {
      const response = await request();
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "That change could not be applied.");
      }
      await refresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change could not be applied.");
      return false;
    } finally {
      setPendingKey((current) => current === key ? null : current);
    }
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let running = false;
    let queued = false;
    const controller = new AbortController();

    const regenerate = async () => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      setPendingKey("profile:auto");
      setError(null);
      try {
        do {
          queued = false;
          const response = await fetch("/api/agent-memory/profile", {
            method: "POST",
            signal: controller.signal,
          });
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(payload.error ?? "The memory could not be regenerated.");
          }
          if (!disposed) await refresh();
        } while (queued && !disposed);
      } catch (caught) {
        if (!disposed && !(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The memory could not be regenerated.",
          );
        }
      } finally {
        running = false;
        if (!disposed) {
          setPendingKey((current) => current === "profile:auto" ? null : current);
        }
      }
    };

    const handleMessageActivity = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<{ surface?: string }>;
      if (
        event.detail?.surface !== "dashboard_terminal" &&
        event.detail?.surface !== "garden_chat"
      ) {
        return;
      }
      void regenerate();
    };

    const timer = window.setTimeout(() => void regenerate(), 0);
    window.addEventListener(HERMES_SESSIONS_CHANGED_EVENT, handleMessageActivity);
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
      window.removeEventListener(HERMES_SESSIONS_CHANGED_EVENT, handleMessageActivity);
    };
  }, [refresh]);

  // The instruction is applied and the summary rebuilt server-side, so one
  // refresh afterwards shows both the change and the sentence explaining it.
  async function sendInstruction() {
    const typed = instruction.trim();
    if (!typed) return;
    setPendingKey("instruction");
    setError(null);
    setInstructionOutcome(null);
    try {
      const response = await fetch("/api/agent-memory/instruct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: typed }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<InstructionOutcome> & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "That instruction could not be applied.");
      }
      setInstruction("");
      setInstructionOutcome({
        reply: payload.reply?.trim() || "Memory updated.",
        changes: payload.changes ?? [],
        summaryRefreshed: payload.summaryRefreshed !== false,
      });
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That instruction could not be applied.",
      );
    } finally {
      setPendingKey((current) => current === "instruction" ? null : current);
    }
  }

  async function saveProfile() {
    const summary = profileContent.trim();
    if (summary.length < 24) {
      setError("The memory summary is too short.");
      return;
    }
    const saved = await mutate("profile:edit", () =>
      fetch("/api/agent-memory/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary }),
      }),
    );
    if (saved) setEditingProfile(false);
  }

  const profile = overview?.profile;

  return (
    <div className="space-y-4">
      <section className="neu-surface-subtle space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--ink-heading)]">
              Memory
            </h3>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
              Breadboard automatically keeps useful details from your chats and uses
              them to make future conversations more helpful. You can also just tell
              it what to keep.
            </p>
          </div>
        </div>

        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void sendInstruction();
          }}
        >
          <label htmlFor="memory-instruction" className="sr-only">
            Tell Breadboard what to remember
          </label>
          <textarea
            id="memory-instruction"
            rows={2}
            maxLength={1000}
            value={instruction}
            disabled={pendingKey === "instruction"}
            placeholder="Remember that my birthday is 23 June 2006"
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className="neu-inset w-full resize-y rounded-xl border border-[var(--line-strong)] bg-[var(--paper-strong)] px-3 py-2 text-xs leading-5 text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-muted)] focus:border-[var(--botanical)] disabled:opacity-60"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] leading-4 text-[var(--ink-muted)]">
              Say it the way you would in a chat. Corrections and things to stop
              keeping work the same way.
            </p>
            <button
              type="submit"
              disabled={pendingKey === "instruction" || !instruction.trim()}
              className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--ink)] disabled:opacity-50"
            >
              {pendingKey === "instruction" ? "Saving…" : "Save to memory"}
            </button>
          </div>
        </form>

        {instructionOutcome ? (
          <div
            role="status"
            className="space-y-1.5 rounded-xl bg-[var(--paper-strong)] px-3 py-2.5 text-xs leading-5 text-[var(--ink)]"
          >
            <p>{instructionOutcome.reply}</p>
            {instructionOutcome.changes.length ? (
              <ul className="space-y-1">
                {instructionOutcome.changes.map((change) => (
                  <li key={`${change.action}-${change.memoryId}`} className="flex gap-1.5">
                    <span className="shrink-0 text-[var(--ink-muted)]">
                      {CHANGE_LABELS[change.action]}
                    </span>
                    <span className="min-w-0">{change.content}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {instructionOutcome.changes.length && !instructionOutcome.summaryRefreshed ? (
              <p className="text-[10px] leading-4 text-[var(--ink-muted)]">
                Chats already use this. The summary below catches up on its next update.
              </p>
            ) : null}
          </div>
        ) : null}

        {editingProfile ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProfile();
            }}
          >
            <label htmlFor="memory-profile-edit" className="sr-only">
              Edit memory summary
            </label>
            <textarea
              id="memory-profile-edit"
              autoFocus
              rows={12}
              maxLength={6000}
              value={profileContent}
              disabled={pendingKey === "profile:edit"}
              onChange={(event) => setProfileContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditingProfile(false);
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              className="neu-inset w-full resize-y rounded-xl border border-[var(--line-strong)] bg-[var(--paper-strong)] px-3 py-2 font-mono text-xs leading-5 text-[var(--ink)] outline-none transition focus:border-[var(--botanical)] disabled:opacity-60"
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="submit"
                disabled={pendingKey === "profile:edit" || profileContent.trim().length < 24}
                className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--ink)] disabled:opacity-50"
              >
                {pendingKey === "profile:edit" ? "Saving…" : "Save summary"}
              </button>
              <button
                type="button"
                disabled={pendingKey === "profile:edit"}
                onClick={() => setEditingProfile(false)}
                className="rounded-lg px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : profile?.summary ? (
          <div className="space-y-4 px-0.5 py-1">
            {profileSections(profile.summary).map((section) => (
              <div key={section.heading}>
                <h4 className="text-sm font-medium text-[var(--ink-heading)]">
                  {section.heading}
                </h4>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--ink)]">
                  {section.body}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl bg-[var(--paper-strong)] px-4 py-5 text-center">
            <p className="text-xs text-[var(--ink-muted)]">
              {loading
                ? "Loading memory…"
                : "Memory will appear here automatically as you continue chatting."}
            </p>
          </div>
        )}

        {profile?.lastError ? (
          <p className="text-xs leading-5 text-[var(--danger)]" role="status">
            {profile.lastError}
          </p>
        ) : null}

        {profile ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--ink-muted)]">
            <span>
              {profile.generatedAt
                ? `${profile.source === "edited" ? "Edited" : "Generated"} ${formatDate(profile.generatedAt) ?? "recently"}`
                : "Not generated yet"}
              {profile.pendingMessageCount > 0
                ? ` · ${profile.pendingMessageCount} newer message${profile.pendingMessageCount === 1 ? "" : "s"}`
                : ""}
            </span>
            {profile.summary ? (
              <span className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={pendingKey?.startsWith("profile:")}
                  onClick={() => {
                    setProfileContent(profile.summary);
                    setEditingProfile(true);
                    setError(null);
                  }}
                  className="rounded-lg px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={pendingKey?.startsWith("profile:")}
                  onClick={() =>
                    void mutate("profile:clear", () =>
                      fetch("/api/agent-memory/profile", { method: "DELETE" }),
                    )
                  }
                  className="rounded-lg px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:text-[var(--danger)] disabled:opacity-50"
                >
                  {pendingKey === "profile:clear" ? "Clearing…" : "Clear summary"}
                </button>
              </span>
            ) : null}
          </div>
        ) : null}

      </section>

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
    </div>
  );
}
