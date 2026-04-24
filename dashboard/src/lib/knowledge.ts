import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { publishQuartzAfterMutation } from "@/lib/quartz-publish";

export const DEFAULT_MODEL = "gpt-5.4";

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
  sourceTitle: string;
  topics: {
    slug: string;
    title: string;
    locations: string[];
    action: "created" | "merged";
  }[];
  wordCount: number;
}

interface ExistingTopicNote {
  slug: string;
  title: string;
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
  title: string;
  type: string;
  sourceType: string;
  sourceFile: string;
  sourcePdf: string;
  sourceDocument: string;
  flagColor: string;
  locations: string[];
  tags: string[];
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
    generatedNotes: number;
    links: number;
    words: number;
  };
}

interface ClusterKnowledgeCacheEntry {
  signature: string;
  knowledge: ClusterKnowledge;
}

type Frontmatter = Record<string, string | string[]>;

const clusterKnowledgeCache = new Map<string, ClusterKnowledgeCacheEntry>();

const KNOWLEDGE_SYSTEM_PROMPT = `You are a precise knowledge extraction engine for a second-brain system.

Turn uploaded material into a graph-ready knowledge tree. Extract durable knowledge only: concepts, methods, named entities, formulas, claims, examples, definitions, tasks that teach a reusable procedure, and relationships between them.

Return ONLY valid JSON. Do not wrap the JSON in markdown fences.

Schema:
{
  "documentTitle": "Clean title",
  "summary": "4-8 sentence factual summary of the material",
  "suggestedTags": ["tag-one", "tag-two"],
  "topics": [
    {
      "title": "Atomic Topic Title",
      "slug": "atomic-topic-title",
      "explanation": "A detailed explanation grounded in the uploaded material.",
      "keyPoints": ["Specific fact or step", "Specific fact or step"],
      "sourceEvidence": ["Exact source-grounded detail, equation, example, diagram meaning, or procedure step"],
      "locations": ["Page 2", "Section: Introduction"],
      "relatedTopics": ["Another extracted topic title"],
      "tags": ["tag-one"]
    }
  ],
  "relationships": [
    {
      "source": "Atomic Topic Title",
      "target": "Another extracted topic title",
      "relation": "depends-on | contrasts-with | example-of | part-of | applies-to | related"
    }
  ]
}

Rules:
- Make 6-18 topics depending on the material. Use fewer only if the source is genuinely short.
- Every topic must be useful as its own markdown note, with enough detail to study from without reopening the source.
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
- Tags must be specific subject terms from the material, such as named concepts, methods, formulas, people, systems, or domain terms.
- Every tag must be an exact source term or a close spelling/inflection of a source term. Do not invent broad category tags that are absent from the uploaded material.
- Never use app or navigation tags such as graph, links, graph-links, quartz-graph, map, dashboard, index, garden, knowledge, generated, note, topic, source, document, pdf, file, chat, answer, response, general, or misc.
- Prefer 3-8 meaningful tags per topic and 4-10 suggestedTags for the whole document.
- Link topics aggressively through relatedTopics and relationships whenever the relationship is grounded in the source.
- Each topic should have at least one relatedTopic when more than one topic is extracted.
- Create 2-5 strong relationships per topic when possible. Prefer precise relation labels: depends-on, contrasts-with, example-of, part-of, causes, enables, applies-to, derives-from, measured-by, limits, or related.
- Do not add weak or filler relationships just to increase count; every relationship should explain a real conceptual connection.
- If the source has no durable knowledge, return topics: [] and an honest summary.`;

export function createChatmockClient(baseURL?: string): OpenAI {
  return new OpenAI({
    baseURL: baseURL ?? process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "note";
}

const STOP_WORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "into",
  "the",
  "then",
  "this",
  "that",
  "with",
  "about",
  "between",
  "through",
]);

const GENERIC_TAGS = new Set([
  "answer",
  "answers",
  "chat",
  "chat-note",
  "cluster",
  "concept",
  "concepts",
  "content",
  "data",
  "doc",
  "docs",
  "document",
  "documents",
  "file",
  "files",
  "garden",
  "garden-home",
  "generated",
  "general",
  "graph",
  "graphs",
  "graph-link",
  "graph-links",
  "index",
  "information",
  "knowledge",
  "knowledge-graph",
  "knowledge-map",
  "link",
  "links",
  "map",
  "maps",
  "markdown",
  "misc",
  "node",
  "nodes",
  "note",
  "notes",
  "other",
  "pdf",
  "quartz",
  "quartz-garden",
  "quartz-graph",
  "response",
  "responses",
  "source",
  "sources",
  "text",
  "topic",
  "topics",
  "upload",
  "uploaded",
]);

