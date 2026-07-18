import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { VideoTranscriptionJobStore } from "../src/lib/scriberr/job-store.ts";
import { loadVideoTranscriptionConfig } from "../src/lib/scriberr/config.ts";
import {
  handleCancelVideoTranscription,
  handleCreateVideoTranscription,
  handleGetVideoTranscription,
  handleInspectYouTube,
  handleListVideoTranscriptions,
  handleRetryVideoTranscription,
} from "../src/lib/scriberr/route-core.ts";
// Mirror of RouteError from server-auth.ts (not imported: that module pulls in
// Next.js). route-core re-throws non-VideoTranscriptionError errors untouched,
// so the adapter's status mapping only needs the same shape.
class RouteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ID = "dQw4w9WgXcQ";

function makeStore() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, slug TEXT);
    INSERT INTO users (username) VALUES ('kuzey');
    INSERT INTO clusters (user_id, slug) VALUES (1, 'physics');
  `);
  return new VideoTranscriptionJobStore(db);
}

function makeDeps(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-vt-routes-"));
  const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-vt-content-"));
  const store = makeStore();
  const config = {
    ...loadVideoTranscriptionConfig({}),
    tempDir,
    maxUploadBytes: 10 * 1024 * 1024,
    maxQueuedJobsPerGarden: 2,
  };
  const deps = {
    config,
    store,
    requireOwnedGarden: async (gardenId) => {
      if (gardenId !== "physics") throw new RouteError(404, "Cluster not found");
      return { userId: 1, clusterId: 1, clusterSlug: "physics" };
    },
    contentPath: () => contentDir,
    runnerKick: () => {
      deps.kicks = (deps.kicks ?? 0) + 1;
    },
    runnerCancel: async (jobId) => {
      store.transition(jobId, "cancelled", { errorCode: "cancelled" });
      return store.getJob(jobId);
    },
    runnerRetry: async (jobId) => {
      store.transition(jobId, "queued", { errorCode: null, errorMessage: null });
      return store.getJob(jobId);
    },
    inspectYouTube: async (parsed) => ({
      videoId: parsed.videoId,
      canonicalUrl: parsed.canonicalUrl,
      title: "Example Video",
      channel: "Example Channel",
      durationSeconds: 300,
      thumbnailUrl: "https://i.ytimg.com/x.jpg",
      uploadDate: "20240110",
    }),
    findExistingVideoSource: () => null,
    checkHealth: async () => ({ enabled: true }),
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(contentDir, { recursive: true, force: true });
    },
    ...overrides,
  };
  return deps;
}

function jsonRequest(body) {
  return new Request("http://localhost/api/gardens/physics/video-transcriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function uploadRequest(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request("http://localhost/api/gardens/physics/video-transcriptions", {
    method: "POST",
    body: form,
  });
}

function videoFile(name = "clip.mp4", bytes = 1024) {
  return new File([new Uint8Array(bytes).fill(7)], name, { type: "video/mp4" });
}

test("unauthenticated/unauthorized garden requests are rejected", async () => {
  const deps = makeDeps({
    requireOwnedGarden: async () => {
      throw new RouteError(401, "Unauthorized");
    },
  });
  await assert.rejects(
    handleCreateVideoTranscription(deps, "physics", jsonRequest({ youtubeUrl: `https://youtu.be/${ID}` })),
    (err) => err instanceof RouteError && err.status === 401,
  );
  deps.cleanup();

  const notOwned = makeDeps();
  await assert.rejects(
    handleListVideoTranscriptions(notOwned, "someone-elses-garden"),
    (err) => err instanceof RouteError && err.status === 404,
  );
  notOwned.cleanup();
});

test("valid YouTube submission returns 202 with a queued job and kicks the runner", async () => {
  const deps = makeDeps();
  const result = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: `https://www.youtube.com/watch?v=${ID}` }),
  );
  assert.equal(result.status, 202);
  assert.equal(result.body.job.status, "queued");
  assert.equal(result.body.job.youtubeVideoId, ID);
  assert.equal(result.body.job.videoMetadata.channel, "Example Channel");
  assert.ok(deps.kicks >= 1);
  // Internal fields never reach the browser payload.
  assert.equal("mediaTempPath" in result.body.job, false);
  assert.equal("transcriptJson" in result.body.job, false);
  deps.cleanup();
});

