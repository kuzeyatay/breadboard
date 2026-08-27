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
  validateRuntimeV2MoneyPrinterRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-money-printer-worker.mjs",
);
const source = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
const SERVICE_TOKEN = "money-printer-runtime-test-capability-000001";
const CHATMOCK_KEY = "money-printer-runtime-test-chatmock-key";
const VIDEO = Buffer.alloc(32);
VIDEO.write("ftyp", 4, "ascii");

function canonicalRequest(conversationPublicId, overrides = {}) {
  return {
    conversationPublicId,
    request: {
      subject: "Why tide pools support so much life",
      script: "",
      aspect: "16:9",
      source: "pexels",
      language: "en",
      voice: "en-US-JennyNeural-Female",
      paragraphs: 2,
      clipSeconds: 5,
      concat: "sequential",
      subtitles: true,
      music: false,
      videoCount: 1,
      terms: ["tide pools", "shore life"],
    },
    model: "test-model",
    baseUrl: "http://127.0.0.1:8765/v1",
    ...overrides,
  };
}

function isolated(script, dataRoot) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: dashboardRoot,
    env: {
      ...process.env,
      BREADBOARD_DATA_DIR: dataRoot,
      NODE_NO_WARNINGS: "1",
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function seedConversation(dataRoot) {
  const dbUrl = pathToFileURL(path.join(dashboardRoot, "src", "lib", "db.ts")).href;
  const conversationUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "conversations", "store.ts"),
  ).href;
  const runtimeUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "hermes", "runtime-store.ts"),
  ).href;
  const script = [
    `const { default: db } = await import(${JSON.stringify(dbUrl)});`,
    `const conversations = await import(${JSON.stringify(conversationUrl)});`,
    `const runtime = await import(${JSON.stringify(runtimeUrl)});`,
    "db.prepare(\"INSERT INTO users(id, username, email, password_hash) VALUES (7, 'money-runtime', 'money-runtime@example.test', 'x')\").run();",
    "const conversation = conversations.createConversation({ userId: 7, title: 'Runtime MoneyPrinter test' });",
    `runtime.createRuntimeSession({ conversationId: conversation.id, surface: "dashboard_terminal", userId: 7, chatSessionId: null, agentName: "Breadboard", clusterId: null, gardenId: null, pageSlug: null, workspaceKey: "money-printer-runtime", activeDirectory: ${JSON.stringify(dataRoot)}, filesystemMode: "restricted", hermesSessionId: "hermes_money_printer_runtime" });`,
    "process.stdout.write(JSON.stringify({ id: conversation.id, publicId: conversation.public_id }));",
  ].join("\n");
  const seeded = JSON.parse(isolated(script, dataRoot));
  assert.ok(Number.isSafeInteger(seeded.id));
  assert.match(seeded.publicId, /^conv_[A-Za-z0-9_-]{24}$/u);
  return seeded;
}

function inspectArtifacts(dataRoot, conversationPublicId) {
  const artifactUrl = pathToFileURL(
    path.join(dashboardRoot, "src", "lib", "hermes", "artifact-store.ts"),
  ).href;
  const script = [
    `const fs = await import("node:fs");`,
    `const path = await import("node:path");`,
    `const artifacts = await import(${JSON.stringify(artifactUrl)});`,
    `const rows = artifacts.listArtifactsForUser({ userId: 7, conversationPublicId: ${JSON.stringify(conversationPublicId)} });`,
    "const projected = rows.map((row) => {",
    "  const version = artifacts.getArtifactVersion(row.id, row.current_version);",
    "  const output = path.join(process.env.BREADBOARD_DATA_DIR, 'artifacts', ...version.output_location.split('/'));",
    "  return { row, version, bytes: fs.readFileSync(output).toString('base64') };",
    "});",
    "process.stdout.write(JSON.stringify(projected));",
  ].join("\n");
  return JSON.parse(isolated(script, dataRoot));
}

