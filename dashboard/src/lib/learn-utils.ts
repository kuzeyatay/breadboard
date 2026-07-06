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
  type SourceTableContract,
  type ZettelNote,
} from "./learning-unit-contract.ts";

export const LEARN_STATUSES = [
  "idle",
  "planning",
  "awaiting_confirmation",
  "generating_learning_pages",
  // Legacy name for generating_learning_pages; still read from old job rows.
  "generating_textbook",
  "generating_visuals",
  "writing_quartz",
  "building_navigation",
  "complete",
  "failed",
  "cancelled",
] as const;

export type LearnStatus = (typeof LEARN_STATUSES)[number];

export interface LearnSourceSummary {
  id: string;
  slug: string;
  title: string;
  relPath: string;
  sourceType?: string;
  sourceFile?: string;
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
  mustNotRepeat?: string[];
  expectedWordRange?: [number, number];
  sourceFigureContracts?: SourceFigureContract[];
  sourceFormulaContracts?: SourceFormulaContract[];
  sourceTableContracts?: SourceTableContract[];
  sourceArtifactAssignments?: SourceArtifactAssignment[];
  interactiveVisualContract?: InteractiveVisualContract;
  zettelNotes?: ZettelNote[];
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
  text: string;
  normalizedText?: string;
  groundingStatus: "source-anchored" | "source-derived" | "conceptual-helper" | "unmatched";
  justification: string;
  sourceAnchor?: string;
  sourceAnchorTitle?: string;
  matchReason?: string;
  confidence?: number;
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
  if (/^[A-Za-z](?:_[A-Za-z0-9]+|\^[A-Za-z0-9]+)?$/.test(compacted)) return false;
  if (/^(?:ms|s|j|w|hz|khz|mhz|v|a)$/i.test(compacted)) return false;
  if (/\\(?:frac|sum|prod|int|sqrt|min|max|log|exp|Delta|tau|lambda|eta|theta|operatorname)\b/.test(expr)) return true;
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
  | "convergence";

const FORMULA_FAMILY_PATTERNS: Array<[FormulaMetricFamily, RegExp]> = [
  ["convergence", /\bconverg|\bepochs?\b|\btarget accuracy\b|\btarget\b|t_\{?\\?text\{?conv|t_\{?conv|a\(e\)|\ba_\{?e\}?|\ba_\{?target\}?|arg\s*min|\\arg\s*min|\\min\s*\\?\{/i],
  ["efficiency", /\befficien|\baccuracy per energy\b|normalized energy|\\eta|eta/i],
  ["energy", /\benergy\b|\bjoules?\b|\bpower\b|\bsynaptic\b|\bsynops?\b|\be_\{?\\?text\{?(?:energy|total|spike|syn)|e_\{?(?:total|spike|synop)|cost/i],
  ["spike-count", /\bspike[- ]?count\b|\btotal spikes?\b|\bnumber of spikes?\b|\bspikes?\b|n_\{?\\?text\{?(?:spike|spk)|n_\{?(?:spikes?|spk)\}?|n[_\s]*(?:spikes?|spk)|\\sum(?:_\{?[^}\s]*\}?|\s)*(?:s[_\{]|\bspikes?\b)|s_\{?[a-z](?:,[a-z])?\}?|s_n\(t\)|time ?steps?/i],
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

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => compact(item))
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [compact(value)];
  return [];
}

export function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export function stripMarkdownFrontmatter(value: string): string {
  return value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
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
        return null;
      }
    }
    return null;
  }
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
  /\bto be written\b/i,
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

/** Source-commentary phrasing that must never carry the teaching voice of a
 * learner page. Tolerated only inside compact provenance captions (the italic
 * line under an embedded source figure), which are stripped before matching. */
export const SOURCE_COMMENTARY_PATTERNS: RegExp[] = [
  /\bthe paper\b/i,
  /\bthis paper\b/i,
  /\bthe source\b(?!\s+of\b)/i,
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

/** Count source-commentary phrases in the teaching prose (captions excluded). */
export function countSourceCommentary(markdown: string): number {
  const prose = teachingProse(markdown);
  let count = 0;
  for (const pattern of SOURCE_COMMENTARY_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    count += (prose.match(global) ?? []).length;
  }
  return count;
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
    .replace(/\bthe source\b(?!\s+of\b)/gi, "the material")
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

/** True when the markdown contains meta-instruction / placeholder language. */
export function hasPlaceholderText(markdown: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(markdown));
}

/** True when the markdown carries empty or ellipsis-only bullet scaffolds
 * (`- `, `- ...`, `- TBD`) — a sign a draft's outline was never filled in. Two
 * or more such items on a page is a hard failure. */
export function hasEmptyBulletScaffold(markdown: string): boolean {
  const body = stripMarkdownFrontmatter(markdown).replace(/```[\s\S]*?```/g, " ");
  let empties = 0;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*[-*+]\s*(?:\.{2,}|…|TBD|N\/A|-{2,})?\s*$/i.test(line)) empties += 1;
  }
  return empties >= 2;
}

/** Count AI-style discourse patterns in prose. */
export function countAiisms(markdown: string): number {
  let count = 0;
  for (const pattern of AI_ISM_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    count += (markdown.match(global) ?? []).length;
  }
  return count;
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
}

/** Minimum words a learner subsection should contain. */
export const MIN_LESSON_WORDS = 700;

/**
 * Local quality critic run before a lesson page is written. Every problem here
 * is a hard failure: a page that trips any of them is never written as learner
 * content — the pipeline retries and, if every attempt fails, fails the job
 * (quarantining the last draft under .breadboard/debug/failed-pages/).
 */
export function assessLessonQuality(
  body: string,
  options: { assignedVisualUrls?: string[]; minWords?: number } = {},
): { ok: boolean; hardFail: boolean; problems: QualityProblem[] } {
  const problems: QualityProblem[] = [];
  const words = proseWordCount(body);
  const minWords = options.minWords ?? MIN_LESSON_WORDS;

  if (hasPlaceholderText(body)) {
    problems.push({ code: "placeholder", message: "contains placeholder / meta-instruction text", hard: true });
  }
  if (hasEmptyBulletScaffold(body)) {
    problems.push({ code: "empty-bullet-scaffold", message: "contains empty/placeholder bullet scaffolds", hard: true });
  }
  if (hasFallbackFingerprint(body)) {
    problems.push({ code: "fallback-fingerprint", message: "contains fallback-template prose", hard: true });
  }
  const commentary = countSourceCommentary(body);
  if (commentary > 0) {
    problems.push({
      code: "source-commentary",
      message: `${commentary} source-commentary phrase${commentary === 1 ? "" : "s"} in teaching prose`,
      hard: true,
    });
  }
  if (RAW_REFERENCE_DUMP_RE.test(body)) {
    problems.push({ code: "raw-reference-dump", message: "contains a bibliography/reference-list chunk", hard: true });
  }
  const hasQuestion = /\*\*Question\.\*\*/.test(body) && /\*\*Answer\.\*\*/.test(body);
  if (!hasQuestion) {
    problems.push({ code: "no-qa", message: "missing a Question./Answer. pair", hard: true });
  }
  if (words < 120) {
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
  const aiisms = countAiisms(body);
  if (aiisms > 2) {
    problems.push({ code: "aiisms", message: `${aiisms} AI-style phrases`, hard: true });
  }
  const hasExample = /\b(for example|for instance|imagine|consider|suppose|think of|picture)\b/i.test(body);
  if (!hasExample) {
    problems.push({ code: "no-example", message: "no concrete example / analogy cue", hard: true });
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
 * Normalizes learner-page tags into 4-8 stable Zettelkasten concept handles.
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

export function sourceSetHashForSources(sources: LearnSourceSummary[]): string {
  const stable = sources
    .map((source) => ({
      slug: source.slug,
      relPath: source.relPath,
      title: source.title,
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

function linkSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface LinkTargetEntry {
  kind: "section" | "subsection" | "page";
  /** Canonical vault-root target, no `.md`. */
  target: string;
  /** Display label to use when the source link had no explicit `|label`. */
  label: string;
  /** Slug of the (sanitized + raw) title, for loose matching. */
  slugs: Set<string>;
  /** For subsections: the parent section's slug, for `[[Section#Sub]]` disambiguation. */
  sectionSlug?: string;
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
      slugs: new Set([linkSlug("Topic Overview")]),
    },
    {
      kind: "page",
      target: `${LEARNING_ROOT}/Learning Map`,
      label: "Learning Map",
      slugs: new Set([linkSlug("Learning Map")]),
    },
  ];
  map.sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    const sectionTitle = sanitizeLearnerTitle(section.title);
    const folder = `${LEARNING_ROOT}/${textbookSectionFolder(sectionNumber, sectionTitle)}`;
    const sectionSlug = linkSlug(sectionTitle);
    entries.push({
      kind: "section",
      target: `${folder}/_index`,
      label: sectionTitle,
      slugs: new Set([sectionSlug, linkSlug(section.title), linkSlug(`${sectionNumber}. ${sectionTitle}`)]),
      sectionSlug,
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
          linkSlug(subsectionTitle),
          linkSlug(subsection.title),
          linkSlug(`${numberLabel} ${subsectionTitle}`),
        ]),
        sectionSlug,
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
        const scoped = candidates.find((entry) => entry.sectionSlug === sectionSlug);
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

export function buildLearningPageFrontmatter({
  gardenId,
  sectionNumber,
  subsectionNumber,
  title,
  sourceAnchors,
  tags,
  visualIds,
  sourceVisualIds,
  sourceFormulaAnchors,
  formulas,
  learningUnitId,
  learningUnitRole,
  learningVersionId,
  sourceSetHash,
  generatedAt,
}: {
  gardenId: string;
  sectionNumber: number;
  subsectionNumber: number;
  title: string;
  sourceAnchors: string[];
  /** Zettelkasten concept-handle tags shown to learners (4-8, kebab-case).
   * This is the only tag field written to learner pages. */
  tags?: string[];
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
  generatedAt: string;
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
    sourceAnchors,
    tags: tags && tags.length > 0 ? tags : undefined,
    visualIds,
    sourceVisualIds:
      sourceVisualIds && sourceVisualIds.length > 0 ? sourceVisualIds : undefined,
    sourceFormulaAnchors:
      sourceFormulaAnchors && sourceFormulaAnchors.length > 0 ? sourceFormulaAnchors : undefined,
    formulas: formulas && formulas.length > 0 ? formulas.map((entry) => ({ ...entry })) : undefined,
    learningUnitId,
    learningUnitRole,
    generatedBy: "learn_button",
    generated_by: "learn_button",
    learningVersion: visibleVersionId,
    learningVersionId: visibleVersionId,
    sourceSetHash,
  });
}

function conceptPlansForSource(
  source: LearnSourceSummary,
  concepts: LearnConceptSummary[],
): LearningSubsectionPlan[] {
  const matches = concepts
    .filter((concept) => !concept.sourceDocument || concept.sourceDocument === source.slug)
    .slice(0, 6);

  return matches.map((concept) => ({
    title: sanitizeLearnerTitle(concept.title),
    purpose: concept.excerpt || `Develop the core idea of ${concept.title} directly for the learner.`,
    sourceAnchors:
      concept.locations && concept.locations.length > 0
        ? concept.locations.map((location) => `${source.title}: ${location}`)
        : [source.title],
    visualOpportunities: [],
    conceptTags: concept.tags ?? [],
    sourceVisualIds: [],
    interactiveVisuals: [],
  }));
}

function headingPlansForSource(source: LearnSourceSummary): LearningSubsectionPlan[] {
  const body = source.body ?? "";
  const headings = [...body.matchAll(/^#{2,3}\s+(.+)$/gm)]
    .map((match) => compact(match[1] ?? ""))
    .filter((heading) => heading && !/^(summary|source material|textbook coverage|internal planning)$/i.test(heading))
    .slice(0, 5);

  return headings.map((heading) => ({
    title: sanitizeLearnerTitle(heading),
    purpose: `Teach the ideas organized under "${heading}" directly.`,
    sourceAnchors: [source.title],
    visualOpportunities: [],
    conceptTags: source.tags ?? [],
    sourceVisualIds: [],
    interactiveVisuals: [],
  }));
}

export function fallbackLearningMapFromSources(
  context: LearnContextSummary,
  options: { sourceOnly?: boolean; createdAt?: string } = {},
): ProposedLearningMap {
  const concepts = context.concepts ?? [];
  const sources = context.sources.length > 0
    ? context.sources
    : [
        {
          id: "source",
          slug: "source",
          title: context.gardenTitle || "Uploaded Sources",
          relPath: "sources/source.md",
        },
      ];

  const sections = sources.slice(0, 8).map((source) => {
    const fromConcepts = conceptPlansForSource(source, concepts);
    const fromHeadings = fromConcepts.length > 0 ? [] : headingPlansForSource(source);
    const subsections =
      fromConcepts.length > 0
        ? fromConcepts
        : fromHeadings.length > 0
          ? fromHeadings
          : [
              {
                title: sanitizeLearnerTitle(`${source.title} Foundations`),
                purpose: "Establish the central ideas and vocabulary.",
                sourceAnchors: [source.title],
                visualOpportunities: [],
                conceptTags: source.tags ?? [],
                sourceVisualIds: [],
                interactiveVisuals: [],
              },
              {
                title: sanitizeLearnerTitle(`${source.title} Core Ideas`),
                purpose: "Connect definitions, formulas, examples, and figures into a learning path.",
                sourceAnchors: [source.title],
                visualOpportunities: [],
                conceptTags: source.tags ?? [],
                sourceVisualIds: [],
                interactiveVisuals: [],
              },
              {
                title: sanitizeLearnerTitle(`${source.title} Practice and Synthesis`),
                purpose: "Use worked examples and questions to consolidate the chain of reasoning.",
                sourceAnchors: [source.title],
                visualOpportunities: [],
                conceptTags: source.tags ?? [],
                sourceVisualIds: [],
                interactiveVisuals: [],
              },
            ];

    return {
      title: sanitizeLearnerTitle(source.title),
      purpose: `Teach the material of ${source.title} as an ordered lesson sequence.`,
      sourceAnchors: [source.title],
      subsections,
    };
  });

  return {
    gardenId: context.gardenId,
    title: `${context.gardenTitle || context.gardenId} Learning Garden`,
    summary:
      context.sources.length > 0
        ? `A learning garden generated from ${context.sources.length} uploaded source${context.sources.length === 1 ? "" : "s"}.`
        : "A learning garden plan. Upload sources for stronger coverage.",
    sections,
    warnings: context.sources.length > 0 ? [] : ["No uploaded source documents were found."],
    sourceOnly: options.sourceOnly ?? true,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

function normalizeInteractiveVisualPlans(raw: unknown): InteractiveVisualPlan[] {
  if (!Array.isArray(raw)) return [];
  const plans: InteractiveVisualPlan[] = [];
  for (const item of raw.slice(0, 3)) {
    if (typeof item === "string" && item.trim()) {
      plans.push({ concept: compact(item), reason: "" });
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const concept = asString(record.concept ?? record.title ?? record.name);
      if (!concept) continue;
      plans.push({ concept, reason: asString(record.reason ?? record.why, "") });
    }
  }
  return plans;
}

function normalizeSubsection(raw: unknown, fallbackTitle: string): LearningSubsectionPlan {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    title: sanitizeLearnerTitle(asString(record.title ?? record.name, fallbackTitle)),
    purpose: asString(record.purpose ?? record.goal ?? record.summary, ""),
    sourceAnchors: asStringArray(record.sourceAnchors ?? record.sources ?? record.anchors),
    visualOpportunities: asStringArray(
      record.visualOpportunities ?? record.visuals ?? record.visual_opportunities,
    ),
    conceptTags: asStringArray(record.conceptTags ?? record.tags ?? record.concepts),
    sourceVisualIds: asStringArray(
      record.sourceVisualsToEmbed ?? record.sourceVisualIds ?? record.source_visuals,
    ),
    interactiveVisuals: normalizeInteractiveVisualPlans(
      record.interactiveVisualsToCreate ?? record.interactiveVisuals ?? record.interactive_visuals,
    ),
  };
}

function normalizeSection(raw: unknown, index: number): LearningSectionPlan {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const title = sanitizeLearnerTitle(
    asString(record.title ?? record.name, `Section ${index + 1}`),
  );
  const rawSubsections =
    record.subsections ??
    record.items ??
    record.topics ??
    record.children ??
    [];
  const subsections = Array.isArray(rawSubsections)
    ? rawSubsections
        .slice(0, 8)
        .map((item, subsectionIndex) =>
          normalizeSubsection(item, `${title} ${subsectionIndex + 1}`),
        )
    : [];
  return {
    title,
    purpose: asString(record.purpose ?? record.goal ?? record.summary, ""),
    sourceAnchors: asStringArray(record.sourceAnchors ?? record.sources ?? record.anchors),
    subsections:
      subsections.length > 0
        ? subsections
        : [
            {
              title,
              purpose: `Teach ${title} directly, starting from intuition.`,
              sourceAnchors: asStringArray(record.sourceAnchors ?? record.sources ?? record.anchors),
              visualOpportunities: [],
              conceptTags: [],
              sourceVisualIds: [],
              interactiveVisuals: [],
            },
          ],
  };
}

export function normalizeLearningMapCandidate(
  candidate: unknown,
  context: LearnContextSummary,
  options: { sourceOnly?: boolean; createdAt?: string } = {},
): ProposedLearningMap {
  const fallback = fallbackLearningMapFromSources(context, options);
  const record = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : {};
  const nested =
    (record.learningSpine && typeof record.learningSpine === "object" ? record.learningSpine : null) ??
    (record.learningMap && typeof record.learningMap === "object" ? record.learningMap : null) ??
    (record.topicMap && typeof record.topicMap === "object" ? record.topicMap : null) ??
    record;
  const source = nested as Record<string, unknown>;
  const rawSections =
    source.sections ??
    source.proposedSections ??
    source.proposedOrder ??
    source.textbookSections ??
    [];
  const sections = Array.isArray(rawSections)
    ? rawSections.slice(0, 12).map((item, index) => normalizeSection(item, index))
    : [];

  if (sections.length === 0) return fallback;

  return {
    gardenId: context.gardenId,
    title: asString(source.title ?? record.title, fallback.title),
    summary: asString(source.summary ?? record.summary, fallback.summary),
    sections,
    warnings: [
      ...asStringArray(source.warnings ?? record.warnings),
      ...fallback.warnings,
    ],
    sourceOnly: options.sourceOnly ?? fallback.sourceOnly,
    createdAt: options.createdAt ?? fallback.createdAt,
  };
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
