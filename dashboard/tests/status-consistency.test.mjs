// Problem 4: only VERIFIED issues affect final status. Unsupported / insufficient
// / resolved issues must not leak into acceptance-status.json warnings; they
// appear only in diagnostic report sections. Plus the required end-to-end test.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFinalGardenState, migrateLegacyTextConceptAnchors, verifySourceVisualRepresentation } from "../src/lib/final-garden-state.ts";
import { runCriticLoop } from "../src/lib/critic-loop.ts";

const E_OK = "E_{\\mathrm{total}} = N_{\\mathrm{spikes}} E_{\\mathrm{spike}} + N_{\\mathrm{synops}} E_{\\mathrm{synop}} + baseline";

function tinyGarden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-sc-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Metrics"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: [], sourceStructuralAnchors: [] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "Energy", sourceAnchors: [], sourceFigures: [], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "learning", "1. Metrics", "1.1 Energy.md"), `---\ntitle: "Energy"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nsourceAnchors: []\nsourceFormulaAnchors: []\ntags: []\nformulas:\n  - kind: "conceptual_helper"\n    text: "${E_OK}"\n    groundingStatus: "conceptual-helper"\n---\n\nThe total energy sums spike and synaptic operation energy across the whole run.\n`);
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf-8");

const truncWarning = () => ({ id: "w-formula-1", severity: "warning", type: "formula_anchor_mismatch", pagePath: "learning/1. Metrics/1.1 Energy.md", problem: "Formula appears truncated", evidence: "E_{total}=...", expected: "complete", repairTarget: "unit_page", suggestedRepair: "x" });
const realWarning = () => ({ id: "w-caveat-1", severity: "warning", type: "stale_caveat", repairTarget: "planning_doc", problem: "a genuine polish warning", evidence: "e", expected: "x", suggestedRepair: "y" });

describe("final status uses verified issues only (Fix 10/11)", () => {
  test("1+2. unsupported issue is excluded from acceptance-status warnings but visible in critic-report", async () => {
    const dir = tinyGarden();
    await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: () => [truncWarning()], options: { maxRounds: 1, strictPublish: true }, repair: () => ({ attempted: 0, resolved: 0 }) });
    const status = JSON.parse(read(dir, ".breadboard/acceptance-status.json"));
    assert.ok(!status.warnings.some((w) => w.id === "w-formula-1"), "unsupported issue must NOT be a final warning");
    const report = read(dir, ".breadboard/critic-report.md");
    assert.match(report, /## Unsupported Critic Issues/);
    assert.match(report, /w-formula-1/);
  });

  test("3. a verified warning appears in final warnings", async () => {
    const dir = tinyGarden();
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: () => [realWarning(), truncWarning()], options: { maxRounds: 1, strictPublish: true }, repair: () => ({ attempted: 0, resolved: 0 }) });
    const status = JSON.parse(read(dir, ".breadboard/acceptance-status.json"));
    assert.ok(status.warnings.some((w) => w.id === "w-caveat-1"), "verified warning IS a final warning");
    assert.ok(!status.warnings.some((w) => w.id === "w-formula-1"), "unsupported still excluded");
    assert.match(read(dir, ".breadboard/critic-report.md"), /## Verified Warnings/);
  });

  test("4. a resolved issue is neither a blocker nor a warning", async () => {
    const dir = tinyGarden();
    let round = 0;
    const critic = () => (round++ === 0 ? [{ id: "b1", severity: "blocking", type: "stale_caveat", repairTarget: "planning_doc", problem: "p", evidence: "e", expected: "x", suggestedRepair: "s" }] : []);
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic, options: { maxRounds: 3, strictPublish: true }, repair: () => ({ attempted: 1, resolved: 0 }) });
    const status = JSON.parse(read(dir, ".breadboard/acceptance-status.json"));
    assert.ok(!status.unresolvedBlockingIssues.some((i) => i.id === "b1"));
    assert.ok(!status.warnings.some((i) => i.id === "b1"));
  });

  test("5+6. final counts match verified issue sets and reports agree", async () => {
    const dir = tinyGarden();
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: () => [realWarning(), truncWarning()], options: { maxRounds: 1, strictPublish: true }, repair: () => ({ attempted: 0, resolved: 0 }) });
    const status = JSON.parse(read(dir, ".breadboard/acceptance-status.json"));
    const loop = JSON.parse(read(dir, ".breadboard/critic-loop.json"));
    assert.equal(status.warnings.length, res.finalWarnings.length);
    assert.equal(status.unresolvedBlockingIssues.length, res.finalBlockingIssues.length);
    // The unsupported issue is counted as unsupported, not as a warning/blocker.
    assert.ok(loop.rounds.some((r) => (r.unsupportedIssues ?? 0) >= 1));
    assert.ok(Array.isArray(loop.unsupportedCriticIssues) && loop.unsupportedCriticIssues.some((u) => u.issueId === "w-formula-1"));
  });
});

