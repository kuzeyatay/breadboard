// Breadboard UI-TARS adapter HTTP server (Node).
//
// Binds ONLY to loopback, authenticates every non-health request with a
// per-launch secret (timing-safe), and exposes only the narrow operations the
// Breadboard dashboard needs. Errors returned to callers are sanitized codes —
// never a stack, path, or secret. The adapter trusts the dashboard's asserted
// userId (proven by the bearer secret) and enforces run ownership by it; it is
// NOT a second authorization system.

import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig, assertSecret, type AdapterConfig } from "./config.ts";
import { validateAgentConfiguration } from "./config.ts";
import { RunManager, RunManagerError } from "./run-manager.ts";
import { ScreenshotStore, ScreenshotStoreError } from "./screenshot-store.ts";
import { ProcessManager } from "./process-manager.ts";
import { FakeRuntimeClient, type RuntimeClient } from "./runtime-client.ts";
import { makeRedactor, safeErrorMessage } from "./redaction.ts";
import type { NormalizedEvent } from "./types.ts";
import { ComputerUseSignal } from "./computer-use-signal.ts";

const MAX_BODY_BYTES = 64 * 1024;

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

interface JsonReply {
  (body: unknown, status?: number): void;
}

export interface AdapterServer {
  server: http.Server;
  runManager: RunManager;
  port: number;
  stop: () => Promise<void>;
}

async function loadRuntime(config: AdapterConfig, redact: (l: string) => string): Promise<RuntimeClient> {
  if (config.runtime === "agent-tars") {
    // Lazy import so unit/CI runs never need the heavy upstream deps installed.
    const mod = await import("./agent-tars-runtime.ts");
    return new mod.AgentTarsRuntimeClient({
      dataDir: config.dataDir,
      version: config.version,
      redact,
    });
  }
  return new FakeRuntimeClient({ version: `fake-${config.version}` });
}

