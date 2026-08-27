import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  validateRuntimeV2OmhEnvironment,
  validateRuntimeV2OmhRequest,
  validateRuntimeV2OmhScope,
} from "../scripts/runtime-v2-omh-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "omh-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "omh-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "omh-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "omh-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "omh-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "omh-stub" }, () => ({
          loader: "js",
          contents: `
            const unused = async () => { throw new Error("use the injected OMH control"); };
            export const cancelRuntimeJob = unused;
            export const inspectRuntimeJob = unused;
            export const readRuntimeJobOutput = unused;
            export const submitRuntimeJob = unused;
          `,
        }));
      },
    }],
  });
  const source = Buffer.from(built.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}#omh-runtime-v2`);
}

const runtime = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_omh_1",
    jobType: "omh-command",
    workerKind: "omh-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_omh_1",
    gardenId: "garden_demo",
    conversationId: "conv_demo",
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
    finishedAt: 3,
    lastHeartbeatAt: 2,
    lastWorkerSequence: 4,
    progressCurrent: 100,
    progressTotal: 100,
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

function calls() {
  return { submissions: [], cancellations: [] };
}

function control(job, result, state, identity = {}) {
  return {
    async submit(authority, submission) {
      state.submissions.push({
        authority: structuredClone(authority),
        submission: structuredClone(submission),
      });
      return structuredClone(job);
    },
    async inspect() {
      throw new Error("terminal fixture must not poll");
    },
    async readOutput(authority, jobId, kind) {
      return { jobId, kind, content: envelope(job, result, identity) };
    },
    async cancel(authority, jobId) {
      state.cancellations.push({ authority: structuredClone(authority), jobId });
      return { ...job, state: "cancelled" };
    },
  };
}

function success(arguments_) {
  return {
    ok: true,
    operation: "command",
    arguments: arguments_,
    exitCode: 0,
    durationMs: 18,
    output: '{"route":"coding"}',
    payload: { route: "coding" },
  };
}

test("OMH worker accepts only the sealed read-only command, scope, and paths", () => {
  const request = {
    protocolVersion: 1,
    operation: "command",
    workspaceKey: "user-17/conversation-demo",
    arguments: ["recommend", "--json"],
  };
  const scope = { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" };
  assert.equal(validateRuntimeV2OmhRequest(request), request);
  assert.equal(validateRuntimeV2OmhScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2OmhEnvironment({
    BREADBOARD_OMH_ROOT: path.resolve("oh-my-hermes"),
    BREADBOARD_OMH_PYTHON: path.resolve("runtimes", "python", "python.exe"),
    HERMES_ROOT: path.resolve("hermes"),
  }));
  assert.throws(
    () => validateRuntimeV2OmhRequest({ ...request, executable: "python.exe" }),
    /canonical OMH Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2OmhRequest({ ...request, workspaceKey: "../escape" }),
    /canonical OMH Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2OmhScope({ ...scope, conversationId: null }),
    /authenticated conversation scope/u,
  );
  assert.throws(
    () => validateRuntimeV2OmhEnvironment({
      BREADBOARD_OMH_ROOT: "relative",
      BREADBOARD_OMH_PYTHON: "python",
      HERMES_ROOT: "relative",
    }),
    /sealed OMH runtime paths/u,
  );
});

test("the client submits a bounded conversation-scoped command and accepts a fenced result", async () => {
  const arguments_ = ["recommend", "--json"];
  const job = snapshot();
  const state = calls();
  const answer = await runtime.runOmhViaRuntime({
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: arguments_,
    control: control(job, success(arguments_), state),
  });
  assert.deepEqual(answer, {
    arguments: arguments_,
    exitCode: 0,
    durationMs: 18,
    output: '{"route":"coding"}',
    payload: { route: "coding" },
  });
  assert.deepEqual(state.submissions[0].authority, {
    userId: 17,
    gardenId: "garden_demo",
    conversationId: "conv_demo",
  });
  const submission = state.submissions[0].submission;
  assert.equal(submission.jobType, "omh-command");
  assert.deepEqual(submission.inputUploads, undefined);
  assert.deepEqual(submission.requestPayload, {
    protocolVersion: 1,
    operation: "command",
    workspaceKey: "user-17/conversation-demo",
    arguments: arguments_,
  });
  assert.match(submission.idempotencyKey, /^omh-v2:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(submission), /executable|argv|environment|HERMES_ROOT|OMH_PYTHON/u);
});

test("denied commands, domain errors, and forged fences never become OMH output", async () => {
  const job = snapshot();
  const base = {
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: ["doctor"],
  };
  const failed = {
    ok: false,
    operation: "command",
    errorCode: "omh_runtime_unavailable",
    message: "OMH is unavailable.",
  };
  await assert.rejects(
    runtime.runOmhViaRuntime({ ...base, control: control(job, failed, calls()) }),
    (error) => error.code === "omh_runtime_unavailable" && error.status === 503,
  );
  await assert.rejects(
    runtime.runOmhViaRuntime({
      ...base,
      control: control(job, failed, calls(), { workerInstanceId: "worker_forged" }),
    }),
    /outside its worker fence/u,
  );
  await assert.rejects(
    runtime.runOmhViaRuntime({ ...base, arguments: ["setup"] }),
    (error) => error.code === "omh_command_denied",
  );
});

test("aborting a running OMH command forwards cancellation exactly once", async () => {
  const running = snapshot({ state: "running", finishedAt: null, lastWorkerSequence: 2 });
  const state = calls();
  const abort = new AbortController();
  const current = control(running, {}, state);
  current.inspect = async () => structuredClone(running);
  const promise = runtime.runOmhViaRuntime({
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: ["doctor"],
    signal: abort.signal,
    control: current,
  });
  queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
  await assert.rejects(promise, /Stopped/u);
  assert.equal(state.cancellations.length, 1);
  assert.equal(state.cancellations[0].jobId, running.jobId);
});

test("the public OMH route contains no direct process or workspace execution", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "hermes", "tools", "omh", "route.ts"),
    "utf8",
  );
  assert.match(source, /runOmhViaRuntime/u);
  assert.doesNotMatch(
    source,
    /omh-service|node:child_process|spawn\(|execFile\(|runOmh\(|directoryForWorkspaceKey/u,
  );
});
