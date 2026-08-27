import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  resolveWatchSource,
  runWatch,
  validateWatchOptions,
  WatchServiceError,
} from "../src/lib/hermes/watch-service.ts";
import { watchCommandText } from "../src/lib/hermes/watch-intent.ts";
import {
  prepareVideosForWatch,
  recentVideoAttachment,
  renderWatchVideoContext,
  videoAttachments,
} from "../src/lib/hermes/watch-turn.ts";
import { writeVideoBlob } from "../src/lib/conversations/video-blob-store.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("Watch is a ready ChatMock-compatible prebuilt Terminal skill", () => {
  const terminal = listFirstPartySkills("dashboard_terminal").find(
    (skill) => skill.slug === "watch",
  );
  assert.ok(terminal);
  assert.equal(terminal.availability, "ready");
  assert.equal(terminal.category, "Featured");
  assert.deepEqual(terminal.capabilityContract?.requiredTools, ["watch_run"]);
  assert.deepEqual(terminal.capabilityContract?.requiredBinaries, [
    "python",
    "ffmpeg",
    "ffprobe",
    "yt-dlp",
  ]);

  for (const surface of ["garden_chat", "quartz_ai"]) {
    const candidate = listFirstPartySkills(surface).find(
      (skill) => skill.slug === "watch",
    );
    assert.ok(candidate);
    assert.notEqual(candidate.availability, "ready");
  }
});

test("Watch guidance uses the guarded runtime and has no Claude-only tool dependency", () => {
  const manifest = source("../hermes-skills/prebuilt/watch/SKILL.md");
  const openai = source("../hermes-skills/prebuilt/watch/agents/openai.yaml");
  const tool = source("../hermes-config/tool/watch.ts");
  const route = source("src/app/api/hermes/tools/watch/route.ts");

  assert.match(manifest, /Breadboard and ChatMock workflow/);
  assert.match(manifest, /requiredTools:\s*\n\s*- watch_run/);
  assert.match(manifest, /image-capable file reader/);
  assert.doesNotMatch(manifest, /AskUserQuestion|Claude Read compatibility|hands the result to Claude/);
  assert.match(openai, /Use \$watch/);
  assert.match(tool, /api\/hermes\/tools\/watch/);
  assert.match(route, /selectedConditionalSkills\.includes\("watch"\)/);
  assert.match(route, /session\.surface !== "dashboard_terminal"/);
});

test("Watch arguments are bounded before a process is launched", () => {
  assert.deepEqual(validateWatchOptions({
    source: "https://example.com/video.mp4",
    question: "Summarize it",
  }), {
    source: "https://example.com/video.mp4",
    question: "Summarize it",
    detail: "balanced",
    start: undefined,
    end: undefined,
    timestamps: [],
    maxFrames: undefined,
    resolution: undefined,
    fps: undefined,
    whisper: undefined,
    noWhisper: false,
    noDedup: false,
  });
  assert.throws(
    () => validateWatchOptions({ source: "x", question: "Summarize", detail: "unbounded" }),
    (error) => error instanceof WatchServiceError && error.code === "watch_invalid_arguments",
  );
  assert.throws(
    () => validateWatchOptions({ source: "x", question: "Summarize", fps: 3 }),
    (error) => error instanceof WatchServiceError && error.code === "watch_invalid_arguments",
  );
});

