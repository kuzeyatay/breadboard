// Distills an extracted document into a book-to-skill skill.
//
// This is the clone's generator spec (SKILL.md Steps 3–9) executed as code
// rather than as instructions to a host agent: segment with the clone, analyze
// the structure once, write one file per chapter, derive glossary / patterns /
// cheatsheet from those chapter files, and finish with a master SKILL.md kept
// under the spec's 4,000-token budget.
//
// Two decisions the clone asks the user for are inferred here instead, because
// a chat attachment cannot stop and hold a dialogue mid-turn:
//   BOOK_TYPE — from the density of code fences and tables in the source.
//   DEPTH     — always `study`, the clone's own default when Step 4 is skipped.
// Both stay overridable by the caller.

import type OpenAI from "openai";
import { withCouncil, type CouncilMode } from "../council.ts";
import { createChatmockClient, DEFAULT_MODEL } from "../knowledge.ts";
import { segmentDocument } from "./bridge.ts";
import {
  chapterBudget,
  chapterHeading,
  mergeToLimit,
  planChapters,
  inferBookType,
  type ChapterPlan,
} from "./planning.ts";
import {
  createBuildingSkill,
  documentContentHash,
  findSkillByHash,
  markSkillBuilding,
  markSkillFailed,
  markSkillReady,
  writeSkillFile,
} from "./store.ts";
import { validateGeneratedSkill } from "./validate.ts";
import type {
  BookType,
  DocumentChapter,
  DocumentSkillOrigin,
  DocumentSkillProgress,
  DocumentSkillRecord,
  SkillDepth,
} from "./types.ts";

/** Chapter files distilled at once. Enough to matter, few enough to stay polite. */
const CHAPTER_CONCURRENCY = 3;

export interface BuildSkillInput {
  userId: number;
  /** Already-extracted document text. */
  text: string;
  /** Best available title; refined by the analysis step. */
  title: string;
  origin: DocumentSkillOrigin;
  baseURL?: string;
  bookType?: BookType;
  depth?: SkillDepth;
  model?: string;
  onProgress?: (progress: DocumentSkillProgress) => void;
  signal?: AbortSignal;
}

export interface BuildSkillResult {
  record: DocumentSkillRecord;
  /** True when an existing ready skill was reused instead of rebuilt. */
  cached: boolean;
  warnings: string[];
}

interface DocumentAnalysis {
  title: string;
  author: string | null;
  domain: string;
  frameworks: string[];
  summary: string;
}

/**
 * One model call, with the council mode stated rather than inferred.
 *
 * The mode matters more here than anywhere else in Breadboard, because a book
 * is not one call — it is one per chapter plus four. Left to the task type,
 * `source_synthesis` resolves to `full_council`, which runs a multi-seat
 * deliberation and answers from the council's own pinned models rather than the
 * caller's. That is the right trade for generating a lesson from nothing; it is
 * the wrong trade for distilling a chapter that is sitting in the prompt, forty
 * times over.
 *
 * So the high-volume calls take `direct_council` — a single pass on the
 * requested model, with the source text present and an instruction to use
 * nothing else — and only the master index, the one call that shapes how the
 * whole skill reads, is worth a deliberation.
 */
async function complete(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  taskType: Parameters<typeof withCouncil>[1]["taskType"],
  councilModeOverride: CouncilMode,
  signal?: AbortSignal,
): Promise<string> {
  const response = await client.chat.completions.create(
    withCouncil(
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      { taskType, councilModeOverride },
    ),
    { signal },
  );
  return response.choices[0]?.message?.content?.trim() ?? "";
}

/**
 * The index call, which is allowed a deliberation but not allowed to fail.
 *
 * A council mode above `direct` answers from the council's own configured
 * models, not the caller's — so it can be rate-limited or unavailable
 * independently of the model everything else in this build just used
 * successfully. Losing every distilled chapter at the last step because one
 * optional deliberation was throttled is not a trade worth making, so the
 * deliberation is attempted and then given up on.
 */
