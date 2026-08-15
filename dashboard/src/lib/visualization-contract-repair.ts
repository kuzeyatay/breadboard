import type { LearningUnitContract } from "./learning-unit-contract.ts";
import type { ProposedLearningMap } from "./learn-utils.ts";
import type { GardenVisualBudget, VisualDecisionOverride } from "./visual-necessity-types.ts";
import {
  analyzeVisualizationOpportunities,
  buildVisualizationPlan,
  canonicalVisualizationEvidenceProblems,
  generatedVisualizationContractProblems,
  selectVisualizationRoutes,
  type VisualizationOpportunity,
  type VisualizationCanonicalEvidenceByUnit,
  type VisualizationPlan,
} from "./visualization-opportunities.ts";
import {
  parseVisualizationContractRepairResponse,
  pedagogyContractFromCompleteRepair,
  validateVisualizationContractUnitRepair,
  type CompleteVisualizationContractUnitRepair,
  type VisualizationContractEvidenceEntry,
  type VisualizationContractUnitRepair,
} from "./visualization-contract-validation.ts";

export type {
  CompleteVisualizationContractUnitRepair,
  VisualizationContractControlKind,
  VisualizationContractControlRepair,
  VisualizationContractEvidenceEntry,
  VisualizationContractEvidenceRef,
  VisualizationContractUnitRepair,
} from "./visualization-contract-validation.ts";
export {
  parseVisualizationContractRepairResponse,
  validateVisualizationContractUnitRepair,
  visualizationContractEvidenceForUnit,
} from "./visualization-contract-validation.ts";

export interface VisualizationContractRepairPacket {
  problems: string[];
  units: Array<{
    unitId: string;
    title: string;
    role: string;
    requirement: "required" | "recommended" | "optional";
    interactionGoal: string;
    learnerAction: string;
    learningObjective: string;
    evidence: VisualizationContractEvidenceEntry[];
  }>;
  previousRejectionReasons: string[];
}

export interface VisualizationPlanRepairInput {
  gardenId: string;
  learningMap: ProposedLearningMap;
  learningUnits: LearningUnitContract[];
  visualBudget: GardenVisualBudget;
  canonicalEvidenceByUnit: VisualizationCanonicalEvidenceByUnit;
  necessityReviewCalls?: number;
  rejectedNecessityReviews?: number;
  visualDecisionOverrides?: VisualDecisionOverride[];
  repairProvider: (packet: VisualizationContractRepairPacket) => Promise<unknown>;
  maxRepairAttempts?: number;
  checkCancelled?: () => void;
  onEvent?: (type: string, data: Record<string, unknown>) => void;
}

export interface VisualizationPlanRepairResult {
  plan: VisualizationPlan;
  learningUnits: LearningUnitContract[];
  repairAttempts: number;
  repairedUnitIds: string[];
  repairSource: "none" | "model";
  repairAudit: {
    attempts: VisualizationContractRepairAttempt[];
    acceptedResponse?: unknown;
  };
}

export interface VisualizationContractRepairAttempt {
  attempt: number;
  accepted: boolean;
  responseEncoding: "json" | "undefined";
  response: unknown;
  rejectionReasons: string[];
  appliedUnitIds: string[];
}

function auditResponse(value: unknown): {
  responseEncoding: "json" | "undefined";
  response: unknown;
} {
  return value === undefined
    ? { responseEncoding: "undefined", response: null }
    : { responseEncoding: "json", response: value };
}

