import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  readGardenSemanticArtifacts,
  parseSemanticMarkdown,
  type Frontmatter,
} from "../garden-semantics.ts";
import type { ClusterKnowledge, KnowledgeNode } from "../knowledge.ts";
import type { AuthoredCandidate, ScoringDocument } from "./scoring.ts";
import type {
  EnrichmentText,
  TopologyFolder,
  TopologyNode,
  TopologyRelationType,
} from "./types.ts";

// v2: page summaries come from the document itself (`documentSummary`); the
// model only summarises pages that state nothing, plus folders and the Garden.
export const NODE_SUMMARY_PROMPT_VERSION = "thought-topology-node-summary-v2";
export const EDGE_EXPLANATION_PROMPT_VERSION =
  "thought-topology-edge-explanation-v1";
export const TOPOLOGY_EMBEDDING_MODEL = "local/bge-small-en-v1.5";

/** One embeddable span of a long document; see `documentSpans`. */
export interface TopologySpanProjection {
  /** Heading that names the span (a chapter title, or a page range). */
  label: string;
  /** Text handed to the embedder for this span alone. */
  text: string;
  /** Identity of `text`, the cache key for its vector. */
  hash: string;
}

export interface ProjectedTopologyNode extends TopologyNode, ScoringDocument {
  semanticText: string;
  lexicalText: string;
  claimTexts: string[];
  headings: string[];
  /** The page's own summary text when the document carries one; see
   * `documentSummary`. Null means the builder must ask the model. */
  documentSummary: string | null;
  /** Spans of a long document embedded separately; empty for ordinary pages. */
  spans: TopologySpanProjection[];
}

