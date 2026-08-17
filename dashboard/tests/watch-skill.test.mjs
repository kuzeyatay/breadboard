import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  resolveWatchRuntime,
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

test("Watch runtime resolves from the checked-in prebuilt skill", () => {
  const skillRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../hermes-skills/prebuilt/watch",
  );
  const runtime = resolveWatchRuntime({
    BREADBOARD_WATCH_ROOT: skillRoot,
    BREADBOARD_WATCH_PYTHON: process.execPath,
  });
  assert.ok(runtime);
  assert.equal(runtime.pythonExecutable, process.execPath);
  assert.equal(path.basename(runtime.scriptPath), "watch.py");

  const pathRuntime = resolveWatchRuntime({
    BREADBOARD_WATCH_ROOT: skillRoot,
    BREADBOARD_WATCH_PYTHON: "python.exe",
  });
  assert.equal(pathRuntime?.pythonExecutable, "python.exe");
});

test("Watch runs a product-owned runtime and returns only contained frame paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-watch-run-"));
  try {
    const clip = path.join(root, "clip.mp4");
    const runner = path.join(root, "fake-watch.cjs");
    fs.writeFileSync(clip, "video");
    fs.writeFileSync(
      runner,
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const index = process.argv.indexOf("--out-dir");',
        'const out = process.argv[index + 1];',
        'const frames = path.join(out, "frames");',
        'fs.mkdirSync(frames, { recursive: true });',
        'const frame = path.join(frames, "frame_0001.jpg");',
        'fs.writeFileSync(frame, "jpeg");',
        'console.log("# watch: video report");',
        'console.log("- `" + frame + "` (t=00:01, reason=selected)");',
        'console.log("## Transcript\\n\\n[00:00] hello");',
      ].join("\n"),
    );
    const result = await runWatch({
      args: { source: clip, question: "What happens?", detail: "efficient", noWhisper: true },
      workspaceRoot: root,
      runtime: { pythonExecutable: process.execPath, scriptPath: runner },
      env: { NODE_ENV: "test" },
      timeoutMs: 10_000,
    });
    assert.match(result.report, /watch: video report/);
    assert.equal(result.framePaths.length, 1);
    assert.equal(result.framePaths[0].timestamp, "00:01");
    assert.ok(result.framePaths[0].path.startsWith(result.workDirectory));
    assert.equal(result.analyzedFrameCount, 0);
    assert.match(result.chatmockWarning ?? "", /ChatMock is not configured/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Watch sends bounded frame evidence through the local ChatMock Responses API", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-watch-chatmock-"));
  let requestBody;
  let requestUrl;
  const server = createServer((request, response) => {
    requestUrl = request.url;
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
    const clip = path.join(root, "clip.mp4");
    const runner = path.join(root, "fake-watch.cjs");
    fs.writeFileSync(clip, "video");
    fs.writeFileSync(
      runner,
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const out = process.argv[process.argv.indexOf("--out-dir") + 1];',
        'const frames = path.join(out, "frames");',
        'fs.mkdirSync(frames, { recursive: true });',
        'const frame = path.join(frames, "frame_0001.jpg");',
        'fs.writeFileSync(frame, "jpeg");',
        'console.log("# watch: video report");',
        'console.log("- `" + frame + "` (t=00:01, reason=selected)");',
        'console.log("## Transcript\\n\\n[00:00] hello");',
      ].join("\n"),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await runWatch({
      args: { source: clip, question: "What changed?", detail: "efficient" },
      workspaceRoot: root,
      runtime: { pythonExecutable: process.execPath, scriptPath: runner },
      env: {
        NODE_ENV: "test",
        CHATMOCK_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        CHATMOCK_API_KEY: "local",
        CHATMOCK_MODEL: "default",
      },
      timeoutMs: 10_000,
    });
    assert.equal(requestUrl, "/v1/responses");
    assert.equal(requestBody.model, "default");
    const content = requestBody.input[0].content;
    assert.ok(content.some((part) => part.type === "input_image"));
    assert.match(result.chatmockAnalysis ?? "", /interface changes/);
    assert.equal(result.analyzedFrameCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
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