function applyRepairs(input: {
  units: LearningUnitContract[];
  repairs: VisualizationContractUnitRepair[];
  affectedUnitIds: Set<string>;
  canonicalEvidenceByUnit: VisualizationCanonicalEvidenceByUnit;
}): { units: LearningUnitContract[]; appliedUnitIds: string[]; problems: string[] } {
  const appliedUnitIds: string[] = [];
  const problems: string[] = [];
  const repairIds = input.repairs.map((repair) => repair.unitId);
  const duplicateRepairIds = repairIds.filter(
    (unitId, index) => unitId && repairIds.indexOf(unitId) !== index,
  );
  for (const unitId of new Set(duplicateRepairIds)) {
    problems.push(`repair response duplicates affected unit ${unitId}`);
  }
  for (const repair of input.repairs) {
    if (!input.affectedUnitIds.has(repair.unitId)) {
      problems.push(`repair targets unaffected or unknown unit ${repair.unitId}`);
    }
  }
  for (const unitId of input.affectedUnitIds) {
    if (!repairIds.includes(unitId)) {
      problems.push(`${unitId}: repair response omitted this failed model-approved unit`);
    }
  }
  if (input.repairs.length !== input.affectedUnitIds.size) {
    problems.push(
      `repair response must contain exactly ${input.affectedUnitIds.size} affected unit repair(s), received ${input.repairs.length}`,
    );
  }
  if (problems.length > 0) {
    return { units: input.units, appliedUnitIds, problems: [...new Set(problems)] };
  }
  const repairByUnit = new Map(input.repairs.map((repair) => [repair.unitId, repair]));
  const units = input.units.map((unit) => {
    if (!input.affectedUnitIds.has(unit.id)) return unit;
    const repair = repairByUnit.get(unit.id);
    if (!repair) {
      problems.push(`${unit.id}: validated complete repair response became incomplete`);
      return unit;
    }
    const validation = validateVisualizationContractUnitRepair({
      repair,
      unit,
      evidence: input.canonicalEvidenceByUnit[unit.id] ?? [],
      requireCompleteContract: true,
    });
    if (validation.length > 0) {
      problems.push(...validation);
      return unit;
    }
    const plan = unit.interactiveVisualPlan!;
    const requirement = plan.requirement;
    const necessity = plan.decision.necessity;
    // Complete-contract validation above proves these model-authored fields
    // exist. Application only copies them; it never restores or invents any
    // part from the prior unit.
    const completeRepair = repair as CompleteVisualizationContractUnitRepair;
    const authoredIntent = completeRepair.visualIntent;
    const intent = {
      ...authoredIntent,
      learnerManipulates: [...authoredIntent.learnerManipulates],
      sourceAnchors: [...authoredIntent.sourceAnchors],
    };
    const observable = {
      ...completeRepair.observable,
      evidence: completeRepair.observable.evidence.map((item) => ({ ...item })),
    };
    const next: LearningUnitContract = {
      ...unit,
      interactiveVisual: intent,
      interactiveVisualPlan: {
        ...plan,
        decision: {
          ...plan.decision,
          interaction: pedagogyContractFromCompleteRepair(completeRepair),
        },
        visualIntent: intent,
        interactionGoal: completeRepair.interactionGoal,
        learnerAction: completeRepair.learnerAction,
        controlContract: repair.controls.map((control) => ({
          ...control,
          ...(control.options ? { options: [...control.options] } : {}),
          evidence: control.evidence.map((item) => ({ ...item })),
        })),
        observable,
        expectedInsightEvidence: repair.expectedInsightEvidence.map((item) => ({ ...item })),
      },
    };
    if (
      next.interactiveVisualPlan?.requirement !== requirement ||
      next.interactiveVisualPlan.decision.necessity !== necessity
    ) {
      problems.push(`${unit.id}: repair attempted to change necessity or requirement`);
      return unit;
    }
    appliedUnitIds.push(unit.id);
    return next;
  });
  return { units, appliedUnitIds, problems: [...new Set(problems)] };
}

function selectedContractState(input: {
  gardenId: string;
  learningMap: ProposedLearningMap;
  learningUnits: LearningUnitContract[];
  canonicalEvidenceByUnit: VisualizationCanonicalEvidenceByUnit;
}) {
  const opportunities = analyzeVisualizationOpportunities({
    gardenId: input.gardenId,
    learningMap: input.learningMap,
    learningUnits: input.learningUnits,
    canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
  });
  const selected = selectVisualizationRoutes({
    opportunities,
    learningUnits: input.learningUnits,
    routingAuthority: "model_authored",
  });
  return {
    ...selected,
    problems: generatedVisualizationContractProblems(selected),
  };
}

