// Turning a published garden into review cards.
//
// Cards are seeded from the *published* learning pages rather than from the Learn
// build manifest. The manifest is the obvious source — every BuildLearningUnit
// already carries a `learningQuestion`, a prerequisite graph, and grounded claims
// — but it is ephemeral: nothing under quartz/content/ retains it after a build,
// and gardens built before that pipeline never had one. The markdown is the only
// durable artifact, so it is what gets read here. Seeding therefore works on
// every garden, old or new, and survives any rebuild.
//
// A page yields one card: its lead prose is the answer, and the question is
// written from that prose. Question wording goes through the assistant model when
// one is reachable and falls back to a deterministic template when it is not, so
// a garden can always be seeded offline and improved later.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { gardenDirectory } from "../garden-directory.ts";
import { parseSemanticMarkdown } from "../garden-semantics.ts";
import type { ReviewStore } from "./store.ts";

/** Frontmatter that marks a page as generated learning material. */
function isLearningPage(data: Record<string, unknown>): boolean {
  return (
    data.knowledge_type === "learning-page" ||
    data.breadboardType === "learning_page"
  );
}

function walkMarkdown(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    // Dot-directories are Breadboard's own: .breadboard/ holds visual specs and
    // .<slug>.incoming-*/ is a half-finished build. Neither is published material.
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, out, depth + 1);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * The self-contained explanation at the top of a learning page.
 *
 * Generated pages open with a heading, a `Source:` line, a `Locations:` line, and
 * then a paragraph that summarises the whole idea before `## Page-Grounded
 * Details` breaks into source excerpts. That opening paragraph is the answer —
 * it is the part written to stand alone.
 */
export function leadProse(body: string): string {
  const beforeDetails = body.split(/^##\s+Page-Grounded Details\s*$/m)[0] ?? body;
  const paragraphs = beforeDetails
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(
      (block) =>
        block.length > 0 &&
        !block.startsWith("#") &&
        !/^Source:/i.test(block) &&
        !/^Locations:/i.test(block) &&
        !/^!\[/.test(block) &&
        !/^\|/.test(block),
    );
  return paragraphs.join("\n\n").trim();
}

function stripMathAndLinks(value: string): string {
  return value
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\n]*\$/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Titles arrive numbered by the build ("1.364 Additive Susceptibility …"). */
export function cleanTitle(value: string): string {
  return value.replace(/^\d+(?:\.\d+)*\s+/, "").trim();
}

/**
 * The question asked when no model is reachable.
 *
 * Deliberately plain: a template that pretends to be cleverer than it is
 * produces questions that read as though they test something they do not.
 */
export function templateQuestion(title: string): string {
  return `Explain ${cleanTitle(title)}, and why it holds.`;
}

export function sourceHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export interface SeedCandidate {
  pageSlug: string;
  pageTitle: string;
  answer: string;
  hash: string;
}

/** Read a garden's learning pages and reduce each to a card candidate. */
export function collectCandidates(
  gardenSlug: string,
  options: { contentPath?: string; minAnswerLength?: number } = {},
): SeedCandidate[] {
  const dir = gardenDirectory(gardenSlug, options.contentPath);
  const minLength = options.minAnswerLength ?? 200;
  const candidates: SeedCandidate[] = [];
  for (const file of walkMarkdown(dir)) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const { data, body } = parseSemanticMarkdown(raw);
    if (!isLearningPage(data as Record<string, unknown>)) continue;
    const answer = leadProse(body);
    // A page too short to state a whole idea cannot be asked about fairly; it is
    // usually a stub or an index, and asking about it teaches nothing.
    if (stripMathAndLinks(answer).length < minLength) continue;
    const title = typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : path.basename(file, ".md");
    candidates.push({
      pageSlug: path.basename(file, ".md"),
      pageTitle: title,
      answer,
      hash: sourceHash(answer),
    });
  }
  return candidates;
}

/**
 * Ask the assistant model to phrase one question per candidate.
 *
 * Batched, because a large garden is hundreds of pages and one request each
 * would be both slow and rude to the provider. A batch that fails or comes back
 * malformed falls through to the template rather than aborting the seed — a
 * usable card with a plain question beats no card at all.
 */
async function modelQuestions(batch: SeedCandidate[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (batch.length === 0) return out;
  const { createChatmockClient } = await import("../knowledge.ts");
  const client = createChatmockClient();
  const numbered = batch
    .map(
      (item, index) =>
        `${index + 1}. TITLE: ${cleanTitle(item.pageTitle)}\n   TEXT: ${stripMathAndLinks(
          item.answer,
        ).slice(0, 900)}`,
    )
    .join("\n\n");

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    messages: [
      {
        role: "system",
        content:
          "You write recall questions for a spaced-repetition system. For each " +
          "numbered item, write ONE question that can be answered from the text " +
          "and that tests understanding rather than recognition. Never ask a " +
          "yes/no question. Never mention 'the text' or 'the passage' — the " +
          "reader will not have it in front of them. Reply with a JSON array of " +
          'objects: [{"n": 1, "question": "..."}]. No prose outside the JSON.',
      },
      { role: "user", content: numbered },
    ],
  });

  const content = response.choices?.[0]?.message?.content ?? "";
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const n = Number((entry as { n?: unknown }).n);
    const question = (entry as { question?: unknown }).question;
    if (!Number.isInteger(n) || n < 1 || n > batch.length) continue;
    if (typeof question !== "string" || question.trim().length < 8) continue;
    out.set(batch[n - 1].pageSlug, question.trim());
  }
  return out;
}

