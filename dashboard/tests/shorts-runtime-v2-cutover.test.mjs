import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeRuntimeV2OuterAgentAdapter,
  expectedRuntimeV2OuterAgentInputCount,
  validateRuntimeV2ShortsRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

function request(overrides = {}) {
  return {
    request: {
      source: { kind: "url", url: "https://example.com/keynote.mp4" },
      clipCount: 3,
      aspectRatio: "9:16",
      resolution: "720",
      language: "",
    },
    conversationPublicId: `conv_${"a".repeat(24)}`,
    model: "chat-model",
    whisperModel: "base",
    baseUrl: "http://127.0.0.1:8765/v1",
    ...overrides,
  };
}

test("the Shorts adapter seals the typed media request and durable source ID", () => {
  const canonical = request();
  assert.equal(validateRuntimeV2ShortsRequest(canonical), canonical);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("shorts", canonical), 0);
  const upload = request({
    request: {
      ...canonical.request,
      source: { kind: "upload", uploadId: "b".repeat(32), filename: "talk.mp4" },
    },
  });
  assert.equal(validateRuntimeV2ShortsRequest(upload), upload);
  for (const forged of [
    { ...canonical, executable: "python.exe" },
    { ...canonical, argv: ["arbitrary.py"] },
    { ...canonical, apiKey: "renderer-secret" },
    { ...canonical, conversationPublicId: "../another-chat" },
    { ...canonical, whisperModel: "unbounded" },
    { ...canonical, request: { ...canonical.request, clipCount: 11 } },
    { ...canonical, request: { ...canonical.request, source: { kind: "url", url: "file:///secret" } } },
    { ...canonical, request: { ...canonical.request, source: { kind: "upload", uploadId: "../secret", filename: "x" } } },
  ]) {
    assert.throws(() => validateRuntimeV2ShortsRequest(forged), /invalid/u);
  }
});

test("the fixed adapter drives Shorts only inside its disposable media worker", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-shorts-worker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "worker-src");
  const workspacePath = path.join(root, "runtime-workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  const managerPath = path.join(sourceRoot, "lib", "shorts", "run-manager.ts");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.writeFileSync(managerPath, `
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  if (input.apiKey !== "local") throw new Error("trusted credential missing");
  const run = { terminal: false, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: {
      clipCount: input.request.clipCount,
      sourceKind: input.request.source.kind,
      runtimeJobId: input.runtimeJobId,
      runtimeWorkspacePath: input.runtimeWorkspacePath,
    },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => {
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2,
      type: "run.completed",
      payload: { summary: "three bounded clips", clipCount: 3, attached: 3 },
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
    payload: { summary: "stopped" },
    at: new Date().toISOString(),
  });
  return true;
}
`);
  const updates = [];
  const outcome = await executeRuntimeV2OuterAgentAdapter({
    adapterId: "shorts",
    launch: {
      identity: {
        jobId: "job_shorts_1",
        attempt: 1,
        workerInstanceId: "worker_shorts_1",
      },
      executionScope: {
        userId: 41,
        gardenId: null,
        conversationId: `oa_shorts_${"a".repeat(32)}`,
      },
      request: request(),
      inputBlobs: [],
      inputPaths: [],
      workspacePath,
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
    clipCount: 3,
    sourceKind: "url",
    runtimeJobId: "job_shorts_1",
    runtimeWorkspacePath: workspacePath,
  });
});

test("Shorts routes expose only durable Runtime submit, replay, and cancellation", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const manager = read("src/lib/shorts/run-manager.ts");
  const startRoute = read("src/app/api/shorts/runs/route.ts");
  const eventsRoute = read("src/app/api/shorts/runs/[runId]/events/route.ts");
  const abortRoute = read("src/app/api/shorts/runs/[runId]/abort/route.ts");
  assert.match(manager, /startOuterAgentRun/);
  assert.match(manager, /kind: "shorts"/);
  assert.match(manager, /startRuntimeWorkerRun/);
  assert.match(manager, /runtimeWorkspacePath/);
  assert.match(startRoute, /await startRun\(/);
  assert.match(eventsRoute, /readOuterAgentRunView\("shorts"/);
  assert.match(eventsRoute, /outerAgentEventsResponse/);
  assert.match(abortRoute, /await abortRun\(/);
  for (const route of [startRoute, eventsRoute, abortRoute]) {
    assert.doesNotMatch(route, /node:child_process|spawn\s*\(|execFile\s*\(/u);
  }
  assert.match(
    read("scripts/runtime-v2-shorts-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("shorts"\)/,
  );
});
