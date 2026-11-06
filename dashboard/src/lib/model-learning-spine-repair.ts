import { LEARN_LENGTH_PLANNING_RULES } from "./learn-pedagogy.ts";
import {
  modelAuthoredLearningUnitParseProblems,
  modelAuthoredSourceArtifactOmissionParseProblems,
  learningUnitArtifactLoad,
  type LearningUnitContract,
} from "./learning-unit-contract.ts";
import { mapWithConcurrency } from "./learn-source-map-partition.ts";

const DEFAULT_MAX_TARGETED_REPAIR_ATTEMPTS = 2;
const MAX_FORGOTTEN_ARTIFACT_PLACEMENT_CALLS = 2;
// Owner placements carry a full lesson entry, so a 60-item answer from
// gpt-6-sol ran past the hour-long planning timeout (2026-10-01).
const FORGOTTEN_ARTIFACT_PLACEMENT_BATCH = 30;
const FORGOTTEN_ARTIFACT_PLACEMENT_CONCURRENCY = 6;

type JsonRecord = Record<string, unknown>;

export interface LearningSpineProblemScope {
  unitIds: string[];
  scopedProblems: string[];
  unscopedProblems: string[];
}

export interface LearningSpineTargetedRepairRequest {
  attempt: number;
  unitIds: string[];
  /** Artifact placement runs in batches; each keeps its own receipt stage. */
  placementBatch?: number;
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

    // Section metadata is authored on every unit of the section, so those
    // units are the records that can fix it (telecom-1 M1, 2026-09-30: a
    // missing singleSubsectionReason left the whole repair "unscoped").
    const sectionId = /^section "([^"]+)" /.exec(problem)?.[1];
    if (sectionId) {
      for (const unit of units) {
        if (unit.sectionPlan?.id === sectionId) problemUnitIds.add(unit.id);
      }
    }

    // A lost teaching page belongs to a lesson that teaches its syllabus unit;
    // those lessons are the records that can take it back.
    const lostPageSyllabusUnit = /^teaching evidence for syllabus unit (\S+) lost page /.exec(problem)?.[1];
    if (lostPageSyllabusUnit) {
      for (const unit of units) {
        if (unit.syllabusUnitIds?.includes(lostPageSyllabusUnit)) problemUnitIds.add(unit.id);
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

const FORGOTTEN_ARTIFACT_PROBLEM =
  /^registered source artifact "([^"]+)" is forgotten; assign it to exactly one learning unit or explicitly omit it/;

/** Artifact ids when every problem is a forgotten-artifact problem, else null. */
export function forgottenArtifactIdsOnly(problems: readonly string[]): string[] | null {
  if (problems.length === 0) return null;
  const ids: string[] = [];
  for (const problem of problems) {
    const match = FORGOTTEN_ARTIFACT_PROBLEM.exec(problem);
    if (!match) return null;
    ids.push(match[1]);
  }
  return unique(ids);
}

/** Forgotten-artifact ids among any mix of problems. */
function forgottenArtifactIdsAmong(problems: readonly string[]): string[] {
  return unique(problems.flatMap((problem) => {
    const id = FORGOTTEN_ARTIFACT_PROBLEM.exec(problem)?.[1];
    return id ? [id] : [];
  }));
}

/** Omissions whose summary or reason is too vague to keep, by index. */
function weakOmissionIndexes(problems: readonly string[]): Set<number> {
  const indexes = new Set<number>();
  for (const problem of problems) {
    const match = /^sourceArtifactOmissions\[(\d+)]\.(?:reason|artifactSummary) must /.exec(problem);
    if (match) indexes.add(Number(match[1]));
  }
  return indexes;
}

function artifactEntriesFromPacket(packet: unknown, ids: readonly string[]): unknown[] {
  const wanted = new Set(ids);
  const entries = record(packet)?.extractedSourceArtifacts;
  const found = Array.isArray(entries)
    ? entries.filter((entry) => wanted.has(String(record(entry)?.id ?? "")))
    : [];
  const foundIds = new Set(found.map((entry) => String(record(entry)?.id)));
  return [...found, ...ids.filter((id) => !foundIds.has(id)).map((id) => ({ id }))];
}

