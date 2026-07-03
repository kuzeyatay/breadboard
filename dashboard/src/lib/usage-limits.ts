import fs from "fs";
import os from "os";
import path from "path";

export interface UsageLimitWindow {
  used_percent: number;
  window_minutes?: number;
  resets_in_seconds?: number;
}

export interface UsageLimitsPayload {
  available: boolean;
  captured_at?: string;
  file_updated_at?: string;
  age_seconds?: number;
  stale?: boolean;
  primary?: UsageLimitWindow;
  secondary?: UsageLimitWindow;
}

const STALE_AFTER_SECONDS = 15 * 60;

function trimEnv(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function candidateUsageLimitPaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): { explicitPath: string | null; candidates: string[] } {
  const explicitPath = trimEnv(env.CHATMOCK_USAGE_LIMITS_PATH);
  const homeCandidates = [
    trimEnv(env.CHATMOCK_USAGE_HOME),
    trimEnv(env.CHATGPT_LOCAL_HOME),
    trimEnv(env.CODEX_HOME),
    path.join(homeDir, ".chatgpt-local"),
    path.join(homeDir, ".codex"),
  ].filter((value): value is string => Boolean(value));

  const candidates = [
    ...(explicitPath ? [explicitPath] : []),
    ...homeCandidates.map((home) => path.join(home, "usage_limits.json")),
  ];

  return {
    explicitPath,
    candidates: Array.from(new Set(candidates)),
  };
}

function fileMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

export function resolveUsageLimitsPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): string | null {
  const { explicitPath, candidates } = candidateUsageLimitPaths(env, homeDir);
  if (explicitPath) return explicitPath;

  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  if (existing.length === 0) return candidates[0] ?? null;

  return existing.sort((a, b) => fileMtimeMs(b) - fileMtimeMs(a))[0] ?? null;
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalIntFrom(value: unknown): number | undefined {
  const parsed = numberFrom(value);
  if (parsed === null) return undefined;
  return Math.trunc(parsed);
}

function windowFrom(value: unknown): UsageLimitWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const used = numberFrom(record.used_percent);
  if (used === null) return undefined;

  const window: UsageLimitWindow = {
    used_percent: Math.min(100, Math.max(0, used)),
  };
  const windowMinutes = optionalIntFrom(record.window_minutes);
  const resetsInSeconds = optionalIntFrom(record.resets_in_seconds);
  if (windowMinutes !== undefined) window.window_minutes = windowMinutes;
  if (resetsInSeconds !== undefined) window.resets_in_seconds = resetsInSeconds;
  return window;
}

function isoFromMtime(filePath: string): string | undefined {
  try {
    return new Date(fs.statSync(filePath).mtimeMs).toISOString();
  } catch {
    return undefined;
  }
}

export function readUsageLimits(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
  now = new Date(),
): UsageLimitsPayload {
  const filePath = resolveUsageLimitsPath(env, homeDir);
  if (!filePath) return { available: false };

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return { available: false, file_updated_at: isoFromMtime(filePath) };
  }

  if (!raw || typeof raw !== "object") {
    return { available: false, file_updated_at: isoFromMtime(filePath) };
  }

  const record = raw as Record<string, unknown>;
  const capturedAt =
    typeof record.captured_at === "string" && record.captured_at.trim()
      ? record.captured_at.trim()
      : undefined;
  const primary = windowFrom(record.primary);
  const secondary = windowFrom(record.secondary);
  if (!capturedAt || (!primary && !secondary)) {
    return { available: false, file_updated_at: isoFromMtime(filePath) };
  }

  const capturedMs = Date.parse(capturedAt);
  const ageSeconds = Number.isFinite(capturedMs)
    ? Math.max(0, Math.floor((now.getTime() - capturedMs) / 1000))
    : undefined;

  return {
    available: true,
    captured_at: capturedAt,
    file_updated_at: isoFromMtime(filePath),
    age_seconds: ageSeconds,
    stale: ageSeconds === undefined ? undefined : ageSeconds > STALE_AFTER_SECONDS,
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
  };
}
