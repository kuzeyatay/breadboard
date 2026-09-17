import { createHash } from "crypto";
import {
  normalizeTopicTags as normalizeConceptTags,
  semanticTagsFromText as semanticConceptTagsFromText,
} from "./tags.ts";
import {
  atomicZettelHandle,
  isAtomicZettelHandle,
  type InteractiveVisualContract,
  type LearningUnitRole,
  type SourceArtifactAssignment,
  type SourceFigureContract,
  type SourceFormulaContract,
  type SourceQuestionContract,
  type SourceTableContract,
  type ZettelNote,
} from "./learning-unit-contract.ts";
import type { KnowledgeClaimPlan, SemanticConceptPlan } from "./semantic-core.ts";
import type {
  ContractInteractiveVisualPlan,
  TeachingMediumPlan,
} from "./visual-necessity-types.ts";

export const LEARN_STATUSES = [
  "idle",
  "planning",
  "awaiting_confirmation",
  "analyzing_issues",
  "repairing",
  "revalidating",
  "publishing_repair",
  "generating_learning_pages",
  // Legacy name for generating_learning_pages; still read from old job rows.
  "generating_textbook",
  "generating_visuals",
  "writing_quartz",
  "building_navigation",
  // Held at a checkpoint by the user. The worker, its garden lease, and its
  // in-memory run state all stay alive; Resume returns the row to the status
  // recorded in paused_from_status.
  "paused",
  "complete",
  "failed",
  "cancelled",
] as const;

export type LearnStatus = (typeof LEARN_STATUSES)[number];

export interface LearnSourceSummary {
  id: string;
  slug: string;
  title: string;
  description?: string;
  relPath: string;
  sourceType?: string;
  sourceFile?: string;
  /** Garden-relative URL of the preserved original PDF, when available. */
  sourcePdf?: string;
  date?: string;
  wordCount?: number;
  excerpt?: string;
  body?: string;
  tags?: string[];
  /** Garden-relative URLs of stored full-page snapshot images. */
  sourceImages?: string[];
}

export interface LearnConceptSummary {
  title: string;
  excerpt?: string;
  sourceDocument?: string;
  locations?: string[];
  tags?: string[];
}

export interface LearnContextSummary {
  gardenId: string;
  gardenTitle: string;
  sources: LearnSourceSummary[];
  concepts?: LearnConceptSummary[];
}

/**
 * Resolve an explicit Learn source selection against the currently available
 * source documents. `undefined` preserves the legacy "all documents" behavior;
 * an explicit list is validated so a stale or empty UI selection cannot start
 * a misleading Learn run.
 */
export function selectLearnSources(
  sources: LearnSourceSummary[],
  includedSourceIds?: readonly string[],
): LearnSourceSummary[] {
  if (includedSourceIds === undefined) return sources;

  const requestedIds = Array.from(
    new Set(
      includedSourceIds
        .filter((sourceId): sourceId is string => typeof sourceId === "string")
        .map((sourceId) => sourceId.trim())
        .filter(Boolean),
    ),
  );
  if (requestedIds.length === 0) {
    throw new Error("Select at least one source for Learn.");
  }

  const availableIds = new Set(sources.map((source) => source.slug));
  const missingIds = requestedIds.filter((sourceId) => !availableIds.has(sourceId));
  if (missingIds.length > 0) {
    throw new Error(
      `The selected Learn source${missingIds.length === 1 ? " is" : "s are"} no longer available: ${missingIds.join(", ")}. Refresh the garden and choose the sources again.`,
    );
  }

  const requestedIdSet = new Set(requestedIds);
  return sources.filter((source) => requestedIdSet.has(source.slug));
}

/**
 * Resolve the optional syllabus (study guide) for a Learn run.
 *
 * A syllabus is an ordinary uploaded document that the user *designates* as the
 * course outline: it says what to teach, in what order, and to what depth. It is
 * resolved against every available document rather than the selected teaching
 * set, so a syllabus can steer a run without having to be one of the sources it
 * steers.
 */
export function selectLearnSyllabus(
  availableSources: LearnSourceSummary[],
  syllabusSourceId?: string | null,
): LearnSourceSummary | null {
  const requestedId =
    typeof syllabusSourceId === "string" ? syllabusSourceId.trim() : "";
  if (!requestedId) return null;

  const syllabus = availableSources.find((source) => source.slug === requestedId);
  if (!syllabus) {
    throw new Error(
      `The selected Learn syllabus is no longer available: ${requestedId}. Refresh the garden and choose the syllabus again.`,
    );
  }
  return syllabus;
}

/**
 * Drop the syllabus from the teaching sources. The syllabus describes the course
 * rather than teaching it, so leaving it in would produce lessons *about* the
 * study guide instead of about the subject.
 */
export function excludeSyllabusFromSources(
  sources: LearnSourceSummary[],
  syllabus: LearnSourceSummary | null,
): LearnSourceSummary[] {
  if (!syllabus) return sources;
  return sources.filter((source) => source.slug !== syllabus.slug);
}

export interface PersistedLearnSelectionOwner<TCoverage = unknown> {
  id?: string;
  status?: string;
  proposedLearningMapId?: string;
  confirmedLearningMapId?: string;
  sourceIds: readonly string[];
  syllabusSourceId?: string | null;
  syllabusCoverage?: TCoverage | null;
}

export interface PersistedLearnSelection<TCoverage = unknown> {
  sourceIds: string[];
  syllabusSourceId: string | null;
  syllabusCoverage: TCoverage | null;
}

const JOB_STATUSES_WITH_BOUND_SELECTION_COVERAGE = new Set([
  "awaiting_confirmation",
  "generating_learning_pages",
  "generating_textbook",
  "generating_visuals",
  "writing_quartz",
  "building_navigation",
  "paused",
  "complete",
]);

/**
 * Read the selection from one newest workflow owner. A current job always owns
 * its source/syllabus binding. Coverage is paired only from the exact proposed
 * or confirmed map named by a reviewable/active/completed job with that same
 * binding; coverage is never borrowed from an older map.
 */
export function persistedLearnSelection<TCoverage = unknown>(
  latestJob?: PersistedLearnSelectionOwner<TCoverage> | null,
  jobBoundMap?: PersistedLearnSelectionOwner<TCoverage> | null,
  confirmedMap?: PersistedLearnSelectionOwner<TCoverage> | null,
): PersistedLearnSelection<TCoverage> | null {
  const owner = latestJob ?? jobBoundMap ?? confirmedMap;
  if (!owner) return null;

  const sourceId =
    typeof owner.syllabusSourceId === "string"
      ? owner.syllabusSourceId.trim()
      : "";
  const syllabusSourceId = sourceId || null;
  const boundMapSyllabusSourceId =
    typeof jobBoundMap?.syllabusSourceId === "string"
      ? jobBoundMap.syllabusSourceId.trim()
      : "";
  const boundMapId = latestJob
    ? latestJob.proposedLearningMapId ?? latestJob.confirmedLearningMapId
    : undefined;
  const latestJobOwnsMapCoverage = Boolean(
    latestJob &&
      typeof latestJob.status === "string" &&
      JOB_STATUSES_WITH_BOUND_SELECTION_COVERAGE.has(latestJob.status) &&
      typeof boundMapId === "string" &&
      typeof jobBoundMap?.id === "string" &&
      boundMapId === jobBoundMap.id &&
      latestJob.sourceIds.length === jobBoundMap.sourceIds.length &&
      latestJob.sourceIds.every(
        (sourceId, index) => sourceId === jobBoundMap.sourceIds[index],
      ) &&
      syllabusSourceId === (boundMapSyllabusSourceId || null),
  );
  const syllabusCoverage = latestJob
    ? latestJobOwnsMapCoverage
      ? (jobBoundMap?.syllabusCoverage ?? null)
      : null
    : (owner.syllabusCoverage ?? null);
  return {
    sourceIds: [...owner.sourceIds],
    syllabusSourceId,
    syllabusCoverage: syllabusSourceId
      ? syllabusCoverage
      : null,
  };
}

/**
 * Fold the designated syllabus into the source-set hash so swapping or editing
 * it counts as a source change. A run without a syllabus keeps its existing hash
 * byte-for-byte, so this never marks an untouched garden's sources as changed.
 */
export function sourceSetHashWithSyllabus(
  baseHash: string,
  syllabus: LearnSourceSummary | null,
): string {
  if (!syllabus) return baseHash;
  return createHash("sha256")
    .update(baseHash)
    .update("\0syllabus\0")
    .update(syllabus.slug)
    .update("\0")
    // Every field below can reach a syllabus-planning prompt or identifies the
    // selected guide. Keep a title/description-only edit from being silently
    // treated as the same planning evidence.
    .update(syllabus.title ?? "")
    .update("\0")
    .update(syllabus.description ?? "")
    .update("\0")
    .update(syllabus.relPath ?? "")
    .update("\0")
    .update(syllabus.sourceFile ?? "")
    .update("\0")
    .update(syllabus.body ?? "")
    .digest("hex");
}

/** An interactive visual the planner explicitly decided this page needs.
 * Interactive visuals are opt-in: no entry here means the page gets none. */
export interface InteractiveVisualPlan {
  concept: string;
  reason: string;
}

export interface LearningSubsectionPlan {
  title: string;
  purpose: string;
  sourceAnchors: string[];
  visualOpportunities: string[];
  conceptTags: string[];
  /** Source visual ids (S1.P4.F1 style) assigned to be embedded in this page. */
  sourceVisualIds: string[];
  /** Interactive visuals to create — only for genuinely hard concepts. */
  interactiveVisuals: InteractiveVisualPlan[];
  /** Durable Learning Unit Contract metadata, when this subsection came from a unit. */
  learningUnitId?: string;
  learningUnitRole?: LearningUnitRole;
  learningQuestion?: string;
  prerequisiteConcepts?: string[];
  newConcepts?: string[];
  syllabusUnitIds?: string[];
  mustNotRepeat?: string[];
  expectedWordRange?: [number, number];
  sourceFigureContracts?: SourceFigureContract[];
  sourceFormulaContracts?: SourceFormulaContract[];
  sourceTableContracts?: SourceTableContract[];
  sourceQuestionContracts?: SourceQuestionContract[];
  sourceArtifactAssignments?: SourceArtifactAssignment[];
  interactiveVisualContract?: InteractiveVisualContract;
  interactiveVisualPlan?: ContractInteractiveVisualPlan;
  teachingMediumPlan?: TeachingMediumPlan;
  zettelNotes?: ZettelNote[];
  semanticConcepts?: SemanticConceptPlan[];
  knowledgeClaims?: KnowledgeClaimPlan[];
}

export interface LearningSectionPlan {
  title: string;
  purpose: string;
  sourceAnchors: string[];
  subsections: LearningSubsectionPlan[];
}

export interface ProposedLearningMap {
  gardenId: string;
  title: string;
  summary: string;
  sections: LearningSectionPlan[];
  warnings: string[];
  sourceOnly: boolean;
  createdAt: string;
}

type FrontmatterScalar = string | number | boolean;
type FrontmatterObject = Record<string, FrontmatterScalar | string[] | undefined | null>;
type FrontmatterValue = FrontmatterScalar | string[] | FrontmatterObject[] | undefined | null;

export interface FormulaGroundingEntry {
  kind?: FormulaRecordKind;
  text: string;
  normalizedText?: string;
  groundingStatus: "source-anchored" | "source-derived" | "conceptual-helper" | "unmatched";
  justification: string;
  sourceAnchor?: string;
  sourceAnchorTitle?: string;
  matchReason?: string;
  confidence?: number;
  /** Worked-example lineage: the source (derived) definition this example
   * applies (source-formula anchor id or a page-local definition's text). */
  basedOnFormula?: string;
  /** Metric/relationship family shared by a definition and its worked examples. */
  formulaFamily?: string;
  /** Groups worked examples that apply the same definition. */
  exampleGroupId?: string;
}

export type FormulaRecordKind =
  | "source_definition"
  | "source_derived_definition"
  | "worked_example"
  | "conceptual_helper";

export function formulaRecordKindForGroundingStatus(status: string | undefined): FormulaRecordKind {
  switch (status) {
    case "source-anchored":
      return "source_definition";
    case "source-derived":
      return "source_derived_definition";
    default:
      return "conceptual_helper";
  }
}

