import crypto from "node:crypto";
import { contentFingerprint, fingerprintGardenBuildState } from "./fingerprint.ts";
import { buildGardenBuildIndexes } from "./indexes.ts";
import { mergeGardenIssues } from "./issue-identity.ts";
import type { GardenIssue } from "./issues.ts";
import { validateGardenBuildInvariants } from "./invariants.ts";
import { validateGardenBuildOperation } from "./operation-validation.ts";
import type { GardenBuildOperation } from "./operations.ts";
import { cloneGardenBuildState } from "./state.ts";
import type { GardenBuildStage, GardenBuildState } from "./types.ts";

export interface GardenBuildTransaction {
  transactionId: string;
  buildId: string;
  stage: GardenBuildStage;
  revisionBefore: number;
  revisionAfter?: number;
  fingerprintBefore: string;
  fingerprintAfter?: string;
  operations: GardenBuildOperation[];
  issuesBefore: GardenIssue[];
  issuesAfter: GardenIssue[];
  committed: boolean;
  rolledBack: boolean;
  reason: string;
}

function replaceAll(values: string[], oldId: string, newId: string): string[] {
  return [...new Set(values.map((value) => value === oldId ? newId : value))];
}

function mutateOwnedVisualBlock(body: string, visualId: string, replacement: string | null): string {
  const blockPattern = /```breadboard-(?:generated-)?visual\r?\n([\s\S]*?)\r?\n```/g;
  let found = false;
  const next = body.replace(blockPattern, (block, payload: string) => {
    let id = "";
    try { id = String((JSON.parse(payload) as { id?: unknown }).id ?? ""); } catch { /* malformed blocks are not claimed */ }
    if (id !== visualId) return block;
    found = true;
    return replacement ?? "";
  });
  if (replacement && !found) return `${next.replace(/\s*$/, "")}\n\n${replacement.trim()}\n`;
  return next.replace(/\n{3,}/g, "\n\n");
}

