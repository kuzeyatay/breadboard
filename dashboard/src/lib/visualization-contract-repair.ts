import { createHash } from "node:crypto";

import type { LearningUnitContract } from "./learning-unit-contract.ts";
import type { ProposedLearningMap } from "./learn-utils.ts";
import type { VisualDecisionOverride } from "./visual-necessity-types.ts";
import {
  analyzeVisualizationOpportunities,
  buildVisualizationPlan,
  requiredGeneratedVisualizationContractProblems,
  selectVisualizationRoutes,
  type VisualizationOpportunity,
  type VisualizationPlan,
} from "./visualization-opportunities.ts";
import {
  normalizeVisualizationContractRepairResponse,
  validateVisualizationContractUnitRepair,
  visualizationContractEvidenceForUnit,
  type VisualizationContractEvidenceEntry,
  type VisualizationContractUnitRepair,
} from "./visualization-contract-validation.ts";

export type {
  VisualizationContractControlKind,
  VisualizationContractControlRepair,
  VisualizationContractEvidenceEntry,
  VisualizationContractEvidenceRef,
  VisualizationContractUnitRepair,
} from "./visualization-contract-validation.ts";
export {
  validateVisualizationContractUnitRepair,
  visualizationContractEvidenceForUnit,
} from "./visualization-contract-validation.ts";

export interface VisualizationContractRepairPacket {
  problems: string[];
  units: Array<{
    unitId: string;
    title: string;
    role: string;
    requirement: "required";
    interactionGoal: string;
    learningObjective: string;
    evidence: VisualizationContractEvidenceEntry[];
  }>;
  previousRejectionReasons: string[];
}

export interface VisualizationPlanRepairInput {
  gardenId: string;
  learningMap: ProposedLearningMap;
  learningUnits: LearningUnitContract[];
  groundingUnits?: LearningUnitContract[];
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
  repairSource: "none" | "persisted_contract" | "model";
}

