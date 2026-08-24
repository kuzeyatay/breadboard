import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { LearningUnitContract } from "./learning-unit-contract.ts";
import type { ProposedLearningMap } from "./learn-utils.ts";
import {
  AUTHORITATIVE_LEARNING_UNIT_CONTRACT_MARKDOWN_RELATIVE_PATH,
  renderAuthoritativeLearningUnitContractMarkdown,
} from "./learning-unit-contract-markdown.ts";
import {
  buildVisualizationContractRepairPrompt,
  VISUALIZATION_CONTRACT_REPAIR_RESPONSE_SCHEMA_HASH,
  visualizationContractRepairSystemPrompt,
  type VisualizationContractRepairAttempt,
} from "./visualization-contract-repair.ts";
import {
  GENERATED_VISUAL_CAPABILITY_MANIFEST,
  GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
  GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION,
  GENERATED_VISUAL_CONTROL_ID_PATTERN,
  GENERATED_VISUAL_RESERVED_CONTROL_IDS,
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
  COMPLETE_VISUALIZATION_CONTRACT_REPAIR_SCHEMA,
  parseVisualizationContractRepairResponse,
  pedagogyContractFromCompleteRepair,
  validateVisualizationContractUnitRepair,
  type CompleteVisualizationContractUnitRepair,
  type VisualizationContractEvidenceEntry,
  type VisualizationContractUnitRepair,
} from "./visualization-contract-validation.ts";

/**
 * This pass has one semantic authority: the reviewing model. Deterministic code
 * packages exact contracts and source evidence, checks the response envelope,
 * projects a complete replacement verbatim, and reruns the existing structural
 * gates. It never infers a missing control, changes a goal, or demotes a visual.
 */

/** The model response envelope remains independently versioned from the
 * reviewer protocol and its durable audit ledger. */
export const VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION = 1 as const;

/**
 * Version two separates byte/protocol failures from model-authored semantic
 * candidates. This is deliberately a protocol/ledger change rather than a
 * deterministic repair: every accepted replacement remains a complete model
 * response.
 */
export const VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION = 2 as const;
export const VISUAL_CONTRACT_EXECUTABILITY_LEDGER_SCHEMA_VERSION = 2 as const;

/**
 * At most three parsed semantic candidates are considered. Nonempty malformed
 * provider text may get two bounded protocol repairs, for a hard maximum of
 * five physical provider invocations. Missing/empty provider output is
 * terminal because it is not a returned candidate that can authorize another
 * model request. `maximumTotalCalls` remains the legacy input name for the
 * semantic-candidate ceiling.
 */
export const VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET = Object.freeze({
  initialCalls: 1,
  maximumRereviewCalls: 2,
  maximumTotalCalls: 3,
  maximumProtocolRetries: 2,
  maximumProviderInvocations: 5,
});

/** Keeps a malformed provider payload from turning the audit ledger into an unbounded file. */
export const MAX_VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_BYTES = 512_000;
/** Five bounded raw responses can also appear as exact feedback in later
 * packets. Keep the ledger ceiling above that auditable worst case instead of
 * truncating model text and falsely calling it exact. */
export const MAX_VISUAL_CONTRACT_EXECUTABILITY_LEDGER_BYTES = 12_000_000;
const MAX_VISUAL_CONTRACT_EXECUTABILITY_JSON_DIAGNOSTIC_CHARS = 240;
const MAX_VISUAL_CONTRACT_EXECUTABILITY_JSON_CONTEXT_CHARS = 120;

export const VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH =
  ".breadboard/visual-contract-executability-reviews.json" as const;

const VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA =
  `{"schemaVersion":1,"gardenId":string,"reviews":[{"unitId":string,"verdict":"approve"|"replace","reason":string,"replacement"?:${COMPLETE_VISUALIZATION_CONTRACT_REPAIR_SCHEMA}}]}`;

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

/**
 * Concept aliases are canonicalized when the final Learning Unit Contract is
 * reloaded, while the signed review packet preserves the model's original
 * alias order.  Treat only this set-like projection as order-insensitive; all
 * other immutable packet metadata remains byte-for-byte structural equality.
 */
function sameStringMultiset(left: readonly string[], right: readonly string[]): boolean {
  return isDeepStrictEqual([...left].sort(), [...right].sort());
}

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
  protocolVersion: typeof VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION;
  gardenId: string;
  auditContext?: VisualContractExecutabilityLedgerContext;
  units: VisualContractExecutabilityUnitPacket[];
  technicalCapabilities: {
    manifestVersion: typeof GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION;
    manifestHash: string;
    manifest: typeof GENERATED_VISUAL_CAPABILITY_MANIFEST;
  };
  wholeGardenConstraints?: VisualContractExecutabilityWholeGardenConstraints;
  previousRejectionReasons: string[];
  /** A byte-level failure is supplemental feedback; it never erases the last
   * parsed semantic candidate that still needs model-authored correction. */
  previousProtocolFailure?: VisualContractExecutabilityProtocolFailure;
  /** The complete prior parsed candidate, retained as exact provider text when
   * available so JSON number spellings such as `1e999` cannot be normalized. */
  previousSemanticFailure?: VisualContractExecutabilitySemanticFailure;
}

export interface VisualContractExecutabilityProtocolFailure {
  providerInvocation: number;
  protocolRetry: number;
  responseEncoding: "exact_raw" | "undefined";
  response: string | null;
  exactRawResponseSha256: string | null;
  rejectionReasons: string[];
}

export interface VisualContractExecutabilitySemanticFailure {
  providerInvocation: number;
  semanticCandidate: number;
  responseEncoding: "exact_raw";
  response: string;
  exactRawResponseSha256: string;
  rejectionReasons: string[];
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
  /** Physical provider invocation. It is intentionally distinct from the
   * semantic-candidate ordinal when an earlier response was malformed. */
  attempt: number;
  problems: VisualContractExecutabilityProblem[];
  unitIds: string[];
  requestPurpose: "initial_semantic_review" | "protocol_retry" | "semantic_rereview";
  semanticCandidatesBeforeRequest: number;
  protocolRetriesBeforeRequest: number;
}

export type VisualContractExecutabilityProvider = (
  request: VisualContractExecutabilityProviderRequest,
) => Promise<unknown>;

export interface VisualContractExecutabilityAttempt {
  /** Physical provider invocation, one-based and contiguous. */
  attempt: number;
  startedAt: string;
  completedAt: string;
  requestPurpose: "initial_semantic_review" | "protocol_retry" | "semantic_rereview";
  responseClassification: "protocol_rejection" | "semantic_candidate";
  packet: VisualContractExecutabilityReviewPacket;
  requestHash: string;
  packetHash: string;
  systemPromptHash: string;
  responseSchemaHash: string;
  canonicalEvidenceHashes: Record<string, string>;
  wholeGardenConstraintsHash: string | null;
  transportAccounting: {
    providerInvocation: number;
    semanticCandidate: number | null;
    protocolRetry: number | null;
    providerInvocationsAtThisBoundary: 1;
    transportRetries: "owned_below_semantic_boundary_not_counted";
  };
  accepted: boolean;
  responseEncoding: "exact_raw" | "undefined";
  /** Exact provider text, or null when the provider returned no candidate. */
  response: string | null;
  /** SHA-256 of the byte-exact provider text. It is required for exact_raw
   * responses and null for synthetic in-process JSON test providers. */
  exactRawResponseSha256: string | null;
  rejectionReasons: VisualContractExecutabilityProblem[];
}

/** Raw Council text is carried as text all the way through the bounded review
 * state machine. In particular, JSON.parse('{"step":1e999}') produces
 * Infinity and JSON.stringify would silently turn it into null; this tagged
 * carrier prevents that conversion before model feedback/audit linkage. */
export interface VisualContractExecutabilityExactRawResponse {
  kind: "visual_contract_executability_exact_raw_v2";
  content: string;
}

function sha256Json(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isExactRawProviderResponse(
  value: unknown,
): value is VisualContractExecutabilityExactRawResponse {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.kind === "visual_contract_executability_exact_raw_v2" &&
    typeof value.content === "string"
  );
}

/** Synthetic in-process providers used by focused tests may return a value
 * rather than Council text. Canonicalize it only when JSON serialization is
 * lossless. This deliberately rejects Infinity, undefined object fields,
 * duplicate runtime aliases, and other values that would otherwise be
 * normalized before the durable raw-response audit is written. */
