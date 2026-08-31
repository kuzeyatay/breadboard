import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const isolatedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "breadboard-topology-builder-"),
);
process.env.BREADBOARD_DATA_DIR = path.join(isolatedRoot, "data");
await import("../scripts/learn-worker-import-hook.mjs");
const { buildThoughtTopologyInRuntimeWorker } =
  await import("../src/lib/thought-topology/builder.ts");
const {
  commitThoughtTopology,
  readThoughtTopology,
  readThoughtTopologyCache,
  rendererArtifactContainsVector,
} = await import("../src/lib/thought-topology/storage.ts");
const { DEFAULT_TOPOLOGY_CACHE_VERSIONS } =
  await import("../src/lib/thought-topology/cache.ts");

function databaseFixture(slug, revision = 1) {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      thought_topology_enabled INTEGER NOT NULL DEFAULT 0,
      thought_topology_revision INTEGER NOT NULL DEFAULT 0
    );
  `);
  database
    .prepare("INSERT INTO clusters VALUES (1, 7, ?, 'Fixture Garden', 1, ?)")
    .run(slug, revision);
  return database;
}

function markdown(title, body, related = []) {
  return `---\ntitle: ${JSON.stringify(title)}\nknowledge_type: "user-note"\nrelated: [${related.map(JSON.stringify).join(", ")}]\n---\n\n# ${title}\n\n${body}\n`;
}

function sourceMarkdown(title, body) {
  return `---\ntitle: ${JSON.stringify(title)}\nknowledge_type: "source-document"\nbreadboardType: "source_document"\n---\n\n# ${title}\n\n${body}\n`;
}

function fakeVector(text) {
  const lowered = text.toLowerCase();
  const vector = [
    lowered.includes("flux") ? 1 : 0.1,
    lowered.includes("current") ? 1 : 0.1,
    lowered.includes("potential") ? 1 : 0.1,
  ];
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

test("incremental builds reuse enrichment on moves, invalidate edits, remove deletions, and keep vectors private", async () => {
  const contentRoot = path.join(isolatedRoot, "content");
  const slug = "new-fixture";
  const gardenDir = path.join(contentRoot, slug);
  fs.mkdirSync(gardenDir, { recursive: true });
  fs.writeFileSync(
    path.join(gardenDir, "_index.md"),
    "---\ntitle: Fixture Garden\n---\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "gauss.md"),
    markdown(
      "Gauss law",
      "Electric flux through a closed surface relates to enclosed charge.",
      ["divergence"],
    ),
  );
  fs.writeFileSync(
    path.join(gardenDir, "divergence.md"),
    markdown(
      "Divergence theorem",
      "The divergence theorem converts volume divergence into surface flux.",
    ),
  );
  const database = databaseFixture(slug);
  const batches = [];
  const dependencies = {
    generator: async () =>
      JSON.stringify({
        summary:
          "A grounded summary generated from the deterministic projection.",
      }),
    embed: async (texts) => {
      batches.push([...texts]);
      return {
        model: "local/bge-small-en-v1.5",
        dimension: 3,
        vectors: texts.map(fakeVector),
      };
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  };

  const first = await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 1,
    contentRoot,
    database,
    dependencies,
  });
  assert.equal(first.status, "built");
  assert.equal(batches.flat().length, 2);
  const firstArtifact = readThoughtTopology(gardenDir);
  assert.equal(firstArtifact.nodes.length, 2);
  assert.equal(
    firstArtifact.nodes.every((node) => node.summary.state === "ready"),
    true,
  );
  assert.equal(rendererArtifactContainsVector(firstArtifact), false);
  assert.equal(
    readThoughtTopologyCache(gardenDir).nodes["page:gauss"].embedding.length,
    3,
  );

  const firstCache = readThoughtTopologyCache(gardenDir);
  assert.throws(
    () =>
      commitThoughtTopology(
        gardenDir,
        { ...firstCache, sourceRevision: "failed-rebuild-cache" },
        {
          ...firstArtifact,
          build: { ...firstArtifact.build, generatedAt: 1n },
        },
      ),
    /BigInt/,
  );
  assert.equal(
    readThoughtTopology(gardenDir).sourceRevision,
    firstArtifact.sourceRevision,
    "failed renderer commit retains the last known good topology",
  );
  assert.equal(
    fs
      .readdirSync(path.join(gardenDir, ".breadboard"))
      .some((name) => name.includes(".pending-")),
    false,
  );

  // Merely opening the existing artifact is a pure read and invokes neither callback.
  const callsBeforeOpen = batches.length;
  assert.equal(
    readThoughtTopology(gardenDir).sourceRevision,
    firstArtifact.sourceRevision,
  );
  assert.equal(batches.length, callsBeforeOpen);

  fs.mkdirSync(path.join(gardenDir, "laws"));
  fs.renameSync(
    path.join(gardenDir, "gauss.md"),
    path.join(gardenDir, "laws", "gauss.md"),
  );
  database.prepare("UPDATE clusters SET thought_topology_revision = 2").run();
  const moved = await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 2,
    contentRoot,
    database,
    dependencies,
  });
  assert.equal(moved.status, "built");
  assert.equal(
    batches.length,
    callsBeforeOpen,
    "folder move must not call embedding",
  );
  assert.equal(
    readThoughtTopology(gardenDir).nodes.find(
      (node) => node.id === "page:gauss",
    ).folderId,
    "folder:laws",
  );

  fs.appendFileSync(
    path.join(gardenDir, "laws", "gauss.md"),
    "\nA changed flux passage now adds a sufficiently detailed explanation of enclosed charge and closed surfaces.\n",
  );
  database.prepare("UPDATE clusters SET thought_topology_revision = 3").run();
  await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 3,
    contentRoot,
    database,
    dependencies,
  });
  assert.equal(
    batches.at(-1).length,
    1,
    "one body edit embeds one changed node",
  );

  fs.rmSync(path.join(gardenDir, "divergence.md"));
  database.prepare("UPDATE clusters SET thought_topology_revision = 4").run();
  await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 4,
    contentRoot,
    database,
    dependencies,
  });
  const afterDelete = readThoughtTopology(gardenDir);
  assert.equal(afterDelete.nodes.length, 1);
  assert.equal(
    afterDelete.edges.some(
      (edge) =>
        edge.source === "page:divergence" || edge.target === "page:divergence",
    ),
    false,
  );

  const retainedSummary = afterDelete.nodes[0].summary;
  database.prepare("UPDATE clusters SET thought_topology_revision = 5").run();
  await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 5,
    contentRoot,
    database,
    dependencies: {
      cacheVersions: {
        ...DEFAULT_TOPOLOGY_CACHE_VERSIONS,
        embeddingModel: "local/test-model-v2",
      },
      embed: async (texts) => ({
        model: "local/test-model-v2",
        dimension: 3,
        vectors: texts.map(fakeVector),
      }),
      generator: async () => {
        throw new Error(
          "an embedding-only invalidation must not regenerate summaries",
        );
      },
    },
  });
  assert.deepEqual(
    readThoughtTopology(gardenDir).nodes[0].summary,
    retainedSummary,
  );
  database.close();
});

