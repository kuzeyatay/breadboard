// Weak-anchor self-healing loop (Parts 1–14). Fully isolated — every test builds
// a temporary fixture garden; the live quartz/content/test-2 garden is never read.
//
// The loop is deterministic-first / ChatMock-second: it repairs what it can prove
// from the source, asks an injected ChatMock model ONLY for residual ambiguity,
// independently verifies every decision, applies atomically, and publishes ONLY
// when no ACTIVE weak-anchor blocker remains.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DETERMINISTIC_REPAIR_FLOOR,
  DETERMINISTIC_REPAIR_MARGIN,
  collectWeakAnchorRepairIssues,
  activeWeakAnchorBlockerCount,
  findAnchorRepairCandidates,
  decideDeterministicAnchorRepair,
  batchWeakAnchorRepairIssues,
  buildWeakAnchorRepairPacket,
  verifyWeakAnchorRepairDecision,
  applyVerifiedWeakAnchorDecision,
  runWeakAnchorSelfHealingLoop,
  writeWeakAnchorSelfHealingReports,
  decideFinalAcceptance,
} from "../src/lib/weak-anchor-self-healing.ts";
import { buildFinalGardenState, auditFinalGardenState } from "../src/lib/final-garden-state.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const STRONG =
  "Surrogate gradient training replaces the non-differentiable spike function with a smooth surrogate gradient so backpropagation can train spiking neural networks. The surrogate gradient approximates the derivative of the spike during surrogate gradient training.";
const WEAKISH =
  "Spiking neural networks communicate using discrete spikes and event-driven computation across time steps in a network of neurons.";

function fm(obj) {
  return `---\n${Object.entries(obj)
    .map(([k, v]) => (Array.isArray(v) ? `${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]` : `${k}: ${JSON.stringify(v)}`))
    .join("\n")}\n---\n\n`;
}

