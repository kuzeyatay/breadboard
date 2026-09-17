import { readUsageLimits, type UsageLimitsPayload } from "./usage-limits.ts";
import { buildUsageRefreshRequest } from "./usage-refresh.ts";

interface RefreshResult {
  status: number;
  payload: UsageLimitsPayload & { refreshed: boolean; refresh_error?: string };
}

interface RefreshEntry {
  pending: Promise<RefreshResult>;
  expiresAt: number;
}

const shared = globalThis as typeof globalThis & {
  __breadboardChatgptUsageRefresh?: Map<string, RefreshEntry>;
};
const refreshes = shared.__breadboardChatgptUsageRefresh ??= new Map<string, RefreshEntry>();

/** Coalesce tab-opening bursts, including Strict Mode remounts, into one probe. */
export async function refreshChatgptUsage(baseURL: string, userId: number): Promise<RefreshResult> {
  const key = JSON.stringify([baseURL, userId]);
  const now = Date.now();
  for (const [key, entry] of refreshes) {
    if (entry.expiresAt <= now) refreshes.delete(key);
  }
  const existing = refreshes.get(key);
  if (existing) return existing.pending;

  const entry: RefreshEntry = { pending: probeUsage(baseURL), expiresAt: Infinity };
  refreshes.set(key, entry);
  try {
    const result = await entry.pending;
    entry.expiresAt = Date.now() + (result.status === 200 ? 10_000 : 60_000);
    return result;
  } catch (error) {
    refreshes.delete(key);
    throw error;
  }
}

async function probeUsage(baseURL: string): Promise<RefreshResult> {
  try {
    const before = readUsageLimits();
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildUsageRefreshRequest()),
      signal: AbortSignal.timeout(30_000),
    });
    // ChatMock captures headers even if the completion itself is rate-limited.
    await response.text().catch(() => "");
    const latest = readUsageLimits();
    if (latest.captured_at && latest.captured_at !== before.captured_at) {
      return { status: 200, payload: { ...latest, refreshed: true } };
    }
    return {
      status: 502,
      payload: {
        ...latest, refreshed: false,
        refresh_error: response.ok
          ? "The refresh completed but did not report updated usage limits."
          : `Could not refresh usage limits (HTTP ${response.status}).`,
      },
    };
  } catch (error) {
    return {
      status: 502,
      payload: {
        ...readUsageLimits(), refreshed: false,
        refresh_error: error instanceof Error && error.name === "TimeoutError"
          ? "The usage refresh timed out." : "Could not refresh usage limits.",
      },
    };
  }
}
