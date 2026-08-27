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
  validateRuntimeV2StockAnalystRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-stock-analyst-worker.mjs",
);
const source = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

function canonicalRequest(overrides = {}) {
  return {
    task: "Compare AAPL's recent trend with its valuation.",
    model: "test-model",
    baseUrl: "http://127.0.0.1:8765/v1",
    settings: {
      model: "",
      depth: "single",
      language: "en",
      strategies: "auto",
      watchlist: "AAPL,MSFT",
      memory: false,
      temperature: 0.2,
    },
    memoryContext: "The user prefers concise risk summaries.",
    conversationContext: "User: We were comparing large-cap technology companies.",
    serviceModel: "test-model",
    coldStart: true,
    ...overrides,
  };
}

function runtimeFixture(request) {
  const dataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-stock-analyst-runtime-"),
  );
  const jobId = "job_stock_analyst_1";
  const workerInstanceId = "worker_stock_analyst_1";
  const jobRoot = path.join(dataRoot, "runtime", "jobs", jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity: { jobId, attempt: 1, workerInstanceId },
      executionScope: {
        userId: 7,
        gardenId: null,
        conversationId: `oa_stock_analyst_${"a".repeat(32)}`,
      },
      inputManifestPath: `runtime/jobs/${jobId}/input.json`,
      inputBlobs: [],
      workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${jobId}/result.json`,
    })}\n`,
  );
  return { dataRoot, jobRoot, attemptRoot };
}

