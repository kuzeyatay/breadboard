// Problem 2/3: migrated legacy anchors must persist modern evidence/relevance/
// provenance in the FINAL ledger (never downgraded by a later legacy record),
// and replacements must be closed across every final reference.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildFinalGardenState,
  migrateLegacyTextConceptAnchors,
  mergeCanonicalSourceAnchor,
  auditLegacyMigrationPersistence,
  applyAnchorReplacementClosure,
  computeAnchorReplacementClosure,
  findRemainingAnchorReferences,
} from "../src/lib/final-garden-state.ts";

const SRC = "paperx";
const ENERGY = "Classic networks incur high power consumption, a critical energy bottleneck for mobile and edge computing deployment.";
const NEURO = "Neuromorphic hardware uses event-driven chips and specialized asynchronous circuits to run spiking networks with low power.";
const LIF = "Leaky integrate-and-fire neurons accumulate membrane potential until a threshold triggers a spike, then reset to rest.";
const fid = (s) => `text-${SRC}-${s}`;
const legacy = (id, title, kws, exactText, page = 1) => ({ id, sourceId: SRC, page, kind: "concept", title, exactText, semanticSummary: title, conceptKeywords: kws, confidence: 0.72 });

function buildGarden(textAnchors, { structural = [], extraPageAnchors = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-mp-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".breadboard", "visuals"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Concepts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---\ntitle: "P"\nsourceId: "${SRC}"\n---\n\n# Page 1\n\n${LIF}\n\n${ENERGY}\n\n# Page 2\n\n${NEURO}\n`);
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: textAnchors, sourceStructuralAnchors: structural }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  const refs = [...textAnchors.map((a) => a.id), ...extraPageAnchors];
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "Concepts", sourceAnchors: refs, sourceFigures: [], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "learning", "1. Concepts", "1.1 Concepts.md"), `---\ntitle: "Concepts"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nsourceAnchors: [${refs.map((id) => `"${id}"`).join(", ")}]\nsourceFormulaAnchors: []\ntags: []\n---\n\nA page about concepts.\n`);
  fs.writeFileSync(path.join(dir, ".breadboard", "planning", "Source Coverage.md"), `# Source Coverage\n\n## Reconciled Source Visual Usage\n\n${refs.map((id) => `- ${id} (used)`).join("\n")}\n`);
  return dir;
}
const readLedger = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "source-anchors.json"), "utf-8"));

