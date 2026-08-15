import {
  modelAuthoredLearningUnitParseProblems,
  type LearningUnitContract,
} from "./learning-unit-contract.ts";

const DEFAULT_MAX_TARGETED_REPAIR_ATTEMPTS = 2;

type JsonRecord = Record<string, unknown>;

export interface LearningSpineProblemScope {
  unitIds: string[];
  scopedProblems: string[];
  unscopedProblems: string[];
}

export interface LearningSpineTargetedRepairRequest {
  attempt: number;
  unitIds: string[];
  system: string;
  user: string;
}

export type LearningSpineTargetedRepairProvider = (
  request: LearningSpineTargetedRepairRequest,
) => Promise<unknown>;

export interface LearningSpineCandidateValidation {
  units: LearningUnitContract[];
  problems: string[];
}

export interface LearningSpineTargetedRepairReview {
  attempt: number;
  unitIds: string[];
  responseProblems: string[];
  mergedProblems: string[];
  accepted: boolean;
  introducedUnscopedProblems: boolean;
}

export interface LearningSpineTargetedRepairResult {
  status: "repaired" | "exhausted" | "unscoped";
  candidate: JsonRecord;
  units: LearningUnitContract[];
  problems: string[];
  calls: number;
  reviews: LearningSpineTargetedRepairReview[];
  unscopedProblems: string[];
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsIdentifier(problem: string, identifier: string): boolean {
  if (!identifier) return false;
  return new RegExp(
    `(?:^|[^A-Za-z0-9_.-])${escapeRegExp(identifier)}(?:$|[^A-Za-z0-9_.-])`,
  ).test(problem);
}

function conceptSlugsForUnit(unit: LearningUnitContract): string[] {
  return (unit.semanticConcepts ?? []).map((concept) => concept.slug).filter(Boolean);
}

function uniquelyAddressableUnitId(unitId: string, counts: ReadonlyMap<string, number>): boolean {
  return Boolean(
    unitId &&
    unitId === unitId.trim() &&
    /^[A-Za-z0-9_.-]+$/.test(unitId) &&
    (counts.get(unitId) ?? 0) === 1,
  );
}

/**
 * Resolve only failures whose affected learning-unit records are explicit.
 *
 * Index-based parse failures and exact unit-id mentions are unit scoped. A
 * concept-registry failure is scoped to every unit that authored the named
 * concept slug. Nothing else is guessed: a garden-wide budget, coverage, or
 * section failure remains unscoped and therefore cannot enter this repair path.
 */
export function scopeLearningSpineProblems(
  problems: readonly string[],
  units: readonly LearningUnitContract[],
): LearningSpineProblemScope {
  const scopedProblems: string[] = [];
  const unscopedProblems: string[] = [];
  const affected = new Set<string>();
  const unitIdCounts = new Map<string, number>();
  for (const unit of units) unitIdCounts.set(unit.id, (unitIdCounts.get(unit.id) ?? 0) + 1);

  for (const problem of unique(problems)) {
    const problemUnitIds = new Set<string>();
    for (const match of problem.matchAll(/learningUnits\[(\d+)]/g)) {
      const unit = units[Number.parseInt(match[1], 10)];
      if (unit) problemUnitIds.add(unit.id);
    }
    for (const unit of units) {
      if (containsIdentifier(problem, unit.id)) problemUnitIds.add(unit.id);
    }

    if (/concept|alias|canonical term/i.test(problem)) {
      for (const unit of units) {
        if (conceptSlugsForUnit(unit).some((slug) => containsIdentifier(problem, slug))) {
          problemUnitIds.add(unit.id);
        }
      }
    }

    if (
      problemUnitIds.size === 0 ||
      [...problemUnitIds].some((unitId) => !uniquelyAddressableUnitId(unitId, unitIdCounts))
    ) {
      unscopedProblems.push(problem);
      continue;
    }
    scopedProblems.push(problem);
    for (const unitId of problemUnitIds) affected.add(unitId);
  }

  return {
    unitIds: unique(units.map((unit) => unit.id).filter((unitId) => affected.has(unitId))),
    scopedProblems,
    unscopedProblems,
  };
}

function rawLearningUnits(candidate: JsonRecord): JsonRecord[] | null {
  if (!Array.isArray(candidate.learningUnits)) return null;
  const units = candidate.learningUnits.map(record);
  return units.every((unit): unit is JsonRecord => Boolean(unit)) ? units : null;
}

export interface MergeLearningSpineTargetedResponseInput {
  candidate: JsonRecord;
  targetUnitIds: readonly string[];
  response: unknown;
}

export type MergeLearningSpineTargetedResponseResult =
  | { ok: true; candidate: JsonRecord }
  | { ok: false; problems: string[] };

/**
 * Atomically swap complete model-authored unit records. No field is copied,
 * filled, normalized, or reconciled here. If any requested unit is absent,
 * duplicated, extra, or malformed, the original candidate is returned intact.
 */
export function mergeLearningSpineTargetedResponse(
  input: MergeLearningSpineTargetedResponseInput,
): MergeLearningSpineTargetedResponseResult {
  const response = record(input.response);
  if (!response) {
    return { ok: false, problems: ["targeted response must be a JSON object"] };
  }
  const extraKeys = Object.keys(response).filter((key) => key !== "learningUnits");
  const responseProblems = [
    ...(extraKeys.length > 0
      ? [`targeted response contains unsupported top-level fields: ${extraKeys.join(", ")}`]
      : []),
    ...modelAuthoredLearningUnitParseProblems(response),
  ];
  const replacements = rawLearningUnits(response);
  const currentUnits = rawLearningUnits(input.candidate);
  if (!replacements) responseProblems.push("targeted response.learningUnits must contain complete objects");
  if (!currentUnits) responseProblems.push("accepted candidate.learningUnits must contain complete objects");
  if (responseProblems.length > 0 || !replacements || !currentUnits) {
    return { ok: false, problems: unique(responseProblems) };
  }

  const expectedIds = unique(input.targetUnitIds);
  const expectedIdSet = new Set(expectedIds);
  const replacementIds = replacements.map((unit) => typeof unit.id === "string" ? unit.id : "");
  const replacementIdSet = new Set(replacementIds);
  const idProblems: string[] = [];
  for (const id of expectedIds) {
    if (!replacementIdSet.has(id)) idProblems.push(`targeted response is missing complete learning unit "${id}"`);
  }
  for (const id of replacementIds) {
    if (!expectedIdSet.has(id)) idProblems.push(`targeted response returned non-target learning unit "${id || "(empty)"}"`);
  }
  if (replacementIds.length !== expectedIds.length) {
    idProblems.push(`targeted response must return exactly ${expectedIds.length} complete learning-unit records`);
  }
  const currentIds = currentUnits.map((unit) => typeof unit.id === "string" ? unit.id : "");
  const currentIdSet = new Set(currentIds);
  for (const id of expectedIds) {
    if (!currentIdSet.has(id)) idProblems.push(`accepted candidate does not contain target learning unit "${id}"`);
    if (currentIds.filter((candidateId) => candidateId === id).length !== 1) {
      idProblems.push(`accepted candidate target learning unit "${id}" is not uniquely addressable`);
    }
  }
  if (idProblems.length > 0) return { ok: false, problems: unique(idProblems) };

  const replacementById = new Map(replacements.map((unit) => [String(unit.id), unit]));
  const mergedUnits = currentUnits.map((unit) => replacementById.get(String(unit.id)) ?? unit);
  return {
    ok: true,
    candidate: {
      ...input.candidate,
      learningUnits: mergedUnits,
    },
  };
}

function compactJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function rawUnitById(candidate: JsonRecord): Map<string, JsonRecord> {
  return new Map(
    (rawLearningUnits(candidate) ?? [])
      .filter((unit) => typeof unit.id === "string")
      .map((unit) => [String(unit.id), unit]),
  );
}

function untouchedLearningUnitIndex(
  units: readonly LearningUnitContract[],
  targetedUnitIds: ReadonlySet<string>,
): unknown[] {
  return units
    .filter((unit) => !targetedUnitIds.has(unit.id))
    .map((unit) => ({
      unitId: unit.id,
      syllabusUnitIds: unit.syllabusUnitIds ?? [],
      sectionPlan: unit.sectionPlan,
      sourceAnchors: unit.sourceAnchors,
      sourceArtifactIds: [
        ...unit.sourceFigures.map((artifact) => artifact.id),
        ...unit.sourceFormulas.map((artifact) => artifact.id),
        ...unit.sourceTables.map((artifact) => artifact.id),
      ],
      semanticConcepts: unit.semanticConcepts ?? [],
    }));
}

function preserveUntouchedValidatedUnits(
  currentUnits: readonly LearningUnitContract[],
  validatedUnits: readonly LearningUnitContract[],
  targetedUnitIds: readonly string[],
): LearningUnitContract[] {
  const targeted = new Set(targetedUnitIds);
  const currentById = new Map(currentUnits.map((unit) => [unit.id, unit]));
  return validatedUnits.map((unit) =>
    targeted.has(unit.id) ? unit : (currentById.get(unit.id) ?? unit));
}

export function buildLearningSpineTargetedRepairRequest(input: {
  attempt: number;
  candidate: JsonRecord;
  units: readonly LearningUnitContract[];
  unitIds: readonly string[];
  validationProblems: readonly string[];
  canonicalPlanningPacket: unknown;
  canonicalEvidenceByUnit: Readonly<Record<string, unknown>>;
  previousInvalidResponse?: unknown;
  previousResponseProblems?: readonly string[];
}): LearningSpineTargetedRepairRequest {
  const targetedIds = unique(input.unitIds);
  const targetedIdSet = new Set(targetedIds);
  const currentById = rawUnitById(input.candidate);
  const preservedGardenFields = Object.fromEntries(
    Object.entries(input.candidate).filter(([key]) => key !== "learningUnits"),
  );
  const system = `You perform a bounded, unit-scoped repair of an AI-authored Breadboard Learning Unit Contract.

Return ONLY this exact JSON shape:
{"learningUnits":[COMPLETE_REPLACEMENT_UNIT_RECORD,...]}

Use this complete unit-record schema (optional fields are marked OPTIONAL):
{
  "id": "exact requested unit id",
  "title": "precise learner-facing teaching step",
  "role": "motivation | core_concept | mechanism | formula | worked_example | training_method | metric | result_interpretation | comparison | application | limitation | synthesis",
  "learningQuestion": "one conceptual learner question",
  "prerequisiteConcepts": ["concept"],
  "newConcepts": ["concept"],
  "syllabusUnitIds": ["exact supplied syllabus unit id; empty without a syllabus"],
  "sourceAnchors": ["exact canonical source anchor id"],
  "sourceFigures": [{
    "id": "exact registered figure/graph id",
    "placement": "inside_concept_explanation | after_formula_introduction | inside_result_interpretation | beside_worked_example | inside_comparison",
    "mustBeDiscussedWith": "nearby idea",
    "interpretationGoal": "what the learner notices"
  }],
  "sourceFormulas": [{
    "id": "exact registered formula id",
    "teachingGoal": "what it teaches",
    "termsToDefine": ["term"],
    "placement": "before_example | inside_metric_definition | inside_result_interpretation"
  }],
  "sourceTables": [{
    "id": "exact registered table id",
    "teachingGoal": "what it teaches",
    "rowsOrColumnsToExplain": ["row or column"],
    "placement": "inside_comparison | inside_result_interpretation"
  }],
  "semanticConcepts": [{
    "slug": "canonical-public-concept-slug",
    "preferredLabel": "human-readable label",
    "role": "primary | supporting",
    "aliases": ["equivalent label"],
    "evidenceAnchors": ["exact canonical source anchor id"]
  }],
  "knowledgeClaims": [{
    "text": "readable source-grounded statement",
    "subject": "same-unit semantic concept slug",
    "predicate": "prerequisite-of | causes | enables | derived-from | measured-by | contrasts-with | example-of | part-of | applies-to | limits | emits-when | related-to",
    "object": "OPTIONAL same-unit semantic concept slug",
    "conceptIds": ["OPTIONAL same-unit semantic concept slug"],
    "evidenceAnchors": ["exact canonical source anchor id"],
    "derivationAnchors": ["OPTIONAL exact canonical source anchor id"],
    "connectedClaimIds": ["OPTIONAL claim id"]
  }],
  "zettelNotes": [{"handle":"canonical-atomic-handle","claim":"readable atomic note","connectedTo":["canonical-atomic-handle"]}],
  "mustNotRepeat": ["already-used motif, framing, or example"],
  "expectedWordRange": [700, 1100],
  "sectionPlan": {
    "id": "existing section id",
    "title": "existing learner-facing section title",
    "purpose": "existing section purpose",
    "singleSubsectionReason": "OPTIONAL, only for a one-unit section"
  }
}
Do not add interactiveVisual, interactiveVisualPlan, or teachingMediumPlan during spine repair; a later whole-garden model review authors those decisions.

Hard requirements:
- Return exactly one COMPLETE learning-unit record for every requested unit id and no other units. A complete record repeats every field required by the original Learning Unit Contract; never return a patch, partial object, alias edit, instruction, or prose explanation.
- Author the semantic correction yourself. Code will only validate the complete records and atomically replace the requested units; it will never choose, merge, sort, fill, or reconcile labels, aliases, claims, anchors, assignments, sections, or pedagogy.
- The preserved garden fields and untouched learning-unit index are immutable context. Do not return replacements for untouched units or reassign their source artifacts, syllabus units, section ownership, or concept identities.
- Preserve every valid source-artifact assignment, omission boundary, syllabus assignment, section assignment, learner question, claim, and source anchor unless a supplied hard failure specifically requires changing it.
- Use only exact source and artifact anchor ids present in the canonical planning packet or canonical evidence supplied for these units.
- A semanticConcept slug reused in multiple units must carry exactly the same preferredLabel and exactly the same aliases array (same values in the same order) in every occurrence. Never solve a conflict by mechanically copying a code-selected value; inspect the complete affected records and author one coherent canonical identity.
- Keep every knowledge-claim endpoint inside semanticConcepts of that same returned unit.
- Your response replaces all requested records together or none of them. Make the full replacement pass the complete garden-level contract, depth, source-artifact, source-anchor, syllabus, section, and concept-registry gates.`;
  const user = compactJson({
    repairAttempt: input.attempt,
    requestedUnitIds: targetedIds,
    validationProblems: unique(input.validationProblems),
    canonicalPlanningPacket: input.canonicalPlanningPacket,
    preservedGardenFields,
    canonicalEvidenceByUnit: Object.fromEntries(
      targetedIds.map((unitId) => [unitId, input.canonicalEvidenceByUnit[unitId] ?? []]),
    ),
    invalidLearningUnits: targetedIds.map((unitId) => currentById.get(unitId)).filter(Boolean),
    untouchedLearningUnitIndex: untouchedLearningUnitIndex(input.units, targetedIdSet),
    ...(input.previousInvalidResponse !== undefined
      ? {
          previousInvalidTargetedResponse: input.previousInvalidResponse,
          previousResponseProblems: unique(input.previousResponseProblems ?? []),
        }
      : {}),
  });
  return { attempt: input.attempt, unitIds: targetedIds, system, user };
}

/**
 * Run a bounded AI-only targeted repair after whole-spine replacements are
 * exhausted. Provider exceptions deliberately escape this function: transport
 * retries belong to the provider and never spend a semantic repair attempt.
 */
export async function runLearningSpineTargetedRepair(input: {
  candidate: JsonRecord;
  units: LearningUnitContract[];
  validationProblems: readonly string[];
  canonicalPlanningPacket: unknown;
  canonicalEvidenceByUnit: Readonly<Record<string, unknown>>;
  provider: LearningSpineTargetedRepairProvider;
  validateCandidate: (candidate: JsonRecord) => Promise<LearningSpineCandidateValidation> | LearningSpineCandidateValidation;
  maxAttempts?: number;
}): Promise<LearningSpineTargetedRepairResult> {
  const maxAttempts = Math.max(
    1,
    Math.min(4, Math.trunc(input.maxAttempts ?? DEFAULT_MAX_TARGETED_REPAIR_ATTEMPTS)),
  );
  let candidate = input.candidate;
  let units = input.units;
  let problems = unique(input.validationProblems);
  let calls = 0;
  const reviews: LearningSpineTargetedRepairReview[] = [];
  let previousInvalidResponse: unknown;
  let previousResponseProblems: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts && problems.length > 0; attempt += 1) {
    const scope = scopeLearningSpineProblems(problems, units);
    if (scope.unscopedProblems.length > 0 || scope.unitIds.length === 0) {
      return {
        status: "unscoped",
        candidate,
        units,
        problems,
        calls,
        reviews,
        unscopedProblems: scope.unscopedProblems.length > 0 ? scope.unscopedProblems : problems,
      };
    }

    const request = buildLearningSpineTargetedRepairRequest({
      attempt,
      candidate,
      units,
      unitIds: scope.unitIds,
      validationProblems: problems,
      canonicalPlanningPacket: input.canonicalPlanningPacket,
      canonicalEvidenceByUnit: input.canonicalEvidenceByUnit,
      previousInvalidResponse,
      previousResponseProblems,
    });
    const response = await input.provider(request);
    calls += 1;
    const merged = mergeLearningSpineTargetedResponse({
      candidate,
      targetUnitIds: scope.unitIds,
      response,
    });
    if (merged.ok === false) {
      previousInvalidResponse = response;
      previousResponseProblems = merged.problems;
      reviews.push({
        attempt,
        unitIds: scope.unitIds,
        responseProblems: merged.problems,
        mergedProblems: problems,
        accepted: false,
        introducedUnscopedProblems: false,
      });
      continue;
    }

    const validation = await input.validateCandidate(merged.candidate);
    const mergedProblems = unique(validation.problems);
    const mergedScope = scopeLearningSpineProblems(mergedProblems, validation.units);
    const introducedUnscopedProblems = mergedProblems.length > 0 && (
      mergedScope.unscopedProblems.length > 0 || mergedScope.unitIds.length === 0
    );
    const accepted = mergedProblems.length < problems.length && !introducedUnscopedProblems;
    reviews.push({
      attempt,
      unitIds: scope.unitIds,
      responseProblems: [],
      mergedProblems,
      accepted,
      introducedUnscopedProblems,
    });
    if (introducedUnscopedProblems) {
      // The accepted candidate is still locally repairable. Reject this whole
      // proposed swap, preserve the prior units, and let the model spend the
      // next semantic attempt correcting its own global regression.
      previousInvalidResponse = response;
      previousResponseProblems = mergedProblems;
      continue;
    }
    if (accepted) {
      candidate = merged.candidate;
      units = preserveUntouchedValidatedUnits(units, validation.units, scope.unitIds);
      problems = mergedProblems;
      previousInvalidResponse = undefined;
      previousResponseProblems = [];
      if (problems.length === 0) {
        return {
          status: "repaired",
          candidate,
          units,
          problems: [],
          calls,
          reviews,
          unscopedProblems: [],
        };
      }
    } else {
      previousInvalidResponse = response;
      previousResponseProblems = mergedProblems;
    }
  }

  return {
    status: problems.length === 0 ? "repaired" : "exhausted",
    candidate,
    units,
    problems,
    calls,
    reviews,
    unscopedProblems: [],
  };
}
