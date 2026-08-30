// Server-only client for the Runtime V2-owned mem0 semantic engine.
//
// The dashboard owns canonical memory rows and privacy policy. The service
// owns only mem0's derived SQLite/vector handles, so those native allocations
// disappear when the Runtime retires the on-demand service after its idle TTL.

import {
  SupervisorResourceExhaustedError,
  acquireServiceLease,
  isRuntimeV2ServiceControlConfigured,
  releaseSupervisorLease,
} from "../supervisor-control.ts";
import { mem0Config } from "./config.ts";

export interface SemanticMemoryHit {
  mem0Id: string;
  text: string;
  /** Combined mem0 relevance, clamped to [0, 1]. */
  similarity: number;
}

export interface SemanticFact {
  mem0Id: string;
  text: string;
}

export interface SemanticMemoryClient {
  /** Index text verbatim — no LLM call. Resolves to the mem0 entry id. */
  index(
    text: string,
    scope: { userId: number; metadata?: Record<string, unknown> },
  ): Promise<string | null>;
  search(
    query: string,
    scope: { userId: number; topK?: number },
  ): Promise<SemanticMemoryHit[]>;
  /** LLM fact extraction over one exchange; returns the facts mem0 stored. */
  extract(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    scope: { userId: number },
  ): Promise<SemanticFact[]>;
  remove(mem0Id: string): Promise<void>;
}

/** mem0-side identity. Opaque on purpose: mem0 never sees emails or names. */
export function mem0UserTag(userId: number): string {
  return `bb-user-${userId}`;
}

export class SemanticMemoryServiceError extends Error {
  readonly code: string;

  constructor(code: string, message = "Semantic memory is unavailable.") {
    super(message);
    this.name = "SemanticMemoryServiceError";
    this.code = code;
  }
}

interface ServiceEndpoint {
  origin: string;
  token: string;
}

interface ServiceEnvelope {
  ok?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);
const MAX_RESPONSE_BYTES = 256 * 1024;
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 1024;
const REQUEST_TIMEOUT_MS = 65_000;
/** A turn waits this long for a starting engine before answering without it. */
const SEMANTIC_MEMORY_LEASE_WAIT_MS = 15_000;

function serviceEndpoint(env: NodeJS.ProcessEnv): ServiceEndpoint | null {
  const raw = env.BREADBOARD_MEM0_SERVICE_URL?.trim();
  const token = env.BREADBOARD_MEM0_SERVICE_TOKEN?.trim();
  if (!raw && !token) return null;
  if (!raw || !token) {
    throw new SemanticMemoryServiceError("invalid_runtime_configuration");
  }
  const bytes = Buffer.from(token, "utf8");
  if (
    bytes.byteLength < MIN_TOKEN_BYTES ||
    bytes.byteLength > MAX_TOKEN_BYTES ||
    !bytes.every((byte) => byte >= 0x21 && byte <= 0x7e)
  ) {
    throw new SemanticMemoryServiceError("invalid_runtime_configuration");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SemanticMemoryServiceError("invalid_runtime_configuration");
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
    throw new SemanticMemoryServiceError("invalid_runtime_configuration");
  }
  return { origin: url.origin, token };
}

function positiveUserId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Semantic memory user scope is invalid.");
  }
  return value;
}

function boundedText(value: string, maximumBytes: number, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /\u0000/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

async function readBoundedJson(response: Response): Promise<ServiceEnvelope> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new SemanticMemoryServiceError("invalid_response");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new SemanticMemoryServiceError("invalid_response");
  }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid envelope");
    }
    return value as ServiceEnvelope;
  } catch {
    throw new SemanticMemoryServiceError("invalid_response");
  }
}