function applyOperation(state: GardenBuildState, operation: GardenBuildOperation): void {
  switch (operation.type) {
    case "replace_source_anchor": {
      const oldAnchor = state.sourceAnchors[operation.oldAnchorId];
      if (oldAnchor) oldAnchor.status = "historical";
      for (const unit of Object.values(state.units)) {
        unit.sourceAnchorIds = replaceAll(unit.sourceAnchorIds, operation.oldAnchorId, operation.newAnchorId);
        unit.sourceVisualAnchorIds = replaceAll(unit.sourceVisualAnchorIds, operation.oldAnchorId, operation.newAnchorId);
      }
      for (const claim of Object.values(state.claims)) {
        claim.evidenceAnchorIds = replaceAll(claim.evidenceAnchorIds, operation.oldAnchorId, operation.newAnchorId);
        claim.derivationAnchorIds = replaceAll(claim.derivationAnchorIds, operation.oldAnchorId, operation.newAnchorId);
      }
      for (const visual of Object.values(state.visuals)) {
        visual.sourceAnchorIds = replaceAll(visual.sourceAnchorIds, operation.oldAnchorId, operation.newAnchorId);
        visual.textAnchorIds = replaceAll(visual.textAnchorIds, operation.oldAnchorId, operation.newAnchorId);
      }
      for (const assignment of Object.values(state.formulaAssignments)) if (assignment.formulaAnchorId === operation.oldAnchorId) assignment.status = "historical";
      for (const usage of state.sourceCoverage.usages) if (usage.anchorId === operation.oldAnchorId) usage.anchorId = operation.newAnchorId;
      break;
    }
    case "update_source_anchor_evidence": {
      const anchor = state.sourceAnchors[operation.anchorId];
      if (anchor) {
        if (operation.patch.evidence && typeof operation.patch.evidence === "object") anchor.evidence = operation.patch.evidence as typeof anchor.evidence;
        if (operation.patch.relevance && typeof operation.patch.relevance === "object") anchor.relevance = operation.patch.relevance as typeof anchor.relevance;
        if (typeof operation.patch.status === "string") anchor.status = operation.patch.status as typeof anchor.status;
        if (typeof operation.patch.exactText === "string") anchor.exactText = operation.patch.exactText;
        if (typeof operation.patch.sourceId === "string") anchor.sourceId = operation.patch.sourceId;
        if (typeof operation.patch.page === "number") anchor.page = operation.patch.page;
        anchor.provenance = { ...anchor.provenance, canonicalRepair: operation.justification };
      }
      break;
    }
    case "set_formula_assignment": {
      const assignment = structuredClone(operation.formulaAssignment);
      state.formulaAssignments[assignment.id] = assignment;
      const unit = state.units[assignment.unitId];
      if (unit && !unit.formulaAssignmentIds.includes(assignment.id)) unit.formulaAssignmentIds.push(assignment.id);
      break;
    }
    case "remove_formula_assignment": {
      delete state.formulaAssignments[operation.formulaAssignmentId];
      for (const unit of Object.values(state.units)) unit.formulaAssignmentIds = unit.formulaAssignmentIds.filter((id) => id !== operation.formulaAssignmentId);
      break;
    }
    case "set_formula_lineage": {
      const entry = state.pages[operation.pageId]?.formulaEntries[operation.entryIndex];
      if (entry) { entry.basedOnFormulaAnchorId = operation.basedOnFormulaAnchorId; if (operation.formulaFamily) entry.formulaFamily = operation.formulaFamily; }
      break;
    }
    case "reclassify_formula_entry": {
      const entry = state.pages[operation.pageId]?.formulaEntries[operation.entryIndex];
      if (entry) entry.kind = operation.kind;
      break;
    }
    case "set_unit_concepts": {
      const unit = state.units[operation.unitId];
      if (unit) {
        unit.primaryConceptIds = [...new Set(operation.primaryConceptIds)];
        unit.supportingConceptIds = [...new Set(operation.supportingConceptIds)];
        if (operation.prerequisiteConceptIds) unit.prerequisiteConceptIds = [...new Set(operation.prerequisiteConceptIds)];
      }
      break;
    }
    case "replace_claims": {
      for (const [id, claim] of Object.entries(state.claims)) if (claim.unitId === operation.unitId) delete state.claims[id];
      for (const claim of operation.claims) state.claims[claim.id] = structuredClone(claim);
      const unit = state.units[operation.unitId];
      if (unit) unit.claimIds = operation.claims.map((claim) => claim.id).sort();
      break;
    }
    case "set_page_body": {
      const page = state.pages[operation.pageId];
      if (page) { page.body = operation.body; page.contentFingerprint = contentFingerprint(operation.body); }
      break;
    }
    case "set_page_formula_entries": {
      const page = state.pages[operation.pageId];
      if (page) page.formulaEntries = structuredClone(operation.formulaEntries);
      break;
    }
    case "set_visual_grounding": {
      const visual = state.visuals[operation.visualId];
      if (visual) {
        visual.pageId = operation.pageId; visual.unitId = operation.unitId;
        visual.sourceAnchorIds = [...new Set(operation.sourceAnchorIds)]; visual.textAnchorIds = [...new Set(operation.textAnchorIds)]; visual.status = operation.status;
      }
      if (operation.pageId && state.pages[operation.pageId] && !state.pages[operation.pageId].embeddedVisualIds.includes(operation.visualId)) state.pages[operation.pageId].embeddedVisualIds.push(operation.visualId);
      if (operation.unitId && state.units[operation.unitId] && !state.units[operation.unitId].visualIds.includes(operation.visualId)) state.units[operation.unitId].visualIds.push(operation.visualId);
      break;
    }
    case "set_visual_type": {
      const visual = state.visuals[operation.visualId];
      if (visual) visual.type = operation.visualType;
      break;
    }
    case "set_visual_body": {
      const visual = state.visuals[operation.visualId];
      if (visual) visual.body = operation.body;
      break;
    }
    case "replace_page_visual_block": {
      const page = state.pages[operation.pageId];
      if (page) {
        page.body = mutateOwnedVisualBlock(page.body, operation.visualId, operation.block);
        page.contentFingerprint = contentFingerprint(page.body);
        if (!page.embeddedVisualIds.includes(operation.visualId)) page.embeddedVisualIds.push(operation.visualId);
      }
      const visual = state.visuals[operation.visualId];
      if (visual && page) {
        visual.pageId = page.id;
        visual.unitId = page.unitId;
        if (visual.status === "unresolved" || visual.status === "omitted") visual.status = "grounded";
      }
      if (page && state.units[page.unitId] && !state.units[page.unitId].visualIds.includes(operation.visualId)) state.units[page.unitId].visualIds.push(operation.visualId);
      break;
    }
    case "remove_page_visual": {
      const page = state.pages[operation.pageId];
      if (page) {
        page.body = mutateOwnedVisualBlock(page.body, operation.visualId, null);
        page.contentFingerprint = contentFingerprint(page.body);
        page.embeddedVisualIds = page.embeddedVisualIds.filter((id) => id !== operation.visualId);
        const unit = state.units[page.unitId];
        if (unit) unit.visualIds = unit.visualIds.filter((id) => id !== operation.visualId);
      }
      const visual = state.visuals[operation.visualId];
      if (visual) visual.status = "omitted";
      break;
    }
    case "rename_section": { const section = state.sections[operation.sectionId]; if (section) section.title = operation.title; break; }
    case "move_unit_to_section": {
      const unit = state.units[operation.unitId];
      const from = state.sections[operation.fromSectionId];
      const to = state.sections[operation.toSectionId];
      if (unit && from && to && unit.sectionId === from.id) {
        from.unitIds = from.unitIds.filter((id) => id !== unit.id);
        if (!to.unitIds.includes(unit.id)) to.unitIds.push(unit.id);
        unit.sectionId = to.id;
        const page = state.pages[unit.pageId];
        if (page) page.sectionId = to.id;
      }
      break;
    }
    case "mark_entity_historical": {
      if (operation.entityType === "sourceAnchor" && state.sourceAnchors[operation.entityId]) state.sourceAnchors[operation.entityId].status = "historical";
      if (operation.entityType === "unit" && state.units[operation.entityId]) state.units[operation.entityId].status = "historical";
      if (operation.entityType === "claim" && state.claims[operation.entityId]) state.claims[operation.entityId].status = "historical";
      if (operation.entityType === "visual" && state.visuals[operation.entityId]) state.visuals[operation.entityId].status = "historical";
      if (operation.entityType === "formulaAssignment" && state.formulaAssignments[operation.entityId]) state.formulaAssignments[operation.entityId].status = "historical";
      break;
    }
  }
}

