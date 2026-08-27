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
  validateRuntimeV2OpenscienceRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import { prepareService } from "../src/lib/openscience/service-profile.ts";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workerPath = path.join(dashboardRoot, "scripts", "runtime-v2-openscience-worker.mjs");
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
const jobId = "job_openscience_1";
const serviceToken = "openscience-runtime-test-capability-000001";

function canonicalRequest(overrides = {}) {
  return {
    task: "Measure the migration's failure rate and write a concise report.",
    model: "test-model",
    reasoningEffort: "high",
    options: { harness: "research", deliverFiles: true },
    conversationPublicId: `conv_${"a".repeat(24)}`,
    conversationContext: "User: Compare the result with the previous rollout.",
    ...overrides,
  };
}

function runtimeFixture(request, dataRoot) {
  const workerInstanceId = "worker_openscience_1";
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
      conversationId: `oa_openscience_${"b".repeat(32)}`,
    },
    inputManifestPath: `runtime/jobs/${jobId}/input.json`,
    inputBlobs: [],
    workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${jobId}/result.json`,
  })}\n`);
  return { dataRoot, jobRoot, attemptRoot };
}

function openscienceServer(workspace, { hang = false } = {}) {
  const pending = new Set();
  let origin = "";
  let eventResponse = null;
  let ensureAuthorization = "";
  let ensureRequest = null;
  let sessionRequest = null;
  let promptRequest = null;
  let streamStartedResolve;
  let cancellationSeenResolve;
  const streamStarted = new Promise((resolve) => {
    streamStartedResolve = resolve;
  });
  const cancellationSeen = new Promise((resolve) => {
    cancellationSeenResolve = resolve;
  });

  const send = (response, status, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": String(bytes.length),
    });
    response.end(bytes);
  };
  const publish = (event) => {
    eventResponse?.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const server = http.createServer((request, response) => {
    pending.add(response);
    response.on("close", () => pending.delete(response));
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.method === "POST" && request.url === "/v1/ensure") {
        ensureAuthorization = request.headers.authorization ?? "";
        ensureRequest = JSON.parse(body);
        send(response, 200, {
          ok: true,
          result: {
            baseUrl: origin,
            projectId: "prj_runtime_1",
            workspacePath: workspace,
            models: ["test-model", "default"],
            startedAt: Date.now(),
          },
        });
        return;
      }
      if (request.method === "GET" && request.url === "/event") {
        assert.equal(request.headers.authorization, undefined);
        eventResponse = response;
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        response.flushHeaders();
        return;
      }
      if (request.method === "POST" && request.url === "/session") {
        assert.equal(request.headers.authorization, undefined);
        sessionRequest = JSON.parse(body);
        send(response, 200, { id: "ses_runtime_1", title: sessionRequest.title });
        return;
      }
      if (
        request.method === "POST" &&
        request.url === "/session/ses_runtime_1/prompt_async"
      ) {
        assert.equal(request.headers.authorization, undefined);
        promptRequest = JSON.parse(body);
        send(response, 200, {});
        fs.writeFileSync(
          path.join(workspace, "migration-report.md"),
          "# Migration report\n\nThe measured failure rate is 0.4%.\n",
        );
        setImmediate(() => {
          publish({
            type: "message.updated",
            properties: {
              sessionID: "ses_runtime_1",
              info: { id: "msg_runtime_1", role: "assistant" },
            },
          });
          publish({
            type: "message.part.updated",
            properties: {
              sessionID: "ses_runtime_1",
              part: {
                id: "part_runtime_1",
                messageID: "msg_runtime_1",
                type: "text",
                text: "The measured failure rate is 0.4%; continue the staged rollout.",
              },
            },
          });
          streamStartedResolve();
          if (hang) return;
          publish({
            type: "message.part.updated",
            properties: {
              sessionID: "ses_runtime_1",
              part: {
                id: "step_runtime_1",
                messageID: "msg_runtime_1",
                type: "step-finish",
                tokens: { input: 120, output: 42, reasoning: 8, cache: { read: 12 } },
              },
            },
          });
          publish({ type: "session.idle", properties: { sessionID: "ses_runtime_1" } });
          eventResponse?.end();
        });
        return;
      }
      if (request.method === "GET" && request.url === "/session/ses_runtime_1/message") {
        send(response, 200, [
          {
            info: {
              id: "msg_runtime_1",
              role: "assistant",
              tokens: { input: 120, output: 42, reasoning: 8, cache: { read: 12 } },
            },
            parts: [
              {
                type: "text",
                text: "The measured failure rate is 0.4%; continue the staged rollout.",
              },
            ],
          },
        ]);
        return;
      }
      if (request.method === "POST" && request.url === "/session/ses_runtime_1/abort") {
        cancellationSeenResolve();
        send(response, 200, { ok: true });
        return;
      }
      send(response, 404, { error: "not_found" });
    });
  });

  return {
    streamStarted,
    cancellationSeen,
    get ensureAuthorization() {
      return ensureAuthorization;
    },
    get ensureRequest() {
      return ensureRequest;
    },
    get sessionRequest() {
      return sessionRequest;
    },
    get promptRequest() {
      return promptRequest;
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      server.unref();
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server unavailable");
      origin = `http://127.0.0.1:${address.port}`;
      return origin;
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
        CHATMOCK_API_KEY: "",
        OPENAI_API_KEY: "",
        BREADBOARD_OPENSCIENCE_SERVICE_URL: `${serviceUrl}/`,
        BREADBOARD_OPENSCIENCE_SERVICE_TOKEN: serviceToken,
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`OpenScience Runtime worker timed out.\n${stderr}`));
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

