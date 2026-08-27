import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeRuntimeV2OuterAgentAdapter,
  expectedRuntimeV2OuterAgentInputCount,
  validateRuntimeV2TradingAgentRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

function request(overrides = {}) {
  return {
    request: {
      ticker: "NVDA",
      tradeDate: "2026-08-04",
      analysts: ["market", "news"],
      researchDepth: 2,
      riskRounds: 1,
      assetType: "stock",
    },
    settings: {
      analysts: ["market", "news"],
      researchDepth: 2,
      riskRounds: 1,
      assetType: "stock",
      deepModel: "",
      quickModel: "",
      reasoningEffort: "",
      outputLanguage: "English",
      marketVendor: "yfinance",
      newsVendor: "yfinance",
    },
    model: "chat-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    ...overrides,
  };
}

test("the Trading Agent adapter seals the typed market request and zero inputs", () => {
  const canonical = request();
  assert.equal(validateRuntimeV2TradingAgentRequest(canonical), canonical);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("trading-agent", canonical), 0);
  for (const forged of [
    { ...canonical, executable: "python.exe" },
    { ...canonical, argv: ["arbitrary.py"] },
    { ...canonical, apiKey: "renderer-secret" },
    { ...canonical, request: { ...canonical.request, ticker: "../../secret" } },
    { ...canonical, request: { ...canonical.request, analysts: ["astrology"] } },
    { ...canonical, request: { ...canonical.request, tradeDate: "2026-02-31" } },
    { ...canonical, settings: { ...canonical.settings, marketVendor: "arbitrary" } },
  ]) {
    assert.throws(() => validateRuntimeV2TradingAgentRequest(forged), /invalid/u);
  }
});

test("the fixed adapter drives the legacy graph only inside the disposable worker", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-trading-worker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "worker-src");
  const managerPath = path.join(sourceRoot, "lib", "tradingagents", "run-manager.ts");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.writeFileSync(managerPath, `
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  const run = { terminal: false, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: {
      ticker: input.request.ticker,
      model: input.model,
      vendor: input.settings.marketVendor,
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
      payload: { summary: "bounded market report" },
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
    adapterId: "trading-agent",
    launch: {
      identity: {
        jobId: "job_trading_1",
        attempt: 1,
        workerInstanceId: "worker_trading_1",
      },
      executionScope: {
        userId: 23,
        gardenId: null,
        conversationId: `oa_trading_agent_${"a".repeat(32)}`,
      },
      request: request(),
      inputBlobs: [],
      inputPaths: [],
    },
    sourceRoot,
    signal: new AbortController().signal,
    update(events, status) { updates.push({ events, status }); },
  });
  assert.equal(outcome.status, "completed");
  const events = updates.flatMap((update) => update.events);
  assert.deepEqual(events.map((event) => event.type), ["run.started", "run.completed"]);
  assert.deepEqual(events[0].payload, {
    ticker: "NVDA",
    model: "chat-model",
    vendor: "yfinance",
    runtimeJobId: "job_trading_1",
  });
});

test("Trading Agent routes expose only durable Runtime submit/replay/cancel", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const manager = read("src/lib/tradingagents/run-manager.ts");
  const startRoute = read("src/app/api/tradingagents/runs/route.ts");
  const eventsRoute = read("src/app/api/tradingagents/runs/[runId]/events/route.ts");
  const abortRoute = read("src/app/api/tradingagents/runs/[runId]/abort/route.ts");
  assert.match(manager, /startOuterAgentRun/);
  assert.match(manager, /kind: "trading-agent"/);
  assert.match(manager, /startRuntimeWorkerRun/);
  assert.match(startRoute, /await startRun\(/);
  assert.match(eventsRoute, /readOuterAgentRunView\("trading-agent"/);
  assert.match(eventsRoute, /outerAgentEventsResponse/);
  assert.match(abortRoute, /await abortRun\(/);
  for (const route of [startRoute, eventsRoute, abortRoute]) {
    assert.doesNotMatch(route, /node:child_process|spawn\s*\(|execFile\s*\(/u);
  }
  assert.match(
    read("scripts/runtime-v2-trading-agent-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("trading-agent"\)/,
  );
});
