import { resolveChatmockBaseUrl } from "./chatmock-server.ts";

/**
 * Server-side client for ChatMock's provider management API.
 *
 * ChatMock owns provider credentials (they live beside its ChatGPT `auth.json`)
 * so the running proxy picks up a new key without a restart. The dashboard
 * never stores them: these routes proxy through, behind the session auth that
 * ChatMock's own loopback API does not have.
 */

export interface ChatmockProvider {
  id: string;
  label: string;
  kind: "chatgpt_oauth" | "openai_compatible" | "anthropic" | "chatgpt_web";
  description: string;
  docsUrl: string | null;
  requiresApiKey: boolean;
  baseUrlEditable: boolean;
  defaultBaseUrl: string | null;
  baseUrl: string | null;
  enabled: boolean;
  configured: boolean;
  hasStoredKey: boolean;
  keyFromEnvironment: boolean;
  apiKeyHint: string | null;
  apiKeyEnv: string[];
  models: string[];
  suggestedModels: string[];
  customModels: string[];
  unavailableReason: string | null;
  updatedAt: string | null;
}

export interface ChatmockProviderState {
  providers: ChatmockProvider[];
  defaultModel: string;
  storedDefaultModel: string | null;
  /** A running chat's pin; follows defaultModel until a turn supplies an override. */
  chatModel: string;
  storedChatModel: string | null;
  chatgptModels: string[];
  externalModels: string[];
  settingsPath: string;
}

export interface ProviderUpdate {
  apiKey?: string;
  baseUrl?: string;
  enabled?: boolean;
  models?: string[];
}

/** Provider ids are path segments; keep them to the catalog's own shape. */
export function isValidProviderId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_-]{1,32}$/.test(value);
}

const REQUEST_TIMEOUT_MS = 15_000;

