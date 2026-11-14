import { refreshChatgptUsage } from "../chatgpt-usage-refresh.ts";
import { readClaudeUsageLimits } from "../claude-usage-limits.ts";
import { notchRemaining, notchUsageRows } from "../usage-notch.ts";
import { usageLimitResetAt } from "../usage-limit-display.ts";

/**
 * The Claude Code subscription windows, in the same window shape as the
 * ChatGPT meter below. Any Claude Code model id reads the one shared report.
 */
export async function readClaudeUsageStatus(read = readClaudeUsageLimits) {
  try {
    const payload = await read("cliproxy/claude-sonnet-5");
    const now = Date.now();
    const captured = Date.parse(payload.captured_at ?? "");
    return {
      provider: "anthropic" as const,
      available: payload.available,
      captured_at: payload.captured_at,
      age_seconds: Number.isFinite(captured)
        ? Math.max(0, Math.floor((now - captured) / 1_000))
        : null,
      ...(payload.stale ? { stale: true } : {}),
      ...(payload.error ? { error: payload.error } : {}),
      ...(payload.refresh_error ? { refresh_error: payload.refresh_error } : {}),
      ...(payload.auth_required ? { auth_required: true } : {}),
      windows: payload.limits.map((row) => {
        const reset =
          row.limit.resets_in_seconds !== undefined && Number.isFinite(captured)
            ? captured + row.limit.resets_in_seconds * 1_000
            : null;
        return {
          key: row.key,
          label: row.label,
          reported: true,
          used_percent: row.limit.used_percent,
          remaining_percent: notchRemaining(row.limit.used_percent),
          window_minutes: row.key === "five_hour" ? 300 : 10_080,
          resets_at: reset !== null ? new Date(reset).toISOString() : null,
          resets_in_seconds: reset !== null ? Math.max(0, Math.ceil((reset - now) / 1_000)) : null,
        };
      }),
    };
  } catch (error) {
    // Most commonly "Claude Code is not signed in." — report it, never throw
    // past the ChatGPT meter.
    return {
      provider: "anthropic" as const,
      available: false,
      windows: [],
      error: error instanceof Error ? error.message : "Claude usage could not be read.",
    };
  }
}

/** The same refresh and window labels as the notch, with explicit unknowns. */
export async function readCodexUsageStatus(baseURL: string) {
  const [{ payload }, claude] = await Promise.all([
    refreshChatgptUsage(baseURL),
    readClaudeUsageStatus(),
  ]);
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
    claude,
  };
}
