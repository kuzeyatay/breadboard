import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-topology-api-"));
process.env.BREADBOARD_DATA_DIR = path.join(isolatedRoot, "data");
process.env.QUARTZ_CONTENT_PATH = path.join(isolatedRoot, "content");
fs.mkdirSync(process.env.QUARTZ_CONTENT_PATH, { recursive: true });

await import("../scripts/learn-worker-import-hook.mjs");
const db = (await import("../src/lib/db.ts")).default;
const auth = await import("../src/lib/server-auth.ts");
const route = await import("../src/app/api/thought-topology/route.ts");

function insertUser(username) {
  return Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, 'x')").run(username, `${username}@example.test`).lastInsertRowid);
}

const owner = insertUser("topology-owner");
const member = insertUser("topology-member");
const stranger = insertUser("topology-stranger");
const organizationId = Number(db.prepare("INSERT INTO organizations (name, created_by_user_id) VALUES ('Topology Org', ?)").run(owner).lastInsertRowid);
db.prepare("INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'owner')").run(organizationId, owner);
db.prepare("INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'member')").run(organizationId, member);

function insertGarden(slug, visibility, organization = null, enabled = 0) {
  const gardenId = Number(db.prepare(`INSERT INTO clusters (
    user_id, name, slug, visibility, organization_id,
    thought_topology_enabled, thought_topology_revision
  ) VALUES (?, ?, ?, ?, ?, ?, 0)`).run(
    owner,
    slug,
    slug,
    visibility,
    organization,
    enabled,
  ).lastInsertRowid);
  // The production insert trigger enables topology for new Gardens. Tests
  // that exercise the legacy disabled read path must override that default.
  db.prepare("UPDATE clusters SET thought_topology_enabled = ? WHERE id = ?").run(
    enabled,
    gardenId,
  );
}

insertGarden("owner-private", "private");
insertGarden("org-readable", "organization", organizationId);
insertGarden("public-readable", "public");
insertGarden("public-enabled", "public", null, 1);

test("read authorization covers owner, organization member, public, and rejects private strangers", () => {
  assert.equal(auth.requireReadableCluster(owner, "owner-private").slug, "owner-private");
  assert.equal(auth.requireReadableCluster(member, "org-readable").slug, "org-readable");
  assert.equal(auth.requireReadableCluster(stranger, "public-readable").slug, "public-readable");
  assert.throws(() => auth.requireReadableCluster(stranger, "owner-private"), /Cluster not found/);
});

test("unauthenticated public disabled GET is bounded legacy data and creates no work", async () => {
  const before = db.prepare("SELECT count(*) AS count FROM thought_topology_jobs").get().count;
  const response = await route.GET(new Request("http://dashboard.local/api/thought-topology?clusterSlug=public-readable", {
    headers: { origin: "http://localhost:8081" },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8081");
  assert.deepEqual(await response.json(), { enabled: false, mode: "links" });
  assert.equal(db.prepare("SELECT count(*) AS count FROM thought_topology_jobs").get().count, before);
  assert.equal(fs.existsSync(path.join(process.env.QUARTZ_CONTENT_PATH, "public-readable", ".breadboard")), false);
});

test("public enabled reads return only the sanitized renderer artifact", async () => {
  const derived = path.join(process.env.QUARTZ_CONTENT_PATH, "public-enabled", ".breadboard");
  fs.mkdirSync(derived, { recursive: true });
  const topology = {
    schemaVersion: 1,
    scoringVersion: "thought-topology-affinity-v1",
    sourceRevision: "public-fixture",
    garden: { id: 4, slug: "public-enabled", title: "Public enabled", summary: { state: "ready", text: "Public summary." } },
    folders: [],
    nodes: [],
    edges: [],
    build: { state: "ready", generatedAt: "2026-01-01T00:00:00.000Z", embeddingModel: "local/bge-small-en-v1.5", embeddingDimension: 3, summaryModel: "test", nodePromptVersion: "v1", edgePromptVersion: "v1", retrievalMode: "semantic-vector", threshold: 0.68 },
  };
  fs.writeFileSync(path.join(derived, "thought-topology.json"), JSON.stringify(topology));
  fs.writeFileSync(path.join(derived, "thought-topology-cache.json"), JSON.stringify({ secretMarker: "PRIVATE_VECTOR_MARKER", nodes: { note: { embedding: [1, 2, 3] } } }));
  const clusterId = db.prepare("SELECT id FROM clusters WHERE slug = 'public-enabled'").get().id;
  db.prepare("INSERT INTO thought_topology_jobs (cluster_id, revision, reason, status, last_error) VALUES (?, 1, 'fixture', 'failed', 'private worker detail')").run(clusterId);
  const response = await route.GET(new Request("http://dashboard.local/api/thought-topology?clusterSlug=public-enabled"));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.doesNotMatch(body, /PRIVATE_VECTOR_MARKER|\[1,2,3\]/);
  assert.doesNotMatch(body, /private worker detail/);
  const payload = JSON.parse(body);
  assert.equal(payload.topology.sourceRevision, "public-fixture");
  assert.deepEqual(payload.status, { state: "failed", message: "Showing the last available topology; the latest update failed." });
  assert.equal(payload.stale, true);
});

test("published Quartz receives a credentialed, allowlisted read transport", async () => {
  const response = await route.OPTIONS(new Request("http://dashboard.local/api/thought-topology", {
    method: "OPTIONS",
    headers: { origin: "http://localhost:8081" },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8081");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});