export interface GardenProjection {
  sourceRevision: string;
  folders: TopologyFolder[];
  nodes: ProjectedTopologyNode[];
  authoredEdges: AuthoredCandidate[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function titleFromFolder(folder: string): string {
  if (!folder) return "Garden root";
  return (folder.split("/").pop() ?? folder)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function folderId(folder: string): string {
  return `folder:${folder || "$root"}`;
}

function degradedText(text: string): EnrichmentText {
  return { state: "degraded", text };
}

// ---------------------------------------------------------------------------
// Publish rules. The map must show exactly what the Garden shows: every page
// and folder Quartz publishes, nothing it hides. These predicates mirror
// `quartz/quartz/plugins/filters/draft.ts` (RemoveDrafts); keep them in step.
// ---------------------------------------------------------------------------

const LEGACY_SUBTOPIC_SEGMENTS = new Set([
  "generated",
  "generated subtopics",
  "subtopics",
  "ai topics",
  "topic cards",
]);
const INTERNAL_KNOWLEDGE_TYPES = new Set([
  "internal-concept",
  "source-map",
  "scope-contract",
  "source-coverage",
]);
const INTERNAL_BREADBOARD_TYPES = new Set([
  "internal_concept",
  "source_map",
  "scope_contract",
  "source_coverage",
]);
const LESSON_KNOWLEDGE_TYPES = new Set([
  "learning-page",
  "learning-section",
  "textbook-page",
  "textbook-section",
]);
const LESSON_BREADBOARD_TYPES = new Set([
  "learning_page",
  "learning_section",
  "textbook_page",
  "textbook_section",
]);

function pathSegments(relPath: string): string[] {
  return normalizeRel(relPath).toLowerCase().split("/").filter(Boolean);
}

function isLegacySubtopicPath(relPath: string): boolean {
  const parts = pathSegments(relPath);
  return parts.some(
    (part, index) =>
      LEGACY_SUBTOPIC_SEGMENTS.has(part) ||
      (part === "legacy" && parts[index + 1] === "generated subtopics"),
  );
}

/** Internal/, .breadboard/ and numbered source-snapshot folders never publish. */
function isInternalPath(relPath: string): boolean {
  return pathSegments(relPath).some(
    (part) =>
      part === "internal" ||
      part === ".breadboard" ||
      /^\d+\.\s*source-snapshots$/.test(part),
  );
}

function isInternalLearningArtifact(relPath: string): boolean {
  const lower = normalizeRel(relPath).toLowerCase();
  return (
    lower.endsWith("learning/source map.md") ||
    lower.endsWith("learning/scope contract.md") ||
    lower.endsWith("learning/source coverage.md")
  );
}

function slugifyLoose(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRawFileArtifactPage(title: string, sourceFile: string): boolean {
  const cleanTitle = title.replace(/^\d+(?:\.\d+)*\.?\s*/, "");
  const cleanSource = sourceFile.replace(
    /\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|zip|png|jpe?g|webp)$/i,
    "",
  );
  if (!cleanTitle || !cleanSource) return false;
  return slugifyLoose(cleanTitle) === slugifyLoose(cleanSource);
}

export interface PublishCandidate {
  relPath: string;
  knowledgeType: string;
  breadboardType: string;
  internal: string;
  draft: string;
  generatedBy: string;
  legacySubtopicPage: string;
  title: string;
  sourceFile: string;
}

/** Whether Quartz publishes this Markdown file (see RemoveDrafts). */
export function quartzPublishesMarkdown(candidate: PublishCandidate): boolean {
  const relPath = normalizeRel(candidate.relPath);
  if (
    candidate.legacySubtopicPage === "true" ||
    isLegacySubtopicPath(relPath)
  )
    return false;
  const draft = candidate.draft === "true";
  const isSource =
    candidate.knowledgeType === "source-document" ||
    candidate.breadboardType === "source_document" ||
    pathSegments(relPath).includes("sources");
  if (isSource) return !draft;
  const isLesson =
    LESSON_KNOWLEDGE_TYPES.has(candidate.knowledgeType) ||
    LESSON_BREADBOARD_TYPES.has(candidate.breadboardType);
  // Lesson pages publish when Learn wrote them, or when document ingestion
  // stamped them as source-derived concepts under Concepts/. Unstamped
  // ingest-era lesson pages remain hidden scaffolding (RemoveDrafts:
  // isLearnAuthored / isDocumentIngestConcept).
  const authoredLesson =
    candidate.generatedBy === "learn_button" ||
    (candidate.generatedBy === "document_ingestion" &&
      pathSegments(relPath).includes("concepts"));
  if (
    INTERNAL_KNOWLEDGE_TYPES.has(candidate.knowledgeType) ||
    INTERNAL_BREADBOARD_TYPES.has(candidate.breadboardType) ||
    candidate.internal === "true" ||
    isInternalPath(relPath) ||
    isInternalLearningArtifact(relPath) ||
    isRawFileArtifactPage(candidate.title, candidate.sourceFile) ||
    (isLesson && !authoredLesson)
  )
    return false;
  return !draft;
}

function frontmatterString(data: Frontmatter, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value.trim() : "";
}

export const DOCUMENT_SUMMARY_VERSION = "document-summary-v1";
const SUMMARY_SECTION_HEADING =
  /^(summary|overview|what this covers|core ideas|key ideas|abstract|introduction)\b/i;
const SUMMARY_WORD_LIMIT = 80;

function plainParagraphs(markdown: string): string[] {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias ?? target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\^?[^\]]+\]/g, " ")
    .split(/\n\s*\n/)
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !/^\s*(?:\|.*\||<[^>]+>|---+|\*\*\*+)\s*$/.test(line))
        .join(" ")
        .replace(/^\s{0,3}(?:[-*+] |\d+[.)] |> ?)/gm, "")
        .replace(/[*_`~]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((part) => part.length >= 40 && /[a-z]/i.test(part));
}

/** First sentences of `text` up to about `limit` words, on a sentence edge. */
export function clipToWords(text: string, limit = SUMMARY_WORD_LIMIT): string {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [text];
  const kept: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    const count = sentence.trim().split(/\s+/).length;
    if (kept.length > 0 && words + count > limit) break;
    kept.push(sentence.trim());
    words += count;
    if (words >= limit) break;
  }
  let result = kept.join(" ").trim();
  if (words > limit) {
    result = `${result.split(/\s+/).slice(0, limit).join(" ").replace(/[,;:\s]+$/, "")}…`;
  }
  return result;
}

/**
 * The summary a document states about itself, so the map shows what the page
 * says rather than what a model guessed: a `description`/`summary`
 * frontmatter field first; then the lead paragraphs before the first section;
 * then the opening of a summary-like section. Source documents (transcripts,
 * PDFs) only ever use their description — their body is raw material.
 */
export function documentSummary(node: Pick<KnowledgeNode, "type" | "content">): string | null {
  const parsed = parseSemanticMarkdown(node.content);
  const declared =
    frontmatterString(parsed.data, "description") ||
    frontmatterString(parsed.data, "summary");
  if (declared.length >= 20) return clipToWords(declared);
  if (node.type === "source-document") return null;

  const lines = parsed.body.split(/\r?\n/);
  const sections: Array<{ heading: string; lines: string[] }> = [{ heading: "", lines: [] }];
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      // A single title heading (H1) does not open a section of its own.
      if (heading[1].length === 1 && sections.length === 1 && sections[0].lines.every((item) => !item.trim())) continue;
      sections.push({ heading: heading[2].replace(/[#*_`]/g, "").trim(), lines: [] });
      continue;
    }
    sections[sections.length - 1].lines.push(line);
  }
  // A summary-like section wins when the page has one; otherwise the first
  // section that contains prose is the page's lead, whatever its heading
  // (many pages open with an H2 repeating the title, then the lead paragraph).
  const candidates = [
    ...sections.filter((section) => SUMMARY_SECTION_HEADING.test(section.heading)),
    ...sections,
  ];
  for (const section of candidates) {
    const raw = section.lines.join("\n");
    // Prose before lists: a page that opens with a bullet list of links (a
    // Learning Map, a table of contents) is better described by its first
    // sentence than by the first bullet.
    const prose = plainParagraphs(raw.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+.*$/gm, ""));
    const paragraphs = prose.length > 0 ? prose : plainParagraphs(raw);
    if (paragraphs.length === 0) continue;
    const text = clipToWords(paragraphs.slice(0, 2).join(" "));
    if (text.length >= 40) return text;
  }
  return null;
}

