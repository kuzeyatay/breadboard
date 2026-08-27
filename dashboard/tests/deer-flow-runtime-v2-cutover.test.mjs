import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  expectedRuntimeV2OuterAgentInputCount,
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  validateRuntimeV2DeerFlowRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workerPath = path.join(dashboardRoot, "scripts", "runtime-v2-deer-flow-worker.mjs");
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
const jobId = "job_deer_flow_1";

function seedConversation(dataRoot, task) {
  const dbUrl = pathToFileURL(path.join(dashboardRoot, "src", "lib", "db.ts")).href;
  const conversationUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "conversations", "store.ts"),
  ).href;
  const runtimeUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "hermes", "runtime-store.ts"),
  ).href;
  const turnsUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "conversations", "external-agent-turns.ts"),
  ).href;
  const script = [
    `process.env.BREADBOARD_DATA_DIR = ${JSON.stringify(dataRoot)};`,
    `const { default: db } = await import(${JSON.stringify(dbUrl)});`,
    "db.prepare(\"INSERT INTO users(id, username, email, password_hash) VALUES (7, 'deer-runtime', 'deer-runtime@example.test', 'x')\").run();",
    `const { createConversation } = await import(${JSON.stringify(conversationUrl)});`,
    `const { createRuntimeSession } = await import(${JSON.stringify(runtimeUrl)});`,
    `const { recordExternalAgentTurn } = await import(${JSON.stringify(turnsUrl)});`,
    "const conversation = createConversation({ userId: 7, title: 'Runtime DeerFlow test' });",
    `createRuntimeSession({ conversationId: conversation.id, surface: "dashboard_terminal", userId: 7, chatSessionId: null, agentName: "Hermes", clusterId: null, gardenId: null, pageSlug: null, workspaceKey: "deer-runtime", activeDirectory: ${JSON.stringify(dataRoot)}, filesystemMode: "restricted", hermesSessionId: "hermes-deer-runtime" });`,
    `recordExternalAgentTurn({ conversation, clientMessageId: "deer-runtime-client-1", surface: "dashboard_terminal", userContent: "/agents:deer-flow ${task}", run: { kind: "deer_flow", runId: ${JSON.stringify(jobId)}, task: ${JSON.stringify(task)} } });`,
    "process.stdout.write(conversation.public_id);",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: dashboardRoot,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^conv_[A-Za-z0-9_-]{24}$/u);
  return result.stdout;
}

function canonicalRequest(conversationPublicId, overrides = {}) {
  return {
    task: "Research the migration and write a concise report.",
    model: "test-model",
    reasoningEffort: "high",
    settings: {
      subagents: true,
      maxSubagents: 4,
      planMode: true,
      web: false,
      memory: true,
      shell: false,
    },
    conversationPublicId,
    conversationContext: "User: Keep the recommendation practical and concise.",
    coldStart: true,
    ...overrides,
  };
}

