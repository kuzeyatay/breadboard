import type { Dirent, Stats } from "node:fs";
import os from "os";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { createHash, randomBytes } from "crypto";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import OpenAI from "openai";
import { DEFAULT_MODEL } from "./ai-models";
import { withCouncil } from "./council";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";
import {
  slugify,
  STOP_WORDS,
  semanticTagsFromText,
  normalizeTopicTags,
} from "./tags";
import {
  INTERNAL_CONCEPT_FOLDER,
  INTERNAL_CONCEPT_TYPE,
  LEARNING_FOLDER,
  LEARNING_PAGE_ORDER,
  LEARNING_PAGE_TYPE,
  LEARNING_PAGE_TYPES,
  LEARNING_SECTION_TYPE,
  LEARNING_SECTION_TYPES,
  LEGACY_GENERATED_TOPIC_FOLDER,
  isLearnAuthoredLesson,
  isInternalConceptMetadata,
  isLegacySubtopicRelPath,
  readingOrderRank,
} from "./learning-garden";
import { normalizeQuartzMarkdown } from "./quartz-markdown";
import { readGardenSemanticArtifacts } from "./garden-semantics";
import { resolveConcept } from "./semantic-core";
import {
  acquireGardenMutationLease,
  INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
  isGardenMutationBusyError,
  type GardenMutationLease,
} from "./garden-mutation-lease";

export { createChatmockClient } from "./chatmock-client";

// Re-exported so existing `@/lib/knowledge` importers keep working unchanged.
export { slugify, semanticTagsFromText, normalizeTopicTags };
export { DEFAULT_MODEL } from "./ai-models";

export interface DocumentPage {
  label: string;
  text: string;
  imagePath?: string;
  imageAlt?: string;
}

export interface ExtractedTopic {
  title: string;
  slug?: string;
  explanation: string;
  keyPoints: string[];
  sourceEvidence: string[];
  locations: string[];
  relatedTopics: string[];
  tags: string[];
}

export interface TopicRelationship {
  source: string;
  target: string;
  relation: string;
}

export interface KnowledgeExtraction {
  documentTitle: string;
  summary: string;
  topics: ExtractedTopic[];
  relationships: TopicRelationship[];
  suggestedTags: string[];
}

export interface SavedKnowledge {
  sourceSlug: string;
  sourceRelPath: string;
  sourceTitle: string;
  topics: {
    slug: string;
    title: string;
    locations: string[];
    action: "created" | "merged";
  }[];
  wordCount: number;
}

export interface KnowledgeSourceAsset {
  relativePath: string;
  bytes: Uint8Array;
}

interface ExistingTopicNote {
  slug: string;
  relPath: string;
  title: string;
  type: string;
  breadboardType: string;
  tags: string[];
  body: string;
  content: string;
  filePath: string;
}

interface TopicWritePlan {
  topic: ExtractedTopic;
  finalSlug: string;
  action: "created" | "merged";
  target?: ExistingTopicNote;
  reason?: string;
}

export interface KnowledgeNode {
  id: string;
  slug: string;
  fileName: string;
  folder: string;
  relPath: string;
  title: string;
  description: string;
  type: string;
  sourceType: string;
  sourceFile: string;
  sourcePdf: string;
  sourceMedia: string;
  sourceDocument: string;
  textbookPage: string;
  breadboardType: string;
  draft: string;
  generatedBy: string;
  generated_by: string;
  internal: string;
  flagColor: string;
  locations: string[];
  sourceAnchors: string[];
  tags: string[];
  primaryConcepts: string[];
  supportingConcepts: string[];
  claimIds: string[];
  related: string[];
  date: string;
  wordCount: number;
  excerpt: string;
  content: string;
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  relation: string;
}

export interface KnowledgeTreeItem {
  source: KnowledgeNode;
  topics: KnowledgeNode[];
}

export interface ClusterKnowledge {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  tree: KnowledgeTreeItem[];
  orphanTopics: KnowledgeNode[];
  stats: {
    documents: number;
    topics: number;
    textbookPages: number;
    conceptNodes: number;
    learningPages: number;
    generatedNotes: number;
    links: number;
    words: number;
  };
}

export function normalizeSourceFileIdentity(value: string): string {
  return path.basename(value.trim()).normalize("NFKC").toLocaleLowerCase();
}

function withoutSupersededSourceIngests(
  nodes: KnowledgeNode[],
): KnowledgeNode[] {
  const sourcesByFile = new Map<string, KnowledgeNode[]>();
  for (const node of nodes) {
    if (node.type !== "source-document" || node.sourceType === "url") continue;
    const identity = normalizeSourceFileIdentity(node.sourceFile);
    if (!identity) continue;
    const sources = sourcesByFile.get(identity) ?? [];
    sources.push(node);
    sourcesByFile.set(identity, sources);
  }

  const supersededSourceSlugs = new Set<string>();
  for (const sources of sourcesByFile.values()) {
    if (sources.length < 2) continue;
    sources.sort(
      (left, right) =>
        (Date.parse(right.date) || 0) - (Date.parse(left.date) || 0) ||
        right.relPath.localeCompare(left.relPath),
    );
    for (const source of sources.slice(1)) {
      supersededSourceSlugs.add(source.slug);
    }
  }

  if (supersededSourceSlugs.size === 0) return nodes;
  return nodes.filter(
    (node) =>
      !supersededSourceSlugs.has(node.slug) &&
      !supersededSourceSlugs.has(node.sourceDocument),
  );
}

interface ClusterKnowledgeCacheEntry {
  signature: string;
  knowledge: ClusterKnowledge;
  expiresAt: number;
  generation: number;
  timer: NodeJS.Timeout;
}

type Frontmatter = Record<string, string | string[]>;

const clusterKnowledgeCache = new Map<string, ClusterKnowledgeCacheEntry>();
const CLUSTER_KNOWLEDGE_CACHE_MAX_ENTRIES = 12;
const CLUSTER_KNOWLEDGE_CACHE_TTL_MS = 5 * 60 * 1000;
let clusterKnowledgeCacheGeneration = 0;

function dropClusterKnowledge(cacheKey: string): void {
  const current = clusterKnowledgeCache.get(cacheKey);
  if (current) clearTimeout(current.timer);
  clusterKnowledgeCache.delete(cacheKey);
}

function rememberClusterKnowledge(
  cacheKey: string,
  signature: string,
  knowledge: ClusterKnowledge,
): void {
  const generation = ++clusterKnowledgeCacheGeneration;
  const expiresAt = Date.now() + CLUSTER_KNOWLEDGE_CACHE_TTL_MS;
  dropClusterKnowledge(cacheKey);
  // The timer captures only the key and generation, never the graph itself,
  // and cannot keep a standalone dashboard process alive.
  const timer = setTimeout(() => {
    const current = clusterKnowledgeCache.get(cacheKey);
    if (
      current?.generation === generation &&
      current.expiresAt <= Date.now()
    ) {
      clusterKnowledgeCache.delete(cacheKey);
    }
  }, CLUSTER_KNOWLEDGE_CACHE_TTL_MS);
  timer.unref?.();
  clusterKnowledgeCache.set(cacheKey, {
    signature,
    knowledge,
    expiresAt,
    generation,
    timer,
  });
  while (clusterKnowledgeCache.size > CLUSTER_KNOWLEDGE_CACHE_MAX_ENTRIES) {
    const oldestKey = clusterKnowledgeCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    dropClusterKnowledge(oldestKey);
  }
}

const KNOWLEDGE_SYSTEM_PROMPT = `You are a precise concept extraction engine for Breadboard's living textbook system.

Turn uploaded material into a graph-ready Learning Spine. Extract durable knowledge only: concepts, methods, named entities, formulas, claims, examples, definitions, tasks that teach a reusable procedure, and relationships between them.

Important product rule:
- Extracted topics/concepts are planning scaffolding, not final pages.
- Treat every extracted item as an internal ConceptNode / Learning Spine node.
- The user-facing output must become ordered textbook sections/subsections, not a pile of generated topic cards or disconnected notes.
- Use source anchors to decide where each concept belongs in the Learning Spine.
- Assign every source-central formula, figure, graph, table, and question to the concept/page where it belongs.
- If a source figure is relevant, capture it as sourceEvidence or a visual opportunity so it can become a visual block or source-figure explainer later.
- Do not over-segment into many tiny generated topic pages, and do not create disconnected pages for every concept.
- Repeats between major sections are acceptable; excessive repetition between adjacent subsections should be avoided.

Return ONLY valid JSON. Do not wrap the JSON in markdown fences.

Schema:
{
  "documentTitle": "Clean title",
  "summary": "4-8 sentence factual summary of the material",
  "suggestedTags": ["restoring-force", "angular-frequency", "simple-harmonic-motion"],
  "topics": [
    {
      "title": "ConceptNode Title",
      "slug": "concept-node-title",
      "explanation": "A detailed explanation grounded in the uploaded material.",
      "keyPoints": ["Specific fact or step", "Specific fact or step"],
      "sourceEvidence": ["Exact source-grounded detail, equation, example, diagram meaning, or procedure step"],
      "locations": ["Page 2", "Section: Introduction"],
      "relatedTopics": ["Another ConceptNode title"],
      "tags": ["angular-frequency"]
    }
  ],
  "relationships": [
    {
      "source": "ConceptNode Title",
      "target": "Another ConceptNode title",
      "relation": "depends-on | contrasts-with | example-of | part-of | applies-to | related"
    }
  ]
}

Rules:
- Make 6-18 ConceptNodes depending on the material. Use fewer only if the source is genuinely short.
- Every ConceptNode must be useful for Learning Spine planning, with enough detail to place it into the correct textbook subsection without reopening the source.
- For handwritten or scanned material, treat OCR as page-grounded lecture notes. Preserve equations, worked examples, labels, diagrams, definitions, and procedures instead of making a shallow overview.
- When formulas, symbols, units, or derivations appear, preserve them as LaTeX-ready Markdown: inline math with $...$ and display equations with $$...$$.
- Do not create one broad document topic and then weak derivative topics. Split the material into durable concepts and procedures that cover the full source.
- The extracted topics should collectively cover the source. Every page with legible durable knowledge should appear in at least one topic location.
- Explanations should usually be 120-300 words when the source supports that much detail.
- keyPoints should contain 4-10 specific bullets when possible.
- sourceEvidence should contain 3-8 concrete details from the located source, including formulas, examples, page-specific facts, or diagram descriptions.
- Every location must point to where the topic appears in the source, using the provided page or section markers.
- Use only facts supported by the source text.
- Never copy broken encoding artifacts such as "â€¢", "â†’", "Ã—", "Â³", or replacement characters. Convert them into clean readable Markdown such as "-", "->", "x", "^3", "_10", or a natural-language equivalent.
- If OCR text is messy, infer the intended clean notation from context instead of preserving corrupted characters.
- Tags are Zettelkasten-style concept handles, not category labels. Notes that share a tag become linked in the graph, so each tag must name a reusable concept that would make two notes worth connecting.
- Return only normalized lower-case kebab-case tags. Prefer ontology/concept tags, mechanisms, methods, and formulas over broad topic tags.
- Good tags: "restoring-force", "stable-equilibrium", "angular-frequency", "simple-harmonic-motion", "zero-isi-condition", "jacobian-determinant", "gradient-direction".
- Bad tags: physics, math, formula, important, learning, document, source, general, overview, understanding-the-basics, wave, calculus, force, frequency, oscillation. These are broad categories, document types, generic learning words, or bare nouns that would connect unrelated notes.
- Each tag should be reusable across multiple notes, specific enough to be meaningful, and broad enough to appear again. Never reference a page/slide/figure location, source filename, author name, or title slug in a tag.
- Never use app or navigation tags such as graph, links, quartz-graph, map, index, garden, knowledge, generated, note, topic, source, document, pdf, file, chat, answer, response, general, or misc.
- Keep tags separate from the knowledge graph itself: relationships and relatedTopics carry structural links; tags are lightweight conceptual connectors.
- Use 2-5 reusable concept candidates per topic when the source supports them; these are internal planning hints, not public Quartz tags.
- Link topics aggressively through relatedTopics and relationships whenever the relationship is grounded in the source.
- Each topic should have at least one relatedTopic when more than one topic is extracted.
- Create 2-5 strong relationships per topic when possible. Prefer precise relation labels: depends-on, contrasts-with, example-of, part-of, causes, enables, applies-to, derives-from, measured-by, limits, or related.
- Do not add weak or filler relationships just to increase count; every relationship should explain a real conceptual connection.
- If the source has no durable knowledge, return topics: [] and an honest summary.`;

// Tag slugifying, normalization, and idea-tag scoring live in ./tags.
// They are re-exported below so existing "@/lib/knowledge" imports keep working.

function yamlQuote(value: string): string {
  return JSON.stringify(value.replace(/\r/g, ""));
}

function yamlArray(values: string[]): string {
  return `[${values.map((value) => yamlQuote(value)).join(", ")}]`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}\n\n[Truncated for analysis]`;
}

const CP1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "\u2080": "0",
  "\u2081": "1",
  "\u2082": "2",
  "\u2083": "3",
  "\u2084": "4",
  "\u2085": "5",
  "\u2086": "6",
  "\u2087": "7",
  "\u2088": "8",
  "\u2089": "9",
};

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "\u2070": "0",
  "\u00b9": "1",
  "\u00b2": "2",
  "\u00b3": "3",
  "\u2074": "4",
  "\u2075": "5",
  "\u2076": "6",
  "\u2077": "7",
  "\u2078": "8",
  "\u2079": "9",
};

function cp1252ByteFor(char: string): number | undefined {
  const code = char.codePointAt(0) ?? 0;
  const mapped = CP1252_REVERSE[code];
  if (mapped !== undefined) return mapped;
  if (code <= 0xff) return code;
  return undefined;
}

function utf8SequenceLength(firstByte: number): number {
  if (firstByte >= 0xc2 && firstByte <= 0xdf) return 2;
  if (firstByte >= 0xe0 && firstByte <= 0xef) return 3;
  if (firstByte >= 0xf0 && firstByte <= 0xf4) return 4;
  return 0;
}

function isContinuationByte(byte: number | undefined): byte is number {
  return byte !== undefined && byte >= 0x80 && byte <= 0xbf;
}

function mojibakeScore(value: string): number {
  const chars = [...value];
  let score = 0;

  for (let index = 0; index < chars.length; index += 1) {
    const firstByte = cp1252ByteFor(chars[index]);
    if (firstByte === undefined) continue;

    const length = utf8SequenceLength(firstByte);
    if (length <= 1 || index + length > chars.length) continue;

    const bytes = chars.slice(index, index + length).map(cp1252ByteFor);
    if (bytes.slice(1).every(isContinuationByte)) {
      score += 1;
      index += length - 1;
    }
  }

  const damagedRuns = value.match(
    /(?:\u00e2\u20ac["']|\u00e2[\u2020\u2021]["'\-\^]?\d?|\u00c3-|\u00e2'[\u00a0-\u00af])/g,
  );
  return score + (damagedRuns?.length ?? 0);
}

function repairCompleteMojibakeRuns(value: string): string {
  const chars = [...value];
  let output = "";

  for (let index = 0; index < chars.length; index += 1) {
    const firstByte = cp1252ByteFor(chars[index]);
    const length = firstByte === undefined ? 0 : utf8SequenceLength(firstByte);

    if (length > 1 && index + length <= chars.length) {
      const bytes = chars.slice(index, index + length).map(cp1252ByteFor);
      if (bytes[0] === firstByte && bytes.slice(1).every(isContinuationByte)) {
        const decoded = Buffer.from(bytes as number[]).toString("utf8");
        if (decoded && !decoded.includes("\ufffd")) {
          output += decoded;
          index += length - 1;
          continue;
        }
      }
    }

    output += chars[index];
  }

  return output;
}

function repairDamagedMojibake(value: string): string {
  return value
    .replace(/\u00e2\u20ac"/g, "-")
    .replace(/\u00e2\u20ac'/g, "'")
    .replace(/\u00e2\u02c6["'\-]?/g, "-")
    .replace(/\u00e2\u0081\s*deg/g, "^0")
    .replace(/\u00c2\^([0-9])/g, "^$1")
    .replace(/\u00e2\u2020(?:["'\-\^]?\d?)?/g, "->")
    .replace(/\u00e2\u2021(?:["'\-\^]?\d?)?/g, "=>")
    .replace(/\u00e2-\u00ba/g, "->")
    .replace(/\u00e2-\u00bc/g, "-")
    .replace(/\u00e2\u0153["']/g, "yes")
    .replace(/\u00e2\u0160-/g, "xor")
    .replace(/\u00e2\u017e["']/g, "->")
    .replace(/\u00e2'\u00a0/g, "(1)")
    .replace(/\u00e2'\u00a1/g, "(2)")
    .replace(/\u00e2'\u00a2/g, "(3)")
    .replace(/\u00e2'\u00a3/g, "(4)")
    .replace(/\u00e2'\u00a4/g, "(5)")
    .replace(/\u00c3-/g, "x")
    .replace(
      /\u00e2"[\u0080-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u20ac\u201a-\u201e\u2020-\u2022\u2030\u2039\u203a]+/g,
      "-",
    )
    .replace(/-"[\u0080-\u00ff\u20ac]+/g, "-");
}

function decodeMojibake(value: string): string {
  if (mojibakeScore(value) === 0) return value;
  return repairDamagedMojibake(repairCompleteMojibakeRuns(value));
}

function normalizeStudySymbols(value: string): string {
  return value
    .replace(
      /[\u2080-\u2089]+/g,
      (match) =>
        `_${[...match].map((char) => SUBSCRIPT_DIGITS[char] ?? "").join("")}`,
    )
    .replace(
      /[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+/g,
      (match) =>
        `^${[...match].map((char) => SUPERSCRIPT_DIGITS[char] ?? "").join("")}`,
    )
    .replace(/\u1d62/g, "_i")
    .replace(/\u2071/g, "^i")
    .replace(/[\u2022\u25e6\u2043]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2192\u21d2]/g, "->")
    .replace(/[\u2190\u21d0]/g, "<-")
    .replace(/\u2191/g, "up")
    .replace(/\u2193/g, "down")
    .replace(/\u00d7/g, "x")
    .replace(/\u00f7/g, "/")
    .replace(/\u00b7/g, "*")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/\u2248/g, "~=")
    .replace(/\u2260/g, "!=")
    .replace(/\u2211/g, "sum")
    .replace(/\u00b0/g, " deg")
    .replace(/\u2460/g, "(1)")
    .replace(/\u2461/g, "(2)")
    .replace(/\u2462/g, "(3)")
    .replace(/\u2463/g, "(4)")
    .replace(/\u2464/g, "(5)");
}

export function cleanGeneratedText(value: string): string {
  let output = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = normalizeStudySymbols(decodeMojibake(output));
    if (next === output) break;
    output = next;
  }

  return output
    .replace(/\ufffd/g, "")
    .replace(/-\s*_\(([^)]+)\)\s*\^/g, "sum_($1)^")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function asString(value: unknown, fallback = ""): string {
  return cleanGeneratedText(
    typeof value === "string" && value.trim() ? value.trim() : fallback,
  );
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => cleanGeneratedText(item.trim()))
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim())
    return [cleanGeneratedText(value.trim())];
  return [];
}

function stripMarkdownJsonFences(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonObject(value: string): unknown {
  const stripped = stripMarkdownJsonFences(value);
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }
    throw new Error("Model response did not contain valid JSON");
  }
}

function uniqueSlug(baseSlug: string, used: Set<string>): string {
  let candidate = slugify(baseSlug);
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }

  const timestamp = Date.now();
  candidate = `${candidate}-${timestamp}`;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${baseSlug}-${timestamp}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

export interface ClusterMarkdownEntry {
  /** Basename, e.g. "note.md". */
  entry: string;
  /** Absolute path on disk. */
  filePath: string;
  /** POSIX path relative to the cluster directory, e.g. "caches/note.md". */
  relPath: string;
  /** POSIX directory relative to the cluster directory, "" for the cluster root. */
  folder: string;
  stat: Stats;
}

/**
 * Recursively enumerate the markdown notes of a cluster, descending into
 * sub-folders. Skips the `assets/` directory, dotfiles, and folder index files
 * (`_index.md` / `index.md`). Note identity stays the basename, so filenames are
 * expected to be unique within a cluster regardless of folder.
 */
export function walkClusterMarkdown(
  clusterDir: string,
): ClusterMarkdownEntry[] {
  if (!fs.existsSync(clusterDir)) return [];

  const results: ClusterMarkdownEntry[] = [];
  const walk = (dir: string, relDir: string) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = dirent.name;
      if (dirent.isDirectory()) {
        if (name === "assets" || name.startsWith(".")) continue;
        walk(path.join(dir, name), relDir ? `${relDir}/${name}` : name);
        continue;
      }
      if (!dirent.isFile() || !name.endsWith(".md")) continue;
      const lower = name.toLowerCase();
      if (lower === "_index.md" || lower === "index.md") continue;

      const filePath = path.join(dir, name);
      results.push({
        entry: name,
        filePath,
        relPath: relDir ? `${relDir}/${name}` : name,
        folder: relDir,
        stat: fs.statSync(filePath),
      });
    }
  };

  walk(clusterDir, "");
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * The count that goes with the walk above. It lives in `garden-directory.ts`
 * so it stays reachable from a leaf module, and is re-exported here to keep it
 * alongside `walkClusterMarkdown`, whose traversal rules it mirrors.
 */
export { countClusterMarkdown } from "./garden-directory";

/**
 * Folder (relative to the cluster directory) that ingested source documents are
 * written into. Extracted concepts are now internal ConceptNodes, while public
 * study output is written as ordered textbook pages under numbered sections.
 * Notes are still identified by basename slug so links resolve across folders
 * (Quartz uses shortest-path link resolution).
 */
export const SOURCE_NOTE_FOLDER = "sources";
export const GENERATED_NOTE_FOLDER = LEGACY_GENERATED_TOPIC_FOLDER;
export const TEXTBOOK_FOLDER = LEARNING_FOLDER;
export const CONCEPT_NODE_FOLDER = INTERNAL_CONCEPT_FOLDER;

const KNOWLEDGE_TRANSACTION_VERSION = 1;
const MAX_KNOWLEDGE_TRANSACTION_ENTRIES = 4096;
const MAX_KNOWLEDGE_TRANSACTION_DIRECTORIES = 4096;
const MAX_KNOWLEDGE_TRANSACTION_JOURNAL_BYTES = 1024 * 1024;
const MAX_KNOWLEDGE_TRANSACTION_RESULT_BYTES = 1024 * 1024;
const MAX_KNOWLEDGE_TRANSACTION_BACKUP_BYTES = 512 * 1024 * 1024;
const MAX_KNOWLEDGE_TRANSACTION_PATH_BYTES = 4096;
const MAX_KNOWLEDGE_TRANSACTION_LOCK_BYTES = 4096;
const MAX_KNOWLEDGE_COMMIT_TOMBSTONE_BYTES = 8192;
const KNOWLEDGE_TRANSACTION_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const KNOWLEDGE_TRANSACTION_SHA256 = /^[a-f0-9]{64}$/;
const KNOWLEDGE_TRANSACTION_LOCK_FILE = ".active.lock";
const KNOWLEDGE_COMMIT_TOMBSTONE_FILE = "ingestion-commit.json";
const KNOWLEDGE_TRANSACTION_INITIALIZING_DIRECTORY =
  /^\.initializing\.([A-Za-z0-9_-]{1,128})\.([a-f0-9]{32})$/;
const KNOWLEDGE_TRANSACTION_CLEANUP_DIRECTORY =
  /^\.cleanup\.(committed|rolled-back)\.([A-Za-z0-9_-]{1,128})\.([a-f0-9]{32})$/;

type KnowledgeTransactionState =
  | "active"
  | "result-pending"
  | "committed"
  | "reconciling";

interface KnowledgeAbsentSnapshot {
  kind: "absent";
}

interface KnowledgeFileBackupSnapshot {
  kind: "file";
  backupName: string;
  sizeBytes: number;
  sha256: string;
  mode: number;
}

interface KnowledgeJournalEntry {
  relativePath: string;
  original: KnowledgeAbsentSnapshot | KnowledgeFileBackupSnapshot;
}

interface KnowledgeTransactionJournal {
  version: 1;
  transactionId: string;
  ownerPid: number;
  clusterPathSha256: string;
  state: KnowledgeTransactionState;
  entries: KnowledgeJournalEntry[];
  createdDirectories: string[];
  resultSha256?: string;
  replacementResultSha256?: string;
}

interface KnowledgeTransactionRegistryLock {
  version: 1;
  transactionId: string;
  ownerPid: number;
  token: string;
}

interface HeldKnowledgeTransactionRegistryLock {
  descriptor: number;
  filePath: string;
  value: KnowledgeTransactionRegistryLock;
}

interface KnowledgeCommitTombstone {
  version: 1;
  transactionId: string;
  clusterPathSha256: string;
  state: "committed" | "reconciling";
  resultSha256: string;
  replacementResultSha256?: string;
}

export interface KnowledgeWriteTransactionOptions {
  registryRoot: string;
  transactionId: string;
  resultPath: string;
  retainCommittedJournal?: boolean;
}

export interface KnowledgeWriteRecovery {
  transactionId: string;
  outcome: "rolled-back" | "committed";
  transaction?: KnowledgeWriteTransaction;
}

export interface KnowledgeWriteTransaction {
  captureFile(filePath: string): void;
  recordCreatedDirectory(directoryPath: string): void;
  prepareResult(expectedSha256: string): void;
  prepareResultReplacement(expectedSha256: string): void;
  readCommittedResult(): Buffer;
  commit(): void;
  seal(): void;
  finalize(): void;
  rollback(): void;
}

function normalizedKnowledgePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function knowledgeClusterPathSha256(clusterDir: string): string {
  return createHash("sha256")
    .update(normalizedKnowledgePath(clusterDir), "utf8")
    .digest("hex");
}

function fsyncKnowledgeDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    // Windows cannot FlushFileBuffers for every directory handle. File data
    // and the atomic rename are still durable; other hosts fsync the parent.
    if (
      process.platform !== "win32" ||
      !(error instanceof Error) ||
      !("code" in error) ||
      !["EACCES", "EINVAL", "EPERM"].includes(String(error.code))
    ) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function fsyncKnowledgeFile(filePath: string): void {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Knowledge transaction durable file is not regular.");
  }
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      filePath,
      process.platform === "win32" ? "r+" : "r",
    );
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertDirectKnowledgeDirectory(
  directoryPath: string,
  label: string,
): void {
  const resolved = path.resolve(directoryPath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} is not a direct directory.`);
  }
  if (
    normalizedKnowledgePath(fs.realpathSync.native(resolved)) !==
    normalizedKnowledgePath(resolved)
  ) {
    throw new Error(`${label} contains an indirect path.`);
  }
}