function runtimeFixture(request, dataRoot) {
  const jobId = "job_money_printer_1";
  const workerInstanceId = "worker_money_printer_1";
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
        conversationId: `oa_money_printer_${"a".repeat(32)}`,
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

function moneyPrinterGateway(managedRoot, { hangTask = false } = {}) {
  const pending = new Set();
  let origin = "";
  let ensureAuthorization = "";
  let ensureRequest = null;
  let videoRequest = null;
  let stopAuthorization = "";
  let stopRequest = null;
  let taskRequestedResolve;
  let stopSeenResolve;
  const taskRequested = new Promise((resolve) => {
    taskRequestedResolve = resolve;
  });
  const stopSeen = new Promise((resolve) => {
    stopSeenResolve = resolve;
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
      if (request.url === "/v1/ensure") {
        ensureAuthorization = request.headers.authorization ?? "";
        ensureRequest = JSON.parse(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          ok: true,
          result: {
            url: origin,
            root: managedRoot,
            model: ensureRequest.options.model,
            startedAt: Date.now(),
          },
        }));
        return;
      }
      if (request.url === "/v1/stop") {
        stopAuthorization = request.headers.authorization ?? "";
        stopRequest = JSON.parse(body);
        stopSeenResolve();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result: { stopped: true } }));
        return;
      }
      if (request.url === "/v1/status") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result: { log: "" } }));
        return;
      }
      if (request.url === "/api/v1/videos" && request.method === "POST") {
        videoRequest = JSON.parse(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: 200, data: { task_id: "task-runtime-1" } }));
        return;
      }
      if (request.url === "/api/v1/tasks/task-runtime-1") {
        taskRequestedResolve();
        if (hangTask) return;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          status: 200,
          data: {
            state: 1,
            progress: 100,
            videos: ["/tasks/task-runtime-1/final-1.mp4"],
            script: "Tide pools shelter a dense web of shore life.",
            terms: ["tide pools", "shore life"],
          },
        }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    });
  });
  return {
    taskRequested,
    stopSeen,
    get ensureAuthorization() {
      return ensureAuthorization;
    },
    get ensureRequest() {
      return ensureRequest;
    },
    get videoRequest() {
      return videoRequest;
    },
    get stopAuthorization() {
      return stopAuthorization;
    },
    get stopRequest() {
      return stopRequest;
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      server.unref();
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("test server unavailable");
      }
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
    const env = {
      ...process.env,
      BREADBOARD_DATA_DIR: fixture.dataRoot,
      BREADBOARD_MONEY_PRINTER_SERVICE_URL: `${serviceUrl}/`,
      BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN: SERVICE_TOKEN,
      CHATMOCK_API_KEY: CHATMOCK_KEY,
      MONEY_PRINTER_CREDENTIALS_FILE: path.join(fixture.dataRoot, "money-printer-credentials.json"),
      BREADBOARD_SUPERVISOR_CONTROL_URL: "",
      BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "",
      BREADBOARD_RUNTIME_V2_ACTIVE: "",
      PEXELS_API_KEY: "",
      PIXABAY_API_KEY: "",
      COVERR_API_KEY: "",
      NODE_NO_WARNINGS: "1",
    };
    const child = spawn(process.execPath, [workerPath, "start.json"], {
      cwd: fixture.attemptRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let stopSent = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MoneyPrinter Runtime worker timed out.\n${stderr}`));
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
        if (stopSent || child.exitCode !== null) return;
        stopSent = true;
        child.stdin.write('{"type":"stop","force":false}\n');
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

test("MoneyPrinter accepts one exact credential-free zero-input Runtime request", () => {
  const request = canonicalRequest(`conv_${"m".repeat(24)}`);
  assert.equal(validateRuntimeV2MoneyPrinterRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("money-printer", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["money-printer"], {
    id: "money-printer",
    workerKind: "outer-money-printer-node",
    jobType: "money-printer-run",
    scopePrefix: "oa_money_printer_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  });
  for (const invalid of [
    { ...request, argv: ["python", "attacker.py"] },
    { ...request, env: { MONEY_PRINTER_ROOT: "C:\\outside" } },
    { ...request, apiKey: "renderer-secret" },
    canonicalRequest("conv_other"),
    canonicalRequest(request.conversationPublicId, {
      baseUrl: "http://user:secret@127.0.0.1:8765/v1",
    }),
    canonicalRequest(request.conversationPublicId, {
      request: { ...request.request, subject: "x".repeat(40_001) },
    }),
    canonicalRequest(request.conversationPublicId, {
      request: { ...request.request, source: "filesystem" },
    }),
    canonicalRequest(request.conversationPublicId, {
      request: { ...request.request, videoCount: 6 },
    }),
    canonicalRequest(request.conversationPublicId, {
      request: { ...request.request, terms: ["x".repeat(1_025)] },
    }),
    canonicalRequest(request.conversationPublicId, {
      request: { ...request.request, serviceToken: "renderer-secret" },
    }),
  ]) {
    assert.throws(
      () => validateRuntimeV2MoneyPrinterRequest(invalid),
      /canonical MoneyPrinter Runtime request is invalid/u,
    );
  }
});

test("MoneyPrinter routes are a durable facade over one bounded disposable worker", () => {
  const facade = source("src/lib/money-printer/runtime-run-manager.ts");
  const manager = source("src/lib/money-printer/run-manager.ts");
  const service = source("src/lib/money-printer/runtime-service.ts");
  const launch = source("src/app/api/money-printer/runs/route.ts");
  const events = source("src/app/api/money-printer/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/money-printer/runs/[runId]/abort/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");

  assert.match(facade, /kind: "money-printer"/u);
  assert.doesNotMatch(facade, /apiKey|token|secret|node:child_process|\bspawn\s*\(/u);
  assert.match(manager, /export function startRuntimeWorkerRun/u);
  assert.match(manager, /ensureMoneyPrinterService/u);
  assert.match(manager, /stopMoneyPrinterWorkerService/u);
  assert.match(manager, /readBoundedBody/u);
  assert.match(manager, /MAX_SERVICE_RESPONSE_BYTES/u);
  assert.doesNotMatch(manager, /withMoneyPrinterServiceLease|stopMoneyPrinterRuntime/u);
  assert.match(service, /stopMoneyPrinterWorkerService[\s\S]*callRuntimeAgentService/u);
  assert.match(launch, /money-printer\/runtime-run-manager\.ts/u);
  assert.doesNotMatch(launch, /money-printer\/run-manager|node:child_process|\bspawn\s*\(/u);
  assert.match(events, /outerAgentEventsResponse/u);
  assert.match(events, /readOuterAgentRunView\("money-printer"/u);
  assert.doesNotMatch(events, /setInterval|money-printer\/run-manager/u);
  assert.match(abort, /await abortRun\(userId, runId\)/u);
  assert.match(cancellation, /money-printer\/runtime-run-manager\.ts/u);
  assert.match(
    source("scripts/runtime-v2-money-printer-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("money-printer"\)/u,
  );
});

test("the real disposable MoneyPrinter worker seals a conversation-bound video artifact", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-money-runtime-"));
  const conversation = seedConversation(dataRoot);
  const managedRoot = path.join(dataRoot, "runtime-v2", "toolchains", "money-printer");
  const video = path.join(managedRoot, "storage", "tasks", "task-runtime-1", "final-1.mp4");
  fs.mkdirSync(path.dirname(video), { recursive: true });
  fs.writeFileSync(video, VIDEO);
  fs.writeFileSync(
    path.join(managedRoot, "config.toml"),
    '[app]\npexels_api_keys = ["runtime-test-key"]\n',
  );
  const gateway = moneyPrinterGateway(managedRoot);
  const serviceUrl = await gateway.listen();
  const request = canonicalRequest(conversation.publicId);
  const fixture = runtimeFixture(request, dataRoot);
  try {
    const child = await runWorker(fixture, serviceUrl);
    assert.equal(child.code, 0, child.stderr);
    assert.equal(gateway.ensureAuthorization, `Bearer ${SERVICE_TOKEN}`);
    assert.deepEqual(gateway.ensureRequest.scope, {
      userId: 7,
      runId: "job_money_printer_1",
      conversationPublicId: conversation.publicId,
    });
    assert.deepEqual(gateway.ensureRequest.options, {
      baseUrl: request.baseUrl,
      apiKey: CHATMOCK_KEY,
      model: request.model,
    });
    assert.equal(gateway.videoRequest.video_subject, request.request.subject);
    assert.equal(gateway.videoRequest.video_aspect, request.request.aspect);
    assert.equal(gateway.videoRequest.video_source, request.request.source);

    const result = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"),
    );
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.run.adapterId, "money-printer");
    assert.equal(result.run.status, "completed");
    const ready = result.run.events.find((event) => event.type === "video.ready");
    const terminal = result.run.events.find((event) => event.type === "run.completed");
    assert.match(ready.payload.artifactId, /^art_/u);
    assert.deepEqual(terminal.payload.videoArtifactIds, [ready.payload.artifactId]);
    assert.match(terminal.payload.summary, /Play or download it on the card below/u);

    const artifacts = inspectArtifacts(dataRoot, conversation.publicId);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].row.id, ready.payload.artifactId);
    assert.equal(artifacts[0].row.user_id, 7);
    assert.equal(artifacts[0].row.conversation_id, conversation.id);
    assert.equal(artifacts[0].row.kind, "video");
    assert.equal(artifacts[0].row.mime_type, "video/mp4");
    assert.equal(artifacts[0].row.source_hermes_tool, "money_printer_cut_video");
    assert.equal(artifacts[0].row.byte_size, VIDEO.byteLength);
    assert.equal(artifacts[0].bytes, VIDEO.toString("base64"));
    const metadata = JSON.parse(artifacts[0].row.metadata_json);
    assert.equal(metadata.moneyPrinterTaskId, "task-runtime-1");
    assert.equal(metadata.moneyPrinterSource, "pexels");
    assert.match(child.stdout, /"type":"ready"/u);
    assert.match(child.stdout, /"type":"complete"/u);
  } finally {
    await gateway.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop shuts down MoneyPrinter before sealing an artifact or result", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-money-cancel-"));
  const conversation = seedConversation(dataRoot);
  const managedRoot = path.join(dataRoot, "runtime-v2", "toolchains", "money-printer");
  fs.mkdirSync(managedRoot, { recursive: true });
  fs.writeFileSync(
    path.join(managedRoot, "config.toml"),
    '[app]\npexels_api_keys = ["runtime-test-key"]\n',
  );
  const gateway = moneyPrinterGateway(managedRoot, { hangTask: true });
  const serviceUrl = await gateway.listen();
  const fixture = runtimeFixture(canonicalRequest(conversation.publicId), dataRoot);
  try {
    const child = await runWorker(fixture, serviceUrl, {
      stopWhen: gateway.taskRequested,
    });
    assert.equal(child.code, 0, child.stderr);
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "aborted");
    assert.ok(checkpoint.events.some((event) => event.type === "task.created"));
    assert.ok(checkpoint.events.some((event) => event.type === "run.aborted"));
    assert.match(child.stdout, /"type":"cancellation-acknowledged"/u);
    await Promise.race([
      gateway.stopSeen,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("MoneyPrinter service stop was not requested")), 2_000),
      ),
    ]);
    assert.equal(gateway.stopAuthorization, `Bearer ${SERVICE_TOKEN}`);
    assert.deepEqual(gateway.stopRequest.scope, {
      userId: 7,
      runId: "job_money_printer_1",
      conversationPublicId: conversation.publicId,
    });
    assert.deepEqual(inspectArtifacts(dataRoot, conversation.publicId), []);
  } finally {
    await gateway.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
