"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalPanel } from "./terminal-sidebar";
import type {
  ActiveChatProcess,
  ProcessesSnapshot,
  TrackedBreadboardProcess,
} from "@/lib/processes/types.ts";
import {
  formatRelativeRunTime,
  formatRunTime,
  SCHEDULES_CHANGED_EVENT,
} from "./schedule-client";
import { HERMES_SESSIONS_CHANGED_EVENT } from "@/lib/hermes/session-client";

interface Props {
  onOpenChat: (conversationId: string) => void;
  onOpenPanel: (panel: Extract<TerminalPanel, "scheduled" | "hooks">) => void;
}

const EMPTY_SNAPSHOT: ProcessesSnapshot = {
  activeChats: [],
  activeProcesses: [],
  schedules: [],
  hooks: [],
  generatedAt: "",
};

function surfaceLabel(run: ActiveChatProcess): string {
  if (run.surface === "dashboard_terminal") return "Terminal chat";
  if (run.surface === "garden_chat") {
    return run.gardenId ? `${run.gardenId} garden chat` : "Garden chat";
  }
  return run.pageSlug ? `Quartz · ${run.pageSlug}` : "Quartz chat";
}

function processKindLabel(process: TrackedBreadboardProcess): string {
  return process.kind === "scheduled_run" ? "Scheduled run" : "Agent process";
}

