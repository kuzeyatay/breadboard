import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  executeSystemLocationOperation,
  parseSystemLocationWorkerOutput,
  validateSystemLocationExecutionScope,
  validateSystemLocationRequest,
} from "../scripts/runtime-v2-system-location-executor.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "system-location-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "system-location-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "system-location-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "system-location-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "system-location-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "system-location-stub" }, () => ({
          loader: "js",
          contents: `
            const unused = async () => { throw new Error("use the injected location control"); };
            export const cancelRuntimeJob = unused;
            export const inspectRuntimeJob = unused;
            export const readRuntimeJobOutput = unused;
            export const submitRuntimeJob = unused;
            export const isRuntimeV2ServiceControlConfigured = () => true;
          `,
        }));
      },
    }],
  });
  const source = Buffer.from(built.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}#system-location-runtime-v2`);
}

const client = await loadClient();

function launch() {
  return {
    executionScope: { userId: 17, gardenId: null, conversationId: null },
    request: { protocolVersion: 1, operation: "read-device-location" },
  };
}

function runtimeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-location-worker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(
    root,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "fixed test executable");
  return {
    executable,
    environment: {
      SystemRoot: root,
      TEMP: root,
      TMP: root,
      PATH: "must-not-cross-the-worker-boundary",
      OPENAI_API_KEY: "must-not-cross-the-worker-boundary",
      BREADBOARD_RUNTIME_V2_FIXED_TOOLS: "1",
      BREADBOARD_WINDOWS_POWERSHELL_BIN: executable,
    },
  };
}

function snapshot(overrides = {}) {
  return {
    jobId: "job_location_1",
    jobType: "system-location",
    workerKind: "system-location-node",
    resourceClass: "core",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_location_1",
    gardenId: null,
    conversationId: null,
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
    finishedAt: 3,
    lastHeartbeatAt: 2,
    lastWorkerSequence: 4,
    progressCurrent: 1,
    progressTotal: 1,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: false,
    ...overrides,
  };
}

function envelope(job, result, identity = {}) {
  return {
    protocolVersion: 1,
    identity: {
      jobId: job.jobId,
      attempt: job.attempt,
      workerInstanceId: job.workerInstanceId,
      ...identity,
    },
    completionSequence: job.lastWorkerSequence,
    result,
  };
}

test("the location worker accepts only its closed request and user-global scope", () => {
  const request = { protocolVersion: 1, operation: "read-device-location" };
  const scope = { userId: 17, gardenId: null, conversationId: null };
  assert.equal(validateSystemLocationRequest(request), request);
  assert.equal(validateSystemLocationExecutionScope(scope), scope);
  assert.throws(
    () => validateSystemLocationRequest({ ...request, executable: "powershell.exe" }),
    /canonical system-location request/u,
  );
  assert.throws(
    () => validateSystemLocationExecutionScope({ ...scope, conversationId: "forged" }),
    /user-global scope/u,
  );
});

test("the worker keeps unsupported platforms process-free", async () => {
  let launches = 0;
  const result = await executeSystemLocationOperation(
    launch(),
    new AbortController().signal,
    {
      platform: "darwin",
      execFileImpl() { launches += 1; },
      environment: {},
    },
  );
  assert.equal(result.state, "unsupported");
  assert.equal(launches, 0);
});

test("the worker launches only Runtime-minted Windows PowerShell with a closed environment", async (t) => {
  const fixture = runtimeFixture(t);
  let invocation;
  const result = await executeSystemLocationOperation(
    launch(),
    new AbortController().signal,
    {
      platform: "win32",
      environment: fixture.environment,
      execFileImpl(executable, args, options, callback) {
        invocation = { executable, args, options };
        callback(null, '{"state":"available","latitude":40.94,"longitude":29.11,"accuracyMeters":102}', "");
      },
    },
  );
  assert.deepEqual(result, {
    state: "available",
    latitude: 40.94,
    longitude: 29.11,
    accuracyMeters: 102,
  });
  assert.equal(invocation.executable, fs.realpathSync.native(fixture.executable));
  assert.deepEqual(invocation.args.slice(0, 4), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
  ]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.signal instanceof AbortSignal, true);
  assert.equal(invocation.options.env.PATH, undefined);
  assert.equal(invocation.options.env.OPENAI_API_KEY, undefined);
  assert.equal(invocation.options.env.BREADBOARD_WINDOWS_POWERSHELL_BIN, undefined);
});

test("malformed and unbounded sensor output remains an ordinary unavailable answer", () => {
  for (const output of ["", "noise", "{not-json", '{"state":"available","latitude":91,"longitude":0}']) {
    assert.equal(parseSystemLocationWorkerOutput(output).state, "unavailable");
  }
});

test("the authenticated client submits one fenced disposable job and no executable", async () => {
  const job = snapshot();
  const calls = { submissions: [], outputs: [], cancellations: [] };
  const control = {
    async submit(authority, submission) {
      calls.submissions.push({ authority, submission });
      return job;
    },
    async inspect() { throw new Error("terminal fixture must not poll"); },
    async readOutput(authority, jobId, kind) {
      calls.outputs.push({ authority, jobId, kind });
      return {
        jobId,
        kind,
        content: envelope(job, {
          state: "available",
          latitude: 40.94,
          longitude: 29.11,
          accuracyMeters: 102,
        }),
      };
    },
    async cancel(authority, jobId) {
      calls.cancellations.push({ authority, jobId });
      return snapshot({ state: "cancelled" });
    },
  };
  const result = await client.readSystemLocationViaRuntime({
    userId: 17,
    platform: "win32",
    control,
  });
  assert.equal(result.state, "available");
  assert.deepEqual(calls.submissions[0].authority, {
    userId: 17,
    gardenId: null,
    conversationId: null,
  });
  const submission = calls.submissions[0].submission;
  assert.equal(submission.jobType, "system-location");
  assert.match(submission.idempotencyKey, /^system-location-v2:/u);
  assert.deepEqual(submission.requestPayload, {
    protocolVersion: 1,
    operation: "read-device-location",
  });
  assert.doesNotMatch(JSON.stringify(submission), /executable|argv|PowerShell|CONTROL_TOKEN/u);
  assert.deepEqual(calls.outputs.map(({ kind }) => kind), ["result"]);
  assert.deepEqual(calls.cancellations, []);
});

test("forged Runtime identity is rejected instead of becoming a location fix", async () => {
  const job = snapshot();
  const control = {
    async submit() { return job; },
    async inspect() { throw new Error("terminal fixture must not poll"); },
    async readOutput(authority, jobId, kind) {
      return {
        jobId,
        kind,
        content: envelope(job, {
          state: "available",
          latitude: 40.94,
          longitude: 29.11,
          accuracyMeters: 102,
        }, { workerInstanceId: "forged_worker" }),
      };
    },
    async cancel() { return snapshot({ state: "cancelled" }); },
  };
  const result = await client.readSystemLocationViaRuntime({
    userId: 17,
    platform: "win32",
    control,
  });
  assert.equal(result.state, "unavailable");
});

test("the route and compatibility layer own no process launcher", () => {
  const route = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "profile", "device-location", "route.ts"),
    "utf8",
  );
  const parser = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "system-location.ts"), "utf8");
  const runtimeClient = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "runtime-v2", "system-location-job.ts"),
    "utf8",
  );
  for (const source of [route, parser, runtimeClient]) {
    assert.doesNotMatch(source, /node:child_process|execFile\s*\(|spawn\s*\(/u);
  }
  assert.match(route, /readSystemLocationViaRuntime/u);
  assert.match(runtimeClient, /cancelRuntimeJob/u);
});
