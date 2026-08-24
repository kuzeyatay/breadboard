// The Postiz lifecycle owner: activation, coalescing, authentication, idle
// shutdown, ownership and cleanup.
//
// Docker is never invoked here. Every dependency the coordinator has on the
// outside world is injected, so these tests assert the decisions — when a
// `compose up` is issued, how many are issued, what a status read is allowed to
// touch, and what may be stopped — rather than the containers.

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ACTIVATION_REASONS,
  PostizCoordinator,
  normalizeActivationReason,
} from "../src/lib/socials-manager/coordinator-core.ts";
import {
  MAX_CONTROL_BODY_BYTES,
  handleCoordinatorRequest,
  isAuthorized,
} from "../src/lib/socials-manager/coordinator-server.ts";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  pendingScheduledWork,
  resolveIdleTimeoutMs,
} from "../src/lib/socials-manager/coordinator-runtime.ts";
import {
  activateStack,
  deactivateStack,
  observeStack,
  releaseActivation,
  resolveCoordinatorEndpoint,
} from "../src/lib/socials-manager/activation.ts";
import { openPostizSession, syncPendingPosts } from "../src/lib/socials-manager/service.ts";
import { PostizApiClient } from "../src/lib/socials-manager/api-client.ts";
import { resolveSocialsManagerConfig } from "../src/lib/socials-manager/config.ts";
import { renderOverride } from "../src/lib/socials-manager/stack.ts";

const config = resolveSocialsManagerConfig({ SOCIALS_MANAGER_URL: "http://localhost:4007" });

/**
 * A coordinator whose whole world is a mutable record of what it was asked to
 * do. `calls` is the assertion surface: every Docker-shaped action lands there.
 */
function harness(overrides = {}) {
  const calls = { start: 0, stop: 0, bootstrap: 0, reachable: 0, docker: 0, pending: 0 };
  const state = {
    reachable: false,
    startOk: true,
    startReason: undefined,
    startPreExisting: false,
    stopOk: true,
    readyAfterStart: true,
    bootstrapOk: true,
    integrations: 2,
    pending: { known: true, pending: false },
    /** Delays the compose-up step so concurrency is observable. */
    startDelayMs: 0,
    now: 1_000_000,
  };
  const logs = [];
  const deps = {
    config,
    now: () => state.now,
    log: (line) => logs.push(line),
    startupTimeoutMs: 60_000,
    idleTimeoutMs: 10_000,
    leaseTtlMs: 30_000,
    reachable: async () => {
      calls.reachable += 1;
      return state.reachable;
    },
    startStack: async () => {
      calls.start += 1;
      if (state.startDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, state.startDelayMs));
      }
      if (state.startOk && state.readyAfterStart) state.reachable = true;
      return state.startOk
        ? { ok: true, preExisting: state.startPreExisting }
        : { ok: false, preExisting: false, reason: state.startReason ?? "compose_failed" };
    },
    stopStack: async () => {
      calls.stop += 1;
      if (state.stopOk) state.reachable = false;
      return state.stopOk;
    },
    waitForReady: async () => state.readyAfterStart,
    bootstrap: async () => {
      calls.bootstrap += 1;
      return state.bootstrapOk
        ? { ok: true, integrations: state.integrations }
        : { ok: false, integrations: 0, reason: "no_api_key" };
    },
    pendingWork: async () => {
      calls.pending += 1;
      return state.pending;
    },
    dockerAvailable: async () => {
      calls.docker += 1;
      return true;
    },
    ...overrides,
  };
  return { coordinator: new PostizCoordinator(deps), calls, state, logs, deps };
}

// ------------------------------------------------------------- idle at rest

test("a fresh coordinator is stopped and has touched nothing", async () => {
  const { coordinator, calls } = harness();
  const snapshot = coordinator.snapshot();
  assert.equal(snapshot.state, "stopped");
  assert.equal(snapshot.ownership, "unknown");
  assert.deepEqual(calls, { start: 0, stop: 0, bootstrap: 0, reachable: 0, docker: 0, pending: 0 });
});

test("polling status never starts Docker, Compose, or anything else", async () => {
  const { coordinator, calls } = harness();
  for (let i = 0; i < 25; i += 1) coordinator.snapshot();
  assert.equal(calls.start, 0);
  assert.equal(calls.docker, 0);
  assert.equal(calls.reachable, 0);
});

test("reading status does not mutate the state machine", async () => {
  const { coordinator } = harness();
  const before = coordinator.snapshot();
  coordinator.snapshot();
  coordinator.snapshot();
  assert.deepEqual(coordinator.snapshot(), before);
});

