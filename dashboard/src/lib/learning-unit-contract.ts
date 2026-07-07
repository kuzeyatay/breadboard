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
 * This module is dependency-free on purpose: the dashboard pipeline, the
 * standalone validator script, and the test suite all import it directly. The
 * only imports are type-only (fully erased at runtime).
 */

import type {
  ProposedLearningMap,
  LearningSectionPlan,
  LearningSubsectionPlan,
} from "./learn-utils";

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

export interface InteractiveVisualContract {
  id: string;
  uniqueConcept: string;
  visualType: string;
  whyStaticSourceFigureIsNotEnough: string;
  learnerManipulates: string[];
  expectedInsight: string;
  sourceAnchors: string[];
  /** Stable dedupe key; if two units share it, that is a duplicate visual. */
  duplicateSignature: string;
  /** Set when this visual reuses/links back to an earlier unit's visual. */
  reuseOf?: string;
}

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

  sourceAnchors: string[];

  sourceFigures: SourceFigureContract[];
  sourceFormulas: SourceFormulaContract[];
  sourceTables: SourceTableContract[];

  interactiveVisual?: InteractiveVisualContract;

  zettelNotes: ZettelNote[];

  mustNotRepeat: string[];
  expectedWordRange: [number, number];
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

const ROLE_ZETTEL_CLAIMS: Record<LearningUnitRole, string[]> = {
  motivation: [
    "{concept} identifies the source problem behind the lesson",
    "{concept} makes the motivation concrete in the source",
  ],
  core_concept: [
    "{concept} carries a reusable source-backed distinction",
    "{concept} links the named idea to source behavior",
  ],
  mechanism: [
    "{concept} turns inputs into observable system behavior",
    "{concept} makes the state change observable",
  ],
  formula: [
    "{concept} records the source relationship mathematically",
    "{concept} ties named quantities to a measurable relationship",
  ],
  worked_example: [
    "{concept} tests the method on a concrete case",
    "{concept} ties the procedure to the observed result",
  ],
  training_method: [
    "{concept} defines a training tradeoff",
    "{concept} changes model behavior through its learning rule",
  ],
  metric: [
    "{concept} makes the source behavior measurable",
    "{concept} separates model quality from deployment cost",
  ],
  result_interpretation: [
    "{concept} states what the reported result supports",
    "{concept} keeps the result tied to its metric context",
  ],
  comparison: [
    "{concept} supports comparison across alternatives",
    "{concept} prevents a single metric from choosing the winner",
  ],
  application: [
    "{concept} shapes deployment constraints",
    "{concept} connects capability to use case fit",
  ],
  limitation: [
    "{concept} marks the limit of the source claim",
    "{concept} keeps claims bounded by source limits",
  ],
  synthesis: [
    "{concept} connects earlier ideas into one model",
    "{concept} combines separate lessons into one decision",
  ],
};

function primaryZettelConcept(unit: LearningUnitContract): string {
  const candidate =
    [...unit.newConcepts, unit.title, unit.learningQuestion]
      .map((value) => compact(value).replace(/^\d+(?:\.\d+)*\.?\s*/, ""))
      .find((value) => value && !/^(why|how|what|where|when|the)\b/i.test(value)) ??
    unit.title ??
    "the concept";
  return candidate.replace(/\s+/g, " ").trim() || "the concept";
}

function generatedZettelNote(unit: LearningUnitContract, claimTemplate: string): ZettelNote | null {
  const concept = primaryZettelConcept(unit);
  const claim = claimTemplate.replace("{concept}", concept);
  const handle = atomicZettelHandle(claim);
  if (!isAtomicZettelHandle(handle)) return null;
  return {
    handle,
    claim,
    connectedTo: [...new Set([...unit.prerequisiteConcepts, ...unit.newConcepts, ...unit.sourceAnchors].filter(Boolean))].slice(0, 5),
  };
}

function expandZettelNotesForUnit(unit: LearningUnitContract): ZettelNote[] {
  const notes = [...(unit.zettelNotes ?? [])];
  const seen = new Set(zettelHandlesForUnit({ ...unit, zettelNotes: notes }));
  const templates = [
    ...(ROLE_ZETTEL_CLAIMS[unit.role] ?? []),
    "{concept} keeps the explanation tied to observable details",
    "{concept} supports a reusable learner decision",
  ];
  for (const template of templates) {
    if (seen.size >= 3) break;
    const note = generatedZettelNote(unit, template);
    if (!note) continue;
    const handle = atomicZettelHandle(note.handle || note.claim);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    notes.push(note);
  }
  return notes.slice(0, 6);
}

