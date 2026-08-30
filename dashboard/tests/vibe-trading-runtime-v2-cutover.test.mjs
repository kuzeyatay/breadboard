import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  abortRuntimeWorkerRun,
  getRuntimeWorkerEventsSince,
  isRuntimeWorkerTerminal,
  resetVibeTradingRuns,
  startRuntimeWorkerRun,
} from "../src/lib/vibe-trading/run-manager.ts";
import { startRun as startDurableRun } from "../src/lib/vibe-trading/runtime-run-manager.ts";

const outerAdapters = await import("../scripts/runtime-v2-outer-agent-adapters.mjs");
const {
  executeRuntimeV2OuterAgentAdapter,
  expectedRuntimeV2OuterAgentInputCount,
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  validateRuntimeV2VibeTradingRequest,
} = outerAdapters;

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8").replace(/\r\n/g, "\n");

function request(overrides = {}) {
  return {
    task: "Compare defensive factor performance during the last three drawdowns.",
    model: "test-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    settings: {
      model: "",
      temperature: 0.3,
      memory: "off",
      dataCache: true,
      cryptoExchange: "binance",
    },
    conversationContext: "User: Compare it with the benchmark we discussed.",
    coldStart: true,
    ...overrides,
  };
}

test("Vibe Trading has one exact sealed zero-input Runtime contract", () => {
  const canonical = validateRuntimeV2VibeTradingRequest(request());
  assert.equal(expectedRuntimeV2OuterAgentInputCount("vibe-trading", canonical), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["vibe-trading"], {
    id: "vibe-trading",
    workerKind: "outer-vibe-trading-node",
    jobType: "vibe-trading-run",
    scopePrefix: "oa_vibe_trading_",
    maximumInputs: 0,
  });
  for (const invalid of [
    request({ argv: ["python", "anything.py"] }),
    request({ env: { VIBE_TRADING_SERVICE_API_KEY: "renderer-secret" } }),
    request({ apiKey: "renderer-secret" }),
    request({ task: "x".repeat(200_001) }),
    request({ settings: { ...request().settings, memory: "forever" } }),
    request({ coldStart: "yes" }),
  ]) {
    assert.throws(() => validateRuntimeV2VibeTradingRequest(invalid));
  }
});

test("the hashed Vibe Trading lock cannot acquire unpinned future extras", () => {
  const lock = source("../Vibe-Trading/requirements-lock.txt");
  assert.doesNotMatch(
    lock,
    /^[A-Za-z0-9_.-]+\[[^\]]+\]==/mu,
    "resolved extras must be stripped after their dependencies are locked",
  );
  assert.match(
    lock,
    /^winloop==0\.6\.3 ; sys_platform == "win32" \\/mu,
    "Windows-only transitive dependencies must be pinned and hashed",
  );
  assert.match(
    lock,
    /^uvloop==0\.22\.1 ; sys_platform != "win32" \\/mu,
    "the Unix event loop must not be installed on Windows",
  );
});

test("the trusted facade writes configuration before submission and sends no credential", async () => {
  const order = [];
  let submission = null;
  let configuredApiKey = "";
  const result = await startDurableRun(
    {
      userId: 12,
      ...request(),
      coldStart: undefined,
    },
    {
      prepare: async (options) => {
        order.push("configuration");
        assert.ok(options.apiKey);
        configuredApiKey = options.apiKey;
        return {
          url: "http://127.0.0.1:39871",
          apiKey: "server-only",
          model: options.model,
          startedAt: Date.now(),
        };
      },
      coldStartHint: async () => {
        order.push("cold-start");
        return true;
      },
      submit: async (input) => {
        order.push("submission");
        submission = input;
        return { runId: "job_vibe_1", status: "queued" };
      },
    },
  );
  assert.deepEqual(order, ["configuration", "cold-start", "submission"]);
  assert.deepEqual(result, { runId: "job_vibe_1", status: "queued" });
  assert.deepEqual(submission.requestPayload, request());
  assert.ok(!JSON.stringify(submission).includes(configuredApiKey));
  assert.doesNotMatch(JSON.stringify(submission), /server-only|apiKey|token|secret/iu);
});

