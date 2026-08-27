// The coordinator's loopback control surface.
//
// Six endpoints, one of which is open:
//
//   GET  /health       the coordinator process is alive. Says nothing about
//                      whether Postiz is running, and starts nothing.
//   POST /status       scoped state snapshot. Side-effect-free.
//   POST /ensure-ready the only door to starting the stack. Authenticated.
//   POST /release      drop a hold taken by ensure-ready. Authenticated.
//   POST /stop         `compose down` this project only. Authenticated.
//   POST /shutdown     Breadboard is exiting: stop the stack only if this
//                      coordinator started it and nothing is scheduled or in
//                      flight. Authenticated.
//
// `/health` is open because the Runtime service engine polls it as ordinary
// process liveness and a liveness probe that needs a credential is a liveness
// probe that reports outages it caused. It answers with the state name and
// nothing else — no token, no credentials, no ports, no Compose output.

import { timingSafeEqual } from "node:crypto";

import {
  ACTIVATION_REASONS,
  type PostizCoordinator,
} from "./coordinator-core.ts";

export interface CoordinatorRequest {
  method: string;
  /** Exact path only; queries, fragments, and encoded aliases are refused. */
  url: string;
  authorization?: string | undefined;
  /** Raw body text. Invalid JSON fails the endpoint's exact-key contract. */
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
  const tokenBytes = Buffer.byteLength(token, "utf8");
  if (
    tokenBytes < 32 ||
    tokenBytes > 1024 ||
    !/^[\x21-\x7e]+$/u.test(token)
  ) return false;
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
  if (url.includes("?") || url.includes("#") || url.includes("%")) return "";
  const raw = url;
  return raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

interface ControlScope {
  userId: number;
  runId?: string;
  conversationPublicId?: string;
}

function parseScope(value: unknown): ControlScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scope = value as Record<string, unknown>;
  if (Object.keys(scope).some((key) => !["userId", "runId", "conversationPublicId"].includes(key))) {
    return null;
  }
  if (!Number.isSafeInteger(scope.userId) || Number(scope.userId) < 1) return null;
  for (const key of ["runId", "conversationPublicId"] as const) {
    const item = scope[key];
    if (
      item !== undefined &&
      (typeof item !== "string" ||
        !item ||
        Buffer.byteLength(item, "utf8") > 256 ||
        /\p{Cc}/u.test(item))
    ) return null;
  }
  return scope as unknown as ControlScope;
}

function scopeKey(scope: ControlScope): string {
  return JSON.stringify([
    scope.userId,
    scope.runId ?? null,
    scope.conversationPublicId ?? null,
  ]);
}

function badRequest(): CoordinatorResponse {
  return { status: 400, json: { ok: false, error: "invalid_control_request" } };
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

  if (path === "/status" && method === "POST") {
    if (!exactKeys(body, ["scope", "probeDocker"]) || typeof body.probeDocker !== "boolean") {
      return badRequest();
    }
    const scope = parseScope(body.scope);
    if (!scope) return badRequest();
    const snapshot = coordinator.snapshot();
    if (!body.probeDocker) return { status: 200, json: { ok: true, ...snapshot } };
    const daemonRunning = await coordinator.dockerAvailable();
    return {
      status: 200,
      json: {
        ok: true,
        ...snapshot,
        docker: {
          cliInstalled: daemonRunning,
          desktopInstalled: daemonRunning,
          daemonRunning,
        },
      },
    };
  }

  if (path === "/ensure-ready" && method === "POST") {
    if (
      !exactKeys(body, ["scope", "reason", "timeoutMs", "hold", "nextScheduledAt"]) ||
      typeof body.reason !== "string" ||
      !ACTIVATION_REASONS.includes(body.reason as (typeof ACTIVATION_REASONS)[number]) ||
      !Number.isSafeInteger(body.timeoutMs) ||
      Number(body.timeoutMs) < 0 ||
      Number(body.timeoutMs) > 20 * 60_000 ||
      typeof body.hold !== "boolean" ||
      !(
        body.nextScheduledAt === null ||
        (typeof body.nextScheduledAt === "string" &&
          body.nextScheduledAt.length <= 64 &&
          Number.isFinite(Date.parse(body.nextScheduledAt)))
      )
    ) return badRequest();
    const scope = parseScope(body.scope);
    if (!scope) return badRequest();
    const result = await coordinator.ensureReady({
      reason: body.reason,
      timeoutMs: Number(body.timeoutMs),
      hold: body.hold,
      nextScheduledAt: body.nextScheduledAt as string | null,
      scopeKey: scopeKey(scope),
    });
    return { status: 200, json: { ok: true, ...result } };
  }

  if (path === "/release" && method === "POST") {
    if (
      !exactKeys(body, ["scope", "leaseId"]) ||
      typeof body.leaseId !== "string" ||
      !/^lease-[a-zA-Z0-9-]{1,120}$/u.test(body.leaseId)
    ) return badRequest();
    const scope = parseScope(body.scope);
    if (!scope) return badRequest();
    const released = coordinator.releaseLease(body.leaseId, scopeKey(scope));
    return { status: 200, json: { ok: true, released, leases: coordinator.activeLeases() } };
  }

  if (path === "/stop" && method === "POST") {
    if (!exactKeys(body, ["scope"]) || !parseScope(body.scope)) return badRequest();
    // An explicit stop is the user's decision and is always honoured, including
    // for a stack that was already running when Breadboard found it.
    const stopped = await coordinator.stop("manual");
    return { status: 200, json: { ok: true, stopped, ...coordinator.snapshot() } };
  }

  if (path === "/shutdown" && method === "POST") {
    if (!exactKeys(body, [])) return badRequest();
    // Application exit. Unlike /stop this is conditional: `close()` refuses for
    // a pre-existing stack, an active hold, or pending scheduled publishing.
    //
    // It also backs Runtime V2's exact stdin graceful-stop record on Windows,
    // where POSIX signals cannot be the only shutdown contract.
    const stopped = await coordinator.close();
    return { status: 200, json: { ok: true, stopped, ...coordinator.snapshot() } };
  }

  return { status: 404, json: { ok: false, error: "not_found" } };
}
