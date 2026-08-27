// Authenticated dashboard client for the Runtime V2-owned Postiz coordinator.
//
// This module is intentionally process-free. It can acquire a native Runtime
// service lease and call one credentialed loopback HTTP service; it cannot
// import Docker, Compose, WSL, or the coordinator's execution helpers. A
// missing/unreachable coordinator therefore fails closed to local drafting.

import type { SocialsManagerConfig } from "./config.ts";
import type { ActivationReason, PostizStackState, StackOwnership } from "./coordinator-core.ts";
import { reachable, type StackStatus } from "./local-state.ts";
import {
  acquireServiceLease,
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
  releaseSupervisorLease,
} from "../supervisor-control.ts";

export interface PostizControlScope {
  userId: number;
  runId?: string;
  conversationPublicId?: string;
}

export interface CoordinatorEndpoint {
  url: string;
  token: string;
}

export interface ActivationOutcome {
  ready: boolean;
  state: PostizStackState;
  ownership: StackOwnership;
  reason?: string;
  /** Release with `releaseActivation` when the operation finishes. */
  leaseId?: string;
  via: "coordinator";
}

const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);
const CONTROL_TIMEOUT_MS = 5_000;
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 1024;

export function resolveCoordinatorEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): CoordinatorEndpoint | null {
  const raw =
    env.BREADBOARD_POSTIZ_COORDINATOR_SERVICE_URL?.trim() ||
    env.POSTIZ_COORDINATOR_URL?.trim();
  const token =
    env.BREADBOARD_POSTIZ_COORDINATOR_SERVICE_TOKEN?.trim() ||
    env.POSTIZ_COORDINATOR_TOKEN?.trim();
  if (!raw || !token) return null;
  const tokenBytes = Buffer.byteLength(token, "utf8");
  if (
    tokenBytes < MIN_TOKEN_BYTES ||
    tokenBytes > MAX_TOKEN_BYTES ||
    !/^[\x21-\x7e]+$/u.test(token)
  ) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "http:" ||
      !LOOPBACK.has(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return { url: parsed.origin, token };
  } catch {
    return null;
  }
}

function validateScope(scope: PostizControlScope): void {
  if (!Number.isSafeInteger(scope.userId) || scope.userId < 1) {
    throw new TypeError("A valid Postiz user scope is required.");
  }
  for (const value of [scope.runId, scope.conversationPublicId]) {
    if (
      value !== undefined &&
      (!value || Buffer.byteLength(value, "utf8") > 256 || /\p{Cc}/u.test(value))
    ) {
      throw new TypeError("The Postiz operation scope is invalid.");
    }
  }
}

