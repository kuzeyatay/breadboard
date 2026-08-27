// Wiring the coordinator's injected dependencies to the real world.
//
// Kept apart from `coordinator-core.ts` on purpose: the state machine has no
// idea what Docker is, and this file has no idea what a state is. Only this
// file ever runs a Compose command, and only for the one project identity in
// `SocialsManagerConfig`.

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

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
const OWNERSHIP_RECEIPT_VERSION = 1;
const OWNERSHIP_RECEIPT_BYTES = 1_024;
const OWNERSHIP_RECEIPT_FILE = "runtime-v2-stack-ownership.json";

function ownershipReceiptPath(config: SocialsManagerConfig): string {
  return path.join(config.stateDir, OWNERSHIP_RECEIPT_FILE);
}

/**
 * Recover only an exact, small receipt written for Breadboard's sealed Compose
 * project. Corruption, links and future versions all resolve to "not ours",
 * which prevents an automatic stop.
 */
export function hasStackOwnershipReceipt(config: SocialsManagerConfig): boolean {
  const target = ownershipReceiptPath(config);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > OWNERSHIP_RECEIPT_BYTES) {
      return false;
    }
    const value: unknown = JSON.parse(fs.readFileSync(target, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const receipt = value as Record<string, unknown>;
    return (
      Object.keys(receipt).sort().join(",") === "projectName,version" &&
      receipt.version === OWNERSHIP_RECEIPT_VERSION &&
      receipt.projectName === config.projectName
    );
  } catch {
    return false;
  }
}

