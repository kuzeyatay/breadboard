import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  executeSpeechMedia,
  runSpeechMediaProcess,
  sealedSpeechMediaEnvironment,
  validateSpeechMediaRequest,
} from "../scripts/runtime-v2-speech-media-executor.mjs";
import {
  loadRuntimeV2SpeechMediaLaunch,
  parseRuntimeV2SpeechMediaStopRecord,
} from "../scripts/runtime-v2-speech-media-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(dashboardRoot, "scripts", "runtime-v2-speech-media-worker.mjs");
const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

function fixture({ operation = "video-visual-qc", inputSize = null, scope = null } = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-media-worker-test-"));
  const identity = {
    jobId: `job_media_${operation.replaceAll("-", "_")}`,
    attempt: 1,
    workerInstanceId: `worker_media_${operation.replaceAll("-", "_")}`,
  };
  const executionScope = scope ?? { userId: 17, gardenId: null, conversationId: null };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(jobRoot, "attempts", "1", identity.workerInstanceId);
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  const request = { protocolVersion: 1, operation };
  fs.writeFileSync(path.join(jobRoot, "input.json"), `${JSON.stringify(request)}\n`);
  const inputBlobs = inputSize === null
    ? []
    : [{
        blobId: "blob_media_input",
        relativePath: `runtime/jobs/${identity.jobId}/inputs/blob_media_input/payload`,
        sizeBytes: inputSize,
        sha256: "a".repeat(64),
        displayName: "recording.wav",
        mediaType: "audio/wav",
      }];
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope,
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs,
      workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    })}\n`,
  );
  return { dataRoot, identity, executionScope, jobRoot, attemptRoot };
}

async function runWorker(current) {
  const child = spawn(process.execPath, [workerPath, "start.json"], {
    cwd: current.attemptRoot,
    env: {
      ...process.env,
      BREADBOARD_RUNTIME_V2_MEDIA_FFMPEG_PATH: "",
      BREADBOARD_RUNTIME_V2_MEDIA_FFPROBE_PATH: "",
      BREADBOARD_RUNTIME_V2_MEDIA_YTDLP_PATH: "",
      BREADBOARD_RUNTIME_V2_MEDIA_PYTHON_PATH: "",
      BREADBOARD_RUNTIME_V2_MEDIA_VIDEO_USE_ROOT: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-64 * 1024); });
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The fresh speech/media worker did not exit."));
    }, 20_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  return { exit, stdout, stderr };
}

function fakeChild(pid = 41) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal = "SIGTERM") => {
    child.signalCode = signal;
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  return child;
}

function finishFake(child, { stdout = "", stderr = "", code = 0 } = {}) {
  queueMicrotask(() => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.exitCode = code;
    child.emit("close", code, null);
  });
}

test("speech/media loader accepts user-global authority and the exact 2 GiB input ceiling", () => {
  const current = fixture({ operation: "recording-segments", inputSize: MAX_MEDIA_BYTES });
  try {
    const launch = loadRuntimeV2SpeechMediaLaunch(["start.json"], current.attemptRoot);
    assert.deepEqual(launch.executionScope, { userId: 17, gardenId: null, conversationId: null });
    assert.equal(launch.inputBlobs[0].sizeBytes, MAX_MEDIA_BYTES);

    const manifestPath = path.join(current.attemptRoot, "start.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.inputBlobs[0].sizeBytes += 1;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.throws(
      () => loadRuntimeV2SpeechMediaLaunch(["start.json"], current.attemptRoot),
      /sealed speech\/media input/u,
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("speech/media protocol rejects renderer-selected process controls and forged stop input", () => {
  for (const extra of [
    { executable: "ffmpeg" },
    { argv: ["--help"] },
    { env: { OPENAI_API_KEY: "secret" } },
  ]) {
    assert.throws(
      () => validateSpeechMediaRequest({ protocolVersion: 1, operation: "speech-mp3", ...extra }),
      /request shape/u,
    );
  }
  assert.deepEqual(parseRuntimeV2SpeechMediaStopRecord('{"type":"stop","force":false}\n'), {
    type: "stop",
    force: false,
  });
  for (const invalid of [
    '{"type":"stop","force":true}\n',
    '{"type":"stop","force":false,"jobId":"forged"}\n',
    '{"type":"stop","force":false}',
  ]) assert.throws(() => parseRuntimeV2SpeechMediaStopRecord(invalid), /stop record/u);
});

test("a fresh visual-QC worker writes one fenced bounded result and exits", async () => {
  const current = fixture();
  try {
    const run = await runWorker(current);
    assert.deepEqual(run.exit, { code: 0, signal: null }, run.stderr);
    const events = run.stdout.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    assert.equal(events[0]?.type, "ready");
    assert.equal(events.at(-1)?.type, "complete");
    assert.ok(events.every((event, index) => event.sequence === index + 1));
    const result = JSON.parse(fs.readFileSync(path.join(current.jobRoot, "result.json"), "utf8"));
    assert.deepEqual(result.identity, current.identity);
    assert.equal(result.completionSequence, events.at(-1).sequence);
    assert.deepEqual(result.result, {
      ok: true,
      operation: "video-visual-qc",
      available: false,
    });
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("fixed speech and download operations use sealed argv and strip service secrets", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-media-executor-test-"));
  try {
    const workspacePath = path.join(dataRoot, "workspace");
    const toolsPath = path.join(dataRoot, "tools");
    fs.mkdirSync(workspacePath);
    fs.mkdirSync(toolsPath);
    const ffmpeg = path.join(toolsPath, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const ytdlp = path.join(toolsPath, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    fs.writeFileSync(ffmpeg, "fixed ffmpeg fixture");
    fs.writeFileSync(ytdlp, "fixed yt-dlp fixture");
    const input = path.join(dataRoot, "speech.wav");
    fs.writeFileSync(input, "wave");
    const calls = [];
    const checkpoints = [];
    const spawnImpl = (command, args, options) => {
      const child = fakeChild(100 + calls.length);
      calls.push({ command, args: [...args], options });
      if (args.includes("--dump-single-json")) {
        finishFake(child, {
          stdout: JSON.stringify({ title: "Clip", duration: 12, is_live: false, ext: "mp4" }),
        });
      } else if (args.includes("--max-filesize")) {
        const template = args[args.indexOf("-o") + 1];
        fs.writeFileSync(template.replace("%(ext)s", "mp4"), "video");
        finishFake(child, { stdout: "[download]  42.3% of 10.00MiB at 3.11MiB/s\n" });
      } else {
        fs.writeFileSync(args.at(-1), "mp3");
        finishFake(child);
      }
      return child;
    };
    const context = {
      dataRoot,
      workspacePath,
      executionScope: { userId: 17, gardenId: null, conversationId: null },
      inputPaths: [input],
      signal: new AbortController().signal,
      checkpoint: (value) => checkpoints.push(value),
      env: {
        ...process.env,
        BREADBOARD_RUNTIME_V2_MEDIA_FFMPEG_PATH: ffmpeg,
        BREADBOARD_RUNTIME_V2_MEDIA_YTDLP_PATH: ytdlp,
        OPENAI_API_KEY: "must-not-cross",
        BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "must-not-cross",
      },
      spawnImpl,
    };
    const speech = await executeSpeechMedia(
      { protocolVersion: 1, operation: "speech-mp3" },
      context,
    );
    assert.equal(speech.ok, true);
    assert.deepEqual(calls[0].args.slice(0, 4), ["-nostdin", "-y", "-loglevel", "error"]);

    context.inputPaths = [];
    const downloaded = await executeSpeechMedia(
      {
        protocolVersion: 1,
        operation: "video-source-download",
        source: { canonicalUrl: "https://example.com/clip.mp4", label: "clip.mp4" },
      },
      context,
    );
    assert.equal(downloaded.ok, true);
    const downloadCall = calls.find((call) => call.args.includes("--max-filesize"));
    assert.ok(downloadCall);
    assert.ok(downloadCall.args.includes("--ignore-config"));
    assert.ok(downloadCall.args.includes("--no-playlist"));
    assert.deepEqual(downloadCall.args.slice(-2), ["--", "https://example.com/clip.mp4"]);
    assert.ok(checkpoints.some((item) => item.percent === 42.3));
    for (const call of calls) {
      assert.equal(call.options.shell, false);
      assert.equal(call.options.env.OPENAI_API_KEY, undefined);
      assert.equal(call.options.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
    }

    const sealed = sealedSpeechMediaEnvironment({
      PATH: "untrusted",
      OPENAI_API_KEY: "secret",
      BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "control",
    }, { ffmpeg, ytdlp });
    assert.equal(sealed.OPENAI_API_KEY, undefined);
    assert.equal(sealed.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
    assert.notEqual(sealed.PATH, "untrusted");
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("Runtime cancellation terminates the owned process tree and returns no partial success", async () => {
  const controller = new AbortController();
  let terminated = 0;
  const child = fakeChild(404);
  const running = runSpeechMediaProcess("fixed-tool", [], {
    timeoutMs: 10_000,
    signal: controller.signal,
    env: {},
    runtimeEnv: {},
    spawnImpl: () => child,
    terminateImpl: async (owned) => {
      assert.equal(owned, child);
      terminated += 1;
      child.signalCode = "SIGKILL";
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    },
  });
  controller.abort(new DOMException("Stopped", "AbortError"));
  await assert.rejects(running, (error) => error?.name === "AbortError");
  assert.equal(terminated, 1);
});

test("dashboard speech/media callers contain no direct process fallback", () => {
  for (const relative of [
    "src/lib/speech/synthesis.ts",
    "src/lib/speech/recording-transcription.ts",
    "src/lib/video-sources/download.ts",
    "src/lib/video-use/media.ts",
    "src/lib/video-use/render.ts",
    "src/lib/video-use/transcript.ts",
    "src/lib/video-use/runtime.ts",
  ]) {
    const source = fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
    assert.doesNotMatch(source, /node:child_process|\bspawn\(|\bspawnSync\(|\bexecFile\(/u, relative);
  }
});