function exactRawTextFromProviderResponse(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (isExactRawProviderResponse(value)) return value.content;
  if (typeof value === "string") return value;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error(
      `Visual-contract executability provider returned a non-JSON-safe synthetic value: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (serialized === undefined) {
    throw new Error("Visual-contract executability provider returned an unserializable synthetic value.");
  }
  let reparsed: unknown;
  try {
    reparsed = JSON.parse(serialized);
  } catch {
    throw new Error("Visual-contract executability synthetic serialization was not strict JSON.");
  }
  if (!isDeepStrictEqual(value, reparsed)) {
    throw new Error(
      "Visual-contract executability provider returned a synthetic value that JSON would normalize; return exact raw provider text instead.",
    );
  }
  return serialized;
}

interface NormalizedVisualContractExecutabilityProviderResponse {
  responseEncoding: "exact_raw" | "undefined";
  response: string | null;
  exactRawResponseSha256: string | null;
  parsedValue: unknown;
  protocolProblems: VisualContractExecutabilityProblem[] | null;
  terminalProtocolFailure: boolean;
}

function normalizedVisualContractExecutabilityProviderResponse(
  value: unknown,
): NormalizedVisualContractExecutabilityProviderResponse {
  const raw = exactRawTextFromProviderResponse(value);
  if (raw === null) {
    return {
      responseEncoding: "undefined",
      response: null,
      exactRawResponseSha256: null,
      parsedValue: null,
      protocolProblems: [{
        code: "invalid_protocol_response",
        path: "response",
        message: "provider returned no exact response text",
      }],
      terminalProtocolFailure: false,
    };
  }
  const exactRawResponseSha256 = sha256Text(raw);
  if (Buffer.byteLength(raw, "utf8") > MAX_VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_BYTES) {
    return {
      responseEncoding: "exact_raw",
      response: raw,
      exactRawResponseSha256,
      parsedValue: null,
      protocolProblems: [{
        code: "invalid_protocol_response",
        path: "response",
        message: `exact provider response exceeds ${MAX_VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_BYTES} UTF-8 bytes`,
      }],
      // Exact bytes above the hard response ceiling cannot safely be embedded
      // in another prompt/ledger. Do not truncate and pretend the feedback is
      // exact; fail closed at this boundary instead.
      terminalProtocolFailure: true,
    };
  }
  if (raw.trim().length === 0) {
    return {
      responseEncoding: "exact_raw",
      response: raw,
      exactRawResponseSha256,
      parsedValue: null,
      protocolProblems: [{
        code: "invalid_protocol_response",
        path: "response",
        message: "provider returned empty exact response text",
      }],
      terminalProtocolFailure: false,
    };
  }
  try {
    const parsedValue = JSON.parse(raw) as unknown;
    if (parsedValue === null) {
      return {
        responseEncoding: "exact_raw",
        response: raw,
        exactRawResponseSha256,
        parsedValue: null,
        protocolProblems: [{
          code: "invalid_protocol_response",
          path: "response",
          message: "provider returned literal JSON null instead of a candidate",
        }],
        terminalProtocolFailure: true,
      };
    }
    return {
      responseEncoding: "exact_raw",
      response: raw,
      exactRawResponseSha256,
      parsedValue,
      protocolProblems: null,
      terminalProtocolFailure: false,
    };
  } catch {
    return {
      responseEncoding: "exact_raw",
      response: raw,
      exactRawResponseSha256,
      parsedValue: null,
      protocolProblems: [{
        code: "invalid_protocol_response",
        path: "response",
        message: `response is not strict JSON; ${strictJsonSyntaxDiagnostic(raw) ?? "strict JSON.parse failed"}`,
      }],
      terminalProtocolFailure: false,
    };
  }
}

function parsedVisualContractExecutabilityAttemptResponse(
  attempt: Pick<VisualContractExecutabilityAttempt, "responseEncoding" | "response" | "exactRawResponseSha256">,
): unknown | null {
  if (
    attempt.responseEncoding !== "exact_raw" ||
    typeof attempt.response !== "string" ||
    attempt.exactRawResponseSha256 !== sha256Text(attempt.response)
  ) return null;
  try {
    return JSON.parse(attempt.response) as unknown;
  } catch {
    return null;
  }
}

function exactRawVisualContractExecutabilityAttemptParses(
  attempt: Pick<VisualContractExecutabilityAttempt, "responseEncoding" | "response" | "exactRawResponseSha256">,
): boolean {
  if (
    attempt.responseEncoding !== "exact_raw" ||
    typeof attempt.response !== "string" ||
    attempt.exactRawResponseSha256 !== sha256Text(attempt.response)
  ) return false;
  try {
    JSON.parse(attempt.response);
    return true;
  } catch {
    return false;
  }
}

export interface VisualContractExecutabilityRunResult<TPlan> {
  learningUnits: LearningUnitContract[];
  plan: TPlan;
  /** Physical provider invocations, including bounded protocol retries. */
  calls: number;
  /** Rejected parsed semantic candidates only. */
  rejectedReviews: number;
  /** Rejected empty/malformed raw provider responses only. */
  protocolRejections: number;
  semanticCandidates: number;
  protocolRetries: number;
  callBudget: {
    protocolVersion: typeof VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION;
    maximumSemanticCandidates: number;
    maximumProtocolRetries: number;
    maximumProviderInvocations: number;
  };
  approvedUnitIds: string[];
  replacedUnitIds: string[];
  acceptedResponse: VisualContractExecutabilityResponse | null;
  attempts: VisualContractExecutabilityAttempt[];
  beforeContracts: Record<string, CompleteVisualizationContractUnitRepair>;
  reviewedContracts: Record<string, CompleteVisualizationContractUnitRepair>;
  wholeGardenConstraints: VisualContractExecutabilityWholeGardenConstraints | null;
  auditContext: VisualContractExecutabilityLedgerContext | null;
}

export class VisualContractExecutabilityReviewError extends Error {
  readonly calls: number;
  readonly semanticCandidates: number;
  readonly protocolRetries: number;
  readonly problems: VisualContractExecutabilityProblem[];
  readonly lastResponse: unknown;

  constructor(input: {
    calls: number;
    semanticCandidates: number;
    protocolRetries: number;
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
    this.semanticCandidates = input.semanticCandidates;
    this.protocolRetries = input.protocolRetries;
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

/** Exact shape that survives this JSON artifact's on-disk serialization. */
function clonePersistedJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function responseByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Bounded syntax-only feedback for a raw model response. This deliberately
 * invokes strict JSON.parse once and reports where it stopped; it never
 * balances delimiters, extracts a substring, or returns a parsed value. */
function strictJsonSyntaxDiagnostic(value: string): string | null {
  try {
    JSON.parse(value);
    return null;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "invalid JSON";
    const safeMessage = rawMessage
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_VISUAL_CONTRACT_EXECUTABILITY_JSON_DIAGNOSTIC_CHARS);
    const positionMatch = safeMessage.match(/\bposition\s+(\d+)\b/i);
    const position = positionMatch ? Number(positionMatch[1]) : null;
    const boundedPosition = position !== null && Number.isSafeInteger(position)
      ? Math.max(0, Math.min(value.length, position))
      : null;
    const context = boundedPosition === null
      ? ""
      : value.slice(
          Math.max(0, boundedPosition - Math.floor(MAX_VISUAL_CONTRACT_EXECUTABILITY_JSON_CONTEXT_CHARS / 2)),
          Math.min(
            value.length,
            boundedPosition + Math.ceil(MAX_VISUAL_CONTRACT_EXECUTABILITY_JSON_CONTEXT_CHARS / 2),
          ),
        );
    return [
      `strict JSON.parse failed${boundedPosition === null ? "" : ` at position ${boundedPosition}`}`,
      safeMessage || "invalid JSON",
      ...(context ? [`bounded context ${JSON.stringify(context)}`] : []),
    ].join(": ");
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
        optional: ["protocolRole", "unit", "min", "max", "step", "options"],
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
  auditContext?: VisualContractExecutabilityLedgerContext;
  wholeGardenConstraints?: VisualContractExecutabilityWholeGardenConstraints;
  previousRejectionReasons?: VisualContractExecutabilityProblem[];
  previousProtocolFailure?: VisualContractExecutabilityProtocolFailure;
  previousSemanticFailure?: VisualContractExecutabilitySemanticFailure;
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
    protocolVersion: VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION,
    gardenId,
    ...(input.auditContext ? { auditContext: cloneExact(input.auditContext) } : {}),
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
    ...(input.previousProtocolFailure
      ? { previousProtocolFailure: cloneExact(input.previousProtocolFailure) }
      : {}),
    ...(input.previousSemanticFailure
      ? { previousSemanticFailure: cloneExact(input.previousSemanticFailure) }
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
    `Every learner control id must match ${GENERATED_VISUAL_CONTROL_ID_PATTERN.source}; ${GENERATED_VISUAL_RESERVED_CONTROL_IDS.join(", ")} are runtime expression variables and are forbidden control ids. Reject or replace any contract that violates this policy.`,
    "Check goal-to-control-to-observable executability explicitly. Every condition or case that is decisive for the expected insight must be represented by a declared control state or by explicit observable behavior; a selector that merely changes what is displayed is insufficient when the goal requires a distinct learner decision, comparison, prediction, or evaluation.",
    "For interactionGoal test_prediction, the learner must commit a prediction before the outcome is revealed or evaluated. Require three distinct authored controls in order: an evidence-grounded slider/number/select marked prediction_input, a protocol_action button/toggle marked commit_prediction, then a protocol_action button/toggle marked reveal_outcome or evaluate_prediction. The protocol default must keep the result hidden, and the later observable must retain the selected prediction while showing the result or evaluation.",
    "Use only the canonical evidence supplied with that same unit. Every source-semantic control label and option, observable label, and expected insight must be literally grounded by exact quotes at their anchors. Pure protocol_action controls instead require exactly empty evidence; their model-authored UI labels may express only interaction mechanics and never substantiate a subject claim, observable, or insight. Do not invent subject-matter claims, cases, variables, conditions, or units.",
    "When previousRejectionReasons are present, correct every listed problem in a fresh complete batch. Do not argue with or paraphrase the rejection reasons.",
    "previousSemanticFailure, when present, is the still-unresolved complete candidate. Its response field and exactRawResponseSha256 bind the exact provider output; correct that candidate's listed semantic failures in a fresh complete batch. A later previousProtocolFailure is supplemental syntax feedback and never replaces or clears previousSemanticFailure.",
    "When previousProtocolFailure is present, its response is exact malformed or empty provider text plus a strict parser diagnostic. Inspect it only to produce a syntactically valid fresh complete JSON object; never return a patch, fragment, or commentary about it.",
    "Every numeric control min, max, step, and numeric defaultValue you author must be a JavaScript-finite JSON number. Do not emit non-finite spellings or numeric overflow such as 1e999. This is a format/executability requirement, not an instruction to invent a value: choose only evidence-grounded values justified by the supplied contract.",
    "Before returning, validate the entire response with a strict JSON parser. Return one JSON object only, with no Markdown fence, wrapper, trailing token, or surplus delimiter.",
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

/**
 * Strict executability transport boundary. Keep all provider text as an exact
 * tagged string, including valid JSON. Decoding happens transiently inside the
 * reviewer loop and is repeated during ledger linkage; this prevents JSON
 * number normalization (notably 1e999 -> Infinity -> null) from laundering
 * model output before a fresh bounded rereview sees it.
 */
export function strictVisualContractExecutabilityResponseOrExactRaw(
  content: string,
): VisualContractExecutabilityExactRawResponse {
  return {
    kind: "visual_contract_executability_exact_raw_v2",
    content,
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
    const syntaxDiagnostic = typeof input.value === "string"
      ? strictJsonSyntaxDiagnostic(input.value)
      : null;
    problem(
      problems,
      "invalid_response",
      "response",
      `response must be an object${syntaxDiagnostic ? `; ${syntaxDiagnostic}` : ""}`,
    );
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
    const reviewedContract = review.verdict === "replace"
      ? review.replacement
      : completeVisualContractForUnit(unit);
    const validation = validateVisualizationContractUnitRepair({
      unit,
      repair: reviewedContract,
      evidence: input.canonicalEvidenceByUnit[unit.id] ?? [],
      requireCompleteContract: true,
      requireExecutableProtocol: true,
    });
    for (const message of validation) {
      problem(
        problems,
        "invalid_replacement_contract",
        `review:${review.unitId}.${review.verdict === "replace" ? "replacement" : "approvedContract"}`,
        message,
        review.unitId,
      );
    }
    if (review.verdict === "replace") {
      replacementByUnit.set(review.unitId, review.replacement);
    }
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
  auditContext?: VisualContractExecutabilityLedgerContext;
  wholeGardenConstraints?: VisualContractExecutabilityWholeGardenConstraints;
  provider: VisualContractExecutabilityProvider;
  validateGlobal?: (learningUnits: LearningUnitContract[]) => VisualContractExecutabilityProblem[];
  /** Must run the complete existing whole-plan/global validators and return their plan. */
  validateAll: (learningUnits: LearningUnitContract[]) => TPlan;
  maxCalls?: number;
  checkCancelled?: () => void;
  onEvent?: (type: string, data: Record<string, unknown>) => void;
}): Promise<VisualContractExecutabilityRunResult<TPlan>> {
  // `maxCalls` is retained as a public compatibility knob for parsed semantic
  // candidates. It never expands the protocol or physical-invocation caps.
  const maximumSemanticCandidates = Math.max(
    1,
    Math.min(
      VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET.maximumTotalCalls,
      input.maxCalls ?? VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET.maximumTotalCalls,
    ),
  );
  const maximumProtocolRetries = VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET.maximumProtocolRetries;
  const maximumProviderInvocations = Math.min(
    VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET.maximumProviderInvocations,
    maximumSemanticCandidates + maximumProtocolRetries,
  );
  const callBudget = {
    protocolVersion: VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION,
    maximumSemanticCandidates,
    maximumProtocolRetries,
    maximumProviderInvocations,
  } as const;
  const emitReviewEvent = (
    type: string,
    data: Record<string, unknown>,
  ): void => {
    try {
      input.onEvent?.(type, data);
    } catch {
      // Review telemetry is observational and cannot replace the exact model,
      // cancellation, protocol, or semantic outcome.
    }
  };
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
      protocolRejections: 0,
      semanticCandidates: 0,
      protocolRetries: 0,
      callBudget,
      approvedUnitIds: [],
      replacedUnitIds: [],
      acceptedResponse: null,
      attempts: [],
      beforeContracts,
      reviewedContracts: {},
      wholeGardenConstraints: input.wholeGardenConstraints
        ? cloneExact(input.wholeGardenConstraints)
        : null,
      auditContext: input.auditContext ? cloneExact(input.auditContext) : null,
    };
  }
  if (new Set(activeUnitIds).size !== activeUnitIds.length) {
    throw new Error("Visual-contract executability review requires unique active learning-unit ids.");
  }
  const attempts: VisualContractExecutabilityAttempt[] = [];
  let providerInvocations = 0;
  let semanticCandidates = 0;
  /** Number of requests explicitly issued to repair a prior byte/protocol
   * failure. The initial request is not itself a retry. */
  let protocolRetries = 0;
  let protocolRejections = 0;
  let rejectedReviews = 0;
  let previousResponseClassification: VisualContractExecutabilityAttempt["responseClassification"] | null = null;
  let previousProtocolFailure: VisualContractExecutabilityProtocolFailure | undefined;
  let previousSemanticFailure: VisualContractExecutabilitySemanticFailure | undefined;
  let previousProtocolProblems: VisualContractExecutabilityProblem[] = [];
  let previousSemanticProblems: VisualContractExecutabilityProblem[] = [];

  const primaryProblems = (): VisualContractExecutabilityProblem[] => [
    ...(previousSemanticFailure ? previousSemanticProblems : []),
    ...(previousProtocolFailure ? previousProtocolProblems : []),
  ];
  const primaryFailureResponse = (): string | null =>
    previousResponseClassification === "protocol_rejection"
      ? previousProtocolFailure?.response ?? null
      : previousSemanticFailure?.response ?? previousProtocolFailure?.response ?? null;
  const packetForNextRequest = (): VisualContractExecutabilityReviewPacket =>
    buildVisualContractExecutabilityReviewPacket({
      gardenId: input.gardenId,
      learningUnits: input.learningUnits,
      canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
      ...(input.auditContext ? { auditContext: input.auditContext } : {}),
      ...(input.wholeGardenConstraints
        ? { wholeGardenConstraints: input.wholeGardenConstraints }
        : {}),
      previousRejectionReasons: primaryProblems(),
      ...(previousProtocolFailure ? { previousProtocolFailure } : {}),
      ...(previousSemanticFailure ? { previousSemanticFailure } : {}),
    });
  const rejectionReasonStrings = (reasons: VisualContractExecutabilityProblem[]): string[] =>
    reasons.map((item) => `${item.path}: ${item.message}`);
  const auditAttempt = (inputAttempt: {
    packet: VisualContractExecutabilityReviewPacket;
    startedAt: string;
    requestPurpose: VisualContractExecutabilityAttempt["requestPurpose"];
    responseClassification: VisualContractExecutabilityAttempt["responseClassification"];
    semanticCandidate: number | null;
    protocolRetry: number | null;
    normalized: NormalizedVisualContractExecutabilityProviderResponse;
    accepted: boolean;
    rejectionReasons: VisualContractExecutabilityProblem[];
  }): VisualContractExecutabilityAttempt => {
    const prompt = buildVisualContractExecutabilityPrompt(inputAttempt.packet);
    return {
      attempt: providerInvocations,
      startedAt: inputAttempt.startedAt,
      completedAt: new Date().toISOString(),
      requestPurpose: inputAttempt.requestPurpose,
      responseClassification: inputAttempt.responseClassification,
      packet: cloneExact(inputAttempt.packet),
      requestHash: sha256Json({ system: prompt.system, user: prompt.user }),
      packetHash: sha256Json(inputAttempt.packet),
      systemPromptHash: sha256Text(prompt.system),
      responseSchemaHash: VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA_HASH,
      canonicalEvidenceHashes: Object.fromEntries(
        inputAttempt.packet.units.map((unit) => [unit.unitId, sha256Json(unit.canonicalEvidence)]),
      ),
      wholeGardenConstraintsHash: inputAttempt.packet.wholeGardenConstraints
        ? sha256Json(inputAttempt.packet.wholeGardenConstraints)
        : null,
      transportAccounting: {
        providerInvocation: providerInvocations,
        semanticCandidate: inputAttempt.semanticCandidate,
        protocolRetry: inputAttempt.protocolRetry,
        providerInvocationsAtThisBoundary: 1,
        transportRetries: "owned_below_semantic_boundary_not_counted",
      },
      accepted: inputAttempt.accepted,
      responseEncoding: inputAttempt.normalized.responseEncoding,
      response: inputAttempt.normalized.response,
      exactRawResponseSha256: inputAttempt.normalized.exactRawResponseSha256,
      rejectionReasons: cloneExact(inputAttempt.rejectionReasons),
    };
  };
  emitReviewEvent("visual_contract_executability_review_started", {
    unitIds: activeUnitIds,
    maximumSemanticCandidates,
    maximumProtocolRetries,
    maximumProviderInvocations,
  });

  while (
    providerInvocations < maximumProviderInvocations &&
    semanticCandidates < maximumSemanticCandidates
  ) {
    input.checkCancelled?.();
    const requestPurpose: VisualContractExecutabilityAttempt["requestPurpose"] =
      providerInvocations === 0
        ? "initial_semantic_review"
        : previousResponseClassification === "protocol_rejection"
          ? "protocol_retry"
          : "semantic_rereview";
    if (
      requestPurpose === "protocol_retry" &&
      protocolRetries >= maximumProtocolRetries
    ) break;
    const protocolRetryForRequest = requestPurpose === "protocol_retry"
      ? protocolRetries + 1
      : null;
    if (protocolRetryForRequest !== null) protocolRetries = protocolRetryForRequest;
    const packet = packetForNextRequest();
    const prompt = buildVisualContractExecutabilityPrompt(packet);
    const startedAt = new Date().toISOString();
    providerInvocations += 1;
    // Deliberately no catch: a true transport/provider exception escapes this
    // bounded reviewer state after exactly one physical provider invocation.
    let rawResponse: unknown;
    try {
      rawResponse = await input.provider({
        ...prompt,
        attempt: providerInvocations,
        problems: cloneExact(primaryProblems()),
        unitIds: [...activeUnitIds],
        requestPurpose,
        semanticCandidatesBeforeRequest: semanticCandidates,
        protocolRetriesBeforeRequest: protocolRetryForRequest === null
          ? protocolRetries
          : protocolRetries - 1,
      });
    } catch (error) {
      emitReviewEvent("visual_contract_executability_review_transport_aborted", {
        attempt: providerInvocations,
        unitIds: activeUnitIds,
        semanticCandidatesBeforeTransportFailure: semanticCandidates,
        protocolRetriesBeforeTransportFailure: protocolRetries,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const normalized = normalizedVisualContractExecutabilityProviderResponse(rawResponse);
    if (
      normalized.response === null ||
      normalized.response.trim().length === 0
    ) {
      protocolRejections += 1;
      const emptyProblems = normalized.protocolProblems ?? [{
        code: "invalid_protocol_response",
        path: "response",
        message: "provider returned no nonempty exact response text",
      }];
      emitReviewEvent("visual_contract_executability_review_exhausted", {
        calls: providerInvocations,
        semanticCandidates,
        protocolRetries,
        protocolRejections,
        maximumSemanticCandidates,
        maximumProtocolRetries,
        maximumProviderInvocations,
        terminalEmptyResponse: true,
        unitIds: activeUnitIds,
        reasons: rejectionReasonStrings(emptyProblems),
      });
      throw new VisualContractExecutabilityReviewError({
        calls: providerInvocations,
        semanticCandidates,
        protocolRetries,
        problems: emptyProblems,
        lastResponse: normalized.response ?? "[provider returned no exact response text]",
      });
    }
    if (normalized.protocolProblems) {
      protocolRejections += 1;
      previousResponseClassification = "protocol_rejection";
      if (normalized.terminalProtocolFailure) {
        emitReviewEvent("visual_contract_executability_review_exhausted", {
          calls: providerInvocations,
          semanticCandidates,
          protocolRetries,
          protocolRejections,
          maximumSemanticCandidates,
          maximumProtocolRetries,
          maximumProviderInvocations,
          terminalProtocolFailure: true,
          unitIds: activeUnitIds,
          reasons: rejectionReasonStrings(normalized.protocolProblems),
        });
        throw new VisualContractExecutabilityReviewError({
          calls: providerInvocations,
          semanticCandidates,
          protocolRetries,
          problems: normalized.protocolProblems,
          lastResponse: "[exact provider response omitted from feedback because it exceeded the bounded raw-response ceiling]",
        });
      }
      previousProtocolProblems = cloneExact(normalized.protocolProblems);
      previousProtocolFailure = {
        providerInvocation: providerInvocations,
        protocolRetry: protocolRetryForRequest ?? 0,
        responseEncoding: normalized.responseEncoding,
        response: normalized.response,
        exactRawResponseSha256: normalized.exactRawResponseSha256,
        rejectionReasons: rejectionReasonStrings(normalized.protocolProblems),
      };
      attempts.push(auditAttempt({
        packet,
        startedAt,
        requestPurpose,
        responseClassification: "protocol_rejection",
        semanticCandidate: null,
        protocolRetry: protocolRetryForRequest,
        normalized,
        accepted: false,
        rejectionReasons: normalized.protocolProblems,
      }));
      emitReviewEvent("visual_contract_executability_review_rejected", {
        attempt: providerInvocations,
        requestPurpose,
        responseClassification: "protocol_rejection",
        semanticCandidates,
        protocolRetries,
        protocolRejections,
        reasons: rejectionReasonStrings(normalized.protocolProblems),
      });
      continue;
    }

    semanticCandidates += 1;
    // A parsed candidate is semantically actionable. It supersedes only the
    // byte-level feedback, never a prior semantic failure until this candidate
    // itself has been accepted or rejected below.
    previousProtocolFailure = undefined;
    previousProtocolProblems = [];
    previousResponseClassification = "semantic_candidate";
    const parsed = parseVisualContractExecutabilityResponse({
      value: normalized.parsedValue,
      gardenId: input.gardenId,
      activeUnitIds,
    });
    if (!parsed.ok) {
      rejectedReviews += 1;
      previousSemanticProblems = cloneExact(parsed.problems);
      previousSemanticFailure = {
        providerInvocation: providerInvocations,
        semanticCandidate: semanticCandidates,
        responseEncoding: "exact_raw",
        response: normalized.response as string,
        exactRawResponseSha256: normalized.exactRawResponseSha256 as string,
        rejectionReasons: rejectionReasonStrings(parsed.problems),
      };
      attempts.push(auditAttempt({
        packet,
        startedAt,
        requestPurpose,
        responseClassification: "semantic_candidate",
        semanticCandidate: semanticCandidates,
        protocolRetry: protocolRetryForRequest,
        normalized,
        accepted: false,
        rejectionReasons: parsed.problems,
      }));
      emitReviewEvent("visual_contract_executability_review_rejected", {
        attempt: providerInvocations,
        requestPurpose,
        responseClassification: "semantic_candidate",
        semanticCandidates,
        protocolRetries,
        protocolRejections,
        reasons: rejectionReasonStrings(parsed.problems),
      });
      continue;
    }
    const applied = applyVerbatimReplacements({
      learningUnits: input.learningUnits,
      response: parsed.response,
      canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
    });
    if (!applied.ok) {
      rejectedReviews += 1;
      previousSemanticProblems = cloneExact(applied.problems);
      previousSemanticFailure = {
        providerInvocation: providerInvocations,
        semanticCandidate: semanticCandidates,
        responseEncoding: "exact_raw",
        response: normalized.response as string,
        exactRawResponseSha256: normalized.exactRawResponseSha256 as string,
        rejectionReasons: rejectionReasonStrings(applied.problems),
      };
      attempts.push(auditAttempt({
        packet,
        startedAt,
        requestPurpose,
        responseClassification: "semantic_candidate",
        semanticCandidate: semanticCandidates,
        protocolRetry: protocolRetryForRequest,
        normalized,
        accepted: false,
        rejectionReasons: applied.problems,
      }));
      emitReviewEvent("visual_contract_executability_review_rejected", {
        attempt: providerInvocations,
        requestPurpose,
        responseClassification: "semantic_candidate",
        semanticCandidates,
        protocolRetries,
        protocolRejections,
        reasons: rejectionReasonStrings(applied.problems),
      });
      continue;
    }

    const globalProblems = input.validateGlobal?.(applied.learningUnits) ?? [];
    if (globalProblems.length > 0) {
      rejectedReviews += 1;
      previousSemanticProblems = cloneExact(globalProblems);
      previousSemanticFailure = {
        providerInvocation: providerInvocations,
        semanticCandidate: semanticCandidates,
        responseEncoding: "exact_raw",
        response: normalized.response as string,
        exactRawResponseSha256: normalized.exactRawResponseSha256 as string,
        rejectionReasons: rejectionReasonStrings(globalProblems),
      };
      attempts.push(auditAttempt({
        packet,
        startedAt,
        requestPurpose,
        responseClassification: "semantic_candidate",
        semanticCandidate: semanticCandidates,
        protocolRetry: protocolRetryForRequest,
        normalized,
        accepted: false,
        rejectionReasons: globalProblems,
      }));
      emitReviewEvent("visual_contract_executability_review_rejected", {
        attempt: providerInvocations,
        requestPurpose,
        responseClassification: "semantic_candidate",
        semanticCandidates,
        protocolRetries,
        protocolRejections,
        reasons: rejectionReasonStrings(globalProblems),
      });
      continue;
    }

    let plan: TPlan;
    try {
      plan = input.validateAll(applied.learningUnits);
    } catch (error) {
      const validationProblems: VisualContractExecutabilityProblem[] = [{
        code: "global_contract_validation_failed",
        path: "whole_garden",
        message: error instanceof Error ? error.message : String(error),
      }];
      rejectedReviews += 1;
      previousSemanticProblems = cloneExact(validationProblems);
      previousSemanticFailure = {
        providerInvocation: providerInvocations,
        semanticCandidate: semanticCandidates,
        responseEncoding: "exact_raw",
        response: normalized.response as string,
        exactRawResponseSha256: normalized.exactRawResponseSha256 as string,
        rejectionReasons: rejectionReasonStrings(validationProblems),
      };
      attempts.push(auditAttempt({
        packet,
        startedAt,
        requestPurpose,
        responseClassification: "semantic_candidate",
        semanticCandidate: semanticCandidates,
        protocolRetry: protocolRetryForRequest,
        normalized,
        accepted: false,
        rejectionReasons: validationProblems,
      }));
      emitReviewEvent("visual_contract_executability_review_rejected", {
        attempt: providerInvocations,
        requestPurpose,
        responseClassification: "semantic_candidate",
        semanticCandidates,
        protocolRetries,
        protocolRejections,
        reasons: rejectionReasonStrings(validationProblems),
      });
      continue;
    }

    attempts.push(auditAttempt({
      packet,
      startedAt,
      requestPurpose,
      responseClassification: "semantic_candidate",
      semanticCandidate: semanticCandidates,
      protocolRetry: protocolRetryForRequest,
      normalized,
      accepted: true,
      rejectionReasons: [],
    }));
    const approvedUnitIds = parsed.response.reviews
      .filter((review) => review.verdict === "approve")
      .map((review) => review.unitId);
    const reviewedContracts = Object.fromEntries(
      applied.learningUnits
        .filter((unit) => activeRequirement(unit))
        .map((unit) => [unit.id, completeVisualContractForUnit(unit)]),
    );
    emitReviewEvent("visual_contract_executability_review_completed", {
      calls: providerInvocations,
      semanticCandidates,
      protocolRetries,
      protocolRejections,
      rejectedReviews,
      approvedUnitIds,
      replacedUnitIds: applied.replacedUnitIds,
    });
    return {
      learningUnits: applied.learningUnits,
      plan,
      calls: providerInvocations,
      rejectedReviews,
      protocolRejections,
      semanticCandidates,
      protocolRetries,
      callBudget,
      approvedUnitIds,
      replacedUnitIds: applied.replacedUnitIds,
      acceptedResponse: parsed.response,
      attempts,
      beforeContracts,
      reviewedContracts,
      wholeGardenConstraints: input.wholeGardenConstraints
        ? cloneExact(input.wholeGardenConstraints)
        : null,
      auditContext: input.auditContext ? cloneExact(input.auditContext) : null,
    };
  }

  emitReviewEvent("visual_contract_executability_review_exhausted", {
    calls: providerInvocations,
    semanticCandidates,
    protocolRetries,
    protocolRejections,
    maximumSemanticCandidates,
    maximumProtocolRetries,
    maximumProviderInvocations,
    unitIds: activeUnitIds,
    reasons: rejectionReasonStrings(primaryProblems()),
  });
  throw new VisualContractExecutabilityReviewError({
    calls: providerInvocations,
    semanticCandidates,
    protocolRetries,
    problems: primaryProblems(),
    lastResponse: primaryFailureResponse(),
  });
}

export async function reviewVisualizationPlanExecutability(input: {
  gardenId: string;
  learningMap: ProposedLearningMap;
  learningUnits: LearningUnitContract[];
  initialPlan: VisualizationPlan;
  canonicalEvidenceByUnit: VisualizationCanonicalEvidenceByUnit;
  auditContext?: VisualContractExecutabilityLedgerContext;
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
    ...(input.auditContext ? { auditContext: input.auditContext } : {}),
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

export type VisualContractExecutabilityLedgerContext =
  | {
      phase: "planning";
      jobId: string;
      model: string;
      learningMapId: string;
    }
  | {
      phase: "generation";
      jobId: string;
      model: string;
      learningMapId: string;
      textbookVersionId: string;
    };

type BoundVisualizationOpportunity = Omit<
  VisualizationPlan["opportunities"][number],
  "targetPage" | "targetHeading" | "insertionAnchor"
>;

function boundVisualizationOpportunity(
  opportunity: VisualizationPlan["opportunities"][number],
): BoundVisualizationOpportunity {
  const {
    targetPage: _targetPage,
    targetHeading: _targetHeading,
    insertionAnchor: _insertionAnchor,
    ...bound
  } = opportunity;
  return bound;
}

export interface VisualContractExecutabilityLedger {
  schemaVersion: typeof VISUAL_CONTRACT_EXECUTABILITY_LEDGER_SCHEMA_VERSION;
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
    serialization: "JSON.stringify_utf8_v2_exact_raw_provider_text";
    responseSchemaHash: string;
    protocolVersion: typeof VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION;
  };
  callAccounting: {
    protocolVersion: typeof VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION;
    maximumSemanticCandidates: number;
    maximumProtocolRetries: number;
    maximumProviderInvocations: number;
    providerInvocations: number;
    semanticCandidates: number;
    protocolRetries: number;
    protocolRejections: number;
    transportAttempts: "not_observable_below_provider_boundary";
  };
  /** Rejected parsed candidate batches only; see callAccounting.protocolRejections
   * for byte/protocol failures. */
  rejectedReviews: number;
  protocolRejections: number;
  wholeGardenConstraints: VisualContractExecutabilityWholeGardenConstraints;
  authoritativePlanPolicy: {
    visualBudget: VisualizationPlan["visualBudget"];
    visualDecisionOverrides: VisualizationPlan["visualDecisionOverrides"];
    necessityReviewCalls: number;
    rejectedNecessityReviews: number;
    opportunitiesExcludingMechanicalPlacement: BoundVisualizationOpportunity[];
    routeDecisions: VisualizationPlan["decisions"];
  };
  immutableGardenAllocation: Array<{
    unitId: string;
    requirement: NonNullable<LearningUnitContract["interactiveVisualPlan"]>["requirement"];
    decisionBeforeMechanicalRouting: unknown;
    teachingMediumPlan: LearningUnitContract["teachingMediumPlan"];
  }>;
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

function serializedVisualContractExecutabilityLedger(
  ledger: VisualContractExecutabilityLedger,
): string {
  const payload = `${JSON.stringify(ledger, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_VISUAL_CONTRACT_EXECUTABILITY_LEDGER_BYTES) {
    throw new Error(
      `Visual-contract executability ledger exceeds ${MAX_VISUAL_CONTRACT_EXECUTABILITY_LEDGER_BYTES} UTF-8 bytes.`,
    );
  }
  return payload;
}

function opportunityInputsForContract(
  contract: CompleteVisualizationContractUnitRepair,
): Array<Record<string, unknown>> {
  return contract.controls.map((control) => ({
    id: control.id,
    kind: control.kind,
    label: control.label,
    type: control.type,
    ...(control.protocolRole !== undefined ? { protocolRole: control.protocolRole } : {}),
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isActiveRequirementValue(value: unknown): value is ActiveRequirement {
  return value === "required" || value === "recommended" || value === "optional";
}

function isCanonicalEvidenceEntryEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeySet(value, ["anchor", "kind", "text"]) &&
    Boolean(compact(value.anchor)) &&
    Boolean(compact(value.kind)) &&
    Boolean(compact(value.text))
  );
}

function isCompleteContractEnvelope(value: unknown): boolean {
  if (!isRecord(value) || !compact(value.unitId)) return false;
  const parsed = parseVisualizationContractRepairResponse(
    { repairs: [value] },
    { requireCompleteContract: true, expectedUnitIds: [value.unitId as string] },
  );
  return parsed.problems.length === 0 && parsed.repairs.length === 1;
}

function isWholeGardenConstraintsEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeySet(value, [
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
    ]) &&
    isStringArray(value.unitOrder) &&
    isRecord(value.sectionByUnit) &&
    Object.values(value.sectionByUnit).every((sectionId) => Boolean(compact(sectionId))) &&
    [
      "maximumRepeatedInteractionSignature",
      "targetMinimum",
      "targetMaximum",
      "maximumPerSection",
      "minimumUnitsBetweenSimilarVisuals",
      "requiredVisuals",
      "recommendedVisuals",
      "optionalVisuals",
    ].every((field) =>
      Number.isInteger(value[field]) && Number(value[field]) >= 0)
  );
}

function isExecutabilityProblemEnvelope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasUnitId = Object.prototype.hasOwnProperty.call(value, "unitId");
  return (
    exactKeySet(value, ["code", "path", "message", ...(hasUnitId ? ["unitId"] : [])]) &&
    Boolean(compact(value.code)) &&
    Boolean(compact(value.path)) &&
    Boolean(compact(value.message)) &&
    (!hasUnitId || Boolean(compact(value.unitId)))
  );
}

function isTransportAccountingEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeySet(value, [
      "logicalSemanticCall",
      "providerInvocationsAtThisBoundary",
      "transportRetries",
    ]) &&
    Number.isInteger(value.logicalSemanticCall) &&
    Number(value.logicalSemanticCall) > 0 &&
    value.providerInvocationsAtThisBoundary === 1 &&
    value.transportRetries === "owned_below_semantic_boundary_not_counted"
  );
}

function isExecutabilityTransportAccountingEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeySet(value, [
      "providerInvocation",
      "semanticCandidate",
      "protocolRetry",
      "providerInvocationsAtThisBoundary",
      "transportRetries",
    ]) &&
    Number.isInteger(value.providerInvocation) &&
    Number(value.providerInvocation) > 0 &&
    (value.semanticCandidate === null ||
      (Number.isInteger(value.semanticCandidate) && Number(value.semanticCandidate) > 0)) &&
    (value.protocolRetry === null ||
      (Number.isInteger(value.protocolRetry) && Number(value.protocolRetry) > 0)) &&
    value.providerInvocationsAtThisBoundary === 1 &&
    value.transportRetries === "owned_below_semantic_boundary_not_counted"
  );
}

function isExactRawResponseEnvelope(input: {
  responseEncoding: unknown;
  response: unknown;
  exactRawResponseSha256: unknown;
}): boolean {
  return (
    input.responseEncoding === "exact_raw" &&
    typeof input.response === "string" &&
    Buffer.byteLength(input.response, "utf8") <=
      MAX_VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_BYTES &&
    SHA256_HEX_PATTERN.test(String(input.exactRawResponseSha256 ?? "")) &&
    input.exactRawResponseSha256 === sha256Text(input.response)
  ) || (
    input.responseEncoding === "undefined" &&
    input.response === null &&
    input.exactRawResponseSha256 === null
  );
}

function isProtocolFailureEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeySet(value, [
      "providerInvocation",
      "protocolRetry",
      "responseEncoding",
      "response",
      "exactRawResponseSha256",
      "rejectionReasons",
    ]) &&
    Number.isInteger(value.providerInvocation) &&
    Number(value.providerInvocation) > 0 &&
    Number.isInteger(value.protocolRetry) &&
    Number(value.protocolRetry) >= 0 &&
    (value.responseEncoding === "exact_raw" || value.responseEncoding === "undefined") &&
    isExactRawResponseEnvelope({
      responseEncoding: value.responseEncoding,
      response: value.response,
      exactRawResponseSha256: value.exactRawResponseSha256,
    }) &&
    isStringArray(value.rejectionReasons) &&
    value.rejectionReasons.every((reason) => Boolean(compact(reason)))
  );
}

function isSemanticFailureEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeySet(value, [
      "providerInvocation",
      "semanticCandidate",
      "responseEncoding",
      "response",
      "exactRawResponseSha256",
      "rejectionReasons",
    ]) &&
    Number.isInteger(value.providerInvocation) &&
    Number(value.providerInvocation) > 0 &&
    Number.isInteger(value.semanticCandidate) &&
    Number(value.semanticCandidate) > 0 &&
    isExactRawResponseEnvelope({
      responseEncoding: value.responseEncoding,
      response: value.response,
      exactRawResponseSha256: value.exactRawResponseSha256,
    }) &&
    value.responseEncoding === "exact_raw" &&
    typeof value.response === "string" &&
    isStringArray(value.rejectionReasons) &&
    value.rejectionReasons.every((reason) => Boolean(compact(reason)))
  );
}

function isLedgerContextEnvelope(value: unknown): value is VisualContractExecutabilityLedgerContext {
  if (!isRecord(value)) return false;
  if (value.phase === "planning") {
    return (
      exactKeySet(value, ["phase", "jobId", "model", "learningMapId"]) &&
      Boolean(compact(value.jobId)) &&
      Boolean(compact(value.model)) &&
      Boolean(compact(value.learningMapId))
    );
  }
  return (
    value.phase === "generation" &&
    exactKeySet(value, ["phase", "jobId", "model", "learningMapId", "textbookVersionId"]) &&
    Boolean(compact(value.jobId)) &&
    Boolean(compact(value.model)) &&
    Boolean(compact(value.learningMapId)) &&
    Boolean(compact(value.textbookVersionId))
  );
}

function isArtifactProvenanceEnvelope(value: unknown): boolean {
  if (!isRecord(value) || !exactKeySet(value, [
    "visualNecessityDecisionSource",
    "authoritativeFinalLearningUnitContract",
    "authoritativeVisualizationPlan",
    "reviewLedger",
  ])) return false;
  const necessity = value.visualNecessityDecisionSource;
  const contract = value.authoritativeFinalLearningUnitContract;
  const plan = value.authoritativeVisualizationPlan;
  const ledger = value.reviewLedger;
  return (
    isRecord(necessity) &&
    exactKeySet(necessity, [
      "path",
      "decisionRecordsPath",
      "role",
      "finalInteractionContractsMayDiffer",
    ]) &&
    necessity.path === VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH &&
    necessity.decisionRecordsPath === VISUAL_DECISION_RECORDS_RELATIVE_PATH &&
    necessity.role === "pre_executability_model_necessity_and_teaching_medium_source" &&
    necessity.finalInteractionContractsMayDiffer === true &&
    isRecord(contract) &&
    exactKeySet(contract, ["path", "role"]) &&
    contract.path === LEARNING_UNIT_CONTRACT_RELATIVE_PATH &&
    contract.role === "authoritative_final_interaction_contract" &&
    isRecord(plan) &&
    exactKeySet(plan, ["path", "role"]) &&
    plan.path === VISUALIZATION_PLAN_RELATIVE_PATH &&
    plan.role === "authoritative_final_routing_projection" &&
    isRecord(ledger) &&
    exactKeySet(ledger, ["path", "role"]) &&
    ledger.path === VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH &&
    ledger.role === "exact_model_review_and_replacement_audit"
  );
}

function isExecutabilityPacketEnvelope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasAuditContext = Object.prototype.hasOwnProperty.call(value, "auditContext");
  const hasConstraints = Object.prototype.hasOwnProperty.call(value, "wholeGardenConstraints");
  const hasPreviousProtocolFailure = Object.prototype.hasOwnProperty.call(value, "previousProtocolFailure");
  const hasPreviousSemanticFailure = Object.prototype.hasOwnProperty.call(value, "previousSemanticFailure");
  if (!exactKeySet(value, [
    "schemaVersion",
    "protocolVersion",
    "gardenId",
    ...(hasAuditContext ? ["auditContext"] : []),
    "units",
    "technicalCapabilities",
    ...(hasConstraints ? ["wholeGardenConstraints"] : []),
    "previousRejectionReasons",
    ...(hasPreviousProtocolFailure ? ["previousProtocolFailure"] : []),
    ...(hasPreviousSemanticFailure ? ["previousSemanticFailure"] : []),
  ])) return false;
  if (
    value.schemaVersion !== VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION ||
    value.protocolVersion !== VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION ||
    !compact(value.gardenId) ||
    !Array.isArray(value.units) ||
    !isStringArray(value.previousRejectionReasons) ||
    (hasAuditContext && !isLedgerContextEnvelope(value.auditContext)) ||
    !isRecord(value.technicalCapabilities) ||
    !exactKeySet(value.technicalCapabilities, ["manifestVersion", "manifestHash", "manifest"]) ||
    (hasConstraints && !isWholeGardenConstraintsEnvelope(value.wholeGardenConstraints)) ||
    (hasPreviousProtocolFailure && !isProtocolFailureEnvelope(value.previousProtocolFailure)) ||
    (hasPreviousSemanticFailure && !isSemanticFailureEnvelope(value.previousSemanticFailure))
  ) return false;
  return value.units.every((unit) =>
    isRecord(unit) &&
    exactKeySet(unit, [
      "unitId",
      "title",
      "role",
      "learningQuestion",
      "prerequisiteConcepts",
      "concepts",
      "necessity",
      "requirement",
      "contract",
      "canonicalEvidence",
    ]) &&
    Boolean(compact(unit.unitId)) &&
    typeof unit.title === "string" &&
    typeof unit.role === "string" &&
    typeof unit.learningQuestion === "string" &&
    isStringArray(unit.prerequisiteConcepts) &&
    isStringArray(unit.concepts) &&
    isActiveRequirementValue(unit.necessity) &&
    unit.requirement === unit.necessity &&
    isCompleteContractEnvelope(unit.contract) &&
    (unit.contract as Record<string, unknown>).unitId === unit.unitId &&
    Array.isArray(unit.canonicalEvidence) &&
    unit.canonicalEvidence.every(isCanonicalEvidenceEntryEnvelope));
}

function isStructuralRepairPacketEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeySet(value, ["problems", "units", "previousRejectionReasons"]) &&
    isStringArray(value.problems) &&
    isStringArray(value.previousRejectionReasons) &&
    Array.isArray(value.units) &&
    value.units.every((unit) =>
      isRecord(unit) &&
      exactKeySet(unit, [
        "unitId",
        "title",
        "role",
        "requirement",
        "interactionGoal",
        "learnerAction",
        "learningObjective",
        "evidence",
      ]) &&
      Boolean(compact(unit.unitId)) &&
      typeof unit.title === "string" &&
      typeof unit.role === "string" &&
      isActiveRequirementValue(unit.requirement) &&
      typeof unit.interactionGoal === "string" &&
      typeof unit.learnerAction === "string" &&
      typeof unit.learningObjective === "string" &&
      Array.isArray(unit.evidence) &&
      unit.evidence.every(isCanonicalEvidenceEntryEnvelope))
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
    "protocolRejections",
    "wholeGardenConstraints",
    "authoritativePlanPolicy",
    "immutableGardenAllocation",
    "structuralContractRepair",
    "artifactProvenance",
    "attempts",
    "units",
    "integrityHash",
  ])) {
    problems.push("executability ledger top-level fields are missing or unexpected");
  }
  if (value.schemaVersion !== VISUAL_CONTRACT_EXECUTABILITY_LEDGER_SCHEMA_VERSION) {
    problems.push("executability ledger schemaVersion is invalid");
  }
  if (!compact(value.gardenId)) problems.push("executability ledger gardenId is missing");
  if (!isIsoTimestamp(value.generatedAt)) problems.push("executability ledger generatedAt is invalid");
  if (
    !isRecord(value.callAccounting) ||
    !exactKeySet(value.callAccounting, [
      "protocolVersion",
      "maximumSemanticCandidates",
      "maximumProtocolRetries",
      "maximumProviderInvocations",
      "providerInvocations",
      "semanticCandidates",
      "protocolRetries",
      "protocolRejections",
      "transportAttempts",
    ]) ||
    value.callAccounting.protocolVersion !== VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION ||
    !Number.isInteger(value.callAccounting.maximumSemanticCandidates) ||
    Number(value.callAccounting.maximumSemanticCandidates) < 1 ||
    Number(value.callAccounting.maximumSemanticCandidates) >
      VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET.maximumTotalCalls ||
    value.callAccounting.maximumProtocolRetries !==
      VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET.maximumProtocolRetries ||
    !Number.isInteger(value.callAccounting.maximumProviderInvocations) ||
    value.callAccounting.maximumProviderInvocations !==
      Math.min(
        VISUAL_CONTRACT_EXECUTABILITY_CALL_BUDGET.maximumProviderInvocations,
        Number(value.callAccounting.maximumSemanticCandidates) +
          Number(value.callAccounting.maximumProtocolRetries),
      ) ||
    !Number.isInteger(value.callAccounting.providerInvocations) ||
    Number(value.callAccounting.providerInvocations) < 0 ||
    !Number.isInteger(value.callAccounting.semanticCandidates) ||
    Number(value.callAccounting.semanticCandidates) < 0 ||
    !Number.isInteger(value.callAccounting.protocolRetries) ||
    Number(value.callAccounting.protocolRetries) < 0 ||
    !Number.isInteger(value.callAccounting.protocolRejections) ||
    Number(value.callAccounting.protocolRejections) < 0 ||
    value.callAccounting.transportAttempts !== "not_observable_below_provider_boundary"
  ) {
    problems.push("executability ledger semantic/transport call accounting is invalid");
  }
  if (!Number.isInteger(value.rejectedReviews) || Number(value.rejectedReviews) < 0) {
    problems.push("executability ledger rejectedReviews is invalid");
  }
  if (!Number.isInteger(value.protocolRejections) || Number(value.protocolRejections) < 0) {
    problems.push("executability ledger protocolRejections is invalid");
  }
  if (!isWholeGardenConstraintsEnvelope(value.wholeGardenConstraints)) {
    problems.push("executability ledger whole-garden constraints are invalid");
  }
  if (
    !isRecord(value.authoritativePlanPolicy) ||
    !exactKeySet(value.authoritativePlanPolicy, [
      "visualBudget",
      "visualDecisionOverrides",
      "necessityReviewCalls",
      "rejectedNecessityReviews",
      "opportunitiesExcludingMechanicalPlacement",
      "routeDecisions",
    ]) ||
    !isRecord(value.authoritativePlanPolicy.visualBudget) ||
    !Array.isArray(value.authoritativePlanPolicy.visualDecisionOverrides) ||
    !value.authoritativePlanPolicy.visualDecisionOverrides.every(isRecord) ||
    !Array.isArray(value.authoritativePlanPolicy.opportunitiesExcludingMechanicalPlacement) ||
    !value.authoritativePlanPolicy.opportunitiesExcludingMechanicalPlacement.every(isRecord) ||
    !Array.isArray(value.authoritativePlanPolicy.routeDecisions) ||
    !value.authoritativePlanPolicy.routeDecisions.every(isRecord) ||
    !Number.isInteger(value.authoritativePlanPolicy.necessityReviewCalls) ||
    Number(value.authoritativePlanPolicy.necessityReviewCalls) < 0 ||
    !Number.isInteger(value.authoritativePlanPolicy.rejectedNecessityReviews) ||
    Number(value.authoritativePlanPolicy.rejectedNecessityReviews) < 0
  ) {
    problems.push("executability ledger authoritative plan policy is invalid");
  }
  if (!Array.isArray(value.attempts)) problems.push("executability ledger attempts must be an array");
  if (!Array.isArray(value.units)) problems.push("executability ledger units must be an array");
  if (!Array.isArray(value.immutableGardenAllocation)) {
    problems.push("executability ledger immutable garden allocation must be an array");
  } else {
    value.immutableGardenAllocation.forEach((allocation, index) => {
      if (
        !isRecord(allocation) ||
        !exactKeySet(allocation, [
          "unitId",
          "requirement",
          "decisionBeforeMechanicalRouting",
          "teachingMediumPlan",
        ]) ||
        !compact(allocation.unitId) ||
        !compact(allocation.requirement) ||
        !isRecord(allocation.decisionBeforeMechanicalRouting) ||
        !isRecord(allocation.teachingMediumPlan)
      ) {
        problems.push(`executability ledger immutable allocation ${index + 1} is invalid`);
      }
    });
  }
  if (value.scope !== "current_phase_only_generation_replaces_planning_ledger") {
    problems.push("executability ledger scope is invalid");
  }
  if (!isLedgerContextEnvelope(value.context)) {
    problems.push("executability ledger context fields are invalid");
  }
  if (
    !isRecord(value.technicalCapabilities) ||
    !exactKeySet(value.technicalCapabilities, ["manifestVersion", "manifestHash", "sdkVersion"])
  ) {
    problems.push("executability ledger technical capability fields are invalid");
  }
  if (
    !isRecord(value.auditHashing) ||
    !exactKeySet(value.auditHashing, [
      "algorithm",
      "serialization",
      "responseSchemaHash",
      "protocolVersion",
    ]) ||
    value.auditHashing.algorithm !== "sha256" ||
    value.auditHashing.serialization !== "JSON.stringify_utf8_v2_exact_raw_provider_text" ||
    value.auditHashing.responseSchemaHash !== VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA_HASH ||
    value.auditHashing.protocolVersion !== VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION
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
          "startedAt",
          "completedAt",
          "packet",
          "packetHash",
          "requestHash",
          "systemPromptHash",
          "responseSchemaHash",
          "canonicalEvidenceHashes",
          "transportAccounting",
          "accepted",
          "responseEncoding",
          "response",
          "rejectionReasons",
          "appliedUnitIds",
        ]) ||
        !isStructuralRepairPacketEnvelope(attempt.packet) ||
        !isRecord(attempt.canonicalEvidenceHashes) ||
        !Object.values(attempt.canonicalEvidenceHashes).every((hash) =>
          SHA256_HEX_PATTERN.test(String(hash))) ||
        !isTransportAccountingEnvelope(attempt.transportAccounting) ||
        !isStringArray(attempt.rejectionReasons) ||
        !isStringArray(attempt.appliedUnitIds) ||
        !Number.isInteger(attempt.attempt) ||
        typeof attempt.accepted !== "boolean" ||
        !isIsoTimestamp(attempt.startedAt) ||
        !isIsoTimestamp(attempt.completedAt)
      ) {
        problems.push(`executability ledger structural repair attempt ${index + 1} fields are invalid`);
      }
    });
  }
  if (!isArtifactProvenanceEnvelope(value.artifactProvenance)) {
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
          "requestPurpose",
          "responseClassification",
          "packet",
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
          "exactRawResponseSha256",
          "rejectionReasons",
        ]) ||
        !isRecord(attempt.canonicalEvidenceHashes) ||
        !Object.values(attempt.canonicalEvidenceHashes).every((hash) =>
          SHA256_HEX_PATTERN.test(String(hash))) ||
        !isExecutabilityPacketEnvelope(attempt.packet) ||
        !isExecutabilityTransportAccountingEnvelope(attempt.transportAccounting) ||
        !Array.isArray(attempt.rejectionReasons) ||
        !attempt.rejectionReasons.every(isExecutabilityProblemEnvelope) ||
        !Number.isInteger(attempt.attempt) ||
        (attempt.requestPurpose !== "initial_semantic_review" &&
          attempt.requestPurpose !== "protocol_retry" &&
          attempt.requestPurpose !== "semantic_rereview") ||
        (attempt.responseClassification !== "protocol_rejection" &&
          attempt.responseClassification !== "semantic_candidate") ||
        typeof attempt.accepted !== "boolean" ||
        !isExactRawResponseEnvelope({
          responseEncoding: attempt.responseEncoding,
          response: attempt.response,
          exactRawResponseSha256: attempt.exactRawResponseSha256,
        }) ||
        !isIsoTimestamp(attempt.startedAt) ||
        !isIsoTimestamp(attempt.completedAt)
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
        !isCompleteContractEnvelope(unit.beforeReviewContract) ||
        !isCompleteContractEnvelope(unit.reviewedContractBeforeMechanicalRouting) ||
        !isCompleteContractEnvelope(unit.finalRoutedContract) ||
        !isRecord(unit.mechanicalRouting) ||
        !exactKeySet(unit.mechanicalRouting, [
          "opportunityId",
          "decision",
          "reviewedRecommendedVisualType",
          "projectedVisualType",
        ]) ||
        !compact(unit.mechanicalRouting.opportunityId) ||
        !isRecord(unit.mechanicalRouting.decision) ||
        !compact(unit.mechanicalRouting.projectedVisualType)
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

/**
 * Strict linkage must be able to replay a rejected parsed candidate rather
 * than trusting the candidate's self-authored rejection text.  The durable
 * ledger deliberately stores complete pre-review contracts and canonical
 * evidence, so this only reprojects those signed inputs; it never repairs or
 * fills a model contract.  A synthetic map is sufficient for the existing
 * whole-plan validator because placement is not a semantic input to the
 * executability review, while the original section/unit topology remains
 * bound by `wholeGardenConstraints`.
 */
interface ExecutabilitySemanticReplayInput {
  learningUnits: LearningUnitContract[];
  canonicalEvidenceByUnit: VisualizationCanonicalEvidenceByUnit;
  learningMap: ProposedLearningMap;
}

function executabilitySemanticReplayInputFromLedger(input: {
  ledger: VisualContractExecutabilityLedger;
  finalLearningUnits: LearningUnitContract[];
}): ExecutabilitySemanticReplayInput | null {
  const activeUnits = input.finalLearningUnits.filter((unit) => activeRequirement(unit));
  const activeIds = activeUnits.map((unit) => unit.id);
  const initialPacket = input.ledger.attempts[0]?.packet;
  if (!initialPacket || !isDeepStrictEqual(initialPacket.units.map((unit) => unit.unitId), activeIds)) {
    return null;
  }
  const ledgerByUnit = new Map(input.ledger.units.map((unit) => [unit.unitId, unit]));
  const allocationByUnit = new Map(
    input.ledger.immutableGardenAllocation.map((allocation) => [allocation.unitId, allocation]),
  );
  if (
    activeUnits.some((unit) => !ledgerByUnit.has(unit.id)) ||
    input.finalLearningUnits.some((unit) => !allocationByUnit.has(unit.id))
  ) return null;
  const canonicalEvidenceByUnit = Object.fromEntries(
    initialPacket.units.map((unit) => [unit.unitId, cloneExact(unit.canonicalEvidence)]),
  ) as VisualizationCanonicalEvidenceByUnit;
  const beforeResponse: VisualContractExecutabilityResponse = {
    schemaVersion: VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION,
    gardenId: input.ledger.gardenId,
    reviews: activeIds.map((unitId) => ({
      unitId,
      verdict: "replace" as const,
      reason: "Rebind the immutable signed pre-review contract for strict ledger replay.",
      replacement: cloneExact(ledgerByUnit.get(unitId)!.beforeReviewContract),
    })),
  };
  // Final routed units may have a projected visual type in their decision.
  // Rejected candidates were evaluated before that mechanical route existed,
  // so restore the signed allocation and teaching-medium state first. The
  // following verbatim replacement then restores the signed pre-review
  // interaction contract for every active unit.
  const preRoutingUnits: LearningUnitContract[] = [];
  for (const unit of input.finalLearningUnits) {
    const allocation = allocationByUnit.get(unit.id);
    const plan = unit.interactiveVisualPlan;
    if (!allocation || !plan || !isRecord(allocation.decisionBeforeMechanicalRouting)) return null;
    preRoutingUnits.push({
      ...unit,
      interactiveVisualPlan: {
        ...plan,
        decision: cloneExact(
          allocation.decisionBeforeMechanicalRouting,
        ) as unknown as NonNullable<LearningUnitContract["interactiveVisualPlan"]>["decision"],
      },
      teachingMediumPlan: cloneExact(allocation.teachingMediumPlan),
    });
  }
  const rebound = applyVerbatimReplacements({
    learningUnits: preRoutingUnits,
    response: beforeResponse,
    canonicalEvidenceByUnit,
  });
  if (!rebound.ok) return null;

  const sections = new Map<string, ProposedLearningMap["sections"][number]>();
  for (const unit of rebound.learningUnits) {
    const sectionId = input.ledger.wholeGardenConstraints.sectionByUnit[unit.id];
    if (!compact(sectionId)) return null;
    const section = sections.get(sectionId) ?? {
      title: sectionId,
      purpose: unit.sectionPlan?.purpose ?? sectionId,
      sourceAnchors: [],
      subsections: [],
    };
    if (!sections.has(sectionId)) sections.set(sectionId, section);
    section.subsections.push({
      title: unit.title,
      purpose: unit.sectionPlan?.purpose ?? unit.learningQuestion,
      sourceAnchors: [...unit.sourceAnchors],
      visualOpportunities: [],
      conceptTags: [...unit.newConcepts],
      sourceVisualIds: [],
      interactiveVisuals: [],
      learningUnitId: unit.id,
    });
    for (const anchor of unit.sourceAnchors) {
      if (!section.sourceAnchors.includes(anchor)) section.sourceAnchors.push(anchor);
    }
  }
  return {
    learningUnits: rebound.learningUnits,
    canonicalEvidenceByUnit,
    learningMap: {
      gardenId: input.ledger.gardenId,
      title: "Signed executability replay",
      summary: "Strict replay-only map reconstructed from the ledger's immutable unit topology.",
      sections: [...sections.values()],
      warnings: [],
      sourceOnly: true,
      createdAt: input.ledger.generatedAt,
    },
  };
}

