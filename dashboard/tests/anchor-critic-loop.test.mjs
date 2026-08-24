// Tests for wiring low-confidence source-anchor evidence into the ChatMock
// critic loop: weak anchors become blocking critic issues, and a fake anchor
// critic confirms / replaces / creates-better / rejects them, after which the
// state is rebuilt and publish-readiness reflects the resolution.

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
  validateAnchorCriticDecision,
} from "../src/lib/final-garden-state.ts";
import { runCriticLoop, parseAnchorCriticDecision } from "../src/lib/critic-loop.ts";

const REAL_GARDEN = fileURLToPath(new URL("../../quartz/content/test-2", import.meta.url));
const AVAILABLE = fs.existsSync(path.join(REAL_GARDEN, ".breadboard", "learning-unit-contract.json"));
const LIVE_GARDEN_ENABLED = /^(1|true|yes)$/i.test((process.env.BREADBOARD_TEST_LIVE_GARDEN ?? "").trim());
const skip = !LIVE_GARDEN_ENABLED
  ? "opt-in live-garden integration test; set BREADBOARD_TEST_LIVE_GARDEN=1 to run"
  : (AVAILABLE ? false : "real generated garden quartz/content/test-2 is not present");

let BASELINE = null;
before(() => {
  if (!AVAILABLE) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-acl-base-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(REAL_GARDEN, dir, { recursive: true });
  reconcileFinalGardenState(dir, "test-2");
  BASELINE = dir;
});
function freshCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-acl-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(BASELINE, dir, { recursive: true });
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf-8");
const write = (dir, rel, s) => fs.writeFileSync(path.join(dir, ...rel.split("/")), s, "utf-8");
const readLedger = (dir) => JSON.parse(read(dir, ".breadboard/source-anchors.json"));
const readContract = (dir) => JSON.parse(read(dir, ".breadboard/learning-unit-contract.json"));
const contractUnits = (j) => j.learningUnits ?? j.units;

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

/** Reference a weakly-supported anchor id and reconcile so it registers `low`. */
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

// A strong, source-grounded "energy" replacement anchor, registered explicitly by
// the test so the fixture does not depend on a particular generated garden still
// happening to contain an `energy-bottleneck` anchor.
function registerEnergyBottleneck(dir) {
  const l = readLedger(dir);
  l.sourceStructuralAnchors.push({
    id: "S1.P1.energy-bottleneck", kind: "guidance", sourceId: "2510-27379v1", page: 1,
    title: "Energy cost bottleneck", confidence: "high",
    conceptKeywords: ["energy", "bottleneck"],
    exactText: "high power consumption-a critical bottleneck in scenarios such as mobile and edge computing",
    semanticSummary: "Conventional networks are energy-bottlenecked by dense per-inference computation.",
    evidence: { keywordHits: ["energy", "bottleneck"], missingKeywords: [], titleOverlapScore: 1, keywordCoverageScore: 1, pageMatchScore: 1, contextSpecificityScore: 1, negativeEvidencePenalty: 0, totalScore: 0.95, decision: "register" },
  });
  write(dir, ".breadboard/source-anchors.json", JSON.stringify(l, null, 2) + "\n");
}
const noCritic = () => [];

