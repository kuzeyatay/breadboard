// Server-only control client for the Runtime-owned Recall capture service.
//
// Recording is durable desired state, not a request-scoped lease: once a user
// explicitly starts capture (or opts into auto-start), the Rust Runtime keeps
// it alive across dashboard restarts until that same owner explicitly stops it.

import { RecallError } from "./errors.ts";
import { normalizeExcludedWindows, type RecallSettings } from "./policy.ts";
import type { SupervisedServiceLifecycleState } from "../supervisor-control.ts";
import { runtimeControlTransports } from "../runtime-control-transport.ts";

if (typeof window !== "undefined") {
  throw new Error("Recall Runtime control is server-only.");
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const STATUS_TIMEOUT_MS = 5_000;
const RECONCILE_TIMEOUT_MS = 2 * 60_000;
const MAX_LOG_LINES = 40;
const MAX_LOG_BYTES = 16 * 1_024;

const SERVICE_STATES = new Set<SupervisedServiceLifecycleState>([
  "pending",
  "starting",
  "healthy",
  "degraded",
  "failed",
  "stopping",
  "stopped",
  "available-but-stopped",
  "ready",
  "busy",
  "resource-blocked",
  "installation-unavailable",
]);

const ACTIVE_PROCESS_STATES = new Set<SupervisedServiceLifecycleState>([
  "pending",
  "starting",
  "healthy",
  "degraded",
  "ready",
  "busy",
]);

interface RuntimeEndpoint {
  origin: string;
  token: string;
}

export type RecallRuntimeDesiredState = "running" | "stopped";

export interface RecallRuntimeStatus {
  protocolVersion: 1;
  ok: true;
  serviceId: "recall";
  desiredState: RecallRuntimeDesiredState;
  serviceState: SupervisedServiceLifecycleState;
  ownedByRequester: boolean;
  logTail: string[];
}

interface RecallRuntimeReconcileResult {
  protocolVersion: 1;
  ok: true;
  serviceId: "recall";
  desiredState: RecallRuntimeDesiredState;
  serviceState: "healthy" | "stopped";
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function recallRuntimeManaged(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.RECALL_RUNTIME_MANAGED?.trim() === "1";
}

function endpoint(env: NodeJS.ProcessEnv): RuntimeEndpoint {
  const raw = env.BREADBOARD_SUPERVISOR_CONTROL_URL?.trim();
  const token = env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN?.trim();
  if (!raw || !token) {
    throw new RecallError("engine_unavailable", {
      detail: "managed Recall Runtime control is not configured",
    });
  }
  const tokenBytes = Buffer.byteLength(token, "utf8");
  if (
    tokenBytes < MIN_TOKEN_BYTES ||
    tokenBytes > MAX_TOKEN_BYTES ||
    !/^[\x21-\x7e]+$/u.test(token)
  ) {
    throw new RecallError("engine_unavailable", {
      detail: "managed Recall Runtime capability is invalid",
    });
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new RecallError("engine_unavailable", {
      detail: "managed Recall Runtime URL is invalid",
      cause,
    });
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new RecallError("engine_unavailable", {
      detail: "managed Recall Runtime URL is not a loopback origin",
    });
  }
  return { origin: url.origin, token };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  ) {
    throw new Error("Recall Runtime returned an oversized response.");
  }
  if (!response.body)
    throw new Error("Recall Runtime returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Recall Runtime returned an oversized response.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Recall Runtime returned invalid JSON.");
  }
}

function validateUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new RecallError("invalid_input", { detail: "invalid Recall owner" });
  }
}

