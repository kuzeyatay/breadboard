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
  validateRuntimeV2DeepResearchRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-deep-research-worker.mjs",
);
const source = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
const JOB_ID = "job_deep_research_1";
const SERVICE_SECRET = "deep-research-runtime-test-capability-000001";
const CREATED_AT = "2026-08-26T10:00:00.000Z";

function canonicalRequest(overrides = {}) {
  return {
    query: "Compare two practical approaches to grid-scale energy storage.",
    breadth: 4,
    depth: 3,
    output: "report",
    memoryContext: "The user prefers quantified tradeoffs and explicit uncertainty.",
    conversationContext: "User: Focus on deployment in coastal regions.",
    ...overrides,
  };
}

function runtimeFixture(request, dataRoot) {
  const workerInstanceId = "worker_deep_research_1";
  const jobRoot = path.join(dataRoot, "runtime", "jobs", JOB_ID);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity: { jobId: JOB_ID, attempt: 1, workerInstanceId },
      executionScope: {
        userId: 7,
        gardenId: null,
        conversationId: `oa_deep_research_${"a".repeat(32)}`,
      },
      inputManifestPath: `runtime/jobs/${JOB_ID}/input.json`,
      inputBlobs: [],
      workspacePath: `runtime/jobs/${JOB_ID}/attempts/1/${workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${JOB_ID}/checkpoint.json`,
      resultPath: `runtime/jobs/${JOB_ID}/result.json`,
    })}\n`,
  );
  return { dataRoot, jobRoot, attemptRoot };
}

function runSummary(status, request) {
  return {
    runId: JOB_ID,
    ownerUserId: 7,
    status,
    query: request.query,
    breadth: request.breadth,
    depth: request.depth,
    output: request.output,
    createdAt: CREATED_AT,
    ...(status === "running" ? {} : { completedAt: "2026-08-26T10:00:03.000Z" }),
    lastSequence: status === "running" ? 1 : status === "completed" ? 4 : 2,
    learningCount: status === "completed" ? 2 : 0,
    sourceCount: status === "completed" ? 2 : 0,
    evidenceCount: status === "completed" ? 2 : 0,
    warningCount: 0,
    ...(status === "completed"
      ? {
          result: "Flow batteries trade energy density for long cycle life; pumped hydro remains site-limited.",
          usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
        }
      : {}),
  };
}

function serviceEvents(request, status) {
  const events = [
    {
      sequenceNumber: 1,
      type: "run.started",
      at: CREATED_AT,
      payload: {
        query: request.query,
        breadth: request.breadth,
        depth: request.depth,
        output: request.output,
      },
    },
  ];
  if (status === "completed") {
    events.push(
      {
        sequenceNumber: 2,
        type: "research.learnings",
        at: "2026-08-26T10:00:01.000Z",
        payload: { learnings: ["Flow batteries are cycle-durable.", "Pumped hydro is site-limited."] },
      },
      {
        sequenceNumber: 3,
        type: "run.result",
        at: "2026-08-26T10:00:02.000Z",
        payload: {
          output: request.output,
          result: "Flow batteries trade energy density for long cycle life; pumped hydro remains site-limited.",
        },
      },
      {
        sequenceNumber: 4,
        type: "run.completed",
        at: "2026-08-26T10:00:03.000Z",
        payload: {
          learningCount: 2,
          sourceCount: 2,
          evidenceCount: 2,
          warningCount: 0,
        },
      },
    );
  } else if (status === "aborted") {
    events.push({
      sequenceNumber: 2,
      type: "run.aborted",
      at: "2026-08-26T10:00:03.000Z",
      payload: { learningCount: 0, sourceCount: 0, evidenceCount: 0, warningCount: 0 },
    });
  }
  return events;
}

function deepResearchService(requestShape, { hang = false } = {}) {
  let createRequest = null;
  let createAuthorization = "";
  let abortRequest = null;
  let abortAuthorization = "";
  let aborted = false;
  let firstEventsResolve;
  let abortSeenResolve;
  const firstEvents = new Promise((resolve) => {
    firstEventsResolve = resolve;
  });
  const abortSeen = new Promise((resolve) => {
    abortSeenResolve = resolve;
  });
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const send = (statusCode, value) => {
        response.writeHead(statusCode, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.headers.authorization !== `Bearer ${SERVICE_SECRET}`) {
        send(401, { ok: false, error: "unauthorized" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/runs") {
        createAuthorization = request.headers.authorization ?? "";
        createRequest = JSON.parse(body);
        send(201, { ok: true, data: runSummary("running", requestShape) });
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === `/runs/${JOB_ID}/events`
      ) {
        firstEventsResolve();
        const since = Number(url.searchParams.get("since") ?? 0);
        const status = aborted ? "aborted" : hang ? "running" : "completed";
        send(200, {
          ok: true,
          data: serviceEvents(requestShape, status).filter(
            (event) => event.sequenceNumber > since,
          ),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === `/runs/${JOB_ID}`) {
        send(200, {
          ok: true,
          data: runSummary(aborted ? "aborted" : hang ? "running" : "completed", requestShape),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === `/runs/${JOB_ID}/abort`) {
        abortAuthorization = request.headers.authorization ?? "";
        abortRequest = JSON.parse(body);
        setTimeout(() => {
          aborted = true;
          abortSeenResolve();
          send(200, { ok: true, data: runSummary("aborted", requestShape) });
        }, 75);
        return;
      }
      send(404, { ok: false, error: "not_found" });
    });
  });
  return {
    firstEvents,
    abortSeen,
    get createRequest() {
      return createRequest;
    },
    get createAuthorization() {
      return createAuthorization;
    },
    get abortRequest() {
      return abortRequest;
    },
    get abortAuthorization() {
      return abortAuthorization;
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      server.unref();
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test service unavailable");
      return `http://127.0.0.1:${address.port}`;
    },
    async close() {
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
        DEEP_RESEARCH_URL: serviceUrl,
        DEEP_RESEARCH_SECRET: SERVICE_SECRET,
        DEEP_RESEARCH_REQUEST_TIMEOUT_MS: "5000",
        BREADBOARD_SUPERVISOR_CONTROL_URL: "",
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "",
        BREADBOARD_RUNTIME_V2_ACTIVE: "",
        CHATMOCK_API_KEY: "",
        OPENAI_API_KEY: "",
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Deep Research Runtime worker timed out.\n${stderr}`));
    }, 30_000);
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
        if (child.exitCode === null) child.stdin.write('{"type":"stop","force":false}\n');
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

test("Deep Research has one exact secret-free zero-input Runtime contract", () => {
  const request = canonicalRequest();
  assert.equal(validateRuntimeV2DeepResearchRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("deep-research", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["deep-research"], {
    id: "deep-research",
    workerKind: "outer-deep-research-node",
    jobType: "deep-research-run",
    scopePrefix: "oa_deep_research_",
    maximumInputs: 0,
    maximumProjectionBytes: 8 * 1024 * 1024,
  });
  for (const invalid of [
    { ...request, apiKey: "secret" },
    { ...request, serviceUrl: "http://127.0.0.1:7722" },
    { ...request, supervisorToken: "secret" },
    canonicalRequest({ query: "x".repeat(4_001) }),
    canonicalRequest({ breadth: 11 }),
    canonicalRequest({ depth: 0 }),
    canonicalRequest({ output: "raw" }),
    canonicalRequest({ memoryContext: "x".repeat(32_001) }),
  ]) {
    assert.throws(
      () => validateRuntimeV2DeepResearchRequest(invalid),
      /canonical Deep Research Runtime request is invalid/u,
    );
  }
});

test("Deep Research routes are durable and the disposable worker owns no process authority", () => {
  const facade = source("src/lib/deep-research/runtime-run-manager.ts");
  const manager = source("src/lib/deep-research/runtime-worker-run-manager.ts");
  const launch = source("src/app/api/deep-research/runs/route.ts");
  const events = source("src/app/api/deep-research/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/deep-research/runs/[runId]/abort/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");

  assert.match(facade, /kind: "deep-research"/u);
  assert.match(facade, /memoryContext: memory\?\.text \?\? ""/u);
  assert.doesNotMatch(
    facade.slice(facade.indexOf("requestPayload:")),
    /apiKey|secret|serviceUrl|supervisorToken/iu,
  );
  assert.match(manager, /export function startRuntimeWorkerRun/u);
  assert.match(manager, /export async function abortRuntimeWorkerRun/u);
  assert.match(manager, /await client\.abort\(run\.runId, run\.userId\)/u);
  assert.doesNotMatch(
    manager,
    /node:child_process|\bspawn\s*\(|supervisor-control|ServiceLease|acquireServiceLease/iu,
  );
  assert.match(launch, /deep-research\/runtime-run-manager\.ts/u);
  assert.doesNotMatch(launch, /deep-research\/service\.ts|startRuntimeWorkerRun/u);
  assert.match(events, /outerAgentEventsResponse/u);
  assert.match(events, /readOuterAgentRunView\("deep-research"/u);
  assert.doesNotMatch(events, /setInterval/u);
  assert.match(abort, /await abortRun\(userId, runId\)/u);
  assert.match(cancellation, /deep-research\/runtime-run-manager\.ts/u);
  assert.match(
    source("scripts/runtime-v2-deep-research-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("deep-research"\)/u,
  );
});

test("the real Deep Research worker seals context and projects its completed report", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-deep-research-runtime-"));
  const request = canonicalRequest();
  const fixture = runtimeFixture(request, dataRoot);
  const service = deepResearchService(request);
  const serviceUrl = await service.listen();
  try {
    const child = await runWorker(fixture, serviceUrl);
    assert.equal(child.code, 0, child.stderr);
    assert.equal(service.createAuthorization, `Bearer ${SERVICE_SECRET}`);
    assert.deepEqual(Object.keys(service.createRequest).sort(), [
      "breadth",
      "depth",
      "output",
      "ownerUserId",
      "query",
      "runId",
      "userContext",
    ]);
    assert.equal(service.createRequest.runId, JOB_ID);
    assert.equal(service.createRequest.ownerUserId, 7);
    assert.equal(service.createRequest.query, request.query);
    assert.equal(
      service.createRequest.userContext,
      `${request.memoryContext}\n\n${request.conversationContext}`,
    );
    const result = JSON.parse(fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"));
    assert.equal(result.run.adapterId, "deep-research");
    assert.equal(result.run.status, "completed");
    assert.match(
      result.run.events.find((event) => event.type === "run.result")?.payload.result ?? "",
      /Flow batteries trade energy density/u,
    );
    assert.equal(
      result.run.events.findLast((event) => event.type.startsWith("run."))?.type,
      "run.completed",
    );
    assert.match(child.stdout, /"type":"complete"/u);
  } finally {
    await service.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop awaits upstream Deep Research abort and publishes no result", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-deep-research-cancel-"));
  const request = canonicalRequest({ query: "Keep researching until this run is stopped." });
  const fixture = runtimeFixture(request, dataRoot);
  const service = deepResearchService(request, { hang: true });
  const serviceUrl = await service.listen();
  try {
    const child = await runWorker(fixture, serviceUrl, { stopWhen: service.firstEvents });
    assert.equal(child.code, 0, child.stderr);
    await Promise.race([
      service.abortSeen,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("upstream Deep Research abort was not awaited")), 2_000),
      ),
    ]);
    assert.equal(service.abortAuthorization, `Bearer ${SERVICE_SECRET}`);
    assert.deepEqual(service.abortRequest, { userId: 7 });
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "aborted");
    assert.ok(checkpoint.events.some((event) => event.type === "run.aborted"));
    assert.equal(checkpoint.events.some((event) => event.type === "run.result"), false);
    assert.match(child.stdout, /"type":"cancellation-acknowledged"/u);
  } finally {
    await service.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
