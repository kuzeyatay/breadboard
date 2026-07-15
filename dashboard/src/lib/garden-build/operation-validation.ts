import { stableGardenIssueId } from "./issue-identity.ts";
import type { GardenIssue, GardenIssueBase } from "./issues.ts";
import { operationMutatedFields, type GardenBuildOperation } from "./operations.ts";
import { STAGE_MUTATION_POLICY, type GardenBuildStage, type GardenBuildState } from "./types.ts";

function illegal(state: GardenBuildState, operation: GardenBuildOperation, field: string, category: string): GardenIssue {
  const base: Omit<GardenIssueBase, "issueId"> = {
    type: "illegal_stage_mutation", severity: "blocking", repairClass: "non_repairable", stage: state.stage,
    target: {}, evidence: { field, operationType: operation.type, semanticCategory: category }, detectedBy: ["operation_validation"],
  };
  return { ...base, issueId: stableGardenIssueId(base) } as GardenIssue;
}

export function validateGardenBuildOperation(state: GardenBuildState, operation: GardenBuildOperation, expectedStage: GardenBuildStage): GardenIssue[] {
  if (state.stage !== expectedStage) return [illegal(state, operation, "stage", "unexpected_stage")];
  const policy = STAGE_MUTATION_POLICY[state.stage] as readonly string[];
  if (policy.length === 0) return [illegal(state, operation, operationMutatedFields(operation)[0] ?? "unknown", "immutable_stage")];
  if (state.stage !== "repair") {
    const disallowed = operationMutatedFields(operation).filter((field) => !policy.includes(String(field)));
    if (disallowed.length) return disallowed.map((field) => illegal(state, operation, String(field), "field_not_owned_by_stage"));
  }
  if (operation.type === "set_formula_assignment") {
    if (operation.formulaAssignment.unitId !== operation.expectedUnitId || operation.formulaAssignment.pageId !== operation.expectedPageId) {
      return [illegal(state, operation, "formulaAssignments", "assignment_scope_mismatch")];
    }
  }
  if (operation.type === "replace_claims" && operation.claims.some((claim) => claim.unitId !== operation.unitId)) {
    return [illegal(state, operation, "claims", "claim_scope_mismatch")];
  }
  return [];
}
