/**
 * Learning Unit Contract — the source-grounded intermediate representation that
 * Breadboard plans BEFORE writing any learner page.
 *
 * A learning garden is not planned as sections/subsections first. It is planned
 * as a sequence of *learning units*: the smallest meaningful teaching step in
 * the textbook. Each unit answers one conceptual learner question and OWNS the
 * source anchors, figures, formulas, interactive visual, and Zettelkasten note
 * handles needed for that step. Sections are then *clustered from* the units, so
 * a shallow "8 sections, 1 subsection each" map is structurally impossible.
 *
 * This module owns the section-title VALIDATION checks (naturalness, grammar,
 * semantic coherence). The topic-agnostic title GENERATION lives in
 * ./section-title.ts, which it delegates to; that module imports the validators
 * back for candidate scoring. The cycle is call-time only (neither module uses
 * the other at import/top-level), which ES modules resolve correctly.
 */

import type {
  ProposedLearningMap,
  LearningSectionPlan,
  LearningSubsectionPlan,
} from "./learn-utils";
import {
  buildGardenTopicProfile,
  foreignTitleContentWords,
  generateSectionTitle,
  type GardenTopicProfile,
} from "./section-title.ts";
import { semanticTagsFromText } from "./tags.ts";
import {
  SUPPORTED_RELATION_PREDICATES,
  alignSemanticConceptAliasesWithRegistry,
  isGenericFillerClaim,
  isValidPublicConceptSlug,
  normalizeConceptSlug,
  normalizeRelationPredicate,
  preferredLabelFromSlug,
  reconcileSemanticConceptAliases,
  type AliasConflict,
  type ConceptAliasRepair,
  type ConceptRegistry,
  type KnowledgeClaimPlan,
  type SemanticConceptPlan,
} from "./semantic-core.ts";
import type {
  ContractInteractiveVisualPlan,
  InteractiveVisualIntent,
  InteractiveVisualNecessity,
  InteractiveVisualOutputRepresentation,
  InteractiveVisualPedagogyContract,
  PreferredTeachingMedium,
  TeachingMediumPlan,
  VisualNecessityDecision,
} from "./visual-necessity-types.ts";
import type { VisualizationInteractionGoal } from "./visualization-registry.ts";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export type LearningUnitRole =
  | "motivation"
  | "core_concept"
  | "mechanism"
  | "formula"
  | "worked_example"
  | "training_method"
  | "metric"
  | "result_interpretation"
  | "comparison"
  | "application"
  | "limitation"
  | "synthesis";

export const LEARNING_UNIT_ROLES: readonly LearningUnitRole[] = [
  "motivation",
  "core_concept",
  "mechanism",
  "formula",
  "worked_example",
  "training_method",
  "metric",
  "result_interpretation",
  "comparison",
  "application",
  "limitation",
  "synthesis",
];

export type SourceFigurePlacement =
  | "inside_concept_explanation"
  | "after_formula_introduction"
  | "inside_result_interpretation"
  | "beside_worked_example"
  | "inside_comparison"
  | "not_used_with_reason";

export type SourceFormulaPlacement =
  | "before_example"
  | "inside_metric_definition"
  | "inside_result_interpretation";

export type SourceTablePlacement = "inside_comparison" | "inside_result_interpretation";

export interface SourceFigureContract {
  id: string;
  placement: SourceFigurePlacement;
  mustBeDiscussedWith: string;
  interpretationGoal: string;
  notUsedReason?: string;
}

export interface SourceFormulaContract {
  id: string;
  teachingGoal: string;
  termsToDefine: string[];
  placement: SourceFormulaPlacement;
}

export interface SourceTableContract {
  id: string;
  teachingGoal: string;
  rowsOrColumnsToExplain: string[];
  placement: SourceTablePlacement;
}

/** When a source figure is deliberately reused on a second unit. */
export interface FigureReusePolicy {
  allowed: boolean;
  reason: string;
}

export type InteractiveVisualContract = InteractiveVisualIntent;

export interface ZettelNote {
  handle: string;
  claim: string;
  connectedTo: string[];
}

export interface LearningUnitContract {
  id: string;
  title: string;
  role: LearningUnitRole;

  learningQuestion: string;
  prerequisiteConcepts: string[];
  newConcepts: string[];
  /** Exact syllabus unit IDs selected by the planning model; empty without a syllabus. */
  syllabusUnitIds?: string[];

  sourceAnchors: string[];

  sourceFigures: SourceFigureContract[];
  sourceFormulas: SourceFormulaContract[];
  sourceTables: SourceTableContract[];

  interactiveVisual?: InteractiveVisualContract;
  /** Necessity is decided before renderer/type routing. Only `required` is a hard blocker. */
  interactiveVisualPlan?: ContractInteractiveVisualPlan;
  /** The best teaching medium even when no interactive visual is selected. */
  teachingMediumPlan?: TeachingMediumPlan;

  zettelNotes: ZettelNote[];

  /** Canonical concept identities planned separately from readable claims. */
  semanticConcepts?: SemanticConceptPlan[];
  /** Evidence-grounded natural-language claims. Legacy zettelNotes remain migration input only. */
  knowledgeClaims?: KnowledgeClaimPlan[];

  mustNotRepeat: string[];
  expectedWordRange: [number, number];

  /**
   * Section ownership is authored with the learning spine. The active Learn
   * path projects these fields verbatim and never clusters units by role.
   */
  sectionPlan?: {
    id: string;
    title: string;
    purpose: string;
    singleSubsectionReason?: string;
  };
}

/** One decision about where a single source artifact is taught. */
export interface SourceArtifactAssignment {
  sourceArtifactId: string;
  assignedLearningUnitId: string;
  placement: SourceFigurePlacement;
  reason: string;
  requiredInterpretation: string;
  forbiddenSections?: string[];
}

function sourceArtifactAssignmentRecordKey(assignment: SourceArtifactAssignment): string {
  return JSON.stringify([
    assignment.sourceArtifactId,
    assignment.assignedLearningUnitId,
    assignment.placement,
    assignment.reason,
    assignment.requiredInterpretation,
    assignment.forbiddenSections ?? null,
  ]);
}

/**
 * Validation-only equality for an authored assignment projection. Registry
 * reconciliation may enumerate the same records in a different order, but it
 * must not add, remove, duplicate, or change any record. This helper never
 * normalizes, deduplicates, or rewrites either projection.
 */
export function sameSourceArtifactAssignmentRecords(
  left: readonly SourceArtifactAssignment[],
  right: readonly SourceArtifactAssignment[],
): boolean {
  if (left.length !== right.length) return false;
  const remaining = new Map<string, number>();
  for (const assignment of left) {
    const key = sourceArtifactAssignmentRecordKey(assignment);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  for (const assignment of right) {
    const key = sourceArtifactAssignmentRecordKey(assignment);
    const count = remaining.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) remaining.delete(key);
    else remaining.set(key, count - 1);
  }
  return remaining.size === 0;
}

/**
 * A model-authored decision not to teach one registered source artifact.
 *
 * Omissions are garden-wide rather than attached to a learning unit: attaching
 * an unused artifact to a unit would falsely imply pedagogical ownership. The
 * active Learn path persists these records verbatim beside assignments.
 */
export interface SourceArtifactOmission {
  sourceArtifactId: string;
  reason: string;
}

/** The dedupe fingerprint for an interactive visual. */
export interface InteractiveVisualSignature {
  visualType: string;
  controls: string[];
  sourceAnchors: string[];
  expectedInsight: string;
  conceptTarget: string;
}

/** Minimal description of a source artifact extracted from the uploads. */
export type SourceArtifactKind = "figure" | "table" | "formula" | "result" | "example";

export interface SourceArtifact {
  id: string;
  kind: SourceArtifactKind;
  caption?: string;
  page?: number;
  sourceId?: string;
}

/** Kinds that can be proven by the persisted SourceVisual ledger. */
export type RegisteredSourceArtifactKind = "figure" | "graph" | "table" | "formula";

export interface RegisteredSourceArtifact {
  id: string;
  kind: RegisteredSourceArtifactKind;
}

export interface SourceArtifactReconciliationResult {
  units: LearningUnitContract[];
  assignments: SourceArtifactAssignment[];
  /** Structured ids removed because no matching SourceVisual was registered. */
  removedArtifactIds: string[];
}

const STRUCTURED_SOURCE_ARTIFACT_ID_RE = /^S\d+\.P\d+\.(?:F|G|T|E)\d+$/i;

/**
 * Reconcile model-authored contracts against the authoritative SourceVisual
 * registry. Source prose is allowed to mention a figure-like label, but that
 * label does not become a figure/table/equation contract until its PDF page has
 * actually been rendered and scanned.
 *
 * This is intentionally projection-wide: an unsupported id is removed from
 * the unit field, generic/evidence anchors, visual intent, and durable artifact
 * assignments together. Leaving even one of those projections behind creates
 * an impossible final-repair loop.
 */
export function reconcileLearningUnitSourceArtifacts(
  units: LearningUnitContract[],
  assignments: SourceArtifactAssignment[],
  registeredArtifacts: Iterable<RegisteredSourceArtifact>,
): SourceArtifactReconciliationResult {
  const kindById = new Map(
    [...registeredArtifacts]
      .map((artifact) => [artifact.id.trim(), artifact.kind] as const)
      .filter(([id]) => id),
  );
  const removed = new Set<string>();
  const keepStructuredAnchor = (id: string): boolean => {
    const normalized = id.trim();
    if (!STRUCTURED_SOURCE_ARTIFACT_ID_RE.test(normalized)) return true;
    const keep = kindById.has(normalized);
    if (!keep) removed.add(normalized);
    return keep;
  };
  const keepKind = (
    id: string,
    expected: RegisteredSourceArtifactKind | readonly RegisteredSourceArtifactKind[],
  ): boolean => {
    const normalized = id.trim();
    const actual = kindById.get(normalized);
    const expectedKinds = Array.isArray(expected) ? expected : [expected];
    const keep = Boolean(actual && expectedKinds.includes(actual));
    if (!keep && normalized) removed.add(normalized);
    return keep;
  };
  const filterAnchors = (anchors: string[] | undefined): string[] =>
    (anchors ?? []).filter(keepStructuredAnchor);

  const reconciledUnits = units.map((unit): LearningUnitContract => {
    const sourceFigures = unit.sourceFigures.filter((figure) =>
      keepKind(figure.id, ["figure", "graph"]),
    );
    const sourceTables = unit.sourceTables.filter((table) => keepKind(table.id, "table"));
    const sourceFormulas = unit.sourceFormulas.filter((formula) => keepKind(formula.id, "formula"));
    const interactiveVisual = unit.interactiveVisual
      ? { ...unit.interactiveVisual, sourceAnchors: filterAnchors(unit.interactiveVisual.sourceAnchors) }
      : undefined;
    const interactiveVisualPlan = unit.interactiveVisualPlan
      ? {
          ...unit.interactiveVisualPlan,
          decision: {
            ...unit.interactiveVisualPlan.decision,
            evidence: {
              ...unit.interactiveVisualPlan.decision.evidence,
              sourceAnchorIds: filterAnchors(
                unit.interactiveVisualPlan.decision.evidence.sourceAnchorIds,
              ),
            },
          },
          ...(unit.interactiveVisualPlan.visualIntent
            ? {
                visualIntent: {
                  ...unit.interactiveVisualPlan.visualIntent,
                  sourceAnchors: filterAnchors(
                    unit.interactiveVisualPlan.visualIntent.sourceAnchors,
                  ),
                },
              }
            : {}),
        }
      : undefined;
    const sourceFigureAnchorId = unit.teachingMediumPlan?.sourceFigureAnchorId;
    const teachingMediumPlan = unit.teachingMediumPlan
      ? {
          ...unit.teachingMediumPlan,
          ...(sourceFigureAnchorId && keepKind(sourceFigureAnchorId, ["figure", "graph"])
            ? { sourceFigureAnchorId }
            : { sourceFigureAnchorId: undefined }),
          ...(unit.teachingMediumPlan.formulaAnchorIds
            ? {
                formulaAnchorIds: unit.teachingMediumPlan.formulaAnchorIds.filter((id) =>
                  keepKind(id, "formula"),
                ),
              }
            : {}),
        }
      : undefined;

    return {
      ...unit,
      sourceAnchors: filterAnchors(unit.sourceAnchors),
      sourceFigures,
      sourceFormulas,
      sourceTables,
      interactiveVisual,
      interactiveVisualPlan,
      teachingMediumPlan,
      semanticConcepts: unit.semanticConcepts?.map((concept) => ({
        ...concept,
        evidenceAnchors: filterAnchors(concept.evidenceAnchors),
      })),
      knowledgeClaims: unit.knowledgeClaims?.map((claim) => ({
        ...claim,
        evidenceAnchors: filterAnchors(claim.evidenceAnchors),
        ...(claim.derivationAnchors
          ? { derivationAnchors: filterAnchors(claim.derivationAnchors) }
          : {}),
      })),
    };
  });

  const survivingByUnit = new Map<string, Set<string>>(
    reconciledUnits.map((unit) => [
      unit.id,
      new Set([
        ...unit.sourceFigures.map((figure) => figure.id),
        ...unit.sourceFormulas.map((formula) => formula.id),
        ...unit.sourceTables.map((table) => table.id),
      ]),
    ]),
  );
  const reconciledAssignments = assignments.filter((assignment) => {
    const keep = survivingByUnit
      .get(assignment.assignedLearningUnitId)
      ?.has(assignment.sourceArtifactId) ?? false;
    // A registered artifact can still have a stale/wrong-unit assignment. Drop
    // that projection without misreporting the artifact itself as unregistered.
    if (!keep && assignment.sourceArtifactId && !kindById.has(assignment.sourceArtifactId)) {
      removed.add(assignment.sourceArtifactId);
    }
    return keep;
  });

  return {
    units: reconciledUnits,
    assignments: dedupeSourceArtifactAssignments(reconciledAssignments, reconciledUnits),
    removedArtifactIds: [...removed].sort(),
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function compact(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => compact(item)).filter(Boolean);
  }
  const single = compact(value);
  return single ? [single] : [];
}

function asRole(value: unknown): LearningUnitRole {
  const raw = compact(value).toLowerCase().replace(/[\s-]+/g, "_");
  return (LEARNING_UNIT_ROLES as readonly string[]).includes(raw)
    ? (raw as LearningUnitRole)
    : "core_concept";
}

const FIGURE_PLACEMENTS: readonly SourceFigurePlacement[] = [
  "inside_concept_explanation",
  "after_formula_introduction",
  "inside_result_interpretation",
  "beside_worked_example",
  "inside_comparison",
  "not_used_with_reason",
];

function asFigurePlacement(value: unknown, fallback: SourceFigurePlacement): SourceFigurePlacement {
  const raw = compact(value).toLowerCase().replace(/[\s-]+/g, "_");
  return (FIGURE_PLACEMENTS as readonly string[]).includes(raw)
    ? (raw as SourceFigurePlacement)
    : fallback;
}

// ---------------------------------------------------------------------------
// Zettelkasten handles (Fix 6 / Fix 7)
// ---------------------------------------------------------------------------

const HANDLE_STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "to", "in", "on", "for", "with", "by",
  "is", "are", "be", "as", "at", "it", "its", "this", "that", "into", "from",
  "than", "then", "so", "but", "can", "will", "may", "not",
]);

/**
 * Turn a claim ("A model can be accurate while still being too slow or
 * energy-hungry") into an atomic lower-kebab-case Zettelkasten handle
 * ("accuracy-alone-hides-energy-and-latency-cost"-style). No slash namespaces,
 * no broad single words: a handle expresses a concept or claim, not a category.
 */
