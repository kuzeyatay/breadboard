import { timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
  ResourceExhaustionError,
  type ResourceExhaustionPayload,
} from "./memory-governor";
import type { LogManager } from "./log-manager";
import type { ServiceManager } from "./service-manager";

const MAX_BODY_BYTES = 8 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const OWNER_EXIT_POLL_MS = 100;
// Learn's registered capability lease expires after six hours. The PID watch
// is only a shorter release fence; it must never outlive that existing bound.
const OWNER_EXIT_WATCH_MAX_MS = 6 * 60 * 60_000;
const MAX_DEFERRED_OWNER_RELEASES = 8;

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function authorized(header: string | undefined, secret: string): boolean {
  const token = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "")?.[1];
  if (!secret || !token) return false;
  const left = Buffer.from(token);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

function send(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.byteLength,
    "cache-control": "no-store",
    connection: "close",
  });
  res.end(payload);
}

async function bodyOf(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    total += chunk.byteLength;
    if (total > MAX_BODY_BYTES) throw new RangeError("payload_too_large");
    chunks.push(chunk);
  }
  if (total === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("invalid_body");
  }
  return parsed as Record<string, unknown>;
}

export interface SupervisorControlPlaneOptions {
  port: number;
  secret: string;
  services: ServiceManager;
  logs: LogManager;
  /** Test seam; production observes the recorded owner PID with signal 0. */
  ownerProcessIsAlive?: (pid: number) => boolean;
  /** Test seam; the production poll waits for an observable exit condition. */
  ownerExitPollMs?: number;
  /** Test seam; production matches the Learn capability's existing lease TTL. */
  ownerExitWatchMaxMs?: number;
}

interface DeferredLeaseRelease {
  ownerPid: number;
  pollTimer: NodeJS.Timeout;
  expiryTimer: NodeJS.Timeout;
}

/** Electron-owned loopback-only service lease and admission API. */
export class SupervisorControlPlane {
  private readonly options: SupervisorControlPlaneOptions;
  private readonly deferredLeaseReleases = new Map<string, DeferredLeaseRelease>();
  private readonly leaseOwnerWatchDeadlines = new Map<string, number>();
  private readonly ownerExitReleaseTombstones = new Map<string, number>();
  private server: http.Server | null = null;

  constructor(options: SupervisorControlPlaneOptions) {
    this.options = options;
  }

  /** Diagnostic/test seam; no lease identifiers or owner PIDs are exposed. */
  pendingOwnerExitReleaseCount(): number {
    return this.deferredLeaseReleases.size;
  }

  async start(): Promise<number> {
    if (!this.options.secret) throw new Error("Supervisor control secret is missing.");
    if (this.server) return (this.server.address() as AddressInfo).port;
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = REQUEST_TIMEOUT_MS;
    server.keepAliveTimeout = 1_000;
    server.maxRequestsPerSocket = 20;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    const port = (server.address() as AddressInfo).port;
    this.options.logs
      .forService("desktop")
      .write(`[control] supervisor control plane listening on 127.0.0.1:${port}`);
    return port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const deferred of this.deferredLeaseReleases.values()) {
      clearInterval(deferred.pollTimer);
      clearTimeout(deferred.expiryTimer);
    }
    this.deferredLeaseReleases.clear();
    this.leaseOwnerWatchDeadlines.clear();
    this.ownerExitReleaseTombstones.clear();
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private releaseLeaseNow(leaseId: string): boolean {
    // Once a worker has installed an owner-exit fence, a duplicate generic
    // release must not shorten it and restore reclaimed services early.
    if (
      this.deferredLeaseReleases.has(leaseId) ||
      this.ownerExitReleaseTombstones.has(leaseId)
    ) {
      return false;
    }
    this.leaseOwnerWatchDeadlines.delete(leaseId);
    return this.options.services.releaseLease(leaseId);
  }