// ------------------------------------------------------------- activation

test("the first explicit request is what starts the stack", async () => {
  const { coordinator, calls } = harness();
  const result = await coordinator.ensureReady({ reason: "run" });
  assert.equal(result.ready, true);
  assert.equal(result.state, "ready");
  assert.equal(result.ownership, "breadboard");
  assert.equal(result.integrations, 2);
  assert.equal(calls.start, 1);
  assert.equal(calls.bootstrap, 1);
});

test("concurrent requests share one compose startup", async () => {
  const { coordinator, calls, state } = harness();
  state.startDelayMs = 60;
  const results = await Promise.all([
    coordinator.ensureReady({ reason: "run" }),
    coordinator.ensureReady({ reason: "publish" }),
    coordinator.ensureReady({ reason: "channels" }),
    coordinator.ensureReady({ reason: "sync" }),
  ]);
  assert.equal(calls.start, 1, "exactly one compose up for four concurrent callers");
  assert.equal(calls.bootstrap, 1, "exactly one account bootstrap");
  for (const result of results) assert.equal(result.ready, true);
});

test("a second request after readiness reuses the running stack", async () => {
  const { coordinator, calls } = harness();
  await coordinator.ensureReady({ reason: "run" });
  await coordinator.ensureReady({ reason: "publish" });
  await coordinator.ensureReady({ reason: "publish" });
  assert.equal(calls.start, 1);
});

test("a failed startup is retryable, not sticky", async () => {
  const { coordinator, calls, state } = harness();
  state.startOk = false;
  state.startReason = "The container engine is not running.";
  const failed = await coordinator.ensureReady({ reason: "run" });
  assert.equal(failed.ready, false);
  assert.equal(failed.state, "failed");
  assert.equal(failed.reason, "The container engine is not running.");

  state.startOk = true;
  const recovered = await coordinator.ensureReady({ reason: "run" });
  assert.equal(recovered.ready, true);
  assert.equal(calls.start, 2, "the retry issued a real second attempt");
});

test("a caller that gives up early leaves the shared attempt running", async () => {
  const { coordinator, calls, state } = harness();
  state.startDelayMs = 120;
  const impatient = await coordinator.ensureReady({ reason: "run", timeoutMs: 10 });
  assert.equal(impatient.ready, false);
  assert.equal(impatient.state, "starting");
  assert.match(impatient.reason ?? "", /still starting/i);

  // The activation was never cancelled, so the next caller finds it ready.
  const patient = await coordinator.ensureReady({ reason: "run" });
  assert.equal(patient.ready, true);
  assert.equal(calls.start, 1, "the abandoned caller must not have caused a second start");
});

test("bootstrap failure is reported as a sanitized category, not raw output", async () => {
  const { coordinator, state } = harness();
  state.bootstrapOk = false;
  const result = await coordinator.ensureReady({ reason: "run" });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "no_api_key");
});

test("a thrown dependency becomes one short sanitized line", async () => {
  const { coordinator } = harness({
    startStack: async () => {
      throw new Error(
        "compose up failed\nJWT_SECRET=supersecret\nDATABASE_URL=postgres://user:pw@host/db",
      );
    },
  });
  const result = await coordinator.ensureReady({ reason: "run" });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "compose up failed");
  assert.equal(result.reason?.includes("supersecret"), false);
});

test("an activation reason is always one of the closed set", () => {
  assert.equal(normalizeActivationReason("run"), "run");
  assert.equal(normalizeActivationReason("../../etc/passwd"), "other");
  assert.equal(normalizeActivationReason({ toString: () => "run" }), "other");
  assert.equal(normalizeActivationReason(undefined), "other");
  for (const reason of ACTIVATION_REASONS) {
    assert.equal(normalizeActivationReason(reason), reason);
  }
});

// ------------------------------------------------------------- ownership

test("a stack that was already up is adopted, not claimed", async () => {
  const { coordinator, calls, state } = harness();
  state.reachable = true;
  const result = await coordinator.ensureReady({ reason: "run" });
  assert.equal(result.ready, true);
  assert.equal(result.ownership, "pre-existing");
  assert.equal(calls.start, 0, "an already-running stack must not be started again");
});

test("a pre-existing stack is never stopped by the idle timer", async () => {
  const { coordinator, calls, state } = harness();
  state.reachable = true;
  await coordinator.ensureReady({ reason: "run" });
  state.now += 10 * 60_000;
  const decision = await coordinator.idleDecision();
  assert.equal(decision.stop, false);
  assert.equal(decision.reason, "not_breadboard_started");
  assert.equal(await coordinator.idleTick(), false);
  assert.equal(calls.stop, 0);
});

