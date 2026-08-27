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
  validateRuntimeV2AgentTarsRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import { defaultAgentConfiguration } from "../src/lib/ui-tars/config.ts";
import {
  loadUITarsRunProfile,
  prepareUITarsRunProfile,
  uiTarsProfileId,
} from "../src/lib/ui-tars/run-profile.ts";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workerPath = path.join(dashboardRoot, "scripts", "runtime-v2-agent-tars-worker.mjs");
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
const jobId = "job_agent_tars_1";
const workerInstanceId = "worker_agent_tars_1";
const userId = 7;
const agentId = "uta_" + "a".repeat(32);
const requestId = "agent-tars-request-1";
const profileId = uiTarsProfileId(userId, agentId, requestId);
const task = "Open the release dashboard and summarize its final state.";
const serviceToken = "agent-tars-runtime-test-capability-000001";
const providerSecret = "agent-tars-private-provider-secret";

function configuration() {
  return {
    ...defaultAgentConfiguration({
      CHATMOCK_BASE_URL: "http://127.0.0.1:8765/v1",
      CHATMOCK_MODEL: "test-model",
    }),
    model: "test-model",
  };
}

function canonicalRequest(overrides = {}) {
  return { agentId, task, profileId, ...overrides };
}

function prepareProfile(dataRoot, overrides = {}) {
  return prepareUITarsRunProfile(dataRoot, {
    profileId,
    ownerUserId: userId,
    agentId,
    task,
    configuration: configuration(),
    providerApiKey: providerSecret,
    ...overrides,
  });
}

function runtimeFixture(request, dataRoot) {
  const jobRoot = path.join(dataRoot, "runtime", "jobs", jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), JSON.stringify(request) + "\n");
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    JSON.stringify({
      protocolVersion: 1,
      identity: { jobId, attempt: 1, workerInstanceId },
      executionScope: {
        userId,
        gardenId: null,
        conversationId: "oa_agent_tars_" + "b".repeat(32),
      },
      inputManifestPath: "runtime/jobs/" + jobId + "/input.json",
      inputBlobs: [],
      workspacePath:
        "runtime/jobs/" + jobId + "/attempts/1/" + workerInstanceId + "/workspace",
      checkpointPath: "runtime/jobs/" + jobId + "/checkpoint.json",
      resultPath: "runtime/jobs/" + jobId + "/result.json",
    }) + "\n",
  );
  return { dataRoot, jobRoot, attemptRoot };
}