const TAG_STOP_WORDS = new Set([
  ...STOP_WORDS,
  "also",
  "based",
  "because",
  "before",
  "being",
  "does",
  "during",
  "each",
  "have",
  "into",
  "only",
  "over",
  "same",
  "such",
  "than",
  "their",
  "these",
  "those",
  "using",
  "where",
  "which",
  "while",
  "will",
  "within",
  "without",
]);

function isUsefulTagSlug(tag: string): boolean {
  if (!tag || GENERIC_TAGS.has(tag) || TAG_STOP_WORDS.has(tag)) return false;
  if (/^\d+$/.test(tag)) return false;
  return tag.length >= 3 || tag === "ai" || tag === "ml";
}

function searchableTagText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagPartVariants(part: string): string[] {
  const variants = new Set([part]);
  if (part.length > 3 && part.endsWith("ies")) variants.add(`${part.slice(0, -3)}y`);
  if (part.length > 3 && part.endsWith("es")) variants.add(part.slice(0, -2));
  if (part.length > 3 && part.endsWith("s")) variants.add(part.slice(0, -1));
  if (part.length > 2) variants.add(`${part}s`);
  return [...variants];
}

function isGroundedTagSlug(tag: string, groundingText: string): boolean {
  const grounded = searchableTagText(groundingText);
  if (!grounded) return true;

  const phrase = tag.split("-").filter(Boolean).join(" ");
  if (phrase && new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(grounded)) {
    return true;
  }

  const groundedWords = new Set(grounded.split(/\s+/).filter(Boolean));
  const parts = tag.split("-").filter((part) => part && !TAG_STOP_WORDS.has(part));
  if (parts.length === 0) return false;

  return parts.every((part) =>
    tagPartVariants(part).some((variant) => groundedWords.has(variant)),
  );
}

