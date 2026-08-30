// Problem 1: a STATIC embedded+explained source figure is a valid visual
// representation. A critic "missing visual" issue for such a figure must verify
// as unsupported and must not create a duplicate interactive visual.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFinalGardenState, verifySourceVisualRepresentation } from "../src/lib/final-garden-state.ts";
import { verifyCriticIssueAgainstFinalState, buildCriticReviewPacket, runCriticLoop } from "../src/lib/critic-loop.ts";

const ANCHOR = "S1.P4.F1";
const ASSET = "assets/source-visuals/2510-27379v1-page-4-diagram-f1-architecture.png";

function buildGarden({
  embed = true,
  asset = true,
  ledger = true,
  visualJson = false,
  prose = true,
  assetPath = ASSET,
  embedUrl = `/test-2/${assetPath}`,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-vis-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".breadboard", "visuals"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Why SNNs Need Events"), { recursive: true });
  if (asset) { fs.mkdirSync(path.join(dir, "assets", "source-visuals"), { recursive: true }); fs.writeFileSync(path.join(dir, ...assetPath.split("/")), "PNGDATA"); }
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: [], sourceStructuralAnchors: [] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), JSON.stringify(ledger ? [{ sourceVisualId: ANCHOR, type: "figure", caption: "Conceptual architecture of a spiking neural network", pageNumber: 4, sourceId: "2510-27379v1", conceptUsage: "embedded_and_explained", cropStatus: "embedded", assignedPageId: "learning/1. Why SNNs Need Events/1.4 Input Encoding and SNN Layers", croppedImagePath: embedUrl, usageStatus: "assigned" }] : [], null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "Input encoding", sourceAnchors: [], sourceFigures: [{ id: ANCHOR, placement: "inside_concept_explanation" }], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
  const visualIds = visualJson ? ["arch-visual-1"] : [];
  if (visualJson) fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "arch-visual-1.json"), JSON.stringify({ id: "arch-visual-1", type: "neural_coding", sourceAnchors: [{ figureId: ANCHOR }] }, null, 2) + "\n");
  const body = [
    prose ? "The conceptual architecture below shows how input encoding feeds excitatory and inhibitory layers in a spiking neural network, and why event-driven timing matters for the downstream layers." : "# heading only",
    embed ? `![Conceptual architecture of spiking neural network with input encoding](${embedUrl})` : "",
    visualJson ? "```breadboard-visual\n{\"id\":\"arch-visual-1\",\"type\":\"neural_coding\",\"sourceAnchors\":[{\"figureId\":\"S1.P4.F1\"}]}\n```" : "",
  ].filter(Boolean).join("\n\n");
  fs.writeFileSync(path.join(dir, "learning", "1. Why SNNs Need Events", "1.4 Input Encoding and SNN Layers.md"), `---
title: "Input Encoding and SNN Layers"
knowledge_type: "learning-page"
breadboardType: "learning_page"
generated_by: "learn_button"
learningUnitId: "U1"
sourceAnchors: ["${ANCHOR}"]
sourceFormulaAnchors: []
sourceVisualIds: ["${ANCHOR}"]
visualIds: [${visualIds.map((v) => `"${v}"`).join(", ")}]
tags: []
---

${body}
`);
  return dir;
}

const missingVisualIssue = () => ({ id: "c-arch-1", severity: "blocking", type: "visual_grounding_mismatch", pagePath: "learning/1. Why SNNs Need Events/1.4 Input Encoding and SNN Layers.md", sourceAnchorIds: [ANCHOR], problem: `The central architecture figure ${ANCHOR} is not represented / not visualized as an interactive visual.`, evidence: "no visual JSON", expected: "an interactive visual", repairTarget: "unit_page", suggestedRepair: "add an interactive visual" });

