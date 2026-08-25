import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixtureRoot = path.join(dashboardRoot, "tests", "fixtures");
const workerPath = path.join(dashboardRoot, "scripts", "learn-worker.mjs");
const hookPath = path.join(
  fixtureRoot,
  "learn-worker-capability-hook.mjs",
);

function readEvents(eventsPath) {
  if (!fs.existsSync(eventsPath)) return [];
  return fs
    .readFileSync(eventsPath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function waitForCondition(predicate, message, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      try {
        if (predicate()) {
          clearInterval(timer);
          resolve();
          return;
        }
      } catch {
        // Atomic receipt writes can briefly make the observation unavailable.
      }
      if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error(message));
      }
    }, 20);
  });
}

function startFixtureWorker(mode) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `learn-worker-capability-${mode}-`),
  );
  const runtimeRoot = path.join(temporaryRoot, "runtime", "learn-workers");
  const contentPath = path.join(temporaryRoot, "content");
  const eventsPath = path.join(temporaryRoot, "events.jsonl");
  const gatePath = path.join(temporaryRoot, "release-gate");
  const requestId = `capability-${mode}-${randomUUID()}`;
  const nonce = randomUUID();
  const markerPath = path.join(runtimeRoot, "learn-worker.active.json");
  const startupPath = path.join(runtimeRoot, `learn-worker-${requestId}.start.json`);
  const receiptPath = path.join(runtimeRoot, `learn-worker-${requestId}.ready.json`);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(contentPath, { recursive: true });
  fs.writeFileSync(
    markerPath,
    `${JSON.stringify({
      protocolVersion: 1,
      requestId,
      nonce,
      pid: process.pid,
      state: "launching",
    })}\n`,
    "utf8",
  );
  fs.writeFileSync(
    startupPath,
    `${JSON.stringify({
      protocolVersion: 1,
      type: "start",
      requestId,
      receiptPath,
      concurrencyPath: markerPath,
      concurrencyNonce: nonce,
      request: {
        operation: "humanizer",
        gardenId: `capability-${mode}-garden`,
        userId: 1,
        contentPath,
        enabled: true,
      },
    })}\n`,
    "utf8",
  );

  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      pathToFileURL(hookPath).href,
      workerPath,
      "--breadboard-learn-start-file",
      startupPath,
    ],
    {
      cwd: dashboardRoot,
      detached: true,
      windowsHide: true,
      env: {
        ...process.env,
        BREADBOARD_LEARN_WORKER_RUNTIME_DIR: runtimeRoot,
        QUARTZ_CONTENT_PATH: contentPath,
        LEARN_WORKER_TEST_CAPABILITY_FIXTURE_ROOT: fixtureRoot,
        LEARN_WORKER_TEST_CAPABILITY_EVENTS: eventsPath,
        LEARN_WORKER_TEST_CAPABILITY_GATE: gatePath,
        LEARN_WORKER_TEST_CAPABILITY_MODE: mode,
      },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    eventsPath,
    exit,
    gatePath,
    receiptPath,
    temporaryRoot,
  };
}

async function cleanupFixture(fixture) {
  if (fixture.child.exitCode === null && fixture.child.signalCode === null) {
    fixture.child.kill();
    await Promise.race([
      fixture.exit.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  fs.rmSync(fixture.temporaryRoot, { recursive: true, force: true });
}

test("Learn capability denial happens before the heavyweight executor import", async () => {
  const fixture = startFixtureWorker("deny");
  try {
    const exit = await fixture.exit;
    assert.deepEqual(exit, { code: 1, signal: null });
    const receipt = readJsonIfPresent(fixture.receiptPath);
    assert.equal(receipt?.type, "failed");
    assert.equal(receipt?.error?.name, "SupervisorResourceExhaustedError");
    assert.deepEqual(
      readEvents(fixture.eventsPath).map(({ event }) => event),
      ["acquire"],
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

for (const mode of ["success", "failure"]) {
  test(`Learn worker releases its single capability lease after terminal ${mode}`, async () => {
    const fixture = startFixtureWorker(mode);
    try {
      const exit = await fixture.exit;
      assert.deepEqual(exit, { code: mode === "success" ? 0 : 1, signal: null });
      const receipt = readJsonIfPresent(fixture.receiptPath);
      assert.equal(receipt?.type, mode === "success" ? "completed" : "failed");
      assert.deepEqual(
        readEvents(fixture.eventsPath).map(({ event }) => event),
        ["acquire", "executor-import", "execute", "release"],
      );
      const events = readEvents(fixture.eventsPath);
      assert.equal(events[0].capabilityId, "learn-worker");
      assert.equal(events[0].reason, "learn-humanizer");
      assert.equal(events.at(-1).leaseId, "learn-worker-fixture-lease");
      assert.equal(events.at(-1).afterOwnerPidExit, fixture.child.pid);
    } finally {
      await cleanupFixture(fixture);
    }
  });
}

test("detached Learn work retains the capability after handoff and releases at completion", async () => {
  const fixture = startFixtureWorker("handoff");
  try {
    await waitForCondition(
      () => readJsonIfPresent(fixture.receiptPath)?.type === "ready",
      "The fixture worker did not publish its durable handoff.",
    );
    await waitForCondition(
      () => readEvents(fixture.eventsPath).some(({ event }) => event === "handoff-published"),
      "The fixture executor did not continue after handoff.",
    );
    assert.equal(fixture.child.exitCode, null);
    assert.deepEqual(
      readEvents(fixture.eventsPath).map(({ event }) => event),
      ["acquire", "executor-import", "execute", "handoff-published"],
    );

    fs.writeFileSync(fixture.gatePath, "release\n", "utf8");
    const exit = await fixture.exit;
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.deepEqual(
      readEvents(fixture.eventsPath).map(({ event }) => event),
      [
        "acquire",
        "executor-import",
        "execute",
        "handoff-published",
        "operation-complete",
        "release",
      ],
    );
    assert.equal(
      readEvents(fixture.eventsPath).at(-1).afterOwnerPidExit,
      fixture.child.pid,
    );
    assert.equal(readJsonIfPresent(fixture.receiptPath)?.type, "ready");
  } finally {
    await cleanupFixture(fixture);
  }
});