function affectedOpportunities(
  problems: readonly string[],
  opportunities: readonly VisualizationOpportunity[],
): VisualizationOpportunity[] {
  const ids = new Set(problems.map((problem) => problem.split(":", 1)[0]?.trim()).filter(Boolean));
  return opportunities.filter((opportunity) => ids.has(opportunity.id));
}

export async function buildVisualizationPlanWithContractRepair(
  input: VisualizationPlanRepairInput,
): Promise<VisualizationPlanRepairResult> {
  const canonicalEvidenceProblems = input.learningUnits.flatMap((unit) => {
    if (unit.interactiveVisualPlan?.requirement === "none") return [];
    return canonicalVisualizationEvidenceProblems({
      unit,
      evidence: input.canonicalEvidenceByUnit?.[unit.id],
    });
  });
  if (canonicalEvidenceProblems.length > 0) {
    throw new Error(
      `Canonical visualization evidence validation failed: ${[...new Set(canonicalEvidenceProblems)].join("; ")}`,
    );
  }
  let learningUnits = input.learningUnits;
  const build = (candidateUnits: LearningUnitContract[] = learningUnits) => buildVisualizationPlan({
    gardenId: input.gardenId,
    learningMap: input.learningMap,
    learningUnits: candidateUnits,
    visualBudget: input.visualBudget,
    canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
    necessityReviewCalls: input.necessityReviewCalls,
    rejectedNecessityReviews: input.rejectedNecessityReviews,
    visualDecisionOverrides: input.visualDecisionOverrides,
  });
  try {
    const plan = build();
    return {
      plan,
      learningUnits,
      repairAttempts: 0,
      repairedUnitIds: [],
      repairSource: "none",
      repairAudit: { attempts: [] },
    };
  } catch (initialError) {
    let state = selectedContractState({
      gardenId: input.gardenId,
      learningMap: input.learningMap,
      learningUnits,
      canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
    });
    if (state.problems.length === 0) throw initialError;
    const affected = affectedOpportunities(state.problems, state.opportunities);
    const affectedUnitIds = new Set(affected.map((opportunity) => opportunity.learningUnitId));
    if (affectedUnitIds.size === 0) throw initialError;

    input.onEvent?.("visual_opportunity_contract_repair_started", {
      problems: state.problems,
      unitIds: [...affectedUnitIds],
    });

    const maxAttempts = Math.max(1, Math.min(3, input.maxRepairAttempts ?? 2));
    let rejectionReasons: string[] = [];
    const repairAttempts: VisualizationContractRepairAttempt[] = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      input.checkCancelled?.();
      state = selectedContractState({
        gardenId: input.gardenId,
        learningMap: input.learningMap,
        learningUnits,
        canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
      });
      const failed = affectedOpportunities(state.problems, state.opportunities);
      if (failed.length === 0) {
        throw new Error(
          `Visualization contract repair stopped because no failed model-approved unit matched: ${state.problems.join("; ")}`,
        );
      }
      const unitById = new Map(learningUnits.map((unit) => [unit.id, unit]));
      const packet: VisualizationContractRepairPacket = {
        problems: state.problems,
        units: failed.flatMap((opportunity) => {
          const unit = unitById.get(opportunity.learningUnitId);
          const visualPlan = unit?.interactiveVisualPlan;
          const requirement = visualPlan?.requirement;
          if (!unit || !visualPlan || !requirement || requirement === "none") return [];
          return [{
            unitId: unit.id,
            title: unit.title,
            role: unit.role,
            requirement,
            // A missing goal is exactly what repair is being asked to supply,
            // so it reaches the model as empty rather than as a guess.
            interactionGoal: opportunity.interactionGoal ?? "",
            learnerAction: visualPlan.learnerAction ?? "",
            learningObjective: opportunity.learningObjective,
            evidence: (input.canonicalEvidenceByUnit[unit.id] ?? []).map((entry) => ({ ...entry })),
          }];
        }),
        previousRejectionReasons: rejectionReasons,
      };
      let response: unknown;
      try {
        response = await input.repairProvider(packet);
      } catch (error) {
        try {
          input.checkCancelled?.();
        } catch (cancelled) {
          input.onEvent?.("visual_opportunity_contract_repair_cancelled", {
            attempt,
            unitIds: [...affectedUnitIds],
            reason: cancelled instanceof Error ? cancelled.message : String(cancelled),
          });
          throw cancelled;
        }
        input.onEvent?.("visual_opportunity_contract_repair_transport_aborted", {
          attempt,
          unitIds: [...affectedUnitIds],
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      try {
        input.checkCancelled?.();
      } catch (error) {
        input.onEvent?.("visual_opportunity_contract_repair_cancelled", {
          attempt,
          unitIds: [...affectedUnitIds],
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const exactResponse = structuredClone(response);
      const failedUnitIds = failed.map((opportunity) => opportunity.learningUnitId);
      const parsedResponse = parseVisualizationContractRepairResponse(response, {
        requireCompleteContract: true,
        expectedUnitIds: failedUnitIds,
      });
      if (parsedResponse.problems.length > 0) {
        rejectionReasons = [...parsedResponse.problems];
        repairAttempts.push({
          attempt,
          accepted: false,
          ...auditResponse(exactResponse),
          rejectionReasons: [...rejectionReasons],
          appliedUnitIds: [],
        });
        input.onEvent?.("visual_opportunity_contract_repair_rejected", {
          attempt,
          reasons: rejectionReasons,
        });
        continue;
      }
      const applied = applyRepairs({
        units: learningUnits,
        repairs: parsedResponse.repairs,
        affectedUnitIds: new Set(failedUnitIds),
        canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
      });
      rejectionReasons = [...new Set(applied.problems)];
      if (applied.appliedUnitIds.length === 0 || rejectionReasons.length > 0) {
        repairAttempts.push({
          attempt,
          accepted: false,
          ...auditResponse(exactResponse),
          rejectionReasons: [...rejectionReasons],
          appliedUnitIds: [...applied.appliedUnitIds],
        });
        input.onEvent?.("visual_opportunity_contract_repair_rejected", {
          attempt,
          reasons: rejectionReasons,
        });
        continue;
      }
      try {
        const plan = build(applied.units);
        learningUnits = applied.units;
        repairAttempts.push({
          attempt,
          accepted: true,
          ...auditResponse(exactResponse),
          rejectionReasons: [],
          appliedUnitIds: [...applied.appliedUnitIds],
        });
        input.onEvent?.("visual_opportunity_contract_repair_completed", {
          source: "model",
          attempt,
          unitIds: applied.appliedUnitIds,
        });
        return {
          plan,
          learningUnits,
          repairAttempts: attempt,
          repairedUnitIds: applied.appliedUnitIds,
          repairSource: "model",
          repairAudit: {
            attempts: repairAttempts,
            acceptedResponse: exactResponse,
          },
        };
      } catch (error) {
        const candidateState = selectedContractState({
          gardenId: input.gardenId,
          learningMap: input.learningMap,
          learningUnits: applied.units,
          canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
        });
        if (candidateState.problems.length === 0) throw error;
        rejectionReasons = candidateState.problems;
        repairAttempts.push({
          attempt,
          accepted: false,
          ...auditResponse(exactResponse),
          rejectionReasons: [...rejectionReasons],
          appliedUnitIds: [...applied.appliedUnitIds],
        });
      }
    }
    input.onEvent?.("visual_opportunity_contract_repair_exhausted", {
      attempts: maxAttempts,
      unitIds: [...affectedUnitIds],
      reasons: rejectionReasons,
    });
    const initialMessage = initialError instanceof Error ? initialError.message : String(initialError);
    throw new Error(
      `${initialMessage}. Automatic model-approved visualization contract repair exhausted ${maxAttempts} bounded attempt(s): ${rejectionReasons.join("; ") || "no valid grounded repair was returned"}`,
    );
  }
}
