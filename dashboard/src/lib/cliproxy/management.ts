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
  claudeProfileFile,
  claudeProfileId,
  CLAUDE_CODE_MODELS,
  isClaudeCodeLoginComplete,
  isClaudeCodeLoginState,
  isClaudeCodeModel,
  linkClaudeCodeLogin,
  changeClaudeProfile,
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
  method: "GET" | "DELETE" | "PATCH" = "GET",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${cliproxyManagementUrl()}${path}`, {
      method,
      headers: {
        "X-Management-Key": cliproxyManagementKey(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
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
  url: string | null;
  state: string;
  flow: "redirect" | "device" | "local";
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
  signal?.throwIfAborted();
  const spec = cliproxyProvider(providerId);
  if (!spec) throw new CliproxyRequestError(400, "Unknown subscription provider.");

  if (spec.id === "claude") {
    try {
      const linked = await linkClaudeCodeLogin(userId);
      return { provider: spec.id, url: null, state: linked.state, flow: "local" };
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
  signal?.throwIfAborted();
  if (!state.trim()) return false;
  if (isClaudeCodeLoginState(state)) {
    return isClaudeCodeLoginComplete(userId, state);
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
  const profile = claudeProfileId(name);
  if (profile) {
    try {
      await changeClaudeProfile(userId, "logout", profile, signal);
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

/**
 * Make one subscription credential the account its provider serves from.
 *
 * CLIProxyAPI has no notion of a preferred credential: every enabled file for
 * a provider takes a share of the traffic. "Active" is therefore built from
 * the one switch it does have — a per-file `disabled` flag its management API
 * toggles (PATCH /auth-files/status, verified against v7.2.111, which writes
 * the flag into the credential file so it survives a restart). Activating
 * enables the chosen file first, so a failure part-way leaves the provider
 * with at least one credential serving, and then disables its siblings.
 *
 * Claude profile preferences are handled by its account worker.
 */
export async function activateAccount(file: string, userId?: number, signal?: AbortSignal): Promise<void> {
  const name = file.trim();
  const profile = claudeProfileId(name);
  if (profile) {
    if (!userId) throw new CliproxyRequestError(401, "Sign in to switch Claude accounts.");
    return changeClaudeProfile(userId, "activate", profile, signal);
  }
  if (
    !name ||
    name !== basename(name) ||
    name.startsWith(".") ||
    !name.toLowerCase().endsWith(".json")
  ) {
    throw new CliproxyRequestError(400, "That is not a credential this panel manages.");
  }
  const accounts = readCliproxyAccounts();
  const chosen = accounts.find((account) => account.file === name);
  if (!chosen) throw new CliproxyRequestError(404, "That account is not signed in.");

  await managementFetch("/auth-files/status", "PATCH", { name, disabled: false });
  for (const sibling of accounts) {
    if (sibling.provider !== chosen.provider || sibling.file === name || !sibling.active) {
      continue;
    }
    await managementFetch("/auth-files/status", "PATCH", {
      name: sibling.file,
      disabled: true,
    });
  }
}

/** Last path segment, treating both separators as such on every platform. */
function basename(value: string): string {
  return value.split(/[\\/]/).pop() ?? "";
}

/**
 * Normalize both CLIProxyAPI model-catalog shapes.
 *
 * The ordinary OpenAI-compatible endpoint returns `data[].id`; the richer
 * client catalog returns `models[]` and may call the same field `slug`. A
 * reconnect must accept the latter or a successful fresh discovery looks
 * empty and the old minimal snapshot wins.
 */
export function cliproxyModelIdsFromPayload(payload: unknown): string[] {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.models)
      ? record.models
      : Array.isArray(record?.data)
        ? record.data
        : [];

  return [
    ...new Set(
      rows.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const model = entry as Record<string, unknown>;
        if (String(model.visibility ?? "").toLowerCase() === "hide") return [];
        // The rich catalog may describe models the account cannot use. Never
        // persist those as callable subscription routes (e.g. Argon on an
        // ineligible Google plan).
        if (model.disabled === true) return [];
        const value =
          typeof model.id === "string"
            ? model.id
            : typeof model.slug === "string"
              ? model.slug
              : "";
        const id = value.trim();
        return id ? [id] : [];
      }),
    ),
  ];
}

/** Model ids the proxy can currently serve, i.e. what the signed-in accounts grant. */
async function listCliproxyModels(): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    const catalogUrl = new URL(`${cliproxyBaseUrl()}/models`);
    // CLIProxyAPI treats any client_version query as a fresh rich-catalog
    // request. This matters immediately after Google OAuth: the minimal endpoint
    // may still hold the small bootstrap list and used to overwrite every
    // Gemini model Breadboard had already discovered.
    catalogUrl.searchParams.set("client_version", "breadboard");
    response = await fetch(catalogUrl, {
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
  return cliproxyModelIdsFromPayload(
    await response.json().catch(() => null),
  );
}

/**
 * Models unlocked by every subscription backend.
 *
 * Claude is intentionally removed from CLIProxyAPI and re-added only when the
 * official Claude Code CLI reports a live login. The public `cliproxy/...`
 * ids stay stable, while request dispatch now hands those Claude ids to Claude
 * Code itself. Other subscription providers continue through CLIProxyAPI.
 */
/**
 * Claude's status comes from a Runtime job that can fail on its own (memory
 * admission, a worker fault). It must not take Gemini, Kimi and Grok down with
 * it: an uncaught failure here once failed the whole Accounts status call, so
 * every provider looked disconnected and Connect stayed disabled. The promise
 * is also settled immediately, so a failure while the proxy call is still in
 * flight is never an unhandled rejection.
 */
function readClaudeStatusContained(userId: number, signal?: AbortSignal) {
  return readClaudeCodeStatus(userId, signal).then(
    (status) => ({ ...status, statusError: null as string | null }),
    (error: unknown) => ({
      installed: false,
      loggedIn: false,
      authMethod: null,
      email: null,
      subscriptionType: null,
      accounts: [] as Awaited<ReturnType<typeof readClaudeCodeStatus>>["accounts"],
      error: null,
      statusError:
        error instanceof Error && error.message
          ? error.message
          : "Claude Code could not be checked.",
    }),
  );
}

export async function listModels(userId: number, signal?: AbortSignal): Promise<string[]> {
  const claudeStatusPromise = readClaudeStatusContained(userId, signal);
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
  claudeInstalled: boolean;
  /** Set when Claude's status could not be read; it is unknown, not missing. */
  claudeStatusError: string | null;
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
  const claudeStatusPromise = readClaudeStatusContained(userId, signal);

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
  const serving = claudeStatus.accounts.find(account => account.resetAt <= Date.now());
  for (const [index, profile] of claudeStatus.accounts.entries()) {
    accounts.push({
      provider: "claude", label: "Claude", vendorLabel: "Anthropic",
      file: claudeProfileFile(profile.id), account: profile.email ?? "Signed in",
      connectedAt: profile.connectedAt, active: serving?.id === profile.id,
      preferred: index === 0, resetAt: profile.resetAt,
    });
  }

  const models = proxyModels.filter((model) => !isClaudeCodeModel(model));
  if (claudeStatus.loggedIn) models.push(...CLAUDE_CODE_MODELS);
  const running = proxyRunning || claudeStatus.loggedIn;
  const installed = proxyInstalled || claudeStatus.installed;

  return {
    installed,
    claudeInstalled: claudeStatus.installed,
    claudeStatusError: claudeStatus.statusError,
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