/** The unit list a registered artifact id belongs in, by its kind letter. */
export function artifactListKey(artifactId: string): "sourceFigures" | "sourceFormulas" | "sourceTables" | null {
  const kind = /\.([A-Z])\d+$/.exec(artifactId)?.[1];
  if (kind === "F" || kind === "G") return "sourceFigures";
  if (kind === "E") return "sourceFormulas";
  if (kind === "T") return "sourceTables";
  return null;
}

/** Remaining teachable-artifact room per unit. */
export function unitArtifactCapacity(units: readonly LearningUnitContract[]): Map<string, number> {
  return new Map(units.map((unit) => {
    const load = learningUnitArtifactLoad(unit);
    return [unit.id, Math.max(0, load.cap - load.artifacts)];
  }));
}

export function buildForgottenArtifactPlacementRequest(input: {
  attempt: number;
  artifactIds: readonly string[];
  units: readonly LearningUnitContract[];
  canonicalPlanningPacket: unknown;
  /** Room this request may use per unit; defaults to each unit's full room. */
  capacityByUnit?: ReadonlyMap<string, number>;
  previousInvalidResponse?: unknown;
  previousResponseProblems?: readonly string[];
}): LearningSpineTargetedRepairRequest {
  const capacity = input.capacityByUnit ?? unitArtifactCapacity(input.units);
  const system = `You place registered source artifacts that an AI-authored Breadboard Learning Unit Contract forgot.
Return ONLY this JSON shape:
{"placements":[{"sourceArtifactId":"exact id","ownerUnitId":"exact existing unit id","entry":{...}} | {"sourceArtifactId":"exact id","omission":{"disposition":"redundant_with_assigned_artifact | outside_learning_scope | non_instructional | unreliable_extraction","artifactSummary":"specific description of what the artifact shows","reason":"specific justification","alternativeArtifactId":"for redundant_with_assigned_artifact the different assigned artifact that already teaches it; otherwise exactly null"}}]}
The entry is the owner lesson's plan for the artifact, by the id's kind letter:
- figure or graph (.F# or .G#): {"placement":"inside_concept_explanation | after_formula_introduction | inside_result_interpretation | beside_worked_example | inside_comparison","mustBeDiscussedWith":"the concept or result the lesson discusses it with","interpretationGoal":"what the learner should read from it"}
- formula (.E#): {"teachingGoal":"what the learner should be able to do with it","termsToDefine":["each symbol or term the lesson must define"],"placement":"before_example | inside_metric_definition | inside_result_interpretation","grounding":"derived | empirical | axiom | asserted_in_source","derivableFrom":["for derived only: earlier anchor ids or prior unit results the route starts from; otherwise []"]}
- table (.T#): {"teachingGoal":"what the learner should take from it","rowsOrColumnsToExplain":["the rows or columns the lesson must explain"],"placement":"inside_comparison | inside_result_interpretation"}
Hard rules:
- Return exactly one placement for every id in forgottenArtifacts and no other ids.
- Choose ownerUnitId when the artifact teaches something the unit covers; it must be one exact id from learningUnits, and the entry must be specific to that lesson.
- A lesson can teach only so many artifacts. Give a unit at most its remainingArtifactCapacity new artifacts in this answer. When the best unit is full, choose another unit that genuinely covers the artifact, or omit it (for example redundant_with_assigned_artifact when an assigned artifact already teaches the same point).
- Choose an omission only when the artifact adds no safe in-scope teaching value or no lesson has room for it. The artifactSummary must specifically describe what the artifact shows (at least three words). The reason must be at least eight words and must reuse at least one distinctive key term from its own artifactSummary.
- Do not return prose, patches, or any other fields.`;
  const user = compactJson({
    repairAttempt: input.attempt,
    forgottenArtifacts: artifactEntriesFromPacket(input.canonicalPlanningPacket, input.artifactIds),
    learningUnits: input.units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      role: unit.role,
      learningQuestion: unit.learningQuestion,
      sourceAnchors: unit.sourceAnchors,
      remainingArtifactCapacity: capacity.get(unit.id) ?? 0,
      sourceArtifactIds: [
        ...unit.sourceFigures.map((artifact) => artifact.id),
        ...unit.sourceFormulas.map((artifact) => artifact.id),
        ...unit.sourceTables.map((artifact) => artifact.id),
      ],
    })),
    ...(input.previousInvalidResponse !== undefined
      ? {
          previousInvalidResponse: input.previousInvalidResponse,
          previousResponseProblems: unique(input.previousResponseProblems ?? []),
        }
      : {}),
  });
  return { attempt: input.attempt, unitIds: [], system, user };
}