test("a revision change during enrichment can never publish stale output", async () => {
  const contentRoot = path.join(isolatedRoot, "stale-content");
  const slug = "stale-fixture";
  const gardenDir = path.join(contentRoot, slug);
  fs.mkdirSync(gardenDir, { recursive: true });
  fs.writeFileSync(
    path.join(gardenDir, "note.md"),
    markdown(
      "Potential",
      "Electric potential determines an electric field through its gradient.",
    ),
  );
  const database = databaseFixture(slug);
  let changed = false;
  const result = await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 1,
    contentRoot,
    database,
    dependencies: {
      embed: async (texts) => ({
        model: "local/bge-small-en-v1.5",
        dimension: 3,
        vectors: texts.map(fakeVector),
      }),
      generator: async () => {
        if (!changed) {
          changed = true;
          database
            .prepare("UPDATE clusters SET thought_topology_revision = 2")
            .run();
        }
        return JSON.stringify({
          summary: "A grounded description of electric potential.",
        });
      },
    },
  });
  assert.equal(result.status, "stale");
  assert.equal(
    fs.existsSync(path.join(gardenDir, ".breadboard", "thought-topology.json")),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(gardenDir, ".breadboard", "thought-topology-cache.json"),
    ),
    false,
  );
  database.close();
});

test("source-document Markdown becomes a topology node under its source folder", async () => {
  const contentRoot = path.join(isolatedRoot, "source-content");
  const slug = "source-fixture";
  const gardenDir = path.join(contentRoot, slug);
  fs.mkdirSync(path.join(gardenDir, "sources"), { recursive: true });
  fs.writeFileSync(
    path.join(gardenDir, "sources", "reference.md"),
    sourceMarkdown(
      "Field theory reference",
      "Electric flux, charge density, divergence, and boundary conditions connect integral and differential field laws.",
    ),
  );
  const database = databaseFixture(slug);
  const result = await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 1,
    contentRoot,
    database,
    dependencies: {
      generator: null,
      embed: async () => {
        throw new Error("offline fixture");
      },
    },
  });
  assert.equal(result.status, "built");
  const artifact = readThoughtTopology(gardenDir);
  assert.equal(artifact.nodes.length, 1);
  assert.equal(artifact.nodes[0].kind, "source");
  assert.equal(artifact.nodes[0].folderId, "folder:sources");
  assert.equal(
    artifact.folders.some((folder) => folder.id === "folder:sources"),
    true,
  );
  database.close();
});
