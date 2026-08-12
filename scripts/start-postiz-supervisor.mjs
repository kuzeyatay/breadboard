// Optional background supervisor for the real Postiz Docker Compose stack.
//
// This process does not report healthy merely because port 4007 answers. It
// starts the stack, waits for Postiz's HTTP app, bootstraps Breadboard's local
// account/API key, verifies the authenticated public API, and only then opens
// its private readiness endpoint for the Electron service manager.

import http from "node:http";
import { PostizApiClient } from "../dashboard/src/lib/socials-manager/api-client.ts";
import { ensureApiKey } from "../dashboard/src/lib/socials-manager/bootstrap.ts";
import { resolveSocialsManagerConfig } from "../dashboard/src/lib/socials-manager/config.ts";
import {
  reachable,
  readCredentials,
  startStack,
  waitForReady,
  writeCredentials,
} from "../dashboard/src/lib/socials-manager/stack.ts";

const host = process.env.POSTIZ_SUPERVISOR_HOST?.trim() || "127.0.0.1";
const healthPort = Number(process.env.POSTIZ_SUPERVISOR_PORT);
const startupTimeoutMs = Number(
  process.env.POSTIZ_SUPERVISOR_STARTUP_TIMEOUT_MS || 18 * 60_000,
);
const checkOnly = process.argv.includes("--check");
const startedAt = Date.now();

function log(message) {
  process.stdout.write(`[postiz-supervisor] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function remainingBudget() {
  return Math.max(0, startupTimeoutMs - (Date.now() - startedAt));
}

function relayComposeOutput(stream, chunk) {
  const target = stream === "stderr" ? process.stderr : process.stdout;
  for (const line of chunk.split(/\r?\n/)) {
    if (line.trim()) target.write(`[postiz-compose] ${line}\n`);
  }
}

async function waitForAuthenticatedApi(config) {
  let lastError = "Postiz did not return an API key.";
  let clearedStaleKey = false;

  while (remainingBudget() > 0) {
    try {
      const apiKey = await ensureApiKey(config);
      if (apiKey) {
        const client = new PostizApiClient(config, apiKey);
        const integrations = await client.listIntegrations();
        return integrations.length;
      }
      lastError = "Postiz did not return an API key.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      // A retained Breadboard credentials file can outlive reset Docker
      // volumes. Clear only the cached API key so bootstrap can register/login
      // again while preserving the stable local account password.
      if (!clearedStaleKey) {
        const credentials = readCredentials(config);
        if (credentials?.apiKey) {
          writeCredentials(config, { ...credentials, apiKey: "" });
          clearedStaleKey = true;
          log("cached API key was rejected; re-running local account bootstrap");
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  fail(`authenticated API readiness timed out: ${lastError}`);
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

  log(`starting optional stack at ${config.baseUrl}`);
  const heartbeat = setInterval(() => {
    log(`startup is still in progress (${Math.round((Date.now() - startedAt) / 1_000)}s elapsed)`);
  }, 15_000);

  let stack;
  try {
    stack = await startStack(config, relayComposeOutput);
  } finally {
    clearInterval(heartbeat);
  }
  if (stack.state !== "running" && stack.state !== "starting") {
    fail(stack.reason || `stack entered ${stack.state} state`);
  }

  log("containers started; waiting for the Postiz backend");
  if (!(await waitForReady(config, remainingBudget()))) {
    fail(`web readiness timed out after ${startupTimeoutMs}ms`);
  }

  log("backend answered; bootstrapping the authenticated API");
  const integrationCount = await waitForAuthenticatedApi(config);
  if (checkOnly) {
    log(`ready; authenticated API verified; ${integrationCount} integration(s) connected`);
    return;
  }

  const server = http.createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ready: true, integrations: integrationCount }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(healthPort, host, resolve);
  });
  log(`ready; authenticated API verified; ${integrationCount} integration(s) connected`);

  // A successful one-time probe is not durable supervision. If the real app
  // disappears for three consecutive checks, exit non-zero so Electron's
  // bounded restart policy starts this coordinator again.
  let consecutiveFailures = 0;
  let checking = false;
  setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      consecutiveFailures = (await reachable(config)) ? 0 : consecutiveFailures + 1;
      if (consecutiveFailures >= 3) {
        process.stderr.write("[postiz-supervisor] Postiz failed three readiness checks; restarting\n");
        process.exitCode = 1;
        server.close(() => process.exit(1));
      }
    } finally {
      checking = false;
    }
  }, 10_000);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[postiz-supervisor] fatal: ${message}\n`);
  process.exitCode = 1;
});