export interface ForgottenArtifactInsertion {
  unitId: string;
  listKey: "sourceFigures" | "sourceFormulas" | "sourceTables";
  entry: JsonRecord;
}

export type ForgottenArtifactPlacementResult =
  | { ok: true; candidate: JsonRecord; ownerProblems: string[]; omissions: JsonRecord[]; insertions: ForgottenArtifactInsertion[] }
  | { ok: false; problems: string[] };

const FIGURE_ENTRY_PLACEMENTS = [
  "inside_concept_explanation",
  "after_formula_introduction",
  "inside_result_interpretation",
  "beside_worked_example",
  "inside_comparison",
];
const FORMULA_ENTRY_PLACEMENTS = ["before_example", "inside_metric_definition", "inside_result_interpretation"];
const FORMULA_ENTRY_GROUNDINGS = ["derived", "empirical", "axiom", "asserted_in_source"];
const TABLE_ENTRY_PLACEMENTS = ["inside_comparison", "inside_result_interpretation"];

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Shape problems in one model-authored owner entry; the full contract
 * validation still judges it afterwards. */
function ownerEntryProblems(
  at: string,
  listKey: ForgottenArtifactInsertion["listKey"],
  entry: JsonRecord,
): string[] {
  const problems: string[] = [];
  if (listKey === "sourceFigures") {
    if (!FIGURE_ENTRY_PLACEMENTS.includes(String(entry.placement))) problems.push(`${at}.entry.placement must be one of ${FIGURE_ENTRY_PLACEMENTS.join(", ")}`);
    if (!nonEmptyString(entry.mustBeDiscussedWith)) problems.push(`${at}.entry.mustBeDiscussedWith must be a non-empty string`);
    if (!nonEmptyString(entry.interpretationGoal)) problems.push(`${at}.entry.interpretationGoal must be a non-empty string`);
  } else if (listKey === "sourceFormulas") {
    if (!nonEmptyString(entry.teachingGoal)) problems.push(`${at}.entry.teachingGoal must be a non-empty string`);
    if (!stringList(entry.termsToDefine)) problems.push(`${at}.entry.termsToDefine must be an array of strings`);
    if (!FORMULA_ENTRY_PLACEMENTS.includes(String(entry.placement))) problems.push(`${at}.entry.placement must be one of ${FORMULA_ENTRY_PLACEMENTS.join(", ")}`);
    if (!FORMULA_ENTRY_GROUNDINGS.includes(String(entry.grounding))) problems.push(`${at}.entry.grounding must be one of ${FORMULA_ENTRY_GROUNDINGS.join(", ")}`);
    if (entry.derivableFrom !== undefined && !stringList(entry.derivableFrom)) problems.push(`${at}.entry.derivableFrom must be an array of strings`);
  } else {
    if (!nonEmptyString(entry.teachingGoal)) problems.push(`${at}.entry.teachingGoal must be a non-empty string`);
    if (!stringList(entry.rowsOrColumnsToExplain)) problems.push(`${at}.entry.rowsOrColumnsToExplain must be an array of strings`);
    if (!TABLE_ENTRY_PLACEMENTS.includes(String(entry.placement))) problems.push(`${at}.entry.placement must be one of ${TABLE_ENTRY_PLACEMENTS.join(", ")}`);
  }
  return problems;
}

