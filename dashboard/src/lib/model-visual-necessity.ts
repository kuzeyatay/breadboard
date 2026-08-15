import type { LearningUnitContract } from "./learning-unit-contract.ts";
import type {
  ContractInteractiveVisualPlan,
  GardenVisualBudget,
  GardenZeroVisualSafeguard,
  InteractiveVisualOutputRepresentation,
  InteractiveVisualPedagogyContract,
  InteractiveVisualNecessity,
  PreferredTeachingMedium,
  TeachingMediumPlan,
  VisualDecisionOverride,
  VisualDecisionRecord,
  VisualNecessityDecision,
} from "./visual-necessity-types.ts";
import type { VisualizationInteractionGoal } from "./visualization-registry.ts";
import {
  parseVisualizationContractRepairResponse,
  validateVisualizationContractUnitRepair,
  type VisualizationContractControlRepair,
  type VisualizationContractEvidenceEntry,
  type VisualizationContractEvidenceRef,
} from "./visualization-contract-validation.ts";

/**
 * The model is the sole author of pedagogical visual-necessity decisions.
 * This module only packages evidence and validates the returned contract. It
 * deliberately contains no keyword rules, scoring heuristics, fallback
 * decisions, quota promotion, duplicate demotion, or medium selection.
 */

export const MODEL_VISUAL_NECESSITY_SCHEMA_VERSION = 1 as const;

/** One initial whole-garden call plus at most two model repair calls. */
export const MODEL_VISUAL_NECESSITY_CALL_BUDGET = Object.freeze({
  initialCalls: 1,
  maximumRepairCalls: 2,
  maximumTotalCalls: 3,
});

/** Unit-scoped repair is separate from the whole-batch semantic budget. */
export const MODEL_VISUAL_NECESSITY_TARGETED_REPAIR_CALL_BUDGET = Object.freeze({
  maximumRepairCalls: 2,
});

export type ModelVisualEvidenceItem = VisualizationContractEvidenceEntry;

export interface ModelVisualNecessityUnitPacket {
  unitId: string;
  pageId: string;
  sectionId?: string;
  title: string;
  role: string;
  learningQuestion: string;
  prerequisiteConcepts: string[];
  concepts: string[];
  sourceAnchorIds: string[];
  evidence: ModelVisualEvidenceItem[];
}

/** Maximums are constraints, never targets or minimum quotas. */
export interface ModelVisualNecessityBudgetPolicy {
  maximumInteractiveUnits: number;
  maximumRequiredInteractiveUnits: number;
  maximumInteractiveUnitsPerSection?: number;
  maximumRepeatedInteractionSignature?: number;
}

export interface ModelVisualNecessityPacket {
  schemaVersion: typeof MODEL_VISUAL_NECESSITY_SCHEMA_VERSION;
  gardenId: string;
  units: ModelVisualNecessityUnitPacket[];
  budget: ModelVisualNecessityBudgetPolicy;
  overrides: VisualDecisionOverride[];
}

export interface ModelLearnerObservableDraft {
  label: string;
  representation: InteractiveVisualOutputRepresentation;
  evidence: VisualizationContractEvidenceRef[];
}

export type ModelInteractionContractDraft = InteractiveVisualPedagogyContract;

export interface ModelAuthoredVisualNecessityDecision extends VisualNecessityDecision {
  confidence: number;
  alternativeCoverage: "covered" | "uncovered" | "unverified";
  teachingMediumReason: string;
  interaction?: ModelInteractionContractDraft;
}

export interface ModelVisualNecessityBatchResponse {
  schemaVersion: typeof MODEL_VISUAL_NECESSITY_SCHEMA_VERSION;
  gardenId: string;
  gardenRationale: string;
  visualBudget: GardenVisualBudget;
  decisions: ModelAuthoredVisualNecessityDecision[];
}

export interface ModelVisualNecessityProblem {
  code: string;
  path: string;
  message: string;
  unitId?: string;
}

export interface ValidatedModelVisualNecessityPlan {
  response: ModelVisualNecessityBatchResponse;
  decisions: VisualNecessityDecision[];
  interactionDrafts: Record<string, ModelInteractionContractDraft>;
  learningUnits: LearningUnitContract[];
  teachingMedia: TeachingMediumPlan[];
  budget: GardenVisualBudget;
  decisionRecords: VisualDecisionRecord[];
  zeroVisualSafeguard: GardenZeroVisualSafeguard;
  counts: {
    interactive: number;
    required: number;
    recommended: number;
    optional: number;
    nonInteractive: number;
  };
}

export type ModelVisualNecessityValidationResult =
  | { ok: true; plan: ValidatedModelVisualNecessityPlan }
  | { ok: false; problems: ModelVisualNecessityProblem[] };

export interface ModelVisualNecessityProviderRequest {
  system: string;
  user: string;
  sourceContext: unknown;
  /** Zero is the initial call; one and two are the bounded repair calls. */
  attempt: number;
  problems: ModelVisualNecessityProblem[];
}

export type ModelVisualNecessityProvider = (
  request: ModelVisualNecessityProviderRequest,
) => Promise<unknown>;

export interface ModelVisualNecessityRunResult {
  plan: ValidatedModelVisualNecessityPlan;
  calls: number;
  repairCalls: number;
  targetedRepairCalls: number;
}

export interface ModelVisualNecessityTargetedRepairUnit {
  unit: ModelVisualNecessityUnitPacket;
  invalidDecision: unknown;
  problems: ModelVisualNecessityProblem[];
}

export interface ModelVisualNecessityTargetedRepairPacket {
  schemaVersion: typeof MODEL_VISUAL_NECESSITY_SCHEMA_VERSION;
  gardenId: string;
  units: ModelVisualNecessityTargetedRepairUnit[];
  wholeGardenConstraints: {
    requestBudget: ModelVisualNecessityBudgetPolicy;
    currentVisualBudget: unknown;
    overrides: VisualDecisionOverride[];
    reservedDuplicateSignatures: string[];
    untouchedDecisionIndex: Array<{
      unitId: string;
      sectionId?: string;
      necessity: string;
      preferredMedium: string;
      duplicateSignature?: string;
    }>;
  };
  previousRejectionReasons: ModelVisualNecessityProblem[];
}

export interface ModelVisualNecessityTargetedRepairProviderRequest {
  system: string;
  user: string;
  sourceContext: unknown;
  attempt: number;
  problems: ModelVisualNecessityProblem[];
  unitIds: string[];
}

export type ModelVisualNecessityTargetedRepairProvider = (
  request: ModelVisualNecessityTargetedRepairProviderRequest,
) => Promise<unknown>;

export class ModelVisualNecessityPlanningError extends Error {
  readonly calls: number;
  readonly problems: ModelVisualNecessityProblem[];
  readonly lastResponse: unknown;

  constructor(input: {
    calls: number;
    problems: ModelVisualNecessityProblem[];
    lastResponse: unknown;
  }) {
    const summary = input.problems
      .slice(0, 6)
      .map((problem) => `${problem.path}: ${problem.message}`)
      .join("; ");
    super(
      `Model-authored visual-necessity planning remained invalid after ${input.calls} calls` +
      `${summary ? `: ${summary}` : "."}`,
    );
    this.name = "ModelVisualNecessityPlanningError";
    this.calls = input.calls;
    this.problems = input.problems;
    this.lastResponse = input.lastResponse;
  }
}

const NECESSITIES = new Set<InteractiveVisualNecessity>([
  "required",
  "recommended",
  "optional",
  "not_needed",
  "harmful_or_distracting",
]);

const MEDIA = new Set<PreferredTeachingMedium>([
  "interactive_visual",
  "source_figure",
  "generated_static_diagram",
  "formula_derivation",
  "worked_example",
  "comparison_table",
  "timeline",
  "prose",
  "no_additional_visual",
]);

const ACTIVE_NECESSITIES = new Set<InteractiveVisualNecessity>([
  "required",
  "recommended",
  "optional",
]);

const SCORE_FIELDS = [
  "manipulationValue",
  "dynamicBehaviorValue",
  "comparisonValue",
  "spatialValue",
  "parameterSensitivityValue",
  "sourceFigureSufficiency",
  "proseSufficiency",
  "formulaSufficiency",
  "workedExampleSufficiency",
  "cognitiveLoadRisk",
  "duplicationRisk",
  "implementationRisk",
] as const;

function compact(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(compact).filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value.map((item) => compact(item)).filter(Boolean);
}

