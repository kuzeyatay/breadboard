import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  humanizerCancel,
  humanizerHealth,
  humanizerRewrite,
  humanizerToolStatus,
} from "../src/lib/humanizer/service.ts";
import { SupervisorResourceExhaustedError } from "../src/lib/supervisor-control.ts";

const passage = "The system represents a groundbreaking step forward.";
const rewrite = "The system is a step forward.";

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}

async function harness(t, { installed = true, startupDelay = 0, leaseFailure, health = {} } = {}) {
  const seen = [];
  const sidecar = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    seen.push(request.url);
    assert.equal(request.headers.authorization, "Bearer sidecar-secret");
    const answer = request.url === "/health"
      ? { status: "ok", modelState: installed ? "loaded" : "not_installed",
          modelId: "test-model", modelRevision: "test-revision", device: "cpu",
          modelInstalled: installed, modelLoaded: installed, busy: false, ...health }
      : { requestId: body.requestId, status: "complete", originalText: body.text,
          rewrittenText: rewrite, chunks: { total: 1, rewritten: 1, reverted: 0 },
          preservation: { passed: true, warnings: [] } };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(answer));
  });
  // Start with a genuinely closed port, as after Runtime's idle shutdown.
  const port = await listen(sidecar);
  await close(sidecar);
  const supervisor = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    seen.push(request.url);
    assert.equal(request.headers.authorization, `Bearer ${"a".repeat(32)}`);
    let body;
    let status = 200;
    if (request.url.endsWith("/lease-contract")) {
      body = { protocolVersion: 1, serviceId: "humanizer", acquireTimeoutMs: 30_000 };
    } else if (request.url.endsWith("/lease")) {
      if (leaseFailure) {
        status = 503;
        body = leaseFailure;
      } else {
        if (startupDelay) await new Promise(resolve => setTimeout(resolve, startupDelay));
        if (!sidecar.listening) await listen(sidecar, port);
        body = { serviceId: "humanizer", leaseId: "test-lease" };
      }
    } else if (request.url.endsWith("/release")) {
      body = { released: true };
    } else {
      status = 404;
      body = {};
    }
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  const controlPort = await listen(supervisor);
  t.after(async () => { await close(supervisor); await close(sidecar); });
  return {
    seen,
    env: {
      HUMANIZER_SERVICE_URL: `http://127.0.0.1:${port}`,
      HUMANIZER_SERVICE_SECRET: "sidecar-secret",
      BREADBOARD_SUPERVISOR_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
      BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "a".repeat(32),
    },
  };
}

test("an idle rewriter wakes for command preflight, then rewrites the exact passage", async t => {
  const { env, seen } = await harness(t);
  assert.equal((await humanizerHealth(env)).status, "unreachable");
  assert.deepEqual(seen, [], "passive settings health must not start the service");
  const status = await humanizerToolStatus(env);
  assert.equal(status.ready, true);
  assert.match(status.summary, /humanize_text/);
  assert.deepEqual(seen, [
    "/v1/services/humanizer/lease-contract", "/v1/services/humanizer/lease",
    "/health", "/v1/leases/test-lease/release",
  ]);
  const result = await humanizerRewrite({ requestId: "cold-command", text: passage }, env);
  assert.equal(result.ok, true);
  assert.equal(result.originalText, passage);
  assert.equal(result.rewrittenText, rewrite);
  assert.equal(result.preservation.passed, true);
  assert.equal(seen.at(-1), "/v1/leases/test-lease/release");
});

test("the command can rewrite directly without a status call or a downloaded checkpoint", async t => {
  const { env, seen } = await harness(t, { installed: false });
  const result = await humanizerRewrite({ requestId: "direct-command", text: passage }, env);
  assert.equal(result.ok, true);
  assert.equal(seen.includes("/health"), false);
  const status = await humanizerToolStatus(env);
  assert.equal(status.ready, true);
  assert.equal(status.modelInstalled, false);
  assert.match(status.summary, /download.*first use/);
  assert.doesNotMatch(status.summary, /npm|restart|setup:/);
});

test("cold startup does not consume the health or inference request budget", async t => {
  const { env } = await harness(t, { startupDelay: 5_100 });
  assert.equal((await humanizerToolStatus(env)).ready, true);
  const result = await humanizerRewrite({ requestId: "slow-start", text: passage }, {
    ...env, BREADBOARD_HUMANIZER_TIMEOUT_MS: "5000",
  });
  assert.equal(result.ok, true);
});

test("disabled commands and cancellation never wake a stopped service", async t => {
  const { env, seen } = await harness(t);
  assert.equal((await humanizerToolStatus({ ...env, HUMANIZER_MODE: "disabled" })).state, "disabled");
  const controller = new AbortController();
  controller.abort();
  assert.equal((await humanizerRewrite({ requestId: "stopped", text: passage, signal: controller.signal }, env)).reason, "cancelled");
  await humanizerCancel("stopped", env);
  assert.deepEqual(seen, []);
});

test("a failed startup is reported without a misleading manual installation instruction", async t => {
  const { env, seen } = await harness(t, { leaseFailure: { error: "start_failed" } });
  const status = await humanizerToolStatus(env);
  assert.equal(status.ready, false);
  assert.equal(status.state, "unavailable");
  assert.doesNotMatch(status.summary, /npm|restart|setup:/);
  assert.equal(seen.includes("/health"), false);
});

test("resource admission failures remain actionable instead of becoming setup failures", async t => {
  const { env } = await harness(t, { leaseFailure: {
    code: "BREADBOARD_RESOURCE_EXHAUSTED", resource: "windows_commit",
    requiredHeadroomMb: 6144, availableHeadroomMb: 512, retryable: false, state: "critical",
  } });
  await assert.rejects(humanizerToolStatus(env), SupervisorResourceExhaustedError);
});

test("busy and broken model health remain distinct from readiness", async t => {
  const busy = await harness(t, { health: { status: "busy", busy: true } });
  assert.equal((await humanizerToolStatus(busy.env)).state, "busy");
  const broken = await harness(t, { health: { status: "degraded" } });
  assert.equal((await humanizerToolStatus(broken.env)).state, "error");
});
