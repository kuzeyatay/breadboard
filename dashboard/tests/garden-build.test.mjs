import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";

import { deriveUnitFormulaRequirement, validateFormulaAssignment } from "../src/lib/formula-assignment.ts";
import { fingerprintGardenBuildState } from "../src/lib/garden-build/fingerprint.ts";
import { formulaAssignmentId, pageIdForUnit, sectionIdForUnitMembership } from "../src/lib/garden-build/ids.ts";
import { mergeGardenIssues, stableGardenIssueId } from "../src/lib/garden-build/issue-identity.ts";
import { legacyFinalizeProblemsToIssues } from "../src/lib/garden-build/issue-adapters.ts";
import { importLegacyGardenBuildState } from "../src/lib/garden-build/legacy-import.ts";
import { learnBuildStateMode } from "../src/lib/garden-build/mode.ts";
import { compareCanonicalParity } from "../src/lib/garden-build/parity.ts";
import { buildGardenPathPlan } from "../src/lib/garden-build/path-plan.ts";
import { handlerForGardenIssue } from "../src/lib/garden-build/repair-dispatcher.ts";
import { proposeCanonicalRepairs } from "../src/lib/garden-build/repair-dispatcher.ts";
import { runCanonicalGardenShadowBuild } from "../src/lib/garden-build/shadow.ts";
import { createAcceptedGardenSnapshot, isDeepFrozen } from "../src/lib/garden-build/snapshot.ts";
import { createGardenBuildState, refreshGardenBuildFingerprint } from "../src/lib/garden-build/state.ts";
import { applyGardenBuildTransaction } from "../src/lib/garden-build/transactions.ts";
import { validateGardenBuildOperation } from "../src/lib/garden-build/operation-validation.ts";
import { renderAcceptedGardenSnapshot } from "../src/lib/garden-renderer/render-garden.ts";
import { validateRenderedGardenProjection } from "../src/lib/garden-renderer/projection-validation.ts";

function identity(anchorId = "S1.P1.E1", family = "energy") {
  return {
    anchorId, sourceId: "S1", page: 1, canonicalText: "E = n c", title: "Energy cost", caption: "Energy cost", family,
    evidence: { formulaText: "E = n c", title: "Energy cost", caption: "Energy cost", sourceContext: "Energy cost is the total operation count times cost.", detectedVariables: ["E", "n", "c"], detectedTerms: ["energy cost"], familyScores: { [family]: 1 }, selectedFamily: family, confidence: "high", provenance: "exact_formula_text", reason: "fixture" },
    verified: true, problems: [],
  };
}

function contractUnit() {
  return {
    id: "U1", title: "Energy Cost", role: "formula", learningQuestion: "How is energy cost calculated?", prerequisiteConcepts: [], newConcepts: ["energy cost"],
    sourceAnchors: ["S1.P1.E1"], sourceFigures: [], sourceFormulas: [{ id: "S1.P1.E1", teachingGoal: "Define energy cost", termsToDefine: ["energy"], placement: "before_example" }],
    sourceTables: [], zettelNotes: [], semanticConcepts: [{ slug: "energy-cost", preferredLabel: "Energy cost", role: "primary", aliases: [], evidenceAnchors: ["S1.P1.E1"] }], knowledgeClaims: [], mustNotRepeat: [], expectedWordRange: [300, 500],
  };
}