export function semanticTagsFromText(
  value: string,
  maxTags = 8,
  groundingText = value,
): string[] {
  const words = value
    .toLowerCase()
    .slice(0, 9000)
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter((word) => isUsefulTagSlug(slugify(word)));

  const scores = new Map<string, number>();
  const addScore = (tag: string, amount: number) => {
    const slug = slugify(tag);
    if (!isUsefulTagSlug(slug)) return;
    if (!isGroundedTagSlug(slug, groundingText)) return;
    scores.set(slug, (scores.get(slug) ?? 0) + amount);
  };

  for (const word of words) addScore(word, 1);
  for (let index = 0; index < words.length - 1; index++) {
    const first = words[index];
    const second = words[index + 1];
    if (first === second) continue;
    addScore(`${first}-${second}`, 2.5);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
    .slice(0, maxTags);
}

export function normalizeTopicTags(
  values: string[],
  fallbackText = "",
  maxTags = 8,
  groundingText = fallbackText,
): string[] {
  const groundedText = groundingText.trim() ? groundingText : fallbackText;
  const tags = values
    .map(slugify)
    .filter((tag) => isUsefulTagSlug(tag) && isGroundedTagSlug(tag, groundedText));
  const deduped = [...new Set(tags)].slice(0, maxTags);
  if (deduped.length >= Math.min(3, maxTags) || !fallbackText.trim())
    return deduped;
  return [
    ...new Set([...deduped, ...semanticTagsFromText(fallbackText, maxTags, groundedText)]),
  ].slice(0, maxTags);
}

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

function extractExistingSlugs(clusterDir: string): Set<string> {
  if (!fs.existsSync(clusterDir)) return new Set();
  return new Set(
    fs
      .readdirSync(clusterDir)
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => entry.replace(/\.md$/, "")),
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
  const response = await client.chat.completions.create({
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
  });

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
}: {
  client: OpenAI;
  model?: string;
  title: string;
  sourceType: string;
  sourceLabel: string;
  isHandwriting?: boolean;
  pages: DocumentPage[];
  text: string;
}): Promise<KnowledgeExtraction> {
  const selectedModel = model?.trim() || DEFAULT_MODEL;
  const cleanPages = cleanDocumentPages(pages);
  const cleanText = cleanGeneratedText(text);
  const chunks = buildLocatedPromptChunks(cleanPages, cleanText);

  try {
    if (chunks.length <= 1) {
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
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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

function hasStrongPageTokenMatch(topicTokens: Set<string>, pageTokens: Set<string>): boolean {
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
  if (explicit) return explicit;
  if (frontmatterString(data, "source_document")) return "knowledge-topic";
  const tags = frontmatterArray(data, "tags");
  if (tags.includes("generated")) return "generated-note";
  const source = frontmatterString(data, "source");
  if (source && !tags.includes("generated")) return "source-document";
  return "note";
}

function readExistingTopicNotes(clusterDir: string): ExistingTopicNote[] {
  if (!fs.existsSync(clusterDir)) return [];

  return fs
    .readdirSync(clusterDir)
    .filter((entry) => entry.endsWith(".md") && entry !== "_index.md")
    .map((entry) => {
      const filePath = path.join(clusterDir, entry);
      const content = fs.readFileSync(filePath, "utf-8");
      const { data, body } = parseMarkdownFile(content);
      const type = inferKnowledgeType(data);
      if (
        type !== "knowledge-topic" &&
        type !== "generated-note" &&
        type !== "user-note" &&
        type !== "note"
      ) {
        return undefined;
      }

      return {
        slug: entry.replace(/\.md$/, ""),
        title: frontmatterString(data, "title") || entry.replace(/\.md$/, ""),
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
    const response = await client.chat.completions.create({
      model: model?.trim() || DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You decide whether newly extracted knowledge should update an existing markdown note or become a new note. " +
            "Merge only when the new topic is the same concept, a direct continuation, or a more specific treatment of the existing note. " +
            "Create a new note when the topic is merely related, adjacent, or only shares broad keywords. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            schema: [
              {
                topicTitle: "new topic title",
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
    });

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

function appendMergedTopicSection({
  target,
  topic,
  sourceSlug,
  sourceTitle,
  sourceLabel,
  imagePages,
}: {
  target: ExistingTopicNote;
  topic: ExtractedTopic;
  sourceSlug: string;
  sourceTitle: string;
  sourceLabel: string;
  imagePages: DocumentPage[];
}): void {
  const locations =
    topic.locations.length > 0 ? topic.locations : ["Uploaded document"];
  const sourceLink = wikilink(sourceSlug, sourceTitle);
  const snapshots = formatSourceSnapshots(imagePages);

  if (target.content.includes(sourceLink)) return;

  const section =
    `\n\n## Added from ${sourceLink}\n\n` +
    `Source label: ${sourceLabel}\n\n` +
    `Locations: ${locations.join(", ")}\n\n` +
    `${topic.explanation}\n\n` +
    (snapshots ? `### Source snapshots\n\n${snapshots}\n\n` : "") +
    `### New key points\n\n${formatBullets(topic.keyPoints)}\n`;

  fs.writeFileSync(
    target.filePath,
    `${target.content.trimEnd()}${section}`,
    "utf-8",
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Upload canceled");
    error.name = "AbortError";
    throw error;
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
  isHandwriting,
  markdownText,
  plainText,
  pages = [],
  extraction,
  abortSignal,
  createdFilePaths = [],
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
  isHandwriting?: boolean;
  markdownText: string;
  plainText: string;
  pages?: DocumentPage[];
  extraction: KnowledgeExtraction;
  abortSignal?: AbortSignal;
  createdFilePaths?: string[];
}): Promise<SavedKnowledge> {
  throwIfAborted(abortSignal);
  const clusterDir = path.join(contentPath, clusterSlug.trim());
  fs.mkdirSync(clusterDir, { recursive: true });
  const cleanPages = cleanDocumentPages(pages);
  const outputMarkdownText = cleanGeneratedText(markdownText);
  const outputPlainText = cleanGeneratedText(plainText);

  const usedSlugs = extractExistingSlugs(clusterDir);
  const sourceSlug = uniqueSlug(slugify(sourceTitle), usedSlugs);
  const existingNotes = readExistingTopicNotes(clusterDir);
  const topicPlans = await decideTopicWritePlans({
    client,
    model,
    topics: extraction.topics,
    existingNotes,
    usedSlugs,
  });
  const topicSlugByTitle = new Map(
    topicPlans.map((plan) => [plan.topic.title.toLowerCase(), plan.finalSlug]),
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

  const date = new Date().toISOString();
  const sourceTags = normalizeTopicTags(
    [
      ...extraction.suggestedTags,
      ...topicPlans.flatMap((plan) => plan.topic.tags),
      ...semanticTagsFromText(
        extraction.documentTitle || sourceTitle,
        4,
        [extraction.documentTitle || sourceTitle, outputPlainText].join("\n"),
      ),
    ],
    [
      extraction.documentTitle || sourceTitle,
      extraction.summary,
      outputPlainText.slice(0, 3000),
    ].join("\n"),
    10,
    [extraction.documentTitle || sourceTitle, outputPlainText].join("\n"),
  );
  const sourceLinks = topicPlans.map((plan) => {
    const locations =
      plan.topic.locations.length > 0
        ? ` (${plan.topic.locations.join(", ")})`
        : "";
    return `- ${wikilink(plan.finalSlug, plan.topic.title)}${locations}`;
  });
  const sourceImages = uniqueNonEmpty(
    cleanPages.map((page) => page.imagePath ?? "").filter(Boolean),
    40,
  );

  const sourceFrontmatter: Record<string, string | string[]> = {
    title: extraction.documentTitle || sourceTitle,
    date,
    source: sourceLabel,
    knowledge_type: "source-document",
    source_type: sourceType,
    source_file: sourceFileName,
    generated_by: "chatmock",
    topics: topicPlans.map((plan) => plan.finalSlug),
    tags: sourceTags,
  };
  if (sourceImages.length > 0) sourceFrontmatter.source_images = sourceImages;
  if (sourcePdfPath) sourceFrontmatter.source_pdf = sourcePdfPath;
  if (isHandwriting) {
    sourceFrontmatter.source_mode = "handwritten-or-scanned";
    sourceFrontmatter.extraction_method = "chatmock-vision-ocr";
  }

  const sourceContent =
    frontmatter(sourceFrontmatter) +
    `## Summary\n\n${extraction.summary}\n\n` +
    `## Knowledge tree\n\n${sourceLinks.length > 0 ? sourceLinks.join("\n") : "- No knowledge topics were extracted."}\n\n` +
    `## Source material\n\n${outputMarkdownText.trim() || outputPlainText.trim()}\n`;

  throwIfAborted(abortSignal);
  const sourceFilePath = path.join(clusterDir, `${sourceSlug}.md`);
  fs.writeFileSync(sourceFilePath, sourceContent, "utf-8");
  createdFilePaths.push(sourceFilePath);

  for (const plan of topicPlans) {
    throwIfAborted(abortSignal);
    const topic = plan.topic;
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
        const relatedSlug = topicSlugByTitle.get(relatedTitle.toLowerCase());
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
    const pageGroundedDetails = formatPageGroundedDetails(topic, cleanPages);
    const tags = normalizeTopicTags(
      topic.tags,
      [
        topic.title,
        topic.explanation,
        topic.keyPoints.join("\n"),
        topic.sourceEvidence.join("\n"),
      ].join("\n"),
      8,
      [topic.title, outputPlainText].join("\n"),
    );

    if (plan.action === "merged" && plan.target) {
      appendMergedTopicSection({
        target: plan.target,
        topic,
        sourceSlug,
        sourceTitle: extraction.documentTitle || sourceTitle,
        sourceLabel,
        imagePages,
      });
      continue;
    }

    const topicFrontmatter: Record<string, string | string[]> = {
      title: topic.title,
      date,
      source: sourceLabel,
      knowledge_type: "knowledge-topic",
      source_document: sourceSlug,
      source_file: sourceFileName,
      locations,
      related: relatedTitles.map(
        (relatedTitle) =>
          topicSlugByTitle.get(relatedTitle.toLowerCase()) ??
          slugify(relatedTitle),
      ),
      tags,
    };
    const topicImages = imagePages
      .map((page) => page.imagePath ?? "")
      .filter(Boolean);
    if (topicImages.length > 0) topicFrontmatter.source_images = topicImages;

    const topicContent =
      frontmatter(topicFrontmatter) +
      `## ${topic.title}\n\n` +
      `Source: ${wikilink(sourceSlug, extraction.documentTitle || sourceTitle)}\n\n` +
      `Locations: ${locations.join(", ")}\n\n` +
      `${topic.explanation || extraction.summary}\n\n` +
      (snapshotMarkdown
        ? `### Source snapshots\n\n${snapshotMarkdown}\n\n`
        : "") +
      (pageGroundedDetails
        ? `### Page-grounded details\n\n${pageGroundedDetails}\n\n`
        : "") +
      `### Key points\n\n${formatBullets(topic.keyPoints)}\n\n` +
      `### Related topics\n\n${relatedLinks.length > 0 ? relatedLinks.join("\n") : "- No direct related topics extracted."}\n\n` +
      (relationLines.length > 0
        ? `### Relationships\n\n${relationLines.join("\n")}\n`
        : "");

    const topicFilePath = path.join(clusterDir, `${plan.finalSlug}.md`);
    fs.writeFileSync(topicFilePath, topicContent, "utf-8");
    createdFilePaths.push(topicFilePath);
  }

  throwIfAborted(abortSignal);
  refreshClusterIndex(contentPath, clusterSlug);
  await publishQuartzAfterMutation(`ingest knowledge into ${clusterSlug}`);

  return {
    sourceSlug,
    sourceTitle: extraction.documentTitle || sourceTitle,
    topics: topicPlans.map((plan) => ({
      slug: plan.finalSlug,
      title: plan.topic.title,
      locations: plan.topic.locations,
      action: plan.action,
    })),
    wordCount: outputPlainText.trim().split(/\s+/).filter(Boolean).length,
  };
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
): ClusterKnowledge {
  const clusterDir = path.join(contentPath, clusterSlug.trim());
  const nodes: KnowledgeNode[] = [];

  if (!fs.existsSync(clusterDir)) {
    return {
      nodes: [],
      edges: [],
      tree: [],
      orphanTopics: [],
      stats: { documents: 0, topics: 0, generatedNotes: 0, links: 0, words: 0 },
    };
  }

  const markdownEntries = fs
    .readdirSync(clusterDir)
    .filter((entry) => entry.endsWith(".md") && entry !== "_index.md")
    .map((entry) => {
      const filePath = path.join(clusterDir, entry);
      const stat = fs.statSync(filePath);
      return { entry, filePath, stat };
    })
    .sort((a, b) => a.entry.localeCompare(b.entry));

  const cacheKey = path.resolve(clusterDir);
  const signature = markdownEntries
    .map(
      ({ entry, stat }) =>
        `${entry}:${stat.size}:${Math.trunc(stat.mtimeMs)}`,
    )
    .join("|");
  const cached = clusterKnowledgeCache.get(cacheKey);
  if (cached?.signature === signature) {
    return cached.knowledge;
  }

  for (const { entry, filePath, stat } of markdownEntries) {
    const modifiedAt = stat.mtime.toISOString();
    const content = fs.readFileSync(filePath, "utf-8");
    const { data, body } = parseMarkdownFile(content);
    const slug = entry.replace(/\.md$/, "");
    const title = frontmatterString(data, "title") || slug;
    const sourceType = frontmatterString(data, "source_type");
    const sourceFile = frontmatterString(data, "source_file");
    const sourcePdf = frontmatterString(data, "source_pdf");
    const sourceDocument = frontmatterString(data, "source_document");
    const flagColor = frontmatterString(data, "flag_color");
    const locations = frontmatterArray(data, "locations");
    const tags = normalizeTopicTags(
      frontmatterArray(data, "tags"),
      "",
      8,
      [title, body].join("\n"),
    );
    const related = frontmatterArray(data, "related");
    const type = inferKnowledgeType(data);
    const date = frontmatterString(data, "date") || modifiedAt;
    const wordCount = body.trim().split(/\s+/).filter(Boolean).length;

    nodes.push({
      id: slug,
      slug,
      fileName: entry,
      title,
      type,
      sourceType,
      sourceFile,
      sourcePdf,
      sourceDocument,
      flagColor,
      locations,
      tags,
      related,
      date,
      wordCount,
      excerpt: excerpt(body),
      content,
    });
  }

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
  const topicNodes = nodes.filter((node) => node.type === "knowledge-topic");
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

  const orphanTopics = [...topicNodes, ...generatedNotes].filter(
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
      generatedNotes: generatedNotes.length,
      links: edges.length,
      words: nodes.reduce((sum, node) => sum + node.wordCount, 0),
    },
  };

  clusterKnowledgeCache.set(cacheKey, { signature, knowledge });
  if (clusterKnowledgeCache.size > 128) {
    const oldestKey = clusterKnowledgeCache.keys().next().value;
    if (typeof oldestKey === "string") clusterKnowledgeCache.delete(oldestKey);
  }

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

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function clusterIndexDescription(knowledge: ClusterKnowledge): string {
  return `Quartz garden generated from ${countLabel(
    knowledge.stats.documents,
    "source document",
  )}, with ${countLabel(
    knowledge.stats.topics,
    "knowledge topic",
  )} and ${countLabel(knowledge.stats.links, "graph link")}.`;
}

function clusterOverviewText(knowledge: ClusterKnowledge, date: string): string {
  const sourceText = countLabel(knowledge.stats.documents, "source document");
  const topicText = countLabel(knowledge.stats.topics, "knowledge topic");
  const noteText = countLabel(knowledge.stats.generatedNotes, "generated chat note");
  const linkText = countLabel(knowledge.stats.links, "graph link");
  const wordText = countLabel(knowledge.stats.words, "indexed word");

  return [
    `This Quartz garden is generated from ${sourceText} and rebuilt into a linked knowledge map. It currently contains ${topicText}, ${noteText}, ${linkText}, and ${wordText}.`,
    `Whenever a new document is uploaded and markdown content is generated, this cluster index is updated so the map, counts, and source tree stay aligned with the current material.`,
    `Last updated: ${date}.`,
  ].join("\n\n");
}

export function refreshClusterIndex(
  contentPath: string,
  clusterSlug: string,
): void {
  const clusterDir = path.join(contentPath, clusterSlug.trim());
  fs.mkdirSync(clusterDir, { recursive: true });
  const meta = readClusterIndexMeta(clusterDir, clusterSlug);
  const knowledge = scanClusterKnowledge(contentPath, clusterSlug);
  const date = new Date().toISOString().split("T")[0];

  const byNewest = (a: KnowledgeNode, b: KnowledgeNode) => {
    const dateDiff = Date.parse(b.date) - Date.parse(a.date);
    return dateDiff || a.title.localeCompare(b.title);
  };

  const sourceSections = [...knowledge.tree]
    .sort((a, b) => byNewest(a.source, b.source))
    .map(({ source, topics }) => {
      const topicLines = [...topics].sort(byNewest).map((topic) => {
        const locations =
          topic.locations.length > 0 ? ` - ${topic.locations.join(", ")}` : "";
        return `  - ${wikilink(topic.slug, topic.title)}${locations}`;
      });
      return [`- ${wikilink(source.slug, source.title)}`, ...topicLines].join(
        "\n",
      );
    });
  const sourceDocumentLines = [...knowledge.tree]
    .map(({ source }) => source)
    .sort(byNewest)
    .map(
      (source) =>
        `- ${wikilink(source.slug, source.title)} - full source-generated markdown, ${source.wordCount} words`,
    );

  const orphanLines = [...knowledge.orphanTopics]
    .sort(byNewest)
    .map((topic) => `- ${wikilink(topic.slug, topic.title)}`);
  const description = clusterIndexDescription(knowledge);
  const content =
    frontmatter({
      title: meta.title,
      date,
      description,
      knowledge_type: "cluster-index",
      tags: normalizeTopicTags(
        [meta.title, clusterSlug],
        [meta.title, clusterSlug].join("\n"),
        5,
        [meta.title, clusterSlug].join("\n"),
      ),
    }) +
    `## Garden overview\n\n` +
    `${clusterOverviewText(knowledge, date)}\n\n` +
    `## Full source notes\n\n` +
    `${sourceDocumentLines.length > 0 ? sourceDocumentLines.join("\n") : "- No source documents yet."}\n\n` +
    `## Cluster map\n\n` +
    `- Source documents: ${knowledge.stats.documents}\n` +
    `- Knowledge topics: ${knowledge.stats.topics}\n` +
    `- Generated chat notes: ${knowledge.stats.generatedNotes}\n` +
    `- Graph links: ${knowledge.stats.links}\n\n` +
    `## Source tree\n\n${sourceSections.length > 0 ? sourceSections.join("\n") : "- No source documents yet."}\n\n` +
    `## Other knowledge notes\n\n${orphanLines.length > 0 ? orphanLines.join("\n") : "- No standalone knowledge notes yet."}\n`;

  fs.writeFileSync(path.join(clusterDir, "_index.md"), content, "utf-8");
}
