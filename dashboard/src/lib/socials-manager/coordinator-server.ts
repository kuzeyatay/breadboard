// The coordinator's loopback control surface.
//
// Six endpoints, one of which is open:
//
//   GET  /health       the coordinator process is alive. Says nothing about
//                      whether Postiz is running, and starts nothing.
//   GET  /status       the state machine, verbatim. Side-effect-free.
//   POST /ensure-ready the only door to starting the stack. Authenticated.
//   POST /release      drop a hold taken by ensure-ready. Authenticated.
//   POST /stop         `compose down` this project only. Authenticated.
//   POST /shutdown     Breadboard is exiting: stop the stack only if this
//                      coordinator started it and nothing is scheduled or in
//                      flight. Authenticated.
//
// `/health` is open because the Electron service manager polls it as ordinary
// process liveness and a liveness probe that needs a credential is a liveness
// probe that reports outages it caused. It answers with the state name and
// nothing else — no token, no credentials, no ports, no Compose output.

import { timingSafeEqual } from "node:crypto";

import type { PostizCoordinator } from "./coordinator-core.ts";

export interface CoordinatorRequest {
  method: string;
  /** Path only; a query string is ignored. */
  url: string;
  authorization?: string | undefined;
  /** Raw body text. Anything unparseable is treated as an empty object. */
  body?: string;
}

export interface CoordinatorResponse {
  status: number;
  json: Record<string, unknown>;
}

export const MAX_CONTROL_BODY_BYTES = 8 * 1024;

/**
 * Constant-time bearer check.
 *
 * An unset token is a hard closed door rather than an open one: a coordinator
 * that was never handed a capability secret cannot authenticate anybody, so it
 * refuses every control request instead of serving them all.
 */
export function isAuthorized(header: string | undefined, token: string): boolean {
  if (!token) return false;
  const presented = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "")?.[1];
  if (!presented) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseBody(body: string | undefined): Record<string, unknown> {
  if (!body || body.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function pathOf(url: string): string {
  const raw = url.split("?")[0] ?? "/";
  return raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

/**
 * Route one control request.
 *
 * Deliberately a pure function of (request, coordinator): no sockets, no
 * timers, no globals — so the authentication rules and the "status never
 * touches Docker" promise can both be tested directly.
 */
export async function handleCoordinatorRequest(
  request: CoordinatorRequest,
  coordinator: PostizCoordinator,
  token: string,
): Promise<CoordinatorResponse> {
  const path = pathOf(request.url);
  const method = request.method.toUpperCase();

  if (path === "/health" && method === "GET") {
    // Liveness of *this process*. Reading the snapshot mutates nothing and
    // runs no command.
    return { status: 200, json: { ok: true, stack: coordinator.snapshot().state } };
  }

  if (!isAuthorized(request.authorization, token)) {
    return {
      status: token ? 401 : 503,
      json: { ok: false, error: token ? "unauthorized" : "coordinator_unconfigured" },
    };
  }

  if ((request.body?.length ?? 0) > MAX_CONTROL_BODY_BYTES) {
    return { status: 413, json: { ok: false, error: "payload_too_large" } };
  }
  const body = parseBody(request.body);

  if (path === "/status" && method === "GET") {
    return { status: 200, json: { ok: true, ...coordinator.snapshot() } };
  }

  if (path === "/ensure-ready" && method === "POST") {
    const result = await coordinator.ensureReady({
      reason: body.reason,
      ...(typeof body.timeoutMs === "number" ? { timeoutMs: body.timeoutMs } : {}),
      ...(body.hold === true ? { hold: true } : {}),
      ...(typeof body.nextScheduledAt === "string"
        ? { nextScheduledAt: body.nextScheduledAt }
        : {}),
    });
    return { status: 200, json: { ok: true, ...result } };
  }

  if (path === "/release" && method === "POST") {
    const released = coordinator.releaseLease(body.leaseId);
    return { status: 200, json: { ok: true, released, leases: coordinator.activeLeases() } };
  }

  if (path === "/stop" && method === "POST") {
    // An explicit stop is the user's decision and is always honoured, including
    // for a stack that was already running when Breadboard found it.
    const stopped = await coordinator.stop("manual");
    return { status: 200, json: { ok: true, stopped, ...coordinator.snapshot() } };
  }

  if (path === "/shutdown" && method === "POST") {
    // Application exit. Unlike /stop this is conditional: `close()` refuses for
    // a pre-existing stack, an active hold, or pending scheduled publishing.
    //
    // It exists as an endpoint because on Windows the supervisor terminates
    // this process rather than signalling it, so a SIGTERM handler would never
    // run and a Breadboard-started stack would be orphaned on every quit.
    const stopped = await coordinator.close();
    return { status: 200, json: { ok: true, stopped, ...coordinator.snapshot() } };
  }

  return { status: 404, json: { ok: false, error: "not_found" } };
}