function startedLabel(value: string): string {
  const started = new Date(value).getTime();
  if (!Number.isFinite(started)) return "Running";
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  if (minutes < 1) return "Started now";
  if (minutes < 60) return `Running ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `Running ${hours} h` : `Running ${Math.floor(hours / 24)} d`;
}

function LiveDot() {
  return (
    <span className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0" aria-label="Active">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--botanical)] opacity-30 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--botanical)]" />
    </span>
  );
}

export default function ProcessesPanel({ onOpenChat, onOpenPanel }: Props) {
  const [snapshot, setSnapshot] = useState<ProcessesSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestActive = useRef(false);

  const load = useCallback(async (manual = false) => {
    if (requestActive.current) return;
    requestActive.current = true;
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/processes", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as Partial<ProcessesSnapshot> & {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "Processes could not be loaded.");
      }
      setSnapshot({
        activeChats: Array.isArray(payload.activeChats) ? payload.activeChats : [],
        activeProcesses: Array.isArray(payload.activeProcesses) ? payload.activeProcesses : [],
        schedules: Array.isArray(payload.schedules) ? payload.schedules : [],
        hooks: Array.isArray(payload.hooks) ? payload.hooks : [],
        generatedAt: typeof payload.generatedAt === "string" ? payload.generatedAt : "",
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Processes could not be loaded.");
    } finally {
      requestActive.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void load(), 0);
    const refresh = () => void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5_000);
    window.addEventListener(HERMES_SESSIONS_CHANGED_EVENT, refresh);
    window.addEventListener(SCHEDULES_CHANGED_EVENT, refresh);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(interval);
      window.removeEventListener(HERMES_SESSIONS_CHANGED_EVENT, refresh);
      window.removeEventListener(SCHEDULES_CHANGED_EVENT, refresh);
    };
  }, [load]);

  const activeCount = snapshot.activeChats.length + snapshot.activeProcesses.length;

  return (
    <section
      aria-label="Processes"
      className="flex h-full min-h-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)]"
    >
      <header className="shrink-0 border-b border-[var(--line)] px-4 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-[var(--ink-heading)]">Processes</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              Live chats, running work, schedules, and hooks in one place.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="neu-button rounded-lg px-2.5 py-1.5 text-xs text-[var(--ink-muted)] disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {error ? (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_28%,var(--line))] bg-[var(--paper-raised)] p-3">
            <p className="text-xs text-[var(--danger)]">{error}</p>
            <button type="button" onClick={() => void load(true)} className="mt-2 text-xs font-medium text-[var(--botanical)]">
              Try again
            </button>
          </div>
        ) : null}

        <section aria-labelledby="processes-active-heading">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 id="processes-active-heading" className="text-sm font-medium text-[var(--ink-heading)]">
              Active now
            </h3>
            {!loading ? <span className="text-[11px] tabular-nums text-[var(--ink-muted)]">{activeCount}</span> : null}
          </div>
          {loading ? (
            <div className="space-y-2" aria-label="Loading active processes">
              {[0, 1].map((row) => <div key={row} className="h-20 animate-pulse rounded-xl bg-[var(--paper-strong)] motion-reduce:animate-none" />)}
            </div>
          ) : activeCount ? (
            <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--paper-raised)]">
              {snapshot.activeChats.map((run) => (
                <li key={`chat:${run.id}`}>
                  <button
                    type="button"
                    disabled={run.surface !== "dashboard_terminal"}
                    onClick={() => onOpenChat(run.conversationId)}
                    className="flex w-full items-start gap-3 px-3 py-3 text-left transition enabled:hover:bg-[var(--paper-strong)] disabled:cursor-default"
                  >
                    <LiveDot />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">{run.title}</span>
                      <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-[var(--ink-muted)]">{run.instruction}</span>
                      <span className="mt-1 block text-[10px] text-[var(--ink-muted)]">{surfaceLabel(run)} · {startedLabel(run.startedAt)}</span>
                    </span>
                    {run.surface === "dashboard_terminal" ? <span className="mt-0.5 text-xs text-[var(--botanical)]">Open</span> : null}
                  </button>
                </li>
              ))}
              {snapshot.activeProcesses.map((process) => (
                <li key={process.id} className="flex items-start gap-3 px-3 py-3">
                  <LiveDot />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">{process.title}</span>
                    {process.description ? <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-[var(--ink-muted)]">{process.description}</span> : null}
                    <span className="mt-1 block text-[10px] text-[var(--ink-muted)]">{processKindLabel(process)} · {startedLabel(process.startedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-center">
              <p className="text-sm text-[var(--ink-heading)]">Nothing is running</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">Active chats and agent work will appear here automatically.</p>
            </div>
          )}
        </section>

        <section aria-labelledby="processes-scheduled-heading">
          <div className="mb-2 flex items-center gap-3">
            <h3 id="processes-scheduled-heading" className="text-sm font-medium text-[var(--ink-heading)]">Scheduled</h3>
            <button type="button" onClick={() => onOpenPanel("scheduled")} className="ml-auto text-xs font-medium text-[var(--botanical)]">Manage</button>
          </div>
          {snapshot.schedules.length ? (
            <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--paper-raised)]">
              {snapshot.schedules.map((schedule) => (
                <li key={schedule.id} className="px-3 py-3">
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${schedule.enabled ? "bg-[var(--botanical)]" : "bg-[var(--ink-faint)]"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--ink-heading)]">{schedule.title}</p>
                      <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{schedule.cadence} · {schedule.target}</p>
                      <p className="mt-1 text-[10px] text-[var(--ink-muted)]">
                        {schedule.enabled ? `${formatRelativeRunTime(schedule.nextRunAt)} · ${formatRunTime(schedule.nextRunAt)}` : "Paused"}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <button type="button" onClick={() => onOpenPanel("scheduled")} className="w-full rounded-xl border border-dashed border-[var(--line)] px-4 py-5 text-left transition hover:bg-[var(--paper-raised)]">
              <span className="block text-sm text-[var(--ink-heading)]">No scheduled tasks</span>
              <span className="mt-1 block text-xs text-[var(--ink-muted)]">Create one to run a chat automatically.</span>
            </button>
          )}
        </section>

        <section aria-labelledby="processes-hooks-heading">
          <div className="mb-2 flex items-center gap-3">
            <h3 id="processes-hooks-heading" className="text-sm font-medium text-[var(--ink-heading)]">Hooks</h3>
            <button type="button" onClick={() => onOpenPanel("hooks")} className="ml-auto text-xs font-medium text-[var(--botanical)]">Manage</button>
          </div>
          {snapshot.hooks.length ? (
            <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--paper-raised)]">
              {snapshot.hooks.map((hook) => (
                <li key={hook.id} className="flex items-start gap-3 px-3 py-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${hook.enabled ? "bg-[var(--botanical)]" : "bg-[var(--ink-faint)]"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">{hook.title}</span>
                    <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">{hook.event}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <button type="button" onClick={() => onOpenPanel("hooks")} className="w-full rounded-xl border border-dashed border-[var(--line)] px-4 py-5 text-left transition hover:bg-[var(--paper-raised)]">
              <span className="block text-sm text-[var(--ink-heading)]">No hooks yet</span>
              <span className="mt-1 block text-xs text-[var(--ink-muted)]">Create an automation that reacts to an event.</span>
            </button>
          )}
        </section>
      </div>
    </section>
  );
}