async function completeIndex(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<{ text: string; deliberated: boolean }> {
  try {
    const text = await complete(client, model, system, user, "source_synthesis", "lite_council", signal);
    if (text.trim()) return { text, deliberated: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
  }
  return {
    text: await complete(client, model, system, user, "source_synthesis", "direct_council", signal),
    deliberated: false,
  };
}

const ANALYSIS_SYSTEM = [
  "You identify the structure of a document so it can be turned into an agent skill.",
  "Extract structure, not a summary. Preserve the author's exact naming for frameworks.",
  "Answer with a single JSON object and nothing else.",
].join(" ");

async function analyzeDocument(
  client: OpenAI,
  model: string,
  text: string,
  chapters: DocumentChapter[],
  fallbackTitle: string,
  signal?: AbortSignal,
): Promise<DocumentAnalysis> {
  const user = [
    "Identify this document. Return JSON with exactly these keys:",
    '{"title": string, "author": string|null, "domain": string, "frameworks": string[], "summary": string}',
    "",
    "- title: the document's real title (not the filename) if it is discoverable, else the filename.",
    "- author: the author(s), or null if not stated.",
    "- domain: the subject area in 2-5 words.",
    "- frameworks: up to 8 named frameworks, models, or methods this document teaches, using the author's exact names.",
    "- summary: two sentences on what this document is and what it is for.",
    "",
    `Filename or provisional title: ${fallbackTitle}`,
    "",
    `Detected sections (${chapters.length}):`,
    chapters.slice(0, 40).map((chapter) => `- ${chapter.title}`).join("\n"),
    "",
    "Opening of the document:",
    text.slice(0, 8000),
  ].join("\n");

  const raw = await complete(client, model, ANALYSIS_SYSTEM, user, "metadata_generation", "direct_council", signal);
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(json) as Partial<DocumentAnalysis>;
    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallbackTitle,
      author: typeof parsed.author === "string" && parsed.author.trim() ? parsed.author.trim() : null,
      domain: typeof parsed.domain === "string" ? parsed.domain.trim() : "",
      frameworks: Array.isArray(parsed.frameworks)
        ? parsed.frameworks.filter((item): item is string => typeof item === "string").slice(0, 8)
        : [],
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    };
  } catch {
    return { title: fallbackTitle, author: null, domain: "", frameworks: [], summary: "" };
  }
}

