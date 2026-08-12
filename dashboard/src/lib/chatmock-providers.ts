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
  kind: "chatgpt_oauth" | "openai_compatible" | "anthropic";
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
): Promise<Response> {
  const { baseURL } = resolveChatmockBaseUrl(request);
  // The management API sits next to /v1, and baseURL already ends in /v1.
  const url = `${baseURL}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
): Promise<unknown> {
  let response: Response;
  try {
    response = await chatmockFetch(incoming, path, init);
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
