// Tests for source-text RELEVANCE verification: a ChatMock confirm/create/replace
// decision must quote text that both EXISTS in the source and actually SUPPORTS
// the anchor's meaning (title/summary/keywords/concept family). Real-but-
// irrelevant quotes stay blocking.

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
  verifySourceTextRelevance,
  isRelevanceAcceptableForKind,
  detectConceptFamily,
} from "../src/lib/final-garden-state.ts";
import { runCriticLoop } from "../src/lib/critic-loop.ts";

const REAL_GARDEN = fileURLToPath(new URL("../../quartz/content/test-2", import.meta.url));
const AVAILABLE = fs.existsSync(path.join(REAL_GARDEN, ".breadboard", "learning-unit-contract.json"));
const LIVE_GARDEN_ENABLED = /^(1|true|yes)$/i.test((process.env.BREADBOARD_TEST_LIVE_GARDEN ?? "").trim());
const skip = !LIVE_GARDEN_ENABLED
  ? "opt-in live-garden integration test; set BREADBOARD_TEST_LIVE_GARDEN=1 to run"
  : (AVAILABLE ? false : "real generated garden quartz/content/test-2 is not present");
const SRC = "2510-27379v1";

// Real page-1 source excerpts.
const Q_ENERGY = "classic networks carry out millions of operations per inference step, resulting in high power consumption-a critical bottleneck in scenarios such as mobile and edge computing";
const Q_ACCURACY = "Results show that surrogate gradient-trained SNNs closely approximate ANN accuracy";
const Q_STDP = "Spike-Timing Dependent Plasticity (STDP)-are examined in depth";
const Q_BRAIN = "brain-inspired alternative to conventional Artificial Neural Networks";

let BASELINE = null;
before(() => {
  if (!AVAILABLE) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-rel-base-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(REAL_GARDEN, dir, { recursive: true });
  reconcileFinalGardenState(dir, "test-2");
  BASELINE = dir;
});
function freshCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-rel-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(BASELINE, dir, { recursive: true });
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf-8");
const write = (dir, rel, s) => fs.writeFileSync(path.join(dir, ...rel.split("/")), s, "utf-8");
const readLedger = (dir) => JSON.parse(read(dir, ".breadboard/source-anchors.json"));
const writeLedger = (dir, l) => write(dir, ".breadboard/source-anchors.json", JSON.stringify(l, null, 2) + "\n");
const readContract = (dir) => JSON.parse(read(dir, ".breadboard/learning-unit-contract.json"));
const contractUnits = (j) => j.learningUnits ?? j.units;
const decisions = (dir) => JSON.parse(read(dir, ".breadboard/anchor-critic-decisions.json"));
const anchorIds = (dir) => readLedger(dir).sourceStructuralAnchors.map((a) => a.id);

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
/** Register a low-confidence anchor with chosen keywords and reference it. */
function injectWeakAnchor(dir, { id, title, conceptKeywords, page = 1, kind = "text_concept" }) {
  const { pageRel, unitId } = firstSection1Page(dir);
  const l = readLedger(dir);
  l.sourceStructuralAnchors.push({
    id, kind, title, page, sourceId: SRC, semanticSummary: `${title}`,
    conceptKeywords, confidence: "low",
    evidence: { keywordHits: [conceptKeywords[0]], missingKeywords: conceptKeywords.slice(1), titleOverlapScore: 0.5, keywordCoverageScore: 0.3, pageMatchScore: 1, contextSpecificityScore: 0.3, negativeEvidencePenalty: 0, totalScore: 0.4, decision: "needs_critic_review" },
  });
  writeLedger(dir, l);
  let t = read(dir, pageRel);
  const cur = (t.match(/^sourceAnchors:\s*\[([^\]]*)\]/m) ?? [, ""])[1];
  t = t.replace(/^sourceAnchors:\s*\[[^\]]*\]/m, `sourceAnchors: [${cur.trim() ? cur.trim() + ", " : ""}"${id}"]`);
  write(dir, pageRel, t);
  const j = readContract(dir);
  const u = contractUnits(j).find((x) => x.id === unitId);
  u.sourceAnchors = [...new Set([...(u.sourceAnchors ?? []), id])];
  write(dir, ".breadboard/learning-unit-contract.json", JSON.stringify(j, null, 2) + "\n");
  return { pageRel, unitId, anchorId: id };
}
function registerStrong(dir, rec) {
  const l = readLedger(dir);
  l.sourceStructuralAnchors.push({ kind: "text_concept", sourceId: SRC, confidence: "high",
    evidence: { keywordHits: rec.conceptKeywords, missingKeywords: [], titleOverlapScore: 1, keywordCoverageScore: 1, pageMatchScore: 1, contextSpecificityScore: 1, negativeEvidencePenalty: 0, totalScore: 0.95, decision: "register" }, ...rec });
  writeLedger(dir, l);
}
const noCritic = () => [];
const confirm = (text) => (p) => ({ anchorId: p.anchor.id, decision: "confirm", confidence: "high", confirmedExactText: text, reason: "cited" });