export function isWorkedExampleFormula(expr: string): boolean {
  const compacted = expr
    .replace(/\\(?:text|mathrm|operatorname)\{([^}]*)\}/g, "$1")
    .replace(/\\(?:left|right|,|;|:|!)/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!compacted || !/[=+\-*/]/.test(compacted)) return false;
  const withoutUnits = compacted.replace(/\b(?:ms|s|j|w|hz|khz|mhz|v|a|spikes?|epochs?)\b/gi, "");
  const alpha = withoutUnits.match(/[A-Za-z]/g) ?? [];
  const digits = compacted.match(/\d/g) ?? [];
  if (digits.length < 2) return false;
  // A summation/product/integral is a source DEFINITION, never numeric worked-
  // example arithmetic — even when its inline index bounds (t=1, i=1) and an
  // equation tag like "(3)" add extra "=" signs and digits. OCR flattening of
  // \sum_{t=1}^{T}\sum_{i=1}^{N} into "sum sum ... t=1 i=1" previously tripped
  // the chained-equality rule below and mislabeled the canonical definition as
  // a worked example. Aggregation notation is excluded from both heuristics.
  const aggregationNotation = /\\(?:sum|prod|oint|int)(?![A-Za-z])/.test(expr) || /\bsum\b|\bprod\b|\boint\b|\bint\b/i.test(expr);
  if (aggregationNotation) return false;
  // Chained equality with concrete values is a substitution/result even when
  // the left-hand variable has a descriptive subscript (for example
  // L_decision = 35 - 20 = 15 time steps). The old alpha-count heuristic
  // mislabeled these as source definitions or generic helpers.
  if ((compacted.match(/=/g) ?? []).length >= 2) return true;
  return alpha.length <= 1 || digits.length >= alpha.length * 3;
}

/** Formula grounding metadata is for meaningful equations/metric definitions,
 * not every numeric inline example. Plain numbers, percentages, and single
 * variables can stay in prose without bloating frontmatter. */
export function isFormulaExpression(expr: string): boolean {
  const original = expr.trim();
  if (!original) return false;
  if (/^(?:define|show|teach|use|connect|explain|describe|introduce|compare|discuss|demonstrate|identify|interpret|summarize|calculate)\b/i.test(original)) {
    return false;
  }
  if (/:\s*[A-Za-z][A-Za-z\s-]*(?:\s+\+\s+[A-Za-z][A-Za-z\s-]*){1,}\s*$/i.test(original)) {
    return false;
  }
  const compacted = expr
    .replace(/\\(?:left|right|,|;|:|!)/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!compacted) return false;
  if (/^[+-]?\d+(?:\.\d+)?(?:\\?%)?$/.test(compacted)) return false;
  if (isTrivialFormulaFragment(expr)) return false;
  if (/^(?:ms|s|j|w|hz|khz|mhz|v|a)$/i.test(compacted)) return false;
  // Coordinate and component tuples are mathematical expressions even when
  // they do not contain an operator or equality sign. This covers point/vector
  // definitions such as `A(1,2,3); B(4,5,6)` while requiring a named tuple and
  // at least two scalar/symbolic components, so ordinary parenthetical prose is
  // not promoted to formula metadata.
  const coordinateTuple = /(?:^|[;\s\\])(?:[A-Za-z][A-Za-z0-9_]*|\\(?:mathbf|vec)\{[A-Za-z][A-Za-z0-9_]*\})\s*\(\s*[+-]?(?:\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]*)\s*(?:,\s*[+-]?(?:\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]*)\s*){1,}\)/;
  if (coordinateTuple.test(original)) return true;
  // TeX command names end before `_`, `^`, or `{`, not only at a JavaScript
  // word boundary. This recognizes bounded integrals such as `\\int_S` and
  // contour integrals such as `\\oint` without accepting longer prose words.
  if (/\\(?:frac|sum|prod|oint|int|sqrt|min|max|log|exp|Delta|tau|lambda|eta|theta|operatorname)(?![A-Za-z])/.test(expr)) return true;
  if (/[=<>≤≥≈∝]/.test(expr) || /\\(?:geq|leq|neq|approx)\b/.test(expr)) {
    return /[A-Za-z0-9\\]/.test(expr);
  }
  if (/[=<>≤≥≈∝]/.test(expr)) return /[A-Za-z\\]/.test(expr);
  if (/[+\-*/^]/.test(compacted) && /[A-Za-z0-9\\]/.test(compacted) && compacted.length > 3) {
    const parts = original
      .split(/\s*[+\-*/^]\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    const naturalLanguageBundle =
      parts.length >= 2 &&
      parts.every((part) => /^[A-Za-z][A-Za-z\s-]{2,}$/.test(part) && !/[\\_^0-9]/.test(part));
    if (naturalLanguageBundle) return false;
    return true;
  }
  return false;
}

export function isGroundableFormula(expr: string): boolean {
  return isFormulaExpression(expr);
}

export type FormulaMetricFamily =
  | "accuracy"
  | "latency"
  | "spike-count"
  | "energy"
  | "efficiency"
  | "convergence"
  | "threshold"
  | "probability"
  | "loss"
  | "gradient";