describe("legacy migration persistence (Fix 5/6/7)", () => {
  test("Fix 5: a migrated record persists evidence + relevance + migration provenance + string confidence", () => {
    const dir = buildGarden([legacy(fid("energy"), "Energy bottleneck", ["energy", "bottleneck"], ENERGY, 1)]);
    migrateLegacyTextConceptAnchors(dir, "test-2");
    const rec = readLedger(dir).sourceTextConceptAnchors.find((a) => a.id === fid("energy"));
    assert.ok(["high", "medium"].includes(rec.confidence), "string confidence enum");
    assert.ok(rec.evidence && typeof rec.evidence.totalScore === "number", "evidence persisted");
    assert.ok(rec.relevance && rec.relevance.decision, "relevance persisted");
    assert.ok(rec.migration && rec.migration.previousSchema === "numeric_confidence_legacy" && rec.migration.migrationStatus, "migration provenance persisted");
  });

  test("Fix 6: mergeCanonicalSourceAnchor never lets a legacy record overwrite a modern one", () => {
    const modern = { id: "x", kind: "text_concept", title: "X", origin: "text_ledger", confidence: "high", evidence: { totalScore: 0.9 }, relevance: { decision: "relevant" }, migration: { migrationStatus: "migrated" }, criticConfirmed: true, exactText: "modern text" };
    const legacyRec = { id: "x", kind: "text_concept", title: "X", origin: "text_ledger" };
    const a = mergeCanonicalSourceAnchor(modern, legacyRec);
    assert.equal(a.confidence, "high");
    assert.ok(a.evidence && a.relevance && a.migration && a.criticConfirmed);
    // Order independence: legacy incoming over modern existing also preserved.
    const b = mergeCanonicalSourceAnchor(legacyRec, modern);
    assert.equal(b.confidence, "high");
    assert.ok(b.evidence && b.relevance && b.migration);
  });

  test("Fix 7: persistence audit passes for a properly migrated garden, fails when a record reverts to legacy", () => {
    const dir = buildGarden([legacy(fid("energy"), "Energy bottleneck", ["energy", "bottleneck"], ENERGY, 1), legacy(fid("neuro"), "Neuromorphic hardware", ["neuromorphic", "hardware"], LIF, 2)]);
    migrateLegacyTextConceptAnchors(dir, "test-2");
    assert.deepEqual(auditLegacyMigrationPersistence(dir).problems, [], "clean after correct migration");
    // Simulate a later legacy overwrite (the bug): revert a record to numeric.
    const led = readLedger(dir);
    const rec = led.sourceTextConceptAnchors.find((a) => a.id === fid("energy"));
    rec.confidence = 0.72; delete rec.evidence;
    fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify(led, null, 2) + "\n");
    const problems = auditLegacyMigrationPersistence(dir).problems;
    assert.ok(problems.some((p) => p.includes(fid("energy")) && /numeric confidence|still legacy/.test(p)));
  });

  test("Fix 7: no legacy numeric-confidence text anchor survives migration in the final ledger", () => {
    const dir = buildGarden([
      legacy(fid("energy"), "Energy bottleneck", ["energy", "bottleneck"], ENERGY, 1),
      legacy(fid("neuro"), "Neuromorphic hardware", ["neuromorphic", "hardware"], LIF, 2),
      legacy(fid("scalable"), "Scalable open challenges", ["scalable", "challenges"], LIF, 1),
    ]);
    migrateLegacyTextConceptAnchors(dir, "test-2");
    for (const a of readLedger(dir).sourceTextConceptAnchors) {
      assert.equal(typeof a.confidence, "string", `${a.id} must not keep numeric confidence`);
      assert.ok(a.migration, `${a.id} must carry migration provenance`);
    }
    assert.deepEqual(auditLegacyMigrationPersistence(dir).problems, []);
  });
});

