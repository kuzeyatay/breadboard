import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import db from "../src/lib/db.ts";
import { issueCapabilityToken } from "../src/lib/hermes/capability-token.ts";
import { executeGardenTool } from "../src/lib/hermes/garden-tools.ts";
import {
  compactThoughtTopologyGraph,
  HERMES_TOPOLOGY_GRAPH_FORMAT,
  queryThoughtTopologyGraph,
} from "../src/lib/hermes/thought-topology-graph.ts";
import { GARDEN_TOOLS } from "../src/lib/hermes/tool-scopes.ts";

function enrichment(text) {
  return { state: "ready", text };
}

function fixture(slug = "physics") {
  return {
    schemaVersion: 1,
    scoringVersion: "thought-topology-affinity-v1",
    sourceRevision: "revision-physics-1",
    garden: {
      id: 7,
      slug,
      title: "Physics for EE",
      summary: enrichment("Physics garden"),
    },
    folders: [
      {
        id: "folder:$root",
        path: "",
        parentId: null,
        title: "Garden root",
        depth: 0,
        nodeCount: 0,
        summary: enrichment("Root"),
      },
      {
        id: "folder:waves",
        path: "waves",
        parentId: "folder:$root",
        title: "Waves",
        depth: 1,
        nodeCount: 3,
        summary: enrichment("Wave lessons"),
      },
    ],
    nodes: [
      {
        id: "page:oscillation",
        slug: `${slug}/waves/oscillation`,
        relPath: "waves/oscillation.md",
        folderId: "folder:waves",
        title: "Oscillation",
        kind: "markdown",
        knowledgeType: "textbook-page",
        contentHash: "a",
        summary: enrichment("Periodic motion"),
        primaryConcepts: ["oscillation"],
        supportingConcepts: ["period"],
        claimIds: [],
        wordCount: 100,
      },
      {
        id: "page:resonance",
        slug: `${slug}/waves/resonance`,
        relPath: "waves/resonance.md",
        folderId: "folder:waves",
        title: "Resonance",
        kind: "markdown",
        knowledgeType: "textbook-page",
        contentHash: "b",
        summary: enrichment("Driven response"),
        primaryConcepts: ["resonance"],
        supportingConcepts: ["oscillation"],
        claimIds: [],
        wordCount: 120,
      },
      {
        id: "page:unrelated",
        slug: `${slug}/waves/unrelated`,
        relPath: "waves/unrelated.md",
        folderId: "folder:waves",
        title: "Weak relation",
        kind: "markdown",
        knowledgeType: "textbook-page",
        contentHash: "c",
        summary: enrichment("Weakly related"),
        primaryConcepts: [],
        supportingConcepts: [],
        claimIds: [],
        wordCount: 80,
      },
    ],
    edges: [
      {
        id: "edge:strong",
        source: "page:oscillation",
        target: "page:resonance",
        origin: "inferred",
        score: 0.91,
        threshold: 0.68,
        components: { embedding: 0.9, concept: 0.8, lexical: 0.7 },
        relationType: "depends-on",
        direction: "target-to-source",
        explanation: enrichment(
          "Resonance depends on the model of oscillation.",
        ),
        evidence: [
          {
            kind: "concept",
            label: "oscillation",
            sourceNodeId: "page:oscillation",
          },
        ],
        pairHash: "strong",
        visual: { width: 4.2, opacity: 0.9, distance: 80, strength: 0.7 },
      },
      {
        id: "edge:weak",
        source: "page:oscillation",
        target: "page:unrelated",
        origin: "inferred",
        score: 0.31,
        threshold: 0.2,
        components: { embedding: 0.3, concept: 0.2, lexical: 0.1 },
        relationType: "related",
        direction: "undirected",
        explanation: enrichment("A weak lexical connection."),
        evidence: [{ kind: "lexical", label: "wave" }],
        pairHash: "weak",
        visual: { width: 1.2, opacity: 0.4, distance: 150, strength: 0.2 },
      },
    ],
    build: {
      state: "ready",
      generatedAt: "2026-08-31T00:00:00.000Z",
      embeddingModel: "local/test",
      embeddingDimension: 3,
      summaryModel: "test",
      nodePromptVersion: "node-v1",
      edgePromptVersion: "edge-v1",
      retrievalMode: "semantic-vector",
      threshold: 0.68,
    },
  };
}

