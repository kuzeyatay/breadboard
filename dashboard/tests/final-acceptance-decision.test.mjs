// One canonical acceptance decision from the rebuilt final state. Deterministic
// failures take precedence over critic availability; critic unavailability is a
// separate detail. All reports share the same counts.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFinalGardenState } from "../src/lib/final-garden-state.ts";
import {
  computeFinalAcceptanceDecision,
  collectDeterministicBlockers,
  reconcileValidationReportWithDecision,
} from "../src/lib/critic-loop.ts";

const SRC = "paperx";

// A garden whose page + contract reference an anchor MISSING from the registry
// (a deterministic dangling-reference failure).
function buildDanglingGarden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-fad-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. X"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---\ntitle: "P"\nsourceId: "${SRC}"\n---\n\n# Page 1\n\nSome source text about spikes.\n`);
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: [], sourceStructuralAnchors: [] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "X", sourceAnchors: ["text-paperx-gone"], sourceFigures: [], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "learning", "1. X", "1.1 X.md"), `---\ntitle: "X"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nsourceAnchors: ["text-paperx-gone"]\nsourceFormulaAnchors: []\ntags: []\n---\n\nA page grounded on a deleted anchor.\n`);
  return dir;
}

describe("final acceptance decision (Fix 12/13/14)", () => {
  test("22./26. deterministic failure + critic HTTP 429 → deterministic_validation_failed, critic shown separately", () => {
    const state = buildFinalGardenState(buildDanglingGarden(), "test-2");
    const d = computeFinalAcceptanceDecision(state, {
      draftGenerated: true, strictPublish: true, criticRan: false, criticAvailable: false,
      criticAvailabilityProblem: "HTTP 429", verifiedCriticBlockers: [], verifiedWarnings: [],
    });
    assert.equal(d.primaryReason, "deterministic_validation_failed", "deterministic failure wins over critic unavailability");
    assert.equal(d.deterministicPass, false);
    assert.ok(d.deterministicBlockerCount >= 1);
    assert.equal(d.criticAvailable, false);
    assert.equal(d.criticAvailabilityProblem, "HTTP 429", "429 is an availability detail, not the primary reason");
    assert.equal(d.publishReady, false);
  });

  test("23./25. the decision includes all deterministic blockers and exposes shared counts", () => {
    const state = buildFinalGardenState(buildDanglingGarden(), "test-2");
    const blockers = collectDeterministicBlockers(state);
    assert.ok(blockers.some((b) => /text-paperx-gone/.test(b.problem)), "missing canonical anchor is a deterministic blocker");
    const d = computeFinalAcceptanceDecision(state, { draftGenerated: true, strictPublish: true, criticRan: true, criticAvailable: true, verifiedCriticBlockers: [], verifiedWarnings: [] });
    assert.equal(d.deterministicBlockerCount, d.deterministicBlockers.length);
    assert.ok(d.deterministicBlockerCount >= 1);
  });

  test("24. validation-report.md cannot show 0 FAIL / Accepted: yes when deterministicPass is false", () => {
    const dir = buildDanglingGarden();
    const state = buildFinalGardenState(dir, "test-2");
    // Simulate the pre-migration report that (wrongly) claimed a clean pass.
    const reportPath = path.join(dir, ".breadboard", "validation-report.md");
    fs.writeFileSync(reportPath, "# Breadboard Validation Report\n\nCheck results: 40 PASS, 0 WARN, 0 FAIL, 0 SKIP\nAccepted: yes\n\nBlocking failures:\n- None\n");
    const d = computeFinalAcceptanceDecision(state, { draftGenerated: true, strictPublish: true, criticRan: false, criticAvailable: false, criticAvailabilityProblem: "HTTP 429", verifiedCriticBlockers: [], verifiedWarnings: [] });
    reconcileValidationReportWithDecision(dir, d);
    const text = fs.readFileSync(reportPath, "utf-8");
    assert.doesNotMatch(text, /Check results: \d+ PASS, \d+ WARN, 0 FAIL/, "FAIL count reflects deterministic blockers");
    assert.match(text, /^Accepted: no$/m);
    assert.match(text, /## Final Acceptance Decision/);
    assert.match(text, /Primary reason: deterministic_validation_failed/);
    assert.match(text, /Critic available: false \(HTTP 429\)/);
  });

  test("clean garden with critic available → accepted", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-fad-ok-"));
    const dir = path.join(root, "test-2");
    fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
    fs.mkdirSync(path.join(dir, "learning", "1. X"), { recursive: true });
    fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
    fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---\ntitle: "P"\nsourceId: "${SRC}"\n---\n\n# Page 1\n\nSource text.\n`);
    fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: [], sourceStructuralAnchors: [] }, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
    fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "X", sourceAnchors: [], sourceFigures: [], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "learning", "1. X", "1.1 X.md"), `---\ntitle: "X"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nsourceAnchors: []\nsourceFormulaAnchors: []\ntags: []\n---\n\nA clean page.\n`);
    const state = buildFinalGardenState(dir, "test-2");
    const d = computeFinalAcceptanceDecision(state, { draftGenerated: true, strictPublish: true, criticRan: true, criticAvailable: true, verifiedCriticBlockers: [], verifiedWarnings: [] });
    assert.equal(d.deterministicPass, true, JSON.stringify(d.deterministicBlockers));
    assert.equal(d.primaryReason, "accepted");
    assert.equal(d.publishReady, true);
  });
});
