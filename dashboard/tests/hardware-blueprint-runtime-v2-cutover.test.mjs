import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  expectedRuntimeV2OuterAgentInputCount,
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  validateRuntimeV2HardwareBlueprintRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-hardware-blueprint-worker.mjs",
);
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

const TURN = {
  mode: "new",
  note: "An Arduino Uno blinking one LED.",
  request: {
    title: "Arduino LED blinker",
    purpose: "Blink one LED once per second",
    controller: "Arduino Uno",
    inputs: [],
    outputs: [{ type: "LED", quantity: 1 }],
    physicalParts: [],
    communication: [],
    power: { source: "usb" },
    prototypeType: "breadboard",
    firmware: { platform: "platformio", language: "cpp" },
    constraints: {
      beginnerFriendly: true,
      preferredComponents: [],
      forbiddenComponents: [],
    },
  },
};

const FIRMWARE = {
  helperDeclarations: "",
  setupBody: "",
  loopBody: "delay(1000);",
  expectedSerialOutput: "LED toggled",
};

function canonicalRequest(baseUrl, overrides = {}) {
  return {
    conversationPublicId: `conv_${"h".repeat(24)}`,
    brief: "Blink an LED --no-enclosure",
    parsed: {
      brief: "Blink an LED",
      board: null,
      prototypeType: null,
      firmwarePlatform: null,
      enclosure: false,
      cadBackend: null,
    },
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl,
    preferences: {
      board: null,
      prototypeType: null,
      firmwarePlatform: null,
      enclosure: "auto",
      cadBackend: "auto",
    },
    conversationContext: "",
    ...overrides,
  };
}

function runtimeFixture(request) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hardware-runtime-"));
  const jobId = "job_hardware_blueprint_1";
  const workerInstanceId = "worker_hardware_blueprint_1";
  const jobRoot = path.join(dataRoot, "runtime", "jobs", jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(path.join(attemptRoot, "start.json"), `${JSON.stringify({
    protocolVersion: 1,
    identity: { jobId, attempt: 1, workerInstanceId },
    executionScope: {
      userId: 7,
      gardenId: null,
      conversationId: `oa_hardware_blueprint_${"a".repeat(32)}`,
    },
    inputManifestPath: `runtime/jobs/${jobId}/input.json`,
    inputBlobs: [],
    workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${jobId}/result.json`,
  })}\n`);
  return { dataRoot, jobRoot, attemptRoot };
}

function modelServer({ hang = false } = {}) {
  const pending = new Set();
  const server = http.createServer((request, response) => {
    pending.add(response);
    response.on("close", () => pending.delete(response));
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (hang) return;
      const parsed = JSON.parse(body);
      const toolName = parsed.tools?.[0]?.function?.name;
      const value = toolName === "hardware_turn" ? TURN : FIRMWARE;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(value) } }] } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }));
    });
  });
  return {
    server,
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server unavailable");
      return `http://127.0.0.1:${address.port}/v1`;
    },
    async close() {
      for (const response of pending) response.destroy();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function runWorker(fixture, { cancel = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, "start.json"], {
      cwd: fixture.attemptRoot,
      env: {
        ...process.env,
        CHATMOCK_API_KEY: "test-runtime-key",
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let stopped = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Hardware Runtime worker timed out.\n${stderr}`));
    }, 25_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (cancel && !stopped && stdout.includes('"type":"ready"')) {
        stopped = true;
        child.stdin.write('{"type":"stop","force":false}\n');
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("Hardware accepts one sealed product request and no execution overrides", () => {
  const request = canonicalRequest("http://127.0.0.1:8765/v1");
  assert.equal(validateRuntimeV2HardwareBlueprintRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("hardware-blueprint", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["hardware-blueprint"], {
    id: "hardware-blueprint",
    workerKind: "outer-hardware-blueprint-node",
    jobType: "hardware-blueprint-run",
    scopePrefix: "oa_hardware_blueprint_",
    maximumInputs: 0,
  });
  for (const forged of [
    { ...request, executable: "node.exe" },
    { ...request, argv: ["attacker.mjs"] },
    { ...request, apiKey: "renderer-secret" },
    { ...request, conversationPublicId: "conv_other" },
    { ...request, parsed: { ...request.parsed, enclosure: "yes" } },
  ]) {
    assert.throws(() => validateRuntimeV2HardwareBlueprintRequest(forged), /invalid/u);
  }
});

test("Hardware routes only submit, replay, and cancel authenticated Runtime jobs", () => {
  const manager = source("src/lib/hardware/runtime-run-manager.ts");
  const workerManager = source("src/lib/hardware/run-manager.ts");
  const route = source("src/app/api/hardware-blueprint/runs/route.ts");
  const events = source("src/app/api/hardware-blueprint/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/hardware-blueprint/runs/[runId]/abort/route.ts");
  assert.match(workerManager, /export function startRuntimeWorkerRun/);
  assert.match(manager, /startOuterAgentRun\(\{/);
  assert.match(manager, /readOuterAgentRunView\("hardware-blueprint"/);
  assert.match(manager, /abortOuterAgentRun\("hardware-blueprint"/);
  assert.doesNotMatch(
    manager,
    /from "\.\/(?:compiler|design|model-client|component-discovery)|from "\.\.\/cad\//u,
  );
  assert.match(route, /await startRun\(/);
  assert.doesNotMatch(route, /startRuntimeWorkerRun|node:child_process|\bspawn\s*\(/u);
  assert.doesNotMatch(route, /hardware\/run-manager\.ts/u);
  assert.match(events, /outerAgentEventsResponse/);
  assert.doesNotMatch(events, /setInterval\(/);
  assert.match(abort, /await abortRun\(/);
  assert.match(source("scripts/runtime-v2-hardware-blueprint-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("hardware-blueprint"\)/);
});

test("the real disposable worker compiles and seals the Hardware event projection", async () => {
  const model = modelServer();
  const baseUrl = await model.listen();
  const fixture = runtimeFixture(canonicalRequest(baseUrl));
  try {
    const child = await runWorker(fixture);
    assert.equal(child.code, 0, child.stderr);
    const result = JSON.parse(fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"));
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.run.adapterId, "hardware-blueprint");
    assert.equal(result.run.status, "completed");
    const terminal = result.run.events.find((event) => event.type === "run.completed");
    assert.equal(terminal.payload.status, "ready");
    assert.equal(terminal.payload.controller, "Arduino Uno R3");
    assert.equal(terminal.payload.state.kind, "hardware-blueprint");
    assert.ok(result.run.events.some((event) => event.type === "artifact.unavailable"));
    assert.match(child.stdout, /"type":"ready"/);
    assert.match(child.stdout, /"type":"complete"/);
  } finally {
    await model.close();
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop aborts the real Hardware worker without publishing a result", async () => {
  const model = modelServer({ hang: true });
  const baseUrl = await model.listen();
  const fixture = runtimeFixture(canonicalRequest(baseUrl));
  try {
    const child = await runWorker(fixture, { cancel: true });
    assert.equal(child.code, 0, child.stderr);
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "aborted");
    assert.ok(checkpoint.events.some((event) => event.type === "run.aborted"));
    assert.match(child.stdout, /"type":"cancellation-acknowledged"/);
  } finally {
    await model.close();
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
});
