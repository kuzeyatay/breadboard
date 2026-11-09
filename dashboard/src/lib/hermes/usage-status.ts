import { refreshChatgptUsage } from "../chatgpt-usage-refresh.ts";
import { notchRemaining, notchUsageRows } from "../usage-notch.ts";
import { usageLimitResetAt } from "../usage-limit-display.ts";

/** The same refresh and window labels as the notch, with explicit unknowns. */
export async function readCodexUsageStatus(baseURL: string) {
  const { payload } = await refreshChatgptUsage(baseURL);
  const now = Date.now();
  const captured = Date.parse(payload.captured_at ?? "");
  return {
    ...payload,
    provider: "chatgpt",
    checked_at: new Date(now).toISOString(),
    age_seconds: Number.isFinite(captured) ? Math.max(0, Math.floor((now - captured) / 1_000)) : null,
    windows: notchUsageRows("chatgpt", payload).map((row) => {
      const reset = usageLimitResetAt(payload.captured_at, row.limit);
      return {
        key: row.key,
        label: row.label,
        reported: row.used !== null,
        used_percent: row.used,
        remaining_percent: notchRemaining(row.used),
        window_minutes: row.limit.window_minutes ?? null,
        resets_at: reset !== null ? new Date(reset).toISOString() : null,
        resets_in_seconds: reset !== null ? Math.max(0, Math.ceil((reset - now) / 1_000)) : null,
      };
    }),
  };
}