/** Folder index pages (`_index.md`) publish the folder itself, not a page. */
function isFolderIndex(relPath: string): boolean {
  return /(^|\/)_?index\.md$/i.test(normalizeRel(relPath));
}

function visibleMarkdown(node: KnowledgeNode): boolean {
  const rel = normalizeRel(node.relPath);
  if (!rel || isFolderIndex(rel)) return false;
  return quartzPublishesMarkdown({
    relPath: rel,
    knowledgeType: node.type,
    breadboardType: node.breadboardType,
    internal: node.internal,
    draft: node.draft,
    generatedBy: node.generatedBy || node.generated_by,
    legacySubtopicPage: "",
    title: node.title,
    sourceFile: node.sourceFile,
  });
}

/** Whether a folder's own index page publishes, which makes the folder itself
 * appear in the Garden even when it holds no other page. */
function folderIndexPublishes(absoluteFolder: string, relative: string): boolean {
  for (const name of ["_index.md", "index.md"]) {
    const file = path.join(absoluteFolder, name);
    if (!fs.existsSync(file)) continue;
    let content = "";
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      return false;
    }
    const data = parseSemanticMarkdown(content).data;
    return quartzPublishesMarkdown({
      relPath: `${relative}/${name}`,
      knowledgeType: frontmatterString(data, "knowledge_type"),
      breadboardType:
        frontmatterString(data, "breadboardType") ||
        frontmatterString(data, "breadboard_type"),
      internal: frontmatterString(data, "internal"),
      draft: frontmatterString(data, "draft"),
      generatedBy:
        frontmatterString(data, "generated_by") ||
        frontmatterString(data, "generatedBy"),
      legacySubtopicPage: frontmatterString(data, "legacy_subtopic_page"),
      title: frontmatterString(data, "title"),
      sourceFile: frontmatterString(data, "source_file"),
    });
  }
  return false;
}

