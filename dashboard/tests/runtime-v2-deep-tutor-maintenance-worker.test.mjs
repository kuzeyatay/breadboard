import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  deepTutorIndexConversationId,
  validateDeepTutorIndexExecutionScope,
  validateDeepTutorIndexRequest,
  validateDeepTutorProbeExecutionScope,
  validateDeepTutorProbeRequest,
} from "../scripts/runtime-v2-deep-tutor-maintenance-executor.mjs";
import {
  cancelDeepTutorIndex,
  rebuildDeepTutorIndex,
  refreshDeepTutorIndexJob,
} from "../src/lib/runtime-v2/deep-tutor-maintenance-job.ts";
import {
  indexableDocuments,
  readIndexJobReceipt,
} from "../src/lib/deep-tutor/knowledge-base.ts";
import { embeddingFingerprint } from "../src/lib/deep-tutor/home.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const probeWorker = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-deep-tutor-probe-worker.mjs",
);
const indexWorker = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-deep-tutor-index-worker.mjs",
);
let fixtureSequence = 0;

function availablePython() {
  for (const candidate of [
    process.env.DEEP_TUTOR_TEST_PYTHON,
    process.platform === "win32" ? "python.exe" : "python3",
    "python",
  ].filter(Boolean)) {
    const result = spawnSync(candidate, ["-c", "import sys; print(sys.executable)"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const executable = result.status === 0 ? result.stdout.trim() : "";
    if (executable && path.isAbsolute(executable) && fs.existsSync(executable)) {
      return fs.realpathSync.native(executable);
    }
  }
  return null;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function fixture(t, operation, { slow = false } = {}) {
  const python = availablePython();
  if (!python) {
    t.skip("A Python interpreter is required for the Deep Tutor worker fixture.");
    return null;
  }
  const sequence = ++fixtureSequence;
  const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deep-tutor-runtime-v2-")));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const appRoot = path.join(dataRoot, "immutable-app");
  const clone = path.join(appRoot, "DeepTutor");
  write(path.join(clone, "pyproject.toml"), '[project]\nname = "deeptutor-fixture"\n');
  write(path.join(clone, "deeptutor", "__init__.py"), "");
  write(
    path.join(clone, "deeptutor", "app", "__init__.py"),
    "class DeepTutorApp:\n    pass\n",
  );
  write(path.join(clone, "deeptutor", "app", "facade.py"), "class DeepTutorApp:\n    pass\n");
  write(path.join(clone, "deeptutor_cli", "main.py"), "# fixture\n");
  write(path.join(clone, "mcp", "__init__.py"), "# fixture\n");
  const script = path.join(appRoot, "scripts", "deeptutor-index.py");
  write(
    script,
    [
      "import json, os, sys, time",
      "request = json.loads(sys.stdin.readline())",
      "with open(os.path.join(request['home'], 'indexer.pid'), 'w', encoding='utf-8') as handle:",
      "    handle.write(str(os.getpid()))",
      "print(json.dumps({'type': 'progress', 'stage': 'embedding', 'percent': 45}), flush=True)",
      ...(slow ? ["time.sleep(60)"] : []),
      "print(json.dumps({'type': 'completed', 'documents': len(request['documents']), 'chunks': len(request['documents']) * 3}), flush=True)",
    ].join("\n"),
  );
  const gardenRoot = path.join(dataRoot, "garden");
  write(path.join(gardenRoot, "aliasing.md"), "# Aliasing\n");
  const scopeId = "garden-signals";
  const request = operation === "probe"
    ? { protocolVersion: 1, operation: "probe" }
    : {
        protocolVersion: 1,
        operation: "index",
        root: gardenRoot,
        scopeId,
        kb: scopeId,
        fingerprint: "fixture-embedding@384",
      };
  const identity = {
    jobId: `job_deep_tutor_${operation}_${sequence}`,
    attempt: 1,
    workerInstanceId: `worker_deep_tutor_${operation}_${sequence}`,
  };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", identity.workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope: {
        userId: 43,
        gardenId: null,
        conversationId: operation === "probe"
          ? "deep-tutor-health"
          : deepTutorIndexConversationId(scopeId),
      },
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs: [],
      workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    })}\n`,
  );
  const homeRoot = path.join(dataRoot, "runtime-v2", "services", "deep-tutor", "home");
  return {
    dataRoot,
    appRoot,
    clone,
    python,
    script,
    gardenRoot,
    scopeId,
    identity,
    jobRoot,
    attemptRoot,
    homeRoot,
  };
}

async function runWorker(current, worker, { cancelAfterChildStarts = false } = {}) {
  const child = spawn(process.execPath, [worker, "start.json"], {
    cwd: current.attemptRoot,
    windowsHide: true,
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERPROFILE: process.env.USERPROFILE,
      DEEP_TUTOR_ROOT: current.clone,
      DEEP_TUTOR_PYTHON: current.python,
      DEEP_TUTOR_HOME_ROOT: current.homeRoot,
      DEEP_TUTOR_INDEX_SCRIPT: current.script,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let buffer = "";
  let cancellationStarted = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const event = line ? JSON.parse(line) : null;
      if (event?.type === "checkpoint" && cancelAfterChildStarts && !cancellationStarted) {
        cancellationStarted = true;
        const pidFile = path.join(
          current.homeRoot,
          "u43",
          current.scopeId,
          "indexer.pid",
        );
        const deadline = Date.now() + 10_000;
        const poll = setInterval(() => {
          if (fs.existsSync(pidFile)) {
            clearInterval(poll);
            child.stdin.end('{"type":"stop","force":false}\n');
          } else if (Date.now() >= deadline) {
            clearInterval(poll);
            child.stdin.end('{"type":"stop","force":false}\n');
          }
        }, 20);
        poll.unref?.();
      }
      newline = buffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-64 * 1024); });
  if (!cancelAfterChildStarts) child.stdin.end();
  const exit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("The fresh Deep Tutor worker did not exit."));
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

test("Deep Tutor maintenance requests and authenticated scopes are closed", () => {
  const probe = { protocolVersion: 1, operation: "probe" };
  assert.equal(validateDeepTutorProbeRequest(probe), probe);
  assert.throws(
    () => validateDeepTutorProbeRequest({ ...probe, command: "python" }),
    /probe request is invalid/u,
  );
  assert.deepEqual(
    validateDeepTutorProbeExecutionScope({
      userId: 4,
      gardenId: null,
      conversationId: "deep-tutor-health",
    }),
    { userId: 4, gardenId: null, conversationId: "deep-tutor-health" },
  );
  const index = {
    protocolVersion: 1,
    operation: "index",
    root: path.resolve(os.tmpdir()),
    scopeId: "garden-signals",
    kb: "garden-signals",
    fingerprint: "fixture@384",
  };
  assert.equal(validateDeepTutorIndexRequest(index), index);
  assert.throws(
    () => validateDeepTutorIndexRequest({ ...index, python: "anything.exe" }),
    /index request is invalid/u,
  );
  const conversationId = deepTutorIndexConversationId(index.scopeId);
  assert.match(conversationId, /^deep-tutor-index-[0-9a-f]{24}$/u);
  assert.deepEqual(
    validateDeepTutorIndexExecutionScope({
      userId: 4,
      gardenId: null,
      conversationId,
    }),
    { userId: 4, gardenId: null, conversationId },
  );
  assert.throws(
    () => validateDeepTutorIndexExecutionScope({
      userId: 4,
      gardenId: null,
      conversationId: "deep-tutor-index-forged",
    }),
    /index worker scope is invalid/u,
  );
});

test("a fresh probe worker returns a fenced import result and exits", async (t) => {
  const current = fixture(t, "probe");
  if (!current) return;
  const run = await runWorker(current, probeWorker);
  assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
  assert.deepEqual(run.events.map((event) => event.type), ["ready", "complete"]);
  assert.ok(run.events.every((event) =>
    JSON.stringify(event.identity) === JSON.stringify(current.identity)));
  const result = JSON.parse(fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"));
  assert.deepEqual(result.identity, current.identity);
  assert.equal(result.completionSequence, run.events.at(-1).sequence);
  assert.deepEqual(
    {
      packageInstalled: result.result.packageInstalled,
      mcpInstalled: result.result.mcpInstalled,
      timedOut: result.result.timedOut,
    },
    { packageInstalled: true, mcpInstalled: true, timedOut: false },
  );
});

test("a fresh index worker atomically publishes progress and a durable manifest", async (t) => {
  const current = fixture(t, "index");
  if (!current) return;
  const run = await runWorker(current, indexWorker);
  assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
  assert.deepEqual(run.events.map((event) => event.type), ["ready", "checkpoint", "complete"]);
  const checkpoint = JSON.parse(
    fs.readFileSync(path.join(current.jobRoot, "checkpoint.json"), "utf8"),
  );
  assert.deepEqual(checkpoint.identity, current.identity);
  assert.equal(checkpoint.snapshot.stage, "completed");
  assert.equal(checkpoint.snapshot.percent, 100);
  const result = JSON.parse(fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"));
  assert.equal(result.result.ok, true);
  assert.equal(result.result.documentCount, 1);
  assert.equal(result.result.chunkCount, 3);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(current.homeRoot, "u43", current.scopeId, "breadboard-index.json"),
    "utf8",
  ));
  assert.equal(manifest.kb, current.scopeId);
  assert.equal(manifest.fingerprint, "fixture-embedding@384");
  assert.equal(manifest.documents.length, 1);
  assert.equal(manifest.documents[0].path, path.join(current.gardenRoot, "aliasing.md"));
  assert.equal(
    fs.readdirSync(path.join(current.homeRoot, "u43", current.scopeId))
      .some((name) => name.includes(".pending-")),
    false,
  );
});

test("index cancellation is acknowledged and leaves no result or manifest", async (t) => {
  const current = fixture(t, "index", { slow: true });
  if (!current) return;
  const run = await runWorker(current, indexWorker, { cancelAfterChildStarts: true });
  assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
  assert.deepEqual(run.events.map((event) => event.type), [
    "ready",
    "checkpoint",
    "cancellation-acknowledged",
  ]);
  assert.equal(fs.existsSync(path.join(current.jobRoot, "result.json")), false);
  assert.equal(
    fs.existsSync(
      path.join(current.homeRoot, "u43", current.scopeId, "breadboard-index.json"),
    ),
    false,
  );
});

function snapshot(authority, state, overrides = {}) {
  return {
    jobId: "job_deep_tutor_client",
    jobType: "deep-tutor-index",
    workerKind: "deep-tutor-index-node",
    resourceClass: "large-generation",
    state,
    attempt: 1,
    workerInstanceId: "worker_deep_tutor_client",
    gardenId: authority.gardenId,
    conversationId: authority.conversationId,
    lastWorkerSequence: 3,
    ...overrides,
  };
}

test("the dashboard persists admission, reconciles success, and never submits an executable", async (t) => {
  const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deep-tutor-client-")));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const gardenRoot = path.join(dataRoot, "garden");
  write(path.join(gardenRoot, "lesson.md"), "# Lesson\n");
  const homeRoot = path.join(dataRoot, "runtime-v2", "services", "deep-tutor", "home");
  const previousHome = process.env.DEEP_TUTOR_HOME_ROOT;
  process.env.DEEP_TUTOR_HOME_ROOT = homeRoot;
  t.after(() => {
    if (previousHome === undefined) delete process.env.DEEP_TUTOR_HOME_ROOT;
    else process.env.DEEP_TUTOR_HOME_ROOT = previousHome;
  });
  const scope = {
    kind: "garden",
    id: "garden-client",
    label: "Client",
    roots: [gardenRoot],
    summary: "fixture",
  };
  const submissions = [];
  let terminal = false;
  let submittedAuthority;
  const control = {
    configured: () => true,
    async submit(authority, submission) {
      submittedAuthority = authority;
      submissions.push(submission);
      return snapshot(authority, "running");
    },
    async inspect(authority) {
      return snapshot(authority, terminal ? "succeeded" : "running");
    },
    async readOutput(authority, jobId, kind) {
      assert.equal(kind, "result");
      const documents = indexableDocuments(scope);
      const builtAt = new Date().toISOString();
      const home = path.join(homeRoot, "u79", scope.id);
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(path.join(home, "breadboard-index.json"), JSON.stringify({
        kb: scope.id,
        fingerprint: embeddingFingerprint(),
        builtAt,
        documents,
        documentCount: 1,
        chunkCount: 4,
      }));
      return {
        content: {
          protocolVersion: 1,
          identity: {
            jobId,
            attempt: 1,
            workerInstanceId: "worker_deep_tutor_client",
          },
          completionSequence: 3,
          result: {
            ok: true,
            kb: scope.id,
            fingerprint: embeddingFingerprint(),
            builtAt,
            candidateCount: 1,
            documentCount: 1,
            chunkCount: 4,
            durationMs: 100,
            error: "",
          },
        },
      };
    },
    async cancel(authority) {
      return snapshot(authority, "cancelled");
    },
  };
  const started = await rebuildDeepTutorIndex(79, scope, {
    env: { BREADBOARD_DATA_DIR: dataRoot },
    control,
    now: Date.now,
  });
  assert.equal(started.started, true);
  assert.equal(started.state.phase, "building");
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].jobType, "deep-tutor-index");
  assert.deepEqual(Object.keys(submissions[0].requestPayload).sort(), [
    "fingerprint",
    "kb",
    "operation",
    "protocolVersion",
    "root",
    "scopeId",
  ]);
  assert.equal("command" in submissions[0].requestPayload, false);
  assert.equal("python" in submissions[0].requestPayload, false);
  assert.match(submittedAuthority.conversationId, /^deep-tutor-index-[0-9a-f]{24}$/u);
  assert.equal(readIndexJobReceipt(79, scope)?.jobId, "job_deep_tutor_client");

  terminal = true;
  const ready = await refreshDeepTutorIndexJob(79, scope, {
    env: { BREADBOARD_DATA_DIR: dataRoot },
    control,
  });
  assert.equal(ready.phase, "ready");
  assert.equal(ready.chunkCount, 4);
  assert.equal(readIndexJobReceipt(79, scope), null);
});

test("cancelling a durable index receipt waits for Runtime and records the outcome", async (t) => {
  const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deep-tutor-cancel-")));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const gardenRoot = path.join(dataRoot, "garden");
  write(path.join(gardenRoot, "lesson.md"), "# Lesson\n");
  const previousHome = process.env.DEEP_TUTOR_HOME_ROOT;
  process.env.DEEP_TUTOR_HOME_ROOT = path.join(dataRoot, "homes");
  t.after(() => {
    if (previousHome === undefined) delete process.env.DEEP_TUTOR_HOME_ROOT;
    else process.env.DEEP_TUTOR_HOME_ROOT = previousHome;
  });
  const scope = {
    kind: "garden",
    id: "garden-cancel",
    label: "Cancel",
    roots: [gardenRoot],
    summary: "fixture",
  };
  const baseControl = {
    configured: () => true,
    async submit(authority) { return snapshot(authority, "running"); },
    async inspect(authority) { return snapshot(authority, "cancelled"); },
    async readOutput() { throw new Error("cancelled jobs have no result"); },
    async cancel(authority) { return snapshot(authority, "cancelled"); },
  };
  await rebuildDeepTutorIndex(80, scope, { control: baseControl });
  const cancelled = await cancelDeepTutorIndex(80, scope, { control: baseControl });
  assert.equal(cancelled.phase, "failed");
  assert.equal(cancelled.error, "Indexing was cancelled.");
  assert.equal(readIndexJobReceipt(80, scope)?.phase, "failed");
});

test("Next-owned Deep Tutor modules contain no subprocess fallback", () => {
  for (const relative of [
    ["src", "lib", "deep-tutor", "runtime.ts"],
    ["src", "lib", "deep-tutor", "knowledge-base.ts"],
  ]) {
    const source = fs.readFileSync(path.join(dashboardRoot, ...relative), "utf8");
    assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(/u);
  }
  const healthRoute = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "deep-tutor", "health", "route.ts"),
    "utf8",
  );
  const setupRoute = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "deep-tutor", "setup", "route.ts"),
    "utf8",
  );
  assert.match(healthRoute, /runDeepTutorProbeJob/u);
  assert.match(healthRoute, /deepTutorIndexStatus/u);
  assert.match(setupRoute, /rebuildDeepTutorIndex/u);
  assert.match(setupRoute, /cancelDeepTutorIndex/u);
  assert.match(healthRoute, /requireOwnGarden/u);
  assert.match(setupRoute, /requireOwnGarden/u);
});
