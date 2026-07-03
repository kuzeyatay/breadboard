import { createHash } from "crypto";

export const LEARN_STATUSES = [
  "idle",
  "planning",
  "awaiting_confirmation",
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

type FrontmatterValue = string | number | boolean | string[] | undefined | null;

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

/** True when the markdown contains meta-instruction / placeholder language. */
export function hasPlaceholderText(markdown: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(markdown));
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
 * Local quality critic run before a lesson page is written. Hard problems
 * (placeholder text, no question/answer, no real prose, an assigned visual that
 * never got embedded) should block the write / trigger a retry. Soft problems
 * (short, too many AI-isms, no obvious example) are advisory.
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
  if (words < minWords) {
    problems.push({ code: "short", message: `${words} words (< ${minWords})`, hard: false });
  }
  const aiisms = countAiisms(body);
  if (aiisms > 2) {
    problems.push({ code: "aiisms", message: `${aiisms} AI-style phrases`, hard: false });
  }
  const hasExample = /\b(for example|for instance|imagine|consider|suppose|think of|picture)\b/i.test(body);
  if (!hasExample) {
    problems.push({ code: "no-example", message: "no concrete example / analogy cue", hard: false });
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

/** Known typo/abbreviation roots to repair in the domain namespace segment. */
const TAG_ROOT_FIXES: Record<string, string> = {
  sn: "snn",
  dl: "deep-learning",
  ml: "machine-learning",
  nn: "neural-networks",
  cnn: "cnn",
};

/**
 * Concept → hierarchical tag lexicon. When a lesson body mentions one of these
 * durable concepts, we emit the exact clean tag (already namespaced), which is
 * far more reliable than namespacing whatever noisy words the planner produced.
 * Ordered longest/most-specific first. General enough to be harmless on other
 * domains (it only fires on literal keyword matches).
 */
const CONCEPT_TAG_LEXICON: Array<[RegExp, string]> = [
  [/\bleaky integrate[- ]and[- ]fire\b|\blif neuron\b|\blif model\b/i, "snn/lif-neuron"],
  [/\bmembrane potential\b/i, "computational-neuroscience/membrane-potential"],
  [/\b(?:firing )?threshold\b|\bthreshold crossing\b/i, "snn/threshold-firing"],
  [/\brefractory\b|\breset (?:potential|behavior)\b/i, "snn/reset-dynamics"],
  [/\bspike[- ]timing[- ]dependent plasticity\b|\bstdp\b/i, "snn/stdp"],
  [/\bsynaptic (?:plasticity|weight)\b/i, "learning-rules/synaptic-plasticity"],
  [/\bspike timing\b/i, "computational-neuroscience/spike-timing"],
  [/\bsurrogate gradient\b/i, "snn/surrogate-gradient-training"],
  [/\bnon[- ]differentiab\w+\b/i, "optimization/non-differentiable-spikes"],
  [/\bbackpropagation\b|\bbackprop\b/i, "deep-learning/backpropagation"],
  [/\bann[- ]to[- ]snn\b|\bann to snn\b|\bconversion\b/i, "snn/ann-to-snn-conversion"],
  [/\brate coding\b/i, "snn/rate-coding"],
  [/\btemporal coding\b/i, "snn/temporal-coding"],
  [/\bspike (?:coding|encoding)\b|\bencoding information as spikes\b/i, "snn/spike-coding"],
  [/\bevent[- ]driven\b/i, "snn/event-driven-computation"],
  [/\blateral inhibition\b/i, "computational-neuroscience/lateral-inhibition"],
  [/\bneuromorphic\b|\bloihi\b|\btruenorth\b/i, "neuromorphic-computing/event-driven-hardware"],
  [/\bedge (?:ai|device|computing)\b/i, "edge-ai/real-time-inference"],
  [/\benergy (?:efficiency|per inference|consumption)\b/i, "edge-ai/energy-efficiency"],
  [/\blatency\b|\bresponse time\b/i, "model-evaluation/latency"],
  [/\bspike count\b/i, "model-evaluation/spike-count"],
  [/\bconvergence\b/i, "model-evaluation/convergence"],
  [/\bspiking neural network\b|\bsnns?\b/i, "snn/spiking-neural-networks"],
];

/** Pull already-clean hierarchical tag seeds from a lesson body by matching the
 * concept lexicon. Returns [] when nothing durable is mentioned. */
export function extractTagSeeds(body: string): string[] {
  const seeds: string[] = [];
  for (const [pattern, tag] of CONCEPT_TAG_LEXICON) {
    if (pattern.test(body) && !seeds.includes(tag)) seeds.push(tag);
  }
  return seeds;
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

/**
 * Normalizes learner-page tags into 3-5 stable, hierarchical, concept tags
 * ("snn/lif-neuron" style). Flat tags get namespaced under a short domain
 * acronym; typo roots are repaired; debris/generic segments are dropped;
 * too-few results are topped up from the subsection title.
 */
export function normalizeZettelTags(
  rawTags: string[],
  topicHint: string,
  domainHint: string,
): string[] {
  const domain = domainNamespace(domainHint);
  const seen = new Set<string>();
  const output: string[] = [];

  const push = (candidate: string) => {
    if (output.length >= 5) return;
    const segments = candidate
      .split("/")
      .map((segment) => zettelSegmentSlug(segment))
      .filter(Boolean);
    if (segments.length === 0) return;
    // Repair typo/abbrev roots in the namespace segment.
    if (segments.length > 1 && TAG_ROOT_FIXES[segments[0]]) {
      segments[0] = TAG_ROOT_FIXES[segments[0]];
    }
    const namespaced = segments.length === 1 ? [domain, segments[0]] : segments.slice(0, 3);
    // Every segment must be a real concept word, not debris or a bare number.
    if (namespaced.some((segment) => ZETTEL_TAG_BANLIST.has(segment))) return;
    if (namespaced.some((segment) => segment.length < 2 || /^\d+$/.test(segment))) return;
    // The leaf (last) segment must not be a lone generic word.
    const leaf = namespaced[namespaced.length - 1];
    if (leaf.split("-").every((word) => TAG_STOPWORDS.has(word) || ZETTEL_TAG_BANLIST.has(word))) {
      return;
    }
    const tag = namespaced.join("/");
    if (tag.length > 60 || seen.has(tag)) return;
    seen.add(tag);
    output.push(tag);
  };

  for (const raw of rawTags) {
    if (output.length >= 5) break;
    if (typeof raw === "string" && raw.trim()) push(raw);
  }

  if (output.length < 3) {
    const topicSlug = zettelSegmentSlug(topicHint);
    if (topicSlug) push(`${domain}/${topicSlug}`);
  }

  return output.slice(0, 5);
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
      lines.push(`${key}: [${value.map((item) => yamlScalar(item)).join(", ")}]`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  return `---\n${lines.join("\n")}\n---\n\n`;
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
  learningVersionId,
  sourceSetHash,
  generatedAt,
}: {
  gardenId: string;
  sectionNumber: number;
  subsectionNumber: number;
  title: string;
  sourceAnchors: string[];
  /** Hierarchical zettel tags shown to learners (3-5, "snn/lif-neuron" style).
   * This is the only tag field written to learner pages. */
  tags?: string[];
  visualIds: string[];
  /** Source visuals (S1.P4.F1 style) embedded in this page's body. */
  sourceVisualIds?: string[];
  learningVersionId: string;
  sourceSetHash?: string;
  generatedAt: string;
}): string {
  // No `conceptTags`, no `textbook*` keys: learner pages carry clean `tags:`
  // and never contain the word "textbook" anywhere in their frontmatter.
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
    generatedBy: "learn_button",
    generated_by: "learn_button",
    learningVersion: learningVersionId,
    learningVersionId,
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
