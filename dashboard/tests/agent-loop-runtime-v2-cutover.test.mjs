import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  validateRuntimeV2AgentLoopEnvironment,
  validateRuntimeV2AgentLoopRequest,
  validateRuntimeV2AgentLoopScope,
} from "../scripts/runtime-v2-agent-loop-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "agent-loop-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "agent-loop-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "agent-loop-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "agent-loop-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "agent-loop-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "agent-loop-stub" }, () => ({
          loader: "js",
          contents: `
            const unused = async () => { throw new Error("use the injected Agent Loop control"); };
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
  return import(`data:text/javascript;base64,${source}#agent-loop-runtime-v2`);
}

const runtime = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_agent_loop_1",
    jobType: "agent-loop-command",
    workerKind: "agent-loop-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_agent_loop_1",
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
    command: arguments_[0],
    exitCode: 0,
    durationMs: 42,
    stdout: '{"ok":true}',
    stderr: "",
    truncated: false,
  };
}

test("Agent Loop worker accepts only a sealed command, scope, and installed runtime", () => {
  const request = {
    protocolVersion: 1,
    operation: "command",
    workspaceKey: "user-17/conversation-demo",
    arguments: ["validate", "--json", "loop.yaml"],
  };
  const scope = { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" };
  assert.equal(validateRuntimeV2AgentLoopRequest(request), request);
  assert.equal(validateRuntimeV2AgentLoopScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2AgentLoopEnvironment({
    BREADBOARD_AGENT_LOOP_ROOT: path.resolve("agent-loop-runtime", "source"),
    BREADBOARD_AGENT_LOOP_PYTHON: path.resolve("agent-loop-runtime", "python", "python.exe"),
    BREADBOARD_AGENT_LOOP_SITE_PACKAGES: path.resolve("agent-loop-runtime", "site-packages"),
    HERMES_ROOT: path.resolve("hermes"),
  }));
  assert.throws(
    () => validateRuntimeV2AgentLoopRequest({ ...request, executable: "python.exe" }),
    /canonical Agent Loop Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2AgentLoopRequest({ ...request, workspaceKey: "../escape" }),
    /canonical Agent Loop Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2AgentLoopScope({ ...scope, conversationId: null }),
    /authenticated conversation scope/u,
  );
  assert.throws(
    () => validateRuntimeV2AgentLoopEnvironment({
      BREADBOARD_AGENT_LOOP_ROOT: "relative",
      BREADBOARD_AGENT_LOOP_PYTHON: "python",
      HERMES_ROOT: "relative",
    }),
    /sealed Agent Loop runtime paths/u,
  );
});

test("the client submits a conversation-local command and accepts one fenced result", async () => {
  const arguments_ = ["validate", "--json", "loop.yaml"];
  const job = snapshot();
  const state = calls();
  const answer = await runtime.runAgentLoopViaRuntime({
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: arguments_,
    control: control(job, success(arguments_), state),
  });
  assert.deepEqual(answer, {
    arguments: arguments_,
    command: "validate",
    exitCode: 0,
    durationMs: 42,
    stdout: '{"ok":true}',
    stderr: "",
    truncated: false,
  });
  assert.deepEqual(state.submissions[0].authority, {
    userId: 17,
    gardenId: "garden_demo",
    conversationId: "conv_demo",
  });
  const submission = state.submissions[0].submission;
  assert.equal(submission.jobType, "agent-loop-command");
  assert.deepEqual(submission.inputUploads, undefined);
  assert.deepEqual(submission.requestPayload, {
    protocolVersion: 1,
    operation: "command",
    workspaceKey: "user-17/conversation-demo",
    arguments: arguments_,
  });
  assert.match(submission.idempotencyKey, /^agent-loop-v2:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(submission), /executable|argv|environment|HERMES_ROOT|AGENT_LOOP_PYTHON/u);
});

test("write-capable Agent Loop commands receive distinct submission identities", async () => {
  const arguments_ = ["init", "loop"];
  const job = snapshot();
  const first = calls();
  const second = calls();
  const input = {
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: arguments_,
  };
  await runtime.runAgentLoopViaRuntime({ ...input, control: control(job, success(arguments_), first) });
  await runtime.runAgentLoopViaRuntime({ ...input, control: control(job, success(arguments_), second) });
  assert.notEqual(
    first.submissions[0].submission.idempotencyKey,
    second.submissions[0].submission.idempotencyKey,
  );
});

test("denied paths, domain failures, and forged fences never become kit output", async () => {
  const job = snapshot();
  const base = {
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: ["privacy-scan"],
  };
  const failed = {
    ok: false,
    operation: "command",
    errorCode: "agent_loop_runtime_unavailable",
    message: "The loop kit is unavailable.",
  };
  await assert.rejects(
    runtime.runAgentLoopViaRuntime({ ...base, control: control(job, failed, calls()) }),
    (error) => error.code === "agent_loop_runtime_unavailable" && error.status === 503,
  );
  await assert.rejects(
    runtime.runAgentLoopViaRuntime({
      ...base,
      control: control(job, failed, calls(), { workerInstanceId: "worker_forged" }),
    }),
    /outside its worker fence/u,
  );
  await assert.rejects(
    runtime.runAgentLoopViaRuntime({ ...base, arguments: ["validate", "../escape"] }),
    (error) => error.code === "agent_loop_path_denied",
  );
});

test("aborting a running Agent Loop command forwards cancellation exactly once", async () => {
  const running = snapshot({ state: "running", finishedAt: null, lastWorkerSequence: 2 });
  const state = calls();
  const abort = new AbortController();
  const current = control(running, {}, state);
  current.inspect = async () => structuredClone(running);
  const promise = runtime.runAgentLoopViaRuntime({
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    workspaceKey: "user-17/conversation-demo",
    arguments: ["privacy-scan"],
    signal: abort.signal,
    control: current,
  });
  queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
  await assert.rejects(promise, /Stopped/u);
  assert.equal(state.cancellations.length, 1);
  assert.equal(state.cancellations[0].jobId, running.jobId);
});

test("the public Agent Loop route contains no direct process or workspace execution", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "hermes", "tools", "agent-loop", "route.ts"),
    "utf8",
  );
  assert.match(source, /runAgentLoopViaRuntime/u);
  assert.doesNotMatch(
    source,
    /agent-loop-service|node:child_process|spawn\(|execFile\(|runAgentLoopKit\(|directoryForWorkspaceKey/u,
  );
});
