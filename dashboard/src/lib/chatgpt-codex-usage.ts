import type { UsageLimitReserve, UsageLimitWindow, UsageLimitsPayload } from "./usage-limits.ts";

/**
 * OpenAI's own usage report for the chosen ChatGPT account, read through
 * ChatMock (`GET /v1/settings/usage`). Unlike the header snapshot in
 * `usage-limits.ts` it is per account, costs no quota, and says when a spent
 * plan has been moved onto the Luna reserve — which is the one thing the
 * person asking "am I on reserve?" needs to see.
 */

interface ReportEntry {
  pending: Promise<UsageLimitsPayload | null>;
  expiresAt: number;
}

const shared = globalThis as typeof globalThis & {
  __breadboardCodexUsageReports?: Map<string, ReportEntry>;
};
const reports = shared.__breadboardCodexUsageReports ??= new Map<string, ReportEntry>();

/** A fresh read at most this often; the popover and the notch both poll. */
const REPORT_CACHE_MS = 10_000;
const FAILURE_CACHE_MS = 30_000;

function numberFrom(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function windowFrom(value: unknown): UsageLimitWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const used = numberFrom(record.used_percent);
  if (used === undefined) return undefined;
  const window: UsageLimitWindow = { used_percent: Math.min(100, Math.max(0, used)) };
  const minutes = numberFrom(record.window_minutes);
  const resets = numberFrom(record.resets_in_seconds);
  if (minutes !== undefined) window.window_minutes = Math.trunc(minutes);
  if (resets !== undefined) window.resets_in_seconds = Math.trunc(resets);
  return window;
}

function reserveFrom(value: unknown): UsageLimitReserve | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const primary = windowFrom(record.primary);
  const secondary = windowFrom(record.secondary);
  return {
    model: typeof record.model === "string" && record.model.trim() ? record.model.trim() : null,
    active: record.active === true,
    limit_reached: record.limit_reached === true,
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
  };
}

/** Shape ChatMock's report into the payload the usage surfaces already draw. */
export function codexUsagePayload(raw: unknown, now = new Date()): UsageLimitsPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const capturedAt = typeof record.captured_at === "string" && record.captured_at.trim()
    ? record.captured_at.trim() : undefined;
  const primary = windowFrom(record.primary);
  const secondary = windowFrom(record.secondary);
  if (!capturedAt || (!primary && !secondary)) return null;
  const capturedMs = Date.parse(capturedAt);
  const ageSeconds = Number.isFinite(capturedMs)
    ? Math.max(0, Math.floor((now.getTime() - capturedMs) / 1000)) : undefined;
  const banner = record.banner && typeof record.banner === "object"
    ? (record.banner as Record<string, unknown>) : null;
  return {
    available: true,
    source: "report",
    captured_at: capturedAt,
    age_seconds: ageSeconds,
    stale: false,
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    account: typeof record.account === "string" ? record.account : undefined,
    plan: typeof record.plan === "string" ? record.plan : undefined,
    limit_reached: record.limit_reached === true,
    reserve: reserveFrom(record.reserve),
    banner: banner && typeof banner.type === "string"
      ? {
          type: banner.type,
          title: typeof banner.title === "string" ? banner.title : null,
          description: typeof banner.description === "string" ? banner.description : null,
        }
      : null,
  };
}

async function fetchReport(baseURL: string): Promise<UsageLimitsPayload | null> {
  try {
    const response = await fetch(`${baseURL}/settings/usage`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return null;
    return codexUsagePayload(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

/**
 * The report for ChatMock's primary account, or null when it cannot be read —
 * the caller then falls back to the header snapshot. Concurrent readers share
 * one request and a short cache so a burst of tabs does not fan out upstream.
 */
export async function readCodexUsageReport(baseURL: string): Promise<UsageLimitsPayload | null> {
  const now = Date.now();
  for (const [key, entry] of reports) {
    if (entry.expiresAt <= now) reports.delete(key);
  }
  const existing = reports.get(baseURL);
  if (existing) return existing.pending;
  const entry: ReportEntry = { pending: fetchReport(baseURL), expiresAt: Infinity };
  reports.set(baseURL, entry);
  try {
    const result = await entry.pending;
    entry.expiresAt = Date.now() + (result ? REPORT_CACHE_MS : FAILURE_CACHE_MS);
    return result;
  } catch (error) {
    reports.delete(baseURL);
    throw error;
  }
}
