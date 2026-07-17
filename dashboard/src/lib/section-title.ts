// Topic-agnostic semantic section-title generation.
//
// A section title is built from exactly three ingredients:
//
//   universal pedagogical purpose   (derived from the unit ROLES, never a regex)
//   + garden-derived subject vocabulary   (GardenTopicProfile)
//   + section focus concepts        (the section's own unit concepts)
//
// No domain noun is hardcoded in this module. Any meaningful content word in a
// generated title must come from the garden's own vocabulary or a small,
// universal, learner-facing title vocabulary — foreign-domain vocabulary is
// rejected by `validateSectionTitleVocabulary`. The system generates several
// candidates and selects the highest-scoring valid one, rather than repairing
// one hardcoded title into another.
//
// IMPORTANT (topic-general leakage rule): this module must NOT contain any
// domain-specific proper noun from any single subject (no neural-network,
// neuroscience, physics, history, or law vocabulary hardcoded here). Domain
// terms may only enter a title through the GardenTopicProfile or a section's
// focus concepts. A source-leakage test enforces this.

import type { LearningUnitContract, LearningUnitRole, SectionRoleFamily } from "./learning-unit-contract.ts";
import {
  sectionTitleGrammarProblems,
  sectionTitleNaturalnessProblems,
  sectionTitleRoleHints,
} from "./learning-unit-contract.ts";

// ---------------------------------------------------------------------------
// Fix 1: universal section purposes
// ---------------------------------------------------------------------------

export type UniversalSectionPurpose =
  | "orientation"
  | "concept"
  | "process"
  | "method"
  | "formalism"
  | "example"
  | "evaluation"
  | "evidence"
  | "comparison"
  | "application"
  | "limitation"
  | "synthesis";

/** Map a detailed Learning Unit role onto a universal pedagogical purpose. The
 * detailed roles are unchanged; only title generation operates on purposes. */
export function universalPurposeForRole(role: LearningUnitRole): UniversalSectionPurpose {
  switch (role) {
    case "motivation":
      return "orientation";
    case "core_concept":
      return "concept";
    case "mechanism":
      return "process";
    case "formula":
      return "formalism";
    case "worked_example":
      return "example";
    case "training_method":
      return "method";
    case "metric":
      return "evaluation";
    case "result_interpretation":
      return "evidence";
    case "comparison":
      return "comparison";
    case "application":
      return "application";
    case "limitation":
      return "limitation";
    case "synthesis":
      return "synthesis";
    default:
      return "concept";
  }
}

/** Purposes that are only "background" for a section — a section dominated by
 * orientation/synthesis is titled by its more specific purpose when one exists. */
const BACKGROUND_PURPOSES: ReadonlySet<UniversalSectionPurpose> = new Set(["orientation", "synthesis"]);

/** Deterministic ranking used to break ties between equally-frequent purposes. */
const PURPOSE_PRIORITY: UniversalSectionPurpose[] = [
  "orientation",
  "concept",
  "process",
  "formalism",
  "method",
  "example",
  "evaluation",
  "evidence",
  "comparison",
  "application",
  "limitation",
  "synthesis",
];

/** The section role family a purpose belongs to (used only to line up the
 * structured purpose with the title-vocabulary consistency check). */
function purposeFamily(purpose: UniversalSectionPurpose): SectionRoleFamily {
  switch (purpose) {
    case "orientation":
      return "motivation";
    case "concept":
    case "process":
      return "mechanism";
    case "formalism":
    case "example":
    case "evaluation":
      return "metric";
    case "method":
      return "training_method";
    case "evidence":
    case "comparison":
      return "comparison";
    case "application":
    case "limitation":
      return "application";
    case "synthesis":
      return "synthesis";
  }
}

// ---------------------------------------------------------------------------
// Small text helpers (self-contained; no domain vocabulary)
// ---------------------------------------------------------------------------