const SCAFFOLD_ZETTEL_PATTERNS: RegExp[] = [
  /\bnames-the-durable-idea\b/i,
  /\blearners-reuse\b/i,
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
    case "result_interpretation":
      return "metric";
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

const TITLE_ROLE_HINTS: Array<[SectionRoleFamily, RegExp]> = [
  ["motivation", /\bwhy\b|\bexist\b|\bmotivat|\bneed\b|\bpurpose\b/i],
  ["mechanism", /\bmechanism|\bworks?\b|\bspike event|\bneuron|\blif\b|\bmembrane|\bthreshold|\breset|\bcoding|\barchitecture|\bdynamics|\bformal|\bformula/i],
  ["training_method", /\blearn(?:s|ing)?\b|\btrain(?:s|ing|ed)?\b|\bsurrogate\b|\bgradient\b|\bstdp\b|\bplasticity\b|\bconversion\b|\bann[- ]to[- ]snn\b|\bmethod\b|\bstrategy\b/i],
  ["metric", /\bmetric|\bmeasur|\bevaluat|\baccuracy\b|\blatency\b|\benergy\b|\bspike count\b|\bconvergence\b|\bperformance\b|\bscore/i],
  ["comparison", /\bcompar|\btrade[- ]?off|\bversus\b|\bvs\b|\bmodel families\b|\bresults?\b|\bresults show\b/i],
  ["application", /\bapplication|\bdeploy|\bhardware|\bneuromorphic|\bwhere\b|\bfit\b|\badoption\b|\bblocks?\b|\bchallenge|\blimitation|\bfuture|\bunresolved/i],
  ["synthesis", /\btogether\b|\bunified\b|\bbig picture\b|\bconnect|\boverview\b|\bframework\b/i],
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
    const motivationTitleIntroducesMechanism =
      importantFamilies.length === 1 &&
      importantFamilies[0] === "mechanism" &&
      titleHas("motivation") &&
      !titleHas("metric") &&
      !titleHas("comparison") &&
      !titleHas("training_method") &&
      /\b(?:snn|spik|event|neuron|network|computation|compute)\b/i.test(
        [sectionTitle, ...subsectionTitles, ...dominantConcepts].join(" "),
      );
    const missing = importantFamilies.filter((role) => !titleHints.includes(role));
    if (importantFamilies.length >= 2 && missing.length > 0 && !titleAcknowledgesMixed) {
      problems.push(semanticProblem(sectionTitle, dominantRoleLabels, `mixed section title omits ${missing.join(", ")} role(s)`, "split the section or use a title that names the mixed purpose"));
    }
    if (importantFamilies.length === 1 && !titleHints.includes(importantFamilies[0]) && !motivationTitleIntroducesMechanism) {
      problems.push(semanticProblem(sectionTitle, dominantRoleLabels, `title vocabulary points to ${titleHints.join(", ")} but units are ${importantFamilies[0]}`, "retitle the section to match the unit role"));
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
  metric_calculator: /metric|formula|accuracy|latency|energy|efficien|spike count|convergence|rate|score|normaliz|equation/i,
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
    concept: /metric|formula|accuracy|latency|energy|efficien|spike count|convergence|rate|score|normaliz/i,
  },
  tradeoff_explorer: {
    // Allowed on metric/comparison/application units, so its vocabulary must
    // cover the metrics that drive tradeoffs (energy/efficiency/latency/…),
    // not only the words "tradeoff"/"compare".
    roles: new Set(["comparison", "application", "result_interpretation", "metric"]),
    concept: /trade[- ]?off|compar|deployment|choice|priorit|multiple metrics|versus|vs\b|efficien|energy|latency|accuracy|spike count|throughput|budget|metric|normaliz/i,
  },
};

const SUPPORTED_INTERACTIVE_VISUAL_TYPES = new Set([
  "lif_neuron",
  "neural_coding",
  "stdp_window",
  "metric_calculator",
  "training_curve",
  "tradeoff_explorer",
]);

/**
 * Is this visual type justified by the learning unit? Returns an ok flag and a
 * reason when incompatible. Unsupported renderer types are rejected so the
 * contract never requires a visual the page writer cannot embed.
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
      ok: false,
      reason: `visual type "${type}" is not supported by an implemented interactive renderer`,
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

function normalizeInteractiveVisual(raw: unknown): InteractiveVisualContract | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const visualType = normalizeInteractiveVisualType(compact(record.visualType ?? record.type));
  const uniqueConcept = compact(record.uniqueConcept ?? record.concept);
  if (!visualType && !uniqueConcept) return undefined;
  if (!SUPPORTED_INTERACTIVE_VISUAL_TYPES.has(visualType)) return undefined;
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
  if (!provisional.duplicateSignature) {
    provisional.duplicateSignature = signatureKey(interactiveVisualSignature(provisional));
  }
  return provisional;
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
    return { ...unit, interactiveVisual: undefined };
  });
  return { units: sanitized, dropped };
}

export function normalizeLearningUnits(raw: unknown): LearningUnitContract[] {
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
    const title = compact(record.title ?? record.name) || `Learning unit ${index + 1}`;
    let id = compact(record.id) || `U${index + 1}`;
    id = id.replace(/[^A-Za-z0-9_.-]/g, "-");
    while (usedIds.has(id)) id = `${id}x`;
    usedIds.add(id);
    const unit: LearningUnitContract = {
      id,
      title,
      role: asRole(record.role),
      learningQuestion: compact(record.learningQuestion ?? record.question),
      prerequisiteConcepts: asStringArray(record.prerequisiteConcepts ?? record.prerequisites),
      newConcepts: asStringArray(record.newConcepts ?? record.concepts),
      sourceAnchors: asStringArray(record.sourceAnchors ?? record.anchors),
      sourceFigures: asArray(record.sourceFigures).map(normalizeFigure).filter(Boolean) as SourceFigureContract[],
      sourceFormulas: asArray(record.sourceFormulas).map(normalizeFormula).filter(Boolean) as SourceFormulaContract[],
      sourceTables: asArray(record.sourceTables).map(normalizeTable).filter(Boolean) as SourceTableContract[],
      interactiveVisual: normalizeInteractiveVisual(record.interactiveVisual),
      zettelNotes: asArray(record.zettelNotes).map(normalizeZettelNote).filter(Boolean) as ZettelNote[],
      mustNotRepeat: asStringArray(record.mustNotRepeat ?? record.avoid),
      expectedWordRange: normalizeWordRange(record.expectedWordRange ?? record.wordRange),
    };
    units.push({ ...unit, zettelNotes: expandZettelNotesForUnit(unit) });
  });
  return units;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Source-artifact assignment (Fix 3 / Fix 8)
// ---------------------------------------------------------------------------

const RESULT_ROLES = new Set<LearningUnitRole>(["result_interpretation", "comparison"]);
const DEFINITION_ROLES = new Set<LearningUnitRole>(["motivation", "core_concept"]);
const FORMULA_ROLES = new Set<LearningUnitRole>(["formula", "metric"]);

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
    purpose: unit.learningQuestion || `Teach ${unit.title} directly.`,
    sourceAnchors: unit.sourceAnchors,
    visualOpportunities: unit.interactiveVisual ? [unit.interactiveVisual.uniqueConcept] : [],
    conceptTags: zettelHandlesForUnit(unit),
    sourceVisualIds: [...new Set(sourceVisualIds)],
    interactiveVisuals,
    learningUnitId: unit.id,
    learningUnitRole: unit.role,
    learningQuestion: unit.learningQuestion,
    prerequisiteConcepts: unit.prerequisiteConcepts,
    newConcepts: unit.newConcepts,
    mustNotRepeat: unit.mustNotRepeat,
    expectedWordRange: unit.expectedWordRange,
    sourceFigureContracts: unit.sourceFigures,
    sourceFormulaContracts: unit.sourceFormulas,
    sourceTableContracts: unit.sourceTables,
    sourceArtifactAssignments: assignSourceArtifacts([unit]),
    interactiveVisualContract: unit.interactiveVisual,
    zettelNotes: unit.zettelNotes,
  };
}

function topicLabel(topic: string): string {
  const cleaned = compact(topic).replace(/\bLearning Garden\b/gi, "").trim();
  if (!cleaned) return "the Topic";
  if (/spiking neural networks|snns/i.test(cleaned)) return "SNNs";
  return cleaned.replace(/^the\s+/i, "");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && /^(and|or|the|a|an|to|of|in|for|with)$/.test(lower)) return lower;
      return lower.replace(/^./, (ch) => ch.toUpperCase());
    })
    .join(" ");
}

function conceptFromUnits(units: LearningUnitContract[], fallback: string): string {
  const concepts = units.flatMap((unit) => [...unit.newConcepts, unit.title]);
  const candidate =
    concepts
      .map((item) => compact(item).replace(/^\d+(?:\.\d+)*\.?\s*/, ""))
      .find((item) => item && !/^(why|how|what|when|where|the)\b/i.test(item)) ??
    fallback;
  return titleCase(candidate.replace(/\bSNNs\b/gi, "SNNs"));
}

