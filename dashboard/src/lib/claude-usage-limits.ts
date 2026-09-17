import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const REQUEST_TIMEOUT_MS = 20_000;
const REFRESH_INTERVAL_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const SESSION_RECOVERY_INTERVAL_MS = 15 * 60_000;

export const CLAUDE_USAGE_PAGE = "https://claude.ai/settings/usage";

export interface ClaudeUsageLimitWindow {
  used_percent: number;
  resets_in_seconds?: number;
}

export interface ClaudeUsageLimitRow {
  key: "five_hour" | "seven_day";
  label: string;
  limit: ClaudeUsageLimitWindow;
}

export interface ClaudeUsageLimitsPayload {
  provider: "anthropic";
  available: boolean;
  captured_at: string;
  model: string;
  limits: ClaudeUsageLimitRow[];
  usage_url: string;
  error?: string;
  stale?: boolean;
  refresh_error?: string;
  retry_at?: string;
  recovery_required?: boolean;
  auth_required?: boolean;
}

interface ClaudeUsageCache {
  credentialKey: string;
  restored?: boolean;
  snapshot?: ClaudeUsageLimitsPayload;
  pending?: Promise<void>;
  nextAttemptAt: number;
  rateLimits: number;
  error?: string;
  recoveryReason?: "credential" | "inactive";
  nextRecoveryAt?: number;
  authRequired?: boolean;
}

// One subscription report serves all Claude models and all dashboard tabs.
// Keep it through development module reloads; never expose the credential key.
const shared = globalThis as typeof globalThis & { __breadboardClaudeUsage?: ClaudeUsageCache };

function retryDelay(header: string | null, attempt: number, now: number): number {
  const seconds = header?.trim() ? Number(header) : NaN;
  const hinted = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header ?? "") - now;
  const backoff = Math.min(MAX_BACKOFF_MS, REFRESH_INTERVAL_MS * 2 ** Math.min(attempt, 4));
  // Retry-After: 0 is not permission to hammer the endpoint. Longer server
  // cooldowns are honored even when they exceed our exponential-backoff cap.
  return Math.max(backoff, Number.isFinite(hinted) ? hinted : 0);
}

function cachedUsage(state: ClaudeUsageCache, model: string, now: Date): ClaudeUsageLimitsPayload {
  const snapshot = state.snapshot ?? {
    provider: "anthropic" as const, available: false, captured_at: now.toISOString(),
    model, limits: [], usage_url: CLAUDE_USAGE_PAGE,
  };
  const recovery = state.recoveryReason && now.getTime() >= (state.nextRecoveryAt ?? 0)
    ? { recovery_required: true } : {};
  if (!state.error) return { ...snapshot, model, ...recovery };
  const retryAt = new Date(state.nextAttemptAt).toISOString();
  return {
    ...snapshot, model, ...recovery,
    ...(state.authRequired ? { auth_required: true } : {}),
    ...(!recovery.recovery_required ? { retry_at: retryAt } : {}),
    ...(snapshot.available ? { stale: true, refresh_error: state.error } : { error: state.error }),
  };
}

