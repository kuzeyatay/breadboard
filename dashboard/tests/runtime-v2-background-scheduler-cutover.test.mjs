import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeRuntimeV2BackgroundRequest,
  validateRuntimeV2BackgroundRequest,
} from "../scripts/runtime-v2-background-executor.mjs";
import {
  loadRuntimeV2BackgroundLaunch,
  parseRuntimeV2BackgroundStopRecord,
} from "../scripts/runtime-v2-background-worker.mjs";
import {
  acquireDetachedEventPump,
  waitForDetachedEventPumps,
} from "../src/lib/hermes/detached-event-pump.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const unscoped = { userId: null, gardenId: null, conversationId: null };
const userScope = { userId: 17, gardenId: null, conversationId: null };

function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

test("background requests are closed and distinguish internal from user authority", () => {
  for (const operation of [
    "skills-catalog-refresh",
    "hermes-abandoned-run-recovery",
    "scheduled-chats",
    "memory-autofetch",
    "email-poll",
    "review-scheduler",
    "caldav-sync",
    "ifixai-maintenance",
  ]) {
    assert.equal(
      validateRuntimeV2BackgroundRequest({ protocolVersion: 1, operation }, unscoped).operation,
      operation,
    );
    assert.throws(
      () => validateRuntimeV2BackgroundRequest({ protocolVersion: 1, operation }, userScope),
      /internal Runtime authority/u,
    );
  }

  assert.throws(
    () => validateRuntimeV2BackgroundRequest(
      {
        protocolVersion: 1,
        operation: "gateway-reconcile",
        gateway: "telegram",
        trigger: "explicit",
        desiredState: "running",
        decisionEpoch: 4,
      },
      unscoped,
    ),
    /authenticated user authority/u,
  );
  assert.throws(
    () => validateRuntimeV2BackgroundRequest(
      { protocolVersion: 1, operation: "scheduled-chats", extra: true },
      unscoped,
    ),
    /operation is invalid/u,
  );
});

test("gateway and dynamic schedule decisions preserve the native monotonic fence", async (t) => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-background-executor-"));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  write(
    path.join(sourceRoot, "lib/telegram/config.ts"),
    "export const telegramFeatureEnabled = () => true;\n",
  );
  write(
    path.join(sourceRoot, "lib/telegram/instance.ts"),
    "export const getTelegramStore = () => ({ requireOwner(id) { if (id !== 17) throw new Error('wrong owner'); } });\n",
  );
  const gateway = await executeRuntimeV2BackgroundRequest({
    request: {
      protocolVersion: 1,
      operation: "gateway-reconcile",
      gateway: "telegram",
      trigger: "explicit",
      desiredState: "running",
      decisionEpoch: 91,
    },
    executionScope: userScope,
    sourceRoot,
  });
  assert.deepEqual(gateway, {
    kind: "runtime-service-reconciliation",
    serviceId: "telegram-gateway",
    gateway: "telegram",
    decisionEpoch: 91,
    desiredState: "running",
    ownerUserId: 17,
    reason: "authenticated-explicit-intent",
  });

  write(
    path.join(sourceRoot, "lib/hermes/skills-catalog-store.ts"),
    "export const configuredStaleMs = () => 420000;\n",
  );
  const schedule = await executeRuntimeV2BackgroundRequest({
    request: {
      protocolVersion: 1,
      operation: "schedule-reconcile",
      schedule: "skills-catalog-refresh",
      trigger: "startup",
      desiredState: null,
      decisionEpoch: 92,
    },
    executionScope: unscoped,
    sourceRoot,
  });
  assert.equal(schedule.kind, "runtime-schedule-reconciliation");
  assert.equal(schedule.decisionEpoch, 92);
  assert.equal(schedule.initialDelayMs, 420000);
  assert.equal(schedule.intervalMs, 420000);
  assert.equal(schedule.initialDelayMs, schedule.intervalMs);
});

