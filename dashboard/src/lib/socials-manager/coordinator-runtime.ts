// Wiring the coordinator's injected dependencies to the real world.
//
// Kept apart from `coordinator-core.ts` on purpose: the state machine has no
// idea what Docker is, and this file has no idea what a state is. Only this
// file ever runs a Compose command, and only for the one project identity in
// `SocialsManagerConfig`.

import { PostizApiClient } from "./api-client.ts";
import { ensureApiKey } from "./bootstrap.ts";
import type { SocialsManagerConfig } from "./config.ts";
import { dockerStatus } from "./docker.ts";
import type { CoordinatorDeps, StartOutcome } from "./coordinator-core.ts";
import {
  reachable,
  readCredentials,
  startStack,
  stopStack,
  waitForReady,
  writeCredentials,
  type PostizStackOutput,
} from "./stack.ts";

/** The default idle window: long enough that ordinary use never notices it. */
export const DEFAULT_IDLE_TIMEOUT_MS = 25 * 60_000;

export function resolveIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.POSTIZ_IDLE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_IDLE_TIMEOUT_MS;
  const value = Number(raw);
  // A non-numeric or negative value is a misconfiguration, and the safe
  // reading of a broken idle setting is "never stop anything".
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * Does Postiz still owe someone a publish?
 *
 * Postiz is the system of record for scheduled publishing — its Temporal
 * workflows are derived from these posts — so the honest question is asked of
 * Postiz itself. Anything that stops the question being answerable (no API key
 * yet, the API refusing, a network error) returns `known: false`, and the
 * caller reads that as "keep the stack running".
 */
export async function pendingScheduledWork(
  config: SocialsManagerConfig,
  now: () => number = Date.now,
): Promise<{ known: boolean; pending: boolean; detail?: string }> {
  const apiKey = readCredentials(config)?.apiKey;
  if (!apiKey) return { known: false, pending: false, detail: "no_api_key" };
  const client = new PostizApiClient(config, apiKey);

  /** Anything Postiz still intends to publish inside the window. */
  const upcoming = (posts: Awaited<ReturnType<typeof client.listPosts>>): boolean =>
    posts.some((post) => {
      const at = Date.parse(post.publishDate);
      if (!Number.isFinite(at) || at <= now()) return false;
      const state = (post.state ?? "").toUpperCase();
      return state !== "PUBLISHED" && state !== "ERROR";
    });

  // Ninety days ahead. A schedule further out than that still keeps the stack
  // alive through the locally reported `nextScheduledAt`, and it is far past
  // the point where holding nine containers for it makes sense.
  const startDate = new Date(now()).toISOString();
  const endDate = new Date(now() + 90 * 86_400_000).toISOString();
  try {
    return { known: true, pending: upcoming(await client.listPosts({ startDate, endDate })) };
  } catch (rangeError) {
    // Older Postiz builds took `week`/`year` instead and 400 the ISO pair.
    try {
      for (const week of [isoWeek(new Date(now())), isoWeek(new Date(now() + 7 * 86_400_000))]) {
        if (upcoming(await client.listPosts(week))) return { known: true, pending: true };
      }
      return { known: true, pending: false };
    } catch {
      // Neither spelling answered. "The API refused" must never be read as
      // "nothing is scheduled", so the stack stays up and says why.
      return {
        known: false,
        pending: false,
        detail: rangeError instanceof Error ? rangeError.name : "api_error",
      };
    }
  }
}

function isoWeek(date: Date): { week: number; year: number } {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { week, year: target.getUTCFullYear() };
}

/**
 * Bootstrap the local Postiz account and confirm the public API answers.
 *
 * A credentials file can outlive the Docker volume it was minted against, so a
 * rejected key is cleared once and re-bootstrapped rather than reported as a
 * permanent failure. The account password is preserved either way — it is the
 * only copy in existence.
 */
