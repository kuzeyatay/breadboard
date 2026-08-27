import {
  acquireServiceLease,
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
  releaseSupervisorLease,
  SupervisorResourceExhaustedError,
  type SupervisorLease,
} from "../../supervisor-control.ts";
import { CadServiceError } from "../errors.ts";
import { inspectSolidWorksConfiguration } from "./configuration.ts";
import type {
  SolidWorksBridgeLike,
  SolidWorksBridgeStatus,
  SolidWorksToolResult,
} from "./protocol.ts";
import type { SolidWorksAvailability } from "./status.ts";

const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const STATUS_TIMEOUT_MS = 5_000;
const STARTUP_TIMEOUT_MS = 310_000;
const DEFAULT_CALL_TIMEOUT_MS = 120_000;

type ServiceEndpoint = { origin: string; token: string };
type ServiceEnvelope = {
  ok?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
};

export interface SolidWorksRuntimeStatus {
  availability: SolidWorksAvailability;
  bridge: SolidWorksBridgeStatus;
}

const STOPPED_BRIDGE: SolidWorksBridgeStatus = {
  running: false,
  ownsSolidWorks: false,
  startedAt: null,
  toolCount: 0,
  log: "",
};

function managed(env: NodeJS.ProcessEnv): boolean {
  return (
    env.BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED?.trim() === "1" &&
    isRuntimeV2ServiceControlConfigured(env)
  );
}

function endpoint(env: NodeJS.ProcessEnv): ServiceEndpoint {
  if (!managed(env)) {
    throw new CadServiceError(
      "solidworks_unavailable",
      "The SolidWorks bridge is not connected to the Runtime V2 service owner.",
    );
  }
  const raw = env.BREADBOARD_SOLIDWORKS_SERVICE_URL?.trim() ?? "";
  const token = env.BREADBOARD_SOLIDWORKS_SERVICE_TOKEN?.trim() ?? "";
  const tokenBytes = Buffer.from(token, "utf8");
  if (
    tokenBytes.byteLength < MIN_TOKEN_BYTES ||
    tokenBytes.byteLength > MAX_TOKEN_BYTES ||
    !tokenBytes.every((byte) => byte >= 0x21 && byte <= 0x7e)
  ) {
    throw new CadServiceError(
      "solidworks_unavailable",
      "The SolidWorks Runtime service capability is invalid.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CadServiceError(
      "solidworks_unavailable",
      "The SolidWorks Runtime service endpoint is invalid.",
    );
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
    throw new CadServiceError(
      "solidworks_unavailable",
      "The SolidWorks Runtime service endpoint must use credential-free loopback HTTP.",
    );
  }
  return { origin: url.origin, token };
}

async function readEnvelope(response: Response): Promise<ServiceEnvelope> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new CadServiceError(
      "solidworks_bridge_failed",
      "The SolidWorks Runtime service returned an oversized response.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new CadServiceError(
      "solidworks_bridge_failed",
      "The SolidWorks Runtime service returned an empty response.",
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new CadServiceError(
          "solidworks_bridge_failed",
          "The SolidWorks Runtime service returned an oversized response.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as ServiceEnvelope;
  } catch (error) {
    if (error instanceof CadServiceError) throw error;
    throw new CadServiceError(
      "solidworks_bridge_failed",
      "The SolidWorks Runtime service returned invalid JSON.",
    );
  }
}

function retryable(code: string): boolean {
  return new Set([
    "solidworks_bridge_crashed",
    "solidworks_bridge_timeout",
    "solidworks_operation_timeout",
    "solidworks_operation_failed",
    "solidworks_tool_failed",
  ]).has(code);
}