function stockAnalystServer({ hang = false } = {}) {
  const pending = new Set();
  let streamRequest = null;
  let streamStartedResolve;
  let cancellationSeenResolve;
  const streamStarted = new Promise((resolve) => {
    streamStartedResolve = resolve;
  });
  const cancellationSeen = new Promise((resolve) => {
    cancellationSeenResolve = resolve;
  });
  const server = http.createServer((request, response) => {
    pending.add(response);
    response.on("close", () => pending.delete(response));
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.url?.endsWith("/cancel")) {
        cancellationSeenResolve();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (request.url === "/api/v1/agent/chat/stream") {
        streamRequest = JSON.parse(body);
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        response.write(`data: ${JSON.stringify({ type: "accepted" })}\n\n`);
        streamStartedResolve();
        if (hang) return;
        response.end(
          `data: ${JSON.stringify({
            type: "done",
            success: true,
            content: "AAPL remains profitable, but valuation risk is elevated.",
            total_steps: 3,
          })}\n\n`,
        );
        return;
      }
      if (request.url?.startsWith("/api/v1/agent/chat/sessions/")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ messages: [] }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  return {
    streamStarted,
    cancellationSeen,
    get streamRequest() {
      return streamRequest;
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      server.unref();
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("test server unavailable");
      }
      return `http://127.0.0.1:${address.port}`;
    },
    async close() {
      for (const response of pending) response.destroy();
      server.closeAllConnections?.();
      await Promise.race([
        new Promise((resolve) => server.close(resolve)),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    },
  };
}

function runWorker(fixture, serviceUrl, { stopWhen } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, "start.json"], {
      cwd: fixture.attemptRoot,
      env: {
        ...process.env,
        BREADBOARD_SUPERVISOR_CONTROL_URL: "",
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "",
        BREADBOARD_RUNTIME_V2_ACTIVE: "",
        STOCK_ANALYST_SERVICE_URL: serviceUrl,
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Stock Analyst Runtime worker timed out.\n${stderr}`));
    }, 25_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    if (stopWhen) {
      void stopWhen.then(() => {
        if (child.exitCode === null) {
          child.stdin.write('{"type":"stop","force":false}\n');
        }
      });
    }
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

test("Stock Analyst has one exact credential-free Runtime request contract", () => {
  const request = canonicalRequest();
  assert.equal(validateRuntimeV2StockAnalystRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("stock-analyst", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["stock-analyst"], {
    id: "stock-analyst",
    workerKind: "outer-stock-analyst-node",
    jobType: "stock-analyst-run",
    scopePrefix: "oa_stock_analyst_",
    maximumInputs: 0,
  });
  for (const invalid of [
    { ...request, apiKey: "renderer-secret" },
    canonicalRequest({ baseUrl: "http://user:secret@127.0.0.1:8765/v1" }),
    canonicalRequest({ task: "x".repeat(200_001) }),
    canonicalRequest({ memoryContext: "x".repeat(32_001) }),
    canonicalRequest({ conversationContext: "x".repeat(15_001) }),
    canonicalRequest({ settings: { ...request.settings, depth: "unbounded" } }),
    canonicalRequest({ settings: { ...request.settings, watchlist: "aapl" } }),
    canonicalRequest({ settings: { ...request.settings, temperature: 2.1 } }),
    canonicalRequest({ settings: { ...request.settings, providerToken: "secret" } }),
    canonicalRequest({ serviceModel: "another-model" }),
  ]) {
    assert.throws(
      () => validateRuntimeV2StockAnalystRequest(invalid),
      /canonical Stock Analyst Runtime request is invalid/u,
    );
  }
});

test("Stock Analyst routes are a thin durable facade over one disposable worker", () => {
  const facade = source("src/lib/stock-analyst/runtime-run-manager.ts");
  const manager = source("src/lib/stock-analyst/run-manager.ts");
  const launch = source("src/app/api/stock-analyst/runs/route.ts");
  const events = source("src/app/api/stock-analyst/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/stock-analyst/runs/[runId]/abort/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");

  assert.match(facade, /prepareService\(/u);
  assert.match(facade, /kind: "stock-analyst"/u);
  assert.ok(
    facade.indexOf("prepareService({") < facade.indexOf("startOuterAgentRun({"),
    "the private service boot profile must be written before Runtime admission",
  );
  assert.match(manager, /export function startRuntimeWorkerRun/u);
  assert.match(manager, /preparedService\(input\.runtimeServiceModel\)/u);
  assert.match(launch, /stock-analyst\/runtime-run-manager\.ts/u);
  assert.doesNotMatch(
    launch,
    /stock-analyst\/run-manager|node:child_process|\bspawn\s*\(/u,
  );
  assert.match(events, /outerAgentEventsResponse/u);
  assert.match(events, /readOuterAgentRunView\("stock-analyst"/u);
  assert.doesNotMatch(events, /setInterval|stock-analyst\/run-manager/u);
  assert.match(abort, /await abortRun\(userId, runId\)/u);
  assert.match(cancellation, /stock-analyst\/runtime-run-manager\.ts/u);
  assert.match(
    source("scripts/runtime-v2-stock-analyst-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("stock-analyst"\)/u,
  );
});

test("the real disposable Stock Analyst worker streams and seals a completed answer", async () => {
  const service = stockAnalystServer();
  const serviceUrl = await service.listen();
  const request = canonicalRequest();
  const fixture = runtimeFixture(request);
  try {
    const child = await runWorker(fixture, serviceUrl);
    assert.equal(child.code, 0, child.stderr);
    assert.equal(typeof service.streamRequest.session_id, "string");
    assert.equal(typeof service.streamRequest.request_id, "string");
    assert.match(service.streamRequest.message, /prefers concise risk summaries/u);
    assert.match(service.streamRequest.message, /Compare AAPL's recent trend/u);
    assert.match(service.streamRequest.message, /large-cap technology companies/u);
    const result = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"),
    );
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.run.adapterId, "stock-analyst");
    assert.equal(result.run.status, "completed");
    const ready = result.run.events.find((event) => event.type === "service.ready");
    assert.equal(ready.payload.model, "test-model");
    assert.equal(ready.payload.coldStart, true);
    const terminal = result.run.events.find(
      (event) => event.type === "run.completed",
    );
    assert.match(terminal.payload.summary, /valuation risk is elevated/u);
    assert.match(child.stdout, /"type":"ready"/u);
    assert.match(child.stdout, /"type":"complete"/u);
  } finally {
    await service.close();
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop aborts a hung Stock Analyst stream without publishing a result", async () => {
  const service = stockAnalystServer({ hang: true });
  const serviceUrl = await service.listen();
  const fixture = runtimeFixture(canonicalRequest());
  try {
    const child = await runWorker(fixture, serviceUrl, {
      stopWhen: service.streamStarted,
    });
    assert.equal(child.code, 0, child.stderr);
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "aborted");
    assert.ok(checkpoint.events.some((event) => event.type === "run.aborted"));
    assert.match(child.stdout, /"type":"cancellation-acknowledged"/u);
    await Promise.race([
      service.cancellationSeen,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("upstream cancellation was not requested")), 2_000),
      ),
    ]);
  } finally {
    await service.close();
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
});
