import assert from "node:assert/strict";
import test from "node:test";

import {
  brainEdgeId,
  knowledgeNodeId,
  organizationPublicId,
} from "../src/lib/profile/brain-graph-ids.ts";
import {
  normalizeBrainGraph,
  safeBrainHref,
} from "../src/lib/profile/brain-graph-normalize.ts";
import { brainGraphRevision } from "../src/lib/profile/brain-graph-revision.ts";

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


test("opaque IDs are stable, namespaced, and do not reveal numeric rows", () => {
  process.env.BRAIN_GRAPH_ID_SECRET = "deterministic-test-secret";
  assert.equal(organizationPublicId(42), organizationPublicId(42));
  assert.notEqual(organizationPublicId(42), organizationPublicId(43));
  assert.doesNotMatch(organizationPublicId(42), /42/);
  assert.equal(knowledgeNodeId("alpha", "page", "a"), "garden:alpha:page:a");
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

test("the Knowledge map is never cut off: every node and edge survives normalization", () => {
  const nodes = Array.from({ length: 5_000 }, (_, index) => node(`n${index}`));
  const edges = nodes.slice(1).map((entry, index) => edge(`e${index}`, "n0", entry.id));
  const normalized = normalizeBrainGraph([{ nodes, edges }]);
  assert.equal(normalized.nodes.length, 5_000);
  assert.equal(normalized.edges.length, 4_999);
  assert.equal("truncated" in normalized, false);
});

test("safe navigation accepts only allowlisted internal Breadboard routes", () => {
  assert.equal(safeBrainHref("/buzz?room=room_public"), "/buzz?room=room_public");
  assert.equal(safeBrainHref("/garden/a?note=b"), "/garden/a?note=b");
  assert.equal(safeBrainHref("/settings?tab=knowledge"), "/settings?tab=knowledge");
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

