import assert from "node:assert/strict";
import test from "node:test";

import { detectTopics, leidenCommunities, louvainCommunities } from "../src/lib/quartz-brain-graph/topics.ts";

// Two dense triangles-plus joined by one weak bridge.
const clique = (ids, weight) =>
  ids.flatMap((a, i) => ids.slice(i + 1).map((b) => ({ source: a, target: b, weight })));
const edges = [
  ...clique(["a1", "a2", "a3", "a4"], 0.9),
  ...clique(["b1", "b2", "b3", "b4"], 0.85),
  { source: "a1", target: "b1", weight: 0.1 },
];

test("Leiden keeps a weak bridge between two dense groups and leaves an isolated page separate", () => {
  const ids = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4", "lonely"];
  const groups = leidenCommunities(ids,edges);
  for (const group of [ids.slice(0,4),ids.slice(4,8)]) assert.equal(new Set(group.map(id=>groups.get(id))).size,1);
  assert.equal(new Set([groups.get("a1"),groups.get("b1"),groups.get("lonely")]).size,3);
  assert.deepEqual(leidenCommunities([...ids].reverse(),[...edges].reverse()),groups);
});

test("louvain separates two dense groups joined by a weak bridge", () => {
  const ids = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4", "lonely"];
  const communities = louvainCommunities(ids, edges);
  const a = new Set(["a1", "a2", "a3", "a4"].map((id) => communities.get(id)));
  const b = new Set(["b1", "b2", "b3", "b4"].map((id) => communities.get(id)));
  assert.equal(a.size, 1);
  assert.equal(b.size, 1);
  assert.notEqual([...a][0], [...b][0]);
  assert.ok(![...a, ...b].includes(communities.get("lonely")));
  // Deterministic: same input, same grouping.
  assert.deepEqual(louvainCommunities(ids, edges), communities);
});

test("topics are named from shared concepts and skip tiny groups", () => {
  const node = (id, concepts) => ({ id, title: id.toUpperCase(), concepts });
  const topics = detectTopics(
    [
      node("a1", ["Maxwell", "Fields"]),
      node("a2", ["Maxwell"]),
      node("a3", ["Maxwell", "Fields"]),
      node("a4", []),
      node("b1", []),
      node("b2", []),
      node("b3", []),
      node("b4", []),
      node("lonely", ["Maxwell"]),
    ],
    edges,
  );
  assert.equal(topics.length, 2);
  const labels = topics.map((topic) => topic.label);
  assert.ok(labels.includes("Maxwell and Fields"));
  assert.ok(topics.every((topic) => !topic.memberIds.includes("lonely")));
  assert.deepEqual(topics.map((topic) => topic.index), [0, 1]);
});

test("a topic or path view keeps only its pages, their lines, and the folders above them", async () => {
  const { filterTopologyPayload, shortestTopologyPath } = await import(
    "../src/lib/quartz-brain-graph/topology-adapter.ts"
  );
  const folder = (id, parentId) => ({ id, parentId, path: id, title: id, depth: 0, nodeCount: 0, summary: { state: "ready", text: "" } });
  const page = (id, folderId) => ({ id, slug: id, relPath: id, folderId, title: id, knowledgeType: "page", summary: { state: "ready", text: "" }, primaryConcepts: [], supportingConcepts: [] });
  const line = (source, target) => ({ id: `${source}-${target}`, source, target });
  const payload = {
    garden: { id: 0, slug: "g", title: "g", summary: { state: "ready", text: "" } },
    folders: [folder("root", null), folder("A", "root"), folder("B", "root"), folder("A/x", "A")],
    nodes: [page("p1", "A/x"), page("p2", "A"), page("p3", "B"), page("p4", "B")],
    edges: [line("p1", "p2"), line("p2", "p3"), line("p3", "p4")],
    build: { state: "ready", threshold: 0.68, retrievalMode: "semantic-vector" },
  };

  assert.deepEqual(shortestTopologyPath(payload.edges, "p1", "p4"), ["p1", "p2", "p3", "p4"]);
  assert.equal(shortestTopologyPath([line("p1", "p2")], "p1", "p4"), null);

  const view = filterTopologyPayload(payload, new Set(["p1", "p2"]));
  assert.deepEqual(view.nodes.map((node) => node.id), ["p1", "p2"]);
  assert.deepEqual(view.edges.map((edge) => edge.id), ["p1-p2"]);
  assert.deepEqual(view.folders.map((entry) => entry.id), ["root", "A", "A/x"], "folder B has nothing to show");
});

test("two groups with the same top concepts get distinct names", () => {
  const node = (id) => ({ id, title: id, concepts: ["Fourier"] });
  const ids = ["a1", "a2", "a3", "b1", "b2", "b3"];
  const topics = detectTopics(ids.map(node), [
    ...clique(["a1", "a2", "a3"], 0.9),
    ...clique(["b1", "b2", "b3"], 0.9),
  ]);
  assert.deepEqual(topics.map((topic) => topic.label), ["Fourier", "Fourier 2"]);
});
