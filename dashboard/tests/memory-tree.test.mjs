// The memory tree, its markdown vault, and the one query that reads both.
//
// What matters here is not that clustering produces pretty groups — that is a
// judgement call the user can override — but that the round trip is lossless
// in the direction that counts. A fact must survive being written to a file,
// edited by hand, and read back; a correction must outlive the next rebuild;
// and nothing in this layer may create or destroy a memory the user did not
// ask it to.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-memory-tree-"));
const vaultRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-vault-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
process.env.BREADBOARD_MEMORY_VAULT_DIR = vaultRootDir;

const { default: db } = await import("../src/lib/db.ts");
const { buildMemoryTree } = await import("../src/lib/memory-tree/build.ts");
const { exportVault, importVault, vaultRoot } = await import(
  "../src/lib/memory-tree/vault.ts"
);
const { treeStatus, ensureFreshTree, syncVault } = await import(
  "../src/lib/memory-tree/maintain.ts"
);
const { memoryQuery } = await import("../src/lib/memory-tree/query.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.rmSync(vaultRootDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM memory_tree_links;
    DELETE FROM memory_tree_nodes;
    DELETE FROM memory_vault_files;
    DELETE FROM memory_tree_state;
    DELETE FROM durable_memories;
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
  fs.rmSync(vaultRoot(1), { recursive: true, force: true });
});

function remember(content, overrides = {}) {
  const row = {
    kind: "project_fact",
    scope: "global",
    scopeId: null,
    state: "confirmed",
    confidence: 0.9,
    salience: 0.8,
    ...overrides,
  };
  return Number(
    db
      .prepare(
        `INSERT INTO durable_memories
           (user_id, content, kind, scope, scope_id, state, confidence, salience,
            last_confirmed_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        content,
        row.kind,
        row.scope,
        row.scopeId,
        row.state,
        row.confidence,
        row.salience,
      ).lastInsertRowid,
  );
}

function seedPumpsAndTravel() {
  remember("The pump rig runs on a 24V supply");
  remember("The pump rig impeller is a five-blade design");
  remember("Pump rig pressure is logged every 30 seconds");
  remember("Prefers window seats on long flights");
  remember("Flights out of Schiphol are easier than Heathrow");
}

// ── building ──────────────────────────────────────────────────────────

test("a tree groups memories that share vocabulary", () => {
  seedPumpsAndTravel();
  const built = buildMemoryTree(1, db);

  assert.equal(built.memories, 5);
  assert.ok(built.topics >= 1, "at least one topic should form");

  const topics = db
    .prepare(`SELECT title, memory_count FROM memory_tree_nodes WHERE user_id = 1 AND kind = 'topic'`)
    .all();
  const pumpTopic = topics.find((topic) => /pump/i.test(topic.title));
  assert.ok(pumpTopic, `expected a pump topic, got ${JSON.stringify(topics)}`);
  assert.ok(pumpTopic.memory_count >= 2);
});

test("every memory is reachable from the tree", () => {
  seedPumpsAndTravel();
  remember("Completely unrelated singleton fact about zebras");
  buildMemoryTree(1, db);

  const linked = db
    .prepare(
      `SELECT COUNT(DISTINCT l.memory_id) AS n
       FROM memory_tree_links l
       JOIN memory_tree_nodes n ON n.id = l.node_id
       WHERE n.user_id = 1`,
    )
    .get();
  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM durable_memories
       WHERE user_id = 1 AND state IN ('candidate','confirmed')`,
    )
    .get();
  assert.equal(linked.n, total.n, "a fact nobody can reach is a fact nobody stored");
});

test("superseded memories are left out", () => {
  remember("Still true");
  const retired = remember("No longer true");
  db.prepare(`UPDATE durable_memories SET state = 'superseded' WHERE id = ?`).run(retired);

  const built = buildMemoryTree(1, db);
  assert.equal(built.memories, 1);
});

test("scopes split before topics do", () => {
  remember("Global preference about tea", { scope: "global" });
  remember("Garden fact about tea", { scope: "garden", scopeId: "7" });
  buildMemoryTree(1, db);

  const scopes = db
    .prepare(`SELECT scope, scope_id FROM memory_tree_nodes WHERE user_id = 1 AND kind = 'scope'`)
    .all();
  assert.equal(scopes.length, 2);
});