test("Hermes receives Thought Topology as a typed, weighted property graph", () => {
  const graph = queryThoughtTopologyGraph(fixture(), {
    start: "physics/waves/oscillation",
    depth: 1,
    limit: 20,
  });

  assert.equal(graph.format, HERMES_TOPOLOGY_GRAPH_FORMAT);
  assert.equal(graph.startNode.id, "page:oscillation");
  const strong = graph.edges.find((edge) => edge.id === "edge:strong");
  assert.equal(strong.type, "affinity");
  assert.equal(strong.relation, "depends-on");
  assert.equal(strong.direction, "target-to-source");
  assert.equal(strong.weight, 0.91);
  assert.equal(strong.visualWidth, 4.2);
  assert.match(strong.explanation, /depends on/i);
  assert.deepEqual(strong.evidence[0], {
    kind: "concept",
    label: "oscillation",
    sourceNodeId: "page:oscillation",
  });
  assert.equal(strong.provenance.sourceRevision, "revision-physics-1");
});

test("Hermes can traverse Garden-folder-page hierarchy and filter affinities by weight", () => {
  const hierarchy = queryThoughtTopologyGraph(fixture(), {
    start: "physics",
    depth: 2,
    limit: 20,
  });
  assert.ok(
    hierarchy.edges.some(
      (edge) =>
        edge.source === "garden:physics" &&
        edge.target === "folder:waves" &&
        edge.relation === "contains",
    ),
  );
  assert.ok(
    hierarchy.edges.some(
      (edge) =>
        edge.source === "folder:waves" &&
        edge.target === "page:oscillation" &&
        edge.relation === "contains",
    ),
  );

  const filtered = queryThoughtTopologyGraph(fixture(), {
    start: "page:oscillation",
    depth: 1,
    minWeight: 0.8,
    includeHierarchy: false,
  });
  assert.deepEqual(
    filtered.edges.map((edge) => edge.id),
    ["edge:strong"],
  );
  assert.equal(
    filtered.nodes.some((node) => node.id === "page:unrelated"),
    false,
  );
});

test("the every-turn compact packet keeps graph structure without verbose explanations", () => {
  const compact = compactThoughtTopologyGraph(
    queryThoughtTopologyGraph(fixture(), {
      start: "page:oscillation",
      depth: 1,
    }),
  );
  assert.match(JSON.stringify(compact), /edge:strong/);
  assert.doesNotMatch(JSON.stringify(compact), /the model of oscillation/);
  // One short sentence per typed edge, with the direction already applied.
  assert.equal(compact.edges.find((edge) => edge.id === "edge:strong").reads, "Resonance depends on Oscillation.");
  assert.equal(compact.linkQuality.status, "sparse");
});

test("follow walks typed relations the way they read: prerequisites out, dependants in", () => {
  const prerequisites = queryThoughtTopologyGraph(fixture(), {
    start: "page:resonance", follow: "out", relationTypes: ["depends-on"], depth: 3,
  });
  assert.deepEqual(prerequisites.nodes.map((node) => node.id), ["page:resonance", "page:oscillation"]);
  assert.deepEqual(prerequisites.edges.map((edge) => edge.id), ["edge:strong"]);

  // Oscillation needs nothing; walking out from it finds no prerequisite.
  const none = queryThoughtTopologyGraph(fixture(), { start: "page:oscillation", follow: "out", depth: 3 });
  assert.deepEqual(none.nodes.map((node) => node.id), ["page:oscillation"]);

  const dependants = queryThoughtTopologyGraph(fixture(), { start: "page:oscillation", follow: "in", depth: 3 });
  assert.deepEqual(dependants.nodes.map((node) => node.id), ["page:oscillation", "page:resonance"]);
  // An undirected "related" edge is never part of a directed walk.
  assert.equal(dependants.edges.some((edge) => edge.id === "edge:weak"), false);
});

