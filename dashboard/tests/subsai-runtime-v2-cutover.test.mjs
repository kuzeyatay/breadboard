import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import esbuild from "esbuild";

import {
  executeRuntimeV2SubsAiProbe,
  validateRuntimeV2SubsAiProbeRequest,
  validateRuntimeV2SubsAiProbeScope,
} from "../scripts/runtime-v2-subsai-probe-worker.mjs";
import {
  executeRuntimeV2SubsAiTranscription,
  validateRuntimeV2SubsAiTranscriptionRequest,
} from "../scripts/runtime-v2-subsai-transcription-worker.mjs";
import {
  SUBSAI_MAX_INPUT_BYTES,
  SUBSAI_SOURCE_COMMIT,
  runtimeV2SubsAiChildEnvironment,
  validateRuntimeV2SubsAiEnvironment,
  validateRuntimeV2SubsAiScope,
} from "../scripts/runtime-v2-subsai-worker-layout.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");

async function loadClient(relative, suffix) {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, relative)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: `subsai-${suffix}-stubs`,
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "subsai-runtime-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "subsai-runtime-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "subsai-runtime-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "subsai-runtime-stub" }, () => ({
          loader: "js",
          contents: `
            export class RuntimeJobControlError extends Error {
              constructor(input) { super(input.message); Object.assign(this, input); }
            }
            const unused = async () => { throw new Error("use the injected SubsAI control"); };
            export const abandonRuntimeJobInput = unused;
            export const cancelRuntimeJob = unused;
            export const cancelRuntimeJobByIdempotencyKey = unused;
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
  return import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#${suffix}`
  );
}

const transcriptionClient = await loadClient(
  "src/lib/runtime-v2/subsai-transcription-job.ts",
  "transcription",
);
const probeClient = await loadClient(
  "src/lib/runtime-v2/subsai-probe-job.ts",
  "probe",
);

