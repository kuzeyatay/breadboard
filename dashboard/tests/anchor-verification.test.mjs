// Tests for independent verification of ChatMock anchor decisions against the
// source files. A confirm/create_better decision must quote text that actually
// exists in the source; a replace must be semantically compatible. Unverified
// decisions stay blocking.

import test, { describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFinalGardenState,
  auditFinalGardenState,
  reconcileFinalGardenState,
  verifySourceText,
  checkReplacementCompatibility,
} from "../src/lib/final-garden-state.ts";
import { runCriticLoop } from "../src/lib/critic-loop.ts";

const REAL_GARDEN = fileURLToPath(new URL("../../quartz/content/test-2", import.meta.url));
const AVAILABLE = fs.existsSync(path.join(REAL_GARDEN, ".breadboard", "learning-unit-contract.json"));
const skip = AVAILABLE ? false : "real generated garden quartz/content/test-2 is not present";
const SRC = "2510-27379v1";

let BASELINE = null;
before(() => {
  if (!AVAILABLE) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-ver-base-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(REAL_GARDEN, dir, { recursive: true });
  reconcileFinalGardenState(dir, "test-2");
  BASELINE = dir;
});
function freshCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-ver-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(BASELINE, dir, { recursive: true });
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf-8");
const write = (dir, rel, s) => fs.writeFileSync(path.join(dir, ...rel.split("/")), s, "utf-8");
const readLedger = (dir) => JSON.parse(read(dir, ".breadboard/source-anchors.json"));
const readContract = (dir) => JSON.parse(read(dir, ".breadboard/learning-unit-contract.json"));
const contractUnits = (j) => j.learningUnits ?? j.units;
const anchorIds = (dir) => readLedger(dir).sourceStructuralAnchors.map((a) => a.id);
const decisions = (dir) => JSON.parse(read(dir, ".breadboard/anchor-critic-decisions.json"));

function firstSection1Page(dir) {
  const secDir = fs.readdirSync(path.join(dir, "learning"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^1\./.test(e.name)).map((e) => e.name).sort()[0];
  const rel = fs.readdirSync(path.join(dir, "learning", secDir)).find((f) => f.endsWith(".md") && f !== "_index.md");
  const pageRel = `learning/${secDir}/${rel}`;
  const unitId = (read(dir, pageRel).match(/^learningUnitId:\s*"?([^"\n]+)"?/m) ?? [])[1];
  return { pageRel, unitId };
}
function pageAnchors(dir, pageRel) {
  return (read(dir, pageRel).match(/^sourceAnchors:\s*\[([^\]]*)\]/m)?.[1] ?? "")
    .split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}
function injectLowConfidenceAnchor(dir, anchorId = "S1.P1.energy-widget") {
  const { pageRel, unitId } = firstSection1Page(dir);
  let t = read(dir, pageRel);
  const cur = (t.match(/^sourceAnchors:\s*\[([^\]]*)\]/m) ?? [, ""])[1];
  t = t.replace(/^sourceAnchors:\s*\[[^\]]*\]/m, `sourceAnchors: [${cur.trim() ? cur.trim() + ", " : ""}"${anchorId}"]`);
  write(dir, pageRel, t);
  const j = readContract(dir);
  const u = contractUnits(j).find((x) => x.id === unitId);
  u.sourceAnchors = [...new Set([...(u.sourceAnchors ?? []), anchorId])];
  write(dir, ".breadboard/learning-unit-contract.json", JSON.stringify(j, null, 2) + "\n");
  reconcileFinalGardenState(dir, "test-2");
  return { pageRel, unitId, anchorId };
}
function registerStrongAnchor(dir, rec) {
  const l = readLedger(dir);
  l.sourceStructuralAnchors.push({
    kind: "text_concept", sourceId: SRC, confidence: "high",
    evidence: { keywordHits: rec.conceptKeywords, missingKeywords: [], titleOverlapScore: 1, keywordCoverageScore: 1, pageMatchScore: 1, contextSpecificityScore: 1, negativeEvidencePenalty: 0, totalScore: 0.95, decision: "register" },
    ...rec,
  });
  write(dir, ".breadboard/source-anchors.json", JSON.stringify(l, null, 2) + "\n");
}
// A strong, source-grounded "energy" replacement anchor. Registered explicitly by
// the test so the fixture does not depend on any particular generated garden
// still happening to contain an `energy-bottleneck` anchor.
function registerEnergyBottleneck(dir) {
  registerStrongAnchor(dir, {
    id: "S1.P1.energy-bottleneck", title: "Energy cost bottleneck", page: 1,
    conceptKeywords: ["energy", "bottleneck"],
    exactText: "high power consumption-a critical bottleneck in scenarios such as mobile and edge computing",
    semanticSummary: "Conventional networks are energy-bottlenecked by dense per-inference computation.",
  });
}
const noCritic = () => [];