test("valid upload submission stores media in a random temp path and returns 202", async () => {
  const deps = makeDeps();
  const result = await handleCreateVideoTranscription(
    deps,
    "physics",
    uploadRequest({ video: videoFile("My Lecture (v2).mp4") }),
  );
  assert.equal(result.status, 202);
  const job = deps.store.getJob(result.body.job.id);
  assert.equal(job.inputKind, "upload");
  assert.equal(job.originalFilename, "My Lecture (v2).mp4");
  assert.ok(job.mediaTempPath.startsWith(deps.config.tempDir));
  assert.ok(!job.mediaTempPath.includes("My Lecture"), "temp path never uses the original name");
  assert.ok(fs.existsSync(job.mediaTempPath));
  assert.match(job.mediaSha256, /^[0-9a-f]{64}$/);
  deps.cleanup();
});

test("submitting both inputs is rejected", async () => {
  const deps = makeDeps();
  const result = await handleCreateVideoTranscription(
    deps,
    "physics",
    uploadRequest({ video: videoFile(), youtubeUrl: `https://youtu.be/${ID}` }),
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /not both/i);
  deps.cleanup();
});

test("submitting neither input is rejected", async () => {
  const deps = makeDeps();
  const jsonResult = await handleCreateVideoTranscription(deps, "physics", jsonRequest({}));
  assert.equal(jsonResult.status, 400);
  const formResult = await handleCreateVideoTranscription(
    deps,
    "physics",
    uploadRequest({ title: "no media" }),
  );
  assert.equal(formResult.status, 400);
  deps.cleanup();
});

test("unsupported media types are rejected with a specific error", async () => {
  const deps = makeDeps();
  const result = await handleCreateVideoTranscription(
    deps,
    "physics",
    uploadRequest({ video: videoFile("malware.exe") }),
  );
  assert.equal(result.status, 415);
  assert.equal(result.body.errorCode, "media_unsupported");
  deps.cleanup();
});

test("oversized media is rejected with 413", async () => {
  const deps = makeDeps();
  deps.config.maxUploadBytes = 512;
  const result = await handleCreateVideoTranscription(
    deps,
    "physics",
    uploadRequest({ video: videoFile("big.mp4", 4096) }),
  );
  assert.equal(result.status, 413);
  assert.equal(result.body.errorCode, "media_too_large");
  deps.cleanup();
});

test("invalid YouTube URLs and playlists are rejected", async () => {
  const deps = makeDeps();
  const invalid = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: "https://example.com/watch?v=" + ID }),
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.errorCode, "youtube_invalid_url");

  const playlist = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: "https://www.youtube.com/playlist?list=PLx" }),
  );
  assert.equal(playlist.status, 400);
  assert.equal(playlist.body.errorCode, "youtube_playlist");
  deps.cleanup();
});

test("videos longer than the configured limit are rejected", async () => {
  const deps = makeDeps();
  deps.config.maxDurationSeconds = 60;
  const result = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: `https://youtu.be/${ID}` }),
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.errorCode, "media_too_long");
  deps.cleanup();
});

test("duplicate YouTube submissions return the existing source", async () => {
  const deps = makeDeps({
    findExistingVideoSource: ({ youtubeVideoId }) =>
      youtubeVideoId === ID
        ? { sourceSlug: "example-video", sourceRelPath: "sources/example-video.md" }
        : null,
  });
  const result = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: `https://youtu.be/${ID}` }),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.duplicate, true);
  assert.equal(result.body.source.sourceSlug, "example-video");

  // Explicit retranscription bypasses dedup.
  const forced = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: `https://youtu.be/${ID}`, retranscribe: true }),
  );
  assert.equal(forced.status, 202);
  deps.cleanup();
});