async function serviceCall(
  endpoint: ServiceEndpoint,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint.origin}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const envelope = await readBoundedJson(response);
    if (!response.ok || envelope.ok !== true) {
      const code = typeof envelope.error?.code === "string"
        ? envelope.error.code
        : "service_request_failed";
      throw new SemanticMemoryServiceError(code);
    }
    return envelope.result;
  } catch (error) {
    if (error instanceof SemanticMemoryServiceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SemanticMemoryServiceError(signal?.aborted ? "cancelled" : "timeout");
    }
    throw new SemanticMemoryServiceError("unavailable");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function rpcClient(
  endpoint: ServiceEndpoint,
  fingerprint: string,
  env: NodeJS.ProcessEnv,
  leaseEachOperation: boolean,
): SemanticMemoryClient {
  const call = async (path: string, body: Record<string, unknown>) => {
    const operation = () => serviceCall(endpoint, path, { fingerprint, ...body });
    if (!leaseEachOperation) return operation();
    const lease = await acquireServiceLease(
      "mem0-semantic-engine",
      `semantic-memory:${path.slice(4)}`,
      env,
    );
    try {
      return await operation();
    } finally {
      await releaseSupervisorLease(lease, env);
    }
  };

  return {
    async index(text, scope) {
      const result = await call("/v1/index", {
        text: boundedText(text, 4_000, "Semantic memory text"),
        userId: positiveUserId(scope.userId),
        ...(scope.metadata ? { metadata: scope.metadata } : {}),
      });
      if (
        !result ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        !Object.hasOwn(result, "mem0Id")
      ) {
        throw new SemanticMemoryServiceError("invalid_response");
      }
      const mem0Id = (result as { mem0Id: unknown }).mem0Id;
      if (mem0Id !== null && (typeof mem0Id !== "string" || mem0Id.length > 512)) {
        throw new SemanticMemoryServiceError("invalid_response");
      }
      return mem0Id;
    },

    async search(query, scope) {
      const topK = scope.topK ?? 24;
      if (!Number.isSafeInteger(topK) || topK < 1 || topK > 100) {
        throw new TypeError("Semantic memory result limit is invalid.");
      }
      const result = await call("/v1/search", {
        query: boundedText(query, 32_000, "Semantic memory query"),
        userId: positiveUserId(scope.userId),
        topK,
      });
      if (!Array.isArray(result) || result.length > 100) {
        throw new SemanticMemoryServiceError("invalid_response");
      }
      return result.map((item) => {
        if (
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          typeof (item as { mem0Id?: unknown }).mem0Id !== "string" ||
          typeof (item as { text?: unknown }).text !== "string" ||
          typeof (item as { similarity?: unknown }).similarity !== "number"
        ) {
          throw new SemanticMemoryServiceError("invalid_response");
        }
        const value = item as SemanticMemoryHit;
        if (
          value.mem0Id.length > 512 ||
          Buffer.byteLength(value.text, "utf8") > 32_000 ||
          !Number.isFinite(value.similarity) ||
          value.similarity < 0 ||
          value.similarity > 1
        ) {
          throw new SemanticMemoryServiceError("invalid_response");
        }
        return value;
      });
    },

    async extract(messages, scope) {
      if (
        !Array.isArray(messages) ||
        messages.length < 1 ||
        messages.length > 2 ||
        messages.some((message) =>
          !message ||
          (message.role !== "user" && message.role !== "assistant") ||
          typeof message.content !== "string" ||
          Buffer.byteLength(message.content, "utf8") > 4_000 ||
          /\u0000/u.test(message.content)
        )
      ) {
        throw new TypeError("Semantic memory extraction messages are invalid.");
      }
      const result = await call("/v1/extract", {
        messages,
        userId: positiveUserId(scope.userId),
      });
      if (!Array.isArray(result) || result.length > 100) {
        throw new SemanticMemoryServiceError("invalid_response");
      }
      return result.map((item) => {
        if (
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          typeof (item as { mem0Id?: unknown }).mem0Id !== "string" ||
          typeof (item as { text?: unknown }).text !== "string"
        ) {
          throw new SemanticMemoryServiceError("invalid_response");
        }
        const value = item as SemanticFact;
        if (value.mem0Id.length > 512 || Buffer.byteLength(value.text, "utf8") > 4_000) {
          throw new SemanticMemoryServiceError("invalid_response");
        }
        return value;
      });
    },

    async remove(mem0Id) {
      if (!mem0Id) return;
      await call("/v1/remove", {
        mem0Id: boundedText(mem0Id, 512, "Semantic memory id"),
      });
    },
  };
}

function configuredClient(
  env: NodeJS.ProcessEnv,
  leaseEachOperation: boolean,
): SemanticMemoryClient | null {
  const config = mem0Config(env);
  if (!config.enabled || !isRuntimeV2ServiceControlConfigured(env)) return null;
  const endpoint = serviceEndpoint(env);
  return endpoint ? rpcClient(endpoint, config.fingerprint, env, leaseEachOperation) : null;
}

/**
 * A client whose individual calls each hold a Runtime lease. This is useful to
 * callers that perform one operation; retrieval/extraction use the scoped
 * helper below so an entire multi-call reconciliation remains one lease.
 */
export async function semanticMemoryClient(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SemanticMemoryClient | null> {
  try {
    return configuredClient(env, true);
  } catch {
    return null;
  }
}

/** Hold exactly one lease across a complete semantic retrieval/extraction. */
export async function withSemanticMemoryClient<T>(
  reason: "retrieval" | "extraction",
  operation: (client: SemanticMemoryClient) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T | null> {
  let client: SemanticMemoryClient | null;
  try {
    client = configuredClient(env, false);
  } catch {
    return null;
  }
  if (!client) return null;
  let lease;
  try {
    // Semantic memory is optional for a turn. Wait a few seconds for a
    // starting engine, not its whole startup budget: a reply held for two
    // minutes because memory was still booting is worse than a reply without
    // that memory, and the engine keeps starting for the next turn.
    lease = await acquireServiceLease(
      "mem0-semantic-engine",
      `semantic-memory:${reason}`,
      env,
      { timeoutMs: SEMANTIC_MEMORY_LEASE_WAIT_MS },
    );
    return await operation(client);
  } catch (error) {
    if (error instanceof SupervisorResourceExhaustedError) throw error;
    throw error;
  } finally {
    await releaseSupervisorLease(lease, env);
  }
}