describe("source-text verification (pure)", { skip }, () => {
  test("exact / normalized / not-found matching", () => {
    const dir = freshCopy();
    const exact = verifySourceText(dir, "high power consumption-a critical bottleneck", { sourceId: SRC, page: 1 });
    assert.equal(exact.ok, true);
    assert.equal(exact.matchType, "exact");

    // Same sentence with an em-dash + collapsed spacing → normalized_exact.
    const norm = verifySourceText(dir, "high power  consumption—a   critical bottleneck", { sourceId: SRC, page: 1 });
    assert.equal(norm.ok, true);
    assert.equal(norm.matchType, "normalized_exact");

    const missing = verifySourceText(dir, "This exact sentence is not present anywhere in the source document.", { sourceId: SRC, page: 1 });
    assert.equal(missing.ok, false);
    assert.equal(missing.matchType, "not_found");
  });

  test("compatibility: same family ok, different family incompatible", () => {
    const dir = freshCopy();
    injectLowConfidenceAnchor(dir, "S1.P1.energy-widget");
    registerStrongAnchor(dir, { id: "S1.P1.surrogate-strong", title: "Surrogate gradient training", page: 1, conceptKeywords: ["surrogate", "gradient"] });
    registerEnergyBottleneck(dir);
    const state = buildFinalGardenState(dir, "test-2");
    assert.equal(checkReplacementCompatibility(state, "S1.P1.energy-widget", "S1.P1.energy-bottleneck").ok, true);
    const bad = checkReplacementCompatibility(state, "S1.P1.energy-widget", "S1.P1.surrogate-strong");
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /family mismatch/);
    assert.equal(checkReplacementCompatibility(state, "S1.P1.energy-widget", "S1.P9.does-not-exist").ok, false);
  });
});