async function request(
  route: "/v1/status" | "/v1/ensure" | "/v1/list-tools" | "/v1/call",
  body: Record<string, unknown>,
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal },
): Promise<unknown> {
  const target = endpoint(options.env);
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded, "utf8") > 512 * 1024) {
    throw new TypeError("The SolidWorks bridge request exceeded its bound.");
  }
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(`${target.origin}${route}`, {
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
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.ok !== true || !Object.hasOwn(envelope, "result")) {
      const code =
        typeof envelope.error?.code === "string" &&
        /^[a-z0-9_-]{1,64}$/u.test(envelope.error.code)
          ? envelope.error.code
          : "solidworks_bridge_failed";
      const message =
        typeof envelope.error?.message === "string"
          ? envelope.error.message.slice(0, 8_192)
          : "The SolidWorks Runtime service rejected the request.";
      throw new CadServiceError(code, message, { retryable: retryable(code), detail: message });
    }
    return envelope.result;
  } catch (error) {
    if (error instanceof CadServiceError || error instanceof TypeError) throw error;
    if (options.signal?.aborted) {
      throw new CadServiceError("solidworks_aborted", "The SolidWorks build was cancelled.");
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new CadServiceError(
        route === "/v1/ensure" ? "solidworks_bridge_timeout" : "solidworks_operation_timeout",
        route === "/v1/ensure"
          ? "The SolidWorks bridge did not finish starting in time. SolidWorks may be showing a dialog that needs dismissing."
          : "The SolidWorks operation did not finish in time.",
        { retryable: true },
      );
    }
    throw new CadServiceError(
      "solidworks_bridge_crashed",
      "The SolidWorks Runtime service stopped before it answered.",
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBridgeStatus(value: unknown): SolidWorksBridgeStatus {
  if (!record(value)) throw new CadServiceError("solidworks_bridge_failed", "Invalid SolidWorks bridge status.");
  const running = value.running;
  const ownsSolidWorks = value.ownsSolidWorks;
  const startedAt = value.startedAt;
  const toolCount = value.toolCount;
  const log = value.log;
  if (
    typeof running !== "boolean" ||
    typeof ownsSolidWorks !== "boolean" ||
    (startedAt !== null &&
      (typeof startedAt !== "string" || Buffer.byteLength(startedAt, "utf8") > 64)) ||
    !Number.isSafeInteger(toolCount) ||
    (toolCount as number) < 0 ||
    (toolCount as number) > 10_000 ||
    typeof log !== "string" ||
    Buffer.byteLength(log, "utf8") > 64 * 1024
  ) {
    throw new CadServiceError("solidworks_bridge_failed", "Invalid SolidWorks bridge status.");
  }
  return { running, ownsSolidWorks, startedAt, toolCount: toolCount as number, log };
}

function parseAvailability(value: unknown): SolidWorksAvailability {
  if (!record(value)) throw new CadServiceError("solidworks_bridge_failed", "Invalid SolidWorks availability status.");
  const code = value.code;
  const codes = new Set([
    "available",
    "unsupported_os",
    "mcp_not_configured",
    "python_missing",
    "dependencies_missing",
    "solidworks_not_installed",
  ]);
  if (
    typeof value.available !== "boolean" ||
    typeof code !== "string" ||
    !codes.has(code) ||
    typeof value.message !== "string" ||
    Buffer.byteLength(value.message, "utf8") > 8_192 ||
    (value.clonePath !== null && typeof value.clonePath !== "string") ||
    (value.running !== null && typeof value.running !== "boolean") ||
    (value.version !== null &&
      (!Number.isSafeInteger(value.version) || (value.version as number) < 2000 || (value.version as number) > 2100))
  ) {
    throw new CadServiceError("solidworks_bridge_failed", "Invalid SolidWorks availability status.");
  }
  return value as unknown as SolidWorksAvailability;
}

function parseRuntimeStatus(value: unknown): SolidWorksRuntimeStatus {
  if (!record(value)) throw new CadServiceError("solidworks_bridge_failed", "Invalid SolidWorks Runtime status.");
  return {
    availability: parseAvailability(value.availability),
    bridge: parseBridgeStatus(value.bridge),
  };
}

function unavailable(message: string, env: NodeJS.ProcessEnv): SolidWorksRuntimeStatus {
  const configured = inspectSolidWorksConfiguration(env);
  return {
    availability: {
      ...configured,
      available: false,
      code: configured.code === "unsupported_os" ? "unsupported_os" : "dependencies_missing",
      message,
    },
    bridge: STOPPED_BRIDGE,
  };
}

/** Passive: this never acquires a lease and never starts the service or SolidWorks. */
export async function readSolidWorksRuntimeStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SolidWorksRuntimeStatus> {
  if (!managed(env)) {
    return unavailable(
      "SolidWorks backend unavailable: the Runtime V2 service owner is not connected.",
      env,
    );
  }
  const configured = inspectSolidWorksConfiguration(env);
  const snapshot = await readSupervisedServiceSnapshot("solidworks-mcp", env).catch(() => null);
  if (!snapshot) return unavailable("SolidWorks backend unavailable: Runtime status is unavailable.", env);
  if (snapshot.state === "resource-blocked") {
    return unavailable("SolidWorks backend unavailable: there is not enough memory headroom to start its bridge.", env);
  }
  if (snapshot.state === "installation-unavailable") {
    return unavailable("SolidWorks backend unavailable: its sealed bridge installation is incomplete.", env);
  }
  if (snapshot.state === "failed") {
    return unavailable("SolidWorks backend unavailable: its Runtime service failed to start.", env);
  }
  if (!["healthy", "ready", "busy", "degraded"].includes(snapshot.state)) {
    return { availability: configured, bridge: STOPPED_BRIDGE };
  }
  try {
    return parseRuntimeStatus(
      await request("/v1/status", {}, { env, timeoutMs: STATUS_TIMEOUT_MS }),
    );
  } catch {
    return unavailable("SolidWorks backend unavailable: its Runtime service did not answer.", env);
  }
}

export async function acquireSolidWorksRuntimeLease(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SupervisorLease | null> {
  if (!managed(env)) {
    throw new CadServiceError(
      "solidworks_unavailable",
      "The SolidWorks bridge is not connected to the Runtime V2 service owner.",
    );
  }
  try {
    const lease = await acquireServiceLease("solidworks-mcp", "cad-solidworks-build", env);
    if (!lease) {
      throw new CadServiceError(
        "solidworks_unavailable",
        "The SolidWorks Runtime service did not grant a lease.",
      );
    }
    return lease;
  } catch (error) {
    if (error instanceof CadServiceError) throw error;
    if (error instanceof SupervisorResourceExhaustedError) {
      throw new CadServiceError("solidworks_unavailable", error.message, { detail: error.message });
    }
    throw new CadServiceError(
      "solidworks_unavailable",
      "The SolidWorks Runtime service could not be started.",
      { detail: error instanceof Error ? error.message : String(error) },
    );
  }
}

export async function releaseSolidWorksRuntimeLease(
  lease: SupervisorLease | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await releaseSupervisorLease(lease, env);
}

export function solidWorksRuntimeBridge(
  env: NodeJS.ProcessEnv = process.env,
): SolidWorksBridgeLike {
  let attached = false;
  return {
    async ensureStarted(): Promise<void> {
      const value = await request("/v1/ensure", {}, { env, timeoutMs: STARTUP_TIMEOUT_MS });
      if (!record(value) || typeof value.attachedToExistingSession !== "boolean") {
        throw new CadServiceError("solidworks_bridge_failed", "Invalid SolidWorks startup response.");
      }
      attached = value.attachedToExistingSession;
    },
    attachedToExistingSession(): boolean {
      return attached;
    },
    async callTool(name, args, options = {}): Promise<SolidWorksToolResult> {
      const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
      const value = await request(
        "/v1/call",
        { name, arguments: args, timeoutMs },
        { env, timeoutMs: timeoutMs + 5_000, ...(options.signal ? { signal: options.signal } : {}) },
      );
      if (
        !record(value) ||
        !record(value.data) ||
        typeof value.text !== "string" ||
        Buffer.byteLength(value.text, "utf8") > 256 * 1024 ||
        typeof value.isError !== "boolean" ||
        !record(value.raw)
      ) {
        throw new CadServiceError("solidworks_bridge_failed", "Invalid SolidWorks tool response.");
      }
      return value as unknown as SolidWorksToolResult;
    },
    async listTools(): Promise<number> {
      const value = await request("/v1/list-tools", {}, { env, timeoutMs: 35_000 });
      if (!record(value) || !Number.isSafeInteger(value.count) || (value.count as number) < 0) {
        throw new CadServiceError("solidworks_bridge_failed", "Invalid SolidWorks tool-list response.");
      }
      return value.count as number;
    },
  };
}