function validateBudgetPolicy(policy: ModelVisualNecessityBudgetPolicy): void {
  for (const [name, value] of Object.entries(policy)) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Visual necessity budget ${name} must be a non-negative integer.`);
    }
  }
  if (policy.maximumRequiredInteractiveUnits > policy.maximumInteractiveUnits) {
    throw new Error(
      "Visual necessity budget maximumRequiredInteractiveUnits cannot exceed maximumInteractiveUnits.",
    );
  }
}

export function buildModelVisualNecessityPacket(input: {
  gardenId: string;
  learningUnits: LearningUnitContract[];
  canonicalEvidenceByUnit: Record<string, ModelVisualEvidenceItem[]>;
  budget: ModelVisualNecessityBudgetPolicy;
  sectionByUnit?: Record<string, string>;
  overrides?: VisualDecisionOverride[];
}): ModelVisualNecessityPacket {
  const gardenId = compact(input.gardenId);
  if (!gardenId) throw new Error("A garden id is required for model visual-necessity planning.");
  if (input.learningUnits.length === 0) {
    throw new Error("At least one learning unit is required for model visual-necessity planning.");
  }
  validateBudgetPolicy(input.budget);
  const unitIds = input.learningUnits.map((unit) => compact(unit.id));
  if (unitIds.some((unitId) => !unitId) || new Set(unitIds).size !== unitIds.length) {
    throw new Error("Learning-unit ids must be non-empty and unique.");
  }
  const knownUnitIds = new Set(unitIds);
  const overrides = input.overrides ?? [];
  const seenOverrides = new Set<string>();
  for (const override of overrides) {
    if (!knownUnitIds.has(override.unitId)) {
      throw new Error(`Visual decision override references unknown unit ${override.unitId}.`);
    }
    if (seenOverrides.has(override.unitId)) {
      throw new Error(`Multiple visual decision overrides target ${override.unitId}.`);
    }
    if (!compact(override.reason)) {
      throw new Error(`Visual decision override for ${override.unitId} requires a reason.`);
    }
    seenOverrides.add(override.unitId);
  }
  if (
    input.budget.maximumInteractiveUnitsPerSection !== undefined &&
    !input.sectionByUnit
  ) {
    throw new Error("sectionByUnit is required when a per-section visual budget is configured.");
  }
  const units = input.learningUnits.map((unit) => {
    const sourceAnchorIds = unique([
      ...unit.sourceAnchors,
      ...unit.sourceFigures.map((item) => item.id),
      ...unit.sourceFormulas.map((item) => item.id),
      ...unit.sourceTables.map((item) => item.id),
      ...(unit.semanticConcepts ?? []).flatMap((item) => item.evidenceAnchors),
      ...(unit.knowledgeClaims ?? []).flatMap((item) => [
        ...item.evidenceAnchors,
        ...(item.derivationAnchors ?? []),
      ]),
    ]);
    const allowedAnchors = new Set(sourceAnchorIds);
    const evidence = input.canonicalEvidenceByUnit[unit.id];
    if (!Array.isArray(evidence)) {
      throw new Error(`Canonical source evidence is missing for model visual unit ${unit.id}.`);
    }
    for (const [index, entry] of evidence.entries()) {
      if (!entry || typeof entry.anchor !== "string" || !entry.anchor || typeof entry.text !== "string" || !entry.text) {
        throw new Error(`Canonical source evidence ${unit.id}[${index}] is malformed.`);
      }
      if (!allowedAnchors.has(entry.anchor)) {
        throw new Error(`Canonical source evidence ${unit.id}[${index}] references undeclared anchor ${entry.anchor}.`);
      }
    }
    return {
      unitId: unit.id,
      pageId: unit.id,
      ...(input.sectionByUnit?.[unit.id]
        ? { sectionId: compact(input.sectionByUnit[unit.id]) }
        : {}),
      title: unit.title,
      role: unit.role,
      learningQuestion: unit.learningQuestion,
      prerequisiteConcepts: unique(unit.prerequisiteConcepts),
      concepts: unique([
        ...unit.newConcepts,
        ...(unit.semanticConcepts ?? []).flatMap((concept) => [
          concept.slug,
          concept.preferredLabel,
        ]),
      ]),
      sourceAnchorIds,
      evidence: evidence.map((entry) => ({ ...entry })),
    };
  });
  return {
    schemaVersion: MODEL_VISUAL_NECESSITY_SCHEMA_VERSION,
    gardenId,
    units,
    budget: { ...input.budget },
    overrides: overrides.map((override) => ({ ...override })),
  };
}

export function modelVisualNecessitySystemPrompt(): string {
  return [
    "You are the sole pedagogical decision-maker for interactive-visual necessity across an entire learning garden.",
    "Return strict JSON and exactly one decision for every supplied unit.",
    "Use this exact response shape: {\"schemaVersion\":1,\"gardenId\":string,\"gardenRationale\":string,\"visualBudget\":{\"targetMinimum\":integer,\"targetMaximum\":integer,\"maximumPerSection\":integer,\"minimumUnitsBetweenSimilarVisuals\":integer,\"requiredVisuals\":integer,\"recommendedVisuals\":integer,\"optionalVisuals\":integer,\"reason\":string},\"decisions\":[{\"unitId\":string,\"pageId\":string,\"necessity\":\"required\"|\"recommended\"|\"optional\"|\"not_needed\"|\"harmful_or_distracting\",\"preferredMedium\":\"interactive_visual\"|\"source_figure\"|\"generated_static_diagram\"|\"formula_derivation\"|\"worked_example\"|\"comparison_table\"|\"timeline\"|\"prose\"|\"no_additional_visual\",\"learningGoal\":string,\"manipulationValue\":number,\"dynamicBehaviorValue\":number,\"comparisonValue\":number,\"spatialValue\":number,\"parameterSensitivityValue\":number,\"sourceFigureSufficiency\":number,\"proseSufficiency\":number,\"formulaSufficiency\":number,\"workedExampleSufficiency\":number,\"cognitiveLoadRisk\":number,\"duplicationRisk\":number,\"implementationRisk\":number,\"confidence\":number,\"evidence\":{\"unitRole\":string,\"learningQuestion\":string,\"concepts\":string[],\"sourceAnchorIds\":string[],\"nearbyVisualIntentIds\":string[]},\"reason\":string,\"alternativeCoverage\":\"covered\"|\"uncovered\"|\"unverified\",\"teachingMediumReason\":string,\"interaction\"?:{\"interactionGoal\":\"manipulate_variables\"|\"observe_change_over_time\"|\"compare_cases\"|\"step_through_process\"|\"explore_structure\"|\"test_prediction\"|\"inspect_relationship\"|\"simulate_system\",\"uniqueConcept\":string,\"whyStaticSourceFigureIsNotEnough\":string,\"learnerAction\":string,\"controls\":[{\"id\":string,\"kind\":\"variable\"|\"select_case\"|\"process_position\",\"label\":string,\"type\":\"slider\"|\"number\"|\"select\",\"unit\"?:string,\"min\"?:number,\"max\"?:number,\"step\"?:number,\"options\"?:string[],\"defaultValue\":number|string,\"evidence\":[{\"anchor\":string,\"quote\":string}]}],\"observable\":{\"label\":string,\"representation\":\"value\"|\"chart\"|\"diagram\"|\"animation\"|\"timeline\"|\"table\"|\"annotation\",\"evidence\":[{\"anchor\":string,\"quote\":string}]},\"expectedInsight\":string,\"expectedInsightEvidence\":[{\"anchor\":string,\"quote\":string}],\"duplicateSignature\":string}}]}.",
    "Every score and confidence field is a JSON number from 0 through 1. Copy unitId, pageId, learningGoal, evidence concepts, and evidence sourceAnchorIds only from the request.",
    "Judge every unit from its supplied learning question, concepts, claims, source artifacts, and garden context; code will not classify or repair your pedagogical choices.",
    "The request budget contains safety maximums, not quotas. Author visualBudget as your whole-garden plan, keep it within those maximums, and make its required/recommended/optional counts exactly match your decisions. Do not add interaction merely to fill a budget and do not omit a necessary interaction merely to create variety.",
    "For every required, recommended, or optional interaction, author the interactionGoal, uniqueConcept, whyStaticSourceFigureIsNotEnough, concrete learnerAction, at least one typed learner control whose kind is variable, select_case, or process_position, a learner-visible observable and its representation, an expected insight, and a garden-unique duplicateSignature.",
    "Every control must author its stable id, exact input type, complete domain, and default. Slider/number controls require finite min, max, step, and numeric default with min < max, step > 0, and the default in range. Select controls require at least two unique options and a string default exactly equal to one option. Every control, observable, and expected insight must cite exact anchor-and-quote evidence from that same unit. Do not invent variables, cases, claims, or units absent from the packet.",
    "Grounding is literal: every meaningful normalized token in each control label, each select option, the observable label, and the expected insight must occur in the exact quote text cited for that field. Exact source symbols and formulas are valid when they occur with identifier boundaries in the cited quote (for example, t in E_x(z,t)); a character embedded inside a larger identifier or LaTeX command is not. Every quote must itself be an exact substring of the canonical evidence text at its anchor, and evidence.sourceAnchorIds must include every anchor cited anywhere in the interaction contract. The safest construction is to reuse concise exact source wording; do not introduce synonyms, expanded labels, or inferred conclusions that are absent from the quote.",
    "Use a non-interactive preferredMedium when a source figure, derivation, worked example, table, timeline, static diagram, or prose teaches the goal adequately.",
    "Honor every explicit user override exactly. Coordinate the whole batch to avoid redundant interactions.",
    "Do not emit renderer code or silently downgrade a required interaction because implementation may be difficult; record implementationRisk and keep the pedagogical judgment independent.",
  ].join(" ");
}

/** Prompt-visible response contract; API structured output may enforce the same shape. */
export const MODEL_VISUAL_NECESSITY_RESPONSE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  gardenId: "copy request.gardenId exactly",
  gardenRationale: "model-authored whole-garden rationale",
  visualBudget: {
    targetMinimum: "model-authored non-negative integer",
    targetMaximum: "model-authored non-negative integer within request maximumInteractiveUnits",
    maximumPerSection: "model-authored non-negative integer within the request's section maximum",
    minimumUnitsBetweenSimilarVisuals: "model-authored non-negative integer",
    requiredVisuals: "exact count of required decisions",
    recommendedVisuals: "exact count of recommended decisions",
    optionalVisuals: "exact count of optional decisions",
    reason: "model-authored whole-garden budget rationale",
  },
  decisions: [{
    unitId: "copy one request unitId",
    pageId: "copy that unit pageId",
    necessity: "required | recommended | optional | not_needed | harmful_or_distracting",
    preferredMedium:
      "interactive_visual | source_figure | generated_static_diagram | formula_derivation | worked_example | comparison_table | timeline | prose | no_additional_visual",
    learningGoal: "copy the unit learningQuestion exactly",
    manipulationValue: "number 0..1",
    dynamicBehaviorValue: "number 0..1",
    comparisonValue: "number 0..1",
    spatialValue: "number 0..1",
    parameterSensitivityValue: "number 0..1",
    sourceFigureSufficiency: "number 0..1",
    proseSufficiency: "number 0..1",
    formulaSufficiency: "number 0..1",
    workedExampleSufficiency: "number 0..1",
    cognitiveLoadRisk: "number 0..1",
    duplicationRisk: "number 0..1",
    implementationRisk: "number 0..1",
    confidence: "number 0..1",
    evidence: {
      unitRole: "copy the supplied unit role",
      concepts: ["exact supplied concept labels"],
      learningQuestion: "copy the supplied learningQuestion exactly",
      sourceAnchorIds: ["exact supplied sourceAnchorIds"],
      nearbyVisualIntentIds: ["other unitIds from this batch, when relevant"],
    },
    reason: "model-authored necessity rationale",
    alternativeCoverage: "covered | uncovered | unverified",
    teachingMediumReason: "model-authored reason for the selected medium",
    interaction: {
      note: "omit this entire object for not_needed or harmful_or_distracting",
      interactionGoal:
        "manipulate_variables | observe_change_over_time | compare_cases | step_through_process | explore_structure | test_prediction | inspect_relationship | simulate_system",
      uniqueConcept: "specific concept this interaction alone makes visible",
      whyStaticSourceFigureIsNotEnough: "source-grounded explanation",
      learnerAction: "specific learner action",
      controls: [{
        id: "stable snake_case model-authored input id",
        kind: "variable | select_case | process_position",
        label: "specific source-grounded input",
        type: "slider | number | select",
        unit: "optional source-supported display unit",
        min: "required finite number for slider or number",
        max: "required finite number for slider or number",
        step: "required positive finite number for slider or number",
        options: ["required for select_case: at least two source-grounded cases"],
        defaultValue: "in-range number or exact declared select option",
        evidence: [{ anchor: "exact evidence anchor", quote: "exact evidence substring" }],
      }],
      observable: {
        label: "specific learner-visible response",
        representation: "value | chart | diagram | animation | timeline | table | annotation",
        evidence: [{ anchor: "exact evidence anchor", quote: "exact evidence substring" }],
      },
      expectedInsight: "source-grounded expected insight",
      expectedInsightEvidence: [{
        anchor: "exact evidence anchor",
        quote: "exact evidence substring",
      }],
      duplicateSignature: "garden-unique semantic interaction signature",
    },
  }],
});

export function buildModelVisualNecessityPrompt(packet: ModelVisualNecessityPacket): {
  system: string;
  user: string;
  sourceContext: unknown;
} {
  const sourceContext = {
    request: packet,
    responseContract: MODEL_VISUAL_NECESSITY_RESPONSE_CONTRACT,
  };
  return {
    system: modelVisualNecessitySystemPrompt(),
    user: JSON.stringify(sourceContext),
    sourceContext,
  };
}

function addProblem(
  problems: ModelVisualNecessityProblem[],
  code: string,
  path: string,
  message: string,
  unitId?: string,
): void {
  problems.push({ code, path, message, ...(unitId ? { unitId } : {}) });
}

function parseVisualBudget(input: {
  raw: unknown;
  problems: ModelVisualNecessityProblem[];
}): GardenVisualBudget | undefined {
  const path = "visualBudget";
  const record = asRecord(input.raw);
  if (!record) {
    addProblem(input.problems, "missing_visual_budget", path, "visualBudget must be an object");
    return undefined;
  }
  const numericFields = [
    "targetMinimum",
    "targetMaximum",
    "maximumPerSection",
    "minimumUnitsBetweenSimilarVisuals",
    "requiredVisuals",
    "recommendedVisuals",
    "optionalVisuals",
  ] as const;
  const values = {} as Record<(typeof numericFields)[number], number>;
  for (const field of numericFields) {
    const value = record[field];
    if (!Number.isInteger(value) || Number(value) < 0) {
      addProblem(
        input.problems,
        "invalid_visual_budget",
        `${path}.${field}`,
        `${field} must be a non-negative integer`,
      );
    }
    values[field] = typeof value === "number" ? value : Number.NaN;
  }
  const reason = typeof record.reason === "string" ? record.reason : "";
  if (!reason.trim()) {
    addProblem(input.problems, "invalid_visual_budget", `${path}.reason`, "reason is required");
  }
  if (
    Number.isFinite(values.targetMinimum) &&
    Number.isFinite(values.targetMaximum) &&
    values.targetMinimum > values.targetMaximum
  ) {
    addProblem(
      input.problems,
      "invalid_visual_budget",
      path,
      "targetMinimum cannot exceed targetMaximum",
    );
  }
  return { ...values, reason };
}

function parseEvidenceRefs(value: unknown): VisualizationContractEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const anchor = compact(record?.anchor);
    const quote = compact(record?.quote);
    return anchor && quote ? [{ anchor, quote }] : [];
  });
}

function parseInteraction(input: {
  raw: unknown;
  path: string;
  unit: ModelVisualNecessityUnitPacket;
  problems: ModelVisualNecessityProblem[];
}): ModelInteractionContractDraft | undefined {
  if (input.raw === undefined || input.raw === null) return undefined;
  const record = asRecord(input.raw);
  if (!record) {
    addProblem(input.problems, "invalid_interaction", input.path, "interaction must be an object", input.unit.unitId);
    return undefined;
  }
  const learnerAction = compact(record.learnerAction);
  const interactionGoal = compact(record.interactionGoal) as VisualizationInteractionGoal;
  const uniqueConcept = compact(record.uniqueConcept);
  const whyStaticSourceFigureIsNotEnough = compact(record.whyStaticSourceFigureIsNotEnough);
  const expectedInsight = compact(record.expectedInsight);
  const duplicateSignature = compact(record.duplicateSignature);
  const interactionGoals = new Set<VisualizationInteractionGoal>([
    "manipulate_variables",
    "observe_change_over_time",
    "compare_cases",
    "step_through_process",
    "explore_structure",
    "test_prediction",
    "inspect_relationship",
    "simulate_system",
  ]);
  if (!interactionGoals.has(interactionGoal)) {
    addProblem(
      input.problems,
      "invalid_interaction_goal",
      `${input.path}.interactionGoal`,
      "interactionGoal is required and must use the declared enum",
      input.unit.unitId,
    );
  }
  if (!learnerAction) addProblem(input.problems, "missing_learner_action", `${input.path}.learnerAction`, "learnerAction is required", input.unit.unitId);
  if (!uniqueConcept) addProblem(input.problems, "missing_unique_concept", `${input.path}.uniqueConcept`, "uniqueConcept is required", input.unit.unitId);
  if (!whyStaticSourceFigureIsNotEnough) addProblem(input.problems, "missing_static_limitation", `${input.path}.whyStaticSourceFigureIsNotEnough`, "whyStaticSourceFigureIsNotEnough is required", input.unit.unitId);
  if (!expectedInsight) addProblem(input.problems, "missing_expected_insight", `${input.path}.expectedInsight`, "expectedInsight is required", input.unit.unitId);
  if (!duplicateSignature) addProblem(input.problems, "missing_duplicate_signature", `${input.path}.duplicateSignature`, "duplicateSignature is required", input.unit.unitId);

  const parsedContract = parseVisualizationContractRepairResponse({
    repairs: [{
      unitId: input.unit.unitId,
      controls: record.controls,
      expectedInsight,
      expectedInsightEvidence: record.expectedInsightEvidence,
    }],
  });
  for (const message of parsedContract.problems) {
    addProblem(
      input.problems,
      "invalid_interaction_contract_shape",
      input.path,
      message,
      input.unit.unitId,
    );
  }
  const controls = parsedContract.repairs[0]?.controls ?? [];
  const expectedInsightEvidence = parsedContract.repairs[0]?.expectedInsightEvidence ?? [];
  if (controls.length === 0) addProblem(input.problems, "missing_learner_input", `${input.path}.controls`, "at least one typed model-authored learner control is required", input.unit.unitId);
  if (expectedInsightEvidence.length === 0) addProblem(input.problems, "missing_expected_insight_evidence", `${input.path}.expectedInsightEvidence`, "expectedInsightEvidence is required", input.unit.unitId);

  const observableRecord = asRecord(record.observable);
  let observable: ModelLearnerObservableDraft = {
    label: "",
    representation: "annotation",
    evidence: [],
  };
  if (!observableRecord) {
    addProblem(input.problems, "missing_observable", `${input.path}.observable`, "a learner-visible observable is required", input.unit.unitId);
  } else {
    const label = compact(observableRecord.label);
    const representation = compact(
      observableRecord.representation,
    ) as InteractiveVisualOutputRepresentation;
    const representations = new Set<InteractiveVisualOutputRepresentation>([
      "value",
      "chart",
      "diagram",
      "animation",
      "timeline",
      "table",
      "annotation",
    ]);
    if (!label) addProblem(input.problems, "missing_observable_label", `${input.path}.observable.label`, "observable label is required", input.unit.unitId);
    if (!representations.has(representation)) {
      addProblem(
        input.problems,
        "invalid_observable_representation",
        `${input.path}.observable.representation`,
        "observable representation is required and must use the declared enum",
        input.unit.unitId,
      );
    }
    const evidence = parseEvidenceRefs(observableRecord.evidence);
    if (evidence.length === 0) addProblem(input.problems, "missing_observable_evidence", `${input.path}.observable.evidence`, "observable evidence is required", input.unit.unitId);
    observable = { label, representation, evidence };
  }
  return {
    interactionGoal,
    uniqueConcept,
    whyStaticSourceFigureIsNotEnough,
    learnerAction,
    controls,
    observable,
    expectedInsight,
    expectedInsightEvidence,
    duplicateSignature,
  };
}

function parseDecision(input: {
  raw: unknown;
  index: number;
  unit: ModelVisualNecessityUnitPacket;
  problems: ModelVisualNecessityProblem[];
}): ModelAuthoredVisualNecessityDecision | undefined {
  const path = `decisions[${input.index}]`;
  const record = asRecord(input.raw);
  if (!record) {
    addProblem(input.problems, "invalid_decision", path, "decision must be an object", input.unit.unitId);
    return undefined;
  }
  const unitId = compact(record.unitId);
  const pageId = compact(record.pageId);
  const necessity = compact(record.necessity) as InteractiveVisualNecessity;
  const preferredMedium = compact(record.preferredMedium) as PreferredTeachingMedium;
  const learningGoal = compact(record.learningGoal);
  const reason = compact(record.reason);
  const teachingMediumReason = compact(record.teachingMediumReason);
  const alternativeCoverage = compact(record.alternativeCoverage) as ModelAuthoredVisualNecessityDecision["alternativeCoverage"];
  const confidence = typeof record.confidence === "number" ? record.confidence : Number.NaN;
  if (pageId !== input.unit.pageId) addProblem(input.problems, "page_mismatch", `${path}.pageId`, `pageId must equal ${input.unit.pageId}`, input.unit.unitId);
  if (!NECESSITIES.has(necessity)) addProblem(input.problems, "invalid_necessity", `${path}.necessity`, `unsupported necessity ${necessity || "(empty)"}`, input.unit.unitId);
  if (!MEDIA.has(preferredMedium)) addProblem(input.problems, "invalid_medium", `${path}.preferredMedium`, `unsupported preferredMedium ${preferredMedium || "(empty)"}`, input.unit.unitId);
  if (learningGoal !== compact(input.unit.learningQuestion)) addProblem(input.problems, "learning_goal_drift", `${path}.learningGoal`, "learningGoal must exactly preserve the supplied learningQuestion", input.unit.unitId);
  if (!reason) addProblem(input.problems, "missing_reason", `${path}.reason`, "decision reason is required", input.unit.unitId);
  if (!teachingMediumReason) addProblem(input.problems, "missing_medium_reason", `${path}.teachingMediumReason`, "teachingMediumReason is required", input.unit.unitId);
  if (!["covered", "uncovered", "unverified"].includes(alternativeCoverage)) addProblem(input.problems, "invalid_alternative_coverage", `${path}.alternativeCoverage`, "alternativeCoverage must be covered, uncovered, or unverified", input.unit.unitId);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) addProblem(input.problems, "invalid_confidence", `${path}.confidence`, "confidence must be between 0 and 1", input.unit.unitId);

  const scoreValues = {} as Pick<ModelAuthoredVisualNecessityDecision, (typeof SCORE_FIELDS)[number]>;
  for (const field of SCORE_FIELDS) {
    const value = typeof record[field] === "number" ? record[field] : Number.NaN;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      addProblem(input.problems, "invalid_score", `${path}.${field}`, `${field} must be between 0 and 1`, input.unit.unitId);
    }
    (scoreValues as unknown as Record<string, number>)[field] = value;
  }

  const evidenceRecord = asRecord(record.evidence);
  const knownConcepts = new Set(input.unit.concepts);
  const knownAnchors = new Set(input.unit.sourceAnchorIds);
  let concepts: string[] = [];
  let sourceAnchorIds: string[] = [];
  let nearbyVisualIntentIds: string[] = [];
  if (!evidenceRecord) {
    addProblem(input.problems, "missing_decision_evidence", `${path}.evidence`, "decision evidence is required", input.unit.unitId);
  } else {
    if (compact(evidenceRecord.unitRole) !== input.unit.role) addProblem(input.problems, "unit_role_drift", `${path}.evidence.unitRole`, "evidence unitRole must exactly match the unit packet", input.unit.unitId);
    if (compact(evidenceRecord.learningQuestion) !== compact(input.unit.learningQuestion)) addProblem(input.problems, "question_evidence_drift", `${path}.evidence.learningQuestion`, "evidence learningQuestion must exactly match the unit packet", input.unit.unitId);
    concepts = stringArray(evidenceRecord.concepts) ?? [];
    sourceAnchorIds = stringArray(evidenceRecord.sourceAnchorIds) ?? [];
    nearbyVisualIntentIds = stringArray(evidenceRecord.nearbyVisualIntentIds) ?? [];
    for (const concept of concepts) if (!knownConcepts.has(concept)) addProblem(input.problems, "unknown_concept_evidence", `${path}.evidence.concepts`, `concept ${concept} is not in the unit packet`, input.unit.unitId);
    for (const anchorId of sourceAnchorIds) if (!knownAnchors.has(anchorId)) addProblem(input.problems, "unknown_source_anchor", `${path}.evidence.sourceAnchorIds`, `source anchor ${anchorId} is not in the unit packet`, input.unit.unitId);
  }

  const interaction = parseInteraction({
    raw: record.interaction,
    path: `${path}.interaction`,
    unit: input.unit,
    problems: input.problems,
  });
  const active = ACTIVE_NECESSITIES.has(necessity);
  if (active && preferredMedium !== "interactive_visual") addProblem(input.problems, "active_medium_mismatch", `${path}.preferredMedium`, "an active interaction must use interactive_visual", input.unit.unitId);
  if (!active && preferredMedium === "interactive_visual") addProblem(input.problems, "inactive_medium_mismatch", `${path}.preferredMedium`, "an inactive decision must use a non-interactive medium", input.unit.unitId);
  if (active && !interaction) addProblem(input.problems, "missing_interaction_contract", `${path}.interaction`, "an active decision requires a model-authored interaction contract", input.unit.unitId);
  if (!active && interaction) addProblem(input.problems, "unexpected_interaction_contract", `${path}.interaction`, "a non-interactive decision must not include an interaction contract", input.unit.unitId);
  if (active && sourceAnchorIds.length === 0) {
    addProblem(
      input.problems,
      "missing_interaction_source_anchors",
      `${path}.evidence.sourceAnchorIds`,
      "an active interaction must cite at least one canonical source anchor",
      input.unit.unitId,
    );
  }
  if (active && interaction) {
    const declaredInteractionAnchors = new Set(sourceAnchorIds);
    const citedInteractionAnchors = unique([
      ...interaction.controls.flatMap((control) =>
        control.evidence.map((reference) => reference.anchor)),
      ...interaction.observable.evidence.map((reference) => reference.anchor),
      ...interaction.expectedInsightEvidence.map((reference) => reference.anchor),
    ]);
    for (const anchor of citedInteractionAnchors) {
      if (!declaredInteractionAnchors.has(anchor)) {
        addProblem(
          input.problems,
          "interaction_source_anchor_omission",
          `${path}.evidence.sourceAnchorIds`,
          `evidence.sourceAnchorIds omits interaction evidence anchor ${anchor}`,
          input.unit.unitId,
        );
      }
    }
  }

  return {
    unitId,
    pageId,
    necessity,
    preferredMedium,
    learningGoal,
    ...scoreValues,
    evidence: {
      unitRole: input.unit.role,
      concepts,
      learningQuestion: input.unit.learningQuestion,
      sourceAnchorIds,
      nearbyVisualIntentIds,
    },
    reason,
    confidence,
    alternativeCoverage,
    teachingMediumReason,
    ...(interaction ? { interaction } : {}),
  };
}

function requirementForNecessity(
  necessity: InteractiveVisualNecessity,
): ContractInteractiveVisualPlan["requirement"] {
  if (necessity === "required") return "required";
  if (necessity === "recommended") return "recommended";
  if (necessity === "optional") return "optional";
  return "none";
}

function teachingMediumFromModel(
  decision: ModelAuthoredVisualNecessityDecision,
): TeachingMediumPlan {
  return {
    unitId: decision.unitId,
    preferredMedium: decision.preferredMedium,
    reason: decision.teachingMediumReason,
    ...(decision.preferredMedium === "generated_static_diagram"
      ? { staticDiagramIntent: decision.teachingMediumReason }
      : {}),
    ...(decision.preferredMedium === "worked_example"
      ? { workedExampleIntent: decision.teachingMediumReason }
      : {}),
    ...(decision.preferredMedium === "comparison_table"
      ? { comparisonTableIntent: decision.teachingMediumReason }
      : {}),
  };
}

function projectionFromValidatedBatch(input: {
  packet: ModelVisualNecessityPacket;
  learningUnits: LearningUnitContract[];
  response: ModelVisualNecessityBatchResponse;
}): ValidatedModelVisualNecessityPlan {
  const decisionByUnit = new Map(input.response.decisions.map((decision) => [decision.unitId, decision]));
  const teachingMedia = input.response.decisions.map(teachingMediumFromModel);
  const teachingByUnit = new Map(teachingMedia.map((medium) => [medium.unitId, medium]));
  const learningUnits = input.learningUnits.map((unit) => {
    const authored = decisionByUnit.get(unit.id)!;
    const decision: VisualNecessityDecision = authored;
    const visualIntent = authored.interaction
      ? {
          id: `visual-${unit.id.toLowerCase()}-model`,
          uniqueConcept: authored.interaction.uniqueConcept,
          visualType: "generated_module",
          whyStaticSourceFigureIsNotEnough:
            authored.interaction.whyStaticSourceFigureIsNotEnough,
          learnerManipulates: authored.interaction.controls.map((control) => control.label),
          expectedInsight: authored.interaction.expectedInsight,
          sourceAnchors: authored.evidence.sourceAnchorIds,
          duplicateSignature: authored.interaction.duplicateSignature,
        }
      : undefined;
    return {
      ...unit,
      interactiveVisual: visualIntent,
      interactiveVisualPlan: {
        decision,
        requirement: requirementForNecessity(decision.necessity),
        alternativeCoverage: authored.alternativeCoverage,
        ...(visualIntent ? { visualIntent } : {}),
        ...(authored.interaction
          ? {
              interactionGoal: authored.interaction.interactionGoal,
              learnerAction: authored.interaction.learnerAction,
              controlContract: authored.interaction.controls,
              observable: authored.interaction.observable,
              expectedInsightEvidence: authored.interaction.expectedInsightEvidence,
            }
          : {}),
        ...(!ACTIVE_NECESSITIES.has(decision.necessity)
          ? { omissionReason: authored.reason }
          : {}),
      },
      teachingMediumPlan: teachingByUnit.get(unit.id),
    };
  });
  const interactionDrafts = Object.fromEntries(
    input.response.decisions
      .filter((decision): decision is ModelAuthoredVisualNecessityDecision & { interaction: ModelInteractionContractDraft } => Boolean(decision.interaction))
      .map((decision) => [decision.unitId, decision.interaction]),
  );
  const counts = {
    interactive: input.response.decisions.filter((decision) => ACTIVE_NECESSITIES.has(decision.necessity)).length,
    required: input.response.decisions.filter((decision) => decision.necessity === "required").length,
    recommended: input.response.decisions.filter((decision) => decision.necessity === "recommended").length,
    optional: input.response.decisions.filter((decision) => decision.necessity === "optional").length,
    nonInteractive: input.response.decisions.filter((decision) => !ACTIVE_NECESSITIES.has(decision.necessity)).length,
  };
  const budget: GardenVisualBudget = { ...input.response.visualBudget };
  const decisionRecords: VisualDecisionRecord[] = input.response.decisions.map((decision) => {
    const active = ACTIVE_NECESSITIES.has(decision.necessity);
    const recordDecision: VisualDecisionRecord["decision"] =
      decision.necessity === "required"
        ? "required"
        : decision.necessity === "recommended"
          ? "strongly_recommended"
          : decision.necessity === "optional"
            ? "optional"
            : "not_useful";
    return {
      unitId: decision.unitId,
      candidateType: active ? "generated_module" : decision.preferredMedium,
      decision: recordDecision,
      pedagogicalBenefit: decision.reason,
      ...(decision.interaction
        ? {
            learnerAction: decision.interaction.learnerAction,
            conceptMadeVisible: decision.interaction.uniqueConcept,
          }
        : {}),
      positiveSignals: active ? [decision.reason] : [],
      negativeSignals: active ? [] : [decision.reason],
      confidence: decision.confidence,
      decisionSource: "model_batch",
    };
  });
  const zeroVisualSafeguard: GardenZeroVisualSafeguard = {
    triggered: false,
    activeInteractiveCount: counts.interactive,
    latentStrongCandidateUnitIds: [],
    status: counts.interactive === 0 ? "consistent_zero" : "not_applicable",
    reason: counts.interactive === 0
      ? "The validated model-authored whole-garden decision selected zero interactions; no quota safeguard promoted a unit."
      : "The validated model-authored whole-garden decision already contains interaction.",
  };
  return {
    response: input.response,
    decisions: input.response.decisions,
    interactionDrafts,
    learningUnits,
    teachingMedia,
    budget,
    decisionRecords,
    zeroVisualSafeguard,
    counts,
  };
}

export function validateModelVisualNecessityBatch(input: {
  packet: ModelVisualNecessityPacket;
  learningUnits: LearningUnitContract[];
  response: unknown;
}): ModelVisualNecessityValidationResult {
  const problems: ModelVisualNecessityProblem[] = [];
  const responseRecord = asRecord(input.response);
  if (!responseRecord) {
    return { ok: false, problems: [{ code: "invalid_response", path: "$", message: "response must be a JSON object" }] };
  }
  if (responseRecord.schemaVersion !== MODEL_VISUAL_NECESSITY_SCHEMA_VERSION) addProblem(problems, "schema_version_mismatch", "schemaVersion", `schemaVersion must be numeric ${MODEL_VISUAL_NECESSITY_SCHEMA_VERSION}`);
  if (compact(responseRecord.gardenId) !== input.packet.gardenId) addProblem(problems, "garden_mismatch", "gardenId", `gardenId must equal ${input.packet.gardenId}`);
  const gardenRationale = compact(responseRecord.gardenRationale);
  if (!gardenRationale) addProblem(problems, "missing_garden_rationale", "gardenRationale", "gardenRationale is required");
  const visualBudget = parseVisualBudget({ raw: responseRecord.visualBudget, problems });
  const rawDecisions = Array.isArray(responseRecord.decisions) ? responseRecord.decisions : [];
  if (!Array.isArray(responseRecord.decisions)) addProblem(problems, "missing_decisions", "decisions", "decisions must be an array");

  const expectedUnits = new Map(input.packet.units.map((unit) => [unit.unitId, unit]));
  const contractUnitById = new Map(input.learningUnits.map((unit) => [unit.id, unit]));
  for (const unitId of expectedUnits.keys()) {
    if (!contractUnitById.has(unitId)) addProblem(problems, "missing_contract_unit", "learningUnits", `learning-unit contract ${unitId} is missing`, unitId);
  }
  for (const unitId of contractUnitById.keys()) {
    if (!expectedUnits.has(unitId)) addProblem(problems, "unexpected_contract_unit", "learningUnits", `learning-unit contract ${unitId} was not included in the model packet`, unitId);
  }
  const seenUnitIds = new Set<string>();
  const parsedDecisions: ModelAuthoredVisualNecessityDecision[] = [];
  rawDecisions.forEach((raw, index) => {
    const record = asRecord(raw);
    const unitId = compact(record?.unitId);
    if (!unitId || !expectedUnits.has(unitId)) {
      addProblem(problems, "unknown_unit", `decisions[${index}].unitId`, `unitId ${unitId || "(empty)"} is not in the request`, unitId || undefined);
      return;
    }
    if (seenUnitIds.has(unitId)) {
      addProblem(problems, "duplicate_unit", `decisions[${index}].unitId`, `unit ${unitId} has more than one decision`, unitId);
      return;
    }
    seenUnitIds.add(unitId);
    const parsed = parseDecision({ raw, index, unit: expectedUnits.get(unitId)!, problems });
    if (parsed) parsedDecisions.push(parsed);
  });
  for (const unitId of expectedUnits.keys()) {
    if (!seenUnitIds.has(unitId)) addProblem(problems, "missing_unit", "decisions", `unit ${unitId} has no model-authored decision`, unitId);
  }

  const knownUnitIds = new Set(expectedUnits.keys());
  for (const decision of parsedDecisions) {
    for (const nearbyId of decision.evidence.nearbyVisualIntentIds) {
      if (!knownUnitIds.has(nearbyId) || nearbyId === decision.unitId) addProblem(problems, "invalid_nearby_unit", `decision:${decision.unitId}.evidence.nearbyVisualIntentIds`, `nearby unit ${nearbyId} must be another unit in the same batch`, decision.unitId);
    }
  }

  const decisionByUnit = new Map(parsedDecisions.map((decision) => [decision.unitId, decision]));
  for (const decision of parsedDecisions) {
    if (!ACTIVE_NECESSITIES.has(decision.necessity) || !decision.interaction) continue;
    const unit = contractUnitById.get(decision.unitId);
    if (!unit) continue;
    const validationUnit: LearningUnitContract = {
      ...unit,
      interactiveVisualPlan: {
        decision,
        requirement: "required",
        alternativeCoverage: decision.alternativeCoverage,
        controlContract: decision.interaction.controls,
        expectedInsightEvidence: decision.interaction.expectedInsightEvidence,
      },
    };
    const contractProblems = validateVisualizationContractUnitRepair({
      unit: validationUnit,
      evidence: expectedUnits.get(decision.unitId)?.evidence,
      repair: {
        unitId: decision.unitId,
        controls: decision.interaction.controls,
        observable: decision.interaction.observable,
        expectedInsight: decision.interaction.expectedInsight,
        expectedInsightEvidence: decision.interaction.expectedInsightEvidence,
      },
    });
    for (const message of contractProblems) {
      addProblem(
        problems,
        "invalid_interaction_grounding",
        `decision:${decision.unitId}.interaction`,
        message,
        decision.unitId,
      );
    }
  }
  for (const override of input.packet.overrides) {
    const decision = decisionByUnit.get(override.unitId);
    if (!decision) continue;
    const active = ACTIVE_NECESSITIES.has(decision.necessity);
    const interactive = decision.preferredMedium === "interactive_visual";
    const honored = override.action === "force_required"
      ? decision.necessity === "required" && interactive
      : override.action === "force_none"
        ? !active && !interactive
        : override.action === "prefer_static"
          ? !interactive
          : active && interactive;
    if (!honored) addProblem(problems, "override_conflict", `decision:${override.unitId}`, `decision does not honor explicit ${override.action} override`, override.unitId);
  }

  const active = parsedDecisions.filter((decision) => ACTIVE_NECESSITIES.has(decision.necessity));
  const required = parsedDecisions.filter((decision) => decision.necessity === "required");
  if (active.length > input.packet.budget.maximumInteractiveUnits) addProblem(problems, "garden_budget_exceeded", "decisions", `model selected ${active.length} interactive units; maximum is ${input.packet.budget.maximumInteractiveUnits}`);
  if (required.length > input.packet.budget.maximumRequiredInteractiveUnits) addProblem(problems, "required_budget_exceeded", "decisions", `model selected ${required.length} required interactions; maximum is ${input.packet.budget.maximumRequiredInteractiveUnits}`);
  if (visualBudget) {
    const recommendedCount = parsedDecisions.filter((decision) =>
      decision.necessity === "recommended").length;
    const optionalCount = parsedDecisions.filter((decision) =>
      decision.necessity === "optional").length;
    const authoredCounts = [
      ["requiredVisuals", visualBudget.requiredVisuals, required.length],
      ["recommendedVisuals", visualBudget.recommendedVisuals, recommendedCount],
      ["optionalVisuals", visualBudget.optionalVisuals, optionalCount],
    ] as const;
    for (const [field, authored, actual] of authoredCounts) {
      if (authored !== actual) {
        addProblem(
          problems,
          "visual_budget_count_mismatch",
          `visualBudget.${field}`,
          `${field} must equal the ${actual} matching decisions`,
        );
      }
    }
    if (visualBudget.targetMaximum > input.packet.budget.maximumInteractiveUnits) {
      addProblem(
        problems,
        "visual_budget_exceeded",
        "visualBudget.targetMaximum",
        `targetMaximum cannot exceed request maximum ${input.packet.budget.maximumInteractiveUnits}`,
      );
    }
    if (active.length < visualBudget.targetMinimum || active.length > visualBudget.targetMaximum) {
      addProblem(
        problems,
        "visual_budget_decision_mismatch",
        "visualBudget",
        `${active.length} interactive decisions must fall within the authored target range ${visualBudget.targetMinimum}..${visualBudget.targetMaximum}`,
      );
    }
    const configuredSectionMaximum = input.packet.budget.maximumInteractiveUnitsPerSection;
    if (
      configuredSectionMaximum !== undefined &&
      visualBudget.maximumPerSection > configuredSectionMaximum
    ) {
      addProblem(
        problems,
        "visual_budget_exceeded",
        "visualBudget.maximumPerSection",
        `maximumPerSection cannot exceed request maximum ${configuredSectionMaximum}`,
      );
    }
  }
  const sectionByUnit = new Map(input.packet.units.map((unit) => [unit.unitId, unit.sectionId]));
  const sectionCounts = new Map<string, number>();
  for (const decision of active) {
    const section = sectionByUnit.get(decision.unitId);
    if (!section) continue;
    sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
  }
  if (input.packet.budget.maximumInteractiveUnitsPerSection !== undefined) {
    for (const [section, count] of sectionCounts) if (count > input.packet.budget.maximumInteractiveUnitsPerSection) addProblem(problems, "section_budget_exceeded", `section:${section}`, `model selected ${count} interactive units in section ${section}; maximum is ${input.packet.budget.maximumInteractiveUnitsPerSection}`);
  }
  if (visualBudget) {
    for (const [section, count] of sectionCounts) {
      if (count > visualBudget.maximumPerSection) {
        addProblem(
          problems,
          "visual_budget_section_mismatch",
          `section:${section}`,
          `model selected ${count} interactive units in section ${section}; authored maximumPerSection is ${visualBudget.maximumPerSection}`,
        );
      }
    }
  }
  const signatures = new Map<string, string[]>();
  for (const decision of active) {
    const signature = compact(decision.interaction?.duplicateSignature).toLowerCase();
    if (!signature) continue;
    signatures.set(signature, [...(signatures.get(signature) ?? []), decision.unitId]);
  }
  const signatureMaximum = input.packet.budget.maximumRepeatedInteractionSignature ?? 1;
  for (const [signature, unitIds] of signatures) if (unitIds.length > signatureMaximum) addProblem(problems, "duplicate_interaction_signature", "decisions", `interaction signature ${signature} is repeated by ${unitIds.join(", ")}; maximum is ${signatureMaximum}`);
  if (visualBudget && visualBudget.minimumUnitsBetweenSimilarVisuals > 0) {
    const unitIndex = new Map(input.packet.units.map((unit, index) => [unit.unitId, index]));
    for (const [signature, unitIds] of signatures) {
      const indices = unitIds.map((unitId) => unitIndex.get(unitId) ?? -1).sort((a, b) => a - b);
      for (let index = 1; index < indices.length; index += 1) {
        const unitsBetween = indices[index] - indices[index - 1] - 1;
        if (unitsBetween < visualBudget.minimumUnitsBetweenSimilarVisuals) {
          addProblem(
            problems,
            "visual_budget_spacing_mismatch",
            "visualBudget.minimumUnitsBetweenSimilarVisuals",
            `interaction signature ${signature} has ${unitsBetween} unit(s) between uses; authored minimum is ${visualBudget.minimumUnitsBetweenSimilarVisuals}`,
          );
        }
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  const response: ModelVisualNecessityBatchResponse = {
    schemaVersion: MODEL_VISUAL_NECESSITY_SCHEMA_VERSION,
    gardenId: input.packet.gardenId,
    gardenRationale,
    visualBudget: visualBudget!,
    decisions: parsedDecisions,
  };
  return {
    ok: true,
    plan: projectionFromValidatedBatch({ packet: input.packet, learningUnits: input.learningUnits, response }),
  };
}

/**
 * Repair remains model-authored. The caller sends this packet to the model and
 * validates the returned whole batch again. No invalid unit is filled from a
 * heuristic or previous deterministic decision.
 */
export function buildModelVisualNecessityRepairPrompt(input: {
  packet: ModelVisualNecessityPacket;
  invalidResponse: unknown;
  problems: ModelVisualNecessityProblem[];
  repairAttempt: number;
}): { system: string; user: string; sourceContext: unknown } {
  if (
    !Number.isInteger(input.repairAttempt) ||
    input.repairAttempt < 1 ||
    input.repairAttempt > MODEL_VISUAL_NECESSITY_CALL_BUDGET.maximumRepairCalls
  ) {
    throw new Error(
      `Visual necessity repairAttempt must be between 1 and ${MODEL_VISUAL_NECESSITY_CALL_BUDGET.maximumRepairCalls}.`,
    );
  }
  const sourceContext = {
    request: input.packet,
    responseContract: MODEL_VISUAL_NECESSITY_RESPONSE_CONTRACT,
    invalidResponse: input.invalidResponse,
    validationProblems: input.problems,
    repairAttempt: input.repairAttempt,
  };
  return {
    system: [
      modelVisualNecessitySystemPrompt(),
      "Repair the invalid whole-garden response using the supplied validation problems.",
      "Return a complete replacement batch, not prose, a partial patch, or a deterministic fallback.",
      "Preserve valid source-grounded decisions unless a garden-level budget, duplication, or override conflict requires coordinated changes.",
    ].join(" "),
    user: JSON.stringify(sourceContext),
    sourceContext,
  };
}

const TARGETED_REPAIR_EVIDENCE_KINDS = new Set<ModelVisualEvidenceItem["kind"]>([
  "source_text",
  "source_formula",
  "source_figure",
  "source_table",
]);

export const MODEL_VISUAL_NECESSITY_TARGETED_REPAIR_RESPONSE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  gardenId: "copy request.gardenId exactly",
  decisions: [MODEL_VISUAL_NECESSITY_RESPONSE_CONTRACT.decisions[0]],
});

function rawDecisionRecords(response: unknown): Record<string, unknown>[] | null {
  const record = asRecord(response);
  if (!record || !Array.isArray(record.decisions)) return null;
  const decisions = record.decisions.map(asRecord);
  return decisions.every((decision): decision is Record<string, unknown> => Boolean(decision))
    ? decisions
    : null;
}

function targetedRepairUnitIds(input: {
  packet: ModelVisualNecessityPacket;
  invalidResponse: unknown;
  problems: ModelVisualNecessityProblem[];
}): string[] {
  if (input.problems.length === 0) return [];
  const knownUnitIds = new Set(input.packet.units.map((unit) => unit.unitId));
  const problemUnitIds = new Set<string>();
  for (const problem of input.problems) {
    if (!problem.unitId || !knownUnitIds.has(problem.unitId)) return [];
    problemUnitIds.add(problem.unitId);
  }
  const decisions = rawDecisionRecords(input.invalidResponse);
  if (!decisions) return [];
  for (const unitId of problemUnitIds) {
    if (decisions.filter((decision) => compact(decision.unitId) === unitId).length !== 1) {
      return [];
    }
  }
  return input.packet.units
    .map((unit) => unit.unitId)
    .filter((unitId) => problemUnitIds.has(unitId));
}

function assertTargetedRepairCanonicalEvidence(
  unit: ModelVisualNecessityUnitPacket,
): void {
  if (unit.evidence.length === 0) {
    throw new Error(
      `Targeted visual-necessity repair for ${unit.unitId} requires non-empty canonical source evidence.`,
    );
  }
  const declaredAnchors = new Set(unit.sourceAnchorIds);
  unit.evidence.forEach((entry, index) => {
    if (!TARGETED_REPAIR_EVIDENCE_KINDS.has(entry.kind)) {
      throw new Error(
        `Targeted visual-necessity repair evidence ${unit.unitId}[${index}] has non-canonical kind ${entry.kind}.`,
      );
    }
    if (!declaredAnchors.has(entry.anchor)) {
      throw new Error(
        `Targeted visual-necessity repair evidence ${unit.unitId}[${index}] uses undeclared anchor ${entry.anchor}.`,
      );
    }
    if (!compact(entry.text)) {
      throw new Error(
        `Targeted visual-necessity repair evidence ${unit.unitId}[${index}] has empty source text.`,
      );
    }
  });
}

/**
 * Builds a compact repair request containing only failed units and their exact
 * canonical evidence. The model must return complete decisions; application
 * code never fills, restores, or rewrites a semantic field within those units.
 */
export function buildModelVisualNecessityTargetedRepairPrompt(input: {
  packet: ModelVisualNecessityPacket;
  invalidResponse: unknown;
  problems: ModelVisualNecessityProblem[];
  targetUnitIds: string[];
  repairAttempt: number;
}): { system: string; user: string; sourceContext: ModelVisualNecessityTargetedRepairPacket & {
  responseContract: typeof MODEL_VISUAL_NECESSITY_TARGETED_REPAIR_RESPONSE_CONTRACT;
  repairAttempt: number;
} } {
  if (
    !Number.isInteger(input.repairAttempt) ||
    input.repairAttempt < 1 ||
    input.repairAttempt > MODEL_VISUAL_NECESSITY_TARGETED_REPAIR_CALL_BUDGET.maximumRepairCalls
  ) {
    throw new Error(
      `Targeted visual-necessity repairAttempt must be between 1 and ${MODEL_VISUAL_NECESSITY_TARGETED_REPAIR_CALL_BUDGET.maximumRepairCalls}.`,
    );
  }
  const targetUnitIds = unique(input.targetUnitIds);
  if (targetUnitIds.length === 0 || targetUnitIds.length !== input.targetUnitIds.length) {
    throw new Error("Targeted visual-necessity repair requires unique affected unit ids.");
  }
  const targetSet = new Set(targetUnitIds);
  const unitsById = new Map(input.packet.units.map((unit) => [unit.unitId, unit]));
  const decisions = rawDecisionRecords(input.invalidResponse);
  if (!decisions) {
    throw new Error("Targeted visual-necessity repair requires a prior response with decision records.");
  }
  const units = targetUnitIds.map((unitId) => {
    const unit = unitsById.get(unitId);
    if (!unit) throw new Error(`Targeted visual-necessity repair references unknown unit ${unitId}.`);
    assertTargetedRepairCanonicalEvidence(unit);
    const matchingDecisions = decisions.filter((decision) => compact(decision.unitId) === unitId);
    if (matchingDecisions.length !== 1) {
      throw new Error(
        `Targeted visual-necessity repair requires exactly one prior decision for ${unitId}.`,
      );
    }
    return {
      unit,
      invalidDecision: matchingDecisions[0],
      problems: input.problems.filter((problem) => problem.unitId === unitId),
    };
  });
  const invalidRecord = asRecord(input.invalidResponse)!;
  const reservedDuplicateSignatures = unique(decisions.flatMap((decision) => {
    if (targetSet.has(compact(decision.unitId))) return [];
    const signature = compact(asRecord(decision.interaction)?.duplicateSignature);
    return signature ? [signature] : [];
  }));
  const sectionByUnit = new Map(input.packet.units.map((unit) => [unit.unitId, unit.sectionId]));
  const untouchedDecisionIndex = decisions.flatMap((decision) => {
    const unitId = compact(decision.unitId);
    if (!unitId || targetSet.has(unitId)) return [];
    const duplicateSignature = compact(asRecord(decision.interaction)?.duplicateSignature);
    const sectionId = sectionByUnit.get(unitId);
    return [{
      unitId,
      ...(sectionId ? { sectionId } : {}),
      necessity: compact(decision.necessity),
      preferredMedium: compact(decision.preferredMedium),
      ...(duplicateSignature ? { duplicateSignature } : {}),
    }];
  });
  const packet: ModelVisualNecessityTargetedRepairPacket = {
    schemaVersion: MODEL_VISUAL_NECESSITY_SCHEMA_VERSION,
    gardenId: input.packet.gardenId,
    units,
    wholeGardenConstraints: {
      requestBudget: { ...input.packet.budget },
      currentVisualBudget: invalidRecord.visualBudget,
      overrides: input.packet.overrides.map((override) => ({ ...override })),
      reservedDuplicateSignatures,
      untouchedDecisionIndex,
    },
    previousRejectionReasons: input.problems.map((problem) => ({ ...problem })),
  };
  const sourceContext = {
    ...packet,
    responseContract: MODEL_VISUAL_NECESSITY_TARGETED_REPAIR_RESPONSE_CONTRACT,
    repairAttempt: input.repairAttempt,
  };
  return {
    system: [
      "You repair model-authored visual-necessity decisions that failed strict validation.",
      "Return strict JSON with schemaVersion 1, the supplied gardenId, and exactly one complete replacement decision record for every supplied unit in decisions.",
      "Each replacement is atomic: author every decision field in the response contract, even when only one interaction field failed. The application will replace the entire prior decision and will not merge, restore, infer, normalize, or rewrite any semantic field inside it.",
      "Do not return decisions for unaffected units. Their previously validated records are immutable and will be preserved exactly by the application.",
      "Copy unitId, pageId, learningGoal, evidence.unitRole, evidence.learningQuestion, evidence.concepts, and evidence.sourceAnchorIds only from that unit packet. Honor every supplied override and the whole-garden budget. When the reported defects are limited to interaction grounding, preserve the prior necessity and preferredMedium so the accepted whole-garden allocation remains coherent.",
      "Use only that unit's supplied canonical source evidence. Every evidence quote must be a non-empty exact substring of the text at the same anchor.",
      "Grounding is literal: every meaningful normalized token in each control label, each select option, the observable label, and the expected insight must occur in the exact quote text cited for that field. Exact source symbols and formulas are valid when they occur with identifier boundaries in the cited quote (for example, t in E_x(z,t)); a character embedded inside a larger identifier or LaTeX command is not. evidence.sourceAnchorIds must be non-empty and include every anchor cited by the controls, observable, or expectedInsightEvidence. The safest construction is to reuse concise exact source wording. Do not use synonyms, inferred labels, or expanded conclusions.",
      "For every active interaction, author the complete interactionGoal, uniqueConcept, whyStaticSourceFigureIsNotEnough, learnerAction, controls, observable, expectedInsight, expectedInsightEvidence, and a duplicateSignature that does not reuse a reserved signature. Numeric and select control domains must satisfy the response contract exactly.",
      "For a non-interactive decision, use a non-interactive preferredMedium and omit interaction entirely. Never emit a partial patch, prose, renderer code, or a deterministic fallback.",
    ].join(" "),
    user: JSON.stringify(sourceContext),
    sourceContext,
  };
}

export type ModelVisualNecessityTargetedMergeResult =
  | { ok: true; response: unknown }
  | { ok: false; problems: ModelVisualNecessityProblem[] };

/** Atomically swaps complete model-authored decisions for the requested units. */
export function applyModelVisualNecessityTargetedRepairs(input: {
  packet: ModelVisualNecessityPacket;
  invalidResponse: unknown;
  repairResponse: unknown;
  targetUnitIds: string[];
}): ModelVisualNecessityTargetedMergeResult {
  const problems: ModelVisualNecessityProblem[] = [];
  const targetUnitIds = unique(input.targetUnitIds);
  const targetSet = new Set(targetUnitIds);
  const knownUnitIds = new Set(input.packet.units.map((unit) => unit.unitId));
  if (targetUnitIds.length === 0 || targetUnitIds.length !== input.targetUnitIds.length) {
    return {
      ok: false,
      problems: [{
        code: "invalid_targeted_repair_scope",
        path: "targetUnitIds",
        message: "targeted repair requires unique affected unit ids",
      }],
    };
  }
  for (const unitId of targetUnitIds) {
    if (!knownUnitIds.has(unitId)) {
      addProblem(
        problems,
        "invalid_targeted_repair_scope",
        "targetUnitIds",
        `targeted repair references unknown unit ${unitId}`,
        unitId,
      );
    }
  }
  const invalidRecord = asRecord(input.invalidResponse);
  const invalidDecisions = rawDecisionRecords(input.invalidResponse);
  if (!invalidRecord || !invalidDecisions) {
    addProblem(
      problems,
      "invalid_targeted_repair_base",
      "$",
      "prior whole-garden response must contain decision records",
    );
  }
  const repairRecord = asRecord(input.repairResponse);
  if (!repairRecord) {
    addProblem(problems, "invalid_targeted_repair_response", "$", "repair response must be an object");
  } else {
    if (repairRecord.schemaVersion !== MODEL_VISUAL_NECESSITY_SCHEMA_VERSION) {
      addProblem(
        problems,
        "invalid_targeted_repair_response",
        "schemaVersion",
        `schemaVersion must be numeric ${MODEL_VISUAL_NECESSITY_SCHEMA_VERSION}`,
      );
    }
    if (compact(repairRecord.gardenId) !== input.packet.gardenId) {
      addProblem(
        problems,
        "invalid_targeted_repair_response",
        "gardenId",
        `gardenId must equal ${input.packet.gardenId}`,
      );
    }
    if (!Array.isArray(repairRecord.decisions)) {
      addProblem(
        problems,
        "invalid_targeted_repair_response",
        "decisions",
        "decisions must be an array",
      );
    }
  }
  const repairs = Array.isArray(repairRecord?.decisions)
    ? repairRecord.decisions.map(asRecord)
    : [];
  const repairByUnit = new Map<string, Record<string, unknown>>();
  repairs.forEach((repair, index) => {
    if (!repair) {
      addProblem(
        problems,
        "invalid_targeted_repair_response",
        `decisions[${index}]`,
        "replacement decision must be an object",
      );
      return;
    }
    const unitId = compact(repair.unitId);
    if (!targetSet.has(unitId)) {
      addProblem(
        problems,
        "invalid_targeted_repair_response",
        `decisions[${index}].unitId`,
        `replacement decision targets unaffected or unknown unit ${unitId || "(empty)"}`,
        unitId || undefined,
      );
      return;
    }
    if (repairByUnit.has(unitId)) {
      addProblem(
        problems,
        "invalid_targeted_repair_response",
        `decisions[${index}].unitId`,
        `replacement response contains more than one decision for ${unitId}`,
        unitId,
      );
      return;
    }
    repairByUnit.set(unitId, repair);
  });
  for (const unitId of targetUnitIds) {
    if (!repairByUnit.has(unitId)) {
      addProblem(
        problems,
        "invalid_targeted_repair_response",
        "decisions",
        `replacement response omitted affected unit ${unitId}`,
        unitId,
      );
    }
    if (invalidDecisions?.filter((decision) => compact(decision.unitId) === unitId).length !== 1) {
      addProblem(
        problems,
        "invalid_targeted_repair_base",
        "decisions",
        `prior response must contain exactly one decision for ${unitId}`,
        unitId,
      );
    }
  }
  if (repairs.length !== targetUnitIds.length) {
    addProblem(
      problems,
      "invalid_targeted_repair_response",
      "decisions",
      `replacement response must contain exactly ${targetUnitIds.length} decision record(s)`,
    );
  }
  if (problems.length > 0 || !invalidRecord || !invalidDecisions) {
    return { ok: false, problems: [...new Map(problems.map((problem) => [
      `${problem.code}\u0000${problem.path}\u0000${problem.message}\u0000${problem.unitId ?? ""}`,
      problem,
    ])).values()] };
  }
  const decisions = invalidDecisions.map((decision) => {
    const unitId = compact(decision.unitId);
    return targetSet.has(unitId) ? repairByUnit.get(unitId)! : decision;
  });
  return {
    ok: true,
    response: {
      ...invalidRecord,
      decisions,
    },
  };
}

/**
 * Runs the complete model-authored decision loop. Unit-scoped failures may be
 * returned to the model as compact, complete-decision replacement requests;
 * unscoped failures stay on the bounded whole-batch path. Provider/transport
 * failures are rethrown because their retry budget belongs to the transport,
 * never to this semantic-repair loop.
 */
export async function runModelVisualNecessityPlanning(input: {
  packet: ModelVisualNecessityPacket;
  learningUnits: LearningUnitContract[];
  provider: ModelVisualNecessityProvider;
  targetedRepairProvider?: ModelVisualNecessityTargetedRepairProvider;
}): Promise<ModelVisualNecessityRunResult> {
  let problems: ModelVisualNecessityProblem[] = [];
  let lastResponse: unknown;
  let calls = 0;
  let targetedRepairCalls = 0;
  for (
    let attempt = 0;
    attempt < MODEL_VISUAL_NECESSITY_CALL_BUDGET.maximumTotalCalls;
    attempt += 1
  ) {
    const prompt = attempt === 0
      ? buildModelVisualNecessityPrompt(input.packet)
      : buildModelVisualNecessityRepairPrompt({
          packet: input.packet,
          invalidResponse: lastResponse,
          problems,
          repairAttempt: attempt,
        });
    calls += 1;
    // callCouncilText owns bounded transport retry. If it ultimately throws,
    // propagate that error without consuming another semantic model attempt.
    lastResponse = await input.provider({
      ...prompt,
      attempt,
      problems: [...problems],
    });
    let validation = validateModelVisualNecessityBatch({
      packet: input.packet,
      learningUnits: input.learningUnits,
      response: lastResponse,
    });
    if (!("problems" in validation)) {
      return {
        plan: validation.plan,
        calls,
        repairCalls: Math.max(0, calls - 1),
        targetedRepairCalls,
      };
    }
    problems = validation.problems;

    let targetUnitIds = targetedRepairUnitIds({
      packet: input.packet,
      invalidResponse: lastResponse,
      problems,
    });
    let targetedFeedback = problems;
    while (
      input.targetedRepairProvider &&
      targetUnitIds.length > 0 &&
      targetedRepairCalls < MODEL_VISUAL_NECESSITY_TARGETED_REPAIR_CALL_BUDGET.maximumRepairCalls
    ) {
      targetedRepairCalls += 1;
      const targetedPrompt = buildModelVisualNecessityTargetedRepairPrompt({
        packet: input.packet,
        invalidResponse: lastResponse,
        problems: targetedFeedback,
        targetUnitIds,
        repairAttempt: targetedRepairCalls,
      });
      calls += 1;
      const repairResponse = await input.targetedRepairProvider({
        ...targetedPrompt,
        attempt: targetedRepairCalls,
        problems: targetedFeedback.map((problem) => ({ ...problem })),
        unitIds: [...targetUnitIds],
      });
      const merged = applyModelVisualNecessityTargetedRepairs({
        packet: input.packet,
        invalidResponse: lastResponse,
        repairResponse,
        targetUnitIds,
      });
      if (!("response" in merged)) {
        // Preserve the currently accepted whole response. The next bounded AI
        // attempt sees both the original unit failures and this response-shape
        // rejection; code never applies a partial replacement.
        targetedFeedback = [...problems, ...merged.problems];
        continue;
      }
      lastResponse = merged.response;
      validation = validateModelVisualNecessityBatch({
        packet: input.packet,
        learningUnits: input.learningUnits,
        response: lastResponse,
      });
      if (!("problems" in validation)) {
        return {
          plan: validation.plan,
          calls,
          repairCalls: Math.max(0, calls - 1),
          targetedRepairCalls,
        };
      }
      problems = validation.problems;
      targetedFeedback = problems;
      targetUnitIds = targetedRepairUnitIds({
        packet: input.packet,
        invalidResponse: lastResponse,
        problems,
      });
    }
  }
  throw new ModelVisualNecessityPlanningError({ calls, problems, lastResponse });
}