export function atomicZettelHandle(claim: string): string {
  const slug = compact(claim)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    // Slash namespaces are explicitly banned; collapse any that slipped in.
    .replace(/\//g, "-");
  const words = slug.split("-").filter(Boolean);
  // Keep meaning words but preserve short glue words that carry the claim
  // ("saves", "by", "hides"). We only trim leading/trailing stopwords and cap
  // the length so the handle stays a readable claim, not a sentence.
  while (words.length > 3 && HANDLE_STOPWORDS.has(words[0])) words.shift();
  while (words.length > 3 && HANDLE_STOPWORDS.has(words[words.length - 1])) words.pop();
  return words.slice(0, 9).join("-");
}

/**
 * An atomic handle is lower-kebab-case, has no slash namespace, is not a broad
 * single word, and reads like a concept/claim (>= 2 meaningful words).
 */
export function isAtomicZettelHandle(tag: string): boolean {
  const value = compact(tag).toLowerCase();
  if (!value) return false;
  if (value.includes("/")) return false;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value)) return false;
  const words = value.split("-").filter(Boolean);
  // At least two words, and not a single broad category term.
  if (words.length < 2) return false;
  const meaningful = words.filter((word) => word.length >= 3 && !HANDLE_STOPWORDS.has(word));
  return meaningful.length >= 2;
}

/** Deduped atomic handles taken from a unit's planned zettelNotes. */
export function zettelHandlesForUnit(unit: LearningUnitContract): string[] {
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const note of unit.zettelNotes ?? []) {
    const handle = atomicZettelHandle(note.handle || note.claim);
    if (!handle || !isAtomicZettelHandle(handle) || seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
  }
  return handles;
}

function inferredClaimPredicate(text: string): ReturnType<typeof normalizeRelationPredicate> {
  if (/\bcaus(?:e|es|ed)\b/i.test(text)) return "causes";
  if (/\benabl(?:e|es|ed)\b/i.test(text)) return "enables";
  if (/\bmeasur(?:e|es|ed|ement)\b/i.test(text)) return "measured-by";
  if (/\bcontrast|whereas|unlike\b/i.test(text)) return "contrasts-with";
  if (/\blimit|bound|constraint\b/i.test(text)) return "limits";
  if (/\bemits?.*\bwhen\b|\bfires?.*\bwhen\b/i.test(text)) return "emits-when";
  if (/\bderived? from\b/i.test(text)) return "derived-from";
  return "related-to";
}

function normalizedConceptPlan(raw: unknown): SemanticConceptPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const slug = normalizeConceptSlug(compact(record.slug ?? record.id ?? record.preferredLabel));
  if (!isValidPublicConceptSlug(slug)) return null;
  return {
    slug,
    preferredLabel: compact(record.preferredLabel ?? record.label) || preferredLabelFromSlug(slug),
    role: compact(record.role).toLowerCase() === "primary" ? "primary" : "supporting",
    aliases: asStringArray(record.aliases),
    evidenceAnchors: asStringArray(record.evidenceAnchors ?? record.sourceAnchors),
  };
}

function deriveSemanticConcepts(unit: LearningUnitContract): SemanticConceptPlan[] {
  const explicit = (unit.semanticConcepts ?? [])
    .map(normalizedConceptPlan)
    .filter((plan): plan is SemanticConceptPlan => Boolean(plan));
  if (explicit.length > 0) {
    const seen = new Set<string>();
    return explicit.filter((plan) => !seen.has(plan.slug) && Boolean(seen.add(plan.slug))).slice(0, 5);
  }

  const directPrimary = (unit.newConcepts ?? [])
    .map(normalizeConceptSlug)
    .filter(isValidPublicConceptSlug);
  const directSupporting = (unit.prerequisiteConcepts ?? [])
    .map(normalizeConceptSlug)
    .filter(isValidPublicConceptSlug);
  const inferred = semanticTagsFromText(
    [
      unit.title,
      unit.learningQuestion,
      ...(unit.zettelNotes ?? []).map((note) => note.claim),
    ].join("\n"),
    5,
  ).filter(isValidPublicConceptSlug);
  const ordered = [...directPrimary, ...directSupporting, ...inferred]
    .filter((slug, index, all) => all.indexOf(slug) === index)
    .slice(0, 5);
  const primaryCandidates = directPrimary.length > 0
    ? new Set(directPrimary.slice(0, 2))
    : new Set(ordered.slice(0, 1));
  return ordered.map((slug) => ({
    slug,
    preferredLabel: preferredLabelFromSlug(slug),
    role: primaryCandidates.has(slug) ? "primary" : "supporting",
    aliases: [],
    evidenceAnchors: [...new Set(unit.sourceAnchors ?? [])],
  }));
}

function normalizedKnowledgeClaim(raw: unknown): KnowledgeClaimPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const text = compact(record.text ?? record.claim ?? record.statement);
  if (!text || isGenericFillerClaim(text)) return null;
  const subject = normalizeConceptSlug(compact(record.subject));
  if (!subject) return null;
  const object = normalizeConceptSlug(compact(record.object));
  return {
    text,
    subject,
    predicate: normalizeRelationPredicate(record.predicate),
    ...(object ? { object } : {}),
    conceptIds: asStringArray(record.conceptIds ?? record.concepts).map(normalizeConceptSlug).filter(Boolean),
    evidenceAnchors: asStringArray(record.evidenceAnchors ?? record.sourceAnchors),
    derivationAnchors: asStringArray(record.derivationAnchors),
    connectedClaimIds: asStringArray(record.connectedClaimIds),
  };
}

function deriveKnowledgeClaims(unit: LearningUnitContract): KnowledgeClaimPlan[] {
  const explicit = (unit.knowledgeClaims ?? [])
    .map(normalizedKnowledgeClaim)
    .filter((claim): claim is KnowledgeClaimPlan => Boolean(claim));
  if (explicit.length > 0) return explicit;
  const concepts = deriveSemanticConcepts(unit);
  const subject = concepts.find((concept) => concept.role === "primary")?.slug ?? concepts[0]?.slug;
  if (!subject) return [];
  return (unit.zettelNotes ?? []).flatMap((note) => {
    const text = compact(note.claim);
    if (!text || isGenericFillerClaim(text)) return [];
    const object = (note.connectedTo ?? [])
      .map(normalizeConceptSlug)
      .find((slug) => isValidPublicConceptSlug(slug) && slug !== subject);
    return [{
      text,
      subject,
      predicate: inferredClaimPredicate(text),
      ...(object ? { object } : {}),
      conceptIds: concepts.map((concept) => concept.slug),
      evidenceAnchors: [...new Set(unit.sourceAnchors ?? [])],
      derivationAnchors: [],
      connectedClaimIds: [],
    }];
  });
}

export function semanticConceptsForUnit(unit: LearningUnitContract): SemanticConceptPlan[] {
  return deriveSemanticConcepts(unit);
}

export function reconcileLearningUnitConceptAliases(
  units: readonly LearningUnitContract[],
): {
  units: LearningUnitContract[];
  repairs: ConceptAliasRepair[];
  conflicts: AliasConflict[];
} {
  const plansByUnit = units.map(semanticConceptsForUnit);
  const planCounts = plansByUnit.map((plans) => plans.length);
  const reconciled = reconcileSemanticConceptAliases(
    plansByUnit.flat(),
  );
  let cursor = 0;
  const nextUnits = units.map((unit, index) => {
    const semanticConcepts = reconciled.concepts.slice(cursor, cursor + planCounts[index]);
    cursor += planCounts[index];
    return { ...unit, semanticConcepts };
  });
  return {
    units: nextUnits,
    repairs: reconciled.repairs,
    conflicts: reconciled.conflicts,
  };
}

export function alignLearningUnitConceptAliasesWithRegistry(
  units: readonly LearningUnitContract[],
  registry: ConceptRegistry,
): LearningUnitContract[] {
  const plansByUnit = units.map(semanticConceptsForUnit);
  const planCounts = plansByUnit.map((plans) => plans.length);
  const aligned = alignSemanticConceptAliasesWithRegistry(
    plansByUnit.flat(),
    registry,
  );
  let cursor = 0;
  return units.map((unit, index) => {
    const semanticConcepts = aligned.slice(cursor, cursor + planCounts[index]);
    cursor += planCounts[index];
    return { ...unit, semanticConcepts };
  });
}

export function knowledgeClaimsForUnit(unit: LearningUnitContract): KnowledgeClaimPlan[] {
  return deriveKnowledgeClaims(unit);
}

export function conceptTagsForUnit(unit: LearningUnitContract): string[] {
  return semanticConceptsForUnit(unit).map((concept) => concept.slug).slice(0, 5);
}

// Fallback claims used only when a unit ships fewer than three model-authored
// zettel notes. They must read as durable, concept-specific claims — never as a
// description of the tag's function (see final-garden-state naturalness audit).
const SCAFFOLD_ZETTEL_PATTERNS: RegExp[] = [
  // Planner-scaffold phrases. The newer template phrases (Fix 7) are enforced by
  // the canonical FinalGardenState audit and repaired deterministically by the
  // finalizer's reconcile pass, so they are NOT added here — routing them
  // through the per-page repair loop would stamp pages the finalizer then
  // re-cleans, breaking finalize idempotency.
  /\bnames-the-durable-idea\b/i,
  /\blearners-reuse\b/i,
  /\bidentifies-the-source-problem\b/i,
  /\brecords-the-source-relationship\b/i,
  /\bstates-what-the-reported-result-supports\b/i,
  /\bkeeps-the-result-tied\b/i,
  /\bchanges-behavior-through-a-specific-mechanism\b/i,
  /\bfixes-which-variables-carry-the-claim\b/i,
  /\bturns-a-broad-problem\b/i,
  /\bconnects-vocabulary\b/i,
  /\bexplains-how\b/i,
  /\bintroduces-the-topic\b/i,
  /\bsets-up\b/i,
  /\bbridges-to\b/i,
  /\bhelps-understand\b/i,
  /\bdefines-the-lesson-s-central-idea\b/i,
  /\banchors-the-lesson-s-source-evidence\b/i,
  /\bconnects-learner-question-to-source-anchors\b/i,
  /\bexplains-why-the-topic-matters\b/i,
  /\bturns-separate-lessons\b/i,
];