function replaySemanticCandidateRejectionProblems(input: {
  ledger: VisualContractExecutabilityLedger;
  replay: ExecutabilitySemanticReplayInput;
  activeUnitIds: string[];
  attempt: VisualContractExecutabilityAttempt;
}): VisualContractExecutabilityProblem[] {
  const parsed = parseVisualContractExecutabilityResponse({
    value: parsedVisualContractExecutabilityAttemptResponse(input.attempt),
    gardenId: input.ledger.gardenId,
    activeUnitIds: input.activeUnitIds,
  });
  if (!parsed.ok) return cloneExact(parsed.problems);
  const applied = applyVerbatimReplacements({
    learningUnits: input.replay.learningUnits,
    response: parsed.response,
    canonicalEvidenceByUnit: input.replay.canonicalEvidenceByUnit,
  });
  if (!applied.ok) return cloneExact(applied.problems);
  const globalProblems = reviewedWholeGardenConstraintProblems({
    beforeUnits: input.replay.learningUnits,
    reviewedUnits: applied.learningUnits,
    constraints: input.ledger.wholeGardenConstraints,
  });
  if (globalProblems.length > 0) return cloneExact(globalProblems);
  try {
    buildVisualizationPlan({
      gardenId: input.ledger.gardenId,
      learningMap: input.replay.learningMap,
      learningUnits: applied.learningUnits,
      visualBudget: input.ledger.authoritativePlanPolicy.visualBudget,
      canonicalEvidenceByUnit: input.replay.canonicalEvidenceByUnit,
      necessityReviewCalls: input.ledger.authoritativePlanPolicy.necessityReviewCalls,
      rejectedNecessityReviews: input.ledger.authoritativePlanPolicy.rejectedNecessityReviews,
      visualDecisionOverrides: input.ledger.authoritativePlanPolicy.visualDecisionOverrides,
    });
  } catch (error) {
    return [{
      code: "global_contract_validation_failed",
      path: "whole_garden",
      message: error instanceof Error ? error.message : String(error),
    }];
  }
  return [];
}