function canonicalState(topicTitle = "Energy Systems") {
  const unitContract = contractUnit();
  const formula = identity();
  const requirement = deriveUnitFormulaRequirement(unitContract);
  const compatibility = validateFormulaAssignment(formula, requirement, unitContract);
  const state = createGardenBuildState({ buildId: "build:test", gardenId: "test", gardenSlug: "test", topicTitle, sourceSetHash: "source-hash", stage: "repair" });
  const sectionId = sectionIdForUnitMembership(["U1"]);
  const pageId = pageIdForUnit("U1");
  const assignmentId = formulaAssignmentId(formula.anchorId, "U1");
  state.sources.S1 = { id: "S1", title: "Source", status: "active", provenance: {} };
  state.sourceAnchors[formula.anchorId] = { id: formula.anchorId, sourceId: "S1", kind: "formula", title: formula.title, semanticSummary: formula.title, conceptKeywords: ["energy"], page: 1, exactText: formula.canonicalText, formulaIdentity: formula, status: "verified", provenance: {} };
  state.sections[sectionId] = { id: sectionId, order: 0, title: "Foundations", unitIds: ["U1"] };
  state.concepts["concept:energy-cost"] = { id: "concept:energy-cost", slug: "energy-cost", preferredLabel: "Energy cost", aliases: [], description: "", broader: [], narrower: [], related: [], status: "active" };
  state.units.U1 = { id: "U1", sectionId, pageId, order: 0, title: unitContract.title, role: unitContract.role, learningQuestion: unitContract.learningQuestion, prerequisiteConceptIds: [], primaryConceptIds: ["concept:energy-cost"], supportingConceptIds: [], sourceAnchorIds: [formula.anchorId], sourceVisualAnchorIds: [], formulaAssignmentIds: [assignmentId], claimIds: ["claim:u1:energy"], visualIds: [], zettelNotes: [], status: "generated" };
  state.pages[pageId] = { id: pageId, unitId: "U1", sectionId, order: 0, title: "Energy Cost", body: "# Energy Cost\n\nEnergy follows the source definition.", formulaEntries: [{ kind: "source_definition", text: formula.canonicalText, sourceAnchorId: formula.anchorId, formulaFamily: "energy" }], embeddedVisualIds: [], contentFingerprint: "body", legacyPath: "learning/old/energy.md" };
  state.claims["claim:u1:energy"] = { id: "claim:u1:energy", unitId: "U1", pageId, text: "Energy cost scales with operation count.", subjectConceptId: "concept:energy-cost", predicate: "related-to", conceptIds: ["concept:energy-cost"], evidenceAnchorIds: [formula.anchorId], derivationAnchorIds: [], status: "active" };
  state.formulaAssignments[assignmentId] = { id: assignmentId, formulaAnchorId: formula.anchorId, unitId: "U1", pageId, identity: formula, requirement, compatibility, usage: "source_definition", status: "verified", provenance: { formulaAnchorId: formula.anchorId, unitId: "U1", verifiedFamily: "energy", compatibilityScore: compatibility.totalScore, status: "verified", reason: "fixture" } };
  state.sourceCoverage.usages = [{ anchorId: formula.anchorId, pageId, unitId: "U1", mode: "formula_definition" }];
  return refreshGardenBuildFingerprint(state);
}

function issue(type, target, category, severity = "blocking") {
  const base = { type, severity, repairClass: "deterministic", stage: "repair", target, evidence: { semanticCategory: category }, detectedBy: ["fixture"] };
  return { ...base, issueId: stableGardenIssueId(base) };
}

describe("typed issues and routing", () => {
  test("stable identity ignores human-readable legacy wording", () => {
    const base = { type: "formula_usage_projection", severity: "blocking", repairClass: "deterministic", stage: "repair", target: { formulaAnchorId: "S1.P1.E1", unitId: "U1" }, detectedBy: ["x"] };
    assert.equal(stableGardenIssueId({ ...base, evidence: { semanticCategory: "wrong_family", originalProblem: "first wording" } }), stableGardenIssueId({ ...base, evidence: { semanticCategory: "wrong_family", originalProblem: "completely different wording" } }));
  });

  test("duplicate detections merge severity, evidence, and detectors", () => {
    const a = issue("visual_grounding", { visualId: "v1", pageId: "page:U1" }, "missing_anchor", "warning");
    const b = { ...a, severity: "blocking", detectedBy: ["second"], evidence: { ...a.evidence, affectedIds: ["a"] } };
    const merged = mergeGardenIssues([[a], [b]]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].severity, "blocking");
    assert.deepEqual(merged[0].detectedBy, ["fixture", "second"]);
  });

  test("legacy adapter is explicit and canonical routing uses issue.type", () => {
    const [adapted] = legacyFinalizeProblemsToIssues([{ name: "Visual grounding", status: "FAIL", problems: ["learning/old.md: wording one"] }], { pageIdByLegacyPath: { "learning/old.md": "page:U1" } });
    assert.equal(adapted.evidence.legacyStringAdapter, true);
    assert.equal(adapted.evidence.originalCheckName, "Visual grounding");
    const handler = handlerForGardenIssue({ ...adapted, type: "tag_projection", target: { unitId: "U1", pageId: "page:U1" } });
    assert.equal(handler?.issueType, "tag_projection");
  });
});