function repairIntent(
  unit: LearningUnitContract,
  repair: VisualizationContractUnitRepair,
) {
  const previous = unit.interactiveVisualPlan?.visualIntent ?? unit.interactiveVisual;
  const controls = repair.controls.map((control) => control.label);
  const uniqueConcept =
    previous?.uniqueConcept ||
    unit.semanticConcepts?.find((concept) => concept.role === "primary")?.preferredLabel ||
    unit.newConcepts[0] ||
    unit.title;
  const sourceAnchors = [...new Set([
    ...(previous?.sourceAnchors ?? []),
    ...unit.sourceAnchors,
    ...unit.sourceFigures.map((item) => item.id),
    ...unit.sourceFormulas.map((item) => item.id),
    ...unit.sourceTables.map((item) => item.id),
  ])];
  const duplicateSignature = createHash("sha256")
    .update(JSON.stringify({ unitId: unit.id, controls, insight: repair.expectedInsight }))
    .digest("hex")
    .slice(0, 20);
  return {
    id: previous?.id || `visual-contract-${unit.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    uniqueConcept,
    visualType: previous?.visualType || unit.interactiveVisualPlan?.decision.recommendedVisualType || "generated_module",
    whyStaticSourceFigureIsNotEnough:
      previous?.whyStaticSourceFigureIsNotEnough ||
      unit.interactiveVisualPlan?.decision.reason ||
      `Interaction is required to expose ${uniqueConcept}.`,
    learnerManipulates: controls,
    expectedInsight: repair.expectedInsight,
    sourceAnchors,
    duplicateSignature: previous?.duplicateSignature || duplicateSignature,
  };
}

function applyRepairs(input: {
  units: LearningUnitContract[];
  repairs: VisualizationContractUnitRepair[];
  affectedUnitIds: Set<string>;
}): { units: LearningUnitContract[]; appliedUnitIds: string[]; problems: string[] } {
  const repairByUnit = new Map(input.repairs.map((repair) => [repair.unitId, repair]));
  const appliedUnitIds: string[] = [];
  const problems: string[] = [];
  for (const repair of input.repairs) {
    if (!input.affectedUnitIds.has(repair.unitId)) {
      problems.push(`repair targets unaffected or unknown unit ${repair.unitId}`);
    }
  }
  const units = input.units.map((unit) => {
    if (!input.affectedUnitIds.has(unit.id)) return unit;
    const repair = repairByUnit.get(unit.id);
    if (!repair) {
      problems.push(`${unit.id}: repair response omitted this failed required unit`);
      return unit;
    }
    const validation = validateVisualizationContractUnitRepair({ repair, unit });
    if (validation.length > 0) {
      problems.push(...validation);
      return unit;
    }
    const plan = unit.interactiveVisualPlan!;
    const requirement = plan.requirement;
    const necessity = plan.decision.necessity;
    const intent = repairIntent(unit, repair);
    const next: LearningUnitContract = {
      ...unit,
      interactiveVisual: intent,
      interactiveVisualPlan: {
        ...plan,
        visualIntent: intent,
        controlContract: repair.controls.map((control) => ({
          kind: control.kind,
          label: control.label,
          ...(control.kind === "select_case" ? { options: [...(control.options ?? [])] } : {}),
          evidence: control.evidence.map((item) => ({ ...item })),
        })),
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
}) {
  const opportunities = analyzeVisualizationOpportunities({
    gardenId: input.gardenId,
    learningMap: input.learningMap,
    learningUnits: input.learningUnits,
  });
  const selected = selectVisualizationRoutes({
    opportunities,
    learningUnits: input.learningUnits,
    routingAuthority: "model_authored",
  });
  return {
    ...selected,
    problems: requiredGeneratedVisualizationContractProblems(selected),
  };
}

function affectedOpportunities(
  problems: readonly string[],
  opportunities: readonly VisualizationOpportunity[],
): VisualizationOpportunity[] {
  const ids = new Set(problems.map((problem) => problem.split(":", 1)[0]?.trim()).filter(Boolean));
  return opportunities.filter((opportunity) => ids.has(opportunity.id));
}

function persistedRepairs(input: {
  units: LearningUnitContract[];
  affectedUnitIds: Set<string>;
}): VisualizationContractUnitRepair[] {
  return input.units.flatMap((unit) => {
    if (!input.affectedUnitIds.has(unit.id)) return [];
    const intent = unit.interactiveVisualPlan?.visualIntent ?? unit.interactiveVisual;
    const controlContract = unit.interactiveVisualPlan?.controlContract ?? [];
    const insightEvidence = unit.interactiveVisualPlan?.expectedInsightEvidence ?? [];
    if (!intent?.expectedInsight || controlContract.length === 0 || insightEvidence.length === 0) return [];
    return [{
      unitId: unit.id,
      controls: controlContract.map((control) => ({
        kind: control.kind,
        label: control.label,
        ...(control.options ? { options: [...control.options] } : {}),
        evidence: control.evidence.map((item) => ({ ...item })),
      })),
      expectedInsight: intent.expectedInsight,
      expectedInsightEvidence: insightEvidence.map((item) => ({ ...item })),
    }];
  });
}

export async function buildVisualizationPlanWithContractRepair(
  input: VisualizationPlanRepairInput,
): Promise<VisualizationPlanRepairResult> {
  let learningUnits = input.learningUnits;
  let persistedRestoredUnitIds: string[] = [];
  if (input.groundingUnits?.length) {
    const currentById = new Map(learningUnits.map((unit) => [unit.id, unit]));
    const persistedCandidateIds = new Set(
      input.groundingUnits
        .filter((unit) =>
          (unit.interactiveVisualPlan?.controlContract?.length ?? 0) > 0 &&
          currentById.get(unit.id)?.interactiveVisualPlan?.requirement === "required" &&
          (currentById.get(unit.id)?.interactiveVisualPlan?.controlContract?.length ?? 0) === 0,
        )
        .map((unit) => unit.id),
    );
    if (persistedCandidateIds.size > 0) {
      const restored = applyRepairs({
        units: learningUnits,
        repairs: persistedRepairs({
          units: input.groundingUnits,
          affectedUnitIds: persistedCandidateIds,
        }),
        affectedUnitIds: persistedCandidateIds,
      });
      if (
        restored.problems.length === 0 &&
        restored.appliedUnitIds.length === persistedCandidateIds.size
      ) {
        learningUnits = restored.units;
        persistedRestoredUnitIds = restored.appliedUnitIds;
      }
    }
  }
  const build = () => buildVisualizationPlan({
    gardenId: input.gardenId,
    learningMap: input.learningMap,
    learningUnits,
    necessityReviewCalls: input.necessityReviewCalls,
    rejectedNecessityReviews: input.rejectedNecessityReviews,
    visualDecisionOverrides: input.visualDecisionOverrides,
  });
  try {
    const plan = build();
    if (persistedRestoredUnitIds.length > 0) {
      input.onEvent?.("visual_opportunity_contract_repair_completed", {
        source: "persisted_contract",
        attempt: 0,
        unitIds: persistedRestoredUnitIds,
      });
    }
    return {
      plan,
      learningUnits,
      repairAttempts: 0,
      repairedUnitIds: persistedRestoredUnitIds,
      repairSource: persistedRestoredUnitIds.length > 0 ? "persisted_contract" : "none",
    };
  } catch (initialError) {
    let state = selectedContractState({
      gardenId: input.gardenId,
      learningMap: input.learningMap,
      learningUnits,
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
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      input.checkCancelled?.();
      state = selectedContractState({
        gardenId: input.gardenId,
        learningMap: input.learningMap,
        learningUnits,
      });
      const failed = affectedOpportunities(state.problems, state.opportunities);
      if (failed.length === 0) {
        throw new Error(
          `Required-visual contract repair stopped because no failed unit matched: ${state.problems.join("; ")}`,
        );
      }
      const unitById = new Map(learningUnits.map((unit) => [unit.id, unit]));
      const packet: VisualizationContractRepairPacket = {
        problems: state.problems,
        units: failed.flatMap((opportunity) => {
          const unit = unitById.get(opportunity.learningUnitId);
          if (!unit || unit.interactiveVisualPlan?.requirement !== "required") return [];
          return [{
            unitId: unit.id,
            title: unit.title,
            role: unit.role,
            requirement: "required" as const,
            interactionGoal: opportunity.interactionGoal,
            learningObjective: opportunity.learningObjective,
            evidence: visualizationContractEvidenceForUnit(unit),
          }];
        }),
        previousRejectionReasons: rejectionReasons,
      };
      let response: unknown;
      try {
        response = await input.repairProvider(packet);
      } catch (error) {
        rejectionReasons = [error instanceof Error ? error.message : String(error)];
        input.onEvent?.("visual_opportunity_contract_repair_rejected", {
          attempt,
          reasons: rejectionReasons,
        });
        continue;
      }
      const applied = applyRepairs({
        units: learningUnits,
        repairs: normalizeVisualizationContractRepairResponse(response),
        affectedUnitIds: new Set(failed.map((opportunity) => opportunity.learningUnitId)),
      });
      rejectionReasons = applied.problems;
      if (applied.appliedUnitIds.length === 0 || applied.problems.length > 0) {
        input.onEvent?.("visual_opportunity_contract_repair_rejected", {
          attempt,
          reasons: rejectionReasons,
        });
        continue;
      }
      learningUnits = applied.units;
      try {
        const plan = build();
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
        };
      } catch (error) {
        state = selectedContractState({
          gardenId: input.gardenId,
          learningMap: input.learningMap,
          learningUnits,
        });
        if (state.problems.length === 0) throw error;
        rejectionReasons = state.problems;
      }
    }
    input.onEvent?.("visual_opportunity_contract_repair_exhausted", {
      attempts: maxAttempts,
      unitIds: [...affectedUnitIds],
      reasons: rejectionReasons,
    });
    const initialMessage = initialError instanceof Error ? initialError.message : String(initialError);
    throw new Error(
      `${initialMessage}. Automatic required-visual contract repair exhausted ${maxAttempts} bounded attempt(s): ${rejectionReasons.join("; ") || "no valid grounded repair was returned"}`,
    );
  }
}