export interface SeedResult {
  scanned: number;
  created: number;
  refreshed: number;
  unchanged: number;
  modelQuestions: number;
}

/**
 * Bring a garden's cards in line with its pages.
 *
 * Idempotent: a page whose prose has not changed leaves its card — and its whole
 * scheduling history — untouched.
 */
export async function seedGarden(options: {
  store: ReviewStore;
  userId: number;
  gardenSlug: string;
  contentPath?: string;
  /** Skip the model and use templates only. */
  offline?: boolean;
  batchSize?: number;
  now?: Date;
}): Promise<SeedResult> {
  const candidates = collectCandidates(options.gardenSlug, {
    contentPath: options.contentPath,
  });
  const result: SeedResult = {
    scanned: candidates.length,
    created: 0,
    refreshed: 0,
    unchanged: 0,
    modelQuestions: 0,
  };

  // Only pages whose card is missing need a question written; a garden that has
  // already been seeded therefore costs no model calls at all. The existing
  // slugs are read once — a per-candidate lookup would be quadratic, and these
  // gardens run to hundreds of pages.
  const known = new Set(
    options.store
      .listCards(options.userId, options.gardenSlug, 100_000)
      .map((card) => card.pageSlug),
  );
  const needsQuestion = candidates.filter((candidate) => !known.has(candidate.pageSlug));

  const questions = new Map<string, string>();
  if (!options.offline && needsQuestion.length > 0) {
    const batchSize = options.batchSize ?? 8;
    for (let index = 0; index < needsQuestion.length; index += batchSize) {
      const batch = needsQuestion.slice(index, index + batchSize);
      try {
        for (const [slug, question] of await modelQuestions(batch)) {
          questions.set(slug, question);
        }
      } catch {
        // Provider down, ChatMock restarting mid-request, no key configured —
        // all of which are recoverable by falling back to templates.
      }
    }
  }
  result.modelQuestions = questions.size;

  for (const candidate of candidates) {
    const outcome = options.store.upsertCard({
      userId: options.userId,
      gardenSlug: options.gardenSlug,
      pageSlug: candidate.pageSlug,
      pageTitle: candidate.pageTitle,
      question: questions.get(candidate.pageSlug) ?? templateQuestion(candidate.pageTitle),
      answer: candidate.answer,
      sourceHash: candidate.hash,
      now: options.now,
    });
    if (outcome.created) result.created += 1;
    else if (outcome.refreshed) result.refreshed += 1;
    else result.unchanged += 1;
  }

  options.store.markSeeded(options.userId, options.gardenSlug);
  return result;
}
