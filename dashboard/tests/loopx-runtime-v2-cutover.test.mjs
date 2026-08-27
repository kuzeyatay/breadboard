import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  validateRuntimeV2LoopxEnvironment,
  validateRuntimeV2LoopxRequest,
  validateRuntimeV2LoopxScope,
} from "../scripts/runtime-v2-loopx-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const request = Object.freeze({
  protocolVersion: 1,
  operation: "tick",
  conversationPublicId: "conv_demo",
  turnSequence: 4,
  objective: "Finish the migration",
  outcome: "completed",
  toolCalls: 2,
  producedArtifact: false,
});

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "loopx-tick-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "loopx-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "loopx-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "loopx-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "loopx-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "loopx-stub" }, () => ({
          loader: "js",
          contents: `
            const unused = async () => { throw new Error("use the injected LoopX control"); };
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
  return import(`data:text/javascript;base64,${source}#loopx-runtime-v2`);
}

const runtime = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_loopx_1",
    jobType: "loopx-tick",
    workerKind: "loopx-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_loopx_1",
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

function success() {
  return {
    ok: true,
    operation: "tick",
    conversationPublicId: request.conversationPublicId,
    turnSequence: request.turnSequence,
    created: true,
    goalId: "bb-conv-demo",
    durationMs: 2_500,
  };
}

const scope = Object.freeze({
  userId: 17,
  gardenId: "garden_demo",
  conversationId: "conv_demo",
});

test("LoopX worker accepts only a canonical tick, authenticated scope, and sealed roots", () => {
  assert.equal(validateRuntimeV2LoopxRequest(request), request);
  assert.equal(validateRuntimeV2LoopxScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2LoopxEnvironment({
    BREADBOARD_LOOPX_ROOT: path.resolve("loopx"),
    BREADBOARD_LOOPX_PYTHON: path.resolve("runtimes", "python", "python.exe"),
    BREADBOARD_LOOPX_HOME: path.resolve("state", "loopx-goals"),
    ENABLE_LOOPX: "1",
  }));
  assert.throws(
    () => validateRuntimeV2LoopxRequest({ ...request, executable: "python.exe" }),
    /canonical LoopX Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2LoopxRequest({ ...request, objective: "bad\nobjective" }),
    /canonical LoopX Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2LoopxScope({ ...scope, conversationId: null }),
    /authenticated conversation scope/u,
  );
  assert.throws(
    () => validateRuntimeV2LoopxEnvironment({
      BREADBOARD_LOOPX_ROOT: "relative",
      BREADBOARD_LOOPX_PYTHON: "python",
      BREADBOARD_LOOPX_HOME: "relative",
    }),
    /sealed LoopX runtime paths/u,
  );
});

test("the client submits one scoped durable tick and accepts a fenced result", async () => {
  const job = snapshot();
  const state = calls();
  const answer = await runtime.runLoopxTickViaRuntime({
    scope,
    request,
    control: control(job, success(), state),
  });
  assert.deepEqual(answer, {
    conversationPublicId: "conv_demo",
    turnSequence: 4,
    created: true,
    goalId: "bb-conv-demo",
    durationMs: 2_500,
  });
  assert.deepEqual(state.submissions[0].authority, scope);
  const submission = state.submissions[0].submission;
  assert.equal(submission.jobType, "loopx-tick");
  assert.deepEqual(submission.requestPayload, request);
  assert.deepEqual(submission.inputUploads, undefined);
  assert.match(submission.idempotencyKey, /^loopx-v2:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(submission), /executable|argv|environment|LOOPX_ROOT|LOOPX_HOME/u);
});

test("the same completed turn has one deterministic idempotency identity", async () => {
  const job = snapshot();
  const first = calls();
  const second = calls();
  await runtime.runLoopxTickViaRuntime({ scope, request, control: control(job, success(), first) });
  await runtime.runLoopxTickViaRuntime({ scope, request, control: control(job, success(), second) });
  assert.equal(
    first.submissions[0].submission.idempotencyKey,
    second.submissions[0].submission.idempotencyKey,
  );
});

test("domain errors, conversation mismatch, and forged fences never become LoopX ticks", async () => {
  const job = snapshot();
  const failed = {
    ok: false,
    operation: "tick",
    errorCode: "loopx_runtime_unavailable",
    message: "LoopX is unavailable.",
  };
  await assert.rejects(
    runtime.runLoopxTickViaRuntime({ scope, request, control: control(job, failed, calls()) }),
    (error) => error.code === "loopx_runtime_unavailable" && error.status === 503,
  );
  await assert.rejects(
    runtime.runLoopxTickViaRuntime({
      scope,
      request,
      control: control(job, failed, calls(), { workerInstanceId: "worker_forged" }),
    }),
    /outside its worker fence/u,
  );
  await assert.rejects(
    runtime.runLoopxTickViaRuntime({
      scope,
      request: { ...request, conversationPublicId: "conv_other" },
      control: control(job, failed, calls()),
    }),
    /conversation scope/u,
  );
});

test("aborting a running LoopX tick forwards cancellation exactly once", async () => {
  const running = snapshot({ state: "running", finishedAt: null, lastWorkerSequence: 2 });
  const state = calls();
  const abort = new AbortController();
  const current = control(running, {}, state);
  current.inspect = async () => structuredClone(running);
  const promise = runtime.runLoopxTickViaRuntime({
    scope,
    request,
    signal: abort.signal,
    control: current,
  });
  queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
  await assert.rejects(promise, /Stopped/u);
  assert.equal(state.cancellations.length, 1);
  assert.equal(state.cancellations[0].jobId, running.jobId);
});

test("the dashboard tick imports no LoopX process implementation", () => {
  const tick = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "loopx", "tick.ts"), "utf8");
  assert.match(tick, /runLoopxTickViaRuntime/u);
  assert.doesNotMatch(
    tick,
    /from "\.\/runtime\.ts"|node:child_process|spawn\(|runLoopx\(/u,
  );
  const conversation = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "loopx", "conversation-tick.ts"),
    "utf8",
  );
  assert.match(conversation, /getRuntimeSessionById/u);
  assert.match(conversation, /userId: conversation\.user_id/u);
  assert.match(conversation, /gardenId: runtimeSession\.garden_id/u);
});
