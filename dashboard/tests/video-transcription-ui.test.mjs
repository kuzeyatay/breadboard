import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  ACCEPTED_MEDIA_EXTENSIONS,
  ACCEPTED_VIDEO_EXTENSIONS,
  MEDIA_FILE_ACCEPT_ATTR,
  VIDEO_FILE_ACCEPT_ATTR,
  formatBytes,
  formatElapsed,
  formatVideoDuration,
  hasActiveJob,
  isAcceptedAudioFilename,
  isAcceptedMediaFilename,
  isAcceptedVideoFilename,
  nextPollDelayMs,
  stageIndexForStatus,
  stagesForInputKind,
  statusLabel,
  validateMediaFile,
  validateVideoFile,
  validateYouTubeInput,
} from "../src/lib/video-transcription-ui.ts";

const componentSource = fs.readFileSync(
  new URL("../src/app/components/garden-video-import.tsx", import.meta.url),
  "utf8",
);

// ── Pure helpers ────────────────────────────────────────────────────────────

test("stage lists match the documented progressions for both input kinds", () => {
  assert.deepEqual(
    stagesForInputKind("upload").map((stage) => stage.label),
    [
      "Validating media",
      "Uploading to Scriberr",
      "Transcribing",
      "Formatting transcript",
      "Writing source",
      "Indexing source",
      "Complete",
    ],
  );
  assert.deepEqual(
    stagesForInputKind("youtube").map((stage) => stage.label),
    [
      "Checking YouTube URL",
      "Downloading video",
      "Transcribing",
      "Formatting transcript",
      "Writing source",
      "Indexing source",
      "Complete",
    ],
  );
});

test("intermediate statuses map onto visible stages", () => {
  assert.equal(stageIndexForStatus("upload", "queued"), 0);
  assert.equal(stageIndexForStatus("upload", "submitting_to_scriberr"), 2);
  assert.equal(stageIndexForStatus("youtube", "downloading"), 1);
  assert.equal(stageIndexForStatus("youtube", "indexing_source"), 5);
});

test("status labels prefer the server-provided stage text", () => {
  assert.equal(
    statusLabel({ status: "transcribing", currentStage: "Transcribing", inputKind: "upload" }),
    "Transcribing",
  );
  assert.equal(statusLabel({ status: "queued", currentStage: null, inputKind: "upload" }), "Queued");
  assert.equal(statusLabel({ status: "failed", currentStage: null, inputKind: "youtube" }), "Failed");
});

test("polling stops on terminal jobs and backs off over time", () => {
  const active = [{ status: "transcribing" }];
  const settled = [{ status: "completed" }, { status: "failed" }, { status: "cancelled" }];
  assert.equal(hasActiveJob(settled), false);
  assert.equal(nextPollDelayMs(settled, 0), 0);
  assert.equal(nextPollDelayMs(active, 10_000), 2_500);
  assert.equal(nextPollDelayMs(active, 120_000), 5_000);
  assert.equal(nextPollDelayMs(active, 900_000), 10_000);
});

test("YouTube input validation mirrors the server rules", () => {
  assert.equal(validateYouTubeInput("https://youtu.be/dQw4w9WgXcQ").ok, true);
  const playlist = validateYouTubeInput("https://www.youtube.com/playlist?list=PLx");
  assert.equal(playlist.ok, false);
  assert.match(playlist.message, /playlist/i);
  const invalid = validateYouTubeInput("https://vimeo.com/1");
  assert.equal(invalid.ok, false);
});

test("file validation covers type, emptiness, and size", () => {
  assert.equal(validateVideoFile({ name: "a.mp4", size: 10 }, 100).ok, true);
  assert.equal(validateVideoFile({ name: "a.exe", size: 10 }, 100).ok, false);
  assert.equal(validateVideoFile({ name: "a.mp4", size: 0 }, 100).ok, false);
  assert.equal(validateVideoFile({ name: "a.mp4", size: 200 }, 100).ok, false);
  assert.equal(isAcceptedVideoFilename("clip.M4V"), true);
  assert.equal(validateMediaFile({ name: "lecture.mp3", size: 10 }, 100).ok, true);
  assert.equal(validateMediaFile({ name: "voice.OGG", size: 10 }, 100).ok, true);
  assert.equal(isAcceptedAudioFilename("podcast.MP3"), true);
  assert.equal(isAcceptedMediaFilename("podcast.flac"), true);
  assert.equal(MEDIA_FILE_ACCEPT_ATTR, ACCEPTED_MEDIA_EXTENSIONS.join(","));
  assert.equal(VIDEO_FILE_ACCEPT_ATTR, MEDIA_FILE_ACCEPT_ATTR);
  assert.ok(ACCEPTED_AUDIO_EXTENSIONS.includes(".mp3"));
});