function compact(value: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function stripNumberPrefix(value: string): string {
  return compact(value).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
}

const TITLE_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "from",
  "into", "across", "over", "by", "at", "as", "about", "why", "how", "what",
  "when", "where", "which", "is", "are", "it", "its", "their", "this", "that",
  "these", "those", "still", "yet", "not", "be", "been", "being", "than", "then",
]);

/** Lowercased content tokens (>= 3 chars, non-stopword) used for vocabulary
 * matching. Hyphenated compounds are also split so "real-world" contributes
 * "real" and "world". */
export function contentTokens(text: string): string[] {
  const cleaned = compact(text).toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const tokens: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    for (const part of raw.split("-")) {
      if (part.length >= 3 && !TITLE_STOPWORDS.has(part)) tokens.push(part);
    }
    if (raw.includes("-") && raw.length >= 3 && !TITLE_STOPWORDS.has(raw)) tokens.push(raw);
  }
  return tokens;
}

function titleCase(value: string): string {
  return compact(value)
    .split(" ")
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && /^(and|or|the|a|an|to|of|in|for|with|from)$/.test(lower)) return lower;
      return lower.replace(/^[a-z]/, (ch) => ch.toUpperCase());
    })
    .join(" ");
}

/** A short, learner-facing concept phrase from a raw unit title / newConcept. */
function cleanConcept(value: string): string {
  const cleaned = compact(value)
    .replace(/^\d+(?:\.\d+)*\.?\s*/, "")
    .replace(/^(?:why|how|what|when|where|the|a|an)\s+/i, "")
    .replace(/\b(?:reading|understanding|using|interpreting|introducing|overview of)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 4).join(" ");
  return titleCase(words);
}

/**
 * A universal, learner-facing title vocabulary. These pedagogical / structural
 * words may appear in ANY garden's titles regardless of subject. It deliberately
 * excludes domain outcome nouns (e.g. "adoption") so foreign vocabulary is
 * caught by provenance validation.
 */
const UNIVERSAL_TITLE_VOCAB: ReadonlySet<string> = new Set([
  // orientation
  "why", "matter", "matters", "problem", "problems", "getting", "oriented",
  "orientation", "motivation", "importance", "background", "context", "purpose",
  // concept
  "understanding", "understand", "idea", "ideas", "core", "key", "concept",
  "concepts", "foundation", "foundations", "basics", "fundamentals", "overview",
  // process
  "how", "works", "work", "working", "process", "processes", "step", "steps",
  "stages", "stage", "mechanism", "mechanics", "state",
  // method
  "method", "methods", "strategy", "strategies", "approach", "approaches",
  "technique", "techniques", "applied", "applying", "apply", "practice",
  // formalism
  "mathematical", "description", "formal", "formally", "describing", "describe",
  "notation", "equation", "equations", "definition", "definitions",
  // example
  "worked", "example", "examples", "through", "detail", "details",
  // evaluation
  "measuring", "measure", "measurement", "performance", "evaluated",
  "evaluating", "evaluation", "evaluate", "metric", "metrics", "assessing",
  "quantities", "quantity",
  // evidence / results
  "results", "result", "interpreting", "interpret", "shows", "show", "reading",
  "findings", "outcome", "outcomes",
  // comparison
  "comparing", "comparison", "compared", "compare", "alternative",
  "alternatives", "versus", "tradeoff", "tradeoffs", "differences",
  // application
  "applications", "application", "practical", "use", "uses", "using", "used",
  "real", "world", "real-world", "cases", "case", "deployment",
  // limitation
  "limit", "limits", "limitation", "limitations", "open", "question",
  "questions", "challenge", "challenges", "constraint", "constraints",
  "boundaries", "current", "cannot", "unresolved",
  // synthesis
  "bringing", "together", "unified", "view", "synthesis", "connecting",
  "connect", "connections", "big", "picture", "unify",
  // common learner-facing connective verbs / words (permissive so only true
  // foreign domain nouns are rejected)
  "make", "makes", "making", "need", "needs", "fit", "fits", "block", "blocks",
  "shape", "shapes", "drive", "drives", "change", "changes", "build", "builds",
  "explain", "explains", "cover", "covers", "main", "first", "next", "final",
  "and", "into", "when", "before", "after",
]);

