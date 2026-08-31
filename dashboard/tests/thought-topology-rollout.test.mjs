import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const isolatedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "breadboard-topology-rollout-"),
);
process.env.BREADBOARD_DATA_DIR = path.join(isolatedRoot, "data");
process.env.QUARTZ_CONTENT_PATH = path.join(isolatedRoot, "content");
fs.mkdirSync(process.env.QUARTZ_CONTENT_PATH, { recursive: true });

await import("../scripts/learn-worker-import-hook.mjs");
const { ensureThoughtTopologySchema } =
  await import("../src/lib/thought-topology/schema.ts");
const { invalidateThoughtTopologyAfterMutation } =
  await import("../src/lib/thought-topology/state.ts");

function fixtureDatabase() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1);
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);
  return database;
}

test("installing topology schema preserves pre-feature Gardens and defaults future Gardens on", () => {
  const database = fixtureDatabase();
  database
    .prepare(
      "INSERT INTO clusters (user_id, name, slug) VALUES (1, 'Existing', 'existing')",
    )
    .run();
  ensureThoughtTopologySchema(database);
  const existing = database
    .prepare(
      "SELECT thought_topology_enabled, thought_topology_revision FROM clusters WHERE slug = 'existing'",
    )
    .get();
  assert.deepEqual(existing, {
    thought_topology_enabled: 0,
    thought_topology_revision: 0,
  });
  database
    .prepare(
      "INSERT INTO clusters (user_id, name, slug) VALUES (1, 'Future', 'future')",
    )
    .run();
  const future = database
    .prepare(
      "SELECT thought_topology_enabled, thought_topology_revision FROM clusters WHERE slug = 'future'",
    )
    .get();
  assert.deepEqual(future, {
    thought_topology_enabled: 1,
    thought_topology_revision: 0,
  });
  assert.equal(
    database
      .prepare("SELECT count(*) AS count FROM thought_topology_jobs")
      .get().count,
    0,
  );
  database.close();
});

test("opening or mutating a disabled Garden cannot queue, submit, or touch its tree", async () => {
  const database = fixtureDatabase();
  database
    .prepare(
      "INSERT INTO clusters (user_id, name, slug) VALUES (1, 'Sentinel', 'sentinel')",
    )
    .run();
  ensureThoughtTopologySchema(database);
  database
    .prepare(
      "UPDATE clusters SET thought_topology_enabled = 0 WHERE slug = 'sentinel'",
    )
    .run();
  const garden = path.join(process.env.QUARTZ_CONTENT_PATH, "sentinel");
  fs.mkdirSync(garden, { recursive: true });
  const sentinel = path.join(garden, "note.md");
  const bytes = Buffer.from("---\ntitle: Sentinel\n---\n\nDo not change.\n");
  fs.writeFileSync(sentinel, bytes);
  let submissions = 0;
  for (const reason of [
    "open",
    "edit",
    "delete",
    "move",
    "publish",
    "startup recovery",
  ]) {
    const result = await invalidateThoughtTopologyAfterMutation(
      "sentinel",
      reason,
      {
        database,
        submit: async () => {
          submissions += 1;
        },
      },
    );
    assert.deepEqual(result, { enabled: false });
  }
  assert.equal(submissions, 0);
  assert.equal(
    database
      .prepare("SELECT count(*) AS count FROM thought_topology_jobs")
      .get().count,
    0,
  );
  assert.deepEqual(fs.readFileSync(sentinel), bytes);
  assert.equal(
    fs.existsSync(path.join(garden, ".breadboard", "thought-topology.json")),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(garden, ".breadboard", "thought-topology-cache.json"),
    ),
    false,
  );
  database.close();
});

test("a newly-created Garden is enabled automatically and gets one revisioned Runtime submission", async () => {
  const database = fixtureDatabase();
  ensureThoughtTopologySchema(database);
  database
    .prepare(
      "INSERT INTO clusters (user_id, name, slug) VALUES (1, 'New', 'new-garden')",
    )
    .run();
  const submissions = [];
  const result = await invalidateThoughtTopologyAfterMutation(
    "new-garden",
    "created",
    {
      database,
      submit: async (submission) => submissions.push(submission),
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result, { enabled: true, revision: 1, queueJobId: 1 });
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].revision, 1);
  assert.deepEqual(
    database
      .prepare("SELECT cluster_id, revision, status FROM thought_topology_jobs")
      .get(),
    { cluster_id: 1, revision: 1, status: "queued" },
  );
  database.close();
});

test("canonical creation is explicit and disabled API/preview paths stay legacy and side-effect free", () => {
  const createSource = fs.readFileSync(
    new URL("../src/app/actions/clusters.ts", import.meta.url),
    "utf8",
  );
  const apiSource = fs.readFileSync(
    new URL("../src/app/api/thought-topology/route.ts", import.meta.url),
    "utf8",
  );
  const previewSource = fs.readFileSync(
    new URL("../src/app/api/quartz-graph-preview/route.ts", import.meta.url),
    "utf8",
  );
  const publishSource = fs.readFileSync(
    new URL("../src/lib/quartz-publish.ts", import.meta.url),
    "utf8",
  );
  const schemaSource = fs.readFileSync(
    new URL("../src/lib/thought-topology/schema.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    createSource,
    /thought_topology_enabled, thought_topology_revision[\s\S]{0,100}1, 0/,
  );
  assert.match(
    schemaSource,
    /CREATE TRIGGER IF NOT EXISTS clusters_enable_thought_topology_on_insert/,
  );
  assert.match(
    apiSource,
    /if \(cluster\.thought_topology_enabled !== 1\)[\s\S]{0,180}enabled: false, mode: "links"/,
  );
  assert.doesNotMatch(
    apiSource,
    /invalidateThoughtTopology|startThoughtTopology|scanClusterKnowledge/,
  );
  assert.match(
    previewSource,
    /cluster\.thought_topology_enabled === 1 \? 'thought-topology' : 'links'/,
  );
  assert.match(
    publishSource,
    /if \(options\.gardenSlug\)[\s\S]{0,180}invalidateThoughtTopologyAfterMutation/,
  );
  assert.doesNotMatch(
    publishSource,
    /scanClusterKnowledge|buildThoughtTopology/,
  );
});

test.after(() => {
  // The imported dashboard singleton may still hold its isolated SQLite file
  // open on Windows. The sentinel content itself is intentionally retained only
  // under the OS temp root and never points at a real Garden.
});
