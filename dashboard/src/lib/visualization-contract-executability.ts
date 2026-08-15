import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { LearningUnitContract } from "./learning-unit-contract.ts";
import type { ProposedLearningMap } from "./learn-utils.ts";
import type { VisualizationContractRepairAttempt } from "./visualization-contract-repair.ts";
import {
  GENERATED_VISUAL_CAPABILITY_MANIFEST,
  GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
  GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION,
} from "./generated-visual-capabilities.ts";
import {
  buildVisualizationPlan,
  canonicalVisualizationEvidenceProblems,
  projectedVisualizationTypeForRoute,
  visualizationOpportunityFieldId,
  type VisualizationCanonicalEvidenceByUnit,
  type VisualizationPlan,
  type VisualizationRouteDecision,
} from "./visualization-opportunities.ts";
import {
  parseVisualizationContractRepairResponse,
  pedagogyContractFromCompleteRepair,
  validateVisualizationContractUnitRepair,
  type CompleteVisualizationContractUnitRepair,
  type VisualizationContractEvidenceEntry,
} from "./visualization-contract-validation.ts";

/**
 * This pass has one semantic authority: the reviewing model. Deterministic code
 * packages exact contracts and source evidence, checks the response envelope,
 * projects a complete replacement verbatim, and reruns the existing structural
 * gates. It never infers a missing control, changes a goal, or demotes a visual.
 */

export const VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION = 1 as const;

/** One review plus at most two semantic rereviews. Transport retries live below this boundary. */
export const VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET = Object.freeze({
  initialCalls: 1,
  maximumRereviewCalls: 2,
  maximumTotalCalls: 3,
});

/** Keeps a malformed provider payload from turning the audit ledger into an unbounded file. */
export const MAX_VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_BYTES = 512_000;
export const MAX_VISUAL_CONTRACT_EXECUTABILITY_LEDGER_BYTES = 4_000_000;

export const VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH =
  ".breadboard/visual-contract-executability-reviews.json" as const;

function quotedUnion(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join("|");
}

const VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA =
  `{"schemaVersion":1,"gardenId":string,"reviews":[{"unitId":string,"verdict":"approve"|"replace","reason":string,"replacement"?:{"unitId":string,"interactionGoal":"manipulate_variables"|"observe_change_over_time"|"compare_cases"|"step_through_process"|"explore_structure"|"test_prediction"|"inspect_relationship"|"simulate_system","learnerAction":string,"visualIntent":{"id":string,"uniqueConcept":string,"visualType":string,"whyStaticSourceFigureIsNotEnough":string,"learnerManipulates":string[],"expectedInsight":string,"sourceAnchors":string[],"duplicateSignature":string,"reuseOf"?:string},"controls":[{"id":string,"kind":${quotedUnion(GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.kinds)},"label":string,"type":${quotedUnion(GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.types)},"unit"?:string,"min"?:number,"max"?:number,"step"?:number,"options"?:string[],"defaultValue":number|string,"evidence":[{"anchor":string,"quote":string}]}],"observable":{"label":string,"representation":${quotedUnion(GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs.representations)},"evidence":[{"anchor":string,"quote":string}]},"expectedInsight":string,"expectedInsightEvidence":[{"anchor":string,"quote":string}]}}]}`;

export const VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA_HASH = crypto
  .createHash("sha256")
  .update(VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA)
  .digest("hex");

const VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH =
  ".breadboard/visual-necessity-decisions.json" as const;
const VISUAL_DECISION_RECORDS_RELATIVE_PATH =
  ".breadboard/visual-decision-records.json" as const;
const LEARNING_UNIT_CONTRACT_RELATIVE_PATH =
  ".breadboard/learning-unit-contract.json" as const;
const VISUALIZATION_PLAN_RELATIVE_PATH = ".breadboard/visualization-plan.json" as const;

type ActiveRequirement = "required" | "recommended" | "optional";

export interface VisualContractExecutabilityUnitPacket {
  unitId: string;
  title: string;
  role: string;
  learningQuestion: string;
  prerequisiteConcepts: string[];
  concepts: string[];
  necessity: ActiveRequirement;
  requirement: ActiveRequirement;
  contract: CompleteVisualizationContractUnitRepair;
  canonicalEvidence: VisualizationContractEvidenceEntry[];
}

export interface VisualContractExecutabilityReviewPacket {
  schemaVersion: typeof VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION;
  gardenId: string;
  units: VisualContractExecutabilityUnitPacket[];
  technicalCapabilities: {
    manifestVersion: typeof GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION;
    manifestHash: string;
    manifest: typeof GENERATED_VISUAL_CAPABILITY_MANIFEST;
  };
  wholeGardenConstraints?: VisualContractExecutabilityWholeGardenConstraints;
  previousRejectionReasons: string[];
  previousResponse?: unknown;
}

export interface VisualContractExecutabilityWholeGardenConstraints {
  unitOrder: string[];
  sectionByUnit: Record<string, string>;
  maximumRepeatedInteractionSignature: number;
  targetMinimum: number;
  targetMaximum: number;
  maximumPerSection: number;
  minimumUnitsBetweenSimilarVisuals: number;
  requiredVisuals: number;
  recommendedVisuals: number;
  optionalVisuals: number;
}

function decisionWithoutInteraction(unit: LearningUnitContract): unknown {
  const decision = unit.interactiveVisualPlan?.decision;
  if (!decision) return undefined;
  const { interaction: _interaction, ...immutableDecision } = decision;
  return immutableDecision;
}

export function reviewedWholeGardenConstraintProblems(input: {
  beforeUnits: LearningUnitContract[];
  reviewedUnits: LearningUnitContract[];
  constraints: VisualContractExecutabilityWholeGardenConstraints;
}): VisualContractExecutabilityProblem[] {
  const problems: VisualContractExecutabilityProblem[] = [];
  const beforeIds = input.beforeUnits.map((unit) => unit.id);
  const reviewedIds = input.reviewedUnits.map((unit) => unit.id);
  if (!isDeepStrictEqual(beforeIds, input.constraints.unitOrder)) {
    problem(
      problems,
      "invalid_global_constraints",
      "wholeGardenConstraints.unitOrder",
      "configured unit order does not exactly match the pre-review learning-unit order",
    );
  }
  if (!isDeepStrictEqual(reviewedIds, beforeIds)) {
    problem(
      problems,
      "unit_order_changed",
      "learningUnits",
      "reviewed learning-unit ids or order differ from the pre-review contract",
    );
  }
  const sectionUnitIds = Object.keys(input.constraints.sectionByUnit);
  const missingSectionUnitIds = beforeIds.filter(
    (unitId) => !compact(input.constraints.sectionByUnit[unitId]),
  );
  const extraSectionUnitIds = sectionUnitIds.filter((unitId) => !beforeIds.includes(unitId));
  if (missingSectionUnitIds.length > 0 || extraSectionUnitIds.length > 0) {
    problem(
      problems,
      "invalid_global_constraints",
      "wholeGardenConstraints.sectionByUnit",
      `section mapping must cover the whole garden exactly; missing [${missingSectionUnitIds.join(", ")}], extra [${extraSectionUnitIds.join(", ")}]`,
    );
  }
  const beforeById = new Map(input.beforeUnits.map((unit) => [unit.id, unit]));
  for (const unit of input.reviewedUnits) {
    const before = beforeById.get(unit.id);
    if (!before) continue;
    if (unit.interactiveVisualPlan?.requirement !== before.interactiveVisualPlan?.requirement) {
      problem(
        problems,
        "requirement_changed",
        `unit:${unit.id}.interactiveVisualPlan.requirement`,
        "executability review changed immutable requirement",
        unit.id,
      );
    }
    if (!isDeepStrictEqual(decisionWithoutInteraction(unit), decisionWithoutInteraction(before))) {
      problem(
        problems,
        "necessity_decision_changed",
        `unit:${unit.id}.interactiveVisualPlan.decision`,
        "executability review changed immutable visual-necessity allocation fields",
        unit.id,
      );
    }
    if (!isDeepStrictEqual(unit.teachingMediumPlan, before.teachingMediumPlan)) {
      problem(
        problems,
        "teaching_medium_changed",
        `unit:${unit.id}.teachingMediumPlan`,
        "executability review changed immutable teaching-medium policy",
        unit.id,
      );
    }
  }

  const active = input.reviewedUnits.filter((unit) => activeRequirement(unit));
  const counts = {
    required: active.filter((unit) => activeRequirement(unit) === "required").length,
    recommended: active.filter((unit) => activeRequirement(unit) === "recommended").length,
    optional: active.filter((unit) => activeRequirement(unit) === "optional").length,
  };
  for (const [field, actual, expected] of [
    ["requiredVisuals", counts.required, input.constraints.requiredVisuals],
    ["recommendedVisuals", counts.recommended, input.constraints.recommendedVisuals],
    ["optionalVisuals", counts.optional, input.constraints.optionalVisuals],
  ] as const) {
    if (actual !== expected) {
      problem(
        problems,
        "visual_budget_count_mismatch",
        `wholeGardenConstraints.${field}`,
        `${field} is ${expected}, but reviewed contracts contain ${actual}`,
      );
    }
  }
  if (active.length < input.constraints.targetMinimum || active.length > input.constraints.targetMaximum) {
    problem(
      problems,
      "visual_budget_target_mismatch",
      "wholeGardenConstraints",
      `${active.length} active contracts must remain within ${input.constraints.targetMinimum}..${input.constraints.targetMaximum}`,
    );
  }

  const sectionCounts = new Map<string, number>();
  for (const unit of active) {
    const sectionId = input.constraints.sectionByUnit[unit.id];
    if (!compact(sectionId)) {
      problem(
        problems,
        "invalid_global_constraints",
        `wholeGardenConstraints.sectionByUnit.${unit.id}`,
        "active unit has no section mapping",
        unit.id,
      );
      continue;
    }
    sectionCounts.set(sectionId, (sectionCounts.get(sectionId) ?? 0) + 1);
  }
  for (const [sectionId, count] of sectionCounts) {
    if (count > input.constraints.maximumPerSection) {
      problem(
        problems,
        "visual_budget_section_mismatch",
        `section:${sectionId}`,
        `${count} active contracts exceed maximumPerSection ${input.constraints.maximumPerSection}`,
      );
    }
  }

  const signatures = new Map<string, string[]>();
  const visualIntentIds = new Map<string, string[]>();
  for (const unit of active) {
    const visualIntentId = compact(unit.interactiveVisualPlan?.visualIntent?.id);
    if (visualIntentId) {
      visualIntentIds.set(visualIntentId, [
        ...(visualIntentIds.get(visualIntentId) ?? []),
        unit.id,
      ]);
    }
    const signature = compact(unit.interactiveVisualPlan?.visualIntent?.duplicateSignature).toLowerCase();
    if (!signature) continue;
    signatures.set(signature, [...(signatures.get(signature) ?? []), unit.id]);
  }
  for (const [visualIntentId, unitIds] of visualIntentIds) {
    if (unitIds.length > 1) {
      problem(
        problems,
        "duplicate_visual_intent_id",
        "reviewedContracts",
        `visualIntent.id ${visualIntentId} is shared by ${unitIds.join(", ")}; ids must be globally unique`,
      );
    }
  }
  for (const [signature, unitIds] of signatures) {
    if (unitIds.length > input.constraints.maximumRepeatedInteractionSignature) {
      problem(
        problems,
        "duplicate_interaction_signature",
        "reviewedContracts",
        `interaction signature ${signature} is repeated by ${unitIds.join(", ")}; maximum is ${input.constraints.maximumRepeatedInteractionSignature}`,
      );
    }
  }
  if (input.constraints.minimumUnitsBetweenSimilarVisuals > 0) {
    const unitIndex = new Map(input.constraints.unitOrder.map((unitId, index) => [unitId, index]));
    for (const [signature, unitIds] of signatures) {
      const indices = unitIds
        .map((unitId) => unitIndex.get(unitId) ?? -1)
        .sort((left, right) => left - right);
      for (let index = 1; index < indices.length; index += 1) {
        const unitsBetween = indices[index] - indices[index - 1] - 1;
        if (unitsBetween < input.constraints.minimumUnitsBetweenSimilarVisuals) {
          problem(
            problems,
            "visual_budget_spacing_mismatch",
            "wholeGardenConstraints.minimumUnitsBetweenSimilarVisuals",
            `interaction signature ${signature} has ${unitsBetween} unit(s) between uses; minimum is ${input.constraints.minimumUnitsBetweenSimilarVisuals}`,
          );
        }
      }
    }
  }
  return problems;
}