test("a pre-existing stack is left running when Breadboard exits", async () => {
  const { coordinator, calls, state } = harness();
  state.reachable = true;
  await coordinator.ensureReady({ reason: "run" });
  assert.equal(await coordinator.close(), false);
  assert.equal(calls.stop, 0);
});

// ------------------------------------------------------------- idle policy

test("a Breadboard-started, draft-only, idle stack is stopped after the threshold", async () => {
  const { coordinator, calls, state } = harness();
  await coordinator.ensureReady({ reason: "run" });
  assert.equal((await coordinator.idleDecision()).reason, "not_idle_yet");

  state.now += 11_000;
  const decision = await coordinator.idleDecision();
  assert.deepEqual(decision, { stop: true, reason: "idle_draft_only" });
  assert.equal(await coordinator.idleTick(), true);
  assert.equal(calls.stop, 1);
  assert.equal(coordinator.snapshot().state, "stopped");
});

test("a future scheduled post suppresses idle shutdown", async () => {
  const { coordinator, calls, state } = harness();
  await coordinator.ensureReady({ reason: "run" });
  state.pending = { known: true, pending: true };
  state.now += 11_000;
  const decision = await coordinator.idleDecision();
  assert.deepEqual(decision, { stop: false, reason: "scheduled_post_pending" });
  assert.equal(await coordinator.idleTick(), false);
  assert.equal(calls.stop, 0);
});

test("a locally reported future schedule suppresses idle shutdown without an API call", async () => {
  const { coordinator, calls, state } = harness();
  await coordinator.ensureReady({
    reason: "schedule",
    nextScheduledAt: new Date(state.now + 3 * 86_400_000).toISOString(),
  });
  state.now += 11_000;
  const decision = await coordinator.idleDecision();
  assert.equal(decision.stop, false);
  assert.equal(decision.reason, "scheduled_post_pending");
  assert.equal(calls.pending, 0, "the local answer was enough");
});

test("an unanswerable pending-work check fails safe and says why", async () => {
  const { coordinator, calls, state } = harness();
  await coordinator.ensureReady({ reason: "run" });
  state.pending = { known: false, pending: false, detail: "no_api_key" };
  state.now += 11_000;
  const decision = await coordinator.idleDecision();
  assert.equal(decision.stop, false);
  assert.equal(decision.reason, "pending_work_unknown:no_api_key");
  assert.equal(calls.stop, 0);
});

test("an active lease suppresses idle shutdown until it is released", async () => {
  const { coordinator, calls, state } = harness();
  const activation = await coordinator.ensureReady({ reason: "run", hold: true });
  assert.ok(activation.leaseId);

  state.now += 11_000;
  assert.equal((await coordinator.idleDecision()).reason, "active_lease");
  assert.equal(await coordinator.idleTick(), false);

  assert.equal(coordinator.releaseLease(activation.leaseId), true);
  state.now += 11_000;
  assert.equal(await coordinator.idleTick(), true);
  assert.equal(calls.stop, 1);
});

test("a lease from a caller that never came back expires instead of pinning forever", async () => {
  const { coordinator, state } = harness();
  await coordinator.ensureReady({ reason: "run", hold: true });
  assert.equal(coordinator.activeLeases(), 1);
  // Past the 30s test TTL.
  state.now += 45_000;
  assert.equal(coordinator.activeLeases(), 0);
  assert.equal(await coordinator.idleTick(), true);
});

test("idle shutdown can be switched off entirely", async () => {
  const { coordinator, state } = harness({ idleTimeoutMs: 0 });
  await coordinator.ensureReady({ reason: "run" });
  state.now += 60 * 60_000;
  assert.deepEqual(await coordinator.idleDecision(), {
    stop: false,
    reason: "idle_stop_disabled",
  });
});

test("the idle window is configurable and a broken value never stops anything", () => {
  assert.equal(resolveIdleTimeoutMs({}), DEFAULT_IDLE_TIMEOUT_MS);
  assert.equal(resolveIdleTimeoutMs({ POSTIZ_IDLE_TIMEOUT_MS: "60000" }), 60_000);
  assert.equal(resolveIdleTimeoutMs({ POSTIZ_IDLE_TIMEOUT_MS: "0" }), 0);
  assert.equal(resolveIdleTimeoutMs({ POSTIZ_IDLE_TIMEOUT_MS: "nonsense" }), 0);
  assert.equal(resolveIdleTimeoutMs({ POSTIZ_IDLE_TIMEOUT_MS: "-5" }), 0);
  assert.ok(DEFAULT_IDLE_TIMEOUT_MS >= 20 * 60_000 && DEFAULT_IDLE_TIMEOUT_MS <= 30 * 60_000);
});

