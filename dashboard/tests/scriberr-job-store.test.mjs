import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { VideoTranscriptionJobStore } from "../src/lib/scriberr/job-store.ts";

// The store runs against an in-memory database seeded with minimal parent
// tables, so no test ever touches the real brain.db.
function makeStore() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, slug TEXT);
    INSERT INTO users (username) VALUES ('kuzey');
    INSERT INTO clusters (user_id, slug) VALUES (1, 'physics'), (1, 'chemistry');
  `);
  return new VideoTranscriptionJobStore(db);
}

function createYouTubeJob(store, overrides = {}) {
  return store.createJob({
    clusterId: 1,
    gardenSlug: "physics",
    userId: 1,
    inputKind: "youtube",
    originalUrl: "https://youtu.be/dQw4w9WgXcQ",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    youtubeVideoId: "dQw4w9WgXcQ",
    sourceTitle: "Example",
    ...overrides,
  });
}

test("createJob persists a queued job with timestamps", () => {
  const store = makeStore();
  const job = createYouTubeJob(store);
  assert.equal(job.status, "queued");
  assert.equal(job.gardenId, "physics");
  assert.match(job.id, /^vtj-/);
  assert.ok(job.createdAt);
});

test("getJobForCluster enforces garden scoping", () => {
  const store = makeStore();
  const job = createYouTubeJob(store);
  assert.ok(store.getJobForCluster(job.id, 1));
  assert.equal(store.getJobForCluster(job.id, 2), null);
});

test("claimNextQueuedJob claims oldest first and honors the concurrency cap", () => {
  const store = makeStore();
  const first = createYouTubeJob(store, { youtubeVideoId: "AAAAAAAAAAA" });
  createYouTubeJob(store, { youtubeVideoId: "BBBBBBBBBBB" });

  const claimed = store.claimNextQueuedJob(1);
  assert.equal(claimed.id, first.id);
  assert.equal(claimed.status, "validating");

  // Cap of 1: the second job stays queued while the first is active.
  assert.equal(store.claimNextQueuedJob(1), null);
  store.transition(first.id, "completed");
  const second = store.claimNextQueuedJob(1);
  assert.ok(second);
  assert.notEqual(second.id, first.id);
});

test("transition sets completedAt on terminal states and heartbeats", () => {
  const store = makeStore();
  const job = createYouTubeJob(store);
  const failed = store.transition(job.id, "failed", { errorCode: "transcription_failed" });
  assert.equal(failed.status, "failed");
  assert.ok(failed.completedAt);
  assert.ok(failed.heartbeatAt);
});

test("findDuplicateJob matches video id and media hash but ignores failed jobs", () => {
  const store = makeStore();
  const job = createYouTubeJob(store);
  assert.equal(
    store.findDuplicateJob({ clusterId: 1, youtubeVideoId: "dQw4w9WgXcQ" }).id,
    job.id,
  );
  assert.equal(store.findDuplicateJob({ clusterId: 2, youtubeVideoId: "dQw4w9WgXcQ" }), null);
  store.transition(job.id, "failed");
  assert.equal(store.findDuplicateJob({ clusterId: 1, youtubeVideoId: "dQw4w9WgXcQ" }), null);

  const upload = store.createJob({
    clusterId: 1,
    gardenSlug: "physics",
    userId: 1,
    inputKind: "upload",
    originalFilename: "clip.mp4",
    mediaSha256: "cafe".repeat(16),
  });
  assert.equal(
    store.findDuplicateJob({ clusterId: 1, mediaSha256: "cafe".repeat(16) }).id,
    upload.id,
  );
});

test("listStaleJobs finds silent active jobs but never queued/terminal ones", () => {
  const store = makeStore();
  const active = createYouTubeJob(store, { youtubeVideoId: "AAAAAAAAAAA" });
  createYouTubeJob(store, { youtubeVideoId: "BBBBBBBBBBB" }); // stays queued
  store.updateJob(active.id, {
    status: "transcribing",
    heartbeatAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  });
  const stale = store.listStaleJobs(120_000);
  assert.deepEqual(stale.map((job) => job.id), [active.id]);
});

test("countPendingForCluster counts queued and running jobs per garden", () => {
  const store = makeStore();
  createYouTubeJob(store, { youtubeVideoId: "AAAAAAAAAAA" });
  const running = createYouTubeJob(store, { youtubeVideoId: "BBBBBBBBBBB" });
  store.updateJob(running.id, { status: "transcribing" });
  const done = createYouTubeJob(store, { youtubeVideoId: "CCCCCCCCCCC" });
  store.transition(done.id, "completed");
  assert.equal(store.countPendingForCluster(1), 2);
  assert.equal(store.countPendingForCluster(2), 0);
});

test("job patches round-trip metadata and transcript checkpoints", () => {
  const store = makeStore();
  const job = createYouTubeJob(store);
  store.updateJob(job.id, {
    scriberrJobId: "sj-1",
    transcriptJson: JSON.stringify({ segments: [] }),
    videoMetadata: {
      videoId: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Example",
      channel: "Chan",
      durationSeconds: 100,
      thumbnailUrl: null,
      uploadDate: null,
    },
    cancelRequested: true,
  });
  const loaded = store.getJob(job.id);
  assert.equal(loaded.scriberrJobId, "sj-1");
  assert.equal(loaded.videoMetadata.channel, "Chan");
  assert.equal(loaded.cancelRequested, true);
});
