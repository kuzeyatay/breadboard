import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { VideoTranscriptionJobStore } from "../src/lib/scriberr/job-store.ts";
import { VideoTranscriptionRunner } from "../src/lib/scriberr/job-runner.ts";
import { ScriberrClient } from "../src/lib/scriberr/client.ts";
import { findExistingVideoSource } from "../src/lib/scriberr/video-source-store.ts";
import { loadVideoTranscriptionConfig } from "../src/lib/scriberr/config.ts";
import { writeFileAtomic } from "../src/lib/scriberr/paths.ts";
import { slugify } from "../src/lib/tags.ts";

const ID = "dQw4w9WgXcQ";

// ── Fake Scriberr: a real HTTP server implementing the endpoints the client
//    uses, so the integration test exercises the actual ScriberrClient. ──────

function createFakeScriberr({
  failTranscription = false,
  malformedTranscript = false,
  emptyTranscript = false,
} = {}) {
  const state = {
    jobs: new Map(),
    startCalls: 0,
    killCalls: 0,
    statusPollsUntilComplete: 2,
  };
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/health") return send(200, { status: "ok" });
    if (req.headers["x-api-key"] !== "test-key") return send(401, { error: "Missing authentication" });

    if (req.method === "POST" && url === "/api/v1/transcription/youtube") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        if (!/youtube\.com|youtu\.be/.test(body.url ?? "")) {
          return send(400, { error: "Invalid YouTube URL" });
        }
        const job = { id: `scr-${state.jobs.size + 1}`, status: "uploaded", title: body.title ?? null, polls: 0 };
        state.jobs.set(job.id, job);
        send(200, { id: job.id, status: job.status, title: job.title });
      });
      return;
    }

    if (
      req.method === "POST" &&
      (url === "/api/v1/transcription/upload" ||
        url === "/api/v1/transcription/upload-video")
    ) {
      req.resume();
      req.on("end", () => {
        const job = {
          id: `scr-${state.jobs.size + 1}`,
          status: "uploaded",
          title: null,
          polls: 0,
        };
        state.jobs.set(job.id, job);
        send(200, { id: job.id, status: job.status, title: job.title });
      });
      return;
    }

    const startMatch = url.match(/^\/api\/v1\/transcription\/([^/]+)\/start$/);
    if (req.method === "POST" && startMatch) {
      const job = state.jobs.get(startMatch[1]);
      if (!job) return send(404, { error: "Job not found" });
      state.startCalls += 1;
      job.status = "pending";
      job.polls = 0;
      req.resume();
      req.on("end", () => send(200, { id: job.id, status: job.status }));
      return;
    }

    const statusMatch = url.match(/^\/api\/v1\/transcription\/([^/]+)\/status$/);
    if (req.method === "GET" && statusMatch) {
      const job = state.jobs.get(statusMatch[1]);
      if (!job) return send(404, { error: "Job not found" });
      job.polls += 1;
      if (job.polls >= state.statusPollsUntilComplete) {
        job.status = failTranscription ? "failed" : "completed";
        if (failTranscription) job.error_message = "model exploded";
      } else {
        job.status = "processing";
      }
      return send(200, { id: job.id, status: job.status, error_message: job.error_message ?? null });
    }

    const transcriptMatch = url.match(/^\/api\/v1\/transcription\/([^/]+)\/transcript$/);
    if (req.method === "GET" && transcriptMatch) {
      const job = state.jobs.get(transcriptMatch[1]);
      if (!job) return send(404, { error: "Job not found" });
      if (emptyTranscript) {
        return send(200, {
          job_id: job.id,
          available: true,
          status: "completed",
          transcript: {
            language: "en",
            model_used: "small.en",
            segments: [],
            text: "",
          },
        });
      }
      if (malformedTranscript) {
        return send(200, {
          job_id: job.id,
          available: true,
          transcript: { segments: [{ start: "not-a-number", end: 1, text: "" }], text: "" },
        });
      }
      return send(200, {
        job_id: job.id,
        available: true,
        status: "completed",
        transcript: {
          language: "en",
          model_used: "whisper-small",
          segments: [
            { start: 1.0, end: 4.0, text: "Welcome to the fake lecture.", speaker: "SPEAKER_00" },
            { start: 5.0, end: 9.0, text: "Entropy always increases.", speaker: "SPEAKER_01" },
          ],
        },
      });
    }

    const killMatch = url.match(/^\/api\/v1\/transcription\/([^/]+)\/kill$/);
    if (req.method === "POST" && killMatch) {
      state.killCalls += 1;
      return send(200, { message: "Job cancellation requested" });
    }

    const deleteMatch = url.match(/^\/api\/v1\/transcription\/([^/]+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      state.jobs.delete(deleteMatch[1]);
      return send(200, { message: "deleted" });
    }

    send(404, { error: "not found" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        state,
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// ── Harness wiring: real store + real client + runner, minimal ingest that
//    writes into a temp garden's sources/ folder like the real pipeline. ─────

function makeHarness(
  fake,
  { ingestFails = false, resumeIndexingFails = false, signal } = {},
) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, slug TEXT);
    INSERT INTO users (username) VALUES ('kuzey');
    INSERT INTO clusters (user_id, slug) VALUES (1, 'physics');
  `);
  const store = new VideoTranscriptionJobStore(db);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-vt-pipe-temp-"));
  const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-vt-pipe-content-"));
  fs.mkdirSync(path.join(contentDir, "physics", "sources"), { recursive: true });

  const config = {
    ...loadVideoTranscriptionConfig({}),
    tempDir,
    pollIntervalMs: 500,
    transcriptionTimeoutMs: 30_000,
    ytdlpDownloadTimeoutMs: 10_000,
  };

  const counters = {
    ingestCalls: 0,
    resumeIndexingCalls: 0,
    ingestUserId: null,
    ingestMediaFilePath: null,
    ingestMediaSha256: null,
    resumeIndexingUserId: null,
  };
  const runner = new VideoTranscriptionRunner({
    config,
    store,
    createScriberrClient: () =>
      new ScriberrClient({ baseUrl: fake.baseUrl, apiToken: "test-key", requestTimeoutMs: 5_000 }),
    withScriberrLease: (_reason, operation) => operation(),
    signal,
    probeMedia: async () => ({
      container: "mov,mp4",
      codecs: ["h264", "aac"],
      durationSeconds: 60,
      hasAudio: true,
      hasVideo: true,
      sizeBytes: 1024,
    }),
    // Minimal stand-in for writeDocumentKnowledge: frontmatter + body into the
    // garden's existing sources/ folder (the real pipeline is exercised in the
    // app; here the boundary under test is the transcription flow).
    ingest: async (input) => {
      counters.ingestCalls += 1;
      counters.ingestUserId = input.userId;
      counters.ingestMediaFilePath = input.mediaFilePath ?? null;
      counters.ingestMediaSha256 = input.mediaSha256 ?? null;
      if (ingestFails) throw new Error("boom");
      const slug = slugify(input.sourceTitle) || "video-source";
      const relPath = `sources/${slug}.md`;
      const frontmatter = Object.entries(input.metadata)
        .map(([key, value]) =>
          Array.isArray(value) ? `${key}: [${value.join(", ")}]` : `${key}: "${value}"`,
        )
        .join("\n");
      writeFileAtomic(
        path.join(contentDir, input.clusterSlug, relPath),
        `---\ntitle: "${input.sourceTitle}"\n${frontmatter}\n---\n\n${input.markdownBody}`,
      );
      input.onProgress?.("Refreshing the Learning Map...");
      return { sourceSlug: slug, sourceRelPath: relPath, sourceTitle: input.sourceTitle, wordCount: 10 };
    },
    resumeIndexing: async (input) => {
      counters.resumeIndexingCalls += 1;
      counters.resumeIndexingUserId = input.userId;
      if (resumeIndexingFails) throw new Error("index boom");
    },
    findExistingVideoSource,
    contentPath: () => contentDir,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 25))),
    log: () => {},
  });

  return {
    db,
    store,
    runner,
    config,
    contentDir,
    tempDir,
    counters,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(contentDir, { recursive: true, force: true });
    },
  };
}

function queueYouTubeJob(store, overrides = {}) {
  return store.createJob({
    clusterId: 1,
    gardenSlug: "physics",
    userId: 1,
    inputKind: "youtube",
    originalUrl: `https://youtu.be/${ID}`,
    canonicalUrl: `https://www.youtube.com/watch?v=${ID}`,
    youtubeVideoId: ID,
    sourceTitle: "Fake Lecture",
    videoMetadata: {
      videoId: ID,
      canonicalUrl: `https://www.youtube.com/watch?v=${ID}`,
      title: "Fake Lecture",
      channel: "Fake Channel",
      durationSeconds: 60,
      thumbnailUrl: null,
      uploadDate: "20240110",
    },
    ...overrides,
  });
}