test("rebuilding is idempotent", () => {
  seedPumpsAndTravel();
  const first = buildMemoryTree(1, db);
  const second = buildMemoryTree(1, db);
  assert.deepEqual(first, second);
});

// ── the vault ─────────────────────────────────────────────────────────

test("exporting writes one note per memory plus its topics", () => {
  seedPumpsAndTravel();
  buildMemoryTree(1, db);
  const exported = exportVault(1, db);

  assert.ok(exported.written > 5, "notes for the memories and the branches");
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(exported.root);
  const bodies = files.map((file) => fs.readFileSync(file, "utf8"));
  assert.ok(
    bodies.some((body) => body.includes("The pump rig runs on a 24V supply")),
    "the fact itself should be readable in a file",
  );
  assert.ok(
    bodies.some((body) => body.includes("[[")),
    "notes should link to each other",
  );
});

test("a second export rewrites nothing that has not changed", () => {
  seedPumpsAndTravel();
  buildMemoryTree(1, db);
  exportVault(1, db);
  const second = exportVault(1, db);
  assert.equal(second.written, 0);
  assert.ok(second.unchanged > 0);
});

test("editing a note in the vault corrects the memory", () => {
  const id = remember("The pump rig runs on a 12V supply");
  remember("The pump rig impeller is a five-blade design");
  buildMemoryTree(1, db);
  const exported = exportVault(1, db);

  const record = db
    .prepare(`SELECT path FROM memory_vault_files WHERE user_id = 1 AND memory_id = ?`)
    .get(id);
  assert.ok(record, "the memory should have a file");

  const file = path.join(exported.root, record.path);
  const raw = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, raw.replace("12V", "24V"), "utf8");

  const imported = importVault(1, db);
  assert.equal(imported.updated, 1);
  assert.equal(imported.rejected.length, 0);

  const row = db.prepare(`SELECT content, state FROM durable_memories WHERE id = ?`).get(id);
  assert.match(row.content, /24V/);
  assert.equal(row.state, "confirmed", "a hand correction is a confirmation");
});

test("deleting a note retires the memory", () => {
  const id = remember("A fact the user no longer wants kept");
  remember("Another fact entirely");
  buildMemoryTree(1, db);
  const exported = exportVault(1, db);

  const record = db
    .prepare(`SELECT path FROM memory_vault_files WHERE user_id = 1 AND memory_id = ?`)
    .get(id);
  fs.rmSync(path.join(exported.root, record.path));

  const imported = importVault(1, db);
  assert.equal(imported.retired, 1);
  assert.equal(
    db.prepare(`SELECT state FROM durable_memories WHERE id = ?`).get(id).state,
    "superseded",
  );
});

test("an emptied note is rejected rather than erasing the memory", () => {
  const id = remember("A fact worth keeping");
  remember("Another fact entirely");
  buildMemoryTree(1, db);
  const exported = exportVault(1, db);
  const record = db
    .prepare(`SELECT path FROM memory_vault_files WHERE user_id = 1 AND memory_id = ?`)
    .get(id);

  fs.writeFileSync(path.join(exported.root, record.path), "---\nmemory_id: 1\n---\n\n", "utf8");
  const imported = importVault(1, db);

  assert.equal(imported.updated, 0);
  assert.equal(imported.rejected.length, 1);
  assert.match(
    db.prepare(`SELECT content FROM durable_memories WHERE id = ?`).get(id).content,
    /worth keeping/,
  );
});

test("renaming a topic survives the next rebuild", () => {
  seedPumpsAndTravel();
  buildMemoryTree(1, db);
  const exported = exportVault(1, db);

  const topic = db
    .prepare(
      `SELECT n.id, n.title, f.path FROM memory_tree_nodes n
       JOIN memory_vault_files f ON f.node_id = n.id
       WHERE n.user_id = 1 AND n.kind = 'topic' LIMIT 1`,
    )
    .get();
  assert.ok(topic);

  const file = path.join(exported.root, topic.path);
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(`# ${topic.title}`, "# The Hydraulics Rig"),
    "utf8",
  );

  const imported = importVault(1, db);
  assert.equal(imported.renamed, 1);

  buildMemoryTree(1, db);
  const titles = db
    .prepare(`SELECT title FROM memory_tree_nodes WHERE user_id = 1 AND kind = 'topic'`)
    .all()
    .map((row) => row.title);
  assert.ok(
    titles.includes("The Hydraulics Rig"),
    `a rebuild must not undo the user's rename, got ${JSON.stringify(titles)}`,
  );
});

