import {
  usageLimitRowsWithFiveHour,
  usageReserveModelLabel,
  usageReserveRows,
  type DisplayUsageLimitReserve,
  type DisplayUsageLimitWindow,
} from "./usage-limit-display.ts";

export type NotchProviderId = "anthropic" | "chatgpt" | "google";
export interface NotchProvider { id: NotchProviderId; label: string; models: string[] }
export interface NotchUsagePayload {
  provider?: NotchProviderId;
  available?: boolean;
  captured_at?: string;
  stale?: boolean;
  error?: string;
  refresh_error?: string;
  retry_at?: string;
  recovery_required?: boolean;
  auth_required?: boolean;
  primary?: DisplayUsageLimitWindow;
  secondary?: DisplayUsageLimitWindow;
  source?: "headers" | "report";
  account?: string;
  plan?: string;
  reserve?: DisplayUsageLimitReserve | null;
  limits?: { key: string; label: string; limit: DisplayUsageLimitWindow }[];
  accounts?: { account: string; limit: DisplayUsageLimitWindow }[];
}
export interface NotchUsageRow { key: string; label: string; limit: DisplayUsageLimitWindow; used: number | null }

/** Include live subscriptions even while the Intelligence catalog is awaiting sync. */
export function notchProviders(modelIds: string[], subscriptionModelIds: string[] = []): NotchProvider[] {
  const groups: NotchProvider[] = [
    { id: "anthropic", label: "Claude", models: [] },
    { id: "chatgpt", label: "ChatGPT", models: [] },
    { id: "google", label: "Gemini", models: [] },
  ];
  const subscriptions = subscriptionModelIds.map((model) => `cliproxy/${model}`);
  for (const model of new Set([...modelIds, ...subscriptions])) {
    const id = /^cliproxy\/claude-[a-z0-9._-]+$/i.test(model) ? "anthropic"
      : /^cliproxy\/(gemini|gemma)[a-z0-9._-]*$/i.test(model) ? "google"
      : model && !model.includes("/") && model !== "default" ? "chatgpt" : null;
    if (id) groups.find((group) => group.id === id)!.models.push(model);
  }
  return groups.filter((group) => group.models.length > 0);
}

export function notchPercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

export function notchRemaining(used: unknown): number | null {
  const percent = notchPercent(used);
  return percent === null ? null : 100 - percent;
}

export function notchUsageRows(provider: NotchProviderId, data?: NotchUsagePayload): NotchUsageRow[] {
  if (!data?.available || (data.provider && data.provider !== provider)) return [];
  if (provider === "anthropic") return (data.limits ?? []).map((row) => ({
    ...row, label: row.key === "seven_day" ? "All models" : row.label, used: notchPercent(row.limit.used_percent),
  })).sort((a, b) => Number(b.key === "five_hour") - Number(a.key === "five_hour"));
  if (provider === "google") return (data.accounts ?? []).map((row, index) => ({
    key: `${row.account}-${index}`, label: data.accounts?.length === 1 ? "Model quota" : row.account,
    limit: row.limit, used: notchPercent(row.limit.used_percent),
  }));
  return [...usageLimitRowsWithFiveHour(data), ...(data.source === "report" ? usageReserveRows(data) : [])].map((row) => ({
    key: row.key, label: row.window.window_minutes === 300 ? "Current session" : row.label,
    limit: row.window, used: row.reported ? notchPercent(row.window.used_percent) : null,
  }));
}

/**
 * One line for the card when OpenAI has moved the account onto its reserve
 * pool: the ring then shows the reserve, and this says why the plan reads 0%.
 */
export function notchReserveCopy(data?: NotchUsagePayload): string | null {
  const reserve = data?.reserve;
  if (!data?.available || !reserve?.active) return null;
  return `Plan limit reached — ChatGPT is answering with ${usageReserveModelLabel(reserve.model)} from its reserve pool. Ring shows the reserve.`;
}

/**
 * Prefer current-session usage; ChatGPT can report only a weekly allowance.
 * While the plan is spent and the reserve is serving, the reserve is the
 * allowance actually being drawn on, so the ring follows it.
 */
export function notchHeadlineRow(provider: NotchProviderId, rows: NotchUsageRow[], data?: NotchUsagePayload): NotchUsageRow | undefined {
  const reported = rows.filter((row) => row.used !== null);
  if (provider === "anthropic") return reported.find((row) => row.key === "five_hour");
  if (provider === "chatgpt") return (data?.reserve?.active ? reported.find((row) => row.key === "reserve") : undefined)
    ?? reported.find((row) => row.limit.window_minutes === 300)
    ?? reported.find((row) => row.limit.window_minutes === 10080);
  // Each Google account is a separate quota; the ring shows the most-used one.
  return reported.sort((a, b) => b.used! - a.used!)[0];
}

export function notchHeadline(provider: NotchProviderId, rows: NotchUsageRow[]): number | null {
  return notchHeadlineRow(provider, rows)?.used ?? null;
}

/** Codenotch's screenshot uses green <50%, yellow <70%, then orange. */
export function notchColor(used: number | null): string {
  return used === null ? "#808080" : used >= 70 ? "#ff3f00" : used >= 50 ? "#f2ff00" : "#00ff88";
}

export function notchResetCopy(capturedAt: string | undefined, limit: DisplayUsageLimitWindow, now: number): string {
  const captured = Date.parse(capturedAt ?? "");
  if (!Number.isFinite(captured) || typeof limit.resets_in_seconds !== "number" || !Number.isFinite(limit.resets_in_seconds)) return "Reset not reported";
  const reset = captured + Math.max(0, limit.resets_in_seconds) * 1000;
  const minutes = Math.ceil((reset - now) / 60000);
  if (minutes <= 0) return "Reset due";
  if (minutes < 60) return `Resets in ${minutes} min`;
  if (minutes < 24 * 60) return `Resets in ${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `Resets ${new Date(reset).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}