async function chatmockFetch(
  request: Request,
  path: string,
  init?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const { baseURL } = resolveChatmockBaseUrl(request);
  // The management API sits next to /v1, and baseURL already ends in /v1.
  const url = `${baseURL}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return fallback;
}

export class ChatmockUnreachableError extends Error {
  constructor(cause: unknown) {
    super(
      "ChatMock is not reachable. Start the proxy, then reopen this panel.",
    );
    this.cause = cause;
  }
}

export class ChatmockRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(
  incoming: Request,
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await chatmockFetch(incoming, path, init, timeoutMs);
  } catch (error) {
    throw new ChatmockUnreachableError(error);
  }

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new ChatmockRequestError(
      response.status,
      errorMessage(payload, `ChatMock returned HTTP ${response.status}.`),
    );
  }
  return payload;
}

export async function readProviderState(
  incoming: Request,
): Promise<ChatmockProviderState> {
  return (await request(incoming, "/providers")) as ChatmockProviderState;
}

export async function updateProvider(
  incoming: Request,
  providerId: string,
  update: ProviderUpdate,
): Promise<ChatmockProviderState> {
  return (await request(incoming, `/providers/${providerId}`, {
    method: "PUT",
    body: JSON.stringify(update),
  })) as ChatmockProviderState;
}

export async function forgetProvider(
  incoming: Request,
  providerId: string,
): Promise<ChatmockProviderState> {
  return (await request(incoming, `/providers/${providerId}`, {
    method: "DELETE",
  })) as ChatmockProviderState;
}

export async function verifyProvider(
  incoming: Request,
  providerId: string,
): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  let response: Response;
  try {
    response = await chatmockFetch(incoming, `/providers/${providerId}/verify`, {
      method: "POST",
    });
  } catch (error) {
    throw new ChatmockUnreachableError(error);
  }
  const payload = (await parseJson(response)) as {
    ok?: boolean;
    models?: string[];
    error?: string;
  } | null;

  // A failed check is a result, not a transport error: report it as 200 with
  // ok:false so the panel can show the reason inline.
  return {
    ok: Boolean(payload?.ok),
    models: Array.isArray(payload?.models) ? payload?.models : undefined,
    error: payload?.error ?? (response.ok ? undefined : `HTTP ${response.status}`),
  };
}

export async function setDefaultModel(
  incoming: Request,
  model: string | null,
): Promise<ChatmockProviderState> {
  return (await request(incoming, "/settings/default-model", {
    method: "PUT",
    body: JSON.stringify({ model }),
  })) as ChatmockProviderState;
}

export async function setChatModel(
  incoming: Request,
  model: string | null,
): Promise<ChatmockProviderState> {
  return (await request(incoming, "/settings/chat-model", {
    method: "PUT",
    body: JSON.stringify({ model }),
  })) as ChatmockProviderState;
}

export function providerErrorResponseInit(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof ChatmockUnreachableError) {
    return { status: 503, message: error.message };
  }
  if (error instanceof ChatmockRequestError) {
    return { status: error.status, message: error.message };
  }
  return {
    status: 500,
    message:
      error instanceof Error ? error.message : "The provider settings could not be read.",
  };
}

// ---- OpenAI (web): the signed-in chatgpt.com tab ---------------------------

/** One model the signed-in ChatGPT page offers. */
export interface ChatgptWebModel {
  slug: string;
  title: string;
  description: string;
  tags: string[];
}

/** What ChatMock knows about the chatgpt.com sign-in, from /v1/providers/openaiweb/session. */
export interface ChatgptWebSession {
  signedIn: boolean;
  email: string | null;
  name: string | null;
  plan: string | null;
  checkedAt: string | null;
  models: ChatgptWebModel[];
  modelsAt: string | null;
  /** Which browser holds the page: Breadboard's own, or a system Chrome/Edge. */
  surface: "desktop" | "browser" | null;
  pageConnected: boolean;
  bridge: { connected: boolean; cdpPort: number | null };
  browser: { available: boolean; executable: string | null };
  login: { status: "awaiting" | "done" | "failed" | "cancelled"; startedAt: string; error: string | null } | null;
  error: string | null;
}

export type ChatgptWebAction = "login" | "cancel-login" | "logout" | "sync";

const CHATGPT_WEB_ACTION_PATHS: Record<ChatgptWebAction, string> = {
  login: "/providers/openaiweb/login",
  "cancel-login": "/providers/openaiweb/login/cancel",
  logout: "/providers/openaiweb/logout",
  sync: "/providers/openaiweb/sync",
};

export function isChatgptWebAction(value: unknown): value is ChatgptWebAction {
  return typeof value === "string" && value in CHATGPT_WEB_ACTION_PATHS;
}

export async function readChatgptWebSession(
  incoming: Request,
  options: { refresh?: boolean } = {},
): Promise<ChatgptWebSession> {
  const query = options.refresh ? "?refresh=1" : "";
  // A refresh opens the page and asks it who is signed in; give it room.
  return (await request(
    incoming,
    `/providers/openaiweb/session${query}`,
    undefined,
    options.refresh ? 90_000 : undefined,
  )) as ChatgptWebSession;
}

export async function runChatgptWebAction(
  incoming: Request,
  action: ChatgptWebAction,
): Promise<ChatgptWebSession> {
  return (await request(
    incoming,
    CHATGPT_WEB_ACTION_PATHS[action],
    { method: "POST" },
    90_000,
  )) as ChatgptWebSession;
}

/** A request from ChatMock for the shell's ChatGPT tab, waiting on a page to relay it. */
export interface ChatgptWebTabRequestRow {
  nonce: string;
  foreground: boolean;
  /** Replace the page rather than reuse it; the one it holds stopped answering. */
  reset: boolean;
  requestedAt: string;
}

export const CHATGPT_WEB_TAB_POLL_MAX_WAIT_SECONDS = 25;

export async function pollChatgptWebTabRequests(
  incoming: Request,
  options: { wait: number; cdpPort?: number | null },
): Promise<{ requests: ChatgptWebTabRequestRow[] }> {
  const wait = Math.max(0, Math.min(CHATGPT_WEB_TAB_POLL_MAX_WAIT_SECONDS, options.wait));
  const params = new URLSearchParams({ wait: String(wait) });
  if (options.cdpPort) params.set("cdpPort", String(options.cdpPort));
  const payload = (await request(
    incoming,
    `/providers/openaiweb/tab-requests?${params.toString()}`,
    undefined,
    (wait + 10) * 1000,
  )) as { requests?: unknown };
  const rows = Array.isArray(payload?.requests) ? payload.requests : [];
  return {
    requests: rows.flatMap((row): ChatgptWebTabRequestRow[] => {
      if (!row || typeof row !== "object") return [];
      const { nonce, foreground, reset, requestedAt } = row as Record<string, unknown>;
      if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce)) return [];
      return [{
        nonce,
        foreground: foreground === true,
        reset: reset === true,
        requestedAt: typeof requestedAt === "string" ? requestedAt : "",
      }];
    }),
  };
}

export function isChatgptWebTabNonce(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

export async function answerChatgptWebTabRequest(
  incoming: Request,
  nonce: string,
  answer: { cdpPort: number; targetId: string } | { error: string },
): Promise<boolean> {
  let response: Response;
  try {
    response = await chatmockFetch(incoming, `/providers/openaiweb/tab-requests/${nonce}`, {
      method: "POST",
      body: JSON.stringify(answer),
    });
  } catch (error) {
    throw new ChatmockUnreachableError(error);
  }
  // 404 means the request already timed out on ChatMock's side; nothing to
  // do about it here, and not a failure of the page that relayed it.
  return response.ok;
}
