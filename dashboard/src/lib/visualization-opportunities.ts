import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  visualTypeCompatibleWithUnit,
  type LearningUnitContract,
  type LearningUnitRole,
} from "./learning-unit-contract.ts";
import type { ProposedLearningMap } from "./learn-utils.ts";
import {
  deriveGardenVisualBudget,
  saveVisualNecessityArtifacts,
} from "./visual-necessity.ts";
import type {
  ContractInteractiveVisualPlan,
  GardenVisualBudget,
  InteractiveVisualIntent,
  InteractiveVisualOutputRepresentation,
  TeachingMediumPlan,
  VisualDecisionOverride,
  VisualNecessityDecision,
} from "./visual-necessity-types.ts";
import { persistedVisualizationControlContractProblems } from "./visualization-contract-validation.ts";
import {
  TRUSTED_RENDERER_REGISTRY,
  trustedRenderer,
  type TrustedRendererDefinition,
  type VisualizationInteractionGoal,
} from "./visualization-registry.ts";

export type VisualizationInputType = "slider" | "number" | "select" | "toggle" | "button";
export type VisualizationOutputRepresentation = InteractiveVisualOutputRepresentation;

export interface VisualizationOpportunityInput {
  id: string;
  label: string;
  type: VisualizationInputType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  defaultValue: unknown;
}

export interface VisualizationOpportunityOutput {
  id: string;
  label: string;
  representation: VisualizationOutputRepresentation;
}

export interface SourceVisualRelationship {
  sourceVisualId: string;
  treatment:
    | "direct_source_embed"
    | "source_embed_plus_interactive_reconstruction"
    | "interactive_reconstruction_with_source_link"
    | "intentional_omission";
  fidelity: "exact_source_image" | "reconstructed" | "normalized" | "illustrative";
  explanation: string;
}

export interface VisualizationOpportunity {
  id: string;
  gardenId: string;
  learningUnitId: string;
  targetPage: string;
  targetHeading: string;
  insertionAnchor: string;
  conceptIds: string[];
  sourceAnchorIds: string[];
  sourceVisualIds: string[];
  sourceVisualRelationships: SourceVisualRelationship[];
  learningObjective: string;
  learnerQuestion: string;
  pedagogicalReason: string;
  interactionGoal: VisualizationInteractionGoal;
  requiredInputs: VisualizationOpportunityInput[];
  requiredOutputs: VisualizationOpportunityOutput[];
  /** Empty only when a typed, source-grounded control contract validates. */
  controlContractProblems: string[];
  preferredRenderer?: string;
  requiresGeneratedModule: boolean;
  priority: "critical" | "high" | "medium" | "low";
  confidence: number;
  similarityFingerprint: string;
  necessityDecision: VisualNecessityDecision;
  requirement: ContractInteractiveVisualPlan["requirement"];
}

export interface VisualizationRouteDecision {
  opportunityId: string;
  route: "trusted_renderer" | "generated_module" | "intentional_omission";
  selectedRenderer?: string;
  compatibilityScore?: number;
  reason: string;
  duplicateOf?: string;
}

export interface VisualizationCoverageReport {
  opportunitiesDetected: number;
  criticalOpportunities: number;
  highPriorityOpportunities: number;
  trustedVisualsPublished: number;
  generatedVisualsPublished: number;
  omittedAsPedagogicallyUnhelpful: number;
  failedValidation: number;
  failedCompilation: number;
  failedRuntimeTests: number;
  failedCritic: number;
  uncoveredCriticalOpportunityIds: string[];
  uncoveredHighPriorityOpportunityIds: string[];
  coverageScore: number;
  status: "pass" | "warning" | "fail";
  explanations: string[];
}

export interface VisualizationPlan {
  schemaVersion: 1;
  gardenId: string;
  generatedAt: string;
  opportunities: VisualizationOpportunity[];
  decisions: VisualizationRouteDecision[];
  visualNecessityDecisions: VisualNecessityDecision[];
  teachingMedia: TeachingMediumPlan[];
  visualBudget: GardenVisualBudget;
  visualDecisionOverrides: VisualDecisionOverride[];
  necessityReviewCalls: number;
  rejectedNecessityReviews: number;
}