function readBoundedKnowledgeDirectoryEntries(
  directoryPath: string,
  maximumEntries: number,
  label: string,
  ignoredName?: string,
) {
  const directory = fs.opendirSync(directoryPath);
  const entries: Dirent[] = [];
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      if (entry.name === ignoredName) continue;
      if (entries.length >= maximumEntries) {
        throw new Error(`${label} exceeded its bound.`);
      }
      entries.push(entry);
    }
    return entries;
  } finally {
    directory.closeSync();
  }
}

function knowledgeInitializationDirectory(
  registryRoot: string,
  transactionId: string,
): string {
  return path.join(
    registryRoot,
    `.initializing.${transactionId}.${randomBytes(16).toString("hex")}`,
  );
}

function knowledgeCleanupDirectory(
  registryRoot: string,
  transactionId: string,
  outcome: "committed" | "rolled-back",
): string {
  return path.join(
    registryRoot,
    `.cleanup.${outcome}.${transactionId}.${randomBytes(16).toString("hex")}`,
  );
}

function removeKnowledgeTransactionDirectory(
  registryRoot: string,
  transactionDir: string,
  transactionId: string,
  outcome: "committed" | "rolled-back",
): void {
  const cleanupDirectory = knowledgeCleanupDirectory(
    registryRoot,
    transactionId,
    outcome,
  );
  fs.renameSync(transactionDir, cleanupDirectory);
  fsyncKnowledgeDirectory(registryRoot);
  fs.rmSync(cleanupDirectory, { recursive: true, force: true });
  fsyncKnowledgeDirectory(registryRoot);
}

function removeKnowledgeTransactionDebris(
  registryRoot: string,
  entry: Dirent,
): boolean {
  if (
    !KNOWLEDGE_TRANSACTION_INITIALIZING_DIRECTORY.test(entry.name) &&
    !KNOWLEDGE_TRANSACTION_CLEANUP_DIRECTORY.test(entry.name)
  ) {
    return false;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(
      "Knowledge transaction registry contains invalid recovery debris.",
    );
  }
  const debrisPath = path.join(registryRoot, entry.name);
  assertDirectKnowledgeDirectory(
    debrisPath,
    "Knowledge transaction recovery debris",
  );
  fs.rmSync(debrisPath, { recursive: true, force: true });
  fsyncKnowledgeDirectory(registryRoot);
  return true;
}

function hashKnowledgeFile(filePath: string): {
  sizeBytes: number;
  sha256: string;
} {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Knowledge transaction data is not a regular file.");
  }
  if (
    normalizedKnowledgePath(fs.realpathSync.native(filePath)) !==
    normalizedKnowledgePath(filePath)
  ) {
    throw new Error("Knowledge transaction data contains an indirect path.");
  }
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size !== metadata.size) {
      throw new Error(
        "Knowledge transaction data changed while it was opened.",
      );
    }
    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < opened.size) {
      const read = fs.readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.byteLength, opened.size - offset),
        offset,
      );
      if (read < 1) {
        throw new Error(
          "Knowledge transaction data ended before its declared size.",
        );
      }
      digest.update(chunk.subarray(0, read));
      offset += read;
    }
    const checked = fs.fstatSync(descriptor);
    if (checked.size !== opened.size || checked.mtimeMs !== opened.mtimeMs) {
      throw new Error("Knowledge transaction data changed while it was read.");
    }
    return { sizeBytes: opened.size, sha256: digest.digest("hex") };
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateKnowledgeRelativePath(
  value: unknown,
  allowRoot = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowRoot && value.length === 0) ||
    Buffer.byteLength(value, "utf8") > MAX_KNOWLEDGE_TRANSACTION_PATH_BYTES ||
    value.includes("\\") ||
    path.isAbsolute(value)
  ) {
    throw new Error("Knowledge transaction journal contains an invalid path.");
  }
  const segments = value === "" ? [] : value.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Knowledge transaction journal contains an invalid path.");
  }
  return value;
}

function validateKnowledgeJournal(
  value: unknown,
  transactionId: string,
): KnowledgeTransactionJournal {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Knowledge transaction journal is invalid.");
  }
  const journal = value as Record<string, unknown>;
  const keys = Object.keys(journal).sort();
  const required = [
    "clusterPathSha256",
    "createdDirectories",
    "entries",
    "ownerPid",
    "state",
    "transactionId",
    "version",
  ];
  const optional = ["replacementResultSha256", "resultSha256"];
  if (
    keys.some((key) => !required.includes(key) && !optional.includes(key)) ||
    required.some((key) => !keys.includes(key)) ||
    journal.version !== KNOWLEDGE_TRANSACTION_VERSION ||
    journal.transactionId !== transactionId ||
    !KNOWLEDGE_TRANSACTION_IDENTIFIER.test(transactionId) ||
    typeof journal.clusterPathSha256 !== "string" ||
    !KNOWLEDGE_TRANSACTION_SHA256.test(journal.clusterPathSha256) ||
    !["active", "result-pending", "committed", "reconciling"].includes(
      String(journal.state),
    ) ||
    !Array.isArray(journal.entries) ||
    journal.entries.length > MAX_KNOWLEDGE_TRANSACTION_ENTRIES ||
    !Array.isArray(journal.createdDirectories) ||
    journal.createdDirectories.length > MAX_KNOWLEDGE_TRANSACTION_DIRECTORIES ||
    !Number.isSafeInteger(journal.ownerPid) ||
    Number(journal.ownerPid) < 1
  ) {
    throw new Error("Knowledge transaction journal is invalid.");
  }

  const seenPaths = new Set<string>();
  const entries = journal.entries.map((raw, index): KnowledgeJournalEntry => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Knowledge transaction journal entry is invalid.");
    }
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).sort().join("\0") !== "original\0relativePath") {
      throw new Error("Knowledge transaction journal entry is invalid.");
    }
    const relativePath = validateKnowledgeRelativePath(entry.relativePath);
    const key =
      process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    if (seenPaths.has(key)) {
      throw new Error(
        "Knowledge transaction journal contains a duplicate path.",
      );
    }
    seenPaths.add(key);
    if (
      entry.original === null ||
      typeof entry.original !== "object" ||
      Array.isArray(entry.original)
    ) {
      throw new Error("Knowledge transaction snapshot is invalid.");
    }
    const original = entry.original as Record<string, unknown>;
    if (original.kind === "absent" && Object.keys(original).length === 1) {
      return { relativePath, original: { kind: "absent" } };
    }
    const expectedBackupName = `${String(index).padStart(6, "0")}.snapshot`;
    if (
      original.kind !== "file" ||
      Object.keys(original).sort().join("\0") !==
        "backupName\0kind\0mode\0sha256\0sizeBytes" ||
      original.backupName !== expectedBackupName ||
      !Number.isSafeInteger(original.sizeBytes) ||
      Number(original.sizeBytes) < 0 ||
      Number(original.sizeBytes) > MAX_KNOWLEDGE_TRANSACTION_BACKUP_BYTES ||
      typeof original.sha256 !== "string" ||
      !KNOWLEDGE_TRANSACTION_SHA256.test(original.sha256) ||
      !Number.isSafeInteger(original.mode) ||
      Number(original.mode) < 0 ||
      Number(original.mode) > 0o777
    ) {
      throw new Error("Knowledge transaction snapshot is invalid.");
    }
    return {
      relativePath,
      original: {
        kind: "file",
        backupName: expectedBackupName,
        sizeBytes: Number(original.sizeBytes),
        sha256: original.sha256,
        mode: Number(original.mode),
      },
    };
  });
  const retainedBackupBytes = entries.reduce(
    (total, entry) =>
      total + (entry.original.kind === "file" ? entry.original.sizeBytes : 0),
    0,
  );
  if (
    !Number.isSafeInteger(retainedBackupBytes) ||
    retainedBackupBytes > MAX_KNOWLEDGE_TRANSACTION_BACKUP_BYTES
  ) {
    throw new Error("Knowledge transaction backup bytes exceeded their bound.");
  }

  const seenDirectories = new Set<string>();
  const createdDirectories = journal.createdDirectories.map((raw) => {
    const relativePath = validateKnowledgeRelativePath(raw, true);
    const key =
      process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    if (seenDirectories.has(key)) {
      throw new Error(
        "Knowledge transaction journal contains a duplicate directory.",
      );
    }
    seenDirectories.add(key);
    return relativePath;
  });

  const state = journal.state as KnowledgeTransactionState;
  const resultSha256 = journal.resultSha256;
  const replacementResultSha256 = journal.replacementResultSha256;
  if (
    (state === "active") !== (resultSha256 === undefined) ||
    (resultSha256 !== undefined &&
      (typeof resultSha256 !== "string" ||
        !KNOWLEDGE_TRANSACTION_SHA256.test(resultSha256))) ||
    (state === "reconciling") !== (replacementResultSha256 !== undefined) ||
    (replacementResultSha256 !== undefined &&
      (typeof replacementResultSha256 !== "string" ||
        !KNOWLEDGE_TRANSACTION_SHA256.test(replacementResultSha256)))
  ) {
    throw new Error("Knowledge transaction result decision is invalid.");
  }
  return {
    version: 1,
    transactionId,
    ownerPid: Number(journal.ownerPid),
    clusterPathSha256: journal.clusterPathSha256,
    state,
    entries,
    createdDirectories,
    ...(resultSha256 === undefined ? {} : { resultSha256 }),
    ...(replacementResultSha256 === undefined
      ? {}
      : { replacementResultSha256 }),
  };
}

let knowledgeJournalWriteSequence = 0;

function writeKnowledgeJournal(
  transactionDir: string,
  journal: KnowledgeTransactionJournal,
): void {
  const bytes = Buffer.from(`${JSON.stringify(journal)}\n`, "utf8");
  if (bytes.byteLength > MAX_KNOWLEDGE_TRANSACTION_JOURNAL_BYTES) {
    throw new Error("Knowledge transaction journal exceeded its bound.");
  }
  const journalPath = path.join(transactionDir, "journal.json");
  const temporaryPath = path.join(
    transactionDir,
    `.journal.pending.${process.pid}.${knowledgeJournalWriteSequence++}`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, journalPath);
    fsyncKnowledgeFile(journalPath);
    fsyncKnowledgeDirectory(transactionDir);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function readKnowledgeJournal(
  transactionDir: string,
  transactionId: string,
): KnowledgeTransactionJournal {
  const journalPath = path.join(transactionDir, "journal.json");
  const metadata = fs.lstatSync(journalPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > MAX_KNOWLEDGE_TRANSACTION_JOURNAL_BYTES
  ) {
    throw new Error(
      "Knowledge transaction journal is unavailable or unbounded.",
    );
  }
  const bytes = fs.readFileSync(journalPath);
  if (bytes.byteLength !== metadata.size) {
    throw new Error("Knowledge transaction journal changed while it was read.");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Knowledge transaction journal is not valid JSON.");
  }
  return validateKnowledgeJournal(value, transactionId);
}

function processIsAliveForKnowledgeTransaction(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error &&
      "code" in error &&
      String(error.code) === "EPERM"
    );
  }
}

function parseKnowledgeRegistryLock(
  value: unknown,
): KnowledgeTransactionRegistryLock {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !==
      "ownerPid\0token\0transactionId\0version"
  ) {
    throw new Error("Knowledge transaction registry lock is invalid.");
  }
  const lock = value as Record<string, unknown>;
  if (
    lock.version !== 1 ||
    typeof lock.transactionId !== "string" ||
    !KNOWLEDGE_TRANSACTION_IDENTIFIER.test(lock.transactionId) ||
    !Number.isSafeInteger(lock.ownerPid) ||
    Number(lock.ownerPid) < 1 ||
    typeof lock.token !== "string" ||
    !KNOWLEDGE_TRANSACTION_SHA256.test(lock.token)
  ) {
    throw new Error("Knowledge transaction registry lock is invalid.");
  }
  return {
    version: 1,
    transactionId: lock.transactionId,
    ownerPid: Number(lock.ownerPid),
    token: lock.token,
  };
}

function readBoundedKnowledgeJson(
  filePath: string,
  maximumBytes: number,
): unknown {
  const metadata = fs.lstatSync(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) {
    throw new Error("Knowledge transaction durable metadata is invalid.");
  }
  const bytes = fs.readFileSync(filePath);
  if (bytes.byteLength !== metadata.size) {
    throw new Error(
      "Knowledge transaction durable metadata changed while read.",
    );
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(
      "Knowledge transaction durable metadata is not valid JSON.",
    );
  }
}

function acquireKnowledgeRegistryLock(
  registryRoot: string,
  transactionId: string,
): HeldKnowledgeTransactionRegistryLock {
  const filePath = path.join(registryRoot, KNOWLEDGE_TRANSACTION_LOCK_FILE);
  const value: KnowledgeTransactionRegistryLock = {
    version: 1,
    transactionId,
    ownerPid: process.pid,
    token: randomBytes(32).toString("hex"),
  };
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fsyncKnowledgeDirectory(registryRoot);
    return { descriptor, filePath, value };
  } catch (error) {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
      try {
        fs.rmSync(filePath);
      } catch {
        // A conflicting owner is diagnosed by recovery on the next attempt.
      }
    }
    throw error;
  }
}

function releaseKnowledgeRegistryLock(
  registryRoot: string,
  held: HeldKnowledgeTransactionRegistryLock | null,
): void {
  if (!held) return;
  fs.closeSync(held.descriptor);
  const current = parseKnowledgeRegistryLock(
    readBoundedKnowledgeJson(
      held.filePath,
      MAX_KNOWLEDGE_TRANSACTION_LOCK_BYTES,
    ),
  );
  if (
    current.token !== held.value.token ||
    current.ownerPid !== held.value.ownerPid ||
    current.transactionId !== held.value.transactionId
  ) {
    throw new Error("Knowledge transaction registry lock ownership changed.");
  }
  fs.rmSync(held.filePath);
  fsyncKnowledgeDirectory(registryRoot);
}

function clearStaleKnowledgeRegistryLock(registryRoot: string): void {
  const filePath = path.join(registryRoot, KNOWLEDGE_TRANSACTION_LOCK_FILE);
  if (!fs.existsSync(filePath)) return;
  const lock = parseKnowledgeRegistryLock(
    readBoundedKnowledgeJson(filePath, MAX_KNOWLEDGE_TRANSACTION_LOCK_BYTES),
  );
  if (processIsAliveForKnowledgeTransaction(lock.ownerPid)) {
    throw new Error("A live ingestion transaction already owns this garden.");
  }
  fs.rmSync(filePath);
  fsyncKnowledgeDirectory(registryRoot);
}

function validateKnowledgeCommitTombstone(
  value: unknown,
  transactionId: string,
): KnowledgeCommitTombstone {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Knowledge commit tombstone is invalid.");
  }
  const tombstone = value as Record<string, unknown>;
  const keys = Object.keys(tombstone).sort();
  const required = [
    "clusterPathSha256",
    "resultSha256",
    "state",
    "transactionId",
    "version",
  ];
  if (
    keys.some(
      (key) => !required.includes(key) && key !== "replacementResultSha256",
    ) ||
    required.some((key) => !keys.includes(key)) ||
    tombstone.version !== 1 ||
    tombstone.transactionId !== transactionId ||
    !KNOWLEDGE_TRANSACTION_IDENTIFIER.test(transactionId) ||
    typeof tombstone.clusterPathSha256 !== "string" ||
    !KNOWLEDGE_TRANSACTION_SHA256.test(tombstone.clusterPathSha256) ||
    !["committed", "reconciling"].includes(String(tombstone.state)) ||
    typeof tombstone.resultSha256 !== "string" ||
    !KNOWLEDGE_TRANSACTION_SHA256.test(tombstone.resultSha256) ||
    (tombstone.state === "reconciling") !==
      (tombstone.replacementResultSha256 !== undefined) ||
    (tombstone.replacementResultSha256 !== undefined &&
      (typeof tombstone.replacementResultSha256 !== "string" ||
        !KNOWLEDGE_TRANSACTION_SHA256.test(tombstone.replacementResultSha256)))
  ) {
    throw new Error("Knowledge commit tombstone is invalid.");
  }
  return {
    version: 1,
    transactionId,
    clusterPathSha256: tombstone.clusterPathSha256,
    state: tombstone.state as "committed" | "reconciling",
    resultSha256: tombstone.resultSha256,
    ...(tombstone.replacementResultSha256 === undefined
      ? {}
      : { replacementResultSha256: tombstone.replacementResultSha256 }),
  };
}