function snapshot(kind, overrides = {}) {
  const transcription = kind === "transcription";
  return {
    jobId: transcription ? "job_subsai_transcription_1" : "job_subsai_probe_1",
    jobType: transcription ? "subsai-transcription" : "subsai-probe",
    workerKind: transcription ? "subsai-transcription-node" : "subsai-probe-node",
    resourceClass: transcription ? "local-model" : "document-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: transcription ? "worker_subsai_transcription_1" : "worker_subsai_probe_1",
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

function envelope(job, result, overrides = {}) {
  return {
    protocolVersion: 1,
    identity: {
      jobId: job.jobId,
      attempt: job.attempt,
      workerInstanceId: job.workerInstanceId,
      ...(overrides.identity ?? {}),
    },
    completionSequence: overrides.completionSequence ?? job.lastWorkerSequence,
    result,
  };
}

function state() {
  return {
    reservations: [],
    uploads: [],
    abandoned: [],
    submissions: [],
    cancellations: [],
    idempotencyCancellations: [],
  };
}

function transcriptionControl(job, result, calls, outputOverrides = {}) {
  return {
    async reserve(authority, request) {
      calls.reservations.push({
        authority: structuredClone(authority),
        request: structuredClone(request),
      });
      return {
        uploadId: "upload_subsai_1",
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
        sizeBytes: bytes.length,
        sha256: "a".repeat(64),
        displayName: reservation.displayName,
        mediaType: reservation.mediaType,
      };
    },
    async abandon(authority, uploadId) {
      calls.abandoned.push({ authority: structuredClone(authority), uploadId });
    },
    async submit(authority, submission) {
      calls.submissions.push({
        authority: structuredClone(authority),
        submission: structuredClone(submission),
      });
      return structuredClone(job);
    },
    async inspect() {
      return structuredClone(job);
    },
    async readOutput(authority, jobId, kind) {
      return { jobId, kind, content: envelope(job, result, outputOverrides) };
    },
    async cancel(authority, jobId) {
      calls.cancellations.push({ authority: structuredClone(authority), jobId });
      return { ...job, state: "cancelled" };
    },
    async cancelByIdempotencyKey(authority, idempotencyKey) {
      calls.idempotencyCancellations.push({
        authority: structuredClone(authority),
        idempotencyKey,
      });
      return { jobId: null, state: "pending", accepted: true };
    },
  };
}

function probeControl(job, result, calls, outputOverrides = {}) {
  return {
    async submit(authority, submission) {
      calls.submissions.push({
        authority: structuredClone(authority),
        submission: structuredClone(submission),
      });
      return structuredClone(job);
    },
    async inspect() {
      return structuredClone(job);
    },
    async readOutput(authority, jobId, kind) {
      return { jobId, kind, content: envelope(job, result, outputOverrides) };
    },
    async cancel(authority, jobId) {
      calls.cancellations.push({ authority: structuredClone(authority), jobId });
      return { ...job, state: "cancelled" };
    },
    async cancelByIdempotencyKey(authority, idempotencyKey) {
      calls.idempotencyCancellations.push({
        authority: structuredClone(authority),
        idempotencyKey,
      });
      return { jobId: null, state: "pending", accepted: true };
    },
  };
}

function attemptStage(dataRoot, job) {
  return path.join(
    dataRoot,
    "runtime", "jobs", job.jobId, "attempts", String(job.attempt),
    job.workerInstanceId, "workspace", "subsai-stage",
  );
}

function relativeTo(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function restoreEnvironment(before) {
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, before);
}

test("SubsAI workers accept only fixed bounded operations and authenticated scope", () => {
  const words = { protocolVersion: 1, operation: "words", size: "base", language: null };
  const subtitles = {
    protocolVersion: 1,
    operation: "subtitles",
    size: "small",
    language: "en",
    format: "vtt",
  };
  const scoped = { userId: 17, gardenId: null, conversationId: "conv_subsai" };
  assert.equal(validateRuntimeV2SubsAiTranscriptionRequest(words), words);
  assert.equal(validateRuntimeV2SubsAiTranscriptionRequest(subtitles), subtitles);
  assert.equal(validateRuntimeV2SubsAiScope(scoped), scoped);
  assert.equal(SUBSAI_MAX_INPUT_BYTES, 2 * 1024 * 1024 * 1024);
  for (const forged of [
    { ...words, executable: "python.exe" },
    { ...words, argv: ["-m", "subsai.cli"] },
    { ...words, env: { OPENAI_API_KEY: "secret" } },
    { ...words, operation: "serve" },
    { ...words, size: "../../model" },
    { ...words, language: "en\n--device=cuda" },
  ]) assert.throws(
    () => validateRuntimeV2SubsAiTranscriptionRequest(forged),
    /canonical subsai transcription request/u,
  );
  assert.throws(
    () => validateRuntimeV2SubsAiScope({ ...scoped, userId: 0 }),
    /authenticated user scope/u,
  );

  const probe = { protocolVersion: 1, operation: "status" };
  const globalScope = { userId: 17, gardenId: null, conversationId: null };
  assert.equal(validateRuntimeV2SubsAiProbeRequest(probe), probe);
  assert.equal(validateRuntimeV2SubsAiProbeScope(globalScope), globalScope);
  assert.throws(
    () => validateRuntimeV2SubsAiProbeRequest({ ...probe, command: "where uv" }),
    /canonical subsai health request/u,
  );
  assert.throws(
    () => validateRuntimeV2SubsAiProbeScope({ ...globalScope, conversationId: "renderer" }),
    /user-global scope/u,
  );
  assert.doesNotThrow(() => validateRuntimeV2SubsAiEnvironment({
    SUBSAI_SOURCE_COMMIT,
    UV_PATH: path.resolve("runtime", "bin", process.platform === "win32" ? "uv.exe" : "uv"),
    BREADBOARD_RUNTIME_V2_MEDIA_BIN: path.resolve("runtime", "bin"),
    SUBSAI_DEVICE: "cpu",
    SUBSAI_COMPUTE_TYPE: "int8",
  }));
  assert.throws(
    () => validateRuntimeV2SubsAiEnvironment({
      SUBSAI_SOURCE_COMMIT,
      BREADBOARD_RUNTIME_V2_MEDIA_BIN: "relative/bin",
    }),
    /trusted subsai BREADBOARD_RUNTIME_V2_MEDIA_BIN path/u,
  );
  assert.throws(
    () => validateRuntimeV2SubsAiEnvironment({
      SUBSAI_SOURCE_COMMIT: "renderer-selected",
    }),
    /pinned subsai source receipt/u,
  );
});

test("the transcription worker owns the exact Python CLI and a closed private environment", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-subsai-worker-"));
  const workspace = path.join(dataRoot, "runtime", "jobs", "job_subsai", "workspace");
  const venv = path.join(dataRoot, "runtime-v2", "services", "subsai", ".venv");
  const python = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  const mediaBin = path.join(dataRoot, "runtime-bin");
  const uv = path.join(mediaBin, process.platform === "win32" ? "uv.exe" : "uv");
  const inputPath = path.join(workspace, "sealed-input.mp4");
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.mkdirSync(mediaBin, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(python, "managed python fixture");
  fs.writeFileSync(uv, "managed uv fixture");
  for (const name of process.platform === "win32"
    ? ["ffmpeg.exe", "ffprobe.exe"]
    : ["ffmpeg", "ffprobe"]) fs.writeFileSync(path.join(mediaBin, name), "media fixture");
  fs.writeFileSync(inputPath, "sealed media");
  const beforeEnvironment = { ...process.env };
  const beforeCwd = process.cwd();
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  try {
    process.env.SUBSAI_SOURCE_COMMIT = SUBSAI_SOURCE_COMMIT;
    process.env.UV_PATH = uv;
    process.env.BREADBOARD_RUNTIME_V2_MEDIA_BIN = mediaBin;
    process.env.OPENAI_API_KEY = "must-not-reach-subsai";
    process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "must-not-reach-subsai";
    process.env.SUBSAI_ROOT = path.join(repositoryRoot, "subsai");
    const calls = [];
    const checkpoints = [];
    const result = await executeRuntimeV2SubsAiTranscription({
      dataRoot,
      workspacePath: workspace,
      executionScope: { userId: 17, gardenId: null, conversationId: "conv_subsai" },
      request: { protocolVersion: 1, operation: "words", size: "base", language: "en" },
      inputBlobs: [{ sizeBytes: fs.statSync(inputPath).size }],
    }, new AbortController().signal, {
      checkpoint(value) { checkpoints.push(value); },
    }, {
      canonicalInput: async () => inputPath,
      runPython: async (layout, args, signal, onProgress) => {
        calls.push({
          layout,
          args: [...args],
          environment: runtimeV2SubsAiChildEnvironment(layout),
        });
        assert.equal(signal.aborted, false);
        onProgress({ stage: "Downloading the model", detail: "download 5%" });
        onProgress({ stage: "Transcribing" });
        const destination = args[args.indexOf("--destination-folder") + 1];
        fs.writeFileSync(
          path.join(destination, "sealed-input.srt"),
          "1\n00:00:00,000 --> 00:00:00,500\nHello\n",
        );
        return { code: 0, stderr: "", spawnError: false };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "words");
    assert.equal(result.format, "srt");
    assert.equal(result.operation, "transcribe");
    assert.equal(path.isAbsolute(result.outputRelativePath), false);
    assert.equal(fs.statSync(path.join(dataRoot, ...result.outputRelativePath.split("/"))).size, result.sizeBytes);
    assert.deepEqual(calls[0].args.slice(0, 5), [
      "-m", "subsai.cli", inputPath, "--model", "guillaumekln/faster-whisper",
    ]);
    assert.deepEqual(
      JSON.parse(calls[0].args[calls[0].args.indexOf("--model-configs") + 1]),
      {
        model_size_or_path: "base",
        device: "cpu",
        compute_type: "int8",
        word_timestamps: true,
        language: "en",
      },
    );
    assert.equal(calls[0].args.includes("--output-suffix"), false);
    assert.equal(calls[0].layout.root, path.join(repositoryRoot, "subsai"));
    assert.equal(calls[0].layout.python, python);
    assert.equal(calls[0].layout.mediaBin, mediaBin);
    assert.equal(calls[0].environment.OPENAI_API_KEY, undefined);
    assert.equal(calls[0].environment.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
    assert.equal(calls[0].environment.SUBSAI_ROOT, path.join(repositoryRoot, "subsai"));
    assert.equal(calls[0].environment.HOME.startsWith(workspace), true);
    assert.equal(calls[0].environment.HF_HOME.startsWith(dataRoot), true);
    assert.equal(calls[0].environment.PATH.split(path.delimiter).includes(mediaBin), true);
    assert.deepEqual(checkpoints, [
      { stage: "preparing" },
      { stage: "starting" },
      { stage: "Downloading the model", detail: "download 5%" },
      { stage: "Transcribing" },
      { stage: "complete" },
    ]);
  } finally {
    process.chdir(beforeCwd);
    restoreEnvironment(beforeEnvironment);
  }
});

test("the health worker is observational and returns the exact bounded status", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-subsai-probe-"));
  const workspace = path.join(dataRoot, "runtime", "jobs", "job_probe", "workspace");
  const uv = path.join(dataRoot, process.platform === "win32" ? "uv.exe" : "uv");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(uv, "managed uv fixture");
  const beforeEnvironment = { ...process.env };
  const beforeCwd = process.cwd();
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  try {
    process.env.SUBSAI_SOURCE_COMMIT = SUBSAI_SOURCE_COMMIT;
    process.env.UV_PATH = uv;
    process.env.OPENAI_API_KEY = "must-not-reach-probe";
    const expected = {
      available: false,
      cloned: true,
      root: path.join(repositoryRoot, "subsai"),
      python: null,
      uvAvailable: true,
      models: [],
      reason: "Subtitles need an environment of their own.",
    };
    const checkpoints = [];
    const result = await executeRuntimeV2SubsAiProbe({
      dataRoot,
      workspacePath: workspace,
      executionScope: { userId: 17, gardenId: null, conversationId: null },
      request: { protocolVersion: 1, operation: "status" },
      inputBlobs: [],
    }, new AbortController().signal, {
      checkpoint(value) { checkpoints.push(value); },
    }, {
      loadHealth: async (layout) => {
        assert.equal(layout.root, path.join(repositoryRoot, "subsai"));
        assert.equal(process.env.OPENAI_API_KEY, undefined);
        assert.equal(process.env.HOME.startsWith(workspace), true);
        return expected;
      },
    });
    assert.deepEqual(result, expected);
    assert.equal(
      fs.existsSync(path.join(dataRoot, "runtime-v2", "services", "subsai", "models")),
      false,
      "an observational probe must not create the shared model cache",
    );
    assert.deepEqual(checkpoints, [
      { stage: "preparing", percent: 10 },
      { stage: "probing", percent: 35 },
      { stage: "complete", percent: 100 },
    ]);
  } finally {
    process.chdir(beforeCwd);
    restoreEnvironment(beforeEnvironment);
  }
});

test("the dashboard streams one sealed media input and fences the retained output", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-subsai-client-"));
  const media = path.join(dataRoot, "source.mp4");
  fs.writeFileSync(media, "streamed source video");
  const beforeDataRoot = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  try {
    const job = snapshot("transcription", { conversationId: "conv_subsai" });
    const stage = attemptStage(dataRoot, job);
    const output = path.join(stage, "source.srt");
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(output, "1\n00:00:00,000 --> 00:00:00,500\nHello\n");
    const result = {
      ok: true,
      operation: "transcribe",
      mode: "words",
      format: "srt",
      outputRelativePath: relativeTo(dataRoot, output),
      sizeBytes: fs.statSync(output).size,
    };
    const calls = state();
    const retained = await transcriptionClient.transcribeWithSubsAiViaRuntime({
      scope: { userId: 17, gardenId: null, conversationId: "conv_subsai" },
      mediaPath: media,
      mode: "words",
      size: "base",
      language: null,
      control: transcriptionControl(job, result, calls),
    });
    assert.equal(fs.readFileSync(retained.filePath, "utf8").includes("Hello"), true);
    assert.deepEqual(calls.reservations[0].authority, {
      userId: 17,
      gardenId: null,
      conversationId: "conv_subsai",
    });
    assert.equal(calls.reservations[0].request.declaredSizeBytes, fs.statSync(media).size);
    assert.equal(calls.uploads[0].bytes.toString(), "streamed source video");
    assert.deepEqual(calls.submissions[0].submission.inputUploads, [
      { uploadId: "upload_subsai_1" },
    ]);
    assert.deepEqual(calls.submissions[0].submission.requestPayload, {
      protocolVersion: 1,
      operation: "words",
      size: "base",
      language: null,
    });
    assert.equal(calls.submissions[0].submission.jobType, "subsai-transcription");
    assert.match(
      calls.submissions[0].submission.idempotencyKey,
      /^subsai-transcription-v2:[a-f0-9]{64}$/u,
    );
    assert.doesNotMatch(
      JSON.stringify(calls.submissions[0].submission),
      /python|subsai\.cli|executable|argv|environment|OPENAI_API_KEY/u,
    );
    assert.equal(fs.existsSync(stage), true, "the caller retains output until it is consumed");
    retained.cleanup();
    assert.equal(fs.existsSync(stage), false, "consumption removes the private attempt stage");
  } finally {
    if (beforeDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = beforeDataRoot;
  }
});

test("forged SubsAI output fences and paths are rejected and cleaned", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-subsai-fence-"));
  const media = path.join(dataRoot, "source.mp4");
  fs.writeFileSync(media, "video");
  const beforeDataRoot = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  try {
    const job = snapshot("transcription");
    for (const fixture of [
      { outside: true, overrides: {} },
      { outside: false, overrides: { identity: { workerInstanceId: "worker_forged" } } },
      { outside: false, overrides: { completionSequence: 3 } },
    ]) {
      const stage = attemptStage(dataRoot, job);
      fs.mkdirSync(stage, { recursive: true });
      const output = fixture.outside
        ? path.join(dataRoot, "outside.srt")
        : path.join(stage, "inside.srt");
      fs.writeFileSync(output, "subtitle");
      const result = {
        ok: true,
        operation: "transcribe",
        mode: "words",
        format: "srt",
        outputRelativePath: relativeTo(dataRoot, output),
        sizeBytes: fs.statSync(output).size,
      };
      await assert.rejects(
        transcriptionClient.transcribeWithSubsAiViaRuntime({
          scope: { userId: 17, gardenId: null, conversationId: null },
          mediaPath: media,
          mode: "words",
          control: transcriptionControl(job, result, state(), fixture.overrides),
        }),
        /subsai|worker fence|private attempt/u,
      );
      assert.equal(fs.existsSync(stage), false, "a rejected attempt stage must be removed");
    }
  } finally {
    if (beforeDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = beforeDataRoot;
  }
});

test("running and uncertain transcription jobs forward cancellation and release inputs", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-subsai-cancel-"));
  const media = path.join(dataRoot, "source.mp4");
  fs.writeFileSync(media, "video");
  const beforeDataRoot = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  try {
    const running = snapshot("transcription", {
      state: "running",
      finishedAt: null,
      lastWorkerSequence: 2,
    });
    const runningCalls = state();
    const abort = new AbortController();
    const pending = transcriptionClient.transcribeWithSubsAiViaRuntime({
      scope: { userId: 17, gardenId: null, conversationId: null },
      mediaPath: media,
      mode: "words",
      signal: abort.signal,
      control: transcriptionControl(running, {}, runningCalls),
    });
    queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
    await assert.rejects(pending, /stopped|aborted/u);
    assert.equal(runningCalls.cancellations.length, 1);

    const uncertainCalls = state();
    const lost = transcriptionControl(running, {}, uncertainCalls);
    lost.submit = async (authority, submission) => {
      uncertainCalls.submissions.push({
        authority: structuredClone(authority),
        submission: structuredClone(submission),
      });
      throw new Error("submit response was lost");
    };
    await assert.rejects(
      transcriptionClient.transcribeWithSubsAiViaRuntime({
        scope: { userId: 17, gardenId: null, conversationId: null },
        mediaPath: media,
        mode: "words",
        control: lost,
      }),
      /submit response was lost/u,
    );
    assert.equal(uncertainCalls.idempotencyCancellations.length, 1);
    assert.equal(uncertainCalls.abandoned.length, 1);
    assert.equal(
      uncertainCalls.idempotencyCancellations[0].idempotencyKey,
      uncertainCalls.submissions[0].submission.idempotencyKey,
    );
  } finally {
    if (beforeDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = beforeDataRoot;
  }
});

test("the fresh user-global health job preserves status, fences, and uncertain cleanup", async () => {
  probeClient.invalidateSubsAiHealth();
  const job = snapshot("probe");
  const expected = {
    available: true,
    cloned: true,
    root: path.resolve("runtime", "subsai"),
    python: path.resolve("runtime", "subsai", ".venv", "python"),
    uvAvailable: true,
    models: ["guillaumekln/faster-whisper"],
    reason: null,
  };
  const calls = state();
  assert.deepEqual(await probeClient.runSubsAiProbeViaRuntime({
    userId: 17,
    control: probeControl(job, expected, calls),
  }), expected);
  assert.deepEqual(calls.submissions[0].authority, {
    userId: 17,
    gardenId: null,
    conversationId: null,
  });
  assert.deepEqual(calls.submissions[0].submission.requestPayload, {
    protocolVersion: 1,
    operation: "status",
  });
  assert.equal(calls.submissions[0].submission.jobType, "subsai-probe");
  assert.equal(calls.submissions[0].submission.inputUploads, undefined);
  assert.doesNotMatch(
    JSON.stringify(calls.submissions[0].submission),
    /where|which|python|executable|argv|environment|OPENAI_API_KEY/u,
  );

  await assert.rejects(
    probeClient.runSubsAiProbeViaRuntime({
      userId: 17,
      control: probeControl(job, expected, state(), {
        identity: { workerInstanceId: "worker_forged" },
      }),
    }),
    /unfenced SubsAI health result/u,
  );
  await assert.rejects(
    probeClient.runSubsAiProbeViaRuntime({
      userId: 17,
      control: probeControl(job, {
        ...expected,
        models: ["guillaumekln/faster-whisper\nforged"],
      }, state()),
    }),
    /invalid SubsAI health metadata/u,
  );

  const uncertainCalls = state();
  const lost = probeControl(job, expected, uncertainCalls);
  lost.submit = async (authority, submission) => {
    uncertainCalls.submissions.push({
      authority: structuredClone(authority),
      submission: structuredClone(submission),
    });
    throw new Error("probe submit response was lost");
  };
  await assert.rejects(
    probeClient.runSubsAiProbeViaRuntime({ userId: 17, control: lost }),
    /probe submit response was lost/u,
  );
  assert.equal(uncertainCalls.idempotencyCancellations.length, 1);
  assert.equal(
    uncertainCalls.idempotencyCancellations[0].idempotencyKey,
    uncertainCalls.submissions[0].submission.idempotencyKey,
  );
});

test("SubsAI health caching remains 30-second single-flight and cancellation is waiter-aware", async () => {
  probeClient.invalidateSubsAiHealth();
  const job = snapshot("probe");
  const expected = {
    available: false,
    cloned: false,
    root: null,
    python: null,
    uvAvailable: true,
    models: [],
    reason: "The subsai clone was not found next to the dashboard.",
  };
  const calls = state();
  const current = probeControl(job, expected, calls);
  const [left, right] = await Promise.all([
    probeClient.subsAiHealthViaRuntime({ userId: 17, control: current }),
    probeClient.subsAiHealthViaRuntime({ userId: 18, control: current }),
  ]);
  assert.deepEqual(left, expected);
  assert.deepEqual(right, expected);
  assert.equal(calls.submissions.length, 1, "concurrent health reads share one fixed probe");

  const cached = state();
  assert.deepEqual(await probeClient.subsAiHealthViaRuntime({
    userId: 19,
    control: probeControl(job, { ...expected, uvAvailable: false }, cached),
  }), expected);
  assert.equal(cached.submissions.length, 0, "a cached health read starts no process or worker");
});

test("all live SubsAI callers delegate without a dashboard process fallback", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const transcribe = read("src/lib/subsai/transcribe.ts");
  const transcript = read("src/lib/video-use/transcript.ts");
  const speech = read("src/lib/video-use/speech.ts");
  const health = read("src/app/api/video-use/health/route.ts");
  const setup = read("src/app/api/video-use/setup/route.ts");
  for (const [relative, source] of [
    ["src/lib/subsai/transcribe.ts", transcribe],
    ["src/lib/video-use/transcript.ts", transcript],
    ["src/lib/video-use/speech.ts", speech],
    ["src/app/api/video-use/health/route.ts", health],
    ["src/app/api/video-use/setup/route.ts", setup],
  ]) assert.doesNotMatch(
    source,
    /node:child_process|\bspawn\s*\(|\bspawnSync\s*\(|\bexecFile\s*\(/u,
    relative,
  );
  assert.match(transcribe, /transcribeWithSubsAiViaRuntime/u);
  assert.match(transcript, /runtimeScope: input\.runtimeScope/u);
  assert.match(speech, /subsAiInstalled\(\)/u);
  assert.doesNotMatch(speech, /subsai\/runtime/u);
  assert.match(health, /subsAiHealthViaRuntime\(\{ userId, signal: request\.signal \}\)/u);
  assert.doesNotMatch(health, /subsAiHealth\(|subsai\/runtime/u);
  assert.match(setup, /runManagedSetupJob/u);
  assert.match(setup, /invalidateSubsAiHealth/u);
  assert.doesNotMatch(setup, /subsai\/runtime/u);
  assert.match(read("scripts/runtime-v2-subsai-transcription-worker.mjs"), /spawn\(layout\.python/u);
  assert.match(read("scripts/runtime-v2-subsai-probe-worker.mjs"), /expectedInputCount:\s*\(\)\s*=>\s*0/u);
});
