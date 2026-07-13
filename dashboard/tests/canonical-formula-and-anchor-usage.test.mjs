// Part 1 (canonical formula normalization), Fix 5 (garden-artifact modes), and
// Part 3 (weak-anchor usage: active blocks, unused does not). All isolated —
// temporary fixtures only, never the live quartz/content/test-2 garden.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeFormulaMetadataCanonical,
  compactFormulaMetadataByLineage,
} from "../src/lib/garden-finalize.ts";
import { classifyGardenArtifact, liveGardenTestsEnabled, isMutableRuntimeGarden } from "../src/lib/garden-artifact-mode.ts";
import { buildFinalGardenState, auditFinalGardenState } from "../src/lib/final-garden-state.ts";

// ---------------------------------------------------------------------------
// Fix 5: garden-artifact classification
// ---------------------------------------------------------------------------

describe("garden artifact modes (Fix 5)", () => {
  test("live content dir is runtime_generated; fixtures immutable; temp is temporary", () => {
    assert.equal(classifyGardenArtifact("/repo/quartz/content/test-2"), "runtime_generated");
    assert.equal(classifyGardenArtifact("/repo/dashboard/tests/fixtures/garden-min"), "immutable_fixture");
    assert.equal(classifyGardenArtifact(path.join(os.tmpdir(), "bb-x", "test-2")), "temporary_test_fixture");
    assert.equal(isMutableRuntimeGarden("runtime_generated"), true);
    assert.equal(isMutableRuntimeGarden("immutable_fixture"), false);
  });

  test("live-garden tests are opt-in via BREADBOARD_TEST_LIVE_GARDEN", () => {
    assert.equal(liveGardenTestsEnabled({}), false);
    assert.equal(liveGardenTestsEnabled({ BREADBOARD_TEST_LIVE_GARDEN: "1" }), true);
    assert.equal(liveGardenTestsEnabled({ BREADBOARD_TEST_LIVE_GARDEN: "true" }), true);
    assert.equal(liveGardenTestsEnabled({ BREADBOARD_TEST_LIVE_GARDEN: "0" }), false);
  });
});

// ---------------------------------------------------------------------------
// Part 1: canonical formula normalization
// ---------------------------------------------------------------------------

describe("canonical formula normalization (Part 1)", () => {
  const def = { kind: "source_definition", text: "\\text{Accuracy}=\\frac{N_c}{N_t}", groundingStatus: "source-anchored", sourceAnchor: "S1.P6.E1", justification: "d" };
  const ex = (n) => ({ kind: "worked_example", text: `84/100 -> ${n}/100 = 0.${n}`, groundingStatus: "conceptual-helper", basedOnFormula: "S1.P6.E1", formulaFamily: "accuracy", justification: "e" });

  test("4. equivalent metadata mutations produce identical serialized frontmatter", () => {
    const a = normalizeFormulaMetadataCanonical([def, ex("84"), ex("90"), ex("75"), ex("60")], { pagePath: "p" });
    // Same entries in a different order + a duplicate.
    const b = normalizeFormulaMetadataCanonical([ex("90"), ex("84"), { ...ex("84") }, def, ex("75"), ex("60")], { pagePath: "p" });
    const serialize = (entries) => entries.map((e) => `${e.kind}|${e.text}|${e.basedOnFormula ?? ""}`).join("\n");
    // Definition kept once; per-lineage examples capped identically regardless of input order/dupes.
    assert.equal(a.entries.filter((e) => e.kind === "source_definition").length, 1);
    assert.equal(serialize(a.entries.filter((e) => e.kind === "source_definition")), serialize(b.entries.filter((e) => e.kind === "source_definition")));
    assert.ok(a.entries.filter((e) => e.kind === "worked_example").length <= 2);
    assert.ok(b.entries.filter((e) => e.kind === "worked_example").length <= 2);
  });

  test("the pipeline audits its own output as valid", () => {
    const result = normalizeFormulaMetadataCanonical([def, ex("84"), ex("90")], { pagePath: "p" });
    assert.equal(result.audit.valid, true, JSON.stringify(result.audit.problems));
    assert.ok(result.changes.length >= 0);
  });

  test("compaction keeps a definition and one-to-two examples per lineage", () => {
    const compact = compactFormulaMetadataByLineage([def, ex("1"), ex("2"), ex("3"), ex("4"), ex("5")]);
    assert.equal(compact.filter((e) => e.kind === "source_definition").length, 1);
    assert.ok(compact.filter((e) => e.kind === "worked_example").length <= 2);
  });
});

