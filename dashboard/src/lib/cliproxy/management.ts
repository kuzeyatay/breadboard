import {
  cliproxyApiKey,
  cliproxyBaseUrl,
  cliproxyManagementKey,
  cliproxyManagementUrl,
  cliproxyProvider,
  isCliproxyInstalled,
  readCliproxyAccounts,
  CLIPROXY_PROVIDERS,
  type CliproxyAccount,
} from "./config.ts";
import {
  CLAUDE_CODE_ACCOUNT_FILE,
  CLAUDE_CODE_MODELS,
  isClaudeCodeLoginComplete,
  isClaudeCodeLoginState,
  isClaudeCodeModel,
  linkClaudeCodeLogin,
  logoutClaudeCode,
  readClaudeCodeStatus,
} from "../claude-code.ts";
import { RuntimeJobControlError } from "../supervisor-control.ts";
import { RuntimeAuthorityUnavailableError } from "../runtime-v2/authority-error.ts";

/**
 * Subscription authentication coordinator. Gemini, Kimi and Grok use
 * CLIProxyAPI's management API; Claude delegates to the official Claude Code
 * CLI and never enters CLIProxyAPI's credential store.
 *
 * Protocol (verified against CLIProxyAPI v7.2.111):
 *   1. GET /v0/management/<provider>-auth-url?is_webui=true -> { url, state }
 *      Device-code providers also return { flow: "device", user_code, ... }.
 *   2. The user completes the login in a browser.
 *   3. GET /v0/management/get-auth-status?state=<state> -> { status: "wait" | "ok" }
 *   4. GET /v0/management/auth-files -> the credentials now on disk.
 *
 * Every call carries X-Management-Key and targets loopback only.
 */

const REQUEST_TIMEOUT_MS = 20_000;

function isClaudeRuntimeAuthorityError(error: unknown): boolean {
  return (
    error instanceof RuntimeJobControlError ||
    error instanceof RuntimeAuthorityUnavailableError ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export class CliproxyUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      "Breadboard could not start the subscription proxy. Restart the app and try again.",
    );
    this.cause = cause;
  }
}