describe("static source-visual representation (Fix 1)", () => {
  test("1. embedded + explained source figure is represented (static modes)", () => {
    const dir = buildGarden();
    const rep = verifySourceVisualRepresentation(ANCHOR, buildFinalGardenState(dir, "test-2"));
    assert.equal(rep.represented, true);
    assert.ok(rep.representationModes.includes("markdown_source_embed"));
    assert.ok(rep.representationModes.includes("source_visual_ledger"));
  });

  test("recovered anchor-slug crop filenames are recognized as the canonical source figure", () => {
    const dir = buildGarden({
      assetPath: "assets/source-visuals/s1-p4-f1-recovered-0123456789abcdef.png",
    });
    const rep = verifySourceVisualRepresentation(ANCHOR, buildFinalGardenState(dir, "test-2"));
    assert.equal(rep.represented, true);
    assert.ok(rep.representationModes.includes("markdown_source_embed"));
    assert.ok(rep.representationModes.includes("source_visual_ledger"));
  });

  test("3. sourceVisualIds without an embedded asset is NOT represented", () => {
    const dir = buildGarden({ embed: false });
    assert.equal(verifySourceVisualRepresentation(ANCHOR, buildFinalGardenState(dir, "test-2")).represented, false);
  });

  test("4. a broken asset path is NOT represented", () => {
    const dir = buildGarden({ asset: false }); // embed present, file missing
    const rep = verifySourceVisualRepresentation(ANCHOR, buildFinalGardenState(dir, "test-2"));
    assert.equal(rep.represented, false);
    assert.ok(!rep.representationModes.includes("markdown_source_embed"));
  });

  test("5. an interactive visual satisfies representation", () => {
    const dir = buildGarden({ embed: false, ledger: false, visualJson: true });
    const rep = verifySourceVisualRepresentation(ANCHOR, buildFinalGardenState(dir, "test-2"));
    assert.equal(rep.represented, true);
    assert.ok(rep.representationModes.includes("interactive_visual"));
  });

  test("packet exposes source-visual summaries with representation status (Fix 3)", () => {
    const dir = buildGarden();
    const packet = buildCriticReviewPacket(buildFinalGardenState(dir, "test-2"));
    const summary = packet.sourceVisualSummaries.find((s) => s.anchorId === ANCHOR);
    assert.ok(summary && summary.represented);
    assert.ok(summary.markdownEmbeds.length > 0);
    assert.equal(summary.ledgerUsage.conceptUsage, "embedded_and_explained");
    assert.match(packet.evidenceNote ?? "", /represented/i);
  });
});

describe("critic missing-visual issue verification (Fix 2)", () => {
  test("2. missing-visual issue for an embedded figure verifies as unsupported", () => {
    const dir = buildGarden();
    const v = verifyCriticIssueAgainstFinalState(missingVisualIssue(), buildFinalGardenState(dir, "test-2"));
    assert.equal(v.severity, "unsupported");
    assert.equal(v.verified, false);
    assert.match(v.reason, /embedded and explained/i);
  });

  test("6. embedded figure: critic issue does not block and no duplicate interactive visual is created", async () => {
    const dir = buildGarden();
    let repairCalls = 0;
    const res = await runCriticLoop({
      gardenDir: dir, gardenSlug: "test-2",
      critic: () => [missingVisualIssue()],
      options: { maxRounds: 2, strictPublish: true },
      repair: (d, s, requests) => { repairCalls += requests.length; return { attempted: requests.length, resolved: 0 }; },
    });
    assert.ok(!res.finalBlockingIssues.some((i) => i.id === "c-arch-1"), "embedded-figure issue is not blocking");
    assert.equal(repairCalls, 0, "no repair request → no duplicate interactive visual created");
    assert.equal(fs.readdirSync(path.join(dir, ".breadboard", "visuals")).length, 0, "no new visual JSON created");
    assert.ok(res.rounds.some((r) => (r.unsupportedIssues ?? 0) >= 1));
  });

  test("a genuinely missing figure verifies as confirmed_blocking", () => {
    const dir = buildGarden({ embed: false, ledger: false });
    const v = verifyCriticIssueAgainstFinalState(missingVisualIssue(), buildFinalGardenState(dir, "test-2"));
    assert.equal(v.severity, "confirmed_blocking");
  });
});
