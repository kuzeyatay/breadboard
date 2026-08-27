import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeWatch,
  expectedWatchInputCount,
  validatePublicWatchUrl,
  validateWatchExecutionScope,
  validateWatchRequest,
} from "../scripts/runtime-v2-watch-executor.mjs";

function request(overrides = {}) {
  return {
    protocolVersion: 1,
    operation: "watch-run",
    sourceKind: "local",
    source: "C:\\workspace\\clip.mp4",
    options: {
      question: "What changes?",
      detail: "efficient",
      start: null,
      end: null,
      timestamps: [],
      maxFrames: null,
      resolution: null,
      fps: null,
      whisper: null,
      noWhisper: true,
      noDedup: false,
    },
    ...overrides,
  };
}

function fixture() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-watch-worker-"));
  const workspacePath = path.join(dataRoot, "runtime", "jobs", "job_watch", "attempts",
    "1", "worker_watch", "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  const skillRoot = path.join(dataRoot, "watch-skill");
  const scripts = path.join(skillRoot, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  const runner = path.join(scripts, "watch.py");
  fs.writeFileSync(runner, [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const source = process.argv[2];',
    'const out = process.argv[process.argv.indexOf("--out-dir") + 1];',
    'const frames = path.join(out, "frames");',
    'fs.mkdirSync(frames, { recursive: true });',
    'const frame = path.join(frames, "frame_0001.jpg");',
    'fs.writeFileSync(frame, "jpeg");',
    'console.log("# watch: video report");',
    'console.log("- **Source:** " + source);',
    'console.log("- **Title:** " + path.basename(source));',
    'console.log("- `" + frame + "` (t=00:01, reason=selected)");',
    'console.log("## Transcript\\n\\n[00:00] hello");',
  ].join("\n"));
  const inputPath = path.join(dataRoot, "runtime", "jobs", "job_watch", "inputs", "input", "payload");
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.writeFileSync(inputPath, "video");
  const launch = {
    dataRoot,
    identity: { jobId: "job_watch", attempt: 1, workerInstanceId: "worker_watch" },
    executionScope: { userId: 7, gardenId: null, conversationId: "conversation-watch" },
    request: request(),
    inputBlobs: [],
    workspacePath,
  };
  const env = {
    NODE_ENV: "test",
    BREADBOARD_WATCH_ROOT: skillRoot,
    BREADBOARD_WATCH_PYTHON: process.execPath,
    FFMPEG_PATH: process.execPath,
    FFPROBE_PATH: process.execPath,
    YTDLP_PATH: process.execPath,
    ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
    ...(process.env.COMSPEC ? { COMSPEC: process.env.COMSPEC } : {}),
    ...(process.env.PATHEXT ? { PATHEXT: process.env.PATHEXT } : {}),
  };
  return { dataRoot, inputPath, launch, env };
}

function cleanup(value) {
  fs.rmSync(value.dataRoot, { recursive: true, force: true });
}

test("Watch worker accepts only its exact authenticated protocol", () => {
  assert.equal(expectedWatchInputCount(validateWatchRequest(request())), 1);
  assert.equal(expectedWatchInputCount(validateWatchRequest(request({
    sourceKind: "remote",
    source: "https://example.com/video.mp4",
  }))), 0);
  assert.deepEqual(validateWatchExecutionScope({
    userId: 7,
    gardenId: null,
    conversationId: "conversation-watch",
  }), {
    userId: 7,
    gardenId: null,
    conversationId: "conversation-watch",
  });
  assert.throws(() => validateWatchRequest({ ...request(), extra: true }), /request is invalid/i);
  assert.throws(() => validateWatchExecutionScope({
    userId: 7,
    gardenId: null,
    conversationId: null,
  }), /conversation scope/i);
});

test("Watch worker rejects DNS names that resolve into private networks", async () => {
  for (const address of ["127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:0:0:1", "fc00::1"]) {
    await assert.rejects(
      validatePublicWatchUrl(
        "https://video.example/media.mp4",
        async () => [{ address, family: address.includes(":") ? 6 : 4 }],
      ),
      (error) => error?.code === "watch_private_url_denied",
      address,
    );
  }
  assert.equal(
    await validatePublicWatchUrl(
      "https://video.example/media.mp4",
      async () => [{ address: "93.184.216.34", family: 4 }],
    ),
    "https://video.example/media.mp4",
  );
});

test("Watch worker keeps report and frames in its private attempt and preserves local source identity", async () => {
  const value = fixture();
  try {
    const result = await executeWatch(
      value.launch,
      new AbortController().signal,
      {},
      value.inputPath,
      { env: value.env },
    );
    assert.equal(result.ok, true);
    assert.equal(result.frameCount, 1);
    assert.equal(result.analyzedFrameCount, 0);
    assert.match(result.chatmockWarning, /ChatMock is not configured/);
    assert.match(result.reportRelativePath, /workspace\/watch-output\/report\.md$/);
    const reportPath = path.join(value.dataRoot, ...result.reportRelativePath.split("/"));
    const report = fs.readFileSync(reportPath, "utf8");
    assert.match(report, /Source:\*\* C:\\workspace\\clip\.mp4/);
    assert.match(report, /Title:\*\* clip\.mp4/);
    assert.doesNotMatch(JSON.stringify(result), /data:image|base64|frame_0001\.jpg/);
  } finally {
    cleanup(value);
  }
});

test("Watch worker sends frame bytes only over sealed internal ChatMock access", async () => {
  const value = fixture();
  let requestBody;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ output_text: "At 00:01 the interface changes." }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await executeWatch(
      value.launch,
      new AbortController().signal,
      {},
      value.inputPath,
      {
        env: {
          ...value.env,
          CHATMOCK_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          CHATMOCK_API_KEY: "local",
          CHATMOCK_MODEL: "default",
        },
      },
    );
    assert.equal(requestBody.model, "default");
    assert.ok(requestBody.input[0].content.some((part) =>
      part.type === "input_image" && part.image_url.startsWith("data:image/jpeg;base64,")));
    assert.match(result.chatmockAnalysis, /interface changes/);
    assert.equal(result.analyzedFrameCount, 1);
    assert.doesNotMatch(JSON.stringify(result), /data:image|base64/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup(value);
  }
});

