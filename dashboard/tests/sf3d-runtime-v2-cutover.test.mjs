import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  validateRuntimeV2Sf3dEnvironment,
  validateRuntimeV2Sf3dRequest,
  validateRuntimeV2Sf3dScope,
} from "../scripts/runtime-v2-sf3d-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.freeze({
  textureResolution: 1024,
  remesh: "triangle",
  targetVertexCount: 12_000,
  removeBackground: true,
});

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "sf3d-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "sf3d-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "sf3d-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "sf3d-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "sf3d-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "sf3d-stub" }, () => ({
          loader: "js",
          contents: `
            const unused = async () => { throw new Error("use the injected SF3D control"); };
            export const abandonRuntimeJobInput = unused;
            export const cancelRuntimeJob = unused;
            export const inspectRuntimeJob = unused;
            export const readRuntimeJobOutput = unused;
            export const reserveRuntimeJobInput = unused;
            export const submitRuntimeJob = unused;
            export const uploadRuntimeJobInput = unused;
          `,
        }));
      },
    }],
  });
  const source = Buffer.from(built.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}#sf3d-runtime-v2`);
}

const runtime = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_sf3d_1",
    jobType: "sf3d-reconstruct",
    workerKind: "sf3d-node",
    resourceClass: "local-model",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_sf3d_1",
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

function state() {
  return { reservations: [], uploads: [], submissions: [], cancellations: [], abandoned: [] };
}