describe("stable IDs, fingerprinting, stages, and transactions", () => {
  test("section/page IDs survive title and path renames", () => {
    const state = canonicalState();
    const sectionId = Object.keys(state.sections)[0];
    const pageId = Object.keys(state.pages)[0];
    const renamed = structuredClone(state);
    renamed.sections[sectionId].title = "Renamed Foundations";
    renamed.pages[pageId].legacyPath = "learning/new/path.md";
    assert.equal(Object.keys(renamed.sections)[0], sectionId);
    assert.equal(Object.keys(renamed.pages)[0], pageId);
    assert.equal(fingerprintGardenBuildState({ ...state, pages: { [pageId]: { ...state.pages[pageId], legacyPath: "elsewhere.md" } } }), state.fingerprint);
    assert.notEqual(fingerprintGardenBuildState(renamed), state.fingerprint, "semantic title changes remain visible");
  });

  test("page body changes semantic fingerprint", () => {
    const state = canonicalState();
    const changed = structuredClone(state);
    changed.pages["page:U1"].body += " Changed.";
    assert.notEqual(fingerprintGardenBuildState(changed), state.fingerprint);
  });

  test("valid transaction commits and an idempotent operation creates no revision", () => {
    const state = canonicalState();
    const first = applyGardenBuildTransaction(state, [{ type: "set_page_body", pageId: "page:U1", body: "New body", justification: "fixture" }], { expectedStage: "repair", validateAfter: true });
    assert.equal(first.transaction.committed, true);
    assert.equal(first.state.revision, 1);
    const sectionId = Object.keys(first.state.sections)[0];
    const second = applyGardenBuildTransaction(first.state, [{ type: "rename_section", sectionId, title: first.state.sections[sectionId].title, justification: "fixture" }], { expectedStage: "repair", validateAfter: true });
    assert.equal(second.transaction.committed, true);
    assert.equal(second.state.revision, 1);
  });

  test("scope mismatch and immutable rendering stage roll back as typed issues", () => {
    const state = canonicalState();
    const assignment = Object.values(state.formulaAssignments)[0];
    const bad = applyGardenBuildTransaction(state, [{ type: "set_formula_assignment", formulaAssignment: assignment, expectedUnitId: "U2", expectedPageId: "page:U2", justification: "bad model scope" }], { expectedStage: "repair", validateAfter: true });
    assert.equal(bad.transaction.rolledBack, true);
    assert.equal(bad.transaction.issuesAfter[0].type, "illegal_stage_mutation");
    const rendering = structuredClone(state);
    rendering.stage = "rendering";
    const sectionId = Object.keys(rendering.sections)[0];
    const illegal = validateGardenBuildOperation(rendering, { type: "rename_section", sectionId, title: "No", justification: "no" }, "rendering");
    assert.equal(illegal[0].type, "illegal_stage_mutation");
  });

  test("new blockers roll a transaction back", () => {
    const state = canonicalState();
    const result = applyGardenBuildTransaction(state, [{ type: "set_unit_concepts", unitId: "U1", primaryConceptIds: ["concept:missing"], supportingConceptIds: [], justification: "invalid" }], { expectedStage: "repair", validateAfter: true });
    assert.equal(result.transaction.rolledBack, true);
    assert.equal(result.state.fingerprint, state.fingerprint);
  });

  test("wrong-family assignments cannot be made acceptable by deletion", () => {
    const state = canonicalState();
    const assignment = state.formulaAssignments["formula-assignment:S1.P1.E1:U1"];
    assignment.requirement = { ...assignment.requirement, requiredFamilies: ["latency"], acceptedRelatedFamilies: [] };
    assignment.compatibility = validateFormulaAssignment(assignment.identity, assignment.requirement);
    const mismatch = issue("formula_assignment_family_mismatch", {
      formulaAssignmentId: assignment.id,
      formulaAnchorId: assignment.formulaAnchorId,
      unitId: assignment.unitId,
      pageId: assignment.pageId,
    }, "formula_assignment_incompatible");
    mismatch.repairClass = "deterministic_then_model";
    state.issueState.active = [mismatch];
    const proposed = proposeCanonicalRepairs([mismatch], state);
    assert.deepEqual(proposed.operations, []);
    assert.equal(proposed.modelPackets.length, 1);
    assert.equal(createAcceptedGardenSnapshot(state), undefined);
  });
});

