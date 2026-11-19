/**
 * The final loop for written artifacts (Word, PDF, Markdown, text, slides,
 * HTML pages). Two halves:
 *
 * 1. `cleanArtifactTypography` is deterministic and runs at storage time for
 *    every producer, Bread or a specialist agent: em dashes, spaced en dashes,
 *    curly quotes and middle-dot separators are the tells the generated_look
 *    rule bans, and a prompt alone never guarantees them away.
 * 2. `reviewArtifactProse` scores what was stored (soundshuman's sloplint via
 *    prose-score, plus a plain-language check for sentences too long to
 *    follow) and tells the agent what to rewrite. The agent fixes it with
 *    artifact_update, which is reviewed again: that is the loop. It stops
 *    asking after MAX_REVIEW_PASSES so a stubborn page cannot spin forever.
 */

import { stripEmDashes } from "../prose-punctuation.ts";
import { maskGardenMarkdown, PROSE_SCORE_TARGET, scoreProse } from "../prose-score/index.ts";

/** Renderers whose stored source is prose the reader sees as written. */
const PROSE_RENDERERS = new Set(["markdown", "text", "docx", "pdf"]);
/** Markup renderers: text is cleaned, but quotes stay (they may delimit attributes). */
const MARKUP_RENDERERS = new Set(["html", "presentation-html"]);

/** artifact_create is pass 1; two artifact_update revisions after it, then report only. */
export const MAX_REVIEW_PASSES = 3;
const LONG_SENTENCE_WORDS = 35;
const VERY_LONG_SENTENCE_WORDS = 50;

export function artifactProseRenderer(rendererId: string | undefined): boolean {
  return !!rendererId && (PROSE_RENDERERS.has(rendererId) || MARKUP_RENDERERS.has(rendererId));
}

/** Rewrite `fn` over the parts of each line outside `$...$` math. */
function outsideMath(text: string, fn: (part: string) => string): string {
  return text
    .split("\n")
    .map((line) => line.split("$").map((part, i) => (i % 2 === 0 ? fn(part) : part)).join("$"))
    .join("\n");
}

function cleanPart(part: string, quotes: boolean): string {
  let out = part
    // A spaced en dash is punctuation; an unspaced one is a range (1–2) and stays.
    .replace(/[ \t]+–[ \t]+/g, ", ")
    // "Design · Build · Ship" separators. A dot between digits is multiplication.
    .replace(/([^\d\s])[ \t]*[·•][ \t]*(?=[^\d\s])/g, "$1, ");
  if (quotes) out = out.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'");
  return out;
}

export function cleanArtifactTypography(content: string, rendererId: string | undefined): string {
  if (!artifactProseRenderer(rendererId)) return content;
  const quotes = PROSE_RENDERERS.has(rendererId!);
  const dashed = stripEmDashes(content);
  // Fenced code is content, not the agent's writing: leave it byte-identical.
  return dashed
    .split(/(```[\s\S]*?```)/g)
    .map((chunk) => (chunk.startsWith("```") ? chunk : outsideMath(chunk, (p) => cleanPart(p, quotes))))
    .join("");
}

function proseOf(content: string, rendererId: string): string {
  if (!MARKUP_RENDERERS.has(rendererId)) return content;
  return content
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|section|br)>/gi, ".\n")
    .replace(/<[^>]+>/g, " ");
}

function longSentences(prose: string): string[] {
  const masked = maskGardenMarkdown(prose, { ignoreQuotes: true });
  return masked
    .split(/(?<=[.!?])\s+|\n{2,}|\n(?=\s*[-*#|>\d])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.split(" ").filter((w) => /[A-Za-z]/.test(w)).length > LONG_SENTENCE_WORDS);
}

export interface ArtifactProseReview {
  score: number;
  target: number;
  band: string;
  patterns: { id: string; count: number; note?: string }[];
  longSentences: string[];
  needsRevision: boolean;
  pass: number;
  instructions?: string;
}

export function reviewArtifactProse(
  content: string,
  rendererId: string,
  pass: number,
  /** Shorter texts are left alone; social posts pass a lower floor. */
  minWords = 60,
): ArtifactProseReview | null {
  if (!artifactProseRenderer(rendererId)) return null;
  const prose = proseOf(content, rendererId);
  if (prose.trim().split(/\s+/).length < minWords) return null;
  const scored = scoreProse(prose);
  const long = longSentences(prose);
  const flagged =
    scored.score > PROSE_SCORE_TARGET ||
    long.length >= 3 ||
    long.some((s) => s.split(" ").length > VERY_LONG_SENTENCE_WORDS);
  const needsRevision = flagged && pass < MAX_REVIEW_PASSES;
  return {
    score: scored.score,
    target: PROSE_SCORE_TARGET,
    band: scored.band,
    patterns: scored.topPatterns,
    longSentences: long.slice(0, 5).map((s) => (s.length > 220 ? `${s.slice(0, 220)}...` : s)),
    needsRevision,
    pass,
    ...(needsRevision
      ? {
          instructions:
            "This document still reads machine-written or is hard to follow. Before telling the user it is done, " +
            "rewrite it once with artifact_update (mode replace, full content) and render again. Remove the listed " +
            "patterns; split each long sentence into short ones; replace abstract or inflated words with plain, " +
            "concrete ones; define any term a newcomer would not know the first time it appears; cut filler, " +
            "summary endings and tidy three-part lists. Keep every fact, number, name, formula, code block and " +
            "the user's requested structure. Do not invent examples or claims. Use the slopbeth skill if loaded.",
        }
      : {}),
  };
}