function operationAddressesIssue(operation: GardenBuildOperation, issue: GardenIssue): boolean {
  switch (operation.type) {
    case "replace_source_anchor":
      return issue.target.anchorId === operation.oldAnchorId;
    case "update_source_anchor_evidence":
      return issue.target.anchorId === operation.anchorId && (issue.type === "weak_source_anchor" || issue.type === "source_anchor_relevance");
    case "set_formula_assignment":
      return issue.target.formulaAnchorId === operation.formulaAssignment.formulaAnchorId && issue.target.unitId === operation.formulaAssignment.unitId;
    case "remove_formula_assignment":
      return issue.target.formulaAssignmentId === operation.formulaAssignmentId;
    case "set_formula_lineage": case "reclassify_formula_entry":
      return issue.type === "formula_lineage" && issue.target.pageId === operation.pageId;
    case "set_unit_concepts":
      return (issue.type === "tag_projection" || issue.type === "concept_reference") && issue.target.unitId === operation.unitId;
    case "replace_claims":
      return issue.type === "claim_page_mapping" && issue.target.unitId === operation.unitId;
    case "set_page_body":
      return issue.target.pageId === operation.pageId && ["section_semantic", "section_semantic_mismatch", "scaffold_prose", "repeated_opening", "critic_semantic"].includes(issue.type);
    case "set_page_formula_entries":
      return issue.target.pageId === operation.pageId && ["formula_lineage", "formula_lineage_missing", "formula_usage_projection"].includes(issue.type);
    case "set_visual_grounding":
      return ["visual_grounding", "visual_grounding_mismatch", "missing_planned_visual", "contract_page_anchor_mismatch"].includes(issue.type) && issue.target.visualId === operation.visualId;
    case "set_visual_type": case "set_visual_body":
      return ["visual_type_mismatch", "missing_planned_visual", "duplicate_visual_signature", "visual_grounding_mismatch"].includes(issue.type) && issue.target.visualId === operation.visualId;
    case "replace_page_visual_block": case "remove_page_visual":
      return issue.target.pageId === operation.pageId && ["missing_planned_visual", "visual_type_mismatch", "duplicate_visual_signature", "visual_grounding", "visual_grounding_mismatch"].includes(issue.type);
    case "rename_section":
      return ["section_semantic", "section_semantic_mismatch"].includes(issue.type) && issue.target.sectionId === operation.sectionId;
    case "move_unit_to_section":
      return ["section_semantic", "section_semantic_mismatch"].includes(issue.type) && issue.target.unitId === operation.unitId;
    case "mark_entity_historical":
      return issue.target.anchorId === operation.entityId || issue.target.claimId === operation.entityId || issue.target.visualId === operation.entityId || issue.target.formulaAssignmentId === operation.entityId || issue.target.unitId === operation.entityId;
  }
}

