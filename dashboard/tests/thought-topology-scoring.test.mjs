import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

await import("../scripts/learn-worker-import-hook.mjs");
const scoring = await import("../src/lib/thought-topology/scoring.ts");

test("cosine, concept IDF Jaccard, TF-IDF, and v1 weights are deterministic", () => {
  assert.equal(scoring.cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(scoring.cosineSimilarity([1, 0], [1, 0]), 1);
  const documents = [
    {
      id: "a",
      folderId: "x",
      primaryConcepts: ["rare"],
      supportingConcepts: ["common"],
      lexicalText: "alpha beta",
      embedding: [1, 0],
    },
    {
      id: "b",
      folderId: "y",
      primaryConcepts: ["rare"],
      supportingConcepts: ["other"],
      lexicalText: "alpha gamma",
      embedding: [0.8, 0.2],
    },
    {
      id: "c",
      folderId: "y",
      primaryConcepts: [],
      supportingConcepts: ["common"],
      lexicalText: "delta epsilon",
      embedding: [0, 1],
    },
  ];
  const idf = scoring.buildConceptIdf(documents);
  const concept = scoring.idfWeightedConceptJaccard(
    documents[0],
    documents[1],
    idf,
  );
  assert.ok(concept > 0 && concept < 1);
  const tfidf = scoring.buildTfidfVectors(documents);
  const lexical = scoring.sparseCosine(tfidf.get("a"), tfidf.get("b"));
  assert.ok(lexical > 0 && lexical < 1);
  const components = { embedding: 0.8, concept: 0.5, lexical: 0.25 };
  assert.equal(
    scoring.combinedAffinity(components, true),
    0.7 * 0.8 + 0.2 * 0.5 + 0.1 * 0.25,
  );
});

test("median/MAD threshold uses fallback and both clamps", () => {
  assert.equal(scoring.adaptiveThreshold([0.1, 0.2]), 0.68);
  assert.equal(scoring.adaptiveThreshold(new Array(9).fill(0.05)), 0.62);
  assert.equal(
    scoring.adaptiveThreshold([
      0.1, 0.2, 0.3, 0.9, 0.91, 0.92, 0.93, 0.94, 0.95,
    ]),
    0.82,
  );
});

test("mutual neighborhoods stay sparse and enforce the inferred degree cap", () => {
  const candidates = [];
  for (let left = 0; left < 10; left += 1) {
    for (let right = left + 1; right < 10; right += 1) {
      candidates.push({
        source: `n${left}`,
        target: `n${right}`,
        sourceFolderId: left % 2 ? "a" : "b",
        targetFolderId: right % 2 ? "a" : "b",
        score: 1 - (right - left) / 100,
        components: { embedding: 1, concept: 1, lexical: 1 },
      });
    }
  }
  const selected = scoring.selectSparseInferredEdges(candidates, 0.62);
  const degrees = new Map();
  for (const edge of selected) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  assert.ok([...degrees.values()].every((degree) => degree <= 6));
  assert.ok(selected.length < candidates.length);
});

test("authored pairs survive thresholds and merge duplicate unordered pairs", () => {
  const scored = [
    {
      source: "a",
      target: "b",
      sourceFolderId: "x",
      targetFolderId: "y",
      score: 0.1,
      components: { embedding: 0.1, concept: 0, lexical: 0 },
    },
  ];
  const merged = scoring.mergeAuthoredPairs(
    [],
    [
      { source: "a", target: "b", origin: "authored", relationType: "extends" },
      { source: "b", target: "a", origin: "authored", relationType: "related" },
    ],
    scored,
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].origin, "authored");
});

test("semantic line width is monotonic", () => {
  const widths = [0.63, 0.7, 0.8, 0.95].map(
    (score) => scoring.edgeVisualStyle(score, 0.62, "inferred").width,
  );
  assert.deepEqual(
    widths,
    [...widths].sort((a, b) => a - b),
  );
  assert.ok(
    widths.at(-1) - widths[0] > 5,
    "affinity weights should be visibly distinct",
  );
});

test("electromagnetics fixture prefers justified pairs over broad field vocabulary", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      new URL(
        "./fixtures/thought-topology/electromagnetism.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const pairs = scoring.scoreAffinityPairs(fixture.documents, true);
  const score = (left, right) =>
    pairs.find(
      (pair) =>
        new Set([pair.source, pair.target]).has(left) &&
        new Set([pair.source, pair.target]).has(right),
    )?.score ?? 0;
  for (const [left, right] of [
    ["gauss-law", "divergence-theorem"],
    ["ampere-maxwell", "displacement-current"],
    ["electric-potential", "electric-field"],
  ]) {
    assert.ok(
      score(left, right) > score(left, "magnetic-materials"),
      `${left} should prefer ${right}`,
    );
    assert.ok(score(left, right) > 0.75);
  }
});
