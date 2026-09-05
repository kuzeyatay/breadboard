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
  thoughtTopologyHasCompleteConnections,
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

function sourceMarkdown(title, body, sourceType = "") {
  return `---\ntitle: ${JSON.stringify(title)}\nknowledge_type: "source-document"\nbreadboardType: "source_document"\n${sourceType ? `source_type: ${JSON.stringify(sourceType)}\n` : ""}---\n\n# ${title}\n\n${body}\n`;
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

test("an unchanged Markdown projection is a no-op that keeps the published topology byte-for-byte", async () => {
  const contentRoot = path.join(isolatedRoot, "unchanged-content");
  const slug = "unchanged-fixture";
  const gardenDir = path.join(contentRoot, slug);
  fs.mkdirSync(gardenDir, { recursive: true });
  fs.writeFileSync(
    path.join(gardenDir, "note.md"),
    markdown("Potential", "Electric potential determines an electric field through its gradient."),
  );
  const database = databaseFixture(slug);
  await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 1,
    contentRoot,
    database,
    dependencies: {
      embed: async (texts) => ({ model: "local/bge-small-en-v1.5", dimension: 3, vectors: texts.map(fakeVector) }),
      generator: async () => JSON.stringify({ summary: "A grounded description of electric potential." }),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  const before = readThoughtTopology(gardenDir);
  database.prepare("UPDATE clusters SET thought_topology_revision = 2").run();
  const progress = [];
  const result = await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 2,
    contentRoot,
    database,
    dependencies: {
      embed: async () => { throw new Error("unchanged pages must not be embedded again"); },
      generator: async () => { throw new Error("unchanged topology must not be regenerated"); },
      now: () => new Date("2027-01-01T00:00:00.000Z"),
    },
    onProgress: (percent) => progress.push(percent),
  });
  assert.equal(result.status, "built");
  assert.deepEqual(readThoughtTopology(gardenDir), before);
  assert.deepEqual(progress, [100]);
  database.close();
});

test("a new Markdown page is inserted while existing nodes and edges keep their layout", async () => {
  const contentRoot = path.join(isolatedRoot, "additive-content");
  const slug = "additive-fixture";
  const gardenDir = path.join(contentRoot, slug);
  fs.mkdirSync(path.join(gardenDir, "notes"), { recursive: true });
  fs.writeFileSync(path.join(gardenDir, "notes", "alpha.md"), markdown("Alpha", "Electric flux through a closed surface.", ["beta"]));
  fs.writeFileSync(path.join(gardenDir, "notes", "beta.md"), markdown("Beta", "The divergence theorem relates volume and surface flux."));
  const database = databaseFixture(slug);
  const embedded = [];
  const dependencies = {
    embed: async (texts) => {
      embedded.push(...texts);
      return { model: "local/bge-small-en-v1.5", dimension: 3, vectors: texts.map(fakeVector) };
    },
    generator: async (messages) => {
      const user = messages.find((message) => message.role === "user")?.content ?? "";
      return user.includes("sourceTitle")
        ? JSON.stringify({ explanation: "These pages share one field-law mechanism.", relationType: "related", direction: "undirected" })
        : JSON.stringify({ summary: "A grounded topology summary." });
    },
  };
  await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1, userId: 7, gardenId: slug, revision: 1, contentRoot, database, dependencies,
  });
  const before = readThoughtTopology(gardenDir);
  const positions = new Map(before.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  const oldEdges = before.edges.map((edge) => structuredClone(edge));

  embedded.length = 0;
  fs.writeFileSync(path.join(gardenDir, "notes", "gamma.md"), markdown("Gamma", "A new current-and-flux note joins the existing map.", ["alpha"]));
  database.prepare("UPDATE clusters SET thought_topology_revision = 2").run();
  await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1, userId: 7, gardenId: slug, revision: 2, contentRoot, database, dependencies,
  });
  const after = readThoughtTopology(gardenDir);
  assert.equal(embedded.length, 1, "only the added page is embedded");
  for (const [id, position] of positions) {
    const node = after.nodes.find((candidate) => candidate.id === id);
    assert.deepEqual({ x: node.x, y: node.y }, position, `${id} keeps its durable position`);
  }
  for (const oldEdge of oldEdges) {
    assert.deepEqual(after.edges.find((edge) => edge.id === oldEdge.id), oldEdge, `${oldEdge.id} is preserved`);
  }
  const added = after.nodes.find((node) => node.id === "page:gamma");
  assert.ok(Number.isFinite(added.x) && Number.isFinite(added.y));
  assert.ok(after.edges.some((edge) => edge.source === added.id || edge.target === added.id));
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
          fs.appendFileSync(
            path.join(gardenDir, "note.md"),
            "\nA later edit adds a sufficiently detailed paragraph about equipotential surfaces and field lines.\n",
          );
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