async function withTempGarden(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-wash-"));
  const dir = path.join(root, "test-2");
  try {
    // MUST await so the temp garden is not deleted while an async loop is still
    // doing file I/O against it (sync fns pass through unchanged).
    return await fn(dir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// A minimal-but-valid garden with one actively-referenced weak text anchor.
//   mode: "strong"       — page-2 source strongly supports the anchor
//         "groundless"   — anchor concept is absent from the source
//         "twoStrong"    — two comparably-strong page-2 passages (ambiguous)
//         "existingRepl" — weak source, but a strong existing anchor covers it
//         "unusedOnly"   — the weak anchor is NOT referenced anywhere
//         "medium"       — the anchor is medium confidence (not blocking)
function buildGarden(dir, { mode = "strong" } = {}) {
  const bb = path.join(dir, ".breadboard");
  fs.mkdirSync(bb, { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "2. Training"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
  fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
  fs.writeFileSync(path.join(bb, "source-visuals.json"), "[]");
  fs.writeFileSync(path.join(bb, "visual-index.json"), "{}");

  // twoStrong uses two IDENTICAL strong passages so the top two candidates score
  // exactly equally (margin 0) — a guaranteed "ambiguous" case that escalates.
  const page2 =
    mode === "twoStrong" ? `${STRONG}\n\n${STRONG}` : mode === "strong" ? STRONG : WEAKISH;
  fs.writeFileSync(
    path.join(dir, "sources", "src.md"),
    fm({ title: "Source", sourceId: "src", breadboardType: "source_document" }) +
      `# Page 1\n\n${WEAKISH}\n\n# Page 2\n\n${page2}\n\n# Page 3\n\n${WEAKISH}\n`,
  );

  const weak = {
    id: "text-active-weak-anchor",
    kind: "text_concept",
    sourceId: "src",
    page: 2,
    title: mode === "groundless" ? "quantum entanglement flux" : "surrogate gradient training",
    semanticSummary: mode === "groundless" ? "A passage about quantum entanglement flux." : "A passage about surrogate gradient training.",
    conceptKeywords: mode === "groundless" ? ["quantum", "entanglement"] : ["surrogate", "gradient"],
    confidence: mode === "medium" ? "medium" : "low",
    evidence: { totalScore: 0.4, keywordHits: ["surrogate"], missingKeywords: ["gradient"], titleOverlapScore: 0.3, keywordCoverageScore: 0.4, pageMatchScore: 1, contextSpecificityScore: 0.3, negativeEvidencePenalty: 0, decision: "needs_critic_review" },
  };
  const anchors = [weak];
  if (mode === "existingRepl") {
    anchors.push({
      id: "text-strong-ref",
      kind: "text_concept",
      sourceId: "src",
      page: 3,
      title: "surrogate gradient method",
      semanticSummary: "Surrogate gradient method for training.",
      conceptKeywords: ["surrogate", "gradient"],
      confidence: "high",
      exactText: STRONG,
      evidence: { totalScore: 0.85, keywordHits: ["surrogate", "gradient"], missingKeywords: [], titleOverlapScore: 0.9, keywordCoverageScore: 1, pageMatchScore: 1, contextSpecificityScore: 0.8, negativeEvidencePenalty: 0, decision: "register" },
    });
  }
  fs.writeFileSync(path.join(bb, "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: anchors }, null, 2));

  const referenced = mode === "unusedOnly" ? [] : ["text-active-weak-anchor", ...(mode === "existingRepl" ? ["text-strong-ref"] : [])];
  fs.writeFileSync(
    path.join(bb, "learning-unit-contract.json"),
    JSON.stringify(
      {
        learningUnits: [
          {
            id: "U1",
            role: "core_concept",
            title: "Training",
            learningQuestion: "How to train spiking networks?",
            sourceAnchors: referenced,
            zettelNotes: [{ handle: "training-uses-surrogate-gradient", claim: "Training uses a surrogate gradient." }],
          },
        ],
        sourceArtifactAssignments: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "learning", "2. Training", "2.2 Surrogate Gradient Training.md"),
    fm({
      title: "2.2 Surrogate Gradient Training",
      knowledge_type: "learning-page",
      breadboardType: "learning_page",
      learningUnitId: "U1",
      generatedBy: "learn_button",
      sourceAnchors: referenced,
      tags: ["training-uses-surrogate-gradient"],
    }) + `## Training\n\n${"This lesson teaches surrogate gradient training in depth. ".repeat(20)}\n`,
  );
}

// Synthetic issue / candidate factories (no garden needed).
function synthIssue(over = {}) {
  return {
    stableIdentity: "weak-anchor|id=text-x|kind=text_concept|family=surrogate_gradient|reason=low_confidence_evidence|usages=page:p",
    anchorId: "text-x",
    kind: "text_concept",
    title: "surrogate gradient",
    conceptFamily: "surrogate_gradient",
    conceptKeywords: ["surrogate", "gradient"],
    confidence: "low",
    failureReason: "low_confidence_evidence",
    usageStatus: "actively_referenced",
    usageTargets: [{ ref: "p", kind: "page" }],
    sourceId: "src",
    page: 2,
    ...over,
  };
}
function synthCandidate(over = {}) {
  return {
    kind: "source_passage",
    exactText: "a verifiable source excerpt of sufficient length",
    evidenceConfidence: "high",
    evidenceScore: 0.9,
    relevance: "relevant",
    relevanceScore: 0.9,
    wrongFamilyPenalty: 0,
    familyCompatible: true,
    supportsAllUsages: true,
    score: 0.9,
    reason: "synthetic",
    ...over,
  };
}

// ===========================================================================
// Part 1 — issue typing + stable identity
// ===========================================================================

describe("Part 1 — weak-anchor repair issue + stable identity", () => {
  test("1. an actively-referenced weak anchor becomes a repair issue", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const issues = collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2"));
      assert.equal(issues.length, 1);
      assert.equal(issues[0].anchorId, "text-active-weak-anchor");
      assert.equal(issues[0].usageStatus, "actively_referenced");
    }));

  test("2. stableIdentity encodes anchor id + kind + family + reason + usages (not the audit sentence)", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const [issue] = collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2"));
      assert.match(issue.stableIdentity, /id=text-active-weak-anchor/);
      assert.match(issue.stableIdentity, /kind=text_concept/);
      assert.match(issue.stableIdentity, /family=surrogate_gradient/);
      assert.match(issue.stableIdentity, /reason=low_confidence_evidence/);
      assert.match(issue.stableIdentity, /usages=/);
      assert.ok(!/score/.test(issue.stableIdentity), "identity must not embed the evidence score sentence");
    }));

  test("3. stableIdentity is stable across two independent builds of the same state", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const a = collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2"))[0].stableIdentity;
      const b = collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2"))[0].stableIdentity;
      assert.equal(a, b);
    }));

  test("4. failureReason normalizes an unsupported anchor", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "groundless" });
      // Force the anchor to unsupported.
      const p = path.join(dir, ".breadboard", "source-anchors.json");
      const j = JSON.parse(fs.readFileSync(p, "utf-8"));
      j.sourceTextConceptAnchors[0].confidence = "unsupported";
      fs.writeFileSync(p, JSON.stringify(j, null, 2));
      const [issue] = collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2"));
      assert.equal(issue.failureReason, "unsupported_confidence_evidence");
    }));

  test("5. failureReason of a plain low-confidence anchor is low_confidence_evidence", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const [issue] = collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2"));
      assert.equal(issue.failureReason, "low_confidence_evidence");
    }));

  test("6. usageTargets include the referencing page and contract unit", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const [issue] = collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2"));
      assert.ok(issue.usageTargets.some((u) => u.kind === "contract_unit" && u.ref === "U1"));
      assert.ok(issue.usageTargets.some((u) => /2\.2 Surrogate Gradient Training\.md/.test(u.ref)));
    }));
});