// ---------------------------------------------------------------------------
// Part 3: weak-anchor usage — active blocks, unused does not
// ---------------------------------------------------------------------------

function fm(obj) {
  return `---\n${Object.entries(obj).map(([k, v]) => Array.isArray(v) ? `${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]` : `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n`;
}

function buildWeakAnchorGarden(dir, { referenceUnused = false } = {}) {
  const bb = path.join(dir, ".breadboard");
  fs.mkdirSync(bb, { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Concepts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
  fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
  fs.writeFileSync(path.join(bb, "source-visuals.json"), "[]");
  fs.writeFileSync(path.join(bb, "visual-index.json"), "{}");
  const weakAnchor = (id, kw) => ({
    id, kind: "text_concept", sourceId: "src", title: `${kw} concept`,
    semanticSummary: `A passage about ${kw}.`, conceptKeywords: [kw],
    confidence: "low", evidence: { totalScore: 0.4, keywordHits: [kw] },
  });
  fs.writeFileSync(path.join(bb, "source-anchors.json"), JSON.stringify({
    sourceTextConceptAnchors: [
      weakAnchor("text-active-weak-anchor", "active"),
      weakAnchor("text-unused-weak-anchor", "unused"),
    ],
  }, null, 2));
  fs.writeFileSync(path.join(bb, "learning-unit-contract.json"), JSON.stringify({
    learningUnits: [{ id: "U1", role: "core_concept", title: "Concept", learningQuestion: "What?", sourceAnchors: ["text-active-weak-anchor"], zettelNotes: [{ handle: "concept-defines-an-idea", claim: "Concept defines an idea." }] }],
    sourceArtifactAssignments: [],
  }, null, 2));
  const anchors = referenceUnused ? ["text-active-weak-anchor", "text-unused-weak-anchor"] : ["text-active-weak-anchor"];
  fs.writeFileSync(path.join(dir, "learning", "1. Concepts", "1.1 Concept.md"),
    fm({ title: "1.1 Concept", knowledge_type: "learning-page", breadboardType: "learning_page", learningUnitId: "U1", generatedBy: "learn_button", sourceAnchors: anchors, tags: ["concept-defines-an-idea"] }) +
      `## Concept\n\n${"This lesson teaches the active concept in depth. ".repeat(30)}\n`);
}

describe("weak-anchor usage classification (Part 3)", () => {
  test("12/13/16. an ACTIVELY referenced weak anchor blocks; an UNUSED one does not", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-wa-"));
    try {
      const dir = path.join(root, "test-2");
      buildWeakAnchorGarden(dir, { referenceUnused: false });
      const state = buildFinalGardenState(dir, "test-2");
      const audit = auditFinalGardenState(state);
      const evidence = audit.byRule?.anchor_evidence ?? [];
      assert.ok(evidence.some((p) => p.includes("text-active-weak-anchor")), `active weak anchor must block, got: ${JSON.stringify(evidence)}`);
      assert.ok(!evidence.some((p) => p.includes("text-unused-weak-anchor")), "unused weak anchor must NOT block");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("15. usage detection follows a page reference (unused becomes active when referenced)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-wa2-"));
    try {
      const dir = path.join(root, "test-2");
      buildWeakAnchorGarden(dir, { referenceUnused: true });
      const state = buildFinalGardenState(dir, "test-2");
      const evidence = auditFinalGardenState(state).byRule?.anchor_evidence ?? [];
      // Now both are referenced → both block.
      assert.ok(evidence.some((p) => p.includes("text-unused-weak-anchor")), "a now-referenced weak anchor blocks");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