describe("verified anchor decisions in the critic loop", { skip }, () => {
  test("1. confirm with invented text → not applied, anchor stays blocking", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (p) => ({ anchorId: p.anchor.id, decision: "confirm", confidence: "medium", confirmedExactText: "This sentence does not exist in the source.", reason: "invented" });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 2 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.applied, false);
    assert.match(d.invalidReason, /not found in source/);
    assert.equal(d.verification.matchType, "not_found");
    assert.equal(readLedger(dir).sourceStructuralAnchors.find((a) => a.id === anchorId).criticConfirmed, undefined);
    assert.equal(res.status.publishReady, false);
    assert.ok(res.finalBlockingIssues.some((i) => (i.sourceAnchorIds ?? []).includes(anchorId)));
  });

  test("2. confirm with normalized-exact text → applied, matchType normalized_exact", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (p) => ({ anchorId: p.anchor.id, decision: "confirm", confidence: "medium", confirmedExactText: "high power  consumption—a   critical bottleneck", reason: "supported on page 1" });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 3 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.applied, true);
    assert.equal(d.verification.matchType, "normalized_exact");
    assert.equal(readLedger(dir).sourceStructuralAnchors.find((a) => a.id === anchorId).criticConfirmed, true);
    assert.equal(res.status.publishReady, true);
  });

  test("3. create_better with invented text → not registered, weak anchor blocking", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (p) => ({
      anchorId: p.anchor.id, decision: "create_better_anchor", confidence: "high", reason: "invented",
      betterAnchor: { id: "S1.P1.invented", kind: "text", sourceId: SRC, page: 1, title: "Invented", exactText: "A fabricated sentence that never appears in the source text.", semanticSummary: "x", conceptKeywords: ["energy", "bottleneck"] },
    });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 2 } });
    assert.ok(!anchorIds(dir).includes("S1.P1.invented"), "invented anchor not registered");
    assert.equal(decisions(dir).find((x) => x.anchorId === anchorId).applied, false);
    assert.ok(res.finalBlockingIssues.some((i) => (i.sourceAnchorIds ?? []).includes(anchorId)));
    assert.equal(res.status.publishReady, false);
  });

  test("4. create_better with verified text but low score stays blocking + follow-up", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (p) => ({
      anchorId: p.anchor.id, decision: "create_better_anchor", confidence: "high", reason: "real text, wrong concept",
      betterAnchor: { id: "S1.P1.gizmo", kind: "text", sourceId: SRC, page: 1, title: "Gizmo widget", exactText: "Spiking Neural Networks (SNNs) represent the latest generation of neural computation", semanticSummary: "x", conceptKeywords: ["gizmo", "widget"] },
    });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 2 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.verification.ok, true, "exact text found");
    assert.equal(d.applied, false);
    assert.equal(d.followUpIssue, true);
    assert.ok(!anchorIds(dir).includes("S1.P1.gizmo"), "low-score anchor not registered as accepted");
    assert.equal(res.status.publishReady, false);
  });

  test("5. create_better with verified text and high score passes", async () => {
    const dir = freshCopy();
    const { pageRel, anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (p) => ({
      anchorId: p.anchor.id, decision: "create_better_anchor", confidence: "high", reason: "stronger passage",
      betterAnchor: { id: "S1.P1.energy-cost", kind: "text", sourceId: SRC, page: 1, title: "Energy cost bottleneck", exactText: "high power consumption-a critical bottleneck in scenarios such as mobile and edge computing", semanticSummary: "energy bottleneck of dense computation", conceptKeywords: ["energy", "bottleneck"] },
    });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 3 } });
    const rec = readLedger(dir).sourceStructuralAnchors.find((a) => a.id === "S1.P1.energy-cost");
    assert.ok(rec, "better anchor registered");
    assert.ok(["medium", "high"].includes(rec.confidence));
    assert.ok(rec.evidence && typeof rec.evidence.totalScore === "number");
    assert.ok(pageAnchors(dir, pageRel).includes("S1.P1.energy-cost"));
    assert.ok(!pageAnchors(dir, pageRel).includes(anchorId));
    assert.equal(auditFinalGardenState(buildFinalGardenState(dir, "test-2")).ok, true);
    assert.equal(res.status.publishReady, true);
  });

  test("6. replace with incompatible (different-family) anchor → invalid, stays blocking", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    registerStrongAnchor(dir, { id: "S1.P1.surrogate-strong", title: "Surrogate gradient training", page: 1, conceptKeywords: ["surrogate", "gradient"] });
    const anchorConfirm = (p) => ({ anchorId: p.anchor.id, decision: "replace", confidence: "high", replacementAnchorId: "S1.P1.surrogate-strong", reason: "unrelated" });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 2 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.applied, false);
    assert.equal(d.semanticCompatibility.ok, false);
    assert.match(d.invalidReason, /incompatible/);
    assert.ok(res.finalBlockingIssues.some((i) => (i.sourceAnchorIds ?? []).includes(anchorId)));
    assert.equal(res.status.publishReady, false);
  });

  test("7. replace with compatible (same-family) anchor passes", async () => {
    const dir = freshCopy();
    const { pageRel, anchorId } = injectLowConfidenceAnchor(dir);
    registerEnergyBottleneck(dir);
    const anchorConfirm = (p) => ({ anchorId: p.anchor.id, decision: "replace", confidence: "high", replacementAnchorId: "S1.P1.energy-bottleneck", reason: "same energy concept" });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 3 } });
    assert.ok(pageAnchors(dir, pageRel).includes("S1.P1.energy-bottleneck"));
    assert.ok(!pageAnchors(dir, pageRel).includes(anchorId));
    assert.equal(readLedger(dir).sourceStructuralAnchors.filter((a) => a.id === anchorId).length, 0);
    assert.equal(decisions(dir).find((x) => x.replacementAnchorId === "S1.P1.energy-bottleneck").semanticCompatibility.ok, true);
    assert.equal(auditFinalGardenState(buildFinalGardenState(dir, "test-2")).ok, true);
    assert.equal(res.status.publishReady, true);
  });

  test("8. reject creates a repair request; publishReady false until repaired", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (p) => ({ anchorId: p.anchor.id, decision: "reject", confidence: "low", reason: "unsupported", requiredRepairs: [{ targetKind: "unit_page", instructions: ["Reground this page."] }] });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 2 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.ok(Array.isArray(d.rejectedRepairRequests) && d.rejectedRepairRequests.length > 0, "rejected repair request created");
    assert.ok(d.rejectedRepairRequests.some((r) => r.targetKind === "unit_page" && r.rejectedAnchorId === anchorId));
    assert.equal(res.status.publishReady, false);
    assert.equal(res.status.draftGenerated, true);
  });

  test("9. invalid decision appears in critic-loop.json and source-anchor-evidence.md", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (p) => ({ anchorId: p.anchor.id, decision: "confirm", confidence: "medium", confirmedExactText: "Totally invented text that is not in the source at all.", reason: "hallucinated" });
    await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 2 } });
    const loop = JSON.parse(read(dir, ".breadboard/critic-loop.json"));
    const decided = loop.rounds.flatMap((r) => r.anchorDecisions ?? []);
    const d = decided.find((x) => x.anchorId === anchorId);
    assert.equal(d.applied, false);
    assert.ok(d.invalidReason);
    assert.equal(d.verification.matchType, "not_found");
    const evidenceMd = read(dir, ".breadboard/source-anchor-evidence.md");
    assert.match(evidenceMd, /## Anchor Decision Verification/);
    assert.match(evidenceMd, new RegExp(`${anchorId.replace(/\./g, "\\.")}.*confirm.*no.*not_found`));
  });
});
