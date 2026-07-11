// Problem 1 (Fix 1/2/3): legacy text-concept enforcement is derived from the
// FINAL canonical ledger, NOT from the presence of a migration report. A report
// is diagnostic output and must never enable or disable validation. The audit is
// kind-specific: only text_concept records are held to the strict modern schema.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildFinalGardenState,
  auditLegacyAnchorsFromFinalLedger,
  legacyTextConceptReasons,
} from "../src/lib/final-garden-state.ts";

const SRC = "paperx";
const ENERGY = "Classic networks incur high power consumption, a critical energy bottleneck for mobile and edge computing deployment.";

const legacyNumeric = (id) => ({ id, sourceId: SRC, page: 1, kind: "concept", title: "Energy bottleneck", exactText: ENERGY, semanticSummary: "energy", conceptKeywords: ["energy", "bottleneck"], confidence: 0.72 });
const modern = (id) => ({ id, sourceId: SRC, page: 1, kind: "concept", title: "Energy bottleneck", exactText: ENERGY, semanticSummary: "energy", conceptKeywords: ["energy", "bottleneck"], confidence: "high", evidence: { totalScore: 0.9, presence: "verbatim" }, relevance: { decision: "relevant", totalScore: 0.8 }, migration: { migratedAt: "2026-07-01T00:00:00Z", previousSchema: "numeric_confidence_legacy", migrationStatus: "migrated" } });

function buildGarden({ text = [], structural = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-lla-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Concepts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---\ntitle: "P"\nsourceId: "${SRC}"\n---\n\n# Page 1\n\n${ENERGY}\n`);
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: text, sourceStructuralAnchors: structural }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  const refs = text.map((a) => a.id);
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "Concepts", sourceAnchors: refs, sourceFigures: [], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "learning", "1. Concepts", "1.1 Concepts.md"), `---\ntitle: "Concepts"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nsourceAnchors: [${refs.map((id) => `"${id}"`).join(", ")}]\nsourceFormulaAnchors: []\ntags: []\n---\n\nA page.\n`);
  return dir;
}
const state = (dir) => buildFinalGardenState(dir, "test-2");

describe("ledger-driven legacy audit (Fix 1/2/3)", () => {
  test("1. flags a numeric-confidence text anchor as legacy — with NO migration report present", () => {
    const dir = buildGarden({ text: [legacyNumeric("text-paperx-energy")] });
    assert.ok(!fs.existsSync(path.join(dir, ".breadboard", "source-anchor-migration.json")), "no report present");
    const res = auditLegacyAnchorsFromFinalLedger(state(dir));
    assert.equal(res.required, true);
    assert.equal(res.passed, false);
    assert.equal(res.legacyAnchors.length, 1);
    assert.deepEqual(res.unresolvedAnchors, ["text-paperx-energy"]);
    assert.ok(res.legacyAnchors[0].reasons.includes("numeric_confidence"));
    assert.ok(res.legacyAnchors[0].reasons.includes("missing_evidence"));
  });

  test("2. a fully modern text anchor passes", () => {
    const res = auditLegacyAnchorsFromFinalLedger(state(buildGarden({ text: [modern("text-paperx-energy")] })));
    assert.equal(res.passed, true);
    assert.deepEqual(res.legacyAnchors, []);
    assert.deepEqual(res.migratedAnchors, ["text-paperx-energy"]);
  });

  test("3. verdict is identical whether or not a (misleading) migration report exists", () => {
    const dir = buildGarden({ text: [legacyNumeric("text-paperx-energy")] });
    const withoutReport = auditLegacyAnchorsFromFinalLedger(state(dir));
    // Write a report that LIES (claims everything migrated). It must not flip the verdict.
    fs.writeFileSync(path.join(dir, ".breadboard", "source-anchor-migration.json"), JSON.stringify({ results: [{ anchorId: "text-paperx-energy", status: "migrated" }] }, null, 2) + "\n");
    const withReport = auditLegacyAnchorsFromFinalLedger(state(dir));
    assert.equal(withoutReport.passed, false);
    assert.equal(withReport.passed, false);
    assert.deepEqual(withReport.unresolvedAnchors, withoutReport.unresolvedAnchors);
  });

  test("4. a report claiming migration cannot mask a still-legacy record (report never disables validation)", () => {
    const dir = buildGarden({ text: [legacyNumeric("text-paperx-energy")] });
    // Even an EMPTY results report, or a deleted report, yields the same block.
    fs.writeFileSync(path.join(dir, ".breadboard", "source-anchor-migration.json"), JSON.stringify({ results: [] }, null, 2) + "\n");
    assert.equal(auditLegacyAnchorsFromFinalLedger(state(dir)).passed, false);
    fs.rmSync(path.join(dir, ".breadboard", "source-anchor-migration.json"));
    assert.equal(auditLegacyAnchorsFromFinalLedger(state(dir)).passed, false);
  });

  test("5. kind-specific: a formula/figure record is NOT judged by the text-concept schema", () => {
    // A structural (figure) record mis-filed in the text array with numeric confidence
    // must NOT be flagged as a legacy text_concept.
    const figureRecord = { id: "S1.P1.F1", sourceId: SRC, page: 1, kind: "figure", title: "Arch", confidence: 0.8 };
    const formulaRecord = { id: "S1.P1.E1", sourceId: SRC, page: 1, kind: "formula", title: "LIF", confidence: 0.9 };
    assert.deepEqual(legacyTextConceptReasons(figureRecord), []);
    assert.deepEqual(legacyTextConceptReasons(formulaRecord), []);
    const res = auditLegacyAnchorsFromFinalLedger(state(buildGarden({ text: [figureRecord, formulaRecord, modern("text-paperx-ok")] })));
    assert.equal(res.passed, true, JSON.stringify(res.legacyAnchors));
  });

  test("6. structural anchors in sourceStructuralAnchors are entirely out of scope", () => {
    const res = auditLegacyAnchorsFromFinalLedger(state(buildGarden({
      text: [modern("text-paperx-ok")],
      structural: [{ id: "S1.P1.Abstract", kind: "abstract", title: "Abstract", page: 1, sourceId: SRC, confidence: 0.7 }],
    })));
    assert.equal(res.passed, true);
  });

  test("7. a text anchor missing relevance OR source text is legacy (strict text schema)", () => {
    const noRelevance = { ...modern("text-paperx-a") };
    delete noRelevance.relevance;
    const noText = { ...modern("text-paperx-b") };
    delete noText.exactText;
    const res = auditLegacyAnchorsFromFinalLedger(state(buildGarden({ text: [noRelevance, noText] })));
    assert.equal(res.passed, false);
    const byId = Object.fromEntries(res.legacyAnchors.map((l) => [l.anchorId, l.reasons]));
    assert.ok(byId["text-paperx-a"].includes("missing_relevance"));
    assert.ok(byId["text-paperx-b"].includes("missing_source_text"));
  });
});