let knowledgeTombstoneWriteSequence = 0;

function knowledgeCommitTombstonePath(resultPath: string): string {
  return path.join(path.dirname(resultPath), KNOWLEDGE_COMMIT_TOMBSTONE_FILE);
}

function writeKnowledgeCommitTombstone(
  resultPath: string,
  tombstone: KnowledgeCommitTombstone,
): void {
  const filePath = knowledgeCommitTombstonePath(resultPath);
  const bytes = Buffer.from(`${JSON.stringify(tombstone)}\n`, "utf8");
  if (bytes.byteLength > MAX_KNOWLEDGE_COMMIT_TOMBSTONE_BYTES) {
    throw new Error("Knowledge commit tombstone exceeded its bound.");
  }
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.ingestion-commit.pending.${process.pid}.${knowledgeTombstoneWriteSequence++}`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    fsyncKnowledgeFile(filePath);
    fsyncKnowledgeDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function readKnowledgeCommitTombstone(
  resultPath: string,
  transactionId: string,
): KnowledgeCommitTombstone {
  return validateKnowledgeCommitTombstone(
    readBoundedKnowledgeJson(
      knowledgeCommitTombstonePath(resultPath),
      MAX_KNOWLEDGE_COMMIT_TOMBSTONE_BYTES,
    ),
    transactionId,
  );
}

function createKnowledgeBackup(
  sourcePath: string,
  backupPath: string,
  maximumBytes: number,
): { sizeBytes: number; sha256: string; mode: number } {
  const sourceMetadata = fs.lstatSync(sourcePath);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error("Knowledge write target is not a regular file.");
  }
  const source = fs.openSync(
    sourcePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  const temporaryPath = `${backupPath}.pending.${process.pid}`;
  let destination: number | undefined;
  try {
    const opened = fs.fstatSync(source);
    if (
      !opened.isFile() ||
      opened.size !== sourceMetadata.size ||
      opened.size > maximumBytes
    ) {
      if (opened.size > maximumBytes) {
        throw new Error(
          "Knowledge transaction backup bytes exceeded their bound.",
        );
      }
      throw new Error("Knowledge write target changed while it was opened.");
    }
    destination = fs.openSync(temporaryPath, "wx", 0o600);
    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < opened.size) {
      const read = fs.readSync(
        source,
        chunk,
        0,
        Math.min(chunk.byteLength, opened.size - offset),
        offset,
      );
      if (read < 1)
        throw new Error("Knowledge write target ended during backup.");
      fs.writeSync(destination, chunk, 0, read);
      digest.update(chunk.subarray(0, read));
      offset += read;
    }
    fs.fsyncSync(destination);
    fs.closeSync(destination);
    destination = undefined;
    const checked = fs.fstatSync(source);
    if (checked.size !== opened.size || checked.mtimeMs !== opened.mtimeMs) {
      throw new Error("Knowledge write target changed during backup.");
    }
    fs.renameSync(temporaryPath, backupPath);
    fsyncKnowledgeFile(backupPath);
    fsyncKnowledgeDirectory(path.dirname(backupPath));
    return {
      sizeBytes: opened.size,
      sha256: digest.digest("hex"),
      mode: opened.mode & 0o777,
    };
  } catch (error) {
    if (destination !== undefined) fs.closeSync(destination);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  } finally {
    fs.closeSync(source);
  }
}

let knowledgeRollbackRestoreSequence = 0;

function restoreKnowledgeSnapshot(
  backupPath: string,
  filePath: string,
  snapshot: KnowledgeFileBackupSnapshot,
): void {
  const backup = hashKnowledgeFile(backupPath);
  if (
    backup.sizeBytes !== snapshot.sizeBytes ||
    backup.sha256 !== snapshot.sha256
  ) {
    throw new Error("Knowledge rollback backup failed its integrity check.");
  }
  const temporaryPath = `${filePath}.rollback.${process.pid}.${knowledgeRollbackRestoreSequence++}`;
  let descriptor: number | undefined;
  try {
    if (fs.existsSync(temporaryPath)) {
      const stale = fs.lstatSync(temporaryPath);
      if (!stale.isFile() || stale.isSymbolicLink()) {
        throw new Error("Knowledge rollback temporary path is indirect.");
      }
      fs.rmSync(temporaryPath);
    }
    fs.copyFileSync(backupPath, temporaryPath, fs.constants.COPYFILE_EXCL);
    descriptor = fs.openSync(temporaryPath, "r+");
    fs.chmodSync(temporaryPath, snapshot.mode);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    fsyncKnowledgeFile(filePath);
    fsyncKnowledgeDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function assertActiveGardenMutationLease(lease: GardenMutationLease): void {
  const processBoundExpiry = Date.parse(lease.lock.processBoundExpiresAt ?? "");
  if (
    lease.lost ||
    (Number.isFinite(processBoundExpiry) && Date.now() >= processBoundExpiry)
  ) {
    throw new Error("Knowledge transaction lost its Garden mutation lease.");
  }
}

function isLiveKnowledgeTransactionConflict(error: unknown): boolean {
  return (
    isGardenMutationBusyError(error) &&
    error.conflict.jobId.startsWith("mutation:document-ingestion:")
  );
}

function liveKnowledgeTransactionError(message: string): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = "EEXIST";
  return error;
}

class DiskBackedKnowledgeWriteTransaction implements KnowledgeWriteTransaction {
  private readonly clusterDir: string;
  private readonly registryRoot: string;
  private readonly transactionDir: string;
  private readonly backupDir: string;
  private readonly resultPath: string;
  private readonly retainCommittedJournal: boolean;
  private journal: KnowledgeTransactionJournal;
  private registryLock: HeldKnowledgeTransactionRegistryLock | null = null;
  private gardenMutationLease: GardenMutationLease | null = null;
  private readonly assertExternalGardenMutationLease?: () => void;
  private finalized = false;

  constructor(
    clusterDir: string,
    options: KnowledgeWriteTransactionOptions,
    existingJournal?: KnowledgeTransactionJournal,
    assertExternalGardenMutationLease?: () => void,
  ) {
    this.clusterDir = path.resolve(clusterDir);
    this.registryRoot = path.resolve(options.registryRoot);
    this.transactionDir = path.join(this.registryRoot, options.transactionId);
    this.backupDir = path.join(this.transactionDir, "backups");
    this.resultPath = path.resolve(options.resultPath);
    this.retainCommittedJournal = options.retainCommittedJournal ?? true;
    this.assertExternalGardenMutationLease = assertExternalGardenMutationLease;
    if (!KNOWLEDGE_TRANSACTION_IDENTIFIER.test(options.transactionId)) {
      throw new Error("Knowledge transaction identity is invalid.");
    }
    if (fs.existsSync(this.clusterDir)) {
      assertDirectKnowledgeDirectory(
        this.clusterDir,
        "Knowledge transaction garden directory",
      );
    } else {
      let existingAncestor = path.dirname(this.clusterDir);
      while (!fs.existsSync(existingAncestor)) {
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) break;
        existingAncestor = parent;
      }
      assertDirectKnowledgeDirectory(
        existingAncestor,
        "Knowledge transaction garden ancestor",
      );
    }
    assertDirectKnowledgeDirectory(
      path.dirname(this.resultPath),
      "Knowledge transaction result directory",
    );
    if (existingJournal) {
      assertDirectKnowledgeDirectory(
        this.transactionDir,
        "Knowledge transaction directory",
      );
      assertDirectKnowledgeDirectory(
        this.backupDir,
        "Knowledge transaction backup directory",
      );
      this.journal = existingJournal;
      return;
    }
    try {
      this.gardenMutationLease = acquireGardenMutationLease(
        this.clusterDir,
        "document-ingestion",
        {
          ownerId: options.transactionId,
          processBoundStaleMs: this.retainCommittedJournal
            ? INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS
            : undefined,
        },
      );
    } catch (error) {
      if (isLiveKnowledgeTransactionConflict(error)) {
        throw liveKnowledgeTransactionError(
          "A live ingestion transaction already owns this garden.",
        );
      }
      throw error;
    }
    try {
      fs.mkdirSync(this.registryRoot, { recursive: true });
      assertDirectKnowledgeDirectory(
        this.registryRoot,
        "Knowledge transaction registry",
      );
      if (this.retainCommittedJournal) {
        this.registryLock = acquireKnowledgeRegistryLock(
          this.registryRoot,
          options.transactionId,
        );
      }
    } catch (error) {
      try {
        this.releaseOwnership();
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          "Knowledge transaction setup failed and ownership could not be released.",
        );
      }
      throw error;
    }
    const initializationDirectory = knowledgeInitializationDirectory(
      this.registryRoot,
      options.transactionId,
    );
    const initializationBackupDirectory = path.join(
      initializationDirectory,
      "backups",
    );
    let published = false;
    try {
      fs.mkdirSync(initializationDirectory, {
        recursive: false,
        mode: 0o700,
      });
      fs.mkdirSync(initializationBackupDirectory, {
        recursive: false,
        mode: 0o700,
      });
      fsyncKnowledgeDirectory(initializationDirectory);
      fsyncKnowledgeDirectory(this.registryRoot);
      this.journal = {
        version: 1,
        transactionId: options.transactionId,
        ownerPid: process.pid,
        clusterPathSha256: knowledgeClusterPathSha256(this.clusterDir),
        state: "active",
        entries: [],
        createdDirectories: [],
      };
      writeKnowledgeJournal(initializationDirectory, this.journal);
      fs.renameSync(initializationDirectory, this.transactionDir);
      published = true;
      fsyncKnowledgeDirectory(this.registryRoot);
    } catch (error) {
      try {
        if (published && fs.existsSync(this.transactionDir)) {
          removeKnowledgeTransactionDirectory(
            this.registryRoot,
            this.transactionDir,
            options.transactionId,
            "rolled-back",
          );
        } else {
          fs.rmSync(initializationDirectory, { recursive: true, force: true });
          fsyncKnowledgeDirectory(this.registryRoot);
        }
      } catch (cleanupError) {
        error = new AggregateError(
          [error, cleanupError],
          "Knowledge transaction initialization failed and its debris could not be removed.",
        );
      }
      try {
        this.releaseOwnership();
      } catch (releaseError) {
        error = new AggregateError(
          [error, releaseError],
          "Knowledge transaction initialization failed and ownership could not be released.",
        );
      }
      throw error;
    }
  }

  private releaseOwnership(): void {
    const failures: Error[] = [];
    try {
      releaseKnowledgeRegistryLock(this.registryRoot, this.registryLock);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.registryLock = null;
    }
    try {
      this.gardenMutationLease?.release();
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.gardenMutationLease = null;
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Knowledge transaction ownership could not be released cleanly.",
      );
    }
  }

  private updateJournal(next: KnowledgeTransactionJournal): void {
    writeKnowledgeJournal(this.transactionDir, next);
    this.journal = next;
  }

  private assertGardenMutationOwnership(): void {
    this.assertExternalGardenMutationLease?.();
    if (this.gardenMutationLease) {
      assertActiveGardenMutationLease(this.gardenMutationLease);
    }
  }

  private assertMutable(): void {
    if (this.finalized || this.journal.state !== "active") {
      throw new Error(
        `Knowledge write transaction is already ${this.journal.state}.`,
      );
    }
  }

  private relativeWithinCluster(candidate: string, allowRoot = false): string {
    const resolved = path.resolve(candidate);
    const relative = path.relative(this.clusterDir, resolved);
    if (
      relative !== "" &&
      (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative))
    ) {
      throw new Error(
        "Knowledge write transaction path escaped the garden directory.",
      );
    }
    const portable = relative.split(path.sep).join("/");
    validateKnowledgeRelativePath(portable, allowRoot);
    let current = this.clusterDir;
    const segments = portable === "" ? [] : portable.split("/");
    if (fs.existsSync(current)) {
      const rootMetadata = fs.lstatSync(current);
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
        throw new Error(
          "Knowledge write transaction path contains an indirect garden directory.",
        );
      }
    }
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current, segment);
      if (!fs.existsSync(current)) break;
      const metadata = fs.lstatSync(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(
          "Knowledge write transaction path contains an indirect directory.",
        );
      }
    }
    return portable;
  }

  private resolveJournalPath(relativePath: string, allowRoot = false): string {
    const validated = validateKnowledgeRelativePath(relativePath, allowRoot);
    const resolved = path.resolve(
      this.clusterDir,
      ...(validated === "" ? [] : validated.split("/")),
    );
    const checked = this.relativeWithinCluster(resolved, allowRoot);
    if (checked !== validated) {
      throw new Error("Knowledge transaction journal path is not canonical.");
    }
    return resolved;
  }

  captureFile(filePath: string): void {
    this.assertMutable();
    this.assertGardenMutationOwnership();
    const relativePath = this.relativeWithinCluster(filePath);
    const key =
      process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    if (
      this.journal.entries.some(
        (entry) =>
          (process.platform === "win32"
            ? entry.relativePath.toLowerCase()
            : entry.relativePath) === key,
      )
    )
      return;
    if (this.journal.entries.length >= MAX_KNOWLEDGE_TRANSACTION_ENTRIES) {
      throw new Error("Knowledge transaction file count exceeded its bound.");
    }

    const resolved = this.resolveJournalPath(relativePath);
    let original: KnowledgeAbsentSnapshot | KnowledgeFileBackupSnapshot = {
      kind: "absent",
    };
    if (fs.existsSync(resolved)) {
      const metadata = fs.lstatSync(resolved);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error("Knowledge write target is not a regular file.");
      }
      const retainedBackupBytes = this.journal.entries.reduce(
        (total, entry) =>
          total +
          (entry.original.kind === "file" ? entry.original.sizeBytes : 0),
        0,
      );
      const remainingBackupBytes =
        MAX_KNOWLEDGE_TRANSACTION_BACKUP_BYTES - retainedBackupBytes;
      if (
        !Number.isSafeInteger(retainedBackupBytes) ||
        remainingBackupBytes < 0 ||
        metadata.size > remainingBackupBytes
      ) {
        throw new Error(
          "Knowledge transaction backup bytes exceeded their bound.",
        );
      }
      const backupName = `${String(this.journal.entries.length).padStart(6, "0")}.snapshot`;
      const backup = createKnowledgeBackup(
        resolved,
        path.join(this.backupDir, backupName),
        remainingBackupBytes,
      );
      original = { kind: "file", backupName, ...backup };
    }
    this.updateJournal({
      ...this.journal,
      entries: [...this.journal.entries, { relativePath, original }],
    });
  }

  recordCreatedDirectory(directoryPath: string): void {
    this.assertMutable();
    this.assertGardenMutationOwnership();
    const relativePath = this.relativeWithinCluster(directoryPath, true);
    const key =
      process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    if (
      this.journal.createdDirectories.some(
        (entry) =>
          (process.platform === "win32" ? entry.toLowerCase() : entry) === key,
      )
    )
      return;
    if (fs.existsSync(directoryPath)) {
      throw new Error(
        "Knowledge transaction was asked to record an existing directory.",
      );
    }
    if (
      this.journal.createdDirectories.length >=
      MAX_KNOWLEDGE_TRANSACTION_DIRECTORIES
    ) {
      throw new Error(
        "Knowledge transaction directory count exceeded its bound.",
      );
    }
    this.updateJournal({
      ...this.journal,
      createdDirectories: [...this.journal.createdDirectories, relativePath],
    });
  }

  prepareResult(expectedSha256: string): void {
    this.assertMutable();
    this.assertGardenMutationOwnership();
    if (!KNOWLEDGE_TRANSACTION_SHA256.test(expectedSha256)) {
      throw new Error("Knowledge transaction result digest is invalid.");
    }
    this.updateJournal({
      ...this.journal,
      state: "result-pending",
      resultSha256: expectedSha256,
    });
  }

  prepareResultReplacement(expectedSha256: string): void {
    this.assertGardenMutationOwnership();
    if (
      this.finalized ||
      this.journal.state !== "committed" ||
      !this.journal.resultSha256 ||
      !KNOWLEDGE_TRANSACTION_SHA256.test(expectedSha256)
    ) {
      throw new Error(
        "Knowledge transaction cannot replace its durable result.",
      );
    }
    const current = hashKnowledgeFile(this.resultPath);
    if (current.sha256 !== this.journal.resultSha256) {
      throw new Error(
        "Knowledge transaction result changed before reconciliation.",
      );
    }
    this.updateJournal({
      ...this.journal,
      state: "reconciling",
      replacementResultSha256: expectedSha256,
    });
  }

  readCommittedResult(): Buffer {
    if (
      this.finalized ||
      !["committed", "reconciling"].includes(this.journal.state) ||
      !this.journal.resultSha256
    ) {
      throw new Error("Knowledge transaction has no committed result.");
    }
    const opened = hashKnowledgeFile(this.resultPath);
    if (
      opened.sizeBytes < 1 ||
      opened.sizeBytes > MAX_KNOWLEDGE_TRANSACTION_RESULT_BYTES
    ) {
      throw new Error(
        "Knowledge transaction committed result is outside its bound.",
      );
    }
    const bytes = fs.readFileSync(this.resultPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== opened.sizeBytes || digest !== opened.sha256) {
      throw new Error(
        "Knowledge transaction committed result changed while it was read.",
      );
    }
    const accepted =
      this.journal.state === "reconciling"
        ? [this.journal.resultSha256, this.journal.replacementResultSha256]
        : [this.journal.resultSha256];
    if (!accepted.includes(digest)) {
      throw new Error(
        "Knowledge transaction committed result failed its integrity check.",
      );
    }
    return bytes;
  }

  commit(): void {
    this.assertGardenMutationOwnership();
    if (this.finalized)
      throw new Error("Knowledge write transaction was finalized.");
    if (this.journal.state === "committed") return;
    if (this.journal.state === "active") {
      if (this.retainCommittedJournal) {
        throw new Error(
          "Durable knowledge transactions require a result commit point.",
        );
      }
      removeKnowledgeTransactionDirectory(
        this.registryRoot,
        this.transactionDir,
        this.journal.transactionId,
        "committed",
      );
      this.finalized = true;
      this.releaseOwnership();
      return;
    } else if (this.journal.state === "result-pending") {
      const result = hashKnowledgeFile(this.resultPath);
      if (result.sha256 !== this.journal.resultSha256) {
        throw new Error(
          "Knowledge transaction result did not reach its commit point.",
        );
      }
      this.updateJournal({ ...this.journal, state: "committed" });
    } else if (this.journal.state === "reconciling") {
      const result = hashKnowledgeFile(this.resultPath);
      if (result.sha256 !== this.journal.replacementResultSha256) {
        throw new Error(
          "Knowledge transaction replacement result did not reach its commit point.",
        );
      }
      const replacementResultSha256 = this.journal.replacementResultSha256;
      const next = {
        ...this.journal,
        state: "committed",
        resultSha256: replacementResultSha256,
      };
      delete next.replacementResultSha256;
      this.updateJournal(next as KnowledgeTransactionJournal);
    } else {
      throw new Error("Knowledge transaction state is invalid.");
    }
  }

  seal(): void {
    if (this.finalized) return;
    this.assertGardenMutationOwnership();
    if (this.journal.state !== "committed" || !this.journal.resultSha256) {
      throw new Error("Only a committed knowledge transaction can be sealed.");
    }
    if (
      this.journal.entries.length > 0 ||
      this.journal.createdDirectories.length > 0
    ) {
      this.updateJournal({
        ...this.journal,
        entries: [],
        createdDirectories: [],
      });
    }
    for (const entry of readBoundedKnowledgeDirectoryEntries(
      this.backupDir,
      MAX_KNOWLEDGE_TRANSACTION_ENTRIES + 1,
      "Knowledge transaction backup directory",
    )) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error("Knowledge transaction backup directory is corrupt.");
      }
      fs.rmSync(path.join(this.backupDir, entry.name));
    }
    fsyncKnowledgeDirectory(this.backupDir);
    const tombstone: KnowledgeCommitTombstone = {
      version: 1,
      transactionId: this.journal.transactionId,
      clusterPathSha256: this.journal.clusterPathSha256,
      state: "committed",
      resultSha256: this.journal.resultSha256,
    };
    const tombstonePath = knowledgeCommitTombstonePath(this.resultPath);
    if (fs.existsSync(tombstonePath)) {
      const existing = readKnowledgeCommitTombstone(
        this.resultPath,
        this.journal.transactionId,
      );
      if (
        existing.clusterPathSha256 !== tombstone.clusterPathSha256 ||
        existing.state !== "committed" ||
        existing.resultSha256 !== tombstone.resultSha256
      ) {
        throw new Error(
          "Knowledge commit tombstone conflicts with the transaction.",
        );
      }
    }
    writeKnowledgeCommitTombstone(this.resultPath, tombstone);
    removeKnowledgeTransactionDirectory(
      this.registryRoot,
      this.transactionDir,
      this.journal.transactionId,
      "committed",
    );
    this.finalized = true;
    this.releaseOwnership();
  }

  finalize(): void {
    if (this.finalized) return;
    this.assertGardenMutationOwnership();
    if (this.journal.state !== "committed") {
      throw new Error(
        "Only a committed knowledge transaction can be finalized.",
      );
    }
    removeKnowledgeTransactionDirectory(
      this.registryRoot,
      this.transactionDir,
      this.journal.transactionId,
      "committed",
    );
    this.finalized = true;
    this.releaseOwnership();
  }

  rollback(): void {
    if (this.finalized) return;
    this.assertGardenMutationOwnership();
    if (
      this.journal.state === "result-pending" &&
      fs.existsSync(this.resultPath)
    ) {
      const result = hashKnowledgeFile(this.resultPath);
      if (result.sha256 === this.journal.resultSha256) {
        throw new Error(
          "Knowledge transaction crossed its durable result commit point.",
        );
      }
      throw new Error("Knowledge transaction result is corrupt.");
    }
    if (
      this.journal.state !== "active" &&
      this.journal.state !== "result-pending"
    ) {
      throw new Error(
        `Knowledge write transaction is already ${this.journal.state}.`,
      );
    }
    const failures: Error[] = [];
    for (const entry of [...this.journal.entries].reverse()) {
      try {
        const filePath = this.resolveJournalPath(entry.relativePath);
        if (entry.original.kind === "file") {
          const existing = fs.existsSync(filePath)
            ? fs.lstatSync(filePath)
            : null;
          if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
            throw new Error("Knowledge rollback target became indirect.");
          }
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          restoreKnowledgeSnapshot(
            path.join(this.backupDir, entry.original.backupName),
            filePath,
            entry.original,
          );
        } else if (fs.existsSync(filePath)) {
          const existing = fs.lstatSync(filePath);
          if (!existing.isFile() || existing.isSymbolicLink()) {
            throw new Error("Knowledge rollback target became indirect.");
          }
          fs.rmSync(filePath);
          fsyncKnowledgeDirectory(path.dirname(filePath));
        }
      } catch (error) {
        failures.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    for (const relativePath of [...this.journal.createdDirectories].reverse()) {
      try {
        const directoryPath = this.resolveJournalPath(relativePath, true);
        if (!fs.existsSync(directoryPath)) continue;
        const metadata = fs.lstatSync(directoryPath);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          throw new Error("Knowledge rollback directory became indirect.");
        }
        if (fs.readdirSync(directoryPath).length === 0) {
          fs.rmdirSync(directoryPath);
          fsyncKnowledgeDirectory(path.dirname(directoryPath));
        }
      } catch (error) {
        failures.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Failed to restore every knowledge file after ingestion rollback.",
      );
    }
    removeKnowledgeTransactionDirectory(
      this.registryRoot,
      this.transactionDir,
      this.journal.transactionId,
      "rolled-back",
    );
    this.finalized = true;
    this.releaseOwnership();
  }

  static recover(
    clusterDir: string,
    options: KnowledgeWriteTransactionOptions,
    assertExternalGardenMutationLease: () => void,
  ): KnowledgeWriteRecovery {
    assertExternalGardenMutationLease();
    const transactionDir = path.join(
      options.registryRoot,
      options.transactionId,
    );
    assertDirectKnowledgeDirectory(
      transactionDir,
      "Knowledge transaction directory",
    );
    const journal = readKnowledgeJournal(transactionDir, options.transactionId);
    if (journal.clusterPathSha256 !== knowledgeClusterPathSha256(clusterDir)) {
      throw new Error(
        "Knowledge transaction journal belongs to another garden.",
      );
    }
    if (processIsAliveForKnowledgeTransaction(journal.ownerPid)) {
      throw new Error("A live ingestion transaction cannot be recovered.");
    }
    const tombstonePath = knowledgeCommitTombstonePath(options.resultPath);
    if (fs.existsSync(tombstonePath)) {
      const tombstone = readKnowledgeCommitTombstone(
        options.resultPath,
        options.transactionId,
      );
      if (
        journal.state !== "committed" ||
        journal.resultSha256 !== tombstone.resultSha256 ||
        journal.clusterPathSha256 !== tombstone.clusterPathSha256
      ) {
        throw new Error(
          "Knowledge transaction conflicts with an existing commit tombstone.",
        );
      }
    }
    const transaction = new DiskBackedKnowledgeWriteTransaction(
      clusterDir,
      options,
      journal,
      assertExternalGardenMutationLease,
    );
    if (journal.state === "active") {
      transaction.rollback();
      return { transactionId: options.transactionId, outcome: "rolled-back" };
    }
    if (journal.state === "result-pending") {
      if (!fs.existsSync(options.resultPath)) {
        transaction.rollback();
        return { transactionId: options.transactionId, outcome: "rolled-back" };
      }
      transaction.commit();
    } else if (journal.state === "reconciling") {
      const result = hashKnowledgeFile(options.resultPath);
      if (result.sha256 === journal.replacementResultSha256) {
        transaction.commit();
      } else if (result.sha256 === journal.resultSha256) {
        const next = { ...journal, state: "committed" };
        delete next.replacementResultSha256;
        transaction.updateJournal(next as KnowledgeTransactionJournal);
      } else {
        throw new Error(
          "Knowledge transaction reconciliation result is corrupt.",
        );
      }
    } else {
      transaction.readCommittedResult();
    }
    return {
      transactionId: options.transactionId,
      outcome: "committed",
      transaction,
    };
  }
}

class CommittedKnowledgeWriteTransaction implements KnowledgeWriteTransaction {
  private readonly clusterDir: string;
  private readonly registryRoot: string;
  private readonly transactionId: string;
  private readonly resultPath: string;
  private tombstone: KnowledgeCommitTombstone;
  private registryLock: HeldKnowledgeTransactionRegistryLock | null = null;
  private gardenMutationLease: GardenMutationLease | null = null;
  private finalized = false;

  constructor(
    clusterDir: string,
    registryRoot: string,
    transactionId: string,
    resultPath: string,
    tombstone: KnowledgeCommitTombstone,
  ) {
    this.clusterDir = path.resolve(clusterDir);
    this.registryRoot = path.resolve(registryRoot);
    this.transactionId = transactionId;
    this.resultPath = path.resolve(resultPath);
    this.tombstone = tombstone;
    assertDirectKnowledgeDirectory(
      this.registryRoot,
      "Knowledge transaction registry",
    );
    assertDirectKnowledgeDirectory(
      path.dirname(this.resultPath),
      "Knowledge transaction result directory",
    );
    if (
      tombstone.clusterPathSha256 !==
      knowledgeClusterPathSha256(this.clusterDir)
    ) {
      throw new Error("Knowledge commit tombstone belongs to another garden.");
    }
    this.gardenMutationLease = acquireGardenMutationLease(
      this.clusterDir,
      "document-ingestion-commit-recovery",
      {
        ownerId: this.transactionId,
        processBoundStaleMs: INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
        recoverStaleProcessBoundLease: true,
      },
    );
    try {
      this.registryLock = acquireKnowledgeRegistryLock(
        this.registryRoot,
        this.transactionId,
      );
      if (this.tombstone.state === "reconciling") {
        const result = hashKnowledgeFile(this.resultPath);
        const reconciledSha256 =
          result.sha256 === this.tombstone.replacementResultSha256
            ? this.tombstone.replacementResultSha256
            : result.sha256 === this.tombstone.resultSha256
              ? this.tombstone.resultSha256
              : null;
        if (!reconciledSha256) {
          throw new Error("Knowledge commit reconciliation result is corrupt.");
        }
        const next: KnowledgeCommitTombstone = {
          version: 1,
          transactionId: this.transactionId,
          clusterPathSha256: this.tombstone.clusterPathSha256,
          state: "committed",
          resultSha256: reconciledSha256,
        };
        writeKnowledgeCommitTombstone(this.resultPath, next);
        this.tombstone = next;
      }
    } catch (error) {
      try {
        this.releaseOwnership();
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          "Knowledge commit recovery failed and ownership could not be released.",
        );
      }
      throw error;
    }
  }

  private assertGardenMutationOwnership(): void {
    if (!this.gardenMutationLease) {
      throw new Error(
        "Knowledge commit recovery has no Garden mutation lease.",
      );
    }
    assertActiveGardenMutationLease(this.gardenMutationLease);
  }

  private releaseOwnership(): void {
    const failures: Error[] = [];
    try {
      releaseKnowledgeRegistryLock(this.registryRoot, this.registryLock);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.registryLock = null;
    }
    try {
      this.gardenMutationLease?.release();
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.gardenMutationLease = null;
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Knowledge commit recovery ownership could not be released cleanly.",
      );
    }
  }

  private assertNotFinalized(): void {
    if (this.finalized) {
      throw new Error("Knowledge commit reconciliation was finalized.");
    }
  }

  captureFile(): void {
    throw new Error("A committed knowledge transaction cannot capture files.");
  }

  recordCreatedDirectory(): void {
    throw new Error(
      "A committed knowledge transaction cannot capture directories.",
    );
  }

  prepareResult(): void {
    throw new Error("A committed knowledge transaction already has a result.");
  }

  prepareResultReplacement(expectedSha256: string): void {
    this.assertNotFinalized();
    this.assertGardenMutationOwnership();
    if (
      this.tombstone.state !== "committed" ||
      !KNOWLEDGE_TRANSACTION_SHA256.test(expectedSha256)
    ) {
      throw new Error("Knowledge commit tombstone cannot replace its result.");
    }
    const current = hashKnowledgeFile(this.resultPath);
    if (current.sha256 !== this.tombstone.resultSha256) {
      throw new Error("Knowledge commit result changed before reconciliation.");
    }
    const next: KnowledgeCommitTombstone = {
      ...this.tombstone,
      state: "reconciling",
      replacementResultSha256: expectedSha256,
    };
    writeKnowledgeCommitTombstone(this.resultPath, next);
    this.tombstone = next;
  }

  readCommittedResult(): Buffer {
    this.assertNotFinalized();
    this.assertGardenMutationOwnership();
    const opened = hashKnowledgeFile(this.resultPath);
    if (
      opened.sizeBytes < 1 ||
      opened.sizeBytes > MAX_KNOWLEDGE_TRANSACTION_RESULT_BYTES
    ) {
      throw new Error("Knowledge commit result is outside its bound.");
    }
    const bytes = fs.readFileSync(this.resultPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== opened.sizeBytes || digest !== opened.sha256) {
      throw new Error("Knowledge commit result changed while it was read.");
    }
    const accepted =
      this.tombstone.state === "reconciling"
        ? [this.tombstone.resultSha256, this.tombstone.replacementResultSha256]
        : [this.tombstone.resultSha256];
    if (!accepted.includes(digest)) {
      throw new Error("Knowledge commit result failed its integrity check.");
    }
    return bytes;
  }

  commit(): void {
    this.assertNotFinalized();
    this.assertGardenMutationOwnership();
    if (this.tombstone.state === "committed") return;
    const result = hashKnowledgeFile(this.resultPath);
    if (result.sha256 !== this.tombstone.replacementResultSha256) {
      throw new Error(
        "Knowledge commit replacement did not reach its commit point.",
      );
    }
    const next: KnowledgeCommitTombstone = {
      version: 1,
      transactionId: this.transactionId,
      clusterPathSha256: this.tombstone.clusterPathSha256,
      state: "committed",
      resultSha256: result.sha256,
    };
    writeKnowledgeCommitTombstone(this.resultPath, next);
    this.tombstone = next;
  }

  seal(): void {
    if (this.finalized) return;
    this.assertGardenMutationOwnership();
    if (this.tombstone.state !== "committed") {
      throw new Error("Knowledge commit reconciliation is incomplete.");
    }
    this.finalized = true;
    this.releaseOwnership();
  }

  finalize(): void {
    this.assertNotFinalized();
    if (this.tombstone.state !== "committed") {
      throw new Error("Knowledge commit reconciliation is incomplete.");
    }
    fs.rmSync(knowledgeCommitTombstonePath(this.resultPath));
    fsyncKnowledgeDirectory(path.dirname(this.resultPath));
    this.seal();
  }

  rollback(): void {
    throw new Error("A committed knowledge transaction cannot be rolled back.");
  }
}

export function knowledgeWriteTransactionRegistryRoot(
  dataRoot: string,
  contentPath: string,
  clusterSlug: string,
): string {
  const clusterDir = path.join(contentPath, clusterSlug.trim());
  const gardenKey = knowledgeClusterPathSha256(clusterDir).slice(0, 32);
  return path.join(dataRoot, "runtime", "ingestion-transactions", gardenKey);
}

export function recoverKnowledgeWriteTransactions(
  contentPath: string,
  clusterSlug: string,
  registryRoot: string,
  runtimeJobsRoot: string,
): KnowledgeWriteRecovery[] {
  const clusterDir = path.join(contentPath, clusterSlug.trim());
  if (!fs.existsSync(registryRoot)) return [];
  assertDirectKnowledgeDirectory(
    registryRoot,
    "Knowledge transaction registry",
  );
  let recoveryLease: GardenMutationLease;
  try {
    recoveryLease = acquireGardenMutationLease(
      clusterDir,
      "document-ingestion-recovery",
      {
        ownerId: `recovery-${process.pid}-${randomBytes(8).toString("hex")}`,
        processBoundStaleMs: INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
        recoverStaleProcessBoundLease: true,
      },
    );
  } catch (error) {
    if (isLiveKnowledgeTransactionConflict(error)) {
      throw liveKnowledgeTransactionError(
        "A live ingestion transaction cannot be recovered.",
      );
    }
    throw error;
  }
  let recoveryLock: HeldKnowledgeTransactionRegistryLock | null = null;
  // Own the same per-garden lock as a writer for the whole scan. Merely
  // observing that a prior lock is stale leaves a race where a new writer can
  // start before rollback; recovery must either win the atomic create or fail
  // without touching the garden.
  try {
    assertActiveGardenMutationLease(recoveryLease);
    clearStaleKnowledgeRegistryLock(registryRoot);
    recoveryLock = acquireKnowledgeRegistryLock(
      registryRoot,
      `recovery_${process.pid}_${randomBytes(8).toString("hex")}`,
    );
    const recoveries: KnowledgeWriteRecovery[] = [];
    const entries = readBoundedKnowledgeDirectoryEntries(
      registryRoot,
      MAX_KNOWLEDGE_TRANSACTION_ENTRIES,
      "Knowledge transaction registry",
      KNOWLEDGE_TRANSACTION_LOCK_FILE,
    );
    for (const entry of entries) {
      if (removeKnowledgeTransactionDebris(registryRoot, entry)) continue;
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !KNOWLEDGE_TRANSACTION_IDENTIFIER.test(entry.name)
      ) {
        throw new Error(
          "Knowledge transaction registry contains an invalid entry.",
        );
      }
      const recovery = DiskBackedKnowledgeWriteTransaction.recover(
        clusterDir,
        {
          registryRoot,
          transactionId: entry.name,
          resultPath: path.join(runtimeJobsRoot, entry.name, "result.json"),
          retainCommittedJournal: true,
        },
        () => assertActiveGardenMutationLease(recoveryLease),
      );
      if (recovery.outcome === "committed") {
        if (!recovery.transaction) {
          throw new Error(
            "Committed knowledge transaction recovery is invalid.",
          );
        }
        recovery.transaction.seal();
        recoveries.push({ transactionId: entry.name, outcome: "committed" });
      } else {
        recoveries.push(recovery);
      }
    }
    return recoveries;
  } finally {
    try {
      releaseKnowledgeRegistryLock(registryRoot, recoveryLock);
    } finally {
      recoveryLease.release();
    }
  }
}

export function recoverCommittedKnowledgeWriteTransaction(
  contentPath: string,
  clusterSlug: string,
  registryRoot: string,
  transactionId: string,
  resultPath: string,
): KnowledgeWriteRecovery | null {
  if (!KNOWLEDGE_TRANSACTION_IDENTIFIER.test(transactionId)) {
    throw new Error("Knowledge commit transaction identity is invalid.");
  }
  const tombstonePath = knowledgeCommitTombstonePath(resultPath);
  if (!fs.existsSync(tombstonePath)) return null;
  assertDirectKnowledgeDirectory(
    registryRoot,
    "Knowledge transaction registry",
  );
  clearStaleKnowledgeRegistryLock(registryRoot);
  const tombstone = readKnowledgeCommitTombstone(resultPath, transactionId);
  const transaction = new CommittedKnowledgeWriteTransaction(
    path.join(contentPath, clusterSlug.trim()),
    registryRoot,
    transactionId,
    resultPath,
    tombstone,
  );
  try {
    transaction.readCommittedResult();
  } catch (error) {
    try {
      transaction.seal();
    } catch {
      // The original integrity failure remains authoritative.
    }
    throw error;
  }
  return { transactionId, outcome: "committed", transaction };
}

export function createKnowledgeWriteTransaction(
  contentPath: string,
  clusterSlug: string,
  backupRootOrOptions: string | KnowledgeWriteTransactionOptions = os.tmpdir(),
): KnowledgeWriteTransaction {
  const options =
    typeof backupRootOrOptions === "string"
      ? {
          registryRoot: backupRootOrOptions,
          transactionId: `knowledge_${process.pid}_${Date.now()}_${randomBytes(8).toString("hex")}`,
          resultPath: path.join(
            backupRootOrOptions,
            `.breadboard-unused-result-${process.pid}-${Date.now()}`,
          ),
          retainCommittedJournal: false,
        }
      : backupRootOrOptions;
  return new DiskBackedKnowledgeWriteTransaction(
    path.join(contentPath, clusterSlug.trim()),
    options,
  );
}

function ensureKnowledgeDirectory(
  directoryPath: string,
  transaction?: KnowledgeWriteTransaction,
): string {
  const missing: string[] = [];
  let current = path.resolve(directoryPath);
  while (!fs.existsSync(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const created of missing.reverse()) {
    transaction?.recordCreatedDirectory(created);
  }
  fs.mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
}

let knowledgeTextWriteSequence = 0;

function writeKnowledgeTextFile(
  filePath: string,
  content: string,
  transaction?: KnowledgeWriteTransaction,
): void {
  transaction?.captureFile(filePath);
  const temporaryPath = `${filePath}.pending.${process.pid}.${knowledgeTextWriteSequence++}`;
  transaction?.captureFile(temporaryPath);
  let descriptor: number | undefined;
  try {
    const mode = fs.existsSync(filePath)
      ? fs.statSync(filePath).mode & 0o777
      : 0o666;
    descriptor = fs.openSync(temporaryPath, "wx", mode);
    fs.writeFileSync(descriptor, content, "utf-8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    fsyncKnowledgeFile(filePath);
    fsyncKnowledgeDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

let knowledgeBinaryWriteSequence = 0;

function writeKnowledgeBinaryFile(
  filePath: string,
  bytes: Uint8Array,
  transaction?: KnowledgeWriteTransaction,
): void {
  transaction?.captureFile(filePath);
  const temporaryPath = `${filePath}.pending.${process.pid}.${knowledgeBinaryWriteSequence++}`;
  transaction?.captureFile(temporaryPath);
  let descriptor: number | undefined;
  try {
    const mode = fs.existsSync(filePath)
      ? fs.statSync(filePath).mode & 0o777
      : 0o666;
    descriptor = fs.openSync(temporaryPath, "wx", mode);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    fsyncKnowledgeFile(filePath);
    fsyncKnowledgeDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

let knowledgeFileCopySequence = 0;

/** Copy a potentially multi-gigabyte source asset without buffering it in JS. */
function copyKnowledgeFile(
  sourcePath: string,
  targetPath: string,
  expectedSha256: string,
  transaction?: KnowledgeWriteTransaction,
): void {
  if (!KNOWLEDGE_TRANSACTION_SHA256.test(expectedSha256)) {
    throw new Error("Knowledge source asset hash is invalid.");
  }
  const source = hashKnowledgeFile(sourcePath);
  if (source.sha256 !== expectedSha256) {
    throw new Error("Knowledge source asset changed before it was saved.");
  }
  if (fs.existsSync(targetPath)) {
    const existing = hashKnowledgeFile(targetPath);
    if (
      existing.sha256 === source.sha256 &&
      existing.sizeBytes === source.sizeBytes
    ) {
      return;
    }
    throw new Error("Knowledge source asset path is already occupied.");
  }

  transaction?.captureFile(targetPath);
  const temporaryPath = `${targetPath}.pending.${process.pid}.${knowledgeFileCopySequence++}`;
  transaction?.captureFile(temporaryPath);
  try {
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    const copied = hashKnowledgeFile(temporaryPath);
    if (
      copied.sha256 !== source.sha256 ||
      copied.sizeBytes !== source.sizeBytes
    ) {
      throw new Error("Knowledge source asset copy failed its integrity check.");
    }
    fs.renameSync(temporaryPath, targetPath);
    fsyncKnowledgeFile(targetPath);
    fsyncKnowledgeDirectory(path.dirname(targetPath));
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function renameKnowledgeFile(
  sourcePath: string,
  targetPath: string,
  transaction?: KnowledgeWriteTransaction,
): void {
  transaction?.captureFile(sourcePath);
  transaction?.captureFile(targetPath);
  fs.renameSync(sourcePath, targetPath);
  fsyncKnowledgeFile(targetPath);
  fsyncKnowledgeDirectory(path.dirname(sourcePath));
  if (path.dirname(targetPath) !== path.dirname(sourcePath)) {
    fsyncKnowledgeDirectory(path.dirname(targetPath));
  }
}

function ensureDirectory(
  root: string,
  relPath: string,
  transaction?: KnowledgeWriteTransaction,
): string {
  const dir = path.join(root, ...relPath.split("/"));
  return ensureKnowledgeDirectory(dir, transaction);
}

function cleanFileSegment(value: string): string {
  return slugify(value).replace(/^-+|-+$/g, "") || "section";
}

/** True when a title is just a file-name artifact ("2510.27379v1"), not a
 * human topic title. Visible folders must never be named after raw uploads. */
export function looksLikeFileArtifactTitle(
  title: string,
  sourceFileName = "",
): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;
  const fileBase = sourceFileName.replace(/\.[a-z0-9]+$/i, "");
  if (fileBase && slugify(trimmed) === slugify(fileBase)) return true;
  const compactTitle = trimmed.replace(/\s+/g, "");
  // arXiv-style / numeric-dotted identifiers.
  if (/^[0-9]{3,5}[.\-_][0-9]{3,6}(v[0-9]+)?$/i.test(compactTitle)) return true;
  const letters = trimmed.replace(/[^a-zA-Z]/g, "");
  return letters.length < 4;
}

const TITLE_SCAN_BANNED =
  /\b(issn|doi|journal|volume|issue|copyright|license|licence|received|revised|accepted|published|university|department|corresponding|author|email|http|www)\b|@/i;

/**
 * Best-effort clean title for a source whose extracted title is a file-name
 * artifact. Tries, in order: a real markdown heading, an "Original Article
 * <Title>" style marker, a Title-Case run near the top of the text, and
 * finally the artifact title itself (callers keep their own last resort).
 */
export function humanizeSourceTitle(
  candidateTitle: string,
  sourceFileName: string,
  sourceText: string,
): string {
  if (!looksLikeFileArtifactTitle(candidateTitle, sourceFileName)) {
    return candidateTitle.trim();
  }

  const text = sourceText
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 4000);

  const heading = sourceText.match(/^#{1,3}\s+(.{8,120})\s*$/m)?.[1]?.trim();
  if (
    heading &&
    !looksLikeFileArtifactTitle(heading, sourceFileName) &&
    !TITLE_SCAN_BANNED.test(heading) &&
    !/^(summary|source material|source snapshots?|snapshots?|abstract|introduction|contents?)$/i.test(
      heading,
    )
  ) {
    return heading;
  }

  const articleMarker = text.match(
    /(?:original|research|review)\s+article\s+(.{10,140}?)(?=\s+[A-Z][a-z]+\s+[A-Z]\.|\s+abstract\b|$)/i,
  );
  if (articleMarker?.[1] && !TITLE_SCAN_BANNED.test(articleMarker[1])) {
    const candidate = articleMarker[1].trim().replace(/[,;:\-\s]+$/, "");
    if (!looksLikeFileArtifactTitle(candidate, sourceFileName))
      return candidate;
  }

  // First Title-Case run of 4-14 words without boilerplate vocabulary.
  const words = text.split(" ").filter(Boolean);
  for (let start = 0; start < Math.min(words.length, 220); start += 1) {
    for (let length = 14; length >= 4; length -= 1) {
      const run = words.slice(start, start + length);
      if (run.length < 4) continue;
      const phrase = run.join(" ").replace(/[,;.]+$/, "");
      if (TITLE_SCAN_BANNED.test(phrase) || /\d{3,}/.test(phrase)) continue;
      const capitalized = run.filter((word) => /^[A-Z]/.test(word)).length;
      if (capitalized / run.length < 0.6) continue;
      if (looksLikeFileArtifactTitle(phrase, sourceFileName)) continue;
      return phrase;
    }
  }

  return candidateTitle.trim();
}

function sourceSectionNumber(clusterDir: string): number {
  if (!fs.existsSync(clusterDir)) return 1;
  const existing = fs
    .readdirSync(clusterDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.match(/^(\d+)\./)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number.parseInt(value, 10))
    .filter(Number.isFinite);
  return existing.length > 0 ? Math.max(...existing) + 1 : 1;
}

function wikilinkForRelPath(relPath: string, label: string): string {
  const withoutExtension = relPath.replace(/\.md$/i, "");
  return wikilink(withoutExtension, label);
}

/**
 * Locate a note file by its basename slug anywhere inside the cluster
 * (root or any sub-folder such as `sources/` or `generated/`). Returns the
 * note's absolute path and cluster-relative path, or null when it does not
 * exist. Use this instead of assuming a note lives at the cluster root.
 */
export function resolveClusterNoteFile(
  contentPath: string,
  clusterSlug: string,
  slug: string,
): { filePath: string; relPath: string; entry: string } | null {
  const clusterDir = path.join(contentPath, clusterSlug.trim());
  const wanted = slug.replace(/\.md$/i, "");
  const wantedSlug = slugify(wanted);
  for (const item of walkClusterMarkdown(clusterDir)) {
    const base = item.entry.replace(/\.md$/i, "");
    if (base === wanted || slugify(base) === wantedSlug) {
      return {
        filePath: item.filePath,
        relPath: item.relPath,
        entry: item.entry,
      };
    }
  }
  return null;
}

/**
 * List every sub-folder of a cluster (POSIX paths relative to the cluster dir),
 * including empty ones, so the dashboard tree can show folders that contain no
 * notes yet. Skips `assets/` and dotfiles.
 */
export function listClusterFolders(clusterDir: string): string[] {
  if (!fs.existsSync(clusterDir)) return [];

  const folders: string[] = [];
  const walk = (dir: string, relDir: string) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const name = dirent.name;
      if (name === "assets" || name.startsWith(".")) continue;
      const rel = relDir ? `${relDir}/${name}` : name;
      folders.push(rel);
      walk(path.join(dir, name), rel);
    }
  };

  walk(clusterDir, "");
  return folders.sort((a, b) => a.localeCompare(b));
}

function extractExistingSlugs(clusterDir: string): Set<string> {
  return new Set(
    walkClusterMarkdown(clusterDir).map((item) =>
      item.entry.replace(/\.md$/, ""),
    ),
  );
}

function buildLocatedPromptChunks(
  pages: DocumentPage[],
  fallbackText: string,
  maxTotalChars = 50000,
): string[] {
  const chunks =
    pages.length > 0
      ? pages.map(
          (page) =>
            `[[${cleanGeneratedText(page.label)}]]\n${truncate(cleanGeneratedText(page.text), 9000)}`,
        )
      : (cleanGeneratedText(fallbackText)
          .match(new RegExp(`[\\s\\S]{1,${maxTotalChars}}`, "g"))
          ?.map(
            (chunk, index) => `[[Document chunk ${index + 1}]]\n${chunk}`,
          ) ?? [
          `[[Document]]\n${truncate(cleanGeneratedText(fallbackText), maxTotalChars)}`,
        ]);

  const output: string[] = [];
  let current = "";
  for (const chunk of chunks) {
    if (current && current.length + chunk.length > maxTotalChars) {
      output.push(current.trim());
      current = "";
    }
    current += `${chunk}\n\n`;
  }
  if (current.trim()) output.push(current.trim());

  return output.length > 0
    ? output
    : [truncate(cleanGeneratedText(fallbackText), maxTotalChars)];
}

function buildLocatedPromptText(
  pages: DocumentPage[],
  fallbackText: string,
): string {
  return (
    buildLocatedPromptChunks(pages, fallbackText, 60000)[0] ??
    truncate(cleanGeneratedText(fallbackText), 60000)
  );
}

function fallbackKnowledgeExtraction(
  title: string,
  text: string,
  pages: DocumentPage[],
): KnowledgeExtraction {
  const headings = Array.from(text.matchAll(/^#{1,3}\s+(.+)$/gm))
    .map((match) => compactText(cleanGeneratedText(match[1] ?? "")))
    .filter(Boolean)
    .slice(0, 8);
  const summary =
    compactText(cleanGeneratedText(text)).slice(0, 800) ||
    "No extractable text was found in this upload.";
  const location = pages[0]?.label ? [pages[0].label] : ["Uploaded document"];
  const topics = (headings.length > 0 ? headings : [title]).map((heading) => ({
    title: heading,
    slug: slugify(heading),
    explanation: summary,
    keyPoints: [summary],
    sourceEvidence: [summary],
    locations: location,
    relatedTopics: [],
    tags: semanticTagsFromText(`${heading}\n${summary}`, 6, text),
  }));

  return {
    documentTitle: title,
    summary,
    topics,
    relationships: [],
    suggestedTags: semanticTagsFromText(`${title}\n${summary}`, 8, text),
  };
}

function normalizeExtraction(
  parsed: unknown,
  fallbackTitle: string,
  text: string,
  pages: DocumentPage[],
): KnowledgeExtraction {
  if (!parsed || typeof parsed !== "object") {
    return fallbackKnowledgeExtraction(fallbackTitle, text, pages);
  }

  const obj = parsed as Record<string, unknown>;
  const rawTopics = Array.isArray(obj.topics) ? obj.topics : [];
  const topics: ExtractedTopic[] = rawTopics
    .map((topic): ExtractedTopic | undefined => {
      if (!topic || typeof topic !== "object") return undefined;
      const record = topic as Record<string, unknown>;
      const title = asString(record.title);
      if (!title) return undefined;
      const explanation = asString(
        record.explanation,
        asString(record.summary, ""),
      );
      const keyPoints = asStringArray(record.keyPoints);
      const sourceEvidence = asStringArray(record.sourceEvidence);
      return {
        title,
        slug: slugify(asString(record.slug, title)),
        explanation,
        keyPoints,
        sourceEvidence: sourceEvidence.length > 0 ? sourceEvidence : keyPoints,
        locations: asStringArray(record.locations),
        relatedTopics: asStringArray(record.relatedTopics),
        tags: normalizeTopicTags(
          asStringArray(record.tags),
          [
            title,
            explanation,
            keyPoints.join(" "),
            sourceEvidence.join(" "),
          ].join("\n"),
          8,
          [title, text].join("\n"),
        ),
      };
    })
    .filter((topic): topic is ExtractedTopic => Boolean(topic));

  const relationships = Array.isArray(obj.relationships)
    ? obj.relationships
        .map((relationship) => {
          if (!relationship || typeof relationship !== "object")
            return undefined;
          const record = relationship as Record<string, unknown>;
          const source = asString(record.source);
          const target = asString(record.target);
          if (!source || !target) return undefined;
          return {
            source,
            target,
            relation: asString(record.relation, "related"),
          };
        })
        .filter((relationship): relationship is TopicRelationship =>
          Boolean(relationship),
        )
    : [];

  const normalized: KnowledgeExtraction = {
    documentTitle: asString(obj.documentTitle, fallbackTitle),
    summary: asString(obj.summary, compactText(text).slice(0, 800)),
    topics,
    relationships,
    suggestedTags: normalizeTopicTags(
      asStringArray(obj.suggestedTags),
      [
        fallbackTitle,
        asString(obj.summary, compactText(text).slice(0, 800)),
        text.slice(0, 2000),
      ].join("\n"),
      10,
      [fallbackTitle, text].join("\n"),
    ),
  };

  if (normalized.topics.length === 0 && text.trim()) {
    return fallbackKnowledgeExtraction(fallbackTitle, text, pages);
  }

  return normalized;
}

function cleanDocumentPages(pages: DocumentPage[]): DocumentPage[] {
  return pages.map((page) => ({
    ...page,
    label: cleanGeneratedText(page.label),
    text: cleanGeneratedText(page.text),
    imageAlt: page.imageAlt ? cleanGeneratedText(page.imageAlt) : page.imageAlt,
  }));
}

function mergeExplanations(left: string, right: string): string {
  const values = uniqueNonEmpty([left, right]);
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values[0].toLowerCase().includes(values[1].toLowerCase()))
    return values[0];
  if (values[1].toLowerCase().includes(values[0].toLowerCase()))
    return values[1];
  return `${values[0]}\n\n${values[1]}`.slice(0, 1800).trim();
}

function mergeKnowledgeExtractions(
  extractions: KnowledgeExtraction[],
  fallbackTitle: string,
  text: string,
  pages: DocumentPage[],
): KnowledgeExtraction {
  if (extractions.length === 0)
    return fallbackKnowledgeExtraction(fallbackTitle, text, pages);

  const topicBySlug = new Map<string, ExtractedTopic>();
  for (const extraction of extractions) {
    for (const topic of extraction.topics) {
      const key = slugify(topic.slug || topic.title);
      const existing = topicBySlug.get(key);
      if (!existing) {
        topicBySlug.set(key, {
          ...topic,
          explanation: cleanGeneratedText(topic.explanation),
          keyPoints: uniqueNonEmpty(
            topic.keyPoints.map(cleanGeneratedText),
            12,
          ),
          sourceEvidence: uniqueNonEmpty(
            topic.sourceEvidence.map(cleanGeneratedText),
            12,
          ),
          locations: uniqueNonEmpty(
            topic.locations.map(cleanGeneratedText),
            30,
          ),
          relatedTopics: uniqueNonEmpty(
            topic.relatedTopics.map(cleanGeneratedText),
            20,
          ),
          tags: normalizeTopicTags(
            topic.tags,
            [topic.title, topic.explanation].join("\n"),
            8,
            [topic.title, text].join("\n"),
          ),
        });
        continue;
      }

      existing.explanation = mergeExplanations(
        existing.explanation,
        topic.explanation,
      );
      existing.keyPoints = uniqueNonEmpty(
        [...existing.keyPoints, ...topic.keyPoints.map(cleanGeneratedText)],
        14,
      );
      existing.sourceEvidence = uniqueNonEmpty(
        [
          ...existing.sourceEvidence,
          ...topic.sourceEvidence.map(cleanGeneratedText),
        ],
        14,
      );
      existing.locations = uniqueNonEmpty(
        [...existing.locations, ...topic.locations.map(cleanGeneratedText)],
        40,
      );
      existing.relatedTopics = uniqueNonEmpty(
        [
          ...existing.relatedTopics,
          ...topic.relatedTopics.map(cleanGeneratedText),
        ],
        30,
      );
      existing.tags = normalizeTopicTags(
        [...existing.tags, ...topic.tags],
        [
          existing.title,
          existing.explanation,
          existing.keyPoints.join("\n"),
        ].join("\n"),
        8,
        [existing.title, text].join("\n"),
      );
    }
  }

  const topicTitles = new Set(
    [...topicBySlug.values()].map((topic) => topic.title.toLowerCase()),
  );
  const relationshipKeys = new Set<string>();
  const relationships: TopicRelationship[] = [];
  for (const extraction of extractions) {
    for (const relationship of extraction.relationships) {
      if (
        !topicTitles.has(relationship.source.toLowerCase()) ||
        !topicTitles.has(relationship.target.toLowerCase())
      )
        continue;
      const relation = cleanGeneratedText(relationship.relation || "related");
      const key = `${relationship.source.toLowerCase()}->${relationship.target.toLowerCase()}:${relation}`;
      if (relationshipKeys.has(key)) continue;
      relationshipKeys.add(key);
      relationships.push({
        source: cleanGeneratedText(relationship.source),
        target: cleanGeneratedText(relationship.target),
        relation,
      });
    }
  }

  const summaries = uniqueNonEmpty(
    extractions.map((extraction) => cleanGeneratedText(extraction.summary)),
    8,
  );
  const summary =
    summaries.join("\n\n") ||
    compactText(cleanGeneratedText(text)).slice(0, 900);

  return {
    documentTitle: cleanGeneratedText(
      extractions.find((extraction) => extraction.documentTitle)
        ?.documentTitle || fallbackTitle,
    ),
    summary,
    topics: [...topicBySlug.values()],
    relationships,
    suggestedTags: normalizeTopicTags(
      extractions.flatMap((extraction) => extraction.suggestedTags),
      [fallbackTitle, summary, text.slice(0, 3000)].join("\n"),
      12,
      [fallbackTitle, text].join("\n"),
    ),
  };
}

async function requestKnowledgeExtraction({
  client,
  model,
  title,
  sourceType,
  sourceLabel,
  isHandwriting,
  locatedText,
  text,
  pages,
  chunkLabel,
}: {
  client: OpenAI;
  model: string;
  title: string;
  sourceType: string;
  sourceLabel: string;
  isHandwriting?: boolean;
  locatedText: string;
  text: string;
  pages: DocumentPage[];
  chunkLabel?: string;
}): Promise<KnowledgeExtraction> {
  const response = await client.chat.completions.create(
    withCouncil(
      {
        model,
        messages: [
          { role: "system", content: KNOWLEDGE_SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `Source title: ${title}\n` +
              `Source type: ${sourceType}\n` +
              `Source label: ${sourceLabel}\n` +
              (chunkLabel ? `Source chunk: ${chunkLabel}\n` : "") +
              `Source mode: ${isHandwriting ? "handwritten or scanned page images transcribed by vision OCR" : "machine-readable or OCR text"}\n\n` +
              `Analyze this located source text and return the JSON knowledge graph. ` +
              `If this is one chunk of a longer document, extract all durable concepts from this chunk and use exact page locations:\n\n${locatedText}`,
          },
        ],
      },
      { taskType: "concept_extraction" },
    ),
  );

  const rawContent = response.choices[0]?.message?.content ?? "{}";
  return normalizeExtraction(parseJsonObject(rawContent), title, text, pages);
}

export async function extractDocumentKnowledge({
  client,
  model,
  title,
  sourceType,
  sourceLabel,
  isHandwriting,
  pages,
  text,
  onProgress,
}: {
  client: OpenAI;
  model?: string;
  title: string;
  sourceType: string;
  sourceLabel: string;
  isHandwriting?: boolean;
  pages: DocumentPage[];
  text: string;
  onProgress?: (step: string) => void;
}): Promise<KnowledgeExtraction> {
  const selectedModel = model?.trim() || DEFAULT_MODEL;
  const cleanPages = cleanDocumentPages(pages);
  const cleanText = cleanGeneratedText(text);
  const chunks = buildLocatedPromptChunks(cleanPages, cleanText);

  try {
    if (chunks.length <= 1) {
      onProgress?.("Analyzing the document for key concepts…");
      return await requestKnowledgeExtraction({
        client,
        model: selectedModel,
        title,
        sourceType,
        sourceLabel,
        isHandwriting,
        locatedText: buildLocatedPromptText(cleanPages, cleanText),
        text: cleanText,
        pages: cleanPages,
      });
    }

    const extractions: KnowledgeExtraction[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      onProgress?.(
        `Extracting concepts from section ${index + 1} of ${chunks.length}…`,
      );
      try {
        extractions.push(
          await requestKnowledgeExtraction({
            client,
            model: selectedModel,
            title,
            sourceType,
            sourceLabel,
            isHandwriting,
            locatedText: chunks[index],
            text: cleanText,
            pages: cleanPages,
            chunkLabel: `${index + 1} of ${chunks.length}`,
          }),
        );
      } catch {
        // Keep extracting other chunks; a single bad chunk should not erase the whole map.
      }
    }

    return mergeKnowledgeExtractions(extractions, title, cleanText, cleanPages);
  } catch {
    return fallbackKnowledgeExtraction(title, cleanText, cleanPages);
  }
}

function wikilink(slug: string, label: string): string {
  return `[[${slug}|${label}]]`;
}

function formatBullets(values: string[]): string {
  return values.length > 0
    ? values.map((value) => `- ${value}`).join("\n")
    : "- No specific points extracted.";
}

function uniqueNonEmpty(values: string[], limit = values.length): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function markdownImage(pathValue: string, alt: string): string {
  const cleanAlt =
    alt
      .replace(/[\[\]\n\r]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Source snapshot";
  return `![${cleanAlt}](${pathValue.replace(/\\/g, "/")})`;
}

function pageNumberFromLabel(label: string): number | undefined {
  const cleanLabel = label.trim();
  const prefixed = [
    ...cleanLabel.matchAll(
      /\b(?:pages?|p\.?|slides?)\s*[-#:]*\s*(\d{1,5})\b/gi,
    ),
  ];
  if (prefixed.length > 0) {
    return Number.parseInt(prefixed[prefixed.length - 1][1], 10);
  }

  const pathStyle = cleanLabel.match(
    /(?:^|[-_/\\])page[-_\s]*(\d{1,5})(?:\D|$)/i,
  );
  if (pathStyle) return Number.parseInt(pathStyle[1], 10);

  const bare = cleanLabel.match(/^\s*(\d{1,5})\s*$/);
  return bare ? Number.parseInt(bare[1], 10) : undefined;
}

function pageNumberFromPage(page: DocumentPage): number | undefined {
  return (
    pageNumberFromLabel(page.label) ??
    (page.imageAlt ? pageNumberFromLabel(page.imageAlt) : undefined) ??
    (page.imagePath ? pageNumberFromLabel(page.imagePath) : undefined)
  );
}

function addPageRange(numbers: Set<number>, start: number, end?: number): void {
  if (!Number.isFinite(start)) return;
  if (!end || !Number.isFinite(end) || end < start || end - start > 25) {
    numbers.add(start);
    return;
  }

  for (let page = start; page <= end; page += 1) {
    numbers.add(page);
  }
}

function pageNumbersFromLocations(locations: string[]): Set<number> {
  const numbers = new Set<number>();
  for (const location of locations) {
    const normalizedLocation = location.replace(/[\u2013\u2014]/g, "-");
    for (const match of normalizedLocation.matchAll(
      /\b(?:pages?|p\.?|slides?)\s*[-#:]*\s*(\d{1,5})(?:\s*(?:-|–|to)\s*(\d{1,5}))?\b/gi,
    )) {
      addPageRange(
        numbers,
        Number.parseInt(match[1], 10),
        match[2] ? Number.parseInt(match[2], 10) : undefined,
      );
    }
  }
  return numbers;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLocationLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function labelMatchesLocations(
  page: DocumentPage,
  locations: string[],
): boolean {
  if (locations.length === 0 || pageNumberFromPage(page) !== undefined)
    return false;

  const locationText = normalizeLocationLabel(locations.join(" "));
  const labels = [page.label, page.imageAlt ?? ""]
    .map(normalizeLocationLabel)
    .filter(Boolean);

  return labels.some((label) => {
    if (label.length < 4) return false;
    return new RegExp(`(?:^|\\b)${escapeRegExp(label)}(?:\\b|$)`, "i").test(
      locationText,
    );
  });
}

function topicImageTokens(topic: ExtractedTopic): Set<string> {
  return tokens(
    [
      topic.title,
      topic.explanation,
      topic.keyPoints.join(" "),
      topic.sourceEvidence.join(" "),
    ].join(" "),
  );
}

function tokenIntersectionCount(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  return intersection;
}

function hasStrongPageTokenMatch(
  topicTokens: Set<string>,
  pageTokens: Set<string>,
): boolean {
  return (
    tokenIntersectionCount(topicTokens, pageTokens) >= 5 &&
    overlapScore(topicTokens, pageTokens) >= 0.08
  );
}

function pageImagesForTopic(
  topic: ExtractedTopic,
  pages: DocumentPage[],
  limit = 2,
): DocumentPage[] {
  const imagePages = pages.filter((page) => page.imagePath);
  if (imagePages.length === 0) return [];

  const chosen: DocumentPage[] = [];
  const chosenPaths = new Set<string>();
  const locationNumbers = pageNumbersFromLocations(topic.locations);
  const locationText = topic.locations.join(" ").toLowerCase();

  for (const page of imagePages) {
    const pageNumber = pageNumberFromPage(page);
    const labelMatches = labelMatchesLocations(page, topic.locations);
    if ((pageNumber && locationNumbers.has(pageNumber)) || labelMatches) {
      chosen.push(page);
      if (page.imagePath) chosenPaths.add(page.imagePath);
      if (chosen.length >= limit) return chosen;
    }
  }

  if (locationNumbers.size > 0 || locationText.length > 0) return chosen;

  const topicTokens = topicImageTokens(topic);
  const scored = imagePages
    .filter((page) => !page.imagePath || !chosenPaths.has(page.imagePath))
    .map((page) => {
      const pageTokens = tokens(`${page.label}\n${page.text}`);
      return {
        page,
        score: overlapScore(topicTokens, pageTokens),
        matched: hasStrongPageTokenMatch(topicTokens, pageTokens),
      };
    })
    .filter((item) => item.matched)
    .sort((a, b) => b.score - a.score);

  for (const { page } of scored) {
    chosen.push(page);
    if (chosen.length >= limit) break;
  }

  if (chosen.length === 0 && imagePages.length === 1)
    chosen.push(imagePages[0]);
  return chosen;
}

function formatSourceSnapshots(pages: DocumentPage[]): string {
  return pages
    .filter((page) => page.imagePath)
    .map((page) =>
      markdownImage(page.imagePath as string, page.imageAlt || page.label),
    )
    .join("\n\n");
}

function supportingPagesForTopic(
  topic: ExtractedTopic,
  pages: DocumentPage[],
  limit = 4,
): DocumentPage[] {
  if (pages.length === 0) return [];

  const chosen: DocumentPage[] = [];
  const chosenLabels = new Set<string>();
  const locationNumbers = pageNumbersFromLocations(topic.locations);
  const locationText = topic.locations.join(" ").toLowerCase();

  for (const page of pages) {
    const pageNumber = pageNumberFromPage(page);
    const labelMatches = labelMatchesLocations(page, topic.locations);
    if ((pageNumber && locationNumbers.has(pageNumber)) || labelMatches) {
      chosen.push(page);
      chosenLabels.add(page.label);
      if (chosen.length >= limit) return chosen;
    }
  }

  if (locationNumbers.size > 0 || locationText.length > 0) return chosen;

  const topicTokens = topicImageTokens(topic);
  const scored = pages
    .filter((page) => !chosenLabels.has(page.label))
    .map((page) => {
      const pageTokens = tokens(`${page.label}\n${page.text}`);
      return {
        page,
        score: overlapScore(topicTokens, pageTokens),
        matched: hasStrongPageTokenMatch(topicTokens, pageTokens),
      };
    })
    .filter((item) => item.matched)
    .sort((a, b) => b.score - a.score);

  for (const { page } of scored) {
    chosen.push(page);
    if (chosen.length >= limit) break;
  }

  return chosen;
}

function formatPageGroundedDetails(
  topic: ExtractedTopic,
  pages: DocumentPage[],
): string {
  const supportPages = supportingPagesForTopic(topic, pages, 4);
  if (supportPages.length === 0) return "";

  return supportPages
    .map((page) => {
      const text = truncate(cleanGeneratedText(page.text), 1200);
      return `#### ${page.label}\n\n${text || "No readable supporting text was extracted for this page."}`;
    })
    .join("\n\n");
}