export async function bootstrapPostiz(
  config: SocialsManagerConfig,
): Promise<{ ok: boolean; integrations: number; reason?: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const apiKey = await ensureApiKey(config);
      if (apiKey) {
        const client = new PostizApiClient(config, apiKey);
        return { ok: true, integrations: (await client.listIntegrations()).length };
      }
    } catch {
      // Fall through to the stale-key recovery below.
    }
    if (attempt === 0) {
      const credentials = readCredentials(config);
      if (credentials?.apiKey) writeCredentials(config, { ...credentials, apiKey: "" });
      else break;
    }
  }
  return { ok: false, integrations: 0, reason: "Postiz did not return a usable API key." };
}

export interface RuntimeDepsInput {
  config: SocialsManagerConfig;
  log: (line: string) => void;
  startupTimeoutMs: number;
  idleTimeoutMs: number;
  /** Live Compose output, already prefixed by the caller. */
  onComposeOutput?: PostizStackOutput;
}

interface ExternalLease {
  id: string;
}

async function acquirePostizStackLease(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExternalLease | null> {
  const raw = env.BREADBOARD_SUPERVISOR_CONTROL_URL?.trim();
  const token = env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN?.trim();
  if (!raw || !token) return null;
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Postiz admission control is not on loopback.");
  }
  const response = await fetch(`${url.origin}/v1/capabilities/postiz-stack/lease`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ reason: "social-operation" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    if (body.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
      throw new Error(
        `BREADBOARD_RESOURCE_EXHAUSTED: Windows commit headroom is ` +
          `${String(body.availableHeadroomMb)} MB; ${String(body.requiredHeadroomMb)} MB is required.`,
      );
    }
    throw new Error("Postiz admission control did not authorize startup.");
  }
  if (typeof body.leaseId !== "string") {
    throw new Error("Postiz admission control returned an invalid lease.");
  }
  return { id: body.leaseId };
}

async function releasePostizStackLease(
  lease: ExternalLease | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!lease) return;
  const raw = env.BREADBOARD_SUPERVISOR_CONTROL_URL?.trim();
  const token = env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN?.trim();
  if (!raw || !token) return;
  try {
    const url = new URL(raw);
    await fetch(`${url.origin}/v1/leases/${encodeURIComponent(lease.id)}/release`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // The supervisor also expires abandoned leases and drops all of them on
    // Electron shutdown. A release failure must not prevent compose down.
  }
}

/** The production dependency set. Tests build their own. */
export function realCoordinatorDeps(input: RuntimeDepsInput): CoordinatorDeps {
  const { config } = input;
  let stackLease: ExternalLease | null = null;
  return {
    config,
    reachable: () => reachable(config),
    startStack: async (): Promise<StartOutcome> => {
      try {
        stackLease ??= await acquirePostizStackLease();
      } catch (error) {
        return {
          ok: false,
          preExisting: false,
          reason: error instanceof Error ? error.message : "Postiz admission was denied.",
        };
      }
      const status = await startStack(config, input.onComposeOutput);
      if (status.state === "running" || status.state === "starting") {
        return { ok: true, preExisting: false };
      }
      await releasePostizStackLease(stackLease);
      stackLease = null;
      return {
        ok: false,
        preExisting: false,
        reason: status.reason ?? `The Postiz stack entered the ${status.state} state.`,
      };
    },
    stopStack: async () => {
      try {
        return await stopStack(config);
      } finally {
        await releasePostizStackLease(stackLease);
        stackLease = null;
      }
    },
    waitForReady: (timeoutMs) => waitForReady(config, timeoutMs),
    bootstrap: () => bootstrapPostiz(config),
    pendingWork: () => pendingScheduledWork(config),
    dockerAvailable: async () => (await dockerStatus()).daemonRunning,
    now: () => Date.now(),
    log: input.log,
    startupTimeoutMs: input.startupTimeoutMs,
    idleTimeoutMs: input.idleTimeoutMs,
  };
}