async function runFakeAdapter({ abort = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-vibe-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "vibe-trading", "run-manager.ts");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.writeFileSync(managerPath, `
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  const run = { terminal: false, timer: null, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: { ...input },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  run.timer = setTimeout(() => {
    if (run.terminal) return;
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2,
      type: "run.completed",
      payload: { summary: "The factor comparison is ready." },
      at: new Date().toISOString(),
    });
  }, 30);
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
  clearTimeout(run.timer);
  run.terminal = true;
  run.events.push({
    sequenceNumber: 2,
    type: "run.aborted",
    payload: { summary: "Vibe Trading stopped." },
    at: new Date().toISOString(),
  });
  return true;
}
`);
  const controller = new AbortController();
  const updates = [];
  try {
    const promise = executeRuntimeV2OuterAgentAdapter({
      adapterId: "vibe-trading",
      launch: {
        identity: {
          jobId: "job_vibe_1",
          attempt: 1,
          workerInstanceId: "worker_vibe_1",
        },
        executionScope: {
          userId: 12,
          gardenId: null,
          conversationId: `oa_vibe_trading_${"a".repeat(32)}`,
        },
        request: request(),
        inputBlobs: [],
        inputPaths: [],
        workspacePath: path.join(root, "workspace"),
      },
      sourceRoot,
      signal: controller.signal,
      update: (events, status) => updates.push({ events, status }),
    });
    if (abort) setTimeout(() => controller.abort(), 10);
    return { outcome: await promise, events: updates.flatMap((entry) => entry.events) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the adapter preserves normalized inputs through real completion and cancellation", async () => {
  const completed = await runFakeAdapter();
  assert.equal(completed.outcome.status, "completed");
  const started = completed.events.find((event) => event.type === "run.started");
  assert.deepEqual(started?.payload, {
    userId: 12,
    runtimeJobId: "job_vibe_1",
    ...request(),
  });
  assert.equal(
    completed.events.find((event) => event.type === "run.completed")?.payload.summary,
    "The factor comparison is ready.",
  );

  const aborted = await runFakeAdapter({ abort: true });
  assert.equal(aborted.outcome.status, "aborted");
  assert.ok(aborted.events.some((event) => event.type === "run.aborted"));
  assert.ok(!aborted.events.some((event) => event.type === "run.completed"));
});

test("the real worker consumes the injected service and awaits upstream cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const previous = {
    url: process.env.VIBE_TRADING_SERVICE_URL,
    key: process.env.VIBE_TRADING_SERVICE_API_KEY,
    controlUrl: process.env.BREADBOARD_SUPERVISOR_CONTROL_URL,
    controlToken: process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN,
  };
  process.env.VIBE_TRADING_SERVICE_URL = "http://127.0.0.1:39871";
  process.env.VIBE_TRADING_SERVICE_API_KEY = "v".repeat(40);
  delete process.env.BREADBOARD_SUPERVISOR_CONTROL_URL;
  delete process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN;
  let mode = "complete";
  let cancelAcknowledged = false;
  let hangingStream = null;
  try {
    globalThis.fetch = async (value, init = {}) => {
      const url = new URL(String(value));
      const method = init.method ?? "GET";
      if (url.pathname === "/sessions" && method === "POST") {
        return Response.json({ session_id: mode === "complete" ? "session_complete" : "session_cancel" });
      }
      if (url.pathname.endsWith("/events")) {
        if (mode === "complete") {
          return new Response(
            'id: 1\nevent: text_delta\ndata: {"delta":"A bounded answer."}\n\n' +
              'id: 2\nevent: attempt.completed\ndata: {"summary":"A bounded answer.","model":"test-model","provider":"chatmock","elapsed_ms":25}\n\n',
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              hangingStream = controller;
              controller.enqueue(new TextEncoder().encode(": ping\n\n"));
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url.pathname.endsWith("/messages") && method === "POST") {
        return new Response(null, { status: 202 });
      }
      if (url.pathname.endsWith("/cancel") && method === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        cancelAcknowledged = true;
        hangingStream?.close();
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected Vibe Trading test request: ${method} ${url.pathname}`);
    };

    resetVibeTradingRuns();
    const completed = startRuntimeWorkerRun({
      userId: 12,
      runtimeJobId: "job_vibe_complete",
      ...request(),
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (isRuntimeWorkerTerminal(12, completed.runId)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const completedEvents = getRuntimeWorkerEventsSince(12, completed.runId, 0);
    assert.equal(completedEvents.findLast((event) => event.type.startsWith("run."))?.type, "run.completed");
    assert.equal(completedEvents.find((event) => event.type === "service.ready")?.payload.coldStart, true);

    mode = "cancel";
    const cancelled = startRuntimeWorkerRun({
      userId: 12,
      runtimeJobId: "job_vibe_cancel",
      ...request({ coldStart: false }),
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        getRuntimeWorkerEventsSince(12, cancelled.runId, 0).some(
          (event) => event.type === "session.opened",
        )
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const stopping = abortRuntimeWorkerRun(12, cancelled.runId);
    assert.equal(isRuntimeWorkerTerminal(12, cancelled.runId), false);
    assert.equal(await stopping, true);
    assert.equal(cancelAcknowledged, true);
    assert.equal(isRuntimeWorkerTerminal(12, cancelled.runId), true);
    assert.equal(
      getRuntimeWorkerEventsSince(12, cancelled.runId, 0).findLast((event) =>
        event.type.startsWith("run."))?.type,
      "run.aborted",
    );
  } finally {
    resetVibeTradingRuns();
    globalThis.fetch = originalFetch;
    for (const [name, value] of [
      ["VIBE_TRADING_SERVICE_URL", previous.url],
      ["VIBE_TRADING_SERVICE_API_KEY", previous.key],
      ["BREADBOARD_SUPERVISOR_CONTROL_URL", previous.controlUrl],
      ["BREADBOARD_SUPERVISOR_CONTROL_TOKEN", previous.controlToken],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Next owns no Vibe execution state, service lease, secret, or fallback", () => {
  const facade = source("src/lib/vibe-trading/runtime-run-manager.ts");
  const worker = source("src/lib/vibe-trading/run-manager.ts");
  const startRoute = source("src/app/api/vibe-trading/runs/route.ts");
  const eventsRoute = source("src/app/api/vibe-trading/runs/[runId]/events/route.ts");
  const abortRoute = source("src/app/api/vibe-trading/runs/[runId]/abort/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");

  assert.ok(
    facade.indexOf("dependencies.prepare(") < facade.indexOf("dependencies.submit("),
    "the service configuration must exist before Rust starts the job dependency",
  );
  assert.match(facade, /kind: "vibe-trading"/);
  assert.doesNotMatch(facade, /requestPayload:\s*\{[^}]*apiKey/s);
  assert.doesNotMatch(worker, /holdRuntimeAgentServiceLease|acquireServiceLease|releaseSupervisorLease/);
  assert.doesNotMatch(worker, /BREADBOARD_SUPERVISOR_CONTROL_(?:URL|TOKEN)/);
  assert.match(worker, /resolveManagedServiceEndpoint\("vibe-trading"\)/);
  assert.match(startRoute, /vibe-trading\/runtime-run-manager\.ts/);
  assert.doesNotMatch(startRoute, /vibe-trading\/run-manager\.ts/);
  assert.match(eventsRoute, /outerAgentEventsResponse/);
  assert.doesNotMatch(eventsRoute, /setInterval\(/);
  assert.match(abortRoute, /vibe-trading\/runtime-run-manager\.ts/);
  assert.match(cancellation, /vibe-trading\/runtime-run-manager\.ts/);
  assert.match(
    source("scripts/runtime-v2-vibe-trading-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("vibe-trading"\)/,
  );
});
