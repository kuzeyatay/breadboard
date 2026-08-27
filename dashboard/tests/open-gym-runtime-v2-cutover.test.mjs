import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeRuntimeV2OuterAgentAdapter,
  expectedRuntimeV2OuterAgentInputCount,
  validateRuntimeV2OpenGymRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

function request(overrides = {}) {
  return {
    task: "Build a three-day strength program.",
    model: "chat-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "User: I train at home.",
    conversationPublicId: `conv_${"a".repeat(24)}`,
    maxSteps: 16,
    ...overrides,
  };
}

test("the openGym adapter seals its conversation, model, and step contract", () => {
  const canonical = request();
  assert.equal(validateRuntimeV2OpenGymRequest(canonical), canonical);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("open-gym", canonical), 0);
  assert.equal(
    validateRuntimeV2OpenGymRequest(request({ conversationPublicId: null })).conversationPublicId,
    null,
  );
  for (const forged of [
    { ...canonical, executable: "node.exe" },
    { ...canonical, argv: ["arbitrary.mjs"] },
    { ...canonical, apiKey: "renderer-secret" },
    { ...canonical, conversationPublicId: "../another-chat" },
    { ...canonical, maxSteps: 0 },
    { ...canonical, maxSteps: 41 },
    { ...canonical, reasoningEffort: "unbounded" },
    { ...canonical, task: "x".repeat(100_001) },
  ]) {
    assert.throws(() => validateRuntimeV2OpenGymRequest(forged), /invalid/u);
  }
});

test("the fixed adapter runs the openGym catalogue loop only in its disposable worker", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-open-gym-worker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "worker-src");
  const managerPath = path.join(sourceRoot, "lib", "open-gym", "run-manager.ts");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.writeFileSync(managerPath, `
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  if (input.apiKey !== "local") throw new Error("trusted credential missing");
  const run = { terminal: false, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: {
      task: input.task,
      maxSteps: input.maxSteps,
      conversationPublicId: input.conversationPublicId,
      runtimeJobId: input.runtimeJobId,
    },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => {
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2,
      type: "run.completed",
      payload: { summary: "bounded training program", exerciseCount: 6 },
      at: new Date().toISOString(),
    });
  }, 10);
  return { runId: input.runtimeJobId, status: "running" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return runs.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) {
  return runs.get(runId).terminal;
}
export function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  run.terminal = true;
  run.events.push({
    sequenceNumber: 2,
    type: "run.aborted",
    payload: { summary: "openGym stopped." },
    at: new Date().toISOString(),
  });
  return true;
}
`);
  const updates = [];
  const outcome = await executeRuntimeV2OuterAgentAdapter({
    adapterId: "open-gym",
    launch: {
      identity: {
        jobId: "job_open_gym_1",
        attempt: 1,
        workerInstanceId: "worker_open_gym_1",
      },
      executionScope: {
        userId: 51,
        gardenId: null,
        conversationId: `oa_open_gym_${"a".repeat(32)}`,
      },
      request: request(),
      inputBlobs: [],
      inputPaths: [],
    },
    sourceRoot,
    signal: new AbortController().signal,
    update(events, status) {
      updates.push({ events, status });
    },
  });
  assert.equal(outcome.status, "completed");
  const events = updates.flatMap((update) => update.events);
  assert.deepEqual(events.map((event) => event.type), ["run.started", "run.completed"]);
  assert.deepEqual(events[0].payload, {
    task: "Build a three-day strength program.",
    maxSteps: 16,
    conversationPublicId: `conv_${"a".repeat(24)}`,
    runtimeJobId: "job_open_gym_1",
  });
});

test("openGym routes expose only durable Runtime submit, replay, and cancellation", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const manager = read("src/lib/open-gym/run-manager.ts");
  const startRoute = read("src/app/api/open-gym/runs/route.ts");
  const eventsRoute = read("src/app/api/open-gym/runs/[runId]/events/route.ts");
  const abortRoute = read("src/app/api/open-gym/runs/[runId]/abort/route.ts");
  assert.match(manager, /startOuterAgentRun/);
  assert.match(manager, /kind: "open-gym"/);
  assert.match(manager, /startRuntimeWorkerRun/);
  assert.match(startRoute, /await startRun\(/);
  assert.match(eventsRoute, /readOuterAgentRunView\("open-gym"/);
  assert.match(eventsRoute, /outerAgentEventsResponse/);
  assert.match(abortRoute, /await abortRun\(/);
  for (const route of [startRoute, eventsRoute, abortRoute]) {
    assert.doesNotMatch(route, /node:child_process|spawn\s*\(|execFile\s*\(/u);
  }
  assert.match(
    read("scripts/runtime-v2-open-gym-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("open-gym"\)/,
  );
});