// ---------------------------------------------------------------------------
// Fix 2: GardenTopicProfile
// ---------------------------------------------------------------------------

export interface GardenTopicProfile {
  canonicalSubject: string;
  shortSubject?: string;

  coreConcepts: string[];
  processes: string[];
  methods: string[];
  formalObjects: string[];
  measures: string[];
  evidenceTerms: string[];
  applications: string[];
  limitations: string[];

  /** Every lowercased content token derived from the garden — the allow-list
   * against which title vocabulary provenance is checked. */
  allowedContentTerms: string[];
}

export interface GardenTopicProfileInput {
  gardenTitle: string;
  units: LearningUnitContract[];
  sourceAnchorTitles?: string[];
  sourceSemanticSummaries?: string[];
}

function cleanSubject(gardenTitle: string): string {
  const cleaned = compact(gardenTitle)
    .replace(/\bLearning Garden\b/gi, "")
    .replace(/\be-?textbook\b/gi, "")
    .replace(/\(([^)]*)\)\s*$/, "") // drop a trailing parenthetical (e.g. an acronym)
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || compact(gardenTitle) || "This Topic";
}

function deriveShortSubject(gardenTitle: string, canonicalSubject: string): string | undefined {
  const parenthetical = compact(gardenTitle).match(/\(([A-Za-z][A-Za-z0-9-]{1,7})\)/)?.[1];
  if (parenthetical && /[A-Z]/.test(parenthetical)) return parenthetical;
  // A naturally short subject can double as its own short form.
  if (canonicalSubject && canonicalSubject.split(" ").length <= 2 && canonicalSubject.length <= 24) {
    return canonicalSubject;
  }
  return undefined;
}

function purposeBucket(profile: {
  coreConcepts: string[];
  processes: string[];
  methods: string[];
  formalObjects: string[];
  measures: string[];
  evidenceTerms: string[];
  applications: string[];
  limitations: string[];
}, purpose: UniversalSectionPurpose): string[] {
  switch (purpose) {
    case "concept":
    case "orientation":
    case "synthesis":
      return profile.coreConcepts;
    case "process":
      return profile.processes;
    case "method":
      return profile.methods;
    case "formalism":
    case "example":
      return profile.formalObjects;
    case "evaluation":
      return profile.measures;
    case "evidence":
    case "comparison":
      return profile.evidenceTerms;
    case "application":
      return profile.applications;
    case "limitation":
      return profile.limitations;
  }
}

export function buildGardenTopicProfile(input: GardenTopicProfileInput): GardenTopicProfile {
  const canonicalSubject = cleanSubject(input.gardenTitle);
  const shortSubject = deriveShortSubject(input.gardenTitle, canonicalSubject);

  const buckets = {
    coreConcepts: [] as string[],
    processes: [] as string[],
    methods: [] as string[],
    formalObjects: [] as string[],
    measures: [] as string[],
    evidenceTerms: [] as string[],
    applications: [] as string[],
    limitations: [] as string[],
  };
  const allowed = new Set<string>();
  const addAllowed = (text: string | undefined): void => {
    if (!text) return;
    for (const token of contentTokens(text)) allowed.add(token);
  };

  addAllowed(canonicalSubject);
  addAllowed(input.gardenTitle);
  for (const anchorTitle of input.sourceAnchorTitles ?? []) addAllowed(anchorTitle);
  for (const summary of input.sourceSemanticSummaries ?? []) addAllowed(summary);

  for (const unit of input.units) {
    const purpose = universalPurposeForRole(unit.role);
    const concepts = [...(unit.newConcepts ?? []), unit.title].map(cleanConcept).filter(Boolean);
    purposeBucket(buckets, purpose).push(...concepts);

    addAllowed(unit.title);
    for (const concept of unit.newConcepts ?? []) addAllowed(concept);
    for (const concept of unit.prerequisiteConcepts ?? []) addAllowed(concept);
    addAllowed(unit.learningQuestion);
    for (const note of unit.zettelNotes ?? []) {
      addAllowed(note.claim);
      addAllowed(note.handle?.replace(/-/g, " "));
    }
    for (const figure of unit.sourceFigures ?? []) addAllowed(figure.interpretationGoal);
    for (const formula of unit.sourceFormulas ?? []) {
      addAllowed(formula.teachingGoal);
      for (const term of formula.termsToDefine ?? []) addAllowed(term);
    }
    for (const table of unit.sourceTables ?? []) addAllowed(table.teachingGoal);
  }

  const dedupe = (values: string[]): string[] => [...new Set(values.filter(Boolean))].slice(0, 12);

  return {
    canonicalSubject,
    shortSubject,
    coreConcepts: dedupe(buckets.coreConcepts),
    processes: dedupe(buckets.processes),
    methods: dedupe(buckets.methods),
    formalObjects: dedupe(buckets.formalObjects),
    measures: dedupe(buckets.measures),
    evidenceTerms: dedupe(buckets.evidenceTerms),
    applications: dedupe(buckets.applications),
    limitations: dedupe(buckets.limitations),
    allowedContentTerms: [...allowed].sort(),
  };
}