function frontmatter(values: Record<string, string | string[]>): string {
  const lines = Object.entries(values).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: ${yamlArray(value)}`;
    return `${key}: ${yamlQuote(value)}`;
  });
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((word) => word.trim())
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function inferKnowledgeType(data: Frontmatter): string {
  const explicit = frontmatterString(data, "knowledge_type");
  if (explicit) {
    // Canonicalize legacy textbook-* values so every downstream comparison can
    // use the current learning-* names.
    if (LEARNING_PAGE_TYPES.has(explicit)) return LEARNING_PAGE_TYPE;
    if (LEARNING_SECTION_TYPES.has(explicit)) return LEARNING_SECTION_TYPE;
    return explicit;
  }
  const tags = frontmatterArray(data, "tags");
  const source = frontmatterString(data, "source");
  const generatedBy = frontmatterString(data, "generated_by");
  if (
    tags.includes("generated") ||
    source === "generated-chat" ||
    generatedBy === "chatmock"
  ) {
    return "generated-note";
  }
  if (frontmatterString(data, "source_document")) return "knowledge-topic";
  if (source && !tags.includes("generated")) return "source-document";
  return "note";
}

function readExistingTopicNotes(clusterDir: string): ExistingTopicNote[] {
  return walkClusterMarkdown(clusterDir)
    .map(({ entry, filePath, relPath }) => {
      const content = fs.readFileSync(filePath, "utf-8");
      const { data, body } = parseMarkdownFile(content);
      const type = isInternalConceptMetadata(data, relPath)
        ? INTERNAL_CONCEPT_TYPE
        : inferKnowledgeType(data);
      if (
        type !== "knowledge-topic" &&
        !LEARNING_PAGE_TYPES.has(type) &&
        type !== INTERNAL_CONCEPT_TYPE &&
        type !== "generated-note" &&
        type !== "user-note" &&
        type !== "note"
      ) {
        return undefined;
      }

      const slug = entry.replace(/\.md$/, "");
      return {
        slug,
        relPath,
        title: frontmatterString(data, "title") || slug,
        type,
        breadboardType: frontmatterString(data, "breadboardType"),
        tags: normalizeTopicTags(frontmatterArray(data, "tags"), body, 8, body),
        body,
        content,
        filePath,
      };
    })
    .filter((note): note is ExistingTopicNote => Boolean(note));
}

function candidateScore(
  topic: ExtractedTopic,
  candidate: ExistingTopicNote,
): number {
  const topicTitleTokens = tokens(topic.title);
  const candidateTitleTokens = tokens(candidate.title);
  const topicTagTokens = tokens(topic.tags.join(" "));
  const candidateTagTokens = tokens(candidate.tags.join(" "));
  const topicBodyTokens = tokens(
    [
      topic.title,
      topic.explanation,
      topic.keyPoints.join(" "),
      topic.sourceEvidence.join(" "),
    ].join(" "),
  );
  const candidateBodyTokens = tokens(candidate.body.slice(0, 4000));
  const exactTitle =
    slugify(topic.title) === slugify(candidate.title) ? 0.35 : 0;

  return (
    exactTitle +
    overlapScore(topicTitleTokens, candidateTitleTokens) * 0.45 +
    overlapScore(topicTagTokens, candidateTagTokens) * 0.15 +
    overlapScore(topicBodyTokens, candidateBodyTokens) * 0.25
  );
}

function fallbackTopicPlan(
  topic: ExtractedTopic,
  candidates: { note: ExistingTopicNote; score: number }[],
  usedSlugs: Set<string>,
): TopicWritePlan {
  const best = candidates[0];
  if (best && best.score >= 0.48) {
    return {
      topic,
      finalSlug: best.note.slug,
      action: "merged",
      target: best.note,
      reason: `similarity ${best.score.toFixed(2)}`,
    };
  }

  return {
    topic,
    finalSlug: uniqueSlug(topic.slug || slugify(topic.title), usedSlugs),
    action: "created",
  };
}

async function decideTopicWritePlans({
  client,
  model,
  topics,
  existingNotes,
  usedSlugs,
}: {
  client?: OpenAI;
  model?: string;
  topics: ExtractedTopic[];
  existingNotes: ExistingTopicNote[];
  usedSlugs: Set<string>;
}): Promise<TopicWritePlan[]> {
  const candidateMap = new Map<
    string,
    { note: ExistingTopicNote; score: number }[]
  >();

  for (const topic of topics) {
    const candidates = existingNotes
      .filter((note) => LEARNING_PAGE_TYPES.has(note.type))
      .map((note) => ({ note, score: candidateScore(topic, note) }))
      .filter((candidate) => candidate.score >= 0.16)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    candidateMap.set(topic.title, candidates);
  }

  if (
    !client ||
    existingNotes.length === 0 ||
    topics.every((topic) => candidateMap.get(topic.title)?.length === 0)
  ) {
    return topics.map((topic) =>
      fallbackTopicPlan(topic, candidateMap.get(topic.title) ?? [], usedSlugs),
    );
  }

  try {
    const response = await client.chat.completions.create(
      withCouncil(
        {
          model: model?.trim() || DEFAULT_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You decide whether newly extracted concepts should update an existing textbook page or become a new textbook page. " +
                "Merge only when the new concept is the same idea, a direct continuation, or a more specific treatment of the existing page. " +
                "Create a new page when the concept is merely related, adjacent, or only shares broad keywords. Return only valid JSON.",
            },
            {
              role: "user",
              content: JSON.stringify({
                schema: [
                  {
                    topicTitle: "new concept title",
                    action: "merge or create",
                    targetSlug:
                      "existing slug when action is merge, otherwise null",
                    reason: "short reason",
                  },
                ],
                topics: topics.map((topic) => ({
                  title: topic.title,
                  explanation: topic.explanation,
                  keyPoints: topic.keyPoints.slice(0, 5),
                  sourceEvidence: topic.sourceEvidence.slice(0, 5),
                  tags: topic.tags,
                  candidates: (candidateMap.get(topic.title) ?? []).map(
                    ({ note, score }) => ({
                      slug: note.slug,
                      title: note.title,
                      tags: note.tags,
                      score,
                      excerpt: compactText(note.body).slice(0, 700),
                    }),
                  ),
                })),
              }),
            },
          ],
        },
        { taskType: "classification" },
      ),
    );

    const parsed = parseJsonObject(
      response.choices[0]?.message?.content ?? "[]",
    );
    const decisions = Array.isArray(parsed) ? parsed : [];
    const plans: TopicWritePlan[] = [];

    for (const topic of topics) {
      const candidates = candidateMap.get(topic.title) ?? [];
      const decision = decisions.find(
        (item) =>
          item &&
          typeof item === "object" &&
          slugify(asString((item as Record<string, unknown>).topicTitle)) ===
            slugify(topic.title),
      ) as Record<string, unknown> | undefined;
      const action = asString(decision?.action).toLowerCase();
      const targetSlug = asString(decision?.targetSlug);
      const target = candidates.find(
        (candidate) => candidate.note.slug === targetSlug,
      );

      if (action === "merge" && target && target.score >= 0.16) {
        plans.push({
          topic,
          finalSlug: target.note.slug,
          action: "merged",
          target: target.note,
          reason: asString(
            decision?.reason,
            `similarity ${target.score.toFixed(2)}`,
          ),
        });
      } else {
        plans.push(fallbackTopicPlan(topic, candidates, usedSlugs));
      }
    }

    return plans;
  } catch {
    return topics.map((topic) =>
      fallbackTopicPlan(topic, candidateMap.get(topic.title) ?? [], usedSlugs),
    );
  }
}

async function harmonizeTopicNote({
  client,
  model,
  target,
  topic,
  sourceSlug,
  sourceTitle,
  sourceLabel,
  imagePages,
  outputPlainText,
  transaction,
}: {
  client?: OpenAI;
  model?: string;
  target: ExistingTopicNote;
  topic: ExtractedTopic;
  sourceSlug: string;
  sourceTitle: string;
  sourceLabel: string;
  imagePages: DocumentPage[];
  outputPlainText: string;
  transaction?: KnowledgeWriteTransaction;
}): Promise<void> {
  const sourceLink = wikilink(sourceSlug, sourceTitle);
  if (target.content.includes(sourceLink)) return;

  const locations =
    topic.locations.length > 0 ? topic.locations : ["Uploaded document"];
  const snapshots = formatSourceSnapshots(imagePages);

  const newContentParts = [
    `Source: ${sourceLink}`,
    `Locations: ${locations.join(", ")}`,
    topic.explanation,
    topic.keyPoints.length > 0
      ? `Key points:\n${formatBullets(topic.keyPoints)}`
      : "",
    topic.sourceEvidence.length > 0
      ? `Source evidence:\n${formatBullets(topic.sourceEvidence)}`
      : "",
    snapshots ? `Source snapshots:\n\n${snapshots}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  let mergedBody = "";
  if (client) {
    try {
      const response = await client.chat.completions.create(
        withCouncil(
          {
            model: model?.trim() || DEFAULT_MODEL,
            messages: [
              {
                role: "system",
                content:
                  "Merge two textbook pages on the same concept into one coherent page. " +
                  "Integrate the new content naturally into the existing structure, expanding or refining sections with new details. " +
                  "Eliminate redundancy while preserving unique facts from both. " +
                  "Keep a clean heading hierarchy with no duplicate headings. " +
                  "Return ONLY the merged markdown body — no frontmatter, no code fences.",
              },
              {
                role: "user",
                content: `### Existing note\n\n${target.body}\n\n### New content to integrate\n\n${newContentParts}`,
              },
            ],
          },
          { taskType: "small_revision" },
        ),
      );
      mergedBody = response.choices[0]?.message?.content?.trim() ?? "";
    } catch {
      mergedBody = "";
    }
  }

  if (!mergedBody) {
    const section =
      `\n\n## Added from ${sourceLink}\n\n` +
      `Source label: ${sourceLabel}\n\n` +
      `Locations: ${locations.join(", ")}\n\n` +
      `${topic.explanation}\n\n` +
      (snapshots ? `### Source snapshots\n\n${snapshots}\n\n` : "") +
      `### New key points\n\n${formatBullets(topic.keyPoints)}\n`;
    writeKnowledgeTextFile(
      target.filePath,
      `${target.content.trimEnd()}${section}`,
      transaction,
    );
    return;
  }

  const { data } = parseMarkdownFile(target.content);
  // Ingestion may enrich learner prose, but public concepts remain owned by
  // the Learning Unit Contract and canonical semantic service.
  const updatedFrontmatter = frontmatter({
    ...data,
    date: new Date().toISOString(),
  });
  writeKnowledgeTextFile(
    target.filePath,
    `${updatedFrontmatter}${mergedBody}\n`,
    transaction,
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Upload canceled");
    error.name = "AbortError";
    throw error;
  }
}