test("target returns the shortest chain of relations as sentences, skipping folder hops", () => {
  const graph = queryThoughtTopologyGraph(fixture(), { start: "page:unrelated", target: "Resonance" });
  assert.equal(graph.path.found, true);
  assert.equal(graph.path.hops, 2);
  assert.deepEqual(graph.path.reads, [
    "Oscillation and Weak relation are related.",
    "Resonance depends on Oscillation.",
  ]);
  assert.equal(graph.edges.some((edge) => edge.type === "contains"), false);

  const directed = queryThoughtTopologyGraph(fixture(), { start: "page:unrelated", target: "page:resonance", follow: "out" });
  assert.equal(directed.path.found, false);

  const missing = queryThoughtTopologyGraph(fixture(), { start: "page:oscillation", target: "reson" });
  assert.equal(missing.path.target, null);
  assert.deepEqual(missing.availableMatches.map((match) => match.id), ["page:resonance"]);
});

test("linkQuality says when an absent link means nothing", () => {
  const lexical = fixture();
  lexical.build.retrievalMode = "concept-lexical";
  lexical.edges = [];
  const quality = queryThoughtTopologyGraph(lexical, { start: "page:oscillation" }).linkQuality;
  assert.equal(quality.status, "structure-only");
  assert.match(quality.note, /embedding service was unavailable/);
  assert.match(quality.note, /says nothing about whether pages are related/);

  const dense = fixture();
  for (let index = 0; index < 4; index += 1) {
    dense.edges.push({ ...dense.edges[1], id: `edge:extra-${index}` });
  }
  const linked = queryThoughtTopologyGraph(dense, { start: "page:resonance" }).linkQuality;
  assert.equal(linked.status, "linked");
  assert.equal(linked.startNodeLinks, 1);
  assert.equal(linked.typedLinks, 1);
});

test("garden_get_graph_neighbors serves the stored Thought Topology to Hermes", async () => {
  const oldRoot = process.env.QUARTZ_CONTENT_PATH;
  const contentRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "hermes-topology-"),
  );
  const slug = `hermes-topology-${crypto.randomUUID()}`;
  const gardenDir = path.join(contentRoot, slug);
  fs.mkdirSync(path.join(gardenDir, ".breadboard"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "waves"), { recursive: true });
  fs.writeFileSync(
    path.join(gardenDir, "waves", "oscillation.md"),
    "---\ntitle: Oscillation\n---\n\nPeriodic motion.",
  );
  fs.writeFileSync(
    path.join(gardenDir, ".breadboard", "thought-topology.json"),
    `${JSON.stringify(fixture(slug))}\n`,
  );
  const inserted = db
    .prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, ?, ?)")
    .run(1, "Hermes Topology", slug);
  process.env.QUARTZ_CONTENT_PATH = contentRoot;
  try {
    const token = issueCapabilityToken({
      userId: 1,
      surface: "garden_chat",
      hermesSessionId: "hermes-topology-test",
      gardenId: slug,
      allowedTools: [...GARDEN_TOOLS],
    });
    const result = await executeGardenTool({
      rawToken: token,
      tool: "garden_get_graph_neighbors",
      args: { slug: `${slug}/waves/oscillation`, depth: 1, minWeight: 0.8 },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.format, HERMES_TOPOLOGY_GRAPH_FORMAT);
    assert.equal(
      result.data.edges.find((edge) => edge.id === "edge:strong").weight,
      0.91,
    );
  } finally {
    db.prepare("DELETE FROM clusters WHERE id = ?").run(
      Number(inserted.lastInsertRowid),
    );
    if (oldRoot === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = oldRoot;
    fs.rmSync(contentRoot, { recursive: true, force: true });
  }
});
