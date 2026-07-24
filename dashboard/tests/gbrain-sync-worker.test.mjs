import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.QUARTZ_CONTENT_PATH = process.env.QUARTZ_CONTENT_PATH || path.join(os.tmpdir(), "gbrain-worker-content");

const dbMod = await import("../src/lib/db.ts");
const db = dbMod.default;
const { GBrainSyncWorker } = await import("../src/lib/gbrain/sync-worker.ts");
const { enqueueSyncJob, setSyncState, getSyncState } = await import("../src/lib/gbrain/mapping.ts");

const SUFFIX = Math.random().toString(36).slice(2, 8);
const userId = Number(
  db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)").run(`w-${SUFFIX}`, `w-${SUFFIX}@x.com`, "h").lastInsertRowid,
);
const slug = `gbrain-worker-${SUFFIX}`;
const clusterId = Number(
  db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, ?, ?)").run(userId, "Worker Garden", slug).lastInsertRowid,
);
const sourceId = `gbrain-src-cluster-${clusterId}`;
db.prepare("INSERT INTO gbrain_garden_sources (cluster_id, garden_slug, source_id, content_root) VALUES (?, ?, ?, ?)").run(
  clusterId,
  slug,
  sourceId,
  "/x",
);

test.after(() => {
  db.prepare("DELETE FROM gbrain_sync_jobs WHERE source_id = ?").run(sourceId);
  db.prepare("DELETE FROM clusters WHERE id = ?").run(clusterId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
});

function clearJobs() {
  db.prepare("DELETE FROM gbrain_sync_jobs WHERE source_id = ?").run(sourceId);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("automatic draining: an enqueued job is processed without a manual drain call", async () => {
  clearJobs();
  let synced = 0;
  const worker = new GBrainSyncWorker({
    intervalMs: 30,
    syncFn: async () => {
      synced++;
      return { status: "synced", sourceId };
    },
  });
  enqueueSyncJob(sourceId, clusterId, "test");
  worker.start();
  try {
    let job;
    for (let i = 0; i < 80; i++) {
      job = db.prepare("SELECT status FROM gbrain_sync_jobs WHERE source_id = ?").get(sourceId);
      if (job?.status === "done") break;
      await sleep(25);
    }
    assert.ok(synced >= 1, "worker should auto-process the job (no manual drain call)");
    assert.equal(job.status, "done");
  } finally {
    await worker.stop();
  }
});

test("duplicate jobs for the same garden are coalesced", () => {
  clearJobs();
  const a = enqueueSyncJob(sourceId, clusterId, "r1");
  const b = enqueueSyncJob(sourceId, clusterId, "r2");
  assert.equal(a, b, "second enqueue should return the same active job id");
  const count = db.prepare("SELECT count(*) AS c FROM gbrain_sync_jobs WHERE source_id = ? AND status = 'queued'").get(sourceId).c;
  assert.equal(count, 1);
});

test("failed job retries with backoff, then fails after maxAttempts and clears stale state", async () => {
  clearJobs();
  const worker = new GBrainSyncWorker({
    intervalMs: 20,
    maxAttempts: 3,
    baseBackoffMs: 1, // tiny backoff so retries are quick
    maxBackoffMs: 5,
    syncFn: async () => {
      throw new Error("boom");
    },
  });
  enqueueSyncJob(sourceId, clusterId, "willfail");
  worker.start();
  try {
    let job;
    for (let i = 0; i < 100; i++) {
      job = db.prepare("SELECT status, attempts FROM gbrain_sync_jobs WHERE source_id = ?").get(sourceId);
      if (job?.status === "failed") break;
      await sleep(20);
    }
    assert.equal(job.status, "failed");
    assert.equal(job.attempts, 3);
    assert.match(getSyncState(sourceId)?.status ?? "", /failed/);
  } finally {
    await worker.stop();
  }
});

test("abandoned running job is recovered (requeued)", () => {
  clearJobs();
  // Simulate a crashed worker: a running job claimed long ago.
  const old = new Date(Date.now() - 60 * 60_000).toISOString();
  db.prepare(
    "INSERT INTO gbrain_sync_jobs (source_id, cluster_id, reason, status, claimed_at, claimed_by, next_attempt_at) VALUES (?, ?, 'crash', 'running', ?, 'dead', datetime('now'))",
  ).run(sourceId, clusterId, old);
  const worker = new GBrainSyncWorker({ staleClaimMs: 1000 });
  const recovered = worker.recoverAbandoned();
  assert.ok(recovered >= 1);
  const job = db.prepare("SELECT status FROM gbrain_sync_jobs WHERE source_id = ?").get(sourceId);
  assert.equal(job.status, "queued");
});

test("successful sync clears stale state to synced", async () => {
  clearJobs();
  setSyncState({ sourceId, status: "stale", error: "prior" });
  const worker = new GBrainSyncWorker({
    intervalMs: 20,
    syncFn: async () => {
      setSyncState({ sourceId, status: "synced", revision: "rev1" });
      return { status: "synced", sourceId };
    },
  });
  enqueueSyncJob(sourceId, clusterId, "recover");
  worker.start();
  try {
    for (let i = 0; i < 60; i++) {
      if (getSyncState(sourceId)?.status === "synced") break;
      await sleep(20);
    }
    assert.equal(getSyncState(sourceId)?.status, "synced");
  } finally {
    await worker.stop();
  }
});

test("stop() waits for the in-flight job and halts cleanly", async () => {
  clearJobs();
  let finished = false;
  const worker = new GBrainSyncWorker({
    intervalMs: 15,
    syncFn: async () => {
      await sleep(60);
      finished = true;
      return { status: "synced", sourceId };
    },
  });
  enqueueSyncJob(sourceId, clusterId, "shutdown");
  worker.start();
  await sleep(30); // let it claim + start processing
  await worker.stop(); // must wait for the in-flight job
  assert.equal(finished, true, "stop() should await the in-flight job");
});
