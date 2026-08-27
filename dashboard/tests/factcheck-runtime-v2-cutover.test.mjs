import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  validateRuntimeV2FactcheckEnvironment,
  validateRuntimeV2FactcheckRequest,
  validateRuntimeV2FactcheckScope,
} from "../scripts/runtime-v2-factcheck-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(root) {
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (/\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(candidate);
    }
  }
  return files;
}

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "factcheck-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "factcheck-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "factcheck-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "factcheck-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "factcheck-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "factcheck-stub" }, () => ({
          loader: "js",
          contents: `
            export class RuntimeJobControlError extends Error {
              constructor(input) {
                super(input.message);
                Object.assign(this, input);
              }
            }
            const unused = async () => { throw new Error("use the injected Factcheck control"); };
            export const cancelRuntimeJob = unused;
            export const cancelRuntimeJobByIdempotencyKey = unused;
            export const inspectRuntimeJob = unused;
            export const readRuntimeJobOutput = unused;
            export const submitRuntimeJob = unused;
          `,
        }));
      },
    }],
  });
  const source = Buffer.from(built.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}#factcheck-runtime-v2`);
}

const runtime = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_factcheck_1",
    jobType: "factcheck-command",
    workerKind: "factcheck-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_factcheck_1",
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

function envelope(job, result, identity = {}, completionSequence = job.lastWorkerSequence) {
  return {
    protocolVersion: 1,
    identity: {
      jobId: job.jobId,
      attempt: job.attempt,
      workerInstanceId: job.workerInstanceId,
      ...identity,
    },
    completionSequence,
    result,
  };
}

function calls() {
  return { submissions: [], cancellations: [], idempotencyCancellations: [] };
}

function control(job, result, state, options = {}) {
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
      return {
        jobId,
        kind,
        content: envelope(
          job,
          result,
          options.identity,
          options.completionSequence ?? job.lastWorkerSequence,
        ),
      };
    },
    async cancel(authority, jobId) {
      state.cancellations.push({ authority: structuredClone(authority), jobId });
      return { ...job, state: "cancelled" };
    },
    async cancelByIdempotencyKey(authority, idempotencyKey) {
      state.idempotencyCancellations.push({
        authority: structuredClone(authority),
        idempotencyKey,
      });
      return { jobId: null, state: "pending", accepted: true };
    },
  };
}

function success(overrides = {}) {
  return {
    ok: true,
    operation: "command",
    command: "fetch",
    arguments: ["https://example.com/article"],
    exitCode: 0,
    durationMs: 31,
    outputPath: "factcheck/fetch-example-com-article-1234abcd.md",
    outputBytes: 19,
    preview: "verified article\n",
    truncated: false,
    stderr: "",
    ...overrides,
  };
}

const scope = {
  userId: 17,
  gardenId: "garden_demo",
  conversationId: "conv_demo",
};

test("Factcheck worker accepts only the sealed command, scope, and installed paths", () => {
  const request = {
    protocolVersion: 1,
    operation: "command",
    workspaceKey: "conversations/conv-demo/session-1",
    arguments: ["fetch", "https://example.com/article"],
  };
  assert.equal(validateRuntimeV2FactcheckRequest(request), request);
  assert.equal(validateRuntimeV2FactcheckScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2FactcheckEnvironment({
    BREADBOARD_BULLSHIT_DETECTOR_ROOT: path.resolve("bullshit-detector"),
    BREADBOARD_FACTCHECK_UV: path.resolve("runtimes", "uv", "uv.exe"),
    BREADBOARD_FACTCHECK_PYTHON: path.resolve("runtimes", "python", "python.exe"),
    HERMES_ROOT: path.resolve("hermes-workspaces"),
    UV_CACHE_DIR: path.resolve("runtime-v2", "toolchains", "cache", "uv"),
  }));
  assert.throws(
    () => validateRuntimeV2FactcheckRequest({ ...request, executable: "python.exe" }),
    /canonical Factcheck Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2FactcheckRequest({ ...request, workspaceKey: "../escape" }),
    /canonical Factcheck Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2FactcheckScope({ ...scope, conversationId: null }),
    /authenticated conversation scope/u,
  );
  assert.throws(
    () => validateRuntimeV2FactcheckEnvironment({
      BREADBOARD_BULLSHIT_DETECTOR_ROOT: "relative",
      BREADBOARD_FACTCHECK_UV: "uv",
      BREADBOARD_FACTCHECK_PYTHON: "python",
      HERMES_ROOT: "relative",
    }),
    /sealed Factcheck runtime paths/u,
  );
});

