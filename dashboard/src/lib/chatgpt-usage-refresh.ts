import { readUsageLimits, type UsageLimitsPayload } from "./usage-limits.ts";
import { readCodexUsageReport } from "./chatgpt-codex-usage.ts";

interface RefreshResult {
  status: number;
  payload: UsageLimitsPayload & { refreshed: boolean; refresh_error?: string };
}

/** Refreshing a meter must never generate a billable model request. */
export async function refreshChatgptUsage(baseURL: string): Promise<RefreshResult> {
  const report = await readCodexUsageReport(baseURL);
  if (report) return { status: 200, payload: { ...report, refreshed: true } };
  return {
    status: 502,
    payload: {
      ...readUsageLimits(), source: "headers", stale: true, refreshed: false,
      refresh_error: "Could not refresh usage limits. Showing the last reported usage.",
    },
  };
}