/** Write the ownership handoff before the in-memory coordinator may claim it. */
export function recordStackOwnership(config: SocialsManagerConfig): void {
  fs.mkdirSync(config.stateDir, { recursive: true });
  const target = ownershipReceiptPath(config);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const body = `${JSON.stringify({
    version: OWNERSHIP_RECEIPT_VERSION,
    projectName: config.projectName,
  })}\n`;
  try {
    fs.writeFileSync(temporary, body, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (!new Set(["EEXIST", "EPERM"]).has(code)) throw error;
      fs.rmSync(target, { force: true });
      fs.renameSync(temporary, target);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function clearStackOwnership(config: SocialsManagerConfig): void {
  fs.rmSync(ownershipReceiptPath(config), { force: true });
}

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
  timer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

const LEASE_ROTATION_MS = 5 * 60_000;
const LEASE_RETRY_MS = 10_000;

interface RuntimeControlTarget {
  origin: string;
  token: string;
}

function runtimeControlTarget(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeControlTarget | null {
  const raw = env.BREADBOARD_SUPERVISOR_CONTROL_URL?.trim();
  const token = env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN?.trim();
  if (!raw && !token) return null;
  if (!raw || !token) throw new Error("Postiz admission control configuration is incomplete.");
  const tokenBytes = Buffer.from(token, "utf8");
  if (
    tokenBytes.byteLength < 32 ||
    tokenBytes.byteLength > 1024 ||
    !tokenBytes.every((byte) => byte >= 0x21 && byte <= 0x7e)
  ) throw new Error("Postiz admission control capability is invalid.");
  const url = new URL(raw);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Postiz admission control is not exact loopback HTTP.");
  }
  return { origin: url.origin, token };
}

async function boundedRuntimeJson(response: Response): Promise<Record<string, unknown>> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > 64 * 1024)) {
    throw new Error("Postiz admission control returned an oversized response.");
  }
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 64 * 1024) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Postiz admission control returned an oversized response.");
    }
    chunks.push(value);
  }
  try {
    const parsed: unknown = total
      ? JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8"))
      : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function acquireRuntimeServiceLease(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const target = runtimeControlTarget(env);
  if (!target) return null;
  const response = await fetch(`${target.origin}/v1/services/postiz-coordinator/lease`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ reason: "social-operation" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await boundedRuntimeJson(response);
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
  if (body.serviceId !== "postiz-coordinator") {
    throw new Error("Postiz admission control escaped its service binding.");
  }
  return body.leaseId;
}

async function releaseRuntimeServiceLease(
  leaseId: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!leaseId) return;
  try {
    const target = runtimeControlTarget(env);
    if (!target) return;
    await fetch(`${target.origin}/v1/leases/${encodeURIComponent(leaseId)}/release`, {
      method: "POST",
      headers: { authorization: `Bearer ${target.token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // The supervisor also expires abandoned leases and drops all of them on
    // Runtime shutdown. A release failure must not prevent Compose down.
  }
}

async function holdPostizStackLease(
  env: NodeJS.ProcessEnv,
  log: (line: string) => void,
): Promise<ExternalLease | null> {
  const id = await acquireRuntimeServiceLease(env);
  if (!id) return null;
  const lease: ExternalLease = { id, timer: null, closed: false };
  const schedule = (delay = LEASE_ROTATION_MS) => {
    if (lease.closed) return;
    lease.timer = setTimeout(() => {
      void (async () => {
        try {
          const replacement = await acquireRuntimeServiceLease(env);
          if (!replacement) throw new Error("runtime control unavailable");
          const previous = lease.id;
          lease.id = replacement;
          await releaseRuntimeServiceLease(previous, env);
          schedule();
        } catch {
          log("[postiz] Runtime stack lease renewal deferred");
          schedule(LEASE_RETRY_MS);
        }
      })();
    }, delay);
    lease.timer.unref?.();
  };
  schedule();
  return lease;
}

async function releasePostizStackLease(
  lease: ExternalLease | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!lease) return;
  lease.closed = true;
  if (lease.timer) clearTimeout(lease.timer);
  lease.timer = null;
  await releaseRuntimeServiceLease(lease.id, env);
}

/** The production dependency set. Tests build their own. */
export function realCoordinatorDeps(input: RuntimeDepsInput): CoordinatorDeps {
  const { config } = input;
  let stackLease: ExternalLease | null = null;
  const ensureAdmission = async (): Promise<void> => {
    stackLease ??= await holdPostizStackLease(process.env, input.log);
  };
  return {
    config,
    recoverOwnership: async () => hasStackOwnershipReceipt(config),
    reachable: async () => {
      const running = await reachable(config);
      if (running && !stackLease) await ensureAdmission();
      return running;
    },
    startStack: async (): Promise<StartOutcome> => {
      try {
        await ensureAdmission();
      } catch (error) {
        return {
          ok: false,
          preExisting: false,
          reason: error instanceof Error ? error.message : "Postiz admission was denied.",
        };
      }
      let ownsRunningStack = false;
      try {
        // No reachable stack was observed immediately before this call. Remove
        // any receipt left by a stack that disappeared outside the coordinator,
        // so it cannot confer ownership on unrelated containers later.
        clearStackOwnership(config);
        const status = await startStack(config, input.onComposeOutput);
        if (status.state === "running" || status.state === "starting") {
          ownsRunningStack = true;
          try {
            recordStackOwnership(config);
          } catch (error) {
            // The current coordinator still owns and will clean up this stack.
            // If it crashes, the missing receipt deliberately recovers as
            // pre-existing rather than risking an unauthorized stop.
            input.log(
              `[postiz] ownership receipt unavailable (${error instanceof Error ? error.name : "error"}); ` +
                "crash recovery will preserve the stack",
            );
          }
          return { ok: true, preExisting: false };
        }
        return {
          ok: false,
          preExisting: false,
          reason: status.reason ?? `The Postiz stack entered the ${status.state} state.`,
        };
      } catch (error) {
        return {
          ok: false,
          preExisting: false,
          reason: error instanceof Error
            ? `Postiz stack startup failed (${error.name}).`
            : "Postiz stack startup failed.",
        };
      } finally {
        if (!ownsRunningStack) {
          await releasePostizStackLease(stackLease);
          stackLease = null;
        }
      }
    },
    stopStack: async () => {
      try {
        // Revoke durable stop authority first. If Compose down fails, restore
        // it for the next recovery attempt; failure to restore is still safe
        // because an unknown stack is never stopped automatically.
        clearStackOwnership(config);
        const stopped = await stopStack(config);
        if (!stopped) {
          try {
            recordStackOwnership(config);
          } catch {
            input.log("[postiz] ownership receipt could not be restored; preserving on recovery");
          }
        }
        return stopped;
      } catch (error) {
        try {
          recordStackOwnership(config);
        } catch {
          input.log("[postiz] ownership receipt could not be restored; preserving on recovery");
        }
        input.log(`[postiz] stop ownership transition failed (${error instanceof Error ? error.name : "error"})`);
        return false;
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
    releaseAdmission: async () => {
      await releasePostizStackLease(stackLease);
      stackLease = null;
    },
  };
}