test("the client submits a fresh bounded conversation-scoped command and preserves the result", async () => {
  const job = snapshot();
  const state = calls();
  const args = ["fetch", "https://example.com/article"];
  const answer = await runtime.runFactcheckViaRuntime({
    scope,
    workspaceKey: "conversations/conv-demo/session-1",
    arguments: args,
    control: control(job, success(), state),
  });
  assert.deepEqual(answer, {
    command: "fetch",
    arguments: ["https://example.com/article"],
    exitCode: 0,
    durationMs: 31,
    outputPath: "factcheck/fetch-example-com-article-1234abcd.md",
    outputBytes: 19,
    preview: "verified article\n",
    truncated: false,
    stderr: "",
  });
  assert.deepEqual(state.submissions[0].authority, scope);
  const submission = state.submissions[0].submission;
  assert.equal(submission.jobType, "factcheck-command");
  assert.deepEqual(submission.inputUploads, undefined);
  assert.deepEqual(submission.requestPayload, {
    protocolVersion: 1,
    operation: "command",
    workspaceKey: "conversations/conv-demo/session-1",
    arguments: args,
  });
  assert.match(submission.idempotencyKey, /^factcheck-v2:[a-f0-9]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(submission),
    /executable|argv|environment|HERMES_ROOT|FACTCHECK_UV|BULLSHIT_DETECTOR_ROOT/u,
  );

  const second = calls();
  await runtime.runFactcheckViaRuntime({
    scope,
    workspaceKey: "conversations/conv-demo/session-1",
    arguments: args,
    control: control(job, success(), second),
  });
  assert.notEqual(
    submission.idempotencyKey,
    second.submissions[0].submission.idempotencyKey,
    "each potentially mutating command needs a fresh disposable job",
  );
});

test("domain failures and forged worker fences never become Factcheck results", async () => {
  const job = snapshot();
  const base = {
    scope,
    workspaceKey: "conversations/conv-demo/session-1",
    arguments: ["fetch", "file:///etc/passwd"],
  };
  const denied = {
    ok: false,
    operation: "command",
    errorCode: "factcheck_source_denied",
    message: "Only http and https sources can be fetched.",
  };
  await assert.rejects(
    runtime.runFactcheckViaRuntime({ ...base, control: control(job, denied, calls()) }),
    (error) => error.code === "factcheck_source_denied" && error.status === 403,
  );
  await assert.rejects(
    runtime.runFactcheckViaRuntime({
      ...base,
      control: control(job, denied, calls(), {
        identity: { workerInstanceId: "worker_forged" },
      }),
    }),
    /outside its worker fence/u,
  );
  await assert.rejects(
    runtime.runFactcheckViaRuntime({
      ...base,
      control: control(job, denied, calls(), { completionSequence: 3 }),
    }),
    /outside its worker fence/u,
  );
});

test("artifact metadata is bounded and path-contained before it reaches the route", async () => {
  const job = snapshot();
  const base = {
    scope,
    workspaceKey: "conversations/conv-demo/session-1",
    arguments: ["fetch", "https://example.com/article"],
  };
  for (const result of [
    success({ outputPath: "../outside.md" }),
    success({ outputPath: "factcheck/../../outside.md" }),
    success({ outputPath: "C:\\outside.md" }),
    success({ outputBytes: 9 * 1024 * 1024 }),
    success({ preview: "x".repeat(25 * 1024) }),
  ]) {
    await assert.rejects(
      runtime.runFactcheckViaRuntime({ ...base, control: control(job, result, calls()) }),
      /invalid Factcheck command metadata/u,
    );
  }
});