export function scaffoldLikeZettelHandle(handle: string): boolean {
  const normalized = atomicZettelHandle(handle);
  return SCAFFOLD_ZETTEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function zettelHandleQualityProblems(unit: LearningUnitContract): string[] {
  const problems: string[] = [];
  for (const note of unit.zettelNotes ?? []) {
    const handle = atomicZettelHandle(note.handle || note.claim);
    if (handle && scaffoldLikeZettelHandle(handle)) {
      problems.push(`unit "${unit.id}": zettel handle "${handle}" sounds like planner scaffolding, not a reusable source-specific claim`);
    }
  }
  return problems;
}

/** Every atomic handle used across the whole garden, with its per-unit count. */
export function zettelHandleFrequency(units: LearningUnitContract[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const unit of units) {
    for (const handle of new Set(zettelHandlesForUnit(unit))) {
      counts.set(handle, (counts.get(handle) ?? 0) + 1);
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Section semantic coherence and title polish
// ---------------------------------------------------------------------------

export type SectionRoleFamily =
  | "motivation"
  | "mechanism"
  | "training_method"
  | "metric"
  | "comparison"
  | "application"
  | "synthesis";

export interface SectionSemanticProfile {
  sectionTitle: string;
  sectionRole?: string;
  subsectionRoles: string[];
  subsectionTitles: string[];
  dominantConcepts: string[];
  outlierUnits: string[];
  titleMatchesUnits: boolean;
  problems: string[];
}

export interface SectionTitlePolishInput {
  sectionNumber: number;
  originalTitle: string;
  unitTitles: string[];
  unitRoles: string[];
  sourceAnchorTitles: string[];
  dominantLearnerQuestion: string;
}

export interface SectionSemanticInput {
  sectionTitle: string;
  units: LearningUnitContract[];
  subsectionTitles?: string[];
}

function unitRoleFamily(role: LearningUnitRole): SectionRoleFamily {
  switch (role) {
    case "motivation":
      return "motivation";
    case "training_method":
      return "training_method";
    case "formula":
    case "worked_example":
      return "metric";
    case "metric":
      return "metric";
    case "result_interpretation":
      return "comparison";
    case "comparison":
      return "comparison";
    case "application":
    case "limitation":
      return "application";
    case "synthesis":
      return "synthesis";
    default:
      return "mechanism";
  }
}

// Topic-neutral role hints. These are a CONSISTENCY CHECK on title vocabulary,
// not the primary role detector (unit roles are the source of truth). They must
// stay free of domain proper nouns — any subject-specific term is supplied by a
// GardenTopicProfile or section concepts, never hardcoded here.
const TITLE_ROLE_HINTS: Array<[SectionRoleFamily, RegExp]> = [
  ["motivation", /\bwhy\b|\bexist\b|\bmotivat|\bneed\b|\bpurpose\b|\bproblem\b|\bmatter/i],
  ["mechanism", /\bmechanism|\bmechanics\b|\bworks?\b|\bworking\b|\bprocess\b|\bhow it\b|\bdynamics\b|\barchitecture\b|\bstructure\b|\bstate\b|\bstep/i],
  ["training_method", /\blearn(?:s|ing)?\b|\btrain(?:s|ing|ed)?\b|\bmethod\b|\bstrateg|\bapproach|\btechnique|\balgorithm|\boptimiz/i],
  ["metric", /\bmetric|\bmeasur|\bevaluat|\bperformance\b|\bscore|\bquantif|\bassess|\bformal|\bmathematical|\bequation|\bnotation/i],
  ["comparison", /\bcompar|\btrade[- ]?off|\bversus\b|\bvs\b|\balternativ|\bresults?\b/i],
  ["application", /\bapplication|\bapplied\b|\bpractical|\buse case|\breal[- ]world|\bdeploy|\bwhere\b|\bfit\b|\badoption\b|\bblocks?\b|\bchallenge|\blimit|\bconstraint|\bopen question|\bfuture|\bunresolved/i],
  ["synthesis", /\btogether\b|\bunified\b|\bbig picture\b|\bconnect|\boverview\b|\bframework\b|\bsynthes/i],
];

export function sectionRoleFamilyForUnitRole(role: LearningUnitRole): SectionRoleFamily {
  return unitRoleFamily(role);
}

export function sectionTitleRoleHints(title: string): SectionRoleFamily[] {
  const clean = compact(title).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
  const roles: SectionRoleFamily[] = [];
  for (const [role, pattern] of TITLE_ROLE_HINTS) {
    if (pattern.test(clean) && !roles.includes(role)) roles.push(role);
  }
  return roles;
}

function semanticProblem(sectionTitle: string, dominantRoles: string[], problem: string, suggestedFix: string): string {
  return `SECTION_SEMANTIC_MISMATCH section="${sectionTitle}" dominantRoles=[${dominantRoles.map((role) => `"${role}"`).join(", ")}] problem="${problem}" suggestedFix="${suggestedFix}"`;
}

function importantSectionFamilies(families: SectionRoleFamily[]): SectionRoleFamily[] {
  const important = families.filter((role) => role !== "motivation" && role !== "synthesis");
  return important.length > 0 ? important : families;
}

const TITLE_CONTENT_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "from",
  "why", "how", "what", "when", "where", "which", "is", "are", "it", "its",
  "this", "that", "still", "yet", "not", "as", "at", "by", "about",
]);

/** Lowercased content words (>= 3 chars, non-stopword) — a topic-neutral way to
 * ask "does this title mention one of the section's own concepts?". */
function titleContentWords(value: string): string[] {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .flatMap((word) => word.split("-"))
    .filter((word) => word.length >= 3 && !TITLE_CONTENT_STOPWORDS.has(word));
}

export function sectionSemanticProfile(input: SectionSemanticInput): SectionSemanticProfile {
  const sectionTitle = compact(input.sectionTitle);
  const units = input.units ?? [];
  const subsectionTitles = input.subsectionTitles?.length
    ? input.subsectionTitles.map(compact).filter(Boolean)
    : units.map((unit) => compact(unit.title)).filter(Boolean);
  const subsectionRoles = units.map((unit) => unit.role);
  const familyCounts = new Map<SectionRoleFamily, number>();
  for (const unit of units) {
    const family = unitRoleFamily(unit.role);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }
  const families = [...familyCounts.keys()];
  const importantFamilies = importantSectionFamilies(families);
  const maxCount = Math.max(0, ...[...familyCounts.values()]);
  const dominantFamilies = [...familyCounts.entries()]
    .filter(([, count]) => count === maxCount)
    .map(([role]) => role);
  const titleHints = sectionTitleRoleHints(sectionTitle);
  const titleAcknowledgesMixed =
    titleHints.length >= 2 ||
    /\b(?:and|or|from .+ to|through|across|pipeline|framework|strategy|trade[- ]?off|unified)\b/i.test(sectionTitle);
  const dominantConcepts = [
    ...new Set(
      units
        .flatMap((unit) => [...(unit.newConcepts ?? []), unit.title])
        .map((value) => compact(value).toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 8);
  const dominantRoleLabels = importantFamilies.length ? importantFamilies : dominantFamilies;
  const problems: string[] = [];

  // Content words the title shares with the section's own concepts (topic
  // agnostic: no hardcoded domain nouns).
  const sectionConceptTexts = [...subsectionTitles, ...dominantConcepts, ...units.flatMap((unit) => unit.newConcepts ?? [])];
  const conceptWords = new Set(sectionConceptTexts.flatMap((value) => titleContentWords(value)));
  const titleNamesSectionConcept = titleContentWords(sectionTitle).some((word) => conceptWords.has(word));
  const purposeMatched = titleHints.some((hint) => families.includes(hint));

  if (units.length > 0 && titleHints.length > 0) {
    const titleHas = (role: SectionRoleFamily) => titleHints.includes(role);
    const unitHas = (role: SectionRoleFamily) => families.includes(role);
    const titleMetricOnly = (titleHas("metric") || titleHas("comparison")) && !titleHas("training_method") && !titleAcknowledgesMixed;
    const titleTrainingOnly = titleHas("training_method") && !titleHas("metric") && !titleHas("comparison") && !titleAcknowledgesMixed;
    const titleMechanismOnly = titleHas("mechanism") && !titleHas("application") && !titleAcknowledgesMixed;
    if (unitHas("training_method") && titleMetricOnly) {
      problems.push(semanticProblem(sectionTitle, dominantRoleLabels, "training units are grouped under a metrics-only title", "split section or retitle to include training and evaluation"));
    }
    if ((unitHas("metric") || unitHas("comparison")) && titleTrainingOnly) {
      problems.push(semanticProblem(sectionTitle, dominantRoleLabels, "metric/evaluation units are grouped under a training-only title", "split section or retitle to include training and evaluation"));
    }
    if (unitHas("application") && titleMechanismOnly) {
      problems.push(semanticProblem(sectionTitle, dominantRoleLabels, "application or limitation units sit under a mechanism/formula title", "split section or retitle to include applications and limitations"));
    }
    // The generic purpose-mismatch checks only fire when the title does NOT name
    // any of the section's own concepts. A title that uses the section's concept
    // vocabulary is on-topic even if a concept name coincidentally contains a
    // role-hint word (e.g. "Optimization" reading as a method hint, "Equation"
    // as a metric hint). Specific structural checks above still fire.
    const missing = importantFamilies.filter((role) => !titleHints.includes(role));
    if (importantFamilies.length >= 2 && missing.length > 0 && !titleAcknowledgesMixed && !titleNamesSectionConcept) {
      problems.push(semanticProblem(sectionTitle, dominantRoleLabels, `mixed section title omits ${missing.join(", ")} role(s)`, "split the section or use a title that names the mixed purpose"));
    }
    if (importantFamilies.length === 1 && !titleHints.includes(importantFamilies[0]) && !titleNamesSectionConcept) {
      problems.push(semanticProblem(sectionTitle, dominantRoleLabels, `title vocabulary points to ${titleHints.join(", ")} but units are ${importantFamilies[0]}`, "retitle the section to match the unit role"));
    }
  }

  // Topic-agnostic off-topic detection: a title that neither reflects the
  // section's purpose (via role hints) nor names any of the section's own
  // concepts, yet introduces foreign, non-universal content words, is unrelated
  // to the section's units. This replaces the old domain-noun regexes and works
  // for any subject (e.g. a "Neuron Membrane Potential Dynamics" title on a
  // metrics section, or an SNN title on a photosynthesis section).
  if (units.length > 0 && problems.length === 0 && !purposeMatched && !titleNamesSectionConcept) {
    const foreign = foreignTitleContentWords(sectionTitle, sectionConceptTexts);
    if (foreign.length > 0) {
      problems.push(semanticProblem(
        sectionTitle,
        dominantRoleLabels,
        `title introduces concepts foreign to the section (${foreign.slice(0, 3).join(", ")})`,
        "retitle the section to match its units",
      ));
    }
  }

  const outlierUnits = units
    .filter((unit) => {
      const family = unitRoleFamily(unit.role);
      return importantFamilies.length > 1 && (familyCounts.get(family) ?? 0) === 1 && !titleHints.includes(family);
    })
    .map((unit) => `${unit.id}:${unit.title}`);

  return {
    sectionTitle,
    sectionRole: titleHints.join("+") || dominantFamilies.join("+") || undefined,
    subsectionRoles,
    subsectionTitles,
    dominantConcepts,
    outlierUnits,
    titleMatchesUnits: problems.length === 0,
    problems,
  };
}

export function sectionSemanticProfiles(inputs: SectionSemanticInput[]): SectionSemanticProfile[] {
  return inputs.map(sectionSemanticProfile);
}

const PLURAL_VERB_FIXES: Record<string, string> = {
  Fits: "Fit",
  Learns: "Learn",
  Uses: "Use",
  Works: "Work",
  Does: "Do",
  Has: "Have",
  Is: "Are",
  Explains: "Explain",
  Measures: "Measure",
};

export function sectionTitleGrammarProblems(title: string, subsectionTitles: string[] = []): string[] {
  const problems: string[] = [];
  const clean = compact(title).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
  for (const match of clean.matchAll(/\b([A-Z]{2,}s|[A-Z][a-z]+s)\s+(Fits|Learns|Uses|Works|Does|Has|Is|Explains|Measures)\b/g)) {
    const subject = match[1] ?? "";
    const verb = match[2] ?? "";
    problems.push(`section title grammar: plural subject "${subject}" should use "${PLURAL_VERB_FIXES[verb] ?? verb}", not "${verb}"`);
  }
  if (/Where\s+\S+s\s+Fit[s]?\s+and\s+What\s+Still\s+Blocks\s+It/i.test(clean)) {
    problems.push('section title grammar: awkward pronoun mismatch; prefer "what still blocks adoption" or "what still blocks them"');
  }
  if (/This Topic|and the Mechanism Works|and it Is Measured|How It Learns or Changes|The Formal Description|The Formal Pieces/i.test(clean)) {
    problems.push(`section title exposes planning scaffold phrasing: "${clean}"`);
  }
  if (/\b(?:Learning Unit|Contract|Planning|Subsection|Source[- ]grounded|Role:|Unit\s+\d+)\b/i.test(clean)) {
    problems.push(`section title exposes internal planning language: "${clean}"`);
  }
  const normalizedTitle = slugLike(clean);
  const duplicated = subsectionTitles
    .map((sub) => compact(sub).replace(/^\d+(?:\.\d+)*\.?\s*/, ""))
    .filter((sub) => slugLike(sub) === normalizedTitle);
  if (duplicated.length > 0 && subsectionTitles.length <= 1) {
    problems.push(`section title duplicates its only subsection title: "${clean}"`);
  }
  return problems;
}

const SECTION_TITLE_SCAFFOLD_PATTERNS: RegExp[] = [
  /\bFormula Mechanics\b/i,
  /\bConcept Mechanics\b/i,
  /\bCorrect Prediction Count\b/i,
  /\bTotal Prediction Count\b/i,
  /\bSpike Cost\b/i,
  /\bSynaptic Operation Cost\b/i,
  /\bChanges Behavior Through a Specific Mechanism\b/i,
  /\bNames the Durable Idea\b/i,
  /\bFixes Which Variables Carry the Claim\b/i,
  /\bConnects Vocabulary to Mechanism\b/i,
  /\bExplains How the System Changes State\b/i,
  /\bSets Up the Next\b/i,
  /\bIntroduces the Topic\b/i,
  /\bMeasuring the Core Quantities\b/i,
];

export function sectionTitleNaturalnessProblems(title: string, subsectionTitles: string[] = []): string[] {
  const problems: string[] = [];
  const clean = compact(title).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
  for (const pattern of SECTION_TITLE_SCAFFOLD_PATTERNS) {
    if (pattern.test(clean)) {
      problems.push(`section title exposes source-anchor or planner wording: "${clean}"`);
      break;
    }
  }
  const commaParts = clean.split(",").map((part) => part.trim()).filter(Boolean);
  if (
    commaParts.length >= 3 &&
    !/^(?:Measuring|Comparing|Reading|Choosing|How)\b/i.test(clean) &&
    /\b(?:formula|count|cost|prediction|operation|variable|anchor|field|synaptic|spike)\b/i.test(clean)
  ) {
    problems.push(`section title looks like a comma-separated source-anchor field list: "${clean}"`);
  }
  if (clean.length > 82 && commaParts.length >= 2) {
    problems.push(`section title is too long and list-like for learner navigation: "${clean}"`);
  }
  const normalizedTitle = slugLike(clean);
  for (const sub of subsectionTitles) {
    const subTitle = compact(sub).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
    if (normalizedTitle && slugLike(subTitle) === normalizedTitle && subsectionTitles.length <= 1) {
      problems.push(`section title duplicates its only subsection title: "${clean}"`);
    }
  }
  return problems;
}

function slugLike(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function normalizedSectionTitleKey(title: string): string {
  return slugLike(compact(title).replace(/^\d+(?:\.\d+)*\.?\s*/, ""));
}

export function sectionTitleUniquenessProblems(sections: Array<{ rel?: string; title: string }>): string[] {
  const problems: string[] = [];
  const byTitle = new Map<string, Array<{ rel?: string; title: string; index: number }>>();
  sections.forEach((section, index) => {
    const key = normalizedSectionTitleKey(section.title);
    if (!key) return;
    const list = byTitle.get(key) ?? [];
    list.push({ ...section, index });
    byTitle.set(key, list);
  });
  for (const [key, list] of byTitle) {
    if (list.length <= 1) continue;
    const locations = list.map((item) => item.rel ?? item.title).join(", ");
    const adjacent = list.some((item, index) => index > 0 && item.index === list[index - 1].index + 1);
    problems.push(
      `SECTION_TITLE_DUPLICATE normalized="${key}" sections=[${locations}]${adjacent ? " adjacent=true" : ""}`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Interactive visual source-grounding semantics
// ---------------------------------------------------------------------------

export type InteractiveVisualGroundingStatus =
  | "source-grounded"
  | "source-derived-conceptual"
  | "conceptual-no-direct-source-figure"
  | "source-anchored";

export interface InteractiveVisualGroundingCheckInput {
  visualType: string;
  sourceAnchors: string[];
  sourceAnchorText: string;
  status?: string;
  justification?: string;
  conceptText?: string;
}

const VISUAL_ANCHOR_REQUIREMENTS: Record<string, RegExp> = {
  lif_neuron: /\blif\b|leaky|membrane potential|threshold|reset|leak|neuron (?:model|dynamics)|integrate[- ]and[- ]fire/i,
  stdp_window: /\bstdp\b|spike[- ]timing|pre.*post|post.*pre|plasticity|local learning|hebbian|timing window/i,
  // The trusted calculator is an SNN/ML renderer (accuracy, latency, spike
  // count, energy per inference). Generic physics words such as "energy" or
  // "formula" must route to a domain-generated visual instead.
  metric_calculator: /\b(?:snn|spiking|spike count|energy per (?:spike|inference)|neuromorphic|classification accuracy|inference latency)\b|accuracy.{0,80}latency.{0,80}energy/i,
  training_curve: /loss|accuracy curve|convergence|epoch|target|training|learning curve/i,
  tradeoff_explorer: /trade[- ]?off|compar|versus|vs\b|accuracy|latency|energy|spike count|metric|result|performance|deployment|budget|model/i,
  neural_coding: /spike|spiking|timing|temporal|rate cod|firing rate|encoding|coding|event[- ]driven/i,
};

const MECHANISM_VISUAL_TYPES = new Set(["lif_neuron", "stdp_window", "neural_coding"]);
const RESULT_ONLY_ANCHOR_RE = /\b(?:result|results|latency|energy|accuracy|performance|comparison|table|training loss|curve|benchmark)\b/i;

export function anchorTextCompatibleWithVisualType(visualType: string, anchorText: string): boolean {
  const type = normalizeInteractiveVisualType(visualType);
  const text = compact(anchorText);
  if (!text) return false;
  const requirement = VISUAL_ANCHOR_REQUIREMENTS[type];
  if (!requirement) return true;
  if (!requirement.test(text)) return false;
  if (MECHANISM_VISUAL_TYPES.has(type) && RESULT_ONLY_ANCHOR_RE.test(text) && !requirement.test(text.replace(RESULT_ONLY_ANCHOR_RE, ""))) {
    return false;
  }
  return true;
}

export function interactiveVisualGroundingProblems(input: InteractiveVisualGroundingCheckInput): string[] {
  const problems: string[] = [];
  const type = normalizeInteractiveVisualType(input.visualType);
  const anchors = input.sourceAnchors.filter(Boolean);
  const status = compact(input.status ?? "");
  const justification = compact(input.justification ?? "");
  const anchorText = compact(input.sourceAnchorText);
  const isGroundedStatus = status === "source-grounded" || status === "source-anchored";
  const isConceptualStatus = status === "source-derived-conceptual" || status === "conceptual-no-direct-source-figure";

  if (!isGroundedStatus && !isConceptualStatus) {
    problems.push(`visual ${type}: invalid sourceGroundingStatus "${status || "(missing)"}"`);
  }
  if (anchors.length === 0) {
    if (!isConceptualStatus || justification.length < 30) {
      problems.push(`visual ${type}: no source anchors and no explicit conceptual grounding justification`);
    }
    return problems;
  }
  if (!anchorTextCompatibleWithVisualType(type, anchorText)) {
    problems.push(`visual ${type}: source anchors [${anchors.join(", ")}] are semantically incompatible with this visual type`);
  }
  if (MECHANISM_VISUAL_TYPES.has(type) && RESULT_ONLY_ANCHOR_RE.test(anchorText) && !VISUAL_ANCHOR_REQUIREMENTS[type]?.test(anchorText)) {
    problems.push(`visual ${type}: result/table/metric anchors cannot ground a mechanism visual`);
  }
  if (status === "conceptual-no-direct-source-figure") {
    problems.push(`visual ${type}: conceptual-no-direct-source-figure must not carry source anchors`);
  }
  if (status === "source-derived-conceptual" && justification.length < 30) {
    problems.push(`visual ${type}: source-derived-conceptual grounding needs a specific justification`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Interactive-visual dedupe (Fix 4) and compatibility (Fix 5)
// ---------------------------------------------------------------------------

export function interactiveVisualSignature(
  visual: InteractiveVisualContract,
): InteractiveVisualSignature {
  return {
    visualType: compact(visual.visualType).toLowerCase(),
    controls: [...(visual.learnerManipulates ?? [])]
      .map((item) => compact(item).toLowerCase())
      .sort(),
    sourceAnchors: [...(visual.sourceAnchors ?? [])]
      .map((item) => compact(item).toUpperCase())
      .sort(),
    expectedInsight: compact(visual.expectedInsight).toLowerCase(),
    conceptTarget: compact(visual.uniqueConcept).toLowerCase(),
  };
}

/** Stable string key for a signature — two visuals with the same key are
 * duplicates (same type, controls, anchors, insight, concept target). */
export function signatureKey(signature: InteractiveVisualSignature): string {
  return [
    signature.visualType,
    signature.controls.join("|"),
    signature.sourceAnchors.join("|"),
    signature.expectedInsight,
    signature.conceptTarget,
  ].join("::");
}

/**
 * Detect duplicate interactive visuals across the garden. A visual that
 * explicitly reuses an earlier one (`reuseOf`) is allowed. Returns one group per
 * offending signature with the unit ids that share it.
 */
export function duplicateInteractiveVisuals(
  units: LearningUnitContract[],
): Array<{ signature: string; unitIds: string[] }> {
  const byKey = new Map<string, string[]>();
  for (const unit of units) {
    const visual = unit.interactiveVisual;
    if (!visual || visual.reuseOf) continue;
    // Prefer the model-declared duplicateSignature when present; otherwise
    // derive one from the visual's structure.
    const key = compact(visual.duplicateSignature)
      ? compact(visual.duplicateSignature).toLowerCase()
      : signatureKey(interactiveVisualSignature(visual));
    const list = byKey.get(key) ?? [];
    list.push(unit.id);
    byKey.set(key, list);
  }
  const duplicates: Array<{ signature: string; unitIds: string[] }> = [];
  for (const [key, unitIds] of byKey) {
    if (unitIds.length > 1) duplicates.push({ signature: key, unitIds });
  }
  return duplicates;
}

/**
 * General visual-type compatibility. A visual type is described by the learner
 * roles it fits and the concept vocabulary its unit/anchors must show. This is a
 * data-driven registry, not a hardcoded page-role → visual map: the built-in
 * entries cover the common dynamic renderers, and any *other* visual type is
 * accepted as long as the unit gives a concrete `uniqueConcept` and a reason a
 * static figure is not enough (so new domains are not blocked).
 */
interface VisualTypeRequirement {
  roles: ReadonlySet<LearningUnitRole>;
  /** Vocabulary the unit's concept/question must mention. */
  concept: RegExp;
  /** Vocabulary the visual's source anchors/insight must NOT be purely about. */
  forbiddenAnchor?: RegExp;
}

const VISUAL_TYPE_REQUIREMENTS: Record<string, VisualTypeRequirement> = {
  lif_neuron: {
    roles: new Set(["core_concept", "mechanism"]),
    concept: /membrane potential|threshold|reset|leak|neuron (?:model|dynamics)|integrate[- ]and[- ]fire|\blif\b/i,
    forbiddenAnchor: /latency|energy|convergence|training loss|accuracy curve/i,
  },
  training_curve: {
    roles: new Set(["training_method", "metric", "result_interpretation"]),
    concept: /training|convergence|loss|learning curve|epoch/i,
  },
  neural_coding: {
    // "Spikes, Timing, and Event-Driven Computation" is a coding unit even
    // though it never writes the exact phrase "spike timing" — match the
    // vocabulary loosely (any spike/timing/coding/event-driven wording).
    roles: new Set(["core_concept", "mechanism"]),
    concept: /spike|spiking|timing|temporal|rate cod|firing rate|encoding|coding|event[- ]driven/i,
  },
  stdp_window: {
    roles: new Set(["training_method", "mechanism"]),
    concept: /stdp|spike[- ]timing|dependent plasticity|plasticity|pre.*post|timing window|hebbian/i,
  },
  metric_calculator: {
    roles: new Set(["metric", "formula"]),
    concept: /\b(?:snn|spiking|spike count|energy per (?:spike|inference)|neuromorphic|classification accuracy|inference latency)\b|accuracy.{0,80}latency.{0,80}energy/i,
  },
  tradeoff_explorer: {
    // Allowed on metric/comparison/application units, so its vocabulary must
    // cover the metrics that drive tradeoffs (energy/efficiency/latency/…),
    // not only the words "tradeoff"/"compare".
    roles: new Set(["comparison", "application", "result_interpretation", "metric"]),
    concept: /trade[- ]?off|compar|deployment|choice|priorit|multiple metrics|versus|vs\b|efficien|energy|latency|accuracy|spike count|throughput|budget|metric|normaliz/i,
  },
};

/**
 * Is this visual type justified by the learning unit? Returns an ok flag and a
 * reason when incompatible. A type without a legacy trusted-renderer rule is
 * retained as a semantic interaction request: the visualization router will
 * either find a compatible trusted renderer or send it through the constrained
 * generated-module path. Planning must not silently erase a useful need merely
 * because the fixed catalog cannot express it yet.
 */
export function visualTypeCompatibleWithUnit(
  visualType: string,
  unit: LearningUnitContract,
): { ok: boolean; reason?: string } {
  const type = normalizeInteractiveVisualType(visualType);
  const req = VISUAL_TYPE_REQUIREMENTS[type];
  const conceptText = [
    unit.title,
    unit.learningQuestion,
    ...(unit.newConcepts ?? []),
    ...(unit.prerequisiteConcepts ?? []),
    unit.interactiveVisual?.uniqueConcept ?? "",
    unit.interactiveVisual?.expectedInsight ?? "",
  ].join(" ");
  const anchorText = (unit.interactiveVisual?.sourceAnchors ?? []).join(" ");

  if (!req) {
    return {
      ok: Boolean(type && unit.interactiveVisual?.uniqueConcept && unit.interactiveVisual.expectedInsight),
      ...(!type || !unit.interactiveVisual?.uniqueConcept || !unit.interactiveVisual.expectedInsight
        ? { reason: "a generated interaction needs a type, unique concept, and expected learner insight" }
        : { reason: `visual type "${type}" requires generated-module routing` }),
    };
  }

  if (!req.roles.has(unit.role)) {
    return {
      ok: false,
      reason: `visual type "${type}" does not fit a "${unit.role}" unit (needs one of: ${[...req.roles].join(", ")})`,
    };
  }
  if (!req.concept.test(conceptText)) {
    return {
      ok: false,
      reason: `visual type "${type}" is not supported by the unit's concept vocabulary`,
    };
  }
  if (req.forbiddenAnchor && anchorText && req.forbiddenAnchor.test(anchorText) && !req.concept.test(anchorText)) {
    return {
      ok: false,
      reason: `visual type "${type}" is anchored only to material it should not use (${anchorText})`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Normalisation (council JSON → contracts)
// ---------------------------------------------------------------------------

function normalizeFigure(raw: unknown): SourceFigureContract | null {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = compact(record.id ?? record.figureId ?? record.sourceVisualId);
  if (!id) return null;
  const placement = asFigurePlacement(record.placement, "inside_concept_explanation");
  const notUsedReason = compact(record.notUsedReason ?? record.reason);
  return {
    id,
    placement,
    mustBeDiscussedWith: compact(record.mustBeDiscussedWith ?? record.discussWith),
    interpretationGoal: compact(record.interpretationGoal ?? record.goal),
    ...(placement === "not_used_with_reason" ? { notUsedReason: notUsedReason || "Not central to this unit." } : {}),
  };
}

function normalizeFormula(raw: unknown): SourceFormulaContract | null {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = compact(record.id ?? record.equationId ?? record.formulaId);
  if (!id) return null;
  const rawPlacement = compact(record.placement).toLowerCase().replace(/[\s-]+/g, "_");
  const placement: SourceFormulaPlacement =
    rawPlacement === "inside_metric_definition" || rawPlacement === "inside_result_interpretation"
      ? (rawPlacement as SourceFormulaPlacement)
      : "before_example";
  return {
    id,
    teachingGoal: compact(record.teachingGoal ?? record.goal),
    termsToDefine: asStringArray(record.termsToDefine ?? record.terms),
    placement,
  };
}

function normalizeTable(raw: unknown): SourceTableContract | null {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = compact(record.id ?? record.tableId);
  if (!id) return null;
  const rawPlacement = compact(record.placement).toLowerCase().replace(/[\s-]+/g, "_");
  const placement: SourceTablePlacement =
    rawPlacement === "inside_result_interpretation" ? "inside_result_interpretation" : "inside_comparison";
  return {
    id,
    teachingGoal: compact(record.teachingGoal ?? record.goal),
    rowsOrColumnsToExplain: asStringArray(record.rowsOrColumnsToExplain ?? record.rowsOrColumns ?? record.columns),
    placement,
  };
}

function normalizeInteractiveVisualType(value: string): string {
  const normalized = compact(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "metric_tradeoff_calculator") return "metric_calculator";
  if (normalized === "training_curves" || normalized === "learning_curve") return "training_curve";
  return normalized;
}

function normalizeInteractiveVisualEvidence(raw: unknown): Array<{ anchor: string; quote: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const anchor = typeof record.anchor === "string" ? record.anchor : "";
    const quote = typeof record.quote === "string" ? record.quote : "";
    return anchor && quote ? [{ anchor, quote }] : [];
  });
}

function normalizeInteractiveVisualControls(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const kind = typeof record.kind === "string" ? record.kind : "";
    const label = typeof record.label === "string" ? record.label : "";
    const type = typeof record.type === "string" ? record.type : "";
    const protocolRole = typeof record.protocolRole === "string" ? record.protocolRole : "";
    if (
      !id ||
      !label ||
      !["variable", "select_case", "process_position", "protocol_action"].includes(kind) ||
      !["slider", "number", "select", "toggle", "button"].includes(type) ||
      (protocolRole && ![
        "prediction_input",
        "commit_prediction",
        "reveal_outcome",
        "evaluate_prediction",
        "reset",
      ].includes(protocolRole)) ||
      (typeof record.defaultValue !== "number" &&
        typeof record.defaultValue !== "string" &&
        typeof record.defaultValue !== "boolean")
    ) return [];
    const options = Array.isArray(record.options) && record.options.every((option) => typeof option === "string")
      ? [...record.options] as string[]
      : undefined;
    return [{
      id,
      kind: kind as "variable" | "select_case" | "process_position" | "protocol_action",
      label,
      type: type as "slider" | "number" | "select" | "toggle" | "button",
      ...(protocolRole ? {
        protocolRole: protocolRole as
          | "prediction_input"
          | "commit_prediction"
          | "reveal_outcome"
          | "evaluate_prediction"
          | "reset",
      } : {}),
      ...(typeof record.unit === "string" ? { unit: record.unit } : {}),
      ...(typeof record.min === "number" ? { min: record.min } : {}),
      ...(typeof record.max === "number" ? { max: record.max } : {}),
      ...(typeof record.step === "number" ? { step: record.step } : {}),
      ...(options ? { options } : {}),
      defaultValue: record.defaultValue,
      evidence: normalizeInteractiveVisualEvidence(record.evidence),
    }];
  });
}

function normalizeInteractiveVisual(raw: unknown, modelAuthoredOnly = false): InteractiveVisualContract | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const visualType = normalizeInteractiveVisualType(compact(record.visualType ?? record.type));
  const uniqueConcept = compact(record.uniqueConcept ?? record.concept);
  if (!visualType && !uniqueConcept) return undefined;
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(visualType) || !uniqueConcept) return undefined;
  const learnerManipulates = asStringArray(record.learnerManipulates ?? record.controls ?? record.manipulates);
  const sourceAnchors = asStringArray(record.sourceAnchors ?? record.anchors);
  const expectedInsight = compact(record.expectedInsight ?? record.insight);
  const declaredSignature = compact(record.duplicateSignature);
  const provisional: InteractiveVisualContract = {
    id: compact(record.id) || "",
    uniqueConcept,
    visualType,
    whyStaticSourceFigureIsNotEnough: compact(
      record.whyStaticSourceFigureIsNotEnough ?? record.whyInteractive ?? record.why,
    ),
    learnerManipulates,
    expectedInsight,
    sourceAnchors,
    duplicateSignature: declaredSignature,
    ...(compact(record.reuseOf) ? { reuseOf: compact(record.reuseOf) } : {}),
  };
  if (!modelAuthoredOnly && !provisional.duplicateSignature) {
    provisional.duplicateSignature = signatureKey(interactiveVisualSignature(provisional));
  }
  return provisional;
}

const VISUAL_NECESSITIES: readonly InteractiveVisualNecessity[] = [
  "required",
  "recommended",
  "optional",
  "not_needed",
  "harmful_or_distracting",
];
const TEACHING_MEDIA: readonly PreferredTeachingMedium[] = [
  "interactive_visual",
  "source_figure",
  "generated_static_diagram",
  "formula_derivation",
  "worked_example",
  "comparison_table",
  "timeline",
  "prose",
  "no_additional_visual",
];
const INTERACTION_GOALS: readonly VisualizationInteractionGoal[] = [
  "manipulate_variables",
  "observe_change_over_time",
  "compare_cases",
  "step_through_process",
  "explore_structure",
  "test_prediction",
  "inspect_relationship",
  "simulate_system",
];
const OUTPUT_REPRESENTATIONS: readonly InteractiveVisualOutputRepresentation[] = [
  "value",
  "chart",
  "diagram",
  "animation",
  "timeline",
  "table",
  "annotation",
];

function normalizeInteractivePedagogyContract(
  raw: unknown,
): InteractiveVisualPedagogyContract | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const interactionGoal = compact(record.interactionGoal) as VisualizationInteractionGoal;
  const uniqueConcept = compact(record.uniqueConcept);
  const whyStaticSourceFigureIsNotEnough = compact(record.whyStaticSourceFigureIsNotEnough);
  const learnerAction = compact(record.learnerAction);
  const controls = normalizeInteractiveVisualControls(record.controls);
  const observableRecord = record.observable && typeof record.observable === "object" && !Array.isArray(record.observable)
    ? record.observable as Record<string, unknown>
    : undefined;
  const observableLabel = compact(observableRecord?.label);
  const observableRepresentation = compact(
    observableRecord?.representation,
  ) as InteractiveVisualOutputRepresentation;
  const observableEvidence = normalizeInteractiveVisualEvidence(observableRecord?.evidence);
  const expectedInsight = compact(record.expectedInsight);
  const expectedInsightEvidence = normalizeInteractiveVisualEvidence(record.expectedInsightEvidence);
  const duplicateSignature = compact(record.duplicateSignature);
  if (
    !INTERACTION_GOALS.includes(interactionGoal) ||
    !uniqueConcept ||
    !whyStaticSourceFigureIsNotEnough ||
    !learnerAction ||
    controls.length === 0 ||
    !observableLabel ||
    !OUTPUT_REPRESENTATIONS.includes(observableRepresentation) ||
    observableEvidence.length === 0 ||
    !expectedInsight ||
    expectedInsightEvidence.length === 0 ||
    !duplicateSignature
  ) return undefined;
  return {
    interactionGoal,
    uniqueConcept,
    whyStaticSourceFigureIsNotEnough,
    learnerAction,
    controls,
    observable: {
      label: observableLabel,
      representation: observableRepresentation,
      evidence: observableEvidence,
    },
    expectedInsight,
    expectedInsightEvidence,
    duplicateSignature,
  };
}

function normalizedScore(value: unknown, modelAuthoredOnly = false): number {
  const numeric = Number(value);
  if (modelAuthoredOnly) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : Number.NaN;
  }
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

function normalizeVisualNecessityDecision(
  raw: unknown,
  fallbackUnitId: string,
  modelAuthoredOnly = false,
): VisualNecessityDecision | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const necessity = compact(record.necessity) as InteractiveVisualNecessity;
  const preferredMedium = compact(record.preferredMedium) as PreferredTeachingMedium;
  if (!VISUAL_NECESSITIES.includes(necessity) || !TEACHING_MEDIA.includes(preferredMedium)) {
    return undefined;
  }
  const evidenceRecord =
    record.evidence && typeof record.evidence === "object"
      ? (record.evidence as Record<string, unknown>)
      : {};
  const interaction = normalizeInteractivePedagogyContract(record.interaction);
  const alternativeCoverage = compact(record.alternativeCoverage);
  const teachingMediumReason = compact(record.teachingMediumReason);
  const hasAlternativeCoverage = ["covered", "uncovered", "unverified"].includes(
    alternativeCoverage,
  );
  // A model-authored Learning Unit Contract must retain these two pedagogical
  // decisions verbatim through the contract projection. They are not inferred
  // from a preferred medium or alternative plan: absent or malformed values
  // make this nested decision invalid so the authoring response is rejected.
  if (modelAuthoredOnly && (!hasAlternativeCoverage || !teachingMediumReason)) {
    return undefined;
  }
  return {
    unitId: compact(record.unitId) || (modelAuthoredOnly ? "" : fallbackUnitId),
    pageId: compact(record.pageId) || (modelAuthoredOnly ? "" : fallbackUnitId),
    necessity,
    preferredMedium,
    learningGoal: compact(record.learningGoal),
    manipulationValue: normalizedScore(record.manipulationValue, modelAuthoredOnly),
    dynamicBehaviorValue: normalizedScore(record.dynamicBehaviorValue, modelAuthoredOnly),
    comparisonValue: normalizedScore(record.comparisonValue, modelAuthoredOnly),
    spatialValue: normalizedScore(record.spatialValue, modelAuthoredOnly),
    parameterSensitivityValue: normalizedScore(record.parameterSensitivityValue, modelAuthoredOnly),
    sourceFigureSufficiency: normalizedScore(record.sourceFigureSufficiency, modelAuthoredOnly),
    proseSufficiency: normalizedScore(record.proseSufficiency, modelAuthoredOnly),
    formulaSufficiency: normalizedScore(record.formulaSufficiency, modelAuthoredOnly),
    workedExampleSufficiency: normalizedScore(record.workedExampleSufficiency, modelAuthoredOnly),
    cognitiveLoadRisk: normalizedScore(record.cognitiveLoadRisk, modelAuthoredOnly),
    duplicationRisk: normalizedScore(record.duplicationRisk, modelAuthoredOnly),
    implementationRisk: normalizedScore(record.implementationRisk, modelAuthoredOnly),
    confidence: normalizedScore(record.confidence, modelAuthoredOnly),
    ...(compact(record.recommendedVisualType)
      ? { recommendedVisualType: compact(record.recommendedVisualType) }
      : {}),
    evidence: {
      unitRole: compact(evidenceRecord.unitRole),
      concepts: asStringArray(evidenceRecord.concepts),
      learningQuestion: compact(evidenceRecord.learningQuestion),
      sourceAnchorIds: asStringArray(evidenceRecord.sourceAnchorIds),
      nearbyVisualIntentIds: asStringArray(evidenceRecord.nearbyVisualIntentIds),
    },
    reason: compact(record.reason),
    ...(hasAlternativeCoverage
      ? {
          alternativeCoverage: alternativeCoverage as VisualNecessityDecision["alternativeCoverage"],
        }
      : {}),
    ...(teachingMediumReason ? { teachingMediumReason } : {}),
    ...(interaction ? { interaction } : {}),
  };
}

function normalizeContractInteractiveVisualPlan(
  raw: unknown,
  unitId: string,
  fallbackIntent?: InteractiveVisualContract,
  modelAuthoredOnly = false,
): ContractInteractiveVisualPlan | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const decision = normalizeVisualNecessityDecision(record.decision, unitId, modelAuthoredOnly);
  const requirement = compact(record.requirement) as ContractInteractiveVisualPlan["requirement"];
  if (!decision || !["required", "recommended", "optional", "none"].includes(requirement)) {
    return undefined;
  }
  const visualIntent = normalizeInteractiveVisual(record.visualIntent, modelAuthoredOnly) ??
    (modelAuthoredOnly ? undefined : fallbackIntent);
  const controlContract = normalizeInteractiveVisualControls(record.controlContract);
  const interactionGoal = compact(record.interactionGoal) as VisualizationInteractionGoal;
  const learnerAction = compact(record.learnerAction);
  const observableRecord =
    record.observable && typeof record.observable === "object"
      ? (record.observable as Record<string, unknown>)
      : undefined;
  const observableLabel = compact(observableRecord?.label);
  const observableRepresentation = compact(
    observableRecord?.representation,
  ) as InteractiveVisualOutputRepresentation;
  const observableEvidence = normalizeInteractiveVisualEvidence(observableRecord?.evidence);
  const expectedInsightEvidence = normalizeInteractiveVisualEvidence(record.expectedInsightEvidence);
  return {
    decision,
    requirement,
    ...(requirement !== "none" && visualIntent ? { visualIntent } : {}),
    ...(requirement !== "none" && controlContract.length > 0 ? { controlContract } : {}),
    ...(requirement !== "none" && INTERACTION_GOALS.includes(interactionGoal)
      ? { interactionGoal }
      : {}),
    ...(requirement !== "none" && learnerAction ? { learnerAction } : {}),
    ...(requirement !== "none" &&
    observableLabel &&
    OUTPUT_REPRESENTATIONS.includes(observableRepresentation) &&
    observableEvidence.length > 0
      ? {
          observable: {
            label: observableLabel,
            representation: observableRepresentation,
            evidence: observableEvidence,
          },
        }
      : {}),
    ...(requirement !== "none" && expectedInsightEvidence.length > 0
      ? { expectedInsightEvidence }
      : {}),
    ...(compact(record.omissionReason) ? { omissionReason: compact(record.omissionReason) } : {}),
    ...(["covered", "uncovered", "unverified"].includes(compact(record.alternativeCoverage))
      ? {
          alternativeCoverage: compact(
            record.alternativeCoverage,
          ) as ContractInteractiveVisualPlan["alternativeCoverage"],
        }
      : {}),
  };
}

function normalizeTeachingMediumPlan(
  raw: unknown,
  unitId: string,
  modelAuthoredOnly = false,
): TeachingMediumPlan | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const preferredMedium = compact(record.preferredMedium) as PreferredTeachingMedium;
  if (!TEACHING_MEDIA.includes(preferredMedium)) return undefined;
  return {
    unitId: compact(record.unitId) || (modelAuthoredOnly ? "" : unitId),
    preferredMedium,
    ...(compact(record.sourceFigureAnchorId)
      ? { sourceFigureAnchorId: compact(record.sourceFigureAnchorId) }
      : {}),
    ...(compact(record.staticDiagramIntent)
      ? { staticDiagramIntent: compact(record.staticDiagramIntent) }
      : {}),
    ...(asStringArray(record.formulaAnchorIds).length > 0
      ? { formulaAnchorIds: asStringArray(record.formulaAnchorIds) }
      : {}),
    ...(compact(record.workedExampleIntent)
      ? { workedExampleIntent: compact(record.workedExampleIntent) }
      : {}),
    ...(compact(record.comparisonTableIntent)
      ? { comparisonTableIntent: compact(record.comparisonTableIntent) }
      : {}),
    reason: compact(record.reason),
  };
}

function normalizeZettelNote(raw: unknown): ZettelNote | null {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const claim = compact(record.claim ?? record.note ?? record.statement);
  const rawHandle = compact(record.handle ?? record.id ?? claim);
  const handle = atomicZettelHandle(rawHandle);
  if (!handle) return null;
  return {
    handle,
    claim: claim || rawHandle,
    connectedTo: asStringArray(record.connectedTo ?? record.links ?? record.related).map(atomicZettelHandle).filter(Boolean),
  };
}

function normalizeWordRange(raw: unknown): [number, number] {
  if (Array.isArray(raw) && raw.length >= 2) {
    const lo = Number(raw[0]);
    const hi = Number(raw[1]);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi >= lo) {
      return [Math.round(lo), Math.round(hi)];
    }
  }
  return [700, 1100];
}

/** Parse raw council output (array of units, or `{ learningUnits: [...] }`)
 * into normalized, id-stable LearningUnitContracts. */
/**
 * Interactive visuals are opt-in. If the model attaches one whose type is
 * incompatible with the unit, drop just that visual instead of rejecting the
 * whole (otherwise good) contract and falling back to deterministic units.
 * Returns the sanitized units plus a note per dropped visual for the log.
 */
export function dropIncompatibleInteractiveVisuals(
  units: LearningUnitContract[],
): { units: LearningUnitContract[]; dropped: string[] } {
  const dropped: string[] = [];
  const sanitized = units.map((unit) => {
    if (!unit.interactiveVisual) return unit;
    const compat = visualTypeCompatibleWithUnit(unit.interactiveVisual.visualType, unit);
    if (compat.ok) return unit;
    dropped.push(`${unit.id} (${unit.title}): dropped ${unit.interactiveVisual.visualType} — ${compat.reason}`);
    return {
      ...unit,
      interactiveVisual: undefined,
      ...(unit.interactiveVisualPlan
        ? {
            interactiveVisualPlan: {
              ...unit.interactiveVisualPlan,
              visualIntent: undefined,
            },
          }
        : {}),
    };
  });
  return { units: sanitized, dropped };
}

export interface NormalizeLearningUnitOptions {
  /** Preserve only explicit model-authored semantics; never infer missing content. */
  modelAuthoredOnly?: boolean;
}

/**
 * Validate the model's canonical Learning Unit JSON before normalization.
 * Normalization is a projection convenience, never a semantic repair step in
 * active Learn. Every malformed or aliased field is reported so the authoring
 * model must return a complete replacement contract.
 */
export function modelAuthoredLearningUnitParseProblems(raw: unknown): string[] {
  const root = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined;
  const list = Array.isArray(raw) ? raw : root?.learningUnits;
  if (!Array.isArray(list)) return ["response.learningUnits must be an array"];

  const problems: string[] = [];
  const seenIds = new Set<string>();
  const requireString = (record: Record<string, unknown>, key: string, at: string) => {
    if (typeof record[key] !== "string" || !String(record[key]).trim()) {
      problems.push(`${at}.${key} must be a non-empty string`);
    }
  };
  const requireStringArray = (record: Record<string, unknown>, key: string, at: string) => {
    const value = record[key];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
      problems.push(`${at}.${key} must be an array of non-empty strings`);
    }
  };
  const requireObjectArray = (
    record: Record<string, unknown>,
    key: string,
    at: string,
    validate: (item: Record<string, unknown>, itemAt: string) => void,
  ) => {
    const value = record[key];
    if (!Array.isArray(value)) {
      problems.push(`${at}.${key} must be an array`);
      return;
    }
    value.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        problems.push(`${at}.${key}[${index}] must be an object`);
        return;
      }
      validate(item as Record<string, unknown>, `${at}.${key}[${index}]`);
    });
  };

  list.forEach((item, index) => {
    const at = `learningUnits[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${at} must be an object`);
      return;
    }
    const unit = item as Record<string, unknown>;
    requireString(unit, "id", at);
    const id = typeof unit.id === "string" ? unit.id : "";
    if (id && (!/^[A-Za-z0-9_.-]+$/.test(id) || id.trim() !== id)) {
      problems.push(`${at}.id must already be a canonical identifier`);
    }
    if (id && seenIds.has(id)) problems.push(`${at}.id duplicates model-authored unit id "${id}"`);
    if (id) seenIds.add(id);
    requireString(unit, "title", at);
    if (!(LEARNING_UNIT_ROLES as readonly unknown[]).includes(unit.role)) {
      problems.push(`${at}.role must be one of ${LEARNING_UNIT_ROLES.join(", ")}`);
    }
    requireString(unit, "learningQuestion", at);
    for (const key of ["prerequisiteConcepts", "newConcepts", "sourceAnchors", "mustNotRepeat"] as const) {
      requireStringArray(unit, key, at);
    }
    if (unit.syllabusUnitIds !== undefined) requireStringArray(unit, "syllabusUnitIds", at);
    if (Array.isArray(unit.sourceAnchors) && unit.sourceAnchors.length === 0) {
      problems.push(`${at}.sourceAnchors must select at least one canonical exact-text source anchor`);
    }
    const wordRange = unit.expectedWordRange;
    if (
      !Array.isArray(wordRange) || wordRange.length !== 2 ||
      !wordRange.every((value) => typeof value === "number" && Number.isInteger(value)) ||
      Number(wordRange[0]) <= 0 || Number(wordRange[1]) < Number(wordRange[0])
    ) {
      problems.push(`${at}.expectedWordRange must be exactly [positiveMin, max>=min]`);
    }

    const section = unit.sectionPlan;
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      problems.push(`${at}.sectionPlan must be an object authored with the learning spine`);
    } else {
      const sectionRecord = section as Record<string, unknown>;
      for (const key of ["id", "title", "purpose"] as const) requireString(sectionRecord, key, `${at}.sectionPlan`);
      if (
        sectionRecord.singleSubsectionReason !== undefined &&
        (typeof sectionRecord.singleSubsectionReason !== "string" || !sectionRecord.singleSubsectionReason.trim())
      ) {
        problems.push(`${at}.sectionPlan.singleSubsectionReason must be a non-empty string when present`);
      }
    }

    requireObjectArray(unit, "sourceFigures", at, (figure, figureAt) => {
      requireString(figure, "id", figureAt);
      if (!(FIGURE_PLACEMENTS as readonly unknown[]).includes(figure.placement)) {
        problems.push(`${figureAt}.placement must be an exact source-figure placement enum`);
      }
      requireString(figure, "mustBeDiscussedWith", figureAt);
      requireString(figure, "interpretationGoal", figureAt);
      if (figure.placement === "not_used_with_reason") requireString(figure, "notUsedReason", figureAt);
    });
    requireObjectArray(unit, "sourceFormulas", at, (formula, formulaAt) => {
      requireString(formula, "id", formulaAt);
      requireString(formula, "teachingGoal", formulaAt);
      requireStringArray(formula, "termsToDefine", formulaAt);
      if (!["before_example", "inside_metric_definition", "inside_result_interpretation"].includes(String(formula.placement))) {
        problems.push(`${formulaAt}.placement must be an exact source-formula placement enum`);
      }
    });
    requireObjectArray(unit, "sourceTables", at, (table, tableAt) => {
      requireString(table, "id", tableAt);
      requireString(table, "teachingGoal", tableAt);
      requireStringArray(table, "rowsOrColumnsToExplain", tableAt);
      if (!["inside_comparison", "inside_result_interpretation"].includes(String(table.placement))) {
        problems.push(`${tableAt}.placement must be an exact source-table placement enum`);
      }
    });
    requireObjectArray(unit, "zettelNotes", at, (note, noteAt) => {
      requireString(note, "handle", noteAt);
      if (typeof note.handle === "string" && atomicZettelHandle(note.handle) !== note.handle) {
        problems.push(`${noteAt}.handle must already be a canonical atomic handle`);
      }
      requireString(note, "claim", noteAt);
      requireStringArray(note, "connectedTo", noteAt);
    });
    requireObjectArray(unit, "semanticConcepts", at, (concept, conceptAt) => {
      requireString(concept, "slug", conceptAt);
      if (
        typeof concept.slug === "string" &&
        (normalizeConceptSlug(concept.slug) !== concept.slug || !isValidPublicConceptSlug(concept.slug))
      ) {
        problems.push(`${conceptAt}.slug must already be a canonical public concept slug`);
      }
      requireString(concept, "preferredLabel", conceptAt);
      if (concept.role !== "primary" && concept.role !== "supporting") {
        problems.push(`${conceptAt}.role must be "primary" or "supporting"`);
      }
      requireStringArray(concept, "aliases", conceptAt);
      requireStringArray(concept, "evidenceAnchors", conceptAt);
    });
    requireObjectArray(unit, "knowledgeClaims", at, (claim, claimAt) => {
      requireString(claim, "text", claimAt);
      if (typeof claim.text === "string" && isGenericFillerClaim(claim.text)) {
        problems.push(`${claimAt}.text must be a concrete model-authored claim, not generic filler`);
      }
      requireString(claim, "subject", claimAt);
      if (
        typeof claim.subject === "string" &&
        (normalizeConceptSlug(claim.subject) !== claim.subject || !isValidPublicConceptSlug(claim.subject))
      ) {
        problems.push(`${claimAt}.subject must already be a canonical public concept slug`);
      }
      if (!(SUPPORTED_RELATION_PREDICATES as readonly unknown[]).includes(claim.predicate)) {
        problems.push(`${claimAt}.predicate must be a supported relation predicate`);
      }
      if (claim.object !== undefined && (typeof claim.object !== "string" || !claim.object.trim())) {
        problems.push(`${claimAt}.object must be a non-empty string when present`);
      } else if (
        typeof claim.object === "string" &&
        (normalizeConceptSlug(claim.object) !== claim.object || !isValidPublicConceptSlug(claim.object))
      ) {
        problems.push(`${claimAt}.object must already be a canonical public concept slug`);
      }
      requireStringArray(claim, "evidenceAnchors", claimAt);
      for (const key of ["conceptIds", "derivationAnchors", "connectedClaimIds"] as const) {
        if (claim[key] !== undefined) requireStringArray(claim, key, claimAt);
      }
      if (
        Array.isArray(claim.conceptIds) &&
        claim.conceptIds.some((value) =>
          typeof value !== "string" || normalizeConceptSlug(value) !== value || !isValidPublicConceptSlug(value))
      ) {
        problems.push(`${claimAt}.conceptIds must contain only canonical public concept slugs`);
      }
    });

    const authoredConceptSlugs = new Set(
      Array.isArray(unit.semanticConcepts)
        ? unit.semanticConcepts.flatMap((concept) => {
            const record = concept && typeof concept === "object" && !Array.isArray(concept)
              ? concept as Record<string, unknown>
              : undefined;
            return typeof record?.slug === "string" ? [record.slug] : [];
          })
        : [],
    );
    if (Array.isArray(unit.knowledgeClaims)) {
      unit.knowledgeClaims.forEach((claim, claimIndex) => {
        if (!claim || typeof claim !== "object" || Array.isArray(claim)) return;
        const record = claim as Record<string, unknown>;
        for (const [field, endpoint] of [["subject", record.subject], ["object", record.object]] as const) {
          if (typeof endpoint === "string" && endpoint && !authoredConceptSlugs.has(endpoint)) {
            problems.push(`${at}.knowledgeClaims[${claimIndex}].${field} must reference semanticConcepts from the same unit`);
          }
        }
      });
    }
  });
  return [...new Set(problems)];
}