async function waitForStatus(store, jobId, statuses, timeoutMs = 15_000) {
  const wanted = new Set(Array.isArray(statuses) ? statuses : [statuses]);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = store.getJob(jobId);
    if (job && wanted.has(job.status)) return job;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${[...wanted]}; job is ${job?.status} (${job?.errorCode}: ${job?.errorMessage})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("YouTube job runs end-to-end: submit, poll, transcript, markdown in sources/", async () => {
  const fake = await createFakeScriberr();
  const harness = makeHarness(fake);
  try {
    const job = queueYouTubeJob(harness.store);
    harness.runner.kick();
    const done = await waitForStatus(harness.store, job.id, "completed");

    assert.equal(done.outputRelativePath, "sources/fake-lecture.md");
    const filePath = path.join(harness.contentDir, "physics", "sources", "fake-lecture.md");
    assert.ok(fs.existsSync(filePath), "markdown written under the garden's sources/");
    const content = fs.readFileSync(filePath, "utf8");
    assert.match(content, /Welcome to the fake lecture\./);
    assert.match(content, /Entropy always increases\./);
    assert.match(content, /youtube_video_id: "dQw4w9WgXcQ"/);
    assert.match(content, /## Transcript/);
    assert.equal(fake.state.startCalls, 1);
    // The runner passed through the visible stages.
    assert.equal(done.progressPercent, 100);
    assert.equal(harness.counters.ingestUserId, 1);
  } finally {
    await fake.close();
    harness.cleanup();
  }
});

test("MP3 job uses Scriberr audio upload and writes an audio Markdown source", async () => {
  const fake = await createFakeScriberr();
  const harness = makeHarness(fake);
  const mediaPath = path.join(harness.tempDir, "lecture.mp3");
  fs.writeFileSync(mediaPath, "fake-mp3-bytes");
  try {
    const job = harness.store.createJob({
      clusterId: 1,
      gardenSlug: "physics",
      userId: 1,
      inputKind: "upload",
      originalFilename: "lecture.mp3",
      sourceTitle: "Audio Lecture",
      mediaTempPath: mediaPath,
      mediaSha256: "ab".repeat(32),
    });
    const done = await harness.runner.runExact(job.id, "start");
    assert.equal(done.status, "completed");
    const sourcePath = path.join(
      harness.contentDir,
      "physics",
      "sources",
      "audio-lecture.md",
    );
    const content = fs.readFileSync(sourcePath, "utf8");
    assert.match(content, /source_type: "audio_upload"/);
    assert.match(content, /Uploaded audio file/);
    assert.match(content, /tags: \[source, audio, transcript\]/);
    assert.equal(harness.counters.ingestMediaFilePath, mediaPath);
    assert.equal(harness.counters.ingestMediaSha256, "ab".repeat(32));
  } finally {
    await fake.close();
    harness.cleanup();
  }
});

test("one admitted Runtime worker executes exactly one durable job", async () => {
  const fake = await createFakeScriberr();
  const harness = makeHarness(fake);
  try {
    const job = queueYouTubeJob(harness.store);
    const done = await harness.runner.runExact(job.id, "start");
    assert.equal(done.status, "completed");
    assert.equal(done.outputRelativePath, "sources/fake-lecture.md");
    assert.equal(harness.store.hasQueuedJobs(), false);
  } finally {
    await fake.close();
    harness.cleanup();
  }
});

test("native Runtime cancellation kills the upstream Scriberr job and settles durable state", async () => {
  const fake = await createFakeScriberr();
  fake.state.statusPollsUntilComplete = 1000;
  const controller = new AbortController();
  const harness = makeHarness(fake, { signal: controller.signal });
  try {
    const job = queueYouTubeJob(harness.store);
    const execution = harness.runner.runExact(job.id, "start");
    await waitForStatus(harness.store, job.id, "transcribing");
    controller.abort(new DOMException("Runtime cancellation requested", "AbortError"));
    const done = await execution;
    assert.equal(done.status, "cancelled");
    assert.equal(done.cancelRequested, true);
    assert.equal(fake.state.killCalls, 1);
  } finally {
    await fake.close();
    harness.cleanup();
  }
});

test("Scriberr transcription failure surfaces as a specific retryable error", async () => {
  const fake = await createFakeScriberr({ failTranscription: true });
  const harness = makeHarness(fake);
  try {
    const job = queueYouTubeJob(harness.store);
    harness.runner.kick();
    const failed = await waitForStatus(harness.store, job.id, "failed");
    assert.equal(failed.errorCode, "transcription_failed");
    assert.ok(failed.errorMessage.length > 0);
    assert.ok(!failed.errorMessage.includes("exploded"), "internal Scriberr detail stays server-side");
  } finally {
    await fake.close();
    harness.cleanup();
  }
});

test("malformed Scriberr transcript fails loudly without writing a source", async () => {
  const fake = await createFakeScriberr({ malformedTranscript: true });
  const harness = makeHarness(fake);
  try {
    const job = queueYouTubeJob(harness.store);
    harness.runner.kick();
    const failed = await waitForStatus(harness.store, job.id, "failed");
    assert.equal(failed.errorCode, "transcript_malformed");
    const sources = fs.readdirSync(path.join(harness.contentDir, "physics", "sources"));
    assert.deepEqual(sources, []);
  } finally {
    await fake.close();
    harness.cleanup();
  }
});

test("a completed no-speech audio result writes an explicit source", async () => {
  const fake = await createFakeScriberr({ emptyTranscript: true });
  const harness = makeHarness(fake);
  const mediaPath = path.join(harness.tempDir, "silent.mp3");
  fs.writeFileSync(mediaPath, "fake-silent-mp3-bytes");
  try {
    const job = harness.store.createJob({
      clusterId: 1,
      gardenSlug: "physics",
      userId: 1,
      inputKind: "upload",
      originalFilename: "silent.mp3",
      sourceTitle: "Silent recording",
      mediaTempPath: mediaPath,
      mediaSha256: "cd".repeat(32),
      videoMetadata: {
        videoId: "",
        canonicalUrl: "",
        title: "Silent recording",
        channel: null,
        durationSeconds: 1116,
        thumbnailUrl: null,
        uploadDate: null,
      },
    });
    const done = await harness.runner.runExact(job.id, "start");
    assert.equal(done.status, "completed");
    assert.equal(fake.state.startCalls, 1);
    const normalized = JSON.parse(done.transcriptJson);
    assert.equal(normalized.noSpeechDetected, true);
    const sourcePath = path.join(
      harness.contentDir,
      "physics",
      "sources",
      "silent-recording.md",
    );
    const content = fs.readFileSync(sourcePath, "utf8");
    assert.match(content, /No speech was detected in this recording/);
    assert.match(content, /transcript_status: "no_speech_detected"/);
  } finally {
    await fake.close();
    harness.cleanup();
  }
});

test("indexing failure after markdown write is recoverable without re-transcribing", async () => {
  const fake = await createFakeScriberr();
  const harness = makeHarness(fake, { ingestFails: true });
  try {
    const job = queueYouTubeJob(harness.store);
    harness.runner.kick();
    // ingest throws after nothing was written -> markdown_write_failed. Now
    // simulate the "markdown written but indexing failed" variant: write the
    // file manually with the same content hash, then retry.
    const failed = await waitForStatus(harness.store, job.id, "failed");
    assert.equal(failed.errorCode, "markdown_write_failed");
    assert.ok(failed.transcriptJson, "transcript checkpoint retained");
    const startCallsAfterFirstRun = fake.state.startCalls;

    // Write the source file exactly as the ingest would have (content hash in
    // frontmatter), so the retry path detects it and resumes indexing only.
    writeFileAtomic(
      path.join(harness.contentDir, "physics", "sources", "fake-lecture.md"),
      `---\ntitle: "Fake Lecture"\ncontent_hash: "sha256:${failed.contentHash}"\n---\n\nbody\n`,
    );

    const retried = await harness.runner.retry(job.id);
    assert.notEqual(retried.status, "failed");
    const done = await waitForStatus(harness.store, job.id, "completed");
    assert.equal(done.sourceSlug, "fake-lecture");
    assert.equal(fake.state.startCalls, startCallsAfterFirstRun, "no re-transcription on retry");
    assert.equal(harness.counters.resumeIndexingCalls, 1, "indexing resumed exactly once");
    assert.equal(harness.counters.resumeIndexingUserId, 1);
    assert.equal(harness.counters.ingestCalls, 1, "ingest not repeated after markdown exists");
  } finally {
    await fake.close();
    harness.cleanup();
  }
});

test("cancelling an active job kills the Scriberr job and cleans up", async () => {
  const fake = await createFakeScriberr();
  fake.state.statusPollsUntilComplete = 10_000; // keep it processing
  const harness = makeHarness(fake);
  try {
    const job = queueYouTubeJob(harness.store);
    harness.runner.kick();
    await waitForStatus(harness.store, job.id, "transcribing");
    await harness.runner.requestCancel(job.id);
    const cancelled = await waitForStatus(harness.store, job.id, "cancelled");
    assert.equal(cancelled.errorCode, "cancelled");
    assert.ok(fake.state.killCalls >= 1, "Scriberr kill endpoint called");
  } finally {
    await fake.close();
    harness.cleanup();
  }
});

test("duplicate detection reuses an existing source instead of rewriting", async () => {
  const fake = await createFakeScriberr();
  const harness = makeHarness(fake);
  try {
    // Pre-existing source for the same video id.
    writeFileAtomic(
      path.join(harness.contentDir, "physics", "sources", "existing.md"),
      `---\ntitle: "Existing"\nyoutube_video_id: "${ID}"\n---\n\nbody\n`,
    );
    const job = queueYouTubeJob(harness.store);
    harness.runner.kick();
    const done = await waitForStatus(harness.store, job.id, "completed");
    assert.equal(done.sourceSlug, "existing");
    assert.equal(harness.counters.ingestCalls, 0, "no second source written");
  } finally {
    await fake.close();
    harness.cleanup();
  }
});

test("upload jobs are validated with ffprobe results before submission", async () => {
  // No-audio probe must fail the job with media_no_audio before any upload.
  const fake2 = await createFakeScriberr();
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, slug TEXT);
    INSERT INTO users (username) VALUES ('kuzey');
    INSERT INTO clusters (user_id, slug) VALUES (1, 'physics');
  `);
  const store = new VideoTranscriptionJobStore(db);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-vt-upl-"));
  const mediaDir = path.join(tempDir, "job-1");
  fs.mkdirSync(mediaDir, { recursive: true });
  const mediaPath = path.join(mediaDir, "media-abc.mp4");
  fs.writeFileSync(mediaPath, "fake-bytes");
  const runner = new VideoTranscriptionRunner({
    config: { ...loadVideoTranscriptionConfig({}), tempDir, pollIntervalMs: 500 },
    store,
    createScriberrClient: () =>
      new ScriberrClient({ baseUrl: fake2.baseUrl, apiToken: "test-key", requestTimeoutMs: 5_000 }),
    withScriberrLease: (_reason, operation) => operation(),
    probeMedia: async () => ({
      container: "mov,mp4",
      codecs: ["h264"],
      durationSeconds: 60,
      hasAudio: false,
      hasVideo: true,
      sizeBytes: 10,
    }),
    ingest: async () => {
      throw new Error("should not ingest");
    },
    resumeIndexing: async () => {},
    findExistingVideoSource: () => null,
    contentPath: () => tempDir,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 25))),
    log: () => {},
  });
  try {
    const job = store.createJob({
      clusterId: 1,
      gardenSlug: "physics",
      userId: 1,
      inputKind: "upload",
      originalFilename: "silent.mp4",
      sourceTitle: "Silent",
      mediaTempPath: mediaPath,
      mediaSha256: "ab".repeat(32),
    });
    runner.kick();
    const failed = await waitForStatus(store, job.id, "failed");
    assert.equal(failed.errorCode, "media_no_audio");
  } finally {
    await fake2.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
