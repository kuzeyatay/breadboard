import { validateFormulaAssignment } from "../formula-assignment.ts";
import { stableGardenIssueId } from "./issue-identity.ts";
import type { GardenIssue, GardenIssueBase, GardenIssueRepairClass, GardenIssueSeverity, GardenIssueTarget } from "./issues.ts";
import type { GardenBuildStage, GardenBuildState } from "./types.ts";

function issue(input: {
  type: GardenIssue["type"];
  severity?: GardenIssueSeverity;
  repairClass?: GardenIssueRepairClass;
  stage?: GardenBuildStage;
  target: GardenIssueTarget;
  evidence: Record<string, unknown>;
  detectedBy: string;
}): GardenIssue {
  const base: Omit<GardenIssueBase, "issueId"> = {
    type: input.type,
    severity: input.severity ?? "blocking",
    repairClass: input.repairClass ?? "deterministic",
    stage: input.stage ?? "repair",
    target: input.target,
    evidence: input.evidence,
    detectedBy: [input.detectedBy],
  };
  return { ...base, issueId: stableGardenIssueId(base) } as GardenIssue;
}

export function validateGardenBuildInvariants(state: GardenBuildState): GardenIssue[] {
  const issues: GardenIssue[] = [];
  const pushMissing = (type: GardenIssue["type"], target: GardenIssueTarget, category: string, detectedBy = "canonical_invariants") => {
    issues.push(issue({ type, target, evidence: { semanticCategory: category }, detectedBy }));
  };

  if (Object.keys(state.units).length === 0) pushMissing("unit_page_mapping", {}, "no_active_learning_units");
  if (Object.keys(state.pages).length === 0) pushMissing("unit_page_mapping", {}, "no_active_learner_pages");

  for (const section of Object.values(state.sections)) {
    for (const unitId of section.unitIds) if (!state.units[unitId]) pushMissing("unit_page_mapping", { sectionId: section.id, unitId }, "section_references_missing_unit");
  }
  for (const unit of Object.values(state.units)) {
    const page = state.pages[unit.pageId];
    if (!page || page.unitId !== unit.id) pushMissing("unit_page_mapping", { unitId: unit.id, pageId: unit.pageId }, "unit_page_not_bidirectional");
    if (!state.sections[unit.sectionId]) pushMissing("unit_page_mapping", { unitId: unit.id, sectionId: unit.sectionId }, "unit_section_missing");
    for (const anchorId of [...unit.sourceAnchorIds, ...unit.sourceVisualAnchorIds]) {
      if (!state.sourceAnchors[anchorId]) pushMissing("missing_source_anchor", { anchorId, unitId: unit.id }, "active_anchor_missing");
    }
    for (const conceptId of [...unit.prerequisiteConceptIds, ...unit.primaryConceptIds, ...unit.supportingConceptIds]) {
      if (!state.concepts[conceptId]) pushMissing("concept_reference", { conceptId, unitId: unit.id, pageId: unit.pageId }, "unit_concept_missing");
    }
    for (const formulaAssignmentId of unit.formulaAssignmentIds) {
      const assignment = state.formulaAssignments[formulaAssignmentId];
      if (!assignment || assignment.unitId !== unit.id || assignment.pageId !== unit.pageId) {
        pushMissing("formula_usage_projection", { formulaAssignmentId, unitId: unit.id, pageId: unit.pageId }, "unit_formula_assignment_missing_or_misdirected");
      }
    }
  }
  for (const page of Object.values(state.pages)) {
    const unit = state.units[page.unitId];
    if (!unit || unit.pageId !== page.id) pushMissing("unit_page_mapping", { unitId: page.unitId, pageId: page.id }, "page_unit_not_bidirectional");
    for (const visualId of page.embeddedVisualIds) if (!state.visuals[visualId]) pushMissing("visual_grounding", { pageId: page.id, visualId }, "embedded_visual_missing");
    for (const entry of page.formulaEntries) {
      if (entry.sourceAnchorId && !state.sourceAnchors[entry.sourceAnchorId]) pushMissing("formula_usage_projection", { pageId: page.id, formulaAnchorId: entry.sourceAnchorId }, "page_formula_anchor_missing");
      if (entry.kind === "worked_example" && !entry.basedOnFormulaAnchorId) pushMissing("formula_lineage", { pageId: page.id }, "worked_example_lineage_missing");
    }
  }
  for (const claim of Object.values(state.claims)) {
    if (!state.pages[claim.pageId] || state.pages[claim.pageId]?.unitId !== claim.unitId) pushMissing("claim_page_mapping", { claimId: claim.id, unitId: claim.unitId, pageId: claim.pageId }, "claim_ownership_invalid");
    for (const conceptId of [claim.subjectConceptId, claim.objectConceptId, ...claim.conceptIds].filter(Boolean) as string[]) {
      if (!state.concepts[conceptId]) pushMissing("concept_reference", { claimId: claim.id, conceptId }, "claim_concept_missing");
    }
    for (const anchorId of [...claim.evidenceAnchorIds, ...claim.derivationAnchorIds]) if (!state.sourceAnchors[anchorId]) pushMissing("missing_source_anchor", { claimId: claim.id, anchorId }, "claim_anchor_missing");
  }
  for (const visual of Object.values(state.visuals)) {
    if (visual.status === "unresolved") pushMissing("visual_grounding", { visualId: visual.id, pageId: visual.pageId }, "visual_unresolved");
    if (visual.pageId && !state.pages[visual.pageId]) pushMissing("visual_grounding", { visualId: visual.id, pageId: visual.pageId }, "visual_page_missing");
    for (const anchorId of [...visual.sourceAnchorIds, ...visual.textAnchorIds]) if (!state.sourceAnchors[anchorId]) pushMissing("missing_source_anchor", { visualId: visual.id, anchorId }, "visual_anchor_missing");
  }
  for (const assignment of Object.values(state.formulaAssignments)) {
    const verdict = validateFormulaAssignment(assignment.identity, assignment.requirement);
    if (
      !state.sourceAnchors[assignment.formulaAnchorId]
      || !state.units[assignment.unitId]
      || !state.pages[assignment.pageId]
      || verdict.hardRejectionReasons.length > 0
    ) {
      const base: Omit<GardenIssueBase, "issueId"> = {
        type: "formula_assignment_family_mismatch", severity: "blocking", repairClass: "deterministic_then_model",
        stage: "repair", target: { formulaAssignmentId: assignment.id, formulaAnchorId: assignment.formulaAnchorId, unitId: assignment.unitId, pageId: assignment.pageId },
        evidence: {
          verifiedFormulaFamily: String(assignment.identity.family), requiredFamilies: assignment.requirement.requiredFamilies,
          acceptedRelatedFamilies: assignment.requirement.acceptedRelatedFamilies, compatibilityScore: assignment.compatibility.totalScore,
          semanticCategory: "formula_assignment_incompatible", hardRejectionReasons: verdict.hardRejectionReasons,
        }, detectedBy: ["canonical_invariants"],
      };
      issues.push({ ...base, issueId: stableGardenIssueId(base) } as GardenIssue);
    }
  }
  return issues;
}

export function canonicalBlockingIssues(state: GardenBuildState): GardenIssue[] {
  return validateGardenBuildInvariants(state).filter((entry) => entry.severity === "blocking");
}
