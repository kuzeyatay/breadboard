import test from "node:test";
import assert from "node:assert/strict";

await import("../scripts/learn-worker-import-hook.mjs");
const cache = await import("../src/lib/thought-topology/cache.ts");
const enrichment = await import("../src/lib/thought-topology/enrichment.ts");

test("cache dimensions invalidate independently", () => {
  const base = { ...cache.DEFAULT_TOPOLOGY_CACHE_VERSIONS };
  const first = cache.nodeCacheHashes("body-a", base);
  const edited = cache.nodeCacheHashes("body-b", base);
  assert.notEqual(first.embeddingHash, edited.embeddingHash);
  assert.notEqual(first.summaryHash, edited.summaryHash);

  const moved = cache.nodeCacheHashes("body-a", base);
  assert.deepEqual(first, moved, "folder paths are not cache inputs");

  const promptChanged = cache.nodeCacheHashes("body-a", { ...base, nodePromptVersion: "node-v2" });
  assert.equal(first.embeddingHash, promptChanged.embeddingHash);
  assert.notEqual(first.summaryHash, promptChanged.summaryHash);

  const embeddingChanged = cache.nodeCacheHashes("body-a", { ...base, embeddingModel: "model-v2" });
  assert.notEqual(first.embeddingHash, embeddingChanged.embeddingHash);
  assert.equal(first.summaryHash, embeddingChanged.summaryHash);
  assert.notEqual(cache.topologyPairHash(first.embeddingHash, "other", base), cache.topologyPairHash(embeddingChanged.embeddingHash, "other", base));

  const pair = cache.topologyPairHash(first.embeddingHash, "other", base);
  assert.notEqual(cache.edgeExplanationHash(pair, ["evidence"], base), cache.edgeExplanationHash(pair, ["evidence"], { ...base, edgePromptVersion: "edge-v2" }));
});

test("AI validators reject excess sentences, words, and relation enums", () => {
  assert.equal(enrichment.validateNodeSummary(JSON.stringify({ summary: "One. Two. Three. Four." })), null);
  assert.equal(enrichment.validateNodeSummary(JSON.stringify({ summary: new Array(76).fill("word").join(" ") })), null);
  assert.equal(enrichment.validateEdgeExplanation(JSON.stringify({ explanation: "Grounded.", relationType: "hallucinated", direction: "undirected" })), null);
});

test("invalid JSON receives one correction then deterministic degradation", async () => {
  let calls = 0;
  const result = await enrichment.enrichNodeSummary({
    title: "Gauss law",
    semanticText: "Gauss law relates electric flux through a closed surface to enclosed charge.",
    generator: async () => { calls += 1; return "not-json"; },
  });
  assert.equal(calls, 2);
  assert.equal(result.state, "degraded");
  assert.ok(result.text.length > 0);
});

test("valid corrected JSON is accepted on the one corrective attempt", async () => {
  let calls = 0;
  const result = await enrichment.enrichEdgeExplanation({
    sourceTitle: "Gauss law",
    targetTitle: "Divergence theorem",
    sourceProjection: "electric flux",
    targetProjection: "surface flux and divergence",
    sharedConcepts: ["electric-flux"],
    components: { embedding: 0.9, concept: 0.8, lexical: 0.5 },
    score: 0.84,
    threshold: 0.68,
    generator: async () => ++calls === 1 ? "{}" : JSON.stringify({ explanation: "Both projections connect surface flux to divergence.", relationType: "applies-to", direction: "source-to-target" }),
  });
  assert.equal(calls, 2);
  assert.equal(result.explanation.state, "ready");
  assert.equal(result.relationType, "applies-to");
});