interface TextbookArtifact {
  topic: ExtractedTopic;
  slug: string;
  title: string;
  relPath: string;
  conceptSlug: string;
  conceptRelPath: string;
  locations: string[];
  action: "created" | "merged";
}

function writeTextbookSectionIndex({
  sectionDir,
  sectionNumber,
  sectionTitle,
  sourceSlug,
  sourceTitle,
  date,
  transaction,
}: {
  sectionDir: string;
  sectionNumber: number;
  sectionTitle: string;
  sourceSlug: string;
  sourceTitle: string;
  date: string;
  transaction?: KnowledgeWriteTransaction;
}): string {
  const content =
    frontmatter({
      title: `${sectionNumber}. ${sectionTitle}`,
      date,
      knowledge_type: LEARNING_SECTION_TYPE,
      breadboardType: "learning_section",
      internal: "true",
      source_document: sourceSlug,
    }) +
    `# ${sectionNumber}. ${sectionTitle}\n\n` +
    `This section collects the lessons on ${sourceTitle}.\n`;

  const filePath = path.join(sectionDir, "_index.md");
  writeKnowledgeTextFile(filePath, content, transaction);
  return filePath;
}

function textbookPageBody({
  sectionNumber,
  subsectionNumber,
  topic,
  sourceSlug,
  sourceTitle,
  locations,
  snapshotMarkdown,
  pageGroundedDetails,
  relatedLinks,
  relationLines,
}: {
  sectionNumber: number;
  subsectionNumber: number;
  topic: ExtractedTopic;
  sourceSlug: string;
  sourceTitle: string;
  locations: string[];
  snapshotMarkdown: string;
  pageGroundedDetails: string;
  relatedLinks: string[];
  relationLines: string[];
}): string {
  const pageTitle = `${sectionNumber}.${subsectionNumber} ${topic.title}`;
  const sourceEvidence =
    topic.sourceEvidence.length > 0
      ? `## Source Anchors\n\n${formatBullets(topic.sourceEvidence)}\n\n`
      : "";

  return (
    `# ${pageTitle}\n\n` +
    `Source: ${wikilink(sourceSlug, sourceTitle)}\n\n` +
    `Locations: ${locations.join(", ")}\n\n` +
    `${topic.explanation}\n\n` +
    (snapshotMarkdown
      ? `## Source Figures and Snapshots\n\n${snapshotMarkdown}\n\n`
      : "") +
    (pageGroundedDetails
      ? `## Page-Grounded Details\n\n${pageGroundedDetails}\n\n`
      : "") +
    `## Core Ideas\n\n${formatBullets(topic.keyPoints)}\n\n` +
    sourceEvidence +
    `## Related Pages\n\n${relatedLinks.length > 0 ? relatedLinks.join("\n") : "- No directly related pages yet."}\n\n` +
    (relationLines.length > 0
      ? `## Concept Dependencies\n\n${relationLines.join("\n")}\n`
      : "")
  );
}

