// Problem 1: the critic packet must never truncate formula evidence, must mark
// other truncated fields explicitly, and every critic issue must be verified
// against the full FinalGardenState before it can block.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildFinalGardenState,
} from "../src/lib/final-garden-state.ts";
import {
  buildCriticReviewPacket,
  verifyCriticIssueAgainstFinalState,
  isFormulaSyntacticallyComplete,
  runCriticLoop,
  writeCriticReports,
} from "../src/lib/critic-loop.ts";

const E_TOTAL = "E_{\\mathrm{total}} = N_{\\mathrm{spikes}} \\cdot E_{\\mathrm{spike}} + N_{\\mathrm{synops}} \\cdot E_{\\mathrm{synop}} + baseline";
const NEE = "Normalized Energy Efficiency = \\frac{Accuracy}{Energy Consumption per inference step over the whole test set}";

function tinyGarden(formulaText, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-pkt-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Metrics"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: [], sourceStructuralAnchors: [] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{
    id: "U1",
    title: "Energy",
    sourceAnchors: [],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    semanticConcepts: [{
      slug: "energy",
      preferredLabel: "Energy",
      role: "primary",
      aliases: [],
      evidenceAnchors: [],
    }],
    knowledgeClaims: [{
      id: "claim-energy-sum",
      text: "Total energy sums spike and synaptic operation energy.",
      subject: "total-energy",
      predicate: "sums",
      object: "operation-energy",
      conceptIds: ["energy"],
      evidenceAnchors: [],
      derivationAnchors: [],
      connectedClaimIds: [],
    }],
  }] }, null, 2) + "\n");
  const opening = extra.longOpening ? "X".repeat(650) + " a very long opening paragraph about energy that exceeds the excerpt limit." : "The total energy of an SNN inference sums spike and synaptic operation energy.";
  fs.writeFileSync(path.join(dir, "learning", "1. Metrics", "1.1 Energy.md"), `---
title: "Energy"
knowledge_type: "learning-page"
breadboardType: "learning_page"
generated_by: "learn_button"
learningUnitId: "U1"
sourceAnchors: []
sourceFormulaAnchors: []
tags: []
formulas:
  - kind: "source_definition"
    text: "${formulaText}"
    groundingStatus: "conceptual-helper"
---

${opening}
`);
  return dir;
}

describe("critic packet never truncates formula evidence (Fix 1/2)", () => {
  test("1+2. long formula is included completely and never sliced", () => {
    const dir = tinyGarden(E_TOTAL);
    const state = buildFinalGardenState(dir, "test-2");
    const packet = buildCriticReviewPacket(state);
    const stateFormula = state.formulas.find((f) => f.pageRel.endsWith("Energy.md"));
    assert.ok(stateFormula && stateFormula.text.length > 80, "state formula is long");
    const rec = packet.sections.flatMap((s) => s.pages).flatMap((p) => p.frontmatterSummary.formulas)[0];
    assert.ok(rec, "packet has a formula record");
    assert.equal(rec.text, stateFormula.text, "packet formula text equals the FULL state formula (not sliced)");
    assert.ok(rec.text.length > 80);
    assert.equal(rec.packetTruncated, false);
    assert.equal(rec.fullLength, stateFormula.text.length);
    // Never a truncated 80-char prefix.
    assert.notEqual(rec.text, stateFormula.text.slice(0, 80));
  });

  test("3. truncated prose field is marked packetTruncated:true with fullLength", () => {
    const dir = tinyGarden(NEE, { longOpening: true });
    const packet = buildCriticReviewPacket(buildFinalGardenState(dir, "test-2"));
    const opening = packet.sections.flatMap((s) => s.pages)[0].openingExcerpt;
    assert.equal(opening.packetTruncated, true);
    assert.ok(opening.fullLength > opening.text.length);
    assert.equal(opening.truncationReason, "excerpt_limit");
    assert.match(packet.evidenceNote, /packetTruncated:true is only an excerpt/i);
  });

  test("the critic receives the complete model-authored claim contract and complete final page body", () => {
    const dir = tinyGarden(E_TOTAL, { longOpening: true });
    const packet = buildCriticReviewPacket(buildFinalGardenState(dir, "test-2"));
    const page = packet.sections.flatMap((section) => section.pages)[0];
    assert.equal(page.learningUnitId, "U1");
    assert.equal(
      page.learningUnitContract.knowledgeClaims[0].text,
      "Total energy sums spike and synaptic operation energy.",
    );
    assert.equal(page.bodyText.packetTruncated, false);
    assert.equal(page.bodyText.text.length, page.bodyText.fullLength);
    assert.match(page.bodyText.text, /very long opening paragraph about energy/);
  });

  test("isFormulaSyntacticallyComplete distinguishes complete vs cut formulas", () => {
    assert.equal(isFormulaSyntacticallyComplete(E_TOTAL), true);
    assert.equal(isFormulaSyntacticallyComplete("E_{\\text{total}} = ... E_{\\te"), false);
    assert.equal(isFormulaSyntacticallyComplete("\\frac{a}{"), false);
    assert.equal(isFormulaSyntacticallyComplete("E = mc^2"), true);
  });
});

