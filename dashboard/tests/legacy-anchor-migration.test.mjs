// Problem 2: legacy text-concept anchors (numeric confidence, no evidence) must
// be rescored/migrated against the same evidence + relevance standard as new
// anchors — including detecting the same passage reused for unrelated concepts.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildFinalGardenState,
  auditFinalGardenState,
  reconcileFinalGardenState,
  migrateLegacyTextConceptAnchors,
  isLegacyTextConceptAnchor,
  detectDuplicateAnchorPassages,
  buildAnchorEvidenceCriticIssues,
} from "../src/lib/final-garden-state.ts";
import { runCriticLoop } from "../src/lib/critic-loop.ts";

const SRC = "paperx";
const LIF = "Leaky integrate-and-fire neurons accumulate membrane potential until a threshold triggers a spike, then reset to rest.";
const ENERGY = "Classic networks incur high power consumption, a critical energy bottleneck for mobile and edge computing deployment.";
const NEURO = "Neuromorphic hardware uses event-driven chips and specialized asynchronous circuits to run spiking networks with low power.";
const STDP = "Spike-Timing Dependent Plasticity (STDP) adjusts synaptic weights based on the relative timing of pre- and post-synaptic spikes.";

/** Build a synthetic garden with a multi-page source and legacy text anchors. */
function buildGarden(textAnchors, { structural = [], pageAnchors = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-leg-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Concepts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---
title: "SNN Paper"
sourceId: "${SRC}"
---

# Page 1

${LIF}

${ENERGY}

# Page 2

${NEURO}

# Page 3

${STDP}
`);
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: textAnchors, sourceStructuralAnchors: structural }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  const refIds = pageAnchors ?? textAnchors.map((a) => a.id);
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "Concepts", sourceAnchors: refIds, sourceFigures: [], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "learning", "1. Concepts", "1.1 Concepts.md"), `---
title: "Concepts"
knowledge_type: "learning-page"
breadboardType: "learning_page"
generated_by: "learn_button"
learningUnitId: "U1"
sourceAnchors: [${refIds.map((id) => `"${id}"`).join(", ")}]
sourceFormulaAnchors: []
tags: []
---

A page about SNN concepts.
`);
  return dir;
}

const fid = (s) => `text-${SRC}-${s}`;
const legacy = (id, title, kws, exactText, page = 1) => ({ id, sourceId: SRC, page, kind: "concept", title, exactText, semanticSummary: title, conceptKeywords: kws, confidence: 0.72 });

describe("legacy text-concept anchor migration", () => {
  test("8. numeric-confidence anchor without evidence is classified as legacy", () => {
    assert.equal(isLegacyTextConceptAnchor({ id: "a", confidence: 0.72, exactText: "x", sourceId: SRC }), true);
    assert.equal(isLegacyTextConceptAnchor({ id: "a", confidence: "high", exactText: "x", sourceId: SRC, evidence: { totalScore: 0.9 } }), false);
    assert.equal(isLegacyTextConceptAnchor({ id: "a", confidence: "medium", exactText: "", sourceId: SRC, evidence: {} }), true, "missing exactText is legacy");
  });

  test("9+10. relevant legacy anchor is rescored with current evidence + relevance and migrates", () => {
    const dir = buildGarden([legacy(fid("energy"), "Energy bottleneck", ["energy", "bottleneck"], ENERGY, 1)]);
    const m = migrateLegacyTextConceptAnchors(dir, "test-2");
    const r = m.results.find((x) => x.anchorId === fid("energy"));
    assert.ok(["migrated", "replaced"].includes(r.status));
    assert.ok(["medium", "high"].includes(r.newConfidence));
    assert.ok(r.evidence && typeof r.evidence.totalScore === "number");
    assert.equal(r.relevance.decision, "relevant");
    const rec = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "source-anchors.json"), "utf-8")).sourceTextConceptAnchors.find((a) => a.id === fid("energy"));
    assert.ok(["medium", "high"].includes(rec.confidence), "string confidence enum written");
    assert.ok(rec.evidence);
  });

  test("11. legacy anchor with wrong LIF exactText is repaired with a relevant passage", () => {
    const dir = buildGarden([legacy(fid("neuro"), "Neuromorphic hardware", ["neuromorphic", "hardware"], LIF, 2)]);
    const m = migrateLegacyTextConceptAnchors(dir, "test-2");
    const r = m.results.find((x) => x.anchorId === fid("neuro"));
    assert.equal(r.status, "replaced");
    assert.match(r.selectedPassage, /Neuromorphic hardware uses event-driven chips/);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "source-anchors.json"), "utf-8")).sourceTextConceptAnchors.find((a) => a.id === fid("neuro"));
    assert.doesNotMatch(rec.exactText, /membrane potential/);
    assert.match(rec.exactText, /Neuromorphic hardware/);
  });

  test("12. one LIF passage reused across unrelated families is flagged suspicious", () => {
    const anchors = [
      legacy(fid("neuro"), "Neuromorphic hardware", ["neuromorphic", "hardware"], LIF, 2),
      legacy(fid("stdp"), "STDP", ["spike", "timing", "plasticity"], LIF, 3),
      legacy(fid("energy"), "Energy bottleneck", ["energy", "bottleneck"], LIF, 1),
    ];
    const groups = detectDuplicateAnchorPassages(anchors);
    const g = groups.find((x) => x.anchorIds.length === 3);
    assert.ok(g && g.suspicious, "shared unrelated passage flagged");
    assert.ok(g.conceptFamilies.length >= 2);
    assert.match(g.reason, /grounds 3 anchors|families differ/);
  });

  test("13. related anchors may share a passage without false failure", () => {
    const anchors = [
      legacy(fid("stdp-1"), "STDP timing", ["spike", "timing", "plasticity"], STDP, 3),
      legacy(fid("stdp-2"), "Spike timing plasticity", ["spike", "timing", "plasticity"], STDP, 3),
    ];
    const groups = detectDuplicateAnchorPassages(anchors);
    const g = groups.find((x) => x.anchorIds.length === 2);
    assert.ok(g && !g.suspicious, "two same-family anchors sharing a passage is not suspicious");
  });

  test("14. a stronger existing canonical anchor replaces a weak duplicate", () => {
    const dir = buildGarden(
      [
        legacy(fid("widget"), "Widget gadget", ["widget", "gadget"], LIF, 2),
        legacy(fid("energy"), "Energy bottleneck", ["energy", "bottleneck"], LIF, 1),
      ],
      { structural: [{ id: "S1.P9.Widget", kind: "guidance", title: "Widget gadget concept", page: 9, sourceId: SRC, conceptKeywords: ["widget", "gadget"] }] },
    );
    const m = migrateLegacyTextConceptAnchors(dir, "test-2");
    const r = m.results.find((x) => x.anchorId === fid("widget"));
    assert.equal(r.status, "replaced");
    assert.equal(r.replacementAnchorId, "S1.P9.Widget");
    // The weak duplicate is removed from the ledger.
    const ledger = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "source-anchors.json"), "utf-8"));
    assert.ok(!ledger.sourceTextConceptAnchors.some((a) => a.id === fid("widget")));
    // Page references switched to the stronger anchor.
    const page = fs.readFileSync(path.join(dir, "learning", "1. Concepts", "1.1 Concepts.md"), "utf-8");
    assert.match(page, /"S1\.P9\.Widget"/);
  });

  test("15. unsupported legacy anchor is routed to critic and blocks publish-ready", async () => {
    const dir = buildGarden([legacy(fid("scalable"), "Scalable open challenges", ["scalable", "challenges"], LIF, 1)]);
    migrateLegacyTextConceptAnchors(dir, "test-2");
    const state = buildFinalGardenState(dir, "test-2");
    const rec = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "source-anchors.json"), "utf-8")).sourceTextConceptAnchors.find((a) => a.id === fid("scalable"));
    assert.ok(["low", "unsupported"].includes(rec.confidence), "weak anchor got a string enum, not numeric");
    assert.ok(buildAnchorEvidenceCriticIssues(state).some((i) => i.sourceAnchorIds.includes(fid("scalable"))), "surfaced as a blocking anchor-evidence issue");
    assert.equal(auditFinalGardenState(state).ok, false);
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: () => [], options: { strictPublish: true, maxRounds: 1 }, repair: () => ({ attempted: 0, resolved: 0 }) });
    assert.equal(res.status.publishReady, false);
  });

  test("16. no legacy numeric-confidence anchor survives migration", () => {
    const dir = buildGarden([
      legacy(fid("energy"), "Energy bottleneck", ["energy", "bottleneck"], ENERGY, 1),
      legacy(fid("neuro"), "Neuromorphic hardware", ["neuromorphic", "hardware"], LIF, 2),
      legacy(fid("scalable"), "Scalable open challenges", ["scalable", "challenges"], LIF, 1),
    ]);
    const m = migrateLegacyTextConceptAnchors(dir, "test-2");
    assert.equal(m.counts.legacyFound, 3);
    const ledger = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "source-anchors.json"), "utf-8"));
    for (const a of ledger.sourceTextConceptAnchors) {
      assert.equal(typeof a.confidence, "string", `${a.id} must not retain numeric confidence`);
      assert.ok(["high", "medium", "low", "unsupported"].includes(a.confidence));
    }
    // Migration report is written.
    assert.ok(fs.existsSync(path.join(dir, ".breadboard", "source-anchor-migration.md")));
    assert.match(fs.readFileSync(path.join(dir, ".breadboard", "source-anchor-migration.md"), "utf-8"), /## Suspicious Reused Passages/);
    const json = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "source-anchor-migration.json"), "utf-8"));
    assert.equal(json.counts.legacyFound, 3);
  });

  test("17. end-to-end: false formula positives discarded, legacy anchors migrated, publishReady reflects verified blockers", async () => {
    // Legacy anchors sharing one LIF passage: some rescore to a real passage,
    // one has no support (stays blocking). A truncation-claiming critic issue on
    // a complete formula must be discarded.
    const dir = buildGarden([
      legacy(fid("energy"), "Energy bottleneck", ["energy", "bottleneck"], LIF, 1),
      legacy(fid("neuro"), "Neuromorphic hardware", ["neuromorphic", "hardware"], LIF, 2),
      legacy(fid("scalable"), "Scalable open challenges", ["scalable", "challenges"], LIF, 1),
    ]);
    // add a complete formula to the page
    const pagePath = path.join(dir, "learning", "1. Concepts", "1.1 Concepts.md");
    fs.writeFileSync(pagePath, fs.readFileSync(pagePath, "utf-8").replace("tags: []", `tags: []
formulas:
  - kind: "conceptual_helper"
    text: "E_{\\\\mathrm{total}} = N_{\\\\mathrm{spikes}} E_{\\\\mathrm{spike}} + N_{\\\\mathrm{synops}} E_{\\\\mathrm{synop}} + baseline"
    groundingStatus: "conceptual-helper"`));

    // Step: migrate legacy anchors (Fix 13).
    const migration = migrateLegacyTextConceptAnchors(dir, "test-2");
    assert.ok(migration.counts.migrated + migration.counts.replaced >= 2, "at least two legacy anchors migrated/repaired");
    assert.ok(migration.duplicateGroups.some((g) => g.suspicious), "shared LIF passage flagged");

    // Critic reports a false formula-truncation issue AND nothing real.
    const critic = () => [{ id: "c-formula-1", severity: "blocking", type: "formula_anchor_mismatch", pagePath: "learning/1. Concepts/1.1 Concepts.md", problem: "Formula appears truncated", evidence: "E_{total} = ...", expected: "complete", repairTarget: "unit_page", suggestedRepair: "rewrite" }];
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic, options: { strictPublish: true, maxRounds: 2 }, repair: () => ({ attempted: 0, resolved: 0 }) });

    assert.ok(!res.finalBlockingIssues.some((i) => i.id === "c-formula-1"), "formula false positive discarded");
    // The genuinely unsupported legacy anchor keeps publish-ready false.
    assert.ok(res.finalBlockingIssues.some((i) => (i.sourceAnchorIds ?? []).includes(fid("scalable"))), "only the real unresolved anchor remains blocking");
    assert.equal(res.status.publishReady, false);
    assert.ok(res.rounds.some((r) => (r.unsupportedIssues ?? 0) >= 1), "false positive recorded");
  });
});
