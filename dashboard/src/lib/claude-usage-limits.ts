import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const REQUEST_TIMEOUT_MS = 20_000;

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
}

interface ClaudeCredentialFile {
  claudeAiOauth?: {
    accessToken?: unknown;
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

async function readAccessToken(): Promise<string> {
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
  return accessToken;
}

/**
 * Fetch Claude's read-only subscription utilization. The OAuth token is read
 * into server memory only and is never included in the returned payload.
 */
export async function readClaudeUsageLimits(
  publicModelId: string,
  capturedAt = new Date(),
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

  const accessToken = await readAccessToken();
  let response: Response;
  try {
    response = await fetch(CLAUDE_USAGE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error("Anthropic's usage service could not be reached.", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Claude Code's sign-in has expired. Sign in again to view usage."
        : `Anthropic's usage service returned HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const limits = claudeUsageRowsFromResponse(payload, capturedAt);
  return {
    provider: "anthropic",
    available: limits.length > 0,
    captured_at: capturedAt.toISOString(),
    model,
    limits,
    usage_url: CLAUDE_USAGE_PAGE,
    ...(limits.length === 0
      ? { error: "Anthropic did not report subscription usage windows." }
      : {}),
  };
}
