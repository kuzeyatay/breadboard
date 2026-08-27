import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import {
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  expectedRuntimeV2OuterAgentInputCount,
  validateRuntimeV2SocialsManagerRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const workerPath = path.join(dashboardRoot, "scripts", "runtime-v2-socials-manager-worker.mjs");

function source(relativePath) {
  return fs.readFileSync(path.join(dashboardRoot, ...relativePath.split("/")), "utf8");
}

function validRequest(baseUrl = "http://127.0.0.1:3000/v1", overrides = {}) {
  return {
    brief: "Announce the launch --on x --no-image",
    model: "test-model",
    baseUrl,
    conversationPublicId: null,
    conversationContext: "",
    ...overrides,
  };
}

function runtimeFixture(request) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-socials-runtime-"));
  const databaseRoot = path.join(dataRoot, "database");
  fs.mkdirSync(databaseRoot, { recursive: true });
  const database = new Database(path.join(databaseRoot, "brain.db"));
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users(id, username, email, password_hash)
      VALUES (7, 'runtime-socials', 'runtime-socials@example.test', 'x');
  `);
  database.close();

  const jobId = "job_socials_manager_1";
  const workerInstanceId = "worker_socials_manager_1";
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
      conversationId: `oa_socials_manager_${"a".repeat(32)}`,
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
      assert.equal(parsed.tools?.[0]?.function?.name, "publish_drafts");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              function: {
                arguments: JSON.stringify({
                  posts: [{ network: "x", content: "Breadboard is ready for launch." }],
                }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      }));
    });
  });
  return {
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
        BREADBOARD_DATA_DIR: fixture.dataRoot,
        BREADBOARD_REPO_ROOT: repositoryRoot,
        SOCIALS_MANAGER_MODE: "adapter",
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
      reject(new Error(`Socials Manager Runtime worker timed out.\n${stderr}`));
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

test("Socials Manager has one sealed zero-input Runtime adapter", () => {
  const request = validRequest();
  assert.equal(validateRuntimeV2SocialsManagerRequest(request), request);
  assert.equal(expectedRuntimeV2OuterAgentInputCount("socials-manager", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["socials-manager"], {
    id: "socials-manager",
    workerKind: "outer-socials-manager-node",
    jobType: "socials-manager-run",
    scopePrefix: "oa_socials_manager_",
    maximumInputs: 0,
  });
  for (const forged of [
    { ...request, apiKey: "renderer-secret" },
    { ...request, executable: "node.exe" },
    validRequest("http://user:secret@127.0.0.1:3000/v1"),
    validRequest(undefined, { conversationPublicId: "conv_other" }),
    validRequest(undefined, { brief: "x".repeat(100_001) }),
  ]) {
    assert.throws(() => validateRuntimeV2SocialsManagerRequest(forged), /invalid/u);
  }
});

test("Socials Manager routes only submit, replay, and cancel Runtime jobs", () => {
  const facade = source("src/lib/socials-manager/runtime-run-manager.ts");
  const manager = source("src/lib/socials-manager/run-manager.ts");
  const launch = source("src/app/api/socials-manager/runs/route.ts");
  const events = source("src/app/api/socials-manager/runs/[runId]/events/route.ts");
  const abort = source("src/app/api/socials-manager/runs/[runId]/abort/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");

  assert.match(facade, /startOuterAgentRun\(\{/u);
  assert.match(facade, /kind: "socials-manager"/u);
  assert.doesNotMatch(facade, /socials-manager\/run-manager|chatmockApiKeyValue|openPostizSession/u);
  assert.match(manager, /export function startRuntimeWorkerRun/u);
  assert.match(manager, /input\.runtimeJobId \?\?/u);
  assert.match(launch, /socials-manager\/runtime-run-manager\.ts/u);
  assert.match(launch, /const run = await startRun\(/u);
  assert.doesNotMatch(launch, /socials-manager\/run-manager|chatmockApiKeyValue|openPostizSession/u);
  assert.match(events, /outerAgentEventsResponse/u);
  assert.doesNotMatch(events, /setInterval|getEventsSince/u);
  assert.match(abort, /await abortRun\(userId, runId\)/u);
  assert.match(cancellation, /socials-manager\/runtime-run-manager\.ts/u);
  assert.match(source("scripts/runtime-v2-socials-manager-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("socials-manager"\)/u);
});

test("the real Socials Manager disposable worker persists a draft and exits", async () => {
  const model = modelServer();
  const baseUrl = await model.listen();
  const fixture = runtimeFixture(validRequest(baseUrl));
  try {
    const child = await runWorker(fixture);
    assert.equal(child.code, 0, child.stderr);
    const result = JSON.parse(fs.readFileSync(path.join(fixture.jobRoot, "result.json"), "utf8"));
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.run.adapterId, "socials-manager");
    assert.equal(result.run.status, "completed");
    const terminal = result.run.events.find((event) => event.type === "run.completed");
    assert.equal(terminal.payload.posts.length, 1);
    assert.equal(terminal.payload.posts[0].providerId, "x");
    assert.match(terminal.payload.summary, /Drafted 1 post/u);
    assert.match(child.stdout, /"type":"ready"/u);
    assert.match(child.stdout, /"type":"complete"/u);
  } finally {
    await model.close();
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
});

test("a Runtime stop aborts the real Socials Manager worker", async () => {
  const model = modelServer({ hang: true });
  const baseUrl = await model.listen();
  const fixture = runtimeFixture(validRequest(baseUrl));
  try {
    const child = await runWorker(fixture, { cancel: true });
    assert.equal(child.code, 0, child.stderr);
    assert.equal(fs.existsSync(path.join(fixture.jobRoot, "result.json")), false);
    const checkpoint = JSON.parse(
      fs.readFileSync(path.join(fixture.jobRoot, "checkpoint.json"), "utf8"),
    );
    assert.equal(checkpoint.status, "aborted");
    assert.ok(checkpoint.events.some((event) => event.type === "run.aborted"));
    assert.match(child.stdout, /"type":"cancellation-acknowledged"/u);
  } finally {
    await model.close();
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
});