export interface VisualizationPublicationOutcome {
  opportunityId: string;
  status:
    | "trusted_published"
    | "generated_published"
    | "intentional_omission"
    | "failed_validation"
    | "failed_compilation"
    | "failed_runtime_tests"
    | "failed_critic";
  reason?: string;
}

function stableHash(value: unknown, length = 20): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length);
}

function safeId(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
  return normalized || "visual";
}

function unitText(unit: LearningUnitContract): string {
  return [
    unit.title,
    unit.learningQuestion,
    ...unit.newConcepts,
    ...unit.prerequisiteConcepts,
    ...(unit.semanticConcepts ?? []).flatMap((concept) => [concept.slug, concept.preferredLabel]),
    ...(unit.knowledgeClaims ?? []).map((claim) => claim.text),
    unit.interactiveVisual?.uniqueConcept ?? "",
    unit.interactiveVisual?.expectedInsight ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function priorityForUnit(unit: LearningUnitContract): VisualizationOpportunity["priority"] {
  const requirement = unit.interactiveVisualPlan?.requirement;
  if (requirement === "required") return "critical";
  if (requirement === "recommended") return "high";
  if (requirement === "optional") return "medium";
  return "low";
}

function inputId(label: string, index: number): string {
  return safeId(label).replace(/-/g, "_") || `input_${index + 1}`;
}

const GENERIC_VISUAL_CONTRACT_IDS = new Set([
  "input",
  "input_1",
  "main_output",
  "output",
  "parameter",
  "result",
  "step",
  "value",
]);
const GENERIC_VISUAL_CONTRACT_LABEL_RE =
  /^(?:control|exploration level|input|main output|output|parameter|process step|result|step|value)$/i;

function cleanQuestionPhrase(value: string): string {
  return value
    .replace(/^[\s,:;-]+|[\s,?.:;-]+$/g, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function requiredGeneratedVisualizationContractProblems(input: {
  opportunities: readonly VisualizationOpportunity[];
  decisions: readonly VisualizationRouteDecision[];
}): string[] {
  const routeByOpportunity = new Map(
    input.decisions.map((decision) => [decision.opportunityId, decision]),
  );
  const problems: string[] = [];
  for (const opportunity of input.opportunities) {
    const route = routeByOpportunity.get(opportunity.id);
    if (opportunity.requirement !== "required" || route?.route !== "generated_module") continue;
    if (opportunity.controlContractProblems.length > 0) {
      problems.push(
        `${opportunity.id}: required generated visualization needs a validated model-authored learner control contract (${opportunity.controlContractProblems.join("; ")})`,
      );
    }
    if (opportunity.requiredInputs.length === 0) {
      problems.push(
        `${opportunity.id}: required generated visualization has no source-grounded learner input; repair the learning-unit contract with a specific variable, case, or process position`,
      );
    }
    for (const control of opportunity.requiredInputs) {
      if (
        GENERIC_VISUAL_CONTRACT_IDS.has(control.id.toLowerCase()) ||
        GENERIC_VISUAL_CONTRACT_LABEL_RE.test(control.label.trim())
      ) {
        problems.push(
          `${opportunity.id}: required generated visualization uses generic input "${control.id}"/"${control.label}"; repair the learning-unit contract with the source-backed learner action`,
        );
      }
    }
    if (opportunity.requiredOutputs.length === 0) {
      problems.push(
        `${opportunity.id}: required generated visualization has no source-grounded observable output`,
      );
    }
    for (const output of opportunity.requiredOutputs) {
      if (
        GENERIC_VISUAL_CONTRACT_IDS.has(output.id.toLowerCase()) ||
        GENERIC_VISUAL_CONTRACT_LABEL_RE.test(output.label.trim())
      ) {
        problems.push(
          `${opportunity.id}: required generated visualization uses generic output "${output.id}"/"${output.label}"; repair the learning-unit contract with the source-backed response`,
        );
      }
    }
  }
  return [...new Set(problems)];
}

function requiredInputsForUnit(
  _unit: LearningUnitContract,
  groundingUnit: LearningUnitContract = _unit,
): VisualizationOpportunityInput[] {
  const controlContract = groundingUnit.interactiveVisualPlan?.controlContract ?? [];
  if (controlContract.length > 0) {
    return controlContract.flatMap((control, index): VisualizationOpportunityInput[] => {
      if (control.kind === "select_case") {
        const options = [...new Set((control.options ?? []).map(cleanQuestionPhrase).filter(Boolean))];
        if (options.length < 2) return [];
        return [{
          id: inputId(control.label, index),
          label: control.label,
          type: "select",
          options,
          defaultValue: options[0],
        }];
      }
      return [{
        id: inputId(control.label, index),
        label: control.label,
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0.5,
      }];
    });
  }
  return [];
}

function requiredOutputsForUnit(
  _unit: LearningUnitContract,
  _goal: VisualizationInteractionGoal,
  groundingUnit: LearningUnitContract = _unit,
): VisualizationOpportunityOutput[] {
  const authoredObservable = groundingUnit.interactiveVisualPlan?.observable;
  if (
    authoredObservable &&
    persistedVisualizationControlContractProblems(groundingUnit).length === 0
  ) {
    return [{
      id: inputId(authoredObservable.label, 0),
      label: authoredObservable.label,
      representation: authoredObservable.representation,
    }];
  }
  return [];
}

function subsectionTarget(map: ProposedLearningMap, unitId: string, fallbackTitle: string) {
  for (let sectionIndex = 0; sectionIndex < map.sections.length; sectionIndex += 1) {
    const section = map.sections[sectionIndex];
    for (let subsectionIndex = 0; subsectionIndex < section.subsections.length; subsectionIndex += 1) {
      const subsection = section.subsections[subsectionIndex];
      if (subsection.learningUnitId !== unitId) continue;
      return {
        targetPage: `learning/${sectionIndex + 1}/${subsectionIndex + 1}-${safeId(subsection.title)}`,
        targetHeading: subsection.title,
        insertionAnchor: `learning-unit:${unitId}:after-introduction`,
      };
    }
  }
  return {
    targetPage: `learning/${safeId(unitId)}`,
    targetHeading: fallbackTitle,
    insertionAnchor: `learning-unit:${unitId}:after-introduction`,
  };
}

export function analyzeVisualizationOpportunities(input: {
  gardenId: string;
  learningMap: ProposedLearningMap;
  learningUnits: LearningUnitContract[];
  /**
   * Pre-necessity contracts may carry an explicit, already-grounded learner
   * action. They are evidence only: renderer/type selection still uses the
   * post-necessity units so a stale visual type cannot influence routing.
   */
  groundingUnits?: LearningUnitContract[];
}): VisualizationOpportunity[] {
  const groundingById = new Map(
    (input.groundingUnits ?? input.learningUnits).map((unit) => [unit.id, unit]),
  );
  return input.learningUnits
    .filter((unit) => {
      const requirement = unit.interactiveVisualPlan?.requirement;
      return requirement === "required" || requirement === "recommended" || requirement === "optional";
    })
    .map((unit) => {
    const groundingUnit = groundingById.get(unit.id) ?? unit;
    const visualPlan = unit.interactiveVisualPlan!;
    const priority = priorityForUnit(unit);
    const interactionGoal = visualPlan.interactionGoal!;
    const target = subsectionTarget(input.learningMap, unit.id, unit.title);
    const conceptIds = [
      ...(unit.semanticConcepts ?? []).map((concept) => concept.slug),
      ...unit.newConcepts.map(safeId),
    ].filter(Boolean);
    // Source figures are visual provenance. Formula and table contracts remain
    // represented by their canonical source anchors and must not be mislabeled
    // as source-image relationships in the generated artifact manifest.
    const sourceVisualIds = unit.sourceFigures.map((figure) => figure.id);
    const sourceVisualRelationships: SourceVisualRelationship[] = unit.sourceFigures.map((figure) => {
      if (figure.placement === "not_used_with_reason") {
        return {
          sourceVisualId: figure.id,
          treatment: "intentional_omission",
          fidelity: "exact_source_image",
          explanation: figure.notUsedReason || figure.interpretationGoal,
        };
      }
      return {
        sourceVisualId: figure.id,
        treatment: "source_embed_plus_interactive_reconstruction",
        fidelity: "illustrative",
        explanation: `The original source figure remains available; any interactive reconstruction is illustrative and supports: ${figure.interpretationGoal}`,
      };
    });
    const learningObjective = visualPlan.visualIntent!.expectedInsight;
    const pedagogicalReason = visualPlan.visualIntent!.whyStaticSourceFigureIsNotEnough;
    const fingerprint = stableHash({
      concepts: [...conceptIds].sort(),
      formulas: unit.sourceFormulas.map((formula) => formula.id).sort(),
      figures: unit.sourceFigures.map((figure) => figure.id).sort(),
      learningObjective: learningObjective.toLowerCase(),
      interactionGoal,
    });
    const id = `visual-${safeId(unit.id)}-${fingerprint.slice(0, 8)}`;
    return {
      id,
      gardenId: input.gardenId,
      learningUnitId: unit.id,
      ...target,
      conceptIds: [...new Set(conceptIds)],
      sourceAnchorIds: [...new Set(unit.sourceAnchors)],
      sourceVisualIds: [...new Set(sourceVisualIds)],
      sourceVisualRelationships,
      learningObjective,
      learnerQuestion: unit.learningQuestion,
      pedagogicalReason,
      interactionGoal,
      requiredInputs: requiredInputsForUnit(unit, groundingUnit),
      requiredOutputs: requiredOutputsForUnit(unit, interactionGoal, groundingUnit),
      controlContractProblems: persistedVisualizationControlContractProblems(groundingUnit),
      preferredRenderer: "generated_module",
      requiresGeneratedModule: false,
      priority,
      confidence: visualPlan.decision.confidence,
      similarityFingerprint: fingerprint,
      necessityDecision: visualPlan.decision,
      requirement: visualPlan.requirement,
    };
  });
}

function compatibilityScore(
  opportunity: VisualizationOpportunity,
  unit: LearningUnitContract,
  renderer: TrustedRendererDefinition,
): number {
  let score = 0;
  if (renderer.interactionGoals.includes(opportunity.interactionGoal)) score += 0.35;
  if (renderer.roles.includes(unit.role)) score += 0.25;
  const text = `${unitText(unit)} ${opportunity.learningObjective}`.toLowerCase();
  const matchingKeywords = renderer.keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
  score += Math.min(0.25, matchingKeywords.length * 0.1);
  if (opportunity.preferredRenderer === renderer.id) score += 0.2;
  const unsupportedControl = opportunity.requiredInputs.some(
    (control) => control.type === "number" || control.type === "button",
  );
  if (!unsupportedControl) score += 0.05;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

export function selectVisualizationRoutes(input: {
  opportunities: VisualizationOpportunity[];
  learningUnits: LearningUnitContract[];
  /** The active Learn path uses model authority and never picks a renderer semantically. */
  routingAuthority?: "legacy_heuristic" | "model_authored";
}): { opportunities: VisualizationOpportunity[]; decisions: VisualizationRouteDecision[] } {
  const units = new Map(input.learningUnits.map((unit) => [unit.id, unit]));
  const firstByFingerprint = new Map<string, VisualizationOpportunity>();
  const decisions: VisualizationRouteDecision[] = [];
  const opportunities = input.opportunities.map((opportunity) => ({ ...opportunity }));

  if (input.routingAuthority === "model_authored") {
    for (const opportunity of opportunities) {
      opportunity.requiresGeneratedModule = true;
      decisions.push({
        opportunityId: opportunity.id,
        route: "generated_module",
        reason:
          opportunity.necessityDecision.reason ||
          "The model-authored visual contract requires a generated interaction.",
      });
    }
    return { opportunities, decisions };
  }

  for (const opportunity of opportunities) {
    const duplicate = firstByFingerprint.get(opportunity.similarityFingerprint);
    if (duplicate) {
      decisions.push({
        opportunityId: opportunity.id,
        route: "intentional_omission",
        duplicateOf: duplicate.id,
        reason: `Merged with ${duplicate.id}; it teaches the same objective, source relationship, and interaction pattern.`,
      });
      continue;
    }
    firstByFingerprint.set(opportunity.similarityFingerprint, opportunity);

    const unit = units.get(opportunity.learningUnitId);
    if (!unit) {
      decisions.push({
        opportunityId: opportunity.id,
        route: "intentional_omission",
        reason: "The learning unit no longer exists in the confirmed contract.",
      });
      continue;
    }

    const scored = TRUSTED_RENDERER_REGISTRY.renderers
      .filter((renderer) => visualTypeCompatibleWithUnit(renderer.id, unit).ok)
      .map((renderer) => ({ renderer, score: compatibilityScore(opportunity, unit, renderer) }))
      .sort((left, right) => right.score - left.score || left.renderer.id.localeCompare(right.renderer.id));
    const best = scored[0];
    if (best && best.score >= TRUSTED_RENDERER_REGISTRY.compatibilityThreshold) {
      decisions.push({
        opportunityId: opportunity.id,
        route: "trusted_renderer",
        selectedRenderer: best.renderer.id,
        compatibilityScore: best.score,
        reason: `${best.renderer.label} satisfies the learning objective, unit role, and ${opportunity.interactionGoal.replace(/_/g, " ")} interaction.`,
      });
      continue;
    }

    if (opportunity.requirement === "optional") {
      decisions.push({
        opportunityId: opportunity.id,
        route: "intentional_omission",
        compatibilityScore: best?.score,
        reason: `Optional interaction omitted because no trusted renderer cleared the compatibility threshold. ${opportunity.pedagogicalReason}`,
      });
      continue;
    }

    opportunity.requiresGeneratedModule = true;
    decisions.push({
      opportunityId: opportunity.id,
      route: "generated_module",
      ...(best && best.score >= TRUSTED_RENDERER_REGISTRY.compatibilityThreshold * 0.75
        ? { selectedRenderer: best.renderer.id }
        : {}),
      compatibilityScore: best?.score,
      reason: best
        ? `Best trusted renderer (${best.renderer.id}, ${best.score.toFixed(2)}) is below the ${TRUSTED_RENDERER_REGISTRY.compatibilityThreshold.toFixed(2)} pedagogical compatibility threshold.`
        : "No trusted renderer can express the required interaction.",
    });
  }
  return { opportunities, decisions };
}

export function buildVisualizationPlan(input: {
  gardenId: string;
  learningMap: ProposedLearningMap;
  learningUnits: LearningUnitContract[];
  groundingUnits?: LearningUnitContract[];
  necessityReviewCalls?: number;
  rejectedNecessityReviews?: number;
  visualDecisionOverrides?: VisualDecisionOverride[];
}): VisualizationPlan {
  const hasPersistedNecessity =
    input.learningUnits.length > 0 &&
    input.learningUnits.every((unit) => unit.interactiveVisualPlan && unit.teachingMediumPlan);
  if (!hasPersistedNecessity) {
    throw new Error(
      "Visualization routing requires a validated model-authored necessity and teaching-medium decision for every learning unit.",
    );
  }
  const incompleteModelContracts = input.learningUnits.flatMap((unit) => {
    const plan = unit.interactiveVisualPlan!;
    if (plan.requirement === "none") return [];
    const problems: string[] = [];
    if (!plan.interactionGoal) problems.push("missing model-authored interactionGoal");
    if (!plan.visualIntent) problems.push("missing model-authored visualIntent");
    if (!plan.observable) problems.push("missing model-authored observable");
    problems.push(...persistedVisualizationControlContractProblems(unit));
    return problems.map((problem) => `${unit.id}: ${problem}`);
  });
  if (incompleteModelContracts.length > 0) {
    throw new Error(
      `Visualization opportunity contract validation failed: ${[...new Set(incompleteModelContracts)].join("; ")}`,
    );
  }
  const necessityPlan = {
    learningUnits: input.learningUnits,
    decisions: input.learningUnits.map((unit) => unit.interactiveVisualPlan!.decision),
    teachingMedia: input.learningUnits.map((unit) => unit.teachingMediumPlan!),
    // This is report metadata only. It does not select, promote, demote, or
    // remove a visual; all such decisions are already present on the contract.
    budget: deriveGardenVisualBudget(
      input.learningUnits,
      input.learningUnits.map((unit) => unit.interactiveVisualPlan!.decision),
    ),
    overrides: input.visualDecisionOverrides ?? [],
  };
  const opportunities = analyzeVisualizationOpportunities({
    ...input,
    learningUnits: necessityPlan.learningUnits,
    groundingUnits: input.groundingUnits ?? input.learningUnits,
  });
  const selected = selectVisualizationRoutes({
    opportunities,
    learningUnits: necessityPlan.learningUnits,
    routingAuthority: "model_authored",
  });
  const opportunityContractProblems = requiredGeneratedVisualizationContractProblems(selected);
  if (opportunityContractProblems.length > 0) {
    throw new Error(
      `Visualization opportunity contract validation failed: ${opportunityContractProblems.join("; ")}`,
    );
  }
  return {
    schemaVersion: 1,
    gardenId: input.gardenId,
    generatedAt: new Date().toISOString(),
    opportunities: selected.opportunities,
    decisions: selected.decisions,
    visualNecessityDecisions: necessityPlan.decisions,
    teachingMedia: necessityPlan.teachingMedia,
    visualBudget: necessityPlan.budget,
    visualDecisionOverrides: necessityPlan.overrides,
    necessityReviewCalls: input.necessityReviewCalls ?? 0,
    rejectedNecessityReviews: input.rejectedNecessityReviews ?? 0,
  };
}

/** Attach renderer/type intent only after necessity and garden coordination. */
export function applyVisualizationRoutesToLearningUnits(
  learningUnits: LearningUnitContract[],
  plan: VisualizationPlan,
): LearningUnitContract[] {
  const opportunityByUnit = new Map(plan.opportunities.map((item) => [item.learningUnitId, item]));
  const routeByOpportunity = new Map(plan.decisions.map((item) => [item.opportunityId, item]));
  return learningUnits.map((unit) => {
    const visualPlan = unit.interactiveVisualPlan;
    if (!visualPlan || visualPlan.requirement === "none") {
      return { ...unit, interactiveVisual: undefined };
    }
    const opportunity = opportunityByUnit.get(unit.id);
    const route = opportunity ? routeByOpportunity.get(opportunity.id) : undefined;
    if (!opportunity || !route || route.route === "intentional_omission") {
      return {
        ...unit,
        interactiveVisual: undefined,
        interactiveVisualPlan: {
          ...visualPlan,
          visualIntent: undefined,
          omissionReason: route?.reason ?? visualPlan.omissionReason,
        },
      };
    }
    const candidateType = route.selectedRenderer ?? visualPlan.decision.recommendedVisualType;
    const selectedType = route.route === "generated_module"
      ? candidateType && visualTypeCompatibleWithUnit(candidateType, unit).ok
        ? candidateType
        : "generated_module"
      : candidateType && visualTypeCompatibleWithUnit(candidateType, unit).ok
        ? candidateType
        : undefined;
    if (!selectedType) {
      return {
        ...unit,
        interactiveVisual: undefined,
        interactiveVisualPlan: {
          ...visualPlan,
          decision: { ...visualPlan.decision, recommendedVisualType: undefined },
          visualIntent: undefined,
        },
      };
    }
    const intent: InteractiveVisualIntent = visualPlan.visualIntent ?? {
      id: opportunity.id,
      uniqueConcept: opportunity.learningObjective,
      visualType: selectedType,
      whyStaticSourceFigureIsNotEnough: opportunity.pedagogicalReason,
      learnerManipulates: opportunity.requiredInputs.map((item) => item.label),
      expectedInsight: opportunity.requiredOutputs.map((item) => item.label).join("; "),
      sourceAnchors: [...new Set([...opportunity.sourceAnchorIds, ...opportunity.sourceVisualIds])],
      duplicateSignature: opportunity.similarityFingerprint,
    };
    const typedIntent = { ...intent, visualType: selectedType };
    return {
      ...unit,
      interactiveVisual: typedIntent,
      interactiveVisualPlan: {
        ...visualPlan,
        decision: { ...visualPlan.decision, recommendedVisualType: selectedType },
        visualIntent: typedIntent,
        omissionReason: undefined,
      },
    };
  });
}

export function visualizationPlanPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "visualization-plan.json");
}

export function saveVisualizationPlan(gardenDir: string, plan: VisualizationPlan): void {
  const filePath = visualizationPlanPath(gardenDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(plan, null, 2)}\n`, "utf-8");
  saveVisualNecessityArtifacts(gardenDir, plan.gardenId, {
    decisions: plan.visualNecessityDecisions,
    teachingMedia: plan.teachingMedia,
    budget: plan.visualBudget,
    overrides: plan.visualDecisionOverrides,
    reviewCalls: plan.necessityReviewCalls,
    rejectedReviews: plan.rejectedNecessityReviews,
  });
}

export function loadVisualizationPlan(gardenDir: string): VisualizationPlan | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(visualizationPlanPath(gardenDir), "utf-8"));
    if (
      parsed?.schemaVersion !== 1 ||
      !Array.isArray(parsed.opportunities) ||
      !Array.isArray(parsed.decisions)
    ) {
      return null;
    }
    const visualBudget: GardenVisualBudget = parsed.visualBudget ?? {
      targetMinimum: 0,
      targetMaximum: 0,
      maximumPerSection: 2,
      minimumUnitsBetweenSimilarVisuals: 3,
      requiredVisuals: 0,
      recommendedVisuals: 0,
      optionalVisuals: 0,
      reason: "Legacy visualization plan; necessity will be recalculated before repair or regeneration.",
    };
    return {
      ...parsed,
      visualNecessityDecisions: Array.isArray(parsed.visualNecessityDecisions)
        ? parsed.visualNecessityDecisions
        : [],
      teachingMedia: Array.isArray(parsed.teachingMedia) ? parsed.teachingMedia : [],
      visualBudget,
      visualDecisionOverrides: Array.isArray(parsed.visualDecisionOverrides)
        ? parsed.visualDecisionOverrides
        : [],
      necessityReviewCalls: Number(parsed.necessityReviewCalls) || 0,
      rejectedNecessityReviews: Number(parsed.rejectedNecessityReviews) || 0,
    } as VisualizationPlan;
  } catch {
    return null;
  }
}

export function coverageGateMode(
  env: NodeJS.ProcessEnv = process.env,
): "off" | "warning" | "fail" {
  const value = String(env.LEARN_VISUAL_COVERAGE_GATE ?? "warning").trim().toLowerCase();
  return value === "off" || value === "fail" ? value : "warning";
}

export function buildVisualizationCoverageReport(input: {
  plan: VisualizationPlan;
  outcomes: VisualizationPublicationOutcome[];
  gate?: "off" | "warning" | "fail";
}): VisualizationCoverageReport {
  const outcomeByOpportunity = new Map(input.outcomes.map((outcome) => [outcome.opportunityId, outcome]));
  const decisions = new Map(input.plan.decisions.map((decision) => [decision.opportunityId, decision]));
  const covered = new Set(
    input.outcomes
      .filter((outcome) => outcome.status === "trusted_published" || outcome.status === "generated_published")
      .map((outcome) => outcome.opportunityId),
  );
  const approvedOmissions = new Set(
    input.outcomes
      .filter((outcome) => outcome.status === "intentional_omission")
      .map((outcome) => outcome.opportunityId),
  );
  const actionable = input.plan.opportunities.filter(
    (opportunity) => decisions.get(opportunity.id)?.route !== "intentional_omission",
  );
  const uncoveredCriticalOpportunityIds = actionable
    .filter((opportunity) => opportunity.priority === "critical" && !covered.has(opportunity.id))
    .map((opportunity) => opportunity.id);
  const uncoveredHighPriorityOpportunityIds = actionable
    .filter((opportunity) => opportunity.priority === "high" && !covered.has(opportunity.id))
    .map((opportunity) => opportunity.id);
  const weightedTotal = actionable.reduce(
    (sum, opportunity) => sum + (opportunity.priority === "critical" ? 3 : opportunity.priority === "high" ? 2 : 1),
    0,
  );
  const weightedCovered = actionable.reduce(
    (sum, opportunity) =>
      sum +
      (covered.has(opportunity.id)
        ? opportunity.priority === "critical"
          ? 3
          : opportunity.priority === "high"
            ? 2
            : 1
        : 0),
    0,
  );
  const gate = input.gate ?? coverageGateMode();
  const publishedCount = covered.size;
  const explanations: string[] = [];
  if (publishedCount === 0 && actionable.some((item) => item.requirement !== "optional")) {
    explanations.push("No required or recommended interactive visualizations were published.");
  }
  if (uncoveredCriticalOpportunityIds.length > 0) {
    explanations.push(`${uncoveredCriticalOpportunityIds.length} critical opportunity or opportunities remain uncovered.`);
  }
  if (uncoveredHighPriorityOpportunityIds.length > 0) {
    explanations.push(`${uncoveredHighPriorityOpportunityIds.length} high-priority opportunity or opportunities remain uncovered.`);
  }
  const status: VisualizationCoverageReport["status"] =
    gate === "fail" && uncoveredCriticalOpportunityIds.length > 0
      ? "fail"
      : uncoveredCriticalOpportunityIds.length > 0 ||
          uncoveredHighPriorityOpportunityIds.length > 0
        ? "warning"
        : "pass";
  const count = (statusName: VisualizationPublicationOutcome["status"]) =>
    input.outcomes.filter((outcome) => outcome.status === statusName).length;
  return {
    opportunitiesDetected: input.plan.opportunities.length,
    criticalOpportunities: input.plan.opportunities.filter((item) => item.priority === "critical").length,
    highPriorityOpportunities: input.plan.opportunities.filter((item) => item.priority === "high").length,
    trustedVisualsPublished: count("trusted_published"),
    generatedVisualsPublished: count("generated_published"),
    omittedAsPedagogicallyUnhelpful: approvedOmissions.size,
    failedValidation: count("failed_validation"),
    failedCompilation: count("failed_compilation"),
    failedRuntimeTests: count("failed_runtime_tests"),
    failedCritic: count("failed_critic"),
    uncoveredCriticalOpportunityIds,
    uncoveredHighPriorityOpportunityIds,
    coverageScore: weightedTotal === 0 ? 1 : Number((weightedCovered / weightedTotal).toFixed(3)),
    status,
    explanations,
  };
}

export function saveVisualizationCoverageReport(
  gardenDir: string,
  report: VisualizationCoverageReport,
): void {
  const breadboardDir = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(breadboardDir, { recursive: true });
  fs.writeFileSync(
    path.join(breadboardDir, "visualization-coverage.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf-8",
  );
  const lines = [
    "# Visualization generation report",
    "",
    `- Opportunities detected: ${report.opportunitiesDetected}`,
    `- Trusted visuals published: ${report.trustedVisualsPublished}`,
    `- Generated visuals published: ${report.generatedVisualsPublished}`,
    `- Intentional omissions: ${report.omittedAsPedagogicallyUnhelpful}`,
    `- Validation failures: ${report.failedValidation}`,
    `- Compilation failures: ${report.failedCompilation}`,
    `- Runtime failures: ${report.failedRuntimeTests}`,
    `- Critic rejections: ${report.failedCritic}`,
    `- Uncovered critical opportunities: ${report.uncoveredCriticalOpportunityIds.length}`,
    `- Final coverage status: ${report.status}`,
    "",
    ...report.explanations.map((explanation) => `- ${explanation}`),
    "",
  ];
  fs.writeFileSync(path.join(breadboardDir, "visualization-report.md"), lines.join("\n"), "utf-8");
}

export function preferredTrustedRenderer(opportunity: VisualizationOpportunity) {
  return opportunity.preferredRenderer ? trustedRenderer(opportunity.preferredRenderer) : undefined;
}

export function roleSupportsVisualInteraction(role: LearningUnitRole): boolean {
  return !["motivation", "limitation"].includes(role);
}