describe("anchor replacement closure (Fix 8/9)", () => {
  test("1-4. replacement updates page frontmatter, contract, visual JSON, and Source Coverage", () => {
    const dir = buildGarden([], { structural: [{ id: "S1.P2.Neuro", kind: "guidance", title: "Neuromorphic hardware", page: 2, sourceId: SRC, exactText: NEURO, conceptKeywords: ["neuromorphic", "hardware"] }, { id: "S1.P2.NeuroNew", kind: "guidance", title: "Neuromorphic hardware canonical", page: 2, sourceId: SRC, exactText: NEURO, conceptKeywords: ["neuromorphic", "hardware"] }], extraPageAnchors: ["S1.P2.Neuro"] });
    // reference old id in a visual JSON too
    fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "v1.json"), JSON.stringify({ id: "v1", type: "neural_coding", sourceAnchors: [{ figureId: "S1.P2.Neuro" }] }, null, 2) + "\n");
    const closure = applyAnchorReplacementClosure(dir, "test-2", "S1.P2.Neuro", "S1.P2.NeuroNew");
    assert.equal(closure.complete, true, `remaining: ${JSON.stringify(closure.remainingActiveReferences)}`);
    const page = fs.readFileSync(path.join(dir, "learning", "1. Concepts", "1.1 Concepts.md"), "utf-8");
    assert.match(page, /"S1\.P2\.NeuroNew"/);
    assert.doesNotMatch(page, /"S1\.P2\.Neuro"(?!New)/);
    const contract = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), "utf-8"));
    assert.ok(contract.learningUnits[0].sourceAnchors.includes("S1.P2.NeuroNew"));
    assert.ok(!contract.learningUnits[0].sourceAnchors.includes("S1.P2.Neuro"));
    assert.match(fs.readFileSync(path.join(dir, ".breadboard", "visuals", "v1.json"), "utf-8"), /S1\.P2\.NeuroNew/);
    assert.match(fs.readFileSync(path.join(dir, ".breadboard", "planning", "Source Coverage.md"), "utf-8"), /S1\.P2\.NeuroNew|Reconciled/);
  });

  test("5-6. old id removed from all ACTIVE references and old canonical record removed", () => {
    const dir = buildGarden([legacy(fid("neuro"), "Neuromorphic hardware", ["neuromorphic", "hardware"], NEURO, 2)], { structural: [{ id: "S1.P2.NeuroNew", kind: "guidance", title: "Neuromorphic hardware", page: 2, sourceId: SRC, exactText: NEURO, conceptKeywords: ["neuromorphic", "hardware"] }] });
    const closure = applyAnchorReplacementClosure(dir, "test-2", fid("neuro"), "S1.P2.NeuroNew");
    assert.equal(closure.complete, true);
    assert.equal(findRemainingAnchorReferences(dir, fid("neuro")).filter((o) => o.active).length, 0, "no active references remain");
    assert.ok(!readLedger(dir).sourceTextConceptAnchors.some((a) => a.id === fid("neuro")), "old text record removed");
  });

  test("7. a remaining ACTIVE reference makes closure incomplete; a body-prose mention does NOT", () => {
    const dir = buildGarden([legacy(fid("neuro"), "Neuromorphic hardware", ["neuromorphic", "hardware"], NEURO, 2)], { structural: [{ id: "S1.P2.NeuroNew", kind: "guidance", title: "Neuromorphic", page: 2, sourceId: SRC, exactText: NEURO, conceptKeywords: ["neuromorphic", "hardware"] }] });
    // A prose mention in the page body is HISTORICAL/free-text — it must NOT block closure.
    const pagePath = path.join(dir, "learning", "1. Concepts", "1.1 Concepts.md");
    fs.writeFileSync(pagePath, fs.readFileSync(pagePath, "utf-8") + `\n\nSee also ${fid("neuro")} in the body.\n`);
    const proseClosure = applyAnchorReplacementClosure(dir, "test-2", fid("neuro"), "S1.P2.NeuroNew");
    assert.equal(proseClosure.complete, true, "body-prose mention is non-active and does not block completeness");
    assert.ok(proseClosure.historicalMentions.some((o) => o.classification === "free_text_mention"), "prose mention surfaced as historical");

    // But a genuine ACTIVE reference (a stray visual JSON pointing at the old id) does.
    fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "stray.json"), JSON.stringify({ id: "stray", type: "neural_coding", sourceAnchors: [{ figureId: fid("neuro") }] }, null, 2) + "\n");
    const active = computeAnchorReplacementClosure(dir, fid("neuro"), "S1.P2.NeuroNew");
    assert.equal(active.complete, false);
    assert.ok(active.remainingActiveReferences.some((o) => o.classification === "active_visual"));
  });

  test("computeAnchorReplacementClosure reports remaining ACTIVE references without mutating", () => {
    const dir = buildGarden([legacy(fid("neuro"), "Neuromorphic hardware", ["neuromorphic", "hardware"], NEURO, 2)]);
    const res = computeAnchorReplacementClosure(dir, fid("neuro"), "S1.P2.NeuroNew");
    assert.equal(res.complete, false); // still referenced (not yet replaced)
    assert.ok(res.remainingActiveReferences.length > 0);
  });

  test("8. whole-token matching does not treat a prefix id as a dangling reference", () => {
    // old = text-…-stdp, new = text-…-stdp-learning (new contains old as a prefix).
    const dir = buildGarden([legacy(fid("stdp-learning"), "STDP learning", ["spike", "timing", "plasticity"], NEURO, 2)], { extraPageAnchors: [] });
    // No standalone `text-paperx-stdp` reference exists — only the longer id.
    assert.deepEqual(findRemainingAnchorReferences(dir, fid("stdp")), [], "prefix id must not match the longer id");
  });
});
