import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  executeScriberrGardenJob,
  expectedScriberrGardenInputCount,
  validateScriberrGardenExecutionScope,
  validateScriberrGardenRequest,
} from "../scripts/runtime-v2-scriberr-executor.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "scriberr-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "scriberr-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "scriberr-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "scriberr-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "scriberr-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "scriberr-stub" }, () => ({
          loader: "js",
          contents: `
            export class RuntimeJobControlError extends Error {
              constructor(code, message = code) { super(message); this.code = code; }
            }
            const unused = async () => { throw new Error("use injected Scriberr control"); };
            export const abandonRuntimeJobInput = unused;
            export const cancelRuntimeJob = unused;
            export const cancelRuntimeJobByIdempotencyKey = unused;
            export const inspectRuntimeJob = unused;
            export const isRuntimeV2ServiceControlConfigured = () => false;
            export const lookupRuntimeJobByIdempotencyKey = unused;
            export const readRuntimeJobOutput = unused;
            export const reserveRuntimeJobInput = unused;
            export const submitRuntimeJob = unused;
            export const uploadRuntimeJobInput = unused;
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#scriberr-runtime`);
}

const client = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_scriberr_1",
    jobType: "scriberr-garden-transcription",
    workerKind: "scriberr-garden-transcription-node",
    resourceClass: "media-processing",
    state: "queued",
    stage: null,
    attempt: 1,
    workerInstanceId: null,
    gardenId: "physics",
    conversationId: null,
    createdAt: 1,
    startedAt: null,
    updatedAt: 1,
    finishedAt: null,
    lastHeartbeatAt: null,
    lastWorkerSequence: 0,
    progressCurrent: 0,
    progressTotal: 0,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: false,
    ...overrides,
  };
}

function legacyJob(overrides = {}) {
  return {
    id: "vtj-m1234567-abcdef1234",
    gardenId: "physics",
    clusterId: 7,
    userId: 3,
    inputKind: "youtube",
    status: "queued",
    runtimeJobId: null,
    runtimeIdempotencyKey: null,
    runtimeGeneration: 0,
    ...overrides,
  };
}

function fakeStore(initial) {
  let job = { ...initial };
  return {
    getJob: (id) => id === job.id ? { ...job } : null,
    updateJob: (id, patch) => {
      if (id !== job.id) return null;
      job = { ...job, ...patch };
      return { ...job };
    },
    transition: (id, status, patch = {}) => {
      if (id !== job.id) return null;
      job = { ...job, ...patch, status };
      return { ...job };
    },
    current: () => ({ ...job }),
  };
}

function fakeControl(overrides = {}) {
  const unused = async () => { throw new Error("unexpected control operation"); };
  return {
    configured: () => true,
    reserve: unused,
    upload: unused,
    abandon: unused,
    submit: unused,
    inspect: unused,
    lookup: unused,
    cancel: unused,
    cancelByKey: unused,
    readOutput: unused,
    ...overrides,
  };
}

test("worker request and authority schemas are exact and path-free", () => {
  const scope = validateScriberrGardenExecutionScope({
    userId: 3,
    gardenId: "physics",
    conversationId: null,
  });
  assert.equal(scope.gardenId, "physics");
  assert.throws(() => validateScriberrGardenExecutionScope({ ...scope, token: "no" }));

  const upload = validateScriberrGardenRequest({
    protocolVersion: 1,
    operation: "transcribe",
    legacyJobId: "vtj-m1234567-abcdef1234",
    clusterId: 7,
    inputKind: "upload",
  });
  assert.equal(expectedScriberrGardenInputCount(upload), 1);
  assert.equal(expectedScriberrGardenInputCount(validateScriberrGardenRequest({
    ...upload,
    operation: "retry",
  })), 0);
  assert.throws(() => validateScriberrGardenRequest({ ...upload, mediaPath: "C:\\secret.mp4" }));
  assert.throws(() => validateScriberrGardenRequest({
    protocolVersion: 1,
    operation: "inspect-youtube",
    videoId: "dQw4w9WgXcQ",
    canonicalUrl: "http://127.0.0.1/private",
  }));
});

