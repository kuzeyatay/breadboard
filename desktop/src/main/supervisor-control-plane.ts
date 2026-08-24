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
}

/** Electron-owned loopback-only service lease and admission API. */
export class SupervisorControlPlane {
  private readonly options: SupervisorControlPlaneOptions;
  private server: http.Server | null = null;

  constructor(options: SupervisorControlPlaneOptions) {
    this.options = options;
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
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
        const lease = await this.options.services.acquireCapabilityLease(capability[1]!, reason);
        send(res, 200, { ok: true, leaseId: lease.id, capabilityId: lease.targetId });
        return;
      }

      const release = /^\/v1\/leases\/([0-9a-f-]+)\/release$/.exec(path);
      if (req.method === "POST" && release) {
        await bodyOf(req);
        send(res, 200, { ok: true, released: this.options.services.releaseLease(release[1]!) });
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