export function applyGardenBuildTransaction(
  state: GardenBuildState,
  operations: GardenBuildOperation[],
  options: { expectedStage: GardenBuildStage; validateAfter: boolean; requireBlockerDecrease?: boolean },
): { state: GardenBuildState; transaction: GardenBuildTransaction } {
  const fingerprintBefore = fingerprintGardenBuildState(state);
  const issuesBefore = mergeGardenIssues([state.issueState.active, state.issueState.warnings, validateGardenBuildInvariants(state)]);
  const validationIssues = mergeGardenIssues(operations.map((operation) => validateGardenBuildOperation(state, operation, options.expectedStage)));
  const transactionId = `transaction:${crypto.createHash("sha1").update(`${state.buildId}:${state.revision}:${JSON.stringify(operations)}`).digest("hex").slice(0, 16)}`;
  const base: GardenBuildTransaction = {
    transactionId, buildId: state.buildId, stage: state.stage, revisionBefore: state.revision,
    fingerprintBefore, operations: structuredClone(operations), issuesBefore, issuesAfter: validationIssues,
    committed: false, rolledBack: false, reason: "pending",
  };
  if (validationIssues.some((issue) => issue.severity === "blocking")) {
    return { state, transaction: { ...base, rolledBack: true, reason: "operation scope validation failed" } };
  }
  const candidate = cloneGardenBuildState(state);
  for (const operation of operations) applyOperation(candidate, operation);
  candidate.issueState.active = candidate.issueState.active.filter((issue) => !operations.some((operation) => operationAddressesIssue(operation, issue)));
  candidate.issueState.warnings = candidate.issueState.warnings.filter((issue) => !operations.some((operation) => operationAddressesIssue(operation, issue)));
  buildGardenBuildIndexes(candidate);
  const candidateFingerprint = fingerprintGardenBuildState(candidate);
  if (candidateFingerprint === fingerprintBefore) {
    return { state, transaction: { ...base, revisionAfter: state.revision, fingerprintAfter: fingerprintBefore, committed: true, issuesAfter: issuesBefore, reason: "idempotent; no semantic change" } };
  }
  const issuesAfter = options.validateAfter ? mergeGardenIssues([candidate.issueState.active, candidate.issueState.warnings, validateGardenBuildInvariants(candidate)]) : mergeGardenIssues([candidate.issueState.active, candidate.issueState.warnings]);
  const blockersBefore = issuesBefore.filter((issue) => issue.severity === "blocking").length;
  const blockersAfter = issuesAfter.filter((issue) => issue.severity === "blocking").length;
  const newBlockerIds = new Set(issuesBefore.filter((issue) => issue.severity === "blocking").map((issue) => issue.issueId));
  const introducedBlockers = issuesAfter.filter((issue) => issue.severity === "blocking" && !newBlockerIds.has(issue.issueId));
  if (introducedBlockers.length > 0 || (options.requireBlockerDecrease && blockersAfter >= blockersBefore)) {
    return { state, transaction: { ...base, rolledBack: true, issuesAfter, fingerprintAfter: candidateFingerprint, reason: introducedBlockers.length ? "transaction introduced canonical blockers" : "transaction did not decrease blocker count" } };
  }
  candidate.revision += 1;
  candidate.issueState.active = issuesAfter.filter((issue) => issue.severity === "blocking");
  candidate.issueState.warnings = issuesAfter.filter((issue) => issue.severity !== "blocking");
  candidate.fingerprint = fingerprintGardenBuildState(candidate);
  candidate.acceptance.stateFingerprint = candidate.fingerprint;
  return {
    state: candidate,
    transaction: { ...base, revisionAfter: candidate.revision, fingerprintAfter: candidate.fingerprint, committed: true, issuesAfter, reason: `committed (${blockersBefore} -> ${blockersAfter} blockers)` },
  };
}