test("a revision bump with unchanged content during enrichment still publishes", async () => {
  const contentRoot = path.join(isolatedRoot, "bumped-content");
  const slug = "bumped-fixture";
  const gardenDir = path.join(contentRoot, slug);
  fs.mkdirSync(gardenDir, { recursive: true });
  fs.writeFileSync(
    path.join(gardenDir, "note.md"),
    markdown("Potential", "Electric potential determines an electric field through its gradient."),
  );
  const database = databaseFixture(slug);
  let bumped = false;
  const result = await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 1,
    contentRoot,
    database,
    dependencies: {
      embed: async (texts) => ({ model: "local/bge-small-en-v1.5", dimension: 3, vectors: texts.map(fakeVector) }),
      generator: async () => {
        if (!bumped) {
          bumped = true;
          // A Learn cleanup retry or a delete elsewhere moved the counter, but
          // nothing in the projected content changed.
          database.prepare("UPDATE clusters SET thought_topology_revision = 2").run();
        }
        return JSON.stringify({ summary: "A grounded description of electric potential." });
      },
    },
  });
  assert.equal(result.status, "built");
  assert.equal(readThoughtTopology(gardenDir).nodes.length, 1);
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
      "pdf",
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
  assert.equal(artifact.nodes[0].sourceType, "pdf");
  assert.equal(artifact.nodes[0].folderId, "folder:sources");
  assert.equal(
    artifact.folders.some((folder) => folder.id === "folder:sources"),
    true,
  );
  database.close();
});

test("a long source document is embedded per section and links to pages through the chapter that covers them", async () => {
  const contentRoot = path.join(isolatedRoot, "span-content");
  const slug = "span-fixture";
  const gardenDir = path.join(contentRoot, slug);
  fs.mkdirSync(path.join(gardenDir, "sources"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "learning"), { recursive: true });
  const chapter = (title, keyword) => {
    const sentence = `The ${keyword} of the enclosed region is treated in this part of the book with worked derivations. `;
    return `## ${title}\n\n${Array.from({ length: 40 }, (_, index) => `### ${title} section ${index + 1}\n\n${sentence.repeat(9)}\n`).join("\n")}`;
  };
  fs.writeFileSync(
    path.join(gardenDir, "sources", "textbook.md"),
    sourceMarkdown("Field theory textbook", `${chapter("Chapter 3 Enclosed Flux", "flux")}\n${chapter("Chapter 7 Steady Current", "current")}\n${chapter("Chapter 4 Energy and Potential", "potential")}`, "pdf"),
  );
  fs.writeFileSync(path.join(gardenDir, "learning", "lecture-current.md"), markdown("Lecture on current", "The current through a wire and the magnetic field it makes."));
  fs.writeFileSync(path.join(gardenDir, "learning", "lecture-potential.md"), markdown("Lecture on potential", "The potential difference between two points in a field."));
  const database = databaseFixture(slug);
  const embedded = [];
  const result = await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 1,
    contentRoot,
    database,
    dependencies: {
      generator: null,
      embed: async (texts) => {
        embedded.push(...texts);
        return { model: DEFAULT_TOPOLOGY_CACHE_VERSIONS.embeddingModel, dimension: 3, vectors: texts.map(fakeVector) };
      },
    },
  });
  assert.equal(result.status, "built");
  const cache = readThoughtTopologyCache(gardenDir);
  const book = cache.nodes["page:textbook"];
  assert.ok(book.sections.length >= 3, "the textbook is embedded per section");
  assert.ok(book.sections.every((section) => section.embedding.length === 3));
  assert.ok(embedded.some((text) => text.startsWith("Title: Field theory textbook. Section: Chapter 7 Steady Current")));
  const artifact = readThoughtTopology(gardenDir);
  assert.equal(rendererArtifactContainsVector(artifact), false);
  assert.ok(artifact.nodes.every((node) => !("spans" in node) && !("sections" in node)));
  const edge = (page) => artifact.edges.find((candidate) => new Set([candidate.source, candidate.target]).has("page:textbook") && new Set([candidate.source, candidate.target]).has(page));
  const currentEdge = edge("page:lecture-current");
  assert.ok(currentEdge, "the current lecture links to the textbook");
  assert.ok(currentEdge.evidence.some((item) => item.kind === "heading" && /Chapter 7 Steady Current/.test(item.label) && item.sourceNodeId === "page:textbook"));
  const potentialEdge = edge("page:lecture-potential");
  assert.ok(potentialEdge, "the potential lecture links to the textbook");
  assert.ok(potentialEdge.evidence.some((item) => item.kind === "heading" && /Chapter 4 Energy and Potential/.test(item.label)));

  // A rebuild with unchanged content embeds nothing again: section vectors are cached by hash.
  embedded.length = 0;
  database.prepare("UPDATE clusters SET thought_topology_revision = 2").run();
  const again = await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 2,
    contentRoot,
    database,
    dependencies: {
      generator: null,
      embed: async (texts) => {
        embedded.push(...texts);
        return { model: DEFAULT_TOPOLOGY_CACHE_VERSIONS.embeddingModel, dimension: 3, vectors: texts.map(fakeVector) };
      },
    },
  });
  assert.equal(again.status, "built");
  assert.deepEqual(embedded, []);
  database.close();
});

