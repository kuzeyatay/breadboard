"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelFailoverNotice } from "@/app/components/use-assistant-intelligence";
import { assistantModelVendor, formatAssistantModelName } from "@/lib/ai-models";
import { providerUsageLink } from "@/lib/provider-usage";
import { usageLimitRowsWithFiveHour } from "@/lib/usage-limit-display";

interface UsageLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_in_seconds?: number;
}

interface UsageLimitsPayload {
  provider?: "chatgpt" | "google" | "anthropic";
  available?: boolean;
  captured_at?: string;
  file_updated_at?: string;
  age_seconds?: number;
  stale?: boolean;
  refreshed?: boolean;
  refresh_error?: string;
  error?: string;
  model?: string;
  primary?: UsageLimitWindow;
  secondary?: UsageLimitWindow;
  accounts?: Array<{
    account: string;
    limit: UsageLimitWindow;
  }>;
  limits?: Array<{
    key: string;
    label: string;
    limit: UsageLimitWindow;
  }>;
  usage_url?: string;
}

interface UsageLimitsPopoverProps {
  buttonClassName?: string;
  activeButtonClassName?: string;
  inactiveButtonClassName?: string;
  popoverClassName?: string;
  showIcon?: boolean;
  light?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showBackdrop?: boolean;
  /**
   * The model currently in use. ChatGPT windows come from rate-limit headers;
   * Google subscriptions are read from Antigravity's quota report; Claude
   * subscriptions use Anthropic's read-only utilization report.
   */
  activeModel?: string;
  modelFailover?: ModelFailoverNotice | null;
}

/** ChatGPT ids are bare; every other provider's are `provider/model`. */
function isChatgptModel(modelId: string | undefined): boolean {
  return typeof modelId === "string" && modelId.trim() !== "" && !modelId.includes("/");
}

function isGoogleSubscriptionModel(modelId: string | undefined): boolean {
  if (typeof modelId !== "string") return false;
  const normalized = modelId.trim();
  return (
    normalized.toLowerCase().startsWith("cliproxy/") &&
    assistantModelVendor(normalized).id === "google"
  );
}

function isClaudeSubscriptionModel(modelId: string | undefined): boolean {
  if (typeof modelId !== "string") return false;
  return /^cliproxy\/claude-[a-z0-9._-]+$/i.test(modelId.trim());
}