  /**
   * A detached worker asks to release from its JS `finally`, which necessarily
   * runs before its process and native allocations have left Windows commit.
   * Keep the capability hold until signal-0 liveness observes the recorded PID
   * dead. The HTTP request is acknowledged as soon as the watch is installed;
   * no worker waits for its own death and no fixed teardown delay is guessed.
   * This is deliberately a PID-observed fence, not a claim to a reusable PID's
   * process identity. Reuse can only delay restoration until lease expiry; it
   * cannot make restoration premature.
   */
  private deferLeaseReleaseUntilOwnerExit(
    leaseId: string,
    ownerPid: number,
  ): { released: boolean; deferred: boolean; ownerPid: number } {
    if (!this.leaseOwnerWatchDeadlines.has(leaseId)) {
      // Only a Learn lease minted by this control-plane launch can install a
      // PID observer. A bearer holder cannot allocate timers for random IDs.
      throw new TypeError("invalid_body");
    }
    const existing = this.deferredLeaseReleases.get(leaseId);
    if (existing) {
      if (existing.ownerPid !== ownerPid) {
        throw new TypeError("invalid_body");
      }
      return { released: false, deferred: true, ownerPid };
    }
    const tombstoneOwnerPid = this.ownerExitReleaseTombstones.get(leaseId);
    if (tombstoneOwnerPid !== undefined) {
      if (tombstoneOwnerPid !== ownerPid) throw new TypeError("invalid_body");
      return { released: false, deferred: false, ownerPid };
    }

    const isAlive = this.options.ownerProcessIsAlive ?? processIsAlive;
    if (!isAlive(ownerPid)) {
      this.leaseOwnerWatchDeadlines.delete(leaseId);
      this.ownerExitReleaseTombstones.delete(leaseId);
      return {
        released: this.options.services.releaseLease(leaseId),
        deferred: false,
        ownerPid,
      };
    }

    const pollMs = Math.max(10, this.options.ownerExitPollMs ?? OWNER_EXIT_POLL_MS);
    const configuredWatchMaxMs =
      this.options.ownerExitWatchMaxMs ?? OWNER_EXIT_WATCH_MAX_MS;
    const deadline =
      this.leaseOwnerWatchDeadlines.get(leaseId) ??
      Date.now() + configuredWatchMaxMs;
    const remainingWatchMs = deadline - Date.now();
    if (remainingWatchMs <= 0) {
      // The authoritative ServiceManager expiry owns any final milliseconds.
      // Never create a new watch window after the original one elapsed.
      return { released: false, deferred: false, ownerPid };
    }
    if (this.deferredLeaseReleases.size >= MAX_DEFERRED_OWNER_RELEASES) {
      throw new Error("owner_exit_observer_capacity_exhausted");
    }
    const pollTimer = setInterval(() => {
      let alive = true;
      try {
        alive = isAlive(ownerPid);
      } catch (error) {
        this.options.logs
          .forService("desktop")
          .write(
            `[control] owner liveness check failed lease=${leaseId} pid=${ownerPid} ` +
              `reason=${error instanceof Error ? error.message : String(error)}`,
          );
        return;
      }
      if (alive) return;
      const current = this.deferredLeaseReleases.get(leaseId);
      if (!current || current.ownerPid !== ownerPid) return;
      clearInterval(current.pollTimer);
      clearTimeout(current.expiryTimer);
      this.deferredLeaseReleases.delete(leaseId);
      this.leaseOwnerWatchDeadlines.delete(leaseId);
      this.ownerExitReleaseTombstones.delete(leaseId);
      const released = this.options.services.releaseLease(leaseId);
      this.options.logs
        .forService("desktop")
        .write(
          `[control] owner exited; deferred lease release lease=${leaseId} ` +
            `pid=${ownerPid} released=${released}`,
        );
    }, pollMs);
    pollTimer.unref?.();
    const watchMaxMs = Math.max(pollMs, remainingWatchMs);
    const expiryTimer = setTimeout(() => {
      const current = this.deferredLeaseReleases.get(leaseId);
      if (!current || current.ownerPid !== ownerPid) return;
      clearInterval(current.pollTimer);
      this.deferredLeaseReleases.delete(leaseId);
      // ServiceManager owns the authoritative lease-expiry timer. This only
      // removes the redundant liveness observer at the same outer bound. Keep
      // the deadline so a late duplicate cannot install a fresh six-hour watch.
    }, watchMaxMs);
    expiryTimer.unref?.();
    this.deferredLeaseReleases.set(leaseId, { ownerPid, pollTimer, expiryTimer });
    this.ownerExitReleaseTombstones.set(leaseId, ownerPid);
    return { released: false, deferred: true, ownerPid };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (req.method === "GET" && path === "/health") {
      send(res, 200, { ok: true });
      return;
    }
    if (!authorized(req.headers.authorization, this.options.secret)) {
      send(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    try {
      if (req.method === "GET" && path === "/v1/status") {
        send(res, 200, {
          ok: true,
          services: this.options.services.allStatuses().map((status) => ({
            id: status.id,
            state: status.state,
            pid: status.pid,
            activeLeases: status.activeLeases,
            restarts: status.restarts,
          })),
          activeJobs: this.options.services.activeLeaseSummary(),
        });
        return;
      }

      const service = /^\/v1\/services\/([a-z0-9-]+)\/lease$/.exec(path);
      if (req.method === "POST" && service) {
        const body = await bodyOf(req);
        const reason = typeof body.reason === "string" ? body.reason : "server-operation";
        const lease = await this.options.services.acquireServiceLease(service[1]!, reason);
        send(res, 200, { ok: true, leaseId: lease.id, serviceId: lease.targetId });
        return;
      }

      const capability = /^\/v1\/capabilities\/([a-z0-9-]+)\/lease$/.exec(path);
      if (req.method === "POST" && capability) {
        const body = await bodyOf(req);
        const reason = typeof body.reason === "string" ? body.reason : "server-job";
        const admissionStartedAt = Date.now();
        const lease = await this.options.services.acquireCapabilityLease(capability[1]!, reason);
        if (capability[1] === "learn-worker") {
          this.leaseOwnerWatchDeadlines.set(
            lease.id,
            admissionStartedAt +
              (this.options.ownerExitWatchMaxMs ?? OWNER_EXIT_WATCH_MAX_MS),
          );
        }
        send(res, 200, { ok: true, leaseId: lease.id, capabilityId: lease.targetId });
        return;
      }

      const release = /^\/v1\/leases\/([0-9a-f-]+)\/release$/.exec(path);
      if (req.method === "POST" && release) {
        const body = await bodyOf(req);
        if (Object.hasOwn(body, "afterOwnerPidExit")) {
          const ownerPid = body.afterOwnerPidExit;
          if (!Number.isSafeInteger(ownerPid) || Number(ownerPid) <= 0) {
            throw new TypeError("invalid_body");
          }
          send(res, 200, {
            ok: true,
            ...this.deferLeaseReleaseUntilOwnerExit(release[1]!, Number(ownerPid)),
          });
          return;
        }
        send(res, 200, { ok: true, released: this.releaseLeaseNow(release[1]!) });
        return;
      }
      send(res, 404, { ok: false, error: "not_found" });
    } catch (error) {
      if (error instanceof ResourceExhaustionError) {
        send(res, 503, error.result as unknown as ResourceExhaustionPayload & Record<string, unknown>);
        return;
      }
      if (error instanceof RangeError) {
        send(res, 413, { ok: false, error: "payload_too_large" });
        return;
      }
      if (error instanceof SyntaxError || error instanceof TypeError) {
        send(res, 400, { ok: false, error: "invalid_request" });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.options.logs
        .forService("desktop")
        .write(`[control] request failed path=${path} reason=${message.slice(0, 200)}`);
      send(res, 503, { ok: false, error: "service_unavailable" });
    }
  }
}