/** Validate the garden-wide omission records in a model-authored spine. */
export function modelAuthoredSourceArtifactOmissionParseProblems(raw: unknown): string[] {
  const root = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined;
  if (!root || !Array.isArray(root.sourceArtifactOmissions)) {
    return ["response.sourceArtifactOmissions must be an array"];
  }
  const problems: string[] = [];
  const seenIds = new Set<string>();
  root.sourceArtifactOmissions.forEach((item, index) => {
    const at = `sourceArtifactOmissions[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${at} must be an object`);
      return;
    }
    const record = item as Record<string, unknown>;
    const extraKeys = Object.keys(record).filter(
      (key) => key !== "sourceArtifactId" && key !== "reason",
    );
    if (extraKeys.length > 0) {
      problems.push(`${at} contains unsupported fields: ${extraKeys.join(", ")}`);
    }
    const sourceArtifactId = record.sourceArtifactId;
    const reason = record.reason;
    if (
      typeof sourceArtifactId !== "string" ||
      !sourceArtifactId.trim() ||
      sourceArtifactId !== sourceArtifactId.trim()
    ) {
      problems.push(`${at}.sourceArtifactId must be a non-empty exact registered artifact id`);
    } else if (seenIds.has(sourceArtifactId)) {
      problems.push(`${at}.sourceArtifactId duplicates omission for "${sourceArtifactId}"`);
    } else {
      seenIds.add(sourceArtifactId);
    }
    if (typeof reason !== "string" || !reason.trim() || reason !== reason.trim()) {
      problems.push(`${at}.reason must be non-empty model-authored prose without surrounding whitespace`);
    }
  });
  return [...new Set(problems)];
}

