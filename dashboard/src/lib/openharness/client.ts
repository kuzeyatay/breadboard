// Low-level typed HTTP client for the OpenHarness server.
//
// We talk to OpenHarness over its documented HTTP API rather than importing the
// `@opencode-ai/sdk` package: the SDK is a Bun-oriented workspace package inside
// the OpenHarness monorepo and is not published in a form the Node/Next.js
// dashboard can depend on cleanly. The API surface we need is small and stable
// (session create / prompt_async / abort / permission reply / event stream /
// health / agents / providers), so a thin fetch wrapper keeps the dependency
// boundary clean while matching the OpenCode protocol.
//
// Server-only: never import this from a client component.

import { authHeader, type OpenHarnessConfig } from "./config.ts";

export class OpenHarnessError extends Error {
  status: number;
  code: string;
  recoverable: boolean;

  constructor(message: string, options: { status?: number; code?: string; recoverable?: boolean } = {}) {
    super(message);
    this.name = "OpenHarnessError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "openharness_error";
    this.recoverable = options.recoverable ?? false;
  }
}

export interface OpenHarnessHealth {
  healthy: boolean;
  version?: string;
}

export interface OpenHarnessAgent {
  name: string;
  description?: string;
  mode?: string;
  hidden?: boolean;
}

export interface OpenHarnessModel {
  id: string;
  providerId: string;
  name?: string;
}

type QueryValue = string | number | boolean | undefined;

function buildUrl(config: OpenHarnessConfig, pathname: string, query?: Record<string, QueryValue>): string {
  const url = new URL(pathname.replace(/^\//, ""), `${config.baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function headers(config: OpenHarnessConfig, extra?: Record<string, string>): Record<string, string> {
  const auth = authHeader(config);
  return {
    Accept: "application/json",
    ...(auth ? { Authorization: auth } : {}),
    ...extra,
  };
}

/** Translate a fetch/network failure into a structured, recoverable error. */
function networkError(cause: unknown): OpenHarnessError {
  const message = cause instanceof Error ? cause.message : "OpenHarness is unreachable";
  return new OpenHarnessError(message, {
    status: 0,
    code: "unreachable",
    recoverable: true,
  });
}

async function request<T>(
  config: OpenHarnessConfig,
  method: string,
  pathname: string,
  options: { query?: Record<string, QueryValue>; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = options.signal ? undefined : new AbortController();
  const timeout = controller
    ? setTimeout(() => controller.abort(), config.requestTimeoutMs)
    : undefined;
  try {
    const response = await fetch(buildUrl(config, pathname, options.query), {
      method,
      headers: headers(config, options.body !== undefined ? { "Content-Type": "application/json" } : undefined),
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal ?? controller?.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OpenHarnessError(
        text || `OpenHarness responded ${response.status}`,
        {
          status: response.status,
          code: response.status === 401 ? "unauthorized" : "http_error",
          recoverable: response.status >= 500 || response.status === 429,
        },
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  } catch (cause) {
    if (cause instanceof OpenHarnessError) throw cause;
    throw networkError(cause);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function fetchHealth(config: OpenHarnessConfig): Promise<OpenHarnessHealth> {
  return request<OpenHarnessHealth>(config, "GET", "/global/health");
}

export async function fetchAgents(
  config: OpenHarnessConfig,
  directory: string,
): Promise<OpenHarnessAgent[]> {
  const agents = await request<OpenHarnessAgent[]>(config, "GET", "/agent", { query: { directory } });
  return Array.isArray(agents) ? agents.filter((agent) => agent && !agent.hidden) : [];
}

export async function fetchModels(
  config: OpenHarnessConfig,
  directory: string,
): Promise<OpenHarnessModel[]> {
  // The `/config/providers` endpoint returns provider descriptors with nested
  // models; flatten to id/providerId pairs.
  const data = await request<{ providers?: Array<{ id?: string; models?: Record<string, { id?: string; name?: string }> }> }>(
    config,
    "GET",
    "/config/providers",
    { query: { directory } },
  );
  const models: OpenHarnessModel[] = [];
  for (const provider of data.providers ?? []) {
    if (!provider.id || !provider.models) continue;
    for (const model of Object.values(provider.models)) {
      if (model?.id) models.push({ id: model.id, providerId: provider.id, name: model.name });
    }
  }
  return models;
}

export interface CreateSessionBody {
  title?: string;
  agent?: string;
  metadata?: Record<string, unknown>;
}

export async function createSession(
  config: OpenHarnessConfig,
  directory: string,
  body: CreateSessionBody,
): Promise<{ id: string }> {
  const session = await request<{ id: string }>(config, "POST", "/session", {
    query: { directory },
    body,
  });
  return session;
}

export interface PromptPart {
  type: "text";
  text: string;
}

export interface PromptBody {
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  system?: string;
  parts: PromptPart[];
  messageID?: string;
}

/** Fire-and-forget prompt: OpenHarness streams the answer over the event bus. */
export async function promptAsync(
  config: OpenHarnessConfig,
  directory: string,
  sessionId: string,
  body: PromptBody,
): Promise<void> {
  await request<void>(config, "POST", `/session/${encodeURIComponent(sessionId)}/prompt_async`, {
    query: { directory },
    body,
  });
}

export async function abortSession(
  config: OpenHarnessConfig,
  directory: string,
  sessionId: string,
): Promise<void> {
  await request<boolean>(config, "POST", `/session/${encodeURIComponent(sessionId)}/abort`, {
    query: { directory },
  });
}

export async function replyPermission(
  config: OpenHarnessConfig,
  directory: string,
  sessionId: string,
  permissionId: string,
  response: "once" | "always" | "reject",
): Promise<void> {
  await request<void>(
    config,
    "POST",
    `/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}`,
    { query: { directory }, body: { response } },
  );
}

/**
 * Open the instance SSE event stream filtered to a workspace `directory`. The
 * caller further filters by session id. Returns the raw Response so the gateway
 * can iterate the body; throws a structured error on failure.
 */
export async function openEventStream(
  config: OpenHarnessConfig,
  directory: string,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    const response = await fetch(buildUrl(config, "/event", { directory }), {
      method: "GET",
      headers: headers(config, { Accept: "text/event-stream" }),
      signal,
    });
    if (!response.ok || !response.body) {
      throw new OpenHarnessError(`Event stream failed (${response.status})`, {
        status: response.status,
        code: "event_stream_failed",
        recoverable: true,
      });
    }
    return response;
  } catch (cause) {
    if (cause instanceof OpenHarnessError) throw cause;
    throw networkError(cause);
  }
}
