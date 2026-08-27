import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QUARTZ_CONTENT_PATH ||= path.join(os.tmpdir(), "gbrain-worker-content");
await import("../scripts/learn-worker-import-hook.mjs");

const db = (await import("../src/lib/db.ts")).default;
const { ensureSyncWorkerStarted } = await import("../src/lib/gbrain/sync-worker.ts");
const { enqueueSyncJob } = await import("../src/lib/gbrain/mapping.ts");

const suffix = Math.random().toString(36).slice(2, 8);
const userId = Number(
  db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)")
    .run(`w-${suffix}`, `w-${suffix}@x.com`, "h").lastInsertRowid,
);
const slug = `gbrain-worker-${suffix}`;
const clusterId = Number(
  db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, ?, ?)")
    .run(userId, "Worker Garden", slug).lastInsertRowid,
);
const sourceId = `gbrain-src-cluster-${clusterId}`;
db.prepare(
  "INSERT INTO gbrain_garden_sources (cluster_id, garden_slug, source_id, content_root) VALUES (?, ?, ?, ?)",
).run(clusterId, slug, sourceId, "/x");

test.after(() => {
  db.prepare("DELETE FROM gbrain_sync_jobs WHERE source_id = ?").run(sourceId);
  db.prepare("DELETE FROM gbrain_sync_state WHERE source_id = ?").run(sourceId);
  db.prepare("DELETE FROM gbrain_garden_sources WHERE source_id = ?").run(sourceId);
  db.prepare("DELETE FROM clusters WHERE id = ?").run(clusterId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
});

test("duplicate durable rows for one garden remain coalesced", () => {
  db.prepare("DELETE FROM gbrain_sync_jobs WHERE source_id = ?").run(sourceId);
  const first = enqueueSyncJob(sourceId, clusterId, "r1");
  const second = enqueueSyncJob(sourceId, clusterId, "r2");
  assert.equal(first, second);
  const count = db.prepare(
    "SELECT count(*) AS count FROM gbrain_sync_jobs WHERE source_id = ? AND status = 'queued'",
  ).get(sourceId).count;
  assert.equal(count, 1);
});

test("compatibility startup performs one bounded single-flight Runtime kick", async () => {
  const priorMode = process.env.GBRAIN_MODE;
  process.env.GBRAIN_MODE = "preferred";
  let calls = 0;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const kick = async () => {
    calls += 1;
    await blocked;
  };
  try {
    ensureSyncWorkerStarted(kick);
    ensureSyncWorkerStarted(kick);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    ensureSyncWorkerStarted(async () => { calls += 1; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
  } finally {
    if (priorMode === undefined) delete process.env.GBRAIN_MODE;
    else process.env.GBRAIN_MODE = priorMode;
  }
});

test("an explicitly disabled GBrain never submits an indexing worker", async () => {
  const priorMode = process.env.GBRAIN_MODE;
  process.env.GBRAIN_MODE = "disabled";
  let calls = 0;
  try {
    ensureSyncWorkerStarted(async () => { calls += 1; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 0);
  } finally {
    if (priorMode === undefined) delete process.env.GBRAIN_MODE;
    else process.env.GBRAIN_MODE = priorMode;
  }
});

test("the compatibility hook retains no timer or in-process indexing fallback", () => {
  const source = fs.readFileSync(
    new URL("../src/lib/gbrain/sync-worker.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /setInterval|setTimeout|syncGardenInRuntimeWorker|scanClusterKnowledge/);
  assert.match(source, /kickQueuedGBrainSyncJobs/);
});