/**
 * Exact projection of omission records after
 * `modelAuthoredSourceArtifactOmissionParseProblems` succeeds. This does not
 * invent, trim, deduplicate, rank, or otherwise repair the model's decisions.
 */
export function projectModelAuthoredSourceArtifactOmissions(
  raw: unknown,
): SourceArtifactOmission[] {
  const root = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const list = Array.isArray(root.sourceArtifactOmissions)
    ? root.sourceArtifactOmissions
    : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    return typeof record.sourceArtifactId === "string" && typeof record.reason === "string"
      ? [{ sourceArtifactId: record.sourceArtifactId, reason: record.reason }]
      : [];
  });
}

export function normalizeLearningUnits(
  raw: unknown,
  options: NormalizeLearningUnitOptions = {},
): LearningUnitContract[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((raw as Record<string, unknown>).learningUnits ??
        (raw as Record<string, unknown>).units ??
        (raw as Record<string, unknown>).learning_units ??
        [])
      : [];
  if (!Array.isArray(list)) return [];

  const units: LearningUnitContract[] = [];
  const usedIds = new Set<string>();
  list.forEach((item, index) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const title =
      compact(record.title ?? record.name) ||
      (options.modelAuthoredOnly ? "" : `Learning unit ${index + 1}`);
    let id = options.modelAuthoredOnly ? compact(record.id) : compact(record.id) || `U${index + 1}`;
    if (!options.modelAuthoredOnly) {
      id = id.replace(/[^A-Za-z0-9_.-]/g, "-");
      while (usedIds.has(id)) id = `${id}x`;
    }
    usedIds.add(id);
    const interactiveVisual = normalizeInteractiveVisual(record.interactiveVisual, options.modelAuthoredOnly === true);
    const unit: LearningUnitContract = {
      id,
      title,
      role: options.modelAuthoredOnly
        ? (compact(record.role) as LearningUnitRole)
        : asRole(record.role),
      learningQuestion: compact(record.learningQuestion ?? record.question),
      prerequisiteConcepts: asStringArray(record.prerequisiteConcepts ?? record.prerequisites),
      newConcepts: asStringArray(record.newConcepts ?? record.concepts),
      syllabusUnitIds: asStringArray(record.syllabusUnitIds),
      sourceAnchors: asStringArray(record.sourceAnchors ?? record.anchors),
      sourceFigures: asArray(record.sourceFigures).map(normalizeFigure).filter(Boolean) as SourceFigureContract[],
      sourceFormulas: asArray(record.sourceFormulas).map(normalizeFormula).filter(Boolean) as SourceFormulaContract[],
      sourceTables: asArray(record.sourceTables).map(normalizeTable).filter(Boolean) as SourceTableContract[],
      interactiveVisual,
      interactiveVisualPlan: normalizeContractInteractiveVisualPlan(
        record.interactiveVisualPlan,
        id,
        interactiveVisual,
        options.modelAuthoredOnly === true,
      ),
      teachingMediumPlan: normalizeTeachingMediumPlan(record.teachingMediumPlan, id, options.modelAuthoredOnly === true),
      zettelNotes: asArray(record.zettelNotes).map(normalizeZettelNote).filter(Boolean) as ZettelNote[],
      semanticConcepts: asArray(record.semanticConcepts)
        .map(normalizedConceptPlan)
        .filter(Boolean) as SemanticConceptPlan[],
      knowledgeClaims: asArray(record.knowledgeClaims)
        .map(normalizedKnowledgeClaim)
        .filter(Boolean) as KnowledgeClaimPlan[],
      mustNotRepeat: asStringArray(record.mustNotRepeat ?? record.avoid),
      expectedWordRange: options.modelAuthoredOnly
        ? (() => {
            const rawRange = record.expectedWordRange ?? record.wordRange;
            if (!Array.isArray(rawRange) || rawRange.length < 2) return [0, 0] as [number, number];
            const lo = Number(rawRange[0]);
            const hi = Number(rawRange[1]);
            return Number.isFinite(lo) && Number.isFinite(hi)
              ? [Math.round(lo), Math.round(hi)] as [number, number]
              : [0, 0] as [number, number];
          })()
        : normalizeWordRange(record.expectedWordRange ?? record.wordRange),
      sectionPlan:
        (record.sectionPlan ?? record.section) && typeof (record.sectionPlan ?? record.section) === "object"
          ? (() => {
              const section = (record.sectionPlan ?? record.section) as Record<string, unknown>;
              const sectionId = compact(section.id);
              const sectionTitle = compact(section.title);
              const purpose = compact(section.purpose);
              if (!sectionId && !sectionTitle && !purpose) return undefined;
              return {
                id: sectionId,
                title: sectionTitle,
                purpose,
                ...(compact(section.singleSubsectionReason)
                  ? { singleSubsectionReason: compact(section.singleSubsectionReason) }
                  : {}),
              };
            })()
          : undefined,
    };
    units.push(options.modelAuthoredOnly
      ? unit
      : {
          ...unit,
          semanticConcepts: deriveSemanticConcepts(unit),
          knowledgeClaims: deriveKnowledgeClaims(unit),
        });
  });
  return options.modelAuthoredOnly ? units : reconcileLearningUnitConceptAliases(units).units;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Source-artifact assignment (Fix 3 / Fix 8)