function providerLabel(modelId: string): string {
  const provider = modelId.split("/", 1)[0];
  if (provider === "cliproxy") return "your subscription";
  return provider;
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

/** "in about 5 days" / "in about 3h" — the exact second is noise here. */
function formatResetWindow(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const hours = Math.round(seconds / 3600);
  if (hours >= 48) return ` in about ${Math.round(hours / 24)} days`;
  if (hours >= 1) return ` in about ${hours}h`;
  return " in under an hour";
}

function formatUpdated(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function resetAtDate(
  capturedAt: string | undefined,
  window: UsageLimitWindow,
  now: number,
): Date | null {
  if (window.resets_in_seconds === undefined) return null;
  const capturedMs = capturedAt ? Date.parse(capturedAt) : Number.NaN;
  const base = Number.isFinite(capturedMs) ? capturedMs : now;
  return new Date(base + Number(window.resets_in_seconds) * 1000);
}

function formatResetAt(date: Date): string {
  return date.toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function UsageLimitMeter({
  label,
  windowData,
  reported,
  capturedAt,
  now,
  light,
}: {
  label: string;
  windowData: UsageLimitWindow;
  reported: boolean;
  capturedAt?: string;
  now: number;
  light: boolean;
}) {
  const used = clampPercent(windowData.used_percent);
  const left = Math.max(0, 100 - used);
  const resetSeconds = remainingResetSeconds(capturedAt, windowData, now);
  const resetAt = resetAtDate(capturedAt, windowData, now);
  const color =
    used >= 90 ? "bg-red-500" : used >= 60 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div>
      <div className={`mb-1 flex justify-between gap-3 ${light ? "text-[var(--ink-muted)]" : "text-gray-400"}`}>
        <span className="min-w-0 truncate" title={label}>{label}</span>
        <span className="shrink-0">
          {reported ? `${used.toFixed(1)}% used, ${left.toFixed(1)}% left` : "Not reported"}
        </span>
      </div>
      {reported ? (
        <div className={`neu-progress-track h-1.5 overflow-hidden rounded-full ${light ? "bg-[var(--line)]" : "bg-gray-800"}`}>
          <div className={`h-full rounded-full ${color}`} style={{ width: `${used}%` }} />
        </div>
      ) : (
        <p className={light ? "text-[var(--ink-muted)]" : "text-gray-600"}>
          The current usage snapshot did not include this window.
        </p>
      )}
      {reported && resetSeconds !== null ? (
        <p className={`mt-1 ${light ? "text-[var(--ink-muted)]" : "text-gray-600"}`}>
          Resets in {formatDuration(resetSeconds)}
          {resetAt ? ` · ${formatResetAt(resetAt)}` : ""}
        </p>
      ) : null}
    </div>
  );
}

export default function UsageLimitsPopover({
  buttonClassName = "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors",
  activeButtonClassName = "border-blue-800/60 bg-blue-950/30 text-blue-400",
  inactiveButtonClassName = "border-transparent text-gray-600 hover:bg-gray-800 hover:text-gray-300",
  popoverClassName = "neu-popover absolute bottom-full right-0 z-20 mb-1.5 w-72 rounded-xl border border-gray-700 bg-gray-900 p-4 text-xs",
  showIcon = true,
  light = false,
  open: controlledOpen,
  onOpenChange,
  showBackdrop = true,
  activeModel,
  modelFailover,
}: UsageLimitsPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [usageData, setUsageData] = useState<UsageLimitsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Show the notice only while its exact Gemini model remains selected. The
  // preferred-model check avoids a stale health poll flashing the old warning
  // after the reader switches models.
  const visibleFailover =
    modelFailover?.usingFallback &&
    activeModel &&
    assistantModelVendor(activeModel).id === "google" &&
    modelFailover.preferredModel === activeModel
      ? modelFailover
      : null;
  const effectiveModel = visibleFailover?.servingModel ?? activeModel;
  const googleUsageActive = isGoogleSubscriptionModel(activeModel);
  const claudeUsageActive = isClaudeSubscriptionModel(activeModel);
  const externalUsage =
    visibleFailover || claudeUsageActive ? null : providerUsageLink(activeModel);
  const effectiveExternalUsage = providerUsageLink(effectiveModel);

  const setOpen = useCallback((next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  const refreshUsage = useCallback(async (quiet = false, probe = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ ts: String(Date.now()) });
      if (activeModel) query.set("model", activeModel);
      // A ChatGPT refresh needs a tiny probe request so fresh limit headers
      // exist. Google and Anthropic expose read-only usage calls of their own.
      const useProbe = probe && !googleUsageActive && !claudeUsageActive;
      const response = await fetch(`/api/usage-limits?${query.toString()}`, {
        method: useProbe ? "POST" : "GET",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const data = (await response.json().catch(() => ({}))) as UsageLimitsPayload;
      setUsageData(data);
      if (!response.ok) {
        throw new Error(
          data.refresh_error || data.error || (useProbe ? "Could not refresh usage limits" : "Could not load usage limits"),
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
  }, [activeModel, googleUsageActive, claudeUsageActive]);

  useEffect(() => {
    if (!open) return;
    // Only providers with an embedded live limit snapshot are polled here.
    if (
      activeModel &&
      !isChatgptModel(activeModel) &&
      !googleUsageActive &&
      !claudeUsageActive
    ) return;
    void refreshUsage(false);
    const id = window.setInterval(() => {
      setNow(Date.now());
      void refreshUsage(true);
    }, 30000);
    return () => window.clearInterval(id);
  }, [open, refreshUsage, activeModel, googleUsageActive, claudeUsageActive]);

  const updatedAt = formatUpdated(usageData?.captured_at);
  const limitRows =
    usageData?.available &&
    usageData.provider !== "google" &&
    usageData.provider !== "anthropic"
      ? usageLimitRowsWithFiveHour(usageData)
      : [];
  const googleAccounts = usageData?.provider === "google" ? usageData.accounts ?? [] : [];
  const claudeLimits = usageData?.provider === "anthropic" ? usageData.limits ?? [] : [];
  const googleModelLabel = formatAssistantModelName(usageData?.model ?? activeModel ?? "Google");
  const triggerClassName = [
    buttonClassName,
    open && !externalUsage ? activeButtonClassName : inactiveButtonClassName,
  ].join(" ");
  const triggerContent = (
    <>
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
      {externalUsage?.label ?? "Usage"}
    </>
  );

  return (
    <div className="relative">
      {externalUsage ? (
        <a
          href={externalUsage.href}
          target="_blank"
          rel="noreferrer"
          onClick={() => setOpen(false)}
          title={externalUsage.title}
          className={triggerClassName}
        >
          {triggerContent}
        </a>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title="View usage limits"
          aria-expanded={open}
          className={triggerClassName}
        >
          {triggerContent}
        </button>
      )}
      {open && !externalUsage ? (
        <>
          {showBackdrop ? (
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          ) : null}
          <div className={popoverClassName}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className={`font-medium ${light ? "text-[var(--ink-heading)]" : "text-gray-300"}`}>Usage Limits</p>
              {!activeModel ||
              isChatgptModel(activeModel) ||
              googleUsageActive ||
              claudeUsageActive ? (
                <button
                  type="button"
                  onClick={() => void refreshUsage(false, true)}
                  disabled={loading}
                  title="Refresh the usage-limit snapshot"
                  className={`neu-button rounded-md border px-2 py-1 text-[11px] transition disabled:cursor-wait disabled:opacity-50 ${light ? "border-[var(--line)] text-[var(--ink-muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]" : "border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-300"}`}
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
              ) : null}
            </div>
            {visibleFailover ? (
              <div className={`mb-3 rounded-xl border px-3 py-2.5 ${light ? "border-[var(--line-strong)] bg-[var(--paper-strong)]" : "border-amber-800/50 bg-amber-950/20"}`}>
                <p className={`font-medium ${light ? "text-[var(--ink-heading)]" : "text-amber-200"}`}>
                  {formatAssistantModelName(visibleFailover.preferredModel)} is out of quota
                </p>
                <p className={`mt-1 leading-4 ${light ? "text-[var(--ink-muted)]" : "text-gray-400"}`}>
                  Using {formatAssistantModelName(visibleFailover.servingModel)} until it
                  resets{formatResetWindow(visibleFailover.resetsInSeconds)}.
                </p>
              </div>
            ) : null}
            {/*
              ChatGPT, Google, and Anthropic each provide their own live
              snapshot. For any other provider, say so plainly instead of
              presenting the wrong provider's budget.
            */}
            {effectiveModel &&
            !isChatgptModel(effectiveModel) &&
            !googleUsageActive &&
            !claudeUsageActive ? (
              <div className="space-y-2">
                <p className={light ? "text-[var(--ink-muted)]" : "text-gray-400"}>
                  These limits track your <span className="font-medium">ChatGPT</span> plan.
                </p>
                <p className={light ? "text-[var(--ink-muted)]" : "text-gray-500"}>
                  The active model runs on {providerLabel(effectiveModel)}, which meters usage on
                  its own side — Breadboard has no counter for it.
                </p>
                <p className={`font-mono ${light ? "text-[var(--ink-muted)]" : "text-gray-600"}`}>
                  {effectiveModel}
                </p>
                {effectiveExternalUsage ? (
                  <a
                    href={effectiveExternalUsage.href}
                    target="_blank"
                    rel="noreferrer"
                    className={light ? "text-[var(--botanical)] underline underline-offset-2" : "text-blue-300 underline underline-offset-2"}
                  >
                    Open live provider usage
                  </a>
                ) : null}
              </div>
            ) : loading ? (
              <p className="text-gray-500">Loading...</p>
            ) : error ? (
              <div className="space-y-2">
                <p className={light ? "text-[var(--danger)]" : "text-red-300"}>{error}</p>
                {claudeUsageActive && effectiveExternalUsage ? (
                  <a
                    href={effectiveExternalUsage.href}
                    target="_blank"
                    rel="noreferrer"
                    className={light ? "text-[var(--botanical)] underline underline-offset-2" : "text-blue-300 underline underline-offset-2"}
                  >
                    Open Claude usage
                  </a>
                ) : null}
              </div>
            ) : !usageData?.available ? (
              <p className={light ? "text-[var(--ink-muted)]" : "text-gray-500"}>
                {usageData?.error ?? "No data yet. Send a message first."}
              </p>
            ) : usageData.provider === "google" ? (
              <div className="space-y-3">
                {updatedAt ? (
                  <p className={light ? "text-[var(--ink-muted)]" : "text-gray-600"}>
                    Updated: {updatedAt}
                  </p>
                ) : null}
                {googleAccounts.map((account, index) => (
                  <UsageLimitMeter
                    key={`${account.account}-${index}`}
                    label={googleAccounts.length === 1 ? `${googleModelLabel} limit` : account.account}
                    windowData={account.limit}
                    reported
                    capturedAt={usageData.captured_at}
                    now={now}
                    light={light}
                  />
                ))}
                <p className={light ? "text-[var(--ink-muted)]" : "text-gray-600"}>
                  Google-reported model quota. Short-term throttles may be separate.
                </p>
              </div>
            ) : usageData.provider === "anthropic" ? (
              <div className="space-y-3">
                {updatedAt ? (
                  <p className={light ? "text-[var(--ink-muted)]" : "text-gray-600"}>
                    Updated: {updatedAt}
                  </p>
                ) : null}
                {claudeLimits.map(({ key, label, limit }) => (
                  <UsageLimitMeter
                    key={key}
                    label={label}
                    windowData={limit}
                    reported
                    capturedAt={usageData.captured_at}
                    now={now}
                    light={light}
                  />
                ))}
                <p className={light ? "text-[var(--ink-muted)]" : "text-gray-600"}>
                  Anthropic-reported subscription usage.
                  {usageData.usage_url ? (
                    <>
                      {" "}
                      <a
                        href={usageData.usage_url}
                        target="_blank"
                        rel="noreferrer"
                        className={light ? "text-[var(--botanical)] underline underline-offset-2" : "text-blue-300 underline underline-offset-2"}
                      >
                        View details
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
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
                {limitRows.length === 0 ? (
                  <p className={light ? "text-[var(--ink-muted)]" : "text-gray-500"}>
                    No usage windows reported yet.
                  </p>
                ) : null}
                {limitRows.map(({ key, label, window: windowData, reported }) => (
                  <UsageLimitMeter
                    key={key}
                    label={label}
                    windowData={windowData}
                    reported={reported}
                    capturedAt={usageData.captured_at}
                    now={now}
                    light={light}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