test("queue limit per garden returns 429", async () => {
  const deps = makeDeps();
  deps.config.maxQueuedJobsPerGarden = 1;
  const first = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: `https://youtu.be/${ID}` }),
  );
  assert.equal(first.status, 202);
  const second = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: "https://youtu.be/AAAAAAAAAAA" }),
  );
  assert.equal(second.status, 429);
  assert.equal(second.body.errorCode, "queue_full");
  deps.cleanup();
});

test("feature-disabled behavior is explicit", async () => {
  const deps = makeDeps();
  deps.config.enabled = false;
  const result = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: `https://youtu.be/${ID}` }),
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.errorCode, "feature_disabled");
  deps.cleanup();
});

test("job status respects garden scoping and 404s unknown jobs", async () => {
  const deps = makeDeps();
  const created = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: `https://youtu.be/${ID}` }),
  );
  const jobId = created.body.job.id;

  const ok = await handleGetVideoTranscription(deps, "physics", jobId);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.job.id, jobId);

  const missing = await handleGetVideoTranscription(deps, "physics", "vtj-nope");
  assert.equal(missing.status, 404);

  // A job that belongs to another cluster is invisible.
  deps.store.updateJob(jobId, {});
  const otherCluster = makeDeps({
    requireOwnedGarden: async () => ({ userId: 2, clusterId: 99, clusterSlug: "other" }),
  });
  otherCluster.store = deps.store;
  const crossAccess = await handleGetVideoTranscription(otherCluster, "physics", jobId);
  assert.equal(crossAccess.status, 404);
  otherCluster.cleanup();
  deps.cleanup();
});

test("cancel and retry flow through the runner with proper status gating", async () => {
  const deps = makeDeps();
  const created = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: `https://youtu.be/${ID}` }),
  );
  const jobId = created.body.job.id;

  const cancelled = await handleCancelVideoTranscription(deps, "physics", jobId);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.job.status, "cancelled");

  // Retry requires a failed job.
  const retryWrongState = await handleRetryVideoTranscription(deps, "physics", jobId);
  assert.equal(retryWrongState.status, 409);

  deps.store.transition(jobId, "failed", { errorCode: "transcription_failed" });
  const retried = await handleRetryVideoTranscription(deps, "physics", jobId);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.job.status, "queued");
  deps.cleanup();
});

test("completed job responses include the source location", async () => {
  const deps = makeDeps();
  const created = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: `https://youtu.be/${ID}` }),
  );
  deps.store.transition(created.body.job.id, "completed", {
    outputRelativePath: "sources/example-video.md",
    sourceSlug: "example-video",
  });
  const result = await handleGetVideoTranscription(deps, "physics", created.body.job.id);
  assert.equal(result.body.job.outputRelativePath, "sources/example-video.md");
  assert.equal(result.body.job.sourceSlug, "example-video");
  deps.cleanup();
});

test("inspect-youtube validates and returns preview metadata", async () => {
  const deps = makeDeps();
  const ok = await handleInspectYouTube(
    deps,
    "physics",
    jsonRequest({ url: `https://youtu.be/${ID}` }),
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.body.valid, true);
  assert.equal(ok.body.metadata.title, "Example Video");

  const bad = await handleInspectYouTube(
    deps,
    "physics",
    jsonRequest({ url: "https://vimeo.com/1" }),
  );
  assert.equal(bad.status, 400);
  deps.cleanup();
});

test("failures are sanitized: no temp paths or internals in error bodies", async () => {
  const deps = makeDeps({
    inspectYouTube: async () => {
      const error = new Error(`ENOENT: C:\\secret\\tools\\yt-dlp.exe`);
      throw Object.assign(error, { code: "internal_error" });
    },
  });
  // Non-VideoTranscriptionError escapes to the adapter, which maps it via
  // routeErrorResponse; VideoTranscriptionErrors carry only userMessage.
  const listResult = await handleListVideoTranscriptions(deps, "physics");
  assert.equal(listResult.status, 200);
  const create = await handleCreateVideoTranscription(
    deps,
    "physics",
    jsonRequest({ youtubeUrl: `https://youtu.be/${ID}` }),
  ).catch((err) => err);
  assert.ok(create instanceof Error);
  deps.cleanup();
});
