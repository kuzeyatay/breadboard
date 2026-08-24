// The dashboard's one way to ask for Postiz.
//
// In desktop mode the Electron supervisor runs a Postiz coordinator and hands
// this process its loopback URL and a per-launch capability token. Every
// activation, stop and status read then goes through that coordinator, so
// exactly one component in the whole application runs Docker commands, and two
// simultaneous Socials Manager operations cannot issue two `compose up`s.
//
// In a bare `npm run dev:dashboard` checkout there is no coordinator, and this
// falls back to driving `stack.ts` directly. The fallback cannot race the
// coordinator, because the two are mutually exclusive by construction: it is
// selected precisely when no coordinator URL was configured.

import type { SocialsManagerConfig } from "./config.ts";
import type { ActivationReason, PostizStackState, StackOwnership } from "./coordinator-core.ts";
import { stackStatus, startStack, stopStack, waitForReady, type StackStatus } from "./stack.ts";

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
  /** Which component actually decided: the coordinator, or the local fallback. */
  via: "coordinator" | "direct";
}

const CONTROL_TIMEOUT_MS = 5_000;

/**
 * The coordinator, if this process was told about one.
 *
 * Both halves are required. A URL without a token would produce control calls
 * that are refused, which is worse than falling back cleanly.
 */
export function resolveCoordinatorEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): CoordinatorEndpoint | null {
  const url = env.POSTIZ_COORDINATOR_URL?.trim();
  const token = env.POSTIZ_COORDINATOR_TOKEN?.trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    // Loopback only, always. A coordinator anywhere else is a configuration
    // mistake, and sending the capability token to it would leak it.
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
    return { url: parsed.origin, token };
  } catch {
    return null;
  }
}

async function control<T>(
  endpoint: CoordinatorEndpoint,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number },
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? CONTROL_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint.url}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ActivateInput {
  /** A closed category, never free text: it is logged and echoed back. */
  reason: ActivationReason;
  /** How long the caller will wait before degrading to local drafting. */
  timeoutMs: number;
  /** Pin the stack until `releaseActivation`. Use for the length of a run. */
  hold?: boolean;
  /** The caller's own next scheduled publish, so idle shutdown can see it. */
  nextScheduledAt?: string | null;
}

/**
 * Ask for a running, authenticated Postiz.
 *
 * This is the *only* function in the dashboard that may cause Docker to start,
 * and it is reached only from an authenticated server-side operation that
 * genuinely needs Postiz.
 */
export async function activateStack(
  config: SocialsManagerConfig,
  input: ActivateInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ActivationOutcome> {
  const endpoint = resolveCoordinatorEndpoint(env);
  if (endpoint) {
    const result = await control<{
      ready: boolean;
      state: PostizStackState;
      ownership: StackOwnership;
      reason?: string;
      leaseId?: string;
    }>(endpoint, "/ensure-ready", {
      method: "POST",
      body: {
        reason: input.reason,
        timeoutMs: input.timeoutMs,
        ...(input.hold ? { hold: true } : {}),
        ...(input.nextScheduledAt ? { nextScheduledAt: input.nextScheduledAt } : {}),
      },
      // The coordinator answers within the caller's own budget; allow it a
      // little more than that before giving up on the coordinator itself.
      timeoutMs: input.timeoutMs + CONTROL_TIMEOUT_MS,
    });
    if (result) {
      return {
        ready: result.ready,
        state: result.state,
        ownership: result.ownership,
        via: "coordinator",
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.leaseId ? { leaseId: result.leaseId } : {}),
      };
    }
    // The coordinator is configured but unreachable. Falling through to a
    // direct `compose up` here would create the second launcher this design
    // exists to remove, so report honestly and let the caller draft locally.
    return {
      ready: false,
      state: "failed",
      ownership: "unknown",
      via: "coordinator",
      reason: "The Postiz coordinator did not respond.",
    };
  }

  // The dashboard-only fallback. `startStack` returns as soon as Compose exits,
  // which is before Postiz has migrated, so this keeps the caller's own budget
  // rather than reporting "starting" the instant the containers exist.
  const status = await startStack(config);
  const ready =
    status.state === "running" ||
    (status.state === "starting" && (await waitForReady(config, input.timeoutMs)));
  return {
    ready,
    state: ready ? "ready" : status.state === "starting" ? "starting" : "stopped",
    ownership: "breadboard",
    via: "direct",
    ...(ready ? {} : status.reason ? { reason: status.reason } : {}),
  };
}

/** Drop a hold taken by `activateStack({ hold: true })`. Always safe to call. */
export async function releaseActivation(
  leaseId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!leaseId) return;
  const endpoint = resolveCoordinatorEndpoint(env);
  if (!endpoint) return;
  await control(endpoint, "/release", { method: "POST", body: { leaseId } });
}

/** Explicitly bring the stack down. Never deletes volumes. */
export async function deactivateStack(
  config: SocialsManagerConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const endpoint = resolveCoordinatorEndpoint(env);
  if (endpoint) {
    const result = await control<{ stopped: boolean }>(endpoint, "/stop", {
      method: "POST",
      timeoutMs: 180_000,
    });
    return result?.stopped === true;
  }
  return stopStack(config);
}

/**
 * Read the stack's state without changing it.
 *
 * Nothing here starts Docker, and by default nothing here *runs* Docker at all:
 * the coordinator answers from its state machine, and the fallback answers from
 * one plain HTTP probe of the Postiz backend. `probeDocker` opts a caller into
 * a read-only engine check for diagnostics.
 */
export async function observeStack(
  config: SocialsManagerConfig,
  options: { probeDocker?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<StackStatus & { coordinator?: Record<string, unknown> }> {
  const endpoint = resolveCoordinatorEndpoint(env);
  if (endpoint) {
    const snapshot = await control<Record<string, unknown>>(endpoint, "/status", {
      method: "GET",
    });
    if (snapshot) {
      const state = snapshot.state as PostizStackState;
      return {
        state: state === "ready" ? "running" : state === "starting" ? "starting" : "stopped",
        reachable: state === "ready",
        coordinator: snapshot,
        ...(typeof snapshot.reason === "string" && snapshot.reason
          ? { reason: snapshot.reason }
          : {}),
      };
    }
  }
  return stackStatus(config, options);
}
