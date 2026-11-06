import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeTree } from "../src/lib/knowledge-tree.ts";

test("source trees preserve reading order, both link directions, duplicates and orphans", () => {
  const sources = [{ slug: "a" }, { slug: "b" }, { slug: "empty" }];
  const topics = ["second", "first", "first", "shared", "orphan"].map((slug, order) => ({ slug, order }));
  const edges = [
    { source: "first", target: "a", relation: "source" },
    { source: "a", target: "second", relation: "wikilink" },
    { source: "a", target: "first", relation: "related" },
    { source: "b", target: "second", relation: "related" },
    { source: "a", target: "shared", relation: "shared-topic" },
    { source: "missing", target: "orphan", relation: "source" },
    { source: "first", target: "orphan", relation: "related" },
  ];
  assert.deepEqual(buildKnowledgeTree(sources, topics, edges), {
    tree: [
      { source: sources[0], topics: topics.slice(0, 3) },
      { source: sources[1], topics: [topics[0]] },
      { source: sources[2], topics: [] },
    ],
    orphanTopics: topics.slice(3),
  });
});

test("large gardens inspect each edge once, regardless of source/topic count", () => {
  const sources = Array.from({ length: 500 }, (_, i) => ({ slug: `source-${i}` }));
  const topics = Array.from({ length: 5000 }, (_, i) => ({ slug: `topic-${i}` }));
  let edgeReads = 0;
  const edges = topics.map((topic, i) => ({
    source: topic.slug,
    target: sources[i % sources.length].slug,
    get relation() { edgeReads++; return "source"; },
  }));
  const result = buildKnowledgeTree(sources, topics, edges);
  assert.equal(edgeReads, edges.length, "no repeated full-graph searches");
  assert.equal(result.orphanTopics.length, 0);
  assert.equal(result.tree.length, sources.length);
  assert.ok(result.tree.every(item => item.topics.length === 10));
  assert.deepEqual(result.tree[0].topics, topics.filter((_, i) => i % sources.length === 0));
});

test("empty graphs and sources without topics remain valid", () => {
  assert.deepEqual(buildKnowledgeTree([], [], []), { tree: [], orphanTopics: [] });
  const source = { slug: "empty" };
  assert.deepEqual(buildKnowledgeTree([source], [], []), { tree: [{ source, topics: [] }], orphanTopics: [] });
});