export interface VisualContractExecutabilityApproval {
  unitId: string;
  verdict: "approve";
  reason: string;
}

export interface VisualContractExecutabilityReplacement {
  unitId: string;
  verdict: "replace";
  reason: string;
  replacement: CompleteVisualizationContractUnitRepair;
}

export type VisualContractExecutabilityReview =
  | VisualContractExecutabilityApproval
  | VisualContractExecutabilityReplacement;

export interface VisualContractExecutabilityResponse {
  schemaVersion: typeof VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION;
  gardenId: string;
  reviews: VisualContractExecutabilityReview[];
}

export interface VisualContractExecutabilityProblem {
  code: string;
  path: string;
  message: string;
  unitId?: string;
}

export interface VisualContractExecutabilityProviderRequest {
  system: string;
  user: string;
  sourceContext: VisualContractExecutabilityReviewPacket;
  /** One is the initial review; two and three are bounded semantic rereviews. */
  attempt: number;
  problems: VisualContractExecutabilityProblem[];
  unitIds: string[];
}

export type VisualContractExecutabilityProvider = (
  request: VisualContractExecutabilityProviderRequest,
) => Promise<unknown>;

export interface VisualContractExecutabilityAttempt {
  attempt: number;
  startedAt: string;
  completedAt: string;
  requestHash: string;
  packetHash: string;
  systemPromptHash: string;
  responseSchemaHash: string;
  canonicalEvidenceHashes: Record<string, string>;
  wholeGardenConstraintsHash: string | null;
  transportAccounting: {
    logicalSemanticCall: number;
    providerInvocationsAtThisBoundary: 1;
    transportRetries: "owned_below_semantic_boundary_not_counted";
  };
  accepted: boolean;
  responseEncoding: "json" | "undefined";
  response: unknown;
  rejectionReasons: VisualContractExecutabilityProblem[];
}