function titleFamilyFlags(text: string): Set<string> {
  const lower = compact(text).toLowerCase();
  const out = new Set<string>();
  if (/\baccuracy\b|\bcorrect prediction/.test(lower)) out.add("accuracy");
  if (/\blatency\b|\bdecision time\b|\bresponse time\b/.test(lower)) out.add("latency");
  if (/\bspike count\b|\bspikes?\b/.test(lower)) out.add("spikes");
  if (/\benergy\b|\bjoules?\b|\bpower\b/.test(lower)) out.add("energy");
  if (/\befficien|\baccuracy per energy\b|\bnormalized\b/.test(lower)) out.add("efficiency");
  if (/\bconverg|\bepochs?\b|\btarget accuracy\b/.test(lower)) out.add("convergence");
  if (/\bthreshold\b|\bmembrane potential\b|\bfiring\b/.test(lower)) out.add("threshold");
  return out;
}

export function polishSectionTitleFromInput(input: SectionTitlePolishInput): string {
  const roles = new Set(input.unitRoles.map((role) => compact(role)));
  const text = [
    input.originalTitle,
    ...input.unitTitles,
    ...input.sourceAnchorTitles,
    input.dominantLearnerQuestion,
  ].join(" ");
  const families = titleFamilyFlags(text);
  const hasFormula = roles.has("formula") || roles.has("worked_example");
  const hasMetric = roles.has("metric") || roles.has("result_interpretation");
  const hasTraining = roles.has("training_method");
  const hasComparison = roles.has("comparison");
  const prefix = input.sectionNumber > 0 ? `${input.sectionNumber}. ` : "";
  let body = compact(input.originalTitle).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
  if (hasFormula || hasMetric) {
    const firstGroup = ["accuracy", "latency"].filter((family) => families.has(family));
    const hasSpikeCost = families.has("spikes");
    const hasDeploymentCost = families.has("energy") || families.has("efficiency") || families.has("convergence");
    const secondGroup = ["energy", "spikes", "efficiency", "convergence"].filter((family) => families.has(family));
    if (firstGroup.length > 0 && hasSpikeCost && !hasDeploymentCost) body = "Measuring Accuracy, Latency, and Spike Count";
    else if (firstGroup.length === 2 && secondGroup.length === 0) body = "Measuring Accuracy and Latency";
    else if (firstGroup.length === 1 && firstGroup[0] === "accuracy" && secondGroup.length === 0) body = "Measuring Accuracy";
    else if (firstGroup.length === 1 && firstGroup[0] === "latency" && secondGroup.length === 0) body = "Measuring Decision Latency";
    else if (families.has("convergence") && (families.has("energy") || families.has("efficiency"))) body = "Measuring Energy, Efficiency, and Convergence";
    else if (secondGroup.length > 0 && !families.has("accuracy") && !families.has("latency")) body = "Measuring Energy, Spikes, and Efficiency";
    else if (firstGroup.length > 0 && secondGroup.length > 0) body = "How Metrics Connect to Deployment Cost";
    else if (families.has("threshold")) body = "How Threshold Rules Create Spikes";
    else body = "Measuring the Core Quantities";
  } else if (hasTraining && hasComparison) {
    body = "Training Methods and Results Compared";
  } else if (hasTraining) {
    body = "How the Method Learns";
  }
  if (sectionTitleNaturalnessProblems(body).length > 0) body = "Measuring the Core Quantities";
  return `${prefix}${body}`;
}

