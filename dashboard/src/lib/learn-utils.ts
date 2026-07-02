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

export interface LearningSubsectionPlan {
  title: string;
  purpose: string;
  sourceAnchors: string[];
  visualOpportunities: string[];
  conceptTags: string[];
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
  visualIds,
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
  visualIds: string[];
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
    visualIds,
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
    title: concept.title,
    purpose: concept.excerpt || `Develop the core idea of ${concept.title} from the source material.`,
    sourceAnchors:
      concept.locations && concept.locations.length > 0
        ? concept.locations.map((location) => `${source.title}: ${location}`)
        : [source.title],
    visualOpportunities: [],
    conceptTags: concept.tags ?? [],
  }));
}

function headingPlansForSource(source: LearnSourceSummary): LearningSubsectionPlan[] {
  const body = source.body ?? "";
  const headings = [...body.matchAll(/^#{2,3}\s+(.+)$/gm)]
    .map((match) => compact(match[1] ?? ""))
    .filter((heading) => heading && !/^(summary|source material|textbook coverage|internal planning)$/i.test(heading))
    .slice(0, 5);

  return headings.map((heading) => ({
    title: heading,
    purpose: `Explain the source material organized under "${heading}".`,
    sourceAnchors: [source.title],
    visualOpportunities: [],
    conceptTags: source.tags ?? [],
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
                title: `${source.title} Overview`,
                purpose: "Establish the source's central ideas and vocabulary.",
                sourceAnchors: [source.title],
                visualOpportunities: [],
                conceptTags: source.tags ?? [],
              },
              {
                title: `${source.title} Core Ideas`,
                purpose: "Connect definitions, formulas, examples, and figures into a learning path.",
                sourceAnchors: [source.title],
                visualOpportunities: [],
                conceptTags: source.tags ?? [],
              },
              {
                title: `${source.title} Practice and Synthesis`,
                purpose: "Use source examples and questions to consolidate the chain of reasoning.",
                sourceAnchors: [source.title],
                visualOpportunities: [],
                conceptTags: source.tags ?? [],
              },
            ];

    return {
      title: source.title,
      purpose: `Turn ${source.title} into an ordered textbook section.`,
      sourceAnchors: [source.title],
      subsections,
    };
  });

  return {
    gardenId: context.gardenId,
    title: `${context.gardenTitle || context.gardenId} Textbook`,
    summary:
      context.sources.length > 0
        ? `A source-aware textbook generated from ${context.sources.length} uploaded source${context.sources.length === 1 ? "" : "s"}.`
        : "A source-aware textbook plan. Upload sources for stronger coverage.",
    sections,
    warnings: context.sources.length > 0 ? [] : ["No uploaded source documents were found."],
    sourceOnly: options.sourceOnly ?? true,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

function normalizeSubsection(raw: unknown, fallbackTitle: string): LearningSubsectionPlan {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    title: asString(record.title ?? record.name, fallbackTitle),
    purpose: asString(record.purpose ?? record.goal ?? record.summary, ""),
    sourceAnchors: asStringArray(record.sourceAnchors ?? record.sources ?? record.anchors),
    visualOpportunities: asStringArray(
      record.visualOpportunities ?? record.visuals ?? record.visual_opportunities,
    ),
    conceptTags: asStringArray(record.conceptTags ?? record.tags ?? record.concepts),
  };
}

function normalizeSection(raw: unknown, index: number): LearningSectionPlan {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const title = asString(record.title ?? record.name, `Section ${index + 1}`);
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
              title: `${title} Overview`,
              purpose: `Introduce ${title} from the uploaded sources.`,
              sourceAnchors: asStringArray(record.sourceAnchors ?? record.sources ?? record.anchors),
              visualOpportunities: [],
              conceptTags: [],
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
  return `${markdown.trim()}\n\n**Question.** What is the main learning move in ${title}?\n\n**Answer.** The main move is to connect the source's definitions, examples, and any formulas into one chain of reasoning. A good answer names the starting idea, explains why the next idea is needed, and checks the conclusion against the source anchors for this subsection.\n`;
}
