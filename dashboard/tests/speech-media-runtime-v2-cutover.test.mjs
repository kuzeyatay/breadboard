import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntimeModule() {
  const result = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "speech-media-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "speech-media-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "speech-media-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "speech-media-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "speech-media-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "speech-media-stub" }, () => ({
          loader: "js",
          contents: `
            const unused = async () => { throw new Error("use the injected speech/media control"); };
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
  const source = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}#speech-media-runtime-v2`);
}

const runtime = await loadRuntimeModule();

function jobSnapshot(overrides = {}) {
  return {
    jobId: `job_${"a".repeat(64)}`,
    jobType: "speech-media",
    workerKind: "speech-media-node",
    resourceClass: "media-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_media_1",
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

function fakeControl(job, result, state) {
  return {
    async reserve(authority, request) {
      state.reservations.push({ authority: structuredClone(authority), request: structuredClone(request) });
      return {
        uploadId: "upload_media_1",
        expiresAt: Date.now() + 60_000,
        maximumBytes: request.declaredSizeBytes,
        ...request,
      };
    },
    async upload(authority, reservation, body) {
      const reader = body.getReader();
      const chunks = [];
      let sizeBytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        sizeBytes += value.byteLength;
      }
      state.uploads.push({ authority: structuredClone(authority), bytes: Buffer.concat(chunks) });
      return {
        uploadId: reservation.uploadId,
        sizeBytes,
        sha256: "b".repeat(64),
        displayName: reservation.displayName,
        mediaType: reservation.mediaType,
      };
    },
    async abandon(authority, uploadId) {
      state.abandoned.push({ authority: structuredClone(authority), uploadId });
    },
    async submit(authority, submission) {
      state.submissions.push({ authority: structuredClone(authority), submission: structuredClone(submission) });
      return structuredClone(job);
    },
    async inspect() {
      throw new Error("terminal fixture must not poll");
    },
    async readOutput(authority, jobId, kind) {
      state.outputs.push({ authority: structuredClone(authority), jobId, kind });
      return { jobId, kind, content: envelope(job, result, state.identityOverride) };
    },
    async cancel(authority, jobId) {
      state.cancellations.push({ authority: structuredClone(authority), jobId });
      return { ...job, state: "cancelled" };
    },
  };
}

function freshState() {
  return {
    reservations: [],
    uploads: [],
    abandoned: [],
    submissions: [],
    outputs: [],
    cancellations: [],
    identityOverride: {},
  };
}

function attemptStage(dataRoot, job) {
  return path.join(
    dataRoot,
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "media-stage",
  );
}

function relativeTo(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

test("speech MP3 submits exact user-global authority through one sealed upload", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-media-client-test-"));
  const priorDataRoot = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  const job = jobSnapshot();
  const stage = attemptStage(dataRoot, job);
  fs.mkdirSync(stage, { recursive: true });
  const output = path.join(stage, "speech.mp3");
  fs.writeFileSync(output, "bounded mp3");
  const state = freshState();
  const result = {
    ok: true,
    operation: "speech-mp3",
    outputRelativePath: relativeTo(dataRoot, output),
    sizeBytes: fs.statSync(output).size,
  };
  try {
    const bytes = await runtime.encodeSpeechMp3ViaRuntime(
      { userId: 17, gardenId: null, conversationId: null },
      new Uint8Array(Buffer.from("voicebox wav")),
      { control: fakeControl(job, result, state) },
    );
    assert.equal(Buffer.from(bytes).toString(), "bounded mp3");
    assert.deepEqual(state.reservations[0].authority, {
      userId: 17,
      gardenId: null,
      conversationId: null,
    });
    assert.equal(state.uploads[0].bytes.toString(), "voicebox wav");
    const submission = state.submissions[0].submission;
    assert.equal(submission.jobType, "speech-media");
    assert.deepEqual(submission.inputUploads, [{ uploadId: "upload_media_1" }]);
    assert.deepEqual(submission.requestPayload, {
      protocolVersion: 1,
      operation: "speech-mp3",
    });
    assert.match(submission.idempotencyKey, /^speech-media-v2:[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(submission), /executable|argv|OPENAI_API_KEY|CONTROL_TOKEN/u);
    assert.equal(fs.existsSync(stage), false, "the consumed attempt stage must be removed");
  } finally {
    if (priorDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = priorDataRoot;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("speech/media client rejects an identity-fenced or out-of-stage result", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-media-fence-test-"));
  const priorDataRoot = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  try {
    const job = jobSnapshot();
    const stage = attemptStage(dataRoot, job);
    fs.mkdirSync(stage, { recursive: true });
    const outside = path.join(dataRoot, "not-this-job.mp3");
    fs.writeFileSync(outside, "outside");
    const result = {
      ok: true,
      operation: "speech-mp3",
      outputRelativePath: relativeTo(dataRoot, outside),
      sizeBytes: fs.statSync(outside).size,
    };
    const state = freshState();
    await assert.rejects(
      runtime.encodeSpeechMp3ViaRuntime(
        { userId: 17, gardenId: null, conversationId: null },
        new Uint8Array([1]),
        { control: fakeControl(job, result, state) },
      ),
      /private attempt stage/u,
    );

    fs.mkdirSync(stage, { recursive: true });
    const output = path.join(stage, "speech.mp3");
    fs.writeFileSync(output, "inside");
    state.identityOverride = { workerInstanceId: "worker_forged" };
    await assert.rejects(
      runtime.encodeSpeechMp3ViaRuntime(
        { userId: 17, gardenId: null, conversationId: null },
        new Uint8Array([2]),
        {
          control: fakeControl(job, {
            ...result,
            outputRelativePath: relativeTo(dataRoot, output),
            sizeBytes: fs.statSync(output).size,
          }, state),
        },
      ),
      /worker fence/u,
    );
  } finally {
    if (priorDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = priorDataRoot;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("Video Use render projects presentation fields out of the fixed Runtime request", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-media-render-test-"));
  const priorDataRoot = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  const job = jobSnapshot({ conversationId: "conv_media_test" });
  const sessionRoot = path.join(dataRoot, "video-use", "17", "art_abcdef");
  const editDir = path.join(sessionRoot, "edit");
  fs.mkdirSync(editDir, { recursive: true });
  const assembled = path.join(editDir, "assembled.mp4");
  fs.writeFileSync(assembled, "rendered");
  const session = {
    artifactId: "art_abcdef",
    root: sessionRoot,
    sourcePath: path.join(sessionRoot, "source", "source.mp4"),
    editDir,
    transcriptsDir: path.join(editDir, "transcripts"),
    transcriptPath: path.join(editDir, "transcripts", "source.json"),
    packedTranscriptPath: path.join(editDir, "takes_packed.md"),
    edlPath: path.join(editDir, "edl.json"),
    outputPath: path.join(editDir, "final.mp4"),
  };
  const state = freshState();
  const result = {
    ok: true,
    operation: "video-render",
    outputRelativePath: relativeTo(dataRoot, assembled),
    durationSeconds: 4,
    sizeBytes: 8,
    width: 1920,
    height: 1080,
  };
  try {
    const rendered = await runtime.renderVideoProgramViaRuntime(
      { userId: 17, gardenId: null, conversationId: "conv_media_test" },
      session,
      {
        ranges: [{ start: 0, end: 4, reason: "keep" }],
        grade: null,
        aspect: "original",
        subtitles: "none",
        transform: {
          speed: 1,
          mute: false,
          volumeDb: 0,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
          reverse: false,
        },
        summary: "presentation only",
      },
      "final",
      { control: fakeControl(job, result, state) },
    );
    assert.equal(rendered.outputPath, assembled);
    const request = state.submissions[0].submission.requestPayload;
    assert.deepEqual(Object.keys(request.program).sort(), [
      "aspect", "grade", "ranges", "subtitles", "transform",
    ]);
    assert.equal("summary" in request.program, false);
    assert.deepEqual(state.submissions[0].authority, {
      userId: 17,
      gardenId: null,
      conversationId: "conv_media_test",
    });
  } finally {
    if (priorDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = priorDataRoot;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("an aborted dashboard request asks Runtime to cancel the finite media job", async () => {
  const job = jobSnapshot({ state: "queued", stage: "queued", finishedAt: null });
  const state = freshState();
  const control = fakeControl(job, {}, state);
  const controller = new AbortController();
  controller.abort(new DOMException("Stopped", "AbortError"));
  await assert.rejects(
    runtime.probeVideoVisualQcViaRuntime(
      { userId: 17, gardenId: null, conversationId: null },
      { signal: controller.signal, control },
    ),
    (error) => error?.name === "AbortError",
  );
  assert.deepEqual(state.cancellations, [{
    authority: { userId: 17, gardenId: null, conversationId: null },
    jobId: job.jobId,
  }]);
});