// ---------------------------------------------------------------------------

const RESULT_ROLES = new Set<LearningUnitRole>(["result_interpretation", "comparison"]);
const DEFINITION_ROLES = new Set<LearningUnitRole>(["motivation", "core_concept"]);

const ASSIGNMENT_ROLE_PRIORITY: Record<LearningUnitRole, number> = {
  result_interpretation: 0,
  comparison: 1,
  metric: 2,
  formula: 3,
  worked_example: 4,
  training_method: 5,
  mechanism: 6,
  core_concept: 7,
  application: 8,
  synthesis: 9,
  limitation: 10,
  motivation: 11,
};

const ASSIGNMENT_PLACEMENT_PRIORITY: Partial<Record<SourceFigurePlacement, number>> = {
  inside_result_interpretation: 0,
  inside_comparison: 1,
  after_formula_introduction: 2,
  beside_worked_example: 3,
  inside_concept_explanation: 4,
};

function placementForArtifact(kind: SourceArtifactKind, role: LearningUnitRole): SourceFigurePlacement {
  if (kind === "table") return role === "result_interpretation" ? "inside_result_interpretation" : "inside_comparison";
  if (kind === "result") return "inside_result_interpretation";
  if (kind === "formula") return "after_formula_introduction";
  if (kind === "example") return "beside_worked_example";
  if (role === "comparison") return "inside_comparison";
  if (RESULT_ROLES.has(role)) return "inside_result_interpretation";
  return "inside_concept_explanation";
}

function assignmentScore(
  assignment: SourceArtifactAssignment,
  unitsById: Map<string, LearningUnitContract>,
  order: number,
): number {
  const unit = unitsById.get(assignment.assignedLearningUnitId);
  const placement = ASSIGNMENT_PLACEMENT_PRIORITY[assignment.placement] ?? 9;
  const role = unit ? ASSIGNMENT_ROLE_PRIORITY[unit.role] : 99;
  return placement * 1_000_000 + role * 1_000 + order;
}

/**
 * A concrete source artifact is taught on one primary learner page. Units may
 * mention the same table/figure/formula while planning, but the export contract
 * needs one owner so the page writer, visual ledger, and finalizer do not ask
 * multiple pages to embed the same source crop.
 */
export function dedupeSourceArtifactAssignments(
  assignments: SourceArtifactAssignment[],
  units: LearningUnitContract[] = [],
): SourceArtifactAssignment[] {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const bestByArtifact = new Map<string, { assignment: SourceArtifactAssignment; score: number }>();
  assignments.forEach((assignment, order) => {
    if (!assignment.sourceArtifactId || !assignment.assignedLearningUnitId) return;
    const score = assignmentScore(assignment, unitsById, order);
    const existing = bestByArtifact.get(assignment.sourceArtifactId);
    if (!existing || score < existing.score) {
      bestByArtifact.set(assignment.sourceArtifactId, { assignment, score });
    }
  });
  return [...bestByArtifact.values()]
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.assignment);
}

/**
 * Collect the concrete source-artifact → learning-unit assignments implied by
 * the contracts. Each figure/table/formula a unit claims becomes an assignment
 * with a placement, reason, and required interpretation. This is the durable
 * record the finalizer and validator read — semantic placement is decided here,
 * before any page is written, never patched afterwards.
 */
export function assignSourceArtifacts(units: LearningUnitContract[]): SourceArtifactAssignment[] {
  const assignments: SourceArtifactAssignment[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    const push = (
      id: string,
      placement: SourceFigurePlacement,
      goal: string,
      forbidden?: string[],
    ) => {
      const key = `${id}::${unit.id}`;
      if (!id || seen.has(key)) return;
      seen.add(key);
      assignments.push({
        sourceArtifactId: id,
        assignedLearningUnitId: unit.id,
        placement,
        reason: `Taught inside "${unit.title}" (${unit.role}) to answer: ${unit.learningQuestion || unit.title}.`,
        requiredInterpretation: goal,
        ...(forbidden && forbidden.length > 0 ? { forbiddenSections: forbidden } : {}),
      });
    };
    for (const figure of unit.sourceFigures) {
      if (figure.placement === "not_used_with_reason") continue;
      push(figure.id, figure.placement, figure.interpretationGoal || figure.mustBeDiscussedWith);
    }
    for (const formula of unit.sourceFormulas) {
      const placement: SourceFigurePlacement =
        formula.placement === "inside_result_interpretation"
          ? "inside_result_interpretation"
          : formula.placement === "inside_metric_definition"
            ? "after_formula_introduction"
            : "after_formula_introduction";
      push(formula.id, placement, formula.teachingGoal);
    }
    for (const table of unit.sourceTables) {
      const placement: SourceFigurePlacement =
        table.placement === "inside_result_interpretation" ? "inside_result_interpretation" : "inside_comparison";
      push(table.id, placement, table.teachingGoal);
    }
  }
  return dedupeSourceArtifactAssignments(assignments, units);
}

/** Reject ambiguous artifact ownership; active Learn never scores competing owners. */
export function sourceArtifactOwnershipProblems(units: readonly LearningUnitContract[]): string[] {
  const owners = new Map<string, string[]>();
  const register = (artifactId: string, unitId: string) => {
    if (!artifactId) return;
    const current = owners.get(artifactId) ?? [];
    current.push(unitId);
    owners.set(artifactId, current);
  };
  for (const unit of units) {
    for (const figure of unit.sourceFigures) {
      if (figure.placement !== "not_used_with_reason") register(figure.id, unit.id);
    }
    for (const formula of unit.sourceFormulas) register(formula.id, unit.id);
    for (const table of unit.sourceTables) register(table.id, unit.id);
  }
  return [...owners.entries()].flatMap(([artifactId, unitIds]) => {
    const uniqueOwners = [...new Set(unitIds)];
    return uniqueOwners.length === 1 && unitIds.length === 1
      ? []
      : [`source artifact "${artifactId}" must have exactly one model-authored owner; found ${unitIds.join(", ")}`];
  });
}

/**
 * Prove that the model partitioned the complete registered artifact catalog.
 * Every artifact must occur exactly once: either in the correctly typed field
 * of exactly one learning unit, or in the garden-wide omission list. This gate
 * checks identity and cardinality only; it never decides whether an artifact
 * ought to be taught or supplies an omission reason.
 */
export function sourceArtifactCoverageProblems(
  units: readonly LearningUnitContract[],
  omissions: readonly SourceArtifactOmission[],
  registeredArtifacts: Iterable<RegisteredSourceArtifact>,
): string[] {
  const registered = new Map<string, RegisteredSourceArtifactKind>();
  const problems: string[] = [];
  for (const artifact of registeredArtifacts) {
    if (!artifact.id) continue;
    const prior = registered.get(artifact.id);
    if (prior && prior !== artifact.kind) {
      problems.push(
        `registered source artifact "${artifact.id}" has conflicting kinds ${prior} and ${artifact.kind}`,
      );
    } else {
      registered.set(artifact.id, artifact.kind);
    }
  }

  type Appearance = { mode: "assigned" | "omitted"; location: string };
  const appearances = new Map<string, Appearance[]>();
  const registerAppearance = (
    id: string,
    expectedKinds: readonly RegisteredSourceArtifactKind[],
    appearance: Appearance,
  ) => {
    if (!id) return;
    const actualKind = registered.get(id);
    if (!actualKind) {
      problems.push(`${appearance.location} references unregistered source artifact "${id}"`);
    } else if (!expectedKinds.includes(actualKind)) {
      problems.push(
        `${appearance.location} places ${actualKind} artifact "${id}" in the wrong contract field`,
      );
    }
    const current = appearances.get(id) ?? [];
    current.push(appearance);
    appearances.set(id, current);
  };

  for (const unit of units) {
    for (const figure of unit.sourceFigures) {
      if (figure.placement === "not_used_with_reason") {
        problems.push(
          `unit "${unit.id}" uses legacy inline omission for "${figure.id}"; move it to response.sourceArtifactOmissions with the exact model-authored reason`,
        );
        continue;
      }
      registerAppearance(figure.id, ["figure", "graph"], {
        mode: "assigned",
        location: `unit "${unit.id}" sourceFigures`,
      });
    }
    for (const formula of unit.sourceFormulas) {
      registerAppearance(formula.id, ["formula"], {
        mode: "assigned",
        location: `unit "${unit.id}" sourceFormulas`,
      });
    }
    for (const table of unit.sourceTables) {
      registerAppearance(table.id, ["table"], {
        mode: "assigned",
        location: `unit "${unit.id}" sourceTables`,
      });
    }
  }
  omissions.forEach((omission, index) => {
    if (!omission.reason.trim()) {
      problems.push(`sourceArtifactOmissions[${index}].reason must be non-empty model-authored prose`);
    }
    registerAppearance(
      omission.sourceArtifactId,
      ["figure", "graph", "table", "formula"],
      { mode: "omitted", location: `sourceArtifactOmissions[${index}]` },
    );
  });

  for (const id of registered.keys()) {
    const entries = appearances.get(id) ?? [];
    if (entries.length === 0) {
      problems.push(
        `registered source artifact "${id}" is forgotten; assign it to exactly one learning unit or explicitly omit it with a model-authored reason`,
      );
    } else if (entries.length > 1) {
      problems.push(
        `registered source artifact "${id}" must be assigned or omitted exactly once; found ${entries.map((entry) => `${entry.mode} at ${entry.location}`).join(", ")}`,
      );
    }
  }
  return [...new Set(problems)];
}

