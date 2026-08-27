import "server-only";

import fs from "node:fs";
import path from "node:path";

import { repositoryRoot } from "../runtime-paths.ts";
import { resolveQuartzBaseUrl } from "../quartz-url.ts";
import { readSupervisedServiceSnapshot } from "../supervisor-control.ts";

export interface PenechoService {
  /** Where the canvas server listens, e.g. `http://127.0.0.1:8092`. */
  baseUrl: string;
  /** True when the endpoint is owned by Runtime V2 rather than an external deployment. */
  managed: boolean;
  startedAt: number;
}

const DEFAULT_PORT = 8092;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 300;
const HEALTH_TIMEOUT_MS = 4_000;

/** The clone, or null when it was never staged next to the dashboard. */
export function resolvePenechoRoot(): string | null {
  const configured = process.env.PENECHO_ROOT?.trim();
  const root = configured
    ? path.resolve(configured)
    : path.join(repositoryRoot(), "penecho");
  return fs.existsSync(path.join(root, "server.js")) ? root : null;
}

function port(): number {
  const configured = Number(process.env.PENECHO_PORT?.trim());
  return Number.isInteger(configured) && configured > 0 && configured <= 65_535
    ? configured
    : DEFAULT_PORT;
}

/** Where whiteboard cards point their frames. */
export function penechoBaseUrl(): string {
  const configured = (
    process.env.PENECHO_URL ??
    process.env.NEXT_PUBLIC_PENECHO_URL ??
    ""
  ).trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${port()}`;
}

/**
 * PENECHO_URL historically meant an externally managed service. Runtime V2
 * also injects its selected loopback URL, so it pairs that value with this
 * server-only ownership marker. The marker is never public configuration.
 */
export function penechoRuntimeManaged(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.BREADBOARD_PENECHO_RUNTIME_MANAGED?.trim() === "1") return true;
  return !(env.PENECHO_URL ?? env.NEXT_PUBLIC_PENECHO_URL ?? "").trim();
}

/** Origins allowed to frame and control a whiteboard card. */
export function embedOrigins(): string[] {
  const candidates = [
    resolveQuartzBaseUrl(),
    process.env.NEXT_PUBLIC_DASHBOARD_URL,
    process.env.DASHBOARD_URL,
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  const parsed = candidates.flatMap((value) => {
    if (!value?.trim()) return [];
    try {
      return [new URL(value.trim()).origin];
    } catch {
      return [];
    }
  });
  return [...new Set(parsed)];
}

export function penechoCorsHeaders(
  origin: string | null,
): Record<string, string> {
  const allowlist = embedOrigins();
  const allowed =
    origin && allowlist.includes(origin) ? origin : (allowlist[0] ?? "*");
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function probePenecho(
  baseUrl = penechoBaseUrl(),
): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/config", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Answer PenEcho's first-run loopback access question. Safe to repeat. */
async function unlock(baseUrl: string): Promise<void> {
  const origin = new URL(baseUrl).origin;
  try {
    await fetch(new URL("/api/local-access/open", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ acknowledgeRisk: true }),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
  } catch {
    // The server's access page remains the truthful fallback.
  }
}

/**
 * Wait for a service whose Runtime lease has already been acquired. This
 * module never constructs a command, adopts a process, or falls back to a
 * dashboard-owned launch.
 */
export async function ensurePenechoService(): Promise<PenechoService> {
  const baseUrl = penechoBaseUrl();
  const managed = penechoRuntimeManaged();
  if (!managed) {
    if (!(await probePenecho(baseUrl))) {
      throw new Error(`No PenEcho canvas server is answering at ${baseUrl}.`);
    }
    await unlock(baseUrl);
    return { baseUrl, managed: false, startedAt: Date.now() };
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probePenecho(baseUrl)) {
      await unlock(baseUrl);
      return { baseUrl, managed: true, startedAt: Date.now() };
    }
    const snapshot = await readSupervisedServiceSnapshot("penecho").catch(
      () => null,
    );
    if (snapshot?.state === "installation-unavailable") {
      throw new Error("The PenEcho clone was not found next to Breadboard.");
    }
    if (snapshot?.state === "resource-blocked") {
      throw new Error(
        "Breadboard does not have enough memory headroom to start PenEcho.",
      );
    }
    if (snapshot?.state === "failed") {
      throw new Error("The PenEcho Runtime service failed during startup.");
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(
    `The PenEcho canvas server did not become ready within ${Math.round(READY_TIMEOUT_MS / 1000)}s.`,
  );
}

/** Observational status only: opening a panel never acquires a lease. */
export async function penechoServiceStatus(): Promise<{
  running: boolean;
  baseUrl: string;
  available: boolean;
}> {
  const baseUrl = penechoBaseUrl();
  const running = await probePenecho(baseUrl);
  if (!penechoRuntimeManaged()) {
    return { running, baseUrl, available: true };
  }
  const snapshot = await readSupervisedServiceSnapshot("penecho").catch(
    () => null,
  );
  return {
    running,
    baseUrl,
    available:
      snapshot?.state !== "installation-unavailable" &&
      (snapshot !== null || resolvePenechoRoot() !== null),
  };
}