test("display formatting helpers", () => {
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), "3.0 GB");
  assert.equal(formatVideoDuration(3725), "1:02:05");
  assert.equal(formatVideoDuration(65), "1:05");
  const started = new Date(Date.now() - 95_000).toISOString();
  assert.match(formatElapsed(started, Date.now()), /^1m 3[45]s$/);
});

// ── Component structure (source-level assertions, matching repo UI tests) ──

test("video, audio, and YouTube inputs render in the same media-import panel", () => {
  assert.match(componentSource, /type="file"/);
  assert.match(componentSource, /accept=\{MEDIA_FILE_ACCEPT_ATTR\}/);
  assert.match(componentSource, /aria-label="YouTube URL"/);
  assert.match(componentSource, /Video: \{ACCEPTED_VIDEO_EXTENSIONS\.join\(" "\)\}/);
  assert.match(componentSource, /Audio: \{ACCEPTED_AUDIO_EXTENSIONS\.join\(" "\)\}/);
  assert.match(componentSource, /form\.append\("media", selectedFile/);
  assert.match(componentSource, /onDrop=\{handleDrop\}/, "drag-and-drop supported");
});

test("media warnings are unboxed and the file chooser is a dark-blue link", () => {
  assert.match(componentSource, /className="space-y-0\.5"/);
  assert.match(componentSource, /text-amber-600/);
  assert.doesNotMatch(componentSource, /border border-amber-900/);
  assert.doesNotMatch(componentSource, /bg-amber-950/);
  const chooserStart = componentSource.indexOf("Drop video or audio here");
  const chooserEnd = componentSource.indexOf("Audio:", chooserStart);
  const chooser = componentSource.slice(chooserStart, chooserEnd);
  assert.match(chooser, /text-blue-900 underline/);
  assert.doesNotMatch(chooser, /text-cyan-300/);
});

test("inputs are mutually exclusive in both directions", () => {
  assert.match(
    componentSource,
    /choosing a file clears the URL side[\s\S]*?setYoutubeUrl\(""\)/,
  );
  assert.match(
    componentSource,
    /Entering a URL clears the file side[\s\S]*?setSelectedFile\(null\)/,
  );
});

test("active progress stays actionable while failed history stays out of the source list", () => {
  assert.match(componentSource, /stagesForInputKind\(job\.inputKind\)/);
  assert.match(componentSource, /formatElapsed\(job\.createdAt, nowMs\)/);
  assert.match(componentSource, /cancelJob\(job\.id\)/);
  assert.match(
    componentSource,
    /filter\(\(job\) => job\.status !== "failed" && job\.status !== "cancelled"\)/,
  );
  assert.doesNotMatch(componentSource, /postJobAction\(job\.id, "retry"\)/);
  assert.doesNotMatch(componentSource, /job\.errorMessage/);
  assert.match(componentSource, /Transcript source/);
});

test("jobs are restored on mount and polling is single-loop with terminal stop", () => {
  assert.match(componentSource, /Restore jobs \(and any in-flight progress\) on mount/);
  assert.match(componentSource, /if \(!hasActiveJob\(jobs\)\) return;/);
  assert.match(componentSource, /pollTimerRef/);
  assert.match(componentSource, /nextPollDelayMs/);
});

test("completion notifies the workspace to refresh the source tree", () => {
  assert.match(componentSource, /onSourceCreated/);
  const workspace = fs.readFileSync(
    new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
    "utf8",
  );
  assert.match(workspace, /handleMediaSourceCreated/);
  assert.match(workspace, /fetchDocuments\(\);/);
  assert.match(workspace, /transcription completed/);
});