function sha256Json(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function auditResponse(value: unknown): {
  responseEncoding: "json" | "undefined";
  response: unknown;
} {
  return value === undefined
    ? { responseEncoding: "undefined", response: null }
    : { responseEncoding: "json", response: value };
}

export interface VisualContractExecutabilityRunResult<TPlan> {
  learningUnits: LearningUnitContract[];
  plan: TPlan;
  calls: number;
  rejectedReviews: number;
  approvedUnitIds: string[];
  replacedUnitIds: string[];
  acceptedResponse: VisualContractExecutabilityResponse | null;
  attempts: VisualContractExecutabilityAttempt[];
  beforeContracts: Record<string, CompleteVisualizationContractUnitRepair>;
  reviewedContracts: Record<string, CompleteVisualizationContractUnitRepair>;
  wholeGardenConstraints: VisualContractExecutabilityWholeGardenConstraints | null;
}

export class VisualContractExecutabilityReviewError extends Error {
  readonly calls: number;
  readonly problems: VisualContractExecutabilityProblem[];
  readonly lastResponse: unknown;

  constructor(input: {
    calls: number;
    problems: VisualContractExecutabilityProblem[];
    lastResponse: unknown;
  }) {
    const summary = input.problems
      .slice(0, 8)
      .map((problem) => `${problem.path}: ${problem.message}`)
      .join("; ");
    super(
      `Model-authored visual-contract executability review remained invalid after ${input.calls} call(s)` +
      `${summary ? `: ${summary}` : "."}`,
    );
    this.name = "VisualContractExecutabilityReviewError";
    this.calls = input.calls;
    this.problems = input.problems;
    this.lastResponse = input.lastResponse;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compact(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cloneExact<T>(value: T): T {
  return structuredClone(value);
}

function responseByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function problem(
  problems: VisualContractExecutabilityProblem[],
  code: string,
  pathValue: string,
  message: string,
  unitId?: string,
): void {
  problems.push({ code, path: pathValue, message, ...(unitId ? { unitId } : {}) });
}

function exactObjectKeys(input: {
  value: Record<string, unknown>;
  path: string;
  required: readonly string[];
  optional?: readonly string[];
  problems: VisualContractExecutabilityProblem[];
  unitId?: string;
}): void {
  const allowed = new Set([...input.required, ...(input.optional ?? [])]);
  for (const key of input.required) {
    if (!Object.prototype.hasOwnProperty.call(input.value, key)) {
      problem(
        input.problems,
        "missing_field",
        `${input.path}.${key}`,
        `${input.path}.${key} is required`,
        input.unitId,
      );
    }
  }
  for (const key of Object.keys(input.value)) {
    if (!allowed.has(key)) {
      problem(
        input.problems,
        "unexpected_field",
        `${input.path}.${key}`,
        `${input.path} contains forbidden or unexpected field ${JSON.stringify(key)}`,
        input.unitId,
      );
    }
  }
}

function strictEvidenceRefsShape(
  value: unknown,
  pathValue: string,
  problems: VisualContractExecutabilityProblem[],
  unitId: string,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isRecord(item)) return;
    exactObjectKeys({
      value: item,
      path: `${pathValue}[${index}]`,
      required: ["anchor", "quote"],
      problems,
      unitId,
    });
  });
}

function strictReplacementShape(
  value: unknown,
  pathValue: string,
  problems: VisualContractExecutabilityProblem[],
  unitId: string,
): void {
  if (!isRecord(value)) return;
  exactObjectKeys({
    value,
    path: pathValue,
    required: [
      "unitId",
      "interactionGoal",
      "learnerAction",
      "visualIntent",
      "controls",
      "observable",
      "expectedInsight",
      "expectedInsightEvidence",
    ],
    problems,
    unitId,
  });
  if (isRecord(value.visualIntent)) {
    exactObjectKeys({
      value: value.visualIntent,
      path: `${pathValue}.visualIntent`,
      required: [
        "id",
        "uniqueConcept",
        "visualType",
        "whyStaticSourceFigureIsNotEnough",
        "learnerManipulates",
        "expectedInsight",
        "sourceAnchors",
        "duplicateSignature",
      ],
      optional: ["reuseOf"],
      problems,
      unitId,
    });
  }
  if (Array.isArray(value.controls)) {
    value.controls.forEach((control, index) => {
      if (!isRecord(control)) return;
      exactObjectKeys({
        value: control,
        path: `${pathValue}.controls[${index}]`,
        required: ["id", "kind", "label", "type", "defaultValue", "evidence"],
        optional: ["unit", "min", "max", "step", "options"],
        problems,
        unitId,
      });
      strictEvidenceRefsShape(
        control.evidence,
        `${pathValue}.controls[${index}].evidence`,
        problems,
        unitId,
      );
    });
  }
  if (isRecord(value.observable)) {
    exactObjectKeys({
      value: value.observable,
      path: `${pathValue}.observable`,
      required: ["label", "representation", "evidence"],
      problems,
      unitId,
    });
    strictEvidenceRefsShape(
      value.observable.evidence,
      `${pathValue}.observable.evidence`,
      problems,
      unitId,
    );
  }
  strictEvidenceRefsShape(
    value.expectedInsightEvidence,
    `${pathValue}.expectedInsightEvidence`,
    problems,
    unitId,
  );
}

function activeRequirement(unit: LearningUnitContract): ActiveRequirement | null {
  const requirement = unit.interactiveVisualPlan?.requirement;
  return requirement === "required" || requirement === "recommended" || requirement === "optional"
    ? requirement
    : null;
}

export function completeVisualContractForUnit(
  unit: LearningUnitContract,
): CompleteVisualizationContractUnitRepair {
  const plan = unit.interactiveVisualPlan;
  if (
    !activeRequirement(unit) ||
    !plan?.interactionGoal ||
    !plan.learnerAction?.trim() ||
    !plan.visualIntent ||
    !plan.controlContract ||
    !plan.observable ||
    !plan.expectedInsightEvidence
  ) {
    throw new Error(`${unit.id}: active visual has no complete model-authored interaction contract`);
  }
  return {
    unitId: unit.id,
    interactionGoal: plan.interactionGoal,
    learnerAction: plan.learnerAction,
    visualIntent: cloneExact(plan.visualIntent),
    controls: cloneExact(plan.controlContract),
    observable: cloneExact(plan.observable),
    expectedInsight: plan.visualIntent.expectedInsight,
    expectedInsightEvidence: cloneExact(plan.expectedInsightEvidence),
  };
}

export function buildVisualContractExecutabilityReviewPacket(input: {
  gardenId: string;
  learningUnits: LearningUnitContract[];
  canonicalEvidenceByUnit: VisualizationCanonicalEvidenceByUnit;
  wholeGardenConstraints?: VisualContractExecutabilityWholeGardenConstraints;
  previousRejectionReasons?: VisualContractExecutabilityProblem[];
  previousResponse?: unknown;
}): VisualContractExecutabilityReviewPacket {
  const gardenId = compact(input.gardenId);
  if (!gardenId) throw new Error("A garden id is required for visual-contract executability review.");
  const units = input.learningUnits.flatMap((unit): VisualContractExecutabilityUnitPacket[] => {
    const requirement = activeRequirement(unit);
    if (!requirement) return [];
    const evidence = input.canonicalEvidenceByUnit[unit.id];
    const evidenceProblems = canonicalVisualizationEvidenceProblems({ unit, evidence });
    if (evidenceProblems.length > 0) {
      throw new Error(
        `Canonical visual-contract executability evidence validation failed: ${evidenceProblems.join("; ")}`,
      );
    }
    const necessity = unit.interactiveVisualPlan!.decision.necessity;
    if (necessity !== requirement) {
      throw new Error(
        `${unit.id}: immutable necessity ${necessity} does not match active requirement ${requirement}`,
      );
    }
    return [{
      unitId: unit.id,
      title: unit.title,
      role: unit.role,
      learningQuestion: unit.learningQuestion,
      prerequisiteConcepts: [...unit.prerequisiteConcepts],
      concepts: [
        ...unit.newConcepts,
        ...(unit.semanticConcepts ?? []).flatMap((concept) => [
          concept.slug,
          concept.preferredLabel,
          ...concept.aliases,
        ]),
      ],
      necessity,
      requirement,
      contract: completeVisualContractForUnit(unit),
      canonicalEvidence: cloneExact(evidence as VisualizationContractEvidenceEntry[]),
    }];
  });
  return {
    schemaVersion: VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION,
    gardenId,
    units,
    technicalCapabilities: {
      manifestVersion: GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION,
      manifestHash: GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
      manifest: GENERATED_VISUAL_CAPABILITY_MANIFEST,
    },
    ...(input.wholeGardenConstraints
      ? { wholeGardenConstraints: cloneExact(input.wholeGardenConstraints) }
      : {}),
    previousRejectionReasons: (input.previousRejectionReasons ?? []).map(
      (item) => `${item.path}: ${item.message}`,
    ),
    ...(input.previousResponse !== undefined
      ? { previousResponse: cloneExact(input.previousResponse) }
      : {}),
  };
}

export function visualContractExecutabilitySystemPrompt(): string {
  return [
    "You are the sole pedagogical-executability reviewer for model-authored interactive visual contracts.",
    "Review every supplied active unit and return exactly one verdict for each unit: approve the complete current contract unchanged, or replace it with one complete interaction contract authored by you.",
    `Return strict JSON with exactly this shape: ${VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA}.`,
    "An approve verdict must contain only unitId, verdict, and a non-empty reason. A replace verdict must contain those fields plus the entire replacement record; never return a patch or omit an unchanged field.",
    "Necessity, requirement, unit identity, teaching-medium policy, and publication policy are immutable. Do not return any of those fields inside a replacement. Code will discard the entire batch if one unit is missing, duplicated, extra, malformed, ungrounded, or invalid; code will never fill, merge, demote, or reinterpret your pedagogy.",
    "Approve only when the interaction goal, learner controls, learner-visible observable, and expected insight form an executable learning activity. The learner must be able to perform the action named by the goal using the declared controls, observe the consequence needed to judge the result, and reach the expected insight from the represented states.",
    "Judge realizability against the exact versioned technicalCapabilities manifest in the request. Approve only when the declared learner sequence can be implemented with those control state transitions, expressions, conditional visibility rules, scene kinds, primitive topology, and hard limits; do not assume hidden state, geometry, widgets, or renderer features absent from that manifest.",
    "Check goal-to-control-to-observable executability explicitly. Every condition or case that is decisive for the expected insight must be represented by a declared control state or by explicit observable behavior; a selector that merely changes what is displayed is insufficient when the goal requires a distinct learner decision, comparison, prediction, or evaluation.",
    "For interactionGoal test_prediction, the contract must give the learner a way to commit a prediction before the outcome is revealed or evaluated. A control that only selects the viewed case or display state is not by itself a prediction commitment. The observable must make the later result or evaluation visible without erasing the committed choice.",
    "Use only the canonical evidence supplied with that same unit. Every evidence quote must be an exact substring at its anchor, and every control label, select option, observable label, and expected insight must be literally grounded under the supplied contract rules. Do not invent subject-matter claims, cases, variables, conditions, or units.",
    "When previousRejectionReasons are present, correct every listed problem in a fresh complete batch. Do not argue with or paraphrase the rejection reasons.",
  ].join(" ");
}

export function buildVisualContractExecutabilityPrompt(
  packet: VisualContractExecutabilityReviewPacket,
): { system: string; user: string; sourceContext: VisualContractExecutabilityReviewPacket } {
  return {
    system: visualContractExecutabilitySystemPrompt(),
    user: JSON.stringify(packet),
    sourceContext: packet,
  };
}

export type ParseVisualContractExecutabilityResponseResult =
  | { ok: true; response: VisualContractExecutabilityResponse }
  | { ok: false; problems: VisualContractExecutabilityProblem[] };

export function parseVisualContractExecutabilityResponse(input: {
  value: unknown;
  gardenId: string;
  activeUnitIds: readonly string[];
}): ParseVisualContractExecutabilityResponseResult {
  const problems: VisualContractExecutabilityProblem[] = [];
  if (responseByteLength(input.value) > MAX_VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_BYTES) {
    problem(
      problems,
      "response_too_large",
      "response",
      `response exceeds ${MAX_VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_BYTES} UTF-8 bytes`,
    );
    return { ok: false, problems };
  }
  if (!isRecord(input.value)) {
    problem(problems, "invalid_response", "response", "response must be an object");
    return { ok: false, problems };
  }
  exactObjectKeys({
    value: input.value,
    path: "response",
    required: ["schemaVersion", "gardenId", "reviews"],
    problems,
  });
  if (input.value.schemaVersion !== VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION) {
    problem(
      problems,
      "schema_mismatch",
      "response.schemaVersion",
      `schemaVersion must equal ${VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION}`,
    );
  }
  if (input.value.gardenId !== input.gardenId) {
    problem(
      problems,
      "garden_mismatch",
      "response.gardenId",
      `gardenId must exactly equal ${JSON.stringify(input.gardenId)}`,
    );
  }
  if (!Array.isArray(input.value.reviews)) {
    problem(problems, "invalid_reviews", "response.reviews", "reviews must be an array");
    return { ok: false, problems };
  }

  const active = new Set(input.activeUnitIds);
  const seen = new Set<string>();
  const reviews: VisualContractExecutabilityReview[] = [];
  input.value.reviews.forEach((rawReview, index) => {
    const reviewPath = `response.reviews[${index}]`;
    if (!isRecord(rawReview)) {
      problem(problems, "invalid_review", reviewPath, `${reviewPath} must be an object`);
      return;
    }
    const unitId = typeof rawReview.unitId === "string" ? rawReview.unitId : "";
    const verdict = rawReview.verdict;
    const reason = compact(rawReview.reason);
    const replace = verdict === "replace";
    exactObjectKeys({
      value: rawReview,
      path: reviewPath,
      required: replace
        ? ["unitId", "verdict", "reason", "replacement"]
        : ["unitId", "verdict", "reason"],
      problems,
      unitId: unitId || undefined,
    });
    if (!unitId) {
      problem(problems, "missing_unit_id", `${reviewPath}.unitId`, "unitId must be a non-empty string");
    } else if (!active.has(unitId)) {
      problem(
        problems,
        "unexpected_unit",
        `${reviewPath}.unitId`,
        `review targets inactive or unknown unit ${unitId}`,
        unitId,
      );
    } else if (seen.has(unitId)) {
      problem(
        problems,
        "duplicate_unit",
        `${reviewPath}.unitId`,
        `review duplicates active unit ${unitId}`,
        unitId,
      );
    }
    if (unitId) seen.add(unitId);
    if (verdict !== "approve" && verdict !== "replace") {
      problem(
        problems,
        "invalid_verdict",
        `${reviewPath}.verdict`,
        'verdict must be exactly "approve" or "replace"',
        unitId || undefined,
      );
    }
    if (!reason) {
      problem(
        problems,
        "missing_reason",
        `${reviewPath}.reason`,
        "reason must be a non-empty string",
        unitId || undefined,
      );
    }
    if (verdict === "approve") {
      if (Object.prototype.hasOwnProperty.call(rawReview, "replacement")) {
        problem(
          problems,
          "unexpected_replacement",
          `${reviewPath}.replacement`,
          "approve verdict must not contain a replacement",
          unitId || undefined,
        );
      }
      if (unitId && reason) reviews.push({ unitId, verdict, reason: rawReview.reason as string });
      return;
    }
    if (verdict !== "replace") return;
    strictReplacementShape(rawReview.replacement, `${reviewPath}.replacement`, problems, unitId);
    const parsed = parseVisualizationContractRepairResponse(
      { repairs: [rawReview.replacement] },
      { requireCompleteContract: true },
    );
    for (const message of parsed.problems) {
      problem(
        problems,
        "invalid_replacement",
        `${reviewPath}.replacement`,
        message,
        unitId || undefined,
      );
    }
    const replacement = parsed.repairs[0];
    if (!replacement) {
      problem(
        problems,
        "missing_replacement",
        `${reviewPath}.replacement`,
        "replace verdict requires one complete replacement record",
        unitId || undefined,
      );
      return;
    }
    if (replacement.unitId !== unitId) {
      problem(
        problems,
        "replacement_unit_mismatch",
        `${reviewPath}.replacement.unitId`,
        `replacement unitId ${JSON.stringify(replacement.unitId)} must equal review unitId ${JSON.stringify(unitId)}`,
        unitId || undefined,
      );
    }
    if (unitId && reason && parsed.problems.length === 0) {
      // The strict shape check makes this cast a verbatim semantic record. Do
      // not use the parser's projection here: application must retain the
      // model's exact strings, array order, and optional-field presence.
      reviews.push({
        unitId,
        verdict,
        reason: rawReview.reason as string,
        replacement: cloneExact(rawReview.replacement) as CompleteVisualizationContractUnitRepair,
      });
    }
  });

  for (const unitId of input.activeUnitIds) {
    if (!seen.has(unitId)) {
      problem(
        problems,
        "missing_unit_review",
        "response.reviews",
        `response omitted active unit ${unitId}`,
        unitId,
      );
    }
  }
  if (input.value.reviews.length !== input.activeUnitIds.length) {
    problem(
      problems,
      "review_count_mismatch",
      "response.reviews",
      `response must contain exactly ${input.activeUnitIds.length} review(s), received ${input.value.reviews.length}`,
    );
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    response: {
      schemaVersion: VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION,
      gardenId: input.gardenId,
      reviews,
    },
  };
}

function applyVerbatimReplacements(input: {
  learningUnits: LearningUnitContract[];
  response: VisualContractExecutabilityResponse;
  canonicalEvidenceByUnit: VisualizationCanonicalEvidenceByUnit;
}):
  | { ok: true; learningUnits: LearningUnitContract[]; replacedUnitIds: string[] }
  | { ok: false; problems: VisualContractExecutabilityProblem[] } {
  const unitById = new Map(input.learningUnits.map((unit) => [unit.id, unit]));
  const replacementByUnit = new Map<string, CompleteVisualizationContractUnitRepair>();
  const problems: VisualContractExecutabilityProblem[] = [];
  for (const review of input.response.reviews) {
    if (review.verdict !== "replace") continue;
    const unit = unitById.get(review.unitId);
    if (!unit) {
      problem(
        problems,
        "unknown_replacement_unit",
        `review:${review.unitId}`,
        `replacement targets unknown unit ${review.unitId}`,
        review.unitId,
      );
      continue;
    }
    const validation = validateVisualizationContractUnitRepair({
      unit,
      repair: review.replacement,
      evidence: input.canonicalEvidenceByUnit[unit.id] ?? [],
      requireCompleteContract: true,
    });
    for (const message of validation) {
      problem(
        problems,
        "invalid_replacement_contract",
        `review:${review.unitId}.replacement`,
        message,
        review.unitId,
      );
    }
    replacementByUnit.set(review.unitId, review.replacement);
  }
  if (problems.length > 0) return { ok: false, problems };

  // No mutation occurs before every replacement validates. Approved and
  // inactive records remain the exact same objects; replacement records are
  // installed whole, never merged field by field with prior semantics.
  const learningUnits = input.learningUnits.map((unit) => {
    const replacement = replacementByUnit.get(unit.id);
    if (!replacement) return unit;
    const priorPlan = unit.interactiveVisualPlan!;
    const priorRequirement = priorPlan.requirement;
    const priorNecessity = priorPlan.decision.necessity;
    const next: LearningUnitContract = {
      ...unit,
      interactiveVisual: replacement.visualIntent,
      interactiveVisualPlan: {
        ...priorPlan,
        decision: {
          ...priorPlan.decision,
          interaction: pedagogyContractFromCompleteRepair(replacement),
        },
        interactionGoal: replacement.interactionGoal,
        learnerAction: replacement.learnerAction,
        visualIntent: replacement.visualIntent,
        controlContract: replacement.controls,
        observable: replacement.observable,
        expectedInsightEvidence: replacement.expectedInsightEvidence,
      },
    };
    if (
      next.interactiveVisualPlan?.requirement !== priorRequirement ||
      next.interactiveVisualPlan.decision.necessity !== priorNecessity
    ) {
      throw new Error(`${unit.id}: executability replacement changed immutable necessity or requirement`);
    }
    return next;
  });
  return {
    ok: true,
    learningUnits,
    replacedUnitIds: [...replacementByUnit.keys()],
  };
}

export async function runVisualContractExecutabilityReview<TPlan>(input: {
  gardenId: string;
  learningUnits: LearningUnitContract[];
  canonicalEvidenceByUnit: VisualizationCanonicalEvidenceByUnit;
  wholeGardenConstraints?: VisualContractExecutabilityWholeGardenConstraints;
  provider: VisualContractExecutabilityProvider;
  validateGlobal?: (learningUnits: LearningUnitContract[]) => VisualContractExecutabilityProblem[];
  /** Must run the complete existing whole-plan/global validators and return their plan. */
  validateAll: (learningUnits: LearningUnitContract[]) => TPlan;
  maxCalls?: number;
  checkCancelled?: () => void;
  onEvent?: (type: string, data: Record<string, unknown>) => void;
}): Promise<VisualContractExecutabilityRunResult<TPlan>> {
  const activeUnits = input.learningUnits.filter((unit) => activeRequirement(unit));
  const activeUnitIds = activeUnits.map((unit) => unit.id);
  const beforeContracts = Object.fromEntries(
    activeUnits.map((unit) => [unit.id, completeVisualContractForUnit(unit)]),
  );
  if (activeUnits.length === 0) {
    return {
      learningUnits: input.learningUnits,
      plan: input.validateAll(input.learningUnits),
      calls: 0,
      rejectedReviews: 0,
      approvedUnitIds: [],
      replacedUnitIds: [],
      acceptedResponse: null,
      attempts: [],
      beforeContracts,
      reviewedContracts: {},
      wholeGardenConstraints: input.wholeGardenConstraints
        ? cloneExact(input.wholeGardenConstraints)
        : null,
    };
  }
  if (new Set(activeUnitIds).size !== activeUnitIds.length) {
    throw new Error("Visual-contract executability review requires unique active learning-unit ids.");
  }
  const maxCalls = Math.max(
    1,
    Math.min(
      VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET.maximumTotalCalls,
      input.maxCalls ?? VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET.maximumTotalCalls,
    ),
  );
  let previousProblems: VisualContractExecutabilityProblem[] = [];
  let previousResponse: unknown;
  const attempts: VisualContractExecutabilityAttempt[] = [];
  input.onEvent?.("visual_contract_executability_review_started", {
    unitIds: activeUnitIds,
    maximumCalls: maxCalls,
  });

  for (let attempt = 1; attempt <= maxCalls; attempt += 1) {
    input.checkCancelled?.();
    const packet = buildVisualContractExecutabilityReviewPacket({
      gardenId: input.gardenId,
      learningUnits: input.learningUnits,
      canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
      ...(input.wholeGardenConstraints
        ? { wholeGardenConstraints: input.wholeGardenConstraints }
        : {}),
      previousRejectionReasons: previousProblems,
      ...(previousResponse !== undefined ? { previousResponse } : {}),
    });
    const prompt = buildVisualContractExecutabilityPrompt(packet);
    const startedAt = new Date().toISOString();
    const attemptAudit = {
      attempt,
      startedAt,
      requestHash: sha256Json({ system: prompt.system, user: prompt.user }),
      packetHash: sha256Json(packet),
      systemPromptHash: sha256Text(prompt.system),
      responseSchemaHash: VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA_HASH,
      canonicalEvidenceHashes: Object.fromEntries(
        packet.units.map((unit) => [unit.unitId, sha256Json(unit.canonicalEvidence)]),
      ),
      wholeGardenConstraintsHash: packet.wholeGardenConstraints
        ? sha256Json(packet.wholeGardenConstraints)
        : null,
      transportAccounting: {
        logicalSemanticCall: attempt,
        providerInvocationsAtThisBoundary: 1 as const,
        transportRetries: "owned_below_semantic_boundary_not_counted" as const,
      },
    };
    // Deliberately no catch: a true transport/provider exception escapes this
    // semantic budget after exactly one logical call.
    let rawResponse: unknown;
    try {
      rawResponse = await input.provider({
        ...prompt,
        attempt,
        problems: cloneExact(previousProblems),
        unitIds: [...activeUnitIds],
      });
    } catch (error) {
      try {
        input.checkCancelled?.();
      } catch (cancelled) {
        input.onEvent?.("visual_contract_executability_review_cancelled", {
          attempt,
          unitIds: activeUnitIds,
          reason: cancelled instanceof Error ? cancelled.message : String(cancelled),
        });
        throw cancelled;
      }
      input.onEvent?.("visual_contract_executability_review_transport_aborted", {
        attempt,
        unitIds: activeUnitIds,
        semanticRejectionsBeforeTransportFailure: attempt - 1,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    try {
      input.checkCancelled?.();
    } catch (error) {
      input.onEvent?.("visual_contract_executability_review_cancelled", {
        attempt,
        unitIds: activeUnitIds,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const exactResponse = cloneExact(rawResponse);
    const parsed = parseVisualContractExecutabilityResponse({
      value: exactResponse,
      gardenId: input.gardenId,
      activeUnitIds,
    });
    if (!parsed.ok) {
      previousProblems = parsed.problems;
      previousResponse = exactResponse;
      attempts.push({
        ...attemptAudit,
        completedAt: new Date().toISOString(),
        accepted: false,
        ...auditResponse(exactResponse),
        rejectionReasons: cloneExact(previousProblems),
      });
      input.onEvent?.("visual_contract_executability_review_rejected", {
        attempt,
        reasons: previousProblems.map((item) => `${item.path}: ${item.message}`),
      });
      continue;
    }
    const applied = applyVerbatimReplacements({
      learningUnits: input.learningUnits,
      response: parsed.response,
      canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
    });
    if (!applied.ok) {
      previousProblems = applied.problems;
      previousResponse = exactResponse;
      attempts.push({
        ...attemptAudit,
        completedAt: new Date().toISOString(),
        accepted: false,
        ...auditResponse(exactResponse),
        rejectionReasons: cloneExact(previousProblems),
      });
      input.onEvent?.("visual_contract_executability_review_rejected", {
        attempt,
        reasons: previousProblems.map((item) => `${item.path}: ${item.message}`),
      });
      continue;
    }

    const globalProblems = input.validateGlobal?.(applied.learningUnits) ?? [];
    if (globalProblems.length > 0) {
      previousProblems = cloneExact(globalProblems);
      previousResponse = exactResponse;
      attempts.push({
        ...attemptAudit,
        completedAt: new Date().toISOString(),
        accepted: false,
        ...auditResponse(exactResponse),
        rejectionReasons: cloneExact(previousProblems),
      });
      input.onEvent?.("visual_contract_executability_review_rejected", {
        attempt,
        reasons: previousProblems.map((item) => `${item.path}: ${item.message}`),
      });
      continue;
    }

    let plan: TPlan;
    try {
      plan = input.validateAll(applied.learningUnits);
    } catch (error) {
      previousProblems = [{
        code: "global_contract_validation_failed",
        path: "whole_garden",
        message: error instanceof Error ? error.message : String(error),
      }];
      previousResponse = exactResponse;
      attempts.push({
        ...attemptAudit,
        completedAt: new Date().toISOString(),
        accepted: false,
        ...auditResponse(exactResponse),
        rejectionReasons: cloneExact(previousProblems),
      });
      input.onEvent?.("visual_contract_executability_review_rejected", {
        attempt,
        reasons: previousProblems.map((item) => `${item.path}: ${item.message}`),
      });
      continue;
    }

    attempts.push({
      ...attemptAudit,
      completedAt: new Date().toISOString(),
      accepted: true,
      ...auditResponse(exactResponse),
      rejectionReasons: [],
    });
    const approvedUnitIds = parsed.response.reviews
      .filter((review) => review.verdict === "approve")
      .map((review) => review.unitId);
    const reviewedContracts = Object.fromEntries(
      applied.learningUnits
        .filter((unit) => activeRequirement(unit))
        .map((unit) => [unit.id, completeVisualContractForUnit(unit)]),
    );
    input.onEvent?.("visual_contract_executability_review_completed", {
      calls: attempt,
      rejectedReviews: attempt - 1,
      approvedUnitIds,
      replacedUnitIds: applied.replacedUnitIds,
    });
    return {
      learningUnits: applied.learningUnits,
      plan,
      calls: attempt,
      rejectedReviews: attempt - 1,
      approvedUnitIds,
      replacedUnitIds: applied.replacedUnitIds,
      acceptedResponse: parsed.response,
      attempts,
      beforeContracts,
      reviewedContracts,
      wholeGardenConstraints: input.wholeGardenConstraints
        ? cloneExact(input.wholeGardenConstraints)
        : null,
    };
  }

  input.onEvent?.("visual_contract_executability_review_exhausted", {
    calls: maxCalls,
    unitIds: activeUnitIds,
    reasons: previousProblems.map((item) => `${item.path}: ${item.message}`),
  });
  throw new VisualContractExecutabilityReviewError({
    calls: maxCalls,
    problems: previousProblems,
    lastResponse: previousResponse,
  });
}

export async function reviewVisualizationPlanExecutability(input: {
  gardenId: string;
  learningMap: ProposedLearningMap;
  learningUnits: LearningUnitContract[];
  initialPlan: VisualizationPlan;
  canonicalEvidenceByUnit: VisualizationCanonicalEvidenceByUnit;
  provider: VisualContractExecutabilityProvider;
  maximumRepeatedInteractionSignature: number;
  maxCalls?: number;
  checkCancelled?: () => void;
  onEvent?: (type: string, data: Record<string, unknown>) => void;
}): Promise<VisualContractExecutabilityRunResult<VisualizationPlan>> {
  if (input.initialPlan.gardenId !== input.gardenId) {
    throw new Error(
      `Initial visualization plan garden ${input.initialPlan.gardenId} does not match ${input.gardenId}.`,
    );
  }
  const wholeGardenConstraints: VisualContractExecutabilityWholeGardenConstraints = {
    unitOrder: input.learningUnits.map((unit) => unit.id),
    sectionByUnit: Object.fromEntries(input.learningUnits.flatMap((unit) =>
      unit.sectionPlan?.id ? [[unit.id, unit.sectionPlan.id]] : [])),
    maximumRepeatedInteractionSignature: input.maximumRepeatedInteractionSignature,
    targetMinimum: input.initialPlan.visualBudget.targetMinimum,
    targetMaximum: input.initialPlan.visualBudget.targetMaximum,
    maximumPerSection: input.initialPlan.visualBudget.maximumPerSection,
    minimumUnitsBetweenSimilarVisuals:
      input.initialPlan.visualBudget.minimumUnitsBetweenSimilarVisuals,
    requiredVisuals: input.initialPlan.visualBudget.requiredVisuals,
    recommendedVisuals: input.initialPlan.visualBudget.recommendedVisuals,
    optionalVisuals: input.initialPlan.visualBudget.optionalVisuals,
  };
  return runVisualContractExecutabilityReview({
    gardenId: input.gardenId,
    learningUnits: input.learningUnits,
    canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
    wholeGardenConstraints,
    provider: input.provider,
    ...(input.maxCalls !== undefined ? { maxCalls: input.maxCalls } : {}),
    ...(input.checkCancelled ? { checkCancelled: input.checkCancelled } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    validateGlobal: (learningUnits) => reviewedWholeGardenConstraintProblems({
      beforeUnits: input.learningUnits,
      reviewedUnits: learningUnits,
      constraints: wholeGardenConstraints,
    }),
    validateAll: (learningUnits) => buildVisualizationPlan({
      gardenId: input.gardenId,
      learningMap: input.learningMap,
      learningUnits,
      visualBudget: input.initialPlan.visualBudget,
      canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
      necessityReviewCalls: input.initialPlan.necessityReviewCalls,
      rejectedNecessityReviews: input.initialPlan.rejectedNecessityReviews,
      visualDecisionOverrides: input.initialPlan.visualDecisionOverrides,
    }),
  });
}

/** Reproject the authoritative plan after the existing mechanical renderer/type routing step. */
export function buildFinalVisualizationPlanFromRoutedContracts(input: {
  gardenId: string;
  learningMap: ProposedLearningMap;
  finalRoutedLearningUnits: LearningUnitContract[];
  reviewedPlan: VisualizationPlan;
  canonicalEvidenceByUnit: VisualizationCanonicalEvidenceByUnit;
}): VisualizationPlan {
  return buildVisualizationPlan({
    gardenId: input.gardenId,
    learningMap: input.learningMap,
    learningUnits: input.finalRoutedLearningUnits,
    visualBudget: input.reviewedPlan.visualBudget,
    canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
    necessityReviewCalls: input.reviewedPlan.necessityReviewCalls,
    rejectedNecessityReviews: input.reviewedPlan.rejectedNecessityReviews,
    visualDecisionOverrides: input.reviewedPlan.visualDecisionOverrides,
  });
}

export interface VisualContractExecutabilityLedgerContext {
  phase: "planning" | "generation";
  jobId: string;
  model: string;
  learningMapId?: string;
  textbookVersionId?: string;
}

export interface VisualContractExecutabilityLedger {
  schemaVersion: typeof VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION;
  gardenId: string;
  generatedAt: string;
  context: VisualContractExecutabilityLedgerContext;
  scope: "current_phase_only_generation_replaces_planning_ledger";
  technicalCapabilities: {
    manifestVersion: typeof GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION;
    manifestHash: string;
    sdkVersion: string;
  };
  auditHashing: {
    algorithm: "sha256";
    serialization: "JSON.stringify_utf8_v1";
    responseSchemaHash: string;
  };
  callAccounting: {
    semanticCalls: number;
    providerInvocationsAtSemanticBoundary: number;
    transportAttempts: "not_observable_below_provider_boundary";
  };
  rejectedReviews: number;
  wholeGardenConstraints: VisualContractExecutabilityWholeGardenConstraints;
  authoritativePlanPolicy: {
    visualBudget: VisualizationPlan["visualBudget"];
    visualDecisionOverrides: VisualizationPlan["visualDecisionOverrides"];
    necessityReviewCalls: number;
    rejectedNecessityReviews: number;
  };
  structuralContractRepair: {
    source: "none" | "model";
    attempts: VisualizationContractRepairAttempt[];
    acceptedResponse?: unknown;
  };
  artifactProvenance: {
    visualNecessityDecisionSource: {
      path: typeof VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH;
      decisionRecordsPath: typeof VISUAL_DECISION_RECORDS_RELATIVE_PATH;
      role: "pre_executability_model_necessity_and_teaching_medium_source";
      finalInteractionContractsMayDiffer: true;
    };
    authoritativeFinalLearningUnitContract: {
      path: typeof LEARNING_UNIT_CONTRACT_RELATIVE_PATH;
      role: "authoritative_final_interaction_contract";
    };
    authoritativeVisualizationPlan: {
      path: typeof VISUALIZATION_PLAN_RELATIVE_PATH;
      role: "authoritative_final_routing_projection";
    };
    reviewLedger: {
      path: typeof VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH;
      role: "exact_model_review_and_replacement_audit";
    };
  };
  attempts: VisualContractExecutabilityAttempt[];
  units: Array<{
    unitId: string;
    necessity: ActiveRequirement;
    requirement: ActiveRequirement;
    acceptedReview: VisualContractExecutabilityReview;
    beforeReviewContract: CompleteVisualizationContractUnitRepair;
    reviewedContractBeforeMechanicalRouting: CompleteVisualizationContractUnitRepair;
    finalRoutedContract: CompleteVisualizationContractUnitRepair;
    mechanicalRouting: {
      opportunityId: string;
      decision: VisualizationRouteDecision;
      reviewedRecommendedVisualType: string | null;
      projectedVisualType: string;
    };
  }>;
  /** SHA-256 over every preceding ledger field using auditHashing.serialization. */
  integrityHash: string;
}

function visualContractExecutabilityLedgerIntegrityHash(
  ledger: Omit<VisualContractExecutabilityLedger, "integrityHash"> | VisualContractExecutabilityLedger,
): string {
  const { integrityHash: _integrityHash, ...payload } = ledger as VisualContractExecutabilityLedger;
  return sha256Json(payload);
}

function opportunityInputsForContract(
  contract: CompleteVisualizationContractUnitRepair,
): Array<Record<string, unknown>> {
  return contract.controls.map((control) => ({
    id: control.id,
    label: control.label,
    type: control.type,
    ...(control.unit !== undefined ? { unit: control.unit } : {}),
    ...(control.min !== undefined ? { min: control.min } : {}),
    ...(control.max !== undefined ? { max: control.max } : {}),
    ...(control.step !== undefined ? { step: control.step } : {}),
    ...(control.options !== undefined ? { options: [...control.options] } : {}),
    defaultValue: control.defaultValue,
  }));
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function exactKeySet(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function visualContractExecutabilityLedgerEnvelopeProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ["executability ledger must be an object"];
  if (!exactKeySet(value, [
    "schemaVersion",
    "gardenId",
    "generatedAt",
    "context",
    "scope",
    "technicalCapabilities",
    "auditHashing",
    "callAccounting",
    "rejectedReviews",
    "wholeGardenConstraints",
    "authoritativePlanPolicy",
    "structuralContractRepair",
    "artifactProvenance",
    "attempts",
    "units",
    "integrityHash",
  ])) {
    problems.push("executability ledger top-level fields are missing or unexpected");
  }
  if (value.schemaVersion !== VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION) {
    problems.push("executability ledger schemaVersion is invalid");
  }
  if (!compact(value.gardenId)) problems.push("executability ledger gardenId is missing");
  if (!isIsoTimestamp(value.generatedAt)) problems.push("executability ledger generatedAt is invalid");
  if (
    !isRecord(value.callAccounting) ||
    !exactKeySet(value.callAccounting, [
      "semanticCalls",
      "providerInvocationsAtSemanticBoundary",
      "transportAttempts",
    ]) ||
    !Number.isInteger(value.callAccounting.semanticCalls) ||
    Number(value.callAccounting.semanticCalls) < 0 ||
    value.callAccounting.providerInvocationsAtSemanticBoundary !==
      value.callAccounting.semanticCalls ||
    value.callAccounting.transportAttempts !== "not_observable_below_provider_boundary"
  ) {
    problems.push("executability ledger semantic/transport call accounting is invalid");
  }
  if (!Number.isInteger(value.rejectedReviews) || Number(value.rejectedReviews) < 0) {
    problems.push("executability ledger rejectedReviews is invalid");
  }
  if (
    !isRecord(value.wholeGardenConstraints) ||
    !exactKeySet(value.wholeGardenConstraints, [
      "unitOrder",
      "sectionByUnit",
      "maximumRepeatedInteractionSignature",
      "targetMinimum",
      "targetMaximum",
      "maximumPerSection",
      "minimumUnitsBetweenSimilarVisuals",
      "requiredVisuals",
      "recommendedVisuals",
      "optionalVisuals",
    ]) ||
    !Array.isArray(value.wholeGardenConstraints.unitOrder) ||
    !isRecord(value.wholeGardenConstraints.sectionByUnit) ||
    [
      "maximumRepeatedInteractionSignature",
      "targetMinimum",
      "targetMaximum",
      "maximumPerSection",
      "minimumUnitsBetweenSimilarVisuals",
      "requiredVisuals",
      "recommendedVisuals",
      "optionalVisuals",
    ].some((field) =>
      !Number.isInteger((value.wholeGardenConstraints as Record<string, unknown>)[field]) ||
      Number((value.wholeGardenConstraints as Record<string, unknown>)[field]) < 0)
  ) {
    problems.push("executability ledger whole-garden constraints are invalid");
  }
  if (
    !isRecord(value.authoritativePlanPolicy) ||
    !exactKeySet(value.authoritativePlanPolicy, [
      "visualBudget",
      "visualDecisionOverrides",
      "necessityReviewCalls",
      "rejectedNecessityReviews",
    ]) ||
    !isRecord(value.authoritativePlanPolicy.visualBudget) ||
    !Array.isArray(value.authoritativePlanPolicy.visualDecisionOverrides)
  ) {
    problems.push("executability ledger authoritative plan policy is invalid");
  }
  if (!Array.isArray(value.attempts)) problems.push("executability ledger attempts must be an array");
  if (!Array.isArray(value.units)) problems.push("executability ledger units must be an array");
  if (value.scope !== "current_phase_only_generation_replaces_planning_ledger") {
    problems.push("executability ledger scope is invalid");
  }
  if (!isRecord(value.context) || !exactKeySet(value.context, [
    "phase",
    "jobId",
    "model",
    ...(Object.prototype.hasOwnProperty.call(value.context ?? {}, "learningMapId")
      ? ["learningMapId"]
      : []),
    ...(Object.prototype.hasOwnProperty.call(value.context ?? {}, "textbookVersionId")
      ? ["textbookVersionId"]
      : []),
  ])) {
    problems.push("executability ledger context fields are invalid");
  } else {
    if (value.context.phase !== "planning" && value.context.phase !== "generation") {
      problems.push("executability ledger context.phase is invalid");
    }
    if (!compact(value.context.jobId)) problems.push("executability ledger context.jobId is missing");
    if (!compact(value.context.model)) problems.push("executability ledger context.model is missing");
  }
  if (
    !isRecord(value.technicalCapabilities) ||
    !exactKeySet(value.technicalCapabilities, ["manifestVersion", "manifestHash", "sdkVersion"])
  ) {
    problems.push("executability ledger technical capability fields are invalid");
  }
  if (
    !isRecord(value.auditHashing) ||
    !exactKeySet(value.auditHashing, ["algorithm", "serialization", "responseSchemaHash"]) ||
    value.auditHashing.algorithm !== "sha256" ||
    value.auditHashing.serialization !== "JSON.stringify_utf8_v1" ||
    value.auditHashing.responseSchemaHash !== VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA_HASH
  ) {
    problems.push("executability ledger audit hashing contract is invalid");
  }
  if (!isRecord(value.structuralContractRepair)) {
    problems.push("executability ledger structural repair audit is invalid");
  } else if (
    !exactKeySet(value.structuralContractRepair, [
      "source",
      "attempts",
      ...(Object.prototype.hasOwnProperty.call(value.structuralContractRepair, "acceptedResponse")
        ? ["acceptedResponse"]
        : []),
    ]) ||
    !Array.isArray(value.structuralContractRepair.attempts)
  ) {
    problems.push("executability ledger structural repair fields are invalid");
  } else {
    value.structuralContractRepair.attempts.forEach((attempt, index) => {
      if (
        !isRecord(attempt) ||
        !exactKeySet(attempt, [
          "attempt",
          "accepted",
          "responseEncoding",
          "response",
          "rejectionReasons",
          "appliedUnitIds",
        ]) ||
        !Array.isArray(attempt.rejectionReasons) ||
        !Array.isArray(attempt.appliedUnitIds)
      ) {
        problems.push(`executability ledger structural repair attempt ${index + 1} fields are invalid`);
      }
    });
  }
  if (!isRecord(value.artifactProvenance)) {
    problems.push("executability ledger artifact provenance is invalid");
  }
  if (Array.isArray(value.attempts)) {
    value.attempts.forEach((attempt, index) => {
      if (
        !isRecord(attempt) ||
        !exactKeySet(attempt, [
          "attempt",
          "startedAt",
          "completedAt",
          "requestHash",
          "packetHash",
          "systemPromptHash",
          "responseSchemaHash",
          "canonicalEvidenceHashes",
          "wholeGardenConstraintsHash",
          "transportAccounting",
          "accepted",
          "responseEncoding",
          "response",
          "rejectionReasons",
        ]) ||
        !isRecord(attempt.canonicalEvidenceHashes) ||
        !isRecord(attempt.transportAccounting) ||
        !Array.isArray(attempt.rejectionReasons)
      ) {
        problems.push(`executability ledger attempt ${index + 1} fields are invalid`);
      }
    });
  }
  if (Array.isArray(value.units)) {
    value.units.forEach((unit, index) => {
      if (
        !isRecord(unit) ||
        !exactKeySet(unit, [
          "unitId",
          "necessity",
          "requirement",
          "acceptedReview",
          "beforeReviewContract",
          "reviewedContractBeforeMechanicalRouting",
          "finalRoutedContract",
          "mechanicalRouting",
        ]) ||
        !isRecord(unit.acceptedReview) ||
        !isRecord(unit.beforeReviewContract) ||
        !isRecord(unit.reviewedContractBeforeMechanicalRouting) ||
        !isRecord(unit.finalRoutedContract) ||
        !isRecord(unit.mechanicalRouting)
      ) {
        problems.push(`executability ledger unit ${index + 1} fields are invalid`);
      }
    });
  }
  if (!SHA256_HEX_PATTERN.test(String(value.integrityHash ?? ""))) {
    problems.push("executability ledger integrityHash is invalid");
  } else if (
    visualContractExecutabilityLedgerIntegrityHash(
      value as unknown as VisualContractExecutabilityLedger,
    ) !== value.integrityHash
  ) {
    problems.push("executability ledger integrityHash does not match its contents");
  }
  return problems;
}

export function visualContractExecutabilityLinkageProblems(input: {
  gardenId: string;
  ledger: VisualContractExecutabilityLedger | null;
  finalLearningUnits: LearningUnitContract[];
  visualizationPlan: VisualizationPlan | null;
  requireGenerationPhase?: boolean;
}): string[] {
  const problems: string[] = [];
  const ledger = input.ledger;
  const plan = input.visualizationPlan;
  if (!ledger) return ["visual-contract executability review ledger is missing or invalid"];
  if (!plan) return ["authoritative visualization plan is missing or invalid"];
  const envelopeProblems = visualContractExecutabilityLedgerEnvelopeProblems(ledger);
  if (envelopeProblems.length > 0) return [...new Set(envelopeProblems)];
  if (ledger.gardenId !== input.gardenId) {
    problems.push(`executability ledger gardenId ${ledger.gardenId} differs from ${input.gardenId}`);
  }
  if (plan.gardenId !== input.gardenId) {
    problems.push(`visualization plan gardenId ${plan.gardenId} differs from ${input.gardenId}`);
  }
  if (input.requireGenerationPhase && ledger.context.phase !== "generation") {
    problems.push(`executability ledger phase is ${ledger.context.phase}, expected generation`);
  }
  if (ledger.scope !== "current_phase_only_generation_replaces_planning_ledger") {
    problems.push("executability ledger scope is missing or invalid");
  }
  if (
    ledger.technicalCapabilities?.manifestVersion !== GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION ||
    ledger.technicalCapabilities?.manifestHash !== GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH ||
    ledger.technicalCapabilities?.sdkVersion !== GENERATED_VISUAL_CAPABILITY_MANIFEST.sdkVersion
  ) {
    problems.push("executability ledger technical capability version/hash is stale");
  }
  if (
    ledger.artifactProvenance?.visualNecessityDecisionSource?.path !==
      VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH ||
    ledger.artifactProvenance?.visualNecessityDecisionSource?.decisionRecordsPath !==
      VISUAL_DECISION_RECORDS_RELATIVE_PATH ||
    ledger.artifactProvenance?.visualNecessityDecisionSource?.role !==
      "pre_executability_model_necessity_and_teaching_medium_source" ||
    ledger.artifactProvenance?.visualNecessityDecisionSource?.finalInteractionContractsMayDiffer !== true ||
    ledger.artifactProvenance?.authoritativeFinalLearningUnitContract?.path !==
      LEARNING_UNIT_CONTRACT_RELATIVE_PATH ||
    ledger.artifactProvenance?.authoritativeVisualizationPlan?.path !==
      VISUALIZATION_PLAN_RELATIVE_PATH ||
    ledger.artifactProvenance?.reviewLedger?.path !==
      VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH
  ) {
    problems.push("executability ledger artifact provenance is missing or invalid");
  }
  const malformedPlanItems = [
    ...(!Array.isArray(plan.opportunities)
      ? ["visualization plan opportunities must be an array"]
      : plan.opportunities.flatMap((item, index) =>
          !isRecord(item) ||
          !compact(item.id) ||
          !compact(item.learningUnitId) ||
          !Array.isArray(item.requiredInputs) ||
          !Array.isArray(item.requiredOutputs) ||
          !isRecord(item.necessityDecision)
            ? [`visualization plan opportunity ${index + 1} is malformed`]
            : [])),
    ...(!Array.isArray(plan.decisions)
      ? ["visualization plan decisions must be an array"]
      : plan.decisions.flatMap((item, index) =>
          !isRecord(item) || !compact(item.opportunityId) || !compact(item.route)
            ? [`visualization plan route decision ${index + 1} is malformed`]
            : [])),
    ...(!Array.isArray(plan.visualNecessityDecisions) ||
    plan.visualNecessityDecisions.some((item) => !isRecord(item))
      ? ["visualization plan necessity decisions are malformed"]
      : []),
    ...(!Array.isArray(plan.teachingMedia) || plan.teachingMedia.some((item) => !isRecord(item))
      ? ["visualization plan teaching media are malformed"]
      : []),
    ...(!isRecord(plan.visualBudget)
      ? ["visualization plan visualBudget is malformed"]
      : []),
  ];
  if (malformedPlanItems.length > 0) {
    return [...new Set([...problems, ...malformedPlanItems])];
  }

  const activeUnits = input.finalLearningUnits.filter((unit) => activeRequirement(unit));
  const activeIds = activeUnits.map((unit) => unit.id);
  const finalPlanPolicy = {
    visualBudget: plan.visualBudget,
    visualDecisionOverrides: plan.visualDecisionOverrides,
    necessityReviewCalls: plan.necessityReviewCalls,
    rejectedNecessityReviews: plan.rejectedNecessityReviews,
  };
  if (!isDeepStrictEqual(ledger.authoritativePlanPolicy, finalPlanPolicy)) {
    problems.push("visualization plan budget, overrides, or necessity-review counters differ from the ledger");
  }
  const constraintBudgetProjection = {
    targetMinimum: ledger.wholeGardenConstraints.targetMinimum,
    targetMaximum: ledger.wholeGardenConstraints.targetMaximum,
    maximumPerSection: ledger.wholeGardenConstraints.maximumPerSection,
    minimumUnitsBetweenSimilarVisuals:
      ledger.wholeGardenConstraints.minimumUnitsBetweenSimilarVisuals,
    requiredVisuals: ledger.wholeGardenConstraints.requiredVisuals,
    recommendedVisuals: ledger.wholeGardenConstraints.recommendedVisuals,
    optionalVisuals: ledger.wholeGardenConstraints.optionalVisuals,
  };
  for (const [field, expected] of Object.entries(constraintBudgetProjection)) {
    if (plan.visualBudget[field as keyof typeof constraintBudgetProjection] !== expected) {
      problems.push(`visualization plan visualBudget.${field} differs from reviewed whole-garden constraints`);
    }
  }
  problems.push(...reviewedWholeGardenConstraintProblems({
    beforeUnits: input.finalLearningUnits,
    reviewedUnits: input.finalLearningUnits,
    constraints: ledger.wholeGardenConstraints,
  }).map((item) => `${item.path}: ${item.message}`));
  const ledgerIds = ledger.units.map((unit) => unit.unitId);
  if (!isDeepStrictEqual(ledgerIds, activeIds)) {
    problems.push("executability ledger units do not exactly match active final learning units in order");
  }
  if (new Set(ledgerIds).size !== ledgerIds.length) {
    problems.push("executability ledger contains duplicate unit records");
  }
  if (ledger.callAccounting.semanticCalls !== ledger.attempts.length) {
    problems.push("executability ledger semanticCalls does not equal its persisted attempt count");
  }
  if (
    ledger.callAccounting.semanticCalls >
    VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET.maximumTotalCalls
  ) {
    problems.push("executability ledger exceeds the bounded semantic model-call budget");
  }
  const acceptedAttempts = ledger.attempts.filter((attempt) => attempt.accepted);
  const rejectedAttempts = ledger.attempts.filter((attempt) => !attempt.accepted);
  if (ledger.rejectedReviews !== rejectedAttempts.length) {
    problems.push("executability ledger rejectedReviews does not equal its rejected attempt count");
  }
  if (activeIds.length === 0) {
    if (ledger.callAccounting.semanticCalls !== 0 || acceptedAttempts.length !== 0) {
      problems.push("executability ledger recorded model calls despite having no active units");
    }
  } else if (
    acceptedAttempts.length !== 1 ||
    !ledger.attempts.at(-1)?.accepted
  ) {
    problems.push("executability ledger must end with exactly one accepted semantic review attempt");
  }
  ledger.attempts.forEach((attempt, index) => {
    const expectedAttempt = index + 1;
    if (
      attempt.attempt !== expectedAttempt ||
      attempt.transportAccounting?.logicalSemanticCall !== expectedAttempt ||
      attempt.transportAccounting?.providerInvocationsAtThisBoundary !== 1 ||
      attempt.transportAccounting?.transportRetries !==
        "owned_below_semantic_boundary_not_counted"
    ) {
      problems.push(`executability ledger attempt ${expectedAttempt} has invalid logical/transport accounting`);
    }
    if (
      !isIsoTimestamp(attempt.startedAt) ||
      !isIsoTimestamp(attempt.completedAt) ||
      (isIsoTimestamp(attempt.startedAt) &&
        isIsoTimestamp(attempt.completedAt) &&
        Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt))
    ) {
      problems.push(`executability ledger attempt ${expectedAttempt} has invalid timestamps`);
    }
    for (const [field, hash] of [
      ["requestHash", attempt.requestHash],
      ["packetHash", attempt.packetHash],
      ["systemPromptHash", attempt.systemPromptHash],
      ["responseSchemaHash", attempt.responseSchemaHash],
    ] as const) {
      if (!SHA256_HEX_PATTERN.test(hash)) {
        problems.push(`executability ledger attempt ${expectedAttempt} ${field} is invalid`);
      }
    }
    if (attempt.systemPromptHash !== sha256Text(visualContractExecutabilitySystemPrompt())) {
      problems.push(`executability ledger attempt ${expectedAttempt} systemPromptHash is stale`);
    }
    if (attempt.responseSchemaHash !== VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA_HASH) {
      problems.push(`executability ledger attempt ${expectedAttempt} responseSchemaHash is stale`);
    }
    if (!SHA256_HEX_PATTERN.test(String(attempt.wholeGardenConstraintsHash ?? ""))) {
      problems.push(`executability ledger attempt ${expectedAttempt} lacks a whole-garden constraints hash`);
    } else if (
      attempt.wholeGardenConstraintsHash !== sha256Json(ledger.wholeGardenConstraints)
    ) {
      problems.push(`executability ledger attempt ${expectedAttempt} whole-garden constraints hash is stale`);
    }
    const evidenceIds = Object.keys(attempt.canonicalEvidenceHashes ?? {});
    if (!isDeepStrictEqual(evidenceIds, activeIds)) {
      problems.push(`executability ledger attempt ${expectedAttempt} evidence hashes do not cover every active unit in order`);
    }
    for (const [unitId, hash] of Object.entries(attempt.canonicalEvidenceHashes ?? {})) {
      if (!SHA256_HEX_PATTERN.test(hash)) {
        problems.push(`executability ledger attempt ${expectedAttempt} has invalid evidence hash for ${unitId}`);
      }
    }
    if (attempt.accepted && attempt.rejectionReasons.length !== 0) {
      problems.push(`executability ledger accepted attempt ${expectedAttempt} contains rejection reasons`);
    }
    if (!attempt.accepted && attempt.rejectionReasons.length === 0) {
      problems.push(`executability ledger rejected attempt ${expectedAttempt} has no exact rejection reasons`);
    }
    if (
      (attempt.responseEncoding !== "json" && attempt.responseEncoding !== "undefined") ||
      (attempt.responseEncoding === "undefined" && attempt.response !== null) ||
      (attempt.accepted && attempt.responseEncoding !== "json")
    ) {
      problems.push(`executability ledger attempt ${expectedAttempt} response encoding is invalid`);
    }
  });

  if (acceptedAttempts.length === 1) {
    const acceptedParsed = parseVisualContractExecutabilityResponse({
      value: acceptedAttempts[0].response,
      gardenId: input.gardenId,
      activeUnitIds: activeIds,
    });
    if (!acceptedParsed.ok) {
      problems.push("executability ledger accepted attempt no longer contains a valid exact response");
    } else if (!isDeepStrictEqual(
      acceptedParsed.response.reviews,
      ledger.units.map((unit) => unit.acceptedReview),
    )) {
      problems.push("executability ledger unit verdicts differ from the accepted exact response");
    }
  }

  const structuralRepair = ledger.structuralContractRepair;
  if (
    structuralRepair?.source !== "none" &&
    structuralRepair?.source !== "model"
  ) {
    problems.push("executability ledger structural repair source is invalid");
  } else if (structuralRepair.source === "none") {
    if (structuralRepair.attempts.length !== 0 || structuralRepair.acceptedResponse !== undefined) {
      problems.push("executability ledger claims no structural repair but contains repair attempts");
    }
  } else {
    const structuralAccepted = structuralRepair.attempts.filter((attempt) => attempt.accepted);
    const acceptedStructuralAttempt = structuralAccepted[0];
    if (
      structuralRepair.attempts.length === 0 ||
      structuralAccepted.length !== 1 ||
      !structuralRepair.attempts.at(-1)?.accepted ||
      acceptedStructuralAttempt?.responseEncoding !== "json" ||
      !isDeepStrictEqual(
        acceptedStructuralAttempt?.response,
        structuralRepair.acceptedResponse,
      )
    ) {
      problems.push("executability ledger structural repair audit lacks one exact terminal accepted response");
    }
    structuralRepair.attempts.forEach((attempt, index) => {
      if (attempt.attempt !== index + 1) {
        problems.push("executability ledger structural repair attempt numbering is invalid");
      }
      if (!attempt.accepted && attempt.rejectionReasons.length === 0) {
        problems.push(`executability ledger structural repair attempt ${index + 1} lacks rejection reasons`);
      }
      if (
        (attempt.responseEncoding !== "json" && attempt.responseEncoding !== "undefined") ||
        (attempt.responseEncoding === "undefined" && attempt.response !== null) ||
        (attempt.accepted && attempt.responseEncoding !== "json")
      ) {
        problems.push(`executability ledger structural repair attempt ${index + 1} has invalid response encoding`);
      }
    });
    if ((acceptedStructuralAttempt?.appliedUnitIds.length ?? 0) === 0) {
      problems.push("executability ledger accepted structural repair has no applied unit ids");
    } else {
      const parsedStructuralRepair = parseVisualizationContractRepairResponse(
        structuralRepair.acceptedResponse,
        { requireCompleteContract: true },
      );
      if (parsedStructuralRepair.problems.length > 0) {
        problems.push("executability ledger accepted structural repair response is malformed");
      } else {
        const repairIds = parsedStructuralRepair.repairs.map((repair) => repair.unitId);
        if (
          new Set(repairIds).size !== repairIds.length ||
          new Set(acceptedStructuralAttempt!.appliedUnitIds).size !==
            acceptedStructuralAttempt!.appliedUnitIds.length ||
          repairIds.length !== acceptedStructuralAttempt!.appliedUnitIds.length ||
          repairIds.some((unitId) => !acceptedStructuralAttempt!.appliedUnitIds.includes(unitId))
        ) {
          problems.push("executability ledger structural repair ids differ from its applied unit ids");
        }
        const ledgerUnitById = new Map(ledger.units.map((unit) => [unit.unitId, unit]));
        for (const repair of parsedStructuralRepair.repairs) {
          const ledgerUnit = ledgerUnitById.get(repair.unitId);
          if (
            !ledgerUnit ||
            !isDeepStrictEqual(ledgerUnit.beforeReviewContract, repair)
          ) {
            problems.push(
              `${repair.unitId}: structural repair does not exactly explain the contract presented to executability review`,
            );
          }
        }
      }
    }
  }

  const opportunityIds = plan.opportunities.map((item) => item.id);
  const routeOpportunityIds = plan.decisions.map((item) => item.opportunityId);
  if (
    new Set(opportunityIds).size !== opportunityIds.length ||
    !isDeepStrictEqual(routeOpportunityIds, opportunityIds)
  ) {
    problems.push("visualization plan must contain exactly one ordered route decision per opportunity");
  }
  const opportunityUnitIds = plan.opportunities.map((item) => item.learningUnitId);
  if (!isDeepStrictEqual(opportunityUnitIds, activeIds)) {
    problems.push("visualization plan opportunities do not exactly cover active learning units in order");
  }
  const expectedNecessityDecisions = input.finalLearningUnits.map(
    (unit) => unit.interactiveVisualPlan?.decision,
  );
  if (!isDeepStrictEqual(plan.visualNecessityDecisions, expectedNecessityDecisions)) {
    problems.push("visualization-plan necessity decisions are not the exact final Learning Unit Contract projection");
  }
  const expectedTeachingMedia = input.finalLearningUnits.map((unit) => unit.teachingMediumPlan);
  if (!isDeepStrictEqual(plan.teachingMedia, expectedTeachingMedia)) {
    problems.push("visualization-plan teaching media are not the exact final Learning Unit Contract projection");
  }
  const opportunityByUnit = new Map(plan.opportunities.map((item) => [item.learningUnitId, item]));
  const routeByOpportunity = new Map(plan.decisions.map((item) => [item.opportunityId, item]));
  const necessityByUnit = new Map(plan.visualNecessityDecisions.map((item) => [item.unitId, item]));
  const ledgerByUnit = new Map(ledger.units.map((item) => [item.unitId, item]));

  for (const unit of activeUnits) {
    let finalContract: CompleteVisualizationContractUnitRepair;
    try {
      finalContract = completeVisualContractForUnit(unit);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const ledgerUnit = ledgerByUnit.get(unit.id);
    if (!ledgerUnit) {
      problems.push(`${unit.id}: executability ledger record is missing`);
      continue;
    }
    if (!isDeepStrictEqual(ledgerUnit.finalRoutedContract, finalContract)) {
      problems.push(`${unit.id}: ledger finalRoutedContract differs from the final Learning Unit Contract`);
    }
    if (
      ledgerUnit.necessity !== unit.interactiveVisualPlan?.decision.necessity ||
      ledgerUnit.requirement !== unit.interactiveVisualPlan?.requirement
    ) {
      problems.push(`${unit.id}: ledger changed immutable necessity or requirement`);
    }
    if (ledgerUnit.acceptedReview?.unitId !== unit.id) {
      problems.push(`${unit.id}: accepted review unitId differs from its ledger unit`);
    }
    if (
      ledgerUnit.acceptedReview?.verdict === "replace" &&
      ledgerUnit.acceptedReview.replacement?.unitId !== unit.id
    ) {
      problems.push(`${unit.id}: accepted replacement unitId differs from its ledger unit`);
    }
    const acceptedVerdict = ledgerUnit.acceptedReview?.verdict;
    if (acceptedVerdict === "approve") {
      if (
        !isDeepStrictEqual(
          ledgerUnit.reviewedContractBeforeMechanicalRouting,
          ledgerUnit.beforeReviewContract,
        )
      ) {
        problems.push(`${unit.id}: approved contract changed before routing`);
      }
    } else if (acceptedVerdict === "replace") {
      if (!isDeepStrictEqual(
        ledgerUnit.reviewedContractBeforeMechanicalRouting,
        ledgerUnit.acceptedReview.replacement,
      )) {
        problems.push(`${unit.id}: reviewed contract is not the exact accepted model replacement`);
      }
    } else {
      problems.push(`${unit.id}: accepted review verdict is invalid`);
    }

    const routing = ledgerUnit.mechanicalRouting;
    const opportunityForRoute = opportunityByUnit.get(unit.id);
    const planRoute = opportunityForRoute
      ? routeByOpportunity.get(opportunityForRoute.id)
      : undefined;
    if (!routing || !opportunityForRoute || !planRoute) {
      problems.push(`${unit.id}: mechanical routing provenance is incomplete`);
    } else {
      if (
        routing.opportunityId !== opportunityForRoute.id ||
        !isDeepStrictEqual(routing.decision, planRoute)
      ) {
        problems.push(`${unit.id}: ledger mechanical route differs from the authoritative plan route`);
      }
      const reviewedDecision = {
        ...unit.interactiveVisualPlan!.decision,
        recommendedVisualType: routing.reviewedRecommendedVisualType ?? undefined,
      };
      const reviewedUnitForProjection: LearningUnitContract = {
        ...unit,
        interactiveVisual: ledgerUnit.reviewedContractBeforeMechanicalRouting.visualIntent,
        interactiveVisualPlan: {
          ...unit.interactiveVisualPlan!,
          decision: reviewedDecision,
          visualIntent: ledgerUnit.reviewedContractBeforeMechanicalRouting.visualIntent,
        },
      };
      const expectedVisualType = projectedVisualizationTypeForRoute({
        unit: reviewedUnitForProjection,
        route: planRoute,
      });
      if (
        !expectedVisualType ||
        routing.projectedVisualType !== expectedVisualType ||
        finalContract.visualIntent.visualType !== expectedVisualType
      ) {
        problems.push(`${unit.id}: final visualType differs from the chosen plan route projection`);
      }
      const onlyAllowedMechanicalDelta: CompleteVisualizationContractUnitRepair = {
        ...cloneExact(ledgerUnit.reviewedContractBeforeMechanicalRouting),
        visualIntent: {
          ...cloneExact(ledgerUnit.reviewedContractBeforeMechanicalRouting.visualIntent),
          visualType: routing.projectedVisualType,
        },
      };
      if (
        !isDeepStrictEqual(ledgerUnit.finalRoutedContract, onlyAllowedMechanicalDelta)
      ) {
        problems.push(
          `${unit.id}: final routed contract differs from reviewed contract beyond visualIntent.visualType`,
        );
      }
    }

    const opportunity = opportunityByUnit.get(unit.id);
    if (!opportunity) {
      problems.push(`${unit.id}: visualization plan opportunity is missing`);
    } else {
      if (opportunity.learnerQuestion !== unit.learningQuestion) {
        problems.push(`${unit.id}: opportunity learnerQuestion differs from the final contract unit`);
      }
      if (opportunity.requirement !== unit.interactiveVisualPlan?.requirement) {
        problems.push(`${unit.id}: opportunity requirement differs from the final contract`);
      }
      if (
        !isDeepStrictEqual(
          opportunity.necessityDecision,
          unit.interactiveVisualPlan?.decision,
        )
      ) {
        problems.push(`${unit.id}: opportunity necessityDecision differs from the final contract`);
      }
      if (opportunity.interactionGoal !== finalContract.interactionGoal) {
        problems.push(`${unit.id}: opportunity interactionGoal differs from the final contract`);
      }
      if (opportunity.learnerAction !== finalContract.learnerAction) {
        problems.push(`${unit.id}: opportunity learnerAction differs from the final contract`);
      }
      if (opportunity.learningObjective !== finalContract.expectedInsight) {
        problems.push(`${unit.id}: opportunity learningObjective differs from the final contract`);
      }
      if (
        opportunity.pedagogicalReason !==
        finalContract.visualIntent.whyStaticSourceFigureIsNotEnough
      ) {
        problems.push(`${unit.id}: opportunity pedagogicalReason differs from the final contract`);
      }
      if (
        !isDeepStrictEqual(
          opportunity.requiredInputs,
          opportunityInputsForContract(finalContract),
        )
      ) {
        problems.push(`${unit.id}: opportunity inputs differ from the final contract controls`);
      }
      const expectedOutputs = [{
        id: visualizationOpportunityFieldId(finalContract.observable.label, 0),
        label: finalContract.observable.label,
        representation: finalContract.observable.representation,
      }];
      if (!isDeepStrictEqual(opportunity.requiredOutputs, expectedOutputs)) {
        problems.push(`${unit.id}: opportunity output differs from the final contract observable`);
      }
    }
    if (
      !isDeepStrictEqual(
        necessityByUnit.get(unit.id),
        unit.interactiveVisualPlan?.decision,
      )
    ) {
      problems.push(`${unit.id}: visualization-plan necessity decision differs from the final synchronized decision.interaction`);
    }
    if (
      !isDeepStrictEqual(
        unit.interactiveVisualPlan?.decision.interaction,
        pedagogyContractFromCompleteRepair(finalContract),
      )
    ) {
      problems.push(`${unit.id}: final decision.interaction differs from the final interaction contract`);
    }
  }
  for (const opportunity of plan.opportunities) {
    if (!activeIds.includes(opportunity.learningUnitId)) {
      problems.push(`${opportunity.id}: visualization plan contains a non-active learning unit`);
    }
  }
  if (plan.opportunities.length !== activeUnits.length) {
    problems.push(
      `visualization plan has ${plan.opportunities.length} opportunities for ${activeUnits.length} active units`,
    );
  }
  return [...new Set(problems)];
}

export function visualContractExecutabilityLedgerPath(gardenDir: string): string {
  return path.join(gardenDir, ...VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH.split("/"));
}

export function buildVisualContractExecutabilityLedger(input: {
  gardenId: string;
  context: VisualContractExecutabilityLedgerContext;
  review: VisualContractExecutabilityRunResult<VisualizationPlan>;
  finalRoutedLearningUnits: LearningUnitContract[];
  finalVisualizationPlan: VisualizationPlan;
  structuralContractRepair: {
    source: "none" | "model";
    attempts: VisualizationContractRepairAttempt[];
    acceptedResponse?: unknown;
  };
  generatedAt?: string;
}): VisualContractExecutabilityLedger {
  if (!input.review.wholeGardenConstraints) {
    throw new Error(
      "Cannot persist visual-contract executability audit without whole-garden constraints.",
    );
  }
  const acceptedByUnit = new Map(
    (input.review.acceptedResponse?.reviews ?? []).map((review) => [review.unitId, review]),
  );
  const finalByUnit = new Map(input.finalRoutedLearningUnits.map((unit) => [unit.id, unit]));
  const reviewedByUnit = new Map(input.review.learningUnits.map((unit) => [unit.id, unit]));
  const units = Object.keys(input.review.beforeContracts).map((unitId) => {
    const review = acceptedByUnit.get(unitId);
    const finalUnit = finalByUnit.get(unitId);
    const reviewedUnit = reviewedByUnit.get(unitId);
    if (!review || !finalUnit || !reviewedUnit) {
      throw new Error(`Cannot persist visual-contract executability audit for missing unit ${unitId}.`);
    }
    const requirement = activeRequirement(finalUnit);
    const necessity = finalUnit.interactiveVisualPlan?.decision.necessity;
    if (!requirement || necessity !== requirement) {
      throw new Error(`Cannot persist visual-contract executability audit for inactive or changed unit ${unitId}.`);
    }
    const matchingOpportunities = input.finalVisualizationPlan.opportunities.filter(
      (opportunity) => opportunity.learningUnitId === unitId,
    );
    if (matchingOpportunities.length !== 1) {
      throw new Error(
        `Cannot persist visual-contract executability audit for ${unitId}: expected one routed opportunity, received ${matchingOpportunities.length}.`,
      );
    }
    const opportunity = matchingOpportunities[0];
    const matchingRoutes = input.finalVisualizationPlan.decisions.filter(
      (decision) => decision.opportunityId === opportunity.id,
    );
    if (matchingRoutes.length !== 1) {
      throw new Error(
        `Cannot persist visual-contract executability audit for ${unitId}: expected one route decision, received ${matchingRoutes.length}.`,
      );
    }
    const route = matchingRoutes[0];
    const projectedVisualType = projectedVisualizationTypeForRoute({ unit: reviewedUnit, route });
    if (!projectedVisualType) {
      throw new Error(
        `Cannot persist visual-contract executability audit for ${unitId}: active reviewed contract has no publishable mechanical route.`,
      );
    }
    const finalContract = completeVisualContractForUnit(finalUnit);
    if (finalContract.visualIntent.visualType !== projectedVisualType) {
      throw new Error(
        `Cannot persist visual-contract executability audit for ${unitId}: final visualType is not the selected mechanical route projection.`,
      );
    }
    return {
      unitId,
      necessity,
      requirement,
      acceptedReview: cloneExact(review),
      beforeReviewContract: cloneExact(input.review.beforeContracts[unitId]),
      reviewedContractBeforeMechanicalRouting: cloneExact(input.review.reviewedContracts[unitId]),
      finalRoutedContract: finalContract,
      mechanicalRouting: {
        opportunityId: opportunity.id,
        decision: cloneExact(route),
        reviewedRecommendedVisualType:
          reviewedUnit.interactiveVisualPlan?.decision.recommendedVisualType ?? null,
        projectedVisualType,
      },
    };
  });
  const ledgerWithoutIntegrity: Omit<VisualContractExecutabilityLedger, "integrityHash"> = {
    schemaVersion: VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION,
    gardenId: input.gardenId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    context: cloneExact(input.context),
    scope: "current_phase_only_generation_replaces_planning_ledger",
    technicalCapabilities: {
      manifestVersion: GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION,
      manifestHash: GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
      sdkVersion: GENERATED_VISUAL_CAPABILITY_MANIFEST.sdkVersion,
    },
    auditHashing: {
      algorithm: "sha256",
      serialization: "JSON.stringify_utf8_v1",
      responseSchemaHash: VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA_HASH,
    },
    callAccounting: {
      semanticCalls: input.review.calls,
      providerInvocationsAtSemanticBoundary: input.review.calls,
      transportAttempts: "not_observable_below_provider_boundary",
    },
    rejectedReviews: input.review.rejectedReviews,
    wholeGardenConstraints: cloneExact(input.review.wholeGardenConstraints),
    authoritativePlanPolicy: {
      visualBudget: cloneExact(input.finalVisualizationPlan.visualBudget),
      visualDecisionOverrides: cloneExact(input.finalVisualizationPlan.visualDecisionOverrides),
      necessityReviewCalls: input.finalVisualizationPlan.necessityReviewCalls,
      rejectedNecessityReviews: input.finalVisualizationPlan.rejectedNecessityReviews,
    },
    structuralContractRepair: cloneExact(input.structuralContractRepair),
    artifactProvenance: {
      visualNecessityDecisionSource: {
        path: VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH,
        decisionRecordsPath: VISUAL_DECISION_RECORDS_RELATIVE_PATH,
        role: "pre_executability_model_necessity_and_teaching_medium_source",
        finalInteractionContractsMayDiffer: true,
      },
      authoritativeFinalLearningUnitContract: {
        path: LEARNING_UNIT_CONTRACT_RELATIVE_PATH,
        role: "authoritative_final_interaction_contract",
      },
      authoritativeVisualizationPlan: {
        path: VISUALIZATION_PLAN_RELATIVE_PATH,
        role: "authoritative_final_routing_projection",
      },
      reviewLedger: {
        path: VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH,
        role: "exact_model_review_and_replacement_audit",
      },
    },
    attempts: cloneExact(input.review.attempts),
    units,
  };
  const ledger: VisualContractExecutabilityLedger = {
    ...ledgerWithoutIntegrity,
    integrityHash: visualContractExecutabilityLedgerIntegrityHash(ledgerWithoutIntegrity),
  };
  const linkageProblems = visualContractExecutabilityLinkageProblems({
    gardenId: input.gardenId,
    ledger,
    finalLearningUnits: input.finalRoutedLearningUnits,
    visualizationPlan: input.finalVisualizationPlan,
  });
  if (linkageProblems.length > 0) {
    throw new Error(
      `Visual-contract executability ledger linkage failed: ${linkageProblems.join("; ")}`,
    );
  }
  return ledger;
}

export function saveVisualContractExecutabilityLedger(input: {
  gardenDir: string;
  ledger: VisualContractExecutabilityLedger;
}): string {
  const filePath = visualContractExecutabilityLedgerPath(input.gardenDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = `${JSON.stringify(input.ledger, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_VISUAL_CONTRACT_EXECUTABILITY_LEDGER_BYTES) {
    throw new Error(
      `Visual-contract executability ledger exceeds ${MAX_VISUAL_CONTRACT_EXECUTABILITY_LEDGER_BYTES} UTF-8 bytes.`,
    );
  }
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const backup = `${filePath}.previous-${process.pid}-${crypto.randomUUID()}`;
  let displaced = false;
  try {
    fs.writeFileSync(temporary, payload, { encoding: "utf8", flag: "wx" });
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, backup);
      displaced = true;
    }
    fs.renameSync(temporary, filePath);
    displaced = false;
    try { fs.rmSync(backup, { force: true }); } catch { /* committed; retain recoverable backup */ }
  } catch (error) {
    if (displaced && !fs.existsSync(filePath) && fs.existsSync(backup)) {
      fs.renameSync(backup, filePath);
      displaced = false;
    }
    throw error;
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    if (!displaced) {
      try { fs.rmSync(backup, { force: true }); } catch { /* best effort */ }
    }
  }
  return filePath;
}

export function loadVisualContractExecutabilityLedger(
  gardenDir: string,
): VisualContractExecutabilityLedger | null {
  try {
    const payload = fs.readFileSync(visualContractExecutabilityLedgerPath(gardenDir), "utf8");
    if (Buffer.byteLength(payload, "utf8") > MAX_VISUAL_CONTRACT_EXECUTABILITY_LEDGER_BYTES) {
      return null;
    }
    const parsed: unknown = JSON.parse(payload);
    if (visualContractExecutabilityLedgerEnvelopeProblems(parsed).length > 0) return null;
    return parsed as VisualContractExecutabilityLedger;
  } catch {
    return null;
  }
}