const FORMULA_FAMILY_PATTERNS: Array<[FormulaMetricFamily, RegExp]> = [
  // Convergence formulas contain a target/threshold condition too. Match the
  // more specific epoch/target-accuracy family before the generic neuronal
  // threshold family so `min {e | A(e) >= A_target}` is not mislabeled.
  ["convergence", /\bconverg|\bepochs?\b|\btarget accuracy\b|\btarget\b|t_\{?\\?text\{?conv|t_\{?conv|a\(e\)|\ba_\{?e\}?|\ba_\{?target\}?|arg\s*min|\\arg\s*min|\\min\s*\\?\{/i],
  ["threshold", /\bthreshold\b|\bmembrane potential\b|\bspike occurs\b|v\(t\)|v_t|\\theta|theta|\\vartheta|>=\s*theta|\\geq\s*\\?theta/i],
  ["gradient", /\bgradient\b|\\nabla|d\s*L\s*\/\s*d|\\partial|surrogate/i],
  ["loss", /\bloss\b|\\mathcal\{?L\}?|mse|cross[- ]?entropy|\\ell\b/i],
  ["probability", /\bprobab|\bp\(|p_\{?i\}?|softmax|\\sigma\(|\\Pr\b/i],
  // Efficiency is a benefit-per-energy ratio. Match the "<accuracy/count/points>
  // per joule/watt/energy" shape BEFORE the generic energy family so a worked
  // example like "45 correct classifications per joule" is not mislabeled energy
  // just because it mentions joules. "energy per inference" keeps "per" AFTER the
  // energy term, so it does not match here and correctly falls through to energy.
  ["efficiency", /\befficien|\baccuracy per energy\b|normalized energy|\\eta|eta|\bNEE\b|\\mathrm\{?NEE\}?|\\frac\s*\{?\s*A\s*\}?\s*\{?\s*E\s*\}?|\bper\s+joule\b|\bper\s+watt\b|(?:classifications?|predictions?|points?|accuracy|percentage)\s+per\s+(?:joule|watt|energy)/i],
  ["energy", /\benergy\b|\bjoules?\b|\bpower\b|\bsynaptic\b|\bsynops?\b|\be_\{?\\?text\{?(?:energy|total|spike|syn)|e_\{?(?:total|spike|synop)|\be(?:total|spike|synapse)\b|(?:energy|power|joule|synaptic|synop|operation)\s+costs?\b|\bcosts?\s+(?:of\s+)?(?:energy|power|joules?|synaptic|synops?|operations?)\b/i],
  ["spike-count", /\bspike[- ]?count\b|\btotal spikes?\b|\bnumber of spikes?\b|\bspikes?\b|n_\{?\\?text\{?(?:spike|spk)|n_\{?(?:spikes?|spk)\}?|n[_\s]*(?:spikes?|spk)|\\sum(?:_\{?[^}\s]*\}?|\s)*(?:s[_\{]|\bspikes?\b)|s_\{?[a-z](?:,[a-z])?\}?|s_n\(t\)/i],
  ["latency", /\blatency\b|\bdelay\b|\bdecision time\b|\bresponse time\b|t_\{?\\?text\{?(?:latency|decision|stimulus)|t_\{?(?:decision|stimulus)/i],
  ["accuracy", /\baccuracy\b|\bclassification\b|\bcorrect predictions?\b|\bn_\{?\\?text\{?correct|n_\{?correct|n_\{?\\?text\{?total|n_\{?total|correct\s*\/\s*total/i],
];

export function formulaMetricFamily(text: string): FormulaMetricFamily | null {
  const normalized = text
    .replace(/\\\\+/g, "\\")
    .replace(/\\mathrm\{([^}]*)\}/g, "$1")
    .replace(/\\operatorname\{([^}]*)\}/g, "$1")
    .replace(/\s+/g, " ")
    .toLowerCase();
  for (const [family, pattern] of FORMULA_FAMILY_PATTERNS) {
    if (pattern.test(normalized)) return family;
  }
  if (/%|\\%/.test(text) && /\\frac|\//.test(text)) return "accuracy";
  return null;
}

export function isTrivialFormulaFragment(expr: string): boolean {
  const compacted = expr
    .trim()
    .replace(/\\(?:left|right|,|;|:|!)/g, "")
    .replace(/\s+/g, "")
    .replace(/\\mathrm\{([^}]*)\}/g, "$1")
    .replace(/\\operatorname\{([^}]*)\}/g, "$1");
  if (!compacted) return true;
  if (/^[A-Za-z](?:_\{?[A-Za-z0-9]+\}?|\^\{?[A-Za-z0-9]+\}?|\([A-Za-z0-9]+\))?$/.test(compacted)) return true;
  if (/^\\(?:theta|vartheta|tau|lambda|Delta|eta)$/.test(compacted)) return true;
  if (/^\\(?:min|max|sum|prod|int)(?:[_^]\{?[^}]*\}?)*$/.test(compacted)) return true;
  if (/^[A-Za-z](?:_\{?[A-Za-z0-9]+\}?|\([A-Za-z0-9]+\))?=\d+(?:\.\d+)?$/.test(compacted)) return true;
  if (/^s_\{?i\}?\(t\)=[01]$|^s_i\(t\)=[01]$/i.test(compacted)) return true;
  return false;
}

export function formulaMeaningMatch(
  formulaText: string,
  sourceText: string,
): { ok: boolean; formulaFamily: FormulaMetricFamily | null; sourceFamily: FormulaMetricFamily | null; reason: string } {
  const formulaFamily = formulaMetricFamily(formulaText);
  const sourceFamily = formulaMetricFamily(sourceText);
  if (!sourceFamily) {
    return { ok: true, formulaFamily, sourceFamily, reason: "source anchor has no recognized metric family" };
  }
  if (!formulaFamily) {
    return { ok: false, formulaFamily, sourceFamily, reason: `formula has no recognized metric family but source is ${sourceFamily}` };
  }
  if (formulaFamily !== sourceFamily) {
    return { ok: false, formulaFamily, sourceFamily, reason: `formula family ${formulaFamily} does not match source family ${sourceFamily}` };
  }
  return { ok: true, formulaFamily, sourceFamily, reason: `formula and source both match ${sourceFamily}` };
}

const RAW_VISUAL_PLACEHOLDER_RE =
  /\[(?:Interactive visual|Visual|Generated visual)\s*:\s*([^\[\]]+)\]/gi;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export function stripMarkdownFrontmatter(value: string): string {
  return value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/** Index of the character that closes the JSON value opened at `start`, or -1. */
function balancedJsonEnd(text: string, start: number): number {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parse a model answer that must be one JSON object. Throws a SyntaxError when
 * it is not.
 *
 * Accepted beyond plain JSON: a ```json fence, a surplus closing brace after a
 * complete object (a bounded transport defect), and a sentence of prose before
 * the object - the ChatGPT web chat models open JSON answers that way even when
 * told not to (seen 2026-09-15 on visual authoring and on a contract repair).
 * The first object that runs to the end of the answer is the response; braces
 * inside the prose (`{plan, package}`) close long before the end and are
 * skipped. Still refused: a second object, trailing prose, and an object that
 * does not parse - never a smaller object nested inside a broken one.
 */
export function parseJsonObjectResponse(content: string): Record<string, any> {
  const text = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (text.startsWith("{")) {
    const end = balancedJsonEnd(text, 0);
    if (end >= 0 && /^[}\s]*$/.test(text.slice(end + 1))) {
      return JSON.parse(text.slice(0, end + 1));
    }
    return JSON.parse(text);
  }
  for (let start = text.indexOf("{"); start > 0; start = text.indexOf("{", start + 1)) {
    const end = balancedJsonEnd(text, start);
    if (end < 0) continue;
    if (/^\s*$/.test(text.slice(end + 1))) {
      return JSON.parse(text.slice(start, end + 1));
    }
    // A complete object with more text after it is a response followed by
    // another response or by trailing prose: refuse rather than skip ahead.
    let complete = false;
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      complete = Boolean(value) && typeof value === "object" && !Array.isArray(value);
    } catch {
      complete = false;
    }
    if (complete) break;
  }
  return JSON.parse(text);
}

export function parseJsonCandidate<T = unknown>(value: string): T | null {
  const stripped = stripMarkdownFence(value);
  try {
    return JSON.parse(stripped) as T;
  } catch {
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // Slicing to the last brace keeps a surplus closing brace the web chat
        // model sometimes appends ("...}}}]}" for "...}}]}"; live 2026-09-16 on
        // a visual-necessity repair). The balanced-object parser drops it.
        try {
          return parseJsonObjectResponse(stripped) as T;
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

/**
 * Drops closing brackets that cannot close anything at their position: a `}`
 * while the innermost open container is an array, a `]` while it is an object,
 * or either with nothing open. Strings are skipped, escapes respected. Such a
 * character is never valid JSON, so removing it is the smallest repair; any
 * other syntax error is left for the strict parser to reject.
 */
export function dropMismatchedJsonClosers(text: string): string {
  const stack: Array<"{" | "["> = [];
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      const top = stack[stack.length - 1];
      if ((ch === "}" && top === "{") || (ch === "]" && top === "[")) stack.pop();
      else continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Best-effort recovery of one JSON value from a chat model's answer: strict
 * JSON first, then the fence/prose-tolerant candidate parser, then the same
 * after removing mismatched closers (the web chat model wrote `}]} }},{` for
 * `}]}},{` on three consecutive executability reviews, live 2026-09-16).
 * Returns null when nothing parses; callers keep the exact raw text for their
 * ledgers and validate the recovered shape as they would a strict answer.
 */
export function recoverJsonValue<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // fall through to the tolerant parsers
  }
  const candidate = parseJsonCandidate<T>(raw);
  if (candidate !== null) return candidate;
  const repaired = dropMismatchedJsonClosers(stripMarkdownFence(raw));
  if (repaired === stripMarkdownFence(raw)) return null;
  return parseJsonCandidate<T>(repaired);
}

// ---------------------------------------------------------------------------
// Learner-facing voice rules
//
// The generated garden must read as a direct lesson on the topic, never as a
// commentary on the uploaded PDF. These lists are shared with the validation
// script (scripts/validate-breadboard-garden.ts keeps a mirrored copy).
// ---------------------------------------------------------------------------

/** Words that must never appear in learner-facing output (titles, prose, tags,
 * file names). */
export const LEARNER_BANNED_WORDS = ["textbook"] as const;

/** Source-commentary phrases that must not carry the teaching voice. They are
 * tolerated only inside tiny provenance captions. */
export const SOURCE_COMMENTARY_PHRASES = [
  "the paper says",
  "the paper argues",
  "the paper opens",
  "the paper frames",
  "the source frames",
  "the source argues",
  "the source material explains",
  "in this paper",
  "in the paper",
  "in the source's framing",
  "source-derived",
  "source-central",
  "according to the paper",
  "according to the source",
] as const;

/** Meta-instruction / placeholder language that means a page was not actually
 * written. Any of these in a learner page is a hard failure. Shared with the
 * validation script. */
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\buse the page\b/i,
  /\bstart with the idea itself\b/i,
  /\bname the starting idea\b/i,
  /\bwhat is the main idea to take away from\b/i,
  // "allows a field to be written as a gradient" is normal explanatory
  // prose. Only reject an actual unfinished-content marker, a location/time
  // marker, or a named content item that has been left for later writing.
  /\bto be written(?:\s+(?:here|later|below|above|soon|afterward)|\s*[:—-]|[.?!]\s*$)/im,
  /\b(?:answer|content|copy|details?|draft|example|explanation|lesson|page|paragraph|section|text)\s+(?:is|are|remains?)?\s*to be written\b/i,
  /\bplaceholder\b/i,
  /\bTODO\b/,
  /\blorem ipsum\b/i,
  /\b(?:use|from) the page \d+ and \d+ materials?\b/i,
  /\bthis (?:section|page) (?:will|should) (?:cover|explain|introduce)\b/i,
  // Scaffold verbs left in a half-written draft.
  /\binsert (?:explanation|the |your |text|content|details?|example|figure|analogy)\b/i,
  /\b(?:add|write|fill in) (?:the |your |an? )?(?:explanation|example|analogy|content|details?) here\b/i,
  /\bsource says\b/i,
  /\bexpand (?:on )?this (?:later|section|point)\b/i,
];

/** Annoying AI-style discourse patterns, especially teaching-by-negation.
 * Shared with the validation script. Prose should teach directly instead. */
export const AI_ISM_PATTERNS: RegExp[] = [
  /\bthe (?:first|second|third|next|final|last|main|big|key) (?:big )?idea is\b/i,
  /\bis not (?:a|just a|merely a|only a) (?:side |minor )?(?:detail|issue|point|feature)\b/i,
  /\bis not just\b/i,
  /\bthe point is not\b/i,
  /\bthis is not only\b.*\bbut also\b/i,
  /\bnot only\b.*\bbut also\b/i,
  /\bit(?:'s| is) important to note that\b/i,
  /\bit(?:'s| is) worth noting that\b/i,
  /\bthe important question is not (?:just|only)\b/i,
  /\bthis matters because\b/i,
  /\bthis highlights\b/i,
  /\bthis underscores\b/i,
  /\bthe key takeaway is\b/i,
  /\bin summary\b/i,
  /\bin conclusion\b/i,
  /\bat the end of the day\b/i,
  /\bwhen it comes to\b/i,
  // Contrastive-negation openers: teaching by saying what a thing is not.
  /\b(?:is|are|was|were)(?:n't| not) (?:about|simply|merely|really|solely|primarily) \b/i,
  /\b(?:isn't|aren't|wasn't) (?:just|about|merely|only) \b/i,
  // "far from the charge" is distance; only the rhetorical form is slop.
  /\bfar from (?:being|just|merely|simply)\b/i,
  /\bnot (?:merely|simply) (?:a|an|the)\b/i,
  /\brather than (?:being |simply |merely )?(?:a|an|the) \w+, /i,
  // Hedging and ceremony words that carry no meaning in a lesson.
  /\bmerely\b/i,
  /\bserves? as\b/i,
  /\bdelve(?:s|d)? (?:into|deeper)\b/i,
  /\bcrucial(?:ly)?\b/i,
  /\bplays? an? (?:crucial|key|vital|pivotal|central) role\b/i,
  /\b(?:simply|put) (?:put|simply),/i,
  /\bat its (?:core|heart)\b/i,
  /\bin essence\b/i,
  /\bthe beauty of\b/i,
  /\ba testament to\b/i,
  /\blet(?:'s| us) (?:dive|delve|unpack|explore)\b/i,
  /\bit(?:'s| is) tempting to (?:think|assume|believe)\b/i,
  /\breadily apparent\b/i,
  /\bit (?:should|must) be (?:noted|emphasized|stressed) that\b/i,
  /\bin the realm of\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bunlock(?:s|ing)? (?:the|a|new)\b/i,
];

/** Fingerprints of the deterministic emergency draft. That draft exists only
 * for debugging (.breadboard/debug/failed-pages/); any of these phrases in a
 * learner page means fallback prose leaked and the page must be rejected.
 * Shared with the validation script. */
export const FALLBACK_FINGERPRINTS: RegExp[] = [
  /The durable concept/i,
  /Relevant details:/i,
  /Read these details as a sequence/i,
  /When no figure is attached/i,
  /Minimal learner-facing fallback/i,
  /Introduce .* from uploaded sources/i,
  /This section is part of the confirmed Breadboard learning map/i,
  /The confirmed learning map did not provide enough local detail/i,
];

/** A web chat model's own voice leaking into a lesson: a first-person note
 * about how it read the pasted request ("I'm using the pasted run contract
 * directly...") or ChatGPT's document wrapper line `:::writing{...}`. Neither
 * is learner prose, so a page carrying one goes back to the model. */
export const CHAT_ASSISTANT_LEAK_PATTERNS: RegExp[] = [
  /^[ \t]*I(?:['’]ll| will|['’]m| am)\s+(?:going to\s+)?(?:treat|treating|use|using|produce|producing|write|writing|return|returning|keep|keeping|follow|following)\b[^\n]*\b(?:pasted|supplied|provided|dossier|contract|request|task specification|prompt|lesson-generation)\b[^\n]*$/gim,
  /^[ \t]*:::writing\{[^\n]*$/gim,
];

/** Lines of chat-assistant commentary or document wrappers in a page body. */
export function chatAssistantLeakMatches(markdown: string): string[] {
  const body = stripMarkdownFrontmatter(markdown).replace(/```[\s\S]*?```/g, " ");
  const found = new Set<string>();
  for (const pattern of CHAT_ASSISTANT_LEAK_PATTERNS) {
    for (const match of body.matchAll(pattern)) found.add(match[0].trim().slice(0, 240));
  }
  return [...found];
}

/** Source-commentary phrasing that must never carry the teaching voice of a
 * learner page. Tolerated only inside compact provenance captions (the italic
 * line under an embedded source figure), which are stripped before matching. */
export const SOURCE_COMMENTARY_PATTERNS: RegExp[] = [
  /\bthe paper\b/i,
  /\bthis paper\b/i,
  // `source` is also a domain term (a charge/current source, a signal source,
  // a light source, and so on). Reject it only when it is grammatically acting
  // as a document narrator. A bare-word rule falsely rejected instructions
  // such as "identify the source" in an electromagnetics lesson.
  /\bthe source(?:\s+material)?\s+(?:argues?|calls?|compares?|defines?|derives?|describes?|discusses?|emphasizes?|explains?|frames?|highlights?|introduces?|lists?|notes?|presents?|reports?|says?|shows?|states?)\b/i,
  /\bthe source(?:\s+material)?\s+(?:contain(?:s)?|include(?:s)?|provide(?:s)?)\s+(?:an?\s+)?(?:account|analysis|definition|derivation|description|discussion|evidence|example|explanation|illustration|overview|worked\s+(?:derivation|example))\b/i,
  /\bas\s+(?:is\s+)?(?:argued|defined|derived|described|discussed|emphasized|explained|highlighted|illustrated|noted|presented|reported|shown|stated)\s+(?:in|by)\s+the source(?:\s+material)?\b/i,
  /\bbased\s+on\s+the source(?:\s+material)?\b(?=\s*[,;:]|\s+(?:account|analysis|argument|definition|derivation|description|discussion|evidence|example|explanation|framing|presentation|treatment)\b)/i,
  /\bthe source['’]s\s+(?:account|analysis|argument|definition|derivation|description|discussion|example|explanation|framing|illustration|overview|presentation|treatment)\b/i,
  // A leading "In/From the source, ..." is document framing. Requiring a
  // sentence/list boundary and punctuation avoids physical relations such as
  // "the field from the source falls with distance".
  /(?:^|[.!?]\s+|^[ \t]*(?:[-*+]\s+|>\s*))((?:in|from)\s+the source(?:\s+material)?\b)(?=\s*[,;:]\s*(?:(?:an?|the|this|that)\s+(?:account|analysis|argument|definition|derivation|description|discussion|document|example|explanation|figure|illustration|paper|presentation|section|table|text|treatment|worked\s+(?:derivation|example))\b|(?:we|one)\s+(?:can\s+)?(?:find|infer|learn|read|see)\b|it\s+(?:is\s+)?(?:argued|defined|derived|described|discussed|explained|presented|reported|shown|stated)\b))/im,
  /\bthe uploaded source\b/i,
  /\bsource-derived\b/i,
  /\bsource-central\b/i,
  /\baccording to the source\b/i,
  /\bthe source material\b/i,
];

/** Bibliography/reference-list chunks ("[12] A. Author, \"Title\", ...") pasted
 * into a lesson as if they were teaching content. */
export const RAW_REFERENCE_DUMP_RE = /\[\d+\]\s+[A-Z][^"\n]+,\s*["“].+["”]/;

/** Learner prose with figure embeds and their compact provenance captions
 * removed, so caption-only phrasing is not judged as teaching voice. */
export function teachingProse(markdown: string): string {
  return stripMarkdownFrontmatter(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Compact provenance caption lines: "*caption text* *(p. 7)*" or "*caption*".
    .replace(/^\s*\*[^*\n]+\*(?:\s*\*\([^)\n]*\)\*)?\s*$/gm, " ");
}

/** True when the markdown contains fallback-draft fingerprints. */
export function hasFallbackFingerprint(markdown: string): boolean {
  return FALLBACK_FINGERPRINTS.some((pattern) => pattern.test(markdown));
}

export interface SourceCommentaryMatch {
  /** Exact bytes matched by the document-commentary rule. */
  matchedText: string;
  /** Exact learner-prose line containing the match, for model repair. */
  snippet: string;
}

interface IndexedSourceCommentaryMatch extends SourceCommentaryMatch {
  start: number;
  end: number;
}

/**
 * Find document-commentary phrasing in learner prose. Overlapping rules count
 * once, and every result carries the exact offending line so an AI repair call
 * can act on evidence instead of guessing from a count.
 */
export function sourceCommentaryMatches(markdown: string): SourceCommentaryMatch[] {
  const prose = teachingProse(markdown);
  const candidates: IndexedSourceCommentaryMatch[] = [];
  for (const pattern of SOURCE_COMMENTARY_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of prose.matchAll(global)) {
      const rawStart = match.index;
      if (rawStart === undefined || !match[0]) continue;
      // A rule may use its first capture to exclude a sentence/list boundary
      // from the reported match while still enforcing that boundary.
      const matchedText = match[1] || match[0];
      const captureOffset = match[1] ? match[0].lastIndexOf(match[1]) : 0;
      const start = rawStart + Math.max(0, captureOffset);
      const end = start + matchedText.length;
      const lineStart = prose.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const nextLineBreak = prose.indexOf("\n", end);
      const lineEnd = nextLineBreak === -1 ? prose.length : nextLineBreak;
      candidates.push({
        matchedText,
        snippet: prose.slice(lineStart, lineEnd).trim() || matchedText,
        start,
        end,
      });
    }
  }
  candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  const distinct: IndexedSourceCommentaryMatch[] = [];
  for (const candidate of candidates) {
    if (distinct.some((accepted) => candidate.start < accepted.end && candidate.end > accepted.start)) {
      continue;
    }
    distinct.push(candidate);
  }
  return distinct.map(({ matchedText, snippet }) => ({ matchedText, snippet }));
}

/** Count source-commentary phrases in the teaching prose (captions excluded). */
export function countSourceCommentary(markdown: string): number {
  return sourceCommentaryMatches(markdown).length;
}

function scrubSourceCommentaryLine(line: string): string {
  let next = line
    .replace(
      /\b(?:according to|based on)\s+(?:the|this|the uploaded)\s+(?:paper|source)(?:\s+material)?,?\s+/gi,
      "",
    )
    .replace(
      /\b(?:as|as shown|as described|as explained|as reported|as argued)\s+(?:in|by)\s+(?:the|this|the uploaded)\s+(?:paper|source)(?:\s+material)?,?\s*/gi,
      "",
    )
    .replace(
      /\bas\s+(?:the|this|the uploaded)\s+(?:paper|source)(?:\s+material)?\s+(?:explains|shows|argues|frames|notes|states|emphasizes|describes|presents|introduces|reports|compares),?\s+/gi,
      "",
    )
    .replace(/\b(?:in|from)\s+(?:the|this)\s+paper,?\s+/gi, "")
    .replace(/\b(?:in|from)\s+(?:the uploaded source|the source material),?\s+/gi, "")
    .replace(
      /\b(?:the|this)\s+(?:paper|source)(?:\s+material)?\s+(?:explains|shows|argues|frames|notes|states|emphasizes|describes|presents|introduces|reports|compares)\s+(?:that\s+)?/gi,
      "",
    )
    .replace(/\b(?:the|this)\s+paper['’]s\s+/gi, "the ")
    .replace(/\bthe source['’]s\s+/gi, "the ")
    .replace(/\bsource[- ]derived\b\s*/gi, "")
    .replace(/\bsource[- ]central\b\s*/gi, "central ")
    .replace(/\bthe source material\b/gi, "the available material")
    .replace(/\bthe uploaded source\b/gi, "the material")
    .replace(/\bthis paper\b/gi, "this topic")
    .replace(/\bthe paper\b/gi, "the topic");

  next = next.replace(/(^|[.!?]\s+|\n\s*)([a-z])/g, (_match, prefix: string, letter: string) =>
    prefix + letter.toUpperCase(),
  );
  return next;
}

/**
 * Repair document-commentary leaks in learner-facing prose without weakening
 * the hard quality gate. Code blocks, image lines, and compact provenance
 * captions are left alone; the final assessor still checks the resulting page.
 */
export function scrubSourceCommentaryProse(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let inCodeFence = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }
      if (inCodeFence) return line;
      if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) return line;
      if (/^\s*\*[^*\n]+\*(?:\s*\*\([^)\n]*\)\*)?\s*$/.test(line)) return line;
      return scrubSourceCommentaryLine(line);
    })
    .join("\n");
}

export interface PlaceholderTextMatch {
  /** Exact phrase that triggered the unfinished-prose detector. */
  matchedText: string;
  /** Exact Markdown line containing the phrase, for a focused model repair. */
  snippet: string;
}

interface IndexedPlaceholderTextMatch extends PlaceholderTextMatch {
  start: number;
  end: number;
}

/**
 * Find unfinished-prose markers while retaining the complete affected line.
 * The old boolean-only result made a model repair guess which sentence to
 * rewrite, and made operational failures impossible to diagnose after a
 * staging workspace was discarded.
 */
export function placeholderTextMatches(markdown: string): PlaceholderTextMatch[] {
  const candidates: IndexedPlaceholderTextMatch[] = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    for (const match of markdown.matchAll(global)) {
      const start = match.index;
      if (start === undefined || !match[0]) continue;
      const end = start + match[0].length;
      const lineStart = markdown.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const nextLineBreak = markdown.indexOf("\n", end);
      const lineEnd = nextLineBreak === -1 ? markdown.length : nextLineBreak;
      candidates.push({
        matchedText: match[0],
        snippet: markdown.slice(lineStart, lineEnd).trim() || match[0],
        start,
        end,
      });
    }
  }
  candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  const distinct: IndexedPlaceholderTextMatch[] = [];
  for (const candidate of candidates) {
    if (distinct.some((accepted) => accepted.start === candidate.start && accepted.end === candidate.end)) {
      continue;
    }
    distinct.push(candidate);
  }
  return distinct.map(({ matchedText, snippet }) => ({ matchedText, snippet }));
}

/** True when the markdown contains meta-instruction / placeholder language. */
export function hasPlaceholderText(markdown: string): boolean {
  return placeholderTextMatches(markdown).length > 0;
}

/**
 * Blank out the block regions of a page that are not markdown — fenced code and
 * display math — preserving line structure so line-oriented markdown checks
 * never read their contents as markdown.
 *
 * Display math is why this exists: a formula broken across lines puts the
 * operator on its own line (`E = a\n+\nb`), and a bare `+` or `-` line is valid
 * LaTeX, not a bullet. Inline math and inline code are deliberately left alone —
 * they cannot span lines, and blanking them would turn a real bullet like
 * `- $E = mc^2$` into an apparently empty one.
 */
export function blankNonProseBlocks(markdown: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return markdown
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/~~~[\s\S]*?~~~/g, blank)
    .replace(/\$\$[\s\S]*?\$\$/g, blank)
    .replace(/\\\[[\s\S]*?\\\]/g, blank)
    .replace(/\\begin\{([a-zA-Z]+\*?)\}[\s\S]*?\\end\{\1\}/g, blank);
}

/** A markdown thematic break (`---`, `***`, `___`) — a horizontal rule, not a bullet. */
const THEMATIC_BREAK_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
/** A bullet with nothing after it: `-`, `* `. */
const BARE_BULLET_RE = /^\s*[-*+]\s*$/;
/** A bullet whose only content is filler: `- ...`, `- …`, `- TBD`, `- N/A`, `- --`. */
const FILLER_BULLET_RE = /^\s*[-*+]\s+(?:\.{2,}|…|TBD|N\/A|-{2,})\s*$/i;

/** The empty/filler bullet scaffold lines on a page (`- `, `- ...`, `- TBD`) —
 * a sign a draft's outline was never filled in. Math and code are excluded, so
 * a lone `+` or `-` operator inside a formula is never mistaken for a bullet. */
export function emptyBulletScaffoldLines(markdown: string): string[] {
  const body = blankNonProseBlocks(stripMarkdownFrontmatter(markdown));
  const hits: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (THEMATIC_BREAK_RE.test(line)) continue;
    if (BARE_BULLET_RE.test(line) || FILLER_BULLET_RE.test(line)) hits.push(line.trim() || "-");
  }
  return hits;
}

/** True when the markdown carries two or more empty/filler bullet scaffolds. */
export function hasEmptyBulletScaffold(markdown: string): boolean {
  return emptyBulletScaffoldLines(markdown).length >= 2;
}

/** Count AI-style discourse patterns in prose. */
/** Every AI-ism hit, as the phrase itself, so a repair can be pointed at the
 * exact words instead of a count. */
export function aiismMatches(markdown: string): string[] {
  const hits: string[] = [];
  for (const pattern of AI_ISM_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of markdown.matchAll(global)) hits.push(match[0].replace(/\s+/g, " ").trim());
  }
  return hits;
}

export function countAiisms(markdown: string): number {
  return aiismMatches(markdown).length;
}

/** Deterministically delete the always-safe AI-ism openers (never rewrites
 * meaning — semantic negation framing is handled by the prompt + critic). */
export function scrubAiisms(markdown: string): string {
  return markdown
    .replace(/\bIt(?:'s| is) important to note that\s+/g, "")
    .replace(/\bIt(?:'s| is) worth noting that\s+/g, "")
    .replace(/\bThe (?:first|second|third|next|final) big idea is that\s+/g, "")
    .replace(/\bThe (?:first|second|third|next|final) idea is that\s+/g, "")
    .replace(/^\s*In summary,\s+/gim, "")
    .replace(/^\s*In conclusion,\s+/gim, "")
    // Fix any capitalization we broke by removing a sentence opener.
    .replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}

/** Count words in prose (ignoring code fences, image lines, and frontmatter). */
export function proseWordCount(markdown: string): number {
  const text = stripMarkdownFrontmatter(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#>*_`|-]+/g, " ");
  const words = text.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word));
  return words.length;
}

export interface QualityProblem {
  code: string;
  message: string;
  hard: boolean;
  /** The exact offending snippets, when the gate can point at them. Handed to
   * the repair call so it fixes the real lines instead of guessing. */
  evidence?: string[];
  /** The term, concept, or result the problem is about, when it has one. */
  subject?: string;
}

/** Serialize a quality failure for an AI repair request without discarding the
 * exact evidence located by the validator. */
export function formatQualityProblemForRepair(problem: QualityProblem): string {
  const summary = `${problem.code}: ${problem.message}`;
  return problem.evidence?.length
    ? `${summary}; offending text: ${problem.evidence.map((snippet) => JSON.stringify(snippet)).join(", ")}`
    : summary;
}

/** Minimum explanatory prose for a lesson; there is no maximum word count. */
/** Raised from 700 (2026-09-16) and again to 1400: lessons stopped at the
 * planner's estimate and read as a seven-minute summary; the writer prompt
 * carries no target and says depth, not length, decides when to stop. */
export const MIN_LESSON_WORDS = 1400;

/** A lesson may break into beats, but a beat per paragraph is the listicle the
 * original no-headings rule was written against. */
/** A subsection is one continuous lesson: no heading of any level inside
 * the body (2026-09-16, reader feedback on telecom-1 M2: "one subsection
 * should be continuous with no blocks or divisions"). */
export const MAX_LESSON_BEAT_HEADINGS = 0;

/** Heading lines inside the body, ignoring the page's own H1/H2 title and
 * anything inside a fenced code block. */
export function bodyBeatHeadings(body: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{3,6})\s+(\S.*)$/.exec(line);
    if (match) headings.push(match[2].trim());
  }
  return headings;
}

/** Pictographic characters in learner prose. Matched by Unicode property so no
 * emoji literal has to live in this source file. */
export function emojiMatches(body: string): string[] {
  return [...body.matchAll(/\p{Extended_Pictographic}/gu)].map((match) => match[0]);
}

/**
 * Local quality critic run before a lesson page is written. Every problem here
 * is a hard failure: a page that trips any of them is never written as learner
 * content — the pipeline retries and, if every attempt fails, fails the job
 * (quarantining the last draft under .breadboard/debug/failed-pages/).
 */
export function assessLessonQuality(
  body: string,
  options: {
    assignedVisualUrls?: string[];
    minWords?: number;
    /** Citations the syllabus assigns that this garden does not contain, paired
     * with a detector. A page naming one is teaching from material nobody
     * uploaded, which is a hard failure however fluent the prose is. */
    unavailableCitations?: {
      detect: (prose: string) => string[];
    };
  } = {},
): { ok: boolean; hardFail: boolean; problems: QualityProblem[] } {
  const problems: QualityProblem[] = [];
  const words = proseWordCount(body);
  const minWords = options.minWords ?? MIN_LESSON_WORDS;

  const placeholderMatches = placeholderTextMatches(body);
  if (placeholderMatches.length > 0) {
    problems.push({
      code: "placeholder",
      message: "contains placeholder / meta-instruction text",
      hard: true,
      evidence: [...new Set(placeholderMatches.map((match) => match.snippet))],
    });
  }
  const scaffoldLines = emptyBulletScaffoldLines(body);
  if (scaffoldLines.length >= 2) {
    problems.push({
      code: "empty-bullet-scaffold",
      message: "contains empty/placeholder bullet scaffolds",
      hard: true,
      evidence: scaffoldLines,
    });
  }
  if (hasFallbackFingerprint(body)) {
    problems.push({ code: "fallback-fingerprint", message: "contains fallback-template prose", hard: true });
  }
  const chatLeaks = chatAssistantLeakMatches(body);
  if (chatLeaks.length > 0) {
    problems.push({
      code: "chat-assistant-commentary",
      message: "contains the chat model's own commentary or document wrapper lines instead of lesson prose",
      hard: true,
      evidence: chatLeaks,
    });
  }
  const commentary = sourceCommentaryMatches(body);
  if (commentary.length > 0) {
    problems.push({
      code: "source-commentary",
      message: `${commentary.length} source-commentary phrase${commentary.length === 1 ? "" : "s"} in teaching prose`,
      hard: true,
      evidence: [...new Set(commentary.map((match) => match.snippet))],
    });
  }
  if (RAW_REFERENCE_DUMP_RE.test(body)) {
    problems.push({ code: "raw-reference-dump", message: "contains a bibliography/reference-list chunk", hard: true });
  }
  const fabricatedCitations = options.unavailableCitations?.detect(teachingProse(body)) ?? [];
  if (fabricatedCitations.length > 0) {
    problems.push({
      code: "unavailable-citation",
      message: `writes about ${fabricatedCitations.length} work${fabricatedCitations.length === 1 ? "" : "s"} the syllabus assigns but this garden does not contain`,
      hard: true,
      evidence: fabricatedCitations,
    });
  }
  const hasQuestion = /\*\*Question\.\*\*/.test(body) && /\*\*Answer\.\*\*/.test(body);
  if (!hasQuestion) {
    problems.push({ code: "no-qa", message: "missing a Question./Answer. pair", hard: true });
  }
  if (words < 120) {
    // Reject near-empty stubs separately from lessons below the prose minimum.
    problems.push({ code: "empty", message: `only ${words} words of prose`, hard: true });
  }
  for (const url of options.assignedVisualUrls ?? []) {
    if (!body.includes(url)) {
      problems.push({ code: "missing-visual", message: `assigned source visual not embedded (${url})`, hard: true });
    }
  }
  if (words >= 120 && words < minWords) {
    problems.push({ code: "short", message: `${words} words (< ${minWords})`, hard: true });
  }
  const aiisms = aiismMatches(body);
  if (aiisms.length > 2) {
    problems.push({
      code: "aiisms",
      message: `${aiisms.length} AI-style phrases (filler, ceremony, or contrastive-negation framing); state directly what the thing is or does`,
      hard: true,
      evidence: [...new Set(aiisms)],
    });
  }
  const hasExample = /\b(for example|for instance|imagine|consider|suppose|think of|picture|analogy|worked example)\b/i.test(body);
  if (!hasExample) {
    problems.push({ code: "no-example", message: "no concrete example / analogy cue", hard: true });
  }
  // Counted, not just requested: prompt guidance alone once produced 35
  // headings across 40 pages. A heading inside the body splits the subsection
  // into titled blocks, which the reader experience forbids.
  const beatHeadings = bodyBeatHeadings(body);
  if (beatHeadings.length > MAX_LESSON_BEAT_HEADINGS) {
    problems.push({
      code: "internal-heading",
      message: `${beatHeadings.length} heading line(s) inside the body; a subsection is one continuous lesson with the page title as its only heading — remove them and join the prose`,
      hard: true,
      evidence: beatHeadings,
    });
  }
  const emoji = emojiMatches(body);
  if (emoji.length > 0) {
    problems.push({
      code: "emoji",
      message: "learner prose contains emoji; emphasis uses bold terms and callouts only",
      hard: true,
      evidence: [...new Set(emoji)],
    });
  }

  const hardFail = problems.some((problem) => problem.hard);
  return { ok: problems.length === 0, hardFail, problems };
}

/** Debris/generic tags that are banned from learner-facing pages. */
export const ZETTEL_TAG_BANLIST = new Set([
  "paper", "source", "sources", "what", "model", "models", "test", "tests",
  "overview", "coverage", "visual", "visuals", "context", "contract", "scope",
  "abstract", "abstract-spiking", "accepted-october", "access-article",
  "garden", "note", "notes", "page", "pages", "section", "sections", "misc",
  "general", "document", "documents", "pdf", "file", "files", "upload",
  "uploads", "learning", "textbook", "introduction", "conclusion", "summary",
  "content", "material", "materials", "topic", "topics", "concept", "concepts",
  // Additional single-word debris and generic framing words.
  "idea", "ideas", "motivation", "against-figures", "input", "inputs", "output",
  "outputs", "potential", "energy", "accuracy", "continuous", "important",
  "example", "examples", "detail", "details", "point", "points", "thing",
  "things", "approach", "approaches", "method", "methods", "system", "systems",
  "figure", "figures", "table", "tables", "data", "value", "values", "result",
  "results", "comparison", "analysis", "study", "work", "field", "area",
]);

const TAG_ROOT_FIXES: Record<string, string> = {
  sn: "snn",
  dl: "deep-learning",
  ml: "machine-learning",
  nn: "neural-networks",
  cnn: "cnn",
};

/**
 * Concept → hierarchical tag lexicon. When a lesson body mentions one of these
 * durable concepts, legacy helpers emitted a clean tag seed, which is
 * far more reliable than namespacing whatever noisy words the planner produced.
 * Ordered longest/most-specific first. General enough to be harmless on other
 * domains (it only fires on literal keyword matches).
 */
/** Pull clean concept-handle tag seeds from the final lesson body. */
export function extractTagSeeds(body: string): string[] {
  return semanticConceptTagsFromText(body, 8, body);
}

/**
 * A title that lists three or more topics ("Work, Potential, Energy, and
 * Current") is a table of contents standing where one teaching step should
 * be. It is the visible symptom of a unit that skims several ideas, so the
 * planner is sent back to split it rather than the title being trimmed.
 */
export function topicListTitleProblem(title: string): string | null {
  const clean = title.trim().replace(/^\d+(?:\.\d+)*\.?\s*/, "");
  const parts = clean.split(/\s*,\s*/).filter(Boolean);
  if (parts.length < 3) return null;
  // A sentence-shaped title can carry commas without being a list.
  if (/^(?:how|why|what|when|where|from|choosing|comparing|measuring|reading)\b/i.test(clean)) return null;
  return `title lists ${parts.length} topics instead of naming one teaching step: "${clean}"; split it into the units it hides, each with its own learning question`;
}

/** Rewrites a planned section/subsection title that frames itself as paper
 * commentary into a standalone lesson title. Deterministic backstop behind the
 * prompt rules; unknown patterns fall through with commentary suffixes/prefixes
 * stripped. */
export function sanitizeLearnerTitle(rawTitle: string): string {
  let title = compact(rawTitle);
  if (!title) return title;

  const structural: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    // "Why the Source Turns from X to Y" -> "From X to Y"
    [/^why (?:the )?(?:source|paper) turns? from (.+) to (.+)$/i, (m) => `From ${m[1]} to ${m[2]}`],
    // "What X Are/Is in This Paper" -> "What X Are/Is"
    [/^(.*?)\s+in (?:this|the) (?:paper|source)$/i, (m) => m[1]],
    // "How the Paper Organizes X" -> "X"
    [/^how (?:the )?(?:source|paper) (?:organizes|presents|structures|frames|introduces|surveys)\s+(.+)$/i, (m) => m[1]],
    // "The Paper's Core Contribution X" -> "X"
    [/^the (?:source|paper)['’]?s? (?:core contribution|main claim|central idea|framing|argument):?\s+(.+)$/i, (m) => m[1]],
    // "Source-Derived X" / "Source-Central X" -> "X"
    [/^source[- ](?:derived|central|anchored|based)\s+(.+)$/i, (m) => m[1]],
    // "X as Source-Central Evidence" -> "X"
    [/^(.*?)\s+as source[- ](?:derived|central|anchored)(?:\s+evidence)?$/i, (m) => m[1]],
    // "X as Evidence" / "X as the Evidence" -> "X" (source-commentary residue)
    [/^(.*?)\s+as (?:the )?evidence$/i, (m) => m[1]],
  ];
  for (const [pattern, rewrite] of structural) {
    const match = title.match(pattern);
    if (match) {
      title = compact(rewrite(match));
      break;
    }
  }

  // Residual scrubs that stay grammatical when removed.
  title = title
    .replace(/^the named\s+/i, "")
    .replace(/\bsource[- ](?:derived|central|anchored)\b\s*/gi, "")
    .replace(/\s*\b(?:in|from|of|per) (?:this|the) (?:paper|source)\b/gi, "")
    .replace(/\s*[-:–—]?\s*overview$/i, "")
    .replace(/\be-?textbook\b/gi, "learning garden")
    .replace(/\btextbook\b/gi, "learning garden");

  // "Evidence" is a banned learner-title word (it frames the page as reading a
  // document instead of teaching the concept). Rewrite to "results", keeping
  // verb agreement ("the evidence shows" -> "the results show") and the
  // original casing style.
  const matchCase = (match: string, replacement: string): string =>
    /^[A-Z]/.test(match)
      ? replacement.replace(/(^|\s)([a-z])/g, (_m, space, letter) => `${space}${letter.toUpperCase()}`)
      : replacement;
  title = title
    .replace(/\bevidence (shows|suggests|says|tells)\b/gi, (m, verb: string) =>
      matchCase(m, `results ${verb.replace(/s$/, "")}`),
    )
    .replace(/\bevidence\b/gi, (m) => matchCase(m, "results"));
  const pluralVerbFixes: Record<string, string> = {
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
  title = title.replace(
    /\b([A-Z]{2,}s|[A-Z][a-z]+s)\s+(Fits|Learns|Uses|Works|Does|Has|Is|Explains|Measures)\b/g,
    (_match, subject: string, verb: string) => `${subject} ${pluralVerbFixes[verb] ?? verb}`,
  );
  title = title.replace(
    /\bWhere\s+([A-Z]{2,}s|[A-Z][a-z]+s)\s+Fit\s+and\s+What\s+Still\s+Blocks\s+It\b/g,
    "Where $1 Fit and What Still Blocks Adoption",
  );
  title = compact(title.replace(/^[,:;\-\s]+|[,:;\-\s]+$/g, ""));
  return title || compact(rawTitle);
}

/** Safe deterministic scrub for learner-facing prose. Never rewrites sentence
 * structure — that is the prompts' job — but the banned word "textbook" has an
 * always-safe replacement. */
export function scrubLearnerProse(markdown: string): string {
  return markdown
    .replace(/\be-?textbook(s)?\b/gi, "learning garden$1")
    .replace(/\bTextbook(s)?\b/g, "Learning garden$1")
    .replace(/\btextbook(s)?\b/g, "learning garden$1");
}

function zettelSegmentSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const TAG_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "how",
  "why", "what", "is", "are", "why", "over", "across", "into", "from", "this",
]);

/** Short, stable namespace for the domain (e.g. "Spiking Neural Networks" ->
 * "snn"). Long multi-word domains become an acronym so tags stay compact. */
function domainNamespace(domainHint: string): string {
  const slug = zettelSegmentSlug(domainHint);
  if (!slug) return "topic";
  const words = slug.split("-").filter((word) => word.length > 1 && !TAG_STOPWORDS.has(word));
  if (slug.length > 16 && words.length >= 2 && words.length <= 4) {
    return words.map((word) => word[0]).join("");
  }
  return TAG_ROOT_FIXES[words[0] ?? slug] ?? words[0] ?? slug;
}

const LEARNER_TAG_NAMESPACE_BY_LEAF: Record<string, string> = {
  "accuracy": "metric/classification-accuracy",
  "ann-to-snn-conversion": "conversion/activation-to-spike-rate",
  "backpropagation": "training/backpropagation-through-continuous-activations",
  "convergence": "metric/convergence-time-target-epoch",
  "continuous-activation": "neural-networks/continuous-activation-values",
  "dense-computation": "neural-networks/synchronous-dense-updates",
  "energy-efficiency": "metric/accuracy-per-energy",
  "event-driven-computation": "snn/event-driven-sparsity",
  "event-driven-processing": "snn/event-driven-sparsity",
  "hardware-constraints": "deployment/reproducibility-and-hardware-standardization",
  "lif-neuron": "snn/lif-neuron-threshold-reset",
  "membrane-potential": "computational-neuroscience/membrane-potential-accumulation",
  "neuromorphic-computing": "hardware/event-driven-neuromorphic-execution",
  "non-differentiable-spikes": "training/surrogate-gradient-for-discrete-spikes",
  "rate-coding": "snn/spike-rate-coding",
  "refractory-period": "snn/refractory-reset-window",
  "reset-dynamics": "snn/reset-after-threshold-spike",
  "spike-coding": "snn/spike-timing-as-information",
  "spike-count": "metric/total-spike-count",
  "spike-threshold": "snn/threshold-firing-event",
  "spike-timing": "snn/spike-timing-as-information",
  "spiking-neural-network": "snn/event-driven-spiking-computation",
  "spiking-neural-networks": "snn/event-driven-spiking-computation",
  "stdp": "training/stdp-local-timing-rule",
  "surrogate-gradient": "training/surrogate-gradient-for-discrete-spikes",
  "surrogate-gradient-training": "training/surrogate-gradient-for-discrete-spikes",
  "synchronous-computation": "neural-networks/synchronous-dense-updates",
  "synaptic-plasticity": "training/stdp-local-timing-rule",
  "temporal-coding": "snn/spike-timing-as-information",
  "threshold-firing": "snn/threshold-firing-event",
};

function namespaceLearnerTag(tag: string, domainHint: string): string | null {
  const normalized = tag.replace(/^#+/, "").toLowerCase();
  const leaf = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
  const exact = LEARNER_TAG_NAMESPACE_BY_LEAF[leaf] ?? LEARNER_TAG_NAMESPACE_BY_LEAF[normalized];
  if (exact) return exact;
  if (normalized.includes("/")) return normalized;

  const words = leaf.split("-").filter((word) => word.length > 2 && !TAG_STOPWORDS.has(word));
  if (words.length < 2) return null;
  return `${domainNamespace(domainHint)}/${leaf}`;
}

/** What a tag must be checked against before it lands on a page: the page's
 * own title, section title, final accepted body, and the captions of the
 * source visuals actually embedded there. */
export interface TagRelevanceContext {
  title: string;
  sectionTitle?: string;
  body: string;
  assignedVisualCaptions?: string[];
}

interface TagRelevanceRule {
  appliesTo: RegExp; // matched against the full tag
  evidence: RegExp; // must appear in title/body/captions
  /** Body-only matches must occur at least this many times ("taught, not
   * mentioned"); a title or caption match always counts. */
  minBodyMentions?: number;
}

/** Concept-specific gates: a tag naming one of these concepts may only appear
 * on a page that actually teaches it. */
const TAG_RELEVANCE_RULES: TagRelevanceRule[] = [
  { appliesTo: /\blif\b|lif-neuron|leaky/i, evidence: /\blif\b|leaky[- ]integrate|membrane potential|(?:firing )?threshold/i },
  { appliesTo: /stdp/i, evidence: /\bstdp\b|spike[- ]?timing|synaptic plasticity|pre[- ]before[- ]post|post[- ]before[- ]pre/i },
  { appliesTo: /surrogate/i, evidence: /surrogate gradient/i },
  { appliesTo: /conversion/i, evidence: /\bann[- ]to[- ]snn\b|\bann to snn\b|\bconversion\b|firing[- ]rate approximation/i },
  { appliesTo: /\blatency\b/i, evidence: /\blatency\b|\bresponse time\b/i, minBodyMentions: 2 },
  { appliesTo: /convergence/i, evidence: /\bconverg\w*\b|\btraining loss\b|\bepochs?\b/i, minBodyMentions: 2 },
  { appliesTo: /spike-count/i, evidence: /\bspike count\b/i, minBodyMentions: 2 },
  { appliesTo: /membrane-potential/i, evidence: /\bmembrane potential\b/i },
  { appliesTo: /threshold/i, evidence: /\bthreshold\b/i },
  { appliesTo: /backpropagation/i, evidence: /\bbackprop\w*\b/i },
];

function countMatches(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return (text.match(global) ?? []).length;
}

/**
 * Page-specific tag gate: true when the page's title, body, or embedded visual
 * captions actually support the tag. Concept-specific rules (LIF, STDP,
 * surrogate gradients, conversion, latency, convergence, ...) demand their own
 * evidence; every other tag must have each meaningful leaf word present
 * somewhere on the page. Tags must never be generated from generic scaffolding
 * text — pass the final accepted body only.
 */
export function tagIsRelevantToPage(tag: string, context: TagRelevanceContext): boolean {
  const titleText = [context.title, context.sectionTitle ?? ""].join("\n");
  const captionText = (context.assignedVisualCaptions ?? []).join("\n");
  const bodyText = teachingProse(context.body);
  const haystack = [titleText, captionText, bodyText].join("\n").toLowerCase();

  for (const rule of TAG_RELEVANCE_RULES) {
    if (!rule.appliesTo.test(tag)) continue;
    if (rule.evidence.test(titleText) || rule.evidence.test(captionText)) return true;
    const mentions = countMatches(bodyText, rule.evidence);
    return mentions >= (rule.minBodyMentions ?? 1);
  }

  // Generic gate: every meaningful word of the leaf segment must appear on the
  // page (prefix match, so "computation" covers "computational").
  const leaf = tag.split("/").at(-1) ?? tag;
  const words = leaf
    .split("-")
    .filter((word) => word.length >= 4 && !TAG_STOPWORDS.has(word));
  if (words.length === 0) return true;
  return words.every((word) => {
    const stem = word.slice(0, Math.max(4, word.length - 2));
    return haystack.includes(stem);
  });
}

/**
 * Normalizes learner-page tags into at most five reusable public concepts.
 * Tags are graph vocabulary, not page decoration: compact kebab-case concepts
 * that future notes can reuse. They are grounded in the final page body, not
 * the title alone, and unsupported concept tags are rejected.
 */
export function normalizeZettelTags(
  rawTags: string[],
  topicHint: string,
  domainHint: string,
  relevance?: TagRelevanceContext,
): string[] {
  const grounding = [
    topicHint,
    domainHint,
    relevance?.title ?? "",
    relevance?.sectionTitle ?? "",
    relevance?.body ?? "",
    ...(relevance?.assignedVisualCaptions ?? []),
  ].join("\n");
  const normalized = normalizeConceptTags(rawTags, grounding, 8, grounding, {
    title: relevance?.title ?? topicHint,
    content: grounding,
    sourceTopics: [domainHint],
  });
  const fallback = normalizeConceptTags(
    [...normalized, ...semanticConceptTagsFromText(grounding, 8, grounding)],
    grounding,
    8,
    grounding,
    {
      title: relevance?.title ?? topicHint,
      content: grounding,
      existingTags: normalized,
      sourceTopics: [domainHint],
    },
  );

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [...rawTags, ...normalized, ...fallback, ...semanticConceptTagsFromText(grounding, 8, grounding)]) {
    const leaf = candidate.split("/").filter(Boolean).at(-1) ?? candidate;
    const handle = atomicZettelHandle(leaf);
    if (!handle || seen.has(handle) || !isAtomicZettelHandle(handle)) continue;
    if (relevance && !tagIsRelevantToPage(handle, relevance)) continue;
    seen.add(handle);
    out.push(handle);
    if (out.length >= 8) break;
  }
  return out;
}

/** Stored full-page snapshot assets look like "...-page-003.png". */
const FULL_PAGE_SNAPSHOT_RE = /-page-\d{1,5}(?:-\d+)?\.(?:png|jpe?g|webp)$/i;

/**
 * A source is "visual-rich" when it has stored full-page snapshots AND its text
 * references figures/tables/graphs. For such a source, an empty extraction is a
 * pipeline failure, not an acceptable "no figures" outcome — the caller hard
 * fails rather than writing learner pages with no source figures.
 */
export function sourceAppearsVisualRich(source: {
  body?: string;
  sourceImages?: string[];
}): boolean {
  const body = source.body ?? "";
  const hasPageImages = (source.sourceImages ?? []).some((url) => FULL_PAGE_SNAPSHOT_RE.test(url));
  const mentionsFigures =
    /\b(?:Fig\.|Figure|Table)\s*\d+/i.test(body) ||
    /\b(?:graph|chart|diagram|architecture|curve|comparison)\b/i.test(body);
  return hasPageImages && mentionsFigures;
}

type SourceVisualCoverageRecord = {
  sourceId?: string;
  type?: string;
};

const DECLARED_SOURCE_VISUAL_CAPTION_RE =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:[*_]{0,2})?(Fig(?:ure)?\.?|Table)\s+(\d+)[a-z]?\s*(?=[:.\-–—])/gim;

function declaredSourceVisualCaptionCounts(
  body: string,
  allowedPageNumbers?: ReadonlySet<number>,
): { figures: number; tables: number } {
  const figures = new Set<string>();
  const tables = new Set<string>();
  const countCaptions = (pageBody: string) => {
    for (const match of pageBody.matchAll(DECLARED_SOURCE_VISUAL_CAPTION_RE)) {
      const kind = (match[1] ?? "").toLowerCase();
      const number = match[2] ?? "";
      if (!number) continue;
      (kind.startsWith("table") ? tables : figures).add(number);
    }
  };

  if (!allowedPageNumbers) {
    countCaptions(body);
    return { figures: figures.size, tables: tables.size };
  }

  // PDF ingestion keeps a small eager page-snapshot set while the OCR/Markdown
  // body may contain the complete document. Only compare declarations from
  // pages that were actually supplied to the detector; otherwise a long book
  // is incorrectly reported as having an incomplete visual registry after a
  // valid partial scan.
  const pageBlockRe = /(?:^|\n)## Page\s+(\d+)\s*([\s\S]*?)(?=(?:^|\n)## Page\s+\d+\b|$)/g;
  for (const match of body.matchAll(pageBlockRe)) {
    const pageNumber = Number.parseInt(match[1] ?? "", 10);
    if (Number.isSafeInteger(pageNumber) && allowedPageNumbers.has(pageNumber)) {
      countCaptions(match[2] ?? "");
    }
  }
  return { figures: figures.size, tables: tables.size };
}

function sourcePageNumbersFromImageUrls(sourceImages: readonly string[]): Set<number> {
  const pageNumbers = new Set<number>();
  for (const imageUrl of sourceImages) {
    const match = imageUrl.match(/-page-(\d{1,5})(?:-\d+)?\.(?:png|jpe?g|webp)$/i);
    const pageNumber = Number.parseInt(match?.[1] ?? "", 10);
    if (Number.isSafeInteger(pageNumber) && pageNumber > 0) pageNumbers.add(pageNumber);
  }
  return pageNumbers;
}

/**
 * Validate extraction per selected source rather than across the source set.
 * Numbered caption declarations provide an independent deterministic lower
 * bound, so a detector that returns one of several declared figures cannot
 * silently satisfy completeness.
 */
export function sourceVisualInventoryCoverageProblems(
  sources: ReadonlyArray<{ slug: string; body?: string; sourceImages?: string[] }>,
  visuals: readonly SourceVisualCoverageRecord[],
  scannedPageImageUrlsBySource?: ReadonlyMap<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  for (const source of sources) {
    if (!sourceAppearsVisualRich(source)) continue;
    const scannedPageImageUrls = scannedPageImageUrlsBySource?.get(source.slug);
    const scannedPageNumbers = scannedPageImageUrls
      ? sourcePageNumbersFromImageUrls(scannedPageImageUrls)
      : undefined;
    const scopedToScannedPages = Boolean(scannedPageImageUrls);
    const declared = declaredSourceVisualCaptionCounts(source.body ?? "", scannedPageNumbers);
    // With page-scoped validation, no declaration on the supplied pages means
    // there is no deterministic completeness claim to enforce for this scan.
    // The full OCR body can legitimately mention visuals that live on pages
    // not included in the eager snapshot set.
    if (scopedToScannedPages && declared.figures === 0 && declared.tables === 0) continue;
    const registered = visuals.filter(
      (visual) => visual.sourceId === source.slug && visual.type !== "full_page_fallback",
    );
    if (registered.length === 0) {
      problems.push(`visual-rich source "${source.slug}" produced no registered figures, tables, graphs, diagrams, or formulas`);
      continue;
    }
    const registeredFigures = registered.filter((visual) =>
      visual.type === "figure" || visual.type === "graph" || visual.type === "diagram"
    ).length;
    const registeredTables = registered.filter((visual) => visual.type === "table").length;
    if (declared.figures > registeredFigures) {
      problems.push(
        `visual-rich source "${source.slug}" declares ${declared.figures} figure captions but only registered ${registeredFigures} figure-like artifacts`,
      );
    }
    if (declared.tables > registeredTables) {
      problems.push(
        `visual-rich source "${source.slug}" declares ${declared.tables} table captions but only registered ${registeredTables} tables`,
      );
    }
  }
  return [...new Set(problems)];
}

export function sourceSetHashForSources(sources: LearnSourceSummary[]): string {
  const stable = sources
    .map((source) => ({
      slug: source.slug,
      relPath: source.relPath,
      title: source.title,
      description: source.description ?? "",
      sourceFile: source.sourceFile ?? "",
      date: source.date ?? "",
      wordCount: source.wordCount ?? 0,
      bodyHash: createHash("sha256").update(source.body ?? "").digest("hex"),
    }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function safeLearnFileSegment(value: string, fallback = "Section"): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "");
  return (cleaned || fallback).slice(0, 96).trim() || fallback;
}

export function textbookSectionFolder(sectionNumber: number, title: string): string {
  return `${sectionNumber}. ${safeLearnFileSegment(title, "Section")}`;
}

export function textbookPageFileName(
  sectionNumber: number,
  subsectionNumber: number,
  title: string,
): string {
  return `${sectionNumber}.${subsectionNumber} ${safeLearnFileSegment(title, "Subsection")}.md`;
}

export function wikilinkForRelPath(relPath: string, label: string): string {
  const target = relPath.replace(/\\/g, "/").replace(/\.md$/i, "");
  return `[[${target}|${label}]]`;
}

// ---------------------------------------------------------------------------
// Wikilink canonicalization
//
// LLM-authored planning pages (Topic Overview, section intros) tend to emit
// loose Obsidian links against section/subsection *titles* — e.g.
// `[[Why Spiking Neural Networks Exist]]` or
// `[[Why Spiking Neural Networks Exist#Surrogate Gradient Descent]]`. Those do
// not resolve: the real files live under numbered folders
// (`learning/1. Why Spiking Neural Networks Exist/_index.md`) and each
// subsection is its own file, not a heading. This canonicalizer rewrites every
// resolvable loose link to the exact on-disk vault-root path the pipeline
// writes, using the SAME folder/file naming as renderLearningIndexMarkdown and
// the generation loop. Anything it cannot resolve is reported so navigation is
// never silently broken.
// ---------------------------------------------------------------------------

const LEARNING_ROOT = "learning";

const LINK_SLUG_COMBINING_MARKS = /[\u0300-\u036f]/g;
// Language models commonly make prose-title slugs by *eliding* a possessive
// apostrophe (`Maxwell's` -> `maxwells`), while the older resolver treated it
// as a word separator (`maxwell-s`). Accept both forms during link resolution.
const LINK_SLUG_ELIDABLE_APOSTROPHES = /['\u2018\u2019\u02bb\u02bc\uff07"]/g;

function normalizedLinkSlug(value: string, elideApostrophes: boolean): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(LINK_SLUG_COMBINING_MARKS, "");
  return (elideApostrophes ? normalized.replace(LINK_SLUG_ELIDABLE_APOSTROPHES, "") : normalized)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function linkSlug(value: string): string {
  return normalizedLinkSlug(value, true);
}

/**
 * Accept both conventional possessive elision (`maxwells`) and the legacy
 * separator form (`maxwell-s`). Keeping the latter avoids breaking links
 * emitted before canonical possessive slugging was introduced.
 */
function linkSlugAliases(value: string): Set<string> {
  return new Set([
    linkSlug(value),
    normalizedLinkSlug(value, false),
  ].filter(Boolean));
}

interface LinkTargetEntry {
  kind: "section" | "subsection" | "page";
  /** Canonical vault-root target, no `.md`. */
  target: string;
  /** Display label to use when the source link had no explicit `|label`. */
  label: string;
  /** Slug of the (sanitized + raw) title, for loose matching. */
  slugs: Set<string>;
  /** For subsections: accepted parent-section aliases, for `[[Section#Sub]]` disambiguation. */
  sectionSlugs?: Set<string>;
  /** For subsections: the `N.M` numeric label. */
  numberLabel?: string;
}

/** Build the resolver entries for a confirmed learning map, mirroring exactly
 * the folder/file naming used when the pages are written to disk. */
export function buildLearningLinkTargets(
  map: ProposedLearningMap,
): LinkTargetEntry[] {
  const entries: LinkTargetEntry[] = [
    {
      kind: "page",
      target: `${LEARNING_ROOT}/Topic Overview`,
      label: "Topic Overview",
      slugs: linkSlugAliases("Topic Overview"),
    },
    {
      kind: "page",
      target: `${LEARNING_ROOT}/Learning Map`,
      label: "Learning Map",
      slugs: linkSlugAliases("Learning Map"),
    },
  ];
  map.sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    const sectionTitle = sanitizeLearnerTitle(section.title);
    const folder = `${LEARNING_ROOT}/${textbookSectionFolder(sectionNumber, sectionTitle)}`;
    const sectionSlugs = new Set([
      ...linkSlugAliases(sectionTitle),
      ...linkSlugAliases(section.title),
      ...linkSlugAliases(`${sectionNumber}. ${sectionTitle}`),
    ]);
    entries.push({
      kind: "section",
      target: `${folder}/_index`,
      label: sectionTitle,
      slugs: sectionSlugs,
      sectionSlugs,
    });
    section.subsections.forEach((subsection, subsectionIndex) => {
      const subsectionNumber = subsectionIndex + 1;
      const subsectionTitle = sanitizeLearnerTitle(subsection.title);
      const fileName = textbookPageFileName(sectionNumber, subsectionNumber, subsectionTitle);
      const numberLabel = `${sectionNumber}.${subsectionNumber}`;
      entries.push({
        kind: "subsection",
        target: `${folder}/${fileName.replace(/\.md$/i, "")}`,
        label: subsectionTitle,
        slugs: new Set([
          ...linkSlugAliases(subsectionTitle),
          ...linkSlugAliases(subsection.title),
          ...linkSlugAliases(`${numberLabel} ${subsectionTitle}`),
        ]),
        sectionSlugs,
        numberLabel,
      });
    });
  });
  return entries;
}

export interface WikilinkCanonicalizationResult {
  markdown: string;
  /** Loose link targets that could not be resolved (stripped to plain text). */
  unresolved: string[];
  /** Count of loose links rewritten to canonical paths. */
  rewritten: number;
}

const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;

/**
 * Rewrite loose title-based wikilinks in learner-facing markdown to the
 * canonical on-disk paths of the confirmed learning map. Links that already
 * carry a `/` (canonical paths) and links to non-map targets are left as-is.
 * Loose links that cannot be resolved are downgraded to plain text and
 * reported in `unresolved` so the caller can fail validation rather than ship
 * broken navigation.
 */
export function canonicalizeLearnerWikilinks(
  markdown: string,
  map: ProposedLearningMap,
): WikilinkCanonicalizationResult {
  const entries = buildLearningLinkTargets(map);
  const bySlug = new Map<string, LinkTargetEntry[]>();
  for (const entry of entries) {
    for (const slug of entry.slugs) {
      if (!slug) continue;
      const list = bySlug.get(slug) ?? [];
      list.push(entry);
      bySlug.set(slug, list);
    }
  }

  const unresolved: string[] = [];
  let rewritten = 0;

  const out = markdown.replace(WIKILINK_RE, (whole, inner: string) => {
    const pipeIndex = inner.indexOf("|");
    const rawTarget = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim();
    const explicitLabel = pipeIndex >= 0 ? inner.slice(pipeIndex + 1).trim() : "";

    // Already a path (canonical or intentionally cross-note) — leave untouched.
    if (rawTarget.includes("/")) return whole;

    const hashIndex = rawTarget.indexOf("#");
    const base = (hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget).trim();
    const fragment = hashIndex >= 0 ? rawTarget.slice(hashIndex + 1).trim() : "";

    const baseSlug = linkSlug(base);
    const fragmentSlug = linkSlug(fragment);

    const pickSubsection = (slug: string, sectionSlug?: string): LinkTargetEntry | undefined => {
      const candidates = (bySlug.get(slug) ?? []).filter((entry) => entry.kind === "subsection");
      if (candidates.length === 0) return undefined;
      if (sectionSlug) {
        const scoped = candidates.find((entry) => entry.sectionSlugs?.has(sectionSlug));
        if (scoped) return scoped;
      }
      return candidates[0];
    };

    let resolved: LinkTargetEntry | undefined;
    if (fragment) {
      // `[[Section#Subsection]]` — the fragment is the real lesson target.
      resolved =
        pickSubsection(fragmentSlug, baseSlug) ??
        (bySlug.get(fragmentSlug) ?? []).find((entry) => entry.kind === "subsection");
    }
    if (!resolved) {
      // Bare `[[Subsection]]` first (more specific), then `[[Section]]`.
      resolved =
        pickSubsection(baseSlug) ??
        (bySlug.get(baseSlug) ?? []).find((entry) => entry.kind === "section" || entry.kind === "page");
    }

    if (!resolved) {
      unresolved.push(rawTarget);
      // Never ship a broken link: fall back to the readable label as plain text.
      return explicitLabel || fragment || base || rawTarget;
    }

    rewritten += 1;
    const label = explicitLabel || resolved.label;
    return `[[${resolved.target}|${label}]]`;
  });

  return { markdown: out, unresolved, rewritten };
}

function yamlScalar(value: string | number | boolean): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value.replace(/\r/g, ""));
}

