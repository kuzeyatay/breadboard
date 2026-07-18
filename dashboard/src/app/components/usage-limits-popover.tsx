"use client";

import { useCallback, useEffect, useState } from "react";
import { usageLimitRowsWithFiveHour } from "@/lib/usage-limit-display";

interface UsageLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_in_seconds?: number;
}

interface UsageLimitsPayload {
  available?: boolean;
  captured_at?: string;
  file_updated_at?: string;
  age_seconds?: number;
  stale?: boolean;
  refreshed?: boolean;
  refresh_error?: string;
  primary?: UsageLimitWindow;
  secondary?: UsageLimitWindow;
}

interface UsageLimitsPopoverProps {
  buttonClassName?: string;
  activeButtonClassName?: string;
  inactiveButtonClassName?: string;
  popoverClassName?: string;
  showIcon?: boolean;
  light?: boolean;
}

function clampPercent(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}

function formatDuration(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const days = Math.floor(clamped / 86400);
  const hours = Math.floor((clamped % 86400) / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const parts = [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
  ].filter(Boolean);
  return parts.join(" ") || "<1m";
}

function formatUpdated(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function remainingResetSeconds(
  capturedAt: string | undefined,
  window: UsageLimitWindow,
  now: number,
): number | null {
  if (window.resets_in_seconds === undefined || !capturedAt) return null;
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs)) return Math.max(0, Number(window.resets_in_seconds));
  const resetAt = capturedMs + Number(window.resets_in_seconds) * 1000;
  return Math.max(0, Math.floor((resetAt - now) / 1000));
}

export default function UsageLimitsPopover({
  buttonClassName = "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors",
  activeButtonClassName = "border-blue-800/60 bg-blue-950/30 text-blue-400",
  inactiveButtonClassName = "border-transparent text-gray-600 hover:bg-gray-800 hover:text-gray-300",
  popoverClassName = "absolute bottom-full right-0 z-20 mb-1.5 w-72 rounded-xl border border-gray-700 bg-gray-900 p-4 text-xs shadow-2xl",
  showIcon = true,
  light = false,
}: UsageLimitsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [usageData, setUsageData] = useState<UsageLimitsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refreshUsage = useCallback(async (quiet = false, probe = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/usage-limits?ts=${Date.now()}`, {
        method: probe ? "POST" : "GET",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const data = (await response.json().catch(() => ({}))) as UsageLimitsPayload;
      setUsageData(data);
      if (!response.ok) {
        throw new Error(
          data.refresh_error || (probe ? "Could not refresh usage limits" : "Could not load usage limits"),
        );
      }
      setNow(Date.now());
    } catch (err) {
      if (!quiet) {
        setError(err instanceof Error ? err.message : "Could not load usage limits");
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshUsage(false);
    const id = window.setInterval(() => {
      setNow(Date.now());
      void refreshUsage(true);
    }, 30000);
    return () => window.clearInterval(id);
  }, [open, refreshUsage]);

  const updatedAt = formatUpdated(usageData?.captured_at);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="View usage limits"
        className={[
          buttonClassName,
          open ? activeButtonClassName : inactiveButtonClassName,
        ].join(" ")}
      >
        {showIcon ? (
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
            />
          </svg>
        ) : null}
        Usage
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={popoverClassName}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className={`font-medium ${light ? "text-[var(--ink-heading)]" : "text-gray-300"}`}>Usage Limits</p>
              <button
                type="button"
                onClick={() => void refreshUsage(false, true)}
                disabled={loading}
                title="Refresh the usage-limit snapshot"
                className={`rounded-md border px-2 py-1 text-[11px] transition disabled:cursor-wait disabled:opacity-50 ${light ? "border-[var(--line)] text-[var(--ink-muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]" : "border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-300"}`}
              >
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            {loading ? (
              <p className="text-gray-500">Loading...</p>
            ) : error ? (
              <p className={light ? "text-[var(--danger)]" : "text-red-300"}>{error}</p>
            ) : !usageData?.available ? (
              <p className="text-gray-500">No data yet. Send a message first.</p>
            ) : (
              <div className="space-y-3">
                {updatedAt ? (
                  <div className="space-y-1">
                    <p className={light ? "text-[var(--ink-muted)]" : "text-gray-600"}>Updated: {updatedAt}</p>
                    {usageData.stale ? (
                      <p className={light ? "text-[#8a6f00]" : "text-amber-300"}>
                        This snapshot is stale. Click Refresh for an updated snapshot.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {usageLimitRowsWithFiveHour(usageData).map(({ key, label, window: windowData, reported }) => {
                  if (!reported) {
                    return (
                      <div key={key}>
                        <div className={`mb-1 flex justify-between gap-3 ${light ? "text-[var(--ink-muted)]" : "text-gray-400"}`}>
                          <span>{label}</span>
                          <span>Not reported</span>
                        </div>
                        <div className={`h-1.5 rounded-full ${light ? "bg-[var(--line)]" : "bg-gray-800"}`} />
                        <p className={`mt-1 ${light ? "text-[var(--ink-muted)]" : "text-gray-600"}`}>
                          Unavailable in the latest response
                        </p>
                      </div>
                    );
                  }
                  const used = clampPercent(windowData.used_percent);
                  const left = Math.max(0, 100 - used);
                  const resetSeconds = remainingResetSeconds(
                    usageData.captured_at,
                    windowData,
                    now,
                  );
                  const color =
                    used >= 90 ? "bg-red-500" : used >= 60 ? "bg-yellow-500" : "bg-green-500";
                  return (
                    <div key={key}>
                      <div className={`mb-1 flex justify-between gap-3 ${light ? "text-[var(--ink-muted)]" : "text-gray-400"}`}>
                        <span>{label}</span>
                        <span>
                          {used.toFixed(1)}% used, {left.toFixed(1)}% left
                        </span>
                      </div>
                      <div className={`h-1.5 overflow-hidden rounded-full ${light ? "bg-[var(--line)]" : "bg-gray-800"}`}>
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${used}%` }} />
                      </div>
                      {resetSeconds !== null ? (
                        <p className={`mt-1 ${light ? "text-[var(--ink-muted)]" : "text-gray-600"}`}>Resets in {formatDuration(resetSeconds)}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