describe("snapshot, rendering, projection validation, and parity", () => {
  test("accepted snapshot is deeply immutable and path planning is ID-based", () => {
    const snapshot = createAcceptedGardenSnapshot(canonicalState(), { acceptedAt: "2026-01-01T00:00:00.000Z" });
    assert.ok(snapshot);
    assert.equal(isDeepFrozen(snapshot), true);
    const plan = buildGardenPathPlan(snapshot);
    assert.match(plan.pagePaths["page:U1"], /^learning\//);
    assert.throws(() => { snapshot.state.pages["page:U1"].body = "mutation"; }, TypeError);
  });

  test("same snapshot renders identically, removes old projections, and validates", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-render-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const one = path.join(root, "one");
    const two = path.join(root, "two");
    fs.mkdirSync(path.join(one, ".breadboard", "planning"), { recursive: true });
    fs.writeFileSync(path.join(one, ".breadboard", "planning", "Source Coverage.md"), "OLD COVERAGE");
    fs.writeFileSync(path.join(one, ".breadboard", "claims-history.json"), "OLD CLAIMS");
    const snapshot = createAcceptedGardenSnapshot(canonicalState(), { acceptedAt: "2026-01-01T00:00:00.000Z" });
    const manifestOne = await renderAcceptedGardenSnapshot(snapshot, one);
    const manifestTwo = await renderAcceptedGardenSnapshot(snapshot, two);
    assert.deepEqual(manifestOne, manifestTwo);
    assert.equal(fs.existsSync(path.join(one, ".breadboard", "claims-history.json")), false);
    assert.equal(fs.readFileSync(path.join(one, ".breadboard", "planning", "Source Coverage.md"), "utf8").includes("OLD"), false);
    assert.equal(validateRenderedGardenProjection(snapshot, one, manifestOne).passed, true);
  });

  test("projection corruption is a typed projection bug", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-projection-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const snapshot = createAcceptedGardenSnapshot(canonicalState());
    const manifest = await renderAcceptedGardenSnapshot(snapshot, root);
    const pagePath = buildGardenPathPlan(snapshot).pagePaths["page:U1"];
    fs.appendFileSync(path.join(root, ...pagePath.split("/")), "corruption");
    const validation = validateRenderedGardenProjection(snapshot, root, manifest);
    assert.equal(validation.passed, false);
    assert.equal(validation.issues[0].repairClass, "projection_bug");
    fs.rmSync(path.join(root, ...pagePath.split("/")));
    const missing = validateRenderedGardenProjection(snapshot, root, manifest);
    assert.ok(missing.issues.some((entry) => entry.type === "projection_missing_file"));
  });

  test("parity classifies path-only and semantic body changes separately", () => {
    const legacy = canonicalState();
    const repaired = structuredClone(legacy);
    repaired.pages["page:U1"].body += " semantic change";
    repaired.fingerprint = fingerprintGardenBuildState(repaired);
    const snapshot = createAcceptedGardenSnapshot(repaired);
    const report = compareCanonicalParity({ importedState: legacy, repairedState: repaired, importIssues: [], snapshot, projection: { passed: true, issues: [], checkedFiles: 1 }, legacyAccepted: true });
    assert.ok(report.differences.some((entry) => entry.category === "path_only_difference"));
    assert.ok(report.differences.some((entry) => entry.category === "semantic_difference" && entry.description.includes("body")));
  });

  test("parity reports a missing canonical page and acceptance disagreement", () => {
    const legacy = canonicalState();
    const repaired = structuredClone(legacy);
    delete repaired.pages["page:U1"];
    repaired.fingerprint = fingerprintGardenBuildState(repaired);
    const report = compareCanonicalParity({ importedState: legacy, repairedState: repaired, importIssues: [], legacyAccepted: true });
    assert.ok(report.differences.some((entry) => entry.category === "unexpected_regression" && entry.entityId === "page:U1"));
    assert.equal(report.acceptanceDisagreement, true);
  });
});