function fakeAdapter(mode) {
  const pending = new Set();
  const events = [];
  let origin = "";
  let summary = null;
  let createBody = null;
  let abortAt = null;
  let decided = false;
  let startedResolve;
  let approvalResolve;
  let abortResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  const approvalRequested = new Promise((resolve) => {
    approvalResolve = resolve;
  });
  const abortSeen = new Promise((resolve) => {
    abortResolve = resolve;
  });

  const append = (type, payload = {}) => {
    const event = {
      runId: jobId,
      sequenceNumber: events.length + 1,
      type,
      at: new Date().toISOString(),
      payload,
    };
    events.push(event);
    if (summary) {
      summary.lastSequence = event.sequenceNumber;
      if (type === "run.started") summary.status = "running";
      if (type === "approval.requested") summary.status = "awaiting_approval";
      if (type === "approval.approved") summary.status = "running";
      if (type === "run.completed") summary.status = "completed";
      if (type === "run.failed") summary.status = "failed";
      if (type === "run.aborted") summary.status = "aborted";
    }
    return event;
  };
  const send = (response, status, value) => {
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": String(bytes.byteLength),
    });
    response.end(bytes);
  };
  const envelope = (response, data) => send(response, 200, { ok: true, data });
  const fail = (response, status, error) => send(response, status, { ok: false, error });

  const server = http.createServer((request, response) => {
    pending.add(response);
    response.on("close", () => pending.delete(response));
    if (request.headers.authorization !== "Bearer " + serviceToken) {
      fail(response, 401, "unauthorized");
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 64 * 1024) request.destroy();
    });
    request.on("end", () => {
      const url = new URL(request.url ?? "/", origin);
      const runPath = "/runs/" + jobId;
      if (request.method === "GET" && url.pathname === runPath) {
        if (Number(url.searchParams.get("userId")) !== userId) {
          fail(response, 403, "forbidden");
        } else if (!summary) {
          fail(response, 404, "run_not_found");
        } else {
          envelope(response, summary);
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/runs") {
        if (summary) {
          fail(response, 409, "run_exists");
          return;
        }
        createBody = JSON.parse(body);
        summary = {
          runId: createBody.runId,
          ownerUserId: createBody.ownerUserId,
          status: "queued",
          task: createBody.task,
          operatorType: createBody.config.operator,
          createdAt: new Date().toISOString(),
          lastSequence: 0,
        };
        append("run.queued", { task: createBody.task });
        append("run.started", { operator: createBody.config.operator });
        startedResolve();
        if (mode === "complete") {
          append("agent.thinking", { text: "Inspecting the release dashboard." });
          append("observation.screenshot", {
            screenshotId: "1",
            width: 1440,
            height: 900,
          });
          append("run.completed", { summary: "The release is healthy." });
        } else if (mode === "approval") {
          append("approval.requested", {
            actionId: "approve_1",
            action: "click",
            target: "Deploy",
            explanation: "This publishes the release.",
            risk: "high",
            requestedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          });
          approvalResolve();
        }
        envelope(response, summary);
        return;
      }
      if (request.method === "GET" && url.pathname === runPath + "/events") {
        if (!summary) {
          fail(response, 404, "run_not_found");
          return;
        }
        const since = Number(url.searchParams.get("since") ?? 0);
        envelope(response, events.filter((event) => event.sequenceNumber > since));
        return;
      }
      if (request.method === "POST" && url.pathname === runPath + "/approve") {
        const parsed = JSON.parse(body);
        if (
          parsed.userId !== userId ||
          parsed.actionId !== "approve_1" ||
          mode !== "approval"
        ) {
          fail(response, 409, "run_mismatch");
          return;
        }
        if (decided) {
          fail(response, 409, "already_decided");
          return;
        }
        decided = true;
        append("approval.approved", { actionId: "approve_1" });
        append("action.completed", { actionId: "approve_1" });
        append("run.completed", { summary: "The release was published." });
        envelope(response, undefined);
        return;
      }
      if (request.method === "POST" && url.pathname === runPath + "/abort") {
        const parsed = JSON.parse(body);
        if (parsed.userId !== userId) {
          fail(response, 403, "forbidden");
          return;
        }
        if (summary && summary.status !== "aborted") append("run.aborted", {});
        abortAt = Date.now();
        abortResolve();
        envelope(response, undefined);
        return;
      }
      fail(response, 404, "not_found");
    });
  });

  return {
    started,
    approvalRequested,
    abortSeen,
    get createBody() {
      return createBody;
    },
    get abortAt() {
      return abortAt;
    },
    get events() {
      return events;
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      server.unref();
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server unavailable");
      origin = "http://127.0.0.1:" + address.port;
      return origin;
    },
    async approve() {
      const response = await fetch(origin + "/runs/" + jobId + "/approve", {
        method: "POST",
        headers: {
          authorization: "Bearer " + serviceToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ userId, actionId: "approve_1" }),
      });
      assert.equal(response.status, 200);
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

function launchWorker(fixture, serviceUrl, stopWhen) {
  const child = spawn(process.execPath, [workerPath, "start.json"], {
    cwd: fixture.attemptRoot,
    env: {
      ...process.env,
      BREADBOARD_SUPERVISOR_CONTROL_URL: "",
      BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "",
      UI_TARS_PROVIDER_API_KEY: "",
      OPENAI_API_KEY: "",
      CHATMOCK_API_KEY: "",
      BREADBOARD_UI_TARS_SERVICE_URL: serviceUrl + "/",
      BREADBOARD_UI_TARS_SERVICE_TOKEN: serviceToken,
      NODE_NO_WARNINGS: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
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
  const completion = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Agent TARS Runtime worker timed out.\n" + stderr));
    }, 30_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, exitAt: Date.now() });
    });
  });
  return { child, completion };
}