test("the projection mirrors what Quartz publishes: hidden pages stay out, empty published folders stay in", async () => {
  const contentRoot = path.join(isolatedRoot, "publish-content");
  const slug = "publish-fixture";
  const gardenDir = path.join(contentRoot, slug);
  for (const folder of ["notes", "empty", "Internal", "generated", "sources", "ingest"]) {
    fs.mkdirSync(path.join(gardenDir, folder), { recursive: true });
  }
  fs.writeFileSync(path.join(gardenDir, "notes", "gauss.md"), markdown("Gauss law", "Electric flux through a closed surface."));
  fs.writeFileSync(path.join(gardenDir, "empty", "_index.md"), '---\ntitle: "Empty"\n---\n');
  fs.writeFileSync(path.join(gardenDir, "Internal", "concept.md"), markdown("Hidden concept", "Internal scaffolding."));
  fs.writeFileSync(path.join(gardenDir, "generated", "topic.md"), markdown("Legacy topic", "Legacy generated subtopic."));
  fs.writeFileSync(path.join(gardenDir, "sources", "paper.md"), sourceMarkdown("Paper", "Raw source text."));
  fs.writeFileSync(
    path.join(gardenDir, "ingest", "_index.md"),
    '---\ntitle: "1. Ingest section"\nknowledge_type: "learning-section"\ninternal: "true"\n---\n',
  );
  fs.writeFileSync(
    path.join(gardenDir, "ingest", "lesson.md"),
    '---\ntitle: "1.1 Lesson"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ninternal: "true"\n---\n\n# Lesson\n\nIngest scaffolding.\n',
  );
  // Document ingestion publishes its source-derived concepts under Concepts/
  // with an explicit ownership stamp; the same lesson type elsewhere, or
  // without the stamp, stays hidden.
  const conceptSection = path.join(gardenDir, "Concepts", "1. gauss-section");
  fs.mkdirSync(conceptSection, { recursive: true });
  fs.writeFileSync(
    path.join(conceptSection, "_index.md"),
    '---\ntitle: "1. Gauss section"\nknowledge_type: "concept-section"\nbreadboardType: "concept_section"\ngenerated_by: "document_ingestion"\ncollection: "Concepts"\n---\n\n# 1. Gauss section\n',
  );
  fs.writeFileSync(
    path.join(conceptSection, "flux-through-a-surface.md"),
    '---\ntitle: "1.1 Flux through a surface"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "document_ingestion"\ncollection: "Concepts"\n---\n\n# 1.1 Flux through a surface\n\nSource: [[paper|Paper]]\n\nThe flux of the field through a closed surface counts the enclosed charge.\n\n## Page-Grounded Details\n\n#### Transcript\n\nGood afternoon everyone, welcome to the session.\n',
  );
  fs.writeFileSync(
    path.join(conceptSection, "unstamped.md"),
    '---\ntitle: "1.2 Unstamped"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\n---\n\n# 1.2 Unstamped\n\nIngest-era scaffolding without an owner.\n',
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
  assert.deepEqual(
    artifact.folders.map((folder) => folder.path).sort(),
    ["", "Concepts", "Concepts/1. gauss-section", "empty", "notes", "sources"],
  );
  assert.deepEqual(
    artifact.nodes.map((node) => node.relPath).sort(),
    ["Concepts/1. gauss-section/flux-through-a-surface.md", "notes/gauss.md", "sources/paper.md"],
  );
  assert.equal(typeof artifact.build.contentFingerprint, "string");
  database.close();
});

function fluxGarden(contentRoot, slug) {
  const gardenDir = path.join(contentRoot, slug);
  fs.mkdirSync(gardenDir, { recursive: true });
  fs.writeFileSync(
    path.join(gardenDir, "gauss.md"),
    markdown(
      "Gauss law",
      "Electric flux through a closed surface relates to enclosed charge.",
    ),
  );
  fs.writeFileSync(
    path.join(gardenDir, "flux.md"),
    markdown(
      "Electric flux",
      "Electric flux counts field lines crossing a surface.",
    ),
  );
  return gardenDir;
}

// Each prompt has its own exact JSON contract, so answer the one being asked.
const readyGenerator = async (messages) =>
  messages.some((message) => message.content.includes('"explanation"'))
    ? JSON.stringify({
        explanation: "Both pages reason about electric flux through a surface.",
        relationType: "related",
        direction: "undirected",
      })
    : JSON.stringify({
        summary: "A grounded summary generated from the deterministic projection.",
      });

test("a healthy semantic map is kept when the embedding service is unavailable", async () => {
  const contentRoot = path.join(isolatedRoot, "downgrade-content");
  const slug = "downgrade-fixture";
  const gardenDir = fluxGarden(contentRoot, slug);
  const database = databaseFixture(slug);
  const batches = [];
  const workingEmbed = async (texts) => {
    batches.push([...texts]);
    return { model: "local/bge-small-en-v1.5", dimension: 3, vectors: texts.map(fakeVector) };
  };

  const first = await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 1,
    contentRoot,
    database,
    dependencies: { generator: readyGenerator, embed: workingEmbed },
  });
  assert.equal(first.mode, "semantic-vector");
  assert.ok(first.edges >= 1, "the fixture pages are close enough to connect");
  const healthy = readThoughtTopology(gardenDir);

  fs.appendFileSync(
    path.join(gardenDir, "gauss.md"),
    "\nA changed flux passage now adds a sufficiently detailed explanation of enclosed charge and closed surfaces.\n",
  );
  database.prepare("UPDATE clusters SET thought_topology_revision = 2").run();
  await assert.rejects(
    buildThoughtTopologyInRuntimeWorker({
      clusterId: 1,
      userId: 7,
      gardenId: slug,
      revision: 2,
      contentRoot,
      database,
      dependencies: {
        generator: readyGenerator,
        embed: async () => {
          throw new Error("embedding service down");
        },
      },
    }),
    /Embedding service unavailable/,
  );
  const kept = readThoughtTopology(gardenDir);
  assert.equal(kept.sourceRevision, healthy.sourceRevision, "the connected map is still served");
  assert.equal(kept.edges.length, healthy.edges.length);
  assert.equal(kept.build.retrievalMode, "semantic-vector");
  assert.equal(readThoughtTopologyCache(gardenDir).nodes["page:flux"].embedding.length, 3);

  database.prepare("UPDATE clusters SET thought_topology_revision = 3").run();
  const recovered = await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 3,
    contentRoot,
    database,
    dependencies: { generator: readyGenerator, embed: workingEmbed },
  });
  assert.equal(recovered.mode, "semantic-vector");
  assert.deepEqual(
    batches.at(-1).length,
    1,
    "once embeddings return only the edited page is embedded",
  );
  assert.notEqual(readThoughtTopology(gardenDir).sourceRevision, healthy.sourceRevision);
  database.close();
});