test("aborting a running Factcheck command forwards cancellation exactly once", async () => {
  const running = snapshot({ state: "running", finishedAt: null, lastWorkerSequence: 2 });
  const state = calls();
  const abort = new AbortController();
  const current = control(running, success(), state);
  current.inspect = async () => structuredClone(running);
  const promise = runtime.runFactcheckViaRuntime({
    scope,
    workspaceKey: "conversations/conv-demo/session-1",
    arguments: ["coverage", "climate claim"],
    signal: abort.signal,
    control: current,
  });
  queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
  await assert.rejects(
    promise,
    (error) => error.code === "factcheck_cancelled" && error.status === 409,
  );
  assert.equal(state.cancellations.length, 1);
  assert.equal(state.cancellations[0].jobId, running.jobId);
});

test("an abort during an uncertain submission cancels by its fresh identity", async () => {
  const job = snapshot({ state: "running", finishedAt: null });
  const state = calls();
  const abort = new AbortController();
  const current = control(job, success(), state);
  current.submit = async (authority, submission) => {
    state.submissions.push({
      authority: structuredClone(authority),
      submission: structuredClone(submission),
    });
    abort.abort(new DOMException("Stopped", "AbortError"));
    throw new Error("the submit response was lost");
  };
  await assert.rejects(
    runtime.runFactcheckViaRuntime({
      scope,
      workspaceKey: "conversations/conv-demo/session-1",
      arguments: ["coverage", "climate claim"],
      signal: abort.signal,
      control: current,
    }),
    (error) => error.code === "factcheck_cancelled" && error.status === 409,
  );
  assert.equal(state.cancellations.length, 0);
  assert.equal(state.idempotencyCancellations.length, 1);
  assert.equal(
    state.idempotencyCancellations[0].idempotencyKey,
    state.submissions[0].submission.idempotencyKey,
  );
});

test("the route and worker leave no dashboard spawn, execution override, or artifact escape seam", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const route = read("src/app/api/hermes/tools/factcheck/route.ts");
  const client = read("src/lib/runtime-v2/factcheck-job.ts");
  const worker = read("scripts/runtime-v2-factcheck-worker.mjs");
  const service = read("src/lib/hermes/factcheck-service.ts");
  assert.match(route, /runFactcheckViaRuntime/u);
  assert.match(route, /conversation\.public_id/u);
  assert.doesNotMatch(
    route,
    /factcheck-service|node:child_process|spawn\(|execFile\(|runFactcheck\(|directoryForWorkspaceKey/u,
  );
  assert.doesNotMatch(client, /node:child_process|spawn\(|execFile\(|process\.env/u);
  assert.doesNotMatch(
    JSON.stringify({ client, route }),
    /BREADBOARD_FACTCHECK_UV|BREADBOARD_FACTCHECK_PYTHON|BREADBOARD_BULLSHIT_DETECTOR_ROOT/u,
  );
  assert.match(worker, /expectedInputCount:\s*\(\)\s*=>\s*0/u);
  assert.match(worker, /BREADBOARD_UPSTREAM_COMMIT/u);
  assert.match(worker, /metadata\.isSymbolicLink\(\)/u);
  assert.match(worker, /metadata\.size\s*!==\s*result\.outputBytes/u);
  assert.match(worker, /UV_PYTHON_DOWNLOADS\s*=\s*"never"/u);
  assert.match(service, /spawn\(runtime\.executable/u);
  const directConsumers = sourceFiles(path.join(dashboardRoot, "src"))
    .filter((filePath) => !filePath.endsWith(path.join("hermes", "factcheck-service.ts")))
    .filter((filePath) => /factcheck-service\.ts/u.test(fs.readFileSync(filePath, "utf8")));
  assert.deepEqual(
    directConsumers,
    [],
    "only the fixed Runtime worker may import the direct Factcheck executor",
  );
});
