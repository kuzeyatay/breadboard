import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureAgentEditsSnapshot,
  executeAgentEditsOperation,
  validateAgentEditsRequest,
} from "../scripts/runtime-v2-agent-edits-executor.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-agent-edits-worker.mjs",
);
const gitBin = (() => {
  if (process.platform === "win32") {
    return execFileSync(path.join(process.env.SystemRoot, "System32", "where.exe"), ["git.exe"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim().split(/\r?\n/u)[0];
  }
  return execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
})();
let sequence = 0;

function git(repositoryPath, ...args) {
  return execFileSync(gitBin, ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function fixture(t, operation = "summary") {
  const current = ++sequence;
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-edits-worker-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const repositoryPath = path.join(dataRoot, "repository");
  fs.mkdirSync(repositoryPath);
  git(repositoryPath, "init", "--initial-branch=main");
  git(repositoryPath, "config", "user.email", "runtime@test.invalid");
  git(repositoryPath, "config", "user.name", "Runtime Test");
  fs.writeFileSync(path.join(repositoryPath, "tracked.ts"), "export const value = 1;\n");
  git(repositoryPath, "add", "-A");
  git(repositoryPath, "commit", "-m", "initial");
  const before = captureAgentEditsSnapshot(repositoryPath);
  fs.writeFileSync(
    path.join(repositoryPath, "tracked.ts"),
    "export const value = 2;\nexport const added = true;\n",
  );
  const after = captureAgentEditsSnapshot(repositoryPath);
  assert.ok(before && after);

  const identity = {
    jobId: `job_agent_edits_${current}`,
    attempt: 1,
    workerInstanceId: `worker_agent_edits_${current}`,
  };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(
    jobRoot,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  const request = {
    operation,
    repositoryPath,
    before,
    after,
    ...(operation === "patch" ? { filePath: "tracked.ts" } : {}),
  };
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(path.join(attemptRoot, "start.json"), `${JSON.stringify({
    protocolVersion: 1,
    identity,
    executionScope: {
      userId: 41,
      gardenId: null,
      conversationId: "agent_edits_fixture_repository",
    },
    inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
    inputBlobs: [],
    workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${identity.jobId}/result.json`,
  })}\n`);
  return { dataRoot, repositoryPath, identity, jobRoot, attemptRoot, request };
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
      HOME: process.env.HOME,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      BREADBOARD_GIT_BIN: gitBin,
      BREADBOARD_RUNTIME_V2_FIXED_TOOLS: "1",
    },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
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
      reject(new Error("The fresh agent-edits worker did not exit."));
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
    exit,
    stderr,
    events: stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)),
  };
}

test("agent-edits accepts only sealed snapshot operations and Next cannot spawn Git", () => {
  const current = {
    operation: "patch",
    repositoryPath: dashboardRoot,
    before: "a".repeat(40),
    after: "b".repeat(40),
    filePath: "src/index.ts",
  };
  assert.equal(validateAgentEditsRequest(current), current);
  assert.throws(
    () => validateAgentEditsRequest({ ...current, executable: "git.exe" }),
    /canonical agent-edits request/u,
  );
  assert.throws(
    () => validateAgentEditsRequest({ ...current, filePath: "../secret" }),
    /file path/u,
  );
  const route = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "agent-edits", "route.ts"),
    "utf8",
  );
  const compatibility = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "agent-edits", "snapshot.ts"),
    "utf8",
  );
  assert.doesNotMatch(route, /node:child_process|execFile|spawn/u);
  assert.doesNotMatch(compatibility, /node:child_process|execFile|spawn/u);
  assert.match(route, /runAgentEditsOperation/u);
});

test("a fresh agent-edits worker publishes a fenced out-of-band JSON artifact", async (t) => {
  const current = fixture(t, "summary");
  const run = await runWorker(current);
  assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
  assert.deepEqual(run.events.map((event) => event.type), ["ready", "checkpoint", "complete"]);
  const result = JSON.parse(fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"));
  assert.deepEqual(result.identity, current.identity);
  assert.equal(result.completionSequence, run.events.at(-1).sequence);
  assert.equal(result.result.operation, "summary");
  assert.equal(result.result.mediaType, "application/json");
  assert.equal(fs.statSync(path.join(current.jobRoot, "result.json")).size < 1024 * 1024, true);
  const artifact = path.resolve(current.dataRoot, ...result.result.artifactRelativePath.split("/"));
  const response = JSON.parse(fs.readFileSync(artifact, "utf8"));
  assert.equal(response.ok, true);
  assert.equal(response.filesChanged, 1);
  assert.deepEqual(response.files.map((file) => file.path), ["tracked.ts"]);
});

test("a failed artifact promotion removes its private pending file", async (t) => {
  const current = fixture(t, "summary");
  const workspacePath = path.join(current.attemptRoot, "workspace");
  fs.mkdirSync(path.join(workspacePath, "agent-edits-response.json"));

  await assert.rejects(
    executeAgentEditsOperation(
      {
        request: current.request,
        workspacePath,
        dataRoot: current.dataRoot,
      },
      new AbortController().signal,
      { checkpoint: () => undefined },
    ),
  );

  assert.deepEqual(
    fs.readdirSync(workspacePath).filter((entry) => entry.includes(".pending.")),
    [],
  );
});

test("agent-edits cancellation is acknowledged before Git starts and publishes no result", async (t) => {
  const current = fixture(t, "patch");
  const run = await runWorker(current, { cancelAtCheckpoint: true });
  assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
  assert.deepEqual(run.events.map((event) => event.type), [
    "ready",
    "checkpoint",
    "cancellation-acknowledged",
  ]);
  assert.equal(fs.existsSync(path.join(current.jobRoot, "result.json")), false);
  assert.equal(
    fs.existsSync(path.join(current.attemptRoot, "workspace", "agent-edits-response.json")),
    false,
  );
});