// ===========================================================================
// Part 2 — collection (active only; unused/confirmed/strong excluded)
// ===========================================================================

describe("Part 2 — collectWeakAnchorRepairIssues (active state only)", () => {
  test("7. an UNUSED weak anchor is not collected", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "unusedOnly" });
      assert.equal(collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2")).length, 0);
    }));

  test("8. a MEDIUM-confidence anchor is not collected", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "medium" });
      assert.equal(collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2")).length, 0);
    }));

  test("9. a critic-confirmed weak anchor is not collected", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const p = path.join(dir, ".breadboard", "source-anchors.json");
      const j = JSON.parse(fs.readFileSync(p, "utf-8"));
      j.sourceTextConceptAnchors[0].criticConfirmed = true;
      fs.writeFileSync(p, JSON.stringify(j, null, 2));
      assert.equal(collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2")).length, 0);
    }));

  test("10. issues are sorted deterministically by stableIdentity", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "existingRepl" });
      // Make text-strong-ref weak too so we get two issues, then check ordering.
      const p = path.join(dir, ".breadboard", "source-anchors.json");
      const j = JSON.parse(fs.readFileSync(p, "utf-8"));
      j.sourceTextConceptAnchors[1].confidence = "low";
      fs.writeFileSync(p, JSON.stringify(j, null, 2));
      const issues = collectWeakAnchorRepairIssues(buildFinalGardenState(dir, "test-2"));
      const ids = issues.map((i) => i.stableIdentity);
      assert.deepEqual(ids, [...ids].sort());
    }));

  test("11. activeWeakAnchorBlockerCount mirrors the audit's anchor_evidence count", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const state = buildFinalGardenState(dir, "test-2");
      const audit = auditFinalGardenState(state).byRule.anchor_evidence ?? [];
      assert.equal(activeWeakAnchorBlockerCount(state), audit.length);
      assert.equal(activeWeakAnchorBlockerCount(state), 1);
    }));
});

// ===========================================================================
// Part 3 — candidate search
// ===========================================================================