export function yamlFrontmatter(values: Record<string, FrontmatterValue>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (value.every((item) => typeof item === "string")) {
        lines.push(`${key}: [${value.map((item) => yamlScalar(item as string)).join(", ")}]`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const entries = Object.entries(item).filter(([, nested]) => nested !== undefined && nested !== null);
          if (entries.length === 0) continue;
          const [firstKey, firstValue] = entries[0];
          if (Array.isArray(firstValue)) {
            lines.push(`  - ${firstKey}: [${firstValue.map((nested) => yamlScalar(nested)).join(", ")}]`);
          } else {
            lines.push(`  - ${firstKey}: ${yamlScalar(firstValue as FrontmatterScalar)}`);
          }
          for (const [nestedKey, nestedValue] of entries.slice(1)) {
            if (Array.isArray(nestedValue)) {
              lines.push(`    ${nestedKey}: [${nestedValue.map((nested) => yamlScalar(nested)).join(", ")}]`);
            } else {
              lines.push(`    ${nestedKey}: ${yamlScalar(nestedValue as FrontmatterScalar)}`);
            }
          }
        }
      }
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  return `---\n${lines.join("\n")}\n---\n\n`;
}

/** Version ids are generated as learning_*; legacy textbook_* ids from older
 * jobs/DB rows are sanitized before they can reach visible Markdown. */
