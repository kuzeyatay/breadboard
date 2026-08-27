// Authenticated dashboard client for the Runtime V2-owned agent services.
//
// These adapters deliberately carry only bounded control records. The actual
// agent protocols (including photos and generated files) continue over each
// clone's private loopback server; no large payload is copied into supervisor
// JSON and no service capability is exposed to the browser.

import {
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
  releaseSupervisorLease,
  acquireServiceLease,
  type SupervisedServiceId,
  type SupervisedServiceSnapshot,
} from "./supervisor-control.ts";

export type RuntimeAgentServiceId =
  | "openwork"
  | "openscience"
  | "money-printer"
  | "wardrobe"
  | "inbox-zero-stack";

export interface RuntimeAgentScope {
  userId: number;
  runId?: string;
  conversationPublicId?: string;
}

interface AgentEndpoint {
  origin: string;
  token: string;
}

const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export class RuntimeAgentServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RuntimeAgentServiceError";
    this.status = status;
  }
}

const CONFIG: Record<
  RuntimeAgentServiceId,
  { url: keyof NodeJS.ProcessEnv; token: keyof NodeJS.ProcessEnv }
> = {
  openwork: {
    url: "BREADBOARD_OPENWORK_SERVICE_URL",
    token: "BREADBOARD_OPENWORK_SERVICE_TOKEN",
  },
  openscience: {
    url: "BREADBOARD_OPENSCIENCE_SERVICE_URL",
    token: "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN",
  },
  "money-printer": {
    url: "BREADBOARD_MONEY_PRINTER_SERVICE_URL",
    token: "BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN",
  },
  wardrobe: {
    url: "BREADBOARD_WARDROBE_SERVICE_URL",
    token: "BREADBOARD_WARDROBE_SERVICE_TOKEN",
  },
  "inbox-zero-stack": {
    url: "BREADBOARD_INBOX_ZERO_SERVICE_URL",
    token: "BREADBOARD_INBOX_ZERO_SERVICE_TOKEN",
  },
};

function endpoint(
  serviceId: RuntimeAgentServiceId,
  env: NodeJS.ProcessEnv = process.env,
): AgentEndpoint {
  const names = CONFIG[serviceId];
  const raw = env[names.url]?.trim() ?? "";
  const token = env[names.token]?.trim() ?? "";
  if (!raw || !token) {
    throw new Error(`${serviceId} is not connected to its Runtime service.`);
  }
  const tokenBytes = Buffer.byteLength(token, "utf8");
  if (
    tokenBytes < MIN_TOKEN_BYTES ||
    tokenBytes > MAX_TOKEN_BYTES ||
    !/^[\x21-\x7e]+$/u.test(token)
  ) {
    throw new Error(`${serviceId} has an invalid Runtime service capability.`);
  }
  const url = new URL(raw);
  if (
    url.protocol !== "http:" ||
    !LOOPBACK.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${serviceId} Runtime service must use credential-free loopback HTTP.`);
  }
  return { origin: url.origin, token };
}

function validateScope(scope: RuntimeAgentScope): void {
  if (!Number.isSafeInteger(scope.userId) || scope.userId < 1) {
    throw new TypeError("A valid agent service user is required.");
  }
  for (const value of [scope.runId, scope.conversationPublicId]) {
    if (value !== undefined && (!value || Buffer.byteLength(value, "utf8") > 256 || /\p{Cc}/u.test(value))) {
      throw new TypeError("Agent service scope is invalid.");
    }
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("The agent service response exceeded its bound.");
  }
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The agent service response exceeded its bound.");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  try {
    return bytes.byteLength ? JSON.parse(bytes.toString("utf8")) : {};
  } catch {
    throw new Error("The agent service returned invalid JSON.");
  }
}

export async function callRuntimeAgentService<T>(
  serviceId: RuntimeAgentServiceId,
  pathName: "/v1/status" | "/v1/ensure" | "/v1/reopen" | "/v1/stop" | "/v1/setup",
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<T> {
  const env = options.env ?? process.env;
  const target = endpoint(serviceId, env);
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded, "utf8") > MAX_REQUEST_BYTES) {
    throw new TypeError("The agent service request exceeded its bound.");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(pathName, target.origin), {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.token}`,
        "content-type": "application/json",
      },
      body: encoded,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const value = await boundedJson(response) as {
      ok?: unknown;
      result?: unknown;
      error?: { message?: unknown };
    };
    if (!response.ok || value.ok !== true) {
      const message = typeof value.error?.message === "string"
        ? value.error.message.slice(0, 8_192)
        : `${serviceId} Runtime service request failed (${response.status}).`;
      throw new RuntimeAgentServiceError(response.status, message);
    }
    return value.result as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export async function withRuntimeAgentServiceLease<T>(
  serviceId: RuntimeAgentServiceId,
  reason: string,
  operation: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const lease = await acquireServiceLease(serviceId as SupervisedServiceId, reason, env);
  if (isRuntimeV2ServiceControlConfigured(env) && !lease) {
    throw new Error(`${serviceId} Runtime service did not grant a lease.`);
  }
  try {
    return await operation();
  } finally {
    await releaseSupervisorLease(lease, env);
  }
}

export async function inspectRuntimeAgentService(
  serviceId: RuntimeAgentServiceId,
  scope: Pick<RuntimeAgentScope, "userId">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ snapshot: SupervisedServiceSnapshot | null; status: unknown | null }> {
  validateScope(scope);
  const snapshot = await readSupervisedServiceSnapshot(serviceId, env);
  const active = !snapshot || ["healthy", "ready", "busy", "degraded"].includes(snapshot.state);
  if (!active) return { snapshot, status: null };
  try {
    const status = await callRuntimeAgentService<unknown>(
      serviceId,
      "/v1/status",
      { scope },
      { timeoutMs: 5_000, env },
    );
    return { snapshot, status };
  } catch {
    return { snapshot, status: null };
  }
}

export function scopedAgentRequest(
  scope: RuntimeAgentScope,
  rest: Record<string, unknown> = {},
): Record<string, unknown> {
  validateScope(scope);
  return { scope, ...rest };
}
