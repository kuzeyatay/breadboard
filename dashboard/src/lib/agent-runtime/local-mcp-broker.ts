if (typeof window !== "undefined") {
  throw new Error("The local MCP broker client is server-only.");
}

import type { RuntimeMcpStatus } from "./contracts.ts";
import type { RuntimeMcpConfig } from "../hermes/mcp-connections.ts";
import {
  SupervisorResourceExhaustedError,
  acquireServiceLease,
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
  releaseSupervisorLease,
} from "../supervisor-control.ts";

export interface LocalMcpBrokerTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export class LocalMcpBrokerError extends Error {
  readonly code: string;

  constructor(code: string, message = "The local MCP runtime is unavailable.") {
    super(message);
    this.name = "LocalMcpBrokerError";
    this.code = code;
  }
}

interface Endpoint {
  origin: string;
  token: string;
}

const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024 + 64 * 1024;

function endpoint(env: NodeJS.ProcessEnv): Endpoint {
  if (!isRuntimeV2ServiceControlConfigured(env)) {
    throw new LocalMcpBrokerError("runtime_unavailable");
  }
  const raw = env.BREADBOARD_LOCAL_MCP_BROKER_URL?.trim();
  const token = env.BREADBOARD_LOCAL_MCP_BROKER_TOKEN?.trim();
  if (!raw || !token) throw new LocalMcpBrokerError("invalid_runtime_configuration");
  const tokenBytes = Buffer.from(token, "utf8");
  if (
    tokenBytes.byteLength < MIN_TOKEN_BYTES ||
    tokenBytes.byteLength > MAX_TOKEN_BYTES ||
    !tokenBytes.every((byte) => byte >= 0x21 && byte <= 0x7e)
  ) {
    throw new LocalMcpBrokerError("invalid_runtime_configuration");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LocalMcpBrokerError("invalid_runtime_configuration");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new LocalMcpBrokerError("invalid_runtime_configuration");
  }
  return { origin: url.origin, token };
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new LocalMcpBrokerError("invalid_response");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new LocalMcpBrokerError("invalid_response");
  }
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new LocalMcpBrokerError("invalid_response");
  }
}

async function request(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  const target = endpoint(env);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${target.origin}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const envelope = await readBoundedJson(response);
    if (!response.ok || envelope.ok !== true || !Object.hasOwn(envelope, "result")) {
      const error = envelope.error;
      const code = error && typeof error === "object" && !Array.isArray(error) &&
          typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "broker_request_failed";
      throw new LocalMcpBrokerError(code);
    }
    return envelope.result;
  } catch (error) {
    if (error instanceof LocalMcpBrokerError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new LocalMcpBrokerError(signal?.aborted ? "cancelled" : "timeout");
    }
    throw new LocalMcpBrokerError("unavailable");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function leasedRequest(
  reason: string,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  let lease;
  try {
    lease = await acquireServiceLease("local-mcp-broker", reason, env);
  } catch (error) {
    if (error instanceof SupervisorResourceExhaustedError) {
      throw new LocalMcpBrokerError(
        "BREADBOARD_RESOURCE_EXHAUSTED",
        "Windows memory pressure is too high to start this local MCP connection right now.",
      );
    }
    throw new LocalMcpBrokerError("runtime_unavailable");
  }
  try {
    return await request(path, body, timeoutMs, signal, env);
  } finally {
    await releaseSupervisorLease(lease, env);
  }
}

function status(value: unknown): RuntimeMcpStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalMcpBrokerError("invalid_response");
  }
  const state = (value as { status?: unknown }).status;
  if (state === "connected" || state === "disabled" || state === "needs_auth" ||
      state === "needs_client_registration") {
    return { status: state };
  }
  if (state === "failed") {
    const error = (value as { error?: unknown }).error;
    return {
      status: "failed",
      ...(typeof error === "string" ? { error: error.slice(0, 1_000) } : {}),
    };
  }
  throw new LocalMcpBrokerError("invalid_response");
}

function tools(value: unknown): LocalMcpBrokerTool[] {
  if (!Array.isArray(value) || value.length > 1_000) {
    throw new LocalMcpBrokerError("invalid_response");
  }
  return value.map((tool) => {
    if (
      !tool ||
      typeof tool !== "object" ||
      Array.isArray(tool) ||
      typeof (tool as { name?: unknown }).name !== "string" ||
      !(tool as { inputSchema?: unknown }).inputSchema ||
      typeof (tool as { inputSchema: unknown }).inputSchema !== "object" ||
      Array.isArray((tool as { inputSchema: unknown }).inputSchema)
    ) {
      throw new LocalMcpBrokerError("invalid_response");
    }
    return tool as LocalMcpBrokerTool;
  });
}

export async function addLocalMcpBrokerConnection(input: {
  userId: number;
  slug: string;
  config: Extract<RuntimeMcpConfig, { type: "local" }>;
  env?: NodeJS.ProcessEnv;
}): Promise<{ status: RuntimeMcpStatus; tools: LocalMcpBrokerTool[] }> {
  const env = input.env ?? process.env;
  const result = await leasedRequest(
    `local-mcp:add:${input.slug}`,
    "/v1/add",
    {
      userId: input.userId,
      slug: input.slug,
      revision: input.config.profileRevision,
      digest: input.config.profileDigest,
    },
    input.config.timeout + 10_000,
    undefined,
    env,
  );
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new LocalMcpBrokerError("invalid_response");
  }
  return {
    status: status((result as { status?: unknown }).status),
    tools: tools((result as { tools?: unknown }).tools),
  };
}

export async function callLocalMcpBrokerTool(input: {
  userId: number;
  slug: string;
  config: Extract<RuntimeMcpConfig, { type: "local" }>;
  tool: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}): Promise<unknown> {
  const env = input.env ?? process.env;
  const result = await leasedRequest(
    `local-mcp:call:${input.slug}`,
    "/v1/call",
    {
      userId: input.userId,
      slug: input.slug,
      revision: input.config.profileRevision,
      digest: input.config.profileDigest,
      tool: input.tool,
      args: input.args,
    },
    input.config.timeout + 10_000,
    input.signal,
    env,
  );
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !Object.hasOwn(result, "result")
  ) {
    throw new LocalMcpBrokerError("invalid_response");
  }
  return (result as { result: unknown }).result;
}

export async function disconnectLocalMcpBrokerConnection(input: {
  userId: number;
  slug: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = input.env ?? process.env;
  if (!isRuntimeV2ServiceControlConfigured(env)) return;
  let state;
  try {
    state = (await readSupervisedServiceSnapshot("local-mcp-broker", env))?.state;
  } catch {
    return;
  }
  if (!state || !new Set(["starting", "healthy", "degraded", "ready", "busy"]).has(state)) {
    return;
  }
  await leasedRequest(
    `local-mcp:disconnect:${input.slug}`,
    "/v1/disconnect",
    { userId: input.userId, slug: input.slug },
    15_000,
    undefined,
    env,
  ).catch(() => undefined);
}