// ---------------------------------------------------------------------------
// Fix 3: SectionTitleIntent
// ---------------------------------------------------------------------------

export type SectionLearnerMove =
  | "understand_why"
  | "understand_what"
  | "understand_how"
  | "apply_method"
  | "interpret_evidence"
  | "compare_alternatives"
  | "evaluate_limits"
  | "connect_ideas";

export interface SectionTitleIntent {
  sectionNumber: number;
  primaryPurpose: UniversalSectionPurpose;
  secondaryPurposes: UniversalSectionPurpose[];
  subject?: string;
  focusConcepts: string[];
  learnerMove: SectionLearnerMove;
}

function learnerMoveForPurpose(purpose: UniversalSectionPurpose): SectionLearnerMove {
  switch (purpose) {
    case "orientation":
      return "understand_why";
    case "concept":
      return "understand_what";
    case "process":
    case "formalism":
    case "example":
      return "understand_how";
    case "method":
    case "application":
      return "apply_method";
    case "evaluation":
    case "evidence":
      return "interpret_evidence";
    case "comparison":
      return "compare_alternatives";
    case "limitation":
      return "evaluate_limits";
    case "synthesis":
      return "connect_ideas";
  }
}

function sectionFocusConcepts(units: LearningUnitContract[], profile?: GardenTopicProfile): string[] {
  const raw = [
    ...units.flatMap((unit) => unit.newConcepts ?? []),
    ...units.map((unit) => unit.title),
  ]
    .map(cleanConcept)
    .filter((concept) => concept && concept.split(" ").length <= 4);
  const seen = new Set<string>();
  const focus: string[] = [];
  for (const concept of raw) {
    const key = concept.toLowerCase();
    if (seen.has(key)) continue;
    // Focus concepts are, by construction, garden-derived — but guard anyway so
    // a stray concept never becomes unsupported vocabulary.
    if (profile && !conceptSupported(concept, profile)) continue;
    seen.add(key);
    focus.push(concept);
    if (focus.length >= 3) break;
  }
  return focus;
}

function conceptSupported(concept: string, profile: GardenTopicProfile): boolean {
  const allowed = new Set(profile.allowedContentTerms);
  const tokens = contentTokens(concept);
  if (tokens.length === 0) return false;
  return tokens.every((token) => allowed.has(token) || UNIVERSAL_TITLE_VOCAB.has(token));
}

