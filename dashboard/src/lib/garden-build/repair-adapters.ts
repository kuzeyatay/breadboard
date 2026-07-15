import fs from "node:fs";
import path from "node:path";
import { validateFormulaAssignment } from "../formula-assignment.ts";
import { buildCanonicalFormulaUsageIndex, parseFormulaMetadataEntries, resolveWorkedExampleLineage, type FormulaUsageRepairPacket } from "../formula-usage-reconciliation.ts";
import { buildFinalGardenState } from "../final-garden-state.ts";
import { buildFinalLearnerPageIndex, buildPageSemanticProjection, rebuildActiveClaimsFromFinalState, rebuildActiveConceptRegistry } from "../semantic-reconciliation.ts";
import { conceptId, type ClaimStore, type ConceptRegistry } from "../semantic-core.ts";
import { buildWeakAnchorRepairPacket, collectWeakAnchorRepairIssues, decideDeterministicAnchorRepair, findAnchorRepairCandidates, type WeakAnchorRepairPacket } from "../weak-anchor-self-healing.ts";
import { stableGardenIssueId } from "./issue-identity.ts";
import type { GardenIssue, GardenIssueBase } from "./issues.ts";
import type { GardenBuildOperation } from "./operations.ts";
import { proposeCanonicalRepairs } from "./repair-dispatcher.ts";
import type { GardenBuildState } from "./types.ts";

export interface FormulaReconciliationPlan {
  issues: GardenIssue[];
  operations: GardenBuildOperation[];
  modelPackets: FormulaUsageRepairPacket[];
}

export interface SemanticReconciliationPlan { issues: GardenIssue[]; operations: GardenBuildOperation[] }

export interface WeakAnchorRepairPlan {
  issues: GardenIssue[];
  deterministicOperations: GardenBuildOperation[];
  modelPackets: WeakAnchorRepairPacket[];
}

function assignmentIssue(state: GardenBuildState, assignmentId: string): GardenIssue | undefined {
  const assignment = state.formulaAssignments[assignmentId];
  if (!assignment) return undefined;
  const compatibility = validateFormulaAssignment(assignment.identity, assignment.requirement);
  if (compatibility.hardRejectionReasons.length === 0) return undefined;
  const base: Omit<GardenIssueBase, "issueId"> = {
    type: "formula_assignment_family_mismatch", severity: "blocking", repairClass: "deterministic_then_model", stage: "repair",
    target: { formulaAssignmentId: assignment.id, formulaAnchorId: assignment.formulaAnchorId, unitId: assignment.unitId, pageId: assignment.pageId },
    evidence: { verifiedFormulaFamily: assignment.identity.family, requiredFamilies: assignment.requirement.requiredFamilies, acceptedRelatedFamilies: assignment.requirement.acceptedRelatedFamilies, compatibilityScore: compatibility.totalScore, semanticCategory: "formula_assignment_incompatible", hardRejectionReasons: compatibility.hardRejectionReasons },
    detectedBy: ["canonical_formula_adapter"],
  };
  return { ...base, issueId: stableGardenIssueId(base) } as GardenIssue;
}

export function planFormulaReconciliation(state: GardenBuildState): FormulaReconciliationPlan {
  const issues = Object.keys(state.formulaAssignments).map((id) => assignmentIssue(state, id)).filter(Boolean) as GardenIssue[];
  const proposed = proposeCanonicalRepairs(issues, state);
  return { issues, operations: proposed.operations, modelPackets: proposed.modelPackets.filter((packet): packet is FormulaUsageRepairPacket => Boolean(packet && typeof packet === "object" && "pagePath" in (packet as object))) };
}

/** Pure adapter over the existing lineage resolver. It reads legacy artifacts,
 * but emits page-ID operations and never writes the garden. */