function writeInternalConceptNode({
  conceptDir,
  conceptSlug,
  topic,
  date,
  sourceSlug,
  sourceTitle,
  sourceLabel,
  sourceFileName,
  locations,
  textbookSlug,
  textbookTitle,
  relatedSlugs,
  transaction,
}: {
  conceptDir: string;
  conceptSlug: string;
  topic: ExtractedTopic;
  date: string;
  sourceSlug: string;
  sourceTitle: string;
  sourceLabel: string;
  sourceFileName: string;
  locations: string[];
  textbookSlug: string;
  textbookTitle: string;
  relatedSlugs: string[];
  transaction?: KnowledgeWriteTransaction;
}): string {
  // Internal planning node: hidden from the published garden, so it carries no
  // public tags.
  const conceptContent =
    frontmatter({
      title: topic.title,
      date,
      source: sourceLabel,
      knowledge_type: INTERNAL_CONCEPT_TYPE,
      breadboardType: "internal_concept",
      draft: "true",
      source_document: sourceSlug,
      source_file: sourceFileName,
      learning_page: textbookSlug,
      locations,
      related: relatedSlugs,
    }) +
    `## ConceptNode: ${topic.title}\n\n` +
    `Planning node for ${wikilink(textbookSlug, textbookTitle)}.\n\n` +
    `Source: ${wikilink(sourceSlug, sourceTitle)}\n\n` +
    `Locations: ${locations.join(", ")}\n\n` +
    `${topic.explanation}\n\n` +
    `### Key planning details\n\n${formatBullets(topic.keyPoints)}\n\n` +
    `### Source coverage\n\n${formatBullets(topic.sourceEvidence)}\n`;

  writeKnowledgeTextFile(
    path.join(conceptDir, `${conceptSlug}.md`),
    conceptContent,
    transaction,
  );
  return `${CONCEPT_NODE_FOLDER}/${conceptSlug}.md`;
}