test("Watch confines local files and rejects private-network URLs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-watch-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-watch-outside-"));
  try {
    const local = path.join(root, "clip.mp4");
    const escaped = path.join(outside, "clip.mp4");
    fs.writeFileSync(local, "video");
    fs.writeFileSync(escaped, "video");
    assert.equal(resolveWatchSource("clip.mp4", root), fs.realpathSync.native(local));
    assert.throws(
      () => resolveWatchSource(escaped, root),
      (error) => error instanceof WatchServiceError && error.code === "watch_source_outside_workspace",
    );
    assert.throws(
      () => resolveWatchSource("http://127.0.0.1/private.mp4", root),
      (error) => error instanceof WatchServiceError && error.code === "watch_private_url_denied",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("Watch seals a local workspace video into an authenticated Runtime job", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-watch-workspace-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-watch-runtime-"));
  const jobId = "job_watch_test";
  const workerInstanceId = "worker_watch_test";
  const output = path.join(dataRoot, "runtime", "jobs", jobId, "attempts", "1",
    workerInstanceId, "workspace", "watch-output");
  const frames = path.join(output, "frames");
  fs.mkdirSync(frames, { recursive: true });
  const frame = path.join(frames, "frame_0001.jpg");
  fs.writeFileSync(frame, "jpeg");
  const report = [
    "# watch: video report",
    `- \`${frame}\` (t=00:01, reason=selected)`,
    "## Transcript",
    "",
    "[00:00] hello",
  ].join("\n");
  const reportPath = path.join(output, "report.md");
  fs.writeFileSync(reportPath, `${report}\n`);
  const relative = (value) => path.relative(dataRoot, value).split(path.sep).join("/");
  const snapshot = {
    jobId,
    jobType: "watch-run",
    workerKind: "watch-media-node",
    resourceClass: "media-processing",
    state: "succeeded",
    stage: "completed",
    attempt: 1,
    workerInstanceId,
    lastWorkerSequence: 4,
    gardenId: null,
    conversationId: "conversation-watch",
  };
  let submitted;
  let uploadedBytes;
  const control = {
    configured: () => true,
    reserve: async (_authority, request) => ({
      uploadId: "upload_watch_test",
      expiresAt: Date.now() + 60_000,
      maximumBytes: request.declaredSizeBytes,
      ...request,
    }),
    upload: async (_authority, reservation, body) => {
      uploadedBytes = Buffer.from(await new Response(body).arrayBuffer());
      return {
        uploadId: reservation.uploadId,
        sizeBytes: reservation.declaredSizeBytes,
        sha256: "a".repeat(64),
        displayName: reservation.displayName,
        mediaType: reservation.mediaType,
      };
    },
    abandon: async () => undefined,
    submit: async (_authority, value) => {
      submitted = value;
      return snapshot;
    },
    inspect: async () => snapshot,
    cancel: async () => ({ ...snapshot, state: "cancelled" }),
    readOutput: async () => ({
      jobId,
      kind: "result",
      content: {
        protocolVersion: 1,
        identity: { jobId, attempt: 1, workerInstanceId },
        completionSequence: 4,
        result: {
          ok: true,
          operation: "watch-run",
          reportRelativePath: relative(reportPath),
          reportSizeBytes: fs.statSync(reportPath).size,
          workDirectoryRelativePath: relative(output),
          frameCount: 1,
          analyzedFrameCount: 0,
          chatmockAnalysis: null,
          chatmockWarning: "ChatMock is not configured, so the runtime returned raw transcript and frame evidence only.",
          durationMs: 25,
          stderr: "",
        },
      },
    }),
  };
  try {
    const clip = path.join(workspace, "clip.mp4");
    fs.writeFileSync(clip, "video");
    const result = await runWatch({
      userId: 7,
      conversationId: "conversation-watch",
      args: { source: clip, question: "What happens?", detail: "efficient", noWhisper: true },
      workspaceRoot: workspace,
      env: { BREADBOARD_DATA_DIR: dataRoot },
      control,
      timeoutMs: 10_000,
    });
    assert.equal(uploadedBytes.toString("utf8"), "video");
    assert.equal(submitted.jobType, "watch-run");
    assert.equal(submitted.inputUploads[0].uploadId, "upload_watch_test");
    assert.equal(submitted.requestPayload.sourceKind, "local");
    assert.equal(submitted.requestPayload.source, fs.realpathSync.native(clip));
    assert.match(result.report, /watch: video report/);
    assert.deepEqual(result.framePaths, [{ path: frame, timestamp: "00:01" }]);
    assert.equal(result.workDirectory, output);
    assert.match(result.chatmockWarning ?? "", /ChatMock is not configured/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("Watch has no Next-owned process or ChatMock frame fallback after cutover", () => {
  const service = source("src/lib/hermes/watch-service.ts");
  const worker = source("scripts/runtime-v2-watch-worker.mjs");
  const executor = source("scripts/runtime-v2-watch-executor.mjs");
  assert.doesNotMatch(service, /node:child_process|\bspawn\s*\(/);
  assert.doesNotMatch(service, /CHATMOCK_BASE_URL|input_image|readFileSync\(frame/);
  assert.match(service, /reserveRuntimeJobInput/);
  assert.match(worker, /canonicalRuntimeInputAsync/);
  assert.match(executor, /input_image/);
});

test("Watch cancellation propagates to the exact active Runtime job", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-watch-cancel-"));
  const controller = new AbortController();
  let cancelledJob = null;
  const running = {
    jobId: "job_watch_cancel",
    jobType: "watch-run",
    workerKind: "watch-media-node",
    resourceClass: "media-processing",
    state: "running",
    stage: "processing",
    attempt: 1,
    workerInstanceId: "worker_watch_cancel",
    lastWorkerSequence: 2,
    gardenId: null,
    conversationId: "conversation-watch",
  };
  const control = {
    configured: () => true,
    reserve: async () => { throw new Error("remote Watch must not reserve an input"); },
    upload: async () => { throw new Error("remote Watch must not upload an input"); },
    abandon: async () => undefined,
    submit: async () => running,
    inspect: async () => running,
    readOutput: async () => { throw new Error("cancelled Watch must not read output"); },
    cancel: async (_authority, jobId) => {
      cancelledJob = jobId;
      return { ...running, state: "cancelled" };
    },
  };
  const timer = setTimeout(() => controller.abort(new DOMException("cancel", "AbortError")), 25);
  try {
    await assert.rejects(runWatch({
      userId: 7,
      conversationId: "conversation-watch",
      args: {
        source: "https://example.com/video.mp4",
        question: "What happens?",
      },
      workspaceRoot: root,
      signal: controller.signal,
      env: { BREADBOARD_DATA_DIR: root },
      control,
      timeoutMs: 10_000,
    }), (error) => error instanceof WatchServiceError && error.code === "watch_cancelled");
    assert.equal(cancelledJob, "job_watch_cancel");
  } finally {
    clearTimeout(timer);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Watch rejects result paths outside the completed worker identity fence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-watch-fence-"));
  const jobId = "job_watch_fence";
  const workerInstanceId = "worker_watch_fence";
  const output = path.join(root, "runtime", "jobs", jobId, "attempts", "1",
    workerInstanceId, "workspace", "watch-output");
  fs.mkdirSync(output, { recursive: true });
  const escapedReport = path.join(root, "outside", "escaped.md");
  fs.mkdirSync(path.dirname(escapedReport), { recursive: true });
  fs.writeFileSync(escapedReport, "# escaped\n");
  const relative = (value) => path.relative(root, value).split(path.sep).join("/");
  const snapshot = {
    jobId,
    jobType: "watch-run",
    workerKind: "watch-media-node",
    resourceClass: "media-processing",
    state: "succeeded",
    stage: "completed",
    attempt: 1,
    workerInstanceId,
    lastWorkerSequence: 4,
    gardenId: null,
    conversationId: "conversation-watch",
  };
  const control = {
    configured: () => true,
    reserve: async () => { throw new Error("remote Watch must not reserve an input"); },
    upload: async () => { throw new Error("remote Watch must not upload an input"); },
    abandon: async () => undefined,
    submit: async () => snapshot,
    inspect: async () => snapshot,
    cancel: async () => ({ ...snapshot, state: "cancelled" }),
    readOutput: async () => ({
      jobId,
      kind: "result",
      content: {
        protocolVersion: 1,
        identity: { jobId, attempt: 1, workerInstanceId },
        completionSequence: 4,
        result: {
          ok: true,
          operation: "watch-run",
          reportRelativePath: relative(escapedReport),
          reportSizeBytes: fs.statSync(escapedReport).size,
          workDirectoryRelativePath: relative(output),
          frameCount: 0,
          analyzedFrameCount: 0,
          chatmockAnalysis: null,
          chatmockWarning: null,
          durationMs: 1,
          stderr: "",
        },
      },
    }),
  };
  try {
    await assert.rejects(runWatch({
      userId: 7,
      conversationId: "conversation-watch",
      args: { source: "https://example.com/video.mp4", question: "What happens?" },
      workspaceRoot: root,
      env: { BREADBOARD_DATA_DIR: root },
      control,
      timeoutMs: 10_000,
    }), (error) => error instanceof WatchServiceError &&
      error.code === "watch_processing_failed" && /outside/i.test(error.message));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Watch cancels an uncertain submission by its one-time idempotency fence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-watch-uncertain-"));
  let submittedKey = null;
  let cancelledKey = null;
  const control = {
    configured: () => true,
    reserve: async () => { throw new Error("remote Watch must not reserve an input"); },
    upload: async () => { throw new Error("remote Watch must not upload an input"); },
    abandon: async () => undefined,
    submit: async (_authority, submission) => {
      submittedKey = submission.idempotencyKey;
      throw new Error("connection closed after admission");
    },
    inspect: async () => { throw new Error("unreachable"); },
    readOutput: async () => { throw new Error("unreachable"); },
    cancel: async () => { throw new Error("job identity was not returned"); },
    cancelByIdempotencyKey: async (_authority, key) => {
      cancelledKey = key;
      return { jobId: "job_watch_uncertain", state: "cancelled", accepted: true };
    },
  };
  try {
    await assert.rejects(runWatch({
      userId: 7,
      conversationId: "conversation-watch",
      args: { source: "https://example.com/video.mp4", question: "What happens?" },
      workspaceRoot: root,
      env: { BREADBOARD_DATA_DIR: root },
      control,
      timeoutMs: 10_000,
    }), (error) => error instanceof WatchServiceError && error.code === "watch_processing_failed");
    assert.match(submittedKey, /^watch-run-v2:/);
    assert.equal(cancelledKey, submittedKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function selection(overrides) {
  return watchCommandText({
    text: "",
    surface: "dashboard_terminal",
    authenticated: true,
    hasVideoAttachment: false,
    ...overrides,
  });
}

test("An attached video selects Watch without the user typing a command", () => {
  for (const text of [
    "what happens in this video?",
    "who is talking here",
    "summarise it",
    "",
    "is the wiring in this correct",
  ]) {
    const chosen = selection({ text, hasVideoAttachment: true });
    assert.equal(chosen.automatic, true, text);
    assert.equal(chosen.text, `/watch ${text}`);
  }

  // Handling the file rather than reading it leaves the turn alone.
  assert.equal(selection({ text: "just save this to Downloads", hasVideoAttachment: true }).automatic, false);
  assert.equal(selection({ text: "post it on the calendar", hasVideoAttachment: true }).automatic, false);
  // …unless the same sentence also asks what is in it.
  assert.equal(
    selection({ text: "save this and tell me what happens at the end", hasVideoAttachment: true }).automatic,
    true,
  );

  // An explicit command already says what the turn is.
  assert.equal(selection({ text: "/premortem this plan", hasVideoAttachment: true }).automatic, false);
  // Watch only exists where its workspace does, and only for a signed-in user.
  assert.equal(
    selection({ text: "what is in this", hasVideoAttachment: true, surface: "garden_chat" }).automatic,
    false,
  );
  assert.equal(
    selection({ text: "what is in this", hasVideoAttachment: true, authenticated: false }).automatic,
    false,
  );
});

test("A video link or an earlier attachment selects Watch only when the turn asks about content", () => {
  assert.equal(
    selection({ text: "summarise https://www.youtube.com/watch?v=abc123" }).automatic,
    true,
  );
  assert.equal(
    selection({ text: "what does https://example.com/talk.mp4 cover?" }).automatic,
    true,
  );
  // A bare link with no question is not a request to watch anything.
  assert.equal(selection({ text: "https://www.youtube.com/watch?v=abc123" }).automatic, false);
  // Nor is a page that merely mentions video.
  assert.equal(selection({ text: "what is on https://example.com/blog" }).automatic, false);

  // A follow-up about a video attached a question or two ago still reaches it.
  assert.equal(
    selection({ text: "what happens at 2:10?", hasRecentVideoAttachment: true }).automatic,
    true,
  );
  assert.equal(
    selection({ text: "thanks, that was helpful", hasRecentVideoAttachment: true }).automatic,
    false,
  );
});

test("An attached video is linked into the workspace and named as the watch_run source", async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-video-store-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-video-workspace-"));
  const previousStore = process.env.BREADBOARD_CHAT_VIDEO_DIR;
  process.env.BREADBOARD_CHAT_VIDEO_DIR = store;
  try {
    const stored = await writeVideoBlob({
      userId: 7,
      format: "mp4",
      body: new Blob(["not really a video"]).stream(),
    });
    assert.match(stored.blobId, /^vid_[0-9a-f]{32}$/);
    assert.equal(stored.byteSize, 18);

    const attachments = videoAttachments([
      { type: "text", name: "notes.md", text: "ignored" },
      { type: "video", name: "lecture.mp4", blobId: stored.blobId, format: "mp4", sizeBytes: 18 },
    ]);
    assert.equal(attachments.length, 1);

    const prepared = prepareVideosForWatch({
      userId: 7,
      workspaceRoot: workspace,
      attachments,
    });
    assert.equal(prepared.length, 1);
    const linked = prepared[0].workspacePath;
    assert.ok(linked);
    // Watch will only open a file inside the authorized workspace, so the path
    // handed to the model has to be one.
    assert.equal(resolveWatchSource(linked, workspace), fs.realpathSync.native(linked));
    assert.equal(fs.readFileSync(linked, "utf8"), "not really a video");

    const context = renderWatchVideoContext(prepared);
    assert.match(context, /\[Attached video\]/);
    assert.match(context, /lecture\.mp4/);
    assert.ok(context.includes(`watch_run source: ${linked}`));

    // A second turn reuses the link rather than copying the file again.
    const before = fs.statSync(linked).mtimeMs;
    const again = prepareVideosForWatch({ userId: 7, workspaceRoot: workspace, attachments });
    assert.equal(again[0].workspacePath, linked);
    assert.equal(fs.statSync(linked).mtimeMs, before);

    // A blob belonging to somebody else is simply not there.
    const other = prepareVideosForWatch({
      userId: 8,
      workspaceRoot: workspace,
      attachments,
    });
    assert.equal(other[0].workspacePath, null);
    assert.match(renderWatchVideoContext(other), /could not be opened/);
  } finally {
    if (previousStore === undefined) delete process.env.BREADBOARD_CHAT_VIDEO_DIR;
    else process.env.BREADBOARD_CHAT_VIDEO_DIR = previousStore;
    fs.rmSync(store, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("A follow-up question finds the video attached earlier in the conversation", () => {
  const blobId = `vid_${"a".repeat(32)}`;
  const messages = [
    {
      role: "user",
      metadata: JSON.stringify({
        attachments: [{ type: "video", name: "lecture.mp4", blobId, format: "mp4" }],
      }),
    },
    { role: "assistant", metadata: null },
    { role: "user", metadata: JSON.stringify({ attachments: [] }) },
  ];
  assert.deepEqual(recentVideoAttachment(messages), {
    type: "video",
    name: "lecture.mp4",
    blobId,
    format: "mp4",
  });
  assert.equal(recentVideoAttachment([{ role: "user", metadata: null }]), null);
});

test("The Watch skill tells the model where an attached video actually is", () => {
  const manifest = source("../hermes-skills/prebuilt/watch/SKILL.md");
  assert.match(manifest, /\[Attached video\]/);
  assert.match(manifest, /never\s+answer that you cannot see videos/i);

  const turnService = source("src/lib/conversations/turn-service.ts");
  assert.match(turnService, /watchCommandText\(/);
  assert.match(turnService, /renderWatchVideoContext\(preparedVideos\)/);
});
