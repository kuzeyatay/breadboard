import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  validateRuntimeV2PremortemEnvironment,
  validateRuntimeV2PremortemRequest,
  validateRuntimeV2PremortemScope,
} from "../scripts/runtime-v2-premortem-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "premortem-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "premortem-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "premortem-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "premortem-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "premortem-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "premortem-stub" }, () => ({
          loader: "js",
          contents: `
            const unused = async () => { throw new Error("use the injected Premortem control"); };
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
  return import(`data:text/javascript;base64,${source}#premortem-runtime-v2`);
}

const runtime = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_premortem_1",
    jobType: "premortem-command",
    workerKind: "premortem-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_premortem_1",
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
    durationMs: 31,
    envelope: {
      schema_version: "1",
      command: arguments_.join(" "),
      data: { status: "ready" },
    },
  };
}

test("Premortem worker accepts only the sealed command, scope, and installed paths", () => {
  const request = {
    protocolVersion: 1,
    operation: "command",
    workspaceKey: "user-17/conversation-demo",
    arguments: ["workflow", "validate"],
  };
  const scope = { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" };
  assert.equal(validateRuntimeV2PremortemRequest(request), request);
  assert.equal(validateRuntimeV2PremortemScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2PremortemEnvironment({
    BREADBOARD_PREMORTEM_ROOT: path.resolve("premortem-runtime"),
    BREADBOARD_PREMORTEM_PYTHON: path.resolve("runtimes", "python", "python.exe"),
    BREADBOARD_PREMORTEM_SITE_PACKAGES: path.resolve("premortem-runtime", "site-packages"),
    HERMES_ROOT: path.resolve("hermes"),
  }));
  assert.throws(
    () => validateRuntimeV2PremortemRequest({ ...request, executable: "python.exe" }),
    /canonical Premortem Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2PremortemRequest({ ...request, workspaceKey: "../escape" }),
    /canonical Premortem Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2PremortemScope({ ...scope, conversationId: null }),
    /authenticated conversation scope/u,
  );
  assert.throws(
    () => validateRuntimeV2PremortemEnvironment({
      BREADBOARD_PREMORTEM_ROOT: "relative",
      BREADBOARD_PREMORTEM_PYTHON: "python",
      HERMES_ROOT: "relative",
    }),
    /sealed Premortem runtime paths/u,
  );
});

test("the client submits a bounded conversation-scoped command and accepts a fenced result", async () => {
  const job = snapshot();
  const state = calls();
  const arguments_ = ["workflow", "validate"];
  const answer = await runtime.runPremortemViaRuntime({
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: arguments_,
    control: control(job, success(arguments_), state),
  });
  assert.deepEqual(answer, {
    arguments: arguments_,
    exitCode: 0,
    durationMs: 31,
    envelope: {
      schema_version: "1",
      command: "workflow validate",
      data: { status: "ready" },
    },
  });
  assert.deepEqual(state.submissions[0].authority, {
    userId: 17,
    gardenId: "garden_demo",
    conversationId: "conv_demo",
  });
  const submission = state.submissions[0].submission;
  assert.equal(submission.jobType, "premortem-command");
  assert.deepEqual(submission.inputUploads, undefined);
  assert.deepEqual(submission.requestPayload, {
    protocolVersion: 1,
    operation: "command",
    workspaceKey: "user-17/conversation-demo",
    arguments: arguments_,
  });
  assert.match(submission.idempotencyKey, /^premortem-v2:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(submission), /executable|argv|environment|HERMES_ROOT|PREMORTEM_PYTHON/u);
});

test("mutating Premortem commands receive distinct submission identities", async () => {
  const arguments_ = ["workflow", "validate"];
  const job = snapshot();
  const first = calls();
  const second = calls();
  const input = {
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: arguments_,
  };
  await runtime.runPremortemViaRuntime({ ...input, control: control(job, success(arguments_), first) });
  await runtime.runPremortemViaRuntime({ ...input, control: control(job, success(arguments_), second) });
  assert.notEqual(
    first.submissions[0].submission.idempotencyKey,
    second.submissions[0].submission.idempotencyKey,
  );
});

test("domain errors and forged completion fences never become Premortem results", async () => {
  const job = snapshot();
  const base = {
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: ["status"],
  };
  const failed = {
    ok: false,
    operation: "command",
    errorCode: "premortem_runtime_unavailable",
    message: "Premortem is unavailable.",
  };
  await assert.rejects(
    runtime.runPremortemViaRuntime({ ...base, control: control(job, failed, calls()) }),
    (error) => error.code === "premortem_runtime_unavailable" && error.status === 503,
  );
  await assert.rejects(
    runtime.runPremortemViaRuntime({
      ...base,
      control: control(job, failed, calls(), { workerInstanceId: "worker_forged" }),
    }),
    /outside its worker fence/u,
  );
  await assert.rejects(
    runtime.runPremortemViaRuntime({ ...base, arguments: ["init", "--force"], control: control(job, failed, calls()) }),
    (error) => error.code === "premortem_flag_denied",
  );
});

test("aborting a running Premortem command forwards cancellation exactly once", async () => {
  const running = snapshot({ state: "running", finishedAt: null, lastWorkerSequence: 2 });
  const state = calls();
  const abort = new AbortController();
  const current = control(running, {}, state);
  current.inspect = async () => structuredClone(running);
  const promise = runtime.runPremortemViaRuntime({
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: ["status"],
    signal: abort.signal,
    control: current,
  });
  queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
  await assert.rejects(promise, /Stopped/u);
  assert.equal(state.cancellations.length, 1);
  assert.equal(state.cancellations[0].jobId, running.jobId);
});

test("the public Premortem route contains no direct process or workspace execution", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "hermes", "tools", "premortem", "route.ts"),
    "utf8",
  );
  assert.match(source, /runPremortemViaRuntime/u);
  assert.doesNotMatch(
    source,
    /premortem-service|node:child_process|spawn\(|execFile\(|runPremortem\(|directoryForWorkspaceKey/u,
  );
});