export function publicLearningVersionId(id: string): string {
  return id.replace(/^textbook_/i, "learning_");
}

/** How a page is told to open. Two per-page rules — "open with the simplest
 * concrete situation" and "the first paragraph must connect to prior ideas" —
 * jointly specify a single template, and no per-page rule can see that every
 * other page is using it too. Assigning the move from the unit's own shape
 * varies the openings deterministically, without a second model pass and
 * without asking a writer that sees one page at a time to "be varied". */
export type OpeningMove =
  | "cold_open"
  | "continuation"
  | "problem_first"
  | "contrast"
  | "concrete_instance";

export const OPENING_MOVE_BRIEFS: Readonly<Record<OpeningMove, string>> = {
  cold_open:
    "Open cold on a concrete situation, object, or observation. Do not refer back to earlier pages at all; this page starts something the learner has no running thread for.",
  continuation:
    "Open by picking up the specific idea the previous page established, then turn to what it does not yet handle. Name the idea itself rather than announcing that the learner already knows it.",
  problem_first:
    "Open with the difficulty, question, or failure this page resolves, stated concretely enough to feel like a real obstacle, before naming any method that addresses it.",
  contrast:
    "Open on a case where the approach established so far gives an incomplete, awkward, or wrong answer, and let that gap create the need for what follows.",
  concrete_instance:
    "Open on one specific instance — particular numbers, a particular geometry, a particular arrangement — and generalize only after the instance is worked or understood.",
};