async function boundedJson(response: Response): Promise<Record<string, unknown> | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;
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
      return null;
    }
    chunks.push(value);
  }
  try {
    const value: unknown = total
      ? JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8"))
      : {};
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function control(
  endpoint: CoordinatorEndpoint,
  path: "/status" | "/ensure-ready" | "/release" | "/stop",
  body: Record<string, unknown>,
  timeoutMs = CONTROL_TIMEOUT_MS,
): Promise<Record<string, unknown> | null> {
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded, "utf8") > MAX_REQUEST_BYTES) {
    throw new TypeError("The Postiz control request exceeded its bound.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(path, endpoint.url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        "content-type": "application/json",
      },
      body: encoded,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return boundedJson(response);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function withCoordinatorLease<T>(
  reason: string,
  operation: (endpoint: CoordinatorEndpoint) => Promise<T>,
  env: NodeJS.ProcessEnv,
): Promise<T> {
  const lease = await acquireServiceLease("postiz-coordinator", reason, env);
  if (isRuntimeV2ServiceControlConfigured(env) && !lease) {
    throw new Error("The Postiz coordinator did not grant a Runtime service lease.");
  }
  try {
    const endpoint = resolveCoordinatorEndpoint(env);
    if (!endpoint) throw new Error("The Postiz coordinator is not configured.");
    return await operation(endpoint);
  } finally {
    await releaseSupervisorLease(lease, env);
  }
}

/**
 * Keep the Runtime-owned coordinator admitted while performing a bounded
 * operation against an already-running stack. This does not ask the
 * coordinator to start Docker or Compose; it only prevents a process-free
 * "if running" caller from bypassing Runtime admission.
 */
export async function withPostizCoordinatorServiceLease<T>(
  scope: PostizControlScope,
  reason: string,
  operation: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  validateScope(scope);
  return withCoordinatorLease(`postiz:${reason}`, async () => operation(), env);
}

export interface ActivateInput {
  scope: PostizControlScope;
  reason: ActivationReason;
  timeoutMs: number;
  hold?: boolean;
  nextScheduledAt?: string | null;
}

/** Ask the Runtime-owned coordinator for a running, authenticated Postiz. */
export async function activateStack(
  _config: SocialsManagerConfig,
  input: ActivateInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ActivationOutcome> {
  validateScope(input.scope);
  return withCoordinatorLease<ActivationOutcome>(`postiz:${input.reason}`, async (endpoint) => {
    const result = await control(
      endpoint,
      "/ensure-ready",
      {
        scope: input.scope,
        reason: input.reason,
        timeoutMs: input.timeoutMs,
        hold: input.hold === true,
        nextScheduledAt: input.nextScheduledAt ?? null,
      },
      input.timeoutMs + CONTROL_TIMEOUT_MS,
    );
    if (
      !result ||
      typeof result.ready !== "boolean" ||
      !["stopped", "starting", "ready", "stopping", "failed"].includes(String(result.state)) ||
      !["unknown", "pre-existing", "breadboard"].includes(String(result.ownership))
    ) {
      return {
        ready: false,
        state: "failed",
        ownership: "unknown",
        via: "coordinator",
        reason: "The Postiz coordinator did not respond.",
      };
    }
    return {
      ready: result.ready,
      state: result.state as PostizStackState,
      ownership: result.ownership as StackOwnership,
      via: "coordinator",
      ...(typeof result.reason === "string" && result.reason
        ? { reason: result.reason.slice(0, 500) }
        : {}),
      ...(typeof result.leaseId === "string" && result.leaseId
        ? { leaseId: result.leaseId }
        : {}),
    };
  }, env).catch((error: unknown): ActivationOutcome => ({
    ready: false,
    state: "failed",
    ownership: "unknown",
    via: "coordinator",
    reason: error instanceof Error ? error.message.slice(0, 500) : "The Postiz coordinator did not respond.",
  }));
}

export async function releaseActivation(
  scope: PostizControlScope,
  leaseId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!leaseId) return;
  validateScope(scope);
  await withCoordinatorLease("postiz:release", async (endpoint) => {
    await control(endpoint, "/release", { scope, leaseId });
  }, env).catch(() => undefined);
}

/** Explicitly bring only the Postiz Compose project down. Volumes are retained. */
export async function deactivateStack(
  _config: SocialsManagerConfig,
  scope: PostizControlScope,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  validateScope(scope);
  return withCoordinatorLease("postiz:user-stop", async (endpoint) => {
    const result = await control(endpoint, "/stop", { scope }, 180_000);
    return result?.stopped === true;
  }, env).catch(() => false);
}

/**
 * Observe without waking Docker. Ordinary polling also avoids starting a
 * stopped coordinator; an explicit Docker diagnostic may lease it so the
 * process owner, rather than Next, performs `docker info`.
 */
export async function observeStack(
  config: SocialsManagerConfig,
  scope: PostizControlScope,
  options: { probeDocker?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<StackStatus & { coordinator?: Record<string, unknown> }> {
  validateScope(scope);
  const snapshot = await readSupervisedServiceSnapshot("postiz-coordinator", env).catch(() => null);
  const serviceActive = !snapshot || ["starting", "healthy", "degraded", "ready", "busy"].includes(snapshot.state);
  const endpoint = resolveCoordinatorEndpoint(env);
  if (endpoint && (serviceActive || options.probeDocker)) {
    const read = async (target: CoordinatorEndpoint) => control(target, "/status", {
      scope,
      probeDocker: options.probeDocker === true,
    });
    const coordinator = options.probeDocker && !serviceActive
      ? await withCoordinatorLease("postiz:docker-diagnostic", read, env).catch(() => null)
      : await read(endpoint);
    if (coordinator) {
      const state = coordinator.state as PostizStackState;
      return {
        state: state === "ready" ? "running" : state === "starting" ? "starting" : "stopped",
        reachable: state === "ready",
        coordinator,
        ...(coordinator.docker && typeof coordinator.docker === "object"
          ? { docker: coordinator.docker as StackStatus["docker"] }
          : {}),
        ...(typeof coordinator.reason === "string" && coordinator.reason
          ? { reason: coordinator.reason.slice(0, 500) }
          : {}),
      };
    }
  }

  // A plain loopback probe is process-free and keeps status accurate after a
  // coordinator restart while the scheduled Postiz containers remain alive.
  const running = await reachable(config);
  return { state: running ? "running" : "stopped", reachable: running };
}
