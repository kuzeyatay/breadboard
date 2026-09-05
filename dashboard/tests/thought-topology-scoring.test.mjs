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

test("median/MAD threshold uses fallback and both clamps on each score scale", () => {
  // Raw cosine scale (a Garden too small to centre).
  assert.equal(scoring.adaptiveThreshold([0.1, 0.2], 0), 0.68);
  assert.equal(scoring.adaptiveThreshold(new Array(9).fill(0.05), 0), 0.62);
  assert.equal(
    scoring.adaptiveThreshold([0.1, 0.2, 0.3, 0.9, 0.91, 0.92, 0.93, 0.94, 0.95], 0),
    0.82,
  );
  // Centred scale (the default): a corpus-typical pair scores near 0.
  assert.equal(scoring.adaptiveThreshold([0.1, 0.2]), 0.3);
  assert.equal(scoring.adaptiveThreshold(new Array(9).fill(0.0)), 0.18);
  assert.equal(
    scoring.adaptiveThreshold([0.1, 0.2, 0.3, 0.9, 0.91, 0.92, 0.93, 0.94, 0.95]),
    0.45,
  );
  // Between the two the bounds blend.
  const half = scoring.thresholdScale(0.5);
  assert.ok(Math.abs(half.minimum - 0.4) < 1e-12);
  assert.ok(Math.abs(half.anchorMargin - 0.06) < 1e-12);
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

test("a homogeneous garden keeps each page's best pair above the floor instead of ending unconnected", () => {
  // Every pair scores between the centred floor (0.18) and a
  // distribution-driven threshold at the 0.45 clamp, so the
  // mutual-neighborhood pass selects nothing.
  const candidates = [];
  for (let left = 0; left < 6; left += 1) {
    for (let right = left + 1; right < 6; right += 1) {
      candidates.push({
        source: `n${left}`,
        target: `n${right}`,
        sourceFolderId: "a",
        targetFolderId: "a",
        score: 0.22 + ((left * 7 + right * 3) % 10) / 50,
        components: { embedding: 1, concept: 0, lexical: 0 },
      });
    }
  }
  const selected = scoring.selectSparseInferredEdges(candidates, 0.45);
  const connected = new Set(selected.flatMap((edge) => [edge.source, edge.target]));
  assert.equal(connected.size, 6, "every page keeps at least one connection");
  assert.ok(selected.length <= 12, "at most two anchors per page");
  for (const edge of selected) assert.ok(edge.score >= 0.18);
  // Only pairs within the margin of a page's best pair qualify as its anchors.
  for (const node of ["n0", "n1", "n2", "n3", "n4", "n5"]) {
    const own = candidates.filter((pair) => pair.source === node || pair.target === node);
    const best = Math.max(...own.map((pair) => pair.score));
    for (const edge of selected.filter((pair) => pair.source === node || pair.target === node)) {
      const other = edge.source === node ? edge.target : edge.source;
      const otherBest = Math.max(...candidates.filter((pair) => pair.source === other || pair.target === other).map((pair) => pair.score));
      assert.ok(edge.score >= best - 0.08 - 1e-9 || edge.score >= otherBest - 0.08 - 1e-9);
    }
  }
  // Pairs below the absolute floor never qualify as anchors.
  const weak = candidates.map((candidate) => ({ ...candidate, score: 0.1 }));
  assert.deepEqual(scoring.selectSparseInferredEdges(weak, 0.45), []);
  // On the raw scale the old floor still applies.
  const rawWeak = candidates.map((candidate) => ({ ...candidate, score: 0.5 }));
  assert.deepEqual(scoring.selectSparseInferredEdges(rawWeak, 0.8, new Map(), 0), []);
});

test("a pair without concept annotations renormalises its weights instead of scoring the gap as zero", () => {
  const components = { embedding: 0.8, concept: 0, lexical: 0.16 };
  assert.equal(scoring.combinedAffinity(components, true, true), 0.7 * 0.8 + 0.1 * 0.16);
  assert.ok(Math.abs(scoring.combinedAffinity(components, true, false) - (0.7 * 0.8 + 0.1 * 0.16) / 0.8) < 1e-12);
  const unit = (values) => {
    const norm = Math.hypot(...values);
    return values.map((value) => value / norm);
  };
  const pairs = scoring.scoreAffinityPairs(
    [
      { id: "book", folderId: "sources", primaryConcepts: [], supportingConcepts: [], lexicalText: "gauss flux divergence", embedding: unit([1, 1, 0]) },
      { id: "lecture", folderId: "sources", primaryConcepts: [], supportingConcepts: [], lexicalText: "gauss flux surface", embedding: unit([1, 1, 0.2]) },
      { id: "note", folderId: "learning", primaryConcepts: ["gauss"], supportingConcepts: [], lexicalText: "gauss law", embedding: unit([1, 1, 0.2]) },
    ],
    true,
  );
  const pair = (left, right) => pairs.find((candidate) => new Set([candidate.source, candidate.target]).has(left) && new Set([candidate.source, candidate.target]).has(right));
  // Two source documents: the concept term is absent, not zero.
  assert.ok(pair("book", "lecture").score > 0.62);
  // A source and an annotated note: still no shared concept evidence, same rule.
  assert.ok(Math.abs(pair("book", "note").score - pair("book", "lecture").score) < 0.05);
});

test("a long document relates through its closest section, names it, and anchors every section", () => {
  const unit = (values) => {
    const norm = Math.hypot(...values);
    return values.map((value) => value / norm);
  };
  const book = {
    id: "book",
    folderId: "sources",
    primaryConcepts: [],
    supportingConcepts: [],
    lexicalText: "electrostatics magnetostatics waves",
    embedding: unit([1, 1, 1]),
    sections: [
      { label: "Chapter 3 Gauss's Law", embedding: unit([1, 0, 0]) },
      { label: "Chapter 7 The Steady Magnetic Field", embedding: unit([0, 1, 0]) },
      { label: "Chapter 11 The Uniform Plane Wave", embedding: unit([0, 0, 1]) },
    ],
  };
  const lecture = (id, values, lexicalText) => ({ id, folderId: "sources", primaryConcepts: [], supportingConcepts: [], lexicalText, embedding: unit(values) });
  const documents = [
    book,
    lecture("gauss", [1, 0.05, 0], "gauss flux"),
    lecture("biot-savart", [0.05, 1, 0], "magnetic field current"),
    lecture("plane-wave", [0, 0.05, 1], "wave propagation"),
    lecture("other-gauss", [1, 0.1, 0.05], "gauss charge"),
  ];
  const affinity = scoring.sectionAwareEmbeddingAffinity(book, documents[1]);
  assert.ok(affinity.value > 0.99, "the section match replaces the blurred whole-book cosine");
  assert.deepEqual(affinity.sections, { source: "Chapter 3 Gauss's Law" });
  assert.equal(scoring.sectionAwareEmbeddingAffinity(documents[1], book).sections.target, "Chapter 3 Gauss's Law");
  assert.deepEqual([...scoring.documentCapacities(documents)], [["book", 3]]);

  const pairs = scoring.scoreAffinityPairs(documents, true);
  const bookPairs = pairs.filter((pair) => pair.source === "book");
  assert.equal(bookPairs.find((pair) => pair.target === "biot-savart").sections.source, "Chapter 7 The Steady Magnetic Field");
  // Lecture-to-lecture pairs never match through the book's sections.
  assert.ok(pairs.filter((pair) => pair.source !== "book" && pair.target !== "book").every((pair) => !pair.sections));
  // With a threshold no pair clears, every chapter still keeps its nearest lecture.
  const selected = scoring.selectSparseInferredEdges(pairs, 0.99, scoring.documentCapacities(documents));
  const bookEdges = selected.filter((pair) => pair.source === "book" || pair.target === "book");
  const partners = new Set(bookEdges.map((pair) => (pair.source === "book" ? pair.target : pair.source)));
  for (const expected of ["gauss", "biot-savart", "plane-wave"]) assert.ok(partners.has(expected), `${expected} links to its chapter`);
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

test("corpus centring removes the shared component and ramps with Garden size", () => {
  const unit = (values) => {
    const norm = Math.hypot(...values);
    return values.map((value) => value / norm);
  };
  // Every page shares a large "course" component along the first axis; the
  // pairs differ only in the small remaining directions.
  const documents = [];
  for (let index = 0; index < 10; index += 1) {
    const topic = index % 2 === 0 ? [0, 1, 0] : [0, 0, 1];
    documents.push({
      id: `p${index}`,
      folderId: "a",
      primaryConcepts: [],
      supportingConcepts: [],
      lexicalText: `page ${index}`,
      embedding: unit([10, topic[1] * (1 + index / 20), topic[2] * (1 + index / 20)]),
    });
  }
  assert.equal(scoring.centeringStrength(2), 0);
  assert.equal(scoring.centeringStrength(8), 1);
  assert.ok(scoring.centeringStrength(5) > 0 && scoring.centeringStrength(5) < 1);
  const centering = scoring.embeddingCentering(documents);
  assert.equal(centering.strength, 1);
  // Raw cosine cannot tell the two topics apart; the centred cosine can.
  const rawSame = scoring.cosineSimilarity(documents[0].embedding, documents[2].embedding);
  const rawOther = scoring.cosineSimilarity(documents[0].embedding, documents[1].embedding);
  assert.ok(rawSame > 0.98 && rawOther > 0.98);
  const same = scoring.centeredCosine(documents[0].embedding, documents[2].embedding, centering);
  const other = scoring.centeredCosine(documents[0].embedding, documents[1].embedding, centering);
  assert.ok(same > 0.9, `same topic stays close (${same})`);
  assert.ok(other < 0, `the other topic sits across the corpus mean (${other})`);
  const pairs = scoring.scoreAffinityPairs(documents, true);
  const pair = (left, right) => pairs.find((candidate) => new Set([candidate.source, candidate.target]).has(left) && new Set([candidate.source, candidate.target]).has(right));
  assert.ok(pair("p0", "p2").components.embedding > pair("p0", "p1").components.embedding + 0.5);
  // Section vectors are centred with the same mean.
  const book = { ...documents[0], id: "book", sections: [{ label: "Chapter 2", embedding: documents[1].embedding }] };
  assert.equal(scoring.sectionAwareEmbeddingAffinity(book, documents[3], centering).sections?.source, "Chapter 2");
  // Too few documents: nothing is centred and raw cosine is kept.
  const tiny = scoring.embeddingCentering(documents.slice(0, 2));
  assert.equal(tiny.strength, 0);
  assert.deepEqual(scoring.centeredVector([1, 2, 3], tiny), [1, 2, 3]);
});

test("lexical overlap ignores bare numbers and uses sublinear term frequency", () => {
  assert.deepEqual(scoring.lexicalTokens("Lecture 2024-10-23 at 13:30 on page 12: Gauss flux"), [
    "lecture",
    "page",
    "gauss",
    "flux",
  ]);
  const vectors = scoring.buildTfidfVectors([
    { id: "a", folderId: "x", primaryConcepts: [], supportingConcepts: [], lexicalText: "flux flux flux flux gauss" },
    { id: "b", folderId: "x", primaryConcepts: [], supportingConcepts: [], lexicalText: "flux gauss" },
  ]);
  const a = vectors.get("a");
  assert.ok(a.get("flux") > a.get("gauss"));
  assert.ok(a.get("flux") < 4 * a.get("gauss"), "the fourth repetition counts less than the first");
});

test("scoring version stamps order numerically so a newer map is never rebuilt by an older bundle", () => {
  assert.equal(scoring.scoringVersionOrdinal("thought-topology-affinity-v2"), 2);
  assert.equal(scoring.scoringVersionOrdinal("thought-topology-affinity-v10"), 10);
  assert.equal(scoring.scoringVersionOrdinal("legacy"), -1);
  assert.equal(scoring.scoringVersionOrdinal(undefined), -1);
  assert.ok(scoring.scoringVersionOrdinal("thought-topology-affinity-v9") > scoring.scoringVersionOrdinal(scoring.THOUGHT_TOPOLOGY_SCORING.version));
});