describe("Part 3 — findAnchorRepairCandidates", () => {
  test("12. a supporting source passage is found for a grounded concept", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const state = buildFinalGardenState(dir, "test-2");
      const [issue] = collectWeakAnchorRepairIssues(state);
      const cands = findAnchorRepairCandidates(dir, issue, state);
      assert.ok(cands.length >= 1);
      assert.ok(cands.some((c) => c.kind === "source_passage" && c.relevance === "relevant"));
    }));

  test("13. a groundless concept yields no candidates", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "groundless" });
      const state = buildFinalGardenState(dir, "test-2");
      const [issue] = collectWeakAnchorRepairIssues(state);
      assert.deepEqual(findAnchorRepairCandidates(dir, issue, state), []);
    }));

  test("14. candidates are ranked by score descending", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "twoStrong" });
      const state = buildFinalGardenState(dir, "test-2");
      const [issue] = collectWeakAnchorRepairIssues(state);
      const cands = findAnchorRepairCandidates(dir, issue, state);
      for (let i = 1; i < cands.length; i += 1) assert.ok(cands[i - 1].score >= cands[i].score);
    }));

  test("15. a strong existing anchor becomes an existing_anchor candidate", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "existingRepl" });
      const state = buildFinalGardenState(dir, "test-2");
      const [issue] = collectWeakAnchorRepairIssues(state);
      const cands = findAnchorRepairCandidates(dir, issue, state);
      assert.ok(cands.some((c) => c.kind === "existing_anchor" && c.replacementAnchorId === "text-strong-ref"));
    }));

  test("16. each candidate carries relevance, evidence confidence, and family compatibility", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const state = buildFinalGardenState(dir, "test-2");
      const [issue] = collectWeakAnchorRepairIssues(state);
      const [c] = findAnchorRepairCandidates(dir, issue, state);
      assert.ok(["relevant", "weak_relevance", "irrelevant"].includes(c.relevance));
      assert.ok(["high", "medium", "low", "unsupported"].includes(c.evidenceConfidence));
      assert.equal(typeof c.familyCompatible, "boolean");
      assert.equal(typeof c.supportsAllUsages, "boolean");
    }));
});

// ===========================================================================
// Part 4 — deterministic repair policy
// ===========================================================================

describe("Part 4 — decideDeterministicAnchorRepair (conservative policy)", () => {
  test("17. an unambiguous strong source passage → reground_from_source", () => {
    const d = decideDeterministicAnchorRepair(synthIssue(), [synthCandidate({ score: 0.91 }), synthCandidate({ score: 0.61 })]);
    assert.equal(d.action, "reground_from_source");
  });

  test("18. no candidate → no_candidate", () => {
    assert.equal(decideDeterministicAnchorRepair(synthIssue(), []).action, "no_candidate");
  });

  test("19. two near-tied candidates (0.76 vs 0.74) → escalate_to_chatmock", () => {
    const d = decideDeterministicAnchorRepair(synthIssue(), [synthCandidate({ score: 0.76 }), synthCandidate({ score: 0.74 })]);
    assert.equal(d.action, "escalate_to_chatmock");
  });

  test("20. above floor but margin < 0.15 → escalate", () => {
    const d = decideDeterministicAnchorRepair(synthIssue(), [synthCandidate({ score: 0.9 }), synthCandidate({ score: 0.8 })]);
    assert.equal(d.action, "escalate_to_chatmock");
    assert.ok(d.margin < DETERMINISTIC_REPAIR_MARGIN);
  });

  test("21. best below the deterministic floor → escalate", () => {
    const d = decideDeterministicAnchorRepair(synthIssue(), [synthCandidate({ score: DETERMINISTIC_REPAIR_FLOOR - 0.05 })]);
    assert.equal(d.action, "escalate_to_chatmock");
  });

  test("22. a wrong-family best candidate → escalate", () => {
    const d = decideDeterministicAnchorRepair(synthIssue(), [synthCandidate({ score: 0.95, wrongFamilyPenalty: 0.3, familyCompatible: false })]);
    assert.equal(d.action, "escalate_to_chatmock");
  });

  test("23. a merely weakly-relevant best candidate → escalate", () => {
    const d = decideDeterministicAnchorRepair(synthIssue(), [synthCandidate({ score: 0.95, relevance: "weak_relevance" })]);
    assert.equal(d.action, "escalate_to_chatmock");
  });

  test("24. low-evidence best candidate → escalate", () => {
    const d = decideDeterministicAnchorRepair(synthIssue(), [synthCandidate({ score: 0.95, evidenceConfidence: "low" })]);
    assert.equal(d.action, "escalate_to_chatmock");
  });

  test("25. a candidate that does not support all usages → escalate", () => {
    const d = decideDeterministicAnchorRepair(synthIssue(), [synthCandidate({ score: 0.95, supportsAllUsages: false })]);
    assert.equal(d.action, "escalate_to_chatmock");
  });

  test("26. a strong existing-anchor best → replace_with_existing_anchor", () => {
    const d = decideDeterministicAnchorRepair(synthIssue(), [synthCandidate({ kind: "existing_anchor", replacementAnchorId: "text-y", score: 0.92 })]);
    assert.equal(d.action, "replace_with_existing_anchor");
  });
});