function control(job, result, calls, identity = {}) {
  return {
    async reserve(authority, request) {
      calls.reservations.push({ authority: structuredClone(authority), request: structuredClone(request) });
      return {
        uploadId: "upload_sf3d_1",
        expiresAt: Date.now() + 60_000,
        maximumBytes: request.declaredSizeBytes,
        ...request,
      };
    },
    async upload(authority, reservation, body) {
      const chunks = [];
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      calls.uploads.push({ authority: structuredClone(authority), bytes });
      return {
        uploadId: reservation.uploadId,
        sizeBytes: bytes.byteLength,
        sha256: "a".repeat(64),
        displayName: reservation.displayName,
        mediaType: reservation.mediaType,
      };
    },
    async abandon(authority, uploadId) {
      calls.abandoned.push({ authority: structuredClone(authority), uploadId });
    },
    async submit(authority, submission) {
      calls.submissions.push({ authority: structuredClone(authority), submission: structuredClone(submission) });
      return structuredClone(job);
    },
    async inspect() {
      throw new Error("terminal fixture must not poll");
    },
    async readOutput(authority, jobId, kind) {
      return { jobId, kind, content: envelope(job, result, identity) };
    },
    async cancel(authority, jobId) {
      calls.cancellations.push({ authority: structuredClone(authority), jobId });
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
    "sf3d-stage",
  );
}

function relativeTo(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

test("SF3D worker accepts only the sealed request, conversation scope, and native paths", () => {
  const request = {
    protocolVersion: 1,
    operation: "reconstruct",
    imageName: "object.png",
    mediaType: "image/png",
    options,
  };
  const scope = { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" };
  assert.equal(validateRuntimeV2Sf3dRequest(request), request);
  assert.equal(validateRuntimeV2Sf3dScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2Sf3dEnvironment({
    SF3D_ROOT: path.resolve("stable-fast-3d"),
    SF3D_PYTHON: path.resolve("runtime-v2", "services", "sf3d", "python.exe"),
    SF3D_DEVICE: "cuda",
    SF3D_TIMEOUT_MS: "600000",
  }));
  assert.throws(
    () => validateRuntimeV2Sf3dRequest({ ...request, executable: "python.exe" }),
    /canonical Stable Fast 3D request/u,
  );
  assert.throws(
    () => validateRuntimeV2Sf3dScope({ ...scope, conversationId: null }),
    /authenticated conversation scope/u,
  );
  assert.throws(
    () => validateRuntimeV2Sf3dEnvironment({ SF3D_ROOT: "relative", SF3D_PYTHON: "python" }),
    /sealed Stable Fast 3D runtime paths/u,
  );
});

test("the client uploads one image and accepts only a fenced private-stage GLB", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-sf3d-client-"));
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
  const mesh = path.join(stage, "mesh.glb");
  fs.writeFileSync(mesh, Buffer.concat([Buffer.from("glTF"), Buffer.alloc(28)]));
  const resultPayload = {
    ok: true,
    operation: "reconstruct",
    outputRelativePath: relativeTo(dataRoot, mesh),
    sizeBytes: fs.statSync(mesh).size,
    device: "cuda",
    durationSeconds: 12.5,
    peakMemoryMb: 2048,
    options,
    summary: { triangles: 42, vertices: 24, extent: { x: 1, y: 2, z: 3 } },
  };
  const calls = state();
  const answer = await runtime.runImageTo3dViaRuntime({
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    image: new Uint8Array(Buffer.from("image bytes")),
    imageName: "object.png",
    mediaType: "image/png",
    options,
    control: control(job, resultPayload, calls),
  });
  assert.equal(answer.meshPath, fs.realpathSync.native(mesh));
  assert.equal(calls.uploads[0].bytes.toString(), "image bytes");
  assert.equal(calls.submissions[0].submission.jobType, "sf3d-reconstruct");
  assert.deepEqual(calls.submissions[0].submission.inputUploads, [{ uploadId: "upload_sf3d_1" }]);
  assert.deepEqual(calls.submissions[0].submission.requestPayload, {
    protocolVersion: 1,
    operation: "reconstruct",
    imageName: "object.png",
    mediaType: "image/png",
    options,
  });
  assert.match(calls.submissions[0].submission.idempotencyKey, /^sf3d-v2:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(calls.submissions[0]), /executable|argv|SF3D_ROOT|SF3D_PYTHON/u);
  answer.cleanup();
  assert.equal(fs.existsSync(stage), false);
});

test("a forged worker fence and a bounded domain failure never become meshes", async () => {
  const job = snapshot();
  const calls = state();
  const base = {
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    image: new Uint8Array(Buffer.from("image bytes")),
    imageName: "object.png",
    mediaType: "image/png",
    options,
  };
  const failed = {
    ok: false,
    operation: "reconstruct",
    errorCode: "sf3d_model_access_denied",
    message: "Model access is required.",
  };
  await assert.rejects(
    runtime.runImageTo3dViaRuntime({ ...base, control: control(job, failed, calls) }),
    (error) => error.code === "sf3d_model_access_denied" && error.status === 403,
  );
  await assert.rejects(
    runtime.runImageTo3dViaRuntime({
      ...base,
      control: control(job, failed, state(), { workerInstanceId: "worker_forged" }),
    }),
    /outside its worker fence/u,
  );
});

test("aborting while a running SF3D job is polled forwards cancellation", async () => {
  const running = snapshot({
    state: "running",
    finishedAt: null,
    lastWorkerSequence: 2,
  });
  const calls = state();
  const abort = new AbortController();
  const current = control(running, {}, calls);
  current.inspect = async () => structuredClone(running);
  const promise = runtime.runImageTo3dViaRuntime({
    scope: { userId: 17, gardenId: "garden_demo", conversationId: "conv_demo" },
    image: new Uint8Array(Buffer.from("image bytes")),
    imageName: "object.png",
    mediaType: "image/png",
    options,
    signal: abort.signal,
    control: current,
  });
  queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
  await assert.rejects(promise, /Stopped/u);
  assert.equal(calls.cancellations.length, 1);
  assert.equal(calls.cancellations[0].jobId, running.jobId);
});

test("the public route contains no direct SF3D process or mesh-buffer implementation", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "hermes", "tools", "image-to-3d", "route.ts"),
    "utf8",
  );
  assert.match(source, /runImageTo3dViaRuntime/u);
  assert.doesNotMatch(source, /sf3d\/service|node:child_process|spawn\(|execFile\(/u);
});