/** Pick an opening move from the unit's own properties, then break runs so no
 * two consecutive pages open the same way. Derived from the unit rather than
 * rotated blindly: a page that genuinely starts a section opens cold, and a
 * worked example genuinely does start from an instance. `previousMove` is the
 * move assigned to the page immediately before this one, if any. */
export function assignedOpeningMove(input: {
  role?: LearningUnitRole;
  isFirstInSection: boolean;
  isFirstOverall: boolean;
  prerequisiteConcepts?: string[];
  previousMove?: OpeningMove;
}): OpeningMove {
  const natural = ((): OpeningMove => {
    if (input.isFirstOverall) return "cold_open";
    if (input.isFirstInSection) return "problem_first";
    if ((input.prerequisiteConcepts ?? []).length === 0) return "cold_open";
    switch (input.role) {
      case "worked_example":
      case "formula":
      case "metric":
        return "concrete_instance";
      case "limitation":
      case "comparison":
        return "contrast";
      case "motivation":
      case "application":
        return "problem_first";
      default:
        return "continuation";
    }
  })();
  if (natural !== input.previousMove) return natural;
  // A run of same-shaped units would otherwise reproduce the monoculture this
  // exists to break. Step to the next move in a fixed order so the choice stays
  // deterministic and reproducible across rebuilds.
  const order: OpeningMove[] = [
    "continuation",
    "problem_first",
    "contrast",
    "concrete_instance",
    "cold_open",
  ];
  const next = order[(order.indexOf(natural) + 1) % order.length];
  return next === input.previousMove ? order[0] : next;
}