/** The clone's Step 7 chapter template, with the sections its rules gate on. */
function chapterPrompt(
  chapter: ChapterPlan,
  index: number,
  analysis: DocumentAnalysis,
  bookType: BookType,
  depth: SkillDepth,
): string {
  const technical = bookType === "technical";
  const study = depth === "study";
  return [
    `Write the skill file for section ${index + 1} of "${analysis.title}".`,
    `Target length: ${chapterBudget(bookType, depth)}. Density beats length — never pad to hit a number.`,
    "",
    "Output ONLY the markdown file, starting with the H1. Use exactly this structure, omitting any section that has no honest content:",
    "",
    `# ${chapterHeading(chapter.title, chapter.number, index)}`,
    "",
    "## Core Idea",
    "1-2 sentences: the single most important thing this section teaches.",
    "",
    "## Frameworks Introduced",
    "- **<Framework Name>**: <exact formulation — preserve the author's naming>",
    "  - When to use: <specific situation>",
    "  - How: <steps or criteria>",
    "",
    "## Key Concepts",
    "- **<Term>**: <precise one-sentence definition> (5-10 terms)",
    "",
    "## Mental Models",
    '2-4 thinking tools, written as "Use X when Y" or "Think of X as Y".',
    "",
    "## Anti-patterns",
    "- **<What to avoid>**: <why it fails>",
    ...(technical
      ? [
          "",
          "## Code Examples",
          "The most instructive snippet from this section, in a fenced block with the right language tag. Preserve syntax and indentation exactly. Follow it with **What it demonstrates**: one line.",
          "",
          "## Reference Tables",
          "Reproduce any comparison matrix, parameter table, or decision table from this section as a markdown table.",
        ]
      : []),
    ...(study
      ? [
          "",
          "## Worked Example",
          "Reproduce or compactly reconstruct one concrete example this section works through. Stay faithful to the source; never copy long raw passages.",
        ]
      : []),
    "",
    "## Key Takeaways",
    "3-7 numbered, actionable insights a practitioner must remember.",
    "",
    "## Connects To",
    "- **Ch N**: <why it relates> — reference other sections by number where the text supports it.",
    "",
    "---",
    "",
    chapter.truncated
      ? "NOTE: this section was too long to include whole; its middle is omitted below. Do not claim coverage of material you cannot see."
      : "",
    "",
    "SOURCE TEXT:",
    chapter.text,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const CHAPTER_SYSTEM = [
  "You convert a section of a document into one file of an agent skill.",
  "Extract structure, not a summary: named frameworks, decision rules, techniques, anti-patterns.",
  "Preserve the author's exact terminology — a framework's name is part of its meaning.",
  "Every claim must come from the supplied text. Never invent frameworks, numbers, or citations.",
  "Output raw markdown only, with no preamble and no code fence around the whole file.",
].join(" ");

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function chapterIndexTable(chapters: ChapterPlan[], summaries: string[]): string {
  const rows = chapters.map((chapter, index) => {
    const core =
      /## Core Idea\s*\n+([^\n#][^\n]*)/.exec(summaries[index] ?? "")?.[1]?.trim() ?? "";
    return `| ${index + 1} | ${chapter.title.replace(/\|/g, "/")} | \`${chapter.file}\` | ${core
      .replace(/\|/g, "/")
      .slice(0, 140)} |`;
  });
  return ["| # | Section | File | Core idea |", "|---|---|---|---|", ...rows].join("\n");
}

export async function buildDocumentSkill(input: BuildSkillInput): Promise<BuildSkillResult> {
  const text = input.text;
  const contentHash = documentContentHash(text);
  const existing = findSkillByHash(input.userId, contentHash);
  if (existing?.status === "ready") return { record: existing, cached: true, warnings: [] };

  const bookType = input.bookType ?? inferBookType(text);
  const depth = input.depth ?? "study";
  const model = input.model?.trim() || DEFAULT_MODEL;
  const client = createChatmockClient(input.baseURL);
  const progress = input.onProgress ?? (() => {});

  progress({ phase: "segmenting", completed: 0, total: 1, message: "Detecting the document's structure" });
  const structure = await segmentDocument(text);
  const chapters = planChapters(text, mergeToLimit(structure.chapters));

  const record =
    existing ??
    createBuildingSkill({
      userId: input.userId,
      contentHash,
      title: input.title,
      bookType,
      depth,
      sourceTokens: structure.estimatedTokens,
      origin: input.origin,
    });
  if (existing) markSkillBuilding(existing.id);

  const warnings: string[] = [];
  if (!structure.fromClone) {
    warnings.push(
      "Segmented without the book-to-skill clone's Python detector; chapter boundaries may be coarser.",
    );
  }
  if (structure.chapters.some((chapter) => chapter.kind === "window")) {
    warnings.push("No chapter headings were detectable, so the document was split into fixed-size parts.");
  }

  try {
    progress({ phase: "segmenting", completed: 1, total: 1, message: "Identifying the document" });
    const analysis = await analyzeDocument(client, model, text, chapters, input.title, input.signal);

    progress({
      phase: "chapters",
      completed: 0,
      total: chapters.length,
      message: `Distilling ${chapters.length} sections`,
    });
    let done = 0;
    const summaries = await mapWithConcurrency(chapters, CHAPTER_CONCURRENCY, async (chapter, index) => {
      const body = await complete(
        client,
        model,
        CHAPTER_SYSTEM,
        chapterPrompt(chapter, index, analysis, bookType, depth),
        "source_synthesis",
        "direct_council",
        input.signal,
      );
      writeSkillFile(record.slug, chapter.file, `${body.trim()}\n`);
      done += 1;
      progress({
        phase: "chapters",
        completed: done,
        total: chapters.length,
        message: `Distilled ${done} of ${chapters.length} sections`,
      });
      return body;
    });

    // The supporting files are derived from the chapter files, not from the raw
    // document: they are meant to be consistent with what the chapters say, and
    // re-reading the whole book three more times would triple the build.
    const chapterDigest = summaries
      .map((summary, index) => `--- ${chapters[index].file} (${chapters[index].title}) ---\n${summary}`)
      .join("\n\n")
      .slice(0, 240_000);

    progress({ phase: "supporting", completed: 0, total: 3, message: "Writing the glossary" });
    const glossary = await complete(
      client,
      model,
      "You compile reference files for an agent skill. Output raw markdown only.",
      [
        `Write \`glossary.md\` for the skill distilled from "${analysis.title}".`,
        "Every significant term, alphabetically sorted, one per line, formatted exactly:",
        "**Term** — definition (Ch N)",
        "Keep it under 1,500 tokens. Use only terms that appear in the section files below.",
        "",
        chapterDigest,
      ].join("\n"),
      "concept_extraction",
      "direct_council",
      input.signal,
    );
    writeSkillFile(record.slug, "glossary.md", `${glossary.trim()}\n`);

    progress({ phase: "supporting", completed: 1, total: 3, message: "Writing the patterns file" });
    const patterns = await complete(
      client,
      model,
      "You compile reference files for an agent skill. Output raw markdown only.",
      [
        `Write \`patterns.md\` for the skill distilled from "${analysis.title}".`,
        "Every concrete technique, pattern, or method, each as:",
        "## Pattern Name",
        "**When to use**: ...",
        "**How**: ...",
        "**Trade-offs**: ...",
        "Keep it under 2,000 tokens. Use only material from the section files below.",
        "",
        chapterDigest,
      ].join("\n"),
      "concept_extraction",
      "direct_council",
      input.signal,
    );
    writeSkillFile(record.slug, "patterns.md", `${patterns.trim()}\n`);

    progress({ phase: "supporting", completed: 2, total: 3, message: "Writing the cheatsheet" });
    const cheatsheet = await complete(
      client,
      model,
      "You compile reference files for an agent skill. Output raw markdown only.",
      [
        `Write \`cheatsheet.md\` for the skill distilled from "${analysis.title}".`,
        "This is a reasoning aid, not a keyword list. It captures the author's judgment.",
        "Prioritize, in order: decision rules (\"When X, do Y, because Z\"), decision trees,",
        "trade-off matrices, thresholds and defaults with their specific numbers, and tells/smells.",
        "Avoid bare term-definition rows (that is the glossary) and prose paragraphs (that is the chapters).",
        "Every line must help the reader decide something. Mostly compact tables. Under 1,200 tokens.",
        "",
        chapterDigest,
      ].join("\n"),
      "concept_extraction",
      "direct_council",
      input.signal,
    );
    writeSkillFile(record.slug, "cheatsheet.md", `${cheatsheet.trim()}\n`);

    progress({ phase: "index", completed: 0, total: 1, message: "Writing the skill index" });
    // The one call worth deliberating over: this index is what every later turn
    // reads, and what decides whether the model opens the right chapter.
    const index = await completeIndex(
      client,
      model,
      "You write the master index of an agent skill. Output raw markdown only, no frontmatter.",
      [
        `Write the body of \`SKILL.md\` for the skill distilled from "${analysis.title}"${
          analysis.author ? ` by ${analysis.author}` : ""
        }.`,
        "CRITICAL: under 3,000 tokens. Most important content FIRST.",
        "Structure:",
        "## What this is — 2-3 sentences on the document and when to reach for it.",
        "## Core Frameworks — the 3-7 most important named frameworks, each with when to use it and how, in the author's exact terminology.",
        "## Decision Rules — the handful of if/then rules that most change what a practitioner does.",
        "## Anti-patterns — what the author says to avoid, and why.",
        "Do NOT include a chapter index or a file list; those are added mechanically.",
        "",
        chapterDigest.slice(0, 160_000),
      ].join("\n"),
      input.signal,
    );
    const core = index.text;

    const description = [
      `Knowledge base from "${analysis.title}"`,
      analysis.author ? ` by ${analysis.author}` : "",
      ". Use when answering from this document, applying its frameworks",
      analysis.domain ? ` for ${analysis.domain}` : "",
      ", or referencing its sections.",
    ].join("");

    const skillMarkdown = [
      "---",
      `name: ${record.slug}`,
      `description: ${JSON.stringify(description)}`,
      "---",
      "",
      `<!-- Distilled by Breadboard from ${input.origin.fileName} using the book-to-skill spec. -->`,
      "",
      `# ${analysis.title}`,
      analysis.author ? `\n*${analysis.author}*` : "",
      "",
      core.trim(),
      "",
      "## Sections",
      "",
      "Each file below is loaded on demand — read only the ones the question needs.",
      "",
      chapterIndexTable(chapters, summaries),
      "",
      "## Reference files",
      "",
      "| File | Contents |",
      "|---|---|",
      "| `glossary.md` | Every key term, alphabetical, with section references |",
      "| `patterns.md` | Techniques and methods, with when-to-use and trade-offs |",
      "| `cheatsheet.md` | Decision rules, thresholds, and trade-off tables |",
      "",
      warnings.length > 0 ? `> Build notes: ${warnings.join(" ")}` : "",
      "",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
    writeSkillFile(record.slug, "SKILL.md", skillMarkdown);

    progress({ phase: "validating", completed: 0, total: 1, message: "Validating the generated skill" });
    const validation = await validateGeneratedSkill(record.slug);
    warnings.push(...validation.warnings);

    markSkillReady(record.id, chapters.length);
    progress({ phase: "done", completed: 1, total: 1, message: `Skill ready: ${analysis.title}` });
    const ready = findSkillByHash(input.userId, contentHash);
    return { record: ready ?? record, cached: false, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The document skill could not be built";
    markSkillFailed(record.id, message);
    throw error;
  }
}