// ===========================================================================
// Part 5 — batching
// ===========================================================================

describe("Part 5 — batchWeakAnchorRepairIssues", () => {
  test("27. issues with the same source + family fall in one batch", () => {
    const batches = batchWeakAnchorRepairIssues([synthIssue({ anchorId: "a" }), synthIssue({ anchorId: "b" })]);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].issues.length, 2);
  });

  test("28. different families produce different batches", () => {
    const batches = batchWeakAnchorRepairIssues([
      synthIssue({ anchorId: "a", conceptFamily: "surrogate_gradient" }),
      synthIssue({ anchorId: "b", conceptFamily: "accuracy" }),
    ]);
    assert.equal(batches.length, 2);
  });

  test("29. different sources produce different batches", () => {
    const batches = batchWeakAnchorRepairIssues([
      synthIssue({ anchorId: "a", sourceId: "s1" }),
      synthIssue({ anchorId: "b", sourceId: "s2" }),
    ]);
    assert.equal(batches.length, 2);
  });

  test("30. batches are ordered deterministically", () => {
    const batches = batchWeakAnchorRepairIssues([
      synthIssue({ anchorId: "b", conceptFamily: "accuracy" }),
      synthIssue({ anchorId: "a", conceptFamily: "surrogate_gradient" }),
    ]);
    assert.deepEqual(batches.map((b) => b.batchId), [...batches.map((b) => b.batchId)].sort());
  });
});

// ===========================================================================
// Part 6 — targeted packet
// ===========================================================================

describe("Part 6 — buildWeakAnchorRepairPacket (targeted, not the whole garden)", () => {
  const fakeState = (anchor) => ({ sourceAnchors: { "text-x": anchor } });

  test("31. the packet targets exactly the issue's anchor", () => {
    const packet = buildWeakAnchorRepairPacket(synthIssue(), [synthCandidate()], fakeState({ kind: "text_concept", title: "t", semanticSummary: "s", exactText: "e" }));
    assert.equal(packet.anchor.id, "text-x");
    assert.equal(packet.issueIdentity, synthIssue().stableIdentity);
  });

  test("32. the packet offers candidate passages and existing alternative anchors", () => {
    const packet = buildWeakAnchorRepairPacket(
      synthIssue(),
      [synthCandidate({ kind: "source_passage", exactText: "passage text here that is long enough" }), synthCandidate({ kind: "existing_anchor", replacementAnchorId: "text-y" })],
      { sourceAnchors: { "text-x": {}, "text-y": { kind: "text_concept", title: "Y" } } },
    );
    assert.equal(packet.candidatePassages.length, 1);
    assert.equal(packet.existingAlternativeAnchors.length, 1);
    assert.equal(packet.existingAlternativeAnchors[0].id, "text-y");
  });

  test("33. the packet carries the invention-forbidding rules", () => {
    const packet = buildWeakAnchorRepairPacket(synthIssue(), [], fakeState({}));
    assert.ok(packet.rules.some((r) => /do NOT invent/i.test(r)));
    assert.ok(packet.rules.some((r) => /verbatim/i.test(r)));
  });

  test("34. the packet lists which pages/units reference the anchor", () => {
    const issue = synthIssue({ usageTargets: [{ ref: "learning/x.md", kind: "page" }, { ref: "U1", kind: "contract_unit" }] });
    const packet = buildWeakAnchorRepairPacket(issue, [], fakeState({}));
    assert.deepEqual(packet.referencedBy.pages, ["learning/x.md"]);
    assert.deepEqual(packet.referencedBy.unitIds, ["U1"]);
  });
});

// ===========================================================================
// Part 8 — independent verification
// ===========================================================================