test("probe worker loads only the attested staged source and reports bounded health", async () => {
  const dataRoot = fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "bb-scriberr-worker-"));
  fs.mkdirSync(path.join(dataRoot, "database"), { recursive: true });
  const names = [
    "BREADBOARD_DATA_DIR",
    "BREADBOARD_REPO_ROOT",
    "BREADBOARD_SCRIBERR_SOURCE_ROOT",
    "SCRIBERR_BASE_URL",
    "SCRIBERR_REQUEST_TIMEOUT_MS",
    "YTDLP_PATH",
    "FFMPEG_PATH",
    "FFPROBE_PATH",
  ];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    BREADBOARD_DATA_DIR: dataRoot,
    BREADBOARD_REPO_ROOT: path.resolve(dashboardRoot, ".."),
    BREADBOARD_SCRIBERR_SOURCE_ROOT: path.join(dashboardRoot, "src"),
    SCRIBERR_BASE_URL: "http://127.0.0.1:1",
    SCRIBERR_REQUEST_TIMEOUT_MS: "1000",
    YTDLP_PATH: process.execPath,
    FFMPEG_PATH: process.execPath,
    FFPROBE_PATH: process.execPath,
  });
  try {
    const result = await executeScriberrGardenJob({
      dataRoot,
      request: { protocolVersion: 1, operation: "health" },
      executionScope: { userId: 3, gardenId: "physics", conversationId: null },
    }, new AbortController().signal, { checkpoint() {} }, null);
    assert.equal(result.ok, true);
    assert.equal(result.operation, "health");
    assert.equal(result.health.enabled, true);
    assert.equal(result.health.scriberr.ok, false);
    assert.equal(result.health.tempDirWritable.ok, true);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("submission binds the legacy row to an exact authenticated Runtime identity", async () => {
  const store = fakeStore(legacyJob());
  let submission;
  const control = fakeControl({
    submit: async (authority, value) => {
      assert.deepEqual(authority, { userId: 3, gardenId: "physics", conversationId: null });
      submission = value;
      return snapshot();
    },
  });
  const updated = await client.startScriberrRuntimeJob({
    store,
    jobId: store.current().id,
    control,
    env: {},
  });
  assert.equal(updated.runtimeJobId, "job_scriberr_1");
  assert.equal(updated.runtimeIdempotencyKey, `scriberr-garden-v2:3:${updated.id}:0`);
  assert.deepEqual(submission.inputUploads, []);
  assert.deepEqual(submission.requestPayload, {
    protocolVersion: 1,
    operation: "transcribe",
    legacyJobId: updated.id,
    clusterId: 7,
    inputKind: "youtube",
  });
  assert.equal(JSON.stringify(submission).includes("secret"), false);
});

test("cancel persists intent and targets only the bound native job", async () => {
  const store = fakeStore(legacyJob({ runtimeJobId: "job_scriberr_1", status: "transcribing" }));
  let cancelled = null;
  const control = fakeControl({
    cancel: async (authority, jobId) => {
      cancelled = { authority, jobId };
      return snapshot({ state: "cancelling", cancellationRequested: true });
    },
  });
  const updated = await client.cancelScriberrRuntimeJob({
    store,
    jobId: store.current().id,
    control,
    env: {},
  });
  assert.equal(updated.cancelRequested, true);
  assert.deepEqual(cancelled, {
    authority: { userId: 3, gardenId: "physics", conversationId: null },
    jobId: "job_scriberr_1",
  });
});

test("probe output is accepted only with matching worker identity and sequence", async () => {
  const succeeded = snapshot({
    jobId: "job_probe_1",
    jobType: "scriberr-garden-inspect-youtube",
    workerKind: "scriberr-garden-probe-node",
    resourceClass: "core",
    state: "succeeded",
    workerInstanceId: "worker_probe_1",
    lastWorkerSequence: 9,
  });
  const metadata = {
    videoId: "dQw4w9WgXcQ",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Example",
    channel: "Channel",
    durationSeconds: 42,
    thumbnailUrl: "https://i.ytimg.com/example.jpg",
    uploadDate: "20240101",
  };
  const control = fakeControl({
    submit: async () => succeeded,
    readOutput: async () => ({
      jobId: succeeded.jobId,
      kind: "result",
      content: {
        protocolVersion: 1,
        identity: {
          jobId: succeeded.jobId,
          attempt: 1,
          workerInstanceId: "worker_probe_1",
        },
        completionSequence: 9,
        result: { ok: true, operation: "inspect-youtube", metadata },
      },
    }),
  });
  const result = await client.inspectScriberrYouTubeViaRuntime({
    userId: 3,
    gardenId: "physics",
    parsed: metadata,
    control,
    env: {},
  });
  assert.equal(result.title, "Example");
});

test("Next source has no Scriberr process fallback after cutover", () => {
  const instance = fs.readFileSync(path.join(dashboardRoot, "src/lib/scriberr/instance.ts"), "utf8");
  const route = fs.readFileSync(path.join(dashboardRoot, "src/lib/scriberr/route-core.ts"), "utf8");
  const worker = fs.readFileSync(path.join(dashboardRoot, "scripts/runtime-v2-scriberr-worker.mjs"), "utf8");
  assert.doesNotMatch(instance, /VideoTranscriptionRunner|probeMediaFile|inspectYouTubeVideo|withServiceLease/u);
  assert.doesNotMatch(route, /createWriteStream|saveUploadStream|mediaTempPath:\s*mediaPath/u);
  assert.match(worker, /canonicalRuntimeInputAsync/u);
  assert.match(instance, /startScriberrRuntimeJob/u);
});