function write(root, rel, content) {
  const target = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function legacyFixture(topic = "Photosynthesis", { duplicateOldPage = false, withFormula = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-shadow-fixture-"));
  const garden = path.join(root, "fixture");
  const formula = identity();
  const unit = {
    id: "U1", title: `${topic} Foundations`, role: "core_concept", learningQuestion: `What establishes ${topic}?`, prerequisiteConcepts: [], newConcepts: ["core idea"], sourceAnchors: ["S1.P1.Intro"], sourceFigures: [], sourceFormulas: [], sourceTables: [], interactiveVisual: undefined,
    zettelNotes: [], semanticConcepts: [{ slug: "core-idea", preferredLabel: "Core idea", role: "primary", aliases: [], evidenceAnchors: ["S1.P1.Intro"] }], knowledgeClaims: [], mustNotRepeat: [], expectedWordRange: [300, 500],
  };
  if (withFormula) unit.sourceFormulas = [{ id: formula.anchorId, teachingGoal: "Define energy cost", termsToDefine: ["energy"], placement: "before_example" }];
  const assignmentProvenance = withFormula ? [{ formulaAnchorId: formula.anchorId, unitId: "U1", verifiedFamily: formula.family, compatibilityScore: 1, status: "verified", reason: "fixture provenance" }] : [];
  write(garden, ".breadboard/learning-unit-contract.json", `${JSON.stringify({ schemaVersion: 2, sourceSetHash: "fixture-hash", learningUnits: [unit], formulaAssignmentProvenance: assignmentProvenance }, null, 2)}\n`);
  write(garden, ".breadboard/source-anchors.json", `${JSON.stringify({ sourceTextConceptAnchors: [], sourceStructuralAnchors: [{ id: "S1.P1.Intro", kind: "intro", title: "Source introduction", sourceId: "S1", page: 1, exactText: "Source introduction evidence.", confidence: "high" }] }, null, 2)}\n`);
  write(garden, ".breadboard/source-visuals.json", `${JSON.stringify(withFormula ? [{ sourceVisualId: formula.anchorId, sourceId: formula.sourceId, pageNumber: formula.page, type: "equation", caption: formula.caption, usageStatus: "used" }] : [], null, 2)}\n`);
  write(garden, ".breadboard/formula-identities.json", `${JSON.stringify({ schemaVersion: 1, identities: withFormula ? [formula] : [] }, null, 2)}\n`);
  write(garden, ".breadboard/concept-registry.json", `${JSON.stringify({ schemaVersion: 1, gardenId: "fixture", sourceSetHash: "fixture-hash", concepts: [{ id: "concept:core-idea", slug: "core-idea", preferredLabel: "Core idea", aliases: [], description: "", broader: [], narrower: [], related: [], relations: [], evidenceAnchors: ["S1.P1.Intro"], status: "source-verified" }] }, null, 2)}\n`);
  const pageRel = `learning/1. Foundations/1.1 ${topic} Foundations.md`;
  const claims = [
    { id: "claim:u1:valid", text: "The core idea is supported by the source.", subject: "concept:core-idea", predicate: "related-to", conceptIds: ["concept:core-idea"], learningUnitId: "U1", pageRelPath: pageRel, evidenceAnchors: ["S1.P1.Intro"], derivationAnchors: [], status: "source-verified", connectedClaimIds: [] },
    { id: "claim:u1:stale", text: "Stale path claim.", subject: "concept:core-idea", predicate: "related-to", conceptIds: ["concept:core-idea"], learningUnitId: "U1", pageRelPath: "learning/old/missing.md", evidenceAnchors: ["S1.P1.Intro"], derivationAnchors: [], status: "source-verified", connectedClaimIds: [] },
  ];
  write(garden, ".breadboard/claims.json", `${JSON.stringify({ schemaVersion: 1, gardenId: "fixture", sourceSetHash: "fixture-hash", claims }, null, 2)}\n`);
  write(garden, "learning/_index.md", `---\ntitle: ${JSON.stringify(topic)}\n---\n\n# ${topic}\n`);
  write(garden, "learning/1. Foundations/_index.md", `---\ntitle: "Foundations"\n---\n\n# Foundations\n`);
  const projectedFormulas = withFormula ? [{ kind: "source_definition", text: formula.canonicalText, sourceAnchor: formula.anchorId, formulaFamily: formula.family }] : [];
  write(garden, pageRel, `---\ntitle: ${JSON.stringify(`${topic} Foundations`)}\ndate: "2026-01-02T00:00:00.000Z"\nlearningVersion: "learning-new"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nlearningUnitRole: "core_concept"\ntags: ["core-idea"]\nsourceAnchors: ["S1.P1.Intro"]\nsourceFormulaAnchors: ${JSON.stringify(withFormula ? [formula.anchorId] : [])}\nsourceVisualIds: []\nvisualIds: []\nformulas: ${JSON.stringify(projectedFormulas)}\n---\n\n# ${topic} Foundations\n\nSource-grounded body.\n`);
  if (duplicateOldPage) write(garden, `learning/0. Old/0.1 Old ${topic}.md`, `---\ntitle: "Old ${topic}"\ndate: "2026-01-01T00:00:00.000Z"\nlearningVersion: "learning-old"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nlearningUnitRole: "core_concept"\ntags: ["stale-tag"]\nsourceAnchors: ["S1.P1.Intro"]\nsourceFormulaAnchors: []\nsourceVisualIds: []\nvisualIds: []\nformulas: []\n---\n\n# Old\n\nOld body.\n`);
  write(garden, ".breadboard/planning/Source Coverage.md", "OLD SOURCE COVERAGE\n");
  write(garden, ".breadboard/validation-report.md", "OLD VALIDATION REPORT\n");
  return { root, garden, pageRel };
}

describe("legacy import and shadow integration", () => {
  test("imports stable entities, preserves imported formula identities, and types stale claim paths", (t) => {
    const fixture = legacyFixture("Energy Cost", { withFormula: true });
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const imported = importLegacyGardenBuildState(fixture.garden, "fixture");
    assert.equal(imported.metrics.unitsImported, 1);
    assert.equal(imported.metrics.pagesImported, 1);
    assert.equal(imported.metrics.formulaIdentitiesImported, 1);
    assert.equal(imported.metrics.formulaAssignmentsImported, 1);
    const assignment = Object.values(imported.state.formulaAssignments)[0];
    assert.equal(assignment.identity.canonicalText, identity().canonicalText);
    assert.equal(assignment.provenance.reason, "fixture provenance");
    assert.ok(imported.issues.some((entry) => entry.type === "claim_page_mapping" && entry.target.claimId === "claim:u1:stale"));
    assert.equal(imported.state.claims["claim:u1:stale"], undefined);
  });

  test("renamed duplicate pages retain provenance and select only a uniquely newest learning version", (t) => {
    const fixture = legacyFixture("Fourier Analysis", { duplicateOldPage: true });
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const imported = importLegacyGardenBuildState(fixture.garden, "fixture");
    assert.equal(imported.state.pages["page:U1"].legacyPath, fixture.pageRel);
    const duplicate = imported.issues.find((entry) => entry.evidence.semanticCategory === "superseded_legacy_page_projection");
    assert.ok(duplicate);
    assert.equal(duplicate.severity, "warning");
    assert.equal(duplicate.evidence.selectedLegacyPath, fixture.pageRel);
  });

  test("shadow repairs state only, regenerates projections, and leaves live files untouched", async (t) => {
    const fixture = legacyFixture("Contract Law");
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const beforePage = fs.readFileSync(path.join(fixture.garden, ...fixture.pageRel.split("/")), "utf8");
    const beforeCoverage = fs.readFileSync(path.join(fixture.garden, ".breadboard", "planning", "Source Coverage.md"), "utf8");
    const result = await runCanonicalGardenShadowBuild(fixture.garden, "fixture", { writeDiagnostics: true });
    assert.equal(result.accepted, true);
    assert.equal(result.projection?.passed, true);
    assert.equal(result.parity.liveGardenMutated, false);
    assert.equal(result.parity.differences.some((entry) => entry.category === "legacy_stale_state_removed"), true);
    assert.equal(fs.readFileSync(path.join(fixture.garden, ...fixture.pageRel.split("/")), "utf8"), beforePage);
    assert.equal(fs.readFileSync(path.join(fixture.garden, ".breadboard", "planning", "Source Coverage.md"), "utf8"), beforeCoverage);
    assert.equal(fs.existsSync(path.join(fixture.garden, ".breadboard", "canonical-shadow", "parity.json")), true);
  });

  test("cross-topic fixtures introduce no domain-specific canonical assumptions", () => {
    for (const topic of ["Spiking neural networks", "Photosynthesis", "French Revolution", "Contract law", "Fourier analysis", "Supply-chain management", "Unknown-domain topic"]) {
      const fixture = legacyFixture(topic);
      try {
        const imported = importLegacyGardenBuildState(fixture.garden, "fixture");
        assert.equal(Object.keys(imported.state.units).length, 1);
        assert.equal(Object.keys(imported.state.pages).length, 1);
        assert.equal(imported.issues.filter((entry) => entry.evidence.semanticCategory === "domain_specific_assumption").length, 0);
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    }
  });

  test("feature flag defaults to legacy and recognizes shadow/canonical", () => {
    assert.equal(learnBuildStateMode({}), "legacy");
    assert.equal(learnBuildStateMode({ LEARN_BUILD_STATE_MODE: "shadow" }), "shadow");
    assert.equal(learnBuildStateMode({ LEARN_BUILD_STATE_MODE: "canonical" }), "canonical");
    assert.equal(learnBuildStateMode({ LEARN_BUILD_STATE_MODE: "unknown" }), "legacy");
  });
});