test("Watch worker cancellation terminates the media child", async () => {
  const value = fixture();
  fs.writeFileSync(path.join(value.launch.workspacePath, "cancel-marker"), "ready");
  fs.writeFileSync(path.join(value.env.BREADBOARD_WATCH_ROOT, "scripts", "watch.py"),
    "setInterval(() => {}, 1000);\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("cancel", "AbortError")), 100);
  try {
    await assert.rejects(
      executeWatch(value.launch, controller.signal, {}, value.inputPath, { env: value.env }),
      (error) => error?.name === "AbortError",
    );
  } finally {
    clearTimeout(timer);
    cleanup(value);
  }
});

test("Watch staging closure is explicit and Next has no subprocess fallback", () => {
  const worker = fs.readFileSync(new URL("../scripts/runtime-v2-watch-worker.mjs", import.meta.url), "utf8");
  const executor = fs.readFileSync(new URL("../scripts/runtime-v2-watch-executor.mjs", import.meta.url), "utf8");
  const service = fs.readFileSync(new URL("../src/lib/hermes/watch-service.ts", import.meta.url), "utf8");
  assert.match(worker, /runtime-v2-watch-executor\.mjs/);
  assert.match(worker, /runtime-v2-finite-mcp-worker-core\.mjs/);
  for (const source of ["watch.py", "config.py", "download.py", "frames.py", "transcribe.py", "whisper.py"]) {
    assert.ok(fs.existsSync(new URL(`../../hermes-skills/prebuilt/watch/scripts/${source}`, import.meta.url)));
  }
  assert.match(executor, /BREADBOARD_WATCH_ROOT/);
  assert.doesNotMatch(service, /node:child_process|\bspawn\s*\(/);
});
