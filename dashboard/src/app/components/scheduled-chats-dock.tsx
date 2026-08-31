"use client";

// Persistent top-left dialogue on the dashboard: while any chat is scheduled,
// this shows what is queued, where it will open, and when — so a cron job that
// runs on its own is never invisible. It renders nothing when no schedule exists.

import { useCallback, useEffect, useState } from "react";
import {
  formatRelativeRunTime,
  formatRunTime,
  SCHEDULES_CHANGED_EVENT,
} from "@/app/components/hermes/schedule-client";
import type { ScheduledChatJob } from "@/lib/schedules/types.ts";
import { scheduleTargetLabel } from "@/lib/schedules/types.ts";
import { ActiveChatIcon } from "@/app/components/hermes/history-client";

const COLLAPSED_KEY = "breadboard:scheduled-chats-dock:collapsed";
const REFRESH_INTERVAL_MS = 30_000;

function ClockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.75V12l2.75 1.75" />
    </svg>
  );
}

export default function ScheduledChatsDock() {
  const [schedules, setSchedules] = useState<ScheduledChatJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Re-render on a timer so the "in 4 min" countdown stays honest.
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/schedules", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { schedules?: ScheduledChatJob[] };
      setSchedules(payload.schedules ?? []);
    } catch {
      // The dock is ambient; a transient failure keeps the last known list.
    }
  }, []);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    void load();
    const listener = () => void load();
    window.addEventListener(SCHEDULES_CHANGED_EVENT, listener);
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
      void load();
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.removeEventListener(SCHEDULES_CHANGED_EVENT, listener);
      window.clearInterval(timer);
    };
  }, [load]);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function act(job: ScheduledChatJob, action: "toggle" | "run" | "delete") {
    setBusyId(job.id);
    setNotice(null);
    try {
      if (action === "delete") {
        await fetch(`/api/schedules/${job.id}`, { method: "DELETE" });
      } else if (action === "toggle") {
        await fetch(`/api/schedules/${job.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !job.enabled }),
        });
      } else {
        const response = await fetch(`/api/schedules/${job.id}/run`, { method: "POST" });
        const payload = (await response.json().catch(() => ({}))) as {
          started?: boolean;
          error?: string | null;
        };
        setNotice(
          payload.started
            ? `"${job.title}" started a new chat.`
            : payload.error ?? "That run could not start.",
        );
      }
      await load();
    } catch {
      setNotice("That action could not be completed.");
    } finally {
      setBusyId(null);
    }
  }

  if (schedules.length === 0) return null;

  const armed = schedules.filter((job) => job.enabled || job.running);
  const next = armed
    .filter((job) => job.nextRunAt)
    .sort((a, b) => Date.parse(a.nextRunAt ?? "") - Date.parse(b.nextRunAt ?? ""))[0];

  return (
    <aside
      aria-label="Scheduled chats"
      className="fixed left-4 top-20 z-30 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-800 bg-gray-900/90 text-white shadow-xl backdrop-blur"
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <span className="mt-0.5 text-[#a9c1b1]">
          <ClockIcon />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-tight">
            {schedules.length} scheduled chat{schedules.length === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-gray-400">
            {next
              ? `Next: ${next.title} ${formatRelativeRunTime(next.nextRunAt)}`
              : "All schedules are paused"}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-gray-400 hover:text-white"
          aria-expanded={!collapsed}
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>

      {collapsed ? null : (
        <div className="max-h-[52vh] overflow-y-auto border-t border-gray-800">
          {notice ? (
            <p role="status" className="px-3 pt-2 text-[11px] text-[#d8c48a]">
              {notice}
            </p>
          ) : null}
          <ul className="divide-y divide-gray-800">
            {schedules.map((job) => (
              <li key={job.id} className="px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      job.enabled ? "bg-[#a9c1b1]" : "bg-gray-600"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                      <span className="truncate">{job.title}</span>
                      {job.running ? (
                        <ActiveChatIcon
                          label={`${job.title} is running`}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                      ) : null}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-gray-400">
                      {job.cronDescription}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-gray-500">
                      New chat in {scheduleTargetLabel(job)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {job.running
                        ? "Running now"
                        : job.enabled
                        ? `Next ${formatRunTime(job.nextRunAt)} · ${formatRelativeRunTime(job.nextRunAt)}`
                        : "Paused"}
                    </p>
                    {job.lastRunAt ? (
                      <p
                        className={`mt-0.5 truncate text-[11px] ${
                          job.lastStatus === "failed" ? "text-red-400" : "text-gray-500"
                        }`}
                        title={job.lastError ?? undefined}
                      >
                        {job.lastStatus === "failed" ? "Last run failed" : "Last ran"}{" "}
                        {formatRunTime(job.lastRunAt)}
                        {job.lastStatus === "failed" && job.lastError ? ` — ${job.lastError}` : ""}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busyId === job.id}
                        onClick={() => void act(job, "run")}
                        className="text-[11px] text-[#a9c1b1] hover:text-white disabled:opacity-40"
                      >
                        Run now
                      </button>
                      <button
                        type="button"
                        disabled={busyId === job.id}
                        onClick={() => void act(job, "toggle")}
                        className="text-[11px] text-gray-400 hover:text-white disabled:opacity-40"
                      >
                        {job.enabled ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === job.id}
                        onClick={() => void act(job, "delete")}
                        className="text-[11px] text-gray-500 hover:text-red-400 disabled:opacity-40"
                      >
                        Delete
                      </button>
                      {job.surface === "garden_chat" && job.gardenSlug ? (
                        <a
                          href={`/gardens/${encodeURIComponent(job.gardenSlug)}`}
                          className="text-[11px] text-gray-500 hover:text-white"
                        >
                          Open garden
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-gray-800 px-3 py-2 text-[10px] leading-4 text-gray-500">
            Scheduled chats open by themselves in the terminal or garden they were created from.
            They only run while Breadboard is running.
          </p>
        </div>
      )}
    </aside>
  );
}