function writeLearningReferencePages({
  clusterDir,
  metaTitle,
  sectionNumber,
  sectionTitle,
  sourceSlug,
  sourceTitle,
  sourceFileName,
  sourceType,
  sourceLabel,
  extraction,
  artifacts,
  date,
  transaction,
}: {
  clusterDir: string;
  metaTitle: string;
  sectionNumber: number;
  sectionTitle: string;
  sourceSlug: string;
  sourceTitle: string;
  sourceFileName: string;
  sourceType: string;
  sourceLabel: string;
  extraction: KnowledgeExtraction;
  artifacts: TextbookArtifact[];
  date: string;
  transaction?: KnowledgeWriteTransaction;
}): void {
  const learningDir = ensureDirectory(clusterDir, LEARNING_FOLDER, transaction);
  // Internal planning artifacts (Source Map, Scope Contract) live under
  // .breadboard/planning/, never under the learner-facing learning/ folder.
  const planningDir = ensureDirectory(
    clusterDir,
    ".breadboard/planning",
    transaction,
  );
  const pageLinks = artifacts.map(
    (artifact) =>
      `- ${wikilinkForRelPath(artifact.relPath, artifact.title)} - ${artifact.locations.join(", ")}`,
  );
  const sourceEvidenceLines = artifacts.flatMap((artifact) =>
    artifact.topic.sourceEvidence.map(
      (evidence) => `- ${artifact.title}: ${cleanGeneratedText(evidence)}`,
    ),
  );
  const conceptLines = artifacts.map(
    (artifact) =>
      `- ${artifact.topic.title} -> ${wikilinkForRelPath(artifact.relPath, artifact.title)}`,
  );
  const currentSectionLine =
    artifacts.length > 0
      ? `- ${sectionNumber}. ${sectionTitle}`
      : `- No lesson sections were generated during ingest. Open ${wikilink(sourceSlug, sourceTitle)} under Sources, then use Learn to build the ordered lessons.`;

  // Learner-facing planning pages live under learning/.
  const learningPages: Array<{
    fileName: string;
    title: string;
    type: string;
    body: string;
  }> = [
    {
      fileName: "Topic Overview.md",
      title: "Topic Overview",
      type: "topic-overview",
      body:
        `# Topic Overview\n\n` +
        `${metaTitle} is organized as a sequence of lessons you can read in order. The newest material in the learning path comes from ${sourceTitle}.\n\n` +
        `## Current Section\n\n` +
        `${currentSectionLine}\n\n` +
        `## What This Covers\n\n${extraction.summary}\n`,
    },
    {
      fileName: "Learning Map.md",
      title: "Learning Map",
      type: "learning-map",
      body:
        `# Learning Map\n\n` +
        `## Ordered Reading Path\n\n` +
        `${pageLinks.length > 0 ? pageLinks.join("\n") : "- No lesson pages have been generated yet."}\n\n` +
        `## Internal Concept Graph\n\n` +
        `${conceptLines.length > 0 ? conceptLines.join("\n") : "- No ConceptNodes were extracted for this source."}\n\n` +
        `## Confirmation Status\n\n` +
        `Run Learn to build the confirmed multi-section learning spine. Until then Breadboard keeps the automatic order above and keeps ConceptNodes internal.\n`,
    },
  ];

  // Internal planning artifacts live under .breadboard/planning/, never under
  // learning/ (they must not appear in the published garden).
  const planningPages: Array<{
    fileName: string;
    title: string;
    type: string;
    body: string;
  }> = [
    {
      fileName: "Source Map.md",
      title: "Source Map",
      type: "source-map",
      body:
        `# Source Map\n\n` +
        `## Source\n\n` +
        `- Title: ${wikilink(sourceSlug, sourceTitle)}\n` +
        `- File: ${sourceFileName}\n` +
        `- Type: ${sourceType || "text"}\n` +
        `- Label: ${sourceLabel}\n\n` +
        `## Coverage Anchors\n\n` +
        `${sourceEvidenceLines.length > 0 ? sourceEvidenceLines.join("\n") : "- No source anchors were extracted."}\n`,
    },
    {
      fileName: "Scope Contract.md",
      title: "Scope Contract",
      type: "scope-contract",
      body:
        `# Scope Contract\n\n` +
        `## Include\n\n` +
        `${artifacts.length > 0 ? artifacts.map((artifact) => `- ${artifact.topic.title}`).join("\n") : "- Source summary and source document."}\n\n` +
        `## Exclude\n\n` +
        `- Claims not grounded in the uploaded source material.\n` +
        `- Disconnected generated topic pages as the primary reading path.\n\n` +
        `## Background\n\n` +
        `- Internal ConceptNodes remain available for graph relationships, source coverage, tags, regeneration, and assistant context.\n\n` +
        `## Deferred\n\n` +
        `- User confirmation of section order before long-form lesson expansion.\n`,
    },
  ];

  for (const page of learningPages) {
    // Internal planning pages carry no public tags — tags are reserved for
    // learner-facing lesson pages.
    const content =
      frontmatter({
        title: page.title,
        date,
        knowledge_type: page.type,
        breadboardType: page.type.replace(/-/g, "_"),
        source_document: sourceSlug,
      }) + page.body;
    writeKnowledgeTextFile(
      path.join(learningDir, page.fileName),
      content,
      transaction,
    );
  }
  for (const page of planningPages) {
    const content =
      frontmatter({
        title: page.title,
        date,
        knowledge_type: page.type,
        breadboardType: page.type.replace(/-/g, "_"),
        internal: "true",
        source_document: sourceSlug,
      }) + page.body;
    writeKnowledgeTextFile(
      path.join(planningDir, page.fileName),
      content,
      transaction,
    );
  }
}

export async function writeDocumentKnowledge({
  client,
  model,
  contentPath,
  clusterSlug,
  sourceTitle,
  sourceFileName,
  sourceType,
  sourceLabel,
  sourcePdfPath,
  sourceMedia,
  isHandwriting,
  markdownText,
  plainText,
  pages = [],
  extraction,
  sourceMetadata,
  sourceAssets = [],
  abortSignal,
  createdFilePaths = [],
  knowledgeWriteTransaction,
  publicationUserId,
  onProgress,
}: {
  client?: OpenAI;
  model?: string;
  contentPath: string;
  clusterSlug: string;
  sourceTitle: string;
  sourceFileName: string;
  sourceType: string;
  sourceLabel: string;
  sourcePdfPath?: string;
  sourceMedia?: { filePath: string; sha256: string };
  isHandwriting?: boolean;
  markdownText: string;
  plainText: string;
  pages?: DocumentPage[];
  extraction: KnowledgeExtraction;
  sourceMetadata?: Record<string, string | string[]>;
  sourceAssets?: KnowledgeSourceAsset[];
  abortSignal?: AbortSignal;
  createdFilePaths?: string[];
  knowledgeWriteTransaction?: KnowledgeWriteTransaction;
  publicationUserId?: number;
  onProgress?: (step: string) => void;
}): Promise<SavedKnowledge> {
  const transaction =
    knowledgeWriteTransaction ??
    createKnowledgeWriteTransaction(contentPath, clusterSlug);
  const ownsTransaction = knowledgeWriteTransaction === undefined;
  const execute = async (): Promise<SavedKnowledge> => {
    throwIfAborted(abortSignal);
    const clusterDir = path.join(contentPath, clusterSlug.trim());
    ensureKnowledgeDirectory(clusterDir, transaction);
    const sourcesDir = path.join(clusterDir, SOURCE_NOTE_FOLDER);
    const sectionNumber = sourceSectionNumber(clusterDir);
    const cleanPages = cleanDocumentPages(pages);
    const outputMarkdownText = cleanGeneratedText(markdownText);
    const outputPlainText = cleanGeneratedText(plainText);
    // Keep the generated/humanized name for learning structure and descriptions,
    // but never replace an uploaded file's visible identity with it. Library
    // rows show the exact filename while the descriptive name remains available
    // as secondary metadata and planning context.
    const sectionTitle = humanizeSourceTitle(
      extraction.documentTitle || sourceTitle,
      sourceFileName,
      outputPlainText || outputMarkdownText,
    );
    extraction.documentTitle = sectionTitle;
    const isUploadedMedia = Boolean(sourceMetadata?.original_filename);
    const visibleSourceTitle =
      sourceType.toLowerCase() === "pdf" || isUploadedMedia
        ? sourceFileName.trim() || sourceTitle
        : sectionTitle || sourceTitle;
    ensureKnowledgeDirectory(sourcesDir, transaction);

    const seenSourceAssetPaths = new Set<string>();
    for (const asset of sourceAssets) {
      const normalizedRelativePath = asset.relativePath.replace(/\\/g, "/").trim();
      if (
        !normalizedRelativePath ||
        normalizedRelativePath.startsWith("/") ||
        normalizedRelativePath.split("/").some((segment) => segment === "..")
      ) {
        throw new Error("Source asset path must stay inside the garden.");
      }
      const assetFilePath = path.resolve(clusterDir, ...normalizedRelativePath.split("/"));
      const resolvedClusterDir = path.resolve(clusterDir);
      if (!assetFilePath.startsWith(`${resolvedClusterDir}${path.sep}`)) {
        throw new Error("Source asset path must stay inside the garden.");
      }
      if (seenSourceAssetPaths.has(assetFilePath)) continue;
      seenSourceAssetPaths.add(assetFilePath);
      ensureKnowledgeDirectory(path.dirname(assetFilePath), transaction);
      writeKnowledgeBinaryFile(assetFilePath, asset.bytes, transaction);
      createdFilePaths.push(assetFilePath);
    }

    const usedSlugs = extractExistingSlugs(clusterDir);
    const sourceSlug = uniqueSlug(slugify(sourceTitle), usedSlugs);
    let sourceMediaUrl = "";
    if (sourceMedia) {
      const extension = path.extname(sourceFileName).toLowerCase();
      const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension)
        ? extension
        : ".bin";
      const mediaAssetName = `${sourceSlug}-media-${sourceMedia.sha256.slice(0, 12)}${safeExtension}`;
      const mediaAssetDir = ensureKnowledgeDirectory(
        path.join(clusterDir, "assets"),
        transaction,
      );
      const mediaAssetPath = path.join(mediaAssetDir, mediaAssetName);
      copyKnowledgeFile(
        sourceMedia.filePath,
        mediaAssetPath,
        sourceMedia.sha256,
        transaction,
      );
      createdFilePaths.push(mediaAssetPath);
      sourceMediaUrl = `/${clusterSlug.trim()}/assets/${mediaAssetName}`;
    }
    const date = new Date().toISOString();
    const existingNotes = readExistingTopicNotes(clusterDir);
    onProgress?.(
      extraction.topics.length > 0
        ? `Planning how to organize ${extraction.topics.length} concept${extraction.topics.length === 1 ? "" : "s"} into textbook pages...`
        : "Planning the textbook structure...",
    );
    const topicPlans = await decideTopicWritePlans({
      client,
      model,
      topics: extraction.topics,
      existingNotes,
      usedSlugs,
    });
    const topicSlugByTitle = new Map(
      topicPlans.map((plan) => [
        plan.topic.title.toLowerCase(),
        plan.finalSlug,
      ]),
    );

    const relationshipLookup = new Map<string, TopicRelationship[]>();
    for (const relationship of extraction.relationships) {
      const sourceKey = relationship.source.toLowerCase();
      const targetKey = relationship.target.toLowerCase();
      if (!topicSlugByTitle.has(sourceKey) || !topicSlugByTitle.has(targetKey))
        continue;
      const existing = relationshipLookup.get(sourceKey) ?? [];
      existing.push(relationship);
      relationshipLookup.set(sourceKey, existing);
    }

    const sourceLinks = topicPlans.map((plan) => {
      const locations =
        plan.topic.locations.length > 0
          ? ` (${plan.topic.locations.join(", ")})`
          : "";
      return `- ${wikilink(plan.finalSlug, plan.topic.title)}${locations}`;
    });
    const sourceImages = uniqueNonEmpty(
      cleanPages.map((page) => page.imagePath ?? "").filter(Boolean),
    );

    const sourceFrontmatter: Record<string, string | string[]> = {
      title: visibleSourceTitle,
      description: sectionTitle,
      date,
      source: sourceLabel,
      knowledge_type: "source-document",
      breadboardType: "source_document",
      source_type: sourceType,
      source_file: sourceFileName,
      generated_by: "chatmock",
      // Raw source notes ground the lessons and publish under a visible Sources
      // folder so learners can open the originals. Planning artifacts (source
      // map, scope contract, source coverage) remain internal.
      learning_pages: topicPlans.map((plan) => plan.finalSlug),
      topics: topicPlans.map((plan) => plan.finalSlug),
    };
    if (sourceMetadata) {
      for (const [key, value] of Object.entries(sourceMetadata)) {
        if (!key || key in sourceFrontmatter) continue;
        if (Array.isArray(value)) {
          sourceFrontmatter[key] = value.filter(
            (item) => typeof item === "string" && item.trim(),
          );
        } else if (typeof value === "string" && value.trim()) {
          sourceFrontmatter[key] = value;
        }
      }
    }
    if (sourceImages.length > 0) sourceFrontmatter.source_images = sourceImages;
    if (sourcePdfPath) sourceFrontmatter.source_pdf = sourcePdfPath;
    if (sourceMediaUrl) sourceFrontmatter.source_media = sourceMediaUrl;
    if (isHandwriting) {
      sourceFrontmatter.source_mode = "handwritten-or-scanned";
      sourceFrontmatter.extraction_method = "chatmock-vision-ocr";
    }

    const sourceContent =
      frontmatter(sourceFrontmatter) +
      `## Summary\n\n${extraction.summary}\n\n` +
      `## Textbook coverage\n\n${sourceLinks.length > 0 ? sourceLinks.join("\n") : "- No textbook pages were generated for this source."}\n\n` +
      `## Internal planning\n\nExtracted concepts are retained as internal ConceptNodes for the Learning Spine, graph relationships, source coverage, and assistant context.\n\n` +
      `## Source material\n\n${outputMarkdownText.trim() || outputPlainText.trim()}\n`;

    throwIfAborted(abortSignal);
    const sourceRelPath = `${SOURCE_NOTE_FOLDER}/${sourceSlug}.md`;
    const sourceFilePath = path.join(clusterDir, sourceRelPath);
    writeKnowledgeTextFile(
      sourceFilePath,
      normalizeQuartzMarkdown(sourceContent),
      transaction,
    );
    createdFilePaths.push(sourceFilePath);

    const textbookArtifacts: TextbookArtifact[] = [];
    if (topicPlans.length > 0) {
      const sectionFolder = `${sectionNumber}. ${cleanFileSegment(sectionTitle)}`;
      const sectionDir = ensureDirectory(
        clusterDir,
        sectionFolder,
        transaction,
      );
      const conceptDir = ensureDirectory(
        clusterDir,
        CONCEPT_NODE_FOLDER,
        transaction,
      );
      createdFilePaths.push(
        writeTextbookSectionIndex({
          sectionDir,
          sectionNumber,
          sectionTitle,
          sourceSlug,
          sourceTitle: extraction.documentTitle || sourceTitle,
          date,
          transaction,
        }),
      );

      let writtenCount = 0;
      for (const plan of topicPlans) {
        throwIfAborted(abortSignal);
        writtenCount += 1;
        onProgress?.(
          `${plan.action === "merged" ? "Merging" : "Writing"} textbook page "${plan.topic.title}" (${writtenCount}/${topicPlans.length})...`,
        );
        const topic = plan.topic;
        const subsectionNumber = writtenCount;
        const relatedTitles = [
          ...new Set([
            ...topic.relatedTopics,
            ...(relationshipLookup.get(topic.title.toLowerCase()) ?? []).map(
              (rel) => rel.target,
            ),
          ]),
        ];
        const relatedLinks = relatedTitles
          .map((relatedTitle) => {
            const relatedSlug = topicSlugByTitle.get(
              relatedTitle.toLowerCase(),
            );
            return relatedSlug
              ? `- ${wikilink(relatedSlug, relatedTitle)}`
              : undefined;
          })
          .filter((link): link is string => Boolean(link));
        const relationLines = (
          relationshipLookup.get(topic.title.toLowerCase()) ?? []
        )
          .map((rel) => {
            const targetSlug = topicSlugByTitle.get(rel.target.toLowerCase());
            return targetSlug
              ? `- ${rel.relation}: ${wikilink(targetSlug, rel.target)}`
              : undefined;
          })
          .filter((line): line is string => Boolean(line));
        const locations =
          topic.locations.length > 0 ? topic.locations : ["Uploaded document"];
        const imagePages = pageImagesForTopic(topic, cleanPages, 2);
        const snapshotMarkdown = formatSourceSnapshots(imagePages);
        const pageGroundedDetails = formatPageGroundedDetails(
          topic,
          cleanPages,
        );

        const canMergeIntoTextbook =
          plan.action === "merged" && plan.target
            ? LEARNING_PAGE_TYPES.has(plan.target.type)
            : false;
        const textbookSlug =
          canMergeIntoTextbook && plan.target
            ? plan.target.slug
            : plan.finalSlug;
        const textbookTitle = `${sectionNumber}.${subsectionNumber} ${topic.title}`;
        const textbookRelPath =
          canMergeIntoTextbook && plan.target
            ? plan.target.relPath
            : `${sectionFolder}/${textbookSlug}.md`;
        const relatedSlugs = relatedTitles.map(
          (relatedTitle) =>
            topicSlugByTitle.get(relatedTitle.toLowerCase()) ??
            slugify(relatedTitle),
        );

        if (canMergeIntoTextbook && plan.target) {
          await harmonizeTopicNote({
            client,
            model,
            target: plan.target,
            topic,
            sourceSlug,
            sourceTitle: extraction.documentTitle || sourceTitle,
            sourceLabel,
            imagePages,
            outputPlainText,
            transaction,
          });
        } else {
          // Ingest pages are internal scaffolding superseded by the Learn pipeline's
          // lessons; they are hidden from the published garden (no learn_button) and
          // therefore carry a clean title and no public tags.
          const cleanTopicTitle = humanizeSourceTitle(
            topic.title,
            sourceFileName,
            outputPlainText,
          );
          const topicFrontmatter: Record<string, string | string[]> = {
            title: `${sectionNumber}.${subsectionNumber} ${cleanTopicTitle}`,
            date,
            source: sourceLabel,
            knowledge_type: LEARNING_PAGE_TYPE,
            breadboardType: "learning_page",
            source_document: sourceSlug,
            source_file: sourceFileName,
            internal: "true",
            locations,
            related: relatedSlugs,
          };
          const topicImages = imagePages
            .map((page) => page.imagePath ?? "")
            .filter(Boolean);
          if (topicImages.length > 0)
            topicFrontmatter.source_images = topicImages;

          const topicContent =
            frontmatter(topicFrontmatter) +
            textbookPageBody({
              sectionNumber,
              subsectionNumber,
              topic,
              sourceSlug,
              sourceTitle: extraction.documentTitle || sourceTitle,
              locations,
              snapshotMarkdown,
              pageGroundedDetails,
              relatedLinks,
              relationLines,
            });

          const topicFilePath = path.join(sectionDir, `${textbookSlug}.md`);
          writeKnowledgeTextFile(
            topicFilePath,
            normalizeQuartzMarkdown(topicContent),
            transaction,
          );
          createdFilePaths.push(topicFilePath);
        }

        const conceptSlug = uniqueSlug(`concept-${textbookSlug}`, usedSlugs);
        const conceptRelPath = writeInternalConceptNode({
          conceptDir,
          conceptSlug,
          topic,
          date,
          sourceSlug,
          sourceTitle: extraction.documentTitle || sourceTitle,
          sourceLabel,
          sourceFileName,
          locations,
          textbookSlug,
          textbookTitle,
          relatedSlugs,
          transaction,
        });
        createdFilePaths.push(path.join(conceptDir, `${conceptSlug}.md`));
        textbookArtifacts.push({
          topic,
          slug: textbookSlug,
          title: textbookTitle,
          relPath: textbookRelPath,
          conceptSlug,
          conceptRelPath,
          locations,
          action: canMergeIntoTextbook ? "merged" : "created",
        });
      }
    }

    writeLearningReferencePages({
      clusterDir,
      metaTitle: extraction.documentTitle || sourceTitle,
      sectionNumber,
      sectionTitle,
      sourceSlug,
      sourceTitle: extraction.documentTitle || sourceTitle,
      sourceFileName,
      sourceType,
      sourceLabel,
      extraction,
      artifacts: textbookArtifacts,
      date,
      transaction,
    });

    throwIfAborted(abortSignal);
    onProgress?.("Refreshing the Learning Map...");
    refreshClusterIndex(contentPath, clusterSlug, { transaction });

    return {
      sourceSlug,
      sourceRelPath,
      sourceTitle: visibleSourceTitle,
      topics: textbookArtifacts.map((artifact) => ({
        slug: artifact.slug,
        title: artifact.title,
        locations: artifact.locations,
        action: artifact.action,
      })),
      wordCount: outputPlainText.trim().split(/\s+/).filter(Boolean).length,
    };
  };

  try {
    const saved = await execute();
    if (ownsTransaction) {
      transaction.commit();
      onProgress?.("Publishing to your garden…");
      await publishQuartzAfterMutation(`ingest knowledge into ${clusterSlug}`, {
        userId: publicationUserId,
        gardenSlug: clusterSlug,
      });
    }
    return saved;
  } catch (error) {
    try {
      transaction.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Document ingestion failed and its knowledge rollback was incomplete.",
      );
    }
    throw error;
  }
}

function parseYamlArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseYamlValue(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]"))
    return parseYamlArray(trimmed);
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseMarkdownFile(content: string): {
  data: Frontmatter;
  body: string;
} {
  if (!content.startsWith("---")) return { data: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: content };
  const rawFrontmatter = content.slice(3, end).trim();
  const body = content.slice(end + 4).trim();
  const data: Frontmatter = {};

  for (const line of rawFrontmatter.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    data[key] = parseYamlValue(value);
  }

  return { data, body };
}