export function visualContractExecutabilityLinkageProblems(input: {
  gardenId: string;
  ledger: VisualContractExecutabilityLedger | null;
  finalLearningUnits: LearningUnitContract[];
  visualizationPlan: VisualizationPlan | null;
  requireGenerationPhase?: boolean;
  /** Independently rebuilt from durable garden source anchors by finalization. */
  authoritativeCanonicalEvidenceByUnit?: VisualizationCanonicalEvidenceByUnit;
  /** Supplied by the active Learn run, never reconstructed from the ledger itself. */
  expectedContext?: VisualContractExecutabilityLedgerContext;
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
  if (input.expectedContext) {
    if (!isDeepStrictEqual(ledger.context, input.expectedContext)) {
      problems.push("executability ledger context differs from the authoritative Learn run context");
    }
  } else if (input.requireGenerationPhase) {
    problems.push("authoritative Learn run context was not supplied to final executability linkage");
  }
  if (input.requireGenerationPhase && !input.authoritativeCanonicalEvidenceByUnit) {
    problems.push("canonical visualization evidence was not rebuilt from durable garden sources");
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
  const finalPlanPolicy = clonePersistedJson({
    visualBudget: plan.visualBudget,
    visualDecisionOverrides: plan.visualDecisionOverrides,
    necessityReviewCalls: plan.necessityReviewCalls,
    rejectedNecessityReviews: plan.rejectedNecessityReviews,
    opportunitiesExcludingMechanicalPlacement: plan.opportunities.map(
      boundVisualizationOpportunity,
    ),
    routeDecisions: plan.decisions,
  });
  if (!isDeepStrictEqual(ledger.authoritativePlanPolicy, finalPlanPolicy)) {
    problems.push(
      "visualization plan opportunities, routes, budget, overrides, or necessity-review counters differ from the ledger",
    );
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
  const ledgerByUnit = new Map(ledger.units.map((item) => [item.unitId, item]));
  const finalUnitById = new Map(input.finalLearningUnits.map((unit) => [unit.id, unit]));
  const allocationByUnit = new Map(
    ledger.immutableGardenAllocation.map((item) => [item.unitId, item]),
  );
  if (!isDeepStrictEqual(ledgerIds, activeIds)) {
    problems.push("executability ledger units do not exactly match active final learning units in order");
  }
  if (new Set(ledgerIds).size !== ledgerIds.length) {
    problems.push("executability ledger contains duplicate unit records");
  }
  for (const unit of input.finalLearningUnits) {
    if (ledger.wholeGardenConstraints.sectionByUnit[unit.id] !== unit.sectionPlan?.id) {
      problems.push(
        `${unit.id}: reviewed whole-garden section mapping differs from the final learning-unit section`,
      );
    }
  }
  if (ledger.callAccounting.providerInvocations !== ledger.attempts.length) {
    problems.push("executability ledger providerInvocations does not equal its persisted attempt count");
  }
  if (
    ledger.callAccounting.providerInvocations >
    ledger.callAccounting.maximumProviderInvocations
  ) {
    problems.push("executability ledger exceeds its bound physical provider-invocation budget");
  }
  const acceptedAttempts = ledger.attempts.filter((attempt) => attempt.accepted);
  const semanticAttempts = ledger.attempts.filter(
    (attempt) => attempt.responseClassification === "semantic_candidate",
  );
  const protocolAttempts = ledger.attempts.filter(
    (attempt) => attempt.responseClassification === "protocol_rejection",
  );
  const rejectedSemanticAttempts = semanticAttempts.filter((attempt) => !attempt.accepted);
  const protocolRetryRequests = ledger.attempts.filter(
    (attempt) => attempt.requestPurpose === "protocol_retry",
  );
  const semanticReplay = rejectedSemanticAttempts.length > 0
    ? executabilitySemanticReplayInputFromLedger({
      ledger,
      finalLearningUnits: input.finalLearningUnits,
    })
    : null;
  if (rejectedSemanticAttempts.length > 0 && !semanticReplay) {
    problems.push(
      "executability ledger cannot reconstruct signed pre-review inputs for semantic rejection replay",
    );
  }
  if (ledger.callAccounting.semanticCandidates !== semanticAttempts.length) {
    problems.push("executability ledger semanticCandidates does not equal its parsed-candidate attempt count");
  }
  if (ledger.callAccounting.protocolRejections !== protocolAttempts.length) {
    problems.push("executability ledger protocolRejections does not equal its raw protocol-rejection count");
  }
  if (ledger.callAccounting.protocolRetries !== protocolRetryRequests.length) {
    problems.push("executability ledger protocolRetries does not equal its protocol-retry request count");
  }
  if (
    ledger.callAccounting.semanticCandidates >
    ledger.callAccounting.maximumSemanticCandidates
  ) {
    problems.push("executability ledger exceeds its persisted semantic-candidate cap");
  }
  if (
    ledger.callAccounting.protocolRetries >
    ledger.callAccounting.maximumProtocolRetries
  ) {
    problems.push("executability ledger exceeds its persisted protocol-retry cap");
  }
  if (ledger.rejectedReviews !== rejectedSemanticAttempts.length) {
    problems.push("executability ledger rejectedReviews does not equal its rejected parsed-candidate count");
  }
  if (ledger.protocolRejections !== protocolAttempts.length) {
    problems.push("executability ledger protocolRejections does not equal its protocol-rejection attempt count");
  }
  if (activeIds.length === 0) {
    if (ledger.callAccounting.providerInvocations !== 0 || acceptedAttempts.length !== 0) {
      problems.push("executability ledger recorded model calls despite having no active units");
    }
  } else if (
    acceptedAttempts.length !== 1 ||
    !ledger.attempts.at(-1)?.accepted
  ) {
    problems.push("executability ledger must end with exactly one accepted semantic review attempt");
  }
  const initialEvidenceByUnit = new Map(
    (ledger.attempts[0]?.packet.units ?? []).map((unit) => [unit.unitId, unit.canonicalEvidence]),
  );
  let expectedPreviousProtocolFailure: VisualContractExecutabilityProtocolFailure | undefined;
  let expectedPreviousSemanticFailure: VisualContractExecutabilitySemanticFailure | undefined;
  let expectedPreviousProtocolProblems: VisualContractExecutabilityProblem[] = [];
  let expectedPreviousSemanticProblems: VisualContractExecutabilityProblem[] = [];
  let expectedPreviousClassification: VisualContractExecutabilityAttempt["responseClassification"] | null = null;
  let expectedSemanticCandidate = 0;
  let expectedProtocolRetry = 0;
  ledger.attempts.forEach((attempt, index) => {
    const expectedAttempt = index + 1;
    const packet = attempt.packet;
    const expectedRequestPurpose: VisualContractExecutabilityAttempt["requestPurpose"] =
      index === 0
        ? "initial_semantic_review"
        : expectedPreviousClassification === "protocol_rejection"
          ? "protocol_retry"
          : "semantic_rereview";
    if (expectedRequestPurpose === "protocol_retry") expectedProtocolRetry += 1;
    if (
      attempt.attempt !== expectedAttempt ||
      attempt.requestPurpose !== expectedRequestPurpose ||
      attempt.transportAccounting?.providerInvocation !== expectedAttempt ||
      attempt.transportAccounting?.protocolRetry !==
        (expectedRequestPurpose === "protocol_retry" ? expectedProtocolRetry : null) ||
      attempt.transportAccounting?.providerInvocationsAtThisBoundary !== 1 ||
      attempt.transportAccounting?.transportRetries !==
        "owned_below_semantic_boundary_not_counted"
    ) {
      problems.push(`executability ledger attempt ${expectedAttempt} has invalid invocation/protocol accounting`);
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
    const priorAttempt = ledger.attempts[index - 1];
    if (
      priorAttempt &&
      Date.parse(attempt.startedAt) < Date.parse(priorAttempt.completedAt)
    ) {
      problems.push(`executability ledger attempt ${expectedAttempt} starts before the prior attempt completed`);
    }
    if (Date.parse(attempt.completedAt) > Date.parse(ledger.generatedAt)) {
      problems.push(`executability ledger attempt ${expectedAttempt} completes after ledger generation`);
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
    if (attempt.packetHash !== sha256Json(packet)) {
      problems.push(`executability ledger attempt ${expectedAttempt} packetHash does not match its packet`);
    }
    const reconstructedPrompt = buildVisualContractExecutabilityPrompt(packet);
    if (
      attempt.requestHash !== sha256Json({
        system: reconstructedPrompt.system,
        user: reconstructedPrompt.user,
      })
    ) {
      problems.push(`executability ledger attempt ${expectedAttempt} requestHash does not match its request`);
    }
    if (
      packet.schemaVersion !== VISUAL_CONTRACT_EXECUTABILITY_SCHEMA_VERSION ||
      packet.protocolVersion !== VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION ||
      packet.gardenId !== input.gardenId ||
      !isDeepStrictEqual(packet.auditContext, ledger.context) ||
      !isDeepStrictEqual(packet.technicalCapabilities, {
        manifestVersion: GENERATED_VISUAL_CAPABILITY_MANIFEST_VERSION,
        manifestHash: GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
        manifest: GENERATED_VISUAL_CAPABILITY_MANIFEST,
      }) ||
      !isDeepStrictEqual(packet.wholeGardenConstraints, ledger.wholeGardenConstraints)
    ) {
      problems.push(`executability ledger attempt ${expectedAttempt} packet metadata is stale`);
    }
    const packetUnitIds = packet.units.map((unit) => unit.unitId);
    if (!isDeepStrictEqual(packetUnitIds, activeIds)) {
      problems.push(`executability ledger attempt ${expectedAttempt} packet units are incomplete`);
    }
    for (const packetUnit of packet.units) {
      const ledgerUnit = ledgerByUnit.get(packetUnit.unitId);
      const finalUnit = finalUnitById.get(packetUnit.unitId);
      const allocation = allocationByUnit.get(packetUnit.unitId);
      if (
        !ledgerUnit ||
        !isDeepStrictEqual(packetUnit.contract, ledgerUnit.beforeReviewContract)
      ) {
        problems.push(
          `executability ledger attempt ${expectedAttempt} packet contract for ${packetUnit.unitId} differs from the reviewed input`,
        );
      }
      const expectedMetadata = finalUnit && allocation ? {
        unitId: finalUnit.id,
        title: finalUnit.title,
        role: finalUnit.role,
        learningQuestion: finalUnit.learningQuestion,
        prerequisiteConcepts: finalUnit.prerequisiteConcepts,
        concepts: [
          ...finalUnit.newConcepts,
          ...(finalUnit.semanticConcepts ?? []).flatMap((concept) => [
            concept.slug,
            concept.preferredLabel,
            ...concept.aliases,
          ]),
        ],
        necessity: finalUnit.interactiveVisualPlan?.decision.necessity,
        requirement: allocation.requirement,
      } : null;
      const packetMetadata = {
        unitId: packetUnit.unitId,
        title: packetUnit.title,
        role: packetUnit.role,
        learningQuestion: packetUnit.learningQuestion,
        prerequisiteConcepts: packetUnit.prerequisiteConcepts,
        concepts: packetUnit.concepts,
        necessity: packetUnit.necessity,
        requirement: packetUnit.requirement,
      };
      const metadataMatches = expectedMetadata &&
        isDeepStrictEqual(
          { ...packetMetadata, concepts: undefined },
          { ...expectedMetadata, concepts: undefined },
        ) &&
        sameStringMultiset(packetMetadata.concepts, expectedMetadata.concepts);
      if (!metadataMatches) {
        problems.push(
          `executability ledger attempt ${expectedAttempt} packet metadata for ${packetUnit.unitId} differs from the final immutable unit`,
        );
      }
      if (!isDeepStrictEqual(
        packetUnit.canonicalEvidence,
        initialEvidenceByUnit.get(packetUnit.unitId),
      )) {
        problems.push(
          `executability ledger attempt ${expectedAttempt} canonical evidence for ${packetUnit.unitId} differs across attempts`,
        );
      }
      const authoritativeEvidence =
        input.authoritativeCanonicalEvidenceByUnit?.[packetUnit.unitId];
      if (
        input.authoritativeCanonicalEvidenceByUnit &&
        !isDeepStrictEqual(packetUnit.canonicalEvidence, authoritativeEvidence)
      ) {
        problems.push(
          `executability ledger attempt ${expectedAttempt} canonical evidence for ${packetUnit.unitId} differs from durable garden sources`,
        );
      }
    }
    const recomputedEvidenceHashes = Object.fromEntries(
      packet.units.map((unit) => [unit.unitId, sha256Json(unit.canonicalEvidence)]),
    );
    if (!isDeepStrictEqual(attempt.canonicalEvidenceHashes, recomputedEvidenceHashes)) {
      problems.push(`executability ledger attempt ${expectedAttempt} evidence hashes do not match its packet`);
    }
    const expectedPriorReasons = [
      ...(expectedPreviousSemanticFailure
        ? expectedPreviousSemanticProblems.map((item) => `${item.path}: ${item.message}`)
        : []),
      ...(expectedPreviousProtocolFailure
        ? expectedPreviousProtocolProblems.map((item) => `${item.path}: ${item.message}`)
        : []),
    ];
    if (!isDeepStrictEqual(packet.previousRejectionReasons, expectedPriorReasons)) {
      problems.push(`executability ledger attempt ${expectedAttempt} previous rejection reasons are not exact`);
    }
    if (
      !isDeepStrictEqual(packet.previousProtocolFailure, expectedPreviousProtocolFailure) ||
      !isDeepStrictEqual(packet.previousSemanticFailure, expectedPreviousSemanticFailure)
    ) {
      problems.push(`executability ledger attempt ${expectedAttempt} prior raw protocol/semantic feedback is not exact`);
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
    if (!isExactRawResponseEnvelope({
      responseEncoding: attempt.responseEncoding,
      response: attempt.response,
      exactRawResponseSha256: attempt.exactRawResponseSha256,
    })) {
      problems.push(`executability ledger attempt ${expectedAttempt} response encoding is invalid`);
    }
    const responseParses = exactRawVisualContractExecutabilityAttemptParses(attempt);
    if (attempt.responseClassification === "protocol_rejection") {
      const recomputedProtocol = normalizedVisualContractExecutabilityProviderResponse(
        attempt.responseEncoding === "undefined" ? undefined : attempt.response,
      );
      if (
        attempt.accepted ||
        attempt.transportAccounting.semanticCandidate !== null ||
        attempt.transportAccounting.protocolRetry !==
          (expectedRequestPurpose === "protocol_retry" ? expectedProtocolRetry : null) ||
        attempt.rejectionReasons.length === 0 ||
        (attempt.responseEncoding === "exact_raw" && responseParses)
      ) {
        problems.push(`executability ledger protocol attempt ${expectedAttempt} is not an exact rejected raw response`);
      }
      if (
        !recomputedProtocol.protocolProblems ||
        recomputedProtocol.terminalProtocolFailure ||
        !isDeepStrictEqual(attempt.rejectionReasons, recomputedProtocol.protocolProblems)
      ) {
        problems.push(`executability ledger protocol attempt ${expectedAttempt} rejection diagnostic is not exact`);
      }
      expectedPreviousProtocolFailure = {
        providerInvocation: expectedAttempt,
        protocolRetry: expectedRequestPurpose === "protocol_retry" ? expectedProtocolRetry : 0,
        responseEncoding: attempt.responseEncoding,
        response: attempt.response as string | null,
        exactRawResponseSha256: attempt.exactRawResponseSha256,
        rejectionReasons: attempt.rejectionReasons.map((item) => `${item.path}: ${item.message}`),
      };
      expectedPreviousProtocolProblems = cloneExact(attempt.rejectionReasons);
    } else {
      expectedSemanticCandidate += 1;
      if (
        !responseParses ||
        attempt.transportAccounting.semanticCandidate !== expectedSemanticCandidate ||
        attempt.transportAccounting.protocolRetry !==
          (expectedRequestPurpose === "protocol_retry" ? expectedProtocolRetry : null)
      ) {
        problems.push(`executability ledger semantic candidate ${expectedAttempt} has invalid raw/invocation accounting`);
      }
      // A parseable candidate clears byte-level feedback before its semantic
      // result is evaluated, matching the live dispatcher.
      expectedPreviousProtocolFailure = undefined;
      expectedPreviousProtocolProblems = [];
      if (!attempt.accepted) {
        const recomputedSemanticProblems = semanticReplay
          ? replaySemanticCandidateRejectionProblems({
            ledger,
            replay: semanticReplay,
            activeUnitIds: activeIds,
            attempt,
          })
          : null;
        if (
          !recomputedSemanticProblems ||
          recomputedSemanticProblems.length === 0 ||
          !isDeepStrictEqual(attempt.rejectionReasons, recomputedSemanticProblems)
        ) {
          problems.push(
            `executability ledger semantic candidate ${expectedAttempt} rejection diagnostic is not exact`,
          );
        }
        expectedPreviousSemanticFailure = {
          providerInvocation: expectedAttempt,
          semanticCandidate: expectedSemanticCandidate,
          responseEncoding: "exact_raw",
          response: attempt.response as string,
          exactRawResponseSha256: attempt.exactRawResponseSha256 as string,
          rejectionReasons: attempt.rejectionReasons.map((item) => `${item.path}: ${item.message}`),
        };
        expectedPreviousSemanticProblems = cloneExact(attempt.rejectionReasons);
      }
    }
    expectedPreviousClassification = attempt.responseClassification;
  });

  if (acceptedAttempts.length === 1) {
    const acceptedParsed = parseVisualContractExecutabilityResponse({
      value: parsedVisualContractExecutabilityAttemptResponse(acceptedAttempts[0]),
      gardenId: input.gardenId,
      activeUnitIds: activeIds,
    });
    if (!acceptedParsed.ok) {
      problems.push("executability ledger accepted attempt no longer contains a valid exact response");
    } else {
      // Review arrays are a complete batch, not an ordered protocol. Preserve
      // the model's exact array in the accepted attempt while linking each
      // durable unit record by its immutable unit id.
      const acceptedReviewByUnit = new Map(
        acceptedParsed.response.reviews.map((review) => [review.unitId, review]),
      );
      if (
        acceptedReviewByUnit.size !== ledger.units.length ||
        ledger.units.some((unit) =>
          !isDeepStrictEqual(acceptedReviewByUnit.get(unit.unitId), unit.acceptedReview))
      ) {
        problems.push("executability ledger unit verdicts differ from the accepted exact response");
      }
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
    if (structuralRepair.attempts.length > 3) {
      problems.push("executability ledger structural repair exceeds its three-call hard bound");
    }
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
      if (
        !isIsoTimestamp(attempt.startedAt) ||
        !isIsoTimestamp(attempt.completedAt) ||
        Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)
      ) {
        problems.push(`executability ledger structural repair attempt ${index + 1} has invalid timestamps`);
      }
      const priorStructuralAttempt = structuralRepair.attempts[index - 1];
      if (
        priorStructuralAttempt &&
        Date.parse(attempt.startedAt) < Date.parse(priorStructuralAttempt.completedAt)
      ) {
        problems.push(
          `executability ledger structural repair attempt ${index + 1} starts before the prior attempt completed`,
        );
      }
      if (Date.parse(attempt.completedAt) > Date.parse(ledger.generatedAt)) {
        problems.push(
          `executability ledger structural repair attempt ${index + 1} completes after ledger generation`,
        );
      }
      if (
        attempt.transportAccounting?.logicalSemanticCall !== index + 1 ||
        attempt.transportAccounting?.providerInvocationsAtThisBoundary !== 1 ||
        attempt.transportAccounting?.transportRetries !==
          "owned_below_semantic_boundary_not_counted"
      ) {
        problems.push(`executability ledger structural repair attempt ${index + 1} has invalid call accounting`);
      }
      const repairPrompt = buildVisualizationContractRepairPrompt(attempt.packet);
      if (
        attempt.packetHash !== sha256Json(attempt.packet) ||
        attempt.requestHash !== sha256Json(repairPrompt) ||
        attempt.systemPromptHash !== sha256Text(visualizationContractRepairSystemPrompt()) ||
        attempt.responseSchemaHash !== VISUALIZATION_CONTRACT_REPAIR_RESPONSE_SCHEMA_HASH
      ) {
        problems.push(`executability ledger structural repair attempt ${index + 1} hashes are stale`);
      }
      const repairEvidenceHashes = Object.fromEntries(
        attempt.packet.units.map((unit) => [unit.unitId, sha256Json(unit.evidence)]),
      );
      if (!isDeepStrictEqual(attempt.canonicalEvidenceHashes, repairEvidenceHashes)) {
        problems.push(`executability ledger structural repair attempt ${index + 1} evidence hashes are stale`);
      }
      for (const packetUnit of attempt.packet.units) {
        const finalUnit = finalUnitById.get(packetUnit.unitId);
        if (
          !finalUnit ||
          packetUnit.title !== finalUnit.title ||
          packetUnit.role !== finalUnit.role ||
          packetUnit.requirement !== finalUnit.interactiveVisualPlan?.requirement
        ) {
          problems.push(
            `executability ledger structural repair attempt ${index + 1} metadata for ${packetUnit.unitId} differs from the final immutable unit`,
          );
        }
        if (!isDeepStrictEqual(
          packetUnit.evidence,
          initialEvidenceByUnit.get(packetUnit.unitId),
        )) {
          problems.push(
            `executability ledger structural repair attempt ${index + 1} evidence for ${packetUnit.unitId} differs from executability review evidence`,
          );
        }
        const authoritativeEvidence =
          input.authoritativeCanonicalEvidenceByUnit?.[packetUnit.unitId];
        if (
          input.authoritativeCanonicalEvidenceByUnit &&
          !isDeepStrictEqual(packetUnit.evidence, authoritativeEvidence)
        ) {
          problems.push(
            `executability ledger structural repair attempt ${index + 1} evidence for ${packetUnit.unitId} differs from durable garden sources`,
          );
        }
      }
      if (!isDeepStrictEqual(
        attempt.packet.previousRejectionReasons,
        structuralRepair.attempts[index - 1]?.rejectionReasons ?? [],
      )) {
        problems.push(`executability ledger structural repair attempt ${index + 1} rejection history is not exact`);
      }
      if (!attempt.accepted && attempt.rejectionReasons.length === 0) {
        problems.push(`executability ledger structural repair attempt ${index + 1} lacks rejection reasons`);
      }
      if (attempt.accepted && attempt.rejectionReasons.length !== 0) {
        problems.push(`executability ledger accepted structural repair attempt ${index + 1} contains rejection reasons`);
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
        const packetUnitIds = acceptedStructuralAttempt!.packet.units.map((unit) => unit.unitId);
        if (
          new Set(repairIds).size !== repairIds.length ||
          new Set(acceptedStructuralAttempt!.appliedUnitIds).size !==
            acceptedStructuralAttempt!.appliedUnitIds.length ||
          repairIds.length !== acceptedStructuralAttempt!.appliedUnitIds.length ||
          repairIds.some((unitId) => !acceptedStructuralAttempt!.appliedUnitIds.includes(unitId)) ||
          !isDeepStrictEqual(packetUnitIds, acceptedStructuralAttempt!.appliedUnitIds)
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
    const lastStructuralAttempt = structuralRepair.attempts.at(-1);
    const firstExecutabilityAttempt = ledger.attempts[0];
    if (
      lastStructuralAttempt &&
      firstExecutabilityAttempt &&
      Date.parse(firstExecutabilityAttempt.startedAt) < Date.parse(lastStructuralAttempt.completedAt)
    ) {
      problems.push("executability review started before structural contract repair completed");
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
  const allocationIds = ledger.immutableGardenAllocation.map((item) => item.unitId);
  const finalUnitIds = input.finalLearningUnits.map((unit) => unit.id);
  if (!isDeepStrictEqual(allocationIds, finalUnitIds)) {
    problems.push("executability ledger immutable allocation does not cover every final unit in order");
  }
  for (const unit of input.finalLearningUnits) {
    const allocation = allocationByUnit.get(unit.id);
    const finalUnitPlan = unit.interactiveVisualPlan;
    if (!allocation || !finalUnitPlan || !unit.teachingMediumPlan) {
      problems.push(`${unit.id}: immutable allocation or final necessity plan is missing`);
      continue;
    }
    if (allocation.requirement !== finalUnitPlan.requirement) {
      problems.push(`${unit.id}: final requirement differs from the reviewed immutable allocation`);
    }
    if (!isDeepStrictEqual(allocation.teachingMediumPlan, unit.teachingMediumPlan)) {
      problems.push(`${unit.id}: final teaching medium differs from the reviewed immutable allocation`);
    }
    const expectedDecision = cloneExact(
      allocation.decisionBeforeMechanicalRouting as Record<string, unknown>,
    );
    const routedLedgerUnit = ledgerByUnit.get(unit.id);
    if (activeRequirement(unit) && routedLedgerUnit) {
      expectedDecision.recommendedVisualType = routedLedgerUnit.mechanicalRouting.projectedVisualType;
    }
    if (!isDeepStrictEqual(decisionWithoutInteraction(unit), expectedDecision)) {
      problems.push(
        `${unit.id}: final visual-necessity allocation changed beyond the mechanical recommendedVisualType route projection`,
      );
    }
  }

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

function readJsonArtifact(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function necessityArtifactMarkerIsExact(value: Record<string, unknown>): boolean {
  return (
    value.artifactRole ===
      "pre_executability_model_necessity_and_teaching_medium_source" &&
    value.interactionContractsAreAuthoritative === false &&
    isRecord(value.supersededBy) &&
    exactKeySet(value.supersededBy, [
      "learningUnitContract",
      "visualizationPlan",
      "executabilityReviewLedger",
    ]) &&
    value.supersededBy.learningUnitContract === LEARNING_UNIT_CONTRACT_RELATIVE_PATH &&
    value.supersededBy.visualizationPlan === VISUALIZATION_PLAN_RELATIVE_PATH &&
    value.supersededBy.executabilityReviewLedger ===
      VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH
  );
}

function recordWithoutInteraction(value: unknown): unknown {
  if (!isRecord(value)) return null;
  const { interaction: _interaction, ...rest } = value;
  return rest;
}

const NECESSITY_INTERACTION_KEYS = [
  "interactionGoal",
  "uniqueConcept",
  "whyStaticSourceFigureIsNotEnough",
  "learnerAction",
  "controls",
  "observable",
  "expectedInsight",
  "expectedInsightEvidence",
  "duplicateSignature",
] as const;

function necessityInteractionRepair(input: {
  unitId: string;
  value: unknown;
}): { repair?: VisualizationContractUnitRepair; problems: string[] } {
  if (!isRecord(input.value)) {
    return { problems: ["interaction must be an object"] };
  }
  const problems: string[] = [];
  if (!exactKeySet(input.value, NECESSITY_INTERACTION_KEYS)) {
    problems.push("interaction fields are not the exact persisted pedagogy contract shape");
  }
  for (const field of [
    "interactionGoal",
    "uniqueConcept",
    "whyStaticSourceFigureIsNotEnough",
    "learnerAction",
    "expectedInsight",
    "duplicateSignature",
  ] as const) {
    if (!compact(input.value[field])) {
      problems.push(`${field} must be a nonempty string`);
    }
  }
  const parsed = parseVisualizationContractRepairResponse(
    {
      repairs: [{
        unitId: input.unitId,
        interactionGoal: input.value.interactionGoal,
        learnerAction: input.value.learnerAction,
        controls: input.value.controls,
        observable: input.value.observable,
        expectedInsight: input.value.expectedInsight,
        expectedInsightEvidence: input.value.expectedInsightEvidence,
      }],
    },
    { requireCompleteContract: false, expectedUnitIds: [input.unitId] },
  );
  problems.push(...parsed.problems);
  return {
    ...(problems.length === 0 && parsed.repairs.length === 1
      ? { repair: parsed.repairs[0] }
      : {}),
    problems: [...new Set(problems)],
  };
}

/**
 * Bind the pre-executability source artifacts and human-readable contract
 * projection to the durable ledger + final JSON artifacts. This deliberately
 * permits stale nested interactions only in the self-labelled necessity
 * source; immutable necessity/medium policy must still match exactly.
 */
export function visualContractExecutabilityArtifactProvenanceProblems(input: {
  gardenDir: string;
  gardenId: string;
  ledger: VisualContractExecutabilityLedger | null;
  finalLearningUnits: LearningUnitContract[];
}): string[] {
  const problems: string[] = [];
  const ledger = input.ledger;
  if (!ledger) return ["visual-contract executability review ledger is missing or invalid"];
  const necessityPath = path.join(
    input.gardenDir,
    ...VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH.split("/"),
  );
  const recordsPath = path.join(
    input.gardenDir,
    ...VISUAL_DECISION_RECORDS_RELATIVE_PATH.split("/"),
  );
  const necessityMarkdownPath = path.join(
    input.gardenDir,
    ".breadboard",
    "visual-necessity-decisions.md",
  );
  const finalContractPath = path.join(
    input.gardenDir,
    ...LEARNING_UNIT_CONTRACT_RELATIVE_PATH.split("/"),
  );
  const finalContractMarkdownPath = path.join(
    input.gardenDir,
    ...AUTHORITATIVE_LEARNING_UNIT_CONTRACT_MARKDOWN_RELATIVE_PATH.split("/"),
  );
  const necessity = readJsonArtifact(necessityPath);
  const records = readJsonArtifact(recordsPath);
  if (!isRecord(necessity)) {
    problems.push(`${VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH} is missing or malformed`);
  } else {
    if (necessity.gardenId !== input.gardenId) {
      problems.push(`${VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH} gardenId is stale`);
    }
    if (!necessityArtifactMarkerIsExact(necessity)) {
      problems.push(`${VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH} role/supersededBy marker is invalid`);
    }
    if (!Array.isArray(necessity.decisions)) {
      problems.push(`${VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH} decisions are malformed`);
    } else {
      const decisionByUnit = new Map(
        necessity.decisions.flatMap((decision) =>
          isRecord(decision) && compact(decision.unitId)
            ? [[decision.unitId as string, decision] as const]
            : []),
      );
      const expectedIds = ledger.immutableGardenAllocation.map((item) => item.unitId);
      const ledgerUnitById = new Map(ledger.units.map((item) => [item.unitId, item]));
      const structurallyRepairedUnitIds = new Set(
        ledger.structuralContractRepair.attempts
          .filter((attempt) => attempt.accepted)
          .flatMap((attempt) => attempt.appliedUnitIds),
      );
      const acceptedStructuralPacketUnitById = new Map(
        ledger.structuralContractRepair.attempts
          .filter((attempt) => attempt.accepted)
          .flatMap((attempt) => attempt.packet.units)
          .map((unit) => [unit.unitId, unit] as const),
      );
      const finalUnitById = new Map(
        input.finalLearningUnits.map((unit) => [unit.id, unit] as const),
      );
      const canonicalEvidenceByUnit = new Map(
        (ledger.attempts[0]?.packet.units ?? []).map(
          (unit) => [unit.unitId, unit.canonicalEvidence] as const,
        ),
      );
      if (
        decisionByUnit.size !== necessity.decisions.length ||
        decisionByUnit.size !== expectedIds.length ||
        expectedIds.some((unitId) => !decisionByUnit.has(unitId))
      ) {
        problems.push(`${VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH} decisions do not uniquely cover the immutable garden allocation`);
      }
      for (const allocation of ledger.immutableGardenAllocation) {
        const decision = decisionByUnit.get(allocation.unitId);
        if (
          !decision ||
          !isDeepStrictEqual(
            recordWithoutInteraction(decision),
            allocation.decisionBeforeMechanicalRouting,
          )
        ) {
          problems.push(
            `${allocation.unitId}: pre-executability necessity fields differ from the immutable ledger allocation`,
          );
        }
        const ledgerUnit = ledgerUnitById.get(allocation.unitId);
        if (!ledgerUnit) continue;
        const parsedInteraction = necessityInteractionRepair({
          unitId: allocation.unitId,
          value: decision?.interaction,
        });
        if (!parsedInteraction.repair) {
          problems.push(
            `${allocation.unitId}: active pre-executability necessity interaction is missing or malformed: ${parsedInteraction.problems.join("; ")}`,
          );
          continue;
        }
        const finalUnit = finalUnitById.get(allocation.unitId);
        const originalInteractionProblems = finalUnit
          ? validateVisualizationContractUnitRepair({
              repair: parsedInteraction.repair,
              unit: finalUnit,
              evidence: canonicalEvidenceByUnit.get(allocation.unitId),
              requireCompleteContract: false,
              // This validates the raw model-authored necessity record rather
              // than retroactively requiring the later executability repair.
              requireExecutableProtocol: false,
            })
          : [`${allocation.unitId}: final learning unit is missing`];
        if (originalInteractionProblems.length > 0) {
          problems.push(
            `${allocation.unitId}: original necessity interaction is invalid: ${originalInteractionProblems.join("; ")}`,
          );
        }
        if (structurallyRepairedUnitIds.has(allocation.unitId)) {
          const packetUnit = acceptedStructuralPacketUnitById.get(allocation.unitId);
          if (
            !packetUnit ||
            parsedInteraction.repair.interactionGoal !== packetUnit.interactionGoal ||
            parsedInteraction.repair.learnerAction !== packetUnit.learnerAction ||
            parsedInteraction.repair.expectedInsight !== packetUnit.learningObjective
          ) {
            problems.push(
              `${allocation.unitId}: structural repair request does not exactly describe the original necessity interaction goal, learner action, and expected insight`,
            );
          }
        } else if (!isDeepStrictEqual(
          decision?.interaction,
          pedagogyContractFromCompleteRepair(ledgerUnit.beforeReviewContract),
        )) {
          problems.push(
            `${allocation.unitId}: executability beforeReviewContract is not the exact unrepaired necessity interaction`,
          );
        }
      }
    }
    if (!Array.isArray(necessity.teachingMedia)) {
      problems.push(`${VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH} teachingMedia are malformed`);
    } else {
      const mediumByUnit = new Map(
        necessity.teachingMedia.flatMap((medium) =>
          isRecord(medium) && compact(medium.unitId)
            ? [[medium.unitId as string, medium] as const]
            : []),
      );
      if (
        mediumByUnit.size !== necessity.teachingMedia.length ||
        mediumByUnit.size !== ledger.immutableGardenAllocation.length ||
        ledger.immutableGardenAllocation.some((item) =>
          !isDeepStrictEqual(mediumByUnit.get(item.unitId), item.teachingMediumPlan))
      ) {
        problems.push(`${VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH} teaching media differ from the immutable ledger allocation`);
      }
    }
    if (
      !isDeepStrictEqual(necessity.budget, ledger.authoritativePlanPolicy.visualBudget) ||
      !isDeepStrictEqual(
        necessity.overrides,
        ledger.authoritativePlanPolicy.visualDecisionOverrides,
      ) ||
      necessity.reviewCalls !== ledger.authoritativePlanPolicy.necessityReviewCalls ||
      necessity.rejectedReviews !==
        ledger.authoritativePlanPolicy.rejectedNecessityReviews
    ) {
      problems.push(`${VISUAL_NECESSITY_ARTIFACT_RELATIVE_PATH} budget/override/review policy differs from the final plan ledger`);
    }
  }
  if (!isRecord(records)) {
    problems.push(`${VISUAL_DECISION_RECORDS_RELATIVE_PATH} is missing or malformed`);
  } else {
    if (records.gardenId !== input.gardenId || !necessityArtifactMarkerIsExact(records)) {
      problems.push(`${VISUAL_DECISION_RECORDS_RELATIVE_PATH} role/supersededBy marker is invalid`);
    }
    if (
      isRecord(necessity) &&
      (
        records.generatedAt !== necessity.generatedAt ||
        !isDeepStrictEqual(records.decisionRecords, necessity.decisionRecords)
      )
    ) {
      problems.push(`${VISUAL_DECISION_RECORDS_RELATIVE_PATH} is not the exact necessity decision-record projection`);
    }
  }
  let necessityMarkdown = "";
  try { necessityMarkdown = fs.readFileSync(necessityMarkdownPath, "utf8"); } catch { /* reported below */ }
  if (
    !/Pre-executability necessity and teaching-medium source/i.test(necessityMarkdown) ||
    !/interaction contract here is not authoritative after review/i.test(necessityMarkdown) ||
    !necessityMarkdown.includes(LEARNING_UNIT_CONTRACT_RELATIVE_PATH) ||
    !necessityMarkdown.includes(VISUALIZATION_PLAN_RELATIVE_PATH) ||
    !necessityMarkdown.includes(VISUAL_CONTRACT_EXECUTABILITY_LEDGER_RELATIVE_PATH)
  ) {
    problems.push(".breadboard/visual-necessity-decisions.md role/supersededBy notice is missing or stale");
  }
  try {
    const finalContractPayload = fs.readFileSync(finalContractPath, "utf8");
    const expectedMarkdown = renderAuthoritativeLearningUnitContractMarkdown({
      units: input.finalLearningUnits,
      authoritativeSourceSha256: sha256Text(finalContractPayload),
    });
    const actualMarkdown = fs.readFileSync(finalContractMarkdownPath, "utf8");
    if (actualMarkdown !== expectedMarkdown) {
      problems.push(
        `${AUTHORITATIVE_LEARNING_UNIT_CONTRACT_MARKDOWN_RELATIVE_PATH} is not the exact final contract projection`,
      );
    }
  } catch {
    problems.push(
      `${AUTHORITATIVE_LEARNING_UNIT_CONTRACT_MARKDOWN_RELATIVE_PATH} is missing or cannot be linked to the final contract`,
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
  if (!isDeepStrictEqual(input.review.auditContext, input.context)) {
    throw new Error(
      "Cannot persist visual-contract executability audit under a context the reviewer request did not see.",
    );
  }
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
  const immutableGardenAllocation = input.review.learningUnits.map((unit) => {
    const plan = unit.interactiveVisualPlan;
    if (!plan || !unit.teachingMediumPlan) {
      throw new Error(
        `Cannot persist visual-contract executability allocation audit for incomplete unit ${unit.id}.`,
      );
    }
    return {
      unitId: unit.id,
      requirement: plan.requirement,
      decisionBeforeMechanicalRouting: cloneExact(decisionWithoutInteraction(unit)),
      teachingMediumPlan: cloneExact(unit.teachingMediumPlan),
    };
  });
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
    schemaVersion: VISUAL_CONTRACT_EXECUTABILITY_LEDGER_SCHEMA_VERSION,
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
      serialization: "JSON.stringify_utf8_v2_exact_raw_provider_text",
      responseSchemaHash: VISUAL_CONTRACT_EXECUTABILITY_RESPONSE_SCHEMA_HASH,
      protocolVersion: VISUAL_CONTRACT_EXECUTABILITY_PROTOCOL_VERSION,
    },
    callAccounting: {
      protocolVersion: input.review.callBudget.protocolVersion,
      maximumSemanticCandidates: input.review.callBudget.maximumSemanticCandidates,
      maximumProtocolRetries: input.review.callBudget.maximumProtocolRetries,
      maximumProviderInvocations: input.review.callBudget.maximumProviderInvocations,
      providerInvocations: input.review.calls,
      semanticCandidates: input.review.semanticCandidates,
      protocolRetries: input.review.protocolRetries,
      protocolRejections: input.review.protocolRejections,
      transportAttempts: "not_observable_below_provider_boundary",
    },
    rejectedReviews: input.review.rejectedReviews,
    protocolRejections: input.review.protocolRejections,
    wholeGardenConstraints: cloneExact(input.review.wholeGardenConstraints),
    authoritativePlanPolicy: clonePersistedJson({
      visualBudget: cloneExact(input.finalVisualizationPlan.visualBudget),
      visualDecisionOverrides: cloneExact(input.finalVisualizationPlan.visualDecisionOverrides),
      necessityReviewCalls: input.finalVisualizationPlan.necessityReviewCalls,
      rejectedNecessityReviews: input.finalVisualizationPlan.rejectedNecessityReviews,
      opportunitiesExcludingMechanicalPlacement: input.finalVisualizationPlan.opportunities.map(
        (opportunity) => cloneExact(boundVisualizationOpportunity(opportunity)),
      ),
      routeDecisions: cloneExact(input.finalVisualizationPlan.decisions),
    }),
    immutableGardenAllocation,
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
  // Persistence call sites construct the complete ledger before writing the
  // final contract or plan. Enforce the durable byte ceiling at that preflight
  // boundary as well as in save(), so an oversized audit cannot fail only
  // after authoritative artifacts have already been replaced.
  serializedVisualContractExecutabilityLedger(ledger);
  return ledger;
}

export function saveVisualContractExecutabilityLedger(input: {
  gardenDir: string;
  ledger: VisualContractExecutabilityLedger;
}): string {
  const filePath = visualContractExecutabilityLedgerPath(input.gardenDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = serializedVisualContractExecutabilityLedger(input.ledger);
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
