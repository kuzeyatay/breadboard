import assert from "node:assert/strict";
import test from "node:test";

import {
  selectedSourceArtifactInventorySnapshot,
  sourceMapArtifactInventoryTransition,
} from "../src/lib/learn-source-artifact-inventory.ts";

const identities = [
  { sourceId: "source-a", sourceIndex: 1 },
  { sourceId: "source-b", sourceIndex: 2 },
];

function visual(overrides = {}) {
  return {
    sourceVisualId: "S1.P4.E1",
    sourceId: "source-a",
    pageNumber: 4,
    type: "equation",
    caption: "Displayed field equation",
    exactText: "\\nabla \\cdot \\mathbf{E} = 0",
    bbox: { x: 0.1, y: 0.2, width: 0.6, height: 0.15 },
    croppedImagePath: "/garden/assets/source-visuals/equation.png",
    pageImagePath: "/garden/assets/source-pages/page-4.png",
    usageStatus: "unassigned",
    ...overrides,
  };
}

function snapshot(visuals, selectedSourceIds = ["source-a", "source-b"]) {
  return selectedSourceArtifactInventorySnapshot({
    selectedSourceIds,
    sourceIdentityMap: identities,
    visuals,
  });
}

test("canonical selected artifact inventory is order-independent and preserves planner-visible provenance", () => {
  const equation = visual();
  const table = visual({
    sourceVisualId: "S2.P8.T1",
    sourceId: "source-b",
    pageNumber: 8,
    type: "table",
    caption: "Material constants",
    exactText: undefined,
    bbox: { x: 0.2, y: 0.35, width: 0.5, height: 0.3 },
    croppedImagePath: "/garden/assets/source-visuals/table.png",
    pageImagePath: "/garden/assets/source-pages/page-8.png",
  });
  const first = snapshot([table, equation]);
  const reordered = snapshot([equation, table]);
  const reorderedSources = snapshot([equation, table], ["source-b", "source-a"]);

  assert.equal(first.sourceArtifactInventoryHash, reordered.sourceArtifactInventoryHash);
  assert.equal(first.sourceArtifactInventoryHash, reorderedSources.sourceArtifactInventoryHash);
  assert.deepEqual(first.artifacts.map((artifact) => artifact.sourceVisualId), [
    "S1.P4.E1",
    "S2.P8.T1",
  ]);
  assert.deepEqual(first.artifacts[0].bbox, equation.bbox);
  assert.equal(first.artifacts[0].croppedImagePath, equation.croppedImagePath);
  assert.equal(first.artifacts[0].pageImagePath, equation.pageImagePath);
});

test("every planner-visible selected artifact field participates in the canonical hash", () => {
  const baseline = snapshot([visual()]);
  const variants = [
    visual({ caption: "A changed caption" }),
    visual({ exactText: "A changed exact transcription" }),
    visual({ bbox: { x: 0.11, y: 0.2, width: 0.6, height: 0.15 } }),
    visual({ croppedImagePath: "/garden/assets/source-visuals/changed.png" }),
    visual({ pageImagePath: "/garden/assets/source-pages/changed.png" }),
    visual({ type: "diagram" }),
    visual({ sourceVisualId: "S1.P5.E1", pageNumber: 5 }),
    visual({ sourceVisualId: "S2.P4.E1", sourceId: "source-b" }),
  ];

  for (const changed of variants) {
    assert.notEqual(
      snapshot([changed]).sourceArtifactInventoryHash,
      baseline.sourceArtifactInventoryHash,
    );
  }
});

test("a late non-equation artifact forces one Source Map reauthor and a second drift fails closed", () => {
  const before = snapshot([visual()]);
  const afterFirstLateScan = snapshot([
    visual(),
    visual({
      sourceVisualId: "S1.P312.F1",
      pageNumber: 312,
      type: "figure",
      caption: "Late source figure",
      exactText: undefined,
      bbox: { x: 0.15, y: 0.1, width: 0.7, height: 0.65 },
      croppedImagePath: "/garden/assets/source-visuals/late-figure.png",
      pageImagePath: "/garden/assets/source-pages/page-312.png",
    }),
  ]);
  assert.notEqual(before.sourceArtifactInventoryHash, afterFirstLateScan.sourceArtifactInventoryHash);
  assert.equal(
    sourceMapArtifactInventoryTransition({
      before,
      after: afterFirstLateScan,
      replanAttempted: false,
    }),
    "reauthor",
  );

  const afterSecondLateScan = snapshot([
    ...afterFirstLateScan.artifacts.map((artifact) => visual({
      sourceVisualId: artifact.sourceVisualId,
      sourceId: artifact.sourceId,
      pageNumber: artifact.pageNumber,
      type: artifact.type,
      caption: artifact.caption,
      exactText: artifact.exactText ?? undefined,
      bbox: artifact.bbox ?? undefined,
      croppedImagePath: artifact.croppedImagePath ?? undefined,
      pageImagePath: artifact.pageImagePath ?? undefined,
    })),
    visual({
      sourceVisualId: "S2.P313.G1",
      sourceId: "source-b",
      pageNumber: 313,
      type: "graph",
      caption: "Late source graph",
      exactText: undefined,
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
      croppedImagePath: "/garden/assets/source-visuals/late-graph.png",
      pageImagePath: "/garden/assets/source-pages/page-313.png",
    }),
  ]);
  assert.equal(
    sourceMapArtifactInventoryTransition({
      before: afterFirstLateScan,
      after: afterSecondLateScan,
      replanAttempted: true,
    }),
    "fail",
  );
});

test("ambiguous selected artifact ids fail instead of hashing a conflicted registry", () => {
  assert.throws(
    () => snapshot([visual(), visual({ caption: "Conflicting duplicate id" })]),
    /duplicate\/conflicting id/i,
  );
});

test("structured source ids cannot hide selected rows by claiming an unselected source", () => {
  assert.doesNotThrow(() => selectedSourceArtifactInventorySnapshot({
    selectedSourceIds: ["source-a"],
    sourceIdentityMap: identities,
    visuals: [visual({
      sourceVisualId: "S2.P9.F1",
      sourceId: "source-b",
      pageNumber: 9,
      type: "figure",
      caption: "A valid unselected figure",
    })],
  }));

  assert.throws(
    () => selectedSourceArtifactInventorySnapshot({
      selectedSourceIds: ["source-a"],
      sourceIdentityMap: identities,
      visuals: [visual({ sourceId: "source-x" })],
    }),
    /source\/index ownership conflict/i,
  );
  assert.throws(
    () => snapshot([visual({ sourceId: "source-a " })]),
    /source\/index ownership conflict/i,
  );
});

test("malformed selected visual rows cannot become a stable Source Map inventory hash", () => {
  assert.throws(
    () => selectedSourceArtifactInventorySnapshot({
      selectedSourceIds: ["source-a"],
      sourceIdentityMap: [{ sourceId: " source-a ", sourceIndex: 1 }],
      visuals: [visual()],
    }),
    /invalid source identity/i,
  );
  assert.throws(
    () => snapshot([visual({ type: "unknown" })]),
    /unknown artifact type/i,
  );
  assert.throws(
    () => snapshot([visual({ caption: null })]),
    /invalid caption/i,
  );
  assert.throws(
    () => snapshot([visual({ bbox: { x: 0.8, y: 0.2, width: 0.3, height: 0.2 } })]),
    /outside the normalized page bounds/i,
  );
  assert.throws(
    () => snapshot([visual({ croppedImagePath: { not: "a path" } })]),
    /invalid croppedImagePath/i,
  );
});
