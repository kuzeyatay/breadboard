import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

process.env.BREADBOARD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-topology-claim-"));
await import("../scripts/learn-worker-import-hook.mjs");
const db = (await import("../src/lib/db.ts")).default;
const { executeThoughtTopologyRuntimeBuild } = await import("../src/lib/thought-topology/executor.ts");
const { reconcileThoughtTopologyRuntimeJob } = await import("../src/lib/thought-topology/state.ts");
const { setHermesUserSettings } = await import("../src/lib/hermes/runtime-store.ts");

test("a disabled default records a failed topology job before starting model work", async () => {
  const userId = Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES ('no-model', 'no-model@example.test', 'x')").run().lastInsertRowid);
  const clusterId = Number(db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, 'No model', 'no-model')").run(userId).lastInsertRowid);
  const queueJobId = Number(db.prepare("INSERT INTO thought_topology_jobs (cluster_id, revision, reason, status) VALUES (?, 1, 'Manual', 'queued')").run(clusterId).lastInsertRowid);
  setHermesUserSettings(userId, { defaultModel: "none" });
  await assert.rejects(executeThoughtTopologyRuntimeBuild({ clusterId, userId, gardenId: "no-model", revision: 1, queueJobId, runtimeJobId: "job_no_model" }), /No default model is selected/);
  const job = db.prepare("SELECT status, last_error, attempts FROM thought_topology_jobs WHERE id = ?").get(queueJobId);
  assert.equal(job.status, "failed");
  assert.match(job.last_error, /No default model is selected/);
  assert.equal(job.attempts, 1);
});

test("the worker reserves the write lock before reading its coalesced queue revision", async () => {
  const userId = Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES ('claim', 'claim@example.test', 'x')").run().lastInsertRowid);
  const clusterId = Number(db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, 'Claim', 'claim')").run(userId).lastInsertRowid);
  // Disabled after queueing: exercise claiming and completion without model work.
  db.prepare("UPDATE clusters SET thought_topology_enabled = 0 WHERE id = ?").run(clusterId);
  const queueJobId = Number(db.prepare("INSERT INTO thought_topology_jobs (cluster_id, revision, reason, status) VALUES (?, 3, 'Learn', 'queued')").run(clusterId).lastInsertRowid);
  const competingWriter = new Database(path.join(process.env.BREADBOARD_DATA_DIR, "database", "brain.db"));
  competingWriter.pragma("busy_timeout = 0");
  const prepare = db.prepare;
  let competed = false;
  db.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    if (sql === "SELECT id, cluster_id, revision, status FROM thought_topology_jobs WHERE id = ?") {
      const get = statement.get.bind(statement);
      statement.get = (...args) => {
        const row = get(...args);
        competed = true;
        // A deferred read transaction allows this writer through, then fails
        // its own upgrade with SQLITE_BUSY_SNAPSHOT. IMMEDIATE excludes it.
        assert.throws(() => competingWriter.prepare("UPDATE clusters SET name = 'Concurrent Learn' WHERE id = ?").run(clusterId),
          (error) => error.code === "SQLITE_BUSY");
        return row;
      };
    }
    return statement;
  };
  try {
    process.env.QUARTZ_CONTENT_PATH = path.join(process.env.BREADBOARD_DATA_DIR, "content");
    const result = await executeThoughtTopologyRuntimeBuild({ clusterId, userId, gardenId: "claim", revision: 1, queueJobId, runtimeJobId: "job_claim" });
    assert.equal(competed, true);
    assert.equal(result.revision, 3);
    assert.equal(result.status, "skipped");
    assert.equal(db.prepare("SELECT status FROM thought_topology_jobs WHERE id = ?").get(queueJobId).status, "stale");
  } finally {
    db.prepare = prepare;
    competingWriter.close();
  }
});

test("reconciliation repairs only terminal jobs belonging to an enabled Garden", () => {
  const clusterId = db.prepare("SELECT id FROM clusters WHERE slug = 'claim'").get().id;
  const snapshot = { jobId: "job_claim", jobType: "thought-topology", workerKind: "thought-topology-node", gardenId: "claim", conversationId: null, state: "failed" };
  db.prepare("UPDATE thought_topology_jobs SET status = 'running' WHERE cluster_id = ?").run(clusterId);
  assert.equal(reconcileThoughtTopologyRuntimeJob(clusterId, snapshot), false);
  db.prepare("UPDATE clusters SET thought_topology_enabled = 1 WHERE id = ?").run(clusterId);
  for (const changes of [{ state: "running" }, { gardenId: "another-garden" }, { workerKind: "learn-node" }, { conversationId: "chat" }, { jobId: "job_different" }]) {
    assert.equal(reconcileThoughtTopologyRuntimeJob(clusterId, { ...snapshot, ...changes }), false);
  }
  for (const state of ["failed", "cancelled", "interrupted", "uncertain", "resource_exhausted", "succeeded"]) {
    db.prepare("UPDATE thought_topology_jobs SET status = 'queued' WHERE cluster_id = ?").run(clusterId);
    assert.equal(reconcileThoughtTopologyRuntimeJob(clusterId, { ...snapshot, state }), true);
    assert.equal(db.prepare("SELECT status FROM thought_topology_jobs WHERE cluster_id = ?").get(clusterId).status, state === "succeeded" ? "stale" : "failed");
  }
  db.prepare("UPDATE thought_topology_jobs SET status = 'done' WHERE cluster_id = ?").run(clusterId);
  assert.equal(reconcileThoughtTopologyRuntimeJob(clusterId, snapshot), false, "a completed worker's result cannot be overwritten by an old observation");
});