/**
 * Mechanically project authored placements and goals into the durable ledger.
 * Callers must run sourceArtifactOwnershipProblems first. This function never
 * ranks owners, invents prose, or silently drops a competing assignment.
 */
export function projectModelAuthoredSourceArtifactAssignments(
  units: readonly LearningUnitContract[],
): SourceArtifactAssignment[] {
  const assignments: SourceArtifactAssignment[] = [];
  for (const unit of units) {
    for (const figure of unit.sourceFigures) {
      if (figure.placement === "not_used_with_reason") continue;
      assignments.push({
        sourceArtifactId: figure.id,
        assignedLearningUnitId: unit.id,
        placement: figure.placement,
        reason: figure.mustBeDiscussedWith,
        requiredInterpretation: figure.interpretationGoal,
      });
    }
    for (const formula of unit.sourceFormulas) {
      assignments.push({
        sourceArtifactId: formula.id,
        assignedLearningUnitId: unit.id,
        placement: formula.placement === "inside_result_interpretation"
          ? "inside_result_interpretation"
          : "after_formula_introduction",
        reason: formula.teachingGoal,
        requiredInterpretation: formula.termsToDefine.join(", "),
      });
    }
    for (const table of unit.sourceTables) {
      assignments.push({
        sourceArtifactId: table.id,
        assignedLearningUnitId: unit.id,
        placement: table.placement,
        reason: table.teachingGoal,
        requiredInterpretation: table.rowsOrColumnsToExplain.join(", "),
      });
    }
  }
  return assignments;
}

// ---------------------------------------------------------------------------
// Clustering units → sections (Fix 1 core)
// ---------------------------------------------------------------------------

interface SectionTheme {
  key: string;
  title: string;
  roles: LearningUnitRole[];
}

/** Ordered narrative arc. Every role maps to exactly one theme. Titles are
 * topic-neutral so the arc generalises to any uploaded source set. */
const SECTION_THEMES: SectionTheme[] = [
  { key: "why", title: "Why This Topic Exists", roles: ["motivation"] },
  { key: "mechanism", title: "How the Mechanism Works", roles: ["core_concept", "mechanism"] },
  { key: "formalism", title: "The Formal Description", roles: ["formula", "worked_example"] },
  { key: "learning", title: "How It Learns or Changes", roles: ["training_method"] },
  { key: "measurement", title: "How It Is Measured", roles: ["metric"] },
  // "Evidence" is a banned learner-title word (reads as source commentary), so
  // the results theme names the concept instead.
  { key: "evidence", title: "What the Results Show", roles: ["result_interpretation", "comparison"] },
  { key: "use", title: "When to Use It, and Its Limits", roles: ["application", "limitation", "synthesis"] },
];

const MIN_SECTIONS = 4;
const MAX_SECTIONS = 7;
const MAX_SUBS_PER_SECTION = 5;

export interface SectionCluster {
  title: string;
  themeKey: string;
  unitIds: string[];
  /** Set when a section legitimately has a single subsection. */
  singleSubsectionReason?: string;
}

function themeForRole(role: LearningUnitRole): SectionTheme {
  return SECTION_THEMES.find((theme) => theme.roles.includes(role)) ?? SECTION_THEMES[1];
}

/**
 * Cluster learning units into 4–7 ordered sections, each normally 2–5
 * subsections. Units are grouped by narrative theme, oversized themes are split,
 * and lone units are merged into the nearest section so "every section has one
 * subsection" cannot happen. A single-subsection section survives only with a
 * recorded reason.
 */
export function clusterUnitsIntoSections(units: LearningUnitContract[]): SectionCluster[] {
  if (units.length === 0) return [];

  // 1) Bucket units into themes, preserving unit order within a theme.
  const buckets = new Map<string, { theme: SectionTheme; unitIds: string[] }>();
  for (const theme of SECTION_THEMES) buckets.set(theme.key, { theme, unitIds: [] });
  for (const unit of units) {
    const theme = themeForRole(unit.role);
    buckets.get(theme.key)!.unitIds.push(unit.id);
  }

  // 2) Drop empty themes, keep narrative order.
  let sections: SectionCluster[] = [];
  for (const theme of SECTION_THEMES) {
    const bucket = buckets.get(theme.key)!;
    if (bucket.unitIds.length === 0) continue;
    sections.push({ title: theme.title, themeKey: theme.key, unitIds: bucket.unitIds });
  }

  // 3) Split oversized sections into balanced parts (each <= MAX_SUBS).
  sections = sections.flatMap((section) => {
    if (section.unitIds.length <= MAX_SUBS_PER_SECTION) return [section];
    const parts = Math.ceil(section.unitIds.length / MAX_SUBS_PER_SECTION);
    const perPart = Math.ceil(section.unitIds.length / parts);
    const out: SectionCluster[] = [];
    for (let i = 0; i < parts; i += 1) {
      const slice = section.unitIds.slice(i * perPart, (i + 1) * perPart);
      if (slice.length === 0) continue;
      out.push({
        title: parts > 1 ? `${section.title} (Part ${i + 1})` : section.title,
        themeKey: section.themeKey,
        unitIds: slice,
      });
    }
    return out;
  });

  // 4) Merge lone (1-unit) sections into the nearest section with room, so we
  //    do not emit a table-of-contents of one-subsection sections.
  sections = mergeLoneSections(sections);

  // 5) If we somehow have fewer than MIN_SECTIONS but enough units, split the
  //    largest sections until we reach the floor.
  sections = growToMinSections(sections);

  // 6) If we have more than MAX_SECTIONS, merge the smallest adjacent pair.
  while (sections.length > MAX_SECTIONS) {
    let bestIndex = 0;
    let bestSize = Infinity;
    for (let i = 0; i < sections.length - 1; i += 1) {
      const size = sections[i].unitIds.length + sections[i + 1].unitIds.length;
      if (size < bestSize) {
        bestSize = size;
        bestIndex = i;
      }
    }
    sections = mergeAt(sections, bestIndex);
  }

  // 7) Any surviving single-subsection section gets a recorded reason.
  for (const section of sections) {
    if (section.unitIds.length === 1 && !section.singleSubsectionReason) {
      section.singleSubsectionReason =
        "This teaching step is conceptually distinct and could not be merged without blurring two different ideas.";
    }
  }
  return sections;
}

function mergeAt(sections: SectionCluster[], index: number): SectionCluster[] {
  const left = sections[index];
  const right = sections[index + 1];
  const merged: SectionCluster = {
    title: left.themeKey === right.themeKey ? left.title.replace(/\s*\(Part \d+\)$/, "") : `${left.title} and ${stripArticleTitle(right.title)}`,
    themeKey: left.themeKey,
    unitIds: [...left.unitIds, ...right.unitIds],
  };
  return [...sections.slice(0, index), merged, ...sections.slice(index + 2)];
}

function stripArticleTitle(title: string): string {
  return title.replace(/^(Why|How|The|What|When)\s+/i, "").replace(/^./, (c) => c.toLowerCase());
}

function mergeLoneSections(sections: SectionCluster[]): SectionCluster[] {
  if (sections.length <= 1) return sections;
  let changed = true;
  let current = [...sections];
  while (changed) {
    changed = false;
    for (let i = 0; i < current.length; i += 1) {
      if (current[i].unitIds.length !== 1) continue;
      // Prefer merging into the neighbour with the fewest subsections that still
      // has room. Try previous, then next.
      const candidates: number[] = [];
      if (i > 0) candidates.push(i - 1);
      if (i < current.length - 1) candidates.push(i + 1);
      const target = candidates
        .filter((j) => current[j].unitIds.length < MAX_SUBS_PER_SECTION)
        .sort((a, b) => current[a].unitIds.length - current[b].unitIds.length)[0];
      if (target === undefined) continue;
      const mergeIndex = Math.min(i, target);
      current = mergeAt(current, mergeIndex);
      changed = true;
      break;
    }
    // Don't collapse below the minimum useful spine.
    if (current.length <= MIN_SECTIONS) break;
  }
  return current;
}