test("syncing reads edits before it writes files", () => {
  const id = remember("The pump rig runs on a 12V supply");
  remember("The pump rig impeller is a five-blade design");
  syncVault(1, db);

  const record = db
    .prepare(`SELECT path FROM memory_vault_files WHERE user_id = 1 AND memory_id = ?`)
    .get(id);
  const file = path.join(vaultRoot(1), record.path);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("12V", "48V"), "utf8");

  const result = syncVault(1, db);
  assert.equal(result.imported.updated, 1);
  assert.match(
    db.prepare(`SELECT content FROM durable_memories WHERE id = ?`).get(id).content,
    /48V/,
  );
});

// ── freshness ─────────────────────────────────────────────────────────

test("the tree is rebuilt only when the facts change", () => {
  seedPumpsAndTravel();
  assert.ok(treeStatus(1, db).stale);
  assert.ok(ensureFreshTree(1, db), "first call builds");
  assert.equal(ensureFreshTree(1, db), null, "second call is a no-op");

  remember("A brand new fact");
  assert.ok(treeStatus(1, db).stale);
  assert.ok(ensureFreshTree(1, db), "a new memory makes it stale again");
});

// ── the one query ─────────────────────────────────────────────────────

test("browse returns the branches, deepest score first", async () => {
  seedPumpsAndTravel();
  const result = await memoryQuery({ userId: 1, mode: "browse" }, db);
  assert.equal(result.ranking, "tree");
  assert.ok(result.branches.length > 0);
  assert.ok(result.branches[0].children.length > 0, "scopes should carry topics");
});

test("topic opens one branch by title or slug", async () => {
  seedPumpsAndTravel();
  await memoryQuery({ userId: 1, mode: "browse" }, db);
  const topic = db
    .prepare(`SELECT title, slug FROM memory_tree_nodes WHERE user_id = 1 AND kind = 'topic' LIMIT 1`)
    .get();

  const byTitle = await memoryQuery({ userId: 1, mode: "topic", topic: topic.title }, db);
  const bySlug = await memoryQuery({ userId: 1, mode: "topic", topic: topic.slug }, db);
  assert.ok(byTitle.hits.length > 0);
  assert.deepEqual(
    byTitle.hits.map((hit) => hit.id),
    bySlug.hits.map((hit) => hit.id),
  );
});

test("search reports which ranking answered", async () => {
  seedPumpsAndTravel();
  const result = await memoryQuery({ userId: 1, mode: "search", query: "impeller" }, db);
  assert.ok(["lexical", "hybrid"].includes(result.ranking));
  assert.ok(result.hits.some((hit) => /impeller/i.test(hit.content)));
});

test("search hits carry the topics they belong to", async () => {
  seedPumpsAndTravel();
  ensureFreshTree(1, db);
  const result = await memoryQuery({ userId: 1, mode: "search", query: "pump rig supply" }, db);
  assert.ok(result.hits.length > 0);
  assert.ok(
    result.hits.some((hit) => hit.topics.length > 0),
    "a flat row plus its branch is the whole point of the tree",
  );
});

test("stats says what is there", async () => {
  seedPumpsAndTravel();
  const result = await memoryQuery({ userId: 1, mode: "stats" }, db);
  assert.equal(result.stats.remembered, 5);
  assert.equal(result.stats.confirmed, 5);
  assert.ok(result.stats.topics >= 1);
});

test("an unknown topic answers rather than throwing", async () => {
  seedPumpsAndTravel();
  const result = await memoryQuery({ userId: 1, mode: "topic", topic: "nothing here" }, db);
  assert.equal(result.hits.length, 0);
  assert.match(result.note, /No branch/);
});

test("a query with nothing remembered is not an error", async () => {
  const result = await memoryQuery({ userId: 1, mode: "search", query: "anything" }, db);
  assert.equal(result.hits.length, 0);
  assert.equal(result.ranking, "none");
});
