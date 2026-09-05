import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import {
  deleteGardenDatabaseRows,
  gardenDatabaseResidue,
  inventoryGardenOwnedData,
} from "../src/lib/garden-deletion-db.ts";

function fixture() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE clusters (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, slug TEXT UNIQUE NOT NULL);
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
      default_garden_id INTEGER REFERENCES clusters(id) ON DELETE SET NULL
    );
    CREATE TABLE hermes_runtime_sessions (
      id INTEGER PRIMARY KEY, cluster_id INTEGER, garden_id TEXT,
      conversation_id INTEGER, allowed_garden_ids TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE openharness_runtime_sessions (
      id INTEGER PRIMARY KEY, cluster_id INTEGER, garden_id TEXT,
      conversation_id INTEGER, allowed_garden_ids TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE hermes_artifacts (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, cluster_id INTEGER,
      conversation_id INTEGER NOT NULL, runtime_session_id INTEGER NOT NULL
    );
    CREATE TABLE openharness_artifacts (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, cluster_id INTEGER,
      conversation_id INTEGER NOT NULL, runtime_session_id INTEGER NOT NULL
    );
    CREATE TABLE cad_projects (
      id TEXT PRIMARY KEY, cluster_id INTEGER, conversation_id INTEGER NOT NULL
    );
    CREATE TABLE gbrain_garden_sources (
      cluster_id INTEGER, garden_slug TEXT, source_id TEXT PRIMARY KEY
    );
    CREATE TABLE gbrain_sync_jobs (id INTEGER PRIMARY KEY, cluster_id INTEGER, source_id TEXT);
    CREATE TABLE learn_jobs (id TEXT PRIMARY KEY, garden_id TEXT);
    CREATE TABLE learn_maps (id TEXT PRIMARY KEY, garden_id TEXT);
    CREATE TABLE review_cards (id INTEGER PRIMARY KEY, garden_slug TEXT);
    CREATE TABLE review_gardens (garden_slug TEXT PRIMARY KEY);
    CREATE TABLE scheduled_chat_jobs (id INTEGER PRIMARY KEY, garden_slug TEXT);
    CREATE TABLE hooks (id TEXT PRIMARY KEY, garden_slug TEXT);
    CREATE TABLE hermes_audit_events (id INTEGER PRIMARY KEY, garden_id TEXT);
    CREATE TABLE runtime_v2_outer_agent_runs (job_id TEXT PRIMARY KEY, garden_id TEXT);
    CREATE TABLE semantic_chunks (id TEXT PRIMARY KEY, garden_slug TEXT);
    CREATE VIRTUAL TABLE semantic_chunks_fts USING fts5(id UNINDEXED, garden_slug UNINDEXED, content);
    CREATE TABLE durable_memories (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, scope TEXT NOT NULL, scope_id TEXT
    );
    CREATE TABLE memory_tree_nodes (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
      parent_id INTEGER REFERENCES memory_tree_nodes(id) ON DELETE CASCADE,
      scope TEXT, scope_id TEXT
    );
    CREATE TABLE memory_vault_files (
      user_id INTEGER NOT NULL, path TEXT NOT NULL,
      node_id INTEGER REFERENCES memory_tree_nodes(id) ON DELETE CASCADE,
      memory_id INTEGER REFERENCES durable_memories(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, path)
    );

    INSERT INTO clusters VALUES (1, 7, 'doomed'), (2, 7, 'kept');
    INSERT INTO conversations VALUES (10, 7, 1), (20, 7, 2);
    INSERT INTO hermes_runtime_sessions VALUES
      (100, 1, 'doomed', 10, '[1,2]'),
      (200, 2, 'kept', 20, '[1,2]');
    INSERT INTO openharness_runtime_sessions VALUES
      (300, 1, 'doomed', 10, '[1,2]'),
      (400, 2, 'kept', 20, '[1,2]');
    INSERT INTO hermes_artifacts VALUES
      ('ha-doomed', 7, 1, 10, 100),
      ('ha-kept', 7, 2, 20, 200);
    INSERT INTO openharness_artifacts VALUES
      ('oa-doomed', 7, 1, 10, 300),
      ('oa-kept', 7, 2, 20, 400);
    INSERT INTO cad_projects VALUES ('cad-doomed', 1, 10), ('cad-kept', 2, 20);
    INSERT INTO gbrain_garden_sources VALUES
      (1, 'doomed', 'gbrain-src-cluster-1'),
      (2, 'kept', 'gbrain-src-cluster-2');
    INSERT INTO gbrain_sync_jobs VALUES
      (1, 1, 'gbrain-src-cluster-1'),
      (2, 2, 'gbrain-src-cluster-2');
    INSERT INTO learn_jobs VALUES ('learn-doomed', 'doomed'), ('learn-kept', 'kept');
    INSERT INTO learn_maps VALUES ('map-doomed', 'doomed'), ('map-kept', 'kept');
    INSERT INTO review_cards VALUES (1, 'doomed'), (2, 'kept');
    INSERT INTO review_gardens VALUES ('doomed'), ('kept');
    INSERT INTO scheduled_chat_jobs VALUES (1, 'doomed'), (2, 'kept');
    INSERT INTO hooks VALUES ('hook-doomed', 'doomed'), ('hook-kept', 'kept');
    INSERT INTO hermes_audit_events VALUES (1, 'doomed'), (2, 'kept');
    INSERT INTO runtime_v2_outer_agent_runs VALUES ('run-doomed', 'doomed'), ('run-kept', 'kept');
    INSERT INTO semantic_chunks VALUES ('chunk-doomed', 'doomed'), ('chunk-kept', 'kept');
    INSERT INTO semantic_chunks_fts VALUES ('chunk-doomed', 'doomed', 'gone');
    INSERT INTO semantic_chunks_fts VALUES ('chunk-kept', 'kept', 'stay');
    INSERT INTO durable_memories VALUES
      (71, 7, 'garden', '1'), (72, 7, 'garden', '2'), (73, 7, 'global', NULL);
    INSERT INTO memory_tree_nodes VALUES
      (81, 7, NULL, 'garden', '1'), (82, 7, 81, 'garden', '1'),
      (83, 7, NULL, 'garden', '2');
    INSERT INTO memory_vault_files VALUES
      (7, 'Garden 1/memory.md', 81, NULL),
      (7, 'Garden 1/fact.md', NULL, 71),
      (7, 'Garden 2/memory.md', 83, NULL),
      (7, 'Garden 2/fact.md', NULL, 72);
  `);
  return database;
}

test("Garden deletion removes every owned row and preserves other Gardens", () => {
  const database = fixture();
  const inventory = inventoryGardenOwnedData(database, {
    clusterId: 1,
    userId: 7,
    gardenSlug: "doomed",
  });

  assert.deepEqual(inventory.conversationIds, [10]);
  assert.deepEqual(inventory.runtimeSessionIds, [100]);
  assert.deepEqual(inventory.openharnessRuntimeSessionIds, [300]);
  assert.deepEqual(inventory.durableMemoryIds, [71]);
  assert.deepEqual(inventory.memoryTreeNodeIds.sort(), [81, 82]);
  assert.deepEqual(inventory.memoryVaultPaths.sort(), [
    "Garden 1/fact.md",
    "Garden 1/memory.md",
  ]);
  assert.deepEqual(
    inventory.artifactDirectories.map((artifact) => artifact.artifactId).sort(),
    ["ha-doomed", "oa-doomed"],
  );

  deleteGardenDatabaseRows(database, {
    clusterId: 1,
    userId: 7,
    gardenSlug: "doomed",
    inventory,
  });

  assert.deepEqual(
    gardenDatabaseResidue(database, {
      clusterId: 1,
      userId: 7,
      gardenSlug: "doomed",
    }),
    [],
  );
  assert.equal(database.prepare("SELECT count(*) n FROM clusters").get().n, 1);
  assert.equal(database.prepare("SELECT slug FROM clusters").get().slug, "kept");
  assert.equal(database.prepare("SELECT count(*) n FROM conversations").get().n, 1);
  assert.equal(database.prepare("SELECT count(*) n FROM hermes_artifacts").get().n, 1);
  assert.equal(database.prepare("SELECT count(*) n FROM openharness_artifacts").get().n, 1);
  assert.equal(database.prepare("SELECT count(*) n FROM semantic_chunks").get().n, 1);
  assert.equal(database.prepare("SELECT count(*) n FROM semantic_chunks_fts").get().n, 1);
  assert.equal(database.prepare("SELECT count(*) n FROM durable_memories").get().n, 2);
  assert.equal(database.prepare("SELECT count(*) n FROM memory_tree_nodes").get().n, 1);
  assert.equal(database.prepare("SELECT count(*) n FROM memory_vault_files").get().n, 2);
  assert.equal(
    database.prepare("SELECT allowed_garden_ids value FROM hermes_runtime_sessions").get().value,
    "[2]",
  );
  assert.equal(
    database.prepare("SELECT allowed_garden_ids value FROM openharness_runtime_sessions").get().value,
    "[2]",
  );
  database.close();
});
