// Humanizer scores and preservation warnings, derived on the server.
//
// Two jobs. Score both versions with Breadboard's existing prose scorer — the
// one in `lib/prose-score`, not a second detector — and turn the service's
// warning codes into sentences a reader can act on.
//
// The score is a review signal and nothing more. It is a deterministic count of
// patterns that tend to show up in machine-written English, on a curve. It is
// not an AI detector, it cannot tell you who wrote something, and a rewrite that
// lowered it is not thereby safe: the preservation gate decides that, and this
// number is only ever advice. It stays internal and is used to decide whether
// an automatic rewrite is safe to adopt; it is not an AI-detector probability.

import { scoreProse, type ProseScore } from "../prose-score/index.ts";
import type { HumanizerWarning } from "./service.ts";
import type { HumanizerScoreSummary } from "./review-types.ts";

export interface ProseScoreSummary {
  score: number;
  band: string;
  confidence: "high" | "medium" | "low";
  patternScore: number;
  uniformityScore: number;
  topPatterns: { id: string; count: number; note?: string }[];
}

function summarize(analysis: ProseScore): ProseScoreSummary {
  return {
    score: analysis.score,
    band: analysis.band,
    confidence: analysis.confidence,
    patternScore: analysis.patternScore,
    uniformityScore: analysis.uniformityScore,
    topPatterns: analysis.topPatterns.slice(0, 5),
  };
}

/**
 * Score one version of the text.
 *
 * Breadboard's normal masking and profile: this is chat and garden Markdown, so
 * code fences, LaTeX, wikilinks and anchors must not be scored as though
 * somebody wrote them as sentences.
 */
export function scoreForReview(text: string): ProseScoreSummary {
  return summarize(scoreProse(text));
}

export interface ReviewScores {
  original: ProseScoreSummary;
  rewrite: ProseScoreSummary;
  /** Negative is an improvement. Reported honestly either way. */
  delta: number;
  /** The integer-valued rule set could not measure a difference. */
  tied: boolean;
  worsened: boolean;
}

export function scoreReview(original: string, rewritten: string): ReviewScores {
  const before = scoreForReview(original);
  const after = scoreForReview(rewritten);
  return {
    original: before,
    rewrite: after,
    delta: after.score - before.score,
    tied: after.score === before.score,
    // A rewrite that scores worse is still offered — it may read better to a
    // person, and the score is noisy on short passages. It is labelled, not
    // hidden, and never auto-rejected.
    worsened: after.score > before.score,
  };
}

export function summarizeReviewScores(scores: ReviewScores): HumanizerScoreSummary {
  return {
    original: scores.original.score,
    rewrite: scores.rewrite.score,
    delta: scores.delta,
    tied: scores.tied,
    worsened: scores.worsened,
  };
}

export interface RewriteIntegrityReview {
  passed: boolean;
  issues: string[];
}

function markdownLineSignature(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line): string[] => {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) return ["fence"];
    const heading = /^(#{1,6})\s+/.exec(trimmed);
    if (heading) return [`heading:${heading[1].length}`];
    if (/^\*\*[^*\n]+\*\*$/.test(trimmed)) return ["strong-heading"];
    if (/^>\s?/.test(trimmed)) return ["quote"];
    if (/^[-+*]\s+/.test(trimmed)) return ["bullet"];
    if (/^\d+[.)]\s+/.test(trimmed)) return ["numbered"];
    return [];
  });
}

function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function firstLetter(text: string): string | null {
  const stripped = text
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*/, "")
    .replace(/^>\s?/, "")
    .replace(/^[-+*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "");
  return stripped.match(/\p{L}/u)?.[0] ?? null;
}

function isUppercaseLetter(value: string): boolean {
  return value.toLocaleUpperCase() === value && value.toLocaleLowerCase() !== value;
}

function isLowercaseLetter(value: string): boolean {
  return value.toLocaleLowerCase() === value && value.toLocaleUpperCase() !== value;
}

/**
 * Catch cheap-but-destructive failures before an automatic rewrite is adopted.
 * These are preservation checks, not style opinions: paragraph boundaries,
 * Markdown framing, and a paragraph that suddenly starts with a truncated
 * lowercase token must not move under a standing preference.
 */