const FINGERPRINT_IGNORED = new Set([".breadboard", "assets", ".git", "node_modules"]);

/**
 * Cheap identity of the Garden's Markdown tree (paths, sizes, mtimes and the
 * folders themselves). Built pages compare it against the build-time value to
 * notice content that arrived through a write path that never queued a
 * rebuild. It deliberately reads no file bodies.
 */
export function gardenContentFingerprint(gardenDir: string): string {
  const entries: string[] = [];
  const visit = (absolute: string, relative: string) => {
    let children: fs.Dirent[] = [];
    try {
      children = fs.readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of children) {
      if (FINGERPRINT_IGNORED.has(entry.name)) continue;
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        entries.push(`${next}/`);
        visit(path.join(absolute, entry.name), next);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        try {
          const stat = fs.statSync(path.join(absolute, entry.name));
          entries.push(`${next}\u0000${stat.size}\u0000${Math.round(stat.mtimeMs)}`);
        } catch {
          entries.push(`${next}\u0000unreadable`);
        }
      }
    }
  };
  visit(gardenDir, "");
  return sha256(entries.sort().join("\n"));
}

/**
 * Sections ingest appends to every generated concept page: the grounding
 * excerpt of the source transcript, source anchors, and the related-page
 * list. They are apparatus shared by every page cut from the same source,
 * so a vector that reads them describes the source, not the concept. The
 * page's own prose is what should embed; these sections are dropped from
 * the semantic projection (lexical scoring still sees the whole page).
 */
const SCAFFOLD_SECTION_HEADINGS =
  /^(?:page[- ]grounded details|source anchors|related pages|source information|internal planning|textbook coverage|source snapshots)$/i;

export function authoredBody(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  let skippingLevel = 0;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      if (skippingLevel && level <= skippingLevel) skippingLevel = 0;
      if (!skippingLevel && SCAFFOLD_SECTION_HEADINGS.test(cleanHeading(heading[2]))) {
        skippingLevel = level;
        continue;
      }
    }
    // Page-level provenance lines ("Source: [[...]]", "Locations: ...") that
    // ingest writes above the prose describe where the page came from.
    if (!skippingLevel && !/^(?:Source|Locations|Source file):\s/.test(line)) kept.push(line);
  }
  return kept.join("\n");
}

/** Up to eight passages: the page's opening paragraph first, because it
 * states what the page is about, then the longest remaining ones. */
function meaningfulPassages(body: string): string[] {
  const parts = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\^?[^\]]+\]/g, " ")
    .split(/\n\s*\n/)
    .map((part) =>
      part
        .replace(/^\s{0,3}(?:[-*+] |\d+[.)] |> ?)/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((part) => part.length >= 45);
  if (parts.length === 0) return [];
  const [lead, ...rest] = parts;
  return [lead, ...rest.sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  )]
    .slice(0, 8)
    .map((part) => part.slice(0, 700));
}

/**
 * Headings that only mark position ("Page 12", a transcript's "00:05:00-
 * 00:10:00") say nothing about content. They would otherwise fill the whole
 * heading budget of a scanned book or a transcript with noise that every
 * such document shares, which made unrelated transcripts look alike.
 */
function isPositionalHeading(heading: string): boolean {
  return (
    /^page\s+\d+\s*$/i.test(heading) ||
    /^\d{1,2}:\d{2}(?::\d{2})?\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?$/.test(heading)
  );
}