function runtimeFixture(request, dataRoot) {
  const workerInstanceId = "worker_deer_flow_1";
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
      conversationId: `oa_deer_flow_${"a".repeat(32)}`,
    },
    inputManifestPath: `runtime/jobs/${jobId}/input.json`,
    inputBlobs: [],
    workspacePath: `runtime/jobs/${jobId}/attempts/1/${workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${jobId}/result.json`,
  })}\n`);
  return { dataRoot, jobRoot, attemptRoot };
}

function deerFlowServer({ hang = false } = {}) {
  const pending = new Set();
  let runRequest = null;
  let threadId = "";
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
      if (/\/runs\/gateway-run-1\/cancel\?action=interrupt$/u.test(request.url ?? "")) {
        cancellationSeenResolve();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (request.method === "POST" && request.url === "/api/runs/stream") {
        runRequest = JSON.parse(body);
        threadId = runRequest.config.configurable.thread_id;
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "content-location": `/api/threads/${threadId}/runs/gateway-run-1`,
        });
        response.write(
          `id: 1\nevent: messages\ndata: ${JSON.stringify([
            {
              type: "AIMessageChunk",
              id: "assistant-1",
              content: "The migration is ready. ",
              additional_kwargs: {},
            },
            {},
          ])}\n\n`,
        );
        setTimeout(streamStartedResolve, 100);
        if (hang) return;
        response.end("id: 2\nevent: end\ndata: null\n\n");
        return;
      }
      if (
        request.method === "GET" &&
        request.url === `/api/threads/${threadId}/state`
      ) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          values: {
            messages: [{ type: "ai", content: "The migration is ready. Roll it out in stages." }],
            artifacts: ["/mnt/user-data/outputs/migration-report.md"],
          },
        }));
        return;
      }
      if (
        request.method === "GET" &&
        request.url ===
          `/api/threads/${threadId}/artifacts/mnt/user-data/outputs/migration-report.md?download=true`
      ) {
        response.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
        response.end("# Migration report\n\nRoll out in three bounded stages.\n");
        return;
      }
      if (request.method === "GET" && /\/runs\/gateway-run-1$/u.test(request.url ?? "")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: hang ? "running" : "completed" }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  return {
    streamStarted,
    cancellationSeen,
    get runRequest() {
      return runRequest;
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      server.unref();
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server unavailable");
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
        CHATMOCK_API_KEY: "",
        OPENAI_API_KEY: "",
        DEER_FLOW_SERVICE_URL: serviceUrl,
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`DeerFlow Runtime worker timed out.\n${stderr}`));
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

function readStoredArtifact(dataRoot, artifactId) {
  const artifactStoreUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "hermes", "artifact-store.ts"),
  ).href;
  const script = [
    `process.env.BREADBOARD_DATA_DIR = ${JSON.stringify(dataRoot)};`,
    `const { getArtifactById, artifactDeliveryFile } = await import(${JSON.stringify(artifactStoreUrl)});`,
    `const artifact = getArtifactById(${JSON.stringify(artifactId)});`,
    "if (!artifact) throw new Error('artifact missing');",
    "const file = artifactDeliveryFile(artifact);",
    "const fs = await import('node:fs');",
    "process.stdout.write(JSON.stringify({ userId: artifact.user_id, source: artifact.source_hermes_tool, metadata: JSON.parse(artifact.metadata_json), content: fs.readFileSync(file.absolutePath, 'utf8') }));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: dashboardRoot,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("DeerFlow has one exact secret-free Runtime request contract", () => {
  const request = canonicalRequest(`conv_${"a".repeat(24)}`);
  assert.equal(validateRuntimeV2DeerFlowRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("deer-flow", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["deer-flow"], {
    id: "deer-flow",
    workerKind: "outer-deer-flow-node",
    jobType: "deer-flow-run",
    scopePrefix: "oa_deer_flow_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  });
  for (const invalid of [
    { ...request, apiKey: "renderer-secret" },
    { ...request, baseUrl: "http://127.0.0.1:8765/v1" },
    { ...request, supervisorToken: "secret" },
    canonicalRequest(request.conversationPublicId, { task: "x".repeat(200_001) }),
    canonicalRequest(request.conversationPublicId, { reasoningEffort: "unbounded" }),
    canonicalRequest(request.conversationPublicId, {
      settings: { ...request.settings, maxSubagents: 13 },
    }),
    canonicalRequest(request.conversationPublicId, {
      settings: { ...request.settings, providerSecret: "secret" },
    }),
  ]) {
    assert.throws(
      () => validateRuntimeV2DeerFlowRequest(invalid),
      /canonical DeerFlow Runtime request is invalid/u,
    );
  }
});

test("DeerFlow routes are a thin durable facade and worker has no secret or process authority", () => {
  const facade = source("src/lib/deer-flow/runtime-run-manager.ts");
  const manager = source("src/lib/deer-flow/run-manager.ts");
  const service = source("src/lib/deer-flow/service.ts");
  const workerService = source("src/lib/deer-flow/runtime-worker-service.ts");
  const launch = source("src/app/api/deer-flow/runs/route.ts");
  const events = source("src/app/api/deer-flow/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/deer-flow/runs/[runId]/abort/route.ts");
  const artifact = source("src/app/api/deer-flow/runs/[runId]/artifacts/[artifactId]/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");

  assert.ok(
    facade.indexOf("prepareService({") < facade.indexOf("startOuterAgentRun({"),
    "the private service profile must be written before Runtime admission",
  );
  const requestPayload = facade.slice(facade.indexOf("requestPayload:"));
  assert.doesNotMatch(requestPayload, /baseUrl|apiKey|supervisor|token|secret/iu);
  assert.match(manager, /export function startRuntimeWorkerRun/u);
  assert.match(manager, /preparedService\(\)/u);
  assert.match(manager, /deer-flow\/runtime-worker-service\.ts|\.\/runtime-worker-service\.ts/u);
  assert.doesNotMatch(
    manager,
    /agent-browser\/provider|prepareService|service-run-lease|supervisor-control|node:child_process|\bspawn\s*\(/u,
  );
  assert.match(service, /export async function prepareService/u);
  assert.match(workerService, /export function preparedService/u);
  assert.doesNotMatch(workerService, /writeConfig|provider|supervisor|apiKey|token|secret/iu);
  assert.match(launch, /deer-flow\/runtime-run-manager\.ts/u);
  assert.match(launch, /if \(!conversationPublicId\)[\s\S]*conversation_required/u);
  assert.match(launch, /getConversationForUser\(conversationPublicId, userId\)/u);
  assert.doesNotMatch(launch, /deer-flow\/run-manager|node:child_process|\bspawn\s*\(/u);
  assert.match(events, /outerAgentEventsResponse/u);
  assert.match(events, /readOuterAgentRunView\("deer-flow"/u);
  assert.doesNotMatch(events, /setInterval|deer-flow\/run-manager/u);
  assert.match(abort, /await abortRun\(userId, runId\)/u);
  assert.match(artifact, /deer-flow\/runtime-run-manager\.ts/u);
  assert.match(artifact, /createReadStream/u);
  assert.doesNotMatch(artifact, /DEER_FLOW_SERVICE_URL|fetch\(|deer-flow\/run-manager/u);
  assert.match(cancellation, /deer-flow\/runtime-run-manager\.ts/u);
  assert.match(
    source("scripts/runtime-v2-deer-flow-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("deer-flow"\)/u,
  );
});

test("the real disposable DeerFlow worker seals context, settings, answer, and artifact", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-deer-flow-runtime-"));
  const task = "Research the migration and write a concise report.";
  const conversationPublicId = seedConversation(dataRoot, task);
  const request = canonicalRequest(conversationPublicId);
  const fixture = runtimeFixture(request, dataRoot);
  const service = deerFlowServer();
  const serviceUrl = await service.listen();
  try {
    const child = await runWorker(fixture, serviceUrl);
    assert.equal(child.code, 0, child.stderr);
    assert.match(service.runRequest.input.messages[0].content, /Research the migration/u);
    assert.match(service.runRequest.input.messages[0].content, /practical and concise/u);
    assert.equal(service.runRequest.context.model_name, "test-model");
    assert.equal(service.runRequest.context.reasoning_effort, "high");
    assert.equal(service.runRequest.context.is_plan_mode, true);
    assert.equal(service.runRequest.context.subagent_enabled, true);
    assert.equal(service.runRequest.context.max_total_subagents, 4);
    const result = JSON.parse(fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"));
    assert.equal(result.run.adapterId, "deer-flow");
    assert.equal(result.run.status, "completed");
    const ready = result.run.events.find((event) => event.type === "service.ready");
    assert.equal(ready.payload.coldStart, true);
    const terminal = result.run.events.find((event) => event.type === "run.completed");
    assert.match(terminal.payload.summary, /Roll it out in stages/u);
    assert.equal(terminal.payload.artifacts.length, 1);
    assert.match(terminal.payload.artifacts[0].artifactId, /^art_/u);
    const stored = readStoredArtifact(dataRoot, terminal.payload.artifacts[0].artifactId);
    assert.equal(stored.userId, 7);
    assert.equal(stored.source, "deer_flow_present_files");
    assert.equal(stored.metadata.deerFlowOutput, true);
    assert.equal(stored.metadata.deerFlowPath, "/mnt/user-data/outputs/migration-report.md");
    assert.match(stored.content, /Roll out in three bounded stages/u);
    assert.match(child.stdout, /"type":"complete"/u);
  } finally {
    await service.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop interrupts a hung DeerFlow run and publishes no result", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-deer-flow-cancel-"));
  const task = "Keep researching until stopped.";
  const conversationPublicId = seedConversation(dataRoot, task);
  const fixture = runtimeFixture(canonicalRequest(conversationPublicId), dataRoot);
  const service = deerFlowServer({ hang: true });
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
        setTimeout(() => reject(new Error("upstream DeerFlow cancellation was not requested")), 2_000),
      ),
    ]);
  } finally {
    await service.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
