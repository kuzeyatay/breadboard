import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  validateRuntimeV2ManimEnvironment,
  validateRuntimeV2ManimRequest,
  validateRuntimeV2ManimScope,
} from "../scripts/runtime-v2-manim-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scene = Object.freeze({
  title: "Completing the square",
  description: "Animate the geometric identity.",
  code: "from manim import *\nclass BreadboardScene(Scene):\n    def construct(self):\n        self.add(Square())\n",
  sceneName: "BreadboardScene",
  quality: "standard",
});

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "manim-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "manim-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "manim-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "manim-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "manim-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "manim-stub" }, () => ({
          loader: "js",
          contents: `
            const unused = async () => { throw new Error("use the injected Manim control"); };
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
  return import(`data:text/javascript;base64,${source}#manim-runtime-v2`);
}

const runtime = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_manim_1",
    jobType: "manim-render",
    workerKind: "manim-node",
    resourceClass: "media-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_manim_1",
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
      state.submissions.push({ authority: structuredClone(authority), submission: structuredClone(submission) });
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

function stagePath(dataRoot, job) {
  return path.join(
    dataRoot,
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "manim-stage",
  );
}

function relativeTo(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

test("Manim worker accepts only canonical source, conversation scope, and native Docker config", () => {
  const request = {
    protocolVersion: 1,
    operation: "render",
    ...scene,
    sourceHash: createHash("sha256").update(scene.code).digest("hex"),
  };
  const scope = { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" };
  assert.equal(validateRuntimeV2ManimRequest(request), request);
  assert.equal(validateRuntimeV2ManimScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2ManimEnvironment({
    MANIM_DOCKER_BIN: path.resolve("docker.exe"),
    MANIM_DOCKER_IMAGE: "manimcommunity/manim:v0.20.1",
    MANIM_TIMEOUT_MS: "300000",
  }));
  assert.throws(
    () => validateRuntimeV2ManimRequest({ ...request, argv: ["run", "attacker/image"] }),
    /canonical Manim Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2ManimRequest({ ...request, sourceHash: "0".repeat(64) }),
    /canonical Manim Runtime request/u,
  );
  assert.throws(
    () => validateRuntimeV2ManimScope({ ...scope, conversationId: null }),
    /authenticated conversation scope/u,
  );
});

test("the client accepts one fenced private-stage MP4 without loading it into Next", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-manim-client-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const priorDataRoot = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  t.after(() => {
    if (priorDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = priorDataRoot;
  });
  const job = snapshot();
  const stage = stagePath(dataRoot, job);
  fs.mkdirSync(stage, { recursive: true });
  const video = path.join(stage, "animation.mp4");
  const bytes = Buffer.alloc(32);
  bytes.write("ftyp", 4, "ascii");
  fs.writeFileSync(video, bytes);
  const resultPayload = {
    ok: true,
    operation: "render",
    outputRelativePath: relativeTo(dataRoot, video),
    sizeBytes: bytes.byteLength,
    image: "manimcommunity/manim:v0.20.1",
    durationSeconds: 12.5,
    sourceHash: createHash("sha256").update(scene.code).digest("hex"),
  };
  const state = calls();
  const answer = await runtime.runManimViaRuntime({
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    request: scene,
    control: control(job, resultPayload, state),
  });
  assert.equal(answer.videoPath, fs.realpathSync.native(video));
  assert.deepEqual(state.submissions[0].authority, {
    userId: 17,
    gardenId: "garden_demo",
    conversationId: "conv_demo",
  });
  const submission = state.submissions[0].submission;
  assert.equal(submission.jobType, "manim-render");
  assert.deepEqual(submission.inputUploads, undefined);
  assert.equal(submission.requestPayload.operation, "render");
  assert.equal(submission.requestPayload.code, scene.code);
  assert.match(submission.idempotencyKey, /^manim-v2:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(submission), /executable|argv|MANIM_DOCKER_BIN/u);
  answer.cleanup();
  assert.equal(fs.existsSync(stage), false);
});

test("domain errors and forged completion fences never become Manim videos", async () => {
  const job = snapshot();
  const base = {
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    request: scene,
  };
  const failed = {
    ok: false,
    operation: "render",
    errorCode: "manim_runtime_unavailable",
    message: "Docker is unavailable.",
  };
  await assert.rejects(
    runtime.runManimViaRuntime({ ...base, control: control(job, failed, calls()) }),
    (error) => error.code === "manim_runtime_unavailable" && error.status === 503,
  );
  await assert.rejects(
    runtime.runManimViaRuntime({
      ...base,
      control: control(job, failed, calls(), { workerInstanceId: "worker_forged" }),
    }),
    /outside its worker fence/u,
  );
});

test("aborting a running Manim job forwards cancellation exactly once", async () => {
  const running = snapshot({ state: "running", finishedAt: null, lastWorkerSequence: 2 });
  const state = calls();
  const abort = new AbortController();
  const current = control(running, {}, state);
  current.inspect = async () => structuredClone(running);
  const promise = runtime.runManimViaRuntime({
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    request: scene,
    signal: abort.signal,
    control: current,
  });
  queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
  await assert.rejects(promise, /Stopped/u);
  assert.equal(state.cancellations.length, 1);
  assert.equal(state.cancellations[0].jobId, running.jobId);
});

test("the public Manim route has no direct Docker process or MP4 buffer implementation", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "hermes", "tools", "manim", "route.ts"),
    "utf8",
  );
  assert.match(source, /runManimViaRuntime/u);
  assert.doesNotMatch(source, /manim\/service|node:child_process|spawn\(|execFile\(|runManim\(/u);
});