function polishSectionTitle(cluster: SectionCluster, units: LearningUnitContract[], gardenTopic: string): string {
  const topic = topicLabel(gardenTopic);
  const roles = new Set(units.map((unit) => unit.role));
  const hasFormulaRole = roles.has("formula") || roles.has("worked_example");
  const hasMetricRole = roles.has("metric") || roles.has("result_interpretation");
  const hasTrainingRole = roles.has("training_method");
  const hasComparisonRole = roles.has("comparison");
  if (roles.has("motivation") && (roles.has("core_concept") || roles.has("mechanism"))) {
    return /SNNs/i.test(topic) ? "Why SNNs Need Events" : `Why ${topic} Needs a New Mechanism`;
  }
  if (hasTrainingRole && hasMetricRole) return /SNNs/i.test(topic) ? "How SNNs Learn and Are Evaluated" : `How ${topic} Learns and Is Evaluated`;
  if (hasTrainingRole && hasFormulaRole) return "Training Methods and Formal Rules";
  if (hasComparisonRole && hasMetricRole) return "Metrics and Results Compared";
  if (hasComparisonRole && hasFormulaRole) return "Formulas and Results Compared";
  if (hasComparisonRole && hasTrainingRole) return "Training Methods and Results Compared";
  if (roles.has("core_concept") || roles.has("mechanism")) {
    return `How ${conceptFromUnits(units, topic)} Works`;
  }
  if (hasFormulaRole && hasMetricRole) {
    return polishSectionTitleFromInput({
      sectionNumber: 0,
      originalTitle: cluster.title,
      unitTitles: units.map((unit) => unit.title),
      unitRoles: units.map((unit) => unit.role),
      sourceAnchorTitles: units.flatMap((unit) => unit.sourceFormulas.map((formula) => formula.teachingGoal)),
      dominantLearnerQuestion: units.map((unit) => unit.learningQuestion).filter(Boolean)[0] ?? "",
    });
  }
  if (hasFormulaRole) {
    return polishSectionTitleFromInput({
      sectionNumber: 0,
      originalTitle: cluster.title,
      unitTitles: units.map((unit) => unit.title),
      unitRoles: units.map((unit) => unit.role),
      sourceAnchorTitles: units.flatMap((unit) => unit.sourceFormulas.map((formula) => formula.teachingGoal)),
      dominantLearnerQuestion: units.map((unit) => unit.learningQuestion).filter(Boolean)[0] ?? "",
    });
  }
  if (hasMetricRole) {
    return /SNNs/i.test(topic) ? "The Metrics That Make SNNs Measurable" : `The Rules and Metrics Behind ${topic}`;
  }
  if (hasTrainingRole) return `How ${topic} Learns`;
  if (hasComparisonRole) return "What the Results Show";
  if (roles.has("application") || roles.has("limitation") || roles.has("synthesis")) {
    return `Where ${topic} Fits and What Still Blocks It`;
  }
  const first = conceptFromUnits(units, cluster.title);
  return first === "This Topic" ? `Understanding ${topic}` : first;
}