// ------------------------------------------------------------- stop and exit

test("stop during startup waits for the activation rather than racing it", async () => {
  const { coordinator, calls, state } = harness();
  state.startDelayMs = 80;
  const starting = coordinator.ensureReady({ reason: "run" });
  const stopping = coordinator.stop("manual");
  const [started, stopped] = await Promise.all([starting, stopping]);
  assert.equal(started.ready, true);
  assert.equal(stopped, true);
  assert.equal(calls.start, 1);
  assert.equal(calls.stop, 1);
  assert.equal(coordinator.snapshot().state, "stopped");
});

test("concurrent stops issue one compose down", async () => {
  const { coordinator, calls } = harness();
  await coordinator.ensureReady({ reason: "run" });
  await Promise.all([coordinator.stop(), coordinator.stop(), coordinator.stop()]);
  assert.equal(calls.stop, 1);
});

test("a stop that fails leaves the previous state rather than lying", async () => {
  const { coordinator, state } = harness();
  await coordinator.ensureReady({ reason: "run" });
  state.stopOk = false;
  assert.equal(await coordinator.stop(), false);
  assert.equal(coordinator.snapshot().state, "ready");
  assert.match(coordinator.snapshot().reason ?? "", /could not be stopped/);
});

test("a stopped stack can be started again", async () => {
  const { coordinator, calls } = harness();
  await coordinator.ensureReady({ reason: "run" });
  await coordinator.stop();
  const again = await coordinator.ensureReady({ reason: "publish" });
  assert.equal(again.ready, true);
  assert.equal(calls.start, 2);
});

test("exit stops only a Breadboard-started stack with nothing pending", async () => {
  const clean = harness();
  await clean.coordinator.ensureReady({ reason: "run" });
  assert.equal(await clean.coordinator.close(), true);
  assert.equal(clean.calls.stop, 1);

  const scheduled = harness();
  await scheduled.coordinator.ensureReady({ reason: "run" });
  scheduled.state.pending = { known: true, pending: true };
  assert.equal(await scheduled.coordinator.close(), false);
  assert.equal(scheduled.calls.stop, 0);

  const busy = harness();
  await busy.coordinator.ensureReady({ reason: "run", hold: true });
  assert.equal(await busy.coordinator.close(), false);
  assert.equal(busy.calls.stop, 0);
});

test("a closed coordinator refuses to start the stack again", async () => {
  const { coordinator, calls } = harness();
  await coordinator.close();
  const result = await coordinator.ensureReady({ reason: "run" });
  assert.equal(result.ready, false);
  assert.equal(calls.start, 0);
});

// -------------------------------------------------- the compose contract

test("stopping uses `down` and never touches volumes, prune, or WSL", async () => {
  // The real stop path, read as source: the one place a stop command is built.
  const source = await import("node:fs").then(({ readFileSync }) =>
    readFileSync(new URL("../src/lib/socials-manager/stack.ts", import.meta.url), "utf8"),
  );
  const stopBody = source.slice(source.indexOf("export async function stopStack"));
  assert.match(stopBody, /"down"/);
  assert.equal(/--volumes|"-v"|'-v'/.test(stopBody), false, "stop must never delete volumes");
  assert.equal(/prune/i.test(source), false, "nothing here may prune Docker state");
  assert.equal(/wsl/i.test(source), false, "nothing here may touch a WSL distribution");
  assert.equal(/taskkill/i.test(source), false);
});

test("no part of the socials-manager layer can shut down WSL or prune Docker", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../src/lib/socials-manager/", import.meta.url);
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".ts")) continue;
    const text = readFileSync(new URL(entry, dir), "utf8");
    assert.equal(
      /wsl\s*--shutdown|docker\s+system\s+prune|volume\s+prune|container\s+prune|down\s+-v/i.test(
        text,
      ),
      false,
      `${entry} must not contain a destructive Docker or WSL command`,
    );
  }
});

