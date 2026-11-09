"use client";

import { RefreshCw } from "lucide-react";
import { useProviderUsage } from "@/app/new-tab/use-provider-usage";
import { formatAssistantModelName } from "@/lib/ai-models";
import {
  notchResetCopy,
  notchUsageRows,
  type NotchProviderId,
  type NotchUsagePayload,
  type NotchUsageRow,
} from "@/lib/usage-notch";

const percent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function planRows(provider: NotchProviderId, data?: NotchUsagePayload): NotchUsageRow[] {
  return notchUsageRows(provider, data)
    // The notch adds an unreported 5-hour placeholder and reserve pools. This
    // group describes the plan's actual windows, so neither belongs here.
    .filter((row) => provider !== "chatgpt" || row.key === "primary" || row.key === "secondary")
    .map((row) => ({
      ...row,
      label: row.key === "seven_day" || row.limit.window_minutes === 10_080
        ? "Weekly limit"
        : row.key === "five_hour" || row.limit.window_minutes === 300
          ? "5-hour limit"
          : row.label,
    }))
    .sort((left, right) => Number(right.label === "Weekly limit") - Number(left.label === "Weekly limit"));
}

function UsageWindow({ row, provider, capturedAt, now }: {
  row: NotchUsageRow;
  provider: string;
  capturedAt?: string;
  now: number;
}) {
  const used = row.used;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate text-gray-300" title={row.label}>{row.label}</span>
        <span className="shrink-0 font-semibold tabular-nums text-white">
          {used === null ? "Not reported" : `${percent.format(used)}% used`}
        </span>
      </div>
      {used !== null && (
        <div
          role="meter"
          aria-label={`${provider} ${row.label}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={used}
          aria-valuetext={`${percent.format(used)}% used`}
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-800/70"
        >
          <div
            className={`h-full rounded-full ${used >= 90 ? "bg-[var(--danger)]" : used >= 70 ? "bg-amber-500" : "bg-[var(--botanical)]"}`}
            style={{ width: `${used}%` }}
          />
        </div>
      )}
      <p className="mt-1 text-[11px] text-gray-500">
        {notchResetCopy(capturedAt, row.limit, now)}
      </p>
    </div>
  );
}

export default function PlanUsagePanel() {
  const usage = useProviderUsage();

  return (
    <section aria-label="Plan usage" className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">Plan usage</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Subscription limits for accounts connected to Breadboard. Includes usage outside Breadboard.
        </p>
      </header>

      <div className="space-y-5">
        {usage.providers.map((provider) => {
          const model = provider.models.includes(usage.selection[provider.id])
            ? usage.selection[provider.id]
            : provider.models[0];
          const reading = usage.readings[model];
          const rows = planRows(provider.id, reading?.data);
          const loading = !reading || reading.loading;
          const stale = Boolean(reading?.data?.stale || (reading?.error && rows.length));
          const retryAt = Date.parse(reading?.data?.retry_at ?? "");
          const coolingDown = Number.isFinite(retryAt) && retryAt > usage.now;
          const updatedAt = Date.parse(reading?.data?.captured_at ?? "");

          return (
            <div key={provider.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-white">{provider.label}</h3>
                  {reading?.data?.account && (
                    <p className="mt-0.5 truncate text-[11px] text-gray-500" title={reading.data.account}>
                      {reading.data.account}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Refresh ${provider.label} plan usage`}
                  disabled={loading || coolingDown}
                  onClick={() => void usage.refresh(provider, model)}
                  className="neu-button flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-400 transition-colors hover:text-white disabled:opacity-50"
                >
                  <RefreshCw size={12} aria-hidden="true" />
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {provider.id === "google" && (
                <select
                  aria-label="Gemini quota model"
                  value={model}
                  onChange={(event) => usage.setSelection((current) => ({ ...current, google: event.target.value }))}
                  className="w-full min-w-0 rounded-lg border border-gray-800 bg-[var(--paper-bg)] px-2 py-1.5 text-xs text-gray-300"
                >
                  {provider.models.map((id) => <option key={id} value={id}>{formatAssistantModelName(id)}</option>)}
                </select>
              )}

              {rows.map((row) => (
                <UsageWindow key={row.key} row={row} provider={provider.label} capturedAt={reading?.data?.captured_at} now={usage.now} />
              ))}

              {!rows.length && (
                <p className="text-xs text-gray-500" role="status">
                  {loading ? "Reading plan usage…" : reading?.error ?? "No usage limits reported yet."}
                </p>
              )}
              {rows.length > 0 && provider.id !== "google" && !rows.some((row) => row.label === "Weekly limit") && (
                <p className="text-[11px] text-gray-500">Weekly limit not reported.</p>
              )}
              {stale && (
                <p className="text-[11px] text-gray-500" role="status">
                  Last reported usage. {reading?.error ?? "Waiting for an updated report."}
                </p>
              )}
              {coolingDown && (
                <p className="text-[11px] text-gray-500">
                  Retrying after {new Date(retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
                </p>
              )}
              {Number.isFinite(updatedAt) && rows.length > 0 && (
                <p className="text-[11px] text-gray-500">
                  Updated {new Date(updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {!usage.providers.length && (
        <div className="space-y-2 text-xs text-gray-500" role="status">
          <p>{usage.catalogError ?? (usage.catalogReady
            ? "No subscriptions with usage reports are connected."
            : "Reading connected subscriptions…")}</p>
          {usage.catalogReady && (
            <button type="button" onClick={() => void usage.loadCatalog()} className="text-[var(--botanical)] hover:underline">
              Try again
            </button>
          )}
        </div>
      )}
    </section>
  );
}
