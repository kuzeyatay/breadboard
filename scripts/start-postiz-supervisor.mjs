// The Postiz lifecycle coordinator.
//
// This process starts with Breadboard and does nothing. It is the single owner
// of the Postiz Compose project — Docker startup, `compose up`, readiness,
// account bootstrap, health recovery, idle shutdown and `compose down` — but it
// owns all of that lazily. Until an authenticated `POST /ensure-ready` arrives
// it runs no Docker command at all, so a cold Breadboard launch leaves Docker
// Desktop closed, the docker-desktop WSL VM stopped, and every Postiz container
// non-existent.
//
// It replaces a supervisor that called `startStack()` on its first line and
// only opened its readiness endpoint once nine containers were up. That earlier
// design read `startInBackground` as "do not block the startup screen" when the
// requirement was "do not start until asked", which is why roughly 3.4 GiB of
// containers were resident on every launch whether or not anyone published
// anything.
//
//   GET  /health        this process is alive. Never starts Docker.
//   GET  /status        the state machine. Side-effect-free.
//   POST /ensure-ready  the only door to starting the stack. Authenticated.
//   POST /release       drop a hold. Authenticated.
//   POST /stop          `compose down` (never `-v`). Authenticated.

import http from "node:http";

import { resolveSocialsManagerConfig } from "../dashboard/src/lib/socials-manager/config.ts";
import { PostizCoordinator } from "../dashboard/src/lib/socials-manager/coordinator-core.ts";
import {
  MAX_CONTROL_BODY_BYTES,
  handleCoordinatorRequest,
} from "../dashboard/src/lib/socials-manager/coordinator-server.ts";
import {
  realCoordinatorDeps,
  resolveIdleTimeoutMs,
} from "../dashboard/src/lib/socials-manager/coordinator-runtime.ts";

const host = process.env.POSTIZ_SUPERVISOR_HOST?.trim() || "127.0.0.1";
const healthPort = Number(process.env.POSTIZ_SUPERVISOR_PORT);
const token = process.env.POSTIZ_COORDINATOR_TOKEN?.trim() ?? "";
const startupTimeoutMs = Number(process.env.POSTIZ_SUPERVISOR_STARTUP_TIMEOUT_MS || 18 * 60_000);
const idleTimeoutMs = resolveIdleTimeoutMs(process.env);
const idleCheckMs = Number(process.env.POSTIZ_IDLE_CHECK_MS || 60_000);
const checkOnly = process.argv.includes("--check");

function log(message) {
  process.stdout.write(`[postiz-coordinator] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

/**
 * Compose output is relayed at most one line at a time and only while an
 * activation is running. It is prefixed rather than parsed, and the desktop
 * LogManager applies the per-install secret redactor on the way to disk.
 */
function relayComposeOutput(stream, chunk) {
  const target = stream === "stderr" ? process.stderr : process.stdout;
  for (const line of chunk.split(/\r?\n/)) {
    if (line.trim()) target.write(`[postiz-compose] ${line}\n`);
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    // Bounded: a control request has no reason to be large, and an unbounded
    // read is a loopback denial-of-service against Breadboard's own supervisor.
    if (size > MAX_CONTROL_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65_535) {
    fail("POSTIZ_SUPERVISOR_PORT must be a valid TCP port");
  }
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs < 1_000) {
    fail("POSTIZ_SUPERVISOR_STARTUP_TIMEOUT_MS must be at least 1000ms");
  }

  const config = resolveSocialsManagerConfig();
  if (config.mode !== "stack") fail("Postiz must run in stack mode on desktop");

  const coordinator = new PostizCoordinator(
    realCoordinatorDeps({
      config,
      log,
      startupTimeoutMs,
      idleTimeoutMs,
      onComposeOutput: relayComposeOutput,
    }),
  );

  if (checkOnly) {
    // The packaging smoke check: prove the stack *can* be brought up, on
    // purpose and in the foreground. Never part of ordinary startup.
    const result = await coordinator.ensureReady({ reason: "manual" });
    log(
      result.ready
        ? `ready in ${result.waitedMs}ms; ${result.integrations ?? 0} integration(s) connected`
        : `not ready: ${result.reason ?? "unknown"}`,
    );
    if (!result.ready) process.exitCode = 1;
    return;
  }

  if (!token) {
    // Fail loudly but keep serving /health: the desktop supervisor should see a
    // live-but-unusable coordinator rather than a crash loop.
    log("WARNING: no capability token was provided; control endpoints are closed");
  }

  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        const body = request.method === "POST" ? await readBody(request) : "";
        if (body === null) {
          response.writeHead(413, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ ok: false, error: "payload_too_large" }));
          return;
        }
        const result = await handleCoordinatorRequest(
          {
            method: request.method ?? "GET",
            url: request.url ?? "/",
            authorization: request.headers.authorization,
            body,
          },
          coordinator,
          token,
        );
        response.writeHead(result.status, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify(result.json));
      } catch (error) {
        // Never echo the failure: it can quote Compose output.
        log(`control request failed: ${error instanceof Error ? error.name : "error"}`);
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        }
        response.end(JSON.stringify({ ok: false, error: "internal_error" }));
      }
    })();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // Loopback only. The capability token is a second lock, not the only one.
    server.listen(healthPort, host, resolve);
  });
  log(
    `idle and listening on ${host}:${healthPort}; Docker is untouched ` +
      `(idle-stop ${idleTimeoutMs > 0 ? `${Math.round(idleTimeoutMs / 60_000)}min` : "disabled"})`,
  );

  const idleTimer = setInterval(() => {
    void coordinator.idleTick().catch(() => null);
  }, Math.max(10_000, idleCheckMs));
  idleTimer.unref?.();

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    clearInterval(idleTimer);
    log(`received ${signal}; deciding whether the stack may be stopped`);
    const stopped = await coordinator.close().catch(() => false);
    log(stopped ? "stack stopped on exit" : "stack left running on exit");
    server.close(() => process.exit(0));
    // A socket the OS has not released yet must not hold the app's shutdown.
    setTimeout(() => process.exit(0), 5_000).unref?.();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[postiz-coordinator] fatal: ${message}\n`);
  process.exitCode = 1;
});