describe("relevance verification (pure)", { skip }, () => {
  test("family detection + relevance verdicts match the task scenarios", () => {
    const energy = { id: "S1.P1.energy-bottleneck", title: "Energy bottleneck", kind: "text_concept", conceptKeywords: ["energy", "bottleneck"], semanticSummary: "energy bottleneck" };
    assert.equal(verifySourceTextRelevance(energy, Q_ACCURACY).decision, "irrelevant");
    assert.equal(verifySourceTextRelevance(energy, Q_ENERGY).decision, "relevant");
    const stdp = { id: "S1.P9.spike-timing-dependent-plasticity", title: "Spike timing dependent plasticity", kind: "method", conceptKeywords: ["spike", "timing", "dependent", "plasticity"], semanticSummary: "STDP" };
    assert.equal(verifySourceTextRelevance(stdp, Q_BRAIN).decision, "irrelevant");
    assert.equal(verifySourceTextRelevance(stdp, Q_STDP).decision, "relevant");
    const sg = { id: "S1.P6.surrogate-gradient", title: "Surrogate gradient", kind: "method", conceptKeywords: ["surrogate", "gradient"], semanticSummary: "surrogate gradient" };
    const sgVsEnergy = verifySourceTextRelevance(sg, "SNNs are more energy-efficient with lower power consumption");
    assert.equal(sgVsEnergy.decision, "irrelevant");
    assert.ok(sgVsEnergy.wrongFamilyPenalty > 0);
    assert.equal(detectConceptFamily(Q_STDP).family, "stdp");
  });

  test("3. weak_relevance allowed only for broad abstract with high confidence", () => {
    const weak = verifySourceTextRelevance({ id: "S1.P1.x", title: "Energy throughput", kind: "abstract", conceptKeywords: ["energy", "throughput"], semanticSummary: "energy throughput" }, "the measured throughput of the pipeline was recorded here");
    assert.equal(weak.decision, "weak_relevance");
    assert.equal(isRelevanceAcceptableForKind(weak, "abstract", "high"), true);
    assert.equal(isRelevanceAcceptableForKind(weak, "method", "high"), false);
    assert.equal(isRelevanceAcceptableForKind(weak, "abstract", "medium"), false);
  });
});

