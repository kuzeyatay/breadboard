// Problem 3 (Fix 7/8/9): distinguish ACTIVE anchor references (grounding,
// contract, visuals, coverage projection, canonical registry) from HISTORICAL
// mentions (repair log, critic log, migration report) and conservative free-text
// prose mentions. Replacement completeness requires only that ACTIVE references
// are gone; historical mentions are preserved and shown separately.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findRemainingAnchorReferences,
  applyAnchorReplacementClosure,
  computeAnchorReplacementClosure,
} from "../src/lib/final-garden-state.ts";

const SRC = "paperx";
const NEURO = "Neuromorphic hardware uses event-driven chips to run spiking networks with low power.";
const OLD = "S1.P2.Neuro";
const NEW = "S1.P2.NeuroNew";

function buildGarden({ withHistory = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-arc-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".breadboard", "visuals"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Concepts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---\ntitle: "P"\nsourceId: "${SRC}"\n---\n\n# Page 2\n\n${NEURO}\n`);
  const structural = [
    { id: OLD, kind: "guidance", title: "Neuromorphic hardware", page: 2, sourceId: SRC, exactText: NEURO, conceptKeywords: ["neuromorphic", "hardware"] },
    { id: NEW, kind: "guidance", title: "Neuromorphic hardware canonical", page: 2, sourceId: SRC, exactText: NEURO, conceptKeywords: ["neuromorphic", "hardware"] },
  ];
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: [], sourceStructuralAnchors: structural }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "Concepts", sourceAnchors: [OLD], sourceFigures: [], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "learning", "1. Concepts", "1.1 Concepts.md"), `---\ntitle: "Concepts"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nsourceAnchors: ["${OLD}"]\nsourceFormulaAnchors: []\ntags: []\n---\n\nA page about ${OLD} concepts.\n`);
  fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "v1.json"), JSON.stringify({ id: "v1", type: "neural_coding", sourceAnchors: [{ figureId: OLD }] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "planning", "Source Coverage.md"), `# Source Coverage\n\n## Reconciled Source Visual Usage\n\n- ${OLD} (used)\n`);
  if (withHistory) {
    fs.writeFileSync(path.join(dir, ".breadboard", "repair-log.json"), JSON.stringify([{ target: OLD, action: "noted" }], null, 2) + "\n");
    fs.writeFileSync(path.join(dir, ".breadboard", "critic-issues.json"), JSON.stringify({ blocking: [{ id: "c1", sourceAnchorIds: [OLD] }], warnings: [] }, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, ".breadboard", "source-anchor-migration.json"), JSON.stringify({ results: [{ anchorId: OLD, status: "replaced", replacementAnchorId: NEW }] }, null, 2) + "\n");
  }
  return dir;
}

describe("anchor reference classification (Fix 7/8/9)", () => {
  test("1. classifies each occurrence: grounding/contract/visual/projection/registry are active", () => {
    const occ = findRemainingAnchorReferences(buildGarden(), OLD);
    const classes = new Set(occ.map((o) => o.classification));
    assert.ok(classes.has("active_grounding"), "page frontmatter");
    assert.ok(classes.has("active_contract"), "contract");
    assert.ok(classes.has("active_visual"), "visual json");
    assert.ok(classes.has("active_projection"), "source coverage");
    assert.ok(classes.has("canonical_registry"), "ledger record");
    assert.ok(occ.filter((o) => o.active).length >= 5);
  });

  test("2. body prose that names the id is a conservative free_text_mention (non-active)", () => {
    const occ = findRemainingAnchorReferences(buildGarden(), OLD);
    const prose = occ.find((o) => o.classification === "free_text_mention");
    assert.ok(prose, "prose mention detected");
    assert.equal(prose.active, false);
  });

  test("3. historical logs/reports are classified historical and are NON-active", () => {
    const occ = findRemainingAnchorReferences(buildGarden({ withHistory: true }), OLD);
    const byClass = Object.fromEntries(occ.map((o) => [o.classification, o]));
    assert.ok(byClass.historical_repair_log && byClass.historical_repair_log.active === false);
    assert.ok(byClass.historical_critic_log && byClass.historical_critic_log.active === false);
    assert.ok(byClass.historical_migration_report && byClass.historical_migration_report.active === false);
  });

  test("4. after replacement: complete=true when active refs gone even if history still names the old id", () => {
    const dir = buildGarden({ withHistory: true });
    const closure = applyAnchorReplacementClosure(dir, "test-2", OLD, NEW);
    assert.equal(closure.complete, true, `active remaining: ${JSON.stringify(closure.remainingActiveReferences)}`);
    assert.equal(closure.remainingActiveReferences.length, 0);
    // historical repair-log / migration report still legitimately mention the old id.
    assert.ok(closure.historicalMentions.length >= 1, "history preserved and shown separately");
    assert.ok(closure.historicalMentions.every((o) => !o.active));
  });

  test("5. completeness ignores historicalMentions (they never block)", () => {
    const dir = buildGarden({ withHistory: true });
    applyAnchorReplacementClosure(dir, "test-2", OLD, NEW);
    // Re-scan: any leftover occurrences must all be historical/non-active.
    const occ = findRemainingAnchorReferences(dir, OLD);
    assert.equal(occ.filter((o) => o.active).length, 0);
    assert.ok(occ.length >= 1); // history retained
  });

  test("6. whole-token matching: a prefix id does not match a longer id", () => {
    const dir = buildGarden();
    // OLD (S1.P2.Neuro) is a strict prefix of NEW (S1.P2.NeuroNew). A whole-token
    // search for the shorter prefix "S1.P2.Ne" must match NEITHER.
    assert.deepEqual(findRemainingAnchorReferences(dir, "S1.P2.Ne"), []);
    // NEW is registered in the ledger but not otherwise referenced, so a search for
    // NEW finds ONLY the canonical registry entry — never OLD's occurrences.
    const forNew = findRemainingAnchorReferences(dir, NEW);
    assert.ok(forNew.every((o) => o.classification === "canonical_registry"), `NEW only in registry: ${JSON.stringify(forNew.map((o) => o.classification))}`);
  });

  test("7. a stray active visual reference after replacement keeps closure incomplete", () => {
    const dir = buildGarden();
    applyAnchorReplacementClosure(dir, "test-2", OLD, NEW);
    fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "stray.json"), JSON.stringify({ id: "stray", sourceAnchors: [{ figureId: OLD }] }, null, 2) + "\n");
    const closure = computeAnchorReplacementClosure(dir, OLD, NEW);
    assert.equal(closure.complete, false);
    assert.ok(closure.remainingActiveReferences.some((o) => o.classification === "active_visual"));
  });
});