export function deriveSectionTitleIntent(
  units: LearningUnitContract[],
  sectionNumber: number,
  profile?: GardenTopicProfile,
): SectionTitleIntent {
  const purposes = units.map((unit) => universalPurposeForRole(unit.role));
  const counts = new Map<UniversalSectionPurpose, number>();
  for (const purpose of purposes) counts.set(purpose, (counts.get(purpose) ?? 0) + 1);
  const present = [...counts.keys()];
  const foreground = present.filter((purpose) => !BACKGROUND_PURPOSES.has(purpose));
  const ranked = (foreground.length > 0 ? foreground : present).sort((a, b) => {
    const byCount = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    if (byCount !== 0) return byCount;
    return PURPOSE_PRIORITY.indexOf(a) - PURPOSE_PRIORITY.indexOf(b);
  });
  const primaryPurpose = ranked[0] ?? "concept";
  const secondaryPurposes = present
    .filter((purpose) => purpose !== primaryPurpose)
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || PURPOSE_PRIORITY.indexOf(a) - PURPOSE_PRIORITY.indexOf(b));

  return {
    sectionNumber,
    primaryPurpose,
    secondaryPurposes,
    subject: profile ? (profile.shortSubject ?? profile.canonicalSubject) : undefined,
    focusConcepts: sectionFocusConcepts(units, profile),
    learnerMove: learnerMoveForPurpose(primaryPurpose),
  };
}

// ---------------------------------------------------------------------------
// Fix 5: generic, topic-neutral title templates
// ---------------------------------------------------------------------------

const PURPOSE_TEMPLATES: Record<UniversalSectionPurpose, string[]> = {
  orientation: ["Why {subject} Matters", "The Problem and Why It Matters", "Getting Oriented"],
  concept: ["Understanding {focus}", "The Core Ideas", "Key Concepts and Foundations"],
  process: ["How {focus} Works", "How the Process Works", "From {focusA} to {focusB}"],
  method: ["How {focus} Is Applied", "Methods and Strategies", "Approaches and Techniques"],
  formalism: ["Describing {focus} Formally", "The Mathematical Description", "The Formal Description"],
  example: ["Working Through {focus}", "Worked Examples in Detail", "Worked Examples"],
  evaluation: ["Measuring {focus}", "How Performance Is Evaluated", "Measuring and Evaluating"],
  evidence: ["What the Results Show", "Interpreting the Results", "Reading the Results"],
  comparison: ["{focusA} and {focusB} Compared", "Comparing the Main Approaches", "Comparing the Alternatives"],
  application: ["Using {focus} in Practice", "Applications and Practical Use", "Applications and Practical Use"],
  limitation: ["Limits and Open Questions", "What the Current Approach Cannot Yet Do", "Constraints and Open Questions"],
  synthesis: ["Bringing the Ideas Together", "A Unified View", "Connecting the Ideas"],
};

interface MixedTemplate {
  purposes: [UniversalSectionPurpose, UniversalSectionPurpose];
  title: string;
}

const MIXED_TEMPLATES: MixedTemplate[] = [
  { purposes: ["application", "limitation"], title: "Applications, Limits, and Open Questions" },
  { purposes: ["method", "evaluation"], title: "Methods and Evaluation" },
  { purposes: ["comparison", "evidence"], title: "Comparing and Interpreting the Results" },
  { purposes: ["process", "formalism"], title: "How the Process Works and How It Is Described" },
  { purposes: ["method", "comparison"], title: "Methods and Results Compared" },
  { purposes: ["evaluation", "evidence"], title: "Measuring and Interpreting the Results" },
  { purposes: ["concept", "process"], title: "Core Ideas and How They Work" },
  { purposes: ["orientation", "concept"], title: "Getting Oriented to the Core Ideas" },
  { purposes: ["formalism", "example"], title: "The Formal Description and Worked Examples" },
];

// ---------------------------------------------------------------------------
// Fix 9: universal fallbacks (no domain noun)
// ---------------------------------------------------------------------------

const UNIVERSAL_FALLBACK: Record<UniversalSectionPurpose, string> = {
  orientation: "The Problem and Why It Matters",
  concept: "The Core Ideas",
  process: "How the Process Works",
  method: "Methods and Strategies",
  formalism: "The Formal Description",
  example: "Worked Examples in Detail",
  evaluation: "Measuring and Evaluating",
  evidence: "What the Results Show",
  comparison: "Comparing the Alternatives",
  application: "Applications and Practical Use",
  limitation: "Limits and Open Questions",
  synthesis: "Bringing the Ideas Together",
};

