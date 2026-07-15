import type { FormulaUsageRepairPacket } from "../formula-usage-reconciliation.ts";
import type { WeakAnchorRepairPacket } from "../weak-anchor-self-healing.ts";
import type { GardenIssue } from "./issues.ts";
import type { GardenBuildOperation } from "./operations.ts";
import type { GardenBuildState } from "./types.ts";

export interface GardenRepairHandler<TIssue extends GardenIssue = GardenIssue> {
  issueType: TIssue["type"];
  proposeDeterministicOperations(issue: TIssue, state: GardenBuildState): GardenBuildOperation[];
  buildModelPacket?(issue: TIssue, state: GardenBuildState): unknown;
  verifyModelDecision?(issue: TIssue, packet: unknown, decision: unknown, state: GardenBuildState): { valid: boolean; operations: GardenBuildOperation[]; reason: string };
}

function operationsForIssue(issue: GardenIssue, state: GardenBuildState): GardenBuildOperation[] {
  // An incompatible assignment is not repaired by deleting it: doing so would
  // erase the contract requirement and could make the build appear acceptable.
  // It remains blocking until an independently verified replacement operation
  // is available from the existing formula-assignment system.
  if (issue.type === "formula_assignment_family_mismatch") return [];
  if (issue.type === "formula_lineage" && issue.target.pageId) {
    const page = state.pages[issue.target.pageId];
    const unit = page ? state.units[page.unitId] : undefined;
    const assignments = unit?.formulaAssignmentIds.map((id) => state.formulaAssignments[id]).filter((entry) => entry?.status === "verified") ?? [];
    const entryIndex = page?.formulaEntries.findIndex((entry) => entry.kind === "worked_example" && !entry.basedOnFormulaAnchorId) ?? -1;
    if (assignments.length === 1 && entryIndex >= 0) return [{ type: "set_formula_lineage", pageId: page!.id, entryIndex, basedOnFormulaAnchorId: assignments[0].formulaAnchorId, formulaFamily: String(assignments[0].identity.family), justification: "one verified on-unit canonical formula is the only supported lineage candidate" }];
  }
  if (issue.type === "tag_projection" && issue.target.unitId) {
    const unit = state.units[issue.target.unitId];
    if (unit) return [{ type: "set_unit_concepts", unitId: unit.id, primaryConceptIds: unit.primaryConceptIds, supportingConceptIds: unit.supportingConceptIds, prerequisiteConceptIds: unit.prerequisiteConceptIds, justification: "discard stale legacy tags; renderer projects the canonical unit concept assignment" }];
  }
  if (issue.type === "claim_page_mapping" && issue.target.unitId) {
    const claims = Object.values(state.claims).filter((claim) => claim.unitId === issue.target.unitId);
    return [{ type: "replace_claims", unitId: issue.target.unitId, claims, justification: "rebuild active claims by stable unit/page identity and discard stale path ownership" }];
  }
  if (issue.type === "visual_grounding" && issue.target.visualId) {
    const visual = state.visuals[issue.target.visualId];
    if (visual) return [{ type: "set_visual_grounding", visualId: visual.id, sourceAnchorIds: visual.sourceAnchorIds, textAnchorIds: visual.textAnchorIds, status: "omitted", justification: "legacy visual page path does not resolve; preserve the entity as an explicit omission" }];
  }
  return [];
}

function modelPacket(issue: GardenIssue, state: GardenBuildState): FormulaUsageRepairPacket | WeakAnchorRepairPacket | Record<string, unknown> | undefined {
  if (issue.type === "weak_source_anchor") {
    const anchor = issue.target.anchorId ? state.sourceAnchors[issue.target.anchorId] : undefined;
    return anchor ? { issueType: issue.type, issueId: issue.issueId, anchor, allowedEntityIds: [anchor.id] } : undefined;
  }
  if (["formula_identity", "formula_usage_projection", "formula_lineage", "formula_assignment_family_mismatch"].includes(issue.type)) {
    return { issueType: issue.type, issueId: issue.issueId, target: issue.target, evidence: issue.evidence };
  }
  return undefined;
}

const HANDLED_TYPES: GardenIssue["type"][] = [
  "formula_identity", "formula_assignment_family_mismatch", "formula_lineage", "formula_usage_projection",
  "weak_source_anchor", "source_anchor_relevance", "claim_page_mapping", "concept_reference", "tag_projection",
  "visual_grounding", "section_semantic",
];

export const GARDEN_REPAIR_HANDLERS: ReadonlyMap<GardenIssue["type"], GardenRepairHandler> = new Map(
  HANDLED_TYPES.map((issueType) => [issueType, {
    issueType,
    proposeDeterministicOperations: (issue: GardenIssue, state: GardenBuildState) => operationsForIssue(issue, state),
    buildModelPacket: (issue: GardenIssue, state: GardenBuildState) => modelPacket(issue, state),
  }]),
);

export function handlerForGardenIssue(issue: GardenIssue): GardenRepairHandler | undefined {
  return GARDEN_REPAIR_HANDLERS.get(issue.type);
}

export function proposeCanonicalRepairs(issues: readonly GardenIssue[], state: GardenBuildState): { operations: GardenBuildOperation[]; modelPackets: unknown[] } {
  const operations: GardenBuildOperation[] = [];
  const modelPackets: unknown[] = [];
  for (const issue of issues) {
    const handler = handlerForGardenIssue(issue);
    if (!handler) continue;
    operations.push(...handler.proposeDeterministicOperations(issue, state));
    if (issue.repairClass === "model" || issue.repairClass === "deterministic_then_model") {
      const packet = handler.buildModelPacket?.(issue, state);
      if (packet) modelPackets.push(packet);
    }
  }
  return { operations, modelPackets };
}
