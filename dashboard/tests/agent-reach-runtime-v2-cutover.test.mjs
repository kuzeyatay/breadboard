import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeRuntimeV2OuterAgentAdapter,
  expectedRuntimeV2OuterAgentInputCount,
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  validateRuntimeV2AgentReachRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

function request(overrides = {}) {
  return {
    task: "Find the primary sources and summarize what changed.",
    model: "chat-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    maxSteps: 16,
    conversationContext: "User: prefer primary sources.",
    ...overrides,
  };
}

test("Agent Reach outer adapter seals product inputs and accepts no blobs", () => {
  const canonical = request();
  assert.equal(validateRuntimeV2AgentReachRequest(canonical), canonical);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("agent-reach", canonical), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["agent-reach"], {
    id: "agent-reach",
    workerKind: "outer-agent-reach-node",
    jobType: "agent-reach-run",
    scopePrefix: "oa_agent_reach_",
    maximumInputs: 0,
  });
  for (const forged of [
    { ...canonical, executable: "powershell.exe" },
    { ...canonical, command: "curl attacker" },
    { ...canonical, env: { HOME: "elsewhere" } },
    { ...canonical, apiKey: "renderer-secret" },
    { ...canonical, maxSteps: 0 },
    { ...canonical, maxSteps: 41 },
    { ...canonical, baseUrl: "file:///secrets" },
    { ...canonical, task: "x".repeat(100_001) },
  ]) assert.throws(() => validateRuntimeV2AgentReachRequest(forged), /invalid/u);
});

test("fixed Agent Reach adapter passes only trusted worker state and projects completion", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-reach-outer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "worker-src");
  const managerPath = path.join(sourceRoot, "lib", "agent-reach", "run-manager.ts");
  const workspacePath = path.join(root, "runtime", "workspace");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.writeFileSync(managerPath, `
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  if (input.apiKey !== "local") throw new Error("trusted credential missing");
  if (input.runtimeWorkspacePath !== ${JSON.stringify(workspacePath)}) throw new Error("workspace mismatch");
  const run = { terminal: false, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: { model: input.model, maxSteps: input.maxSteps, runtimeJobId: input.runtimeJobId },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => {
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2,
      type: "run.completed",
      payload: { summary: "bounded findings" },
      at: new Date().toISOString(),
    });
  }, 10);
  return { runId: input.runtimeJobId, status: "queued" };
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
    payload: { summary: "Agent Reach stopped." },
    at: new Date().toISOString(),
  });
  return true;
}
`);
  const updates = [];
  const outcome = await executeRuntimeV2OuterAgentAdapter({
    adapterId: "agent-reach",
    launch: {
      identity: {
        jobId: "job_agent_reach_1",
        attempt: 1,
        workerInstanceId: "worker_agent_reach_1",
      },
      executionScope: {
        userId: 31,
        gardenId: null,
        conversationId: `oa_agent_reach_${"a".repeat(32)}`,
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
    model: "chat-model",
    maxSteps: 16,
    runtimeJobId: "job_agent_reach_1",
  });
});

test("Agent Reach routes expose only authenticated Runtime submit, replay, health, and cancel", () => {
  const manager = source("src/lib/agent-reach/run-manager.ts");
  const startRoute = source("src/app/api/agent-reach/runs/route.ts");
  const eventsRoute = source("src/app/api/agent-reach/runs/[runId]/events/route.ts");
  const abortRoute = source("src/app/api/agent-reach/runs/[runId]/abort/route.ts");
  const healthRoute = source("src/app/api/agent-reach/health/route.ts");
  const setupRoute = source("src/app/api/agent-reach/setup/route.ts");
  assert.match(manager, /startOuterAgentRun/u);
  assert.match(manager, /kind: "agent-reach"/u);
  assert.match(manager, /startRuntimeWorkerRun/u);
  assert.match(manager, /runtimeWorkspacePath/u);
  assert.match(startRoute, /await startRun\(/u);
  assert.match(eventsRoute, /readOuterAgentRunView\("agent-reach"/u);
  assert.match(eventsRoute, /outerAgentEventsResponse/u);
  assert.doesNotMatch(eventsRoute, /setInterval\(/u);
  assert.match(abortRoute, /await abortRun\(/u);
  assert.match(healthRoute, /runAgentReachDoctorJob/u);
  assert.match(setupRoute, /runAgentReachDoctorJob/u);
  for (const route of [startRoute, eventsRoute, abortRoute, healthRoute, setupRoute]) {
    assert.doesNotMatch(route, /node:child_process|spawn\s*\(|execFile\s*\(/u);
  }
  assert.match(
    source("scripts/runtime-v2-agent-reach-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("agent-reach"\)/u,
  );
});

test("Agent Reach runtime resolves source, environment, tools, and home under Runtime data", () => {
  const runtime = source("src/lib/agent-reach/runtime.ts");
  const manager = source("src/lib/agent-reach/run-manager.ts");
  assert.match(runtime, /"runtime-v2", "toolchains", "agent-reach", "source"/u);
  assert.match(runtime, /"runtime-v2", "services", "agent-reach"/u);
  assert.match(runtime, /"tools", "bin"/u);
  assert.match(runtime, /AGENT_REACH_CONFIG_PATH/u);
  for (const fixedMutableEnv of [
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "npm_config_prefix",
    "npm_config_cache",
  ]) assert.match(runtime, new RegExp(fixedMutableEnv, "u"));
  assert.match(runtime, /MAX_CLI_STDOUT_BYTES/u);
  assert.match(runtime, /MAX_CLI_STDERR_BYTES/u);
  assert.match(runtime, /signal\?\.addEventListener\("abort", abort/u);
  assert.match(runtime, /child\.stdout\?\.destroy\(\)/u);
  assert.match(runtime, /Native Runtime remains the final process-tree reaper/u);
  assert.match(manager, /doctor\(\{ signal: run\.abortController\.signal \}\)/u);
  assert.doesNotMatch(runtime, /path\.join\(repositoryRoot\(\), "agent-reach", "\.venv"/u);
});

test("Agent Reach doctor subprocess output and cancellation are bounded", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-reach-doctor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const cache = path.join(root, "cache");
  const npmPrefix = path.join(root, "npm");
  const toolsBin = path.join(root, "tools");
  const venvBin = path.join(root, "venv");
  for (const directory of [home, cache, npmPrefix, toolsBin, venvBin]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const runtime = {
    root,
    command: process.execPath,
    baseArgs: [],
    venvBin,
    toolsBin,
    npmBin: npmPrefix,
    npmPrefix,
    home,
    appData: path.join(home, "AppData", "Roaming"),
    localAppData: path.join(home, "AppData", "Local"),
    cache,
    source: "qa_configured",
  };
  const { runCli } = await import("../src/lib/agent-reach/runtime.ts");
  const bounded = await runCli(
    runtime,
    ["-e", 'process.stdout.write("x".repeat(700000));process.stderr.write("y".repeat(100000))'],
    10_000,
  );
  assert.ok(Buffer.byteLength(bounded.stdout, "utf8") <= 512 * 1024);
  assert.ok(Buffer.byteLength(bounded.stderr, "utf8") <= 64 * 1024);

  const abort = new AbortController();
  const startedAt = Date.now();
  const cancelled = runCli(
    runtime,
    ["-e", "setInterval(() => {}, 1000)"],
    10_000,
    abort.signal,
  );
  setTimeout(() => abort.abort(), 20).unref?.();
  const result = await cancelled;
  assert.match(result.stderr, /cancelled/u);
  assert.ok(Date.now() - startedAt < 6_000, "cancellation must not wait for the command timeout");
});
