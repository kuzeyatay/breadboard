import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactNodeId,
  brainEdgeId,
  memoryNodeId,
  organizationPublicId,
} from "../src/lib/profile/brain-graph-ids.ts";
import {
  mergeBrainGraphResponse,
  normalizeBrainGraph,
  safeBrainHref,
} from "../src/lib/profile/brain-graph-normalize.ts";
import { brainGraphRevision } from "../src/lib/profile/brain-graph-revision.ts";
import { adaptBrainGraph } from "../src/lib/quartz-brain-graph/adapter.ts";
import {
  graphSearchMatches,
  quartzFocusState,
  quartzLabelAlpha,
  quartzLayoutStorageKey,
} from "../src/lib/quartz-brain-graph/state.ts";
import { quartzBrainNodeStyle } from "../src/lib/quartz-brain-graph/theme.ts";

function node(id, kind = "page", extra = {}) {
  return {
    id,
    kind,
    label: id,
    origins: ["canonical"],
    expandable: false,
    ...extra,
  };
}

function edge(id, source, target, extra = {}) {
  return {
    id,
    source,
    target,
    relation: "links_to",
    origin: "canonical",
    explicit: true,
    ...extra,
  };
}

function response(nodes, edges, revision = "brain_a") {
  return {
    revision,
    layoutKey: "layout_private",
    generatedAt: "2026-01-01T00:00:00.000Z",
    scope: { kind: "personal" },
    nodes,
    edges,
    counts: {},
    truncated: false,
    warnings: [],
    scopeOptions: [{ id: "personal", kind: "personal", label: "Personal" }],
    capabilities: {
      buzz: true,
      gbrain: false,
      organization: true,
      expansion: true,
      pathFinding: true,
    },
    diagnostics: {
      buildMs: 1,
      adapterMs: {},
      overviewNodeCount: nodes.length,
      overviewEdgeCount: edges.length,
      truncated: false,
    },
  };
}

test("opaque IDs are stable, namespaced, and do not reveal numeric rows", () => {
  process.env.BRAIN_GRAPH_ID_SECRET = "deterministic-test-secret";
  assert.equal(organizationPublicId(42), organizationPublicId(42));
  assert.notEqual(organizationPublicId(42), organizationPublicId(43));
  assert.doesNotMatch(organizationPublicId(42), /42/);
  assert.doesNotMatch(memoryNodeId(987654), /987654/);
  assert.equal(artifactNodeId("art_public"), "artifact:art_public");
  assert.equal(
    brainEdgeId("a", "b", "links_to", "canonical"),
    brainEdgeId("a", "b", "links_to", "canonical"),
  );
});

test("normalization merges provenance, sanitizes URLs, prunes dangling edges, and recomputes counts", () => {
  const normalized = normalizeBrainGraph(
    [
      {
        nodes: [
          node("a", "page", { href: "/garden/alpha?note=a" }),
          node("b", "concept"),
        ],
        edges: [edge("ab", "a", "b"), edge("secret", "a", "inaccessible")],
      },
      {
        nodes: [
          node("a", "page", {
            href: "https://attacker.invalid/private",
            origins: ["gbrain-derived"],
            expandable: true,
          }),
        ],
        edges: [
          edge("ab2", "a", "b", {
            origin: "gbrain-derived",
            explicit: false,
            weight: 0.4,
          }),
        ],
      },
    ],
    { maxNodes: 20, maxEdges: 20 },
  );
  const merged = normalized.nodes.find((entry) => entry.id === "a");
  assert.deepEqual(new Set(merged.origins), new Set(["canonical", "gbrain-derived"]));
  assert.equal(merged.expandable, true);
  assert.equal(merged.href, "/garden/alpha?note=a");
  assert.equal(normalized.edges.some((entry) => entry.target === "inaccessible"), false);
  assert.equal(normalized.counts.total, 2);
  assert.equal(normalized.counts.edges, 2, "separate edge provenance remains inspectable");
  assert.ok((merged.metrics.importance ?? 0) > 0);
});

test("caps are deterministic and always leave an endpoint-closed graph", () => {
  const nodes = Array.from({ length: 12 }, (_, index) =>
    node(`n${index}`, index === 0 ? "user" : "page", {
      updatedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    }),
  );
  const edges = nodes.slice(1).map((entry, index) => edge(`e${index}`, "n0", entry.id));
  const normalized = normalizeBrainGraph([{ nodes, edges }], { maxNodes: 5, maxEdges: 3 });
  const ids = new Set(normalized.nodes.map((entry) => entry.id));
  assert.equal(normalized.nodes.length, 5);
  assert.equal(normalized.edges.length, 3);
  assert.equal(normalized.truncated, true);
  assert.ok(normalized.edges.every((entry) => ids.has(entry.source) && ids.has(entry.target)));
  assert.ok(ids.has("n0"), "the viewer anchor survives importance selection");
});

test("safe navigation accepts only allowlisted internal Breadboard routes", () => {
  assert.equal(safeBrainHref("/buzz?room=room_public"), "/buzz?room=room_public");
  assert.equal(safeBrainHref("/garden/a?note=b"), "/garden/a?note=b");
  assert.equal(safeBrainHref("//attacker.invalid"), undefined);
  assert.equal(safeBrainHref("https://attacker.invalid"), undefined);
  assert.equal(safeBrainHref("/api/profile/brain-graph"), undefined);
});

test("revision is order independent and changes only with visible graph material", () => {
  const scope = { kind: "personal" };
  const nodes = [node("a"), node("b", "concept")];
  const edges = [edge("ab", "a", "b")];
  assert.equal(
    brainGraphRevision(scope, nodes, edges),
    brainGraphRevision(scope, [...nodes].reverse(), [...edges].reverse()),
  );
  assert.notEqual(
    brainGraphRevision(scope, nodes, edges),
    brainGraphRevision(scope, [...nodes, node("c")], edges),
  );
});

test("Breadboard response adapts to Quartz data without changing authorization semantics", () => {
  const source = response(
    [
      node("a", "garden", { gardenId: "garden:a", metrics: { importance: 0.8 } }),
      node("b", "page", { gardenId: "garden:a", subtitle: "Needle phrase" }),
    ],
    [edge("ab", "a", "b")],
  );
  const graph = adaptBrainGraph(source);
  assert.equal(graph.nodes[0].cluster, "garden:a");
  assert.equal(graph.links[0].metadata, source.edges[0]);
  assert.deepEqual(quartzFocusState(graph, "a").activeNodes, new Set(["a", "b"]));
  assert.deepEqual(graphSearchMatches(graph, "needle"), new Set(["b"]));
  assert.ok(quartzLabelAlpha(3) > quartzLabelAlpha(0.5));
  assert.equal(quartzLabelAlpha(0.25, { selected: true }), 1);
  assert.ok(quartzBrainNodeStyle("user").radius > quartzBrainNodeStyle("page").radius);
  assert.match(quartzLayoutStorageKey("private", "revision", "personal"), /private:personal:revision$/);
});

test("incremental expansion merges nodes and removes dangling expansion edges", () => {
  const current = response([node("a", "garden")], []);
  const expansion = response(
    [node("a", "garden"), node("b", "page")],
    [edge("ab", "a", "b"), edge("bad", "b", "hidden")],
    "brain_b",
  );
  const merged = mergeBrainGraphResponse(current, expansion);
  assert.deepEqual(merged.nodes.map((entry) => entry.id), ["a", "b"]);
  assert.deepEqual(merged.edges.map((entry) => entry.id), ["ab"]);
  assert.equal(merged.revision, "brain_b");
});