export class CliproxyRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function managementFetch(
  path: string,
  method: "GET" | "DELETE" = "GET",
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${cliproxyManagementUrl()}${path}`, {
      method,
      headers: { "X-Management-Key": cliproxyManagementKey() },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new CliproxyUnavailableError(error);
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `HTTP ${response.status}`;
    throw new CliproxyRequestError(response.status, detail);
  }
  return payload;
}

export interface CliproxyLoginStart {
  provider: string;
  url: string;
  state: string;
  flow: "redirect" | "device";
  userCode?: string;
  expiresIn?: number;
  interval?: number;
}

/** Begin an OAuth flow and return what the browser needs to show. */
export async function startLogin(
  userId: number,
  providerId: string,
  signal?: AbortSignal,
): Promise<CliproxyLoginStart> {
  const spec = cliproxyProvider(providerId);
  if (!spec) throw new CliproxyRequestError(400, "Unknown subscription provider.");

  if (spec.id === "claude") {
    try {
      const linked = await linkClaudeCodeLogin(userId, signal);
      return {
        provider: spec.id,
        // The settings UI requires a safe URL for every redirect flow. Linking
        // itself is already complete; this page only lets the user inspect the
        // Claude account whose CLI-owned credential Breadboard detected.
        url: "https://claude.ai/settings/profile",
        state: linked.state,
        flow: "redirect",
      };
    } catch (error) {
      if (isClaudeRuntimeAuthorityError(error)) throw error;
      throw new CliproxyRequestError(
        409,
        error instanceof Error ? error.message : "Claude Code could not be linked.",
      );
    }
  }

  // `is_webui=true` asks CLIProxyAPI to host the OAuth callback itself, so the
  // redirect lands back on the local proxy rather than needing a Breadboard route.
  const query = spec.flow === "device" ? "" : "?is_webui=true";
  const payload = (await managementFetch(`/${spec.endpoint}${query}`)) as {
    url?: unknown;
    state?: unknown;
    flow?: unknown;
    user_code?: unknown;
    expires_in?: unknown;
    interval?: unknown;
  } | null;

  const url = typeof payload?.url === "string" ? payload.url : null;
  if (!url) throw new CliproxyRequestError(502, "The proxy did not return a sign-in URL.");

  return {
    provider: spec.id,
    url,
    state: typeof payload?.state === "string" ? payload.state : "",
    flow: payload?.flow === "device" ? "device" : spec.flow,
    ...(typeof payload?.user_code === "string" && payload.user_code
      ? { userCode: payload.user_code }
      : {}),
    ...(typeof payload?.expires_in === "number" ? { expiresIn: payload.expires_in } : {}),
    ...(typeof payload?.interval === "number" ? { interval: payload.interval } : {}),
  };
}

/** Poll one in-flight login. Returns true once the credential is stored. */
export async function isLoginComplete(
  userId: number,
  state: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!state.trim()) return false;
  if (isClaudeCodeLoginState(state)) {
    return isClaudeCodeLoginComplete(userId, state, signal);
  }
  try {
    const payload = (await managementFetch(
      `/get-auth-status?state=${encodeURIComponent(state)}`,
    )) as { status?: unknown } | null;
    return payload?.status === "ok";
  } catch (error) {
    // A not-yet-known state answers with an error; that is "still waiting",
    // not a failure worth surfacing.
    if (error instanceof CliproxyRequestError) return false;
    throw error;
  }
}

/**
 * Sign one subscription account out by removing its stored credential.
 *
 * This goes through the management API rather than unlinking the file, because
 * the running proxy holds the credential in memory and only drops it when told.
 * There is no undo: the account has to complete its OAuth flow again, so the UI
 * confirms before calling this.
 *
 * The name is a filename the proxy resolves inside its auth-dir. It comes from
 * a listing this module produced, but it arrives back over an HTTP route, so it
 * is checked rather than trusted — a name that walks out of that directory is
 * not a credential this panel manages.
 */
export async function deleteAccount(
  userId: number,
  file: string,
  signal?: AbortSignal,
): Promise<void> {
  const name = file.trim();
  if (name === CLAUDE_CODE_ACCOUNT_FILE) {
    try {
      await logoutClaudeCode(userId, signal);
      return;
    } catch (error) {
      if (isClaudeRuntimeAuthorityError(error)) throw error;
      throw new CliproxyRequestError(
        502,
        error instanceof Error ? error.message : "Claude Code could not sign out.",
      );
    }
  }
  if (
    !name ||
    name !== basename(name) ||
    name.startsWith(".") ||
    !name.toLowerCase().endsWith(".json")
  ) {
    throw new CliproxyRequestError(400, "That is not a credential this panel manages.");
  }
  await managementFetch(`/auth-files?name=${encodeURIComponent(name)}`, "DELETE");
}

/** Last path segment, treating both separators as such on every platform. */
function basename(value: string): string {
  return value.split(/[\\/]/).pop() ?? "";
}

/** Model ids the proxy can currently serve, i.e. what the signed-in accounts grant. */
async function listCliproxyModels(): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${cliproxyBaseUrl()}/models`, {
      headers: { Authorization: `Bearer ${cliproxyApiKey()}` },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new CliproxyUnavailableError(error);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new CliproxyRequestError(response.status, `HTTP ${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as { data?: unknown } | null;
  if (!Array.isArray(payload?.data)) return [];

  return payload.data
    .map((entry) =>
      entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string"
        ? (entry as { id: string }).id
        : null,
    )
    .filter((id): id is string => Boolean(id));
}

/**
 * Models unlocked by every subscription backend.
 *
 * Claude is intentionally removed from CLIProxyAPI and re-added only when the
 * official Claude Code CLI reports a live login. The public `cliproxy/...`
 * ids stay stable, while request dispatch now hands those Claude ids to Claude
 * Code itself. Other subscription providers continue through CLIProxyAPI.
 */
export async function listModels(userId: number, signal?: AbortSignal): Promise<string[]> {
  const claudeStatusPromise = readClaudeCodeStatus(userId, signal);
  let proxyModels: string[] = [];
  let proxyError: unknown;
  try {
    proxyModels = await listCliproxyModels();
  } catch (error) {
    proxyError = error;
  }

  const claudeStatus = await claudeStatusPromise;
  const models = proxyModels.filter((model) => !isClaudeCodeModel(model));
  if (claudeStatus.loggedIn) models.push(...CLAUDE_CODE_MODELS);

  if (models.length === 0 && proxyError) throw proxyError;
  return [...new Set(models)];
}

export interface CliproxyStatus {
  installed: boolean;
  running: boolean;
  baseUrl: string;
  providers: Array<{
    id: string;
    label: string;
    vendorLabel: string;
    description: string;
    flow: "redirect" | "device";
    connected: boolean;
    /** Vendors that can hold only one account, so their second sign-in is disabled. */
    singleAccount: boolean;
  }>;
  accounts: CliproxyAccount[];
  models: string[];
  error: string | null;
}

/** Everything the settings panel needs in one call. */
export async function readStatus(userId: number, signal?: AbortSignal): Promise<CliproxyStatus> {
  // Legacy proxy-owned Claude credentials are deliberately ignored. They are
  // left on disk (never destroy a user's credential implicitly), but Claude's
  // visible account and connected state now come only from Claude Code.
  const accounts = readCliproxyAccounts().filter(
    (account) => account.provider !== "claude",
  );
  const proxyInstalled = isCliproxyInstalled();
  const claudeStatusPromise = readClaudeCodeStatus(userId, signal);

  let proxyModels: string[] = [];
  let proxyRunning = false;
  let error: string | null = null;
  try {
    proxyModels = await listCliproxyModels();
    proxyRunning = true;
  } catch (caught) {
    error =
      caught instanceof CliproxyUnavailableError
        ? caught.message
        : caught instanceof Error
          ? caught.message
          : "The subscription proxy could not be reached.";
  }

  const claudeStatus = await claudeStatusPromise;
  if (claudeStatus.loggedIn) {
    accounts.push({
      provider: "claude",
      label: "Claude",
      vendorLabel: "Anthropic",
      file: CLAUDE_CODE_ACCOUNT_FILE,
      account: claudeStatus.email ?? claudeStatus.subscriptionType ?? "Signed in",
      connectedAt: null,
    });
  }

  const models = proxyModels.filter((model) => !isClaudeCodeModel(model));
  if (claudeStatus.loggedIn) models.push(...CLAUDE_CODE_MODELS);
  const running = proxyRunning || claudeStatus.loggedIn;
  const installed = proxyInstalled || claudeStatus.installed;

  return {
    installed,
    running,
    baseUrl: cliproxyBaseUrl(),
    providers: CLIPROXY_PROVIDERS.map((provider) => ({
      id: provider.id,
      label: provider.label,
      vendorLabel: provider.vendorLabel,
      description: provider.description,
      flow: provider.flow,
      connected: accounts.some((account) => account.provider === provider.id),
      singleAccount: provider.singleAccount === true,
    })),
    accounts,
    models: [...new Set(models)],
    error: running ? null : error ?? claudeStatus.error,
  };
}