export async function startAdapter(overrides: Partial<AdapterConfig> = {}): Promise<AdapterServer> {
  const config: AdapterConfig = { ...resolveConfig(), ...overrides };
  assertSecret(config);

  const dataDir = config.dataDir || path.join(process.cwd(), ".ui-tars-data");
  const redact = makeRedactor([config.secret]);
  const screenshots = new ScreenshotStore(path.join(dataDir, "screenshots"));
  const processes = new ProcessManager(path.join(dataDir, "sessions"));
  processes.reapOrphans();

  const client = await loadRuntime(config, redact);
  let runManager!: RunManager;
  const computerUseSignal = new ComputerUseSignal({
    dataDir,
    onCancel: () => runManager.abortActiveDesktopControls("escape"),
  });
  runManager = new RunManager(client, screenshots, processes, {
    maxConcurrentRuns: config.maxConcurrentRuns,
    screenshotRetentionMs: config.screenshotRetentionMs,
    redact,
    onDesktopControlChange: (active) => computerUseSignal.setActive(active),
  });

  const authorized = (req: http.IncomingMessage): boolean => {
    const header = req.headers["authorization"] ?? "";
    const value = Array.isArray(header) ? header[0] : header;
    const bearer = value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
    return bearer.length > 0 && timingSafeEqual(bearer, config.secret);
  };

  const readBody = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          reject(new RunManagerError("payload_too_large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (chunks.length === 0) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
        } catch {
          reject(new RunManagerError("invalid_json"));
        }
      });
      req.on("error", () => reject(new RunManagerError("read_error")));
    });

  const codeToStatus = (code: string): number => {
    switch (code) {
      case "run_not_found":
      case "not_found":
        return 404;
      case "forbidden":
        return 403;
      case "run_exists":
        return 409;
      case "too_many_runs":
        return 429;
      case "payload_too_large":
        return 413;
      case "already_decided":
      case "expired":
      case "run_mismatch":
        return 409;
      case "empty_task":
      case "task_too_long":
      case "invalid_json":
      case "invalid_configuration":
      case "invalid_run_id":
      case "invalid_screenshot_id":
      case "invalid_owner_user_id":
        return 400;
      default:
        return 500;
    }
  };

  const server = http.createServer((req, res) => {
    const json: JsonReply = (body, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const fail = (code: string, status?: number) => json({ ok: false, error: code }, status ?? codeToStatus(code));

    void handle(req, res, json, fail).catch((err) => {
      const code =
        err instanceof RunManagerError || err instanceof ScreenshotStoreError
          ? err.code
          : "internal_error";
      if (!res.headersSent) fail(code, codeToStatus(code));
      else res.end();
      // Only a stable, redacted message ever reaches logs.
      console.error(`[ui-tars-adapter] ${safeErrorMessage(err, [config.secret])}`);
    });
  });

  async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    json: JsonReply,
    fail: (code: string, status?: number) => void,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    const method = req.method ?? "GET";

    // --- Unauthenticated liveness (leaks nothing sensitive) ---
    if (url.pathname === "/health") {
      const caps = client.capabilities();
      return json({
        status: "healthy",
        runtime: caps.runtime,
        realBrowser: caps.realBrowser,
        operator: caps.operator,
        operators: caps.operators,
        version: caps.version,
      });
    }

    if (!authorized(req)) return fail("unauthorized", 401);

    if (url.pathname === "/capabilities" && method === "GET") {
      return json({ ok: true, data: client.capabilities() });
    }

    const uidParam = url.searchParams.get("userId");
    const uidQuery = uidParam !== null ? Number(uidParam) : NaN;

    // POST /runs
    if (parts[0] === "runs" && parts.length === 1 && method === "POST") {
      const body = await readBody(req);
      const ownerUserId = Number(body["ownerUserId"]);
      if (!Number.isFinite(ownerUserId) || ownerUserId <= 0) return fail("forbidden", 403);
      const validation = validateAgentConfiguration(body["config"]);
      if (!validation.ok || !validation.value) return fail("invalid_configuration", 400);
      const runId = typeof body["runId"] === "string" ? body["runId"] : crypto.randomUUID();
      const providerApiKey = typeof body["providerApiKey"] === "string" ? (body["providerApiKey"] as string) : undefined;
      const summary = runManager.create({
        runId,
        ownerUserId,
        task: String(body["task"] ?? ""),
        config: validation.value,
        ...(providerApiKey ? { providerApiKey } : {}),
      });
      return json({ ok: true, data: summary }, 201);
    }

    // GET /runs?userId=
    if (parts[0] === "runs" && parts.length === 1 && method === "GET") {
      if (!Number.isFinite(uidQuery)) return fail("forbidden", 403);
      return json({ ok: true, data: runManager.listForUser(uidQuery) });
    }

    const runId = parts[1];
    if (parts[0] === "runs" && runId) {
      // GET /runs/:id
      if (parts.length === 2 && method === "GET") {
        if (!Number.isFinite(uidQuery)) return fail("forbidden", 403);
        return json({ ok: true, data: runManager.summary(runId, uidQuery) });
      }
      // GET /runs/:id/events (SSE or JSON)
      if (parts[2] === "events" && parts.length === 3 && method === "GET") {
        if (!Number.isFinite(uidQuery)) return fail("forbidden", 403);
        const lastEventId = Number(req.headers["last-event-id"] ?? url.searchParams.get("since") ?? 0) || 0;
        const accept = String(req.headers["accept"] ?? "");
        if (accept.includes("text/event-stream")) {
          return streamEvents(req, res, runId, uidQuery, lastEventId);
        }
        return json({ ok: true, data: runManager.eventsSince(runId, lastEventId, uidQuery) });
      }
      // GET /runs/:id/screenshots/:sid
      if (parts[2] === "screenshots" && parts[3] && parts.length === 4 && method === "GET") {
        if (!Number.isFinite(uidQuery)) return fail("forbidden", 403);
        // Live runs use the in-memory owner. Restored runs use the durable
        // ownership manifest written beside their screenshots.
        try {
          runManager.summary(runId, uidQuery);
        } catch (error) {
          if (!(error instanceof RunManagerError) || error.code !== "run_not_found") throw error;
          const ownerUserId = screenshots.ownerOf(runId);
          if (ownerUserId === null) throw error;
          if (ownerUserId !== uidQuery) throw new ScreenshotStoreError("forbidden");
        }
        const buf = await screenshots.read(runId, parts[3]);
        if (!buf) return fail("not_found", 404);
        res.writeHead(200, { "content-type": "image/png", "cache-control": "private, max-age=60" });
        res.end(buf);
        return;
      }
      // POST /runs/:id/screenshots/restore
      // Repairs pre-manifest screenshot folders after the dashboard has
      // verified this user owns the durable run record.
      if (
        parts[2] === "screenshots"
        && parts[3] === "restore"
        && parts.length === 4
        && method === "POST"
      ) {
        const body = await readBody(req);
        const userId = Number(body["userId"]);
        if (!Number.isSafeInteger(userId) || userId <= 0) return fail("forbidden", 403);
        screenshots.claimHistoricalRun(runId, userId);
        return json({ ok: true });
      }
      // POST /runs/:id/{approve,reject,abort}
      if (method === "POST" && parts.length === 3) {
        const body = await readBody(req);
        const userId = Number(body["userId"]);
        if (!Number.isFinite(userId) || userId <= 0) return fail("forbidden", 403);
        try {
          if (parts[2] === "approve") {
            runManager.approve(runId, String(body["actionId"] ?? ""), userId);
            return json({ ok: true });
          }
          if (parts[2] === "reject") {
            runManager.reject(runId, String(body["actionId"] ?? ""), userId);
            return json({ ok: true });
          }
          if (parts[2] === "abort") {
            runManager.abort(runId, { userId });
            return json({ ok: true });
          }
        } catch (err) {
          const code =
            err instanceof RunManagerError ? err.code : runManager.isApprovalError(err) ? err.code : "internal_error";
          return fail(code, codeToStatus(code));
        }
      }
    }

    return fail("not_found", 404);
  }

  function streamEvents(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    runId: string,
    userId: number,
    since: number,
  ): void {
    let backlog: NormalizedEvent[];
    try {
      backlog = runManager.eventsSince(runId, since, userId);
    } catch (err) {
      const code = err instanceof RunManagerError ? err.code : "internal_error";
      res.writeHead(codeToStatus(code), { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: code }));
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    const write = (e: NormalizedEvent) => {
      res.write(`id: ${e.sequenceNumber}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    for (const e of backlog) write(e);
    let unsub: () => void = () => {};
    try {
      unsub = runManager.subscribe(runId, userId, write);
    } catch {
      res.end();
      return;
    }
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
    heartbeat.unref?.(); // never keep the process alive on the heartbeat alone
    const cleanup = () => {
      clearInterval(heartbeat);
      unsub();
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
  }

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;

  return {
    server,
    runManager,
    port,
    async stop() {
      await runManager.shutdown();
      computerUseSignal.stop();
      // Force-close keep-alive/SSE sockets so close() resolves promptly.
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// Direct execution entrypoint (Windows-safe: compare normalized file URLs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startAdapter()
    .then((s) => {
      console.log(`[ui-tars-adapter] listening on 127.0.0.1:${s.port}`);
      const shutdown = () => {
        s.stop().finally(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      console.error(`[ui-tars-adapter] failed to start: ${safeErrorMessage(err)}`);
      process.exit(1);
    });
}