function cleanHeading(raw: string): string {
  return raw.replace(/[#*_`]/g, "").trim();
}

// ---------------------------------------------------------------------------
// Spans. One vector for a 200,000-word textbook is a blur of every topic it
// covers, so it sits at a middling distance from every page about one topic
// and never clears the affinity floor, even though chapter 9 is plainly about
// the same thing as the lecture on Faraday's law. Documents past
// SPAN_MIN_CHARS are therefore also projected as SPAN_TARGET_CHARS-sized
// spans split on headings, each embedded on its own; scoring takes the best
// span match (see `sectionAwareEmbeddingAffinity`). The embedder reads only
// the first few hundred tokens of a text, so each span is condensed to its
// headings and a few passages sampled across it rather than its full body.
// ---------------------------------------------------------------------------
// A lecture transcript (60-70k characters) is one topic and stays one
// vector; spans start where a document plainly holds several topics.
export const SPAN_MIN_CHARS = 100_000;
const SPAN_TARGET_CHARS = 48_000;
const SPAN_MIN_COUNT = 3;
const SPAN_MAX_COUNT = 32;
const SPAN_TEXT_LIMIT = 1_800;
const SPAN_MIN_TEXT = 240;
const SPAN_HEADING_LIMIT = 14;
const SPAN_PASSAGE_LIMIT = 10;
const SPAN_PASSAGE_CHARS = 300;

interface MarkdownBlock {
  heading: string | null;
  level: number;
  text: string;
}

function markdownBlocks(body: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [{ heading: null, level: 0, text: "" }];
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ heading: cleanHeading(heading[2]), level: heading[1].length, text: "" });
      continue;
    }
    blocks[blocks.length - 1].text += `${line}\n`;
  }
  return blocks.filter((block) => block.heading !== null || block.text.trim());
}

/** Passages spread across a span: its opening, middle and end rather than
 * its longest paragraphs, so the sample describes the span as a whole. */
function sampledPassages(text: string, limit: number): string[] {
  const passages = plainParagraphs(text.replace(/\$\$[\s\S]*?\$\$/g, " "));
  if (passages.length <= limit) return passages.map((part) => part.slice(0, SPAN_PASSAGE_CHARS));
  const picked: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const at = Math.min(passages.length - 1, Math.round((index * (passages.length - 1)) / Math.max(1, limit - 1)));
    picked.push(passages[at].slice(0, SPAN_PASSAGE_CHARS));
  }
  return picked;
}

/** Headings that name apparatus rather than a topic: worked examples, problem
 * sets, reference lists, ingest scaffolding. They label a span only when it
 * holds nothing better. */
function isBoilerplateHeading(heading: string): boolean {
  return /^(?:example\s+\d|d\d+\.\d+|references$|(?:chapter\s+\d+\s+)?problems$|source snapshots$|textbook coverage$|internal planning$|source material$)/i.test(
    heading,
  );
}

function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The heading covering the most text; ties go to the earliest in the span. */
function largest(coverage: ReadonlyMap<string, number>, exclude?: string): string | null {
  let best: string | null = null;
  let bestSize = -1;
  for (const [heading, size] of coverage) {
    if (heading === exclude) continue;
    if (size > bestSize) {
      best = heading;
      bestSize = size;
    }
  }
  return best;
}