test("OpenScience has one exact secret-free Runtime request contract", () => {
  const request = canonicalRequest();
  assert.equal(validateRuntimeV2OpenscienceRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("openscience", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS.openscience, {
    id: "openscience",
    workerKind: "outer-openscience-node",
    jobType: "openscience-run",
    scopePrefix: "oa_openscience_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  });
  for (const invalid of [
    { ...request, apiKey: "provider-secret" },
    { ...request, baseUrl: "http://127.0.0.1:8765/v1" },
    { ...request, serviceToken },
    { ...request, supervisorToken: "secret" },
    canonicalRequest({ task: "x".repeat(20_001) }),
    canonicalRequest({ reasoningEffort: "unbounded" }),
    canonicalRequest({ options: { harness: "biology", deliverFiles: true } }),
    canonicalRequest({ options: { harness: "research", deliverFiles: true, shell: true } }),
    canonicalRequest({ conversationPublicId: "conv_wrong" }),
    canonicalRequest({ conversationContext: "x".repeat(15_001) }),
  ]) {
    assert.throws(
      () => validateRuntimeV2OpenscienceRequest(invalid),
      /canonical OpenScience Runtime request is invalid/u,
    );
  }
});

test("the trusted facade profile is atomic, private, and accumulates declared models", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openscience-profile-"));
  const previous = process.env.OPENSCIENCE_STATE_ROOT;
  process.env.OPENSCIENCE_STATE_ROOT = root;
  try {
    assert.deepEqual(
      await prepareService({
        baseUrl: "http://127.0.0.1:8765/v1",
        apiKey: "openscience-private-provider-key",
        model: "model-one",
      }),
      { changed: true },
    );
    await prepareService({
      baseUrl: "http://127.0.0.1:8765/v1/",
      apiKey: "openscience-private-provider-key",
      model: "model-two",
    });
    const directory = path.join(root, "config");
    assert.deepEqual(fs.readdirSync(directory), ["openscience.json"]);
    const profile = JSON.parse(fs.readFileSync(path.join(directory, "openscience.json"), "utf8"));
    assert.equal(profile.provider.chatmock.options.baseURL, "http://127.0.0.1:8765/v1");
    assert.equal(profile.provider.chatmock.options.apiKey, "openscience-private-provider-key");
    assert.deepEqual(
      Object.keys(profile.provider.chatmock.models).sort(),
      ["default", "model-one", "model-two"],
    );
  } finally {
    if (previous === undefined) delete process.env.OPENSCIENCE_STATE_ROOT;
    else process.env.OPENSCIENCE_STATE_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("OpenScience Next routes own no run, process, provider, or service authority", () => {
  const facade = source("src/lib/openscience/runtime-run-manager.ts");
  const manager = source("src/lib/openscience/run-manager.ts");
  const workerService = source("src/lib/openscience/runtime-worker-service.ts");
  const profile = source("src/lib/openscience/service-profile.ts");
  const client = source("src/lib/openscience/client.ts");
  const launch = source("src/app/api/openscience/runs/route.ts");
  const events = source("src/app/api/openscience/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/openscience/runs/[runId]/abort/route.ts");
  const deliverable = source("src/app/api/openscience/runs/[runId]/deliverables/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");

  assert.ok(
    facade.indexOf("dependencies.prepare(") < facade.indexOf("dependencies.submit("),
    "the private service profile must exist before Runtime dependency admission",
  );
  const requestPayload = facade.slice(facade.indexOf("requestPayload:"));
  assert.doesNotMatch(requestPayload, /baseUrl|apiKey|serviceToken|supervisor|secret/iu);
  assert.doesNotMatch(facade, /node:child_process|\bspawn(?:Sync)?\s*\(/u);
  assert.match(profile, /writeConfig/u);
  assert.match(profile, /chatmockApiKeyValue|apiKey/u);
  assert.match(manager, /export function startRuntimeWorkerRun/u);
  assert.match(manager, /from "\.\/runtime-worker-service\.ts"/u);
  assert.doesNotMatch(
    manager,
    /from "\.\/(?:runtime-service|service)\.ts"|agent-browser\/provider|supervisor-control|node:child_process|\bspawn(?:Sync)?\s*\(/u,
  );
  assert.match(workerService, /BREADBOARD_OPENSCIENCE_SERVICE_URL/u);
  assert.match(workerService, /BREADBOARD_OPENSCIENCE_SERVICE_TOKEN/u);
  assert.doesNotMatch(
    workerService,
    /CHATMOCK|OPENAI|BREADBOARD_SUPERVISOR|withRuntimeAgentServiceLease|acquireServiceLease|releaseSupervisorLease|node:child_process|\bspawn(?:Sync)?\s*\(/u,
  );
  assert.match(client, /MAX_RESPONSE_BYTES/u);
  assert.match(client, /boundedText/u);
  assert.match(launch, /openscience\/runtime-run-manager\.ts/u);
  assert.match(launch, /conversation_required/u);
  assert.match(launch, /getConversationForUser\(conversationPublicId, userId\)/u);
  assert.match(launch, /clientMessageId/u);
  assert.doesNotMatch(launch, /openscience\/run-manager|node:child_process|\bspawn(?:Sync)?\s*\(/u);
  assert.match(events, /outerAgentEventsResponse/u);
  assert.match(events, /readOuterAgentRunView\("openscience"/u);
  assert.doesNotMatch(events, /setInterval|openscience\/run-manager/u);
  assert.match(abort, /openscience\/runtime-run-manager\.ts/u);
  assert.match(deliverable, /openscience\/runtime-run-manager\.ts/u);
  assert.match(deliverable, /createReadStream/u);
  assert.doesNotMatch(deliverable, /readFileSync|openscience\/run-manager|fetch\(/u);
  assert.match(cancellation, /openscience\/runtime-run-manager\.ts/u);
  assert.match(
    source("scripts/runtime-v2-openscience-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("openscience"\)/u,
  );
});

test("the real disposable OpenScience worker seals context, settings, answer, and files", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openscience-runtime-"));
  const workspace = path.join(dataRoot, "openscience-workspace");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "existing.md"), "older work\n");
  const fixture = runtimeFixture(canonicalRequest(), dataRoot);
  const service = openscienceServer(workspace);
  const serviceUrl = await service.listen();
  try {
    const child = await runWorker(fixture, serviceUrl);
    assert.equal(child.code, 0, child.stderr);
    assert.equal(service.ensureAuthorization, `Bearer ${serviceToken}`);
    assert.deepEqual(service.ensureRequest, {
      scope: {
        userId: 7,
        runId: jobId,
        conversationPublicId: `conv_${"a".repeat(24)}`,
      },
    });
    assert.equal(service.sessionRequest.permission[0].permission, "question");
    assert.equal(service.sessionRequest.permission[0].action, "deny");
    assert.equal(service.promptRequest.agent, "research");
    assert.deepEqual(service.promptRequest.model, {
      providerID: "chatmock",
      modelID: "test-model",
    });
    assert.equal(service.promptRequest.variant, "high");
    const prompt = service.promptRequest.parts[0].text;
    assert.match(prompt, /Measure the migration's failure rate/u);
    assert.match(prompt, /Compare the result with the previous rollout/u);
    assert.match(prompt, /collected and attached/u);

    const result = JSON.parse(fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"));
    assert.equal(result.run.adapterId, "openscience");
    assert.equal(result.run.status, "completed");
    const started = result.run.events.find((event) => event.type === "run.started");
    assert.equal(started.payload.harness, "research");
    const ready = result.run.events.find((event) => event.type === "service.ready");
    assert.equal(ready.payload.workspace, workspace);
    const delta = result.run.events.find((event) => event.type === "assistant.delta");
    assert.match(delta.payload.text, /failure rate is 0\.4%/u);
    const delivered = result.run.events.filter((event) => event.type === "deliverable.ready");
    assert.deepEqual(delivered.map((event) => event.payload.path), ["migration-report.md"]);
    assert.equal(delivered[0].payload.size, fs.statSync(path.join(workspace, "migration-report.md")).size);
    const terminal = result.run.events.find((event) => event.type === "run.completed");
    assert.match(terminal.payload.content, /continue the staged rollout/u);
    assert.equal(terminal.payload.deliverables, 1);
    assert.match(child.stdout, /"type":"complete"/u);
  } finally {
    await service.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop aborts a hung OpenScience session and seals no result", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openscience-cancel-"));
  const workspace = path.join(dataRoot, "openscience-workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const fixture = runtimeFixture(canonicalRequest({ task: "Keep measuring until stopped." }), dataRoot);
  const service = openscienceServer(workspace, { hang: true });
  const serviceUrl = await service.listen();
  try {
    const child = await runWorker(fixture, serviceUrl, { stopWhen: service.streamStarted });
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
        setTimeout(() => reject(new Error("upstream OpenScience abort was not requested")), 2_000),
      ),
    ]);
  } finally {
    await service.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