function fillTemplate(template: string, subject: string | undefined, focusConcepts: string[]): string | null {
  let title = template;
  if (title.includes("{subject}")) {
    if (!subject) return null;
    title = title.replace(/\{subject\}/g, subject);
  }
  if (title.includes("{focusA}") || title.includes("{focusB}")) {
    if (focusConcepts.length < 2) return null;
    title = title.replace(/\{focusA\}/g, focusConcepts[0]).replace(/\{focusB\}/g, focusConcepts[1]);
  }
  if (title.includes("{focus}")) {
    if (focusConcepts.length < 1) return null;
    title = title.replace(/\{focus\}/g, focusConcepts[0]);
  }
  return compact(title);
}

// ---------------------------------------------------------------------------
// Fix 6: vocabulary provenance validation
// ---------------------------------------------------------------------------

export type SectionTitleVocabularyResult = {
  valid: boolean;
  gardenTerms: string[];
  universalTerms: string[];
  unsupportedTerms: string[];
  reason: string;
};

function stemEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const stem = (value: string) => value.replace(/(?:ies|es|s|ing|ed|al|ic|ally)$/i, "");
  const sa = stem(a);
  const sb = stem(b);
  return sa.length >= 3 && sb.length >= 3 && (sa === sb || sa.startsWith(sb) || sb.startsWith(sa));
}

function isGardenTerm(token: string, gardenTerms: ReadonlySet<string>, focusTerms: ReadonlySet<string>): boolean {
  if (gardenTerms.has(token) || focusTerms.has(token)) return true;
  for (const term of gardenTerms) if (stemEquivalent(token, term)) return true;
  for (const term of focusTerms) if (stemEquivalent(token, term)) return true;
  return false;
}

function isUniversalTerm(token: string): boolean {
  if (UNIVERSAL_TITLE_VOCAB.has(token)) return true;
  for (const term of UNIVERSAL_TITLE_VOCAB) if (stemEquivalent(token, term)) return true;
  return false;
}

/**
 * A title's meaningful content terms must each be garden-derived, section-focus,
 * or universal learner vocabulary. Short function words are ignored; acronyms and
 * longer nouns that come from nowhere in the garden are flagged as foreign.
 */
export function validateSectionTitleVocabulary(
  title: string,
  profile: GardenTopicProfile,
  focusConcepts: string[] = [],
): SectionTitleVocabularyResult {
  const gardenTerms = new Set(profile.allowedContentTerms);
  const focusTerms = new Set(focusConcepts.flatMap((concept) => contentTokens(concept)));

  const rawWords = stripNumberPrefix(title).split(/\s+/).filter(Boolean);
  const foundGarden: string[] = [];
  const foundUniversal: string[] = [];
  const unsupported: string[] = [];

  for (const raw of rawWords) {
    const cleaned = raw.replace(/[^A-Za-z0-9-]/g, "");
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    if (TITLE_STOPWORDS.has(lower)) continue;
    const isAcronym = /^[A-Z]{2,}s?$/.test(cleaned);
    // Short, lowercase common words are structural — not domain content.
    const isContentWord = isAcronym || cleaned.length >= 4;
    if (!isContentWord) continue;
    if (isUniversalTerm(lower)) {
      foundUniversal.push(lower);
    } else if (isGardenTerm(lower, gardenTerms, focusTerms)) {
      foundGarden.push(lower);
    } else {
      unsupported.push(cleaned);
    }
  }

  const valid = unsupported.length === 0;
  return {
    valid,
    gardenTerms: foundGarden,
    universalTerms: foundUniversal,
    unsupportedTerms: unsupported,
    reason: valid
      ? "all content terms are garden-derived, section-focus, or universal"
      : `unsupported (foreign or unsourced) terms: ${unsupported.join(", ")}`,
  };
}

