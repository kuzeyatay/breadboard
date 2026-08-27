import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeRuntimeV2OuterAgentAdapter,
  expectedRuntimeV2OuterAgentInputCount,
  validateRuntimeV2CareerOpsRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

function request(overrides = {}) {
  return {
    task: "Evaluate this infrastructure role against my background.",
    model: "chat-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    maxSteps: 24,
    conversationContext: "User: I prefer infrastructure roles.",
    ...overrides,
  };
}

test("the Career Ops adapter seals its full prompt contract and zero inputs", () => {
  const canonical = request();
  assert.equal(validateRuntimeV2CareerOpsRequest(canonical), canonical);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("career-ops", canonical), 0);
  for (const forged of [
    { ...canonical, executable: "node.exe" },
    { ...canonical, argv: ["arbitrary.mjs"] },
    { ...canonical, apiKey: "renderer-secret" },
    { ...canonical, maxSteps: 0 },
    { ...canonical, maxSteps: 61 },
    { ...canonical, reasoningEffort: "unbounded" },
    { ...canonical, baseUrl: "file:///secrets" },
    { ...canonical, task: "x".repeat(200_001) },
  ]) {
    assert.throws(() => validateRuntimeV2CareerOpsRequest(forged), /invalid/u);
  }
});

test("the fixed adapter drives the Career Ops loop only inside its disposable worker", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-career-worker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "worker-src");
  const managerPath = path.join(sourceRoot, "lib", "career-ops", "run-manager.ts");
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
      model: input.model,
      maxSteps: input.maxSteps,
      conversationContext: input.conversationContext,
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
      payload: { summary: "bounded career report", written: ["reports/role.md"] },
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
    payload: { summary: "Career Ops stopped.", written: [] },
    at: new Date().toISOString(),
  });
  return true;
}
`);
  const updates = [];
  const outcome = await executeRuntimeV2OuterAgentAdapter({
    adapterId: "career-ops",
    launch: {
      identity: {
        jobId: "job_career_1",
        attempt: 1,
        workerInstanceId: "worker_career_1",
      },
      executionScope: {
        userId: 31,
        gardenId: null,
        conversationId: `oa_career_ops_${"a".repeat(32)}`,
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
    task: "Evaluate this infrastructure role against my background.",
    model: "chat-model",
    maxSteps: 24,
    conversationContext: "User: I prefer infrastructure roles.",
    runtimeJobId: "job_career_1",
  });
  assert.deepEqual(events[1].payload.written, ["reports/role.md"]);
});

test("Career Ops routes expose only durable Runtime submit, replay, and cancellation", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const manager = read("src/lib/career-ops/run-manager.ts");
  const startRoute = read("src/app/api/career-ops/runs/route.ts");
  const eventsRoute = read("src/app/api/career-ops/runs/[runId]/events/route.ts");
  const abortRoute = read("src/app/api/career-ops/runs/[runId]/abort/route.ts");
  assert.match(manager, /startOuterAgentRun/);
  assert.match(manager, /kind: "career-ops"/);
  assert.match(manager, /startRuntimeWorkerRun/);
  assert.match(startRoute, /await startRun\(/);
  assert.match(eventsRoute, /readOuterAgentRunView\("career-ops"/);
  assert.match(eventsRoute, /outerAgentEventsResponse/);
  assert.match(abortRoute, /await abortRun\(/);
  for (const route of [startRoute, eventsRoute, abortRoute]) {
    assert.doesNotMatch(route, /node:child_process|spawn\s*\(|execFile\s*\(/u);
  }
  assert.match(
    read("scripts/runtime-v2-career-ops-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("career-ops"\)/,
  );
});
