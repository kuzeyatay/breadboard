import {
  cliproxyManagementKey,
  cliproxyManagementUrl,
} from "./config.ts";

const REQUEST_TIMEOUT_MS = 20_000;
const ANTIGRAVITY_MODELS_URLS = [
  "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
] as const;

export interface GoogleUsageLimitWindow {
  used_percent: number;
  resets_in_seconds?: number;
}

export interface GoogleUsageLimitAccount {
  account: string;
  limit: GoogleUsageLimitWindow;
}

export interface GoogleUsageLimitsPayload {
  provider: "google";
  available: boolean;
  captured_at: string;
  model: string;
  accounts: GoogleUsageLimitAccount[];
  error?: string;
}

interface ManagementAuthFile {
  auth_index?: unknown;
  provider?: unknown;
  type?: unknown;
  name?: unknown;
  email?: unknown;
  account?: unknown;
  label?: unknown;
  project_id?: unknown;
  disabled?: unknown;
}

interface ManagementApiCallResponse {
  status_code?: unknown;
  body?: unknown;
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

/** The upstream model id behind a public `cliproxy/<model>` id. */
export function antigravityModelId(modelId: string): string | null {
  const normalized = modelId.trim();
  if (!normalized.toLowerCase().startsWith("cliproxy/")) return null;
  const bare = normalized.slice(normalized.indexOf("/") + 1).trim();
  return /^(?:gemini|gemma)[a-z0-9._-]*$/i.test(bare) ? bare : null;
}

/**
 * Read one model's quota entry without depending on the rest of Google's
 * internal model-catalog shape. Antigravity reports a fraction remaining, so
 * the progress bar uses its complement as the percentage consumed.
 */
export function googleLimitWindowFromModels(
  payload: unknown,
  model: string,
  capturedAt: Date,
): GoogleUsageLimitWindow | null {
  if (!payload || typeof payload !== "object") return null;
  const models = (payload as { models?: unknown }).models;
  if (!models || typeof models !== "object" || Array.isArray(models)) return null;

  const match = Object.entries(models as Record<string, unknown>).find(
    ([name]) => name.toLowerCase() === model.toLowerCase(),
  )?.[1];
  if (!match || typeof match !== "object") return null;

  const quotaInfo = (match as { quotaInfo?: unknown }).quotaInfo;
  if (!quotaInfo || typeof quotaInfo !== "object") return null;
  const remaining = finiteNumber(
    (quotaInfo as { remainingFraction?: unknown }).remainingFraction,
  );
  if (remaining === null) return null;

  const clampedRemaining = Math.min(1, Math.max(0, remaining));
  const limit: GoogleUsageLimitWindow = {
    used_percent: (1 - clampedRemaining) * 100,
  };
  const resetTime = text((quotaInfo as { resetTime?: unknown }).resetTime);
  const resetMs = resetTime ? Date.parse(resetTime) : Number.NaN;
  if (Number.isFinite(resetMs)) {
    limit.resets_in_seconds = Math.max(
      0,
      Math.floor((resetMs - capturedAt.getTime()) / 1000),
    );
  }
  return limit;
}

async function managementRequest(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${cliproxyManagementUrl()}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "X-Management-Key": cliproxyManagementKey(),
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error("The Google subscription proxy could not be reached.", {
      cause: error,
    });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`The Google subscription proxy returned HTTP ${response.status}.`);
  }
  return payload;
}

function isAntigravityAuth(auth: ManagementAuthFile): boolean {
  return (
    text(auth.provider)?.toLowerCase() === "antigravity" ||
    text(auth.type)?.toLowerCase() === "antigravity" ||
    text(auth.name)?.toLowerCase().startsWith("antigravity-") === true
  );
}

function accountLabel(auth: ManagementAuthFile): string {
  return (
    text(auth.email) ??
    text(auth.account) ??
    text(auth.label) ??
    "Google account"
  );
}

async function fetchAccountLimit(
  auth: ManagementAuthFile,
  model: string,
  capturedAt: Date,
): Promise<GoogleUsageLimitAccount | null> {
  const authIndex = text(auth.auth_index);
  if (!authIndex) return null;
  const projectId = text(auth.project_id);
  const data = JSON.stringify(projectId ? { project: projectId } : {});

  for (const url of ANTIGRAVITY_MODELS_URLS) {
    const response = (await managementRequest("/api-call", {
      method: "POST",
      body: {
        auth_index: authIndex,
        method: "POST",
        url,
        header: {
          Authorization: "Bearer $TOKEN$",
          "Content-Type": "application/json",
          "User-Agent": "antigravity/1.104.0",
        },
        data,
      },
    })) as ManagementApiCallResponse | null;
    if (finiteNumber(response?.status_code) !== 200 || typeof response?.body !== "string") {
      continue;
    }
    const upstream = (() => {
      try {
        return JSON.parse(response.body as string) as unknown;
      } catch {
        return null;
      }
    })();
    const limit = googleLimitWindowFromModels(upstream, model, capturedAt);
    if (limit) return { account: accountLabel(auth), limit };
  }
  return null;
}

/** Fetch Google-reported model quota for every connected Antigravity account. */
export async function readGoogleUsageLimits(
  publicModelId: string,
  capturedAt = new Date(),
): Promise<GoogleUsageLimitsPayload> {
  const model = antigravityModelId(publicModelId);
  if (!model) {
    return {
      provider: "google",
      available: false,
      captured_at: capturedAt.toISOString(),
      model: publicModelId,
      accounts: [],
      error: "This Google model is not served by the connected subscription.",
    };
  }

  const authPayload = (await managementRequest("/auth-files")) as {
    files?: unknown;
  } | null;
  const auths = Array.isArray(authPayload?.files)
    ? (authPayload.files as ManagementAuthFile[]).filter(
        (auth) => isAntigravityAuth(auth) && auth.disabled !== true,
      )
    : [];
  if (auths.length === 0) {
    return {
      provider: "google",
      available: false,
      captured_at: capturedAt.toISOString(),
      model,
      accounts: [],
      error: "No connected Google subscription account was found.",
    };
  }

  const settled = await Promise.allSettled(
    auths.map((auth) => fetchAccountLimit(auth, model, capturedAt)),
  );
  const accounts = settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  return {
    provider: "google",
    available: accounts.length > 0,
    captured_at: capturedAt.toISOString(),
    model,
    accounts,
    ...(accounts.length === 0
      ? { error: `Google did not report quota for ${model}.` }
      : {}),
  };
}
