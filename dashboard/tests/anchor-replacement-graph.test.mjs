// Two-phase replacement graph: plan-and-validate BEFORE any mutation.
// Cycles are rejected or resolved to one survivor; chains collapse to a surviving
// canonical anchor; targets are validated. Never delete every node of a cycle.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnchorReplacementPlan,
  resolveFinalAnchorTarget,
} from "../src/lib/final-garden-state.ts";

// Minimal canonical anchor. `strong` bumps evidence so it wins a cycle.
const anchor = (id, over = {}) => ({
  id, kind: "text_concept", title: id, origin: "text_ledger",
  confidence: "medium", evidence: { totalScore: 0.6 }, relevance: { decision: "relevant", totalScore: 0.6 },
  ...over,
});
const strong = (id) => anchor(id, { confidence: "high", evidence: { totalScore: 0.95 }, criticConfirmed: true });
const plan = (reps, anchors) => buildAnchorReplacementPlan(reps.map(([o, n]) => ({ oldAnchorId: o, proposedNewAnchorId: n, reason: "duplicate_anchor_merge" })), anchors);

describe("resolveFinalAnchorTarget (Fix 3)", () => {
  test("collapses a chain A→B→C to C", () => {
    const map = new Map([["A", "B"], ["B", "C"]]);
    const r = resolveFinalAnchorTarget("A", map);
    assert.equal(r.finalAnchorId, "C");
    assert.deepEqual(r.path, ["A", "B", "C"]);
    assert.equal(resolveFinalAnchorTarget("B", map).finalAnchorId, "C");
  });
  test("detects a cycle and returns it", () => {
    const map = new Map([["A", "B"], ["B", "A"]]);
    const r = resolveFinalAnchorTarget("A", map);
    assert.ok(r.cycle, "cycle reported");
    assert.equal(r.finalAnchorId, undefined);
    assert.deepEqual([...new Set(r.cycle)].sort(), ["A", "B"]);
  });
  test("a self-loop is terminal", () => {
    assert.equal(resolveFinalAnchorTarget("A", new Map([["A", "A"]])).finalAnchorId, "A");
  });
});

describe("buildAnchorReplacementPlan (Fix 2/4/5)", () => {
  test("1. two-node cycle with equal strength is blocked; never deletes both", () => {
    const p = plan([["A", "B"], ["B", "A"]], [anchor("A"), anchor("B")]);
    assert.equal(p.cycles.length, 1);
    assert.equal(p.cycleResolutions[0].action, "blocked_for_review");
    assert.equal(p.blockedReplacements.length, 2, "both edges blocked");
    assert.deepEqual(p.resolvedTargets, {}, "nothing applied");
    assert.equal(p.valid, false);
    // Both survive (never deleted).
    assert.ok(p.survivingAnchorIds.includes("A") && p.survivingAnchorIds.includes("B"));
  });

  test("1b. two-node cycle with a clear survivor rewrites both toward it", () => {
    const p = plan([["A", "B"], ["B", "A"]], [anchor("A"), strong("B")]);
    assert.equal(p.cycleResolutions[0].action, "selected_survivor");
    assert.equal(p.cycleResolutions[0].survivorAnchorId, "B");
    assert.equal(p.resolvedTargets["A"], "B");
    assert.equal(p.resolvedTargets["B"], undefined, "survivor is not itself replaced");
    assert.ok(p.survivingAnchorIds.includes("B"));
    assert.ok(!p.survivingAnchorIds.includes("A"), "A is replaced away");
  });

  test("2. multi-node cycle A→B→C→A is detected and (equal) blocked", () => {
    const p = plan([["A", "B"], ["B", "C"], ["C", "A"]], [anchor("A"), anchor("B"), anchor("C")]);
    assert.equal(p.cycles.length, 1);
    assert.deepEqual([...p.cycles[0]].sort(), ["A", "B", "C"]);
    assert.equal(p.cycleResolutions[0].action, "blocked_for_review");
    assert.equal(p.blockedReplacements.length, 3);
    assert.deepEqual(p.resolvedTargets, {});
  });

  test("3. a simple chain A→B, B→C resolves to A→C and B→C", () => {
    const p = plan([["A", "B"], ["B", "C"]], [anchor("A"), anchor("B"), anchor("C")]);
    assert.equal(p.resolvedTargets["A"], "C");
    assert.equal(p.resolvedTargets["B"], "C");
    assert.deepEqual(p.chains["A"], ["A", "B", "C"]);
    assert.ok(p.survivingAnchorIds.includes("C"));
    assert.ok(!p.survivingAnchorIds.includes("A") && !p.survivingAnchorIds.includes("B"));
    assert.equal(p.valid, true);
  });

  test("4. a target that does not exist is invalid and blocked", () => {
    const p = plan([["A", "missing-anchor"]], [anchor("A")]);
    assert.equal(p.invalidTargets.length, 1);
    assert.match(p.invalidTargets[0].reason, /missing from the canonical registry|does not exist/);
    assert.equal(p.resolvedTargets["A"], undefined);
    assert.equal(p.valid, false);
  });

  test("5. a chain leading to no surviving canonical anchor is rejected", () => {
    // A→B→C where C is not in the registry ⇒ terminal target missing ⇒ blocked.
    const p = plan([["A", "B"], ["B", "C"]], [anchor("A"), anchor("B")]);
    assert.equal(p.resolvedTargets["A"], undefined);
    assert.equal(p.resolvedTargets["B"], undefined);
    assert.ok(p.invalidTargets.length >= 1);
    assert.equal(p.valid, false);
  });

  test("6. conflicting proposals for one old anchor are blocking", () => {
    const p = plan([["A", "B"], ["A", "C"]], [anchor("A"), anchor("B"), anchor("C")]);
    assert.ok(p.invalidTargets.some((t) => /conflicting/.test(t.reason)));
    assert.equal(p.resolvedTargets["A"], undefined);
    assert.equal(p.valid, false);
  });

  test("7. a self-replacement is a no-op and does not mutate the plan", () => {
    const p = plan([["A", "A"]], [anchor("A")]);
    assert.deepEqual(p.resolvedTargets, {});
    assert.equal(p.blockedReplacements.length, 0);
    assert.ok(p.survivingAnchorIds.includes("A"));
    assert.equal(p.valid, true);
  });
});