async function waitFor(predicate, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

test("Agent TARS has one exact secret-free Runtime request contract", () => {
  const request = canonicalRequest();
  assert.equal(validateRuntimeV2AgentTarsRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("agent-tars", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["agent-tars"], {
    id: "agent-tars",
    workerKind: "outer-agent-tars-node",
    jobType: "agent-tars-run",
    scopePrefix: "oa_agent_tars_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  });
  for (const invalid of [
    { ...request, providerApiKey: providerSecret },
    { ...request, configuration: configuration() },
    { ...request, serviceUrl: "http://127.0.0.1:9999" },
    { ...request, serviceToken },
    { ...request, supervisorToken: "supervisor-secret" },
    canonicalRequest({ agentId: "agent-wrong" }),
    canonicalRequest({ task: "" }),
    canonicalRequest({ task: "x".repeat(8_001) }),
    canonicalRequest({ profileId: "profile-wrong" }),
  ]) {
    assert.throws(
      () => validateRuntimeV2AgentTarsRequest(invalid),
      /canonical Agent TARS Runtime request is invalid/u,
    );
  }
});

test("the private launch profile is immutable and bound to the authenticated run", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-tars-profile-"));
  try {
    const profile = prepareProfile(dataRoot);
    assert.equal(profile.providerApiKey, providerSecret);
    assert.deepEqual(prepareProfile(dataRoot), profile, "an exact retry is idempotent");
    assert.equal(
      loadUITarsRunProfile(dataRoot, { profileId, ownerUserId: userId, agentId, task }).profileId,
      profileId,
    );
    assert.throws(
      () => loadUITarsRunProfile(dataRoot, { profileId, ownerUserId: userId + 1, agentId, task }),
      /does not match this job/u,
    );
    assert.throws(
      () => prepareProfile(dataRoot, { task: "A conflicting task." }),
      /identity was reused/u,
    );
    const canonical = JSON.stringify(canonicalRequest());
    assert.doesNotMatch(canonical, /private-provider|configuration|providerApiKey|serviceToken/iu);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("Agent TARS Next routes own no run lease, timer, process, or provider authority", () => {
  const facade = source("src/lib/ui-tars/runtime-run-manager.ts");
  const worker = source("src/lib/ui-tars/runtime-worker-run-manager.ts");
  const workerClient = source("src/lib/ui-tars/runtime-worker-client.ts");
  const adminClient = source("src/lib/ui-tars/client.ts");
  const launch = source("src/app/api/ui-tars/agents/[agentId]/runs/route.ts");
  const events = source("src/app/api/ui-tars/agents/[agentId]/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/ui-tars/agents/[agentId]/runs/[runId]/abort/route.ts");
  const approval = source("src/app/api/ui-tars/agents/[agentId]/runs/[runId]/approve/route.ts");
  const screenshot = source(
    "src/app/api/ui-tars/agents/[agentId]/runs/[runId]/screenshots/[screenshotId]/route.ts",
  );
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");

  assert.ok(
    facade.indexOf("prepareUITarsRunProfile(dashboardDataDir()") <
      facade.indexOf("startOuterAgentRun({"),
    "the private profile must be prepared before Runtime admission",
  );
  const requestPayload = facade.slice(
    facade.indexOf("requestPayload:"),
    facade.indexOf("store.createRunRecord"),
  );
  assert.doesNotMatch(
    requestPayload,
    /configuration|providerApiKey|serviceUrl|serviceToken|supervisor|executable|spawn/iu,
  );
  assert.doesNotMatch(facade, /node:child_process|\bspawn(?:Sync)?\s*\(|run-lease/iu);
  assert.match(worker, /loadUITarsRunProfile/u);
  assert.match(worker, /runtimeJobId/u);
  assert.doesNotMatch(
    worker,
    /service\.ts|store\.ts|db\.ts|supervisor-control|withServiceLease|node:child_process|\bspawn(?:Sync)?\s*\(/iu,
  );
  assert.match(workerClient, /BREADBOARD_UI_TARS_SERVICE_URL/u);
  assert.match(workerClient, /BREADBOARD_UI_TARS_SERVICE_TOKEN/u);
  assert.doesNotMatch(
    workerClient,
    /BREADBOARD_SUPERVISOR|CHATMOCK|OPENAI|withServiceLease|node:child_process|\bspawn(?:Sync)?\s*\(/u,
  );
  assert.doesNotMatch(adminClient, /createRun\(|getRun\(|eventsSince\(|abort\(runId/u);
  assert.match(launch, /ui-tars\/runtime-run-manager\.ts/u);
  assert.match(launch, /requestId/u);
  assert.doesNotMatch(launch, /ui-tars\/service\.ts|run-lease|node:child_process/u);
  assert.match(events, /outerAgentEventsResponse/u);
  assert.match(events, /readEventsView/u);
  assert.doesNotMatch(events, /setInterval|run-lease|ui-tars\/service\.ts/u);
  assert.match(abort, /ui-tars\/runtime-run-manager\.ts/u);
  assert.doesNotMatch(abort, /ui-tars\/service\.ts|run-lease/u);
  assert.match(approval, /service\.decide\(userId, agentId, runId/u);
  assert.match(screenshot, /service\.screenshot\(userId, agentId, runId/u);
  assert.match(cancellation, /ui-tars\/runtime-run-manager\.ts/u);
  assert.equal(fs.existsSync(path.join(dashboardRoot, "src/lib/ui-tars/run-lease.ts")), false);
  assert.match(
    source("scripts/runtime-v2-agent-tars-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("agent-tars"\)/u,
  );
});

test("the real disposable Agent TARS worker completes with its Runtime job identity", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-tars-runtime-"));
  prepareProfile(dataRoot);
  const fixture = runtimeFixture(canonicalRequest(), dataRoot);
  const service = fakeAdapter("complete");
  const serviceUrl = await service.listen();
  try {
    const launched = launchWorker(fixture, serviceUrl);
    const child = await launched.completion;
    assert.equal(child.code, 0, child.stderr);
    assert.equal(service.createBody.runId, jobId);
    assert.equal(service.createBody.ownerUserId, userId);
    assert.equal(service.createBody.task, task);
    assert.deepEqual(service.createBody.config, configuration());
    assert.equal(service.createBody.providerApiKey, providerSecret);
    const input = fs.readFileSync(path.join(fixture.jobRoot, "input.json"), "utf8");
    assert.doesNotMatch(input, /private-provider|providerApiKey|configuration|serviceToken/iu);
    const result = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"),
    );
    assert.equal(result.run.adapterId, "agent-tars");
    assert.equal(result.run.status, "completed");
    assert.deepEqual(
      result.run.events.map((event) => event.type),
      [
        "run.queued",
        "run.started",
        "agent.thinking",
        "observation.screenshot",
        "run.completed",
      ],
    );
    assert.match(child.stdout, /"type":"complete"/u);
  } finally {
    await service.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("the disposable worker remains alive across approval and resumes exactly once", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-tars-approval-"));
  prepareProfile(dataRoot);
  const fixture = runtimeFixture(canonicalRequest(), dataRoot);
  const service = fakeAdapter("approval");
  const serviceUrl = await service.listen();
  try {
    const launched = launchWorker(fixture, serviceUrl);
    await service.approvalRequested;
    await waitFor(() => {
      const checkpointPath = path.join(fixture.jobRoot, "checkpoint.json");
      if (!fs.existsSync(checkpointPath)) return false;
      const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
      return checkpoint.events.some((event) => event.type === "approval.requested");
    }, "approval was not sealed into the Runtime checkpoint");
    assert.equal(launched.child.exitCode, null, "the worker must stay alive while approval is pending");
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    await service.approve();
    const child = await launched.completion;
    assert.equal(child.code, 0, child.stderr);
    const result = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"),
    );
    assert.deepEqual(
      result.run.events.slice(-3).map((event) => event.type),
      ["approval.approved", "action.completed", "run.completed"],
    );
    const replay = await fetch(serviceUrl + "/runs/" + jobId + "/approve", {
      method: "POST",
      headers: {
        authorization: "Bearer " + serviceToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ userId, actionId: "approve_1" }),
    });
    assert.equal(replay.status, 409, "the upstream action gate is single use");
  } finally {
    await service.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop aborts the hung upstream run before exit and seals no result", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-tars-cancel-"));
  prepareProfile(dataRoot);
  const fixture = runtimeFixture(canonicalRequest(), dataRoot);
  const service = fakeAdapter("hang");
  const serviceUrl = await service.listen();
  try {
    const launched = launchWorker(fixture, serviceUrl, service.started);
    const child = await launched.completion;
    assert.equal(child.code, 0, child.stderr);
    await Promise.race([
      service.abortSeen,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("upstream Agent TARS abort was not requested")), 2_000),
      ),
    ]);
    assert.ok(service.abortAt <= child.exitAt, "the upstream abort must settle before worker exit");
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "aborted");
    assert.ok(checkpoint.events.some((event) => event.type === "run.aborted"));
    assert.match(child.stdout, /"type":"cancellation-acknowledged"/u);
  } finally {
    await service.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