interface ClaudeCredentialFile {
  claudeAiOauth?: {
    accessToken?: unknown;
    expiresAt?: unknown;
    refreshToken?: unknown;
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The upstream model id behind a Claude Code `cliproxy/<model>` id. */
export function claudeSubscriptionModelId(modelId: string): string | null {
  const normalized = modelId.trim();
  if (!normalized.toLowerCase().startsWith("cliproxy/")) return null;
  const bare = normalized.slice(normalized.indexOf("/") + 1).trim();
  return /^claude-[a-z0-9._-]+$/i.test(bare) ? bare : null;
}

function usageWindow(
  payload: unknown,
  key: ClaudeUsageLimitRow["key"],
  label: string,
  capturedAt: Date,
): ClaudeUsageLimitRow | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = (payload as Record<string, unknown>)[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const utilization = finiteNumber(
    (raw as { utilization?: unknown }).utilization,
  );
  if (utilization === null) return null;

  const limit: ClaudeUsageLimitWindow = {
    used_percent: Math.min(100, Math.max(0, utilization)),
  };
  const resetsAt = text((raw as { resets_at?: unknown }).resets_at);
  const resetMs = resetsAt ? Date.parse(resetsAt) : Number.NaN;
  if (Number.isFinite(resetMs)) {
    limit.resets_in_seconds = Math.max(
      0,
      Math.floor((resetMs - capturedAt.getTime()) / 1000),
    );
  }
  return { key, label, limit };
}

/** Convert the stable windows shown by Claude Code's own Usage screen. */
export function claudeUsageRowsFromResponse(
  payload: unknown,
  capturedAt: Date,
): ClaudeUsageLimitRow[] {
  return [
    usageWindow(payload, "five_hour", "Current session", capturedAt),
    usageWindow(payload, "seven_day", "Current week (all models)", capturedAt),
  ].filter((row): row is ClaudeUsageLimitRow => row !== null);
}

function credentialPath(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  const configDir = configured
    ? path.resolve(configured)
    : path.join(os.homedir(), ".claude");
  return path.join(configDir, ".credentials.json");
}

function cachePath(): string {
  return path.join(path.dirname(credentialPath()), ".breadboard", "usage-cache.json");
}

/** Restore only a report belonging to the currently authenticated credential. */
async function restoreUsageCache(state: ClaudeUsageCache, file: string): Promise<void> {
  try {
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    if (saved?.version !== 1 || saved.credentialKey !== state.credentialKey) return;
    if (!Number.isFinite(saved.nextAttemptAt) || saved.nextAttemptAt < 0
      || !Number.isInteger(saved.rateLimits) || saved.rateLimits < 0) return;

    const snapshot = saved.snapshot;
    if (snapshot) {
      const capturedAt = new Date(snapshot.captured_at);
      if (!Number.isFinite(capturedAt.getTime()) || !Array.isArray(snapshot.limits)) return;
      const windows: Record<string, unknown> = {};
      for (const row of snapshot.limits) {
        if ((row?.key !== "five_hour" && row?.key !== "seven_day")
          || !Number.isFinite(row.limit?.used_percent)) return;
        const reset = row.limit.resets_in_seconds;
        if (reset !== undefined && (!Number.isFinite(reset) || reset < 0)) return;
        const resetsAt = reset === undefined ? null : capturedAt.getTime() + reset * 1000;
        windows[row.key] = {
          utilization: row.limit.used_percent,
          resets_at: resetsAt === null ? null : new Date(resetsAt).toISOString(),
        };
      }
      const limits = claudeUsageRowsFromResponse(windows, capturedAt);
      if (!limits.length) return;
      state.snapshot = {
        provider: "anthropic", available: true, captured_at: capturedAt.toISOString(),
        model: "", limits, usage_url: CLAUDE_USAGE_PAGE,
      };
    }
    state.nextAttemptAt = saved.nextAttemptAt;
    state.rateLimits = saved.rateLimits;
    state.error = text(saved.error) ?? undefined;
    if (saved.recoveryReason === "credential" || saved.recoveryReason === "inactive") {
      state.recoveryReason = saved.recoveryReason;
    }
    if (Number.isFinite(saved.nextRecoveryAt)) state.nextRecoveryAt = saved.nextRecoveryAt;
    state.authRequired = saved.authRequired === true;
  } catch {
    // Missing, corrupt or unwritable cache files must never block live usage.
  }
}

async function saveUsageCache(state: ClaudeUsageCache, file: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify({
      version: 1, credentialKey: state.credentialKey, snapshot: state.snapshot,
      nextAttemptAt: state.nextAttemptAt, rateLimits: state.rateLimits, error: state.error,
      recoveryReason: state.recoveryReason, nextRecoveryAt: state.nextRecoveryAt,
      authRequired: state.authRequired,
    }), { mode: 0o600 });
    await fs.rename(temporary, file);
  } catch {
    // The in-memory report remains usable if persistence is unavailable.
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function readCredential() {
  let raw: string;
  try {
    raw = await fs.readFile(credentialPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Claude Code is not signed in.");
    }
    throw new Error("Claude Code's sign-in could not be read.", { cause: error });
  }

  let credential: ClaudeCredentialFile;
  try {
    credential = JSON.parse(raw) as ClaudeCredentialFile;
  } catch (error) {
    throw new Error("Claude Code's sign-in file is invalid.", { cause: error });
  }
  const accessToken = text(credential.claudeAiOauth?.accessToken);
  if (!accessToken) throw new Error("Claude Code is not signed in.");
  return {
    accessToken,
    refreshable: Boolean(text(credential.claudeAiOauth?.refreshToken)),
    expiresAt: finiteNumber(credential.claudeAiOauth?.expiresAt),
  };
}

type ClaudeCredential = Awaited<ReturnType<typeof readCredential>>;

function credentialKey(credential: ClaudeCredential): string {
  return createHash("sha256").update(credentialPath()).update(credential.accessToken).digest("hex");
}

/**
 * Read subscription utilization; an optional POST-only callback lets the
 * official CLI renew an expired/inactive session. Credentials stay server-side.
 */
export async function readClaudeUsageLimits(
  publicModelId: string,
  capturedAt = new Date(),
  options: { recoverSession?: () => Promise<void> } = {},
): Promise<ClaudeUsageLimitsPayload> {
  const model = claudeSubscriptionModelId(publicModelId);
  if (!model) {
    return {
      provider: "anthropic",
      available: false,
      captured_at: capturedAt.toISOString(),
      model: publicModelId,
      limits: [],
      usage_url: CLAUDE_USAGE_PAGE,
      error: "This Claude model is not served by the connected subscription.",
    };
  }

  const credential = await readCredential();
  const key = credentialKey(credential);
  if (shared.__breadboardClaudeUsage?.credentialKey !== key) {
    shared.__breadboardClaudeUsage = { credentialKey: key, nextAttemptAt: 0, rateLimits: 0 };
  }
  const state = shared.__breadboardClaudeUsage;
  if (state.pending) {
    await state.pending;
    // A read-only GET may have discovered the need for the concurrent POST.
    if (!options.recoverSession || !state.recoveryReason
      || Date.now() < (state.nextRecoveryAt ?? 0)) return cachedUsage(state, model, new Date());
    return readClaudeUsageLimits(publicModelId, new Date(), options);
  } else {
    const file = cachePath();
    state.pending = (async () => {
      if (!state.restored) {
        await restoreUsageCache(state, file);
        state.restored = true;
      }
      if (capturedAt.getTime() >= state.nextAttemptAt) {
        if (credential.refreshable && credential.expiresAt !== null
          && credential.expiresAt <= capturedAt.getTime()) {
          state.snapshot = undefined;
          state.recoveryReason = "credential";
          state.error = "Claude’s session needs a refresh.";
          state.nextAttemptAt = capturedAt.getTime() + REFRESH_INTERVAL_MS;
        } else {
          await fetchClaudeUsage(state, credential, model, capturedAt);
        }
      }
      if (options.recoverSession && state.recoveryReason
        && capturedAt.getTime() >= (state.nextRecoveryAt ?? 0)) {
        // Reserve and persist before the CLI runs so failed recovery cannot
        // generate a paid message on every poll, model change or server restart.
        state.nextRecoveryAt = Date.now() + SESSION_RECOVERY_INTERVAL_MS;
        await saveUsageCache(state, file);
        try {
          await options.recoverSession();
          const refreshed = await readCredential();
          if (state.credentialKey !== credentialKey(refreshed)) state.snapshot = undefined;
          state.credentialKey = credentialKey(refreshed);
          await fetchClaudeUsage(state, refreshed, model, new Date());
        } catch {
          state.error = "Claude’s session could not be refreshed. We’ll retry automatically.";
          state.nextAttemptAt = state.nextRecoveryAt;
        }
      }
      await saveUsageCache(state, file);
    })();
    try {
      await state.pending;
    } finally {
      state.pending = undefined;
    }
  }
  return cachedUsage(state, model, capturedAt);
}

async function fetchClaudeUsage(
  state: ClaudeUsageCache,
  credential: ClaudeCredential,
  model: string,
  capturedAt: Date,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(CLAUDE_USAGE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credential.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    state.error = "Claude usage could not be reached. We’ll retry automatically.";
    state.nextAttemptAt = Date.now() + REFRESH_INTERVAL_MS;
    return;
  }

  capturedAt = new Date();
  if (response.status === 429) {
    state.recoveryReason = undefined;
    state.error = "Claude is temporarily limiting usage checks.";
    state.nextAttemptAt = capturedAt.getTime() + retryDelay(response.headers.get("retry-after"), state.rateLimits++, capturedAt.getTime());
    return;
  }
  state.rateLimits = 0;
  state.recoveryReason = undefined;
  state.authRequired = false;
  if (!response.ok) {
    const unauthorized = response.status === 401 || response.status === 403;
    // Rejected credentials must not keep serving a previously authorized report.
    if (unauthorized) state.snapshot = undefined;
    if (response.status === 401 && credential.refreshable) state.recoveryReason = "credential";
    state.authRequired = unauthorized && !state.recoveryReason;
    state.error = response.status === 403
        ? "Claude’s sign-in does not have access to usage. Check the connected account."
        : response.status === 401 && credential.refreshable
        ? "Claude’s session needs a refresh."
        : unauthorized ? "Claude Code's sign-in has expired. Sign in again to view usage."
        : "Claude usage is temporarily unavailable. We’ll retry automatically.";
    state.nextAttemptAt = capturedAt.getTime() + REFRESH_INTERVAL_MS;
    return;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const limits = claudeUsageRowsFromResponse(payload, capturedAt);
  // An explicit null session means the window has not started. A missing or
  // malformed field is not evidence of inactivity (and must not trigger a call).
  if (payload && typeof payload === "object" && "five_hour" in payload
    && payload.five_hour === null) state.recoveryReason = "inactive";
  state.nextAttemptAt = capturedAt.getTime() + REFRESH_INTERVAL_MS;
  if (!limits.length) {
    state.error = state.recoveryReason === "inactive"
      ? "Claude has no active usage session yet."
      : "Anthropic did not report subscription usage windows.";
    return;
  }
  state.error = undefined;
  state.snapshot = {
    provider: "anthropic",
    available: limits.length > 0,
    captured_at: capturedAt.toISOString(),
    model,
    limits,
    usage_url: CLAUDE_USAGE_PAGE,
  };
}