const SECTION_CONCEPT_STOPWORDS = new Set([
  "what", "why", "how", "where", "the", "and", "or", "as", "with", "for", "from",
  "result", "results", "show", "reading", "using", "source", "lesson", "overview",
  "metric", "metrics", "snn", "snns", "neural", "network", "networks",
]);

function compactConceptTitle(value: string): string {
  const cleaned = compact(value)
    .replace(/^\d+(?:\.\d+)*\.?\s*/, "")
    .replace(/\b(?:reading|understanding|using|interpreting|results?|comparisons?|across models)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter((word) => {
    const key = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    return key.length > 1 && !SECTION_CONCEPT_STOPWORDS.has(key);
  });
  return titleCase(words.slice(0, 5).join(" "));
}

function disambiguatedSectionTitle(units: LearningUnitContract[], fallback: string): string {
  const roles = new Set(units.map((unit) => unit.role));
  const candidates = [
    ...units.flatMap((unit) => unit.newConcepts),
    ...units.map((unit) => unit.title),
  ]
    .map(compactConceptTitle)
    .filter(Boolean);
  const unique = [...new Set(candidates)].slice(0, 3);
  const stem = unique.length > 0 ? unique.join(", ") : compactConceptTitle(fallback) || "Focused";
  const hasFormulaRole = roles.has("formula") || roles.has("worked_example");
  const hasMetricRole = roles.has("metric") || roles.has("result_interpretation");
  const hasComparisonRole = roles.has("comparison");
  if (roles.has("training_method") && hasFormulaRole) return `${stem} Training and Formal Rules`;
  if (roles.has("training_method") && hasMetricRole) return `${stem} Training and Evaluation`;
  if (hasComparisonRole && hasFormulaRole) return `${stem} Formulas and Results`;
  if (hasComparisonRole && hasMetricRole) return `${stem} Metrics and Results`;
  if (hasComparisonRole) return `${stem} Results`;
  if (hasFormulaRole) {
    return polishSectionTitleFromInput({
      sectionNumber: 0,
      originalTitle: fallback,
      unitTitles: units.map((unit) => unit.title),
      unitRoles: units.map((unit) => unit.role),
      sourceAnchorTitles: units.flatMap((unit) => unit.sourceFormulas.map((formula) => formula.teachingGoal)),
      dominantLearnerQuestion: units.map((unit) => unit.learningQuestion).filter(Boolean)[0] ?? "",
    }).replace(/^\d+\.\s*/, "");
  }
  if (hasMetricRole) return `${stem} Metrics`;
  if (roles.has("training_method")) return `${stem} Training Methods`;
  if (roles.has("application") || roles.has("limitation")) return `${stem} Applications and Limits`;
  return stem;
}

function disambiguateDuplicateSectionTitles(
  sections: LearningSectionPlan[],
  clusters: SectionCluster[],
  byId: Map<string, LearningUnitContract>,
): LearningSectionPlan[] {
  const groups = new Map<string, number[]>();
  sections.forEach((section, index) => {
    const key = normalizedSectionTitleKey(section.title);
    const list = groups.get(key) ?? [];
    list.push(index);
    groups.set(key, list);
  });
  const next = [...sections];
  for (const indexes of groups.values()) {
    if (indexes.length <= 1) continue;
    for (const index of indexes) {
      const clusterUnits = clusters[index].unitIds.map((id) => byId.get(id)).filter(Boolean) as LearningUnitContract[];
      const title = disambiguatedSectionTitle(clusterUnits, next[index].title);
      next[index] = {
        ...next[index],
        title,
        purpose: `Build up ${title.toLowerCase()} one step at a time.`,
      };
    }
  }
  return next;
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
  const rawSections: LearningSectionPlan[] = clusters.map((cluster) => {
    const clusterUnits = cluster.unitIds.map((id) => byId.get(id)).filter(Boolean) as LearningUnitContract[];
    const sectionAnchors = [...new Set(clusterUnits.flatMap((unit) => unit.sourceAnchors))].slice(0, 8);
    const sectionTitle = polishSectionTitle(cluster, clusterUnits, meta.title);
    return {
      title: sectionTitle,
      purpose: cluster.singleSubsectionReason
        ? cluster.singleSubsectionReason
        : `Build up ${sectionTitle.toLowerCase()} one step at a time.`,
      sourceAnchors: sectionAnchors,
      subsections: clusterUnits.map(subsectionFromUnit),
    };
  });
  const sections = disambiguateDuplicateSectionTitles(rawSections, clusters, byId);
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

  if (imageBlockIndexes.length > maxFigures) {
    problems.push(`page embeds ${imageBlockIndexes.length} source figures (> ${maxFigures}) without justification`);
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
  const artifactCount = options.artifactCount ?? 0;
  const minUnits = options.minUnitsForRichSource ?? 12;

  // Unit count for artifact-rich sources.
  if (units.length < minUnits && artifactCount >= minUnits) {
    problems.push(
      `only ${units.length} learning units for a source with ${artifactCount} important figures/tables/formulas/results (expected >= ${minUnits})`,
    );
  }
  if (units.length < 8) {
    problems.push(`only ${units.length} learning units; a garden needs a real teaching sequence (>= 8)`);
  }

  // Section-depth prediction from clustering.
  const clusters = clusterUnitsIntoSections(units);
  problems.push(...clusterDepthProblems(clusters));

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
    for (const formula of unit.sourceFormulas) {
      if (!FORMULA_ROLES.has(unit.role) && unit.role !== "result_interpretation" && unit.role !== "worked_example") {
        problems.push(`unit "${unit.id}" (${unit.role}): formula ${formula.id} assigned outside a formula/metric unit`);
      }
    }
  }

  // Zettelkasten quality (Fix 6 / Fix 7).
  const handleFreq = zettelHandleFrequency(units);
  for (const unit of units) {
    problems.push(...zettelHandleQualityProblems(unit));
    for (const note of unit.zettelNotes) {
      if (note.handle.includes("/")) problems.push(`unit "${unit.id}": zettel handle "${note.handle}" uses a slash namespace`);
      if (!isAtomicZettelHandle(note.handle)) {
        problems.push(`unit "${unit.id}": zettel handle "${note.handle}" is not an atomic concept handle`);
      }
    }
  }
  const overusedThreshold = Math.max(2, Math.ceil(units.length * 0.4));
  for (const [handle, count] of handleFreq) {
    if (count > overusedThreshold) {
      problems.push(`zettel handle "${handle}" appears on ${count}/${units.length} units (> 40%); likely too broad`);
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