test("the generated override keeps a deliberate stop stopped without a restart loop", () => {
  const override = renderOverride(config, {
    email: "breadboard@localhost.local",
    password: "pw",
    apiKey: "",
    jwtSecret: "secret",
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  // Upstream ships `restart: always`. The coordinator owns any later recovery
  // so a commit-pressure failure is never retried blindly by Docker.
  assert.match(override, /restart: 'no'/);
  assert.equal(/restart: always/.test(override), false);
});

// ------------------------------------------------------------- the control plane

const TOKEN = "capability-token-0123456789abcdef";

test("an unauthenticated control request is refused and changes nothing", async () => {
  const { coordinator, calls } = harness();
  for (const authorization of [undefined, "", "Bearer ", "Bearer wrong", TOKEN, "Basic x"]) {
    const response = await handleCoordinatorRequest(
      { method: "POST", url: "/ensure-ready", authorization, body: '{"reason":"run"}' },
      coordinator,
      TOKEN,
    );
    assert.equal(response.status, 401);
    assert.equal(response.json.error, "unauthorized");
  }
  assert.equal(calls.start, 0, "an unauthenticated caller must not have started anything");
});

test("a coordinator with no token refuses every control request", async () => {
  const { coordinator, calls } = harness();
  const response = await handleCoordinatorRequest(
    { method: "POST", url: "/ensure-ready", authorization: "Bearer anything" },
    coordinator,
    "",
  );
  assert.equal(response.status, 503);
  assert.equal(response.json.error, "coordinator_unconfigured");
  assert.equal(calls.start, 0);
});

test("the bearer check is exact and length-safe", () => {
  assert.equal(isAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(isAuthorized(`bearer ${TOKEN}`, TOKEN), true);
  assert.equal(isAuthorized(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(isAuthorized(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN), false);
  assert.equal(isAuthorized(undefined, TOKEN), false);
  assert.equal(isAuthorized(`Bearer ${TOKEN}`, ""), false);
});

test("health is open, says nothing secret, and never starts Docker", async () => {
  const { coordinator, calls } = harness();
  const response = await handleCoordinatorRequest(
    { method: "GET", url: "/health" },
    coordinator,
    TOKEN,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { ok: true, stack: "stopped" });
  assert.equal(JSON.stringify(response.json).includes(TOKEN), false);
  assert.equal(calls.start, 0);
  assert.equal(calls.docker, 0);
});

test("health reports the coordinator is alive while the stack is stopped", async () => {
  const { coordinator } = harness();
  const before = await handleCoordinatorRequest({ method: "GET", url: "/health" }, coordinator, TOKEN);
  assert.equal(before.json.ok, true);
  assert.equal(before.json.stack, "stopped");
  await coordinator.ensureReady({ reason: "run" });
  const after = await handleCoordinatorRequest({ method: "GET", url: "/health" }, coordinator, TOKEN);
  assert.equal(after.json.stack, "ready");
});

test("no control response carries the capability token", async () => {
  const { coordinator } = harness();
  const auth = `Bearer ${TOKEN}`;
  const responses = [
    await handleCoordinatorRequest({ method: "GET", url: "/health" }, coordinator, TOKEN),
    await handleCoordinatorRequest({ method: "GET", url: "/status", authorization: auth }, coordinator, TOKEN),
    await handleCoordinatorRequest(
      { method: "POST", url: "/ensure-ready", authorization: auth, body: '{"reason":"run"}' },
      coordinator,
      TOKEN,
    ),
    await handleCoordinatorRequest({ method: "POST", url: "/stop", authorization: auth }, coordinator, TOKEN),
    await handleCoordinatorRequest({ method: "GET", url: "/nope", authorization: auth }, coordinator, TOKEN),
  ];
  for (const response of responses) {
    assert.equal(JSON.stringify(response.json).includes(TOKEN), false);
  }
});

test("an oversized control body is refused before it is parsed", async () => {
  const { coordinator, calls } = harness();
  const response = await handleCoordinatorRequest(
    {
      method: "POST",
      url: "/ensure-ready",
      authorization: `Bearer ${TOKEN}`,
      body: "x".repeat(MAX_CONTROL_BODY_BYTES + 1),
    },
    coordinator,
    TOKEN,
  );
  assert.equal(response.status, 413);
  assert.equal(calls.start, 0);
});

test("a malformed body is treated as empty rather than failing the request", async () => {
  const { coordinator } = harness();
  const response = await handleCoordinatorRequest(
    { method: "POST", url: "/ensure-ready", authorization: `Bearer ${TOKEN}`, body: "{not json" },
    coordinator,
    TOKEN,
  );
  assert.equal(response.status, 200);
  assert.equal(response.json.ready, true);
});

test("status over the control plane is authenticated and side-effect-free", async () => {
  const { coordinator, calls } = harness();
  const unauthenticated = await handleCoordinatorRequest(
    { method: "GET", url: "/status" },
    coordinator,
    TOKEN,
  );
  assert.equal(unauthenticated.status, 401);

  const authenticated = await handleCoordinatorRequest(
    { method: "GET", url: "/status?whatever=1", authorization: `Bearer ${TOKEN}` },
    coordinator,
    TOKEN,
  );
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.json.state, "stopped");
  assert.equal(calls.start, 0);
  assert.equal(calls.docker, 0);
});

test("release drops exactly one hold", async () => {
  const { coordinator } = harness();
  const auth = `Bearer ${TOKEN}`;
  const activated = await handleCoordinatorRequest(
    { method: "POST", url: "/ensure-ready", authorization: auth, body: '{"reason":"run","hold":true}' },
    coordinator,
    TOKEN,
  );
  const leaseId = activated.json.leaseId;
  assert.ok(typeof leaseId === "string");
  const released = await handleCoordinatorRequest(
    { method: "POST", url: "/release", authorization: auth, body: JSON.stringify({ leaseId }) },
    coordinator,
    TOKEN,
  );
  assert.equal(released.json.released, true);
  assert.equal(released.json.leases, 0);
});

// ------------------------------------------------- the dashboard's client

test("a coordinator endpoint needs both halves and must be loopback", () => {
  assert.equal(resolveCoordinatorEndpoint({}), null);
  assert.equal(resolveCoordinatorEndpoint({ POSTIZ_COORDINATOR_URL: "http://127.0.0.1:7721" }), null);
  assert.equal(resolveCoordinatorEndpoint({ POSTIZ_COORDINATOR_TOKEN: "t" }), null);
  assert.equal(
    resolveCoordinatorEndpoint({
      POSTIZ_COORDINATOR_URL: "http://example.com:7721",
      POSTIZ_COORDINATOR_TOKEN: "t",
    }),
    null,
    "the capability token must never be sent off-box",
  );
  assert.deepEqual(
    resolveCoordinatorEndpoint({
      POSTIZ_COORDINATOR_URL: "http://127.0.0.1:7721/",
      POSTIZ_COORDINATOR_TOKEN: "t",
    }),
    { url: "http://127.0.0.1:7721", token: "t" },
  );
});

/** A stand-in coordinator process, so the dashboard client is tested over real HTTP. */
async function fakeCoordinator(handler) {
  const seen = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      const result = handler({ url: request.url ?? "", body }) ?? { status: 200, json: {} };
      response.writeHead(result.status, { "content-type": "application/json" });
      response.end(JSON.stringify(result.json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    seen,
    env: {
      POSTIZ_COORDINATOR_URL: `http://127.0.0.1:${port}`,
      POSTIZ_COORDINATOR_TOKEN: TOKEN,
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("the dashboard activates through the coordinator, bearing the capability token", async (t) => {
  const fake = await fakeCoordinator(({ url }) =>
    url.startsWith("/ensure-ready")
      ? {
          status: 200,
          json: { ok: true, ready: true, state: "ready", ownership: "breadboard", leaseId: "L1" },
        }
      : { status: 404, json: {} },
  );
  t.after(() => fake.close());

  const outcome = await activateStack(config, { reason: "run", timeoutMs: 1_000, hold: true }, fake.env);
  assert.equal(outcome.ready, true);
  assert.equal(outcome.via, "coordinator");
  assert.equal(outcome.leaseId, "L1");
  assert.equal(fake.seen[0].authorization, `Bearer ${TOKEN}`);
  assert.equal(JSON.parse(fake.seen[0].body).reason, "run");
});

test("an unreachable coordinator degrades truthfully instead of starting a second launcher", async (t) => {
  const fake = await fakeCoordinator(() => ({ status: 500, json: {} }));
  t.after(() => fake.close());
  const outcome = await activateStack(config, { reason: "run", timeoutMs: 500 }, fake.env);
  assert.equal(outcome.ready, false);
  assert.equal(outcome.via, "coordinator");
  assert.match(outcome.reason ?? "", /coordinator did not respond/i);
});

test("observing the stack asks the coordinator and starts nothing", async (t) => {
  const fake = await fakeCoordinator(({ url }) =>
    url.startsWith("/status")
      ? { status: 200, json: { ok: true, state: "stopped", ownership: "unknown", leases: 0 } }
      : { status: 404, json: {} },
  );
  t.after(() => fake.close());
  const status = await observeStack(config, {}, fake.env);
  assert.equal(status.state, "stopped");
  assert.equal(status.reachable, false);
  assert.equal(fake.seen.length, 1);
  assert.equal(fake.seen[0].method, "GET");
  assert.match(fake.seen[0].url, /^\/status/);
});

test("stopping goes through the coordinator, and release is fire-and-forget-safe", async (t) => {
  const fake = await fakeCoordinator(({ url }) =>
    url.startsWith("/stop")
      ? { status: 200, json: { ok: true, stopped: true } }
      : { status: 200, json: { ok: true, released: true } },
  );
  t.after(() => fake.close());
  assert.equal(await deactivateStack(config, fake.env), true);
  await releaseActivation("L1", fake.env);
  await releaseActivation(null, fake.env);
  assert.equal(fake.seen.length, 2, "a null lease must not produce a request");
});

// ---------------------------------------------------- pending scheduled work

test("pending work is unknown, never 'no', when there is no API key to ask with", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "bb-postiz-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scoped = { ...config, stateDir: dir, credentialsFile: path.join(dir, "credentials.json") };
  const answer = await pendingScheduledWork(scoped);
  assert.deepEqual(answer, { known: false, pending: false, detail: "no_api_key" });
});

test("an upcoming Postiz post is reported as pending work", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "bb-postiz-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(dir, "credentials.json"),
    JSON.stringify({
      email: "breadboard@localhost.local",
      password: "pw",
      apiKey: "key-123",
      jwtSecret: "secret",
    }),
  );

  const now = Date.parse("2026-08-23T12:00:00.000Z");
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        posts: [
          { id: "p1", content: "old", publishDate: "2026-08-22T09:00:00.000Z", state: "PUBLISHED" },
          { id: "p2", content: "next", publishDate: "2026-08-24T09:00:00.000Z", state: "QUEUE" },
        ],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const scoped = {
    ...config,
    baseUrl: base,
    publicApiUrl: `${base}/api/public/v1`,
    appApiUrl: `${base}/api`,
    stateDir: dir,
    credentialsFile: path.join(dir, "credentials.json"),
  };

  assert.deepEqual(await pendingScheduledWork(scoped, () => now), { known: true, pending: true });
});

test("a Postiz API that will not answer leaves pending work unknown", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "bb-postiz-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(dir, "credentials.json"),
    JSON.stringify({ email: "e", password: "p", apiKey: "k", jwtSecret: "s" }),
  );
  const scoped = {
    ...config,
    // Nothing listening: the client fails, and the answer must not be "no".
    baseUrl: "http://127.0.0.1:1",
    publicApiUrl: "http://127.0.0.1:1/api/public/v1",
    appApiUrl: "http://127.0.0.1:1/api",
    stateDir: dir,
    credentialsFile: path.join(dir, "credentials.json"),
  };
  const answer = await pendingScheduledWork(scoped);
  assert.equal(answer.known, false);
  assert.equal(answer.pending, false);
});

// ------------------------------------------------------ offline drafting

/**
 * A dead Postiz URL plus a coordinator that reports failure: exactly the shape
 * of "Docker is not available" and "the cold start has not finished yet".
 */
function offlineEnv(coordinatorEnv) {
  return {
    SOCIALS_MANAGER_MODE: "stack",
    // Nothing listens here, so `reachable` is false without touching Docker.
    SOCIALS_MANAGER_URL: "http://127.0.0.1:1",
    SOCIALS_MANAGER_READY_TIMEOUT_MS: "200",
    ...coordinatorEnv,
  };
}

test("Docker being unavailable leaves the run drafting locally, with a reason", async (t) => {
  const fake = await fakeCoordinator(({ url }) =>
    url.startsWith("/ensure-ready")
      ? {
          status: 200,
          json: {
            ok: true,
            ready: false,
            state: "failed",
            ownership: "unknown",
            reason: "The container engine is not running.",
          },
        }
      : { status: 404, json: {} },
  );
  t.after(() => fake.close());

  const availability = await openPostizSession({ reason: "run" }, offlineEnv(fake.env));
  assert.equal(availability.session, null);
  assert.equal(availability.state, "stopped");
  assert.equal(availability.reason, "The container engine is not running.");
  // No lease was taken, so nothing is left pinning a stack that never started.
  assert.equal(availability.leaseId, undefined);
});

test("a cold start that outruns the run budget degrades truthfully to local drafting", async (t) => {
  const fake = await fakeCoordinator(({ url }) =>
    url.startsWith("/ensure-ready")
      ? {
          status: 200,
          json: {
            ok: true,
            ready: false,
            state: "starting",
            ownership: "breadboard",
            reason: "Postiz is still starting.",
          },
        }
      : { status: 404, json: {} },
  );
  t.after(() => fake.close());

  const availability = await openPostizSession({ reason: "run", hold: true }, offlineEnv(fake.env));
  assert.equal(availability.session, null);
  // "starting", not "running" and not "failed": the containers really are
  // coming up, and the next run will find them.
  assert.equal(availability.state, "starting");
  assert.match(availability.reason ?? "", /still starting/i);
  assert.equal(availability.leaseId, undefined);
});

test("the Socials Manager still drafts locally with no coordinator configured at all", async () => {
  // No POSTIZ_COORDINATOR_* at all and an unreachable Postiz: the direct
  // fallback is selected. It is given `adapter` mode so the assertion is about
  // the degrade path and no Docker command is ever issued from a test.
  const availability = await openPostizSession(
    { reason: "run" },
    { SOCIALS_MANAGER_MODE: "adapter", SOCIALS_MANAGER_URL: "http://127.0.0.1:1" },
  );
  assert.equal(availability.session, null);
  assert.equal(availability.state, "adapter");
  assert.equal(availability.reason, "Local drafting mode.");
});

test("a later healthy session pushes the drafts made while Postiz was down", async (t) => {
  const created = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url?.endsWith("/posts")) {
        created.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: `remote-${created.length}` }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end("[]");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const offline = [
    { id: 1, providerId: "x", content: "drafted offline", scheduledAt: "2026-09-01T09:00", status: "scheduled", remoteId: null, imageArtifactId: null },
    { id: 2, providerId: "linkedin", content: "also offline", scheduledAt: "2026-09-01T10:00", status: "draft", remoteId: null, imageArtifactId: null },
    { id: 3, providerId: "x", content: "already pushed", scheduledAt: "2026-09-01T11:00", status: "scheduled", remoteId: "remote-existing", imageArtifactId: null },
  ];
  const updates = [];
  const store = {
    listPosts: () => offline,
    updatePost: (_userId, id, patch) => updates.push({ id, ...patch }),
  };
  const session = {
    config: { ...config, baseUrl: base, publicApiUrl: `${base}/api/public/v1`, appApiUrl: `${base}/api` },
    integrations: [
      { id: "int-x", identifier: "x", name: "X", disabled: false },
      { id: "int-li", identifier: "linkedin", name: "LinkedIn", disabled: false },
    ],
    client: new PostizApiClient(
      { ...config, publicApiUrl: `${base}/api/public/v1`, appApiUrl: `${base}/api` },
      "key-123",
    ),
  };

  const pushed = await syncPendingPosts(session, store, 1);
  assert.equal(pushed, 2, "both offline drafts reached Postiz");
  assert.equal(created.length, 2);
  assert.deepEqual(
    updates.map((update) => update.id),
    [1, 2],
  );
  assert.equal(
    updates.some((update) => update.id === 3),
    false,
    "a post Postiz already owns is not sent twice",
  );
});

test("the exit endpoint is conditional where the manual stop is not", async () => {
  const auth = `Bearer ${TOKEN}`;

  // Breadboard started it and nothing is pending: exit may clean it up.
  const owned = harness();
  await owned.coordinator.ensureReady({ reason: "run" });
  const exited = await handleCoordinatorRequest(
    { method: "POST", url: "/shutdown", authorization: auth },
    owned.coordinator,
    TOKEN,
  );
  assert.equal(exited.json.stopped, true);
  assert.equal(owned.calls.stop, 1);

  // Someone else's stack: exit leaves it exactly as found...
  const adopted = harness();
  adopted.state.reachable = true;
  await adopted.coordinator.ensureReady({ reason: "run" });
  const left = await handleCoordinatorRequest(
    { method: "POST", url: "/shutdown", authorization: auth },
    adopted.coordinator,
    TOKEN,
  );
  assert.equal(left.json.stopped, false);
  assert.equal(adopted.calls.stop, 0);

  // ...while an explicit user-initiated stop still stops it.
  const manual = harness();
  manual.state.reachable = true;
  await manual.coordinator.ensureReady({ reason: "manual" });
  const stopped = await handleCoordinatorRequest(
    { method: "POST", url: "/stop", authorization: auth },
    manual.coordinator,
    TOKEN,
  );
  assert.equal(stopped.json.stopped, true);
  assert.equal(manual.calls.stop, 1);
});

test("the exit endpoint is authenticated too", async () => {
  const { coordinator, calls } = harness();
  await coordinator.ensureReady({ reason: "run" });
  const response = await handleCoordinatorRequest(
    { method: "POST", url: "/shutdown", authorization: "Bearer nope" },
    coordinator,
    TOKEN,
  );
  assert.equal(response.status, 401);
  assert.equal(calls.stop, 0);
});