test("degraded summaries and explanations are retried on the next build", async () => {
  const contentRoot = path.join(isolatedRoot, "retry-content");
  const slug = "retry-fixture";
  const gardenDir = fluxGarden(contentRoot, slug);
  const database = databaseFixture(slug);
  const embed = async (texts) => ({
    model: "local/bge-small-en-v1.5",
    dimension: 3,
    vectors: texts.map(fakeVector),
  });

  await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 1,
    contentRoot,
    database,
    dependencies: { generator: async () => "model offline", embed },
  });
  const degraded = readThoughtTopology(gardenDir);
  assert.equal(degraded.build.state, "degraded");
  // Pages that state their own summary never depend on the model: the map
  // shows the document's lead paragraph even while the model is offline.
  assert.ok(degraded.nodes.every((node) => node.summary.state === "ready"));
  assert.ok(degraded.nodes.every((node) => node.summary.promptVersion === "document-summary-v1"));
  assert.equal(
    degraded.nodes.find((node) => node.id === "page:flux").summary.text,
    "Electric flux counts field lines crossing a surface.",
  );
  assert.equal(degraded.garden.summary.state, "degraded");
  assert.ok(degraded.edges.length >= 1);
  assert.ok(degraded.edges.every((edge) => edge.explanation.state === "degraded"));

  database.prepare("UPDATE clusters SET thought_topology_revision = 2").run();
  await buildThoughtTopologyInRuntimeWorker({
    clusterId: 1,
    userId: 7,
    gardenId: slug,
    revision: 2,
    contentRoot,
    database,
    dependencies: { generator: readyGenerator, embed },
  });
  const healed = readThoughtTopology(gardenDir);
  assert.equal(healed.build.state, "ready");
  assert.ok(healed.nodes.every((node) => node.summary.state === "ready"));
  assert.ok(healed.edges.every((edge) => edge.explanation.state === "ready"));
  assert.equal(healed.garden.summary.state, "ready");
  database.close();
});

