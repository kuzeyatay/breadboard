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

/** Debris/generic tags that are banned from learner-facing pages. */
export const ZETTEL_TAG_BANLIST = new Set([
  "paper", "source", "sources", "what", "model", "models", "test", "tests",
  "overview", "coverage", "visual", "visuals", "context", "contract", "scope",
  "abstract", "abstract-spiking", "accepted-october", "access-article",
  "garden", "note", "notes", "page", "pages", "section", "sections", "misc",
  "general", "document", "documents", "pdf", "file", "files", "upload",
  "uploads", "learning", "textbook", "introduction", "conclusion", "summary",
  "content", "material", "materials", "topic", "topics", "concept", "concepts",
]);

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

/**
 * Normalizes learner-page tags into 3-6 stable hierarchical concept tags
 * ("snn/lif-neuron" style). Flat tags get namespaced under the domain hint;
 * debris/generic segments are dropped; too-few results are topped up from the
 * subsection title so learner pages always carry useful tags.
 */
export function normalizeZettelTags(
  rawTags: string[],
  topicHint: string,
  domainHint: string,
): string[] {
  const domain = zettelSegmentSlug(domainHint) || "topic";
  const seen = new Set<string>();
  const output: string[] = [];

  const push = (candidate: string) => {
    const segments = candidate
      .split("/")
      .map((segment) => zettelSegmentSlug(segment))
      .filter(Boolean);
    if (segments.length === 0) return;
    const namespaced = segments.length === 1 ? [domain, segments[0]] : segments.slice(0, 3);
    if (namespaced.some((segment) => ZETTEL_TAG_BANLIST.has(segment))) return;
    if (namespaced.some((segment) => segment.length < 2 || /^\d+$/.test(segment))) return;
    const tag = namespaced.join("/");
    if (tag.length > 80 || seen.has(tag)) return;
    seen.add(tag);
    output.push(tag);
  };

  for (const raw of rawTags) {
    if (output.length >= 6) break;
    if (typeof raw === "string" && raw.trim()) push(raw);
  }

  if (output.length < 3) {
    const topicSlug = zettelSegmentSlug(topicHint);
    if (topicSlug) push(`${domain}/${topicSlug}`);
  }

  return output.slice(0, 6);
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

export function buildTextbookPageFrontmatter({
  gardenId,
  sectionNumber,
  subsectionNumber,
  title,
  sourceAnchors,
  conceptTags,
  tags,
  visualIds,
  sourceVisualIds,
  textbookVersionId,
  sourceSetHash,
  generatedAt,
}: {
  gardenId: string;
  sectionNumber: number;
  subsectionNumber: number;
  title: string;
  sourceAnchors: string[];
  conceptTags: string[];
  /** Hierarchical zettel tags shown to learners (3-6, "snn/lif-neuron" style). */
  tags?: string[];
  visualIds: string[];
  /** Source visuals (S1.P4.F1 style) embedded in this page's body. */
  sourceVisualIds?: string[];
  textbookVersionId: string;
  sourceSetHash?: string;
  generatedAt: string;
}): string {
  return yamlFrontmatter({
    title,
    date: generatedAt,
    knowledge_type: "textbook-page",
    breadboardType: "textbook_page",
    gardenId,
    sectionNumber,
    subsectionNumber: `${sectionNumber}.${subsectionNumber}`,
    sourceAnchors,
    conceptTags,
    tags: tags && tags.length > 0 ? tags : undefined,
    visualIds,
    sourceVisualIds:
      sourceVisualIds && sourceVisualIds.length > 0 ? sourceVisualIds : undefined,
    generatedBy: "learn_button",
    generated_by: "learn_button",
    textbookVersion: textbookVersionId,
    textbookVersionId,
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
  return `${markdown.trim()}\n\n**Question.** What is the main idea to take away from ${title}?\n\n**Answer.** The main move is to connect the definitions, examples, and any formulas in this page into one chain of reasoning. A good answer names the starting idea, explains why the next idea is needed, and checks the conclusion against the examples given above.\n`;
}