export function reviewRewriteIntegrity(
  original: string,
  rewritten: string,
): RewriteIntegrityReview {
  const issues: string[] = [];
  const originalParagraphs = paragraphs(original);
  const rewrittenParagraphs = paragraphs(rewritten);

  if (originalParagraphs.length !== rewrittenParagraphs.length) {
    issues.push("Paragraph structure changed.");
  }
  if (
    JSON.stringify(markdownLineSignature(original)) !==
    JSON.stringify(markdownLineSignature(rewritten))
  ) {
    issues.push("Markdown structure changed.");
  }
  if ((original.match(/\*\*/g) ?? []).length !== (rewritten.match(/\*\*/g) ?? []).length) {
    issues.push("Markdown emphasis markers changed.");
  }
  if ((original.match(/`/g) ?? []).length !== (rewritten.match(/`/g) ?? []).length) {
    issues.push("Code-span markers changed.");
  }

  if (originalParagraphs.length === rewrittenParagraphs.length) {
    const truncatedStart = originalParagraphs.some((paragraph, index) => {
      const before = firstLetter(paragraph);
      const after = firstLetter(rewrittenParagraphs[index]);
      return Boolean(before && after && isUppercaseLetter(before) && isLowercaseLetter(after));
    });
    if (truncatedStart) {
      issues.push("A paragraph appears to start with a truncated word.");
    }
  }

  return { passed: issues.length === 0, issues };
}

const WARNING_SENTENCES: Record<string, string> = {
  placeholder_lost: "a protected fragment (a link, a number, a code span) did not come back intact",
  literal_removed: "a fact the original stated was missing from the rewrite",
  literal_invented: "the rewrite introduced a value the original did not contain",
  length_out_of_bounds: "the rewrite was much shorter or much longer than the original",
  repeated_text: "the rewrite repeated itself",
  empty_rewrite: "the rewrite came back empty",
  invalid_unicode: "the rewrite contained characters that do not belong in prose",
  structure_changed: "the rewrite changed the formatting of the section",
  sentence_boundary_lost:
    "the rewrite ran sentences together or dropped a closing full stop",
  truncated_word: "the rewrite appears to start in the middle of a word",
  document_structure_changed: "the rewritten document no longer has the same structure",
  document_literal_removed: "a fact in the document was missing after the rewrite",
  document_literal_invented: "the rewritten document contained a value the original did not",
  unresolved_placeholder: "an internal marker survived into the rewritten text",
};

const KIND_NAMES: Record<string, string> = {
  url: "a link",
  email: "an email address",
  path: "a file path",
  flag: "a command-line flag",
  percent: "a percentage",
  currency: "an amount of money",
  date: "a date",
  time: "a time",
  version: "a version number",
  citation: "a citation",
  footnote: "a footnote",
  handle: "a handle",
  hashtag: "a hashtag",
  measurement: "a measurement",
  acronym: "an acronym",
  quote: "a quoted passage",
  number: "a number",
  name: "a name",
};

export interface ReviewWarnings {
  /** The one line shown without expanding anything. Null when nothing to say. */
  headline: string | null;
  /** One sentence per distinct reason, safe to show. */
  details: string[];
}

/**
 * Turn warning codes into sentences.
 *
 * Codes and category names only. The service deliberately never sends the
 * literals themselves, so there is nothing here that could leak a fragment of
 * the user's text into a tooltip, and nothing that names a service path, a port
 * or an internal module.
 */
export function describeWarnings(
  warnings: readonly HumanizerWarning[],
  revertedChunks: number,
): ReviewWarnings {
  const details: string[] = [];
  const seen = new Set<string>();
  for (const warning of warnings) {
    const base = WARNING_SENTENCES[warning.code];
    if (!base) continue;
    const kinds = warning.kinds
      .map((kind) => KIND_NAMES[kind])
      .filter((name): name is string => Boolean(name));
    const sentence = kinds.length > 0 ? `${base} (${kinds.join(", ")})` : base;
    const capitalized = sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
    if (seen.has(capitalized)) continue;
    seen.add(capitalized);
    details.push(capitalized);
  }

  const headline =
    revertedChunks > 0
      ? revertedChunks === 1
        ? "1 section kept its original wording because the model's alternative did not pass the safety checks."
        : `${revertedChunks} sections kept their original wording because the model's alternatives did not pass the safety checks.`
      : null;

  return { headline, details };
}