/** The embeddable spans of a long document; empty for ordinary pages. */
export function documentSpans(title: string, body: string): TopologySpanProjection[] {
  if (body.length < SPAN_MIN_CHARS) return [];
  const blocks = markdownBlocks(body);
  if (blocks.length < 2) return [];
  // A heading is topical when it names content: not a page marker, not a
  // timestamp, and not the document's own title repeated as a heading.
  const documentTitle = normalizeHeading(title);
  const topical = (block: MarkdownBlock): block is MarkdownBlock & { heading: string } =>
    Boolean(block.heading) &&
    !isPositionalHeading(block.heading!) &&
    normalizeHeading(block.heading!) !== documentTitle;
  // Chapters are the headings at the shallowest level that holds at least a
  // few topical titles (a lone "Source material" wrapper above a book's real
  // chapters is not a chapter level). A chapter owns every block up to the
  // next chapter, across span boundaries, so a span that starts in the
  // middle of a chapter is still named by that chapter; apparatus headings
  // (problem sets, references) never take ownership.
  const topicalLevels = new Map<number, number>();
  for (const block of blocks) {
    if (topical(block) && !isBoilerplateHeading(block.heading)) {
      topicalLevels.set(block.level, (topicalLevels.get(block.level) ?? 0) + 1);
    }
  }
  const levels = [...topicalLevels.keys()].sort((left, right) => left - right);
  const chapterLevel = levels.find((level) => (topicalLevels.get(level) ?? 0) >= SPAN_MIN_COUNT) ?? levels[0] ?? Infinity;
  const startsChapter = (block: MarkdownBlock) =>
    topical(block) && block.level === chapterLevel && !isBoilerplateHeading(block.heading);
  const count = Math.max(SPAN_MIN_COUNT, Math.min(SPAN_MAX_COUNT, Math.round(body.length / SPAN_TARGET_CHARS)));
  const budget = body.length / count;
  const groups: MarkdownBlock[][] = [];
  let current: MarkdownBlock[] = [];
  let currentChars = 0;
  for (const block of blocks) {
    const size = (block.heading?.length ?? 0) + block.text.length;
    // Split preferably where a chapter starts, once the span is two thirds
    // full; otherwise once it has outgrown its budget by a third.
    const full = startsChapter(block)
      ? currentChars >= budget * 0.66
      : currentChars + size > budget * 1.34;
    if (current.length > 0 && full && groups.length < count - 1) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(block);
    currentChars += size;
  }
  if (current.length > 0) groups.push(current);
  if (groups.length < SPAN_MIN_COUNT) return [];

  let chapter: string | null = null;
  const used = new Set<string>();
  const spans = groups.map((group, index) => {
    const chapterCoverage = new Map<string, number>();
    const sectionCoverage = new Map<string, number>();
    const pages: string[] = [];
    for (const block of group) {
      const size = (block.heading?.length ?? 0) + block.text.length;
      if (startsChapter(block)) chapter = block.heading;
      if (chapter) chapterCoverage.set(chapter, (chapterCoverage.get(chapter) ?? 0) + size);
      if (topical(block) && block.level !== chapterLevel) {
        sectionCoverage.set(block.heading, (sectionCoverage.get(block.heading) ?? 0) + size);
      }
      const page = block.heading?.match(/^page\s+(\d+)\s*$/i)?.[1];
      if (page) pages.push(page);
    }
    // The chapter covering most of the span names it; apparatus headings
    // (problem sets, references) only when nothing else is there.
    const substantive = (coverage: Map<string, number>) =>
      new Map([...coverage].filter(([heading]) => !isBoilerplateHeading(heading)));
    let label =
      largest(substantive(chapterCoverage)) ??
      largest(chapterCoverage) ??
      largest(substantive(sectionCoverage)) ??
      largest(sectionCoverage) ??
      (pages.length > 1
        ? `Pages ${pages[0]}-${pages[pages.length - 1]}`
        : pages.length === 1
          ? `Page ${pages[0]}`
          : `Part ${index + 1} of ${groups.length}`);
    // Two spans of one long chapter are told apart by their dominant section.
    if (used.has(label)) {
      const section = largest(substantive(sectionCoverage), label) ?? largest(sectionCoverage, label);
      label = section ? `${label}: ${section}` : `${label} (${index + 1})`;
    }
    while (used.has(label)) label = `${label} (${index + 1})`;
    used.add(label);
    label = label.slice(0, 140);

    const headings = group
      .filter(topical)
      .map((block) => block.heading)
      .slice(0, SPAN_HEADING_LIMIT);
    const passages = sampledPassages(group.map((block) => block.text).join("\n\n"), SPAN_PASSAGE_LIMIT);
    const text = [
      `Title: ${title}. Section: ${label}`,
      headings.length ? `Headings: ${headings.join(" | ")}` : "",
      passages.length ? `Passages: ${passages.join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, SPAN_TEXT_LIMIT);
    return { label, text, hash: sha256(text) };
  });
  // A trailing sliver (a stray heading after the last chapter) would embed
  // as little more than the title and match pages on the title alone.
  return spans.filter((span) => span.text.length >= SPAN_MIN_TEXT);
}

function semanticProjection(
  node: KnowledgeNode,
  claimTexts: string[],
): {
  semanticText: string;
  lexicalText: string;
  headings: string[];
  spans: TopologySpanProjection[];
} {
  const parsed = parseSemanticMarkdown(node.content);
  const body = authoredBody(parsed.body);
  const headings = [...body.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map((match) => cleanHeading(match[1]))
    .filter((heading) => heading && !isPositionalHeading(heading))
    .slice(0, 40);
  const formulas = [
    ...body.matchAll(
      /(?:\$\$?[\s\S]{2,220}?\$\$?|\\\[[\s\S]{2,220}?\\\])/g,
    ),
  ]
    .map((match) => match[0].replace(/\s+/g, " ").trim())
    .slice(0, 30);
  const passages = meaningfulPassages(body);
  const sections = [
    `Title: ${node.title}`,
    headings.length ? `Headings: ${headings.join(" | ")}` : "",
    node.primaryConcepts.length
      ? `Primary concepts: ${node.primaryConcepts.join(", ")}`
      : "",
    node.supportingConcepts.length
      ? `Supporting concepts: ${node.supportingConcepts.join(", ")}`
      : "",
    claimTexts.length ? `Registered claims: ${claimTexts.join(" | ")}` : "",
    formulas.length ? `Formulae: ${formulas.join(" | ")}` : "",
    passages.length ? `Passages: ${passages.join(" | ")}` : "",
  ].filter(Boolean);
  const semanticText = sections.join("\n").slice(0, 16_000);
  const spans = documentSpans(node.title, parsed.body);
  // Lexical overlap is scored on the whole document, so a long document's
  // lexical text also carries its spans: a textbook's chapter vocabulary,
  // not only its table of contents.
  const lexicalText = spans.length
    ? `${semanticText}\n${spans.map((span) => span.text).join("\n")}`.slice(0, 40_000)
    : semanticText;
  return { semanticText, lexicalText, headings, spans };
}

function folderPaths(
  gardenDir: string,
  nodes: readonly ProjectedTopologyNode[],
): string[] {
  const folders = new Set<string>([""]);
  for (const node of nodes) {
    let current = normalizeRel(path.posix.dirname(normalizeRel(node.relPath)));
    if (current === ".") current = "";
    while (current) {
      folders.add(current);
      const parent = normalizeRel(path.posix.dirname(current));
      current = parent === "." ? "" : parent;
    }
  }
  // Folders without a visible page still appear when the Garden shows them:
  // a published index page is enough (an empty folder the user created), while
  // Internal/, legacy subtopic trees and other hidden paths never do.
  const addWithAncestors = (folderPath: string) => {
    let current = folderPath;
    while (current) {
      folders.add(current);
      const parent = normalizeRel(path.posix.dirname(current));
      current = parent === "." ? "" : parent;
    }
  };
  const visit = (absolute: string, relative: string) => {
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        [".breadboard", "assets", ".git", "node_modules"].includes(entry.name)
      )
        continue;
      const next = normalizeRel(
        relative ? `${relative}/${entry.name}` : entry.name,
      );
      if (isInternalPath(next) || isLegacySubtopicPath(next)) continue;
      const nextAbsolute = path.join(absolute, entry.name);
      if (folderIndexPublishes(nextAbsolute, next)) addWithAncestors(next);
      visit(nextAbsolute, next);
    }
  };
  visit(gardenDir, "");
  return [...folders].sort(
    (left, right) =>
      left.split("/").length - right.split("/").length ||
      left.localeCompare(right),
  );
}

function authoredRelation(relation: string): TopologyRelationType {
  if (relation === "source") return "derives-from";
  return "related";
}

export function buildGardenProjection(input: {
  gardenDir: string;
  gardenId: string;
  gardenTitle: string;
  knowledge: ClusterKnowledge;
}): GardenProjection {
  const artifacts = readGardenSemanticArtifacts(
    input.gardenDir,
    input.gardenId,
  );
  const claimById = new Map(
    artifacts.claims.claims.map((claim) => [claim.id, claim.text]),
  );
  const nodes = input.knowledge.nodes
    .filter(visibleMarkdown)
    .map((node): ProjectedTopologyNode => {
      const claimTexts = node.claimIds
        .map((id) => claimById.get(id))
        .filter((value): value is string => Boolean(value));
      const projection = semanticProjection(node, claimTexts);
      const folderPath =
        normalizeRel(path.posix.dirname(normalizeRel(node.relPath))) === "."
          ? ""
          : normalizeRel(path.posix.dirname(normalizeRel(node.relPath)));
      const id = `page:${node.slug}`;
      return {
        id,
        slug: `${input.gardenId}/${normalizeRel(node.relPath).replace(/\.md$/i, "")}`,
        relPath: normalizeRel(node.relPath),
        folderId: folderId(folderPath),
        title: node.title || node.slug,
        kind: node.type === "source-document" ? "source" : "markdown",
        knowledgeType: node.type,
        sourceType: node.sourceType,
        contentHash: sha256(
          [projection.semanticText, ...projection.spans.map((span) => span.text)].join("\n"),
        ),
        summary: degradedText(
          node.description ||
            node.excerpt ||
            `A note titled ${node.title || node.slug}.`,
        ),
        primaryConcepts: [...node.primaryConcepts].sort(),
        supportingConcepts: [...node.supportingConcepts].sort(),
        claimIds: [...node.claimIds].sort(),
        wordCount: node.wordCount,
        semanticText: projection.semanticText,
        lexicalText: projection.lexicalText,
        claimTexts,
        headings: projection.headings,
        documentSummary: documentSummary(node),
        spans: projection.spans,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const nodeIdByKnowledgeSlug = new Map(
    nodes.map((node) => [`page:${node.id.slice(5)}`, node.id]),
  );
  const authoredEdges = input.knowledge.edges
    .filter((edge) => edge.relation !== "shared-topic")
    .flatMap((edge) => {
      const source = nodeIdByKnowledgeSlug.get(`page:${edge.source}`);
      const target = nodeIdByKnowledgeSlug.get(`page:${edge.target}`);
      return source && target && source !== target
        ? [
            {
              source,
              target,
              origin:
                edge.relation === "source"
                  ? ("provenance" as const)
                  : ("authored" as const),
              relationType: authoredRelation(edge.relation),
            },
          ]
        : [];
    });

  const folders = folderPaths(input.gardenDir, nodes).map(
    (folderPath): TopologyFolder => {
      const depth = folderPath ? folderPath.split("/").length : 0;
      const parentPath =
        depth > 1 ? folderPath.split("/").slice(0, -1).join("/") : "";
      const directCount = nodes.filter(
        (node) => node.folderId === folderId(folderPath),
      ).length;
      return {
        id: folderId(folderPath),
        path: folderPath,
        parentId: depth === 0 ? null : folderId(parentPath),
        title: titleFromFolder(folderPath),
        depth,
        nodeCount: directCount,
        summary: degradedText(
          directCount === 1
            ? "Contains 1 page."
            : `Contains ${directCount} pages.`,
        ),
      };
    },
  );
  const revisionInput = JSON.stringify({
    garden: input.gardenTitle,
    nodes: nodes.map((node) => [node.id, node.relPath, node.contentHash]),
    authoredEdges,
    folders: folders.map((folder) => folder.path),
  });
  return {
    sourceRevision: sha256(revisionInput),
    folders,
    nodes,
    authoredEdges,
  };
}