describe("Part 8 — verifyWeakAnchorRepairDecision (independent, no invention)", () => {
  const setup = (dir, mode = "strong") => {
    buildGarden(dir, { mode });
    const state = buildFinalGardenState(dir, "test-2");
    const [issue] = collectWeakAnchorRepairIssues(state);
    const cands = findAnchorRepairCandidates(dir, issue, state);
    const packet = buildWeakAnchorRepairPacket(issue, cands, state);
    return { state, issue, cands, packet };
  };

  test("35. a present + relevant excerpt verifies ok", () =>
    withTempGarden((dir) => {
      const { state, issue, packet } = setup(dir);
      const decision = { issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, decision: "reground_from_source", confidence: "high", reason: "x", exactText: STRONG, sourceId: "src", page: 2, origin: "chatmock" };
      const v = verifyWeakAnchorRepairDecision(dir, issue, decision, packet, state);
      assert.equal(v.ok, true);
      assert.equal(v.resolvesBlocker, true);
    }));

  test("36. a fabricated excerpt (absent from source) is rejected", () =>
    withTempGarden((dir) => {
      const { state, issue, packet } = setup(dir);
      const decision = { issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, decision: "reground_from_source", confidence: "high", reason: "x", exactText: "This fabricated sentence appears nowhere in the source documents whatsoever.", origin: "chatmock" };
      const v = verifyWeakAnchorRepairDecision(dir, issue, decision, packet, state);
      assert.equal(v.ok, false);
    }));

  test("37. a decision targeting a different anchor is rejected", () =>
    withTempGarden((dir) => {
      const { state, issue, packet } = setup(dir);
      const decision = { issueIdentity: issue.stableIdentity, anchorId: "text-some-other", decision: "reground_from_source", confidence: "high", reason: "x", exactText: STRONG, origin: "chatmock" };
      const v = verifyWeakAnchorRepairDecision(dir, issue, decision, packet, state);
      assert.equal(v.ok, false);
      assert.equal(v.checks.targetsIssueAnchor, false);
    }));

  test("38. a replacement to an id we did not offer is rejected", () =>
    withTempGarden((dir) => {
      const { state, issue, packet } = setup(dir, "existingRepl");
      const decision = { issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, decision: "replace_with_existing_anchor", confidence: "high", reason: "x", replacementAnchorId: "text-not-offered", origin: "chatmock" };
      const v = verifyWeakAnchorRepairDecision(dir, issue, decision, packet, state);
      assert.equal(v.ok, false);
      assert.equal(v.checks.replacementKnown, false);
    }));

  test("39. reject_no_grounding is structurally valid but does not resolve the blocker", () =>
    withTempGarden((dir) => {
      const { state, issue, packet } = setup(dir);
      const decision = { issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, decision: "reject_no_grounding", confidence: "low", reason: "nothing supports it", origin: "chatmock" };
      const v = verifyWeakAnchorRepairDecision(dir, issue, decision, packet, state);
      assert.equal(v.ok, true);
      assert.equal(v.resolvesBlocker, false);
    }));

  test("40. an offered, registered, compatible replacement verifies ok", () =>
    withTempGarden((dir) => {
      const { state, issue, cands, packet } = setup(dir, "existingRepl");
      const existing = cands.find((c) => c.kind === "existing_anchor");
      assert.ok(existing, "fixture must offer an existing-anchor candidate");
      const decision = { issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, decision: "replace_with_existing_anchor", confidence: "high", reason: "x", replacementAnchorId: existing.replacementAnchorId, origin: "chatmock" };
      const v = verifyWeakAnchorRepairDecision(dir, issue, decision, packet, state);
      assert.equal(v.ok, true);
    }));
});

// ===========================================================================
// Part 9 — atomic application (commit only if blockers drop)
// ===========================================================================