export function planFormulaReconciliationFromLegacy(gardenDir: string, state: GardenBuildState): FormulaReconciliationPlan {
  const base = planFormulaReconciliation(state);
  const finalState = buildFinalGardenState(gardenDir, state.gardenSlug);
  const usageIndex = buildCanonicalFormulaUsageIndex(gardenDir, finalState);
  const operations = [...base.operations];
  for (const legacyPage of finalState.pages) {
    const pageId = pageIdForLegacyPath(state, legacyPage.rel);
    if (!pageId) continue;
    for (const entry of parseFormulaMetadataEntries(legacyPage.rawFrontmatter)) {
      if (entry.kind !== "worked_example" || entry.basedOnFormula) continue;
      const decision = resolveWorkedExampleLineage(entry, legacyPage, usageIndex, finalState);
      if (decision.action === "assign_lineage") operations.push({ type: "set_formula_lineage", pageId, entryIndex: decision.entryIndex, basedOnFormulaAnchorId: decision.basedOnFormula, formulaFamily: decision.formulaFamily, justification: decision.reason });
      if (decision.action === "reclassify_conceptual_helper") operations.push({ type: "reclassify_formula_entry", pageId, entryIndex: decision.entryIndex, kind: "conceptual_helper", justification: decision.reason });
    }
  }
  return { ...base, operations };
}

export function planSemanticReconciliation(state: GardenBuildState): SemanticReconciliationPlan {
  const issues = [...state.issueState.active, ...state.issueState.warnings].filter((issue) => ["claim_page_mapping", "concept_reference", "tag_projection", "unit_page_mapping"].includes(issue.type));
  return { issues, operations: proposeCanonicalRepairs(issues, state).operations };
}

function readJson<T>(file: string, fallback: T): T { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; } }
function pageIdForLegacyPath(state: GardenBuildState, legacyPath: string): string | undefined { return Object.values(state.pages).find((page) => page.legacyPath === legacyPath || page.legacyPath?.replace(/\.md$/i, "") === legacyPath)?.id; }

/** Pure adapter over the existing semantic reconciliation builders. All path
 * ownership is converted to page IDs before an operation leaves this adapter. */
export function planSemanticReconciliationFromLegacy(gardenDir: string, state: GardenBuildState): SemanticReconciliationPlan {
  const finalState = buildFinalGardenState(gardenDir, state.gardenSlug);
  const registry = readJson<ConceptRegistry>(path.join(gardenDir, ".breadboard", "concept-registry.json"), { schemaVersion: 1, gardenId: state.gardenId, sourceSetHash: state.sourceSetHash, concepts: [] });
  const claimStore = readJson<ClaimStore>(path.join(gardenDir, ".breadboard", "claims.json"), { schemaVersion: 1, gardenId: state.gardenId, sourceSetHash: state.sourceSetHash, claims: [] });
  const pageIndex = buildFinalLearnerPageIndex(gardenDir, finalState.learningUnitContract.units);
  const claims = rebuildActiveClaimsFromFinalState(finalState.learningUnitContract.units, pageIndex, claimStore.claims, registry);
  const projections = finalState.learningUnitContract.units
    .map((unit) => pageIndex.byUnitId[unit.id] ? buildPageSemanticProjection(unit, pageIndex.byUnitId[unit.id], claims.activeClaims, registry) : undefined)
    .filter((projection): projection is NonNullable<typeof projection> => Boolean(projection));
  // Reuse the active-concept rebuilder as a consistency pass. The importer
  // remains the owner of canonical entity construction.
  rebuildActiveConceptRegistry(finalState.learningUnitContract.units, projections, claims.activeClaims, registry, new Set(registry.concepts.map((entry) => entry.id)));
  const operations: GardenBuildOperation[] = [];
  for (const projection of projections) {
    const unit = state.units[projection.unitId];
    if (!unit) continue;
    const primary = projection.primaryConcepts.map(conceptId);
    const supporting = projection.supportingConcepts.map(conceptId);
    if (JSON.stringify(primary) !== JSON.stringify(unit.primaryConceptIds) || JSON.stringify(supporting) !== JSON.stringify(unit.supportingConceptIds)) operations.push({ type: "set_unit_concepts", unitId: unit.id, primaryConceptIds: primary, supportingConceptIds: supporting, prerequisiteConceptIds: unit.prerequisiteConceptIds, justification: "existing semantic projection builder disagrees with imported canonical unit concepts" });
  }
  for (const unit of finalState.learningUnitContract.units) {
    const rebuilt = claims.activeClaims.filter((claim) => claim.learningUnitId === unit.id).map((claim) => ({ id: claim.id, unitId: unit.id, pageId: state.units[unit.id]?.pageId ?? `page:${unit.id}`, text: claim.text, subjectConceptId: claim.subject, objectConceptId: claim.object, predicate: claim.predicate, conceptIds: claim.conceptIds, evidenceAnchorIds: claim.evidenceAnchors, derivationAnchorIds: claim.derivationAnchors, status: "active" as const }));
    const current = Object.values(state.claims).filter((claim) => claim.unitId === unit.id);
    if (JSON.stringify(rebuilt) !== JSON.stringify(current)) operations.push({ type: "replace_claims", unitId: unit.id, claims: rebuilt, justification: "existing active-claim rebuilder produced a different stable page-ID claim set" });
  }
  return { issues: planSemanticReconciliation(state).issues, operations: [...planSemanticReconciliation(state).operations, ...operations] };
}