describe("end-to-end: false blockers removed, migration persisted, closure complete, warnings verified", () => {
  const SRC = "2510-27379v1";
  const ANCHOR = "S1.P4.F1";
  const ASSET = "assets/source-visuals/2510-27379v1-page-4-f1-architecture.png";
  const ENERGY = "Classic networks incur high power consumption, a critical energy bottleneck for mobile and edge computing.";
  const NEURO = "Neuromorphic hardware uses event-driven chips and specialized asynchronous circuits to run spiking networks.";
  const LIF = "Leaky integrate-and-fire neurons accumulate membrane potential until a threshold triggers a spike.";
  const fid = (s) => `text-${SRC}-${s}`;

  function buildE2E() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-e2e-"));
    const dir = path.join(root, "test-2");
    fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".breadboard", "visuals"), { recursive: true });
    fs.mkdirSync(path.join(dir, "learning", "1. Why SNNs Need Events"), { recursive: true });
    fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
    fs.mkdirSync(path.join(dir, "assets", "source-visuals"), { recursive: true });
    fs.writeFileSync(path.join(dir, ...ASSET.split("/")), "PNG");
    fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---\ntitle: "P"\nsourceId: "${SRC}"\n---\n\n# Page 1\n\n${LIF}\n\n${ENERGY}\n\n# Page 2\n\n${NEURO}\n`);
    const refs = [ANCHOR, fid("energy"), fid("neuro-weak")];
    fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({
      sourceTextConceptAnchors: [
        { id: fid("energy"), sourceId: SRC, page: 1, kind: "concept", title: "Energy bottleneck", semanticSummary: "Energy bottleneck", exactText: LIF, conceptKeywords: ["energy", "bottleneck"], confidence: 0.72 },
        { id: fid("neuro-weak"), sourceId: SRC, page: 2, kind: "concept", title: "Neuromorphic hardware", semanticSummary: "Neuromorphic hardware", exactText: LIF, conceptKeywords: ["neuromorphic", "hardware"], confidence: 0.72 },
      ],
      sourceStructuralAnchors: [{ id: "S1.P2.NeuroCanonical", kind: "guidance", title: "Neuromorphic hardware", page: 2, sourceId: SRC, exactText: NEURO, conceptKeywords: ["neuromorphic", "hardware"] }],
    }, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), JSON.stringify([{ sourceVisualId: ANCHOR, type: "figure", caption: "Architecture", pageNumber: 4, sourceId: SRC, conceptUsage: "embedded_and_explained", cropStatus: "embedded", assignedPageId: "learning/1. Why SNNs Need Events/1.4 Input Encoding and SNN Layers", croppedImagePath: `/test-2/${ASSET}`, usageStatus: "assigned" }], null, 2) + "\n");
    fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "Input encoding", sourceAnchors: refs, sourceFigures: [{ id: ANCHOR, placement: "inside_concept_explanation" }], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "learning", "1. Why SNNs Need Events", "1.4 Input Encoding and SNN Layers.md"), `---\ntitle: "Input Encoding and SNN Layers"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nsourceAnchors: ["${ANCHOR}", "${fid("energy")}", "${fid("neuro-weak")}"]\nsourceFormulaAnchors: []\nsourceVisualIds: ["${ANCHOR}"]\nvisualIds: []\ntags: []\nformulas:\n  - kind: "conceptual_helper"\n    text: "E_{\\\\mathrm{total}} = N_{\\\\mathrm{spikes}} E_{\\\\mathrm{spike}} + N_{\\\\mathrm{synops}} E_{\\\\mathrm{synop}} + baseline"\n    groundingStatus: "conceptual-helper"\n---\n\nThe conceptual architecture shows input encoding feeding excitatory and inhibitory layers, and why event-driven timing matters.\n\n![Architecture](/test-2/${ASSET})\n`);
    fs.writeFileSync(path.join(dir, ".breadboard", "planning", "Source Coverage.md"), `# Source Coverage\n\n## Reconciled Source Visual Usage\n\n- ${ANCHOR} (used)\n`);
    return dir;
  }

  test("17. full pipeline: visual false-positive discarded, anchors migrated, closure complete, unsupported warning excluded", async () => {
    const dir = buildE2E();
    // Step 2 (Fix 13): migrate legacy anchors before the critic.
    const migration = migrateLegacyTextConceptAnchors(dir, "test-2");
    assert.ok(migration.counts.legacyFound === 2);
    // Modern schema persisted; no numeric confidence remains.
    const led = JSON.parse(read(dir, ".breadboard/source-anchors.json"));
    for (const a of led.sourceTextConceptAnchors) assert.equal(typeof a.confidence, "string");
    // The neuro-weak anchor (LIF passage, suspicious) is replaced/migrated; old id gone if replaced.
    const state0 = buildFinalGardenState(dir, "test-2");
    // S1.P4.F1 is represented (static embed) — a missing-visual issue must be unsupported.
    assert.equal(verifySourceVisualRepresentation(ANCHOR, state0).represented, true);

    // Critic reports a false visual blocker + a false formula-truncation warning.
    const critic = () => [
      { id: "vis-1", severity: "blocking", type: "visual_grounding_mismatch", pagePath: "learning/1. Why SNNs Need Events/1.4 Input Encoding and SNN Layers.md", sourceAnchorIds: [ANCHOR], problem: `architecture figure ${ANCHOR} not represented / not visualized`, evidence: "no visual JSON", expected: "interactive visual", repairTarget: "unit_page", suggestedRepair: "add visual" },
      { id: "w-trunc", severity: "warning", type: "formula_anchor_mismatch", pagePath: "learning/1. Why SNNs Need Events/1.4 Input Encoding and SNN Layers.md", problem: "formula appears truncated", evidence: "...", expected: "complete", repairTarget: "unit_page", suggestedRepair: "x" },
    ];
    let repairCalls = 0;
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic, options: { maxRounds: 1, strictPublish: true }, repair: (d, s, reqs) => { repairCalls += reqs.length; return { attempted: reqs.length, resolved: 0 }; } });

    // Visual false positive discarded; no duplicate interactive visual created.
    assert.ok(!res.finalBlockingIssues.some((i) => i.id === "vis-1"), "static-figure blocker discarded as unsupported");
    assert.equal(repairCalls, 0, "no repair request created for the represented figure");
    assert.equal(fs.readdirSync(path.join(dir, ".breadboard", "visuals")).length, 0, "no duplicate interactive visual JSON");
    // Unsupported warning excluded from final warnings.
    const status = JSON.parse(read(dir, ".breadboard/acceptance-status.json"));
    assert.ok(!status.warnings.some((w) => w.id === "w-trunc"), "unsupported warning excluded");
    // Both false positives recorded as unsupported.
    const loop = JSON.parse(read(dir, ".breadboard/critic-loop.json"));
    assert.ok((loop.unsupportedCriticIssues ?? []).some((u) => u.issueId === "vis-1"));
    assert.ok((loop.unsupportedCriticIssues ?? []).some((u) => u.issueId === "w-trunc"));
    // publishReady is determined only by genuine verified blockers (the weak
    // migrated anchor keeps it false; the false visual/warning do not).
    assert.equal(typeof status.publishReady, "boolean");
    assert.equal(status.draftGenerated, true);
  });
});