describe("Part 9 — applyVerifiedWeakAnchorDecision", () => {
  test("41. a verified reground reduces the blocker count and clears the anchor", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const state = buildFinalGardenState(dir, "test-2");
      const [issue] = collectWeakAnchorRepairIssues(state);
      const cands = findAnchorRepairCandidates(dir, issue, state);
      const packet = buildWeakAnchorRepairPacket(issue, cands, state);
      const decision = { issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, decision: "reground_from_source", confidence: "high", reason: "x", exactText: cands[0].exactText, sourceId: cands[0].sourceId, page: cands[0].page, origin: "deterministic" };
      const v = verifyWeakAnchorRepairDecision(dir, issue, decision, packet, state);
      const app = applyVerifiedWeakAnchorDecision(dir, "test-2", issue, decision, v, state);
      assert.equal(app.applied, true);
      assert.ok(app.blockersAfter < app.blockersBefore);
      assert.equal(activeWeakAnchorBlockerCount(buildFinalGardenState(dir, "test-2")), 0);
    }));

  test("42. a decision whose verification failed is never applied", () =>
    withTempGarden((dir) => {
      buildGarden(dir, { mode: "strong" });
      const state = buildFinalGardenState(dir, "test-2");
      const [issue] = collectWeakAnchorRepairIssues(state);
      const badVerification = { ok: false, resolvesBlocker: false, issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, checks: { targetsIssueAnchor: true }, reason: "bad" };
      const decision = { issueIdentity: issue.stableIdentity, anchorId: issue.anchorId, decision: "reground_from_source", confidence: "high", reason: "x", exactText: STRONG, origin: "chatmock" };
      const app = applyVerifiedWeakAnchorDecision(dir, "test-2", issue, decision, badVerification, state);
      assert.equal(app.applied, false);
      assert.equal(activeWeakAnchorBlockerCount(buildFinalGardenState(dir, "test-2")), 1);
    }));
});

// ===========================================================================
// Part 10 — the bounded loop
// ===========================================================================

describe("Part 10 — runWeakAnchorSelfHealingLoop (deterministic-first / ChatMock-second)", () => {
  test("43. deterministic-only: a grounded anchor is repaired with zero ChatMock calls", async () =>
    withTempGarden(async (dir) => {
      buildGarden(dir, { mode: "strong" });
      const result = await runWeakAnchorSelfHealingLoop(dir, "test-2", {});
      assert.equal(result.deterministicRepairs, 1);
      assert.equal(result.totalChatMockCalls, 0);
      assert.equal(result.publishReady, true);
      assert.equal(activeWeakAnchorBlockerCount(buildFinalGardenState(dir, "test-2")), 0);
    }));

  test("44. ambiguity escalates to ChatMock and a verified decision repairs it", async () =>
    withTempGarden(async (dir) => {
      buildGarden(dir, { mode: "twoStrong" });
      let calls = 0;
      const model = (packet) => {
        calls += 1;
        return { issueIdentity: packet.issueIdentity, anchorId: packet.anchor.id, decision: "reground_from_source", confidence: "high", reason: "picks first", exactText: packet.candidatePassages[0].exactText, sourceId: packet.candidatePassages[0].sourceId, page: packet.candidatePassages[0].page };
      };
      const result = await runWeakAnchorSelfHealingLoop(dir, "test-2", { anchorRepairModel: model });
      assert.equal(result.deterministicRepairs, 0);
      assert.equal(calls, 1);
      assert.equal(result.chatMockRepairs, 1);
      assert.equal(result.publishReady, true);
    }));

  test("45. an UNUSED weak anchor never consumes a ChatMock call", async () =>
    withTempGarden(async (dir) => {
      buildGarden(dir, { mode: "unusedOnly" });
      let calls = 0;
      const model = () => { calls += 1; return null; };
      const result = await runWeakAnchorSelfHealingLoop(dir, "test-2", { anchorRepairModel: model });
      assert.equal(calls, 0);
      assert.equal(result.totalChatMockCalls, 0);
      assert.equal(result.publishReady, true);
    }));

  test("46. an inventing model never publishes — the anchor stays blocking", async () =>
    withTempGarden(async (dir) => {
      buildGarden(dir, { mode: "twoStrong" });
      const model = (packet) => ({ issueIdentity: packet.issueIdentity, anchorId: packet.anchor.id, decision: "reground_from_source", confidence: "high", reason: "fabricated", exactText: "A fabricated excerpt that is nowhere in the source at all whatsoever." });
      const result = await runWeakAnchorSelfHealingLoop(dir, "test-2", { anchorRepairModel: model });
      assert.equal(result.chatMockRepairs, 0);
      assert.equal(result.publishReady, false);
      assert.deepEqual(result.unresolvedActiveAnchorIds, ["text-active-weak-anchor"]);
    }));

  test("47. the total ChatMock-call budget is respected", async () =>
    withTempGarden(async (dir) => {
      buildGarden(dir, { mode: "twoStrong" });
      let calls = 0;
      const model = () => { calls += 1; return null; };
      await runWeakAnchorSelfHealingLoop(dir, "test-2", { anchorRepairModel: model, maxTotalChatMockCalls: 1, maxRounds: 3 });
      assert.ok(calls <= 1, `expected <= 1 call, got ${calls}`);
    }));

  test("48. ChatMock throwing marks the critic unavailable and stops the budget", async () =>
    withTempGarden(async (dir) => {
      buildGarden(dir, { mode: "twoStrong" });
      const model = () => { throw new Error("ChatMock 502"); };
      const result = await runWeakAnchorSelfHealingLoop(dir, "test-2", { anchorRepairModel: model });
      assert.equal(result.criticAvailable, false);
      assert.equal(result.publishReady, false);
      assert.equal(result.totalChatMockCalls, 1);
    }));

  test("49. a deterministic-only run with no model leaves ambiguous anchors unresolved (never guesses)", async () =>
    withTempGarden(async (dir) => {
      buildGarden(dir, { mode: "twoStrong" });
      const result = await runWeakAnchorSelfHealingLoop(dir, "test-2", {});
      assert.equal(result.deterministicRepairs, 0);
      assert.equal(result.publishReady, false);
    }));
});