describe("relevance-gated anchor decisions in the loop", { skip }, () => {
  test("1. real but irrelevant confirm (energy anchor + accuracy quote) fails", async () => {
    const dir = freshCopy();
    const { anchorId } = injectWeakAnchor(dir, { id: "S1.P1.energy-widget", title: "Energy bottleneck", conceptKeywords: ["energy", "bottleneck"] });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm: confirm(Q_ACCURACY), options: { maxRounds: 2 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.verification.ok, true, "presence ok");
    assert.equal(d.relevance.decision, "irrelevant");
    assert.equal(d.applied, false);
    assert.match(d.invalidReason, /does not support anchor/);
    assert.equal(readLedger(dir).sourceStructuralAnchors.find((a) => a.id === anchorId).criticConfirmed, undefined);
    assert.equal(res.status.publishReady, false);
  });

  test("2. real and relevant confirm (energy anchor + energy quote) passes", async () => {
    const dir = freshCopy();
    const { anchorId } = injectWeakAnchor(dir, { id: "S1.P1.energy-widget", title: "Energy bottleneck", conceptKeywords: ["energy", "bottleneck"] });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm: confirm(Q_ENERGY), options: { maxRounds: 3 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.verification.ok, true);
    assert.equal(d.relevance.decision, "relevant");
    assert.equal(d.applied, true);
    assert.equal(readLedger(dir).sourceStructuralAnchors.find((a) => a.id === anchorId).criticConfirmed, true);
    assert.equal(res.status.publishReady, true);
  });

  test("4. STDP confirm with generic brain-inspired quote fails", async () => {
    const dir = freshCopy();
    const { anchorId } = injectWeakAnchor(dir, { id: "S1.P1.stdp-note", title: "Spike timing dependent plasticity", conceptKeywords: ["spike", "timing", "dependent", "plasticity"] });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm: confirm(Q_BRAIN), options: { maxRounds: 2 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.verification.ok, true, "presence ok");
    assert.ok(["irrelevant", "weak_relevance"].includes(d.relevance.decision));
    assert.equal(d.applied, false);
    assert.equal(res.status.publishReady, false);
  });

  test("5. STDP confirm with exact STDP paragraph passes", async () => {
    const dir = freshCopy();
    const { anchorId } = injectWeakAnchor(dir, { id: "S1.P1.stdp-note", title: "Spike timing dependent plasticity", conceptKeywords: ["spike", "timing", "dependent", "plasticity"] });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm: confirm(Q_STDP), options: { maxRounds: 3 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.verification.ok, true);
    assert.equal(d.relevance.decision, "relevant");
    assert.equal(d.applied, true);
    assert.equal(res.status.publishReady, true);
  });

  test("6. surrogate-gradient confirm with energy-efficiency quote fails (wrong family)", async () => {
    const dir = freshCopy();
    const { anchorId } = injectWeakAnchor(dir, { id: "S1.P1.surrogate-note", title: "Surrogate gradient", conceptKeywords: ["surrogate", "gradient"] });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm: confirm(Q_ENERGY), options: { maxRounds: 2 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.relevance.decision, "irrelevant");
    assert.ok(d.relevance.wrongFamilyPenalty > 0);
    assert.equal(d.applied, false);
    assert.equal(res.status.publishReady, false);
  });

  test("7. create_better with real but irrelevant text → not registered, follow-up", async () => {
    const dir = freshCopy();
    const { anchorId } = injectWeakAnchor(dir, { id: "S1.P1.energy-widget", title: "Energy bottleneck", conceptKeywords: ["energy", "bottleneck"] });
    const anchorConfirm = (p) => ({
      anchorId: p.anchor.id, decision: "create_better_anchor", confidence: "high", reason: "real but off-topic",
      betterAnchor: { id: "S1.P1.energy-better", kind: "text", sourceId: SRC, page: 1, title: "Energy bottleneck", exactText: Q_ACCURACY, semanticSummary: "energy bottleneck", conceptKeywords: ["energy", "bottleneck"] },
    });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 2 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.verification.ok, true, "text present");
    assert.equal(d.relevance.decision, "irrelevant");
    assert.equal(d.followUpIssue, true);
    assert.ok(!anchorIds(dir).includes("S1.P1.energy-better"), "irrelevant better anchor not registered");
    assert.equal(res.status.publishReady, false);
  });

  test("8. create_better with real relevant text → registered, evidence + relevance stored", async () => {
    const dir = freshCopy();
    const { pageRel, anchorId } = injectWeakAnchor(dir, { id: "S1.P1.energy-widget", title: "Energy bottleneck", conceptKeywords: ["energy", "bottleneck"] });
    const anchorConfirm = (p) => ({
      anchorId: p.anchor.id, decision: "create_better_anchor", confidence: "high", reason: "stronger passage",
      betterAnchor: { id: "S1.P1.energy-cost", kind: "text", sourceId: SRC, page: 1, title: "Energy cost bottleneck", exactText: Q_ENERGY, semanticSummary: "energy bottleneck of dense computation", conceptKeywords: ["energy", "bottleneck"] },
    });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 3 } });
    const rec = readLedger(dir).sourceStructuralAnchors.find((a) => a.id === "S1.P1.energy-cost");
    assert.ok(rec, "better anchor registered");
    assert.ok(rec.evidence && typeof rec.evidence.totalScore === "number");
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.relevance.decision, "relevant");
    assert.ok(pageAnchors(dir, pageRel).includes("S1.P1.energy-cost"));
    assert.equal(auditFinalGardenState(buildFinalGardenState(dir, "test-2")).ok, true);
    assert.equal(res.status.publishReady, true);
  });

  test("9. replace with canonical but irrelevant anchor fails (Fix 4)", async () => {
    const dir = freshCopy();
    const { anchorId } = injectWeakAnchor(dir, { id: "S1.P1.energy-widget", title: "Energy bottleneck", conceptKeywords: ["energy", "bottleneck"] });
    // Canonical, energy-family metadata (passes compatibility) but its own source
    // text is about accuracy (fails relevance).
    registerStrong(dir, { id: "S1.P1.mixed", title: "Energy note", page: 1, conceptKeywords: ["energy"], semanticSummary: "note", exactText: Q_ACCURACY });
    const anchorConfirm = (p) => ({ anchorId: p.anchor.id, decision: "replace", confidence: "high", replacementAnchorId: "S1.P1.mixed", reason: "reuse" });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 2 } });
    const d = decisions(dir).find((x) => x.anchorId === anchorId);
    assert.equal(d.applied, false);
    assert.ok((d.semanticCompatibility && !d.semanticCompatibility.ok) || (d.relevance && !d.relevance.ok), "compat or relevance failed");
    assert.equal(res.status.publishReady, false);
  });

  test("10. relevance appears in critic-loop.json and source-anchor-evidence.md", async () => {
    const dir = freshCopy();
    const { anchorId } = injectWeakAnchor(dir, { id: "S1.P1.energy-widget", title: "Energy bottleneck", conceptKeywords: ["energy", "bottleneck"] });
    await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm: confirm(Q_ACCURACY), options: { maxRounds: 2 } });
    const loop = JSON.parse(read(dir, ".breadboard/critic-loop.json"));
    const d = loop.rounds.flatMap((r) => r.anchorDecisions ?? []).find((x) => x.anchorId === anchorId);
    assert.ok(d.relevance && d.relevance.decision === "irrelevant", "relevance decision in critic-loop.json");
    assert.ok(d.relevance.reason);
    const md = read(dir, ".breadboard/source-anchor-evidence.md");
    assert.match(md, /Relevance/);
    assert.match(md, new RegExp(`${anchorId.replace(/\./g, "\\.")}.*irrelevant`));
  });
});
