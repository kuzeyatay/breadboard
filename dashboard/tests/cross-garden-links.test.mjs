import assert from "node:assert/strict";
import test from "node:test";

await import("../scripts/learn-worker-import-hook.mjs");
const { buildCrossGardenEdges } = await import(
  "../src/lib/profile/brain-graph-cross-garden.ts"
);

function unit(values) {
  const length = Math.hypot(...values);
  return values.map((value) => value / length);
}

function gardenDocuments(gardenSlug, gardenAxis, topics) {
  return topics.map(({ id, label, topic, text }) => ({
    id: `${gardenSlug}:${id}`,
    folderId: `${gardenSlug}:learning`,
    gardenSlug,
    gardenTitle: gardenSlug === "em" ? "Electromagnetism" : "Physics for EE",
    label,
    nodeKind: "page",
    primaryConcepts: [],
    supportingConcepts: [],
    lexicalText: text,
    embeddingModel: "test-embedding",
    embedding: unit([...gardenAxis, ...topic]),
    wordCount: 500,
  }));
}

const topics = [
  { id: "polarization", label: "Polarization", topic: [1, 0, 0, 0, 0, 0, 0, 0], text: "polarization polarizer electric field orientation" },
  { id: "waves", label: "Wave propagation", topic: [0, 1, 0, 0, 0, 0, 0, 0], text: "wave propagation phase velocity reflection" },
  { id: "gauss", label: "Gauss law", topic: [0, 0, 1, 0, 0, 0, 0, 0], text: "gauss electric flux closed surface" },
  { id: "resonance", label: "Resonance", topic: [0, 0, 0, 1, 0, 0, 0, 0], text: "resonance frequency oscillation energy" },
  { id: "optics", label: "Refraction", topic: [0, 0, 0, 0, 1, 0, 0, 0], text: "refraction optical medium wavelength" },
  { id: "quantum", label: "Quantum states", topic: [0, 0, 0, 0, 0, 1, 0, 0], text: "quantum states probability amplitude" },
  { id: "circuits", label: "Circuit response", topic: [0, 0, 0, 0, 0, 0, 1, 0], text: "circuit voltage current response" },
  { id: "energy", label: "Field energy", topic: [0, 0, 0, 0, 0, 0, 0, 1], text: "field energy power density" },
];

test("independently-centred semantic pages form sparse cross-Garden links", () => {
  const documents = [
    ...gardenDocuments("em", [10, 0], topics),
    ...gardenDocuments("physics", [0, 10], topics),
  ];
  const edges = buildCrossGardenEdges(documents);
  assert.ok(edges.length > 0);
  assert.ok(
    edges.some(
      (edge) =>
        new Set([edge.source, edge.target]).has("em:polarization") &&
        new Set([edge.source, edge.target]).has("physics:polarization"),
    ),
    "the shared polarization topic crosses the Garden boundary",
  );
  assert.ok(
    edges.every((edge) => edge.source.split(":")[0] !== edge.target.split(":")[0]),
  );
  assert.ok(edges.every((edge) => edge.semanticRelation === "cross-garden-related"));
  assert.ok(edges.every((edge) => edge.threshold > 0 && edge.confidence >= edge.threshold));
  assert.doesNotMatch(JSON.stringify(edges), /embeddingModel|embedding\"/);

  const degrees = new Map();
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  assert.ok([...degrees.values()].every((degree) => degree <= 2));
});

test("cross-Garden links are rebuilt from current content and degrade to lexical evidence", () => {
  const base = [
    {
      id: "garden-a:wave",
      folderId: "garden-a:root",
      gardenSlug: "garden-a",
      gardenTitle: "Garden A",
      label: "Wave equation",
      nodeKind: "page",
      primaryConcepts: [],
      supportingConcepts: [],
      lexicalText: "wave equation propagation medium",
      embedding: null,
      wordCount: 100,
    },
    {
      id: "garden-b:wave",
      folderId: "garden-b:root",
      gardenSlug: "garden-b",
      gardenTitle: "Garden B",
      label: "Traveling waves",
      nodeKind: "page",
      primaryConcepts: [],
      supportingConcepts: [],
      lexicalText: "wave equation propagation medium",
      embedding: null,
      wordCount: 100,
    },
  ];
  const related = buildCrossGardenEdges(base);
  assert.equal(related.length, 1);
  assert.match(related[0].explanation, /recalculated from the latest Thought Topology builds/);
  assert.ok(related[0].evidence.some((item) => item === "Shared term: propagation"));

  const changed = buildCrossGardenEdges([
    base[0],
    { ...base[1], lexicalText: "particle spin fermion exclusion" },
  ]);
  assert.deepEqual(changed, [], "a newer unrelated projection removes the stale link");
});

test("one Garden alone never receives synthetic cross-Garden edges", () => {
  assert.deepEqual(buildCrossGardenEdges(gardenDocuments("em", [10, 0], topics)), []);
});