function growToMinSections(sections: SectionCluster[]): SectionCluster[] {
  let current = [...sections];
  const totalUnits = current.reduce((sum, section) => sum + section.unitIds.length, 0);
  // Only attempt to reach the floor if there are genuinely enough units.
  const reachable = Math.min(MAX_SECTIONS, Math.floor(totalUnits / 2));
  while (current.length < MIN_SECTIONS && current.length < reachable) {
    // Split the largest section in half.
    let largest = 0;
    for (let i = 1; i < current.length; i += 1) {
      if (current[i].unitIds.length > current[largest].unitIds.length) largest = i;
    }
    const section = current[largest];
    if (section.unitIds.length < 4) break; // can't split into two >=2 halves
    const mid = Math.ceil(section.unitIds.length / 2);
    const first: SectionCluster = {
      title: `${section.title} (Part 1)`,
      themeKey: section.themeKey,
      unitIds: section.unitIds.slice(0, mid),
    };
    const second: SectionCluster = {
      title: `${section.title} (Part 2)`,
      themeKey: section.themeKey,
      unitIds: section.unitIds.slice(mid),
    };
    current = [...current.slice(0, largest), first, second, ...current.slice(largest + 1)];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Contracts → ProposedLearningMap (Fix 5: subsections from units)
// ---------------------------------------------------------------------------

function subsectionFromUnit(unit: LearningUnitContract): LearningSubsectionPlan {
  const sourceVisualIds = [
    ...unit.sourceFigures.filter((f) => f.placement !== "not_used_with_reason").map((f) => f.id),
    ...unit.sourceFormulas.map((f) => f.id),
    ...unit.sourceTables.map((t) => t.id),
  ];
  const interactiveVisuals = unit.interactiveVisual
    ? [
        {
          concept: unit.interactiveVisual.uniqueConcept,
          reason: unit.interactiveVisual.whyStaticSourceFigureIsNotEnough,
        },
      ]
    : [];
  return {
    title: unit.title,
    purpose: unit.learningQuestion,
    sourceAnchors: unit.sourceAnchors,
    visualOpportunities: unit.interactiveVisual ? [unit.interactiveVisual.uniqueConcept] : [],
    conceptTags: (unit.semanticConcepts ?? []).map((concept) => concept.slug),
    sourceVisualIds,
    interactiveVisuals,
    learningUnitId: unit.id,
    learningUnitRole: unit.role,
    learningQuestion: unit.learningQuestion,
    prerequisiteConcepts: unit.prerequisiteConcepts,
    newConcepts: unit.newConcepts,
    syllabusUnitIds: unit.syllabusUnitIds ?? [],
    mustNotRepeat: unit.mustNotRepeat,
    expectedWordRange: unit.expectedWordRange,
    sourceFigureContracts: unit.sourceFigures,
    sourceFormulaContracts: unit.sourceFormulas,
    sourceTableContracts: unit.sourceTables,
    sourceArtifactAssignments: projectModelAuthoredSourceArtifactAssignments([unit]),
    interactiveVisualContract: unit.interactiveVisual,
    interactiveVisualPlan: unit.interactiveVisualPlan,
    teachingMediumPlan: unit.teachingMediumPlan,
    zettelNotes: unit.zettelNotes,
    semanticConcepts: unit.semanticConcepts ?? [],
    knowledgeClaims: unit.knowledgeClaims ?? [],
  };
}

function stripSectionNumber(value: string): string {
  return compact(value).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
}

/** A minimal unit reconstructed from a title + role, used when only partial
 * (title/role) information is available for title polishing. */
function pseudoUnitForTitle(title: string, role: string): LearningUnitContract {
  const clean = stripSectionNumber(title);
  return {
    id: clean || "unit",
    title: clean,
    role: (LEARNING_UNIT_ROLES as readonly string[]).includes(role) ? (role as LearningUnitRole) : "core_concept",
    learningQuestion: "",
    prerequisiteConcepts: [],
    newConcepts: clean ? [clean] : [],
    sourceAnchors: [],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    zettelNotes: [],
    mustNotRepeat: [],
    expectedWordRange: [0, 0],
  };
}

/**
 * Generation-time section title. Delegates entirely to the topic-agnostic
 * candidate system in ./section-title.ts: the GardenTopicProfile supplies the
 * subject vocabulary, the units supply the universal purpose + focus concepts,
 * and the highest-scoring VALID topic-neutral title is chosen.
 * `otherSectionTitles` keeps sibling section titles unique.
 */
function polishSectionTitle(
  units: LearningUnitContract[],
  profile: GardenTopicProfile,
  otherSectionTitles: string[],
): string {
  return generateSectionTitle({ units, profile, otherSectionTitles }).title;
}

/**
 * Backward-compatible polish from a partial (roles + titles) input. Reconstructs
 * pseudo-units and a minimal profile so the same generic candidate system runs;
 * kept for callers that only have this shape.
 */
export function polishSectionTitleFromInput(input: SectionTitlePolishInput): string {
  const units = input.unitTitles.length > 0
    ? input.unitTitles.map((title, index) => pseudoUnitForTitle(title, input.unitRoles[index] ?? "core_concept"))
    : [pseudoUnitForTitle(input.originalTitle, "core_concept")];
  const profile = buildGardenTopicProfile({
    gardenTitle: input.originalTitle,
    units,
    sourceAnchorTitles: input.sourceAnchorTitles,
    sourceSemanticSummaries: input.dominantLearnerQuestion ? [input.dominantLearnerQuestion] : [],
  });
  const bare = generateSectionTitle({ units, profile, sectionNumber: input.sectionNumber }).title;
  return input.sectionNumber > 0 ? `${input.sectionNumber}. ${bare}` : bare;
}

/**
 * Build a ProposedLearningMap from learning units. Sections come from
 * clustering; subsections come one-per-unit. The map that reaches page
 * generation is therefore a real learning spine derived from the contracts.
 */
export function learningMapFromUnits(
  units: LearningUnitContract[],
  meta: { gardenId: string; title: string; summary: string; sourceOnly: boolean; createdAt: string; warnings?: string[] },
): ProposedLearningMap {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const clusters = clusterUnitsIntoSections(units);
  // One garden-wide topic profile supplies the subject vocabulary for every
  // section title; titles are generated in order so each stays unique.
  const profile = buildGardenTopicProfile({ gardenTitle: meta.title, units });
  const usedTitles: string[] = [];
  const sections: LearningSectionPlan[] = clusters.map((cluster) => {
    const clusterUnits = cluster.unitIds.map((id) => byId.get(id)).filter(Boolean) as LearningUnitContract[];
    const sectionAnchors = [...new Set(clusterUnits.flatMap((unit) => unit.sourceAnchors))].slice(0, 8);
    const sectionTitle = polishSectionTitle(clusterUnits, profile, usedTitles);
    usedTitles.push(sectionTitle);
    return {
      title: sectionTitle,
      purpose: cluster.singleSubsectionReason
        ? cluster.singleSubsectionReason
        : `Build up ${sectionTitle.toLowerCase()} one step at a time.`,
      sourceAnchors: sectionAnchors,
      subsections: clusterUnits.map(subsectionFromUnit),
    };
  });
  return {
    gardenId: meta.gardenId,
    title: meta.title,
    summary: meta.summary,
    sections,
    warnings: meta.warnings ?? [],
    sourceOnly: meta.sourceOnly,
    createdAt: meta.createdAt,
  };
}

/**
 * Project the model-authored spine into the learner map without clustering,
 * title generation, purpose templates, or any other semantic fallback.
 * Callers must run `validateLearningUnitContracts` with
 * `requireModelAuthoredSections` first; this function still fails closed when
 * invoked incorrectly so an incomplete contract can never become a page tree.
 */
export function learningMapFromModelAuthoredUnits(
  units: LearningUnitContract[],
  meta: {
    gardenId: string;
    title: string;
    summary: string;
    sourceOnly: boolean;
    createdAt: string;
    warnings?: string[];
  },
): ProposedLearningMap {
  if (!meta.title.trim() || !meta.summary.trim()) {
    throw new Error("Model-authored learning-map title and summary are required.");
  }
  const sectionProjection = modelAuthoredSectionGroups(units);
  if (sectionProjection.problems.length > 0) {
    throw new Error(
      `Model-authored section contract is invalid: ${sectionProjection.problems.join("; ")}`,
    );
  }
  const sections: LearningSectionPlan[] = sectionProjection.groups.map((group) => ({
    title: group.title,
    purpose: group.purpose,
    sourceAnchors: [...new Set(group.units.flatMap((unit) => unit.sourceAnchors))],
    subsections: group.units.map(subsectionFromUnit),
  }));
  return {
    gardenId: meta.gardenId,
    title: meta.title,
    summary: meta.summary,
    sections,
    warnings: meta.warnings ?? [],
    sourceOnly: meta.sourceOnly,
    createdAt: meta.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Inline source-figure placement (Fix 2)
// ---------------------------------------------------------------------------

const SOURCE_FIGURES_HEADING_RE = /^#{2,3}\s+Source Figures?\s*$/im;

function sourceImageBlockLooksLikeTable(block: string): boolean {
  return /\btable\b/i.test(block) || /source-visuals\/[^)\s]*-table-t\d+/i.test(block);
}

/**
 * A source figure image is "orphaned" when it appears under a generic
 * `## Source Figures` heading, or when no interpretive prose sits within
 * `maxDistance` paragraphs of it. Returns the offending image URLs/reasons.
 * This is the deterministic check behind Fix 2 / Fix 11.
 */
export function figurePlacementProblems(
  markdown: string,
  options: { maxDistanceParagraphs?: number; maxFiguresPerPage?: number } = {},
): string[] {
  const maxDistance = options.maxDistanceParagraphs ?? 3;
  const maxFigures = options.maxFiguresPerPage ?? 3;
  const problems: string[] = [];

  if (SOURCE_FIGURES_HEADING_RE.test(markdown)) {
    problems.push('source figures placed under a generic "## Source Figures" heading');
  }

  const blocks = markdown.split(/\n{2,}/).map((b) => b.trim());
  const imageBlockIndexes: number[] = [];
  blocks.forEach((block, index) => {
    // A block that is essentially just an image embed (optionally a caption).
    const withoutCaptions = block.replace(/^\s*\*[^*\n]*\*\s*$/gm, "").trim();
    const onlyImages = withoutCaptions.length > 0 &&
      withoutCaptions.split(/\n/).every((line) => /^!\[[^\]]*\]\([^)]*\)\s*$/.test(line.trim()) || line.trim() === "");
    if (onlyImages && /!\[[^\]]*\]\([^)]*\)/.test(block)) imageBlockIndexes.push(index);
  });

  const sourceFigureBlockIndexes = imageBlockIndexes.filter((index) => !sourceImageBlockLooksLikeTable(blocks[index] ?? ""));
  if (sourceFigureBlockIndexes.length > maxFigures) {
    problems.push(`page embeds ${sourceFigureBlockIndexes.length} source figures (> ${maxFigures}) without justification`);
  }

  const isProse = (block: string): boolean => {
    if (!block) return false;
    if (/^!\[/.test(block)) return false; // image
    if (/^#{1,6}\s/.test(block)) return false; // heading
    if (/^```/.test(block)) return false; // code / visual block
    if (/^\s*\*[^*]+\*\s*$/.test(block)) return false; // caption-only
    // Needs a real sentence's worth of words.
    return block.split(/\s+/).filter(Boolean).length >= 12;
  };

  for (const index of imageBlockIndexes) {
    let hasNearbyProse = false;
    for (let d = 1; d <= maxDistance; d += 1) {
      if (isProse(blocks[index - d] ?? "") || isProse(blocks[index + d] ?? "")) {
        hasNearbyProse = true;
        break;
      }
    }
    if (!hasNearbyProse) {
      const url = (blocks[index].match(/!\[[^\]]*\]\(([^)]*)\)/) ?? [])[1] ?? "(image)";
      problems.push(`source figure ${url} has no interpretive prose within ${maxDistance} paragraphs`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Learning-quality validation of the contract set (Fix 11)
// ---------------------------------------------------------------------------

export interface ContractValidationOptions {
  /** Number of important source artifacts (figures + tables + formulas + results). */
  artifactCount?: number;
  /** Minimum units expected for an artifact-rich source. */
  minUnitsForRichSource?: number;
  /** Normal Learn planning requires every semantic field to come from the model. */
  requireModelAuthoredSemantics?: boolean;
  /** Normal Learn planning requires explicit section ownership and prose. */
  requireModelAuthoredSections?: boolean;
}

interface ModelAuthoredSectionGroup {
  id: string;
  title: string;
  purpose: string;
  singleSubsectionReason?: string;
  units: LearningUnitContract[];
}

function modelAuthoredSectionGroups(
  units: readonly LearningUnitContract[],
): { groups: ModelAuthoredSectionGroup[]; problems: string[] } {
  const groups: ModelAuthoredSectionGroup[] = [];
  const closedIds = new Set<string>();
  const problems: string[] = [];
  let current: ModelAuthoredSectionGroup | undefined;
  for (const unit of units) {
    const section = unit.sectionPlan;
    if (!section?.id || !section.title || !section.purpose) {
      problems.push(`unit "${unit.id}": missing model-authored section id, title, or purpose`);
      continue;
    }
    if (!current || current.id !== section.id) {
      if (current) closedIds.add(current.id);
      if (closedIds.has(section.id)) {
        problems.push(`section "${section.id}" is non-contiguous in the learning-unit order`);
      }
      current = { ...section, units: [] };
      groups.push(current);
    } else if (
      current.title !== section.title ||
      current.purpose !== section.purpose ||
      (current.singleSubsectionReason ?? "") !== (section.singleSubsectionReason ?? "")
    ) {
      problems.push(`section "${section.id}" has inconsistent model-authored metadata across its units`);
    }
    current.units.push(unit);
  }
  const duplicateTitles = new Set<string>();
  const seenTitles = new Set<string>();
  for (const group of groups) {
    const key = group.title.toLowerCase();
    if (seenTitles.has(key)) duplicateTitles.add(group.title);
    seenTitles.add(key);
    if (group.units.length === 1 && !group.singleSubsectionReason) {
      problems.push(`section "${group.id}" has one unit without a model-authored singleSubsectionReason`);
    }
    if (group.units.length > MAX_SUBS_PER_SECTION) {
      problems.push(`section "${group.id}" has ${group.units.length} units; maximum is ${MAX_SUBS_PER_SECTION}`);
    }
  }
  for (const title of duplicateTitles) problems.push(`duplicate model-authored section title "${title}"`);
  if (groups.length < MIN_SECTIONS || groups.length > MAX_SECTIONS) {
    problems.push(`model authored ${groups.length} sections; expected ${MIN_SECTIONS}-${MAX_SECTIONS}`);
  }
  return { groups, problems: [...new Set(problems)] };
}

/**
 * Validate the learning-unit contract set against learning-quality rules. This
 * runs BEFORE page generation, so semantic mistakes are caught in the plan, not
 * repaired in the finalizer. Returns a list of problems; empty means the plan is
 * a real, source-grounded learning spine.
 */
export function validateLearningUnitContracts(
  units: LearningUnitContract[],
  options: ContractValidationOptions = {},
): string[] {
  const problems: string[] = [];
  const aliasReconciliation = reconcileLearningUnitConceptAliases(units);
  for (const conflict of aliasReconciliation.conflicts) {
    problems.push(
      `canonical concept term collision "${conflict.normalizedAlias}": ${conflict.conceptIds.join(", ")}`,
    );
  }
  const artifactCount = options.artifactCount ?? 0;
  const minUnits = options.minUnitsForRichSource ?? 12;

  const unitIds = new Set<string>();
  for (const unit of units) {
    if (!unit.id || !/^[A-Za-z0-9_.-]+$/.test(unit.id)) {
      problems.push("learning unit is missing a canonical model-authored id");
    } else if (unitIds.has(unit.id)) {
      problems.push(`duplicate model-authored learning unit id "${unit.id}"`);
    } else {
      unitIds.add(unit.id);
    }
  }

  // Unit count for artifact-rich sources.
  if (units.length < minUnits && artifactCount >= minUnits) {
    problems.push(
      `only ${units.length} learning units for a source with ${artifactCount} important figures/tables/formulas/results (expected >= ${minUnits})`,
    );
  }
  if (units.length < 8) {
    problems.push(`only ${units.length} learning units; a garden needs a real teaching sequence (>= 8)`);
  }

  // The active source-rich contract asks the model for 15-25 units. At that
  // depth, collapsing every teaching move to one role is not a harmless label:
  // it changes page prompts, visual review, and section semantics. Formula
  // ownership is validated from exact anchors and placements below, so a model
  // must never relabel conceptual/mechanism/application units as `formula`
  // merely to carry equations.
  if (options.requireModelAuthoredSemantics && units.length >= 15) {
    const authoredRoles = new Set(units.map((unit) => unit.role));
    if (authoredRoles.size < 3) {
      problems.push(
        `model-authored learning spine uses only ${authoredRoles.size} pedagogical role${authoredRoles.size === 1 ? "" : "s"} (${[...authoredRoles].join(", ") || "none"}); choose roles from each unit's teaching move, not its source-artifact type, and use at least 3 distinct roles`,
      );
    }
    if (!units.some((unit) =>
      unit.role === "motivation" ||
      unit.role === "core_concept" ||
      unit.role === "mechanism"
    )) {
      problems.push(
        "model-authored learning spine has no motivation, core-concept, or mechanism unit",
      );
    }
    if (!units.some((unit) =>
      unit.role === "worked_example" ||
      unit.role === "training_method" ||
      unit.role === "result_interpretation" ||
      unit.role === "comparison" ||
      unit.role === "application" ||
      unit.role === "limitation" ||
      unit.role === "synthesis"
    )) {
      problems.push(
        "model-authored learning spine has no practice, interpretation, comparison, application, limitation, or synthesis unit",
      );
    }
  }

  if (options.requireModelAuthoredSections) {
    problems.push(...modelAuthoredSectionGroups(units).problems);
  } else {
    // Legacy callers may still validate the old role-cluster projection. The
    // active Learn path never enters this branch.
    const clusters = clusterUnitsIntoSections(units);
    problems.push(...clusterDepthProblems(clusters));
  }

  // Interactive-visual uniqueness (Fix 4).
  for (const dup of duplicateInteractiveVisuals(units)) {
    problems.push(`duplicate interactive visual signature "${dup.signature}" on units ${dup.unitIds.join(", ")}`);
  }

  // Interactive-visual compatibility (Fix 5).
  for (const unit of units) {
    if (!unit.interactiveVisual) continue;
    const compat = visualTypeCompatibleWithUnit(unit.interactiveVisual.visualType, unit);
    if (!compat.ok) problems.push(`unit "${unit.id}" (${unit.title}): ${compat.reason}`);
  }

  // Source-artifact placement sanity (Fix 3 / Fix 8).
  for (const unit of units) {
    for (const figure of unit.sourceFigures) {
      if (figure.placement === "not_used_with_reason" && !compact(figure.notUsedReason)) {
        problems.push(`unit "${unit.id}": figure ${figure.id} marked unused without a reason`);
      }
      if (figure.placement === "inside_result_interpretation" && DEFINITION_ROLES.has(unit.role)) {
        problems.push(`unit "${unit.id}" (${unit.role}): result figure ${figure.id} assigned to a definition/introduction unit`);
      }
    }
    // A verified equation can legitimately support a concept, mechanism,
    // comparison, application, or synthesis page. The unit role describes the
    // teaching move; it is not permission to carry math. Exact artifact
    // identity, ownership, grounding, and the model-authored placement carry
    // that safety contract, so do not force every equation-owning unit to call
    // itself `formula` or `metric`.
  }

  // Public concepts and readable claims are validated independently.
  for (const unit of units) {
    if (options.requireModelAuthoredSemantics) {
      if (!unit.title) problems.push(`unit "${unit.id}": missing model-authored title`);
      if (!(LEARNING_UNIT_ROLES as readonly string[]).includes(unit.role)) {
        problems.push(`unit "${unit.id}": invalid or missing model-authored role`);
      }
      if (!unit.learningQuestion) {
        problems.push(`unit "${unit.id}": missing model-authored learningQuestion`);
      }
      if (
        unit.expectedWordRange[0] <= 0 ||
        unit.expectedWordRange[1] < unit.expectedWordRange[0]
      ) {
        problems.push(`unit "${unit.id}": missing or invalid model-authored expectedWordRange`);
      }
      if (!unit.semanticConcepts?.length) {
        problems.push(`unit "${unit.id}": missing model-authored semanticConcepts`);
      }
    }
    for (const concept of unit.semanticConcepts ?? []) {
      if (!isValidPublicConceptSlug(normalizeConceptSlug(concept.slug))) {
        problems.push(`unit "${unit.id}": invalid or claim-shaped public concept "${concept.slug}"`);
      }
    }
    const concepts = options.requireModelAuthoredSemantics
      ? (unit.semanticConcepts ?? [])
      : semanticConceptsForUnit(unit);
    const primaryConcepts = concepts.filter((concept) => concept.role === "primary");
    if (primaryConcepts.length === 0) {
      problems.push(`unit "${unit.id}": no primary semantic concept`);
    }
    if (options.requireModelAuthoredSemantics && primaryConcepts.length > 2) {
      problems.push(`unit "${unit.id}": more than two primary semantic concepts`);
    }
    if (concepts.length > 5) problems.push(`unit "${unit.id}": more than five public concepts`);
    for (const concept of concepts) {
      if (!isValidPublicConceptSlug(concept.slug)) {
        problems.push(`unit "${unit.id}": invalid or claim-shaped public concept "${concept.slug}"`);
      }
    }
    const claims = options.requireModelAuthoredSemantics
      ? (unit.knowledgeClaims ?? [])
      : knowledgeClaimsForUnit(unit);
    for (const claim of claims) {
      if (isGenericFillerClaim(claim.text)) {
        problems.push(`unit "${unit.id}": generic fallback claim "${claim.text}"`);
      }
    }
  }

  return problems;
}

/** Section-depth problems derived from a set of clusters (Fix 1). */
export function clusterDepthProblems(clusters: SectionCluster[]): string[] {
  const problems: string[] = [];
  if (clusters.length < MIN_SECTIONS) {
    problems.push(`only ${clusters.length} sections; a normal garden has ${MIN_SECTIONS}-${MAX_SECTIONS}`);
  }
  if (clusters.length > MAX_SECTIONS) {
    problems.push(`${clusters.length} sections; a normal garden has ${MIN_SECTIONS}-${MAX_SECTIONS}`);
  }
  const single = clusters.filter((c) => c.unitIds.length <= 1);
  if (clusters.length > 0 && single.length === clusters.length) {
    problems.push("every section has a single subsection — this is a table of contents, not a learning spine");
  } else if (clusters.length >= 4 && single.filter((c) => !c.singleSubsectionReason).length * 4 > clusters.length) {
    problems.push(
      `${single.length} of ${clusters.length} sections have a single subsection (> 25%) without a recorded reason`,
    );
  }
  return problems;
}
