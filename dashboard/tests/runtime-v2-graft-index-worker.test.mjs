import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveRuntimeGraftCli,
  validateGraftIndexRequest,
} from "../scripts/runtime-v2-graft-index-worker.mjs";
import { graftGraphDirectory } from "../src/lib/code-index/index-service.ts";
import { ensureGraftIndex } from "../src/lib/code-index/runtime-build.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-graft-index-worker.mjs",
);
let fixtureSequence = 0;

function fixture(t, { slow = false } = {}) {
  const sequence = ++fixtureSequence;
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-graft-worker-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const repositoryPath = path.join(dataRoot, "connected-repository");
  fs.mkdirSync(path.join(repositoryPath, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, "index.ts"), "export const ready = true;\n");
  const cliPath = path.join(dataRoot, slow ? "fake-graft-slow.mjs" : "fake-graft.mjs");
  fs.writeFileSync(
    cliPath,
    slow
      ? [
          'import fs from "node:fs";',
          'import path from "node:path";',
          "const graph = process.argv[3];",
          "fs.mkdirSync(graph, { recursive: true });",
          'fs.writeFileSync(path.join(graph, "builder-pid.txt"), String(process.pid));',
          "setTimeout(() => {",
          '  fs.writeFileSync(path.join(graph, "INDEX.md"), "late\\n");',
          "}, 30_000);",
        ].join("\n")
      : [
          'import fs from "node:fs";',
          'import path from "node:path";',
          'if (process.argv[2] !== "--dir" || process.argv[4] !== "build") process.exit(9);',
          "const graph = process.argv[3];",
          "fs.mkdirSync(graph, { recursive: true });",
          'fs.writeFileSync(path.join(graph, "builder-pid.txt"), String(process.pid));',
          'fs.writeFileSync(path.join(graph, "INDEX.md"), "# fixture graph\\n");',
        ].join("\n"),
  );
  const identity = {
    jobId: `job_graft_${sequence}`,
    attempt: 1,
    workerInstanceId: `worker_graft_${sequence}`,
  };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(
    jobRoot,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(
    path.join(jobRoot, "input.json"),
    `${JSON.stringify({ repositoryPath })}\n`,
  );
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope: {
        userId: 31,
        gardenId: null,
        conversationId: "graft_fixture_repository",
      },
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs: [],
      workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    })}\n`,
  );
  return { dataRoot, repositoryPath, cliPath, identity, jobRoot, attemptRoot };
}

async function runWorker(current, { cancelAtCheckpoint = false } = {}) {
  const child = spawn(process.execPath, [workerPath, "start.json"], {
    cwd: current.attemptRoot,
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERPROFILE: process.env.USERPROFILE,
      BREADBOARD_GRAFT_CLI: current.cliPath,
    },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const workerPid = child.pid;
  let stdout = "";
  let stderr = "";
  let buffered = "";
  let stopSent = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line && cancelAtCheckpoint && !stopSent) {
        const event = JSON.parse(line);
        if (event.type === "checkpoint") {
          stopSent = true;
          child.stdin.end('{"type":"stop","force":false}\n');
        }
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  if (!cancelAtCheckpoint) child.stdin.end();
  const exit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("The fresh Graft worker did not exit."));
    }, 20_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  return {
    workerPid,
    exit,
    stderr,
    events: stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)),
  };
}

test("Graft indexing accepts only a repository path and has no Next-owned spawn", () => {
  const request = { repositoryPath: dashboardRoot };
  assert.equal(validateGraftIndexRequest(request), request);
  assert.throws(
    () => validateGraftIndexRequest({ ...request, executable: "anything.exe" }),
    /canonical Graft index request/u,
  );
  assert.throws(
    () => validateGraftIndexRequest({ repositoryPath: "relative" }),
    /canonical Graft index request/u,
  );
  const indexService = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "code-index", "index-service.ts"),
    "utf8",
  );
  const runtimeBuild = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "code-index", "runtime-build.ts"),
    "utf8",
  );
  assert.doesNotMatch(indexService, /node:child_process|\bspawn\s*\(/u);
  assert.match(runtimeBuild, /submitRuntimeJob/);
  assert.match(runtimeBuild, /graft-index-node/);
});

test("a fresh Graft worker atomically publishes one fenced graph", async (t) => {
  const current = fixture(t);
  assert.equal(resolveRuntimeGraftCli({ BREADBOARD_GRAFT_CLI: current.cliPath }), current.cliPath);
  const run = await runWorker(current);
  assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
  assert.deepEqual(run.events.map((event) => event.type), [
    "ready",
    "checkpoint",
    "complete",
  ]);
  assert.ok(run.events.every((event) =>
    JSON.stringify(event.identity) === JSON.stringify(current.identity)));
  const result = JSON.parse(
    fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"),
  );
  assert.deepEqual(result.identity, current.identity);
  assert.equal(result.completionSequence, run.events.at(-1).sequence);
  assert.deepEqual(
    { built: result.result.built, ready: result.result.ready },
    { built: true, ready: true },
  );
  const graphDirectory = graftGraphDirectory(current.repositoryPath, {
    BREADBOARD_DATA_DIR: current.dataRoot,
    BREADBOARD_GRAFT_CLI: current.cliPath,
  });
  assert.equal(fs.existsSync(path.join(graphDirectory, "INDEX.md")), true);
  assert.ok(Number(fs.readFileSync(path.join(graphDirectory, "builder-pid.txt"), "utf8")) > 0);
  assert.equal(
    fs.readdirSync(path.dirname(graphDirectory)).some((name) => name.includes(".pending-")),
    false,
  );
});

test("Graft cancellation is acknowledged and leaves no result or partial graph", async (t) => {
  const current = fixture(t, { slow: true });
  const run = await runWorker(current, { cancelAtCheckpoint: true });
  assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
  assert.deepEqual(run.events.map((event) => event.type), [
    "ready",
    "checkpoint",
    "cancellation-acknowledged",
  ]);
  assert.equal(fs.existsSync(path.join(current.jobRoot, "result.json")), false);
  const graphDirectory = graftGraphDirectory(current.repositoryPath, {
    BREADBOARD_DATA_DIR: current.dataRoot,
    BREADBOARD_GRAFT_CLI: current.cliPath,
  });
  assert.equal(fs.existsSync(path.join(graphDirectory, "INDEX.md")), false);
  assert.equal(
    fs.existsSync(path.dirname(graphDirectory)) &&
      fs.readdirSync(path.dirname(graphDirectory)).some((name) => name.includes(".pending-")),
    false,
  );
});

test("the dashboard submits one sealed non-blocking Runtime build and reuses its graph", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-graft-client-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const repositoryPath = path.join(dataRoot, "owned-repository");
  fs.mkdirSync(path.join(repositoryPath, ".git"), { recursive: true });
  const cliPath = path.join(dataRoot, "graft-cli.mjs");
  fs.writeFileSync(cliPath, "// trusted fixture\n");
  const env = {
    BREADBOARD_DATA_DIR: dataRoot,
    BREADBOARD_GRAFT_CLI: cliPath,
  };
  const submissions = [];
  let submittedJob;
  const control = {
    configured: () => true,
    async submit(authority, submission) {
      submissions.push({ authority, submission });
      submittedJob = {
        jobId: "job_graft_client",
        jobType: "graft-index-build",
        workerKind: "graft-index-node",
        resourceClass: "large-generation",
        gardenId: authority.gardenId,
        conversationId: authority.conversationId,
        state: "succeeded",
        attempt: 1,
        workerInstanceId: "worker_graft_client",
        lastWorkerSequence: 3,
      };
      fs.mkdirSync(graftGraphDirectory(repositoryPath, env), { recursive: true });
      fs.writeFileSync(
        path.join(graftGraphDirectory(repositoryPath, env), "INDEX.md"),
        "# ready\n",
      );
      return submittedJob;
    },
    async inspect() {
      throw new Error("an already-terminal submission must not be polled");
    },
    async readResult(authority, jobId) {
      assert.equal(jobId, submittedJob.jobId);
      return {
        content: {
          protocolVersion: 1,
          identity: {
            jobId,
            attempt: submittedJob.attempt,
            workerInstanceId: submittedJob.workerInstanceId,
          },
          completionSequence: submittedJob.lastWorkerSequence,
          result: { built: true, durationMs: 42, ready: true },
        },
      };
    },
  };
  assert.equal(
    await ensureGraftIndex(71, repositoryPath, { env, control, now: () => 600_000 }),
    "building",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(submissions.length, 1);
  assert.deepEqual(Object.keys(submissions[0].submission.requestPayload), ["repositoryPath"]);
  assert.equal(submissions[0].submission.requestPayload.repositoryPath, repositoryPath);
  assert.match(submissions[0].submission.idempotencyKey, /^graft-index-v2:71:[0-9a-f]{16}:2$/u);
  assert.equal(submissions[0].authority.userId, 71);
  assert.equal(submissions[0].authority.gardenId, null);
  assert.match(submissions[0].authority.conversationId, /^graft_[0-9a-f]{16}$/u);
  assert.equal(
    await ensureGraftIndex(71, repositoryPath, { env, control, now: () => 600_001 }),
    "ready",
  );
  assert.equal(submissions.length, 1);
});