describe("anchor confirmation in the ChatMock critic loop", { skip }, () => {
  test("parse + validate the structured decision schema", () => {
    const d = parseAnchorCriticDecision('```json\n{"anchorId":"S1.P1.x","decision":"confirm","confidence":"medium","confirmedExactText":"abc"}\n```');
    assert.equal(d.decision, "confirm");
    assert.equal(validateAnchorCriticDecision(d).valid, true);
    assert.equal(validateAnchorCriticDecision({ anchorId: "x", decision: "confirm", confidence: "low", confirmedExactText: "a" }).valid, false);
    assert.equal(validateAnchorCriticDecision({ anchorId: "x", decision: "replace" }).valid, false);
    assert.equal(validateAnchorCriticDecision({ anchorId: "x", decision: "create_better_anchor", betterAnchor: { id: "y" } }).valid, false);
  });

  test("1. low-confidence anchor enters the critic loop as a blocking issue", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    assert.equal(auditFinalGardenState(buildFinalGardenState(dir, "test-2")).ok, false, "publishReady false before decision");

    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, options: { maxRounds: 1 } });
    const issue = res.finalBlockingIssues.find((i) => (i.sourceAnchorIds ?? []).includes(anchorId));
    assert.ok(issue, "anchor evidence critic issue created");
    assert.equal(issue.type, "source_anchor_mismatch");
    assert.ok(res.finalBlockingIssues.length > 0);
    assert.equal(res.status.publishReady, false);
  });

  test("2. ChatMock confirms the anchor → criticConfirmed, audit passes, publishReady true", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (packet) => ({
      anchorId: packet.anchor.id, decision: "confirm", confidence: "medium",
      confirmedExactText: "high power consumption—a critical bottleneck in scenarios such as mobile and edge computing",
      reason: "source page 1 supports the energy bottleneck concept",
    });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 3 } });
    const rec = readLedger(dir).sourceStructuralAnchors.find((a) => a.id === anchorId);
    assert.equal(rec.criticConfirmed, true);
    assert.ok(rec.criticConfirmedExactText);
    assert.equal(auditFinalGardenState(buildFinalGardenState(dir, "test-2")).ok, true, "audit passes after confirm");
    assert.equal(res.status.publishReady, true);
  });

  test("3. ChatMock replaces the anchor → page/contract updated, old anchor gone, audit passes", async () => {
    const dir = freshCopy();
    const { pageRel, unitId, anchorId } = injectLowConfidenceAnchor(dir);
    registerEnergyBottleneck(dir);
    const anchorConfirm = (packet) => ({
      anchorId: packet.anchor.id, decision: "replace", confidence: "high",
      replacementAnchorId: "S1.P1.energy-bottleneck", reason: "energy-bottleneck already covers this concept",
    });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 3 } });
    assert.ok(!pageAnchors(dir, pageRel).includes(anchorId), "weak anchor removed from page");
    assert.ok(pageAnchors(dir, pageRel).includes("S1.P1.energy-bottleneck"), "replacement used on page");
    assert.ok(contractUnits(readContract(dir)).find((u) => u.id === unitId).sourceAnchors.includes("S1.P1.energy-bottleneck"));
    assert.equal(readLedger(dir).sourceStructuralAnchors.filter((a) => a.id === anchorId).length, 0, "weak anchor unused/removed");
    assert.equal(auditFinalGardenState(buildFinalGardenState(dir, "test-2")).ok, true);
    assert.equal(res.status.publishReady, true);
  });

  test("4. ChatMock creates a better anchor → registered with evidence, references switched, audit passes", async () => {
    const dir = freshCopy();
    const { pageRel, anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (packet) => ({
      anchorId: packet.anchor.id, decision: "create_better_anchor", confidence: "high",
      reason: "a stronger passage supports this concept",
      betterAnchor: {
        id: "S1.P1.energy-cost", kind: "text", sourceId: "2510-27379v1", page: 1,
        title: "Energy cost bottleneck",
        exactText: "classic networks carry out millions of operations per inference step, resulting in high power consumption—a critical bottleneck",
        semanticSummary: "Conventional networks are energy-bottlenecked by dense per-inference computation.",
        conceptKeywords: ["energy", "bottleneck"],
      },
    });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 3 } });
    const rec = readLedger(dir).sourceStructuralAnchors.find((a) => a.id === "S1.P1.energy-cost");
    assert.ok(rec, "better anchor registered");
    assert.ok(rec.evidence && typeof rec.evidence.totalScore === "number", "evidence metadata written");
    assert.equal(rec.criticConfirmed, true);
    assert.ok(pageAnchors(dir, pageRel).includes("S1.P1.energy-cost"));
    assert.ok(!pageAnchors(dir, pageRel).includes(anchorId));
    assert.equal(auditFinalGardenState(buildFinalGardenState(dir, "test-2")).ok, true);
    assert.equal(res.status.publishReady, true);
  });

  test("5. ChatMock rejects the anchor → publishReady false, blocking remains, draft exists", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (packet) => ({
      anchorId: packet.anchor.id, decision: "reject", confidence: "low",
      reason: "no source passage supports this anchor",
      requiredRepairs: [{ targetKind: "unit_page", instructions: ["Reground this page on a supported source concept."] }],
    });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 2 } });
    assert.equal(res.status.publishReady, false);
    assert.equal(res.status.draftGenerated, true);
    assert.ok(res.finalBlockingIssues.some((i) => (i.sourceAnchorIds ?? []).includes(anchorId)), "unresolved blocking issue remains");
    assert.equal(readLedger(dir).sourceStructuralAnchors.find((a) => a.id === anchorId).criticConfirmed, undefined);
  });

  test("6. ChatMock failure + low-confidence anchor propagates exactly", async () => {
    const dir = freshCopy();
    injectLowConfidenceAnchor(dir);
    const providerError = new Error("connect ECONNREFUSED 127.0.0.1:8765");
    let calls = 0;
    await assert.rejects(
      () => runCriticLoop({
        gardenDir: dir,
        gardenSlug: "test-2",
        critic: () => { calls += 1; throw providerError; },
        options: { strictPublish: true, maxRounds: 3 },
      }),
      (actual) => actual === providerError,
    );
    assert.equal(calls, 1);
  });

  test("7. low-confidence anchor appears in critic + evidence reports", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, options: { maxRounds: 1 } });
    const criticIssues = JSON.parse(read(dir, ".breadboard/critic-issues.json"));
    assert.ok(criticIssues.blocking.some((i) => (i.sourceAnchorIds ?? []).includes(anchorId)), "critic-issues.json includes the anchor issue");
    assert.match(read(dir, ".breadboard/critic-report.md"), new RegExp(anchorId.replace(/\./g, "\\.")));
    assert.match(read(dir, ".breadboard/source-anchor-evidence.md"), /## Low-Confidence \/ Critic-Reviewed Anchors/);
    assert.match(read(dir, ".breadboard/source-anchor-evidence.md"), new RegExp(anchorId.replace(/\./g, "\\.")));
  });

  test("8. confirm without confirmedExactText is rejected; anchor stays blocking", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    const anchorConfirm = (packet) => ({ anchorId: packet.anchor.id, decision: "confirm", confidence: "medium", reason: "looks fine" }); // missing confirmedExactText
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 2 } });
    assert.equal(readLedger(dir).sourceStructuralAnchors.find((a) => a.id === anchorId).criticConfirmed, undefined, "invalid decision not applied");
    assert.equal(res.status.publishReady, false);
    assert.ok(res.finalBlockingIssues.some((i) => (i.sourceAnchorIds ?? []).includes(anchorId)));
    const decisions = JSON.parse(read(dir, ".breadboard/anchor-critic-decisions.json"));
    assert.ok(decisions.some((d) => d.anchorId === anchorId && d.applied === false && d.invalidReason));
  });

  test("round records anchor decisions in critic-loop.json", async () => {
    const dir = freshCopy();
    const { anchorId } = injectLowConfidenceAnchor(dir);
    registerEnergyBottleneck(dir);
    const anchorConfirm = (packet) => ({ anchorId: packet.anchor.id, decision: "replace", confidence: "high", replacementAnchorId: "S1.P1.energy-bottleneck", reason: "covered" });
    await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: noCritic, anchorConfirm, options: { maxRounds: 3 } });
    const loop = JSON.parse(read(dir, ".breadboard/critic-loop.json"));
    const decided = loop.rounds.flatMap((r) => r.anchorDecisions ?? []);
    assert.ok(decided.some((d) => d.anchorId === anchorId && d.decision === "replace" && d.replacementAnchorId === "S1.P1.energy-bottleneck"));
  });
});