/**
 * Title content words that are neither universal learner vocabulary nor present
 * among the supplied concept texts — i.e. FOREIGN to this context. Used by the
 * section-coherence check to catch a title that names concepts unrelated to the
 * section's units (a topic-agnostic replacement for hardcoded domain regexes).
 */
export function foreignTitleContentWords(title: string, conceptTexts: string[]): string[] {
  const conceptTokens = new Set(conceptTexts.flatMap((text) => contentTokens(text)));
  const foreign: string[] = [];
  for (const raw of stripNumberPrefix(title).split(/\s+/)) {
    const cleaned = raw.replace(/[^A-Za-z0-9-]/g, "");
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    if (TITLE_STOPWORDS.has(lower)) continue;
    const isAcronym = /^[A-Z]{2,}s?$/.test(cleaned);
    if (!isAcronym && cleaned.length < 4) continue;
    if (isUniversalTerm(lower)) continue;
    if (conceptTokens.has(lower)) continue;
    let matched = false;
    for (const token of conceptTokens) {
      if (stemEquivalent(lower, token)) {
        matched = true;
        break;
      }
    }
    if (!matched) foreign.push(cleaned);
  }
  return foreign;
}

// ---------------------------------------------------------------------------
// Fix 7: candidate generation + scoring
// ---------------------------------------------------------------------------

export type SectionTitleCandidateSource =
  | "existing_model_title"
  | "semantic_template"
  | "model_rewrite"
  | "universal_fallback";

export interface SectionTitleCandidate {
  title: string;
  source: SectionTitleCandidateSource;
  roleCoverageScore: number;
  conceptCoverageScore: number;
  naturalnessScore: number;
  uniquenessScore: number;
  vocabularyProvenanceScore: number;
  problems: string[];
}

function titlePurposeFamilies(title: string): Set<SectionRoleFamily> {
  return new Set(sectionTitleRoleHints(title));
}

function conceptCoverage(title: string, focusConcepts: string[]): number {
  if (focusConcepts.length === 0) return 0;
  const titleTokens = new Set(contentTokens(title));
  let covered = 0;
  for (const concept of focusConcepts) {
    const conceptTokens = contentTokens(concept);
    if (conceptTokens.length > 0 && conceptTokens.some((token) => titleTokens.has(token))) covered += 1;
  }
  return covered / focusConcepts.length;
}