export function planWeakAnchorRepair(state: GardenBuildState): WeakAnchorRepairPlan {
  const issues = [...state.issueState.active, ...state.issueState.warnings].filter((issue) => issue.type === "weak_source_anchor" || issue.type === "source_anchor_relevance");
  const proposed = proposeCanonicalRepairs(issues, state);
  return { issues, deterministicOperations: proposed.operations, modelPackets: proposed.modelPackets.filter((packet): packet is WeakAnchorRepairPacket => Boolean(packet && typeof packet === "object" && "issueIdentity" in (packet as object))) };
}

/** Pure adapter over the existing conservative weak-anchor candidate scorer.
 * It emits canonical operations/packets and never applies ledger mutations. */
export function planWeakAnchorRepairFromLegacy(gardenDir: string, state: GardenBuildState): WeakAnchorRepairPlan {
  const finalState = buildFinalGardenState(gardenDir, state.gardenSlug);
  const legacyIssues = collectWeakAnchorRepairIssues(finalState);
  const issues = [...state.issueState.active, ...state.issueState.warnings].filter((issue) => issue.type === "weak_source_anchor" || issue.type === "source_anchor_relevance");
  const deterministicOperations: GardenBuildOperation[] = [];
  const modelPackets: WeakAnchorRepairPacket[] = [];
  for (const legacyIssue of legacyIssues) {
    const candidates = findAnchorRepairCandidates(gardenDir, legacyIssue, finalState);
    const decision = decideDeterministicAnchorRepair(legacyIssue, candidates);
    if (decision.action === "replace_with_existing_anchor" && decision.candidate?.replacementAnchorId) {
      deterministicOperations.push({ type: "replace_source_anchor", oldAnchorId: legacyIssue.anchorId, newAnchorId: decision.candidate.replacementAnchorId, justification: decision.reason });
    } else if (decision.action === "reground_from_source" && decision.candidate?.exactText) {
      deterministicOperations.push({ type: "update_source_anchor_evidence", anchorId: legacyIssue.anchorId, patch: { exactText: decision.candidate.exactText, sourceId: decision.candidate.sourceId, page: decision.candidate.page, status: "verified" }, justification: decision.reason });
    } else if (decision.action === "escalate_to_chatmock") {
      modelPackets.push(buildWeakAnchorRepairPacket(legacyIssue, candidates, finalState));
    }
  }
  return { issues, deterministicOperations, modelPackets };
}
