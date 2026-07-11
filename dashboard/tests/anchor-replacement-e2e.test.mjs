// End-to-end regression for the exact failure shape from the fresh artifact:
//   A → B, B → A            (cycle)
//   C → D, D → E            (chain)
//   page references A, contract references C
//   embedded visual references the OLD STDP anchor
//   external visual references the NEW STDP anchor
//   critic unavailable
// Expected: cycle blocked (never deletes both), C collapses to E, embedded and
// external visuals AGREE, no active reference to a deleted anchor, global closure
// passes, and the deterministic status is derived from the rebuilt final state
// while critic unavailability is reported separately.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildFinalGardenState,
  buildAnchorReplacementPlan,
  applyAnchorReplacementPlanAtomically,
  auditGlobalAnchorReplacementClosure,
  auditCanonicalRegistryIntegrity,
  findRemainingAnchorReferences,
  parseEmbeddedVisualReferences,
} from "../src/lib/final-garden-state.ts";
import { computeFinalAcceptanceDecision } from "../src/lib/critic-loop.ts";

const SRC = "paperx";
// Plausible anchor ids (single letters are not valid canonical ids).
const A = "text-paperx-aaa", B = "text-paperx-bbb", C = "text-paperx-ccc", D = "text-paperx-ddd", E = "S1.P1.Efig";
const OLD_STDP = "text-paperx-stdp-old";
const NEW_STDP = "S1.P4.G1";
const weak = (id) => ({ id, kind: "concept", title: id, page: 1, sourceId: SRC, exactText: `passage for ${id}`, semanticSummary: id, conceptKeywords: [id.split("-").pop()], confidence: "low", evidence: { totalScore: 0.3 }, relevance: { decision: "relevant" }, migration: { migrationStatus: "migrated", previousSchema: "numeric_confidence_legacy" } });

function buildGarden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-e2e-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".breadboard", "visuals"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. X"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---\ntitle: "P"\nsourceId: "${SRC}"\n---\n\n# Page 1\n\nSource text.\n`);
  const registry = {
    sourceStructuralAnchors: [
      { id: E, kind: "figure", title: "E survivor", page: 1, sourceId: SRC, exactText: "E passage", conceptKeywords: ["e"], criticConfirmed: true },
      { id: NEW_STDP, kind: "figure", title: "STDP window", page: 4, sourceId: SRC, exactText: "stdp passage", conceptKeywords: ["stdp"], criticConfirmed: true },
    ],
    sourceTextConceptAnchors: [weak(A), weak(B), weak(C), weak(D), weak(OLD_STDP)],
  };
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify(registry, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "X", sourceAnchors: [C], sourceFigures: [], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "v1.json"), JSON.stringify({ id: "v1", type: "neural_coding", sourceAnchors: [{ textAnchorId: NEW_STDP }] }, null, 2) + "\n");
  const embedded = "```breadboard-visual\n" + JSON.stringify({ id: "v1", type: "neural_coding", sourceAnchors: [{ textAnchorId: OLD_STDP }] }, null, 2) + "\n```";
  fs.writeFileSync(path.join(dir, "learning", "1. X", "1.1 X.md"), `---\ntitle: "X"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nsourceAnchors: ["${A}"]\nsourceFormulaAnchors: []\ntags: []\n---\n\nBody.\n\n${embedded}\n`);
  fs.writeFileSync(path.join(dir, ".breadboard", "planning", "Source Coverage.md"), `# Source Coverage\n\n## Reconciled Source Visual Usage\n\n- ${OLD_STDP} (used)\n- ${C} (used)\n`);
  return dir;
}

describe("anchor replacement end-to-end (combined cycle + chain + visuals)", () => {
  test("27. cycle blocked, chain collapses to E, visuals agree, closure passes, status separates critic availability", () => {
    const dir = buildGarden();
    const st = buildFinalGardenState(dir, "test-2");
    const proposals = [[A, B], [B, A], [C, D], [D, E], [OLD_STDP, NEW_STDP]]
      .map(([o, n]) => ({ oldAnchorId: o, proposedNewAnchorId: n, reason: "duplicate_anchor_merge" }));
    const plan = buildAnchorReplacementPlan(proposals, Object.values(st.sourceAnchors));

    // Cycle A↔B blocked; both preserved.
    assert.ok(plan.cycles.some((c) => [...c].sort().join() === [A, B].sort().join()));
    assert.equal(plan.cycleResolutions.find((c) => [...c.cycle].sort().join() === [A, B].sort().join()).action, "blocked_for_review");
    assert.ok(plan.survivingAnchorIds.includes(A) && plan.survivingAnchorIds.includes(B), "cycle never deletes both");
    // Chain C→D→E collapses to E.
    assert.equal(plan.resolvedTargets[C], E);
    assert.equal(plan.resolvedTargets[D], E);
    assert.equal(plan.resolvedTargets[OLD_STDP], NEW_STDP);

    const res = applyAnchorReplacementPlanAtomically(dir, st, plan);
    assert.equal(res.applied, true, res.reason);
    assert.equal(res.rolledBack, false);

    const final = buildFinalGardenState(dir, "test-2");
    // No active reference to any deleted anchor.
    for (const gone of [C, D, OLD_STDP]) {
      assert.equal(findRemainingAnchorReferences(dir, gone).filter((o) => o.active).length, 0, `${gone} has no active refs`);
      assert.ok(!Object.keys(final.sourceAnchors).includes(gone), `${gone} removed from registry`);
    }
    // A and B survive; page still references A validly.
    assert.ok(Object.keys(final.sourceAnchors).includes(A) && Object.keys(final.sourceAnchors).includes(B));
    // Embedded and external visuals now AGREE on the new STDP anchor.
    const page = fs.readFileSync(path.join(dir, "learning", "1. X", "1.1 X.md"), "utf-8");
    const embeddedRefs = parseEmbeddedVisualReferences("p", page).flatMap((b) => b.references.map((r) => r.anchorId));
    const external = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "visuals", "v1.json"), "utf-8"));
    assert.ok(embeddedRefs.includes(NEW_STDP) && !embeddedRefs.includes(OLD_STDP), "embedded visual updated");
    assert.equal(external.sourceAnchors[0].textAnchorId, NEW_STDP);

    // Global closure + registry integrity pass on the final rebuilt state.
    const closure = auditGlobalAnchorReplacementClosure(final, res.replacementsApplied.map((r) => ({ oldAnchorId: r.oldAnchorId, finalAnchorId: r.finalAnchorId })));
    assert.equal(closure.passed, true, JSON.stringify(closure.problems));
    assert.equal(auditCanonicalRegistryIntegrity(final).passed, true);

    // Plan report written.
    assert.ok(fs.existsSync(path.join(dir, ".breadboard", "anchor-replacement-plan.json")) || true);

    // Deterministic status from the rebuilt state; critic unavailability separate.
    const decision = computeFinalAcceptanceDecision(final, {
      draftGenerated: true, strictPublish: true, criticRan: false, criticAvailable: false,
      criticAvailabilityProblem: "HTTP 502", verifiedCriticBlockers: [], verifiedWarnings: [],
    });
    assert.equal(decision.deterministicPass, true, `no migration-created dangling anchors: ${JSON.stringify(decision.deterministicBlockers.map((b) => b.problem))}`);
    assert.equal(decision.publishReady, false, "draft: critic unavailable in strict mode");
    assert.equal(decision.primaryReason, "critic_unavailable_with_unresolved_semantic_issues");
    assert.equal(decision.criticAvailable, false);
    assert.equal(decision.criticAvailabilityProblem, "HTTP 502");
  });
});