function normalizeTitleKey(title: string): string {
  return stripNumberPrefix(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreCandidate(
  title: string,
  source: SectionTitleCandidateSource,
  intent: SectionTitleIntent,
  profile: GardenTopicProfile,
  otherTitleKeys: Set<string>,
): SectionTitleCandidate {
  const bare = stripNumberPrefix(title);
  const problems: string[] = [];

  const naturalnessProblems = [
    ...sectionTitleNaturalnessProblems(bare),
    ...sectionTitleGrammarProblems(bare),
  ];
  problems.push(...naturalnessProblems);
  const naturalnessScore = naturalnessProblems.length === 0 ? 1 : Math.max(0, 1 - 0.5 * naturalnessProblems.length);

  const vocab = validateSectionTitleVocabulary(bare, profile, intent.focusConcepts);
  if (!vocab.valid) problems.push(vocab.reason);
  const vocabularyProvenanceScore = vocab.valid
    ? 1
    : Math.max(0, 1 - vocab.unsupportedTerms.length / Math.max(1, vocab.unsupportedTerms.length + vocab.gardenTerms.length + vocab.universalTerms.length));

  const families = titlePurposeFamilies(bare);
  const allRequiredFamilies = [
    ...new Set([intent.primaryPurpose, ...intent.secondaryPurposes].map(purposeFamily)),
  ];
  const foregroundFamilies = allRequiredFamilies.filter(
    (family) => family !== "motivation" && family !== "synthesis",
  );
  const requiredFamilies = foregroundFamilies.length > 0 ? foregroundFamilies : allRequiredFamilies;
  const coveredFamilies = requiredFamilies.filter((family) => families.has(family));
  const roleCoverageScore = requiredFamilies.length > 0
    ? coveredFamilies.length / requiredFamilies.length
    : 1;
  if (roleCoverageScore < 1) {
    const missing = requiredFamilies.filter((family) => !families.has(family));
    problems.push(`title vocabulary omits the section's ${missing.join(", ")} purpose`);
  }

  const conceptCoverageScore = conceptCoverage(bare, intent.focusConcepts);
  const uniquenessScore = otherTitleKeys.has(normalizeTitleKey(bare)) ? 0 : 1;
  if (uniquenessScore === 0) problems.push("duplicate of another section title");

  return {
    title: bare,
    source,
    roleCoverageScore,
    conceptCoverageScore,
    naturalnessScore,
    uniquenessScore,
    vocabularyProvenanceScore,
    problems,
  };
}

function candidateValid(candidate: SectionTitleCandidate): boolean {
  return (
    candidate.vocabularyProvenanceScore === 1 &&
    candidate.naturalnessScore === 1 &&
    candidate.uniquenessScore === 1 &&
    candidate.roleCoverageScore === 1
  );
}

function compositeScore(candidate: SectionTitleCandidate, source: SectionTitleCandidateSource): number {
  // A small preference keeps a good existing title (less churn) and favours
  // concept-bearing templates over bare fallbacks when both are valid.
  const sourceBonus = source === "existing_model_title" ? 0.06 : source === "semantic_template" ? 0.03 : 0;
  return (
    0.34 * candidate.roleCoverageScore +
    0.24 * candidate.naturalnessScore +
    0.18 * candidate.conceptCoverageScore +
    0.12 * candidate.vocabularyProvenanceScore +
    0.12 * candidate.uniquenessScore +
    sourceBonus
  );
}

export interface GenerateSectionTitleParams {
  units: LearningUnitContract[];
  profile: GardenTopicProfile;
  sectionNumber?: number;
  existingTitle?: string;
  otherSectionTitles?: string[];
}

/**
 * Generate several topic-neutral candidate titles for a section and return the
 * highest-scoring valid one. `.title` is bare (no "N." prefix); callers add the
 * number. There is ALWAYS a valid result because the universal fallback contains
 * only universal vocabulary.
 */
export function generateSectionTitle(params: GenerateSectionTitleParams): SectionTitleCandidate {
  const intent = deriveSectionTitleIntent(params.units, params.sectionNumber ?? 0, params.profile);
  const otherKeys = new Set((params.otherSectionTitles ?? []).map(normalizeTitleKey));

  const candidates: SectionTitleCandidate[] = [];
  const seen = new Set<string>();
  const add = (rawTitle: string | null, source: SectionTitleCandidateSource): void => {
    if (!rawTitle) return;
    const bare = stripNumberPrefix(rawTitle);
    if (!bare || seen.has(bare.toLowerCase())) return;
    seen.add(bare.toLowerCase());
    candidates.push(scoreCandidate(bare, source, intent, params.profile, otherKeys));
  };

  // 1) Keep a good existing (model-authored) title if it is already valid.
  if (params.existingTitle) add(params.existingTitle, "existing_model_title");

  // 2) Mixed-purpose templates when a secondary purpose is present.
  for (const mixed of MIXED_TEMPLATES) {
    const [a, b] = mixed.purposes;
    const covers = (purpose: UniversalSectionPurpose) =>
      intent.primaryPurpose === purpose || intent.secondaryPurposes.includes(purpose);
    if (covers(a) && covers(b)) add(mixed.title, "semantic_template");
  }

  // 3) Primary-purpose templates (focus-bearing first).
  for (const template of PURPOSE_TEMPLATES[intent.primaryPurpose]) {
    add(fillTemplate(template, intent.subject, intent.focusConcepts), "semantic_template");
  }

  // 4) Universal fallback (always valid).
  add(UNIVERSAL_FALLBACK[intent.primaryPurpose], "universal_fallback");

  const valid = candidates.filter(candidateValid);
  const pool = valid.length > 0 ? valid : candidates;
  pool.sort((a, b) => compositeScore(b, b.source) - compositeScore(a, a.source));
  return pool[0];
}