/** The Topic Overview tells learners that each subsection is organized around a
 * learning question and asks them to answer it in words before working through
 * the equations. The question is model-authored in the Learning Unit Contract,
 * so render it where that instruction can actually be followed: directly under
 * the page heading, before any explanation has given it away. Returns the body
 * unchanged when there is no question or when one is already present. */
export function withLearningQuestionPrompt(
  body: string,
  learningQuestion: string | undefined,
): string {
  const question = (learningQuestion ?? "").trim();
  if (!question) return body;
  const lines = body.split("\n");
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+\S/.test(line));
  if (headingIndex < 0) return body;
  // Re-running finalization or a repair must not stack a second prompt.
  if (lines.some((line) => line.startsWith("> **Before you read.**"))) return body;
  const prompt = `> **Before you read.** ${question}`;
  const rest = lines.slice(headingIndex + 1);
  const restStart = rest.findIndex((line) => line.trim().length > 0);
  const tail = restStart < 0 ? [] : rest.slice(restStart);
  return [...lines.slice(0, headingIndex + 1), "", prompt, "", ...tail].join("\n");
}

export function buildLearningPageFrontmatter({
  gardenId,
  sectionNumber,
  subsectionNumber,
  title,
  learningQuestion,
  sourceAnchors,
  tags,
  primaryConcepts,
  supportingConcepts,
  claimIds,
  visualIds,
  sourceVisualIds,
  sourceFormulaAnchors,
  formulas,
  learningUnitId,
  learningUnitRole,
  learningVersionId,
  sourceSetHash,
  sourceFormulaReviewSetHash,
  generatedAt,
  pageId,
  generatedByBuildId,
  generatedByJobId,
  contractFingerprint,
  generationAttempt,
}: {
  gardenId: string;
  sectionNumber: number;
  subsectionNumber: number;
  title: string;
  /** Model-authored question this page answers, surfaced to the learner and
   * kept in frontmatter so review tooling can check the page against it. */
  learningQuestion?: string;
  sourceAnchors: string[];
  /** Registry-backed public concept tags shown to learners (1-5, kebab-case).
   * This is the only tag field written to learner pages. */
  tags?: string[];
  primaryConcepts?: string[];
  supportingConcepts?: string[];
  claimIds?: string[];
  visualIds: string[];
  /** Source visuals (S1.P4.F1 style) embedded in this page's body. */
  sourceVisualIds?: string[];
  /** Source formula anchors (S1.P6.E1 style) taught or referenced by this page. */
  sourceFormulaAnchors?: string[];
  formulas?: FormulaGroundingEntry[];
  /** Learning Unit Contract breadcrumb for validation and provenance. */
  learningUnitId?: string;
  learningUnitRole?: LearningUnitRole;
  learningVersionId: string;
  sourceSetHash?: string;
  sourceFormulaReviewSetHash?: string;
  generatedAt: string;
  /** Active-build ownership (convergent finalization). Emitted only when a
   * build id is supplied, so legacy output is byte-for-byte unchanged. Page
   * identity is unit+build, never path or title. */
  pageId?: string;
  generatedByBuildId?: string;
  generatedByJobId?: string;
  contractFingerprint?: string;
  generationAttempt?: number;
}): string {
  // No `conceptTags`, no `textbook*` keys or values: learner pages carry clean
  // `tags:` and never contain the word "textbook" anywhere in their
  // frontmatter — the version id is sanitized too.
  const visibleVersionId = publicLearningVersionId(learningVersionId);
  return yamlFrontmatter({
    title,
    date: generatedAt,
    knowledge_type: "learning-page",
    breadboardType: "learning_page",
    gardenId,
    sectionNumber,
    subsectionNumber: `${sectionNumber}.${subsectionNumber}`,
    learningQuestion: learningQuestion?.trim() || undefined,
    sourceAnchors,
    primaryConcepts:
      primaryConcepts && primaryConcepts.length > 0 ? primaryConcepts : undefined,
    supportingConcepts:
      supportingConcepts && supportingConcepts.length > 0 ? supportingConcepts : undefined,
    tags: tags && tags.length > 0 ? tags : undefined,
    claimIds: claimIds && claimIds.length > 0 ? claimIds : undefined,
    visualIds,
    sourceVisualIds:
      sourceVisualIds && sourceVisualIds.length > 0 ? sourceVisualIds : undefined,
    sourceFormulaAnchors:
      sourceFormulaAnchors && sourceFormulaAnchors.length > 0 ? sourceFormulaAnchors : undefined,
    formulas: formulas && formulas.length > 0 ? formulas.map((entry) => ({ ...entry })) : undefined,
    learningUnitId,
    learningUnitRole,
    generatedFromUnitId: learningUnitId,
    generatedBy: "learn_button",
    generated_by: "learn_button",
    learningVersion: visibleVersionId,
    learningVersionId: visibleVersionId,
    sourceSetHash,
    sourceFormulaReviewSetHash,
    // Active-build ownership (only present under convergent finalization).
    pageId: generatedByBuildId ? (pageId ?? (learningUnitId ? `page:${learningUnitId}` : undefined)) : undefined,
    generatedByBuildId: generatedByBuildId || undefined,
    generatedByJobId: generatedByBuildId ? generatedByJobId : undefined,
    contractFingerprint: generatedByBuildId ? contractFingerprint : undefined,
    generationAttempt: generatedByBuildId ? (generationAttempt ?? 1) : undefined,
  });
}