test("a build explains every selected connection before publishing one complete snapshot", async () => {
  const contentRoot = path.join(isolatedRoot, "budget-content");
  const slug = "budget-fixture";
  const gardenDir = path.join(contentRoot, slug);
  fs.mkdirSync(gardenDir, { recursive: true });
  fs.writeFileSync(path.join(gardenDir, "_index.md"), "---\ntitle: Budget Garden\n---\n");
  fs.writeFileSync(path.join(gardenDir, "a.md"), markdown("Alpha", "Flux through a surface.", ["b", "c", "d"]));
  fs.writeFileSync(path.join(gardenDir, "b.md"), markdown("Beta", "Current density.", ["c"]));
  fs.writeFileSync(path.join(gardenDir, "c.md"), markdown("Gamma", "Electric potential.", []));
  fs.writeFileSync(path.join(gardenDir, "d.md"), markdown("Delta", "Potential energy.", []));
  let explanationCalls = 0;
  const dependencies = {
    embed: async () => {
      throw new Error("offline fixture");
    },
    generator: async (messages) => {
      const user = messages.find((message) => message.role === "user")?.content ?? "";
      if (user.includes("sourceTitle")) {
        explanationCalls += 1;
        return JSON.stringify({ explanation: "Both pages describe one mechanism.", relationType: "related", direction: "undirected" });
      }
      return JSON.stringify({ summary: "A grounded summary." });
    },
  };
  const build = (revision) =>
    buildThoughtTopologyInRuntimeWorker({
      clusterId: 1,
      userId: 7,
      gardenId: slug,
      revision,
      contentRoot,
      database: databaseFixture(slug, revision),
      dependencies,
    });
  const first = await build(1);
  assert.equal(first.status, "built");
  let artifact = readThoughtTopology(gardenDir);
  const authored = artifact.edges.filter((edge) => edge.origin !== "inferred");
  assert.ok(authored.length >= 3, `authored edges present (${authored.length})`);
  assert.equal(explanationCalls, artifact.edges.length, "every selected edge is explained in the build");
  assert.ok(artifact.edges.every((edge) => edge.explanation.state === "ready"));
  assert.equal(thoughtTopologyHasCompleteConnections(artifact), true);

  const incomplete = structuredClone(artifact);
  incomplete.edges[0].explanation = { state: "pending", text: "Waiting." };
  assert.throws(
    () => commitThoughtTopology(gardenDir, readThoughtTopologyCache(gardenDir), incomplete),
    /before every connection explanation is generated/,
  );
  assert.equal(readThoughtTopology(gardenDir).sourceRevision, artifact.sourceRevision);

  const beforeSecond = structuredClone(artifact);
  const second = await build(2);
  assert.equal(second.status, "built");
  artifact = readThoughtTopology(gardenDir);
  assert.equal(explanationCalls, beforeSecond.edges.length, "unchanged Markdown never schedules another enrichment pass");
  assert.deepEqual(artifact, beforeSecond, "the existing graph is not reconstructed");

  // Simulate the historical budgeted format on disk. Even with unchanged
  // Markdown, the worker must bypass its no-op path and finish that edge.
  const legacyArtifact = structuredClone(artifact);
  const legacyCache = readThoughtTopologyCache(gardenDir);
  const legacyEdge = legacyArtifact.edges[0];
  legacyEdge.explanation = { state: "pending", text: "Waiting." };
  legacyCache.edges[legacyEdge.pairHash].explanation = legacyEdge.explanation;
  fs.writeFileSync(path.join(gardenDir, ".breadboard", "thought-topology.json"), JSON.stringify(legacyArtifact));
  fs.writeFileSync(path.join(gardenDir, ".breadboard", "thought-topology-cache.json"), JSON.stringify(legacyCache));
  const callsBeforeRepair = explanationCalls;
  const repaired = await build(3);
  assert.equal(repaired.status, "built");
  artifact = readThoughtTopology(gardenDir);
  assert.equal(explanationCalls, callsBeforeRepair + 1, "the one historical pending edge is regenerated");
  assert.equal(thoughtTopologyHasCompleteConnections(artifact), true);
  assert.ok(artifact.edges.every((edge) => edge.explanation.state !== "pending"));
});
