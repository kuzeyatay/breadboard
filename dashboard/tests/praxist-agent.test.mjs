import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeRuntimeV2OuterAgentAdapter,
  expectedRuntimeV2OuterAgentInputCount,
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  validateRuntimeV2PraxistRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import {
  parsePraxistTaskPath,
  taskFromPraxistCommand,
} from "../src/lib/praxist/identity.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

test("Praxist command preserves an explicit task-project path", () => {
  assert.equal(taskFromPraxistCommand("/agents:praxist C:\\research\\task"), "C:\\research\\task");
  assert.equal(
    parsePraxistTaskPath('--task-path "C:\\research projects\\task"'),
    "C:\\research projects\\task",
  );
  assert.equal(taskFromPraxistCommand("ordinary prompt"), null);
});

test("Praxist Runtime V2 adapter seals only the task, model, and ChatMock endpoint", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-praxist-adapter-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const taskPath = path.join(root, "task");
  fs.mkdirSync(taskPath);
  fs.writeFileSync(path.join(taskPath, "task.yaml"), "name: smoke\n");
  const request = {
    taskPath,
    model: "gpt-test",
    baseUrl: "http://127.0.0.1:8765/v1",
  };
  assert.equal(validateRuntimeV2PraxistRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("praxist", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS.praxist, {
    id: "praxist",
    workerKind: "outer-praxist-node",
    jobType: "praxist-run",
    scopePrefix: "oa_praxist_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  });
  for (const forged of [
    { ...request, executable: "powershell.exe" },
    { ...request, apiKey: "renderer-secret" },
    { ...request, baseUrl: "file:///secrets" },
    { ...request, taskPath: path.join(root, "missing") },
  ]) assert.throws(() => validateRuntimeV2PraxistRequest(forged), /invalid/u);
});

test("fixed Praxist adapter passes trusted worker state and projects completion", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-praxist-worker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "worker-src");
  const managerPath = path.join(sourceRoot, "lib", "praxist", "run-manager.ts");
  const workspacePath = path.join(root, "runtime", "workspace");
  const taskPath = path.join(root, "task");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(taskPath);
  fs.writeFileSync(path.join(taskPath, "task.yaml"), "name: smoke\n");
  fs.writeFileSync(managerPath, `
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  if (input.apiKey !== "local") throw new Error("trusted credential missing");
  if (input.runtimeWorkspacePath !== ${JSON.stringify(workspacePath)}) throw new Error("workspace mismatch");
  const run = { terminal: false, events: [{ sequenceNumber: 1, type: "run.started", payload: { taskPath: input.taskPath }, at: new Date().toISOString() }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => { run.terminal = true; run.events.push({ sequenceNumber: 2, type: "run.completed", payload: { summary: "accepted experimental findings" }, at: new Date().toISOString() }); }, 10);
  return { runId: input.runtimeJobId, status: "queued" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) { return runs.get(runId).events.filter((event) => event.sequenceNumber > since); }
export function isRuntimeWorkerTerminal(_userId, runId) { return runs.get(runId).terminal; }
export function abortRuntimeWorkerRun() { return true; }
`);
  const updates = [];
  const outcome = await executeRuntimeV2OuterAgentAdapter({
    adapterId: "praxist",
    launch: {
      identity: { jobId: "job_praxist_1", attempt: 1, workerInstanceId: "worker_praxist_1" },
      executionScope: { userId: 31, gardenId: null, conversationId: `oa_praxist_${"a".repeat(32)}` },
      request: { taskPath, model: "gpt-test", baseUrl: "http://127.0.0.1:8765/v1" },
      inputBlobs: [],
      inputPaths: [],
      workspacePath,
    },
    sourceRoot,
    signal: new AbortController().signal,
    update(events, status) { updates.push({ events, status }); },
  });
  assert.equal(outcome.status, "completed");
  assert.deepEqual(
    updates.flatMap((update) => update.events).map((event) => event.type),
    ["run.started", "run.completed"],
  );
});

test("Praxist routes, card, persistence, cancellation, and Max Research are wired", () => {
  const manager = source("src/lib/praxist/run-manager.ts");
  const card = source("src/app/components/hermes/inline-praxist-run.tsx");
  const persistence = source("src/lib/conversations/external-agent-runs.ts");
  const maxPlan = source("src/lib/max-research/plan.ts");
  const maxParticipants = source("src/lib/max-research/participants.ts");
  assert.match(manager, /kind: "praxist"/u);
  assert.match(manager, /runPraxistCli\(runtime, \[/u);
  assert.match(manager, /"stop", run\.praxistRunId/u);
  assert.match(card, /bb-agent-run-card/u);
  assert.match(card, /resolveAgentRunStreamError/u);
  assert.match(persistence, /praxistRun/u);
  assert.match(source("src/lib/conversations/external-agent-cancel.ts"), /praxist\/run-manager/u);
  assert.match(maxPlan, /participant: "praxist"/u);
  assert.match(maxParticipants, /PRAXIST_MAX_RESEARCH_TASK_PATH/u);
  assert.match(source("scripts/runtime-v2-praxist-worker.mjs"), /runRuntimeV2OuterAgentWorker\("praxist"\)/u);
  for (const route of [
    "src/app/api/praxist/runs/route.ts",
    "src/app/api/praxist/runs/[runId]/events/route.ts",
    "src/app/api/praxist/runs/[runId]/abort/route.ts",
    "src/app/api/praxist/health/route.ts",
  ]) {
    assert.doesNotMatch(source(route), /node:child_process|spawn\s*\(|execFile\s*\(/u);
  }
});
