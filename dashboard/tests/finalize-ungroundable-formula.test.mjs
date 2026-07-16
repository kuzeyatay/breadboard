import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { finalizeGardenExport, ungroundableFormulaWarnings } from "../src/lib/garden-finalize.ts";

const roots = [];
test.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function fm(obj) {
  return `---\n${Object.entries(obj).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n`;
}

/**
 * A garden whose source formula anchor S1.P9.E1 is CAPTION-ONLY: the ledger
 * carries a caption ("Hodgkin-Huxley membrane current equation") but the source
 * never yielded exact formula text, so the anchor is ungroundable. The contract
 * still assigns it to U1 and the learner page references it conceptually. This
 * reproduces the test2 failure family: an ungroundable anchor must not be a
 * required contract formula, must not force a page helper to be source-anchored
 * to it, and must not be flagged as "used but skipped".
 */
function makeUngroundableGarden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-ungroundable-"));
  roots.push(root);
  const dir = path.join(root, "test-ug");
  const bb = path.join(dir, ".breadboard");
  fs.mkdirSync(path.join(bb, "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Foundations"), { recursive: true });

  fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "t" }) + "# t\n");
  fs.writeFileSync(
    path.join(dir, "sources", "_index.md"),
    fm({ title: "Sources", knowledge_type: "source-index", breadboardType: "source_index", internal: "true" }) +
      "# Sources\n\n- [[sources/src1|Paper]]\n",
  );
  fs.writeFileSync(
    path.join(dir, "sources", "src1.md"),
    fm({ title: "Paper", knowledge_type: "source-document", breadboardType: "source_document", internal: "true" }) +
      "## Page 9\n\nThe Hodgkin-Huxley model describes membrane current with a conductance-based equation.\n",
  );

  // Caption-only formula anchor: intentionally skipped, no exact text anywhere.
  const ledger = [{
    sourceVisualId: "S1.P9.E1",
    sourceId: "src1",
    pageNumber: 9,
    type: "equation",
    caption: "Hodgkin-Huxley membrane current equation",
    usageStatus: "intentionally_skipped",
    conceptUsage: "intentionally_omitted",
    cropStatus: "available_not_embedded",
  }];
  fs.writeFileSync(path.join(bb, "source-visuals.json"), `${JSON.stringify(ledger, null, 2)}\n`);

  const contract = {
    sourceSetHash: "sf",
    learningUnits: [{
      id: "U1",
      title: "The Hodgkin-Huxley Model",
      role: "core_concept",
      learningQuestion: "How does the Hodgkin-Huxley model describe membrane current?",
      prerequisiteConcepts: [],
      newConcepts: ["hodgkin-huxley-model"],
      sourceAnchors: ["S1.P9.E1"],
      sourceFigures: [],
      sourceFormulas: [], // the planner correctly left it empty (anchor unverified)
      sourceTables: [],
      zettelNotes: [],
      semanticConcepts: [{ slug: "hodgkin-huxley-model", preferredLabel: "Hodgkin-Huxley model", role: "primary", aliases: [], evidenceAnchors: ["S1.P9.E1"] }],
      knowledgeClaims: [],
      mustNotRepeat: [],
      expectedWordRange: [700, 1100],
    }],
    // The STALE desync: an assignment for the ungroundable formula survives even
    // though the unit no longer lists it. The finalizer must not require it.
    sourceArtifactAssignments: [{
      sourceArtifactId: "S1.P9.E1",
      assignedLearningUnitId: "U1",
      placement: "after_formula_introduction",
      reason: "model assignment",
      requiredInterpretation: "explain the membrane current equation",
    }],
  };
  fs.writeFileSync(path.join(bb, "learning-unit-contract.json"), `${JSON.stringify(contract, null, 2)}\n`);

  fs.writeFileSync(
    path.join(dir, "learning", "1. Foundations", "1.1 The Hodgkin-Huxley Model.md"),
    fm({
      title: "1.1 The Hodgkin-Huxley Model",
      knowledge_type: "learning-page",
      breadboardType: "learning_page",
      generated_by: "learn_button",
      generatedBy: "learn_button",
      sectionNumber: 1,
      subsectionNumber: "1.1",
      learningUnitId: "U1",
      learningUnitRole: "core_concept",
      sourceAnchors: ["S1.P9.E1"],
      primaryConcepts: ["hodgkin-huxley-model"],
      supportingConcepts: [],
      tags: ["hodgkin-huxley-model"],
    }) +
      "## The Hodgkin-Huxley Model\n\nThe Hodgkin-Huxley model explains how ionic conductances shape the membrane current over time, giving the neuron its characteristic spiking behavior when the membrane potential crosses threshold.\n",
  );

  return dir;
}

test("an ungroundable (caption-only) formula anchor is not required, matched, or flagged as used-but-skipped", () => {
  const dir = makeUngroundableGarden();
  const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-ug" });
  const crits = report.criticalProblems;
  // The three specific failure families from the test2 report must be absent for
  // the ungroundable anchor.
  assert.equal(crits.some((p) => /missing contract source formula S1\.P9\.E1/.test(p)), false, `unexpected missing-formula problem: ${crits.find((p) => /missing contract source formula/.test(p))}`);
  assert.equal(crits.some((p) => /S1\.P9\.E1: usageStatus=\S+ but the anchor is used/.test(p)), false, `unexpected usage-vs-skip problem: ${crits.find((p) => /but the anchor is used/.test(p))}`);
  assert.equal(crits.some((p) => /matches source formula S1\.P9\.E1 but is marked conceptual-helper/.test(p)), false);

  // The incomplete-extraction gap is surfaced as a NON-BLOCKING warning (never a
  // critical problem) so it is not papered over silently.
  assert.ok(report.warnings.some((w) => /Incomplete source formula extraction/.test(w) && /S1\.P9\.E1/.test(w)),
    `expected an incomplete-extraction warning, got: ${JSON.stringify(report.warnings)}`);
  assert.equal(crits.some((p) => /Incomplete source formula extraction/.test(p)), false, "warning must not be a critical problem");
});

test("ungroundableFormulaWarnings returns [] when no referenced formula anchors exist", () => {
  // A garden with no formula ledger entries has nothing to warn about.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-noformula-"));
  roots.push(root);
  const dir = path.join(root, "g");
  fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]");
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [] }));
  assert.deepEqual(ungroundableFormulaWarnings(dir), []);
});