test("background worker launch is identity/path bound and accepts no blobs", (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-background-launch-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const identity = { jobId: "job_background_1", attempt: 2, workerInstanceId: "worker_abc" };
  const jobRoot = `runtime/jobs/${identity.jobId}`;
  const attemptRoot = `${jobRoot}/attempts/${identity.attempt}/${identity.workerInstanceId}`;
  const launchDir = path.join(dataRoot, ...attemptRoot.split("/"));
  fs.mkdirSync(path.join(launchDir, "workspace"), { recursive: true });
  write(
    path.join(dataRoot, ...`${jobRoot}/input.json`.split("/")),
    JSON.stringify({ protocolVersion: 1, operation: "memory-autofetch" }),
  );
  write(
    path.join(launchDir, "start.json"),
    JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope: unscoped,
      inputManifestPath: `${jobRoot}/input.json`,
      inputBlobs: [],
      workspacePath: `${attemptRoot}/workspace`,
      checkpointPath: `${jobRoot}/checkpoint.json`,
      resultPath: `${jobRoot}/result.json`,
    }),
  );
  const launch = loadRuntimeV2BackgroundLaunch(["start.json"], launchDir);
  assert.equal(launch.identity.jobId, identity.jobId);
  assert.equal(launch.request.operation, "memory-autofetch");

  const manifestPath = path.join(launchDir, "start.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.inputBlobs = [{ blobId: "nope" }];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(
    () => loadRuntimeV2BackgroundLaunch(["start.json"], launchDir),
    /unsupported shape/u,
  );
});

test("finite worker cancellation record is bounded and exact", () => {
  assert.deepEqual(
    parseRuntimeV2BackgroundStopRecord('{"type":"stop","force":false}\n'),
    { type: "stop", force: false },
  );
  assert.throws(
    () => parseRuntimeV2BackgroundStopRecord('{"type":"stop","force":true}\n'),
    /invalid/u,
  );
  assert.throws(
    () => parseRuntimeV2BackgroundStopRecord('{"type":"stop","force":false,"extra":1}\n'),
    /invalid/u,
  );
});

test("a disposable worker can join every detached Hermes pump before exit", async () => {
  let finished = false;
  acquireDetachedEventPump("test:runtime-v2-background", async (sink) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    finished = true;
    sink.close();
  });
  await waitForDetachedEventPumps();
  assert.equal(finished, true);
});

test("the real finite worker can run Hermes and scheduled-chat closures without Next route code", (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-background-real-worker-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));

  for (const [index, operation] of [
    "hermes-abandoned-run-recovery",
    "scheduled-chats",
  ].entries()) {
    const identity = {
      jobId: `job_background_real_${index}`,
      attempt: 1,
      workerInstanceId: `worker_real_${index}`,
    };
    const jobRoot = `runtime/jobs/${identity.jobId}`;
    const attemptRoot = `${jobRoot}/attempts/1/${identity.workerInstanceId}`;
    const launchDir = path.join(dataRoot, ...attemptRoot.split("/"));
    fs.mkdirSync(path.join(launchDir, "workspace"), { recursive: true });
    write(
      path.join(dataRoot, ...`${jobRoot}/input.json`.split("/")),
      JSON.stringify({ protocolVersion: 1, operation }),
    );
    write(
      path.join(launchDir, "start.json"),
      JSON.stringify({
        protocolVersion: 1,
        identity,
        executionScope: unscoped,
        inputManifestPath: `${jobRoot}/input.json`,
        inputBlobs: [],
        workspacePath: `${attemptRoot}/workspace`,
        checkpointPath: `${jobRoot}/checkpoint.json`,
        resultPath: `${jobRoot}/result.json`,
      }),
    );

    const worker = spawnSync(
      process.execPath,
      [path.join(dashboardRoot, "scripts", "runtime-v2-background-worker.mjs"), "start.json"],
      { cwd: launchDir, encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(worker.error, undefined, worker.error?.message);
    assert.equal(worker.status, 0, worker.stderr);
    assert.doesNotMatch(worker.stderr, /ERR_MODULE_NOT_FOUND|next[\\/]server/u);
    assert.deepEqual(
      worker.stdout.trim().split("\n").map((line) => JSON.parse(line).type),
      ["ready", "complete"],
    );
    const result = JSON.parse(
      fs.readFileSync(path.join(dataRoot, ...`${jobRoot}/result.json`.split("/")), "utf8"),
    );
    assert.equal(result.result.operation, operation);
  }
});

test("Next instrumentation has no coordinator, timers, or process spawn fallback", () => {
  const instrumentation = fs.readFileSync(
    path.join(dashboardRoot, "src", "instrumentation-runtime.ts"),
    "utf8",
  );
  assert.doesNotMatch(instrumentation, /background-coordinator|startBackgroundCoordinator|spawn\s*\(/u);
  assert.doesNotMatch(instrumentation, /setInterval|setTimeout/u);
  assert.equal(fs.existsSync(path.join(dashboardRoot, "src", "instrumentation-node.ts")), false);
  assert.equal(
    fs.existsSync(path.join(dashboardRoot, "src", "lib", "background-coordinator-launcher.ts")),
    false,
  );
  assert.equal(fs.existsSync(path.join(dashboardRoot, "scripts", "background-coordinator.mjs")), false);
});