function frontmatterString(data: Frontmatter, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function frontmatterArray(data: Frontmatter, key: string): string[] {
  const value = data[key];
  return Array.isArray(value)
    ? value
    : typeof value === "string" && value
      ? [value]
      : [];
}

function excerpt(body: string): string {
  return compactText(
    body
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2")
      .replace(/^#+\s+/gm, ""),
  ).slice(0, 220);
}

function wikilinkTargets(body: string): string[] {
  const targets = new Set<string>();
  const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  for (const match of body.matchAll(regex)) {
    const target = (match[1] ?? "").trim();
    if (!target) continue;
    targets.add(slugify(path.basename(target)));
  }
  return [...targets];
}

export function scanClusterKnowledge(
  contentPath: string,
  clusterSlug: string,
  options: { migrateSources?: boolean } = {},
): ClusterKnowledge {
  const clusterDir = path.join(contentPath, clusterSlug.trim());
  let nodes: KnowledgeNode[] = [];

  if (!fs.existsSync(clusterDir)) {
    return {
      nodes: [],
      edges: [],
      tree: [],
      orphanTopics: [],
      stats: {
        documents: 0,
        topics: 0,
        textbookPages: 0,
        conceptNodes: 0,
        learningPages: 0,
        generatedNotes: 0,
        links: 0,
        words: 0,
      },
    };
  }

  if (options.migrateSources !== false) {
    migrateRootSourceDocumentsToSources(clusterDir);
  }
  const markdownEntries = walkClusterMarkdown(clusterDir);
  const semanticArtifacts = readGardenSemanticArtifacts(
    clusterDir,
    clusterSlug,
  );

  const cacheKey = path.resolve(clusterDir);
  const signature = markdownEntries
    .map(
      ({ relPath, stat }) =>
        `${relPath}:${stat.size}:${Math.trunc(stat.mtimeMs)}`,
    )
    .join("|");
  const cached = clusterKnowledgeCache.get(cacheKey);
  if (
    cached?.signature === signature &&
    cached.expiresAt > Date.now()
  ) {
    rememberClusterKnowledge(cacheKey, signature, cached.knowledge);
    return cached.knowledge;
  }
  if (cached) dropClusterKnowledge(cacheKey);

  for (const { entry, filePath, folder, relPath, stat } of markdownEntries) {
    const modifiedAt = stat.mtime.toISOString();
    const content = fs.readFileSync(filePath, "utf-8");
    const { data, body } = parseMarkdownFile(content);
    const slug = entry.replace(/\.md$/, "");
    const title = frontmatterString(data, "title") || slug;
    const description = frontmatterString(data, "description");
    const sourceType = frontmatterString(data, "source_type");
    const sourceFile = frontmatterString(data, "source_file");
    const sourcePdf = frontmatterString(data, "source_pdf");
    const sourceMedia = frontmatterString(data, "source_media");
    const sourceDocument = frontmatterString(data, "source_document");
    const textbookPage =
      frontmatterString(data, "learning_page") ||
      frontmatterString(data, "textbook_page");
    const nodeBreadboardType = frontmatterString(data, "breadboardType");
    const draft = frontmatterString(data, "draft");
    const generatedBy = frontmatterString(data, "generatedBy");
    const generated_by = frontmatterString(data, "generated_by");
    const internal = frontmatterString(data, "internal");
    const flagColor = frontmatterString(data, "flag_color");
    const locations = frontmatterArray(data, "locations");
    const sourceAnchors = frontmatterArray(data, "sourceAnchors");
    const related = frontmatterArray(data, "related");
    const type = isInternalConceptMetadata(data, relPath)
      ? INTERNAL_CONCEPT_TYPE
      : inferKnowledgeType(data);
    const isLearnerPage =
      relPath.replace(/\\/g, "/").startsWith(`${LEARNING_FOLDER}/`) &&
      (LEARNING_PAGE_TYPES.has(type) || nodeBreadboardType === "learning_page");
    const rawPrimaryConcepts = frontmatterArray(data, "primaryConcepts");
    const rawSupportingConcepts = frontmatterArray(data, "supportingConcepts");
    const claimIds = isLearnerPage ? frontmatterArray(data, "claimIds") : [];
    const assignmentTerms = [...rawPrimaryConcepts, ...rawSupportingConcepts];
    const legacyTerms = frontmatterArray(data, "tags");
    const publicTerms =
      assignmentTerms.length > 0 ? assignmentTerms : legacyTerms;
    const resolvedTerms =
      semanticArtifacts.registry.concepts.length > 0
        ? publicTerms
            .map(
              (term) => resolveConcept(term, semanticArtifacts.registry)?.slug,
            )
            .filter((term): term is string => Boolean(term))
        : normalizeTopicTags(publicTerms, "", 5, [title, body].join("\n"));
    const tags = isLearnerPage ? [...new Set(resolvedTerms)].slice(0, 5) : [];
    const primaryConcepts = isLearnerPage
      ? rawPrimaryConcepts
          .map(
            (term) =>
              resolveConcept(term, semanticArtifacts.registry)?.slug ?? term,
          )
          .filter((term) => tags.includes(term))
      : [];
    const supportingConcepts = isLearnerPage
      ? rawSupportingConcepts
          .map(
            (term) =>
              resolveConcept(term, semanticArtifacts.registry)?.slug ?? term,
          )
          .filter(
            (term) => tags.includes(term) && !primaryConcepts.includes(term),
          )
      : [];
    const date = frontmatterString(data, "date") || modifiedAt;
    const wordCount = body.trim().split(/\s+/).filter(Boolean).length;

    nodes.push({
      id: slug,
      slug,
      fileName: entry,
      folder,
      relPath,
      title,
      description,
      type,
      sourceType,
      sourceFile,
      sourcePdf,
      sourceMedia,
      sourceDocument,
      textbookPage,
      breadboardType: nodeBreadboardType,
      draft,
      generatedBy,
      generated_by,
      internal,
      flagColor,
      locations,
      sourceAnchors,
      tags,
      primaryConcepts,
      supportingConcepts,
      claimIds,
      related,
      date,
      wordCount,
      excerpt: excerpt(body),
      content,
    });
  }

  // Older versions created a timestamped source and a complete second concept
  // set when the same local file was uploaded again. Treat the newest ingest as
  // canonical so existing gardens immediately present one document and one
  // coherent concept set; the files remain on disk until that source is deleted.
  nodes = withoutSupersededSourceIngests(nodes);

  const slugs = new Set(nodes.map((node) => node.slug));
  const titleToSlug = new Map(
    nodes.map((node) => [slugify(node.title), node.slug]),
  );
  const edges: KnowledgeEdge[] = [];
  const edgeKeys = new Set<string>();

  function addEdge(source: string, target: string, relation: string) {
    const resolvedTarget = slugs.has(target)
      ? target
      : titleToSlug.get(slugify(target));
    if (!resolvedTarget || source === resolvedTarget) return;
    const key = `${source}->${resolvedTarget}:${relation}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target: resolvedTarget, relation });
  }

  for (const node of nodes) {
    if (node.sourceDocument) addEdge(node.slug, node.sourceDocument, "source");
    for (const target of node.related) addEdge(node.slug, target, "related");
    for (const target of wikilinkTargets(node.content))
      addEdge(node.slug, target, "wikilink");
  }

  const sharedTagPairs = new Set<string>();
  const tagGroups = new Map<string, KnowledgeNode[]>();
  for (const node of nodes) {
    for (const tag of node.tags) {
      const group = tagGroups.get(tag) ?? [];
      group.push(node);
      tagGroups.set(tag, group);
    }
  }

  for (const group of tagGroups.values()) {
    if (group.length < 2 || group.length > 14) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const left = group[i].slug < group[j].slug ? group[i] : group[j];
        const right = left === group[i] ? group[j] : group[i];
        const key = `${left.slug}->${right.slug}`;
        if (sharedTagPairs.has(key)) continue;
        sharedTagPairs.add(key);
        addEdge(left.slug, right.slug, "shared-topic");
      }
    }
  }

  const sourceNodes = nodes.filter((node) => node.type === "source-document");
  const textbookNodes = nodes.filter(isLearnAuthoredLesson);
  const legacyPublicTopics = nodes.filter(
    (node) =>
      node.type === "knowledge-topic" &&
      node.internal !== "true" &&
      node.draft !== "true" &&
      !isLegacySubtopicRelPath(node.relPath),
  );
  const topicNodes = [...textbookNodes, ...legacyPublicTopics].sort(
    (a, b) =>
      readingOrderRank(a.relPath, a.type) -
        readingOrderRank(b.relPath, b.type) || a.title.localeCompare(b.title),
  );
  const conceptNodes = nodes.filter(
    (node) => node.type === INTERNAL_CONCEPT_TYPE,
  );
  const learningNodes = nodes.filter(
    (node) =>
      node.relPath.replace(/\\/g, "/").startsWith(`${LEARNING_FOLDER}/`) &&
      node.internal !== "true" &&
      node.draft !== "true",
  );
  const generatedNotes = nodes.filter((node) => node.type === "generated-note");
  const usedTopicSlugs = new Set<string>();

  const tree = sourceNodes.map((source) => {
    const topics = topicNodes.filter((topic) => {
      const linkedToSource = edges.some(
        (edge) =>
          edge.relation !== "shared-topic" &&
          ((edge.source === topic.slug && edge.target === source.slug) ||
            (edge.source === source.slug && edge.target === topic.slug)),
      );
      if (linkedToSource) usedTopicSlugs.add(topic.slug);
      return linkedToSource;
    });

    return { source, topics };
  });

  const orphanTopics = topicNodes.filter(
    (node) => !usedTopicSlugs.has(node.slug),
  );

  const knowledge = {
    nodes,
    edges,
    tree,
    orphanTopics,
    stats: {
      documents: sourceNodes.length,
      topics: topicNodes.length,
      textbookPages: textbookNodes.length,
      conceptNodes: conceptNodes.length,
      learningPages: learningNodes.length,
      generatedNotes: generatedNotes.length,
      links: edges.length,
      words: nodes.reduce((sum, node) => sum + node.wordCount, 0),
    },
  };

  rememberClusterKnowledge(cacheKey, signature, knowledge);

  return knowledge;
}

function readClusterIndexMeta(
  clusterDir: string,
  clusterSlug: string,
): { title: string; description: string } {
  const indexPath = path.join(clusterDir, "_index.md");
  if (!fs.existsSync(indexPath)) return { title: clusterSlug, description: "" };

  const content = fs.readFileSync(indexPath, "utf-8");
  const { data } = parseMarkdownFile(content);
  return {
    title: frontmatterString(data, "title") || clusterSlug,
    description: frontmatterString(data, "description"),
  };
}

function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function clusterIndexDescription(knowledge: ClusterKnowledge): string {
  return `Learning garden with ${countLabel(
    knowledge.stats.documents,
    "source document",
  )}, ${countLabel(
    knowledge.stats.textbookPages,
    "lesson page",
  )}, and ${countLabel(knowledge.stats.links, "graph link")}.`;
}

function clusterOverviewText(
  knowledge: ClusterKnowledge,
  date: string,
  emptyLearnState = false,
): string {
  const sourceText = countLabel(knowledge.stats.documents, "source document");
  const lessonText = countLabel(knowledge.stats.textbookPages, "lesson page");
  const linkText = countLabel(knowledge.stats.links, "graph link");
  const wordText = countLabel(knowledge.stats.words, "indexed word");

  return [
    `This learning garden is organized from ${sourceText} into a sequence of linked lessons. It currently contains ${lessonText}, ${linkText}, and ${wordText}.`,
    emptyLearnState
      ? `No lessons yet.`
      : `Start with the Topic Overview, then follow the numbered sections in order.`,
    `Last updated: ${date}.`,
  ].join("\n\n");
}

function uniqueMigrationPath(root: string, fileName: string): string {
  const parsed = path.parse(fileName);
  let candidate = path.join(root, fileName);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(root, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function migrateRootSourceDocumentsToSources(
  clusterDir: string,
  transaction?: KnowledgeWriteTransaction,
): void {
  if (!fs.existsSync(clusterDir)) return;

  const entries = walkClusterMarkdown(clusterDir);
  const rootSourceEntries = entries.filter((entry) => {
    if (entry.folder) return false;
    const content = fs.readFileSync(entry.filePath, "utf-8");
    const { data } = parseMarkdownFile(content);
    return inferKnowledgeType(data) === "source-document";
  });

  if (rootSourceEntries.length === 0) return;

  const sourceDir = ensureDirectory(
    clusterDir,
    SOURCE_NOTE_FOLDER,
    transaction,
  );
  const migrationDir = path.join(
    clusterDir,
    ".breadboard",
    "migrated-root-sources",
  );

  for (const entry of rootSourceEntries) {
    const targetPath = path.join(sourceDir, entry.entry);
    if (!fs.existsSync(targetPath)) {
      renameKnowledgeFile(entry.filePath, targetPath, transaction);
      continue;
    }

    ensureKnowledgeDirectory(migrationDir, transaction);
    renameKnowledgeFile(
      entry.filePath,
      uniqueMigrationPath(migrationDir, entry.entry),
      transaction,
    );
  }
}

export function refreshClusterIndex(
  contentPath: string,
  clusterSlug: string,
  options: {
    migrateSources?: boolean;
    transaction?: KnowledgeWriteTransaction;
  } = {},
): void {
  const clusterDir = path.join(contentPath, clusterSlug.trim());
  ensureKnowledgeDirectory(clusterDir, options.transaction);
  if (options.migrateSources !== false) {
    migrateRootSourceDocumentsToSources(clusterDir, options.transaction);
  }
  const meta = readClusterIndexMeta(clusterDir, clusterSlug);
  // Migration has already run above when enabled. Passing false here also
  // guarantees a Clear operation can refresh navigation without moving legacy
  // root source documents.
  const knowledge = scanClusterKnowledge(contentPath, clusterSlug, {
    migrateSources: false,
  });
  const date = new Date().toISOString().split("T")[0];

  const byNewest = (a: KnowledgeNode, b: KnowledgeNode) => {
    const dateDiff = Date.parse(b.date) - Date.parse(a.date);
    return dateDiff || a.title.localeCompare(b.title);
  };

  const allTopics = [
    ...knowledge.tree.flatMap(({ topics }) => topics),
    ...knowledge.orphanTopics,
  ];
  const learnerPages = allTopics
    .filter((topic) => {
      const rel = topic.relPath.replace(/\\/g, "/");
      return (
        rel.toLowerCase().startsWith(`${LEARNING_FOLDER}/`) &&
        LEARNING_PAGE_TYPES.has(topic.type)
      );
    })
    .sort(
      (a, b) =>
        readingOrderRank(a.relPath, a.type) -
          readingOrderRank(b.relPath, b.type) ||
        a.relPath.localeCompare(b.relPath),
    );
  const readingPathLines = learnerPages.map(
    (topic, index) =>
      `${index + 1}. ${wikilinkForRelPath(topic.relPath, topic.title)}`,
  );
  const overviewLink = LEARNING_PAGE_ORDER[0];
  const hasTopicOverview = knowledge.nodes.some(
    (node) =>
      node.relPath.replace(/\\/g, "/").toLowerCase() ===
      overviewLink.toLowerCase(),
  );
  const emptyLearnState = learnerPages.length === 0 && !hasTopicOverview;

  const learnerRelPaths = new Set(learnerPages.map((topic) => topic.relPath));
  // Every learner-visible page that is not a lesson (already in the Reading
  // Path), a source, or internal — including user-authored notes in
  // user-created folders. Without this, a folder the user creates inside a
  // garden (and every note in it) is invisible in the garden index, even though
  // it is published. Group by top-level folder so user-created folders surface
  // with their pages.
  const standalonePages = knowledge.nodes.filter((node) => {
    const rel = node.relPath.replace(/\\/g, "/").toLowerCase();
    return (
      node.type !== "source-document" &&
      node.type !== INTERNAL_CONCEPT_TYPE &&
      node.internal !== "true" &&
      node.draft !== "true" &&
      !rel.startsWith(`${LEARNING_FOLDER.toLowerCase()}/`) &&
      !rel.startsWith("sources/") &&
      !isLegacySubtopicRelPath(node.relPath) &&
      !learnerRelPaths.has(node.relPath)
    );
  });
  const pagesByTopFolder = new Map<string, typeof standalonePages>();
  for (const node of standalonePages) {
    const top = (node.folder ?? "").split("/")[0] ?? "";
    const list = pagesByTopFolder.get(top) ?? [];
    list.push(node);
    pagesByTopFolder.set(top, list);
  }
  const folderHeading = (folder: string): string =>
    folder
      .split("/")
      .pop()!
      .split("-")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  const orphanLines: string[] = [];
  // Root-level standalone pages first (no heading), then each folder as a
  // sub-section. Folders are alphabetical for stable, navigable output.
  const topFolders = [...pagesByTopFolder.keys()].sort((a, b) =>
    a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
  );
  for (const folder of topFolders) {
    const pages = [...pagesByTopFolder.get(folder)!].sort(byNewest);
    if (folder) orphanLines.push(`### ${folderHeading(folder)}`, "");
    for (const page of pages) {
      orphanLines.push(`- ${wikilinkForRelPath(page.relPath, page.title)}`);
    }
    orphanLines.push("");
  }
  while (orphanLines.length > 0 && orphanLines[orphanLines.length - 1] === "")
    orphanLines.pop();
  const description = clusterIndexDescription(knowledge);
  const sourcesDir = path.join(clusterDir, "sources");
  if (fs.existsSync(sourcesDir)) {
    const sourceLinks = fs
      .readdirSync(sourcesDir)
      .filter((name) => name.endsWith(".md") && name !== "_index.md")
      .sort()
      .map((name) => {
        const relPath = `sources/${name}`;
        const sourcePath = path.join(sourcesDir, name);
        const parsed = parseMarkdownFile(fs.readFileSync(sourcePath, "utf-8"));
        const title =
          typeof parsed.data.title === "string"
            ? parsed.data.title
            : Array.isArray(parsed.data.title) &&
                typeof parsed.data.title[0] === "string"
              ? parsed.data.title[0]
              : name.replace(/\.md$/i, "");
        return `- ${wikilinkForRelPath(relPath, title)}`;
      });
    writeKnowledgeTextFile(
      path.join(sourcesDir, "_index.md"),
      normalizeQuartzMarkdown(
        frontmatter({
          title: "Sources",
          date,
          knowledge_type: "source-index",
          breadboardType: "source_index",
          internal: "true",
        }) +
          `# Sources\n\n${sourceLinks.length > 0 ? sourceLinks.join("\n") : "- No source notes yet."}\n`,
      ),
      options.transaction,
    );
  }
  const content =
    frontmatter({
      title: meta.title,
      date,
      description,
      knowledge_type: "cluster-index",
    }) +
    `## Garden overview\n\n` +
    `${clusterOverviewText(knowledge, date, emptyLearnState)}\n\n` +
    `## Learning\n\n` +
    `${emptyLearnState ? "- No lessons yet." : `- ${wikilinkForRelPath(overviewLink, "Topic Overview")}`}\n\n` +
    `## Sources\n\n` +
    `- [[sources/_index|Sources]]\n\n` +
    `## Reading Path\n\n${readingPathLines.length > 0 ? readingPathLines.join("\n") : "- No lessons yet."}\n\n` +
    `## More Pages\n\n${orphanLines.length > 0 ? orphanLines.join("\n") : "- No standalone pages yet."}\n`;

  writeKnowledgeTextFile(
    path.join(clusterDir, "_index.md"),
    normalizeQuartzMarkdown(content),
    options.transaction,
  );
}

export interface LegacySubtopicMigrationResult {
  gardenId: string;
  detected: number;
  markedInternal: number;
  preserved: string[];
}

export function migrateLegacySubtopics(
  contentPath: string,
  gardenId: string,
  options: { apply?: boolean } = {},
): LegacySubtopicMigrationResult {
  const clusterDir = path.join(contentPath, gardenId.trim());
  const result: LegacySubtopicMigrationResult = {
    gardenId,
    detected: 0,
    markedInternal: 0,
    preserved: [],
  };
  if (!fs.existsSync(clusterDir)) return result;

  for (const item of walkClusterMarkdown(clusterDir)) {
    if (!isLegacySubtopicRelPath(item.relPath)) continue;
    const content = fs.readFileSync(item.filePath, "utf-8");
    const { data, body } = parseMarkdownFile(content);
    const type = inferKnowledgeType(data);
    if (type !== "knowledge-topic" && type !== INTERNAL_CONCEPT_TYPE) continue;

    result.detected += 1;
    result.preserved.push(item.relPath);

    if (!options.apply || type === INTERNAL_CONCEPT_TYPE) continue;

    const updated =
      frontmatter({
        ...data,
        knowledge_type: INTERNAL_CONCEPT_TYPE,
        breadboardType: "internal_concept",
        draft: "true",
        legacy_subtopic_page: "true",
      }) + `${body}\n`;
    fs.writeFileSync(item.filePath, updated, "utf-8");
    result.markedInternal += 1;
  }

  if (result.detected > 0) {
    console.info(
      `[breadboard] preserved ${result.detected} legacy generated subtopic page(s) in ${gardenId}; marked ${result.markedInternal} as internal.`,
    );
  }

  return result;
}