async function post(
  route: "/v1/services/recall/status" | "/v1/services/recall/reconcile",
  userId: number,
  body: Record<string, unknown>,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  validateUserId(userId);
  const target = endpoint(env);
  let response: Response;
  try {
    response = await runtimeControlTransports().service(`${target.origin}${route}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${target.token}`,
        "content-type": "application/json",
        "x-breadboard-user-id": String(userId),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new RecallError("engine_unavailable", {
      detail: "managed Recall Runtime request failed",
      cause,
    });
  }
  let value: unknown;
  try {
    value = await readBoundedJson(response);
  } catch (cause) {
    throw new RecallError("engine_unavailable", {
      detail: "managed Recall Runtime response was invalid",
      cause,
    });
  }
  if (!response.ok) {
    throw new RecallError(
      route.endsWith("/reconcile") && body.desiredState === "stopped"
        ? "engine_stop_failed"
        : route.endsWith("/reconcile")
          ? "engine_start_failed"
          : "engine_unavailable",
      {
        detail: `managed Recall Runtime rejected the request (${response.status})`,
      },
    );
  }
  return value;
}

function parseLogTail(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_LOG_LINES) {
    throw new Error("Recall Runtime returned an invalid log tail.");
  }
  let total = 0;
  const result: string[] = [];
  for (const line of value) {
    if (typeof line !== "string" || /[\u0000]/u.test(line)) {
      throw new Error("Recall Runtime returned an invalid log line.");
    }
    total += Buffer.byteLength(line, "utf8");
    if (total > MAX_LOG_BYTES) {
      throw new Error("Recall Runtime returned an oversized log tail.");
    }
    result.push(line);
  }
  return result;
}

export async function readRecallRuntimeStatus(
  userId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RecallRuntimeStatus | null> {
  if (!recallRuntimeManaged(env)) return null;
  const value = await post(
    "/v1/services/recall/status",
    userId,
    {},
    STATUS_TIMEOUT_MS,
    env,
  );
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "ok",
      "serviceId",
      "desiredState",
      "serviceState",
      "ownedByRequester",
      "logTail",
    ]) ||
    value.protocolVersion !== 1 ||
    value.ok !== true ||
    value.serviceId !== "recall" ||
    (value.desiredState !== "running" && value.desiredState !== "stopped") ||
    typeof value.serviceState !== "string" ||
    !SERVICE_STATES.has(
      value.serviceState as SupervisedServiceLifecycleState,
    ) ||
    typeof value.ownedByRequester !== "boolean"
  ) {
    throw new RecallError("engine_unavailable", {
      detail: "managed Recall Runtime returned an invalid status",
    });
  }
  let logTail: string[];
  try {
    logTail = parseLogTail(value.logTail);
  } catch (cause) {
    throw new RecallError("engine_unavailable", {
      detail: "managed Recall Runtime returned invalid diagnostics",
      cause,
    });
  }
  return {
    protocolVersion: 1,
    ok: true,
    serviceId: "recall",
    desiredState: value.desiredState,
    serviceState: value.serviceState as SupervisedServiceLifecycleState,
    ownedByRequester: value.ownedByRequester,
    logTail,
  };
}

export async function reconcileRecallRuntime(
  userId: number,
  desiredState: RecallRuntimeDesiredState,
  settings: RecallSettings | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RecallRuntimeReconcileResult> {
  if (!recallRuntimeManaged(env)) {
    throw new RecallError(
      desiredState === "running" ? "engine_start_failed" : "engine_stop_failed",
      {
        detail:
          "an explicitly external Recall endpoint has no local lifecycle owner",
      },
    );
  }
  const body: Record<string, unknown> =
    desiredState === "running"
      ? {
          desiredState,
          configuration: {
            captureAudio: settings?.captureAudio === true,
            excludedWindows: normalizeExcludedWindows(
              settings?.excludedWindows,
            ),
          },
        }
      : { desiredState };
  const value = await post(
    "/v1/services/recall/reconcile",
    userId,
    body,
    RECONCILE_TIMEOUT_MS,
    env,
  );
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "ok",
      "serviceId",
      "desiredState",
      "serviceState",
    ]) ||
    value.protocolVersion !== 1 ||
    value.ok !== true ||
    value.serviceId !== "recall" ||
    value.desiredState !== desiredState ||
    value.serviceState !== (desiredState === "running" ? "healthy" : "stopped")
  ) {
    throw new RecallError(
      desiredState === "running" ? "engine_start_failed" : "engine_stop_failed",
      { detail: "managed Recall Runtime did not apply the requested state" },
    );
  }
  return value as unknown as RecallRuntimeReconcileResult;
}

export function recallRuntimeProcessRunning(
  status: RecallRuntimeStatus | null,
): boolean {
  return Boolean(
    status &&
    status.desiredState === "running" &&
    ACTIVE_PROCESS_STATES.has(status.serviceState),
  );
}