/** Add model-authored owner entries to their units' raw records. */
export function withForgottenArtifactInsertions(
  candidate: JsonRecord,
  insertions: readonly ForgottenArtifactInsertion[],
): JsonRecord {
  if (insertions.length === 0 || !Array.isArray(candidate.learningUnits)) return candidate;
  return {
    ...candidate,
    learningUnits: candidate.learningUnits.map((raw) => {
      const unit = record(raw);
      const mine = unit ? insertions.filter((insertion) => insertion.unitId === unit.id) : [];
      if (!unit || mine.length === 0) return raw;
      const next: JsonRecord = { ...unit };
      for (const insertion of mine) {
        const list = Array.isArray(next[insertion.listKey]) ? next[insertion.listKey] as unknown[] : [];
        next[insertion.listKey] = [...list, insertion.entry];
      }
      return next;
    }),
  };
}

/**
 * Apply model-authored placements for forgotten artifacts. Omissions are added
 * verbatim to sourceArtifactOmissions; an owner choice carries the model's own
 * lesson entry, which is appended to that unit. A choice without an entry
 * falls back to a unit-scoped failure the unit repair handles. Code never picks
 * an owner or writes a reason.
 */
export function applyForgottenArtifactPlacements(input: {
  candidate: JsonRecord;
  artifactIds: readonly string[];
  units: readonly LearningUnitContract[];
  response: unknown;
  capacityByUnit?: ReadonlyMap<string, number>;
}): ForgottenArtifactPlacementResult {
  const root = record(input.response);
  const placements = root && Array.isArray(root.placements) ? root.placements.map(record) : null;
  if (!root || !placements || Object.keys(root).some((key) => key !== "placements")) {
    return { ok: false, problems: ['placement response must be exactly {"placements":[...]}'] };
  }
  const problems: string[] = [];
  const unitIdCounts = new Map<string, number>();
  for (const unit of input.units) unitIdCounts.set(unit.id, (unitIdCounts.get(unit.id) ?? 0) + 1);
  const expected = new Set(input.artifactIds);
  const seen = new Set<string>();
  const omissions: JsonRecord[] = [];
  const ownerProblems: string[] = [];
  const insertions: ForgottenArtifactInsertion[] = [];
  const ownedCount = new Map<string, number>();
  placements.forEach((placement, index) => {
    const at = `placements[${index}]`;
    const artifactId = typeof placement?.sourceArtifactId === "string" ? placement.sourceArtifactId : "";
    if (!placement || !expected.has(artifactId)) {
      problems.push(`${at}.sourceArtifactId must be one of the forgotten artifact ids`);
      return;
    }
    if (seen.has(artifactId)) problems.push(`${at} places "${artifactId}" twice`);
    seen.add(artifactId);
    const owner = placement.ownerUnitId;
    const omission = record(placement.omission);
    if ((owner === undefined) === (omission === null)) {
      problems.push(`${at} must have exactly one of ownerUnitId or omission`);
    } else if (typeof owner === "string") {
      if (!uniquelyAddressableUnitId(owner, unitIdCounts)) {
        problems.push(`${at}.ownerUnitId "${owner}" is not an existing unit id`);
        return;
      }
      ownedCount.set(owner, (ownedCount.get(owner) ?? 0) + 1);
      const entry = record(placement.entry);
      const listKey = artifactListKey(artifactId);
      if (entry && listKey) {
        const entryProblems = ownerEntryProblems(at, listKey, entry);
        if (entryProblems.length > 0) problems.push(...entryProblems);
        else insertions.push({ unitId: owner, listKey, entry: { ...entry, id: artifactId } });
      } else {
        ownerProblems.push(
          `learning unit "${owner}" must own registered source artifact "${artifactId}", which the contract forgot: add it to the matching sourceFigures, sourceFormulas, or sourceTables list with a precise placement and teaching goal`,
        );
      }
    } else if (omission) {
      omissions.push({ sourceArtifactId: artifactId, ...omission });
    } else {
      problems.push(`${at}.ownerUnitId must be an exact unit id`);
    }
  });
  for (const id of expected) if (!seen.has(id)) problems.push(`no placement returned for forgotten artifact "${id}"`);
  if (input.capacityByUnit) {
    for (const [unitId, count] of ownedCount) {
      const room = input.capacityByUnit.get(unitId) ?? 0;
      if (count > room) {
        problems.push(`unit "${unitId}" was given ${count} new artifacts but its remainingArtifactCapacity is ${room}; place the rest in another unit that covers them or omit them with a specific reason`);
      }
    }
  }
  const existingOmissions = Array.isArray(input.candidate.sourceArtifactOmissions)
    ? input.candidate.sourceArtifactOmissions
    : [];
  const omissionProblems = modelAuthoredSourceArtifactOmissionParseProblems({
    sourceArtifactOmissions: [...existingOmissions, ...omissions],
  }).filter((problem) => {
    const index = Number(/sourceArtifactOmissions\[(\d+)]/.exec(problem)?.[1] ?? -1);
    return index < 0 || index >= existingOmissions.length;
  });
  problems.push(...omissionProblems);
  if (problems.length > 0) return { ok: false, problems: unique(problems) };
  return {
    ok: true,
    candidate: withForgottenArtifactInsertions(
      { ...input.candidate, sourceArtifactOmissions: [...existingOmissions, ...omissions] },
      insertions,
    ),
    ownerProblems,
    omissions,
    insertions,
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

${LEARN_LENGTH_PLANNING_RULES}
Use this unit-record schema, also including expectedWordRange as described above (optional fields are marked OPTIONAL):
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
  "sourceQuestions": [{
    "id": "exact sourceMap.sourceQuestions id",
    "placement": "inside_worked_example | guided_practice | end_of_page_check",
    "teachingGoal": "what solving it teaches"
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
 * exhausted. Provider exceptions and fulfilled missing/empty responses are
 * terminal and never spend a semantic repair attempt. Only a nonempty returned
 * candidate with concrete merge/validation problems can authorize another call.
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
  // A forgotten artifact names no unit, so it used to make the whole repair
  // "unscoped". Live 2026-09-23 (gpt-6-luna, telecom-1 M1): every full-contract
  // regeneration of 100+ artifacts dropped a different handful and planning
  // failed. The model now places just those artifacts; an owner choice becomes
  // a unit-scoped failure the unit repair below can fix.
  const ownerProblemByArtifact = new Map<string, string>();
  const withOwnerProblems = (list: readonly string[]): string[] => unique(list.map((problem) => {
    const artifactId = FORGOTTEN_ARTIFACT_PROBLEM.exec(problem)?.[1];
    return (artifactId && ownerProblemByArtifact.get(artifactId)) || problem;
  }));
  let placementRan = false;
  problems = withOwnerProblems(problems);

  for (let attempt = 1; attempt <= maxAttempts && problems.length > 0; attempt += 1) {
    let scope = scopeLearningSpineProblems(problems, units);
    // Forgotten artifacts are placed even beside other unscoped failures, and
    // an omission whose summary or reason is too vague is re-placed the same
    // way. Live 2026-09-30 (gpt-6-sol, telecom-1 M1): 617 forgotten artifacts
    // plus three vague omissions made the whole repair "unscoped". Batches
    // keep each placement answer small enough to be complete.
    const weak = weakOmissionIndexes(scope.unscopedProblems);
    const currentOmissions = Array.isArray(candidate.sourceArtifactOmissions)
      ? candidate.sourceArtifactOmissions
      : [];
    const weakIds = [...weak]
      .map((index) => record(currentOmissions[index])?.sourceArtifactId)
      .filter((id): id is string => typeof id === "string");
    const forgotten = unique([...forgottenArtifactIdsAmong(scope.unscopedProblems), ...weakIds]);
    if (forgotten.length > 0 && !placementRan) {
      placementRan = true;
      const baseOmissions = currentOmissions.filter((_, index) => !weak.has(index));
      const base: JsonRecord = { ...candidate, sourceArtifactOmissions: baseOmissions };
      const batches: string[][] = [];
      for (let index = 0; index < forgotten.length; index += FORGOTTEN_ARTIFACT_PLACEMENT_BATCH) {
        batches.push(forgotten.slice(index, index + FORGOTTEN_ARTIFACT_PLACEMENT_BATCH));
      }
      // Batches run in waves; a wave's batches split each unit's remaining
      // room so parallel answers cannot overfill one lesson together.
      const remaining = unitArtifactCapacity(units);
      const accepted: { omissions: JsonRecord[]; ownerProblems: string[]; insertions: ForgottenArtifactInsertion[] }[] = [];
      for (let waveStart = 0; waveStart < batches.length; waveStart += FORGOTTEN_ARTIFACT_PLACEMENT_CONCURRENCY) {
        const wave = batches.slice(waveStart, waveStart + FORGOTTEN_ARTIFACT_PLACEMENT_CONCURRENCY);
        const share = new Map([...remaining].map(([unitId, room]) => [unitId, Math.floor(room / wave.length)]));
        const placed = await mapWithConcurrency(wave, wave.length, async (ids, offset) => {
          const batch = waveStart + offset;
          let placementInvalidResponse: unknown;
          let placementProblems: string[] = [];
          for (let call = 1; call <= MAX_FORGOTTEN_ARTIFACT_PLACEMENT_CALLS; call += 1) {
            const response = await input.provider({
              ...buildForgottenArtifactPlacementRequest({
                attempt: call,
                artifactIds: ids,
                units,
                canonicalPlanningPacket: input.canonicalPlanningPacket,
                capacityByUnit: share,
                previousInvalidResponse: placementInvalidResponse,
                previousResponseProblems: placementProblems,
              }),
              ...(batches.length > 1 ? { placementBatch: batch + 1 } : {}),
            });
            calls += 1;
            if (response === null || response === undefined || (typeof response === "string" && !response.trim())) {
              throw new Error(
                "Learning-spine artifact placement provider returned no nonempty candidate; no semantic repair request was issued.",
              );
            }
            const result = applyForgottenArtifactPlacements({ candidate: base, artifactIds: ids, units, response, capacityByUnit: share });
            if (result.ok) {
              return { omissions: result.omissions, ownerProblems: result.ownerProblems, insertions: result.insertions };
            }
            placementInvalidResponse = response;
            placementProblems = result.problems;
          }
          return null;
        });
        for (const entry of placed) {
          if (!entry) continue;
          accepted.push(entry);
          for (const insertion of entry.insertions) {
            remaining.set(insertion.unitId, Math.max(0, (remaining.get(insertion.unitId) ?? 0) - 1));
          }
        }
      }
      if (accepted.length > 0) {
        const applied = {
          candidate: withForgottenArtifactInsertions(
            { ...base, sourceArtifactOmissions: [...baseOmissions, ...accepted.flatMap((entry) => entry.omissions)] },
            accepted.flatMap((entry) => entry.insertions),
          ),
          ownerProblems: accepted.flatMap((entry) => entry.ownerProblems),
        };
        candidate = applied.candidate;
        for (const ownerProblem of applied.ownerProblems) {
          const artifactId = /source artifact "([^"]+)"/.exec(ownerProblem)?.[1];
          if (artifactId) ownerProblemByArtifact.set(artifactId, ownerProblem);
        }
        const validation = await input.validateCandidate(candidate);
        units = validation.units;
        problems = withOwnerProblems(validation.problems);
        if (problems.length === 0) {
          return { status: "repaired", candidate, units, problems: [], calls, reviews, unscopedProblems: [] };
        }
        scope = scopeLearningSpineProblems(problems, units);
      }
    }
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
    if (
      response === null ||
      response === undefined ||
      (typeof response === "string" && !response.trim())
    ) {
      throw new Error(
        "Learning-spine targeted repair provider returned no nonempty candidate; no semantic repair request was issued.",
      );
    }
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
    const mergedProblems = withOwnerProblems(validation.problems);
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
