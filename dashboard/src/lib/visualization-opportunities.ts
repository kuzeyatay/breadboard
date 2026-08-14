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
  planGardenVisualNecessity,
  saveVisualNecessityArtifacts,
} from "./visual-necessity.ts";
import type {
  ContractInteractiveVisualPlan,
  GardenVisualBudget,
  InteractiveVisualIntent,
  TeachingMediumPlan,
  VisualDecisionOverride,
  VisualNecessityDecision,
} from "./visual-necessity-types.ts";
import {
  TRUSTED_RENDERER_REGISTRY,
  trustedRenderer,
  type TrustedRendererDefinition,
  type VisualizationInteractionGoal,
} from "./visualization-registry.ts";

export type VisualizationInputType = "slider" | "number" | "select" | "toggle" | "button";
export type VisualizationOutputRepresentation =
  | "value"
  | "chart"
  | "diagram"
  | "animation"
  | "timeline"
  | "table"
  | "annotation";

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

function interactionGoalForUnit(unit: LearningUnitContract): VisualizationInteractionGoal {
  const text = unitText(unit);
  // A unit whose *role* is comparison is fundamentally a compare-cases
  // interaction, even when its prose incidentally mentions temporal words
  // ("signals over time"). Checking this before the time/step keyword rules keeps
  // such units from being misrouted to a time-series renderer and then falling
  // through to the generated-module path when no time renderer fits.
  if (unit.role === "comparison" || /compare|versus|trade[- ]?off|alternative/i.test(text)) {
    return "compare_cases";
  }
  if (/algorithm|step|sequence|procedure|derivation/i.test(text)) return "step_through_process";
  if (/time|timeline|temporal|dynamic|training|convergence|trajectory|animation/i.test(text)) {
    return "observe_change_over_time";
  }
  if (/network|hierarchy|structure|spatial|geometry|node|edge/i.test(text)) return "explore_structure";
  if (unit.role === "mechanism" || /causal|feedback|mechanism|system/i.test(text)) {
    return "simulate_system";
  }
  if (unit.role === "formula" || unit.sourceFormulas.length > 0) return "manipulate_variables";
  if (/predict|boundary|optimization|hypothesis/i.test(text)) return "test_prediction";
  return "inspect_relationship";
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

interface GroundedQuestionRelationship {
  inputs: string[];
  outputs: string[];
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

/**
 * Extract only relationships that the learning contract states explicitly.
 * This is intentionally conservative: a missing match is a planning defect,
 * not permission to invent a generic slider called `step` or `parameter`.
 */
function groundedRelationshipFromQuestion(question: string): GroundedQuestionRelationship {
  const compactQuestion = question.replace(/\s+/g, " ").trim();
  if (!compactQuestion) return { inputs: [], outputs: [] };

  const changing = compactQuestion.match(
    /\b(?:changing|varying|adjusting|increasing|decreasing)\s+(.+?)\s+(?:alters?|affects?|changes?|shapes?|influences?|controls?|determines?|modifies?|shifts?)\s+(.+?)(?:\s+over time)?[?.]?$/i,
  );
  if (changing) {
    return {
      inputs: [cleanQuestionPhrase(changing[1])].filter(Boolean),
      outputs: [cleanQuestionPhrase(changing[2])].filter(Boolean),
    };
  }

  const changesWith = compactQuestion.match(
    /\b(?:how|why)\s+(?:does|do)\s+(.+?)\s+(?:change|vary|evolve|respond)\s+(?:with|as)\s+(.+?)[?.]?$/i,
  );
  if (changesWith) {
    return {
      inputs: [cleanQuestionPhrase(changesWith[2])].filter(Boolean),
      outputs: [cleanQuestionPhrase(changesWith[1])].filter(Boolean),
    };
  }

  const directRelationship = compactQuestion.match(
    /\b(?:how|why)\s+(?:does|do|must|can)\s+(.+?)\s+(?:encodes?|generates?|produces?|determines?|acts?\s+like)\s+(.+?)(?=,\s*(?:and|while|but)\b|\?|$)/i,
  );
  if (directRelationship) {
    return {
      inputs: [cleanQuestionPhrase(directRelationship[1])].filter(Boolean),
      outputs: [cleanQuestionPhrase(directRelationship[2])].filter(Boolean),
    };
  }

  const motionAlongPath = compactQuestion.match(
    /\bhow\s+does\s+.+?\s+when\s+(.+?)\s+(?:moves?|travels?|progresses?)\s+(along|through|across)\s+(.+?)[?.]?$/i,
  );
  if (motionAlongPath) {
    const movingEntity = cleanQuestionPhrase(motionAlongPath[1]);
    const preposition = motionAlongPath[2].toLowerCase();
    const path = cleanQuestionPhrase(motionAlongPath[3]);
    return {
      inputs: movingEntity && path
        ? [`${movingEntity} position ${preposition} ${path}`]
        : [],
      // The response is selected from the unit's explicit concepts below; the
      // question's pre-"when" clause is not parsed into an invented quantity.
      outputs: [],
    };
  }

  const whenChanges = compactQuestion.match(
    /\b(?:what happens to|how does)\s+(.+?)\s+when\s+(.+?)\s+(?:changes?|varies?|increases?|decreases?)[?.]?$/i,
  );
  if (whenChanges) {
    return {
      inputs: [cleanQuestionPhrase(whenChanges[2])].filter(Boolean),
      outputs: [cleanQuestionPhrase(whenChanges[1])].filter(Boolean),
    };
  }

  return { inputs: [], outputs: [] };
}

function explicitComparisonCases(unit: LearningUnitContract): string[] {
  const question = unit.learningQuestion.replace(/\s+/g, " ").trim();
  const versus = question.match(/\b(.+?)\s+(?:versus|vs\.?)\s+(.+?)(?:\?|\s+(?:under|when|across)\b)/i);
  if (versus) {
    return [cleanQuestionPhrase(versus[1]), cleanQuestionPhrase(versus[2])]
      .filter(Boolean)
      .slice(-2);
  }
  const between = question.match(/\b(?:difference|trade-?off)\s+between\s+(.+?)\s+and\s+(.+?)[?.]?$/i);
  if (between) {
    return [cleanQuestionPhrase(between[1]), cleanQuestionPhrase(between[2])].filter(Boolean);
  }
  return [];
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
  unit: LearningUnitContract,
  groundingUnit: LearningUnitContract = unit,
): VisualizationOpportunityInput[] {
  const declared = [
    ...(groundingUnit.interactiveVisual?.learnerManipulates ?? []),
    ...(groundingUnit.interactiveVisualPlan?.visualIntent?.learnerManipulates ?? []),
  ];
  const formulaTerms = unit.sourceFormulas.flatMap((formula) => formula.termsToDefine);
  const questionRelationship = groundedRelationshipFromQuestion(unit.learningQuestion);
  const labels = [...new Set([...declared, ...formulaTerms, ...questionRelationship.inputs])]
    .map(cleanQuestionPhrase)
    .filter((label) => label && !GENERIC_VISUAL_CONTRACT_LABEL_RE.test(label))
    .slice(0, 8);
  const comparisonCases = explicitComparisonCases(unit);
  if (unit.role === "comparison" && labels.length === 0 && comparisonCases.length >= 2) {
    return [
      {
        id: inputId(`${comparisonCases.join(" versus ")} case`, 0),
        label: `${comparisonCases.join(" versus ")} case`,
        type: "select",
        options: comparisonCases,
        defaultValue: comparisonCases[0],
      },
    ];
  }
  // Do not synthesize a generic control. A required generated visualization
  // without a source-grounded learner action is rejected by the planning gate
  // below, where the contract can be repaired before generation spends tokens.
  if (labels.length === 0) return [];
  return labels.map((label, index) => ({
    id: inputId(label, index),
    label,
    type: "slider",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.5,
  }));
}

function requiredOutputsForUnit(
  unit: LearningUnitContract,
  goal: VisualizationInteractionGoal,
  groundingUnit: LearningUnitContract = unit,
): VisualizationOpportunityOutput[] {
  const questionRelationship = groundedRelationshipFromQuestion(unit.learningQuestion);
  const labels = [
    ...questionRelationship.outputs,
    groundingUnit.interactiveVisual?.expectedInsight,
    groundingUnit.interactiveVisualPlan?.visualIntent?.expectedInsight,
    unit.interactiveVisual?.expectedInsight,
    unit.newConcepts[0],
    unit.semanticConcepts?.find((concept) => concept.role === "primary")?.preferredLabel,
    unit.title,
  ]
    .map((label) => cleanQuestionPhrase(label ?? ""))
    .filter((label) => label && !GENERIC_VISUAL_CONTRACT_LABEL_RE.test(label));
  const label = labels[0];
  if (!label) return [];
  return [{
    id: inputId(label, 0),
    label,
    representation: outputRepresentation(goal, unit),
  }];
}

function outputRepresentation(
  goal: VisualizationInteractionGoal,
  unit: LearningUnitContract,
): VisualizationOutputRepresentation {
  if (goal === "observe_change_over_time") return "animation";
  if (goal === "step_through_process") return "timeline";
  if (goal === "explore_structure" || goal === "simulate_system") return "diagram";
  if (goal === "compare_cases" && unit.sourceTables.length > 0) return "table";
  if (unit.role === "formula" || goal === "manipulate_variables") return "chart";
  return "annotation";
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
    const interactionGoal = interactionGoalForUnit(unit);
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
    const learningObjective =
      unit.interactiveVisual?.expectedInsight || unit.learningQuestion || `Understand ${unit.title}`;
    const pedagogicalReason =
      unit.interactiveVisual?.whyStaticSourceFigureIsNotEnough ||
      (priority === "low"
        ? "The subsection is primarily explanatory and has no manipulable relationship, process, comparison, or structure that interaction would clarify."
        : `Interaction lets the learner ${interactionGoal.replace(/_/g, " ")} instead of only reading a static explanation.`);
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
      learnerQuestion: unit.learningQuestion || unit.title,
      pedagogicalReason,
      interactionGoal,
      requiredInputs: requiredInputsForUnit(unit, groundingUnit),
      requiredOutputs: requiredOutputsForUnit(unit, interactionGoal, groundingUnit),
      ...(unit.interactiveVisual?.visualType
        ? { preferredRenderer: unit.interactiveVisual.visualType }
        : {}),
      requiresGeneratedModule: false,
      priority,
      confidence: unit.interactiveVisual ? 0.95 : priority === "low" ? 0.65 : 0.82,
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
}): { opportunities: VisualizationOpportunity[]; decisions: VisualizationRouteDecision[] } {
  const units = new Map(input.learningUnits.map((unit) => [unit.id, unit]));
  const firstByFingerprint = new Map<string, VisualizationOpportunity>();
  const decisions: VisualizationRouteDecision[] = [];
  const opportunities = input.opportunities.map((opportunity) => ({ ...opportunity }));

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
  necessityReviewCalls?: number;
  rejectedNecessityReviews?: number;
  visualDecisionOverrides?: VisualDecisionOverride[];
}): VisualizationPlan {
  const hasPersistedNecessity =
    input.learningUnits.length > 0 &&
    input.learningUnits.every((unit) => unit.interactiveVisualPlan && unit.teachingMediumPlan);
  const necessityPlan = hasPersistedNecessity
    ? {
        learningUnits: input.learningUnits,
        decisions: input.learningUnits.map((unit) => unit.interactiveVisualPlan!.decision),
        teachingMedia: input.learningUnits.map((unit) => unit.teachingMediumPlan!),
        budget: deriveGardenVisualBudget(
          input.learningUnits,
          input.learningUnits.map((unit) => unit.interactiveVisualPlan!.decision),
        ),
        overrides: input.visualDecisionOverrides ?? [],
      }
    : planGardenVisualNecessity({
        gardenId: input.gardenId,
        learningUnits: input.learningUnits,
      });
  const opportunities = analyzeVisualizationOpportunities({
    ...input,
    learningUnits: necessityPlan.learningUnits,
    groundingUnits: input.learningUnits,
  });
  const selected = selectVisualizationRoutes({
    opportunities,
    learningUnits: necessityPlan.learningUnits,
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
    const selectedType = candidateType && visualTypeCompatibleWithUnit(candidateType, unit).ok
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