// ===========================================================================
// Part 13 — reports
// ===========================================================================

describe("Part 13 — writeWeakAnchorSelfHealingReports", () => {
  test("50. writes both the JSON and Markdown reports", () =>
    withTempGarden(async (dir) => {
      buildGarden(dir, { mode: "strong" });
      const result = await runWeakAnchorSelfHealingLoop(dir, "test-2", {});
      const changed = writeWeakAnchorSelfHealingReports(dir, result);
      assert.ok(fs.existsSync(path.join(dir, ".breadboard", "weak-anchor-self-healing.json")));
      assert.ok(fs.existsSync(path.join(dir, ".breadboard", "weak-anchor-self-healing.md")));
      assert.ok(changed.length >= 1);
      const md = fs.readFileSync(path.join(dir, ".breadboard", "weak-anchor-self-healing.md"), "utf-8");
      assert.match(md, /Weak-Anchor Self-Healing/);
    }));
});

// ===========================================================================
// Parts 12 & 14 — final acceptance
// ===========================================================================

describe("Parts 12 & 14 — decideFinalAcceptance", () => {
  const result = (over) => ({
    gardenSlug: "test-2",
    rounds: [],
    totalChatMockCalls: 0,
    deterministicRepairs: 0,
    chatMockRepairs: 0,
    resolvedAnchorIds: [],
    unresolvedActiveAnchorIds: [],
    criticAvailable: true,
    criticRequested: false,
    publishReady: true,
    reason: "",
    ...over,
  });

  test("51. zero unresolved active anchors → accepted / publishReady", () => {
    const d = decideFinalAcceptance(result({ unresolvedActiveAnchorIds: [] }));
    assert.equal(d.publishReady, true);
    assert.equal(d.primaryReason, "accepted");
    assert.equal(d.unresolvedActiveAnchorCount, 0);
  });

  test("52. unresolved anchors with critic UNAVAILABLE → critic_unavailable_with_unresolved_semantic_issues (draft)", () => {
    const d = decideFinalAcceptance(result({ unresolvedActiveAnchorIds: ["text-a", "text-b"], criticAvailable: false, publishReady: false }));
    assert.equal(d.publishReady, false);
    assert.equal(d.primaryReason, "critic_unavailable_with_unresolved_semantic_issues");
    assert.equal(d.criticAvailable, false);
    assert.equal(d.unresolvedActiveAnchorCount, 2);
  });

  test("53. unresolved anchors with critic available → unresolved_active_weak_anchors (draft)", () => {
    const d = decideFinalAcceptance(result({ unresolvedActiveAnchorIds: ["text-a"], criticAvailable: true, publishReady: false }));
    assert.equal(d.publishReady, false);
    assert.equal(d.primaryReason, "unresolved_active_weak_anchors");
    assert.equal(d.unresolvedActiveAnchorCount, 1);
  });
});