const MAP_TITLE_BANNED_RE = /\b(?:source|paper|evidence|textbook)\b|source[- ](?:derived|central|anchored)/i;

/**
 * Structural gate for a proposed learning map: the map must be a real learning
 * spine (multiple subsections per section, standalone lesson titles), not a
 * restatement of the source's table of contents. Returns the reasons the map
 * is unacceptable; an empty array means the map passes.
 */
export function validateLearningMapDepth(
  map: ProposedLearningMap,
  context?: LearnContextSummary,
): string[] {
  const problems: string[] = [];
  const sections = map.sections ?? [];

  if (sections.length < 2) {
    problems.push(`only ${sections.length} section(s); a learning spine needs an ordered sequence`);
  }
  const shallowSections = sections.filter((section) => section.subsections.length <= 1);
  if (sections.length >= 2 && shallowSections.length * 2 > sections.length) {
    problems.push(
      `${shallowSections.length} of ${sections.length} sections have at most one subsection — the map is a table of contents, not a learning sequence`,
    );
  }

  for (const section of sections) {
    if (MAP_TITLE_BANNED_RE.test(section.title)) {
      problems.push(`section title reads as source commentary: "${section.title}"`);
    }
    for (const subsection of section.subsections) {
      if (MAP_TITLE_BANNED_RE.test(subsection.title)) {
        problems.push(`subsection title reads as source commentary: "${subsection.title}"`);
      }
    }
  }

  // A map whose sections are just the uploaded sources, one each, is
  // source-shaped by construction.
  if (context && context.sources.length > 0 && sections.length > 0) {
    const sourceTitles = new Set(context.sources.map((source) => source.title.trim().toLowerCase()));
    const sourceShaped = sections.every((section) => sourceTitles.has(section.title.trim().toLowerCase()));
    if (sourceShaped) {
      problems.push("every section is named after an uploaded source — the map mirrors the upload instead of teaching the topic");
    }
  }

  return problems;
}

export function removeRawVisualPlaceholders(markdown: string, replacement: string): string {
  return markdown.replace(RAW_VISUAL_PLACEHOLDER_RE, replacement);
}

export function containsRawVisualPlaceholder(markdown: string): boolean {
  return new RegExp(RAW_VISUAL_PLACEHOLDER_RE.source, RAW_VISUAL_PLACEHOLDER_RE.flags).test(markdown);
}

export function ensureQuestionBlock(markdown: string, title: string): string {
  if (/\*\*Question\.\*\*/.test(markdown) && /\*\*Answer\.\*\*/.test(markdown)) {
    return markdown;
  }
  // Safety net only — the critic prefers the model to write its own Q&A. This
  // text is grounded in the concept and avoids placeholder phrasing.
  return `${markdown.trim()}\n\n**Question.** How would you explain ${title} to someone who has never seen it before?\n\n**Answer.** Begin with the situation that makes it necessary, describe how it works one step at a time, and finish with a short example that shows the idea in action.\n`;
}