describe("critic issue verification against full state (Fix 3/4/5)", () => {
  test("4. formula-truncation issue is UNSUPPORTED when the full formula is complete", () => {
    const dir = tinyGarden(E_TOTAL);
    const state = buildFinalGardenState(dir, "test-2");
    const issue = { id: "c-formula-1", severity: "blocking", type: "formula_anchor_mismatch", pagePath: "learning/1. Metrics/1.1 Energy.md", problem: "Formula appears truncated / incomplete", evidence: "E_{total} = ... E_{te", expected: "complete formula", repairTarget: "unit_page", suggestedRepair: "rewrite" };
    const v = verifyCriticIssueAgainstFinalState(issue, state);
    assert.equal(v.severity, "unsupported");
    assert.equal(v.verified, false);
    assert.match(v.reason, /complete/i);
  });

  test("5. formula-truncation issue is CONFIRMED when the full formula is genuinely incomplete", () => {
    const dir = tinyGarden("E_{\\mathrm{total}} = N_{\\mathrm{spikes}} E_{\\mathrm{spike}} + N_{\\mathrm{synops");
    const state = buildFinalGardenState(dir, "test-2");
    const issue = { id: "c-formula-2", severity: "blocking", type: "formula_anchor_mismatch", pagePath: "learning/1. Metrics/1.1 Energy.md", problem: "Formula appears truncated / malformed", evidence: "cut off", expected: "complete formula", repairTarget: "unit_page", suggestedRepair: "rewrite" };
    const v = verifyCriticIssueAgainstFinalState(issue, state);
    assert.equal(v.severity, "confirmed_blocking");
    assert.equal(v.verified, true);
  });

  test("6+7. unsupported issue does not block and appears in reports", async () => {
    const dir = tinyGarden(E_TOTAL);
    const truncationCritic = () => [{ id: "c-formula-1", severity: "blocking", type: "formula_anchor_mismatch", pagePath: "learning/1. Metrics/1.1 Energy.md", problem: "Formula appears truncated", evidence: "E_{total} = ...", expected: "complete", repairTarget: "unit_page", suggestedRepair: "rewrite" }];
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: truncationCritic, options: { maxRounds: 2, strictPublish: true }, repair: () => ({ attempted: 0, resolved: 0 }) });
    // The false positive must not be a blocker.
    assert.ok(!res.finalBlockingIssues.some((i) => i.id === "c-formula-1"), "unsupported issue is not blocking");
    assert.ok(res.rounds.some((r) => (r.unsupportedIssues ?? 0) >= 1), "unsupported counted in round record");
    const loop = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "critic-loop.json"), "utf-8"));
    assert.ok(Array.isArray(loop.unsupportedCriticIssues) && loop.unsupportedCriticIssues.some((u) => u.issueId === "c-formula-1"));
    const report = fs.readFileSync(path.join(dir, ".breadboard", "critic-report.md"), "utf-8");
    assert.match(report, /## Unsupported Critic Issues/);
    assert.match(report, /c-formula-1/);
  });

  test("unsupported-issue report row format", () => {
    const dir = tinyGarden(E_TOTAL);
    writeCriticReports(dir, {
      status: { draftGenerated: true, accepted: true, publishReady: true, lifecycleStatus: "publish_ready", deterministicPass: true, criticRequired: true, criticAvailable: true, criticRan: true, criticPass: true, criticAvailabilityStatus: "available", unresolvedBlockingIssues: [], warnings: [], repairRoundsUsed: 1 },
      rounds: [{ round: 1, blockingIssues: 0, warnings: 0, repairsAttempted: 0, repairsResolved: 0, issueTypes: [], resolutions: [], provenance: [], falsePositives: [{ issue: { id: "c-formula-1", type: "formula_anchor_mismatch", problem: "Formula appears truncated", severity: "blocking" }, verification: { issueId: "c-formula-1", verified: false, severity: "unsupported", checkedFiles: [], reason: "Full FinalGardenState formula is complete; only the packet excerpt was truncated" } }] }],
      finalBlockingIssues: [], finalWarnings: [],
    });
    const report = fs.readFileSync(path.join(dir, ".breadboard", "critic-report.md"), "utf-8");
    assert.match(report, /\| Issue \| Reported Problem \| Verification Result \| Reason \|/);
    assert.match(report, /c-formula-1 \| Formula appears truncated \| unsupported \|/);
  });
});
